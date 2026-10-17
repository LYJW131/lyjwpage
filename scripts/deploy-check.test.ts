import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { classifyVersion, deploymentPlan, parseArgs, run, summarizeBuilds, type CheckRun } from "./deploy-check.ts";

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
const options = { sha: SHA, timeoutMs: 600_000, intervalMs: 20_000 };
const changes = () => ({ base: OLDER, files: ["src/components/example.tsx"], commitCount: 1 });

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
  const result = await run(options, { ...fakeClock(), changes, fetch });
  assert.equal(result.pass, true);
  assert.deepEqual(result.versions.map((v) => v.state), ["superseded", "superseded"]);
});

test("site 构建成功且两个域名都跟上时通过", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    changes,
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

test("只改 core 时自动只等 core，不等 /api/version", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    isAncestor: async () => false,
    changes: () => ({ base: OLDER, files: ["workers/core/src/index.ts"], commitCount: 1 }),
    fetch: fakeFetch({ checkRuns: [build("core", "completed", "success")], versions: {} }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.siteChecked, false);
  assert.equal(clock.now(), 0);
  assert.deepEqual(result.plan?.expected, ["core"]);
});

test("构建失败直接不通过并给出下一步", async () => {
  const result = await run(options, {
    ...fakeClock(),
    changes,
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [build("site", "completed", "failure")], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /site=failure/);
});

test("超时仍停在旧提交时不通过，提示交 lyjw 决定重跑", async () => {
  const result = await run(options, {
    ...fakeClock(),
    changes,
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

test("只有明确未命中路径的文档改动才允许没有构建", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    changes: () => ({ base: OLDER, files: ["docs/example.md"], commitCount: 1 }),
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [], versions: {} }),
  });
  assert.equal(result.pass, true);
  assert.match(result.note ?? "", /未命中生产监视路径/);
  assert.equal(clock.now(), 0);
});

test("列了 --expect 却一个构建检查都没有时不通过", async () => {
  const result = await run({ ...options, expect: ["site"] }, {
    ...fakeClock(),
    changes,
    isAncestor: async () => false,
    fetch: fakeFetch({ checkRuns: [], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /site/);
});

test("--expect 列出的 Worker 没有成功构建时不通过", async () => {
  const result = await run({ ...options, expect: ["core"] }, {
    ...fakeClock(),
    changes,
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
  const result = await run({ ...options, timeoutMs: 1500, intervalMs: 100 }, {
    isAncestor: async () => false,
    changes,
    fetch: hanging,
  }).finally(() => clearInterval(keepAlive));
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /读不到合并提交的检查/);
});

test("前端改动未填 --expect、没有任何构建检查时必须失败", async () => {
  const clock = fakeClock();
  const result = await run(options, { ...clock, changes, fetch: fakeFetch({ checkRuns: [], versions: {} }) });
  assert.equal(result.pass, false);
  assert.deepEqual(result.plan?.expected, ["site"]);
  assert.match(result.next ?? "", /site/);
  assert.equal(clock.now(), options.timeoutMs);
});

test("--expect 只能追加，不能漏掉自动推导的 site", async () => {
  const result = await run({ ...options, expect: ["core"] }, {
    ...fakeClock(), changes, fetch: fakeFetch({ checkRuns: [build("core", "completed", "success")], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.deepEqual(result.plan?.expected, ["core", "site"]);
  assert.match(result.next ?? "", /site/);
});

test("读不到 Git 差异时失败，不查询构建或当作没有变化", async () => {
  const result = await run(options, {
    changes: () => { throw new Error("missing commit"); },
    fetch: async () => { throw new Error("不应调用"); },
  });
  assert.equal(result.pass, false);
  assert.match(result.next ?? "", /missing commit/);
  assert.equal(result.plan, null);
});

test("多提交推送把 --before 交给 Git 差异读取", () => {
  const plan = deploymentPlan({ sha: SHA, before: OLDER }, { changes: (sha, before) => {
    assert.equal(sha, SHA);
    assert.equal(before, OLDER);
    return { base: OLDER, files: ["workers/ai/src/index.ts", "workers/core/src/index.ts"], commitCount: 2 };
  } });
  assert.deepEqual(plan.expected, ["ai", "core"]);
});

test("参数缺值、未知参数和非法等待时间按用法错误退出", () => {
  for (const args of [["--sha"], ["--sha", "--expect", "site"], ["--unknown"], ["--site", "no"]]) {
    assert.throws(() => parseArgs(args));
  }
  for (const args of [["--expect", ""], ["--expect", "typo"], ["--timeout", "0"], ["--interval", "Infinity"], ["--timeout", "-1"]]) {
    const result = spawnSync(process.execPath, ["scripts/deploy-check.ts", "--sha", SHA, ...args], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 2, result.stdout + result.stderr);
  }
});
