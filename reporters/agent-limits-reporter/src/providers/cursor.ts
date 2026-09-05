import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { config } from "../config.js";
import type { AgentRow } from "../site.js";
import { genericWindows, object, rowFromWindows, text } from "../windows.js";

const CURSOR_SESSION_EXPIRED = "Cursor session expired — run `agent login` to re-authenticate.";
const CURSOR_RPC = "https://api2.cursor.sh/aiserver.v1.DashboardService";

function asRecord(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function msToIso(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

function windowSeconds(start: unknown, end: unknown): number | null {
  const startMs = Number(start);
  const endMs = Number(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const startAbs = startMs < 1e12 ? startMs * 1000 : startMs;
  const endAbs = endMs < 1e12 ? endMs * 1000 : endMs;
  const seconds = Math.round((endAbs - startAbs) / 1000);
  return seconds > 0 ? seconds : null;
}

function usageWindow(
  usedPercent: unknown,
  resetAt: string | null,
  seconds: number | null,
  label: string,
): Record<string, unknown> | null {
  const n = Number(usedPercent);
  if (!Number.isFinite(n)) return null;
  const node: Record<string, unknown> = {
    used_percent: n,
    reset_at: resetAt,
    label,
  };
  if (seconds != null) node.limit_window_seconds = seconds;
  return node;
}

/** 把三份 DashboardService 响应规整成 genericWindows("cursor") 吃的形状。纯函数。 */
export function normalizeCursorUsage(
  period: unknown,
  plan: unknown,
  _hardLimit: unknown,
): Record<string, unknown> {
  const periodRec = asRecord(period);
  const planRec = asRecord(asRecord(plan)?.planInfo) ?? asRecord(plan);
  const usage = asRecord(periodRec?.planUsage);
  const start = periodRec?.billingCycleStart;
  const end = periodRec?.billingCycleEnd;
  const resetAt = msToIso(end);
  const seconds = windowSeconds(start, end);
  return {
    plan_label: text(planRec?.planName),
    primary_window: usageWindow(usage?.totalPercentUsed, resetAt, seconds, "Included"),
    secondary_window: usageWindow(usage?.autoPercentUsed, resetAt, seconds, "Auto"),
    tertiary_window: usageWindow(usage?.apiPercentUsed, resetAt, seconds, "API"),
  };
}

export function rowFromCursorResponses(input: unknown): AgentRow {
  const rec = asRecord(input) ?? {};
  const node = normalizeCursorUsage(rec.period, rec.plan, rec.hardLimit);
  return rowFromWindows("cursor", node, genericWindows("cursor", node));
}

function cursorAuthPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg || path.join(config.home || os.homedir(), ".config");
  return path.join(base, "cursor", "auth.json");
}

async function readCursorAccessToken(): Promise<string | null> {
  const fromEnv = config.cursorAuthToken;
  if (fromEnv) return fromEnv;
  try {
    const parsed: unknown = JSON.parse(await readFile(cursorAuthPath(), "utf8"));
    return text(asRecord(parsed)?.accessToken);
  } catch {
    return null;
  }
}

async function cursorRpc(accessToken: string, method: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${CURSOR_RPC}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-type": "cli",
    },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function fetchCursor(): Promise<AgentRow | null> {
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;

  try {
    const [period, plan, hardLimit] = await Promise.all([
      cursorRpc(accessToken, "GetCurrentPeriodUsage"),
      cursorRpc(accessToken, "GetPlanInfo"),
      cursorRpc(accessToken, "GetHardLimit"),
    ]);
    if ([period, plan, hardLimit].some((r) => r.status === 401 || r.status === 403)) {
      return { id: "cursor", plan: null, limits: [], limitsError: CURSOR_SESSION_EXPIRED };
    }
    const failed = [period, plan, hardLimit].find((r) => r.status !== 200);
    if (failed) {
      return { id: "cursor", plan: null, limits: [], limitsError: `Cursor API returned ${failed.status}` };
    }
    return rowFromCursorResponses({
      period: period.body,
      plan: plan.body,
      hardLimit: hardLimit.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "cursor", plan: null, limits: [], limitsError: message };
  }
}
