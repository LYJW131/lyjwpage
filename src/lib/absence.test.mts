import assert from "node:assert/strict";
import test from "node:test";

import { QUEST_STALE_MS, questNow, type QuestPresence } from "@shared/quest";

import {
  READING_AWAITING,
  READING_FAILED,
  READING_UNAVAILABLE,
  absenceKind,
  chargingReadingLost,
  combinedAbsence,
  gapCopy,
  questSurface,
} from "./absence.ts";

const NOW = 1_800_000_000_000;

test("absenceKind keeps a missing report, a failed load, and a stale reading apart", () => {
  assert.equal(absenceKind({ loading: true }), "loading");
  assert.equal(absenceKind({ loading: true, awaiting: true, error: "尚未收到" }), "awaiting");
  assert.equal(absenceKind({ error: "状态暂不可用" }), "failed");
  assert.equal(absenceKind({ unavailable: true }), "unavailable");
  assert.equal(absenceKind({}), "known");
  assert.equal(gapCopy({ awaiting: true, error: "尚未收到" }), READING_AWAITING);
  assert.equal(gapCopy({ error: "状态暂不可用" }), READING_FAILED);
  assert.equal(gapCopy({ unavailable: true }), READING_UNAVAILABLE);
  assert.equal(gapCopy({}, "Nothing played recently"), "Nothing played recently");
});

test("combinedAbsence does not call a partial failure an empty report", () => {
  assert.equal(combinedAbsence([{ hasData: true }, { error: "状态暂不可用" }]), null);
  assert.equal(combinedAbsence([{ awaiting: true, error: "尚未收到" }, { error: "状态暂不可用" }]), "failed");
  assert.equal(combinedAbsence([{ awaiting: true, error: "尚未收到" }, { loading: true }]), "awaiting");
  assert.equal(combinedAbsence([{ loading: true }]), null);
  assert.equal(combinedAbsence([{ error: "状态暂不可用" }]), "failed");
});

test("chargingReadingLost is a cleared connection, not an observed unplug", () => {
  const live = { connected: true };
  assert.equal(chargingReadingLost(live, live), false);
  assert.equal(chargingReadingLost(live, { connected: false }), true);
  assert.equal(chargingReadingLost({ connected: false }, { connected: false }), false);
  assert.equal(chargingReadingLost(undefined, undefined), false);
});

test("questSurface hides a known idle and a first report, and keeps a lapsed session visible", () => {
  const idle: QuestPresence = { observedAt: NOW, receivedAt: NOW, discordStatus: "online", playing: null };
  assert.equal(questSurface(questNow(null, NOW), false), "hidden");
  assert.equal(questSurface(questNow(idle, NOW), false), "hidden");
  assert.equal(questSurface(questNow(idle, NOW + QUEST_STALE_MS), false), "unavailable");
  assert.equal(questSurface(undefined, true), "failed");
  const playing: QuestPresence = {
    observedAt: NOW,
    receivedAt: NOW,
    discordStatus: "online",
    playing: {
      name: "Beat Saber",
      platform: "meta_quest",
      details: null,
      state: null,
      startedAt: NOW,
      applicationId: null,
      parentApplicationId: null,
      largeImageUrl: null,
    },
  };
  assert.equal(questSurface(questNow(playing, NOW), false), "playing");
});
