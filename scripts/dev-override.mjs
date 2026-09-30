import fs from "node:fs";
import path from "node:path";

import { site } from "../src/lib/site.ts";


const BASE = (process.env.DEV_WORKER_URL ?? "http://localhost:8788").replace(/\/+$/, "");
const FIXTURES_DIR = path.join(process.cwd(), "workers", "api", "dev-fixtures");

const [first, second] = process.argv.slice(2);

const NOW_TOKEN = /^\$now([+-]\d+)?$/;
const TODAY_TOKEN = /^\$today([+-]\d+)?$/;

// 日期偏移必须按日历计算，跨夏令时不等于固定 24 小时。
function siteDay(now, offsetDays) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: site.timezone }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

// 同一次推送的全部时间令牌必须共用同一个 now。
function stampNow(value, now = Date.now()) {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    if (match) return now + Number(match[1] ?? 0);
    const day = TODAY_TOKEN.exec(value);
    return day ? siteDay(now, Number(day[1] ?? 0)) : value;
  }
  if (Array.isArray(value)) return value.map((item) => stampNow(item, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stampNow(item, now)]));
  }
  return value;
}

function usage() {
  console.error(
    [
      "用法：",
      "  pnpm dev:override <端点路径> <夹具.json>",
      "  pnpm dev:override <端点路径> --clear",
      "  pnpm dev:override --list",
      "  pnpm dev:override --on | --off",
    ].join("\n"),
  );
  process.exit(2);
}

async function call(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (!response.ok) {
    console.error(`${init?.method ?? "GET"} ${pathname} → HTTP ${response.status}：${text.slice(0, 300)}`);
    if (response.status === 405) console.error("提示：本地 Worker 的 .dev.vars 里要有 DEV_OVERRIDES=true");
    process.exit(1);
  }
  return text;
}

if (!first || first === "--help") usage();

if (first === "--list") {
  console.log(await call("/api/dev/overrides"));
} else if (first === "--on" || first === "--off") {
  console.log(
    await call("/api/dev/overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: first === "--on" }),
    }),
  );
} else if (!first.startsWith("/api/")) {
  usage();
} else if (second === "--clear") {
  console.log(await call(`/api/dev/override${first}`, { method: "DELETE" }));
} else if (second) {
  const file = second.includes("/") || second.includes("\\") ? second : path.join(FIXTURES_DIR, second);
  const body = JSON.stringify(stampNow(JSON.parse(fs.readFileSync(file, "utf8"))));
  console.log(
    await call(`/api/dev/override${first}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
} else {
  usage();
}
