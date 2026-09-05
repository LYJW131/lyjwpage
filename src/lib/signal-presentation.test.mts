import assert from "node:assert/strict";
import test from "node:test";
import { powerTrace, selectedRecordIndex } from "./signal-presentation.ts";

test("live detail follows a track change and remains open when playback stops", () => {
  const selection = { kind: "live" } as const;
  assert.equal(
    selectedRecordIndex(
      [
        { key: "mac:a", track: {} },
        { key: "album", track: null },
      ],
      selection,
    ),
    0,
  );
  assert.equal(
    selectedRecordIndex(
      [
        { key: "mac:b", track: {} },
        { key: "album", track: null },
      ],
      selection,
    ),
    0,
  );
  assert.equal(
    selectedRecordIndex([{ key: "album", track: null }], selection),
    0,
  );
  assert.equal(selectedRecordIndex([], selection), -1);
});

test("archive detail retains its selected album when live records are inserted", () => {
  const selection = { kind: "record", id: "album" } as const;
  assert.equal(
    selectedRecordIndex([{ key: "album", track: null }], selection),
    0,
  );
  assert.equal(
    selectedRecordIndex(
      [
        { key: "mac:a", track: {} },
        { key: "album", track: null },
      ],
      selection,
    ),
    1,
  );
  assert.equal(
    selectedRecordIndex([{ key: "other", track: null }], selection),
    -1,
  );
  assert.equal(selectedRecordIndex([{ key: "album", track: null }], null), -1);
});

test("power trace retains time gaps and handles empty or single samples", () => {
  assert.equal(powerTrace([]), "");
  assert.equal(powerTrace([{ t: 1000, w: 0 }]), "0,100");
  const points = powerTrace([
    { t: 1000, w: 10 },
    { t: 2000, w: 5 },
    { t: 11000, w: 0 },
  ])
    .split(" ")
    .map((point) => point.split(",").map(Number));
  assert.deepEqual(points, [
    [0, 10],
    [48, 55],
    [480, 100],
  ]);
});
