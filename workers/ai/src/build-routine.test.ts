import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_DESIGN_LIMITS, BUILD_ISSUE_LOOKUP_GRACE_MS, BUILD_PLAN_TTL_MS, buildIssueMarker, BUILD_SCREENSHOT_LIMITS, buildIssueBody, buildIssueUrl, planLanguage, visitorLanguage, BUILD_QUOTA, BUILD_REPO, BUILD_TIMEOUT_MS, BUILD_UPLOAD_LIMITS, branchForRun, type BuildPlan, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { StoredRun } from "./build/coordinator.ts";
import { signBuildToken, verifyBuildToken, hashToken, decodeBase64url, uploadTokenForRun } from "./build/token.ts";
import { allowedBuildPath, parseBuildPlan, parseBuildUpload } from "./build/validation.ts";
import { githubAppJwt, GithubBuildApi, assertMainAncestor, createBuildPullRequest as publishBuild, findPlanIssue, prepareBuildPullRequest, validateBuildBase, reconcileBuild } from "./build/github.ts";
import { verifyGithubWebhook, applyGithubWebhook } from "./build/webhook.ts";
import { buildGithubFixture, FIXTURE_PLAN_SHA, FIXTURE_PLAN_TREE } from "./build/testing/github-fixture.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { createActionsOidcFixture } from "./build/testing/actions-oidc.ts";
import { consumePlan, issuePlan } from "./build/plan.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { handleBuild, handleBuildIssue, handleBuildProgress, handleBuildScreenshot, handleBuildStatus, handleBuildUpload, handleGithubWebhook } = await import("./build/handlers.ts");
const { BuildCoordinator } = await import("./build/coordinator.ts");
const plan: BuildPlan = { title: "Improve the page", spec: "Improve the public layout.", acceptance: ["Mobile layout fits."], paths: ["src/card.tsx"] };
const sha = "a".repeat(40);
const treeSha = "b".repeat(40);
const headSha = "c".repeat(40);
const runId = "a".repeat(32);
const buildSecret = "test-build-secret";
const callbackOrigin = "https://api.test";
const oidc = await createActionsOidcFixture();
const privateKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const json = (value: unknown, status = 200) => Response.json(value, { status });
const signIn = { code: "github-code", codeVerifier: "a".repeat(43) };
const upload: BuildUpload = { baseSha: sha, message: "feat: improve the page", files: [{ path: "src/card.tsx", mode: "100644", content: btoa("export default true;") }], deletions: [] };

function coordinator() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const stmt = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const instance = new BuildCoordinator({ storage: { sql, transactionSync, getAlarm: async () => null, setAlarm: async () => undefined } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: buildSecret, GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_APP_CLIENT_SECRET: "oauth-fixture", GITHUB_WEBHOOK_SECRET: "webhook-fixture" } as unknown as Env;
  return { instance, env, db };
}
async function stored(id = runId, account = "visitor"): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId: id, branch: branchForRun(id), phase: "triggered", createdAt: now, updatedAt: now }, plan, account, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha: sha, uploadHash: await hashToken(await uploadTokenForRun(id, buildSecret)), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}
async function dispatched(id = runId): Promise<StoredRun> {
  const run = await stored(id);
  return { ...run, callbackOrigin, planCommitSha: FIXTURE_PLAN_SHA, dispatchAttempted: true, state: { ...run.state, pr: { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha: FIXTURE_PLAN_SHA, draft: true } } };
}
function post(path: string, body: unknown, token?: string) {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

for (const path of [".github/workflows/ci.yml", ".claude/settings.json", "AGENTS.md", "src/AGENTS.md", "CLAUDE.md", "docs/CLAUDE.md", "package.json", "src/package.json", "workers/ai/package.json", "pnpm-lock.yaml", "src/pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "src/.npmrc", "scripts/foo.test.ts", "workers/ai/scripts/foo.test.ts", "workers/ai/wrangler.toml", "workers/ai/src/wrangler.test.toml", "src/wrangler.jsonc", "src/wrangler.preview.json", "next.config.ts", "src/next.config.mjs", "src/vite.config.ts", "src/react-router.config.ts", "reporters/foo.test.ts", ".gitmodules", "src/.gitmodules", "src/../package.json", "/src/a.ts", "src//a.ts", "src\\a.ts", "src/%2e%2e/package.json", "src/.git/config"]) {
  test(`upload path denies ${path}`, () => {
    assert.equal(allowedBuildPath(path), false);
    assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], path }] }, [path]));
    assert.throws(() => parseBuildUpload({ ...upload, files: [], deletions: [path] }, [path]));
  });
}

test("allowed paths cover source, docs, assets, worker source and tests", () => {
  for (const path of ["src/app/[slug]/page.tsx", "public/photo.png", "docs/design.md", "shared/types.ts", "workers/ai/src/tools/a.ts", "src/tests/route.test.ts"]) assert.equal(allowedBuildPath(path), true);
});

test("plans validate all fields and protected paths in prose", () => {
  assert.deepEqual(parseBuildPlan(plan), plan);
  for (const bad of [{ ...plan, paths: [".github/workflows/test.yml"] }, { ...plan, spec: "Please change package.json" }, { ...plan, acceptance: ["Update wrangler.toml"] }, { ...plan, paths: [] }, { ...plan, title: "a".repeat(101) }]) assert.equal(parseBuildPlan(bad), null);
});

test("upload blocks special modes, duplicate paths, malformed encoding and byte limits", () => {
  for (const mode of ["120000", "160000", "040000"]) assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], mode }] }, plan.paths));
  assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], content: "%%%" }] }, plan.paths));
  assert.throws(() => parseBuildUpload({ ...upload, deletions: [upload.files[0].path] }, plan.paths));
  assert.throws(() => parseBuildUpload({ ...upload, files: Array.from({ length: 81 }, (_, index) => ({ ...upload.files[0], path: `src/${index}.ts` })) }, ["src/"]));
  const content = Buffer.alloc(BUILD_UPLOAD_LIMITS.fileBytes + 1).toString("base64");
  assert.throws(() => parseBuildUpload({ ...upload, files: [{ ...upload.files[0], content }] }, plan.paths));
  const large = Buffer.alloc(BUILD_UPLOAD_LIMITS.fileBytes).toString("base64");
  assert.throws(() => parseBuildUpload({ ...upload, files: Array.from({ length: 5 }, (_, index) => ({ ...upload.files[0], path: `src/${index}.ts`, content: large })) }, ["src/"]));
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

function githubFixture(extra: (path: string, body: Record<string, unknown> | null) => Response | undefined = () => undefined) {
  const calls: { path: string; method: string; body: Record<string, unknown> | null; auth?: string }[] = [];
  const fixture = buildGithubFixture({ runId, baseSha: sha, baseTree: treeSha, headSha, oidc, override: (call) => {
    const path = call.path === "/login/oauth/access_token" ? "https://github.com/login/oauth/access_token" : call.path;
    calls.push({ ...call, path });
    return extra(path, call.body);
  } });
  return { ...fixture, calls };
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

test("GitHub publishing preserves the plan tree and appends the implementation to the same draft PR", async () => {
  const { fetcher, calls } = githubFixture();
  const result = await createBuildPullRequest(new GithubBuildApi("fixture", fetcher), await stored(), upload);
  assert.equal(result.number, 12);
  assert.equal(result.draft, true);
  const trees = calls.filter((call) => call.path.endsWith("/git/trees") && call.method === "POST");
  assert.equal(trees[0].body?.base_tree, treeSha);
  assert.equal(trees[1].body?.base_tree, FIXTURE_PLAN_TREE);
  const commits = calls.filter((call) => call.path.endsWith("/git/commits") && call.method === "POST");
  assert.deepEqual(commits[0].body?.parents, [sha]);
  assert.deepEqual(commits[1].body?.parents, [FIXTURE_PLAN_SHA]);
  assert.match(String(commits[1].body?.message), /Co-authored-by: Visitor <1\+visitor@users.noreply.github.com>/);
  const creations = calls.filter((call) => call.path.endsWith("/pulls") && call.method === "POST");
  assert.equal(creations.length, 1);
  assert.equal(creations[0].body?.draft, true);
  assert.equal(creations[0].body?.base, "main");
  const patch = calls.find((call) => call.path.endsWith("/pulls/12") && call.method === "PATCH");
  assert.doesNotMatch(String(patch?.body?.body), /Review closely/);
  const extra = githubFixture();
  const extraFiles = [{ path: "src/lib/extra.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "shared/collector.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "workers/ai/README.md", mode: "100644" as const, content: btoa("# ai") }];
  await createBuildPullRequest(new GithubBuildApi("fixture", extra.fetcher), await stored(), { ...upload, files: [...upload.files, ...extraFiles] });
  const patched = String(extra.calls.find((call) => call.path.endsWith("/pulls/12") && call.method === "PATCH")?.body?.body);
  assert.match(patched, /## Review closely/);
  assert.match(patched, /outside the plan, shared contract/);
  assert.match(patched, /documentation outside docs\//);
  assert.match(patched, /\[`src\/lib\/extra\.ts`\]\(https:\/\/github\.com\/LYJW131\/lyjwpage\/pull\/12\/files#diff-[0-9a-f]{64}\)/);
});

test("issue and PR labels follow the plan language", () => {
  const zh: BuildPlan = { title: "加一张原神卡片", spec: "在首页游戏区新增只读卡片，数据来自 workers/collector/src/jobs/genshin-profile.ts 与 shared/collector.ts。", acceptance: ["手机端 375px 单列显示"], paths: ["src/components/live/genshin-card.tsx"] };
  const ja: BuildPlan = { ...zh, title: "原神カードを追加する", spec: "ホームのゲーム欄に読み取り専用のカードを追加します。", acceptance: ["スマホでも一列で表示される"] };
  const en: BuildPlan = { ...plan, spec: "Show the song 星街すいせい GHOST in the card title when it is playing." };
  assert.deepEqual([planLanguage(zh), planLanguage(ja), planLanguage(plan), planLanguage(en)], ["zh", "ja", "en", "en"]);
  const pathHeavy: BuildPlan = { title: "统一构建进度", spec: "改 `src/components/live/agent-status-card.tsx` 与 workers/ai/src/chat/designer.ts 里的进度显示。", acceptance: ["`workers/ai/src/chat/designer.ts` 的进度文案一致"], paths: ["src/components/live/agent-status-card.tsx"] };
  assert.equal(planLanguage(pathHeavy), "zh", "repository paths and inline code do not outweigh the Chinese prose");
  assert.equal(visitorLanguage({ title: "回答完问题后自动折叠问题框" }), "zh", "a Chinese title with an English technical spec still shows Chinese copy to the visitor");
  assert.match(buildIssueBody(zh), /^## 想要什么\n[\s\S]*## 验收标准[\s\S]*## 涉及路径/);
  assert.match(buildIssueBody(ja), /## 受け入れ基準/);
  assert.match(buildIssueBody(plan), /## Acceptance criteria/);
  const issueUrl = new URL(buildIssueUrl(zh));
  assert.equal(issueUrl.origin, "https://github.com");
  assert.equal(issueUrl.pathname, `/${BUILD_REPO}/issues/new`);
  assert.equal(issueUrl.searchParams.get("template"), "improvement.yml");
  assert.equal(issueUrl.searchParams.get("title"), zh.title);
  assert.equal(issueUrl.searchParams.get("what"), zh.spec);
  assert.match(issueUrl.searchParams.get("acceptance") ?? "", /^- \[ \] 手机端 375px 单列显示$/);
  assert.equal(issueUrl.searchParams.get("paths"), "- `src/components/live/genshin-card.tsx`");
  assert.match(issueUrl.searchParams.get("context") ?? "", /提交自\[首页对话\][\s\S]*filed-from-homepage-chat/);
});

test("base must be an ancestor of main, with comparison in the correct direction", async () => {
  for (const status of ["behind", "diverged", "ahead"]) {
    const { fetcher } = githubFixture((path) => path.includes("/compare/") ? json({ status, merge_base_commit: { sha: status === "ahead" ? headSha : sha } }) : undefined);
    await assert.rejects(() => assertMainAncestor(new GithubBuildApi("fixture", fetcher), sha), /not in main history/);
  }
});

test("base tree validation prevents directory replacement, symlink traversal, submodules and truncated trees", async () => {
  for (const [path, type, mode, truncated] of [["src/card.tsx", "tree", "040000", false], ["src", "blob", "120000", false], ["src", "commit", "160000", false], ["src", "tree", "040000", true]] as const) {
    const { fetcher, calls } = githubFixture((url) => url.includes("recursive=1") ? json({ truncated, tree: [{ path, type, mode }] }) : undefined);
    await assert.rejects(() => createBuildPullRequest(new GithubBuildApi("fixture", fetcher), { ...({} as StoredRun), baseSha: sha }, upload));
    assert.equal(calls.some((call) => call.path.endsWith("/git/blobs")), false);
  }
});

test("upload rejection consumes the token, stores a safe reason and does no external writes", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const denied = oidc.serve(async () => assert.fail("No GitHub request on rejected uploads"));
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  const bad = { ...upload, files: [{ ...upload.files[0], path: ".github/workflows/evil.yml" }] };
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, bad, token), env, denied)).status, 400);
  assert.equal(instance.readRun(runId)?.state.phase, "blocked");
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), env, denied)).status, 401);
});

test("valid upload creates and returns a confirmed PR without secret fields", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), env, githubFixture().fetcher);
  assert.equal(response.status, 201);
  const body = await response.json() as BuildRun;
  assert.equal(body.phase, "pr_open");
  assert.equal(body.pr?.number, 12);
  const text = JSON.stringify(body);
  assert.equal(text.includes(token) || text.includes(await uploadTokenForRun(runId, buildSecret)), false);
  assert.equal("plan" in body, false);
});

const png = (seed: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed])]).toString("base64");
function imageBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = { async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) { objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType }); } };
  return { objects, bucket: bucket as unknown as R2Bucket };
}

test("screenshots need workflow authorization before upload, real image bytes and stay within the per-run limit", async () => {
  const { env, instance } = coordinator();
  const { objects, bucket } = imageBucket();
  const withImages = { ...env, IMAGES: bucket } as Env;
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const fetcher = oidc.serve();
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  const shot = (body: unknown, auth = token) => handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, body, auth), withImages, fetcher);
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home", content: png(0) }, token), env, fetcher)).status, 503);
  assert.equal((await shot({ caption: "Home", content: png(0) }, await oidc.token("https://other.test"))).status, 401);
  assert.equal((await shot({ caption: "Home", content: btoa("<svg onload=alert(1)>") })).status, 400);
  assert.equal((await shot({ caption: "x".repeat(BUILD_SCREENSHOT_LIMITS.captionChars + 1), content: png(0) })).status, 400);
  for (let n = 0; n < BUILD_SCREENSHOT_LIMITS.count; n += 1) assert.equal((await shot({ caption: `Home — 375px [x](https://evil.test) @owner ${n}`, content: png(n) })).status, 201);
  assert.equal((await shot({ caption: "One more", content: png(99) })).status, 409);
  assert.equal(objects.size, BUILD_SCREENSHOT_LIMITS.count);
  const [objectKey, object] = [...objects][0];
  assert.match(objectKey, /^[a-f0-9]{64}\.png$/);
  assert.equal(object.contentType, "image/png");
  assert.equal(instance.readRun(runId)?.screenshots?.[0].caption, "Home — 375px x (https evil.test) owner 0");
});

test("the App comments the screenshots on the opened PR, and screenshots close with the upload", async () => {
  const { env, instance } = coordinator();
  const { bucket } = imageBucket();
  const withImages = { ...env, IMAGES: bucket } as Env;
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  const { fetcher, calls } = githubFixture();
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home desktop", content: png(1) }, token), withImages, fetcher)).status, 201);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), withImages, fetcher)).status, 201);
  const comments = calls.filter((call) => call.path.endsWith("/issues/12/comments"));
  assert.equal(comments.length, 1);
  assert.equal(comments[0].auth, "Bearer installation-fixture");
  assert.match(String(comments[0].body?.body), /^## Screenshots\n[\s\S]*\*\*Home desktop\*\*\n\n!\[Home desktop\]\(https:\/\/lyjw\.me\/img\/[a-f0-9]{64}\.png\)$/);
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Late", content: png(2) }, token), withImages, fetcher)).status, 409);
  const plain = coordinator();
  plain.instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const quiet = githubFixture();
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), plain.env, quiet.fetcher)).status, 201);
  assert.equal(quiet.calls.some((call) => call.path.endsWith("/comments")), false);
});

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

test("reconciliation reports unavailable signals as unknown and paginates bot review comments", async () => {
  const old = await stored();
  old.state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  const fixture = githubFixture((path) => {
    if (path.endsWith("/pulls/12")) return json({ number: 12, html_url: old.state.pr!.url, head: { sha: headSha }, state: "open", merged: false, updated_at: new Date().toISOString() });
    if (path.includes("check-runs")) return json({}, 403);
    if (path.includes("/status?")) return json({}, 403);
    if (path.endsWith("comments?per_page=100&page=1")) return json(Array.from({ length: 100 }, () => ({ user: { login: "visitor" }, updated_at: "2026-01-01" })));
    if (path.endsWith("comments?per_page=100&page=2")) return json([{ user: { login: "claude[bot]" }, body: "Review suggests improvements.", html_url: "https://github.com/review", updated_at: "2026-10-10T00:00:00Z" }]);
    return undefined;
  });
  const state = await reconcileBuild(new GithubBuildApi("fixture", fixture.fetcher), old.state);
  assert.equal(state.ci?.state, "unknown");
  assert.equal(state.preview?.state, "unknown");
  assert.equal(state.review?.state, "Review suggests improvements.");
});

test("a stale reconciliation cannot attach old-head success to the newer head", async () => {
  const { instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  instance.updateRun(runId, { phase: "pr_open", pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha }, githubUpdatedAt: 30, ci: { state: "unknown", updatedAt: 30 } });
  const state = instance.updateRun(runId, { pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha: sha }, githubUpdatedAt: 20, ci: { state: "success", updatedAt: Date.now() } });
  assert.equal(state?.pr?.headSha, headSha);
  assert.equal(state?.ci?.state, "unknown");
});

test("CI requires complete results and explicit success conclusions", async () => {
  const state = (await stored()).state;
  state.pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  for (const [conclusion, count, expected] of [["startup_failure", 1, "failure"], ["stale", 1, "unknown"], ["new_undocumented_value", 1, "unknown"], ["success", 101, "unknown"], ["success", 1, "success"]] as const) {
    const fixture = githubFixture((path) => {
      if (path.endsWith("/pulls/12")) return json({ number: 12, html_url: state.pr!.url, head: { sha: headSha }, state: "open", merged: false, updated_at: new Date().toISOString() });
      if (path.includes("check-runs")) return json({ total_count: count, check_runs: [{ name: "tests", status: "completed", conclusion }] });
      if (path.includes("/status?")) return json({ total_count: 0, statuses: [] });
      if (path.includes("/comments?")) return json([]);
      return undefined;
    });
    assert.equal((await reconcileBuild(new GithubBuildApi("fixture", fixture.fetcher), state)).ci?.state, expected);
  }
});

test("oversized serialized plans are rejected before issuing unusable tokens", async () => {
  const { env } = coordinator();
  await assert.rejects(() => issuePlan(env, { ...plan, spec: "x" + "\u0000".repeat(5999), acceptance: Array.from({ length: 8 }, () => "x" + "\u0000".repeat(299)) }), /too large to sign/);
});

test("same-second stale reconciliation is rejected by its expected head", async () => {
  const { instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  instance.updateRun(runId, { phase: "pr_open", pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha }, githubUpdatedAt: 30, ci: { state: "unknown", updatedAt: 30 } });
  const state = instance.updateRun(runId, { pr: { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha: sha }, githubUpdatedAt: 30, ci: { state: "success", updatedAt: Date.now() } }, sha);
  assert.equal(state?.pr?.headSha, headSha);
  assert.equal(state?.ci?.state, "unknown");
});

test("an interrupted upload becomes unknown and a confirmed delayed PR recovers a failed request", async (t) => {
  const { instance } = coordinator();
  const run = await dispatched();
  instance.reserveRun(run, "p", Date.now() + 60_000);
  assert.ok(instance.claimUpload(runId, run.uploadHash));
  instance.updateRun(runId, { phase: "validated" });
  assert.equal(instance.setImplementationHead(runId, headSha), true);
  const later = Date.now() + BUILD_TIMEOUT_MS + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(instance.readRun(runId)?.state.phase, "timeout");
  const pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha };
  assert.equal(instance.updateRun(runId, { phase: "pr_open", pr, githubUpdatedAt: later })?.phase, "pr_open");
  assert.equal(instance.readRun(runId)?.state.reason, undefined);
  const second = await dispatched("e".repeat(32));
  instance.reserveRun(second, "p2", later + 60_000);
  assert.ok(instance.claimUpload(second.state.runId, second.uploadHash));
  instance.updateRun(second.state.runId, { phase: "validated" });
  assert.equal(instance.setImplementationHead(second.state.runId, headSha), true);
  instance.updateRun(second.state.runId, { phase: "failed", reason: "Result unknown." });
  assert.equal(instance.updateRun(second.state.runId, { phase: "pr_open", pr, githubUpdatedAt: later })?.phase, "pr_open");
});

test("a replayed build never reaches GitHub and account renames do not reset quota", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  await consumePlan(env, proposal.token);
  const denied: typeof fetch = async () => assert.fail("Replay must be rejected before network access");
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, denied)).status, 409);
  for (let n = 0; n < 3; n += 1) {
    const run = await stored(n.toString().padStart(32, "0"), `renamed-${n}`);
    run.accountId = 1;
    assert.equal(instance.reserveRun(run, `quota-${n}`, Date.now() + 60_000), "ok");
  }
  const next = await stored("e".repeat(32), "another-name");
  next.accountId = 1;
  assert.equal(instance.reserveRun(next, "quota-overflow", Date.now() + 60_000), "account");
});

test("issue lookup finds the plan's issue by its marker, throttles GitHub and keeps the result past plan expiry", async (t) => {
  const { env } = coordinator();
  const proposal = await issuePlan(env, plan);
  assert.ok(proposal.issueRef);
  assert.ok(new URL(buildIssueUrl(plan, proposal.issueRef)).searchParams.get("context")?.includes(buildIssueMarker(proposal.issueRef)));
  let listed: { auth: string | null; query: URLSearchParams }[] = [];
  let issues: unknown[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === `/repos/${BUILD_REPO}/installation`) return json({ id: 1 });
    if (url.pathname === "/app/installations/1/access_tokens") return json({ token: "installation-fixture" });
    if (url.pathname === `/repos/${BUILD_REPO}/issues`) { listed.push({ auth: new Headers(init?.headers).get("Authorization"), query: url.searchParams }); return json(issues); }
    return json({}, 404);
  }) as typeof fetch;
  const lookup = (token = proposal.token) => handleBuildIssue(new Request("https://api.test/api/build/issue", { headers: { Authorization: `Bearer ${token}` } }), env, fetcher);

  assert.equal((await lookup("not-a-plan")).status, 401);
  assert.deepEqual(await (await lookup()).json(), { issue: null });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].auth, "Bearer installation-fixture");
  assert.equal(listed[0].query.get("state"), "all");
  assert.equal(Date.parse(listed[0].query.get("since")!), proposal.expiresAt - BUILD_PLAN_TTL_MS);

  issues = [
    { number: 9, html_url: `https://github.com/${BUILD_REPO}/pull/9`, body: buildIssueMarker(proposal.issueRef), pull_request: {} },
    { number: 8, html_url: `https://github.com/${BUILD_REPO}/issues/8`, body: buildIssueMarker("another-plan") },
    { number: 7, html_url: `https://github.com/${BUILD_REPO}/issues/7`, body: `context\n${buildIssueMarker(proposal.issueRef)}` },
  ];
  assert.deepEqual(await (await lookup()).json(), { issue: null }, "a second check within the throttle window does not reach GitHub");
  assert.equal(listed.length, 1);

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 11_000 });
  assert.deepEqual(await (await lookup()).json(), { issue: { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` } });
  listed = [];
  t.mock.timers.setTime(proposal.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS / 2);
  assert.deepEqual(await (await lookup()).json(), { issue: { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` } });
  assert.equal(listed.length, 0, "a recorded issue is answered without GitHub");
  t.mock.timers.setTime(proposal.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS + 1);
  assert.equal((await lookup()).status, 401);
});

test("issue lookup pages past newer issues until it reaches ones created before the plan", async () => {
  const since = Date.parse("2026-01-01T00:00:00Z");
  const at = (offset: number) => new Date(since + offset).toISOString();
  const filler = (from: number) => Array.from({ length: 100 }, (_, i) => ({ number: from - i, html_url: `https://github.com/${BUILD_REPO}/issues/${from - i}`, created_at: at(60_000), body: "" }));
  const pages: unknown[][] = [filler(300), [{ number: 7, html_url: `https://github.com/${BUILD_REPO}/issues/7`, created_at: at(1_000), body: buildIssueMarker("ref") }, { number: 3, html_url: `https://github.com/${BUILD_REPO}/issues/3`, created_at: at(-1_000), body: "" }]];
  const requested: string[] = [];
  const api = new GithubBuildApi("token", (async (input: RequestInfo | URL) => {
    const page = new URL(String(input)).searchParams.get("page")!;
    requested.push(page);
    return json(pages[Number(page) - 1] ?? []);
  }) as typeof fetch);
  assert.deepEqual(await findPlanIssue(api, "ref", since), { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` });
  assert.deepEqual(requested, ["1", "2"]);

  const flood = new GithubBuildApi("token", (async () => json(filler(5000))) as typeof fetch);
  await assert.rejects(findPlanIssue(flood, "ref", since), /Too many GitHub issues/);
});

test("Start build checks GitHub once for the plan's issue and refuses without consuming the plan or quota", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  const issue = { number: 31, html_url: `https://github.com/${BUILD_REPO}/issues/31`, body: buildIssueMarker(proposal.issueRef) };
  const { fetcher, calls } = githubFixture((path) => path === "/user" ? json({ id: 432, login: "any-visitor", name: null }) : path.startsWith(`/repos/${BUILD_REPO}/issues?`) ? json([issue]) : undefined);
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json() as { issue: unknown }).issue, { number: 31, url: issue.html_url });
  assert.equal(calls.some((call) => call.path.endsWith("/git/ref/heads/main")), false);
  assert.equal(instance.isPlanUsed(proposal.issueRef!), false);
  assert.deepEqual(instance.planIssue(proposal.issueRef!), { number: 31, url: issue.html_url });
});
