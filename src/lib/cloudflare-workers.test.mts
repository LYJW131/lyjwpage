import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWorkerDeployments, fetchWorkersMetrics, parseBuildsByVersion, parseWorkerDeployment, parseWorkersMetrics } from "./cloudflare-workers.ts";

const start = Date.parse("2026-09-10T12:30:00Z");
const end = start + 43_200_000;
const analytics = () => ({ data: { viewer: { accounts: [{
  summary: [{ dimensions: { scriptName: "api" }, sum: { requests: 20, errors: 2, subrequests: 30 }, quantiles: { cpuTimeP50: 735 } }],
  series: [{ dimensions: { scriptName: "api", datetimeFifteenMinutes: "2026-09-10T13:00:00Z" }, sum: { requests: 20 } }],
}] } }, errors: null });

test("12h window includes partial buckets, preserves zero buckets, and converts microseconds", () => {
  const result = parseWorkersMetrics(analytics(), start, end);
  assert.deepEqual(result.workers.map((worker) => worker.name), ["api", "online-counter", "playstation-reporter"]);
  assert.deepEqual(result.workers[0].metrics, { requests: 20, errors: 2, subrequests: 30, cpuTimeP50Ms: 0.735 });
  assert.equal(result.workers[0].history.length, 48);
  assert.equal(result.workers[0].history[0].requests, 0);
  assert.equal(result.workers[0].history[2].requests, 20);
  assert.equal(result.workers[0].history.at(-1)?.at, Date.parse("2026-09-11T00:15:00Z"));
  assert.equal(result.workers[1].metrics, null);
  assert.deepEqual(result.workers[1].history, []);
});

test("GraphQL errors, inaccessible accounts and malformed metrics never become healthy zeros", () => {
  assert.throws(() => parseWorkersMetrics({ ...analytics(), errors: [{ message: "forbidden" }] }, start, end));
  assert.throws(() => parseWorkersMetrics({ data: { viewer: { accounts: [] } } }, start, end));
  const invalid = analytics();
  invalid.data.viewer.accounts[0].summary[0].sum.requests = NaN;
  assert.throws(() => parseWorkersMetrics(invalid, start, end));
  const empty = analytics();
  empty.data.viewer.accounts[0].summary = [];
  empty.data.viewer.accounts[0].series = [];
  assert.ok(parseWorkersMetrics(empty, start, end).workers.every((worker) => worker.metrics === null));
});

test("deployment projection selects latest deployment and retains only public active versions", () => {
  const result = parseWorkerDeployment({ success: true, result: { deployments: [
    { created_on: "2026-09-10T00:00:00Z", versions: [{ version_id: "old", percentage: 100 }] },
    { created_on: "2026-09-11T00:00:00Z", author_email: "private@example.com", versions: [
      { version_id: "first", percentage: 75 }, { version_id: "second", percentage: 25 }, { version_id: "inactive", percentage: 0 },
    ] },
  ] } });
  assert.deepEqual(result, { deployedAt: Date.parse("2026-09-11T00:00:00Z"), versions: [{ id: "first", percentage: 75 }, { id: "second", percentage: 25 }], commit: null });
  assert.equal(parseWorkerDeployment({ success: true, result: { deployments: [] } }), null);
});

test("builds by version maps commits and skips versions without a valid sha", () => {
  const sha = "0123456789abcdef".repeat(2) + "01234567";
  const result = parseBuildsByVersion({ success: true, result: { builds: {
    v1: { build_trigger_metadata: { branch: "main", commit_hash: sha, commit_message: "feat: x\n\nbody" } },
    manual: { build_trigger_metadata: { branch: "main", commit_hash: null } },
    broken: { build_trigger_metadata: { commit_hash: "not-a-sha" } },
  } } });
  assert.deepEqual(result.get("v1"), { sha, branch: "main", message: "feat: x" });
  assert.equal(result.has("manual"), false);
  assert.equal(result.has("broken"), false);
  assert.throws(() => parseBuildsByVersion({ success: false }));
  assert.throws(() => parseBuildsByVersion({ success: true, result: { builds: [] } }));
});

test("deployment permission failure preserves metrics and sends credentials only to Cloudflare", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.equal(new URL(url).origin, "https://api.cloudflare.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-secret");
    if (url.endsWith("/graphql")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(Date.parse(body.variables.end) - Date.parse(body.variables.start), 43_200_000);
      return Response.json(analytics());
    }
    return Response.json({ success: false }, { status: 403 });
  });
  const metrics = await fetchWorkersMetrics("test-account", "test-secret", start, end);
  const deployments = await fetchWorkerDeployments("test-account", "test-secret");
  assert.equal(calls.length, 4);
  assert.equal(metrics.workers[0].metrics?.requests, 20);
  assert.deepEqual(deployments, [null, null, null]);
  assert.doesNotMatch(JSON.stringify({ metrics, deployments }), /test-secret|test-account/);
});

test("deployments join the commit of the highest-traffic version in one batched call", async (t) => {
  const sha = "0123456789abcdef".repeat(2) + "01234567";
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/builds/builds?")) {
      assert.ok(new URL(url).searchParams.get("version_ids")?.split(",").includes("v1"));
      return Response.json({ success: true, result: { builds: {
        v1: { build_trigger_metadata: { branch: "main", commit_hash: sha, commit_message: "feat: x" } },
      } } });
    }
    if (url.includes("/workers/scripts/api/deployments")) {
      return Response.json({ success: true, result: { deployments: [
        { created_on: "2026-09-11T00:00:00Z", versions: [{ version_id: "v1", percentage: 100 }] },
      ] } });
    }
    return Response.json({ success: false }, { status: 403 });
  });
  const deployments = await fetchWorkerDeployments("test-account", "test-secret");
  assert.equal(calls.length, 4);
  assert.deepEqual(deployments[0]?.commit, { sha, branch: "main", message: "feat: x" });
  assert.deepEqual(deployments.slice(1), [null, null]);
});
