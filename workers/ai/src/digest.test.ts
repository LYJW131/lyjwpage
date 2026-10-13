import assert from "node:assert/strict";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { STATUS_VIEWS } from "@shared/status-views";

import { cleanDigestText, composeDigest, DIGEST_MAX_CHARS, DIGEST_SYSTEM_PROMPT, digestInputHash } from "./digest/compose";
import { digestFacts, type DigestViews } from "./digest/facts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-13T06:20:00Z");
const FROM = NOW - DAY;

const span = (startHour: number, minutes: number) => ({ startSec: startHour * 3_600, endSec: startHour * 3_600 + minutes * 60 });

function stateLane(plays: { at: number; minutes: number; title: string; subtitle: string | null }[], elsewhere: typeof plays = []) {
  const rows = plays.map((play) => ({ ...span(play.at, play.minutes), state: 2, title: play.title, subtitle: play.subtitle }));
  const columns = (list: typeof rows) => ({
    startSec: list.map((row) => row.startSec),
    endSec: list.map((row) => row.endSec),
    state: list.map((row) => row.state),
    title: list.map((row) => row.title),
    subtitle: list.map((row) => row.subtitle),
  });
  const traces = elsewhere.map((play) => ({ ...span(play.at, play.minutes), title: play.title, subtitle: play.subtitle }));
  const all = [...plays, ...elsewhere];
  return {
    kind: "state",
    segments: columns(rows),
    ...(elsewhere.length ? {
      uncertain: {
        startSec: traces.map((row) => row.startSec),
        endSec: traces.map((row) => row.endSec),
        title: traces.map((row) => row.title),
        subtitle: traces.map((row) => row.subtitle),
        marginSec: traces.map(() => 30),
      },
    } : {}),
    summary: { activeSeconds: all.reduce((sum, play) => sum + play.minutes * 60, 0), titles: new Set(all.map((play) => play.title)).size },
  };
}

function baseViews(): DigestViews {
  const songs = Array.from({ length: 40 }, (_, index) => ({ at: 1 + index * 0.1, minutes: 4, title: `Song ${index % 12}`, subtitle: "Hoshimachi Suisei" }));
  return {
    pulse: {
      generatedAt: NOW,
      window: { from: FROM, to: NOW },
      lanes: {
        coding: {
          kind: "coding",
          segments: { startSec: [], endSec: [], value: [], agentSources: [] },
          assessments: { startSec: [], endSec: [], intensity: [], confidence: [], mode: [] },
          summary: { humanSeconds: 2 * 3_600, agentSeconds: 3 * 3_600, bothSeconds: 4 * 3_600 },
        },
        tokens: {
          kind: "tokens",
          buckets: { startSec: [], endSec: [], fresh: [], output: [], cacheRead: [] },
          summary: { peakPerMinute: null, currentPerMinute: null, freshTokens: 41_522_932 },
        },
        listening: stateLane(
          [...songs, { at: 9, minutes: 30, title: "GUM&DROP", subtitle: "Hoshimachi Suisei" }],
          [{ at: 12, minutes: 25, title: "Chatter Chatter", subtitle: "Houshou Marine & Hoshimachi Suisei" }],
        ),
        watching: stateLane([
          { at: 20, minutes: 24, title: "辉夜大小姐想让我告白", subtitle: "S3:E4 · 『燕的子安贝」篇①』" },
          { at: 20.5, minutes: 24, title: "辉夜大小姐想让我告白", subtitle: "S3:E5 · 石上优想要回应" },
        ]),
        gaming: stateLane([]),
        charging: { kind: "power", segments: { startSec: [], endSec: [], watts: [] }, currentPowerW: null, summary: { peakW: null, energyWh: 0 } },
        activity: { kind: "steps", buckets: { startSec: [], endSec: [], steps: [] }, workouts: { startSec: [], endSec: [], activityType: [] }, summary: { steps: 3_255 } },
      },
    } as unknown as DigestViews["pulse"],
    timezone: { timezone: { identifier: "Asia/Singapore", abbreviation: "SGT", secondsFromGMT: 28_800, observedAt: NOW }, snapshotAt: NOW },
    activity: null,
    workouts: {
      pushedAt: NOW,
      items: [{ id: "w1", activityType: "Walking", startedAt: NOW - 8 * DAY - 2 * HOUR, endedAt: NOW - 8 * DAY, secondsFromGMT: 28_800, durationSeconds: 5_790, distanceMeters: 8_175, activeEnergyKcal: 457, elevationAscendedMeters: null, indoor: false }],
    },
    coding: null,
    codingNow: {
      agents: [
        { id: "claude", activity: [{ source: "agents-otlp", lastActivityAt: NOW - 60_000, model: "claude-opus-5-5" }] },
        { id: "pi", activity: [{ source: "mac", lastActivityAt: NOW - 30 * DAY, model: "gpt" }] },
      ],
      lastSeenAt: NOW, declaredOffline: false, heartbeatWindowMs: 300_000,
    },
    trophies: null,
    githubRepo: null,
    siteDeployments: null,
  };
}

function reader(views: DigestViews) {
  const byPath = new Map<string, unknown>(Object.entries(views).map(([key, data]) => [STATUS_VIEWS[key as keyof typeof STATUS_VIEWS].path, data]));
  return async (path: string) => {
    const data = byPath.get(path);
    return data ? Response.json({ ok: true, data }) : Response.json({ ok: false, error: "Unknown status view." }, { status: 404 });
  };
}

function message(text: string, stop: Anthropic.Message["stop_reason"] = "end_turn"): Anthropic.Message {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop, stop_sequence: null,
  } as unknown as Anthropic.Message;
}

test("facts keep the day's highlights, in the owner's time zone, and leave empty lanes out", () => {
  const facts = digestFacts(baseViews(), NOW);
  assert.match(facts, /^Now: Tuesday afternoon in LYJW's time zone \(Asia\/Singapore\)/);
  assert.match(facts, /Coding: active 9 h of the 24 h; a coding app in front on LYJW's Mac 6 h, AI agents working 7 h/);
  assert.match(facts, /Coding agents used: Claude Code \(Opus 5\.5\)\n/, "agents idle for the whole window are left out");
  assert.match(facts, /Tokens through the agents: 42M/);
  assert.match(facts, /Music: 3\.5 h, 14 tracks; top artists Hoshimachi Suisei \(3 h\), Houshou Marine & Hoshimachi Suisei \(25 min\); most played tracks GUM&DROP \(30 min\)/);
  assert.match(facts, /Watching on Emby: 50 min; 辉夜大小姐想让我告白 \[S3:E4, S3:E5\] \(50 min\)/);
  assert.doesNotMatch(facts, /Gaming|trophies|homepage's own code/);
  assert.match(facts, /Steps: 3,300 in 24 h; no workout \(last one: Walking, 8 days ago\)/);
});

test("facts round small changes away, so an unchanged hour keeps the same input hash", async () => {
  const before = baseViews();
  const after = baseViews();
  const coding = after.pulse!.lanes.coding.summary;
  coding.humanSeconds += 240;
  after.pulse!.lanes.activity.summary.steps += 30;
  after.pulse!.lanes.tokens.summary.freshTokens += 200_000;
  after.pulse!.window = { from: FROM + 20 * 60_000, to: NOW + 20 * 60_000 };
  assert.equal(digestFacts(after, NOW + 20 * 60_000), digestFacts(before, NOW));
  assert.equal(
    await digestInputHash("claude-sonnet-5-5", digestFacts(after, NOW + 20 * 60_000)),
    await digestInputHash("claude-sonnet-5-5", digestFacts(before, NOW)),
  );
  assert.notEqual(await digestInputHash("claude-haiku-5-5", digestFacts(before, NOW)), await digestInputHash("claude-sonnet-5-5", digestFacts(before, NOW)));
});

test("an unknown time zone falls back to the site's", () => {
  const views = baseViews();
  views.timezone = { timezone: { identifier: "Mars/Olympus", abbreviation: null, secondsFromGMT: 0, observedAt: NOW }, snapshotAt: NOW };
  assert.match(digestFacts(views, NOW), /^Now: Tuesday afternoon in LYJW's time zone \(Asia\/Shanghai\)/);
});

test("compose calls the model once per new input and keeps the old digest while the facts stand still", async () => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createMessage = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    return message("“LYJW spent **most of the day** coding.\n\nSuisei kept them company.”");
  };
  const readStatus = reader(baseViews());

  const first = await composeDigest({ readStatus, createMessage, previousInputHash: null, now: NOW });
  assert.equal(first.status, "composed");
  if (first.status !== "composed") return;
  assert.equal(first.digest.text, "LYJW spent most of the day coding. Suisei kept them company.");
  assert.equal(first.digest.model, "claude-sonnet-5-5");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].system, DIGEST_SYSTEM_PROMPT);
  assert.deepEqual(calls[0].output_config, { effort: "low" });
  assert.equal(calls[0].messages[0].content, digestFacts(baseViews(), NOW));

  assert.deepEqual(await composeDigest({ readStatus, createMessage, previousInputHash: first.digest.inputHash, now: NOW }), { status: "unchanged" });
  assert.equal(calls.length, 1);
});

test("compose fails the round instead of publishing a refusal, a cut-off answer or a digest without the pulse view", async () => {
  const readStatus = reader(baseViews());
  for (const stop of ["refusal", "max_tokens"] as const) {
    await assert.rejects(
      composeDigest({ readStatus, createMessage: async () => message("Partial", stop), previousInputHash: null, now: NOW }),
      new RegExp(stop),
    );
  }
  await assert.rejects(
    composeDigest({ readStatus, createMessage: async () => message("  "), previousInputHash: null, now: NOW }),
    /no usable text/,
  );
  const withoutPulse = { ...baseViews(), pulse: null };
  await assert.rejects(
    composeDigest({ readStatus: reader(withoutPulse), createMessage: async () => message("x"), previousInputHash: null, now: NOW }),
    /Pulse view unavailable/,
  );
});

test("an overlong answer is cut at a sentence end, never mid-sentence", () => {
  const sentence = "LYJW coded with Claude Code for most of the day while agents kept working through the night. ";
  const text = cleanDigestText(sentence.repeat(8));
  assert.ok(text.length <= DIGEST_MAX_CHARS);
  assert.ok(text.endsWith("night."));
  assert.equal(cleanDigestText("Short and sweet."), "Short and sweet.");
});
