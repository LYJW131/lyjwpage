import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { info } from "../log.js";
import { scanOAuthClientCandidates, type OAuthClient } from "./antigravity-oauth-client.js";
import type { AgentRow } from "../site.js";
import { genericWindows, object, rowFromWindows, text } from "../windows.js";

const QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SKEW_MS = 5 * 60_000;
const EXPIRED_MESSAGE =
  "Antigravity token expired — run `agy` once or set ANTIGRAVITY_OAUTH_CLIENT_ID/SECRET";

const SLOTS = ["primary_window", "secondary_window", "tertiary_window", "quaternary_window"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function groupShortName(displayName: string): string {
  const trimmed = displayName.trim();
  if (/^gemini/i.test(trimmed)) return "Gemini";
  if (/claude/i.test(trimmed) && /gpt/i.test(trimmed)) return "Claude & GPT";
  return trimmed.replace(/\s+models?$/i, "");
}

function windowSeconds(window: string | null): number | null {
  if (window === "weekly") return 604_800;
  if (window === "5h") return 18_000;
  return null;
}

function windowLabel(window: string | null): string {
  if (window === "weekly") return "Weekly";
  if (window === "5h") return "5h";
  return window ?? "";
}

/** 把 retrieveUserQuotaSummary 响应规整成 genericWindows("antigravity") 吃的形状。纯函数。 */
export function normalizeAntigravityQuota(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  const groups = Array.isArray(rec?.groups) ? rec.groups : [];
  const node: Record<string, unknown> = {};
  let i = 0;
  for (const group of groups) {
    const groupRec = asRecord(group);
    if (!groupRec) continue;
    const short = groupShortName(text(groupRec.displayName) ?? "");
    const buckets = Array.isArray(groupRec.buckets) ? groupRec.buckets : [];
    for (const bucket of buckets) {
      const slot = SLOTS[i];
      if (!slot) return node;
      const bucketRec = asRecord(bucket);
      if (!bucketRec) continue;
      const remaining = Number(bucketRec.remainingFraction);
      if (!Number.isFinite(remaining)) continue;
      const window = text(bucketRec.window);
      const seconds = windowSeconds(window);
      const used = (1 - remaining) * 100;
      const entry: Record<string, unknown> = {
        used_percent: used,
        reset_at: text(bucketRec.resetTime),
        label: `${short} ${windowLabel(window)}`.trim(),
      };
      if (seconds != null) entry.limit_window_seconds = seconds;
      node[slot] = entry;
      i += 1;
    }
  }
  return node;
}

/**
 * 套餐：配额接口不带订阅。IDE 里那句「Google AI Pro」来自 Windsurf 那套 language server
 * 问 aicode.googleapis.com 的 gRPC，CLI 自己从不显示；`loadCodeAssist` 回的是 Code Assist
 * 档位（free-tier），不是订阅，拿来当套餐会显示错。所以由环境变量 ANTIGRAVITY_PLAN_LABEL
 * 指定，没配就 null（不渲染套餐标签）。
 */
export function rowFromAntigravityQuota(body: unknown, planLabel = config.antigravityPlanLabel): AgentRow {
  const node = normalizeAntigravityQuota(body);
  if (planLabel) node.plan_label = planLabel;
  return rowFromWindows("antigravity", node, genericWindows("antigravity", node));
}

type TokenFile = {
  token?: {
    access_token?: unknown;
    refresh_token?: unknown;
    expiry?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function tokenPath(home = config.home): string {
  return path.join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token");
}

function expiryMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function accessExpired(expiry: unknown, now = Date.now()): boolean {
  const ms = expiryMs(expiry);
  if (ms == null) return false;
  return now + SKEW_MS >= ms;
}

/**
 * 能用的 OAuth 客户端。环境变量配了就是它；没配就从 `agy` 二进制扫候选（只扫一次），
 * 刷新时逐对试，试对的记下来，之后不再试。
 */
let candidates: Promise<OAuthClient[]> | null = null;
let working: OAuthClient | null = null;

function oauthClientCandidates(): Promise<OAuthClient[]> {
  const { clientId, clientSecret } = config.antigravityOAuth;
  if (clientId && clientSecret) return Promise.resolve([{ clientId, clientSecret }]);
  candidates ??= scanOAuthClientCandidates(config.agyBin);
  return candidates;
}

async function refreshConfigured(): Promise<boolean> {
  return (await oauthClientCandidates()).length > 0;
}

async function requestRefresh(
  refreshToken: string,
  client: OAuthClient,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

async function readTokenFile(home = config.home): Promise<TokenFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(tokenPath(home), "utf8"));
    return asRecord(parsed) as TokenFile | null;
  } catch {
    return null;
  }
}

async function writeTokenFileAtomic(file: TokenFile, home = config.home): Promise<void> {
  const dest = tokenPath(home);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, dest);
}

async function refreshAntigravityToken(file: TokenFile, home = config.home): Promise<string> {
  const refreshToken = text(file.token?.refresh_token);
  if (!refreshToken) throw new Error("Antigravity 凭据里没有 refresh_token");

  /**
   * 先用上次试对的那对；没有就按候选顺序试。配错的那对 Google 回 401 invalid_client，
   * 换下一对；refresh_token 本身坏了（invalid_grant）换谁都没用，直接报出去。
   */
  const order = working ? [working] : await oauthClientCandidates();
  if (order.length === 0) throw new Error("没有可用的 Antigravity OAuth 客户端（环境变量没配，agy 二进制也扫不出）");
  let accessToken: string | null = null;
  let json: Record<string, unknown> | null = null;
  let lastStatus = 0;
  for (const client of order) {
    const result = await requestRefresh(refreshToken, client);
    lastStatus = result.status;
    accessToken = text(result.json?.access_token);
    if (result.status === 200 && accessToken) {
      working = client;
      json = result.json;
      break;
    }
    if (text(result.json?.error) === "invalid_grant") break;
  }
  if (!accessToken) {
    throw new Error(`Antigravity OAuth 刷新失败：HTTP ${lastStatus}`);
  }
  const token = { ...(file.token ?? {}), access_token: accessToken };
  const expiresIn = Number(json?.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    token.expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  const rotated = text(json?.refresh_token);
  if (rotated) token.refresh_token = rotated;
  await writeTokenFileAtomic({ ...file, token }, home);
  info("Antigravity OAuth 已刷新并写回");
  return accessToken;
}

async function retrieveQuota(accessToken: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(QUOTA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "antigravity/cli (agent-limits-reporter)",
    },
    body: JSON.stringify({ project: "aicode-consumers" }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function fetchAntigravity(): Promise<AgentRow | null> {
  const file = await readTokenFile();
  if (!file?.token) return null;
  let accessToken = text(file.token.access_token);
  const expired = accessExpired(file.token.expiry);

  const canRefresh = await refreshConfigured();
  if (expired && !canRefresh) {
    return { id: "antigravity", plan: null, limits: [], limitsError: EXPIRED_MESSAGE };
  }

  try {
    if (expired && canRefresh) {
      accessToken = await refreshAntigravityToken(file);
    }
    if (!accessToken) {
      return { id: "antigravity", plan: null, limits: [], limitsError: EXPIRED_MESSAGE };
    }

    let result = await retrieveQuota(accessToken);
    if (result.status === 401 && canRefresh) {
      const latest = (await readTokenFile()) ?? file;
      accessToken = await refreshAntigravityToken(latest);
      result = await retrieveQuota(accessToken);
    }
    if (result.status === 401 || result.status === 403) {
      return { id: "antigravity", plan: null, limits: [], limitsError: EXPIRED_MESSAGE };
    }
    if (result.status !== 200) {
      return {
        id: "antigravity",
        plan: null,
        limits: [],
        limitsError: `Antigravity quota HTTP ${result.status}`,
      };
    }
    return rowFromAntigravityQuota(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "antigravity", plan: null, limits: [], limitsError: message };
  }
}
