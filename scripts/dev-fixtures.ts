import fs from "node:fs";
import path from "node:path";

import { site } from "../shared/site.ts";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const FIXTURES_DIR = path.join(ROOT, "workers", "core", "dev-fixtures");
export const SCENES_DIR = path.join(FIXTURES_DIR, "scenes");

export const workerBase = () => (process.env.DEV_WORKER_URL ?? "http://localhost:8788").replace(/\/+$/, "");

const NOW_TOKEN = /^\$now([+-]\d+)?$/;
const ISO_TOKEN = /^\$iso([+-]\d+)?$/;
const TODAY_TOKEN = /^\$today([+-]\d+)?$/;

const DAY_MS = 86_400_000;
const EPOCH_MS_FLOOR = 1_500_000_000_000;
const EPOCH_MS_CEIL = 2_500_000_000_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const NON_TIME_UNIT = /(?:Bytes|Count)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const offset = (delta: number): string => (delta === 0 ? "" : delta > 0 ? `+${delta}` : String(delta));

// 日期偏移必须按日历计算，跨夏令时不等于固定 24 小时。
export function siteDay(now: number, offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: site.timezone }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function dayOffset(now: number, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${siteDay(now, 0)}T00:00:00Z`)) / DAY_MS);
}

// 同一次注入的全部时间令牌必须共用同一个 now，否则成对的视图（摘要与 Pulse）会差出几毫秒到几秒。
export function stampNow(value: unknown, now: number): unknown {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    if (match) return now + Number(match[1] ?? 0);
    const iso = ISO_TOKEN.exec(value);
    if (iso) return new Date(now + Number(iso[1] ?? 0)).toISOString();
    const day = TODAY_TOKEN.exec(value);
    return day ? siteDay(now, Number(day[1] ?? 0)) : value;
  }
  if (Array.isArray(value)) return value.map((item) => stampNow(item, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stampNow(item, now)]));
  }
  return value;
}

// stampNow 的逆运算：抓下来的快照里像 epoch 毫秒、ISO 时刻、站点日期的值改写成相对 capturedAt 的令牌，
// 日后注入时整份平移到当下，否则「几分钟前」会越放越旧、新鲜度判定把卡片判成过期。
// 判据是值域：时长、偏移秒数都远小于 EPOCH_MS_FLOOR，只有绝对时刻落在区间里；累计字节数、计数会长进这个区间，
// 按字段名里的单位（跨端契约要求单位写进字段名）排除。
export function tokenize(value: unknown, capturedAt: number, key = ""): unknown {
  if (typeof value === "number") {
    const isTime = value > EPOCH_MS_FLOOR && value < EPOCH_MS_CEIL && !NON_TIME_UNIT.test(key);
    return isTime ? `$now${offset(Math.round(value - capturedAt))}` : value;
  }
  if (typeof value === "string") {
    if (ISO_INSTANT.test(value)) return `$iso${offset(Date.parse(value) - capturedAt)}`;
    if (ISO_DATE.test(value) && Math.abs(dayOffset(capturedAt, value)) <= 400) return `$today${offset(dayOffset(capturedAt, value))}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => tokenize(item, capturedAt, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, tokenize(item, capturedAt, name)]));
  }
  return value;
}

export function fixturePath(name: string): string {
  return name.includes("/") || name.includes("\\") ? path.resolve(name) : path.join(FIXTURES_DIR, name);
}

export function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export class WorkerError extends Error {}

export async function callWorker(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${workerBase()}${pathname}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (!response.ok) {
    const hint = response.status === 405 ? "\n提示：本地 Worker 的 workers/core/.dev.vars 里要有 DEV_OVERRIDES=true" : "";
    throw new WorkerError(`${init?.method ?? "GET"} ${pathname} → HTTP ${response.status}：${text.slice(0, 300)}${hint}`);
  }
  return JSON.parse(text);
}

export function putOverride(endpoint: string, body: unknown): Promise<unknown> {
  return callWorker(`/api/dev/override${endpoint}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function clearOverride(endpoint: string): Promise<unknown> {
  return callWorker(`/api/dev/override${endpoint}`, { method: "DELETE" });
}

export function switchOverrides(enabled: boolean): Promise<unknown> {
  return callWorker("/api/dev/overrides", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function listOverrides(): Promise<{ enabled: boolean; paths: string[] }> {
  return (await callWorker("/api/dev/overrides")) as { enabled: boolean; paths: string[] };
}
