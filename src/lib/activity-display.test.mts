import assert from "node:assert/strict";
import test from "node:test";

import { activityExtras, formatActivityExtra } from "./activity-display.ts";

const counts = { steps: 1_156, distanceMeters: 860, flightsClimbed: null };

test("missing HealthKit counts stay blank instead of zero, and a previous day is not today", () => {
  const today = activityExtras(counts, true);
  assert.equal(formatActivityExtra(today[0]), "1,156");
  assert.equal(formatActivityExtra(today[1]), "0.86 km");
  assert.equal(formatActivityExtra(today[2]), null);

  const measuredZero = activityExtras({ steps: 0, distanceMeters: 0, flightsClimbed: 0 }, true);
  assert.equal(formatActivityExtra(measuredZero[0]), "0");
  assert.equal(formatActivityExtra(measuredZero[1]), "0.00 km");
  assert.equal(formatActivityExtra(measuredZero[2]), "0");

  for (const extra of activityExtras(counts, false)) assert.equal(extra.value, null);
  for (const extra of activityExtras(undefined, true)) assert.equal(extra.value, null);
});
