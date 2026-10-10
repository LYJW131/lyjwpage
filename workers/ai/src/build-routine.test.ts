import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_DESIGN_LIMITS, BUILD_PLAN_TTL_MS, BUILD_SCREENSHOT_LIMITS, buildIssueBody, planLanguage, BUILD_QUOTA, BUILD_REPO, BUILD_TIMEOUT_MS, BUILD_UPLOAD_LIMITS, branchForRun, type BuildPlan, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { StoredRun } from "./build/coordinator.ts";
import { signBuildToken, verifyBuildToken, hashToken, decodeBase64url } from "./build/token.ts";
import { allowedBuildPath, parseBuildPlan, parseBuildUpload } from "./build/validation.ts";
import { githubAppJwt, GithubBuildApi, assertMainAncestor, createBuildPullRequest, reconcileBuild } from "./build/github.ts";
import { verifyGithubWebhook, applyGithubWebhook } from "./build/webhook.ts";
import { consumePlan, issuePlan } from "./build/plan.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { handleBuild, handleBuildProgress, handleBuildScreenshot, handleBuildStatus, handleBuildUpload, handleGithubWebhook } = await import("./build/handlers.ts");
const { BuildCoordinator } = await import("./build/coordinator.ts");
const plan: BuildPlan = { title: "Improve the page", spec: "Improve the public layout.", acceptance: ["Mobile layout fits."], paths: ["src/card.tsx"] };
const sha = "a".repeat(40);
const treeSha = "b".repeat(40);
const headSha = "c".repeat(40);
const runId = "a".repeat(32);
const uploadToken = "f".repeat(64);
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
  const instance = new BuildCoordinator({ storage: { sql, transactionSync } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: "test-build-secret", GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_APP_CLIENT_SECRET: "oauth-fixture", GITHUB_WEBHOOK_SECRET: "webhook-fixture", ROUTINE_FIRE_URL: "https://routine.test/fire", ROUTINE_FIRE_TOKEN: "fire-fixture" } as unknown as Env;
  return { instance, env, db };
}
async function stored(id = runId, account = "visitor"): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId: id, branch: branchForRun(id), phase: "triggered", createdAt: now, updatedAt: now }, plan, account, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha: sha, uploadHash: await hashToken(uploadToken), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}
function post(path: string, body: unknown, token?: string) {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

for (const path of [".github/workflows/ci.yml", ".claude/settings.json", "AGENTS.md", "src/AGENTS.md", "CLAUDE.md", "docs/CLAUDE.md", "package.json", "src/package.json", "workers/ai/package.json", "pnpm-lock.yaml", "src/pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "src/.npmrc", "scripts/foo.test.ts", "workers/ai/scripts/foo.test.ts", "workers/ai/wrangler.toml", "workers/ai/src/wrangler.test.toml", "next.config.ts", "src/next.config.mjs", "vercel.json", "docs/vercel.json", "reporters/foo.test.ts", ".gitmodules", "src/.gitmodules", "src/../package.json", "/src/a.ts", "src//a.ts", "src\\a.ts", "src/%2e%2e/package.json", "src/.git/config"]) {
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

test("plans are single use across issue and build and expire", async (t) => {
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
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "x".repeat(601), blocked: true }, uploadToken), env)).status, 400);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Plan needs shared/collector.ts", blocked: true }, uploadToken), env)).status, 200);
  const run = instance.readRun(runId)!;
  assert.equal(run.state.phase, "blocked");
  assert.equal(run.uploadUsed, true);
  assert.match(run.state.reason ?? "", /shared\/collector\.ts/);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${runId}`, { message: "Still working" }, uploadToken), env)).status, 401);
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), env, githubFixture().fetcher)).status, 401);
});

test("upload claim is atomic, progress cannot consume it and timeout is unknown", async (t) => {
  const { instance } = coordinator();
  const run = await stored();
  assert.equal(instance.reserveRun(run, "p", Date.now() + 60_000), "ok");
  assert.equal(instance.claimUpload(runId, "wrong"), null);
  assert.equal(instance.progress(runId, run.uploadHash, "Testing"), true);
  assert.equal(instance.claimUpload(runId, run.uploadHash)?.state.phase, "uploaded");
  assert.equal(instance.claimUpload(runId, run.uploadHash), null);
  assert.equal(instance.progress(runId, run.uploadHash, "Done"), false);
  const second = await stored("d".repeat(32));
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
  const calls: { path: string; body: Record<string, unknown> | null; auth?: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input).replace("https://api.github.com", "");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ path, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    const override = extra(path, body);
    if (override) return override;
    if (path.endsWith("/installation")) return json({ id: 1 });
    if (path === "/app/installations/1/access_tokens") return json({ token: "installation-fixture" });
    if (path.includes("/compare/")) return json({ status: "ahead", merge_base_commit: { sha } });
    if (path.endsWith(`/git/commits/${sha}`)) return json({ tree: { sha: treeSha } });
    if (path.includes("/git/trees/") && path.includes("recursive")) return json({ truncated: false, tree: [{ path: "src", type: "tree", mode: "040000" }, { path: "src/card.tsx", type: "blob", mode: "100644" }, { path: ".github", type: "tree", mode: "040000" }] });
    if (path.endsWith("/git/blobs") || path.endsWith("/git/trees") || path.endsWith("/git/commits")) return json({ sha: headSha }, 201);
    if (path.endsWith("/git/refs")) return json({ ref: `refs/heads/${branchForRun(runId)}` }, 201);
    if (path.endsWith("/pulls")) return json({ number: 12, html_url: `https://github.com/${BUILD_REPO}/pull/12`, head: { sha: headSha } }, 201);
    if (path.endsWith("/git/ref/heads/main")) return json({ object: { sha } });
    if (path === "https://github.com/login/oauth/access_token") return json({ access_token: "oauth-fixture" });
    if (path === "/user") return json({ id: 1, login: "visitor", name: "Visitor" });
    if (path.startsWith("/applications/") && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("/issues/12/comments")) return json({ id: 1 }, 201);
    throw new Error(`Unexpected fixture request: ${path}`);
  };
  return { fetcher, calls };
}

test("GitHub publishing retains the base tree and binds parent, branch, ready PR and verified coauthor", async () => {
  const { fetcher, calls } = githubFixture();
  const result = await createBuildPullRequest(new GithubBuildApi("fixture", fetcher), await stored(), upload);
  assert.equal(result.number, 12);
  assert.equal(calls.find((call) => call.path.endsWith("/git/trees"))?.body?.base_tree, treeSha);
  assert.deepEqual(calls.find((call) => call.path.endsWith("/git/commits"))?.body?.parents, [sha]);
  assert.match(String(calls.find((call) => call.path.endsWith("/git/commits"))?.body?.message), /Co-authored-by: Visitor <1\+visitor@users.noreply.github.com>/);
  assert.equal(calls.find((call) => call.path.endsWith("/pulls"))?.body?.draft, false);
  assert.equal(calls.find((call) => call.path.endsWith("/pulls"))?.body?.base, "main");
  assert.doesNotMatch(String(calls.find((call) => call.path.endsWith("/pulls"))?.body?.body), /Review closely/);
  assert.equal(calls.some((call) => call.path.endsWith("/pulls/12")), false);
  const extra = githubFixture((path) => path.endsWith("/pulls/12") ? json({ number: 12 }) : undefined);
  const extraFiles = [{ path: "src/lib/extra.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "shared/collector.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "workers/ai/README.md", mode: "100644" as const, content: btoa("# ai") }];
  await createBuildPullRequest(new GithubBuildApi("fixture", extra.fetcher), await stored(), { ...upload, files: [...upload.files, ...extraFiles] });
  assert.match(String(extra.calls.find((call) => call.path.endsWith("/pulls"))?.body?.body), /## Review closely\n- `src\/lib\/extra\.ts` — outside the plan\n- `shared\/collector\.ts` — outside the plan, shared contract\n- `workers\/ai\/README\.md` — outside the plan, documentation outside docs\//);
  const patched = String(extra.calls.find((call) => call.path.endsWith("/pulls/12"))?.body?.body);
  assert.match(patched, /\[`src\/lib\/extra\.ts`\]\(https:\/\/github\.com\/LYJW131\/lyjwpage\/pull\/12\/files#diff-[0-9a-f]{64}\)/);
});

test("issue and PR labels follow the plan language", () => {
  const zh: BuildPlan = { title: "加一张原神卡片", spec: "在首页游戏区新增只读卡片，数据来自 workers/collector/src/jobs/genshin-profile.ts 与 shared/collector.ts。", acceptance: ["手机端 375px 单列显示"], paths: ["src/components/live/genshin-card.tsx"] };
  const ja: BuildPlan = { ...zh, title: "原神カードを追加する", spec: "ホームのゲーム欄に読み取り専用のカードを追加します。", acceptance: ["スマホでも一列で表示される"] };
  const en: BuildPlan = { ...plan, spec: "Show the song 星街すいせい GHOST in the card title when it is playing." };
  assert.deepEqual([planLanguage(zh), planLanguage(ja), planLanguage(plan), planLanguage(en)], ["zh", "ja", "en", "en"]);
  assert.match(buildIssueBody(zh), /## 验收标准[\s\S]*## 计划路径/);
  assert.match(buildIssueBody(ja), /## 受け入れ基準/);
  assert.match(buildIssueBody(plan), /## Acceptance criteria/);
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
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  const denied: typeof fetch = async () => assert.fail("No network on rejected uploads");
  const bad = { ...upload, files: [{ ...upload.files[0], path: ".github/workflows/evil.yml" }] };
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, bad, uploadToken), env, denied)).status, 400);
  assert.equal(instance.readRun(runId)?.state.phase, "blocked");
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), env, denied)).status, 401);
});

test("valid upload creates and returns a confirmed PR without secret fields", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), env, githubFixture().fetcher);
  assert.equal(response.status, 201);
  const body = await response.json() as BuildRun;
  assert.equal(body.phase, "pr_open");
  assert.equal(body.pr?.number, 12);
  assert.equal(JSON.stringify(body).includes(uploadToken), false);
  assert.equal("plan" in body, false);
});

test("an opened PR asks Codex and Cursor to review it with the owner's token, and a failed request keeps the PR", async () => {
  for (const [token, status] of [[undefined, 201], ["owner-fixture", 201], ["owner-fixture", 500]] as const) {
    const { env, instance } = coordinator();
    instance.reserveRun(await stored(), "p", Date.now() + 60_000);
    const { fetcher, calls } = githubFixture((path) => status === 500 && path.endsWith("/comments") ? json({}, 500) : undefined);
    const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), { ...env, CODEX_REVIEW_GITHUB_TOKEN: token }, fetcher);
    assert.equal(response.status, 201);
    assert.equal((await response.json() as BuildRun).phase, "pr_open");
    const comments = calls.filter((call) => call.path.endsWith("/comments"));
    assert.equal(comments.length, token ? 2 : 0);
    if (!token) continue;
    for (const comment of comments) {
      assert.equal(comment.path, `/repos/${BUILD_REPO}/issues/12/comments`);
      assert.equal(comment.auth, "Bearer owner-fixture");
    }
    assert.deepEqual(comments.map((comment) => String(comment.body?.body).split(/\s/)[0]).sort(), ["@codex", "@cursoragent"]);
  }
});

const png = (seed: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed])]).toString("base64");
function imageBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = { async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) { objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType }); } };
  return { objects, bucket: bucket as unknown as R2Bucket };
}

test("screenshots need the unused upload token, real image bytes and stay within the per-run limit", async () => {
  const { env, instance } = coordinator();
  const { objects, bucket } = imageBucket();
  const withImages = { ...env, IMAGES: bucket } as Env;
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  const shot = (body: unknown, token = uploadToken) => handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, body, token), withImages);
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home", content: png(0) }, uploadToken), env)).status, 503);
  assert.equal((await shot({ caption: "Home", content: png(0) }, "e".repeat(64))).status, 409);
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
  instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Home desktop", content: png(1) }, uploadToken), withImages)).status, 201);
  const { fetcher, calls } = githubFixture();
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), withImages, fetcher)).status, 201);
  const comments = calls.filter((call) => call.path.endsWith("/issues/12/comments"));
  assert.equal(comments.length, 1);
  assert.equal(comments[0].auth, "Bearer installation-fixture");
  assert.match(String(comments[0].body?.body), /^## Screenshots\n[\s\S]*\*\*Home desktop\*\*\n\n!\[Home desktop\]\(https:\/\/lyjw\.me\/img\/[a-f0-9]{64}\.png\)$/);
  assert.equal((await handleBuildScreenshot(post(`/api/build/screenshot?runId=${runId}`, { caption: "Late", content: png(2) }, uploadToken), withImages)).status, 409);
  const plain = coordinator();
  plain.instance.reserveRun(await stored(), "p", Date.now() + 60_000);
  const quiet = githubFixture();
  assert.equal((await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, uploadToken), plain.env, quiet.fetcher)).status, 201);
  assert.equal(quiet.calls.some((call) => call.path.endsWith("/comments")), false);
});

test("webhooks verify exact bytes, reject invalid signatures and deduplicate deliveries", async () => {
  const { env, instance } = coordinator();
  const run = await stored();
  run.uploadUsed = true;
  run.state.phase = "validated";
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
  assert.equal(denied.calls.some((call) => call.path === "/fire" || call.path.endsWith("/git/ref/heads/main")), false);
});

test("dispatch includes the upload capability only in routine input and accepts late upload after uncertain dispatch", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  let fireText: Record<string, unknown> | undefined;
  const fixture = githubFixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === env.ROUTINE_FIRE_URL) { fireText = JSON.parse(JSON.parse(String(init?.body)).text); throw new Error("Network response was lost"); }
    return fixture.fetcher(input, init);
  };
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 202);
  const result = await response.json() as { runId: string; statusToken: string };
  assert.equal(fireText?.baseSha, sha);
  assert.equal(instance.readRun(result.runId)?.state.phase, "triggered");
  assert.equal("uploadToken" in result, false);
  assert.equal((await handleBuildProgress(post(`/api/build/progress?runId=${result.runId}`, { message: "Working" }, fireText?.uploadToken as string), env)).status, 200);
  assert.equal((await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher)).status, 409);
  const status = await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}`, { headers: { Authorization: `Bearer ${result.statusToken}` } }), env);
  assert.equal(status.status, 200);
  assert.equal((await handleBuildStatus(new Request(`https://api.test/api/build/status?runId=${result.runId}&token=${result.statusToken}`), env)).status, 401);
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
  const run = await stored();
  instance.reserveRun(run, "p", Date.now() + 60_000);
  instance.claimUpload(runId, run.uploadHash);
  const later = Date.now() + BUILD_TIMEOUT_MS + 1;
  t.mock.method(Date, "now", () => later);
  assert.equal(instance.readRun(runId)?.state.phase, "timeout");
  const pr = { number: 1, url: `https://github.com/${BUILD_REPO}/pull/1`, headSha };
  assert.equal(instance.updateRun(runId, { phase: "pr_open", pr, githubUpdatedAt: later })?.phase, "pr_open");
  assert.equal(instance.readRun(runId)?.state.reason, undefined);
  const second = await stored("e".repeat(32));
  instance.reserveRun(second, "p2", later + 60_000);
  instance.claimUpload(second.state.runId, second.uploadHash);
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
