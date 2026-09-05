import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";
import { info } from "../log.js";
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

export function rowFromAntigravityQuota(body: unknown): AgentRow {
  const node = normalizeAntigravityQuota(body);
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

function refreshConfigured(): boolean {
  return Boolean(config.antigravityOAuth.clientId && config.antigravityOAuth.clientSecret);
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
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.antigravityOAuth.clientId,
    client_secret: config.antigravityOAuth.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = text(json?.access_token);
  if (!res.ok || !accessToken) {
    throw new Error(`Antigravity OAuth 刷新失败：HTTP ${res.status}`);
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

  if (expired && !refreshConfigured()) {
    return { id: "antigravity", plan: null, limits: [], limitsError: EXPIRED_MESSAGE };
  }

  try {
    if (expired && refreshConfigured()) {
      accessToken = await refreshAntigravityToken(file);
    }
    if (!accessToken) {
      return { id: "antigravity", plan: null, limits: [], limitsError: EXPIRED_MESSAGE };
    }

    let result = await retrieveQuota(accessToken);
    if (result.status === 401 && refreshConfigured()) {
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
