/**
 * 上报器配对登录：App 里点「登录」，浏览器过 Access 登录并确认，App 换回这个来源专用的
 * service token。协议见 docs/reporter-pairing.md，和 OAuth 授权码 + PKCE 同形。
 *
 * - `GET  /pair/authorize`：挂在 Access 应用「lyjwpage pairing」后面，只放行站长邮箱。
 *   验过 JWT 与参数后给一张确认页，不改任何东西。
 * - `POST /pair/authorize`：确认页提交。Allow 就发一张授权码（加密的来源 + challenge + 到期），
 *   302 回 App 的回调；Deny 回 `error=access_denied`。仍然不改任何东西。
 * - `POST /api/pair/token`：公开。码和 verifier 对上才调 Cloudflare API 轮换这个来源的
 *   service token（旧 secret 当场作废），新 secret 只在这一个响应里出现。
 *
 * 轮换放在兑换这步：浏览器半路关掉、回调没到都不会让设备掉线。
 */

import { verifyAccessJwt } from "@shared/access-jwt";

import type { Env } from "./runtime";

export const PAIR_AUTHORIZE_PATH = "/pair/authorize";
export const PAIR_TOKEN_PATH = "/api/pair/token";

const CODE_TTL_MS = 5 * 60_000;
const FORM_TTL_MS = 10 * 60_000;
const INGEST_ORIGIN = "https://ingest.homepage.lyjw.llc";

export type PairingSource = { tokenId: string; clientId: string; redirectUri: string; label?: string };

export type PairingEnv = Pick<
  Env,
  | "ACCESS_TEAM_DOMAIN"
  | "PAIRING_ACCESS_AUD"
  | "PAIRING_EMAILS"
  | "PAIRING_SOURCES"
  | "PAIRING_KEY"
  | "CF_ACCESS_API_TOKEN"
  | "CLOUDFLARE_ACCOUNT_ID"
>;

type AuthorizeParams = { source: string; redirectUri: string; state: string; challenge: string };
type CodePayload = { s: string; c: string; e: number };

/** 测试注入：替换对 Cloudflare API 的调用。 */
let rotateSecret: (env: PairingEnv, tokenId: string) => Promise<string> = async (env, tokenId) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/access/service_tokens/${tokenId}/rotate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_ACCESS_API_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; result?: { client_secret?: unknown }; errors?: { message?: string }[] }
    | null;
  const secret = body?.result?.client_secret;
  if (!response.ok || body?.success !== true || typeof secret !== "string" || !secret) {
    throw new Error(`轮换失败：${response.status} ${body?.errors?.map((e) => e.message).join("；") ?? ""}`);
  }
  return secret;
};

export function setRotateForTests(fn: typeof rotateSecret): void {
  rotateSecret = fn;
}

function sources(env: PairingEnv): Record<string, PairingSource> {
  const table = env.PAIRING_SOURCES;
  return table && typeof table === "object" ? (table as Record<string, PairingSource>) : {};
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function pairingKeyBytes(env: PairingEnv): Uint8Array<ArrayBuffer> {
  const bytes = env.PAIRING_KEY ? fromB64url(env.PAIRING_KEY.trim()) : new Uint8Array(0);
  if (bytes.length !== 32) throw new Error("PAIRING_KEY 必须是 32 字节（base64）");
  return bytes;
}

async function aesKey(env: PairingEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", pairingKeyBytes(env), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hmacKey(env: PairingEnv): Promise<CryptoKey> {
  // 同一把 PAIRING_KEY 派一把专门签表单的，不拿加密用的钥匙直接签
  const derived = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`form:${b64url(pairingKeyBytes(env))}`));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sealCode(env: PairingEnv, payload: CodePayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(env),
    new TextEncoder().encode(JSON.stringify(payload)),
  ));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return b64url(out);
}

async function openCode(env: PairingEnv, code: string): Promise<CodePayload | null> {
  try {
    const bytes = fromB64url(code);
    if (bytes.length < 13) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await aesKey(env), bytes.slice(12));
    const payload = JSON.parse(new TextDecoder().decode(plain)) as CodePayload;
    return typeof payload.s === "string" && typeof payload.c === "string" && typeof payload.e === "number" ? payload : null;
  } catch {
    return null;
  }
}

async function formToken(env: PairingEnv, params: AuthorizeParams, email: string, issuedAt: number): Promise<string> {
  const message = JSON.stringify([params.source, params.redirectUri, params.state, params.challenge, email, issuedAt]);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(message));
  return `${issuedAt}.${b64url(new Uint8Array(signature))}`;
}

async function formTokenValid(env: PairingEnv, params: AuthorizeParams, email: string, token: string, now: number): Promise<boolean> {
  const [issued, signature] = token.split(".");
  const issuedAt = Number(issued);
  if (!Number.isSafeInteger(issuedAt) || !signature || now - issuedAt > FORM_TTL_MS || issuedAt > now + 60_000) return false;
  const message = JSON.stringify([params.source, params.redirectUri, params.state, params.challenge, email, issuedAt]);
  return crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(signature), new TextEncoder().encode(message));
}

function readParams(get: (name: string) => string | null, env: PairingEnv): AuthorizeParams | string {
  const source = get("source") ?? "";
  const entry = sources(env)[source];
  if (!entry) return "Unknown source.";
  const redirectUri = get("redirect_uri") ?? "";
  if (redirectUri !== entry.redirectUri) return "redirect_uri does not match this source.";
  const state = get("state") ?? "";
  if (!state || state.length > 200) return "Missing or oversized state.";
  const challenge = get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return "code_challenge must be a base64url SHA-256 digest.";
  if ((get("code_challenge_method") ?? "S256") !== "S256") return "Only S256 is supported.";
  return { source, redirectUri, state, challenge };
}

/** 验「lyjwpage pairing」签的 JWT，并且邮箱在白名单里。 */
async function signedInEmail(request: Request, env: PairingEnv): Promise<string | null> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return null;
  const claims = await verifyAccessJwt(assertion, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.PAIRING_ACCESS_AUD });
  const email = claims?.email?.toLowerCase() ?? null;
  const allowed = (env.PAIRING_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return email && allowed.includes(email) ? email : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string, env: PairingEnv, status = 200): Response {
  const schemes = Object.values(sources(env)).map((entry) => `${new URL(entry.redirectUri).protocol}`).join(" ");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font-family:-apple-system,system-ui,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
main{max-width:26rem;padding:2rem 1.25rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{line-height:1.5;opacity:.85}
code{font-size:.95em}.row{display:flex;gap:.75rem;margin-top:1.5rem}
button{flex:1;font:inherit;padding:.7rem 1rem;border-radius:.6rem;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);background:Canvas;color:CanvasText;cursor:pointer}
button[value=allow]{background:CanvasText;color:Canvas;border-color:CanvasText}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Chrome 对表单提交后的跳转也执行 form-action，App 的回调 scheme 得在名单里
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${schemes}; frame-ancestors 'none'; base-uri 'none'`,
      // 不能用 no-referrer：那样浏览器提交表单时把 Origin 发成 null，同源检查会把自己拒掉
      "Referrer-Policy": "same-origin",
    },
  });
}

function redirectTo(uri: string, query: Record<string, string>): Response {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}

/**
 * 表单只能从这个页面自己提交。认 Origin；Origin 缺席或是 null（隐私设置、老版本浏览器）时
 * 退到浏览器自己加、页面改不了的 Sec-Fetch-Site。两样都不说同源就拒。防伪字段另外照验。
 */
function sameOriginSubmission(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") return origin === new URL(request.url).origin;
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

export async function handleAuthorize(request: Request, env: PairingEnv, now = Date.now()): Promise<Response> {
  const email = await signedInEmail(request, env);
  if (!email) return page("Sign-in required", "<h1>Sign-in required</h1><p>This page only works behind Cloudflare Access for the site owner.</p>", env, 401);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const params = readParams((name) => url.searchParams.get(name), env);
    if (typeof params === "string") return page("Invalid request", `<h1>Invalid request</h1><p>${escapeHtml(params)}</p>`, env, 400);
    const label = sources(env)[params.source]?.label ?? params.source;
    const token = await formToken(env, params, email, now);
    const hidden = [
      ["source", params.source], ["redirect_uri", params.redirectUri], ["state", params.state],
      ["code_challenge", params.challenge], ["code_challenge_method", "S256"], ["form_token", token],
    ].map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value!)}">`).join("");
    return page("Allow reporter sign-in", `<h1>Allow ${escapeHtml(label)} to report?</h1>
<p>Signed in as <code>${escapeHtml(email)}</code>. Allowing issues a new credential for the <code>${escapeHtml(params.source)}</code> source; the one currently on that device stops working.</p>
<p>Only continue if you just tapped sign-in in that app.</p>
<form method="post">${hidden}<div class="row"><button name="decision" value="deny">Deny</button><button name="decision" value="allow">Allow</button></div></form>`, env);
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!sameOriginSubmission(request)) {
    console.log("[pairing] 拒绝跨站提交", request.headers.get("Origin"), request.headers.get("Sec-Fetch-Site"));
    return page("Invalid request", "<h1>Invalid request</h1><p>Cross-site submission rejected.</p>", env, 403);
  }
  const form = await request.formData();
  const get = (name: string) => { const value = form.get(name); return typeof value === "string" ? value : null; };
  const params = readParams(get, env);
  if (typeof params === "string") return page("Invalid request", `<h1>Invalid request</h1><p>${escapeHtml(params)}</p>`, env, 400);
  if (!(await formTokenValid(env, params, email, get("form_token") ?? "", now))) {
    return page("Expired", "<h1>This page expired</h1><p>Start sign-in again from the app.</p>", env, 400);
  }
  if (get("decision") !== "allow") return redirectTo(params.redirectUri, { error: "access_denied", state: params.state });
  const code = await sealCode(env, { s: params.source, c: params.challenge, e: now + CODE_TTL_MS });
  return redirectTo(params.redirectUri, { code, state: params.state });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleExchange(request: Request, env: PairingEnv, now = Date.now()): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "只接受 POST" }, 405);
  let body: { code?: unknown; codeVerifier?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  if (typeof body.code !== "string" || typeof body.codeVerifier !== "string" || body.code.length > 1_000) {
    return json({ ok: false, error: "缺少 code 或 codeVerifier" }, 400);
  }
  const payload = await openCode(env, body.code);
  if (!payload || payload.e < now) return json({ ok: false, error: "授权码无效或已过期，请重新登录" }, 400);
  if (b64url(await sha256(body.codeVerifier)) !== payload.c) return json({ ok: false, error: "codeVerifier 不匹配" }, 400);
  const entry = sources(env)[payload.s];
  if (!entry) return json({ ok: false, error: "这个来源不支持配对" }, 400);

  let clientSecret: string;
  try {
    clientSecret = await rotateSecret(env, entry.tokenId);
  } catch (error) {
    console.error("[pairing]", payload.s, error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "轮换凭据失败，详情见 Worker 日志" }, 502);
  }
  console.log("[pairing] 已为来源换发凭据", payload.s);
  return json({
    ok: true,
    data: { source: payload.s, clientId: entry.clientId, clientSecret, ingestUrl: `${INGEST_ORIGIN}/api/ingest/${payload.s}` },
  });
}
