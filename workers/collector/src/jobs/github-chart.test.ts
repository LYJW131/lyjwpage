import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";
import type { GithubChartPayload } from "@shared/types";

import type { Env } from "../env";
import { MemoryKv } from "../testing/memory-kv";
import { githubChartJob } from "./github-chart";

const now = 1_700_000_000_000;
const env = (lag: MemoryKv) => ({ LAG: lag.asKv(), GITHUB_TOKEN: "ghp_abc" }) as unknown as Env;

const DAYS = [
  { date: "2026-10-11", weekday: 0, contributionCount: 0 },
  { date: "2026-10-12", weekday: 1, contributionCount: 3 },
  { date: "2026-10-13", weekday: 2, contributionCount: 7 },
  { date: "2026-10-14", weekday: 3, contributionCount: 1 },
];

const calendar = { data: { user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: DAYS }] } } } } };

test("缺 GitHub 令牌干净跳过，空白令牌同样算缺", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await githubChartJob.run({ env: {} as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing GITHUB_TOKEN",
  });
  assert.deepEqual(await githubChartJob.run({ env: { GITHUB_TOKEN: "   " } as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing GITHUB_TOKEN",
  });
});

test("取回的日历按 origin 加逐日计数写进可滞后层，detail 报天数", async (t) => {
  const lag = new MemoryKv();
  let authorized: string | null = null;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    authorized = new Headers(init?.headers).get("Authorization");
    assert.equal(String(input), "https://api.github.com/graphql");
    return Response.json(calendar);
  });

  assert.deepEqual(await githubChartJob.run({ env: env(lag), now, scheduled: true }), { status: "ok", detail: "4 days" });
  assert.equal(authorized, "Bearer ghp_abc");
  const entry = await readLag<GithubChartPayload>(lag, LAG_KEYS.githubChart);
  assert.deepEqual(entry?.data, { origin: "2026-10-11", counts: [0, 3, 7, 1] });
});

test("贡献日历取数失败整轮抛错，不写可滞后层", async (t) => {
  t.mock.method(console, "error", () => {});
  const lag = new MemoryKv();
  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "Bad credentials" }] }));
  await assert.rejects(githubChartJob.run({ env: env(lag), now, scheduled: true }), /取数失败/);
  assert.equal(lag.puts.length, 0);
});
