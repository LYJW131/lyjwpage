import assert from "node:assert/strict";
import test from "node:test";

import {
  absoluteQuantile,
  collectorPlays,
  loadRecordedSession,
  recordedTruth,
  replayAtCadence,
  scoreReplay,
} from "@/lib/testing/listening-replay";

const session = loadRecordedSession();
const truth = recordedTruth(session);

test("a recorded iPhone session polled once a minute: plays elsewhere name the right song nearly all the time and start within seconds", () => {
  const { coverage, startErrorsMs, missed } = replayAtCadence(session, truth, 60_000);
  assert.equal(missed, 0, "every song that started between two polls is drawn");
  assert.ok(Math.min(...coverage) >= 0.93, `worst phase names the right song ${Math.min(...coverage)}`);
  assert.ok(coverage.reduce((sum, value) => sum + value, 0) / coverage.length >= 0.95);
  assert.ok(absoluteQuantile(startErrorsMs, 0.5) <= 10_000, `median start error ${absoluteQuantile(startErrorsMs, 0.5)} ms`);
  assert.ok(absoluteQuantile(startErrorsMs, 0.9) <= 25_000, `p90 start error ${absoluteQuantile(startErrorsMs, 0.9)} ms`);
});

test("the windows the production collector recorded during the same session line up just as well", () => {
  const range = { from: session.startedAt + session.collector[0][0], to: session.startedAt + session.collector.at(-1)![1] };
  const result = scoreReplay(truth, collectorPlays(session), range);
  assert.equal(result.matched, result.plays);
  assert.ok(result.coverage >= 0.95, `named the right song ${result.coverage}`);
  assert.ok(absoluteQuantile(result.startErrorsMs, 0.5) <= 10_000, `median start error ${absoluteQuantile(result.startErrorsMs, 0.5)} ms`);
  assert.ok(absoluteQuantile(result.startErrorsMs, 0.9) <= 25_000, `p90 start error ${absoluteQuantile(result.startErrorsMs, 0.9)} ms`);
});
