import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { config } from "../config.js";
import type { AgentRow } from "../site.js";
import { genericWindows, object, rowFromWindows, text } from "../windows.js";

const DEFAULT_BILLING_BASE_URL = "https://cli-chat-proxy.grok.com";
const DEFAULT_BILLING_TIMEOUT_MS = 15_000;
const DEFAULT_SETTINGS_TIMEOUT_MS = 2_000;
const DEFAULT_OIDC_ISSUER = "https://auth.x.ai";
const DEFAULT_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function grokAuthError(): Error {
  const error = new Error("Not logged in to Grok Build. Run `grok login` in Terminal to authenticate.");
  (error as { code?: string }).code = "GROK_AUTH_REQUIRED";
  return error;
}

function grokReauthError(): Error {
  const error = new Error("Grok session expired. Run `grok login` in Terminal to re-authenticate.");
  (error as { code?: string }).code = "GROK_REAUTH_REQUIRED";
  return error;
}

function grokBillingTimeoutError(): Error {
  const error = new Error("Grok billing request timed out.");
  (error as { code?: string }).code = "GROK_BILLING_TIMEOUT";
  return error;
}

export function resolveGrokHome({
  home = config.home,
  env = process.env,
}: { home?: string; env?: NodeJS.ProcessEnv } = {}): string {
  if (typeof env.GROK_HOME === "string" && env.GROK_HOME.trim()) {
    return path.resolve(env.GROK_HOME.trim());
  }
  return path.join(home || os.homedir(), ".grok");
}

function grokValNumber(value: unknown): number | null {
  if (value == null) return null;
  const rec = asRecord(value);
  if (rec && "val" in rec) return grokValNumber(rec.val);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function grokIsoReset(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ts = Date.parse(value.trim());
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

function clampPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function buildWindow({
  usedPercent,
  resetAt,
  windowSeconds = null,
}: {
  usedPercent: unknown;
  resetAt: string | null;
  windowSeconds?: number | null;
}): Record<string, unknown> | null {
  const pct = clampPercent(usedPercent);
  if (pct === null) return null;
  const window: Record<string, unknown> = {
    used_percent: pct,
    reset_at: typeof resetAt === "string" && resetAt ? resetAt : null,
  };
  if (windowSeconds != null && Number.isFinite(windowSeconds) && windowSeconds > 0) {
    window.limit_window_seconds = windowSeconds;
  }
  return window;
}

function grokWindowSeconds({
  periodStart,
  resetAt,
  periodType,
}: {
  periodStart: string | null;
  resetAt: string | null;
  periodType: string | null;
}): number | null {
  const startMs = Date.parse(periodStart || "");
  const endMs = Date.parse(resetAt || "");
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const seconds = Math.round((endMs - startMs) / 1000);
    if (seconds > 0) return seconds;
  }
  if (periodType === "weekly") return 7 * 86400;
  if (periodType === "daily") return 86400;
  return null;
}

export function normalizeGrokPeriodType(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const upper = value.trim().toUpperCase();
  if (upper.includes("WEEK")) return "weekly";
  if (upper.includes("MONTH")) return "monthly";
  if (upper.includes("DAILY") || /(^|_)DAY($|_)/.test(upper) || upper === "DAY") return "daily";
  return null;
}

function inferGrokPeriodTypeFromDates(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const days = (endMs - startMs) / 86_400_000;
  if (days > 0.5 && days <= 1.5) return "daily";
  if (days > 1.5 && days <= 8) return "weekly";
  if (days >= 25 && days <= 35) return "monthly";
  return null;
}

function compactGrokPlanToken(raw: string): string {
  return String(raw).toLowerCase().replace(/[^a-z]/g, "");
}

export function displayGrokPlanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const token = compactGrokPlanToken(trimmed);
  if (token === "supergrokheavy" || token === "heavy") return "SuperGrok Heavy";
  if (token === "supergrok") return "SuperGrok";
  return trimmed;
}

export function parseGrokBillingSubscriptionTier(body: unknown): string | null {
  const rec = asRecord(body);
  if (!rec) return null;
  const cfg = asRecord(rec.config);
  return displayGrokPlanName(cfg?.subscriptionTier ?? rec.subscriptionTier);
}

function parseGrokSettingsTier(body: unknown): string | null {
  const rec = asRecord(body);
  if (!rec) return null;
  const settings = asRecord(rec.settings);
  const cfg = asRecord(rec.config);
  return displayGrokPlanName(
    rec.subscription_tier_display ?? settings?.subscription_tier_display ?? cfg?.subscription_tier_display,
  );
}

function sumProductUsagePercent(productUsage: unknown): number | null {
  if (!Array.isArray(productUsage)) return null;
  let sum = 0;
  let sawAny = false;
  for (const entry of productUsage) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const pct = clampPercent(rec.usagePercent);
    if (pct === null) continue;
    sawAny = true;
    sum += pct;
  }
  return sawAny ? clampPercent(sum) : null;
}

/** 把 billing 响应体规整成 genericWindows("grok") 吃的形状。纯函数。 */
export function normalizeGrokBillingResponse(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  const cfg = asRecord(rec?.config);
  if (!cfg) throw new Error("Could not parse Grok billing: missing config");

  const currentPeriod = asRecord(cfg.currentPeriod);
  const periodStart = grokIsoReset(currentPeriod?.start) || grokIsoReset(cfg.billingPeriodStart);
  const resetAt = grokIsoReset(currentPeriod?.end) || grokIsoReset(cfg.billingPeriodEnd);

  let periodType = normalizeGrokPeriodType(currentPeriod?.type);
  if (!periodType) periodType = inferGrokPeriodTypeFromDates(periodStart, resetAt);

  let usedPercent = clampPercent(cfg.creditUsagePercent);
  if (usedPercent === null) usedPercent = sumProductUsagePercent(cfg.productUsage);

  const monthlyLimit = grokValNumber(cfg.monthlyLimit);
  const used = grokValNumber(cfg.used);
  if (usedPercent === null && monthlyLimit && monthlyLimit > 0 && used !== null) {
    usedPercent = (used / monthlyLimit) * 100;
    if (!periodType) periodType = "monthly";
  }

  if (
    usedPercent === null &&
    currentPeriod &&
    (periodStart || resetAt) &&
    cfg.creditUsagePercent === undefined &&
    cfg.productUsage === undefined
  ) {
    usedPercent = 0;
  }

  const onDemandCap = grokValNumber(cfg.onDemandCap);
  const onDemandUsed = grokValNumber(cfg.onDemandUsed);
  const windowSeconds = grokWindowSeconds({ periodStart, resetAt, periodType });
  const primaryWindow = buildWindow({ usedPercent, resetAt, windowSeconds });

  let secondaryWindow: Record<string, unknown> | null = null;
  if (onDemandCap && onDemandCap > 0 && onDemandUsed !== null) {
    secondaryWindow = buildWindow({
      usedPercent: (onDemandUsed / onDemandCap) * 100,
      resetAt,
      windowSeconds,
    });
  }

  if (!primaryWindow && !secondaryWindow) {
    throw new Error("Could not parse Grok billing: no quota windows in response");
  }

  const planName = parseGrokBillingSubscriptionTier(body);
  return {
    period_type: periodType,
    plan_label: planName,
    monthly_credits_limit: monthlyLimit,
    monthly_credits_used: used,
    credit_usage_percent: usedPercent == null ? null : clampPercent(usedPercent),
    primary_window: primaryWindow,
    secondary_window: secondaryWindow,
  };
}

export function rowFromGrokBilling(body: unknown, planLabel: string | null = null): AgentRow {
  const node = normalizeGrokBillingResponse(body);
  if (planLabel) node.plan_label = planLabel;
  return rowFromWindows("grok", node, genericWindows("grok", node));
}

type GrokAuthEntry = Record<string, unknown>;
type LoadedGrokAuth = {
  entry: GrokAuthEntry;
  authPath: string;
  scopeKey: string;
  authFile: Record<string, unknown>;
};

function grokEntryRefreshToken(entry: GrokAuthEntry): string {
  return typeof entry.refresh_token === "string" ? entry.refresh_token.trim() : "";
}

function grokEntryAccessToken(entry: GrokAuthEntry): string {
  return typeof entry.key === "string" ? entry.key.trim() : "";
}

function resolveGrokOidcClientId(entry: GrokAuthEntry, scopeKey: string): string | null {
  if (typeof entry.oidc_client_id === "string" && entry.oidc_client_id.trim()) {
    return entry.oidc_client_id.trim();
  }
  if (scopeKey.includes("::")) {
    const suffix = scopeKey.slice(scopeKey.lastIndexOf("::") + 2).trim();
    if (suffix) return suffix;
  }
  return null;
}

function resolveGrokOidcIssuer(entry: GrokAuthEntry): string {
  if (typeof entry.oidc_issuer === "string" && entry.oidc_issuer.trim()) {
    return entry.oidc_issuer.trim().replace(/\/$/, "");
  }
  return DEFAULT_OIDC_ISSUER;
}

function resolveGrokTokenEndpoint(entry: GrokAuthEntry, env: NodeJS.ProcessEnv): string {
  if (typeof env.GROK_OIDC_TOKEN_ENDPOINT === "string" && env.GROK_OIDC_TOKEN_ENDPOINT.trim()) {
    return env.GROK_OIDC_TOKEN_ENDPOINT.trim();
  }
  const issuer = resolveGrokOidcIssuer(entry);
  if (issuer === DEFAULT_OIDC_ISSUER) return DEFAULT_TOKEN_ENDPOINT;
  return `${issuer}/oauth2/token`;
}

function isGrokAccessTokenExpired(expiresAt: unknown, nowMs = Date.now()): boolean {
  if (expiresAt == null || expiresAt === "") return false;
  const ts = typeof expiresAt === "number" ? expiresAt : Date.parse(String(expiresAt));
  if (!Number.isFinite(ts)) return false;
  return ts <= nowMs + ACCESS_TOKEN_EXPIRY_SKEW_MS;
}

export async function loadGrokAuthEntry({
  home = config.home,
  env = process.env,
}: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedGrokAuth | null> {
  const authPath = path.join(resolveGrokHome({ home, env }), "auth.json");
  if (!existsSync(authPath)) return null;
  let fallback: LoadedGrokAuth | null = null;
  try {
    const parsed: unknown = JSON.parse(await readFile(authPath, "utf8"));
    const rec = asRecord(parsed);
    if (!rec) return null;
    for (const [scopeKey, value] of Object.entries(rec)) {
      const entry = asRecord(value);
      if (!entry) continue;
      const key = typeof entry.key === "string" ? entry.key.trim() : "";
      const refreshToken = grokEntryRefreshToken(entry);
      if (key) return { entry, authPath, scopeKey, authFile: rec };
      if (refreshToken && !fallback && resolveGrokOidcClientId(entry, scopeKey)) {
        fallback = { entry, authPath, scopeKey, authFile: rec };
      }
    }
  } catch {
    return null;
  }
  return fallback;
}

async function refreshGrokTokens({
  refreshToken,
  clientId,
  tokenEndpoint,
}: {
  refreshToken: string;
  clientId: string;
  tokenEndpoint: string;
}): Promise<{ access_token: string; refresh_token: string; expires_at: string | null }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(DEFAULT_BILLING_TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 401) throw grokReauthError();
  if (!res.ok) throw new Error(`Grok token refresh failed: HTTP ${res.status}`);
  const payload = (await res.json()) as Record<string, unknown>;
  const accessToken = text(payload.access_token);
  if (!accessToken) throw new Error("Grok token refresh response missing access_token");
  const nextRefresh = text(payload.refresh_token) || refreshToken;
  let expiresAt: string | null = null;
  const expiresIn = Number(payload.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  } else if (typeof payload.expires_at === "string" && payload.expires_at.trim()) {
    const parsed = Date.parse(payload.expires_at.trim());
    if (Number.isFinite(parsed)) expiresAt = new Date(parsed).toISOString();
  }
  return { access_token: accessToken, refresh_token: nextRefresh, expires_at: expiresAt };
}

async function persistGrokRefreshedAuth(
  loaded: LoadedGrokAuth,
  newTokens: { access_token: string; refresh_token: string; expires_at: string | null },
): Promise<LoadedGrokAuth> {
  const nextEntry: GrokAuthEntry = {
    ...loaded.entry,
    key: newTokens.access_token,
    refresh_token: newTokens.refresh_token || loaded.entry.refresh_token,
  };
  if (newTokens.expires_at) nextEntry.expires_at = newTokens.expires_at;
  else delete nextEntry.expires_at;
  const merged = { ...loaded.authFile, [loaded.scopeKey]: nextEntry };
  const tmp = `${loaded.authPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, loaded.authPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { entry: nextEntry, authPath: loaded.authPath, scopeKey: loaded.scopeKey, authFile: merged };
}

async function resolveGrokAccessToken(forceRefresh = false): Promise<{
  accessToken: string | null;
  configured: boolean;
  canRefresh: boolean;
  refreshed: boolean;
  loaded: LoadedGrokAuth | null;
  error?: Error;
}> {
  const loaded = await loadGrokAuthEntry();
  if (!loaded) return { accessToken: null, configured: false, canRefresh: false, refreshed: false, loaded: null };

  const accessToken = grokEntryAccessToken(loaded.entry);
  const refreshToken = grokEntryRefreshToken(loaded.entry);
  const expired = isGrokAccessTokenExpired(loaded.entry.expires_at);
  const canRefresh = Boolean(refreshToken && resolveGrokOidcClientId(loaded.entry, loaded.scopeKey));
  const needsRefresh = forceRefresh || !accessToken || expired;

  if (!needsRefresh) {
    return { accessToken, configured: true, canRefresh, refreshed: false, loaded };
  }
  if (!canRefresh) {
    if (accessToken) {
      return { accessToken, configured: true, canRefresh: false, refreshed: false, loaded };
    }
    return { accessToken: null, configured: true, canRefresh: false, refreshed: false, loaded, error: grokAuthError() };
  }

  const clientId = resolveGrokOidcClientId(loaded.entry, loaded.scopeKey);
  if (!clientId) {
    return { accessToken: accessToken || null, configured: true, canRefresh: false, refreshed: false, loaded };
  }
  const tokens = await refreshGrokTokens({
    refreshToken,
    clientId,
    tokenEndpoint: resolveGrokTokenEndpoint(loaded.entry, process.env),
  });
  const persisted = await persistGrokRefreshedAuth(loaded, tokens);
  return { accessToken: tokens.access_token, configured: true, canRefresh: true, refreshed: true, loaded: persisted };
}

function grokHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "x-xai-token-auth": "xai-grok-cli",
  };
}

async function fetchGrokBillingAttempt(
  url: string,
  headers: Record<string, string>,
  deadlineMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const remainingMs = Math.ceil(deadlineMs - Date.now());
  if (remainingMs <= 0) throw grokBillingTimeoutError();
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(remainingMs),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw grokAuthError();
    return { ok: false, status: res.status };
  }
  return { ok: true, body: await res.json() };
}

async function fetchGrokBilling(accessToken: string): Promise<unknown> {
  const root = (
    (typeof process.env.GROK_CLI_CHAT_PROXY_BASE_URL === "string" &&
      process.env.GROK_CLI_CHAT_PROXY_BASE_URL.trim()) ||
    DEFAULT_BILLING_BASE_URL
  ).replace(/\/$/, "");
  const headers = grokHeaders(accessToken);
  const deadlineMs = Date.now() + DEFAULT_BILLING_TIMEOUT_MS;
  let creditsFailure = "request failed";
  try {
    const creditsResult = await fetchGrokBillingAttempt(
      `${root}/v1/billing?format=credits`,
      headers,
      deadlineMs,
    );
    if (creditsResult.ok) return creditsResult.body;
    creditsFailure = `HTTP ${creditsResult.status}`;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "GROK_AUTH_REQUIRED" || code === "GROK_BILLING_TIMEOUT") throw error;
  }
  const legacyResult = await fetchGrokBillingAttempt(`${root}/v1/billing`, headers, deadlineMs);
  if (!legacyResult.ok) {
    throw new Error(`Grok billing API returned ${legacyResult.status} (format=credits: ${creditsFailure})`);
  }
  return legacyResult.body;
}

async function fetchGrokSettingsTier(accessToken: string): Promise<string | null> {
  const root = (
    (typeof process.env.GROK_CLI_CHAT_PROXY_BASE_URL === "string" &&
      process.env.GROK_CLI_CHAT_PROXY_BASE_URL.trim()) ||
    DEFAULT_BILLING_BASE_URL
  ).replace(/\/$/, "");
  try {
    const result = await fetchGrokBillingAttempt(
      `${root}/v1/settings`,
      grokHeaders(accessToken),
      Date.now() + DEFAULT_SETTINGS_TIMEOUT_MS,
    );
    if (!result.ok) return null;
    return parseGrokSettingsTier(result.body);
  } catch {
    return null;
  }
}

export async function fetchGrok(): Promise<AgentRow | null> {
  const grokHome = resolveGrokHome();
  if (!existsSync(path.join(grokHome, "auth.json")) && !existsSync(path.join(grokHome, "sessions"))) {
    return null;
  }

  let resolved;
  try {
    resolved = await resolveGrokAccessToken();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "grok", plan: null, limits: [], limitsError: message };
  }
  if (!resolved.configured) return null;
  if (!resolved.accessToken) {
    return {
      id: "grok",
      plan: null,
      limits: [],
      limitsError: resolved.error?.message || grokAuthError().message,
    };
  }

  try {
    let accessToken = resolved.accessToken;
    let body: unknown;
    try {
      body = await fetchGrokBilling(accessToken);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "GROK_AUTH_REQUIRED" && resolved.canRefresh && !resolved.refreshed) {
        const retry = await resolveGrokAccessToken(true);
        if (!retry.accessToken) throw retry.error || grokReauthError();
        accessToken = retry.accessToken;
        body = await fetchGrokBilling(accessToken);
      } else {
        throw error;
      }
    }
    const settingsTier = await fetchGrokSettingsTier(accessToken);
    const planName = settingsTier || parseGrokBillingSubscriptionTier(body);
    return rowFromGrokBilling(body, planName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "grok", plan: null, limits: [], limitsError: message };
  }
}
