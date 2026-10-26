import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_SCREENSHOT_LIMITS, buildIssueBody, buildIssueUrl, planLanguage, visitorLanguage, BUILD_REPO, type BuildPlan, type BuildRun } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { StoredRun } from "./build/coordinator.ts";
import { uploadTokenForRun } from "./build/token.ts";
import { GithubBuildApi, assertMainAncestor } from "./build/github.ts";
import { FIXTURE_PLAN_SHA, FIXTURE_PLAN_TREE } from "./build/testing/github-fixture.ts";
import { buildWorkflowAudience } from "./build/actions-oidc.ts";
import { buildSecret, callbackOrigin, coordinator, createBuildPullRequest, dispatched, githubFixture, handleBuildScreenshot, handleBuildUpload, headSha, imageBucket, json, oidc, plan, png, post, runId, sha, stored, treeSha, upload } from "./build/testing/routine-fixture.ts";

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
  const extraFiles = [{ path: "src/lib/extra.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "shared/collector.ts", mode: "100644" as const, content: btoa("export {};") }, { path: "workers/ai/NOTES.md", mode: "100644" as const, content: btoa("# ai") }];
  await createBuildPullRequest(new GithubBuildApi("fixture", extra.fetcher), await stored(), { ...upload, files: [...upload.files, ...extraFiles] });
  const patched = String(extra.calls.find((call) => call.path.endsWith("/pulls/12") && call.method === "PATCH")?.body?.body);
  assert.match(patched, /## Review closely/);
  assert.match(patched, /outside the plan, shared contract/);
  assert.match(patched, /documentation outside docs\//);
  const rules = githubFixture();
  await createBuildPullRequest(new GithubBuildApi("fixture", rules.fetcher), await stored(), { ...upload, files: [...upload.files, { path: "workers/ai/README.md", mode: "100644" as const, content: btoa("# ai") }], dropped: ["workers/ai/AGENTS.md"] });
  const ruled = String(rules.calls.find((call) => call.path.endsWith("/pulls/12") && call.method === "PATCH")?.body?.body);
  assert.match(ruled, /`workers\/ai\/README\.md`\]\([^)]+\) — outside the plan, documentation outside docs\/, rules or model-context document/);
  assert.match(ruled, /## Left out of this commit \(outside the allowed paths\)\n- `workers\/ai\/AGENTS\.md`/);
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

test("an upload whose pull request head lags the pushed branch is accepted and stays pending", async () => {
  const { env, instance } = coordinator();
  instance.reserveRun(await dispatched(), "p", Date.now() + 60_000);
  const token = await oidc.token(buildWorkflowAudience(callbackOrigin, runId));
  let pushed = false;
  const { fetcher } = githubFixture((path, body) => {
    if (path.includes("/git/refs/heads/") && body?.sha) pushed = true;
    if (pushed && path.endsWith("/pulls/12") && body === null) return Response.json({ head: { sha: FIXTURE_PLAN_SHA } });
  });
  const response = await handleBuildUpload(post(`/api/build/upload?runId=${runId}`, upload, token), env, fetcher);
  assert.equal(response.status, 202);
  assert.equal((await response.json() as BuildRun).phase, "validated");
  assert.equal(instance.readRun(runId)?.state.phase, "validated");
});

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
