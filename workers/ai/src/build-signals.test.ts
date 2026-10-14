import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_REPO, type BuildRun } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import { GithubBuildApi, reconcileBuild } from "./build/github.ts";
import { fixturePullRequest } from "./build/testing/github-fixture.ts";
import { applyGithubWebhook } from "./build/webhook.ts";

const headSha = "a".repeat(40);
const run: BuildRun = {
  runId: "b".repeat(32), branch: "claude/build-fixture", phase: "pr_open", createdAt: 1, updatedAt: 1,
  pr: { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha },
};
const siteUrl = "https://claude-build-fixture.preview.lyjw.dev";
const ci = { name: "check", status: "completed", conclusion: "success", app: { slug: "github-actions" } };
const siteCheck = { name: "Workers Builds: site", status: "in_progress", conclusion: null, app: { slug: "cloudflare-workers-and-pages" }, started_at: "2026-10-11T00:00:00Z" };

function githubFixture(checks: object[], statuses: object[], options: { checkError?: boolean; statusError?: boolean; checkCount?: number; statusCount?: number } = {}) {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.github.com");
    if (url.pathname.endsWith("/pulls/12")) return Response.json(fixturePullRequest(run.runId, headSha, { head: { sha: headSha, ref: run.branch, repo: { full_name: BUILD_REPO } }, updated_at: "2026-10-10T00:00:00Z" }));
    if (url.pathname.endsWith(`/commits/${headSha}/check-runs`)) return Response.json({ total_count: options.checkCount ?? checks.length, check_runs: checks }, { status: options.checkError ? 403 : 200 });
    if (url.pathname.endsWith(`/commits/${headSha}/status`)) return Response.json({ total_count: options.statusCount ?? statuses.length, statuses }, { status: options.statusError ? 403 : 200 });
    if (url.pathname.endsWith("/issues/12/comments")) return Response.json([]);
    assert.fail(`Unexpected fixture request: ${url.pathname}`);
  };
  return new GithubBuildApi("fixture", fetcher);
}

test("a successful site build links the stable Access-protected preview for the run branch", async () => {
  const patch = await reconcileBuild(githubFixture([ci, { ...siteCheck, status: "completed", conclusion: "success" }], []), run);
  assert.equal(patch.ci?.state, "success");
  assert.equal(patch.preview?.state, "success");
  assert.equal(patch.preview?.url, siteUrl);
  assert.ok(!patch.preview?.url?.includes("?"));
});

test("core and ai deployment checks stay CI and never yield a site preview", async () => {
  const patch = await reconcileBuild(githubFixture([
    ci,
    { name: "Workers Builds: core", status: "completed", conclusion: "success", app: { slug: "cloudflare-workers-and-pages" } },
    { name: "Workers Builds: ai", status: "completed", conclusion: "success", app: { slug: "cloudflare-workers-and-pages" } },
  ], []), run);
  assert.equal(patch.ci?.state, "success");
  assert.equal(patch.preview?.state, "unknown");
  assert.equal(patch.preview?.url, undefined);
});

test("a site-named check from another app is not trusted as the preview", async () => {
  const patch = await reconcileBuild(githubFixture([
    ci,
    { name: "Workers Builds: site", status: "completed", conclusion: "success", app: { slug: "github-actions" }, details_url: "https://evil.example" },
  ], []), run);
  assert.equal(patch.ci?.state, "success");
  assert.equal(patch.preview?.state, "unknown");
  assert.equal(patch.preview?.url, undefined);
});

test("preview state follows the newest site check and never an arbitrary check URL", async () => {
  for (const [status, conclusion, state, url] of [
    ["completed", "failure", "failure", undefined],
    ["in_progress", null, "pending", undefined],
    ["queued", null, "pending", undefined],
    ["completed", "stale", "unknown", undefined],
    ["completed", "skipped", "unknown", undefined],
    ["completed", "neutral", "unknown", undefined],
    ["completed", "success", "success", siteUrl],
  ] as const) {
    const patch = await reconcileBuild(githubFixture([ci, {
      ...siteCheck, status, conclusion, details_url: "https://evil.example", html_url: "https://evil.example",
    }], []), run);
    assert.equal(patch.ci?.state, "success", conclusion ?? status);
    assert.equal(patch.preview?.state, state, conclusion ?? status);
    assert.equal(patch.preview?.url, url, conclusion ?? status);
  }
});

test("the newest site check by started_at then id wins; absent fields keep list order", async () => {
  const oldSuccess = { ...siteCheck, status: "completed", conclusion: "success", started_at: "2026-10-10T00:00:00Z", id: 1 };
  const newFailure = { ...siteCheck, status: "completed", conclusion: "failure", started_at: "2026-10-11T00:00:00Z", id: 2 };
  const failed = await reconcileBuild(githubFixture([ci, oldSuccess, newFailure], []), run);
  assert.equal(failed.preview?.state, "failure");
  const succeeded = await reconcileBuild(githubFixture([ci, { ...newFailure, started_at: "2026-10-10T00:00:00Z" }, { ...oldSuccess, started_at: "2026-10-11T00:00:00Z" }], []), run);
  assert.equal(succeeded.preview?.state, "success");
  assert.equal(succeeded.preview?.url, siteUrl);
  const byId = await reconcileBuild(githubFixture([ci,
    { ...siteCheck, status: "completed", conclusion: "failure", started_at: "2026-10-11T00:00:00Z", id: 3 },
    { ...siteCheck, status: "completed", conclusion: "success", started_at: "2026-10-11T00:00:00Z", id: 4 },
  ], []), run);
  assert.equal(byId.preview?.state, "success");
  const ordered = await reconcileBuild(githubFixture([ci,
    { ...siteCheck, status: "completed", conclusion: "failure" },
    { ...siteCheck, status: "completed", conclusion: "success" },
  ], []), run);
  assert.equal(ordered.preview?.state, "failure");
});

test("no site check means unknown preview without a URL", async () => {
  const patch = await reconcileBuild(githubFixture([ci], []), run);
  assert.equal(patch.preview?.state, "unknown");
  assert.equal(patch.preview?.url, undefined);
});

test("commit statuses all count as CI, whatever their context", async () => {
  for (const context of ["Netlify", "test Netlify integration", "Netlify - fixture: e2e-tests", "ci/tests"]) {
    const patch = await reconcileBuild(githubFixture([ci, { ...siteCheck, status: "completed", conclusion: "success" }], [{ context, state: "failure" }]), run);
    assert.equal(patch.ci?.state, "failure", context);
    assert.equal(patch.preview?.state, "success", context);
  }
});

test("provider words and unrelated app checks remain CI", async () => {
  const checks = [
    { name: "test Netlify integration", app: { slug: "github-actions" } },
    { name: "Netlify", app: { slug: "github-actions" } },
    { name: "Netlify Preview Comments", app: { slug: "github-actions" } },
    { name: "Netlify – Code Owners", app: { slug: "netlify" } },
    { name: "Workers Builds: site", app: { slug: "netlify" } },
    { name: "Workers Builds: site", app: undefined },
    { name: "Workers Builds: core", app: { slug: "cloudflare-workers-and-pages" } },
    { name: "Cloudflare integration tests", app: { slug: "cloudflare-workers-and-pages" } },
  ];
  for (const check of checks) {
    const patch = await reconcileBuild(githubFixture([{ ...ci, ...check, conclusion: "failure" }], []), run);
    assert.equal(patch.ci?.state, "failure", check.name);
    assert.equal(patch.preview?.state, "unknown", check.name);
  }
});

test("missing or incomplete API results cannot mark either aggregate successful", async () => {
  for (const options of [{ checkError: true }, { statusError: true }, { checkCount: 101 }, { statusCount: 101 }]) {
    const patch = await reconcileBuild(githubFixture([ci, { ...siteCheck, status: "completed", conclusion: "success" }], [], options), run);
    assert.equal(patch.ci?.state, "unknown");
    assert.equal(patch.preview?.state, "unknown");
    assert.equal(patch.preview?.url, undefined);
  }
});

test("individual webhook events invalidate both aggregates without replacing them", async () => {
  const pending = await reconcileBuild(githubFixture([ci, siteCheck], []), run);
  const state = { ...run, ...pending };
  const patches: Partial<BuildRun>[] = [];
  const env = { BUILD_COORDINATOR: { getByName: () => ({
    findRun(sha: string) { return sha === headSha ? { state } : null; },
    updateRun(runId: string, patch: Partial<BuildRun>) {
      assert.equal(runId, run.runId);
      patches.push(patch);
      Object.assign(state, patch);
    },
  }) } } as unknown as Env;
  for (const check of [ci, { ...siteCheck, status: "completed", conclusion: "success" }]) {
    await applyGithubWebhook(env, "check_run", { repository: { full_name: BUILD_REPO }, check_run: { ...check, head_sha: headSha } });
  }
  await applyGithubWebhook(env, "status", { repository: { full_name: BUILD_REPO }, sha: headSha, context: "ci/tests", state: "success" });
  await applyGithubWebhook(env, "check_suite", { repository: { full_name: BUILD_REPO }, check_suite: { head_sha: headSha, status: "completed", conclusion: "success" } });
  assert.equal(patches.length, 4);
  for (const patch of patches) assert.deepEqual(patch, { reconciledAt: 0 });
  assert.equal(state.ci?.state, "success");
  assert.equal(state.preview?.state, "pending");
  assert.equal(state.preview?.url, undefined);
  const settled = await reconcileBuild(githubFixture([ci, { ...siteCheck, status: "completed", conclusion: "success" }], []), state);
  assert.equal(settled.ci?.state, "success");
  assert.equal(settled.preview?.state, "success");
  assert.equal(settled.preview?.url, siteUrl);
});
