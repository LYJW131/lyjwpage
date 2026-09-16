import assert from "node:assert/strict";
import { test } from "node:test";
import { StorageClient } from "@shared/storage-client";
import { get, put } from "./cache.ts";
import { fetchPageSpeed, mergePageSpeed, parsePageSpeed, refreshPageSpeed } from "./pagespeed.ts";
import { site } from "./site.ts";
import { installStorageForTests, key, resetStorageForTests } from "./storage.ts";
import type { LighthouseVitals, PageSpeedSample } from "./vercel-deployments-types.ts";

/** 字段名和形状照 runPagespeed 的真实响应，只留用到的那几条审计。 */
const response = (overrides: Record<string, unknown> = {}) => ({
  captchaResult: "CAPTCHA_NOT_NEEDED",
  lighthouseResult: {
    categories: { performance: { score: 0.86, id: "performance" } },
    audits: {
      "largest-contentful-paint": { numericValue: 3827, displayValue: "3.8 s" },
      "total-blocking-time": { numericValue: 122 },
      "cumulative-layout-shift": { numericValue: 0.004269627106685612 },
      "first-contentful-paint": { numericValue: 1220 },
      "server-response-time": { numericValue: 161.5 },
      "final-screenshot": { details: { data: "data:image/webp;base64,private" } },
    },
  },
  ...overrides,
});

test("Lighthouse 评分按百分制取整，CLS 保留三位，其余毫秒取整", () => {
  const data = parsePageSpeed(response());
  assert.deepEqual(data, { score: 86, lcpMs: 3827, tbtMs: 122, cls: 0.004, fcpMs: 1220, ttfbMs: 162 });
  assert.doesNotMatch(JSON.stringify(data), /private|displayValue|screenshot/);
});

test("跑通但缺某条审计只让那一格为空，评分缺失才判整轮无效", () => {
  const audits = { "largest-contentful-paint": { numericValue: 900 }, "cumulative-layout-shift": {} };
  const partial = parsePageSpeed(response({ lighthouseResult: { categories: { performance: { score: 1 } }, audits } }));
  assert.deepEqual(partial, { score: 100, lcpMs: 900, tbtMs: null, cls: null, fcpMs: null, ttfbMs: null });
  assert.throws(() => parsePageSpeed(response({ lighthouseResult: { categories: {}, audits: {} } })), /评分缺失/);
  assert.throws(() => parsePageSpeed({ error: { code: 400 } }));
  assert.throws(() => parsePageSpeed(response({ captchaResult: "CAPTCHA_BLOCKING" })), /人机验证/);
});

test("只取性能类别与裁剪过的字段，密钥只出现在查询串里", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed");
    assert.equal(url.searchParams.get("url"), "https://lyjw.me");
    assert.equal(url.searchParams.get("strategy"), "mobile");
    assert.equal(url.searchParams.get("category"), "performance");
    assert.equal(url.searchParams.get("key"), "test-key");
    // 整份响应带截图有 800 KB，裁掉后才是 Worker 真正要解的那点
    assert.match(url.searchParams.get("fields") ?? "", /^captchaResult,lighthouseResult\(/);
    return new Response(JSON.stringify(response()), { headers: { "Content-Type": "application/json" } });
  });
  assert.equal((await fetchPageSpeed("https://lyjw.me", "mobile", "test-key")).score, 86);
});

test("上游非 200 只报状态码，不把密钥或响应体带进错误", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{\"error\":{\"message\":\"API key not valid\"}}", { status: 400 }));
  await assert.rejects(fetchPageSpeed("https://lyjw.me", "desktop", "secret-key"), (error: Error) => {
    assert.match(error.message, /\(400\)/);
    assert.doesNotMatch(error.message, /secret-key|API key/);
    return true;
  });
});

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-16T04:00:00Z");
const vitals = (score: number, over: Partial<LighthouseVitals> = {}): LighthouseVitals =>
  ({ score, lcpMs: 900, tbtMs: 40, cls: 0.004, fcpMs: 330, ttfbMs: 210, ...over });
const at = (hoursAgo: number, score: number, over: Partial<LighthouseVitals> = {}): PageSpeedSample =>
  ({ at: NOW - hoursAgo * HOUR, desktop: vitals(score, over), mobile: vitals(score - 10) });

test("跑测机卡住的那一轮被窗口里其余几轮的中位数压住", () => {
  const previous = [at(3, 96), at(2, 95), at(1, 97)];
  const { payload, history } = mergePageSpeed(previous, at(0, 65, { tbtMs: 1000 }));
  assert.equal(history.length, 4);
  assert.equal(payload.samples, 4);
  // 96、95、97、65 排序后中间两个是 95 和 96
  assert.equal(payload.desktop.score, 96);
  assert.equal(payload.desktop.tbtMs, 40);
  assert.equal(payload.mobile.score, 86);
  assert.equal(payload.start, NOW - 3 * HOUR);
  assert.equal(payload.fetchedAt, NOW);
});

test("窗口按时间滚动，超出六小时的旧实测不再参与", () => {
  const { payload, history } = mergePageSpeed([at(9, 20), at(7, 20), at(5, 90), at(1, 94)], at(0, 98));
  assert.deepEqual(history.map(row => row.desktop.score), [90, 94, 98]);
  assert.equal(payload.samples, 3);
  assert.equal(payload.desktop.score, 94);
  assert.equal(payload.start, NOW - 5 * HOUR);
});

test("第一轮就是中位数本身；历史坏了或没有都从这一轮重新攒", () => {
  for (const previous of [undefined, [], "corrupt", [{ at: NOW, desktop: null }]]) {
    const { payload } = mergePageSpeed(previous, at(0, 88));
    assert.equal(payload.samples, 1, `previous=${JSON.stringify(previous)}`);
    assert.equal(payload.desktop.score, 88);
    assert.equal(payload.start, NOW);
  }
});

test("某几轮测不出的指标只按测出来的那几轮算，一轮都没有才是空", () => {
  const previous = [at(2, 96, { tbtMs: null, cls: null }), at(1, 96, { tbtMs: 100, cls: null })];
  const { payload } = mergePageSpeed(previous, at(0, 96, { tbtMs: 200, cls: null }));
  assert.equal(payload.desktop.tbtMs, 150);
  assert.equal(payload.desktop.cls, null);
  assert.equal(payload.desktop.lcpMs, 900);
});

/**
 * 提交顺序的回归测试。
 *
 * 线上失败面：Worker 侧 storage 写失败会冒泡（`workers/api/src/storage-driver.ts` 特意不吞错，
 * `workers/api/tsconfig.json` 把 `@/lib/storage-driver` 重映射到它），所以成功路径上那几笔写
 * 是可以中途抛的。history 先落盘、pending 最后清的话，中途抛了就把 pending 留成一张可重放的
 * 提交凭证 —— 五分钟后 attempt 过期，拿同一份 desktop 再测一次移动端又追加一条，而
 * mergePageSpeed 只按 at 追加、不去重，窗口里就多出一个共用同一份 desktop 的样本。
 *
 * 这里**测不出那次重放**：单测跑的是 `src/lib/storage-driver.ts`，它 try/catch 吞掉写失败并
 * 返回 fallback，`put` 在 Node 下根本不抛。所以钉住的是修复本身确立的那条不变量 ——
 * **消费 pending 必须排在提交 history 之前**。顺序反了这条就红，正是回归时会踩的那一步。
 */
const cacheKey = (suffix = "") => key("cache", `pagespeed:v2:${site.url}${suffix}`);

/** 只实现 pagespeed 用到的 get / set / remove，顺带按顺序记录下来。 */
function recordingStorage() {
  const entries = new Map<string, string>();
  const ops: string[] = [];
  const client = new StorageClient(async (commands) => commands.map((command) => {
    ops.push(`${command.op} ${command.key}`);
    switch (command.op) {
      case "get": return entries.get(command.key) ?? null;
      case "set":
        if (entries.has(command.key) && command.options?.ifAbsent) return false;
        entries.set(command.key, command.value);
        return true;
      case "remove": return entries.delete(command.key) ? 1 : 0;
      default: throw new Error(`unexpected op ${command.op}`);
    }
  }));
  return { client, ops };
}

test("提交顺序：pending 在 history 落盘之前就被消费，不留下可重放的提交凭证", async (t) => {
  const store = recordingStorage();
  installStorageForTests(store.client);
  t.after(() => resetStorageForTests());
  process.env.PAGESPEED_API_KEY = "test-key";
  t.after(() => { delete process.env.PAGESPEED_API_KEY; });

  let mobileRuns = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (new URL(String(input)).searchParams.get("strategy") === "mobile") mobileRuns++;
    return new Response(JSON.stringify(response()), { headers: { "Content-Type": "application/json" } });
  });

  // 这一轮的桌面端已经测完、攒在 pending 里，只差移动端
  await put(`pagespeed:v2:${site.url}:pending`, { desktop: vitals(90) }, HOUR);
  await refreshPageSpeed();

  assert.equal(mobileRuns, 1, "pending 里有 desktop 时这一轮只该补移动端");
  assert.equal((await get<PageSpeedSample[]>(`pagespeed:v2:${site.url}:history`))?.length, 1);
  assert.equal(await get(`pagespeed:v2:${site.url}:pending`), undefined, "提交完 pending 必须已经空了");

  const removedPending = store.ops.indexOf(`remove ${cacheKey(":pending")}`);
  const wroteHistory = store.ops.indexOf(`set ${cacheKey(":history")}`);
  assert.ok(removedPending >= 0, "应当消费掉 pending");
  assert.ok(
    removedPending < wroteHistory,
    "消费 pending 要排在写 history 之前：反过来的话，写 history 之后任何一笔抛了都会把 pending 留成可重放的提交凭证",
  );
});
