import assert from "node:assert/strict";
import test from "node:test";
import { CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS } from "@shared/pulse-coding";
import { latestPulseAssessments, type PulseAssessment } from "@shared/pulse-assessment";
import { pulseAssessmentsKey } from "./pulse-assessments";
import { T, setup } from "./testing/pulse-score-harness";

function assessment(domain: "coding", from: number, scoredAt: number, inputHash = "hash"): PulseAssessment {
  return {
    domain,
    from,
    to: from + PULSE_SCORE_WINDOW_MS,
    coverage: [{ from, to: from + PULSE_SCORE_WINDOW_MS }],
    intensity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 } },
    continuity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } },
    mode: null,
    model: "clef-test",
    scoredAt,
    inputHash,
  };
}

test("pulse score state: concurrent instances claim once and a restart preserves eligibility", async () => {
  const b = setup();
  const firstState = b.coordinator();
  const restartedState = b.coordinator();
  const [first, second] = await Promise.all([
    firstState.claimPulseScore(),
    restartedState.claimPulseScore(),
  ]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(await restartedState.claimPulseScore(), null, "a new class instance sees the durable lease");

  b.advance(180_001);
  const replacement = await restartedState.claimPulseScore();
  assert.ok(replacement);
  assert.ok(replacement.generation > first.generation);
  assert.equal(await firstState.finishPulseScore(first.token, first.generation, []), false);
  assert.equal(await b.coordinator().claimPulseScore(), null, "the stale release did not clear the replacement");
  assert.equal(await restartedState.finishPulseScore(replacement.token, replacement.generation, []), true);
});

test("pulse score state: expired results cannot overwrite a replacement window", async () => {
  const b = setup();
  const firstState = b.coordinator();
  const first = await firstState.claimPulseScore();
  assert.ok(first);
  assert.equal(await firstState.activatePulseScore(first.token, first.generation), true);

  b.advance(CODING_WINDOW_MS + 1);
  const replacementState = b.coordinator();
  const replacement = await replacementState.claimPulseScore();
  assert.ok(replacement);
  assert.equal(await replacementState.activatePulseScore(replacement.token, replacement.generation), true);
  const from = T;
  const current = assessment("coding", from, b.now(), "replacement");
  assert.equal(await replacementState.finishPulseScore(replacement.token, replacement.generation, [current]), true);

  const stale = assessment("coding", from, first.now, "stale");
  assert.equal(await firstState.finishPulseScore(first.token, first.generation, [stale]), false);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].inputHash, "replacement");
});

test("pulse score state: commit merges at submit time and compacts a list past its cap to the newest rows", async () => {
  const b = setup();
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  const records = Array.from({ length: 10_001 }, (_, index) => assessment("coding", T - index * PULSE_SCORE_WINDOW_MS, b.now(), `hash-${index}`));
  const concurrent = assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "concurrent");
  await b.storage.append(pulseAssessmentsKey(), JSON.stringify(concurrent));
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, records), true);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.equal(saved.length, 2016);
  assert.ok(saved.some((record) => record.inputHash === "concurrent"));
});

async function finishWith(b: ReturnType<typeof setup>, records: PulseAssessment[]) {
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, records), true);
}

test("pulse score state: a round only appends its new results, never rewrites the list", async () => {
  const b = setup();
  const seeded = Array.from({ length: 20 }, (_, i) => JSON.stringify(assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `seed-${i}`)));
  await b.storage.append(pulseAssessmentsKey(), ...seeded);
  await finishWith(b, [assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "new")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 21);
  assert.deepEqual(rows.slice(0, 20), seeded, "existing rows are left in place");
});

test("pulse score state: a re-scored window is appended and the later row wins for every reader", async () => {
  const b = setup();
  const seeded = Array.from({ length: 20 }, (_, i) => JSON.stringify(assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `seed-${i}`)));
  await b.storage.append(pulseAssessmentsKey(), ...seeded);
  await finishWith(b, [assessment("coding", T, b.now(), "rescored")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 21);
  const latest = latestPulseAssessments(rows);
  assert.equal(latest.length, 20);
  assert.equal(latest.find((row) => row.from === T)?.inputHash, "rescored");
});

test("pulse score state: once superseded rows outweigh half the live ones the list is compacted", async () => {
  const b = setup();
  const live = Array.from({ length: 10 }, (_, i) => assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `live-${i}`));
  const stale = Array.from({ length: 6 }, (_, n) => live.map((row) => JSON.stringify({ ...row, inputHash: `old-${n}` }))).flat();
  await b.storage.append(pulseAssessmentsKey(), ...stale, ...live.map((row) => JSON.stringify(row)));
  await finishWith(b, [assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "new")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 11);
  const parsed = rows.map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.ok(parsed.every((row) => !row.inputHash.startsWith("old-")));
  assert.deepEqual(parsed.map((row) => row.from), [...parsed.map((row) => row.from)].sort((a, b) => a - b));
});

test("pulse score state: one attempt per five-minute slot, regardless of trigger jitter", async () => {
  const b = setup();
  const state = b.coordinator();
  const first = await state.claimPulseScore();
  assert.ok(first);
  assert.equal(await state.activatePulseScore(first.token, first.generation), true);
  assert.equal(await state.finishPulseScore(first.token, first.generation, []), true);
  b.advance(2 * 60_000);
  assert.equal(await state.claimPulseScore(), null, "same slot");
  b.advance(2 * 60_000);
  assert.ok(await state.claimPulseScore(), "next slot opens even though less than five minutes passed");
});
