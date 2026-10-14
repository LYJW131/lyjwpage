import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyVersion, run, summarizeBuilds } from "./deploy-check.mjs";

const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const OLDER = "c".repeat(40);

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function fakeFetch({ checkRuns, versions }) {
  let checkCalls = 0;
  let versionCalls = 0;
  return async (url) => {
    if (url.includes("/check-runs")) {
      const runs = typeof checkRuns === "function" ? checkRuns(checkCalls++) : checkRuns;
      return { ok: true, json: async () => ({ check_runs: runs }) };
    }
    const host = new URL(url).host;
    const commit = typeof versions === "function" ? versions(host, versionCalls++) : versions[host];
    return { ok: true, json: async () => ({ commit }) };
  };
}

const build = (worker, status, conclusion) => ({ name: `Workers Builds: ${worker}`, status, conclusion });
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

test("classifyVersion：被之后的提交覆盖算通过，更旧的算没跟上", () => {
  const isAncestor = (a, d) => a === SHA && d === NEWER;
  assert.equal(classifyVersion(SHA, SHA, isAncestor), "live");
  assert.equal(classifyVersion(NEWER, SHA, isAncestor), "superseded");
  assert.equal(classifyVersion(OLDER, SHA, isAncestor), "stale");
  assert.equal(classifyVersion(null, SHA, isAncestor), "unreadable");
});

test("site 构建成功且两个域名都跟上时通过", async () => {
  const clock = fakeClock();
  const result = await run(options, {
    ...clock,
    isAncestor: () => false,
    fetch: fakeFetch({
      checkRuns: (n) => [build("site", n === 0 ? "in_progress" : "completed", n === 0 ? null : "success")],
      versions: (host, n) => (n < 2 ? OLDER : SHA),
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
    isAncestor: () => false,
    fetch: fakeFetch({ checkRuns: [build("core", "completed", "success")], versions: {} }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.siteChecked, false);
  assert.ok(clock.now() >= options.graceMs);
});

test("构建失败直接不通过并给出下一步", async () => {
  const result = await run(options, {
    ...fakeClock(),
    isAncestor: () => false,
    fetch: fakeFetch({ checkRuns: [build("site", "completed", "failure")], versions: {} }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next, /site=failure/);
});

test("超时仍停在旧提交时不通过，提示交站主决定重跑", async () => {
  const result = await run(options, {
    ...fakeClock(),
    isAncestor: () => false,
    fetch: fakeFetch({
      checkRuns: [build("site", "completed", "success")],
      versions: { "lyjw.me": OLDER, "lyjw131.com": SHA },
    }),
  });
  assert.equal(result.pass, false);
  assert.match(result.next, /lyjw\.me=c{40}/);
  assert.match(result.next, /站主/);
});
