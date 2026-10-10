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
const vercelUrl = "https://vercel.com/fixture/project/deployment";
const workerUrl = "https://dash.cloudflare.com/fixture/workers/services/view/ai/production/previews/fixture/builds/build-id";
const ci = { name: "check", status: "completed", conclusion: "success", app: { slug: "github-actions" } };
const worker = { name: "Workers Builds: ai", status: "in_progress", conclusion: null, app: { slug: "cloudflare-workers-and-pages" }, details_url: workerUrl };
const comments = { name: "Vercel Preview Comments", status: "completed", conclusion: "success", app: { slug: "vercel" }, details_url: "https://vercel.com/github" };
const deployment = { context: "Vercel", state: "pending", target_url: vercelUrl };

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

test("pending Vercel and Workers deployments do not hold successful CI pending", async () => {
  const patch = await reconcileBuild(githubFixture([ci, worker, comments], [deployment]), run);
  assert.equal(patch.ci?.state, "success");
  assert.equal(patch.preview?.state, "pending");
  assert.equal(patch.preview?.url, vercelUrl);
});

test("the Vercel comments check cannot replace the deployment state or link", async () => {
  const patch = await reconcileBuild(githubFixture([ci, comments], [deployment]), run);
  assert.equal(patch.preview?.state, "pending");
  assert.equal(patch.preview?.url, vercelUrl);
  const onlyComments = await reconcileBuild(githubFixture([{ ...comments, conclusion: "failure" }], []), run);
  assert.equal(onlyComments.ci?.state, "unknown");
  assert.equal(onlyComments.preview?.state, "unknown");
  assert.equal(onlyComments.preview?.url, undefined);
});

test("Preview aggregates every deployment and links to the signal determining its result", async () => {
  for (const [status, conclusion, expected] of [
    ["completed", "failure", "failure"], ["in_progress", null, "pending"],
    ["completed", "stale", "unknown"], ["completed", "success", "success"],
  ] as const) {
    const patch = await reconcileBuild(githubFixture([
      ci, { ...worker, status, conclusion },
      { ...worker, name: "Workers Builds: api", status: "completed", conclusion: "success", details_url: `${workerUrl}-other` },
    ], [{ ...deployment, state: "success" }]), run);
    assert.equal(patch.ci?.state, "success");
    assert.equal(patch.preview?.state, expected);
    assert.equal(patch.preview?.url, expected === "success" ? vercelUrl : workerUrl);
  }
});

test("a Workers-only preview is shown without being counted as CI", async () => {
  const patch = await reconcileBuild(githubFixture([worker], []), run);
  assert.equal(patch.ci?.state, "unknown");
  assert.equal(patch.preview?.state, "pending");
  assert.equal(patch.preview?.url, workerUrl);
});

test("Vercel deployment checks and project commit statuses are recognized precisely", async () => {
  for (const name of ["Vercel", "Vercel - fixture-project", "Vercel – fixture-project"]) {
    const check = { name, status: "in_progress", conclusion: null, app: { slug: "vercel" }, details_url: vercelUrl };
    const fromCheck = await reconcileBuild(githubFixture([ci, check], []), run);
    const fromStatus = await reconcileBuild(githubFixture([ci], [{ ...deployment, context: name }]), run);
    for (const patch of [fromCheck, fromStatus]) {
      assert.equal(patch.ci?.state, "success");
      assert.equal(patch.preview?.state, "pending");
      assert.equal(patch.preview?.url, vercelUrl);
    }
  }
});

test("provider words, unrelated apps and Vercel code checks remain CI", async () => {
  const checks = [
    { name: "test Vercel integration", app: { slug: "github-actions" } },
    { name: "Vercel", app: { slug: "github-actions" } },
    { name: "Vercel Preview Comments", app: { slug: "github-actions" } },
    { name: "Vercel – Code Owners", app: { slug: "vercel" } },
    { name: "Vercel - fixture: e2e-tests", app: { slug: "vercel" } },
    { name: "Workers Builds: ai", app: { slug: "github-actions" } },
    { name: "Workers Builds: ai", app: undefined },
    { name: "Cloudflare integration tests", app: { slug: "cloudflare-workers-and-pages" } },
  ];
  for (const check of checks) {
    const patch = await reconcileBuild(githubFixture([{ ...ci, ...check, conclusion: "failure" }], [deployment]), run);
    assert.equal(patch.ci?.state, "failure", check.name);
  }
  for (const status of [
    { ...deployment, context: "test Vercel integration" },
    { ...deployment, context: "Vercel - fixture: e2e-tests" },
    { ...deployment, target_url: "https://vercel.com.example.test/deployment" },
    { ...deployment, target_url: "https://github.com/fixture/actions/1" },
    { ...deployment, target_url: undefined },
  ]) {
    const patch = await reconcileBuild(githubFixture([ci], [{ ...status, state: "failure" }]), run);
    assert.equal(patch.ci?.state, "failure", JSON.stringify(status));
    assert.equal(patch.preview?.state, "unknown");
  }
});

test("missing or incomplete API results cannot mark either aggregate successful", async () => {
  for (const options of [{ checkError: true }, { statusError: true }, { checkCount: 101 }, { statusCount: 101 }]) {
    const patch = await reconcileBuild(githubFixture([ci, { ...worker, status: "completed", conclusion: "success" }], [{ ...deployment, state: "success" }], options), run);
    assert.equal(patch.ci?.state, "unknown");
    assert.equal(patch.preview?.state, "unknown");
    assert.equal(patch.preview?.url, undefined);
  }
});

test("individual webhook events invalidate both aggregates without replacing them", async () => {
  const pending = await reconcileBuild(githubFixture([ci, worker], [{ ...deployment, state: "success" }]), run);
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
  for (const check of [ci, { ...worker, status: "completed", conclusion: "success" }, comments]) {
    await applyGithubWebhook(env, "check_run", { repository: { full_name: BUILD_REPO }, check_run: { ...check, head_sha: headSha } });
  }
  await applyGithubWebhook(env, "status", { repository: { full_name: BUILD_REPO }, sha: headSha, ...deployment, state: "success" });
  await applyGithubWebhook(env, "check_suite", { repository: { full_name: BUILD_REPO }, check_suite: { head_sha: headSha, status: "completed", conclusion: "success" } });
  assert.equal(patches.length, 5);
  for (const patch of patches) assert.deepEqual(patch, { reconciledAt: 0 });
  assert.equal(state.ci?.state, "success");
  assert.equal(state.preview?.state, "pending");
  assert.equal(state.preview?.url, workerUrl);
  const settled = await reconcileBuild(githubFixture([ci, { ...worker, status: "completed", conclusion: "success" }], [{ ...deployment, state: "success" }]), state);
  assert.equal(settled.ci?.state, "success");
  assert.equal(settled.preview?.state, "success");
});
