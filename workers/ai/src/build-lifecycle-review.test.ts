import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun, type BuildFireResult, type BuildPlan, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { StoredRun } from "./build/coordinator.ts";
import { BuildPullRequestRejectedError, createBuildPullRequest, GithubBuildApi, reconcileBuild } from "./build/github.ts";
import { handleBuild, handleBuildStatus, handleBuildUpload, handleGithubWebhook } from "./build/handlers.ts";
import { issuePlan } from "./build/plan.ts";
import { hashToken, signBuildToken } from "./build/token.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
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
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: "local-review-fixture", GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_WEBHOOK_SECRET: "local-webhook-fixture", ROUTINE_FIRE_URL: "https://fixture.invalid/fire", ROUTINE_FIRE_TOKEN: "local-fire-fixture" } as unknown as Env;
  return { db, instance, env };
}

async function stored(): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now }, plan, account: "visitor", accountId: 1, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha, uploadHash: await hashToken(uploadToken), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
}

type GithubCall = { path: string; method: string; headers: Headers; body: Record<string, unknown> | null };
function githubFixture(override: (call: GithubCall) => Response | undefined = () => undefined) {
  const calls: GithubCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const call = { path: url.pathname + url.search, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null };
    calls.push(call);
    const response = override(call);
    if (response) return response;
    if (url.hostname === "fixture.invalid" && call.path === "/fire") return Response.json({ claude_code_session_url: "https://fixture.invalid/session" });
    assert.equal(url.hostname, "api.github.com");
    if (call.path.endsWith("/installation")) return Response.json({ id: 1 });
    if (call.path === "/app/installations/1/access_tokens") return Response.json({ token: "installation-fixture" });
    if (call.path.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: baseSha } });
    if (call.path.includes("/compare/")) return Response.json({ status: "ahead", merge_base_commit: { sha: baseSha } });
    if (call.path.endsWith(`/git/commits/${baseSha}`)) return Response.json({ tree: { sha: treeSha } });
    if (call.path.includes("/git/trees/") && call.path.includes("recursive=1")) return Response.json({ truncated: false, tree: [] });
    if (["/git/blobs", "/git/trees", "/git/commits"].some((path) => call.path.endsWith(path))) return Response.json({ sha: headSha }, { status: 201 });
    if (call.path.endsWith("/git/refs")) return Response.json({ ref: `refs/heads/${branchForRun(runId)}` }, { status: 201 });
    if (call.method === "DELETE" && call.path.includes("/git/refs/heads/")) return new Response(null, { status: 204 });
    if (call.path.endsWith("/pulls")) return Response.json({ number: 12, html_url: `https://github.com/${BUILD_REPO}/pull/12`, head: { sha: headSha } }, { status: 201 });
    assert.fail(`Unexpected fixture request: ${call.method} ${call.path}`);
  };
  return { calls, fetcher };
}

test("build reads main with a read-only installation token before consuming the plan and quota", async (t) => {
  const { env, instance, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const session = await signBuildToken({ kind: "session", account: "visitor", userId: 1, name: "Visitor", expiresAt: Date.now() + 60_000 }, env.BUILD_SESSION_SECRET!);
  const fixture = githubFixture((call) => {
    if (!call.path.endsWith("/git/ref/heads/main")) return;
    assert.equal(call.headers.get("Authorization"), "Bearer installation-fixture");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_records WHERE key LIKE 'plan:%'").get()?.n, 0);
    return Response.json({ object: { sha: baseSha } });
  });
  const response = await handleBuild(post("/api/build", { session, planToken: proposal.token }), env, fixture.fetcher);
  assert.equal(response.status, 202);
  const result = await response.json() as BuildFireResult;
  assert.equal(instance.readRun(result.runId)?.baseSha, baseSha);
  assert.deepEqual(fixture.calls.find((call) => call.path.endsWith("/access_tokens"))?.body?.permissions, { contents: "read", pull_requests: "read", issues: "read" });
  assert.equal(fixture.calls.filter((call) => call.path === "/fire").length, 1);
});

test("main lookup failure leaves the signed plan and build quota available for retry", async (t) => {
  const { env, db } = coordinator();
  t.after(() => db.close());
  const proposal = await issuePlan(env, plan);
  const session = await signBuildToken({ kind: "session", account: "visitor", userId: 1, name: null, expiresAt: Date.now() + 60_000 }, env.BUILD_SESSION_SECRET!);
  const fixture = githubFixture((call) => call.path.endsWith("/git/ref/heads/main") ? Response.json({}, { status: 403 }) : undefined);
  assert.equal((await handleBuild(post("/api/build", { session, planToken: proposal.token }), env, fixture.fetcher)).status, 502);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_hits WHERE kind = 'fire'").get()?.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM build_records WHERE key LIKE 'plan:%' OR key LIKE 'run:%'").get()?.n, 0);
  assert.equal(fixture.calls.some((call) => call.path === "/fire"), false);
  assert.equal((await handleBuild(post("/api/build", { session, planToken: proposal.token }), env, githubFixture().fetcher)).status, 202);
});

test("publishing opens a regular PR, removes supplied coauthors and neutralizes body mentions", async () => {
  const run = await stored();
  run.plan = { ...plan, spec: "Ask @someone and \\@another", acceptance: ["Review by @team/name"], paths: ["src/@scope/card.tsx"] };
  const fixture = githubFixture();
  await createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, { ...upload, message: "feat: card\r\n\r\nCo-authored-by: Forged <forged@example.test>\n  co-AUTHORED-by: Other <other@example.test>\nKeep this detail." }, treeSha);
  const message = String(fixture.calls.find((call) => call.path.endsWith("/git/commits"))?.body?.message);
  assert.equal(message, `feat: card\n\nKeep this detail.\n\nCo-authored-by: ${run.coauthor}`);
  const pr = fixture.calls.find((call) => call.path.endsWith("/pulls"))?.body;
  assert.equal(pr?.draft, false);
  assert.doesNotMatch(String(pr?.body), /@[A-Za-z0-9]/);
  assert.match(String(pr?.body), /@\u200bsomeone/);
  assert.match(String(pr?.body), /@\u200bteam\/name/);
});

for (const status of [400, 401, 403, 422, 429]) {
  test(`PR rejection ${status} deletes the created branch and accepts GitHub's empty 204 response`, async () => {
    const run = await stored();
    const fixture = githubFixture((call) => call.path.endsWith("/pulls") ? Response.json({}, { status }) : undefined);
    await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", fixture.fetcher), run, upload, treeSha), (error) => error instanceof BuildPullRequestRejectedError && /branch was removed/.test(error.message));
    assert.equal(fixture.calls.at(-1)?.method, "DELETE");
    assert.equal(fixture.calls.at(-1)?.path, `/repos/${BUILD_REPO}/git/refs/heads/${run.state.branch}`);
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

test("a PR request timeout preserves the branch while a failed cleanup reports its distinct result", async () => {
  const run = await stored();
  const timeout = githubFixture((call) => { if (call.path.endsWith("/pulls")) throw new DOMException("Timed out", "TimeoutError"); return undefined; });
  await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", timeout.fetcher), run, upload, treeSha), /Timed out/);
  assert.equal(timeout.calls.some((call) => call.method === "DELETE"), false);
  const denied = githubFixture((call) => call.path.endsWith("/pulls") || call.method === "DELETE" ? Response.json({}, { status: 422 }) : undefined);
  await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", denied.fetcher), run, upload, treeSha), /branch could not be removed/);
});

test("upload rejection records confirmed PR failure and branch removal for the card", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await stored(), "upload-plan", Date.now() + 60_000);
  const fixture = githubFixture((call) => call.path.endsWith("/pulls") ? Response.json({}, { status: 422 }) : undefined);
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), env, fixture.fetcher);
  assert.equal(response.status, 502);
  assert.equal(instance.readRun(runId)?.state.phase, "failed");
  assert.match(instance.readRun(runId)?.state.reason ?? "", /branch was removed/);
});

test("uploads outside approved plan paths are blocked with the rejected path and no GitHub request", async (t) => {
  const { instance, env, db } = coordinator();
  t.after(() => db.close());
  instance.reserveRun(await stored(), "scope-plan", Date.now() + 60_000);
  const denied: typeof fetch = async () => assert.fail("Unapproved paths must be rejected before GitHub access");
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, { ...upload, files: [{ ...upload.files[0], path: "src/lib/unplanned.ts" }] }, uploadToken), env, denied);
  assert.equal(response.status, 400);
  assert.equal(instance.readRun(runId)?.state.phase, "blocked");
  assert.match(instance.readRun(runId)?.state.reason ?? "", /src\/lib\/unplanned\.ts.*outside the approved plan paths/);
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
