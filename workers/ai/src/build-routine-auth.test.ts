import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_REPO, branchForRun } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import { uploadTokenForRun } from "./build/token.ts";
import { verifyGithubWebhook, applyGithubWebhook } from "./build/webhook.ts";
import { FIXTURE_PLAN_SHA } from "./build/testing/github-fixture.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { createActionsOidcFixture } from "./build/testing/actions-oidc.ts";
import { issuePlan } from "./build/plan.ts";
import { buildSecret, callbackOrigin, coordinator, dispatched, githubFixture, handleBuild, handleBuildProgress, handleBuildScreenshot, handleBuildStatus, handleBuildUpload, handleGithubWebhook, headSha, imageBucket, json, oidc, plan, png, post, runId, sha, signIn, stored, upload } from "./build/testing/routine-fixture.ts";

test("webhooks verify exact bytes, reject invalid signatures and deduplicate deliveries", async () => {
  const { env, instance } = coordinator();
  const run = await stored();
  run.uploadUsed = true;
  run.state.phase = "validated";
  run.state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  instance.reserveRun(run, "p", Date.now() + 60_000);
  const payload = { repository: { full_name: BUILD_REPO }, pull_request: { number: 12, state: "open", merged: false, html_url: `https://github.com/${BUILD_REPO}/pull/12`, head: { ref: run.state.branch, sha: headSha, repo: { full_name: BUILD_REPO } }, base: { ref: "main" }, updated_at: new Date().toISOString() } };
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = `sha256=${Buffer.from(await crypto.subtle.sign("HMAC", key, bytes)).toString("hex")}`;
  assert.equal(await verifyGithubWebhook(bytes, signature, env.GITHUB_WEBHOOK_SECRET!), true);
  assert.equal(await verifyGithubWebhook(new TextEncoder().encode(text + " "), signature, env.GITHUB_WEBHOOK_SECRET!), false);
  const request = () => new Request("https://api.test/api/build/webhook", { method: "POST", headers: { "X-Hub-Signature-256": signature, "X-GitHub-Delivery": "delivery-1", "X-GitHub-Event": "pull_request" }, body: text });
  assert.equal((await handleGithubWebhook(request(), env)).status, 200);
  assert.equal(instance.readRun(runId)?.state.pr?.number, 12);
  assert.equal((await handleGithubWebhook(request(), env)).status, 200);
  assert.equal(instance.hasDelivery("delivery-1"), true);
  await applyGithubWebhook(env, "pull_request", { ...payload, pull_request: { ...payload.pull_request, number: 99, head: { ...payload.pull_request.head, repo: { full_name: "attacker/fork" } } } });
  assert.equal(instance.readRun(runId)?.state.pr?.number, 12);
});

test("CI deliveries for other branches are acknowledged without touching the BuildCoordinator; build-branch and branchless ones are deduplicated and looked up", async () => {
  const calls: string[] = [];
  const env = {
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    BUILD_COORDINATOR: { getByName: () => ({
      hasDelivery(id: string) { calls.push(`has ${id}`); return false; },
      findRun(sha: string) { calls.push(`find ${sha}`); return null; },
      completeDelivery(id: string) { calls.push(`done ${id}`); },
    }) },
  } as unknown as Env;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const deliver = async (delivery: string, event: string, payload: object) => {
    const text = JSON.stringify({ repository: { full_name: BUILD_REPO }, ...payload });
    const signature = `sha256=${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).toString("hex")}`;
    const response = await handleGithubWebhook(new Request("https://api.test/api/build/webhook", { method: "POST", body: text, headers: { "X-Hub-Signature-256": signature, "X-GitHub-Delivery": delivery, "X-GitHub-Event": event } }), env);
    assert.equal(response.status, 200, delivery);
  };
  const checkRun = (branch: string | null) => ({ check_run: { name: "check", head_sha: headSha, status: "completed", conclusion: "success", check_suite: { head_branch: branch } } });
  const checkSuite = (branch: string | null) => ({ check_suite: { head_sha: headSha, status: "completed", conclusion: "success", head_branch: branch } });
  const status = (...branches: string[]) => ({ sha: headSha, state: "success", branches: branches.map((name) => ({ name })) });

  await deliver("main-run", "check_run", checkRun("main"));
  await deliver("thread-suite", "check_suite", checkSuite("claude/project-thread-x"));
  await deliver("other-status", "status", status("main", "claude/project-thread-x"));
  assert.deepEqual(calls, []);

  await deliver("build-run", "check_run", checkRun(branchForRun(runId)));
  await deliver("build-status", "status", status("main", branchForRun(runId)));
  await deliver("branchless-suite", "check_suite", checkSuite(null));
  await deliver("branchless-status", "status", status());
  assert.deepEqual(calls, ["build-run", "build-status", "branchless-suite", "branchless-status"].flatMap((id) => [`has ${id}`, `find ${headSha}`, `done ${id}`]));
});

test("every build signs in with PKCE, accepts any account, uses the identity once and revokes the OAuth token", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  const { fetcher, calls } = githubFixture((path) => path === "/user" ? json({ id: 432, login: "any-visitor", name: "Any Visitor" }) : undefined);
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 202);
  const { runId: started } = await response.json() as { runId: string };
  assert.equal(calls.find((call) => call.path === "https://github.com/login/oauth/access_token")?.body?.code_verifier, signIn.codeVerifier);
  assert.equal(calls.find((call) => call.path.startsWith("/applications/"))?.body?.access_token, "oauth-fixture");
  assert.equal(instance.readRun(started)?.account, "any-visitor");
  assert.equal(instance.readRun(started)?.coauthor, "Any Visitor <432+any-visitor@users.noreply.github.com>");
  assert.equal((await handleBuild(post("/api/build", { planToken: proposal.token, session: "old-session-ticket" }), env, fetcher)).status, 400);
  const denied = githubFixture((path) => path.includes("login/oauth") ? json({ error: "bad_verification_code" }) : undefined);
  const fresh = await issuePlan(env, plan);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: fresh.token }), env, denied.fetcher)).status, 401);
  assert.equal(denied.calls.some((call) => call.path.endsWith("/dispatches") || call.path.endsWith("/git/ref/heads/main")), false);
});

test("dispatch sends only run identifiers to the build workflow and accepts a late OIDC upload after uncertain dispatch", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  let dispatch: { auth: string | null; body: unknown } | undefined;
  const fixture = githubFixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === `https://api.github.com/repos/${BUILD_REPO}/dispatches`) {
      dispatch = { auth: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) };
      throw new Error("Network response was lost");
    }
    return fixture.fetcher(input, init);
  };
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 202);
  const result = await response.json() as { runId: string; statusToken: string };
  assert.equal(dispatch?.auth, "Bearer installation-fixture");
  assert.deepEqual(dispatch?.body, { event_type: "build", client_payload: { runId: result.runId, planCommitSha: FIXTURE_PLAN_SHA, baseSha: sha, prNumber: 12, callbackOrigin } });
  assert.equal(instance.readRun(result.runId)?.state.phase, "triggered");
  assert.match(instance.readRun(result.runId)?.state.reason ?? "", /build workflow result is unknown/);
  assert.equal("uploadToken" in result, false);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${result.runId}`, { message: "Working" }, await oidc.token(buildWorkflowAudience(callbackOrigin, result.runId))), env, oidc.serve())).status, 200);
  const replay = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(replay.status, 202);
  assert.equal((await replay.json() as { runId: string }).runId, result.runId);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/pulls")).length, 1);
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env);
  assert.equal(status.status, 200);
  assert.equal((await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}&token=${result.statusToken}`), env)).status, 401);
});

test("workflow endpoints accept only a build workflow OIDC token whose audience binds the run's callback origin and runId", async () => {
  const { env, instance } = coordinator();
  const { objects, bucket } = imageBucket();
  const withImages = { ...env, IMAGES: bucket } as Env;
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const fixture = githubFixture();
  const forger = await createActionsOidcFixture();
  const endpoints = (token?: string) => [
    handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Working" }, token), env, fixture.fetcher),
    handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home", content: png(7) }, token), withImages, fixture.fetcher),
    handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), env, fixture.fetcher),
  ];
  for (const token of [undefined, await uploadTokenForRun(runId, buildSecret), await oidc.token("https://ai.test"), await oidc.token(callbackOrigin), await oidc.token(buildWorkflowAudience(callbackOrigin, "b".repeat(32))), await oidc.token(buildWorkflowAudience(callbackOrigin, runId), { workflow_ref: `${BUILD_REPO}/.github/workflows/claude.yml@refs/heads/main` }), await forger.token(buildWorkflowAudience(callbackOrigin, runId))]) {
    for (const response of await Promise.all(endpoints(token))) assert.equal(response.status, 401);
  }
  const unknownRun = await handleBuildProgress(post(`/api/build/progress?runId=${"b".repeat(32)}`, { message: "Working" }, await oidc.token(buildWorkflowAudience(callbackOrigin, runId))), env, fixture.fetcher);
  assert.equal(unknownRun.status, 401);
  assert.equal(instance.readRun(runId)?.uploadUsed, false);
  assert.equal(instance.readRun(runId)?.state.phase, "triggered");
  assert.equal(objects.size, 0);
  assert.equal(fixture.calls.length, 0);
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Working" }, token), env, fixture.fetcher)).status, 200);
  assert.equal(instance.readRun(runId)?.state.progress, "Working");
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home", content: png(7) }, token), withImages, fixture.fetcher)).status, 201);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), withImages, fixture.fetcher)).status, 201);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), withImages, fixture.fetcher)).status, 401);
});

test("runs without a callback origin refuse workflow tokens and an unavailable key set leaves the upload unclaimed", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await stored(), "legacy", Date.now() + 60_000);
  const fetcher = oidc.serve(async () => assert.fail("No GitHub request without workflow authorization"));
  for (const audience of [callbackOrigin, buildWorkflowAudience(callbackOrigin, runId), "undefined", ""]) {
    assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, await oidc.token(audience)), env, fetcher)).status, 401);
  }
  assert.equal(instance.readRun(runId)?.uploadUsed, false);
  const current = coordinator();
  current.instance.reserveRun(await dispatched(), "current", Date.now() + 60_000);
  const keys = await createActionsOidcFixture();
  keys.jwksStatus = 502;
  const unavailable = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, await keys.token(buildWorkflowAudience(callbackOrigin, runId))), current.env, keys.serve());
  assert.equal(unavailable.status, 503);
  assert.equal(current.instance.readRun(runId)?.uploadUsed, false);
});
