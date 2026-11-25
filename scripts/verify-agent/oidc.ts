import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { object, text } from "../../shared/json.ts";

export const ANTHROPIC_OIDC_AUDIENCE = "https://api.anthropic.com";
export const OAUTH_API_BETA_HEADER = "oauth-2025-04-20";

export type OidcRequest = {
  url: string;
  token: string;
};

export type OidcConfig = {
  request: OidcRequest;
  federationRuleId: string;
  organizationId: string;
  serviceAccountId?: string;
  workspaceId?: string;
  baseURL?: string;
};

export type AccessTokenResult = {
  token: string;
  expiresAt: number | null;
};

export type AccessTokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<AccessTokenResult>;

export type TokenCacheLike = {
  getToken: () => Promise<string>;
  invalidate: () => void;
};

export type AnthropicOidcSdk = {
  oidcFederationProvider: (config: {
    identityTokenProvider: () => Promise<string>;
    federationRuleId: string;
    organizationId: string;
    serviceAccountId?: string;
    workspaceId?: string;
    baseURL: string;
    fetch: typeof fetch;
  }) => AccessTokenProvider;
  TokenCache: new (provider: AccessTokenProvider, onAdvisoryRefreshError?: (err: unknown) => void) => TokenCacheLike;
};

export function parseOidcRequest(raw: string): OidcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OIDC 请求文件不是合法 JSON");
  }
  const record = object(parsed);
  if (!record) {
    throw new Error("OIDC 请求文件需要包含 url 与 token 字段的 JSON 对象");
  }
  const url = text(record.url);
  const token = text(record.token);
  if (!url || !token) {
    throw new Error("OIDC 请求文件缺少非空的 url 或 token");
  }
  return { url, token };
}

export async function fetchGitHubOidcToken(request: OidcRequest, audience = ANTHROPIC_OIDC_AUDIENCE, fetcher: typeof fetch = fetch): Promise<string> {
  // 直接拼接而不经过 URL.searchParams 重编码，避免改动 GitHub 签名 URL 里已有的查询参数
  const sep = request.url.includes("?") ? "&" : "?";
  const res = await fetcher(`${request.url}${sep}audience=${encodeURIComponent(audience)}`, {
    headers: { authorization: `Bearer ${request.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`获取 GitHub OIDC 令牌失败：HTTP ${res.status}`);
  const data = (await res.json()) as { value?: unknown };
  if (typeof data.value !== "string" || !data.value.trim()) throw new Error("GitHub OIDC 响应缺少 value");
  return data.value.trim();
}

export async function loadAnthropicOidcSdk(sdkDir: string): Promise<AnthropicOidcSdk> {
  const candidates = [path.join(sdkDir, "..", "pi-ai", "package.json"), path.join(sdkDir, "package.json")];
  let req: ReturnType<typeof createRequire> | null = null;
  let lastError: unknown = null;
  for (const anchor of candidates) {
    try {
      const candidate = createRequire(anchor);
      candidate.resolve("@anthropic-ai/sdk/lib/credentials/oidc-federation");
      req = candidate;
      break;
    } catch (caught) {
      lastError = caught;
    }
  }
  if (!req) throw new Error(`在 ${sdkDir} 附近找不到 @anthropic-ai/sdk OIDC 模块：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  const [federationMod, cacheMod] = await Promise.all([
    import(pathToFileURL(req.resolve("@anthropic-ai/sdk/lib/credentials/oidc-federation")).href),
    import(pathToFileURL(req.resolve("@anthropic-ai/sdk/lib/credentials/token-cache")).href),
  ]);
  return {
    oidcFederationProvider: federationMod.oidcFederationProvider as AnthropicOidcSdk["oidcFederationProvider"],
    TokenCache: cacheMod.TokenCache as AnthropicOidcSdk["TokenCache"],
  };
}

export function createOidcAuthFetch(config: OidcConfig, sdk: AnthropicOidcSdk, baseFetch: typeof fetch = fetch): typeof fetch {
  const baseURL = config.baseURL ?? ANTHROPIC_OIDC_AUDIENCE;
  const provider = sdk.oidcFederationProvider({
    // GitHub OIDC JWT 只有几分钟有效期，Anthropic 访问令牌快到期时按需向 GitHub 重新取一张
    identityTokenProvider: () => fetchGitHubOidcToken(config.request, ANTHROPIC_OIDC_AUDIENCE, baseFetch),
    federationRuleId: config.federationRuleId,
    organizationId: config.organizationId,
    serviceAccountId: config.serviceAccountId,
    workspaceId: config.workspaceId,
    baseURL,
    fetch: baseFetch,
  });
  const tokenCache = new sdk.TokenCache(provider, (err) => {
    console.error(`[oidc] 后台续期失败，暂沿用缓存令牌：${err instanceof Error ? err.message : String(err)}`);
  });

  const sendWithAuth = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const token = await tokenCache.getToken();
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${token}`);
    // 在原有 anthropic-beta 基础上追加 oauth beta，不能覆盖 pi-ai 设的 thinking / tool streaming beta
    const betas = (headers.get("anthropic-beta") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!betas.includes(OAUTH_API_BETA_HEADER)) betas.push(OAUTH_API_BETA_HEADER);
    headers.set("anthropic-beta", betas.join(","));
    return baseFetch(input, { ...init, headers });
  };

  return async (input, init) => {
    const res = await sendWithAuth(input, init);
    if (res.status !== 401) return res;
    await res.body?.cancel().catch(() => {});
    tokenCache.invalidate();
    return sendWithAuth(input, init);
  };
}

type ProviderLike = {
  id: string;
  auth: { apiKey?: unknown; oauth?: unknown };
  stream: (model: unknown, context: unknown, options?: Record<string, unknown>) => unknown;
  streamSimple: (model: unknown, context: unknown, options?: Record<string, unknown>) => unknown;
};

type ModelRuntimeLike = {
  getProvider: (id: string) => ProviderLike | undefined;
  registerNativeProvider: (provider: ProviderLike) => void;
};

export function installOidcAnthropicProvider(modelRuntime: ModelRuntimeLike, config: OidcConfig, sdk: AnthropicOidcSdk, baseFetch: typeof fetch = fetch) {
  const baseAnthropic = modelRuntime.getProvider("anthropic");
  if (!baseAnthropic) throw new Error("pi 的 ModelRuntime 里没有 anthropic 提供方");
  const authFetch = createOidcAuthFetch(config, sdk, baseFetch);
  modelRuntime.registerNativeProvider({
    ...baseAnthropic,
    auth: {
      ...baseAnthropic.auth,
      apiKey: {
        name: "Anthropic OIDC federation",
        // 返回占位 Authorization 头让 pi-ai 的 hasRequestAuth 通过而不走 sk-ant-oat 分支，真实令牌由 authFetch 每次注入
        resolve: async () => ({ auth: { headers: { Authorization: "Bearer oidc" } }, source: "oidc federation" }),
      },
    },
    stream: (model, context, options) => baseAnthropic.stream(model, context, { ...options, fetch: authFetch }),
    streamSimple: (model, context, options) => baseAnthropic.streamSimple(model, context, { ...options, fetch: authFetch }),
  });
}

// 环境变量删了 /proc/self/environ 里也还在：CI 里凭据只经文件进来，读完就删
export function readSecretFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const value = fs.readFileSync(file, "utf8").trim();
  fs.rmSync(file, { force: true });
  return value || undefined;
}

export type VerifyAuthArgs = {
  provider: string;
  oidcRequestFile?: string;
  federationRuleId?: string;
  organizationId?: string;
  serviceAccountId?: string;
  workspaceId?: string;
  apiKeyFile?: string;
  githubTokenFile?: string;
};

export type ResolvedVerifyAuth = {
  oidc: OidcConfig | null;
  apiKey: string | undefined;
  githubToken: string | undefined;
};

export function resolveVerifyAuth(args: VerifyAuthArgs, env: Record<string, string | undefined> = process.env): ResolvedVerifyAuth {
  const keyEnv = `${args.provider.toUpperCase().replaceAll("-", "_")}_API_KEY`;
  const oidcRequestRaw = readSecretFile(args.oidcRequestFile);
  const apiKey = readSecretFile(args.apiKeyFile) ?? env[keyEnv];
  const githubToken = readSecretFile(args.githubTokenFile) ?? env.GITHUB_TOKEN;
  const envOidcUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim();
  const envOidcToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim();
  const federationRuleId = args.federationRuleId?.trim() || env.ANTHROPIC_FEDERATION_RULE_ID?.trim();
  const organizationId = args.organizationId?.trim() || env.ANTHROPIC_ORGANIZATION_ID?.trim();
  const serviceAccountId = args.serviceAccountId?.trim() || env.ANTHROPIC_SERVICE_ACCOUNT_ID?.trim() || undefined;
  const workspaceId = args.workspaceId?.trim() || env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;

  for (const name of [
    "ANTHROPIC_API_KEY",
    keyEnv,
    "GITHUB_TOKEN",
    "PROMPT",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_SERVICE_ACCOUNT_ID",
    "ANTHROPIC_WORKSPACE_ID",
  ]) {
    delete env[name];
  }

  const wantsOidc = args.provider === "anthropic" && Boolean(args.oidcRequestFile || federationRuleId || organizationId || (envOidcUrl && envOidcToken && !apiKey));
  if (wantsOidc) {
    if (env.CI && !args.oidcRequestFile) {
      throw new Error("CI 里 OIDC 请求凭据要经 --oidc-request-file 传，不走环境变量");
    }
    const request = oidcRequestRaw ? parseOidcRequest(oidcRequestRaw) : envOidcUrl && envOidcToken ? { url: envOidcUrl, token: envOidcToken } : null;
    if (!request) {
      throw new Error("缺少 GitHub OIDC 请求凭据：给 --oidc-request-file（或非 CI 环境下的 ACTIONS_ID_TOKEN_REQUEST_URL / _TOKEN）");
    }
    if (!federationRuleId || !organizationId) {
      throw new Error("Anthropic OIDC 需要 --federation-rule-id 与 --organization-id（或 ANTHROPIC_FEDERATION_RULE_ID / ANTHROPIC_ORGANIZATION_ID）");
    }
    return { oidc: { request, federationRuleId, organizationId, serviceAccountId, workspaceId }, apiKey: undefined, githubToken };
  }

  if (!apiKey) {
    throw new Error(`没有 ${args.provider} 的凭据：Anthropic 可走 OIDC（--oidc-request-file + --federation-rule-id + --organization-id），或给 --api-key-file / ${keyEnv}`);
  }
  if (env.CI && !args.apiKeyFile) {
    throw new Error("CI 里钥匙要经 --api-key-file 传，不走环境变量");
  }
  return { oidc: null, apiKey, githubToken };
}
