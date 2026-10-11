import assert from "node:assert/strict";
import test from "node:test";

import { gamingSummaryDetail } from "./gaming-lane-detail.ts";

test("gaming summary names games when any were played", () => {
  assert.equal(gamingSummaryDetail(3_600, 1, [2]), "1 game");
  assert.equal(gamingSummaryDetail(7_200, 2, [2, 0]), "2 games");
});

test("gaming summary stays in game when the title is missing", () => {
  assert.equal(gamingSummaryDetail(60, 0, [2]), "in game");
});

test("gaming summary does not say in game when the day was only online or offline", () => {
  assert.equal(gamingSummaryDetail(0, 0, [0, 0]), "offline");
  assert.equal(gamingSummaryDetail(0, 0, [0, 1]), "online");
});
