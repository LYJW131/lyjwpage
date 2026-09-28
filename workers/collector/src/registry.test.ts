import assert from "node:assert/strict";
import { test } from "node:test";

import { COLLECTOR_JOBS } from "@shared/collector";

import type { Env } from "./env";
import type { Job } from "./job";
import { JOBS, dueJobs, runJob, runNamed, runScheduled, type MonitorRunner } from "./registry";
import { checkinCrontab, checkinDue, checkinEveryMinutes, isDue, monitorConfig, monitorSlug } from "./schedule";

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
  assert.deepEqual(JOBS.map((job) => job.name).sort(), [...COLLECTOR_JOBS].sort());
  for (const job of JOBS) {
    assert.equal(60 % job.everyMinutes, 0, job.name);
    assert.ok(job.offset >= 0 && job.offset < job.everyMinutes, job.name);
    assert.ok(job.maxRuntimeMinutes > 0, job.name);
  }
  // 一小时里每个任务跑的次数正好是 60 / 周期
  const hour = at("2026-09-28T10:00:00Z");
  for (const job of JOBS) {
    const runs = Array.from({ length: 60 }, (_, m) => hour + m * 60_000).filter((time) => dueJobs(time).includes(job)).length;
    assert.equal(runs, 60 / job.everyMinutes, job.name);
  }
});

test("check-ins happen at most every five minutes and only on runs the job actually makes", () => {
  const hour = at("2026-09-28T10:00:00Z");
  for (const job of JOBS) {
    const every = checkinEveryMinutes(job);
    assert.ok(every >= 5 && every % job.everyMinutes === 0, job.name);
    const checkins = Array.from({ length: 60 }, (_, m) => hour + m * 60_000).filter((time) => checkinDue(job, time));
    assert.equal(checkins.length, 60 / every, job.name);
    for (const time of checkins) assert.ok(isDue(job, time), `${job.name} checks in on a minute it does not run`);
  }
  assert.equal(checkinEveryMinutes({ everyMinutes: 1 }), 5);
  assert.equal(checkinEveryMinutes({ everyMinutes: 2 }), 10);
  assert.equal(checkinEveryMinutes({ everyMinutes: 15 }), 15);
});

test("monitor crontabs match the check-in minutes", () => {
  assert.equal(checkinCrontab({ everyMinutes: 1, offset: 0 }), "*/5 * * * *");
  assert.equal(checkinCrontab({ everyMinutes: 2, offset: 0 }), "*/10 * * * *");
  assert.equal(checkinCrontab({ everyMinutes: 10, offset: 1 }), "1-59/10 * * * *");
  assert.equal(checkinCrontab({ everyMinutes: 30, offset: 2 }), "2-59/30 * * * *");
  assert.equal(checkinCrontab({ everyMinutes: 60, offset: 7 }), "7 * * * *");
  const config = monitorConfig({ everyMinutes: 15, offset: 3, maxRuntimeMinutes: 2 });
  assert.deepEqual(config, {
    schedule: { type: "crontab", value: "3-59/15 * * * *" },
    checkinMargin: 3,
    maxRuntime: 2,
    timezone: "UTC",
    failureIssueThreshold: 2,
    recoveryThreshold: 1,
  });
  assert.equal(monitorSlug({ name: "provider-status" }), "collector-provider-status");
});

const env = {} as Env;

function fakeJob(run: Job["run"], overrides: Partial<Job> = {}): Job {
  return { name: "github-chart", everyMinutes: 10, offset: 1, maxRuntimeMinutes: 2, run, ...overrides };
}

/** 记下每次报到和它的结局，行为照 Sentry.withMonitor：抛了就是 error、原样再抛 */
function recordingMonitor() {
  const checkins: { slug: string; status: "ok" | "error"; schedule: string }[] = [];
  const monitor: MonitorRunner = async (slug, run, config) => {
    try {
      const value = await run();
      checkins.push({ slug, status: "ok", schedule: config.schedule.value });
      return value;
    } catch (error) {
      checkins.push({ slug, status: "error", schedule: config.schedule.value });
      throw error;
    }
  };
  return { monitor, checkins };
}

test("a job failure becomes an error outcome and an error check-in instead of rejecting", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { monitor, checkins } = recordingMonitor();
  const result = await runJob(fakeJob(async () => { throw new Error("upstream 503"); }), env, { monitor });
  assert.equal(result.status, "error");
  assert.equal(result.detail, "upstream 503");
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(checkins, [{ slug: "collector-github-chart", status: "error", schedule: "1-59/10 * * * *" }]);
});

test("a known upstream outage is still an error check-in but is logged at warn", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const warnings = t.mock.method(console, "warn", () => {});
  const { monitor, checkins } = recordingMonitor();
  const outage = Object.assign(new Error("PSN 上游不可用（presence）"), { outage: true });
  const result = await runJob(fakeJob(async () => { throw outage; }), env, { monitor });
  assert.equal(result.status, "error");
  assert.equal(errors.mock.callCount(), 0);
  assert.equal(warnings.mock.callCount(), 1);
  assert.deepEqual(checkins.map((row) => row.status), ["error"]);
});

test("a skip that asks the monitor to fail stays a skip in the outcome but checks in as error", async () => {
  const failing = fakeJob(async () => ({ status: "skipped", detail: "backoff", failing: "PSN 已连续 3 轮失败" }));
  const { monitor, checkins } = recordingMonitor();
  const outcome = await runJob(failing, env, { monitor });
  assert.deepEqual({ ...outcome, ms: 0 }, { job: "github-chart", status: "skipped", detail: "PSN 已连续 3 轮失败", ms: 0 });
  assert.deepEqual(checkins.map((row) => row.status), ["error"]);
  // 手动触发不报到，也就不必把跳过翻成失败
  assert.equal((await runJob(failing, env)).detail, "backoff");
});

test("a scheduled tick runs only due jobs and checks in only on check-in minutes", async () => {
  const ran: string[] = [];
  const job = (name: Job["name"], everyMinutes: number, offset: number) =>
    fakeJob(async () => { ran.push(name); return { status: "ok" }; }, { name, everyMinutes, offset });
  const jobs = [job("provider-status", 1, 0), job("apple-recent", 2, 0), job("github-chart", 10, 1)];

  const { monitor, checkins } = recordingMonitor();
  // 10:02：每分钟和每两分钟的都跑；分钟任务要等 10:05 才报到，两分钟那个要等 10:10
  await runScheduled(env, at("2026-09-28T10:02:00Z"), { monitor, jobs });
  assert.deepEqual(ran.sort(), ["apple-recent", "provider-status"]);
  assert.equal(checkins.length, 0);

  ran.length = 0;
  const outcomes = await runScheduled(env, at("2026-09-28T10:10:00Z"), { monitor, jobs });
  assert.deepEqual(outcomes.map((row) => row.status), ["ok", "ok"]);
  assert.deepEqual(checkins.map((row) => row.slug).sort(), ["collector-apple-recent", "collector-provider-status"]);

  checkins.length = 0;
  await runScheduled(env, at("2026-09-28T10:11:00Z"), { monitor, jobs });
  assert.deepEqual(checkins.map((row) => row.slug), ["collector-github-chart"]);
});

test("named runs report unknown jobs without throwing and dedupe names", async () => {
  const results = await runNamed(env, ["nope", "nope"]);
  assert.deepEqual(results, [{ job: "nope", status: "error", detail: "unknown job", ms: 0 }]);
});
