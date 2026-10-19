import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_LABELS } from "@shared/build-routine";
import { BuildBlockedError, markBuildReady, prepareBuildPullRequest, reconcileBuild, recoverBuildPublication } from "./build/github.ts";
import { baseSha, prepared, published, runId } from "./build/testing/preparation-fixture.ts";

test("plan-only drafts preserve active and failure phases during reconciliation", async () => {
  const setup = await prepared();
  for (const phase of ["triggered", "running", "uploaded", "validated", "blocked", "failed", "timeout"] as const) {
    const result = await reconcileBuild(setup.api, { ...setup.stored.state, phase });
    assert.equal(result.phase, phase);
    assert.equal(result.pr?.draft, true);
  }
});

for (const result of ["pending", "failure", "cancelled", "neutral", "skipped"] as const) test(`CI ${result} cannot mark the implementation ready`, async () => {
  const setup = await published();
  setup.state.check = result;
  assert.equal(await markBuildReady(setup.api, setup.stored), null);
  assert.equal(setup.state.readyCalls, 0);
});

test("only successful check from GitHub Actions on the implementation head marks ready", async () => {
  const setup = await published();
  setup.state.checkApp = "other-app";
  assert.equal(await markBuildReady(setup.api, setup.stored), null);
  setup.state.checkApp = "github-actions";
  setup.state.otherCheck = "failure";
  assert.equal(await markBuildReady(setup.api, setup.stored), null);
  setup.state.otherCheck = "success";
  const result = await markBuildReady(setup.api, setup.stored);
  assert.equal(result?.draft, false);
  assert.equal(setup.state.readyCalls, 1);
  assert.equal((await markBuildReady(setup.api, setup.stored))?.draft, false);
  assert.equal(setup.state.readyCalls, 1);
});

test("the implementation stays draft until both CodeQL analyses succeed", async () => {
  const setup = await published();
  for (const codeql of [null, "failure", "skipped"]) {
    setup.state.codeql = codeql;
    assert.equal(await markBuildReady(setup.api, setup.stored), null);
  }
  assert.equal(setup.state.readyCalls, 0);
  setup.state.codeql = "success";
  assert.equal((await markBuildReady(setup.api, setup.stored))?.draft, false);
});

test("failed or blocked runs and a mismatched implementation head never request readiness", async () => {
  const setup = await published();
  for (const phase of ["failed", "blocked", "timeout", "closed"] as const) {
    setup.stored.state.phase = phase;
    assert.equal(await markBuildReady(setup.api, setup.stored), null);
  }
  setup.stored.state.phase = "pr_open";
  setup.state.pr!.head.sha = "d".repeat(40);
  await assert.rejects(() => markBuildReady(setup.api, setup.stored), BuildBlockedError);
  assert.equal(setup.state.readyCalls, 0);
});

test("a remote head change during readiness is restored to draft", async () => {
  const setup = await published();
  setup.state.changeReadyHead = true;
  await assert.rejects(() => markBuildReady(setup.api, setup.stored), /head changed/);
  assert.equal(setup.state.pr!.draft, true);
});

test("publication recovery adopts an already-ready recorded implementation without another mutation", async () => {
  const setup = await published();
  assert.equal((await markBuildReady(setup.api, setup.stored))?.draft, false);
  const writes = setup.calls.filter((call) => call.method !== "GET").length;
  const confirmed = await recoverBuildPublication(setup.api, setup.stored);
  assert.equal(confirmed.draft, false);
  assert.equal(confirmed.headSha, setup.stored.implementationHeadSha);
  assert.equal(setup.calls.filter((call) => call.method !== "GET").length, writes);
  setup.state.head = baseSha;
  await assert.rejects(() => recoverBuildPublication(setup.api, setup.stored), /unexpected commit/);
});

test("ready publication recovery rejects missing review details without replacing a human edit", async () => {
  const setup = await published();
  await markBuildReady(setup.api, setup.stored);
  setup.state.pr!.body = `Edited description\n\n<!-- build-run:${runId} -->`;
  await assert.rejects(() => recoverBuildPublication(setup.api, setup.stored), /review details/);
  assert.equal(setup.state.pr!.body, `Edited description\n\n<!-- build-run:${runId} -->`);
});

test("historical PR reconciliation accepts only the exact legacy run footer and preserves strict new-draft ownership", async () => {
  for (const labels of Object.values(PLAN_LABELS)) {
    const setup = await prepared();
    delete setup.stored.state.pr!.draft;
    setup.stored.state.phase = "pr_open";
    setup.state.pr!.draft = false;
    setup.state.pr!.body = `Confirmed plan\n\n${labels.buildRun(runId)}`;
    const patch = await reconcileBuild(setup.api, setup.stored.state);
    assert.equal(patch.phase, "pr_open");
    assert.equal(patch.pr?.draft, undefined);
    setup.stored.state = { ...setup.stored.state, ...patch };
    assert.equal((await reconcileBuild(setup.api, setup.stored.state)).phase, "pr_open");
    setup.state.pr!.user.id = 1;
    await assert.rejects(() => reconcileBuild(setup.api, setup.stored.state), BuildBlockedError);
    setup.state.pr!.user.id = 338272049;
    setup.stored.state.pr!.draft = true;
    await assert.rejects(() => reconcileBuild(setup.api, setup.stored.state), BuildBlockedError);
    await assert.rejects(() => prepareBuildPullRequest(setup.api, setup.stored), BuildBlockedError);
  }
});
