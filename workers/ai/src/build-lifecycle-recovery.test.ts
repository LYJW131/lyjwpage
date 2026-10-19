import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BUILD_REPO, type BuildFireResult, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import { FIXTURE_PLAN_SHA } from "./build/testing/github-fixture.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { issuePlan } from "./build/plan.ts";
import { uploadTokenForRun } from "./build/token.ts";
import { handleBuild, handleBuildStatus, handleBuildUpload, handleGithubWebhook, plan, headSha, runId, buildSecret, callbackOrigin, dispatchPath, oidc, upload, coordinator, signIn, stored, post, githubFixture } from "./build/testing/lifecycle-fixture.ts";

test("webhook processing failures do not consume delivery IDs and successful retries deduplicate", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  const run = await stored();
  run.uploadUsed = true;
  run.state.phase = "validated";
  run.state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  instance.reserveRun(run, "webhook-plan", Date.now() + 60_000);
  const text = JSON.stringify({ repository: { full_name: BUILD_REPO }, pull_request: { number: 12, state: "open", merged: false, html_url: `https://github.com/${BUILD_REPO}/pull/12`, head: { ref: run.state.branch, sha: headSha, repo: { full_name: BUILD_REPO } }, base: { ref: "main" }, updated_at: new Date().toISOString() } });
  const signature = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET!).update(text).digest("hex")}`;
  const request = () => new Request("https://api.test/api/build/webhook", { method: "POST", body: text, headers: { "X-Hub-Signature-256": signature, "X-GitHub-Delivery": "retry-delivery", "X-GitHub-Event": "pull_request" } });
  const failed = t.mock.method(instance, "updateRun", () => { throw new Error("Temporary storage failure"); });
  await assert.rejects(() => handleGithubWebhook(request(), env), /Temporary storage failure/);
  assert.equal(instance.hasDelivery("retry-delivery"), false);
  failed.mock.restore();
  assert.equal((await handleGithubWebhook(request(), env)).status, 200);
  assert.equal(instance.hasDelivery("retry-delivery"), true);
  assert.equal(instance.readRun(runId)?.state.phase, "pr_open");
  t.mock.method(instance, "updateRun", () => assert.fail("Successful delivery must not be applied twice"));
  assert.equal((await handleGithubWebhook(request(), env)).status, 200);
});

test("the draft link is returned while workflow dispatch continues in the execution context", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  let finishDispatch!: () => void;
  const dispatchPending = new Promise<void>((resolve) => { finishDispatch = resolve; });
  let reachedDispatch!: () => void;
  const dispatchReached = new Promise<void>((resolve) => { reachedDispatch = resolve; });
  const fixture = githubFixture();
  const jobs: Promise<unknown>[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === dispatchPath) {
      reachedDispatch();
      await dispatchPending;
      return new Response(null, { status: 503 });
    }
    return fixture.fetcher(input, init);
  };
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher, { waitUntil(job) { jobs.push(job); } });
  const result = await response.json() as BuildFireResult;
  assert.equal(response.status, 202);
  assert.equal(result.run?.pr?.draft, true);
  assert.equal(result.run?.pr?.url, `https://github.com/${BUILD_REPO}/pull/12`);
  assert.equal(result.run?.phase, "triggered");
  assert.equal(jobs.length, 1);
  assert.equal("uploadHash" in result.run!, false);
  await dispatchReached;
  assert.equal(instance.readRun(result.runId)?.dispatchAttempted, true);
  assert.equal(instance.readRun(result.runId)?.state.reason, undefined);
  finishDispatch();
  await Promise.all(jobs);
  assert.match(instance.readRun(result.runId)?.state.reason ?? "", /build workflow result is unknown/);
});

test("concurrent clicks and same-account retry share one run, quota hit, branch, PR and dispatch", async (t) => {
  const { env, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)));
  const results = await Promise.all(responses.map((response) => response.json() as Promise<BuildFireResult>));
  assert.ok(responses.every((response) => response.status === 202));
  assert.equal(new Set(results.map((result) => result.runId)).size, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 1);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/pulls")).length, 1);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/git/refs")).length, 1);
  assert.equal(fixture.calls.filter((call) => call.path === dispatchPath).length, 1);
  const other: typeof fetch = (input, init) => String(input).endsWith("/user")
    ? Promise.resolve(Response.json({ id: 2, login: "another-visitor", name: null }))
    : fixture.fetcher(input, init);
  const denied = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, other);
  assert.equal(denied.status, 409);
  assert.equal("runId" in (await denied.json() as Record<string, unknown>), false);
});

test("status recovers draft creation failure without dispatching early or marking the plan ready", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  let rejectPr = true;
  const fixture = githubFixture((call) => rejectPr && call.path.endsWith("/pulls") && call.method === "POST" ? Response.json({}, { status: 422 }) : undefined);
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher);
  const result = await response.json() as BuildFireResult;
  assert.equal(result.run?.phase, "triggered");
  assert.equal(result.run?.pr, undefined);
  assert.match(result.run?.reason ?? "", /build workflow was not started/);
  assert.equal(fixture.refs.get(result.branch), FIXTURE_PLAN_SHA);
  assert.equal(fixture.calls.filter((call) => call.path === dispatchPath).length, 0);
  rejectPr = false;
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
  const state = await status.json() as BuildRun;
  assert.equal(state.phase, "triggered");
  assert.equal(state.pr?.draft, true);
  assert.equal(state.ci?.state, "success");
  assert.equal(state.reason, undefined);
  assert.equal(fixture.calls.filter((call) => call.path === "/graphql").length, 0);
  assert.equal(fixture.calls.filter((call) => call.path === dispatchPath).length, 1);
  assert.equal(instance.readRun(result.runId)?.dispatchAttempted, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 1);
});

test("recorded implementation and review body recover after a GitHub write failure without reopening or replaying upload", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  let rejectBody = true;
  const fixture = githubFixture((call) => rejectBody && call.path.endsWith("/pulls/12") && call.method === "PATCH" ? Response.json({}, { status: 503 }) : undefined);
  const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, result.runId));
  const changed: BuildUpload = { ...upload, files: [...upload.files, { path: "shared/fixture.ts", mode: "100644", content: btoa("export const fixture = true;") }] };
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, changed, token), env, fixture.fetcher);
  assert.equal(response.status, 502);
  const pending = instance.readRun(result.runId)!;
  assert.equal(pending.state.phase, "failed");
  assert.equal(pending.state.pr?.draft, true);
  assert.equal(pending.implementationHeadSha, headSha);
  assert.match(pending.publicationBody ?? "", /shared contract/);
  assert.equal(fixture.refs.get(result.branch), FIXTURE_PLAN_SHA);
  rejectBody = false;
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
  const state = await status.json() as BuildRun;
  assert.equal(state.phase, "pr_open");
  assert.equal(state.pr?.headSha, headSha);
  assert.equal(state.pr?.draft, false);
  assert.equal(state.reason, undefined);
  assert.equal(fixture.refs.get(result.branch), headSha);
  assert.equal(fixture.calls.filter((call) => call.path.endsWith("/pulls") && call.method === "POST").length, 1);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, changed, token), env, fixture.fetcher)).status, 401);
  assert.equal(JSON.stringify(state).includes(await uploadTokenForRun(result.runId, buildSecret)), false);
  assert.equal("publicationBody" in state, false);
});

function holdFinalPublicationRead(fixture: ReturnType<typeof githubFixture>, branch: string, loseResponse: boolean) {
  let release!: () => void;
  let reached!: () => void;
  let holding = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const held = new Promise<void>((resolve) => { reached = resolve; });
  const fetcher: typeof fetch = async (input, init) => {
    if (!holding && String(input).endsWith("/pulls/12") && init?.method === "GET" && fixture.refs.get(branch) === headSha) {
      holding = true;
      reached();
      await pending;
      if (loseResponse) throw new Error("Publication response was lost.");
    }
    return fixture.fetcher(input, init);
  };
  return { fetcher, held, release };
}

for (const loseResponse of [false, true]) test(`status completion survives a late upload ${loseResponse ? "failure" : "confirmation"}`, async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, result.runId));
  const delayed = holdFinalPublicationRead(fixture, result.branch, loseResponse);
  t.after(delayed.release);
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, token), env, delayed.fetcher);
  await delayed.held;
  assert.equal(instance.readRun(result.runId)?.state.phase, "validated");
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
  const ready = await status.json() as BuildRun;
  assert.equal(ready.phase, "pr_open");
  assert.equal(ready.pr?.draft, false);
  delayed.release();
  const response = await uploading;
  assert.equal(response.status, 201);
  const state = await response.json() as BuildRun;
  assert.equal(state.phase, "pr_open");
  assert.equal(state.pr?.draft, false);
  assert.equal(state.pr?.headSha, headSha);
  assert.equal(instance.readRun(result.runId)?.state.reason, undefined);
});

test("a frozen draft publication confirmation cannot replace readiness completed by status", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, result.runId));
  let release!: () => void;
  let reached!: () => void;
  let holding = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const held = new Promise<void>((resolve) => { reached = resolve; });
  t.after(() => release());
  const original = instance.completePublication.bind(instance);
  const delayedCoordinator = new Proxy(instance, { get(target, key) {
    if (key === "completePublication") return async (id: string, pr: NonNullable<BuildRun["pr"]>) => {
      if (!holding) {
        holding = true;
        assert.equal(pr.draft, true);
        reached();
        await pending;
      }
      return original(id, pr);
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const delayedEnv = { ...env, BUILD_COORDINATOR: { getByName: () => delayedCoordinator } } as unknown as Env;
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, token), delayedEnv, fixture.fetcher);
  await held;
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
  const ready = await status.json() as BuildRun;
  assert.equal(ready.pr?.draft, false);
  assert.equal(ready.ci?.state, "success");
  release();
  const response = await uploading;
  assert.equal(response.status, 201);
  const completed = await response.json() as BuildRun;
  assert.equal(completed.phase, "pr_open");
  assert.equal(completed.pr?.draft, false);
  assert.deepEqual(completed.ci, ready.ci);
  assert.equal(instance.readRun(result.runId)?.state.pr?.draft, false);
});

test("a late reconciliation rejection cannot overwrite a concurrently confirmed upload", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, result.runId));
  const delayed = holdFinalPublicationRead(fixture, result.branch, false);
  t.after(delayed.release);
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, token), env, delayed.fetcher);
  await delayed.held;
  let releaseStatus!: () => void;
  let reachedStatus!: () => void;
  const statusPending = new Promise<void>((resolve) => { releaseStatus = resolve; });
  const statusHeld = new Promise<void>((resolve) => { reachedStatus = resolve; });
  t.after(() => releaseStatus());
  const staleFetcher: typeof fetch = async (input, init) => {
    const response = await fixture.fetcher(input, init);
    if (String(input).endsWith("/pulls/12") && init?.method === "GET") {
      const snapshot = await response.json() as Record<string, unknown>;
      reachedStatus();
      await statusPending;
      return Response.json({ ...snapshot, state: "closed" });
    }
    return response;
  };
  const checking = handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, staleFetcher);
  await statusHeld;
  delayed.release();
  assert.equal((await uploading).status, 201);
  releaseStatus();
  const state = await (await checking).json() as BuildRun;
  assert.equal(state.phase, "pr_open");
  assert.equal(state.reason, undefined);
  assert.equal(instance.readRun(result.runId)?.state.phase, "pr_open");
});
