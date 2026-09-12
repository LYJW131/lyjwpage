import assert from "node:assert/strict";
import { test } from "node:test";
import { alignHistory, HISTORY_BUCKET_MS } from "./history-align.ts";

const start = Date.parse("2026-09-12T04:15:00Z");
const end = start + 12 * 3_600_000;

test("sparse history is zero-filled to the full window", () => {
  const result = alignHistory([{ at: start, requests: 5 }], start, end);
  assert.equal(result.length, 48);
  assert.equal(result[0].requests, 5);
  assert.equal(result[1].requests, 0);
  assert.equal(result.at(-1)?.at, end - HISTORY_BUCKET_MS);
});

test("two offset windows share one union axis", () => {
  const vercel = alignHistory([{ at: start + HISTORY_BUCKET_MS, requests: 3 }], start, end + HISTORY_BUCKET_MS);
  const workers = alignHistory([{ at: start, requests: 7 }], start, end + HISTORY_BUCKET_MS);
  assert.equal(vercel.length, 49);
  assert.equal(workers.length, 49);
  assert.deepEqual(vercel.map((point) => point.at), workers.map((point) => point.at));
  assert.equal(vercel[0].requests, 0);
  assert.equal(workers[0].requests, 7);
});

test("unaligned points snap down to their bucket", () => {
  const result = alignHistory([{ at: start + 60_000, requests: 9 }], start, start + HISTORY_BUCKET_MS);
  assert.deepEqual(result, [{ at: start, requests: 9 }]);
});
