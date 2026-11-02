import assert from "node:assert/strict";
import test from "node:test";

import { prepareIngest, type PreparedIngest } from "@shared/ingest/prepare";
import { preparePrivateFacts } from "@shared/ingest/private";
import type { ReportedServerStatus } from "@shared/types";
import { archiveIngest } from "./ingest-archive";
import { historyDb } from "./testing/history-db";

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const MEDIA = { container: "mkv", bitrate: 60_000_000, video: null, audio: null, subtitle: null };

async function ingest(world: ReturnType<typeof historyDb>, source: string, raw: unknown, at: number) {
  await archiveIngest(world.db, await prepareIngest(source, raw, at), preparePrivateFacts(source, raw));
}

test("private archive: every Emby report becomes a row and a stop report has no item", async () => {
  const world = historyDb();
  const send = (playing: object | null, receivedAt: number) =>
    archiveIngest(world.db, { source: "emby", receivedAt, images: [], playing } as unknown as PreparedIngest);
  const state = (positionTicks: number, paused = false) => ({
    itemId: "e1", paused, positionTicks, runTimeTicks: 14_400_000_000, client: "Infuse", deviceName: "Apple TV",
    playMethod: "directplay", media: MEDIA, at: 0,
  });
  const item = { title: "Frieren", subtitle: "S1:E3 · Killing Magic" };

  await send({ outcome: "updated", state: state(600_000_000), item }, T0);
  await send({ outcome: "updated", state: state(900_000_000, true), item }, T0 + 60_000);
  await send({ outcome: "cleared", state: null, item: null }, T0 + 120_000);

  assert.deepEqual(world.all("SELECT observed_at, item_id, title, paused, position_ms, client, play_method, media FROM watching_events ORDER BY observed_at"), [
    { observed_at: T0, item_id: "e1", title: "Frieren", paused: 0, position_ms: 60_000, client: "Infuse", play_method: "directplay", media: JSON.stringify(MEDIA) },
    { observed_at: T0 + 60_000, item_id: "e1", title: "Frieren", paused: 1, position_ms: 90_000, client: "Infuse", play_method: "directplay", media: JSON.stringify(MEDIA) },
    { observed_at: T0 + 120_000, item_id: null, title: null, paused: null, position_ms: null, client: null, play_method: null, media: null },
  ]);
});

test("private archive: PlayStation play time gets a row only when it changes, from either list, never from a summed trophy entry", async () => {
  const world = historyDb();
  const game = (playDurationMs: number | null) => ({ titleId: "PPSA01", name: "ASTRO BOT", playCount: 3, lastPlayedAt: T0, playDurationMs });
  const title = (titleIds: string[], playDurationMs: number) => ({
    titleIds, name: "Old Game", localizedName: null, playCount: 1, lastPlayedAt: T0 - 86_400_000, playDurationMs,
  });
  const profile = (level: number) => ({ level, levelProgress: 40, trophyPoint: 9_000, earned: { platinum: 2, gold: 10, silver: 30, bronze: 200 } });
  const send = (observedAt: number, items: object[], titles: object[] | null, level = 300) => archiveIngest(world.db, {
    source: "playstation",
    receivedAt: observedAt,
    presence: null,
    playedGames: { observedAt, items },
    trophies: titles ? { observedAt, profile: profile(level), titles } : null,
  } as unknown as PreparedIngest);

  await send(T0, [game(3_600_000), game(null)], [title(["PPSA01"], 3_600_000), title(["CUSA02"], 7_200_000), title(["CUSA03", "PPSA03"], 5), title([], 1)]);
  await send(T0 + 60_000, [game(3_600_000)], null);
  await send(T0 + 3_600_000, [game(9_000_000)], [], 301);
  await send(T0 + 30_000, [], [], 299);

  assert.deepEqual(world.all("SELECT title_id, play_duration_ms, observed_at FROM game_play_snapshots ORDER BY observed_at, title_id"), [
    { title_id: "CUSA02", play_duration_ms: 7_200_000, observed_at: T0 },
    { title_id: "PPSA01", play_duration_ms: 3_600_000, observed_at: T0 },
    { title_id: "PPSA01", play_duration_ms: 9_000_000, observed_at: T0 + 3_600_000 },
  ]);
  assert.deepEqual(world.all("SELECT date, level, observed_at FROM trophy_profile_days"), [
    { date: "2026-10-30", level: 301, observed_at: T0 + 3_600_000 },
  ]);
});

test("private archive: Quest heartbeats extend one row and new rich presence text starts another", async () => {
  const world = historyDb();
  const report = (observedAt: number, state: string) => ({
    version: 1,
    presence: {
      observedAt,
      discordStatus: "online",
      playing: { name: "Beat Saber", platform: "meta_quest", details: "Expert+", state, startedAt: T0 - 600_000, applicationId: "123456" },
    },
  });

  await ingest(world, "quest", report(T0, "Song 1"), T0);
  await ingest(world, "quest", report(T0 + 60_000, "Song 1"), T0 + 60_000);
  await ingest(world, "quest", report(T0 + 120_000, "Song 2"), T0 + 120_000);

  assert.deepEqual(world.all("SELECT title_key, state, first_seen_at, last_seen_at FROM quest_activities ORDER BY first_seen_at"), [
    { title_key: "123456", state: "Song 1", first_seen_at: T0, last_seen_at: T0 + 60_000 },
    { title_key: "123456", state: "Song 2", first_seen_at: T0 + 120_000, last_seen_at: T0 + 120_000 },
  ]);
});

test("private archive: HomePod rows keep which entity played and stay out of the core command", async () => {
  const world = historyDb();
  const raw = { entityId: "media_player.wo_shi", state: "playing", title: "Song", artist: "Artist", album: "Album", positionMs: 1_000, durationMs: 200_000, observedAt: T0 };

  const command = await prepareIngest("homepod", raw, T0);
  assert.equal(JSON.stringify(command).includes("wo_shi"), false);
  await ingest(world, "homepod", raw, T0);
  await ingest(world, "homepod", raw, T0 + 60_000);
  await ingest(world, "homepod", { ...raw, entityId: undefined }, T0 + 120_000);

  assert.deepEqual(world.all("SELECT entity_id, observed_at, state, title, duration_ms FROM homepod_events"), [
    { entity_id: "media_player.wo_shi", observed_at: T0, state: "playing", title: "Song", duration_ms: 200_000 },
  ]);
});

test("private archive: the Mac keeps the last power bank and port reading of each minute, plus app and time zone changes", async () => {
  const world = historyDb();
  const powerBank = (battery: number, updatedAt: number) => ({
    connected: true, battery, charging: true, timeToFullMinutes: 40, thermalLimited: false, batteryHealth: 98,
    inputPower: 30, outputPower: 0, temperatures: [31, 33], ports: [], device: {}, updatedAt,
  });
  const port = (id: string, active: boolean, power: number | null) => ({
    id, active, power, voltage: power == null ? null : 20, current: power == null ? null : power / 20, device: "iPhone", protocol: "PD", cable: null,
  });
  const send = (receivedAt: number, modules: object) => archiveIngest(world.db, {
    source: "mac", receivedAt, presence: "online", activeModules: [], ignored: [], rejected: [], modules,
  } as unknown as PreparedIngest);

  await send(T0 + 5_000, {
    chargingDevices: { charger: { ports: [port("c1", true, 20), port("c2", false, null)], updatedAt: T0 + 5_000 }, powerBank: powerBank(50, T0 + 5_000) },
    desktop: { activity: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode", windowTitle: null, observedAt: T0 + 4_000 } },
    timezone: { identifier: "Asia/Shanghai", abbreviation: "GMT+8", secondsFromGMT: 28_800, observedAt: T0 + 4_000 },
  });
  await send(T0 + 40_000, {
    chargingDevices: { charger: { ports: [port("c1", true, 27)], updatedAt: T0 + 40_000 }, powerBank: powerBank(52, T0 + 40_000) },
  });

  assert.deepEqual(world.all("SELECT minute_at, battery_percent, temperature_c FROM powerbank_minutes"), [
    { minute_at: T0, battery_percent: 52, temperature_c: 33 },
  ]);
  assert.deepEqual(world.all("SELECT minute_at, port, watts FROM charging_port_minutes"), [{ minute_at: T0, port: "c1", watts: 27 }]);
  assert.deepEqual(world.all("SELECT t, application, bundle_id FROM desktop_changes"), [{ t: T0 + 4_000, application: "Xcode", bundle_id: "com.apple.dt.Xcode" }]);
  assert.deepEqual(world.all("SELECT t, identifier FROM timezone_changes"), [{ t: T0 + 4_000, identifier: "Asia/Shanghai" }]);
});

test("private archive: iPhone Focus changes keep the mode, null when Focus is off", async () => {
  const world = historyDb();
  const send = (mode: string | null, observedAt: number) =>
    archiveIngest(world.db, { source: "iphone", receivedAt: observedAt, ignored: [], focus: { mode, observedAt } } as unknown as PreparedIngest);
  await send("sleep", T0);
  await send(null, T0 + 28_800_000);
  assert.deepEqual(world.all("SELECT t, mode FROM focus_changes ORDER BY t"), [{ t: T0, mode: "sleep" }, { t: T0 + 28_800_000, mode: null }]);
});

function server(observedAt: number, overrides: Partial<ReportedServerStatus> = {}): ReportedServerStatus {
  return {
    id: "misaka-jp", hostname: "misaka-jp", publicIp: "203.0.113.7", country: "Japan", city: "Tokyo", isp: null, asn: 4_713, asnOrg: null,
    os: "Debian", kernel: "6.1", cpuCores: 2, cpuUsagePercent: 10, load1: 0.5, load5: 0.4, load15: 0.3,
    memoryTotalBytes: 2_000, memoryUsedBytes: 1_000, memoryAvailableBytes: 1_000, diskTotalBytes: 10_000, diskUsedBytes: 5_000,
    networkInterface: "eth0", networkRxBytes: 1, networkTxBytes: 1, networkRxBytesPerSec: 100, networkTxBytesPerSec: 50,
    traffic: null, uptimeSeconds: 3_600, observedAt, ...overrides,
  };
}

test("private archive: server hours fill the new columns, also on rows written before migration 0011", async () => {
  const world = historyDb();
  const send = (status: ReportedServerStatus) =>
    archiveIngest(world.db, { source: "server", receivedAt: status.observedAt, status } as PreparedIngest);

  world.exec(`INSERT INTO server_hours(host, hour_at, samples, cpu_percent_sum, cpu_percent_max, load1_sum, load1_max,
    memory_used_bytes_sum, memory_total_bytes, rx_bytes_per_sec_max, tx_bytes_per_sec_max, uptime_seconds, last_observed_at)
    VALUES ('misaka-jp', ${T0}, 1, 5, 5, 0.1, 0.1, 900, 2000, 10, 10, 3000, ${T0 + 1_000})`);
  await send(server(T0 + 60_000, { load5: 0.9, memoryAvailableBytes: 800, networkRxBytes: 5 }));
  await send(server(T0 + 120_000, { load5: 0.2, memoryAvailableBytes: 1_200, networkRxBytes: 9, publicIp: "203.0.113.8" }));

  assert.deepEqual(world.all("SELECT samples, load5_max, memory_available_bytes_min, disk_used_bytes, rx_bytes FROM server_hours"), [
    { samples: 3, load5_max: 0.9, memory_available_bytes_min: 800, disk_used_bytes: 5_000, rx_bytes: 9 },
  ]);
  assert.deepEqual(world.all("SELECT public_ip, asn, first_seen_at, last_seen_at FROM server_identity ORDER BY first_seen_at"), [
    { public_ip: "203.0.113.7", asn: 4_713, first_seen_at: T0 + 60_000, last_seen_at: T0 + 60_000 },
    { public_ip: "203.0.113.8", asn: 4_713, first_seen_at: T0 + 120_000, last_seen_at: T0 + 120_000 },
  ]);
});

test("private archive: a broken private table does not stop the existing archive", async () => {
  const world = historyDb();
  world.exec("DROP TABLE server_identity");
  await archiveIngest(world.db, { source: "server", receivedAt: T0, status: server(T0) } as PreparedIngest);
  assert.equal(world.all("SELECT count(*) AS n FROM server_hours")[0]?.n, 1);
});
