import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import type { AgentRow } from "../site.js";
import { codexWindows, object, rowFromWindows, text } from "../windows.js";

const REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token";
/** 公开客户端 id，和官方 `codex` CLI / TokenTracker 同一份 */
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_THRESHOLD_MS = 8 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const CODEX_SESSION_WINDOW_SECONDS = 18_000;
const CODEX_WEEKLY_WINDOW_SECONDS = 604_800;
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

function asRecord(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function clampPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

export function parseJwtExpirationMs(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    const exp = Number(payload.exp);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isTokenStale(
  lastRefreshIso: string | null,
  nowMs = Date.now(),
  accessToken: string | null = null,
): boolean {
  const expiresAtMs = parseJwtExpirationMs(accessToken);
  if (expiresAtMs !== null) return expiresAtMs <= nowMs + ACCESS_TOKEN_REFRESH_WINDOW_MS;
  if (!lastRefreshIso) return true;
  const ts = Date.parse(lastRefreshIso);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts > REFRESH_THRESHOLD_MS;
}

function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const padLen = (4 - (parts[1].length % 4)) % 4;
    const padded = parts[1] + "=".repeat(padLen);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractOpenAiAuthNamespace(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null;
  return asRecord(payload[OPENAI_AUTH_CLAIM]);
}

function classifyCodexWindow(window: Record<string, unknown> | null): "session" | "weekly" | null {
  if (!window) return null;
  const seconds = Number(window.limit_window_seconds);
  if (!Number.isFinite(seconds)) return null;
  if (seconds === CODEX_SESSION_WINDOW_SECONDS) return "session";
  if (seconds === CODEX_WEEKLY_WINDOW_SECONDS) return "weekly";
  return null;
}

function normalizeCodexRateWindow(window: unknown): Record<string, unknown> | null {
  const rec = asRecord(window);
  if (!rec) return null;
  const usedPercent = clampPercent(rec.used_percent);
  if (usedPercent === null) return null;
  return { ...rec, used_percent: Math.round(usedPercent) };
}

export function normalizeCodexRateWindows(rateLimit: unknown): {
  primary_window: Record<string, unknown> | null;
  secondary_window: Record<string, unknown> | null;
} {
  const rec = asRecord(rateLimit);
  const primary = normalizeCodexRateWindow(rec?.primary_window);
  const secondary = normalizeCodexRateWindow(rec?.secondary_window);
  const candidates = [primary, secondary].filter(Boolean) as Record<string, unknown>[];
  let session: Record<string, unknown> | null = null;
  let weekly: Record<string, unknown> | null = null;
  for (const w of candidates) {
    const kind = classifyCodexWindow(w);
    if (kind === "session" && !session) session = w;
    else if (kind === "weekly" && !weekly) weekly = w;
  }
  if (!session && !weekly && candidates.length > 0) {
    return { primary_window: primary, secondary_window: secondary };
  }
  return { primary_window: session, secondary_window: weekly };
}

function isCodexSparkLimit(entry: unknown): boolean {
  const rec = asRecord(entry);
  if (!rec) return false;
  return [rec.limit_name, rec.metered_feature].some(
    (value) => typeof value === "string" && value.trim().toLowerCase().includes("spark"),
  );
}

function codexSparkFallbackCandidates(
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
): Array<{ kind: "session" | "weekly"; window: Record<string, unknown> }> {
  const primaryKind = classifyCodexWindow(primary);
  const secondaryKind = classifyCodexWindow(secondary);
  const out: Array<{ kind: "session" | "weekly"; window: Record<string, unknown> }> = [];
  const primaryDurationMissing =
    primary &&
    (primary.limit_window_seconds === undefined ||
      primary.limit_window_seconds === null ||
      primary.limit_window_seconds === "");

  if (primaryKind || secondaryKind) {
    if (!primaryKind && primary && secondaryKind === "weekly") out.push({ kind: "session", window: primary });
    if (!primaryKind && primaryDurationMissing && secondaryKind === "session" && primary) {
      out.push({ kind: "weekly", window: primary });
    }
    if (!secondaryKind && secondary && primaryKind === "weekly") out.push({ kind: "session", window: secondary });
    if (!secondaryKind && secondary && primaryKind === "session") out.push({ kind: "weekly", window: secondary });
    return out;
  }
  if (primary) out.push({ kind: "session", window: primary });
  if (secondary) out.push({ kind: "weekly", window: secondary });
  return out;
}

export function normalizeCodexSparkRateWindows(additionalRateLimits: unknown): {
  spark_primary_window: Record<string, unknown> | null;
  spark_secondary_window: Record<string, unknown> | null;
} {
  let session: Record<string, unknown> | null = null;
  let weekly: Record<string, unknown> | null = null;
  if (!Array.isArray(additionalRateLimits)) {
    return { spark_primary_window: null, spark_secondary_window: null };
  }

  const classified: Array<{ kind: "session" | "weekly"; window: Record<string, unknown> }> = [];
  const fallback: Array<{ kind: "session" | "weekly"; window: Record<string, unknown> }> = [];
  for (const entry of additionalRateLimits) {
    if (!isCodexSparkLimit(entry)) continue;
    const rateLimit = asRecord(asRecord(entry)?.rate_limit);
    if (!rateLimit) continue;
    const primary = normalizeCodexRateWindow(rateLimit.primary_window);
    const secondary = normalizeCodexRateWindow(rateLimit.secondary_window);
    for (const window of [primary, secondary]) {
      const kind = classifyCodexWindow(window);
      if (kind && window) classified.push({ kind, window });
    }
    fallback.push(...codexSparkFallbackCandidates(primary, secondary));
  }

  for (const candidate of classified) {
    if (candidate.kind === "session" && !session) session = candidate.window;
    else if (candidate.kind === "weekly" && !weekly) weekly = candidate.window;
  }
  for (const candidate of fallback) {
    if (candidate.kind === "session" && !session) session = candidate.window;
    else if (candidate.kind === "weekly" && !weekly) weekly = candidate.window;
  }
  return { spark_primary_window: session, spark_secondary_window: weekly };
}

/** 把 wham/usage 响应体规整成 codexWindows 吃的形状。纯函数。 */
export function normalizeCodexUsage(
  body: unknown,
  planType: string | null = null,
): Record<string, unknown> {
  const rec = asRecord(body) ?? {};
  return {
    // 线上套餐来自 access token 的 JWT claim；fixture 没有 JWT，退到响应体里的 plan_type
    plan_type: planType ?? text(rec.plan_type),
    ...normalizeCodexRateWindows(rec.rate_limit ?? rec),
    ...normalizeCodexSparkRateWindows(rec.additional_rate_limits),
  };
}

export function rowFromCodexUsage(body: unknown, planType: string | null = null): AgentRow {
  const node = normalizeCodexUsage(body, planType);
  return rowFromWindows("codex", node, codexWindows(node));
}

type CodexAuth = {
  accessToken: string;
  accountId: string | null;
  planType: string | null;
  refreshToken: string | null;
  lastRefresh: string | null;
  authPath: string;
  authJson: Record<string, unknown>;
};

function resolveCodexHome(home: string, env: NodeJS.ProcessEnv): string {
  const explicit = text(env.CODEX_HOME);
  return explicit ? path.resolve(explicit) : path.join(home, ".codex");
}

async function readCodexAuthBundle(): Promise<CodexAuth | null> {
  const authPath = path.join(resolveCodexHome(config.home, process.env), "auth.json");
  let raw: string;
  try {
    raw = await readFile(authPath, "utf8");
  } catch {
    return null;
  }
  let auth: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    const rec = asRecord(parsed);
    if (!rec) return null;
    auth = rec;
  } catch {
    return null;
  }
  const tokens = asRecord(auth.tokens);
  const accessToken = text(tokens?.access_token);
  if (!accessToken) return null;

  const accessPayload = decodeJwtPayload(tokens?.access_token);
  const idPayload = decodeJwtPayload(tokens?.id_token);
  const accessNs = extractOpenAiAuthNamespace(accessPayload);
  const idNs = extractOpenAiAuthNamespace(idPayload);
  const accountId =
    text(tokens?.account_id) ?? text(accessNs?.chatgpt_account_id) ?? text(idNs?.chatgpt_account_id);
  const planType = (
    text(accessNs?.chatgpt_plan_type) ??
    text(idNs?.chatgpt_plan_type) ??
    ""
  ).toLowerCase() || null;

  return {
    accessToken,
    accountId,
    planType,
    refreshToken: text(tokens?.refresh_token),
    lastRefresh: text(auth.last_refresh),
    authPath,
    authJson: auth,
  };
}

async function refreshCodexTokens(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  id_token: string | null;
}> {
  const res = await fetch(REFRESH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) {
    throw new Error("Codex refresh token was rejected. Run `codex login` to re-authenticate.");
  }
  if (!res.ok) throw new Error(`Codex token refresh failed: ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const access = text(body.access_token);
  if (!access) throw new Error("Codex token refresh response missing access_token");
  return {
    access_token: access,
    refresh_token: text(body.refresh_token) || refreshToken,
    id_token: text(body.id_token),
  };
}

async function persistRefreshedAuth(
  authPath: string,
  currentAuth: Record<string, unknown>,
  newTokens: { access_token: string; refresh_token: string; id_token: string | null },
): Promise<Record<string, unknown>> {
  const tokens = asRecord(currentAuth.tokens) ?? {};
  const merged: Record<string, unknown> = {
    ...currentAuth,
    tokens: {
      ...tokens,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      id_token: newTokens.id_token || tokens.id_token || null,
    },
    last_refresh: new Date().toISOString(),
  };
  const tmp = `${authPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, authPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return merged;
}

async function resolveCodexAccess(auth: CodexAuth): Promise<CodexAuth> {
  if (!auth.refreshToken || !isTokenStale(auth.lastRefresh, Date.now(), auth.accessToken)) {
    return auth;
  }
  const tokens = await refreshCodexTokens(auth.refreshToken);
  const authJson = await persistRefreshedAuth(auth.authPath, auth.authJson, tokens);
  return {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    lastRefresh: text(authJson.last_refresh),
    authJson,
  };
}

export async function fetchCodex(): Promise<AgentRow | null> {
  const bundle = await readCodexAuthBundle();
  if (!bundle) return null;

  let auth = bundle;
  try {
    auth = await resolveCodexAccess(bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "codex", plan: null, limits: [], limitsError: message };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "User-Agent": "agent-limits-reporter",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

  try {
    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        id: "codex",
        plan: null,
        limits: [],
        limitsError: `Codex API returned ${res.status}`,
      };
    }
    if (!res.ok) throw new Error(`Codex API returned ${res.status}`);
    return rowFromCodexUsage(await res.json(), auth.planType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "codex", plan: null, limits: [], limitsError: message };
  }
}
