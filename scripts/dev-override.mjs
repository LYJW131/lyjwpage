import fs from "node:fs";
import path from "node:path";

/**
 * 往本地 Worker 注入 / 清除假数据（需要 .dev.vars 里 DEV_OVERRIDES=true）。
 *
 *   pnpm dev:override <端点路径> <夹具.json>   注入：body 是信封或直接是 data
 *   pnpm dev:override <端点路径> --clear      清掉这一条
 *   pnpm dev:override --list                  看现在注入了哪些、总开关开没开
 *   pnpm dev:override --on | --off            总开关：关掉不删夹具，只是不生效
 *
 * 端点路径就是浏览器问的那条，如 /api/status/watching/now。夹具可以是任意 JSON
 * 文件路径；只给文件名（不带斜杠）时到 workers/api/dev-fixtures/ 下找，
 * 例如 `pnpm dev:override /api/status/watching/now watching-now.json`。
 * Worker 地址默认 http://localhost:8788，用 DEV_WORKER_URL 覆盖。
 *
 * 时间戳令牌：夹具里的字符串 `"$now"`、`"$now-90000"`、`"$now+3600000"` 在推送
 * 那一刻换成 Date.now() 加偏移（毫秒）。带 pushedAt / lastSeenAt / observedAt 的
 * 夹具靠它保持新鲜 —— 注入绕过了路由，没人替它续心跳，写死的时间戳几分钟就过期。
 */

const BASE = (process.env.DEV_WORKER_URL ?? "http://localhost:8788").replace(/\/+$/, "");
const FIXTURES_DIR = path.join(process.cwd(), "workers", "api", "dev-fixtures");

const [first, second] = process.argv.slice(2);

const NOW_TOKEN = /^\$now([+-]\d+)?$/;

/** 递归把 "$now" / "$now-90000" 这类字符串换成 Date.now() 加偏移；同一次推送里所有令牌共用一个 now */
function stampNow(value, now = Date.now()) {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    return match ? now + Number(match[1] ?? 0) : value;
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
  // 总开关：关掉不删夹具，只是不生效；页面右下角的「Fake data」胶囊拨的是同一个
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
  // 先在本地把 JSON 错误报出来，别让 Worker 回 400 才知道；顺手把 $now 令牌换成此刻
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
