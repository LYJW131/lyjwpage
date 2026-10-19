import assert from "node:assert/strict";
import test from "node:test";

import { pulseChargingKey, pulseLaneOpenKey, pulseListeningTracesKey } from "./pulse-keys";
import { recordChargingSample, recordStateObservation, replacePulseActivity } from "./stores/pulse.ts";
import { archiveStatements } from "./pulse-archive.ts";
import { M, T0, setup } from "./testing/pulse-archive-harness";

const music = (title: string, state: "playing" | "paused" | "idle" = "playing") => ({
  state, source: state === "idle" ? null : "mac" as const, title: state === "idle" ? null : title, artist: "Hamilton", album: "Hamilton", trackId: null,
});

test("pulse archive: closed playing intervals and recent-list traces become listening plays, idempotently", async () => {
  const b = setup();
  await b.write(async () => {
    await recordStateObservation("listening", T0, music("Helpless"));
    await recordStateObservation("listening", T0 + 3 * M, music("Helpless", "paused"));
    await recordStateObservation("listening", T0 + 5 * M, music("Satisfied"));
    await recordStateObservation("listening", T0 + 9 * M, { ...music("x", "idle"), artist: null, album: null });
    await b.storage.batch().append(pulseListeningTracesKey(),
      JSON.stringify({ since: T0 - 4 * M, t: T0 - 2 * M, title: "Yoru ni Kakeru", artist: "YOASOBI", album: "THE BOOK", itemId: "1" }),
      JSON.stringify({ since: T0 - 4 * M, t: T0 - 2 * M, title: "Idol", artist: "YOASOBI", album: "THE BOOK 2", itemId: "2", durationMs: 213_000 })).execute();
  });
  b.at(T0 + 10 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT source, started_at, ended_at, certain, title, album, item_id FROM listening_plays ORDER BY started_at"), [
    { source: "recent", started_at: T0 - 4 * M, ended_at: T0 - 2 * M, certain: 0, title: "Yoru ni Kakeru", album: "THE BOOK", item_id: "1" },
    { source: "recent", started_at: T0 - 4 * M + 1, ended_at: T0 - 2 * M, certain: 0, title: "Idol", album: "THE BOOK 2", item_id: "2" },
    { source: "mac", started_at: T0, ended_at: T0 + 3 * M, certain: 1, title: "Helpless", album: "Hamilton", item_id: null },
    { source: "mac", started_at: T0 + 5 * M, ended_at: T0 + 9 * M, certain: 1, title: "Satisfied", album: "Hamilton", item_id: null },
  ], "paused and idle spans are not plays; two songs from one refresh keep their order a millisecond apart");
  assert.equal(b.watermark("listening"), String(T0 + 9 * M));
  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes(), before, "a replay past the watermark writes nothing");
});

test("pulse archive: watching sessions merge playing and paused spans of one item and grow as they continue", async () => {
  const b = setup();
  const video = (state: "playing" | "paused" | "idle", itemId: string | null = "42") =>
    ({ state, itemId: state === "idle" ? null : itemId, title: state === "idle" ? null : "Frieren", subtitle: state === "idle" ? null : "S01E05" });
  await b.write(async () => {
    await recordStateObservation("watching", T0, video("playing"));
    await recordStateObservation("watching", T0 + 10 * M, video("paused"));
    await recordStateObservation("watching", T0 + 12 * M, video("playing"));
  });
  b.at(T0 + 13 * M);
  await b.archive().run();
  assert.deepEqual(b.all("SELECT item_id, started_at, ended_at, playing_seconds, title FROM watching_sessions"), [
    { item_id: "42", started_at: T0, ended_at: T0 + 12 * M, playing_seconds: 600, title: "Frieren" },
  ]);
  await b.write(async () => {
    await recordStateObservation("watching", T0 + 21 * M, video("playing"));
    await recordStateObservation("watching", T0 + 30 * M, video("idle"));
  });
  await b.archive().run();
  assert.deepEqual(b.all("SELECT item_id, started_at, ended_at, playing_seconds FROM watching_sessions"), [
    { item_id: "42", started_at: T0, ended_at: T0 + 30 * M, playing_seconds: 600 + 18 * 60 },
  ], "the same session row is extended, not duplicated");
});

test("pulse archive: in-game spans become game sessions; charging keeps samples and derives sessions", async () => {
  const b = setup();
  await b.write(async () => {
    await recordStateObservation("gaming", T0, { state: "online", titleId: null, title: null });
    await recordStateObservation("gaming", T0 + 5 * M, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 35 * M, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 65 * M, { state: "offline", titleId: null, title: null });
    await recordChargingSample(T0, 0, null);
    await recordChargingSample(T0 + M, 60, "MacBook Pro");
    await recordChargingSample(T0 + 6 * M, 60, "MacBook Pro");
    await recordChargingSample(T0 + 11 * M, 0.4, "MacBook Pro");
  });
  b.at(T0 + 70 * M);
  await b.archive().run();
  assert.deepEqual(b.all("SELECT title_id, started_at, ended_at, title FROM game_sessions"), [
    { title_id: "PPSA01", started_at: T0 + 5 * M, ended_at: T0 + 65 * M, title: "Pragmata" },
  ]);
  assert.deepEqual(b.all("SELECT t, watts FROM charging_samples ORDER BY t").map((row) => row.watts), [0, 60, 60, 0.4]);
  assert.deepEqual(b.all("SELECT started_at, ended_at, peak_w, energy_wh, device FROM charging_sessions"), [
    { started_at: T0 + M, ended_at: T0 + 11 * M, peak_w: 60, energy_wh: 10, device: "MacBook Pro" },
  ]);
});

test("pulse archive: authoritative activity replacement writes only changed rows and a newer revision wins", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  const bucket = (offset: number, steps: number | null) => ({ from: T0 + offset * M, to: T0 + (offset + 5) * M, steps, moveKcal: 1, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(5, 20)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps, move_kcal, exercise_minutes FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0, steps: 300, move_kcal: 1, exercise_minutes: null },
    { started_at: T0 + 5 * M, steps: 20, move_kcal: 1, exercise_minutes: null },
  ]);
  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes(), before, "an unchanged snapshot is not replayed");
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(10, null)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0, steps: 300 },
    { started_at: T0 + 10 * M, steps: null },
  ], "HealthKit's revision deletes the vanished bucket and leaves missing steps unknown");
  assert.equal(b.changes() - before, 3, "only the revision claim, the deleted and the new bucket are written");
});

test("pulse archive: activity replacement only deletes within the lower bound and archives no oversized bucket", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  b.exec(`INSERT INTO activity_buckets(started_at, ended_at, steps) VALUES (${T0 - 3 * 24 * 60 * M}, ${T0 - 3 * 24 * 60 * M + 5 * M}, 1), (${T0 - 3 * M}, ${T0 + 2 * M}, 2)`);
  const bucket = (from: number, to: number, steps: number) => ({ from, to, steps, moveKcal: null, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(T0, T0 + 5 * M, 300), bucket(T0 + 10 * M, T0 + 10 * M + 25 * 60 * M, 7)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0 - 3 * 24 * 60 * M, steps: 1 },
    { started_at: T0, steps: 300 },
  ]);
});

test("pulse archive: an older activity snapshot finishing late cannot undo a newer replacement", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  const bucket = (offset: number, steps: number) => ({ from: T0 + offset * M, to: T0 + (offset + 5) * M, steps, moveKcal: null, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(5, 20)]));
  const older = (await b.state.readPulseArchive()).streams.find((stream) => stream.stream === "activity")!;
  await b.write(() => replacePulseActivity(range, [bucket(0, 310)]));
  const newer = (await b.state.readPulseArchive()).streams.find((stream) => stream.stream === "activity")!;
  await b.db.batch(archiveStatements(b.db, newer, T0).statements);
  await b.db.batch(archiveStatements(b.db, older, T0).statements);
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets"), [{ started_at: T0, steps: 310 }]);
});

test("pulse archive: a charging session longer than the lookback stays one row across runs", async () => {
  const b = setup();
  const start = T0 - 3 * 24 * 60 * M;
  const rows = [JSON.stringify({ t: start - M, watts: 0 })];
  for (let t = start; t <= T0; t += M) rows.push(JSON.stringify({ t, watts: 20 }));
  await b.storage.batch().append(pulseChargingKey(), ...rows).execute();
  for (let run = 0; run < 4; run++) {
    const at = T0 + (run + 1) * M;
    await b.storage.batch().append(pulseChargingKey(), JSON.stringify({ t: at, watts: 20 })).execute();
    b.at(at);
    await b.archive().run();
  }
  assert.deepEqual(b.all("SELECT started_at FROM charging_sessions"), [{ started_at: start }]);
});

test("pulse archive: watching idle after an explicit stop outlives the seven-day TTL", async () => {
  const b = setup();
  await b.write(() => recordStateObservation("watching", T0, { state: "idle", itemId: null, title: null, subtitle: null }));
  b.at(T0 + 8 * 24 * 60 * M);
  const raw = await b.storage.get(pulseLaneOpenKey("watching"));
  assert.equal(JSON.parse(raw!).holdUntil, null);
  await b.write(() => recordStateObservation("listening", T0, music("Helpless")));
  b.at(T0 + 16 * 24 * 60 * M);
  assert.equal(await b.storage.get(pulseLaneOpenKey("listening")), null, "a finite hold still expires with the TTL");
  assert.ok(await b.storage.get(pulseLaneOpenKey("watching")));
});

test("pulse archive: one stream failure does not block the others and keeps its watermark", async () => {
  const b = setup({ failStream: "gaming" });
  await b.write(async () => {
    await recordStateObservation("gaming", T0, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 5 * M, { state: "offline", titleId: null, title: null });
    await recordStateObservation("listening", T0, music("Helpless"));
    await recordStateObservation("listening", T0 + 5 * M, music("Satisfied"));
  });
  await b.archive().run();
  assert.deepEqual(b.logged, ["gaming: D1 unavailable"]);
  assert.equal(b.watermark("gaming"), null);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM listening_plays")[0].n, 1);
});

test("pulse archive: late confirmations advance by max and never move backward", async () => {
  const b = setup();
  assert.equal(await b.state.confirmPulseArchive("charging", T0 + 10), T0 + 10);
  assert.equal(await b.state.confirmPulseArchive("charging", T0), T0 + 10);
  await assert.rejects(() => b.state.confirmPulseArchive("charging", T0, "token"), /Invalid/);
});
