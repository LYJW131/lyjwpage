import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_REPEAT_AFTER_MS } from "@shared/limits";
import {
  pulseActivityKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseWorkoutsKey,
} from "./pulse-keys";
import { commitPreparedTelemetryEnvelope } from "@core/stores/telemetry";
import { prepareTelemetryEnvelope } from "@shared/ingest/telemetry";
import { T0, envelope, inRequest, withStorage } from "./testing/pulse-ingest-harness";

const recordTelemetryEnvelope = (input: unknown, at: number) => commitPreparedTelemetryEnvelope(prepareTelemetryEnvelope(input, at));

test("充电头只发心跳的那几分钟，瓦数照样 5 分钟再确认一次", withStorage(async (storage) => {
  const charger = (at: number, watts: number) => envelope(at, ["charger"], {
    chargingDevices: { devices: [{
      id: "sn-1", kind: "charger", model: "A2687", connected: true, updatedAt: at, totalOutputW: watts,
      ports: [{ name: "C1", active: true, powerW: watts, attachedDevice: { model: "MacBook Pro" } }],
    }] },
  });
  await inRequest(() => recordTelemetryEnvelope(charger(T0, 45.04), T0));
  const samples = async () => (await storage.listRange(pulseChargingKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(await samples(), [{ t: T0, watts: 45, device: "MacBook Pro" }]);
  await inRequest(() => recordTelemetryEnvelope(charger(T0 + 20_000, 46), T0 + 20_000));
  assert.equal((await samples()).length, 1);
  const reconfirm = T0 + PULSE_REPEAT_AFTER_MS;
  await inRequest(() => recordTelemetryEnvelope(envelope(reconfirm, ["charger"]), reconfirm));
  assert.deepEqual((await samples()).map((row) => row.t), [T0, reconfirm]);
}));

test("iPhone activity keeps raw five-minute buckets, rewrites only from the first change, and stores workout intervals", withStorage(async (storage) => {
  const { commitPreparedPhoneEnvelope } = await import("@core/phone-telemetry");
  const { preparePhoneEnvelope } = await import("@shared/ingest/phone");
  const recordPhoneEnvelope = (input: unknown, at: number) => commitPreparedPhoneEnvelope(preparePhoneEnvelope(input, at));
  const start = Date.parse("2026-09-20T08:00:00Z");
  const historyOnly = (buckets: object[], to = start + 3_600_000) => ({ version: 1, modules: { activity: { history: { from: start, to, buckets } } } });
  const buckets = async () => (await storage.listRange(pulseActivityKey(), 0, -1)).map((raw) => JSON.parse(raw));
  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, moveKcal: 1 },
  ]), start + 3_600_000));
  assert.deepEqual(await buckets(), [
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, steps: null, moveKcal: 1, exerciseMinutes: null },
  ]);
  assert.equal(await storage.get(pulseActivityRevisionKey()), "1");

  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, moveKcal: 1 },
  ]), start + 3_600_000));
  assert.equal(await storage.get(pulseActivityRevisionKey()), "1");

  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 900_000, to: start + 1_200_000, steps: 40 },
  ]), start + 3_600_000));
  assert.deepEqual((await buckets()).map((row) => [row.from - start, row.steps]), [[0, 300], [900_000, 40]]);
  assert.equal(await storage.get(pulseActivityRevisionKey()), "2");

  await inRequest(() => recordPhoneEnvelope({ version: 1, modules: { workouts: { items: [{
    id: "5c1f2d1e-7d7c-4c65-9c1e-2b4b3f3f5a10", activityType: "Fencing", startedAt: start, endedAt: start + 1_800_000,
    secondsFromGMT: 28_800, durationSeconds: 1_800,
  }] } } }, start + 3_600_000));
  assert.deepEqual(JSON.parse((await storage.get(pulseWorkoutsKey()))!), { items: [{ startedAt: start, endedAt: start + 1_800_000, activityType: "Fencing" }] });
}));
