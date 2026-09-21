import assert from "node:assert/strict";
import test from "node:test";

import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import type { ChargerStatus, ServerStatus, TrophiesPayload } from "@/lib/types";
import { recordStateChange } from "@api/stores/state-journal";
import {
  chargerState,
  desktopState,
  journalKey,
  listeningDeviceState,
  planJournalEntry,
  serverState,
  trophyArchiveState,
  type JournalEntry,
} from "@shared/state-journal";

const music = {
  source: "apple-music" as const,
  state: "playing" as const,
  title: "Idol",
  artist: "YOASOBI",
  album: "Idol",
  trackId: "1",
  repeatOne: false,
};

function entry(t: number, state: unknown): JournalEntry {
  return { t, at: t, state };
}

test("planJournalEntry records a change once and keeps order when the clock stalls", () => {
  const first = planJournalEntry(null, 10, desktopState({ applicationName: "Cursor", bundleIdentifier: "cursor", iconObjectKey: null }));
  assert.deepEqual(first, entry(10, desktopState({ applicationName: "Cursor", bundleIdentifier: "cursor", iconObjectKey: null })));
  assert.equal(planJournalEntry(first, 20, first?.state), null);
  assert.equal(planJournalEntry(first, 1.5, { applicationName: "Zed" }), null);

  const next = planJournalEntry(first, 10, desktopState({ applicationName: "Zed", bundleIdentifier: "zed", iconObjectKey: null }));
  assert.equal(next?.t, 11);
  assert.equal(next?.at, 10);
});

test("playback position and charger wattage are not state changes", () => {
  const playing = listeningDeviceState(music, [{ title: "Next", artist: "A", album: "B" }]);
  assert.equal(planJournalEntry(entry(1, playing), 2, playing), null);
  const paused = listeningDeviceState({ ...music, state: "paused" }, playing.upcoming);
  assert.equal(planJournalEntry(entry(1, playing), 2, paused)?.state && paused.state, "paused");

  const charger = {
    connected: true,
    totalPower: 0,
    maxPower: 160,
    ports: [{ id: "C1", active: false, power: null, voltage: null, current: null, device: null, protocol: null, cable: null }],
    device: { serialNumber: "sn", firmwareVersion: "1", model: "A2687" },
    cover: null,
    updatedAt: 1,
  } satisfies ChargerStatus;
  const resting = chargerState(charger);
  const busier = chargerState({ ...charger, totalPower: 0.4, updatedAt: 2 });
  assert.equal(planJournalEntry(entry(1, resting), 2, busier), null);
  const plugged = chargerState({ ...charger, ports: [{ ...charger.ports[0], active: true, device: "MacBook" }] });
  assert.equal((planJournalEntry(entry(1, resting), 3, plugged)?.state as { ports: { active: boolean }[] }).ports[0]?.active, true);
});

test("server collection time alone does not archive another row", () => {
  const status = {
    id: "nas",
    hostname: "nas",
    publicIp: "1.1.1.1",
    country: null,
    city: null,
    isp: null,
    asn: null,
    asnOrg: null,
    os: "linux",
    kernel: "6",
    cpuCores: 4,
    cpuUsagePercent: 3,
    load1: 0.1,
    load5: 0.1,
    load15: 0.1,
    memoryTotalBytes: 1,
    memoryUsedBytes: 1,
    memoryAvailableBytes: 1,
    diskTotalBytes: 1,
    diskUsedBytes: 1,
    networkInterface: "eth0",
    networkRxBytes: 10,
    networkTxBytes: 10,
    networkRxBytesPerSec: 0,
    networkTxBytesPerSec: 0,
    traffic: null,
    uptimeSeconds: 100,
    observedAt: 1,
  } satisfies ServerStatus;
  const first = serverState(status);
  assert.equal(planJournalEntry(entry(1, first), 2, serverState({ ...status, observedAt: 50 })), null);
  assert.equal(planJournalEntry(entry(1, first), 2, serverState({ ...status, cpuUsagePercent: 80 }))?.at, 2);
});

test("trophy archive keeps recent unlocks and stays stable for the same catalog", () => {
  const counts = { platinum: 0, gold: 1, silver: 0, bronze: 0 };
  const title = {
    npCommunicationId: "NPWR",
    name: "Game",
    localizedName: null,
    titleIds: ["PPSA"],
    iconUrl: null,
    platform: "PS5",
    progress: 10,
    defined: counts,
    earned: counts,
    lastUpdatedAt: null,
    playDurationMs: null,
    playCount: 1,
    firstPlayedAt: null,
    lastPlayedAt: null,
    service: null,
    preOrder: false,
    groups: [],
    trophies: [{
      id: 2,
      type: "gold" as const,
      name: "Done",
      detail: "long",
      iconUrl: null,
      hidden: false,
      groupId: "default",
      earned: true,
      earnedAt: 50,
      earnedRate: 1,
    }],
  };
  const payload = {
    observedAt: 1,
    profile: {
      onlineId: "lyjw",
      avatarUrl: null,
      plus: true,
      level: 2,
      tier: 1,
      trophyPoint: 90,
      levelBasePoint: 0,
      levelNextPoint: 100,
      levelProgress: 10,
      earned: counts,
    },
    titles: [title],
  } satisfies TrophiesPayload;
  const state = trophyArchiveState(payload);
  assert.deepEqual(state.recentUnlocked, [{ npCommunicationId: "NPWR", title: "Game", id: 2, type: "gold", name: "Done", earnedAt: 50 }]);
  assert.equal(planJournalEntry(entry(1, state), 2, trophyArchiveState({ ...payload, observedAt: 9 })), null);
});

test("oversized state is stored as a digest instead of the blob", () => {
  const planned = planJournalEntry(null, 5, { blob: "x".repeat(50_000) });
  assert.equal(planned?.t, 5);
  assert.equal((planned?.state as { truncated?: boolean }).truncated, true);
});

test("recordStateChange appends once and repairs a missed row on retry", async () => {
  resetStorageForTests();
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const cursor = desktopState({ applicationName: "Cursor", bundleIdentifier: "cursor", iconObjectKey: null });
    await recordStateChange("desktop", 10, cursor);
    await recordStateChange("desktop", 20, cursor);
    const zed = desktopState({ applicationName: "Zed", bundleIdentifier: "zed", iconObjectKey: null });
    await recordStateChange("desktop", 15, zed);
    await recordStateChange("desktop", 15, desktopState({ applicationName: "Ghostty", bundleIdentifier: "ghostty", iconObjectKey: "a.webp" }));
    const rows = (await storage.listRange(journalKey("desktop"), 0, -1)).map((raw) => JSON.parse(raw) as JournalEntry);
    assert.deepEqual(rows.map((row) => [row.t, row.at, (row.state as { applicationName: string }).applicationName]), [
      [10, 10, "Cursor"],
      [15, 15, "Zed"],
      [16, 15, "Ghostty"],
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("recordStateChange fails closed when storage is down", async () => {
  resetStorageForTests();
  installStorageForTests(null);
  try {
    await assert.rejects(() => recordStateChange("server", 1, { id: "nas" }), /状态存档/);
  } finally {
    resetStorageForTests();
  }
});
