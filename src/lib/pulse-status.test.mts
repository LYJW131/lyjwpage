import assert from "node:assert/strict";
import test from "node:test";

import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { getPulseStatus } from "@/lib/pulse";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { columnRows } from "@/lib/pulse-columns";
import {
  pulseActivityKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseListeningTracesKey,
  pulseWorkoutsKey,
} from "@/lib/pulse-keys";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { addBucketDeltas, mergeBucketReport } from "@shared/coding-buckets";
import { codingBucketsKey } from "@shared/coding-store";
import type { CodingTokenBucketReport, CodingTokenBucketRow } from "@shared/coding-usage";
import type { PulseAssessment } from "@shared/pulse-assessment";
import { LISTENING_TRACE_LAG_MS } from "@shared/pulse-listening";

const NOW = 1_800_000_000_000;
const FROM = NOW - 24 * 3_600_000;
const M = 60_000;
const sec = (at: number) => Math.round((at - FROM) / 1000);

async function withStorage(run: (storage: FakeStorage) => Promise<void>) {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try { await run(storage); } finally { resetStorageForTests(); }
}

test("empty storage is an all-unknown timeline, not an error", async () => {
  await withStorage(async () => {
    const payload = await getPulseStatus(NOW);
    assert.deepEqual(payload.window, { from: FROM, to: NOW });
    assert.deepEqual(payload.lanes.listening.segments, { startSec: [], endSec: [], state: [], title: [], subtitle: [] });
    assert.deepEqual(payload.lanes.listening.uncertain, { startSec: [], endSec: [], title: [], subtitle: [], marginSec: [] });
    assert.equal(payload.lanes.charging.currentPowerW, null);
    assert.deepEqual(payload.lanes.coding.summary, { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 });
    assert.deepEqual(payload.lanes.tokens, {
      kind: "tokens",
      buckets: { startSec: [], endSec: [], fresh: [], output: [], cacheRead: [] },
      summary: { peakPerMinute: null, currentPerMinute: null, freshTokens: 0 },
    });
  });
});

function tokens(id: string, model: string | null, input: number, output: number, cacheRead: number, cacheCreation: number): CodingTokenBucketRow {
  return { id, model, inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation, reasoningTokens: 0, eventCount: 1 };
}

function report(from: number, to: number, agents: string[], windows: Array<[number, CodingTokenBucketRow[]]>): CodingTokenBucketReport {
  return { from, to, collectedAt: to, agents: agents.map((id) => ({ id, state: "ok" as const })), windows: windows.map(([start, rows]) => ({ from: start, agents: rows })) };
}

test("tokens lane sums every source per bucket, drops the partial leading and window-cut buckets, clips the trailing one and hides names", async () => {
  await withStorage(async (storage) => {
    const mac = mergeBucketReport(null, report(NOW - 18 * M, NOW - 2 * M, ["codex", "claude"], [
      [NOW - 20 * M, [tokens("codex", "secret-model", 100, 10, 1000, 0)]],
      [NOW - 15 * M, [tokens("codex", "secret-model", 1000, 200, 5000, 30), tokens("claude", null, 2000, 300, 90000, 70)]],
      [NOW - 10 * M, [tokens("claude", null, 0, 0, 0, 0)]],
      [NOW - 5 * M, [tokens("claude", null, 600, 60, 0, 0)]],
    ]), NOW - 2 * M);
    const cursor = mergeBucketReport(null, report(NOW - 7 * M, NOW - M, ["cursor"], [[NOW - 5 * M, [tokens("cursor", "composer-2", 100, 10, 0, 0)]]]), NOW - M);
    const cloud = addBucketDeltas(null, [
      { at: NOW - 14 * M, id: "claude", model: "claude-fable-5", inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { at: FROM - 2 * M, id: "claude", model: "claude-fable-5", inputTokens: 9_999, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ], NOW - 3 * M);
    await storage.batch()
      .set(codingBucketsKey("mac"), JSON.stringify(mac))
      .set(codingBucketsKey("agents"), JSON.stringify(cursor))
      .set(codingBucketsKey("agents-otlp"), JSON.stringify(cloud))
      .execute();
    const lane = (await getPulseStatus(NOW)).lanes.tokens;
    assert.deepEqual(columnRows(lane.buckets, ["fresh", "output", "cacheRead"]), [
      { startSec: sec(NOW - 15 * M), endSec: sec(NOW - 10 * M), fresh: 4_000, output: 500, cacheRead: 95_000 },
      { startSec: sec(NOW - 5 * M), endSec: sec(NOW - M), fresh: 770, output: 70, cacheRead: 0 },
    ]);
    assert.deepEqual(lane.summary, { peakPerMinute: 800, currentPerMinute: 193, freshTokens: 4_770 });
    const wire = JSON.stringify(lane);
    for (const secret of ["secret-model", "composer-2", "claude", "codex", "cursor", "mac", "agents"]) assert.equal(wire.includes(secret), false, secret);
  });
});

test("tokens lane: an account source replaces that agent's device and environment rows; other agents still add", async () => {
  await withStorage(async (storage) => {
    const mac = mergeBucketReport(null, report(NOW - 20 * M, NOW - 2 * M, ["cursor", "claude", "codex"], [
      [NOW - 15 * M, [
        tokens("cursor", "composer-2", 5_000, 0, 0, 0),
        tokens("claude", null, 200, 0, 0, 0),
        tokens("codex", null, 40, 0, 0, 0),
      ]],
      [NOW - 10 * M, [
        tokens("cursor", "composer-2", 800, 0, 0, 0),
        tokens("claude", null, 300, 0, 0, 0),
      ]],
    ]), NOW - 2 * M);
    const account = mergeBucketReport(null, report(NOW - 20 * M, NOW - M, ["cursor"], [
      [NOW - 15 * M, [tokens("cursor", "composer-2", 100, 0, 0, 0)]],
    ]), NOW - M);
    const cloud = addBucketDeltas(null, [
      { at: NOW - 14 * M, id: "claude", model: null, inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { at: NOW - 14 * M, id: "cursor", model: null, inputTokens: 9_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { at: NOW - 9 * M, id: "claude", model: null, inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ], NOW - 3 * M);
    await storage.batch()
      .set(codingBucketsKey("mac"), JSON.stringify(mac))
      .set(codingBucketsKey("agents"), JSON.stringify(account))
      .set(codingBucketsKey("agents-otlp"), JSON.stringify(cloud))
      .execute();
    const lane = (await getPulseStatus(NOW)).lanes.tokens;
    assert.deepEqual(columnRows(lane.buckets, ["fresh", "output", "cacheRead"]), [
      { startSec: sec(NOW - 15 * M), endSec: sec(NOW - 10 * M), fresh: 390, output: 0, cacheRead: 0 },
      { startSec: sec(NOW - 10 * M), endSec: sec(NOW - 5 * M), fresh: 320, output: 0, cacheRead: 0 },
    ]);
    assert.equal(lane.summary.freshTokens, 710);
  });
});

test("tokens lane: a superseded source's fresh coverage is not a measured zero", async () => {
  await withStorage(async (storage) => {
    const mac = mergeBucketReport(null, report(NOW - 60 * M, NOW - M, ["cursor"], [
      [NOW - 50 * M, [tokens("cursor", null, 500, 0, 0, 0)]],
    ]), NOW - M);
    const account = mergeBucketReport(null, report(NOW - 60 * M, NOW - 30 * M, ["cursor"], [
      [NOW - 50 * M, [tokens("cursor", null, 100, 0, 0, 0)]],
    ]), NOW - 30 * M);
    await storage.batch()
      .set(codingBucketsKey("mac"), JSON.stringify(mac))
      .set(codingBucketsKey("agents"), JSON.stringify(account))
      .execute();
    const { summary } = (await getPulseStatus(NOW)).lanes.tokens;
    assert.equal(summary.freshTokens, 100);
    assert.equal(summary.currentPerMinute, null);
  });
});

test("tokens lane: the current rate is the last bucket's, or 0 when a source still covers the last ten minutes, or unknown", async () => {
  const current = async (to: number, extra: (storage: FakeStorage) => Promise<void> = async () => {}) => withStorage(async (storage) => {
    const mac = mergeBucketReport(null, report(NOW - 60 * M, to, ["claude"], [[NOW - 50 * M, [tokens("claude", null, 500, 0, 0, 0)]]]), to);
    await storage.set(codingBucketsKey("mac"), JSON.stringify(mac));
    await extra(storage);
    const { summary } = (await getPulseStatus(NOW)).lanes.tokens;
    assert.equal(summary.peakPerMinute, 100);
    assert.equal(summary.freshTokens, 500);
    result = summary.currentPerMinute;
  });
  let result: number | null | undefined;
  await current(NOW - M);
  assert.equal(result, 0, "the Mac scan covers the last ten minutes and saw nothing");
  await current(NOW - 30 * M);
  assert.equal(result, null, "nothing covers the last ten minutes: unknown, not zero");
  await current(NOW - 30 * M, async (storage) => {
    await storage.set(codingBucketsKey("agents-otlp"), JSON.stringify(addBucketDeltas(null, [], NOW - 2 * M)));
  });
  assert.equal(result, 0, "a Claude Code cloud export in the last ten minutes counts as coverage");
});

test("tokens lane ignores a corrupt bucket store instead of failing the whole payload", async () => {
  await withStorage(async (storage) => {
    await storage.set(codingBucketsKey("mac"), "{not json");
    const { tokens: lane, coding } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(lane.buckets.startSec, []);
    assert.deepEqual(coding.summary, { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 });
  });
});

test("coding band shows human, agent and both from raw observations; app and model names never leave", async () => {
  await withStorage(async (storage) => {
    const obs = (t: number, coding: boolean, active: boolean) => JSON.stringify({
      t, available: true, desktop: { application: "SecretEditor", coding }, agents: [{ id: "claude", model: "secret-model", active }],
    });
    await storage.append(codingObservationsKey(),
      obs(NOW - 60 * M, true, false), obs(NOW - 58 * M, true, true), obs(NOW - 56 * M, false, true),
      JSON.stringify({ t: NOW - 54 * M, available: false, desktop: null, agents: null }));
    await storage.append(cursorObservationsKey(), JSON.stringify({ t: NOW - 30 * M, available: true, lastActivityAt: NOW - 30 * M }));
    const scored: PulseAssessment = { domain: "coding", from: NOW - 60 * M, to: NOW - 45 * M, coverage: [{ from: NOW - 60 * M, to: NOW - 54 * M }],
      intensity: { value: 3, confidence: 0.876, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
      continuity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } },
      mode: { value: "mixed", confidence: 1, probabilities: { idle: 0, brief: 0, interactive: 0, agent: 0, mixed: 1 } },
      model: "jev-1.13.0", scoredAt: NOW, inputHash: "h" };
    await storage.append(pulseAssessmentsKey(), JSON.stringify(scored), JSON.stringify({ ...scored, domain: "listening" }));
    const { coding } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(coding.segments, ["value"]), [
      { startSec: sec(NOW - 60 * M), endSec: sec(NOW - 58 * M), value: 1 },
      { startSec: sec(NOW - 58 * M), endSec: sec(NOW - 56 * M), value: 3 },
      { startSec: sec(NOW - 56 * M), endSec: sec(NOW - 54 * M), value: 2 },
      { startSec: sec(NOW - 30 * M), endSec: sec(NOW - 25 * M), value: 2 },
      { startSec: sec(NOW - 25 * M), endSec: sec(NOW), value: 0 },
    ]);
    assert.deepEqual(coding.summary, { humanSeconds: 120, agentSeconds: 420, bothSeconds: 120 });
    assert.deepEqual(coding.assessments, { startSec: [sec(NOW - 60 * M)], endSec: [sec(NOW - 45 * M)], intensity: [3], confidence: [0.88], mode: ["mixed"] });
    const wire = JSON.stringify(coding);
    assert.equal(wire.includes("SecretEditor") || wire.includes("secret-model") || wire.includes("claude"), false);
  });
});

test("state lanes keep unknown apart from idle, expose titles only while active, and draw plays elsewhere the Mac cannot explain", async () => {
  await withStorage(async (storage) => {
    const music = (state: string, title: string | null, album: string | null) => ({ state, source: state === "idle" ? null : "mac", title, artist: title && "Hamilton", album, trackId: null });
    await storage.append(pulseLaneKey("listening"),
      JSON.stringify({ ...music("playing", "Helpless", "Hamilton"), from: NOW - 120 * M, to: NOW - 100 * M }),
      JSON.stringify({ ...music("paused", "Helpless", "Hamilton"), from: NOW - 100 * M, to: NOW - 90 * M }),
      JSON.stringify({ ...music("idle", null, null), from: NOW - 90 * M, to: NOW - 80 * M }));
    await storage.set(pulseLaneOpenKey("listening"), JSON.stringify({ ...music("playing", "Satisfied", "Hamilton"), from: NOW - 20 * M, seenAt: NOW - M }));
    await storage.append(pulseListeningTracesKey(),
      JSON.stringify({ since: FROM - 3 * M, t: FROM - M, title: "Wait for It", artist: "Hamilton", album: "Hamilton", itemId: "5", durationMs: 5 * M }),
      JSON.stringify({ since: NOW - 121 * M, t: NOW - 119 * M, title: "Helpless", artist: "Hamilton", album: "Hamilton", itemId: "1", durationMs: 4 * M }),
      JSON.stringify({ since: NOW - 88 * M, t: NOW - 86 * M, title: "Helpless", artist: "Hamilton", album: "Hamilton", itemId: "1", durationMs: 4 * M }),
      JSON.stringify({ since: NOW - 60 * M, t: NOW - 58 * M, title: "Satisfied", artist: "Hamilton", album: "Hamilton", itemId: "3", durationMs: 5 * M }),
      JSON.stringify({ since: NOW - 50 * M, t: NOW - 48 * M, title: "Yoru ni Kakeru", artist: "YOASOBI", album: "THE BOOK", itemId: "2", durationMs: 4 * M }),
      JSON.stringify({ since: NOW - 23 * M, t: NOW - 21 * M, title: "Satisfied", artist: "Renée Elise Goldsberry", album: "Live", itemId: "4", durationMs: 5 * M }));
    const { listening } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(listening.segments, ["state", "title", "subtitle"]), [
      { startSec: sec(NOW - 120 * M), endSec: sec(NOW - 100 * M), state: 2, title: "Helpless", subtitle: "Hamilton" },
      { startSec: sec(NOW - 100 * M), endSec: sec(NOW - 90 * M), state: 1, title: "Helpless", subtitle: "Hamilton" },
      { startSec: sec(NOW - 90 * M), endSec: sec(NOW - 80 * M), state: 0, title: null, subtitle: null },
      { startSec: sec(NOW - 20 * M), endSec: sec(NOW), state: 2, title: "Satisfied", subtitle: "Hamilton" },
    ], "80–20 minutes ago has no segment: unknown");
    const lag = LISTENING_TRACE_LAG_MS;
    const margin = M / 1000;
    assert.deepEqual(columnRows(listening.uncertain!, ["title", "subtitle", "marginSec"]), [
      { startSec: 0, endSec: sec(FROM + 3 * M - lag), title: "Wait for It", subtitle: "Hamilton", marginSec: margin },
      { startSec: sec(NOW - 87 * M - lag), endSec: sec(NOW - 83 * M - lag), title: "Helpless", subtitle: "Hamilton", marginSec: margin },
      { startSec: sec(NOW - 59 * M - lag), endSec: sec(NOW - 54 * M - lag), title: "Satisfied", subtitle: "Hamilton", marginSec: margin },
      { startSec: sec(NOW - 49 * M - lag), endSec: sec(NOW - 45 * M - lag), title: "Yoru ni Kakeru", subtitle: "YOASOBI", marginSec: margin },
      { startSec: sec(NOW - 22 * M - lag), endSec: sec(NOW - 17 * M - lag), title: "Satisfied", subtitle: "Renée Elise Goldsberry", marginSec: margin },
    ], "the song the Mac was playing is not drawn twice; a list change while the Mac sat paused or idle, long before it played the song, or for another artist's song of the same name, is a play elsewhere");
    assert.deepEqual(listening.summary, { activeSeconds: 40 * 60 + 18 * 60, titles: 4 }, "time and tracks count the plays elsewhere too, including one detected before the window that plays into it");

    await storage.set(pulseLaneOpenKey("gaming"), JSON.stringify({ state: "online", titleId: null, title: null, from: NOW - 50 * M, seenAt: NOW - 30 * M }));
    const { gaming } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(gaming.segments, ["state", "title"]), [{ startSec: sec(NOW - 50 * M), endSec: sec(NOW), state: 1, title: null }],
      "PSN's 35-minute hold keeps a 30-minute-old confirmation current");
  });
});

test("charging draws measured watts with outages left empty; activity exposes step buckets and workouts", async () => {
  await withStorage(async (storage) => {
    await storage.append(pulseChargingKey(),
      JSON.stringify({ t: NOW - 60 * M, watts: 0 }),
      JSON.stringify({ t: NOW - 50 * M, watts: 65, device: "Private MacBook" }),
      JSON.stringify({ t: NOW - 45 * M, watts: 30, device: "Private MacBook" }));
    await storage.append(pulseActivityKey(),
      JSON.stringify({ from: FROM - 2 * M, to: FROM + 3 * M, steps: 500, moveKcal: 1, exerciseMinutes: null }),
      JSON.stringify({ from: NOW - 30 * M, to: NOW - 25 * M, steps: 812, moveKcal: 20, exerciseMinutes: 5 }),
      JSON.stringify({ from: NOW - 25 * M, to: NOW - 20 * M, steps: null, moveKcal: 3, exerciseMinutes: 0 }));
    await storage.set(pulseWorkoutsKey(), JSON.stringify({ items: [{ startedAt: NOW - 40 * M, endedAt: NOW - 20 * M, activityType: "Fencing" }] }));
    const { charging, activity } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(charging.segments, ["watts"]), [
      { startSec: sec(NOW - 60 * M), endSec: sec(NOW - 50 * M), watts: 0 },
      { startSec: sec(NOW - 50 * M), endSec: sec(NOW - 45 * M), watts: 65 },
      { startSec: sec(NOW - 45 * M), endSec: sec(NOW - 35 * M), watts: 30 },
    ]);
    assert.equal(charging.currentPowerW, null);
    assert.deepEqual(charging.summary, { peakW: 65, energyWh: 10.4 });
    assert.equal(JSON.stringify(charging).includes("Private"), false);
    assert.deepEqual(columnRows(activity.buckets, ["steps"]), [
      { startSec: 0, endSec: 180, steps: 500 },
      { startSec: sec(NOW - 30 * M), endSec: sec(NOW - 25 * M), steps: 812 },
    ], "buckets without a step count stay unknown");
    assert.deepEqual(activity.summary, { steps: 300 + 812 });
    assert.deepEqual(columnRows(activity.workouts, ["activityType"]), [{ startSec: sec(NOW - 40 * M), endSec: sec(NOW - 20 * M), activityType: "Fencing" }]);
  });
});

test("column rows reject a payload from another deploy instead of throwing", () => {
  type StateColumns = { startSec: number[]; endSec: number[]; state: number[] };
  assert.equal(columnRows({ startSec: [1], endSec: [2] } as unknown as StateColumns, ["state"]), null);
  assert.equal(columnRows<StateColumns>({ startSec: [1, 2], endSec: [2], state: [0, 1] }, ["state"]), null);
  assert.equal(columnRows<StateColumns>(undefined, ["state"]), null);
  assert.deepEqual(columnRows<StateColumns>({ startSec: [], endSec: [], state: [] }, ["state"]), []);
});

test("plays elsewhere: a run on the phone is laid out by song lengths, ends where the next song starts, and leaves the Mac's songs alone", async () => {
  await withStorage(async (storage) => {
    const S = 1000;
    const trace = (since: number, t: number, title: string, durationMs: number | null) =>
      JSON.stringify({ since: NOW - since * S, t: NOW - t * S, title, artist: "Artist", album: null, itemId: title, durationMs: durationMs && durationMs * S });
    await storage.append(pulseListeningTracesKey(),
      trace(3600, 3540, "A", 240),
      trace(3360, 3300, "B", 200),
      trace(3120, 3060, "C", 300),
      trace(3060, 3000, "D", 180),
      trace(1800, 1740, "E", 240),
      trace(600, 540, "F", null));
    await storage.append(pulseLaneKey("listening"),
      JSON.stringify({ state: "playing", source: "mac", title: "E", artist: "Artist", album: null, trackId: null, from: NOW - 1790 * S, to: NOW - 1550 * S }));
    const { listening } = (await getPulseStatus(NOW)).lanes;
    const at = (offset: number) => Math.round(offset - LISTENING_TRACE_LAG_MS / S);
    assert.deepEqual(columnRows(listening.uncertain!, ["title"])!.map((row) => [row.title, row.startSec - sec(NOW), row.endSec - sec(NOW)]), [
      ["A", at(-3550), at(-3310)],
      ["B", at(-3310), at(-3110)],
      ["C", at(-3110), at(-3030)],
      ["D", at(-3030), at(-2850)],
      ["F", at(-570), -540],
    ], "A–C back to back: their three windows put A's start in (−3570, −3530]; D started while C had time left; the Mac played E; F has no length and stops at its window");
  });
});
