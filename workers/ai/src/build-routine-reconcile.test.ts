import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_REPO, BUILD_TIMEOUT_MS } from "@shared/build-routine";
import { GithubBuildApi, reconcileBuild } from "./build/github.ts";
import { consumePlan, issuePlan } from "./build/plan.ts";
import { coordinator, dispatched, githubFixture, handleBuild, headSha, json, plan, post, runId, sha, signIn, stored } from "./build/testing/routine-fixture.ts";

test("reconciliation reports unavailable signals as unknown and paginates bot review comments", async () => {
  const old = await stored();
  old.state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  const fixture = githubFixture((path) => {
    if (path.endsWith("/pulls/12")) return json({ number: 12, html_url: old.state.pr!.url, head: { sha: headSha }, state: "open", merged: false, updated_at: new Date().toISOString() });
    if (path.includes("check-runs")) return json({}, 403);
    if (path.includes("/status?")) return json({}, 403);
    if (path.endsWith("comments?per_page=100&page=1")) return json(Array.from({ length: 100 }, () => ({ user: { login: "visitor" }, updated_at: "2026-01-01" })));
    if (path.endsWith("comments?per_page=100&page=2")) return json([{ user: { login: "claude[bot]" }, body: "Review suggests improvements.", html_url: "https://github.com/review", updated_at: "2026-10-10T00:00:00Z" }]);
    return undefined;
  });
  const state = await reconcileBuild(new GithubBuildApi("fixture", fixture.fetcher), old.state);
  assert.equal(state.ci?.state, "unknown");
  assert.equal(state.preview?.state, "unknown");
  assert.equal(state.review?.state, "Review suggests improvements.");
});

test("a stale reconciliation cannot attach old-head success to the newer head", async () => {
  const { instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  instance.updateRun(runId, { phase: "pr_open", pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha }, githubUpdatedAt: 30, ci: { state: "unknown", updatedAt: 30 } });
  const state = instance.updateRun(runId, { pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha: sha }, githubUpdatedAt: 20, ci: { state: "success", updatedAt: Date.now() } });
  assert.equal(state?.pr?.headSha, headSha);
  assert.equal(state?.ci?.state, "unknown");
});

test("CI requires complete results and explicit success conclusions", async () => {
  const state = (await stored()).state;
  state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  for (const [conclusion, count, expected] of [["startup_failure", 1, "failure"], ["stale", 1, "unknown"], ["new_undocumented_value", 1, "unknown"], ["success", 101, "unknown"], ["success", 1, "success"]] as const) {
    const fixture = githubFixture((path) => {
      if (path.endsWith("/pulls/12")) return json({ number: 12, html_url: state.pr!.url, head: { sha: headSha }, state: "open", merged: false, updated_at: new Date().toISOString() });
      if (path.includes("check-runs")) return json({ total_count: count, check_runs: [{ name: "tests", status: "completed", conclusion }] });
      if (path.includes("/status?")) return json({ total_count: 0, statuses: [] });
      if (path.includes("/comments?")) return json([]);
      return undefined;
    });
    assert.equal((await reconcileBuild(new GithubBuildApi("fixture", fixture.fetcher), state)).ci?.state, expected);
  }
});

test("oversized serialized plans are rejected before issuing unusable tokens", async () => {
  const { env } = coordinator();
  await assert.rejects(() => issuePlan(env, { ...plan, spec: "x" + "\u0000".repeat(5999), acceptance: Array.from({ length: 8 }, () => "x" + "\u0000".repeat(299)) }), /too large to sign/);
});

test("same-second stale reconciliation is rejected by its expected head", async () => {
  const { instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  instance.updateRun(runId, { phase: "pr_open", pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha }, githubUpdatedAt: 30, ci: { state: "unknown", updatedAt: 30 } });
  const state = instance.updateRun(runId, { pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha: sha }, githubUpdatedAt: 30, ci: { state: "success", updatedAt: Date.now() } }, sha);
  assert.equal(state?.pr?.headSha, headSha);
  assert.equal(state?.ci?.state, "unknown");
});

test("an interrupted upload becomes unknown and a confirmed delayed PR recovers a failed request", async (t) => {
  const { instance } = coordinator();
  const run = await dispatched();
  instance.reserveRun(run, "p", Date.now() + 60_000);
  assert.ok(instance.claimUpload(runId, run.uploadHash));
  instance.updateRun(runId, { phase: "validated" });
  assert.equal(instance.setImplementationHead(runId, headSha), true);
  const later = Date.now() + BUILD_TIMEOUT_MS + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(instance.readRun(runId)?.state.phase, "timeout");
  const pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  assert.equal(instance.updateRun(runId, { phase: "pr_open", pr, githubUpdatedAt: later })?.phase, "pr_open");
  assert.equal(instance.readRun(runId)?.state.reason, undefined);
  const second = await dispatched("e".repeat(32));
  instance.reserveRun(second, "p2", later + 60_000);
  assert.ok(instance.claimUpload(second.state.runId, second.uploadHash));
  instance.updateRun(second.state.runId, { phase: "validated" });
  assert.equal(instance.setImplementationHead(second.state.runId, headSha), true);
  instance.updateRun(second.state.runId, { phase: "failed", reason: "Result unknown." });
  assert.equal(instance.updateRun(second.state.runId, { phase: "pr_open", pr, githubUpdatedAt: later })?.phase, "pr_open");
});

test("a replayed build never reaches GitHub and account renames do not reset quota", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  await consumePlan(env, proposal.token);
  const denied: typeof fetch = async () => assert.fail("Replay must be rejected before network access");
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, denied)).status, 409);
  for (let n = 0; n < 3; n += 1) {
    const run = await stored(n.toString().padStart(32, "0"), `renamed-${n}`);
    run.accountId = 1;
    assert.equal(instance.reserveRun(run, `quota-${n}`, Date.now() + 60_000), "ok");
  }
  const next = await stored("e".repeat(32), "another-name");
  next.accountId = 1;
  assert.equal(instance.reserveRun(next, "quota-overflow", Date.now() + 60_000), "account");
});
