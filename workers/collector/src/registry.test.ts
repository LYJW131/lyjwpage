import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTIVE_COLLECTOR_JOBS, COLLECTOR_JOBS, RETIRED_COLLECTOR_JOBS } from "@shared/collector";

import type { Env } from "./env";
import type { Job } from "./job";
import { JOBS, dueJobs, isLateRound, runJob, runNamed, runScheduled } from "./registry";
import { isDue } from "./schedule";

const at = (iso: string) => Date.parse(iso);

test("a job is due when the epoch minute lands on its offset", () => {
  const hourly = { everyMinutes: 60, offset: 7 };
  assert.equal(isDue(hourly, at("2026-09-28T10:07:00Z")), true);
  assert.equal(isDue(hourly, at("2026-09-28T10:07:59Z")), true);
  assert.equal(isDue(hourly, at("2026-09-28T10:08:00Z")), false);
  const tenth = { everyMinutes: 10, offset: 1 };
  assert.deepEqual([0, 1, 11, 21, 30].map((m) => isDue(tenth, at(`2026-09-28T10:${String(m).padStart(2, "0")}:00Z`))), [false, true, true, true, false]);
  const minute = { everyMinutes: 1, offset: 0 };
  assert.equal(isDue(minute, at("2026-09-28T10:33:00Z")), true);
});

test("the registry covers every shared job name once, with periods that divide an hour", () => {
  const retired: readonly string[] = RETIRED_COLLECTOR_JOBS;
  assert.deepEqual(JOBS.map((job) => job.name).sort(), COLLECTOR_JOBS.filter((name) => !retired.includes(name)).sort());
  assert.deepEqual([...ACTIVE_COLLECTOR_JOBS].sort(), JOBS.map((job) => job.name).sort());
  for (const job of JOBS) {
    assert.equal(60 % job.everyMinutes, 0, job.name);
    assert.ok(job.offset >= 0 && job.offset < job.everyMinutes, job.name);
  }
  const hour = at("2026-09-28T10:00:00Z");
  for (const job of JOBS) {
    const runs = Array.from({ length: 60 }, (_, m) => hour + m * 60_000).filter((time) => dueJobs(time).includes(job)).length;
    assert.equal(runs, 60 / job.everyMinutes, job.name);
  }
});

const env = {} as Env;

function fakeJob(run: Job["run"], overrides: Partial<Job> = {}): Job {
  return { name: "github-chart", everyMinutes: 10, offset: 1, run, ...overrides };
}

test("a job failure becomes an error outcome and an error log instead of rejecting", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const result = await runJob(fakeJob(async () => { throw new Error("upstream 503"); }), env);
  assert.equal(result.status, "error");
  assert.equal(result.detail, "upstream 503");
  assert.equal(logged.mock.callCount(), 1);
  const { ms, ...line } = JSON.parse(String(logged.mock.calls[0].arguments[0]));
  assert.deepEqual(line, { event: "collector-job", job: "github-chart", status: "error", detail: "upstream 503" });
  assert.equal(typeof ms, "number");
});

test("a known upstream outage is logged at warn so it does not open an issue", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const warnings = t.mock.method(console, "warn", () => {});
  const outage = Object.assign(new Error("PSN 上游不可用（presence）"), { outage: true });
  const result = await runJob(fakeJob(async () => { throw outage; }), env);
  assert.equal(result.status, "error");
  assert.equal(errors.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 1);
});

test("a scheduled tick runs only due jobs", async () => {
  const ran: string[] = [];
  const job = (name: Job["name"], everyMinutes: number, offset: number) =>
    fakeJob(async () => { ran.push(name); return { status: "ok" }; }, { name, everyMinutes, offset });
  const jobs = [job("provider-status", 1, 0), job("apple-recent", 2, 0), job("github-chart", 10, 1)];

  await runScheduled(env, at("2026-09-28T10:02:00Z"), { jobs });
  assert.deepEqual(ran.sort(), ["apple-recent", "provider-status"]);

  ran.length = 0;
  const outcomes = await runScheduled(env, at("2026-09-28T10:11:00Z"), { jobs });
  assert.deepEqual(outcomes.map((row) => row.status), ["ok", "ok"]);
  assert.deepEqual(ran.sort(), ["github-chart", "provider-status"]);
});

test("a head-start job gets going before the rest, which wait for it or the head-start window", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = fakeJob(async () => { order.push("ps:start"); await gate; order.push("ps:gate"); return { status: "ok" }; }, { name: "pagespeed", everyMinutes: 1, offset: 0, headStart: true });
  const other = fakeJob(async () => { order.push("other"); return { status: "ok" }; }, { name: "provider-status", everyMinutes: 1, offset: 0 });

  setTimeout(release, 5);
  await runScheduled(env, at("2026-09-28T10:02:00Z"), { jobs: [other, first], headStartMs: 1_000 });
  assert.deepEqual(order, ["ps:start", "ps:gate", "other"]);

  order.length = 0;
  const stuck = fakeJob(async () => { order.push("ps:start"); await new Promise((resolve) => setTimeout(resolve, 50)); order.push("ps:done"); return { status: "ok" }; }, { name: "pagespeed", everyMinutes: 1, offset: 0, headStart: true });
  await runScheduled(env, at("2026-09-28T10:02:00Z"), { jobs: [other, stuck], headStartMs: 5 });
  assert.deepEqual(order, ["ps:start", "other", "ps:done"]);
});

test("named runs report unknown jobs without throwing and dedupe names", async () => {
  const results = await runNamed(env, ["nope", "nope"]);
  assert.deepEqual(results, [{ job: "nope", status: "error", detail: "unknown job", ms: 0 }]);
});

test("retired job names stay callable as skipped and never join the schedule", async () => {
  const outcomes = await runNamed({} as Env, ["vercel-deployments", "vercel-metrics", "nope"]);
  assert.deepEqual(outcomes.map(({ job, status }) => [job, status]), [
    ["vercel-deployments", "skipped"],
    ["vercel-metrics", "skipped"],
    ["nope", "error"],
  ]);
  const hour = at("2026-09-28T10:00:00Z");
  for (let m = 0; m < 60; m++) {
    assert.ok(dueJobs(hour + m * 60_000).every((job) => !(RETIRED_COLLECTOR_JOBS as readonly string[]).includes(job.name)));
  }
});

test("平台约 15 分钟后带原 scheduledTime 重投的一轮算迟到，准点或晚几秒开跑的不算", () => {
  const scheduled = at("2026-10-21T08:03:29Z");
  assert.equal(isLateRound(scheduled, scheduled + 1_500), false);
  assert.equal(isLateRound(scheduled, scheduled + 60_000), false);
  assert.equal(isLateRound(scheduled, at("2026-10-21T08:18:33Z")), true);
});
