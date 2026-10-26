import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_REPO, type BuildFireResult, type BuildRun } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import { BuildPullRequestRejectedError, GithubBuildApi, reconcileBuild } from "./build/github.ts";
import { FIXTURE_PLAN_SHA } from "./build/testing/github-fixture.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { issuePlan } from "./build/plan.ts";
import { signBuildToken } from "./build/token.ts";
import { handleBuild, handleBuildStatus, handleBuildUpload, plan, baseSha, treeSha, headSha, runId, callbackOrigin, dispatchPath, oidc, upload, coordinator, signIn, stored, dispatched, post, githubFixture, createBuildPullRequest } from "./build/testing/lifecycle-fixture.ts";

test("build reads main with a read-only installation token before consuming the plan and quota", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture((call) => {
    if (!call.path.endsWith("/git/ref/heads/main")) return;
    assert.equal(call.headers.get("Authorization"), "Bearer installation-fixture");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_records WHERE key LIKE 'plan:%'").get()?.n, 0);
    return Response.json({ object: { sha: baseSha } });
  });
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher);
  assert.equal(response.status, 202);
  const result = await response.json() as BuildFireResult;
  assert.equal(instance.readRun(result.runId)?.baseSha, baseSha);
  assert.deepEqual(fixture.calls.find((call) => call.path.endsWith("/access_tokens"))?.body?.permissions, { contents: "read", pull_requests: "read", issues: "read", checks: "read", statuses: "read" });
  assert.equal(fixture.calls.filter((call) => call.path === dispatchPath).length, 1);
});

test("main lookup failure leaves the signed plan and build quota available for retry", async (t) => {
  const { env, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture((call) => call.path.endsWith("/git/ref/heads/main") ? Response.json({}, { status: 403 }) : undefined);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).status, 502);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_records WHERE key LIKE 'plan:%' OR key LIKE 'run:%'").get()?.n, 0);
  assert.equal(fixture.calls.some((call) => call.path === dispatchPath), false);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, githubFixture().fetcher)).status, 202);
});

test("dispatch sends the contract payload to repository_dispatch with the write installation token and no Anthropic egress", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  env.ANTHROPIC_EGRESS = { idFromName: () => assert.fail("Builds must not use Anthropic egress"), get: () => assert.fail("Builds must not use Anthropic egress") } as unknown as Env["ANTHROPIC_EGRESS"];
  const requests: Request[] = [];
  const github = githubFixture();
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return github.fetcher(input, init);
  };
  const abort = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => abort.signal);
  const proposal = await issuePlan(env, plan);
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 202);
  const result = await response.json() as BuildFireResult;
  const prepared = instance.readRun(result.runId)!;
  assert.equal(prepared.state.phase, "triggered");
  assert.equal(prepared.state.reason, undefined);
  assert.equal(prepared.dispatchAttempted, true);
  assert.equal(prepared.state.pr?.draft, true);
  assert.equal(prepared.planCommitSha, FIXTURE_PLAN_SHA);
  assert.ok(requests.every((request) => ["github.com", "api.github.com"].includes(new URL(request.url).hostname)));
  const dispatches = requests.filter((request) => new URL(request.url).pathname === dispatchPath);
  assert.equal(dispatches.length, 1);
  const [dispatch] = dispatches;
  assert.equal(dispatch.method, "POST");
  assert.equal(dispatch.headers.get("Authorization"), "Bearer installation-fixture");
  const tokenRequest = github.calls.filter((call) => call.path.endsWith("/access_tokens")).at(-1);
  assert.deepEqual(tokenRequest?.body?.permissions, { contents: "write", pull_requests: "write", issues: "read", checks: "read", statuses: "read" });
  assert.deepEqual(await dispatch.json(), { event_type: "build", client_payload: { runId: result.runId, planCommitSha: FIXTURE_PLAN_SHA, baseSha, prNumber: 12, callbackOrigin } });
  abort.abort();
  assert.equal(dispatch.signal.aborted, true);
});

for (const [outcome, status, phase, reason] of [
  ["rejection", 422, "failed", /GitHub rejected the build workflow dispatch/],
  ["missing workflow", 404, "failed", /GitHub rejected the build workflow dispatch/],
  ["rate limit", 429, "triggered", /build workflow result is unknown/],
  ["timeout", 408, "triggered", /build workflow result is unknown/],
  ["server error", 502, "triggered", /build workflow result is unknown/],
  ["lost response", 0, "triggered", /build workflow result is unknown/],
] as const) {
  test(`dispatch ${outcome} is recorded once and never dispatched again`, async (t) => {
    const { env, instance, db } = coordinator();
    t.after(() => db.close());
    const fixture = githubFixture((call) => {
      if (call.path !== dispatchPath) return undefined;
      if (!status) throw new Error("Dispatch response was lost");
      return Response.json({ message: "fixture" }, { status });
    });
    const proposal = await issuePlan(env, plan);
    const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
    const run = instance.readRun(result.runId)!;
    assert.equal(run.state.phase, phase);
    assert.match(run.state.reason ?? "", reason);
    assert.match(run.state.reason ?? "", /pull request remains a draft/);
    await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher);
    await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
    assert.equal(fixture.calls.filter((call) => call.path === dispatchPath).length, 1);
  });
}

test("publishing keeps the prepared PR draft, replaces supplied trailers and neutralizes body mentions", async () => {
  const run = await stored();
  run.plan = { ...plan, spec: "Ask @someone and \\@another", acceptance: ["Review by @team/name"], paths: ["src/@scope/card.tsx"] };
  const fixture = githubFixture();
  await createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, { ...upload, message: "feat: card\r\n\r\nCo-authored-by: Forged <forged@example.test>\n  co-AUTHORED-by: Other <other@example.test>\nClaude-Session: https://claude.ai/code/session_forged\nKeep this detail." }, treeSha);
  const message = String(fixture.calls.filter((call) => call.path.endsWith("/git/commits") && call.method === "POST").at(-1)?.body?.message);
  assert.equal(message, `feat: card\n\nKeep this detail.\n\nCo-authored-by: ${run.coauthor}\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
  const creation = fixture.calls.find((call) => call.path.endsWith("/pulls") && call.method === "POST")?.body;
  assert.equal(creation?.draft, true);
  const pr = fixture.calls.find((call) => call.path.endsWith("/pulls/12") && call.method === "PATCH")?.body;
  assert.doesNotMatch(String(pr?.body), /@[A-Za-z0-9]/);
  assert.match(String(pr?.body), /@\u200bsomeone/);
  assert.match(String(pr?.body), /@\u200bteam\/name/);
});

for (const status of [400, 401, 403, 422, 429]) {
  test(`PR rejection ${status} preserves the plan branch and can retry without duplicating its ref`, async () => {
    const run = await stored();
    let rejected = true;
    const fixture = githubFixture((call) => rejected && call.method === "POST" && call.path.endsWith("/pulls") ? Response.json({}, { status }) : undefined);
    await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, upload, treeSha), (error) => error instanceof BuildPullRequestRejectedError && /branch was preserved/.test(error.message));
    assert.equal(fixture.calls.some((call) => call.method === "DELETE" && call.path.includes("/git/refs/")), false);
    assert.equal(fixture.refs.get(run.state.branch), FIXTURE_PLAN_SHA);
    rejected = false;
    await createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, upload, treeSha);
    assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/git/refs")).length, 1);
    assert.equal(fixture.refs.get(run.state.branch), headSha);
  });
}

for (const status of [408, 500, 502]) {
  test(`uncertain PR response ${status} preserves the branch for delayed confirmation`, async () => {
    const run = await stored();
    const fixture = githubFixture((call) => call.path.endsWith("/pulls") ? Response.json({}, { status }) : undefined);
    await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, upload, treeSha));
    assert.equal(fixture.calls.some((call) => call.method === "DELETE"), false);
  });
}

test("PR timeout and explicit rejection both preserve the plan branch without cleanup", async () => {
  const run = await stored();
  const timeout = githubFixture((call) => { if (call.path.endsWith("/pulls")) throw new DOMException("Timed out", "TimeoutError"); return undefined; });
  await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", timeout.fetcher), run, upload, treeSha), /Timed out/);
  assert.equal(timeout.calls.some((call) => call.method === "DELETE"), false);
  const denied = githubFixture((call) => call.path.endsWith("/pulls") || call.method === "DELETE" ? Response.json({}, { status: 422 }) : undefined);
  await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", denied.fetcher), run, upload, treeSha), /branch was preserved/);
});

test("a run without a callback origin cannot be claimed by a workflow token", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await stored(), "upload-plan", Date.now() + 60_000);
  const fixture = githubFixture();
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, await oidc.token(buildWorkflowAudience(callbackOrigin, runId))), env, fixture.fetcher);
  assert.equal(response.status, 401);
  assert.equal(instance.readRun(runId)?.uploadUsed, false);
  assert.equal(instance.readRun(runId)?.state.phase, "triggered");
  assert.equal(fixture.calls.length, 0);
});

test("uploads whose every path is outside the allowed scope are blocked with the paths and no GitHub request", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await dispatched(), "scope-plan", Date.now() + 60_000);
  const denied = oidc.serve(async () => assert.fail("Disallowed paths must be rejected before GitHub access"));
  const files = [".github/workflows/x.yml", "workers/ai/AGENTS.md"].map((path) => ({ ...upload.files[0], path }));
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, { ...upload, files }, await oidc.token(buildWorkflowAudience(callbackOrigin, runId))), env, denied);
  assert.equal(response.status, 400);
  assert.equal(instance.readRun(runId)?.state.phase, "blocked");
  assert.match(instance.readRun(runId)?.state.reason ?? "", /outside the allowed scope.*\.github\/workflows\/x\.yml/);
});

for (const phase of ["merged", "closed"] as const) {
  test(`${phase} builds neither claim reconciliation nor request GitHub`, async (t) => {
    const { instance, env, db } = coordinator();
    t.after(() => db.close());
    const run = await stored();
    run.state = { ...run.state, phase, pr: { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha } };
    instance.reserveRun(run, "terminal-plan", Date.now() + 60_000);
    const token = await signBuildToken({ kind: "status", runId, expiresAt: Date.now() + 60_000 }, env.BUILD_SESSION_SECRET!);
    const denied: typeof fetch = async () => assert.fail("Terminal builds must not request GitHub");
    assert.deepEqual(await reconcileBuild(new GithubBuildApi("fixture", denied), run.state), {});
    assert.equal(instance.claimReconcile(runId), false);
    const claim = t.mock.method(instance, "claimReconcile", () => assert.fail("The status handler must skip terminal reconciliation"));
    const response = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${runId}`, { headers: { Authorization: `Bearer ${token}` } }), env, denied);
    assert.equal((await response.json() as BuildRun).phase, phase);
    assert.equal(claim.mock.callCount(), 0);
  });
}

test("reconciliation stops reading checks after discovering a closed PR", async () => {
  const run = await stored();
  run.state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  const fixture = githubFixture((call) => call.path.endsWith("/pulls/12") ? Response.json({ number: 12, html_url: run.state.pr!.url, head: { sha: headSha }, state: "closed", merged: false, updated_at: new Date().toISOString() }) : undefined);
  const patch = await reconcileBuild(new GithubBuildApi("fixture", fixture.fetcher), run.state);
  assert.equal(patch.phase, "closed");
  assert.equal("ci" in patch, false);
  assert.equal(fixture.calls.length, 1);
});
