import assert from "node:assert/strict";
import test from "node:test";
import { codingWindowFeatures, parseCodingAnswers, parseCodingAssessment, parseCodingObservation, CODING_WINDOW_MS, codingQuestions } from "@shared/pulse-coding";
import type { CodingObservation } from "@shared/pulse-coding";
const T = 1_800_000_000_000;
const observation = (t: number, coding = true, agents = true): CodingObservation => ({ t, available: true,
  desktop: { application: coding ? "Zed" : "Safari", coding }, agents: [{ id: "codex", model: "model", active: agents }] });
function answer() { return { model: "jev-1.13.0", answers: {
  w0Intensity: { type: "score", score: 2.5, confidence: 0.4, probabilities: { 0: 0, 1: 0, 2: 0.5, 3: 0.5, 4: 0 } },
  w0Continuity: { type: "score", score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } },
  w0Mode: { type: "choice", choice: "mixed", confidence: 1, probabilities: { idle: 0, brief: 0, interactive: 0, agent: 0, mixed: 1 } },
} }; }

test("coding windows calculate duration and transitions before asking Jev", () => {
  const window = codingWindowFeatures([observation(T - 30_000), observation(T + 90_000, false, false), observation(T + 180_000)], T);
  assert.equal(window.observedSeconds, 300);
  assert.equal(window.codingAppSeconds, 210);
  assert.equal(window.agentActiveSeconds, 210);
  assert.equal(window.codingAppAndAgentSeconds, 210);
  assert.equal(window.foregroundSwitches, 2);
  assert.equal(window.activityTransitions, 2);
  assert.equal(window.longestCodingRunSeconds, 120);
  assert.deepEqual(window.coverage, [{ from: T, to: T + CODING_WINDOW_MS }]);
});
test("coding silence and offline declarations leave real gaps even when previous state was idle", () => {
  const window = codingWindowFeatures([observation(T, false, false)], T);
  assert.equal(window.observedSeconds, 180);
  assert.equal(window.unknownSeconds, 120);
  const offline = codingWindowFeatures([observation(T), { ...observation(T + 60_000), available: false }], T);
  assert.equal(offline.observedSeconds, 60);
  assert.deepEqual(offline.coverage, [{ from: T, to: T + 60_000 }]);
  assert.equal(codingWindowFeatures([observation(T - CODING_WINDOW_MS)], T).observedSeconds, 0);
});
test("coding preserves continuous scores, all distributions, coverage and actual model version", () => {
  const window = codingWindowFeatures([observation(T)], T);
  const [record] = parseCodingAnswers(answer(), [window], T + CODING_WINDOW_MS);
  assert.equal(record.intensity.value, 2.5);
  assert.equal(record.intensity.probabilities["3"], 0.5);
  assert.deepEqual(parseCodingAssessment(JSON.stringify(record)), record);
  assert.equal(JSON.stringify(record).includes("Zed"), false);
  assert.equal(Object.keys(codingQuestions([window])).length, 3);
});
test("coding rejects malformed model output rather than saving fake zeroes", () => {
  const window = codingWindowFeatures([observation(T)], T);
  const bad = answer(); bad.answers.w0Intensity.score = 100;
  assert.throws(() => parseCodingAnswers(bad, [window], T + CODING_WINDOW_MS));
  const incomplete = answer(); delete (incomplete.answers as Record<string, unknown>).w0Mode;
  assert.throws(() => parseCodingAnswers(incomplete, [window], T + CODING_WINDOW_MS));
  const probabilities = answer(); probabilities.answers.w0Intensity.probabilities["2"] = 0.1;
  assert.throws(() => parseCodingAnswers(probabilities, [window], T + CODING_WINDOW_MS));
  assert.equal(parseCodingAssessment('{}'), null);
  assert.equal(parseCodingObservation('{"t":5,"available":true,"agents":[null]}'), null);
});
