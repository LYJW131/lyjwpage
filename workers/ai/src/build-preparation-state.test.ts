import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun } from "@shared/build-routine";
import type { StoredRun } from "./build/coordinator.ts";
import type { Env } from "./runtime.ts";
import { applyGithubWebhook } from "./build/webhook.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { BuildCoordinator } = await import("./build/coordinator.ts");
const runId = "1".repeat(32);
const baseSha = "a".repeat(40);
const planCommitSha = "b".repeat(40);
const implementationHeadSha = "c".repeat(40);
const pr = { number: 91, url: `https://github.com/${BUILD_REPO}/pull/91`, headSha: planCommitSha, draft: true };

function fixture(overrides: Partial<StoredRun> = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const stmt = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const coordinator = new BuildCoordinator({ storage: { sql, transactionSync, getAlarm: async () => null, setAlarm: async () => undefined } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => coordinator } } as unknown as Env;
  const now = Date.now();
  const run: StoredRun = {
    state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now },
    plan: { title: "Improve layout", spec: "Improve the public layout.", acceptance: ["Fits on mobile."], paths: ["src/card.tsx"] },
    account: "visitor", accountId: 42, coauthor: "Visitor <42+visitor@users.noreply.github.com>",
    baseSha, callbackOrigin: "https://api.example.test", uploadHash: "token-hash", uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS,
    ...overrides,
  };
  assert.equal(coordinator.reserveRun(run, "plan", now + 60_000), "ok");
  return { coordinator, run, env };
}

function prepare(coordinator: InstanceType<typeof BuildCoordinator>) {
  const token = coordinator.claimPreparation(runId);
  assert.ok(token);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, token)?.phase, "triggered");
  coordinator.releasePreparation(runId, token);
}

function dispatch(coordinator: InstanceType<typeof BuildCoordinator>) {
  prepare(coordinator);
  assert.equal(coordinator.claimDispatch(runId), true);
}

function recordImplementation(coordinator: InstanceType<typeof BuildCoordinator>) {
  dispatch(coordinator);
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), true);
}

function pullRequest(headSha = planCommitSha, number = pr.number) {
  return { repository: { full_name: BUILD_REPO }, pull_request: { number, state: "open", merged: false, draft: true, html_url: `https://github.com/${BUILD_REPO}/pull/${number}`, head: { ref: branchForRun(runId), sha: headSha, repo: { full_name: BUILD_REPO } }, base: { ref: "main" }, updated_at: new Date().toISOString() } };
}

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

test("review requests claim once after implementation publication", () => {
  const { coordinator } = fixture();
  assert.equal(coordinator.claimReviewRequests(runId), false);
  recordImplementation(coordinator);
  assert.equal(coordinator.claimReviewRequests(runId), false);
  coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } });
  assert.equal(coordinator.claimReviewRequests(runId), true);
  assert.equal(coordinator.claimReviewRequests(runId), false);
});

test("legacy running uploads remain consumable without inventing a preparation record", () => {
  const { coordinator, run } = fixture();
  const legacyId = "2".repeat(32);
  const legacy: StoredRun = { ...run, callbackOrigin: undefined, state: { ...run.state, runId: legacyId, branch: branchForRun(legacyId), phase: "running" } };
  assert.equal(coordinator.reserveRun(legacy, "legacy", Date.now() + 60_000), "ok");
  assert.equal(coordinator.progress(legacyId, "token-hash", "Testing"), true);
  assert.equal(coordinator.claimUpload(legacyId, "token-hash")?.state.phase, "uploaded");
  assert.equal(coordinator.findPlanRun("legacy", 42)?.state.runId, legacyId);
});

test("a validated legacy upload can enter the shared draft publication flow exactly once", () => {
  const { coordinator } = fixture({ callbackOrigin: undefined });
  assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), true);
  assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  const prepared = coordinator.readRun(runId)!;
  assert.equal(prepared.planCommitSha, planCommitSha);
  assert.deepEqual(prepared.state.pr, pr);
  assert.equal(prepared.state.phase, "validated");
  assert.equal(prepared.uploadUsed, true);
  assert.equal(coordinator.claimDispatch(runId), false);
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha, "Verified publication body."), true);
  assert.equal(coordinator.updateRun(runId, { phase: "pr_open", pr: { ...pr, headSha: implementationHeadSha } })?.phase, "pr_open");
});

test("legacy preparation rejects new runs, unused uploads and terminal runs", () => {
  const current = fixture();
  dispatch(current.coordinator);
  assert.ok(current.coordinator.claimUpload(runId, "token-hash"));
  current.coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(current.coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  const unused = fixture({ callbackOrigin: undefined });
  unused.coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(unused.coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  for (const phase of ["failed", "blocked", "timeout", "closed", "merged"] as const) {
    const { coordinator } = fixture({ callbackOrigin: undefined });
    assert.ok(coordinator.claimUpload(runId, "token-hash"));
    coordinator.updateRun(runId, { phase });
    assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
    assert.equal(coordinator.readRun(runId)?.state.pr, undefined);
  }
});

test("legacy preparation verifies the draft identity and cannot replace an existing PR or head", () => {
  const { coordinator } = fixture({ callbackOrigin: undefined });
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  coordinator.updateRun(runId, { phase: "validated" });
  for (const candidate of [{ ...pr, draft: false }, { ...pr, headSha: baseSha }, { ...pr, number: -1 }, { ...pr, url: "https://github.com/someone/fork/pull/91" }]) {
    assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, candidate), false);
  }
  assert.equal(coordinator.setLegacyPrepared(runId, "invalid", pr), false);
  assert.equal(coordinator.setLegacyPrepared(runId, baseSha, { ...pr, headSha: baseSha }), false);
  coordinator.updateRun(runId, { pr: { ...pr, headSha: implementationHeadSha } });
  assert.equal(coordinator.setLegacyPrepared(runId, planCommitSha, pr), false);
  assert.equal(coordinator.readRun(runId)?.planCommitSha, undefined);
  assert.equal(coordinator.readRun(runId)?.state.pr?.headSha, implementationHeadSha);
});
