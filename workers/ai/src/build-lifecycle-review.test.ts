import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_REPO, BUILD_TIMEOUT_MS, BUILD_UPLOAD_LIMITS, branchForRun, type BuildFireResult, type BuildPlan, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { StoredRun } from "./build/coordinator.ts";
import { BuildPullRequestRejectedError, createBuildPullRequest as publishBuild, prepareBuildPullRequest, validateBuildBase, GithubBuildApi, reconcileBuild } from "./build/github.ts";
import { buildGithubFixture, FIXTURE_PLAN_SHA } from "./build/testing/github-fixture.ts";
import { issuePlan } from "./build/plan.ts";
import { hashToken, signBuildToken } from "./build/token.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { handleBuild, handleBuildStatus, handleBuildUpload, handleGithubWebhook } = await import("./build/handlers.ts");
const { BuildCoordinator } = await import("./build/coordinator.ts");
const plan: BuildPlan = { title: "Improve the card", spec: "Improve the public card.", acceptance: ["The card is readable."], paths: ["src/components/card.tsx"] };
const baseSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const headSha = "c".repeat(40);
const runId = "d".repeat(32);
const uploadToken = "e".repeat(64);
const privatePem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const upload: BuildUpload = { baseSha, message: "feat: improve card", files: [{ path: plan.paths[0], mode: "100644", content: btoa("export const card = true;") }], deletions: [] };

function coordinator() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const statement = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const instance = new BuildCoordinator({ storage: { sql, transactionSync } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: "local-review-fixture", GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_WEBHOOK_SECRET: "local-webhook-fixture", ROUTINE_FIRE_URL: "https://fixture.invalid/fire", ROUTINE_FIRE_TOKEN: "local-fire-fixture", GITHUB_APP_CLIENT_SECRET: "local-oauth-fixture" } as unknown as Env;
  return { db, instance, env };
}

const sessionUrl = "https://claude.ai/code/session_01Fixture";
const signIn = { code: "github-code", codeVerifier: "a".repeat(43) };

async function stored(): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now }, plan, account: "visitor", accountId: 1, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha, uploadHash: await hashToken(uploadToken), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
}

type GithubCall = { path: string; method: string; headers: Headers; body: Record<string, unknown> | null };
function githubFixture(override: (call: GithubCall) => Response | undefined = () => undefined) {
  return buildGithubFixture({ runId, baseSha, baseTree: treeSha, headSha, override });
}

async function createBuildPullRequest(api: GithubBuildApi, run: StoredRun, changed: BuildUpload, validatedBaseTree?: string) {
  const baseTree = validatedBaseTree ?? await validateBuildBase(api, run, changed);
  const prepared = await prepareBuildPullRequest(api, run);
  run.planCommitSha = prepared.planCommitSha;
  run.state.pr = prepared.pr;
  return publishBuild(api, run, changed, baseTree, async (sha, body) => {
    run.implementationHeadSha = sha;
    run.publicationBody = body;
  });
}

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
  assert.equal(fixture.calls.filter((call) => call.path === "/fire").length, 1);
});

test("main lookup failure leaves the signed plan and build quota available for retry", async (t) => {
  const { env, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture((call) => call.path.endsWith("/git/ref/heads/main") ? Response.json({}, { status: 403 }) : undefined);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).status, 502);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_records WHERE key LIKE 'plan:%' OR key LIKE 'run:%'").get()?.n, 0);
  assert.equal(fixture.calls.some((call) => call.path === "/fire"), false);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, githubFixture().fetcher)).status, 202);
});

for (const useEgress of [true, false]) {
  test(`build fire ${useEgress ? "uses Anthropic egress without routing GitHub through it" : "uses the injected fetcher when Anthropic egress is absent"}`, async (t) => {
    const { env, instance, db } = coordinator();
    t.after(() => db.close());
    env.ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/fixture/fire";
    const egressRequests: Request[] = [];
    if (useEgress) {
      env.ANTHROPIC_EGRESS = {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async (request: Request) => {
          egressRequests.push(request);
          return Response.json({ claude_code_session_url: sessionUrl });
        } }),
      } as unknown as Env["ANTHROPIC_EGRESS"];
    }
    const directRequests: Request[] = [];
    const github = githubFixture();
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      directRequests.push(request);
      if (request.url === env.ROUTINE_FIRE_URL) return Response.json({ claude_code_session_url: sessionUrl });
      return github.fetcher(input, init);
    };
    const abort = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => abort.signal);
    const proposal = await issuePlan(env, plan);
    const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
    assert.equal(response.status, 202);
    const result = await response.json() as BuildFireResult;
    assert.equal(instance.readRun(result.runId)?.state.phase, "triggered");
    assert.equal(instance.readRun(result.runId)?.state.reason, undefined);
    assert.equal(instance.readRun(result.runId)?.sessionUrl, sessionUrl);
    assert.deepEqual(egressRequests.map((request) => request.url), useEgress ? [env.ROUTINE_FIRE_URL] : []);
    const externalHosts = directRequests.map((request) => new URL(request.url).hostname);
    assert.equal(externalHosts[0], "github.com");
    assert.equal(externalHosts.filter((host) => host === "api.anthropic.com").length, useEgress ? 0 : 1);
    assert.ok(externalHosts.slice(1, useEgress ? undefined : -1).every((host) => host === "api.github.com"));
    const prepared = instance.readRun(result.runId)!;
    assert.equal(prepared.state.pr?.draft, true);
    assert.equal(prepared.planCommitSha, FIXTURE_PLAN_SHA);
    assert.ok(github.calls.some((call) => call.path.endsWith("/git/ref/heads/main")));
    const fire = useEgress ? egressRequests[0] : directRequests.at(-1)!;
    assert.equal(fire.url, env.ROUTINE_FIRE_URL);
    assert.equal(fire.method, "POST");
    assert.equal(fire.headers.get("Authorization"), `Bearer ${env.ROUTINE_FIRE_TOKEN}`);
    assert.equal(fire.headers.get("anthropic-version"), "2023-06-01");
    assert.equal(fire.headers.get("Content-Type"), "application/json");
    const payload = JSON.parse((await fire.json() as { text: string }).text);
    assert.deepEqual(payload.plan, plan);
    assert.equal(payload.runId, result.runId);
    assert.equal(payload.baseSha, baseSha);
    abort.abort();
    assert.equal(fire.signal.aborted, true);
  });
}

test("publishing keeps the prepared PR draft, replaces supplied trailers and neutralizes body mentions", async () => {
  const run = { ...await stored(), sessionUrl };
  run.plan = { ...plan, spec: "Ask @someone and \\@another", acceptance: ["Review by @team/name"], paths: ["src/@scope/card.tsx"] };
  const fixture = githubFixture();
  await createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, { ...upload, message: "feat: card\r\n\r\nCo-authored-by: Forged <forged@example.test>\n  co-AUTHORED-by: Other <other@example.test>\nClaude-Session: https://claude.ai/code/session_forged\nKeep this detail." }, treeSha);
  const message = String(fixture.calls.filter((call) => call.path.endsWith("/git/commits") && call.method === "POST").at(-1)?.body?.message);
  assert.equal(message, `feat: card\n\nKeep this detail.\n\nCo-authored-by: ${run.coauthor}\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: ${sessionUrl}`);
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

test("a legacy upload records draft PR rejection and preserves its plan branch for inspection", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await stored(), "upload-plan", Date.now() + 60_000);
  const fixture = githubFixture((call) => call.path.endsWith("/pulls") ? Response.json({}, { status: 422 }) : undefined);
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), env, fixture.fetcher);
  assert.equal(response.status, 502);
  assert.equal(instance.readRun(runId)?.state.phase, "failed");
  assert.match(instance.readRun(runId)?.state.reason ?? "", /branch was preserved/);
});

test("uploads with too many paths outside the plan are blocked with the paths and no GitHub request", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await stored(), "scope-plan", Date.now() + 60_000);
  const denied: typeof fetch = async () => assert.fail("Unapproved paths must be rejected before GitHub access");
  const unplanned = Array.from({ length: BUILD_UPLOAD_LIMITS.outsidePlanFiles + 1 }, (_, index) => ({ ...upload.files[0], path: `src/lib/unplanned-${index}.ts` }));
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, { ...upload, files: unplanned }, uploadToken), env, denied);
  assert.equal(response.status, 400);
  assert.equal(instance.readRun(runId)?.state.phase, "blocked");
  assert.match(instance.readRun(runId)?.state.reason ?? "", /outside the approved plan paths.*src\/lib\/unplanned-0\.ts/);
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

test("the draft link is returned while routine dispatch continues in the execution context", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  let finishFire!: () => void;
  const firePending = new Promise<void>((resolve) => { finishFire = resolve; });
  const jobs: Promise<unknown>[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === env.ROUTINE_FIRE_URL) {
      await firePending;
      return Response.json({ claude_code_session_url: sessionUrl });
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
  assert.equal(instance.readRun(result.runId)?.sessionUrl, undefined);
  assert.equal("uploadHash" in result.run!, false);
  finishFire();
  await Promise.all(jobs);
  assert.equal(instance.readRun(result.runId)?.sessionUrl, sessionUrl);
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
  assert.equal(fixture.calls.filter((call) => call.path === "/fire").length, 1);
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
  assert.match(result.run?.reason ?? "", /routine was not started/);
  assert.equal(fixture.refs.get(result.branch), FIXTURE_PLAN_SHA);
  assert.equal(fixture.calls.filter((call) => call.path === "/fire").length, 0);
  rejectPr = false;
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env, fixture.fetcher);
  const state = await status.json() as BuildRun;
  assert.equal(state.phase, "triggered");
  assert.equal(state.pr?.draft, true);
  assert.equal(state.ci?.state, "success");
  assert.equal(state.reason, undefined);
  assert.equal(fixture.calls.filter((call) => call.path === "/graphql").length, 0);
  assert.equal(fixture.calls.filter((call) => call.path === "/fire").length, 1);
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
  const fire = JSON.parse(String(fixture.calls.find((call) => call.path === "/fire")?.body?.text)) as { uploadToken: string };
  const changed: BuildUpload = { ...upload, files: [...upload.files, { path: "shared/fixture.ts", mode: "100644", content: btoa("export const fixture = true;") }] };
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, changed, fire.uploadToken), env, fixture.fetcher);
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
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, changed, fire.uploadToken), env, fixture.fetcher)).status, 401);
  assert.equal(JSON.stringify(state).includes(fire.uploadToken), false);
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
  const fire = JSON.parse(String(fixture.calls.find((call) => call.path === "/fire")?.body?.text)) as { uploadToken: string };
  const delayed = holdFinalPublicationRead(fixture, result.branch, loseResponse);
  t.after(delayed.release);
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, fire.uploadToken), env, delayed.fetcher);
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
  const fire = JSON.parse(String(fixture.calls.find((call) => call.path === "/fire")?.body?.text)) as { uploadToken: string };
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
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, fire.uploadToken), delayedEnv, fixture.fetcher);
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
  const fire = JSON.parse(String(fixture.calls.find((call) => call.path === "/fire")?.body?.text)) as { uploadToken: string };
  const delayed = holdFinalPublicationRead(fixture, result.branch, false);
  t.after(delayed.release);
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, fire.uploadToken), env, delayed.fetcher);
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

test("webhook-confirmed publication requests reviews once through status while the upload response is lost", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  env.CODEX_REVIEW_GITHUB_TOKEN = "owner-fixture";
  const proposal = await issuePlan(env, plan);
  const fixture = githubFixture();
  const result = await (await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fixture.fetcher)).json() as BuildFireResult;
  const fire = JSON.parse(String(fixture.calls.find((call) => call.path === "/fire")?.body?.text)) as { uploadToken: string };
  const delayed = holdFinalPublicationRead(fixture, result.branch, true);
  t.after(delayed.release);
  const uploading = handleBuildUpload(post(`/api/build/upload?runId=${result.runId}`, upload, fire.uploadToken), env, delayed.fetcher);
  await delayed.held;
  const pullRequest = await (await fixture.fetcher(`https://api.github.com/repos/${BUILD_REPO}/pulls/12`)).json();
  const body = JSON.stringify({ repository: { full_name: BUILD_REPO }, pull_request: pullRequest });
  const signature = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET!).update(body).digest("hex")}`;
  assert.equal((await handleGithubWebhook(new Request("https://api.test/api/build/webhook", { method: "POST", body, headers: { "X-Hub-Signature-256": signature, "X-GitHub-Delivery": "published-before-response", "X-GitHub-Event": "pull_request" } }), env)).status, 200);
  assert.equal(instance.readRun(result.runId)?.state.phase, "pr_open");
  assert.equal(instance.readRun(result.runId)?.reviewRequested, undefined);
  const statusRequest = () => new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } });
  assert.equal((await handleBuildStatus(statusRequest(), env, fixture.fetcher)).status, 200);
  assert.equal(instance.readRun(result.runId)?.reviewRequested, true);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/comments")).length, 2);
  assert.equal((await handleBuildStatus(statusRequest(), env, fixture.fetcher)).status, 200);
  delayed.release();
  assert.equal((await uploading).status, 201);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/comments")).length, 2);
  assert.equal(instance.readRun(result.runId)?.state.phase, "pr_open");
});
