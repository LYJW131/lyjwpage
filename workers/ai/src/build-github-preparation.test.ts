import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BUILD_REPO, PLAN_LABELS, branchForRun, type BuildUpload } from "@shared/build-routine";
import type { StoredRun } from "./build/coordinator.ts";
import { BuildBlockedError, createBuildPullRequest, GithubBuildApi, markBuildReady, prepareBuildPullRequest, reconcileBuild, recoverBuildPublication } from "./build/github.ts";

const baseSha = "a".repeat(40);
const baseTree = "b".repeat(40);
const runId = "c".repeat(32);
const upload: BuildUpload = { baseSha, message: "feat: improve card", files: [{ path: "src/card.ts", mode: "100644", content: btoa("export const improved = true;") }], deletions: [] };
const run = (): StoredRun => ({ state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: 1791590400000, updatedAt: 1791590400000 }, plan: { title: "Improve card", spec: "Make the public card clearer.", acceptance: ["The card is readable."], paths: ["src/card.ts"] }, account: "private-visitor", coauthor: "Private Visitor <private-visitor@example.test>", sessionUrl: "https://claude.ai/code/private-session", baseSha, uploadHash: "private-upload-hash", uploadUsed: false, uploadExpiresAt: Date.now() + 60000 });
type Entry = { path: string; type: string; mode: string; sha: string | null };
type PullRequest = { number: number; node_id: string; html_url: string; state: string; merged: boolean; draft: boolean; body: string; updated_at: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string; repo: { full_name: string } }; user: { id: number; login: string; type: string } };
type Call = { path: string; method: string; body: Record<string, unknown> };

function fixture() {
  const state = { head: null as string | null, pr: null as PullRequest | null, loseRefResponse: false, losePrResponse: false, losePushResponse: false, rejectPr: false, rejectBody: false, check: "success", otherCheck: "success", checkApp: "github-actions", checkName: "check", readyCalls: 0, changeReadyHead: false };
  const calls: Call[] = [];
  const trees = new Map<string, Entry[]>([[baseTree, []]]);
  const commits = new Map<string, { sha: string; tree: { sha: string }; parents: { sha: string }[] }>([[baseSha, { sha: baseSha, tree: { sha: baseTree }, parents: [] }]]);
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(`/repos/${BUILD_REPO}`, "") + url.search;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    if (path.startsWith("/compare/")) return Response.json({ status: "identical", merge_base_commit: { sha: baseSha } });
    if (path.startsWith("/git/commits/") && method === "GET") return Response.json(commits.get(path.split("/").at(-1)!));
    if (path.startsWith("/git/trees/") && method === "GET") return Response.json({ truncated: false, tree: trees.get(path.split("/").at(-1)!.split("?")[0]) });
    if (path === "/git/blobs") return Response.json({ sha: sha(body) });
    if (path === "/git/trees") {
      const entries = new Map(trees.get(body.base_tree)?.map((entry) => [entry.path, entry]));
      for (const entry of body.tree as Entry[]) { if (entry.sha === null) entries.delete(entry.path); else entries.set(entry.path, entry); }
      const tree = [...entries.values()];
      const id = sha(tree);
      trees.set(id, tree);
      return Response.json({ sha: id });
    }
    if (path === "/git/commits") {
      const id = sha(body);
      commits.set(id, { sha: id, tree: { sha: body.tree }, parents: body.parents.map((id: string) => ({ sha: id })) });
      return Response.json({ sha: id });
    }
    if (path.startsWith("/git/ref/heads/")) return state.head ? Response.json({ ref: `refs/heads/${branchForRun(runId)}`, object: { sha: state.head } }) : Response.json({}, { status: 404 });
    if (path === "/git/refs") {
      if (state.head) return Response.json({}, { status: 422 });
      state.head = body.sha;
      if (state.loseRefResponse) throw new Error("Lost ref response");
      return Response.json({ ref: body.ref, object: { sha: state.head } });
    }
    if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
      assert.equal(body.force, false);
      state.head = body.sha;
      if (state.pr) state.pr.head.sha = body.sha;
      if (state.losePushResponse) throw new Error("Lost push response");
      return Response.json({ object: { sha: state.head } });
    }
    if (path.startsWith("/pulls?")) return Response.json(state.pr ? [state.pr] : []);
    if (path === "/pulls" && method === "POST") {
      if (state.rejectPr) return Response.json({}, { status: 422 });
      assert.equal(state.pr, null);
      state.pr = { number: 80, node_id: "PR_fixture", html_url: `https://github.com/${BUILD_REPO}/pull/80`, state: "open", merged: false, draft: body.draft, body: body.body, updated_at: new Date().toISOString(), head: { sha: state.head!, ref: body.head, repo: { full_name: BUILD_REPO } }, base: { ref: body.base, repo: { full_name: BUILD_REPO } }, user: { id: 338272049, login: "lyjw131[bot]", type: "Bot" } };
      if (state.losePrResponse) throw new Error("Lost PR response");
      return Response.json(state.pr);
    }
    if (path === "/pulls/80") {
      if (method === "PATCH") {
        if (state.rejectBody) return Response.json({}, { status: 502 });
        state.pr!.body = body.body;
      }
      return Response.json(state.pr);
    }
    if (path.includes("/check-runs?")) return Response.json({ total_count: 2, check_runs: [{ name: state.checkName, status: "completed", conclusion: state.check, app: { slug: state.checkApp } }, { name: "Other check", status: "completed", conclusion: state.otherCheck, app: { slug: "github-actions" } }] });
    if (path.includes("/status?")) return Response.json({ total_count: 0, state: "pending", statuses: [] });
    if (path.includes("/comments?")) return Response.json([]);
    if (path === "/graphql") {
      if (String(body.query).includes("convertPullRequestToDraft")) { state.pr!.draft = true; return Response.json({ data: { convertPullRequestToDraft: { pullRequest: { isDraft: true } } } }); }
      state.readyCalls += 1;
      state.pr!.draft = false;
      if (state.changeReadyHead) state.pr!.head.sha = "f".repeat(40);
      return Response.json({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false, headRefOid: state.pr!.head.sha, number: 80 } } } });
    }
    assert.fail(`Unexpected ${method} ${path}`);
  };
  return { api: new GithubBuildApi("fixture", fetcher), state, calls, trees, commits };
}

async function prepared(setup = fixture()) {
  const stored = run();
  const result = await prepareBuildPullRequest(setup.api, stored);
  stored.planCommitSha = result.planCommitSha;
  stored.state.pr = result.pr;
  return { ...setup, stored };
}

async function published() {
  const setup = await prepared();
  setup.stored.uploadUsed = true;
  setup.stored.state.pr = await createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async (sha, body) => { setup.stored.implementationHeadSha = sha; setup.stored.publicationBody = body; });
  setup.stored.state.phase = "pr_open";
  setup.stored.state.ci = { state: "success", updatedAt: Date.now() };
  return setup;
}

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
