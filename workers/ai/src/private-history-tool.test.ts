import assert from "node:assert/strict";
import test from "node:test";

import { historyText, parseHistoryInput, parseHistoryTime, PRIVATE_HISTORY_TOOL, type ReadHistory } from "./tools/private-history.ts";
import { newLedger } from "./tools/registry.ts";

const NOW = Date.parse("2026-10-28T04:00:00Z");

test("不带时区的日期与时间按站点时区读，带时区的照写的算", () => {
  assert.equal(parseHistoryTime("2026-10-27"), Date.parse("2026-10-26T16:00:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30"), Date.parse("2026-10-27T00:30:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30:00Z"), Date.parse("2026-10-27T08:30:00Z"));
  assert.equal(parseHistoryTime("2026-10-27T08:30+09:00"), Date.parse("2026-10-26T23:30:00Z"));
  for (const bad of ["yesterday", "1730000000000", "", 1730000000000, null]) assert.equal(parseHistoryTime(bad), null, String(bad));
});

test("缺省读最近 7 天、100 行；坏输入回一句能照着改的话", () => {
  assert.deepEqual(parseHistoryInput({ table: "workouts" }, NOW), { table: "workouts", from: NOW - 7 * 86_400_000, to: NOW, limit: 100 });
  assert.match(parseHistoryInput({ table: "transcripts" }, NOW) as string, /Unknown table/);
  assert.match(parseHistoryInput({ table: "workouts", from: "2026-10-28", to: "2026-10-27" }, NOW) as string, /earlier/);
  assert.match(parseHistoryInput({ table: "workouts", limit: 501 }, NOW) as string, /limit/);
  assert.match(parseHistoryInput({ table: "workouts", from: "last week" }, NOW) as string, /ISO/);
});

test("列名转成 camelCase，时间列换成本地时间", () => {
  const query = { table: "charging_samples" as const, from: NOW - 3_600_000, to: NOW, limit: 5 };
  const text = historyText(query, { ok: true, rows: [{ t: NOW - 60_000, device_name: "iPhone", watts: 20 }], truncated: false }, NOW);
  assert.match(text, /"observedAt":"2026-10-28 11:59 \(today\)","deviceName":"iPhone","watts":20/);
  assert.match(historyText(query, { ok: false, error: "The history archive is not bound here." }, NOW), /not bound/);
});

// 照 core 的 readPrivateHistory：[from, to) 内按时间列从新到旧，多取一行判断截断。
function fakeArchive(rows: Record<string, unknown>[], time: string): ReadHistory {
  return async ({ from, to, limit }) => {
    const inRange = rows.filter((row) => (row[time] as number) >= from && (row[time] as number) < to)
      .sort((a, b) => (b[time] as number) - (a[time] as number));
    return { ok: true, rows: inRange.slice(0, limit), truncated: inRange.length > limit };
  };
}

async function readAll(readHistory: ReadHistory, limit: number) {
  const seen: string[] = [];
  let to: string | undefined;
  for (let page = 0; page < 20; page++) {
    const { text } = await PRIVATE_HISTORY_TOOL.run({ table: "listening_plays", from: "1970-01-01T00:00:00Z", ...(to && { to }), limit }, { readStatus: async () => new Response(), readDoc: async () => new Response(), readHistory }, newLedger());
    seen.push(...(JSON.parse(text.split("\n\n").at(-1) ?? "[]") as { title: string }[]).map((row) => row.title));
    to = /to set to "([^"]+)"/.exec(text)?.[1];
    if (!to) return { seen, stuck: /higher limit/.test(text) };
  }
  throw new Error("paging did not end");
}

test("照截断提示一页页续读，每行恰好读到一次；整页同一时刻时提示调大 limit", async () => {
  const plays = [3_000, 2_000, 1_500, 1_500, 1_000, 500].map((at, index) => ({ started_at: at, title: `p${index}` }));
  const archive = fakeArchive(plays, "started_at");
  for (const limit of [3, 4, 6]) {
    const { seen } = await readAll(archive, limit);
    assert.deepEqual(seen.toSorted(), plays.map((play) => play.title).toSorted(), `limit ${limit}`);
  }
  for (const limit of [1, 2]) assert.equal((await readAll(archive, limit)).stuck, true, `limit ${limit} 撞上两行同一时刻`);
});

test("day 表续读的 to 是最旧那天的下一天，那一天整组留到下一页", () => {
  const days = { table: "coding_usage_days" as const, from: 0, to: NOW, limit: 3 };
  const page = historyText(days, { ok: true, rows: [{ date: "2026-10-27" }, { date: "2026-10-26" }, { date: "2026-10-26" }], truncated: true }, NOW);
  assert.match(page, /^1 rows/m);
  assert.match(page, /from set to "1970-01-01T00:00:00.000Z" and to set to "2026-10-27"/);
  assert.equal((parseHistoryInput({ table: "coding_usage_days", to: "2026-10-27" }, NOW) as { to: number }).to, Date.parse("2026-10-26T16:00:00Z"));
});
