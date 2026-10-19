import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_COLLECTOR_JOBS, type CollectorJobOutcome } from "@shared/collector";

import { DEPLOYMENT_JOBS } from "./worker";
import { ALL, DEPLOYER, MAC_ONLY, json, world } from "./testing/world";

test("site-deployed: the state core broadcasts version and the collector re-pulls deployments and recent commits in the background", async () => {
  const w = world();
  const response = await w.send("/api/internal/site-deployed", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, delivered: 3 });
  assert.equal(w.calls.broadcasts, 1);
  assert.deepEqual(w.calls.refreshed, [DEPLOYMENT_JOBS]);
  assert.deepEqual(DEPLOYMENT_JOBS, ["site-deployments", "cloudflare-deployments", "github-repo"]);
  assert.equal((await w.send("/api/internal/site-deployed", { method: "GET", client: DEPLOYER })).status, 405);
  assert.equal((await w.send("/api/internal/site-deployed", { client: null })).status, 401);
});

test("site-deployed: a failing or missing collector never fails the notification", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const failing = world({ refresh: async () => { throw new Error("collector unavailable"); } });
  const response = await failing.send("/api/internal/site-deployed", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, delivered: 3 });
  const erroring = world({ refresh: async (jobs) => jobs.map((job): CollectorJobOutcome => ({ job, status: "error", detail: "token missing", ms: 1 })) });
  assert.equal((await erroring.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 200);
  assert.equal(warned.mock.callCount(), 1 + DEPLOYMENT_JOBS.length);
  const unbound = world({ collector: false });
  assert.equal((await unbound.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 200);
});

test("collector-refresh: runs every active job now, one collector call per job, and reports each outcome in request order", async () => {
  const w = world();
  const response = await w.send("/api/internal/collector-refresh", { client: DEPLOYER });
  assert.equal(response.status, 200);
  const body = await json(response) as { ok: boolean; outcomes: CollectorJobOutcome[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.outcomes.map((outcome) => outcome.job), [...ACTIVE_COLLECTOR_JOBS]);
  assert.deepEqual(new Set(w.calls.refreshed.map(([job]) => job)), new Set(ACTIVE_COLLECTOR_JOBS));
  assert.equal(w.calls.refreshed.length, ACTIVE_COLLECTOR_JOBS.length);
  assert.ok(ACTIVE_COLLECTOR_JOBS.includes("digest"));
});

test("collector-refresh: jobs run one at a time (they share the request's connection budget), digest last after the views it summarizes", async () => {
  const started: string[] = [];
  let running = 0;
  let peak = 0;
  const w = world({
    refresh: async ([job]) => {
      started.push(job!);
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return [{ job: job!, status: "ok", ms: 1 }];
    },
  });
  const response = await w.send("/api/internal/collector-refresh?job=digest&job=github-repo&job=site-deployments", { client: DEPLOYER });
  assert.deepEqual((await json(response) as { outcomes: CollectorJobOutcome[] }).outcomes.map((outcome) => outcome.job), ["digest", "github-repo", "site-deployments"]);
  assert.deepEqual(started, ["github-repo", "site-deployments", "digest"]);
  assert.equal(peak, 1);
});

test("collector-refresh: ?job= narrows the run, and a failing job turns ok false without hiding the rest", async () => {
  const w = world();
  const narrowed = await w.send("/api/internal/collector-refresh?job=digest&job=digest&job=pagespeed", { client: DEPLOYER });
  assert.deepEqual(w.calls.refreshed, [["pagespeed"], ["digest"]]);
  assert.equal((await json(narrowed) as { ok: boolean }).ok, true);

  const failing = world({
    refresh: async ([job]) => {
      if (job === "digest") throw new Error("ai unavailable");
      return [{ job: job!, status: job === "pagespeed" ? "error" : "ok", ms: 1 }];
    },
  });
  const response = await failing.send("/api/internal/collector-refresh?job=digest&job=pagespeed&job=github-chart", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    ok: false,
    outcomes: [
      { job: "digest", status: "error", detail: "ai unavailable", ms: 0 },
      { job: "pagespeed", status: "error", ms: 1 },
      { job: "github-chart", status: "ok", ms: 1 },
    ],
  });
});

test("collector-refresh: POST only, needs its own permission, and says so when the collector is not bound", async () => {
  const w = world();
  assert.equal((await w.send("/api/internal/collector-refresh", { method: "GET", client: DEPLOYER })).status, 405);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: null })).status, 401);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: ALL })).status, 403, "report tokens cannot trigger collection");
  assert.equal(w.calls.refreshed.length, 0);
  const unbound = await world({ collector: false }).send("/api/internal/collector-refresh", { client: DEPLOYER });
  assert.equal(unbound.status, 503);
  assert.deepEqual(await json(unbound), { ok: false, error: "没有绑定采集 Worker" });
});
