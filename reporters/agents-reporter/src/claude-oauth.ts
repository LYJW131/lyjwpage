import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { getClaudeOAuthClient } from "./claude-oauth-client.js";
import { info } from "./log.js";


const CREDENTIALS_FILE = ".credentials.json";
const SKEW_MS = 5 * 60_000;

type OauthBlob = {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  subscriptionType?: unknown;
  rateLimitTier?: unknown;
  scopes?: unknown;
  [key: string]: unknown;
};

type CredentialsFile = {
  claudeAiOauth?: OauthBlob;
  [key: string]: unknown;
};

function credentialsPath(home = config.home) {
  return path.join(home, ".claude", CREDENTIALS_FILE);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function expiryMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

export async function readClaudeOauth(home = config.home): Promise<OauthBlob | null> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath(home), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CredentialsFile;
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth !== "object" || Array.isArray(oauth)) return null;
    return oauth;
  } catch {
    return null;
  }
}

export function claudeAccessExpired(oauth: OauthBlob, now = Date.now()): boolean {
  const expires = expiryMs(oauth.expiresAt);
  if (expires == null) return false;
  return now + SKEW_MS >= expires;
}

async function writeCredentialsAtomic(file: CredentialsFile, home = config.home): Promise<void> {
  const dest = credentialsPath(home);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const json = `${JSON.stringify(file, null, 2)}\n`;
  await writeFile(tmp, json, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, dest);
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

async function refreshClaudeOauthOnce(home: string): Promise<boolean> {
  const dest = credentialsPath(home);
  let parsed: CredentialsFile;
  try {
    parsed = JSON.parse(await readFile(dest, "utf8")) as CredentialsFile;
  } catch (error) {
    throw new Error(
      `读 Claude 凭据失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const oauth = parsed.claudeAiOauth;
  if (!oauth || typeof oauth !== "object" || Array.isArray(oauth)) {
    throw new Error("Claude 凭据里没有 claudeAiOauth");
  }
  const refreshToken = asString(oauth.refreshToken);
  if (!refreshToken) throw new Error("Claude 凭据里没有 refreshToken");

  const client = await getClaudeOAuthClient();
  const scopes = Array.isArray(oauth.scopes)
    ? oauth.scopes.filter((scope): scope is string => typeof scope === "string" && !!scope.trim())
    : [];
  const body = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    ...(scopes.length ? { scope: scopes.join(" ") } : {}),
  });
  const response = await fetch(client.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => null)) as TokenResponse | null;
  const accessToken = asString(json?.access_token);
  if (!response.ok || !json || !accessToken ||
      typeof json.expires_in !== "number" || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    throw new Error(`Claude OAuth 刷新失败：HTTP ${response.status}`);
  }

  const next: OauthBlob = { ...oauth, accessToken };
  const rotated = asString(json.refresh_token);
  if (rotated) next.refreshToken = rotated;
  next.expiresAt = Date.now() + json.expires_in * 1000;
  if (typeof json.scope === "string" && json.scope.trim()) {
    next.scopes = json.scope.trim().split(/\s+/);
  }
  await writeCredentialsAtomic({ ...parsed, claudeAiOauth: next }, home);
  info("Claude OAuth 已刷新并写回");
  return true;
}

// 并发刷新会重复轮换 refresh token；到期检查和 401 重试必须共用同一次刷新。
const refreshing = new Map<string, Promise<boolean>>();

export function refreshClaudeOauth(home = config.home): Promise<boolean> {
  const key = path.resolve(home);
  const pending = refreshing.get(key);
  if (pending) return pending;
  const request = refreshClaudeOauthOnce(home).finally(() => refreshing.delete(key));
  refreshing.set(key, request);
  return request;
}

export async function refreshClaudeIfDue(home = config.home): Promise<void> {
  const oauth = await readClaudeOauth(home);
  if (!oauth) return;
  if (!claudeAccessExpired(oauth)) return;
  await refreshClaudeOauth(home);
}
