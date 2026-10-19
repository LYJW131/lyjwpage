import assert from "node:assert/strict";
import test from "node:test";
import { branchForRun } from "@shared/build-routine";
import { applyGithubWebhook } from "./build/webhook.ts";

import { baseSha, fixture, planCommitSha, pr, prepare, pullRequest, runId } from "./build/testing/coordinator-fixture.ts";

test("legacy pull request webhooks preserve the historical reconciliation protocol", async () => {
  const { coordinator, env } = fixture({ callbackOrigin: undefined });
  coordinator.updateRun(runId, { phase: "pr_open", pr: { number: pr.number, url: pr.url, headSha: planCommitSha } });
  const payload = pullRequest();
  payload.pull_request.draft = false;
  await applyGithubWebhook(env, "pull_request", payload);
  assert.equal(coordinator.readRun(runId)?.state.pr?.draft, undefined);
  assert.equal(coordinator.readRun(runId)?.state.phase, "pr_open");
});

test("a consumed build plan recovers only the original verified account without another quota charge", () => {
  const { coordinator, run } = fixture();
  assert.equal(coordinator.hasPlanRun("plan"), true);
  assert.equal(coordinator.findPlanRun("plan", 42)?.state.runId, runId);
  assert.equal(coordinator.findPlanRun("plan", 43), null);
  assert.equal(coordinator.findPlanRun("plan", Number.NaN), null);
  for (let n = 0; n < 4; n += 1) assert.equal(coordinator.reserveRun(run, "plan", Date.now() + 60_000), "used");
  for (const id of ["2", "3"]) {
    const nextId = id.repeat(32);
    assert.equal(coordinator.reserveRun({ ...run, state: { ...run.state, runId: nextId, branch: branchForRun(nextId) } }, `plan-${id}`, Date.now() + 60_000), "ok");
  }
  const nextId = "4".repeat(32);
  assert.equal(coordinator.reserveRun({ ...run, state: { ...run.state, runId: nextId, branch: branchForRun(nextId) } }, "over-quota", Date.now() + 60_000), "account");
  assert.equal(coordinator.claimPlan("issue-plan", Date.now() + 60_000), true);
  assert.equal(coordinator.hasPlanRun("issue-plan"), false);
  assert.equal(coordinator.findPlanRun("issue-plan", 42), null);
});

test("preparation leases exclude concurrent callers and fence expired writes and releases", (t) => {
  const { coordinator } = fixture();
  const first = coordinator.claimPreparation(runId)!;
  assert.ok(first);
  assert.equal(coordinator.claimPreparation(runId), null);
  const nextTime = coordinator.readRun(runId)!.preparation!.expiresAt + 1;
  t.mock.method(Date, "now", () => nextTime);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, first), null);
  const second = coordinator.claimPreparation(runId)!;
  assert.ok(second);
  assert.notEqual(first, second);
  coordinator.releasePreparation(runId, first);
  assert.equal(coordinator.readRun(runId)?.preparation?.token, second);
  assert.equal(coordinator.failPreparation(runId, first, "stale error", true), false);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, first), null);
  assert.ok(coordinator.setPrepared(runId, planCommitSha, pr, second));
});

test("preparation recovery keeps the same draft and dispatch is claimed exactly once", () => {
  const { coordinator } = fixture();
  const lease = coordinator.claimPreparation(runId)!;
  assert.equal(coordinator.failPreparation(runId, lease, "GitHub confirmation unavailable."), true);
  assert.equal(coordinator.readRun(runId)?.state.phase, "triggered");
  coordinator.releasePreparation(runId, lease);
  const recovered = coordinator.claimPreparation(runId)!;
  assert.equal(coordinator.setPrepared(runId, planCommitSha, { ...pr, draft: false }, recovered), null);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, { ...pr, headSha: baseSha }, recovered), null);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, { ...pr, url: "https://github.com/someone/fork/pull/91" }, recovered), null);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, recovered)?.reason, undefined);
  assert.equal(coordinator.claimDispatch(runId), false);
  coordinator.releasePreparation(runId, recovered);
  assert.equal(coordinator.claimDispatch(runId), true);
  assert.equal(coordinator.claimDispatch(runId), false);
  assert.equal(coordinator.claimPreparation(runId), null);
  assert.equal(coordinator.readRun(runId)?.uploadUsed, false);
});

test("preparation and dispatch stop after cancellation, blocking or timeout", (t) => {
  for (const phase of ["blocked", "failed", "closed", "merged", "timeout"] as const) {
    const { coordinator } = fixture();
    prepare(coordinator);
    coordinator.updateRun(runId, { phase });
    assert.equal(coordinator.claimPreparation(runId), null);
    assert.equal(coordinator.claimDispatch(runId), false);
  }
  const { coordinator, run } = fixture();
  const lease = coordinator.claimPreparation(runId)!;
  t.mock.method(Date, "now", () => run.uploadExpiresAt + 1);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, lease), null);
  assert.equal(coordinator.claimPreparation(runId), null);
  assert.equal(coordinator.claimDispatch(runId), false);
  assert.equal(coordinator.readRun(runId)?.state.phase, "timeout");
});

test("an early draft does not grant agent progress or upload before dispatch", () => {
  const { coordinator } = fixture();
  assert.equal(coordinator.claimUpload(runId, "token-hash"), null);
  assert.equal(coordinator.progress(runId, "token-hash", "Working"), false);
  assert.equal(coordinator.blockRun(runId, "token-hash", "Blocked"), false);
  prepare(coordinator);
  assert.equal(coordinator.claimUpload(runId, "token-hash"), null);
  assert.equal(coordinator.claimDispatch(runId), true);
  assert.equal(coordinator.progress(runId, "token-hash", "Working"), true);
  assert.equal(coordinator.claimUpload(runId, "token-hash")?.state.phase, "uploaded");
});
