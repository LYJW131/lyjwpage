import assert from "node:assert/strict";
import test from "node:test";

import type { PulsePayload } from "@shared/types";

import { STRIP_BINS, topicStrip } from "./digest-strips.ts";

const HOUR = 3_600;
const empty = { startSec: [], endSec: [] };

function pulse(lanes: Partial<Record<"coding" | "listening" | "tokens", unknown>>): PulsePayload {
  return {
    generatedAt: 0,
    window: { from: 0, to: 24 * HOUR * 1000 },
    lanes: {
      coding: { kind: "coding", segments: { ...empty, value: [], agentSources: [] } },
      tokens: { kind: "tokens", buckets: { ...empty, total: [], output: [], cacheRead: [] } },
      listening: { kind: "state", segments: { ...empty, state: [], title: [], subtitle: [] } },
      watching: { kind: "state", segments: { ...empty, state: [], title: [], subtitle: [] } },
      gaming: { kind: "state", segments: { ...empty, state: [], title: [], subtitle: [] } },
      activity: { kind: "steps", buckets: { ...empty, steps: [] }, workouts: { ...empty, activityType: [] } },
      ...lanes,
    },
  } as unknown as PulsePayload;
}

test("a span fills the half-hour bins it covers, partly at its edges", () => {
  const strip = topicStrip("music", pulse({
    listening: { kind: "state", segments: { startSec: [HOUR + 900], endSec: [2 * HOUR], state: [2], title: [null], subtitle: [null] } },
  }));
  assert.equal(strip?.length, STRIP_BINS);
  assert.deepEqual(strip?.slice(1, 5), [0, 0.5, 1, 0]);
});

test("paused music and human-only coding stay out of the music and agents strips", () => {
  const segments = { startSec: [0], endSec: [HOUR], title: [null], subtitle: [null] };
  assert.equal(topicStrip("music", pulse({ listening: { kind: "state", segments: { ...segments, state: [1] } } })), null);
  const coding = pulse({ coding: { kind: "coding", segments: { startSec: [0], endSec: [HOUR], value: [1], agentSources: [0] } } });
  assert.equal(topicStrip("agents", coding), null);
  assert.equal(topicStrip("coding", coding)?.[0], 1);
});

test("token bars are scaled to the day's busiest bin, and topics without a lane get no strip", () => {
  const strip = topicStrip("tokens", pulse({
    tokens: { kind: "tokens", buckets: { startSec: [0, 60, 10 * HOUR], endSec: [60, 120, 10 * HOUR + 60], total: [100, 100, 400], output: [], cacheRead: [] } },
  }));
  assert.equal(strip?.[0], 0.5);
  assert.equal(strip?.[20], 1);
  assert.equal(topicStrip("site", pulse({})), null);
});

test("inferred Apple plays alone still draw the music strip", () => {
  const strip = topicStrip("music", pulse({
    listening: {
      kind: "state",
      segments: { startSec: [], endSec: [], state: [], title: [], subtitle: [] },
      uncertain: { startSec: [HOUR], endSec: [2 * HOUR], title: [null], subtitle: [null], marginSec: [0] },
    },
  }));
  assert.ok(strip && strip.some((value) => value > 0));
});
