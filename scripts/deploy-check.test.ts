import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyVersion, parseExpect, run, summarizeBuilds, type CheckRun } from "./deploy-check.ts";

const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const OLDER = "c".repeat(40);

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

type Versions = Record<string, string | null> | ((host: string, n: number) => string | null);

function fakeFetch({ checkRuns, versions }: { checkRuns: CheckRun[] | ((n: number) => CheckRun[]); versions: Versions }) {
  let checkCalls = 0;
  let versionCalls = 0;
  return async (url: string) => {
    if (url.includes("/check-runs")) {
      const runs = typeof checkRuns === "function" ? checkRuns(checkCalls++) : checkRuns;
      return { ok: true, json: async () => ({ check_runs: runs }) };
    }
    const host = new URL(url).host;
    const commit = typeof versions === "function" ? versions(host, versionCalls++) : versions[host];
    return { ok: true, json: async () => ({ commit }) };
  };
}

const build = (worker: string, status: string, conclusion: string | null): CheckRun => ({ name: `Workers Builds: ${worker}`, status, conclusion });
const options = { sha: SHA, site: "auto", timeoutMs: 600_000, intervalMs: 20_000, graceMs: 180_000 };

test("summarizeBuilds 只看 Workers Builds，区分进行中与失败", () => {
  const summary = summarizeBuilds([
    { name: "check", status: "completed", conclusion: "failure" },
    build("site", "completed", "success"),
    build("core", "in_progress", null),
    build("ai", "completed", "failure"),
  ]);
  assert.deepEqual(summary.pending.map((b) => b.worker), ["core"]);
  assert.deepEqual(summary.failed.map((b) => b.worker), ["ai"]);
  assert.equal(summary.siteBuilt, true);
});

test("summarizeBuilds 同一 Worker 重跑过时只认最新一条检查", () => {
  const summary = summarizeBuilds([
    { ...build("site", "completed", "failure"), id: 1, started_at: "2026-10-14T04:00:00Z" },
    { ...build("site", "completed", "success"), id: 2, started_at: "2026-10-14T04:05:00Z" },
  ]);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.siteBuilt, true);
});

test("classifyVersion：被之后的提交覆盖算通过，更旧的算没跟上", async () => {
  const isAncestor = async (a: string, d: string) => a === SHA && d === NEWER;
  assert.equal(await classifyVersion(SHA, SHA, isAncestor), "live");
  assert.equal(await classifyVersion(NEWER, SHA, isAncestor), "superseded");
  assert.equal(await classifyVersion(OLDER, SHA, isAncestor), "stale");
  assert.equal(await classifyVersion(null, SHA, isAncestor), "unreadable");
});

test("不传 isAncestor 时用 GitHub 比较判断被覆盖", async () => {
  const fetch = async (url: string) => {
    if (url.includes("/check-runs")) return { ok: true, json: async () => ({ check_runs: [build("site", "completed", "success")] }) };
    if (url.includes(`/compare/${SHA}...${NEWER}`)) return { ok: true, json: async () => ({ status: "ahead" }) };
    return { ok: true, json: async () => ({ commit: NEWER }) };
  };
  const result = await run(options, { ...fakeClock(), fetch });
  assert.equal(result.pass, true);
  assert.deepEqual(result.versions.map((v) => v.state), ["superseded", "superseded"]);
});

test("site 构建成功且两个域名都跟上时通过", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    isAncestor: async () => false,
    fetch: fakeFetch({
      checkRuns: (n: number) => [build("site", n === 0 ? "in_progress" : "completed", n === 0 ? null : "success")],
      versions: (host: string, n: number) => (n < 2 ? OLDER : SHA),
    }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.siteChecked, true);
  assert.deepEqual(result.versions.map((v) => v.state), ["live", "live"]);
});

test("没碰到 site 时过了宽限期就不等 /api/version", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [build("core", "completed", "success")], versions: {} }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.siteChecked, false);
  assert.ok(clock.now() >= options.graceMs);
});

test("构建失败直接不通过并给出下一步", async () => {
  const result = await run(options, {
    ...fakeClock(),
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [build("site", "completed", "failure")], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /site=failure/);
});

test("超时仍停在旧提交时不通过，提示交 lyjw 决定重跑", async () => {
  const result = await run(options, {
    ...fakeClock(),
    isAncestor: async () => false,
    fetch: fakeFetch({
      checkRuns: [build("site", "completed", "success")],
      versions: { "lyjw.me": OLDER, "lyjw131.com": SHA },
    }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /lyjw\.me=c{40}/);
  assert.match(result.next ?? "", /lyjw/);
});

test("宽限期内没有构建检查且没列 --expect 时通过，并说明没碰到 Worker", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [], versions: {} }),
  });
  assert.equal(result.pass, true);
  assert.match(result.note ?? "", /没碰到 Worker/);
  assert.ok(clock.now() >= options.graceMs && clock.now() < options.timeoutMs);
});

test("列了 --expect 却一个构建检查都没有时不通过", async () => {
  const result = await run({ ...options, expect: ["site"] }, {
    ...fakeClock(),
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /site/);
});

test("--expect 列出的 Worker 没有成功构建时不通过", async () => {
  const result = await run({ ...options, expect: ["core"] }, {
    ...fakeClock(),
    isAncestor: async () => false,
    fetch: fakeFetch({
      checkRuns: [build("site", "completed", "success"), build("core", "completed", "skipped")],
      versions: { "lyjw.me": SHA, "lyjw131.com": SHA },
    }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /core/);
});

test("请求挂住时按总时限中止，不会一直卡住", async () => {
  const hanging = (_url: string, init: { signal: AbortSignal }) =>
    new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  // AbortSignal.timeout 的计时器不占住事件循环，测试里另挂一个，免得 node:test 提前判挂起
  const keepAlive = setInterval(() => {}, 1000);
  const result = await run({ ...options, timeoutMs: 1500, intervalMs: 100, graceMs: 100 }, {
    isAncestor: async () => false,
    fetch: hanging,
  }).finally(() => clearInterval(keepAlive));
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /读不到合并提交的检查/);
});

const PARENT = "d".repeat(40);

function autoFetch(files: string[], checkRuns: CheckRun[]) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    if (url.endsWith(`/commits/${SHA}`)) return { ok: true, json: async () => ({ parents: [{ sha: PARENT }, { sha: OLDER }] }) };
    if (url.includes(`/compare/${PARENT}...${SHA}`)) return { ok: true, json: async () => ({ files: files.map((filename) => ({ filename })) }) };
    if (url.includes("/check-runs")) return { ok: true, json: async () => ({ check_runs: checkRuns }) };
    return { ok: true, json: async () => ({ commit: SHA }) };
  };
  return { fetch, calls };
}

test("--expect auto 按合并提交与第一个父提交的差异算出要等的 Worker", async () => {
  const { fetch, calls } = autoFetch(["workers/ai/src/x.ts", "docs/a.md"], [build("ai", "completed", "success")]);
  const result = await run({ ...options, expect: "auto" }, { ...fakeClock(), isAncestor: async () => false, fetch });
  assert.equal(result.pass, true);
  assert.deepEqual(result.expected, ["ai"]);
  assert.ok(calls.some((url) => url.includes(`/compare/${PARENT}...${SHA}`)));
});

test("--expect auto 算出的 Worker 没有成功构建时不通过", async () => {
  const { fetch } = autoFetch(["shared/json.ts"], [build("core", "completed", "success"), build("site", "completed", "success")]);
  const result = await run({ ...options, expect: "auto" }, { ...fakeClock(), isAncestor: async () => false, fetch });
  assert.equal(result.pass, false);
  assert.deepEqual(result.expected, ["core", "ai", "site", "ingress", "collector"]);
  assert.match(result.next ?? "", /ai、ingress、collector/);
});

test("--expect auto 读不到改动文件时直接不通过，不当成没碰到 Worker", async () => {
  const fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const result = await run({ ...options, expect: "auto" }, { ...fakeClock(), isAncestor: async () => false, fetch });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /算不出 --expect auto/);
});

test("parseExpect：auto、逗号列表，写错的 Worker 名当用法错误", () => {
  assert.equal(parseExpect("auto"), "auto");
  assert.deepEqual(parseExpect("site, core"), ["site", "core"]);
  assert.deepEqual(parseExpect(undefined), []);
  assert.equal(parseExpect("stie"), null);
});
