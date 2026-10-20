import assert from "node:assert/strict";
import test from "node:test";
import { branchForRun } from "@shared/build-routine";
import { applyGithubWebhook } from "./build/webhook.ts";

import { baseSha, dispatch, fixture, implementationHeadSha, planCommitSha, pr, prepare, pullRequest, recordImplementation, runId } from "./build/testing/coordinator-fixture.ts";

test("draft webhook and reconciliation preserve execution phases and failure reasons", async () => {
  for (const phase of ["triggered", "running", "uploaded", "validated", "failed", "blocked", "timeout"] as const) {
    const { coordinator, env } = fixture();
    dispatch(coordinator);
    coordinator.updateRun(runId, { phase, reason: "Keep this reason." });
    await applyGithubWebhook(env, "pull_request", pullRequest());
    coordinator.updateRun(runId, { phase: "pr_open", pr, githubUpdatedAt: Date.now() + 1000, ci: { state: "success", updatedAt: Date.now() } }, planCommitSha);
    assert.equal(coordinator.readRun(runId)?.state.phase, phase);
    assert.equal(coordinator.readRun(runId)?.state.reason, "Keep this reason.");
    assert.equal(coordinator.readRun(runId)?.uploadUsed, false);
  }
});

test("webhooks cannot adopt unknown PRs or replace a verified PR identity", async () => {
  const { coordinator, env } = fixture();
  await applyGithubWebhook(env, "pull_request", pullRequest());
  assert.equal(coordinator.readRun(runId)?.state.pr, undefined);
  prepare(coordinator);
  await applyGithubWebhook(env, "pull_request", pullRequest(planCommitSha, 92));
  await applyGithubWebhook(env, "pull_request", pullRequest(baseSha));
  const forked = pullRequest();
  forked.pull_request.head.repo.full_name = "someone/fork";
  await applyGithubWebhook(env, "pull_request", forked);
  assert.deepEqual(coordinator.readRun(runId)?.state.pr, pr);
  assert.equal(coordinator.updateRun(runId, { pr: { ...pr, number: 92 }, phase: "closed" })?.phase, "triggered");
});

test("webhook draft updates keep upload usable while a closed draft stops execution", async () => {
  const { coordinator, env } = fixture();
  dispatch(coordinator);
  assert.equal(coordinator.progress(runId, "token-hash", "Editing"), true);
  await applyGithubWebhook(env, "pull_request", pullRequest());
  assert.equal(coordinator.readRun(runId)?.state.phase, "running");
  assert.equal(coordinator.progress(runId, "token-hash", "Testing"), true);
  const closed = pullRequest();
  closed.pull_request.state = "closed";
  await applyGithubWebhook(env, "pull_request", closed);
  assert.equal(coordinator.readRun(runId)?.state.phase, "closed");
  assert.equal(coordinator.claimUpload(runId, "token-hash"), null);
  assert.equal(coordinator.progress(runId, "token-hash", "Still working"), false);
});

test("implementation identity is recorded only for a validated single-use upload", () => {
  const { coordinator } = fixture();
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), false);
  dispatch(coordinator);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), false);
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), false);
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setImplementationHead(runId, planCommitSha), false);
  assert.equal(coordinator.setImplementationHead(runId, "invalid"), false);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha, "x".repeat(64_001)), false);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha, "Confirmed public plan and review paths."), true);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), true);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha, "A different body."), false);
  assert.equal(coordinator.readRun(runId)?.publicationBody, "Confirmed public plan and review paths.");
  assert.equal(coordinator.setImplementationHead(runId, baseSha), false);
});

test("publication advances to the recorded implementation despite a missing or same-second GitHub cursor", () => {
  for (const cursor of [undefined, Date.now()]) {
    const { coordinator } = fixture();
    recordImplementation(coordinator);
    coordinator.updateRun(runId, { githubUpdatedAt: cursor });
    assert.equal(coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha }, githubUpdatedAt: cursor })?.phase, "pr_open");
    assert.equal(coordinator.readRun(runId)?.state.pr?.headSha, implementationHeadSha);
    assert.equal(coordinator.readRun(runId)?.state.pr?.draft, true);
  }
});

test("only the recorded implementation can recover failed or timed-out publication", () => {
  for (const phase of ["failed", "timeout", "blocked"] as const) {
    const { coordinator } = fixture();
    recordImplementation(coordinator);
    coordinator.updateRun(runId, { phase, reason: "Publication was not confirmed." });
    assert.equal(coordinator.updateRun(runId, { phase: "pr_open", pr })?.phase, phase);
    assert.equal(coordinator.readRun(runId)?.state.reason, "Publication was not confirmed.");
    const published = coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } });
    assert.equal(published?.phase, phase === "blocked" ? "blocked" : "pr_open");
    assert.equal(published?.reason, phase === "blocked" ? "Publication was not confirmed." : undefined);
  }
});

test("late plan-head events never overwrite a published implementation or its checks", async () => {
  const { coordinator, env } = fixture();
  recordImplementation(coordinator);
  const published = pullRequest(implementationHeadSha);
  await applyGithubWebhook(env, "pull_request", published);
  assert.equal(coordinator.readRun(runId)?.state.phase, "pr_open");
  coordinator.updateRun(runId, { ci: { state: "success", updatedAt: Date.now() } }, implementationHeadSha);
  const delayed = pullRequest();
  delayed.pull_request.updated_at = new Date(Date.now() + 1000).toISOString();
  await applyGithubWebhook(env, "pull_request", delayed);
  coordinator.updateRun(runId, { phase: "closed", pr, ci: { state: "failure", updatedAt: Date.now() + 1000 }, githubUpdatedAt: Date.now() + 1000 }, implementationHeadSha);
  const state = coordinator.readRun(runId)!.state;
  assert.equal(state.phase, "pr_open");
  assert.equal(state.pr?.headSha, implementationHeadSha);
  assert.equal(state.ci?.state, "success");
});

test("late dispatch failures cannot replace upload or publication results", () => {
  const { coordinator } = fixture();
  dispatch(coordinator);
  assert.equal(coordinator.failDispatch(runId, "Dispatch unknown."), true);
  assert.equal(coordinator.readRun(runId)?.state.reason, "Dispatch unknown.");
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  assert.equal(coordinator.failDispatch(runId, "Late rejection.", true), false);
  assert.equal(coordinator.readRun(runId)?.state.phase, "uploaded");
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), true);
  coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } });
  assert.equal(coordinator.failDispatch(runId, "Late failure.", true), false);
  assert.equal(coordinator.readRun(runId)?.state.reason, undefined);
});

test("publication failures are fenced against newer publication and terminal states", () => {
  for (const phase of ["pr_open", "closed", "merged"] as const) {
    const { coordinator } = fixture();
    recordImplementation(coordinator);
    const pending = coordinator.readRun(runId)!.state;
    coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } });
    if (phase !== "pr_open") coordinator.updateRun(runId, { phase });
    const state = coordinator.failPublication(runId, { phase: "blocked", reason: "Late failure." }, pending);
    assert.equal(state?.phase, phase);
    assert.equal(state?.reason, undefined);
  }
});

test("publication confirmation cannot replace ready metadata, checks or terminal phases", () => {
  for (const phase of ["pr_open", "closed", "merged", "blocked"] as const) {
    const { coordinator } = fixture();
    recordImplementation(coordinator);
    const publishedPr = { ...pr, headSha: implementationHeadSha };
    assert.equal(coordinator.completePublication(runId, { ...publishedPr, number: 99 }), null);
    assert.equal(coordinator.completePublication(runId, { ...publishedPr, url: "https://github.com/other/repository/pull/91" }), null);
    assert.equal(coordinator.completePublication(runId, pr), null);
    assert.equal(coordinator.completePublication(runId, publishedPr)?.phase, "pr_open");
    coordinator.updateRun(runId, { phase, pr: { ...publishedPr, draft: false }, ci: { state: "success", updatedAt: Date.now() } });
    const current = coordinator.readRun(runId)!.state;
    assert.deepEqual(coordinator.completePublication(runId, publishedPr), current);
  }
});

test("readiness failures cannot overwrite newer draft metadata but current identity failures remain visible", (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { coordinator } = fixture();
  recordImplementation(coordinator);
  coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } });
  const draft = coordinator.readRun(runId)!.state;
  coordinator.updateRun(runId, { pr: { ...draft.pr!, draft: false } });
  assert.equal(coordinator.failPublication(runId, { phase: "blocked", reason: "Stale failure." }, draft)?.phase, "pr_open");
  assert.equal(coordinator.readRun(runId)?.state.reason, undefined);
  const current = coordinator.readRun(runId)!.state;
  assert.equal(coordinator.failPublication(runId, { phase: "blocked", reason: "The remote head changed." }, current)?.phase, "blocked");
  assert.equal(coordinator.readRun(runId)?.state.reason, "The remote head changed.");
});

test("check updates do not hide a genuine publication failure on the same phase and head", (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { coordinator } = fixture();
  recordImplementation(coordinator);
  const expected = coordinator.readRun(runId)!.state;
  now += 1;
  coordinator.updateRun(runId, { reconciledAt: 0, ci: { state: "success", updatedAt: now } });
  const state = coordinator.failPublication(runId, { phase: "failed", reason: "GitHub did not confirm the implementation." }, expected);
  assert.equal(state?.phase, "failed");
  assert.equal(state?.reason, "GitHub did not confirm the implementation.");
});

test("a run that was never prepared and dispatched accepts no workflow updates", () => {
  const { coordinator } = fixture({ callbackOrigin: undefined, state: { runId, branch: branchForRun(runId), phase: "running", createdAt: Date.now(), updatedAt: Date.now() } });
  assert.equal(coordinator.progress(runId, "token-hash", "Testing"), false);
  assert.equal(coordinator.canAddScreenshot(runId, "token-hash"), false);
  assert.equal(coordinator.blockRun(runId, "token-hash", "Stopped."), false);
  assert.equal(coordinator.claimUpload(runId, "token-hash"), null);
  assert.equal(coordinator.readRun(runId)?.uploadUsed, false);
});

test("a merge or close still lands after the head moves past the implementation commit", async () => {
  for (const merged of [true, false]) {
    const { coordinator, env } = fixture();
    recordImplementation(coordinator);
    assert.ok(coordinator.completePublication(runId, { ...pr, headSha: implementationHeadSha, draft: false }));
    const laterHead = "d".repeat(40);
    await applyGithubWebhook(env, "pull_request", pullRequest(laterHead));
    assert.equal(coordinator.readRun(runId)?.state.phase, "pr_open");
    assert.equal(coordinator.readRun(runId)?.state.pr?.headSha, implementationHeadSha);
    const stale = pullRequest();
    stale.pull_request.state = "closed";
    await applyGithubWebhook(env, "pull_request", stale);
    assert.equal(coordinator.readRun(runId)?.state.phase, "pr_open");
    const closed = pullRequest(laterHead);
    closed.pull_request.state = "closed";
    closed.pull_request.merged = merged;
    await applyGithubWebhook(env, "pull_request", closed);
    assert.equal(coordinator.readRun(runId)?.state.phase, merged ? "merged" : "closed");
    assert.equal(coordinator.readRun(runId)?.state.pr?.headSha, implementationHeadSha);
  }
  const { coordinator } = fixture();
  recordImplementation(coordinator);
  assert.ok(coordinator.completePublication(runId, { ...pr, headSha: implementationHeadSha, draft: false }));
  coordinator.updateRun(runId, { phase: "merged", pr: { ...pr, headSha: "d".repeat(40), draft: false }, ci: { state: "failure", updatedAt: Date.now() } }, implementationHeadSha);
  assert.equal(coordinator.readRun(runId)?.state.phase, "merged");
  assert.notEqual(coordinator.readRun(runId)?.state.ci?.state, "failure");
});
