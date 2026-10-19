import assert from "node:assert/strict";
import test from "node:test";
import { BuildBlockedError, BuildPublicationPendingError, createBuildPullRequest, GithubBuildApi, prepareBuildPullRequest, recoverBuildPublication } from "./build/github.ts";
import { baseSha, baseTree, fixture, prepared, run, runId, upload } from "./build/testing/preparation-fixture.ts";

test("preparation records only the confirmed plan before opening one draft and retries reuse it", async () => {
  const setup = await prepared();
  const planBlob = setup.calls.find((call) => call.path === "/git/blobs")!;
  assert.match(String(planBlob.body.content), /^# Improve card/);
  assert.doesNotMatch(String(planBlob.body.content), /private-|Private Visitor|account|uploadHash/);
  const planEntries = setup.trees.get(setup.commits.get(setup.stored.planCommitSha!)!.tree.sha)!;
  assert.deepEqual(planEntries.map((entry) => entry.path), [`builds/${runId}.md`]);
  assert.deepEqual(setup.commits.get(setup.stored.planCommitSha!)!.parents, [{ sha: baseSha }]);
  const repeated = await prepareBuildPullRequest(setup.api, setup.stored);
  assert.equal(repeated.planCommitSha, setup.stored.planCommitSha);
  assert.equal(repeated.pr.draft, true);
  assert.equal(setup.calls.filter((call) => call.path === "/pulls" && call.method === "POST").length, 1);
});

for (const failure of ["loseRefResponse", "losePrResponse"] as const) test(`preparation recovers ${failure} without a duplicate PR`, async () => {
  const setup = fixture();
  setup.state[failure] = true;
  const result = await prepareBuildPullRequest(setup.api, run());
  assert.equal(result.pr.number, 80);
  assert.equal(result.pr.draft, true);
  assert.equal(setup.calls.filter((call) => call.method === "DELETE").length, 0);
});

test("PR rejection retains the plan branch and retry creates a draft on the same commit", async () => {
  const setup = fixture();
  setup.state.rejectPr = true;
  await assert.rejects(() => prepareBuildPullRequest(setup.api, run()), /preserved for retry/);
  const head = setup.state.head;
  setup.state.rejectPr = false;
  const result = await prepareBuildPullRequest(setup.api, run());
  assert.equal(result.planCommitSha, head);
});

test("preparation rejects foreign branches, existing plan paths and symlink parents without modifying refs", async () => {
  const foreign = fixture();
  foreign.state.head = "e".repeat(40);
  await assert.rejects(() => prepareBuildPullRequest(foreign.api, run()), BuildBlockedError);
  assert.equal(foreign.calls.some((call) => call.path === "/git/refs"), false);
  for (const entry of [{ path: `builds/${runId}.md`, type: "blob", mode: "100644", sha: baseSha }, { path: "builds", type: "blob", mode: "120000", sha: baseSha }]) {
    const setup = fixture();
    setup.trees.set(baseTree, [entry]);
    await assert.rejects(() => prepareBuildPullRequest(setup.api, run()), BuildBlockedError);
    assert.equal(setup.calls.some((call) => call.method === "POST"), false);
  }
});

for (const target of ["actor", "marker", "base", "headRepo", "closed"] as const) test(`recovery rejects a mismatched PR ${target}`, async () => {
  const setup = await prepared();
  if (target === "actor") setup.state.pr!.user.id = 1;
  if (target === "marker") setup.state.pr!.body = "Unrelated plan";
  if (target === "base") setup.state.pr!.base.ref = "dev";
  if (target === "headRepo") setup.state.pr!.head.repo.full_name = "someone/fork";
  if (target === "closed") setup.state.pr!.state = "closed";
  await assert.rejects(() => prepareBuildPullRequest(setup.api, setup.stored), BuildBlockedError);
  assert.equal(setup.calls.filter((call) => call.path === "/pulls").length, 1);
});

test("implementation persists its SHA and body before ref publication and retains the plan file", async () => {
  const setup = await prepared();
  const result = await createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async (sha, body) => {
    assert.equal(setup.state.head, setup.stored.planCommitSha);
    assert.match(body, /build-run:/);
    setup.stored.implementationHeadSha = sha;
    setup.stored.publicationBody = body;
  });
  assert.equal(result.number, setup.stored.state.pr!.number);
  assert.equal(result.draft, true);
  const implementation = setup.commits.get(result.headSha)!;
  assert.deepEqual(implementation.parents, [{ sha: setup.stored.planCommitSha }]);
  assert.deepEqual(setup.trees.get(implementation.tree.sha)!.map((entry) => entry.path), [`builds/${runId}.md`, "src/card.ts"]);
  assert.equal(setup.calls.filter((call) => call.path === "/pulls").length, 1);
  assert.equal(setup.state.readyCalls, 0);
});

test("body update failure is recoverable before pushing and ambiguous push success is adopted", async () => {
  const setup = await prepared();
  setup.state.rejectBody = true;
  await assert.rejects(() => createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async (sha, body) => { setup.stored.implementationHeadSha = sha; setup.stored.publicationBody = body; }));
  assert.equal(setup.state.head, setup.stored.planCommitSha);
  assert.ok(setup.stored.implementationHeadSha);
  setup.state.rejectBody = false;
  setup.state.losePushResponse = true;
  const result = await recoverBuildPublication(setup.api, setup.stored);
  assert.equal(result.headSha, setup.stored.implementationHeadSha);
  assert.equal(setup.state.pr!.body, setup.stored.publicationBody);
});

test("a pull request head that lags the pushed branch is awaited, then left pending rather than blocked", async () => {
  const setup = await prepared();
  setup.state.prHeadLag = 2;
  const result = await createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async (sha, body) => { setup.stored.implementationHeadSha = sha; setup.stored.publicationBody = body; });
  assert.equal(result.headSha, setup.stored.implementationHeadSha);

  const stale = await prepared();
  stale.state.prHeadLag = 100;
  const error = await createBuildPullRequest(stale.api, stale.stored, upload, baseTree, async (sha, body) => { stale.stored.implementationHeadSha = sha; stale.stored.publicationBody = body; }).then(() => null, (error: unknown) => error);
  assert.ok(error instanceof BuildPublicationPendingError && !(error instanceof BuildBlockedError));
  assert.equal(stale.state.head, stale.stored.implementationHeadSha);
  stale.state.prHeadLag = 1;
  assert.equal((await recoverBuildPublication(stale.api, stale.stored)).headSha, stale.stored.implementationHeadSha);
});

test("a failed implementation checkpoint never advances the remote branch", async () => {
  const setup = await prepared();
  await assert.rejects(() => createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async () => { throw new Error("Storage unavailable"); }), /Storage unavailable/);
  assert.equal(setup.state.head, setup.stored.planCommitSha);
  assert.equal(setup.calls.some((call) => call.path.startsWith("/git/refs/heads/") && call.method === "PATCH"), false);
});

test("an implementation cannot overwrite the stored plan or recover from a foreign parent", async () => {
  const setup = await prepared();
  await assert.rejects(() => createBuildPullRequest(setup.api, setup.stored, { ...upload, files: [{ ...upload.files[0], path: `builds/${runId}.md` }] }, baseTree, async () => {}), /cannot replace/);
  setup.stored.implementationHeadSha = "d".repeat(40);
  setup.commits.set(setup.stored.implementationHeadSha, { sha: setup.stored.implementationHeadSha, tree: { sha: baseTree }, parents: [{ sha: baseSha }] });
  await assert.rejects(() => recoverBuildPublication(setup.api, setup.stored), /does not continue/);
  assert.equal(setup.state.head, setup.stored.planCommitSha);
});

test("GithubBuildApi calls its fetcher without a receiver, as workerd's global fetch requires", async () => {
  const fetcher = async function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Response.json({ id: 1, login: "visitor" });
  } as typeof fetch;
  assert.deepEqual(await new GithubBuildApi("token", fetcher).request("/user"), { id: 1, login: "visitor" });
});
