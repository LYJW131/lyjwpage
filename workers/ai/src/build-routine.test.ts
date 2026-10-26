import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_DESIGN_LIMITS, BUILD_PLAN_TTL_MS, BUILD_QUOTA, BUILD_TIMEOUT_MS, BUILD_UPLOAD_LIMITS } from "@shared/build-routine";
import { signBuildToken, verifyBuildToken, hashToken, decodeBase64url, uploadTokenForRun } from "./build/token.ts";
import { allowedBuildPath, parseBuildPlan, parseBuildUpload } from "./build/validation.ts";
import { githubAppJwt } from "./build/github.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { consumePlan, issuePlan } from "./build/plan.ts";
import { callbackOrigin, coordinator, dispatched, githubFixture, handleBuildProgress, handleBuildUpload, headSha, oidc, plan, post, privateKeys, privatePem, runId, sha, stored, upload } from "./build/testing/routine-fixture.ts";

for (const path of [".github/workflows/ci.yml", ".claude/settings.json", "AGENTS.md", "src/AGENTS.md", "CLAUDE.md", "docs/CLAUDE.md", "package.json", "src/package.json", "workers/ai/package.json", "pnpm-lock.yaml", "src/pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "src/.npmrc", "scripts/foo.test.ts", "workers/ai/scripts/foo.test.ts", "workers/ai/wrangler.toml", "workers/ai/src/wrangler.test.toml", "src/wrangler.jsonc", "src/wrangler.preview.json", "next.config.ts", "src/next.config.mjs", "src/vite.config.ts", "src/react-router.config.ts", "reporters/foo.test.ts", ".gitmodules", "src/.gitmodules", "src/../package.json", "/src/a.ts", "src//a.ts", "src\\a.ts", "src/%2e%2e/package.json", "src/.git/config"]) {
  test(`upload path denies ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }));
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }));
  });
}

test("allowed paths cover source, docs, assets, worker source and tests", () => {
  for (const path of ["src/app/[slug]/page.tsx", "public/photo.png", "docs/layout.md", "shared/types.ts", "workers/ai/src/tools/a.ts", "src/tests/route.test.ts"]) assert.equal(allowedBuildPath(path), true);
});

test("plans validate all fields and protected paths in the paths list", () => {
  assert.deepEqual(parseBuildPlan(plan), plan);
  for (const bad of [{ ...plan, paths: [".github/workflows/test.yml"] }, { ...plan, paths: ["wrangler.toml"] }, { ...plan, paths: [] }, { ...plan, title: "a".repeat(101) }]) assert.equal(parseBuildPlan(bad), null);
});

test("upload blocks special modes, duplicate paths, malformed encoding and byte limits", () => {
  for (const mode of ["120000", "160000", "040000"]) assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], mode }] }));
  assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], content: "%%%" }] }));
  assert.throws(() => parseBuildUpload({ ...upload, deletions: [upload.files[0].path] }));
  assert.throws(() => parseBuildUpload({ ...upload, files: Array.from({ length: 81 }, (_, index) => ({ ...upload.files[0], path: `src/${index}.ts` })) }));
  const content = Buffer.alloc(BUILD_UPLOAD_LIMITS.fileBytes + 1).toString("base64");
  assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], content }] }));
  const large = Buffer.alloc(BUILD_UPLOAD_LIMITS.fileBytes).toString("base64");
  assert.throws(() => parseBuildUpload({ ...upload, files: Array.from({ length: 5 }, (_, index) => ({ ...upload.files[0], path: `src/${index}.ts`, content: large })) }));
});

test("signed capabilities enforce integrity, purpose and expiry", async () => {
  const payload = { kind: "plan", expiresAt: Date.now() + 1000, id: "test" };
  const token = await signBuildToken(payload, "secret");
  assert.deepEqual(await verifyBuildToken(token, "secret", "plan"), payload);
  assert.equal(await verifyBuildToken(`${token}x`, "secret", "plan"), null);
  assert.equal(await verifyBuildToken(token, "different", "plan"), null);
  assert.equal(await verifyBuildToken(token, "secret", "session"), null);
  assert.equal(await verifyBuildToken(token, "secret", "plan", payload.expiresAt), null);
});

test("upload capabilities recover after preparation interruption and remain bound to one run and secret", async () => {
  const capability = await uploadTokenForRun(runId, "secret");
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await uploadTokenForRun(runId, "secret"), capability);
  assert.notEqual(await uploadTokenForRun("b".repeat(32), "secret"), capability);
  assert.notEqual(await uploadTokenForRun(runId, "rotated-secret"), capability);
  assert.notEqual(await hashToken(capability), capability);
});

test("design sessions count 12 turns, expire and cap global starts", (t) => {
  const { instance } = coordinator();
  assert.equal(instance.createDesign("first", Date.now() + BUILD_DESIGN_LIMITS.ttlMs), true);
  for (let n = 0; n < 12; n += 1) assert.deepEqual(instance.admitDesign("first"), { status: "ok", remaining: 11 - n });
  assert.deepEqual(instance.admitDesign("first"), { status: "exhausted", remaining: 0 });
  for (let n = 1; n < BUILD_DESIGN_LIMITS.everyone; n += 1) assert.equal(instance.createDesign(`next-${n}`, Date.now() + BUILD_DESIGN_LIMITS.ttlMs), true);
  assert.equal(instance.createDesign("overflow", Date.now() + BUILD_DESIGN_LIMITS.ttlMs), false);
  const later = Date.now() + BUILD_DESIGN_LIMITS.ttlMs + 1;
  t.mock.method(Date, "now", () => later);
  assert.deepEqual(instance.admitDesign("first"), { status: "expired", remaining: 0 });
});

test("plans are single use and expire", async (t) => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  assert.deepEqual(await consumePlan(env, proposal.token), plan);
  assert.equal(await consumePlan(env, proposal.token), null);
  const payload = await verifyBuildToken<{ kind: string; expiresAt: number; id: string }>(proposal.token, env.BUILD_SESSION_SECRET!, "plan");
  assert.equal(instance.reserveRun(await stored(), payload!.id, payload!.expiresAt), "used");
  const expiring = await issuePlan(env, plan);
  const later = Date.now() + BUILD_PLAN_TTL_MS + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(await consumePlan(env, expiring.token), null);
});

test("build quotas atomically cap accounts and the site without consuming denied plans", async () => {
  const { instance } = coordinator();
  for (let n = 0; n < BUILD_QUOTA.fire.everyone; n += 1) {
    const id = n.toString(16).padStart(32, "0");
    assert.equal(instance.reserveRun(await stored(id, `user-${Math.floor(n / 3)}`), id, Date.now() + 60_000), "ok");
    if (n === 2) assert.equal(instance.reserveRun(await stored("f".repeat(32), "user-0"), "unconsumed", Date.now() + 60_000), "account");
  }
  assert.equal(instance.claimPlan("unconsumed", Date.now() + 60_000), true);
  assert.equal(instance.reserveRun(await stored("e".repeat(32), "new-user"), "site-overflow", Date.now() + 60_000), "site");
});

test("a blocked report consumes the upload token and stops the run", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  const fetcher = oidc.serve();
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "x".repeat(601), blocked: true }, token), env, fetcher)).status, 400);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Plan needs shared/collector.ts", blocked: true }, token), env, fetcher)).status, 200);
  const run = instance.readRun(runId)!;
  assert.equal(run.state.phase, "blocked");
  assert.equal(run.uploadUsed, true);
  assert.match(run.state.reason ?? "", /shared\/collector\.ts/);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Still working" }, token), env, fetcher)).status, 401);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), env, githubFixture().fetcher)).status, 401);
});

test("upload claim is atomic, progress cannot consume it and timeout is unknown", async (t) => {
  const { instance } = coordinator();
  const run = await dispatched();
  assert.equal(instance.reserveRun(run, "p", Date.now() + 60_000), "ok");
  assert.equal(instance.claimUpload(runId, "wrong"), null);
  assert.equal(instance.progress(runId, run.uploadHash, "Testing"), true);
  assert.equal(instance.claimUpload(runId, run.uploadHash)?.state.phase, "uploaded");
  assert.equal(instance.claimUpload(runId, run.uploadHash), null);
  assert.equal(instance.progress(runId, run.uploadHash, "Done"), false);
  const second = await dispatched("d".repeat(32));
  instance.reserveRun(second, "p2", Date.now() + 60_000);
  const later = Date.now() + BUILD_TIMEOUT_MS + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(instance.readRun(second.state.runId)?.state.phase, "timeout");
  assert.match(instance.readRun(second.state.runId)?.state.reason ?? "", /unknown/);
  assert.equal(instance.claimUpload(second.state.runId, second.uploadHash), null);
});

test("state cursors reject old events, reopening works and a new head resets check results", async () => {
  const { instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  instance.updateRun(runId, { phase: "pr_open", githubUpdatedAt: 10, pr: { number: 1, url: "https://github.com/LYJW131/lyjwpage/pull/1", headSha: sha }, ci: { state: "success", updatedAt: 10 } });
  instance.updateRun(runId, { phase: "closed", githubUpdatedAt: 20 });
  assert.equal(instance.updateRun(runId, { phase: "pr_open", githubUpdatedAt: 15 })?.phase, "closed");
  assert.equal(instance.updateRun(runId, { phase: "pr_open", githubUpdatedAt: 30 })?.phase, "pr_open");
  assert.equal(instance.updateRun(runId, { pr: { number: 1, url: "https://github.com/LYJW131/lyjwpage/pull/1", headSha }, githubUpdatedAt: 40 })?.ci?.state, "unknown");
  instance.updateRun(runId, { phase: "merged", githubUpdatedAt: 50 });
  assert.equal(instance.updateRun(runId, { phase: "pr_open", githubUpdatedAt: 60 })?.phase, "merged");
});

test("GitHub JWT supports PKCS8 and GitHub PKCS1 PEM with verifiable RS256 signatures", async () => {
  const publicKey = await crypto.subtle.importKey("spki", privateKeys.publicKey.export({ format: "der", type: "spki" }), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  for (const pem of [privatePem, privateKeys.privateKey.export({ format: "pem", type: "pkcs1" }).toString()]) {
    const jwt = await githubAppJwt(pem, 1_700_000_000_000);
    const [header, body, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    assert.equal(claims.iat, 1_699_999_940);
    assert.equal(claims.exp, 1_700_000_540);
    assert.ok(claims.iss);
    assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodeBase64url(signature), new TextEncoder().encode(`${header}.${body}`)), true);
  }
});
