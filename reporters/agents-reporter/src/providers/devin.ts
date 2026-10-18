import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { config } from "../config.js";
import type { AgentLimit, AgentRow } from "../site.js";
import { object, text } from "../windows.js";

const DEVIN_SESSION_EXPIRED =
  "Devin session expired — run `devin auth login --force-manual-token-flow` to re-authenticate.";
const DEFAULT_API_SERVER = "https://server.codeium.com";
const USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";
const FALLBACK_CLIENT_VERSION = "0.0.0";

export type DevinCredentials = { apiKey: string; apiServerUrl: string };

export function parseDevinCredentials(toml: string): DevinCredentials | null {
  const values = new Map<string, string>();
  for (const line of toml.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (match) values.set(match[1]!, match[2]!.replace(/\\(.)/g, "$1"));
  }
  const apiKey = values.get("windsurf_api_key")?.trim();
  if (!apiKey) return null;
  const server = values.get("api_server_url")?.trim() || DEFAULT_API_SERVER;
  // API key 只发往 https 的 API 服务器，凭据文件被改成别的协议时退回默认地址。
  const apiServerUrl = server.startsWith("https://") ? server.replace(/\/+$/, "") : DEFAULT_API_SERVER;
  return { apiKey, apiServerUrl };
}

function devinCredentialsPath(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const base = xdg || path.join(config.home || os.homedir(), ".local", "share");
  return path.join(base, "devin", "credentials.toml");
}

async function readDevinCredentials(): Promise<DevinCredentials | null> {
  try {
    return parseDevinCredentials(await readFile(devinCredentialsPath(), "utf8"));
  } catch {
    return null;
  }
}

let clientVersion: Promise<string> | null = null;

// GetUserStatus 缺 ideVersion / extensionVersion 时回 400；目前不校验取值，带上镜像里 CLI 的真实版本以防日后按版本拦。
function devinClientVersion(): Promise<string> {
  clientVersion ??= promisify(execFile)(config.devinBin, ["--version"], { timeout: 5_000 })
    .then(({ stdout }) => /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? FALLBACK_CLIENT_VERSION)
    .catch(() => FALLBACK_CLIENT_VERSION);
  return clientVersion;
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// proto3 JSON 省略零值：额度用尽时 remainingPercent 整个字段消失，只剩重置时刻。
function quotaWindow(
  key: string,
  label: string,
  windowMinutes: number,
  remaining: unknown,
  resetAtUnix: unknown,
  hidden: unknown,
): AgentLimit | null {
  if (hidden === true) return null;
  const resetsAt = finite(resetAtUnix);
  const left = finite(remaining) ?? (resetsAt != null && resetsAt > 0 ? 0 : null);
  if (left == null) return null;
  return {
    key,
    label,
    group: null,
    windowMinutes,
    usedPercent: Math.min(100, Math.max(0, 100 - left)),
    resetsAt: resetsAt != null && resetsAt > 0 ? Math.trunc(resetsAt) : null,
  };
}

export function rowFromDevinStatus(body: unknown): AgentRow {
  const status = object(object(body)?.userStatus);
  const planStatus = object(status?.planStatus);
  const planInfo = object(planStatus?.planInfo);
  const planName = text(planInfo?.planName);
  const plan = planName ? { tier: planName, label: planName } : null;
  const limits = [
    quotaWindow(
      "devin.primary",
      "Daily",
      1_440,
      planStatus?.dailyQuotaRemainingPercent,
      planStatus?.dailyQuotaResetAtUnix,
      planInfo?.hideDailyQuota,
    ),
    quotaWindow(
      "devin.secondary",
      "Weekly",
      10_080,
      planStatus?.weeklyQuotaRemainingPercent,
      planStatus?.weeklyQuotaResetAtUnix,
      planInfo?.hideWeeklyQuota,
    ),
  ].filter((limit): limit is AgentLimit => limit != null);
  if (limits.length === 0) {
    return { id: "devin", plan, limits: [], limitsError: "Devin plan reports no daily or weekly quota" };
  }
  return { id: "devin", plan, limits, limitsError: null };
}

export async function fetchDevin(): Promise<AgentRow | null> {
  const credentials = await readDevinCredentials();
  if (!credentials) return null;

  try {
    const version = await devinClientVersion();
    const res = await fetch(`${credentials.apiServerUrl}${USER_STATUS_PATH}`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
      body: JSON.stringify({
        metadata: {
          apiKey: credentials.apiKey,
          ideName: "devin-cli",
          ideVersion: version,
          extensionName: "devin-cli",
          extensionVersion: version,
          locale: "en",
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { id: "devin", plan: null, limits: [], limitsError: DEVIN_SESSION_EXPIRED };
    }
    if (res.status !== 200) {
      return { id: "devin", plan: null, limits: [], limitsError: `Devin API returned ${res.status}` };
    }
    return rowFromDevinStatus(await res.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "devin", plan: null, limits: [], limitsError: message };
  }
}
