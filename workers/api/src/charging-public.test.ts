import assert from "node:assert/strict";
import test from "node:test";

import { getChargerSnapshot } from "@/lib/anker";
import { getPowerBankSnapshot } from "@/lib/powerbank";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { K_LATEST as CHARGER_LATEST } from "@shared/charger-store";
import { prepareIngest, type CoreCommand } from "@shared/ingest/prepare";
import { K_LATEST as POWERBANK_LATEST } from "@shared/powerbank-store";
import { withRequestState } from "@shared/request-state";

import { collectIngestEffects } from "./ingest-effects";
import { commitPreparedIngest } from "./ingest-handlers";
import { requestStore, type Env } from "./runtime";

const NOW = 1_800_000_000_000;
const CHARGER_SERIAL = "ASHDJW7CF49200487";
const POWERBANK_SERIAL = "AJ7DLCH0F49600286";

const env = {
  LIVE_PUSH: { idFromName: () => null, get: () => ({ broadcast: async () => {} }) },
} as unknown as Env;

async function land(body: unknown) {
  const command = await prepareIngest("mac", body, NOW, { head: async () => ({}) }) as CoreCommand;
  const pending: Promise<unknown>[] = [];
  try {
    const result = await requestStore.run(
      { env, ctx: { waitUntil: (promise) => { pending.push(promise); } } },
      () => withRequestState(() => collectIngestEffects(() => commitPreparedIngest(command))),
    );
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    return result;
  } finally {
    await Promise.allSettled(pending);
  }
}

test("充电头、充电宝的序列号只留在状态核心：推送和状态接口都不带，存储里照旧有", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const result = await land({
      version: 4,
      presence: "online",
      heartbeatAt: NOW,
      activeModules: ["charger"],
      modules: { chargingDevices: { devices: [
        { id: CHARGER_SERIAL, kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 40, firmware: "v0.0.5.2", model: "A2687" },
        { id: POWERBANK_SERIAL, kind: "powerBank", connected: true, updatedAt: NOW, firmware: "v0.0.5.2", model: "A110G", battery: { percent: 50 } },
      ] } },
    });

    const pushed = result.effects.flatMap((effect) => effect.kind === "event" ? [effect.event] : []);
    const charger = pushed.find((event) => event.type === "charger");
    const powerBank = pushed.find((event) => event.type === "powerbank");
    assert.deepEqual(charger?.payload.device, { firmwareVersion: "v0.0.5.2", model: "A2687" });
    assert.deepEqual(powerBank?.payload.device, { firmwareVersion: "v0.0.5.2", model: "A110G" });

    const served = JSON.stringify([await getChargerSnapshot(), await getPowerBankSnapshot()]);
    assert.ok(served.includes("A2687") && served.includes("A110G"));
    assert.ok(!served.includes("serialNumber") && !served.includes(CHARGER_SERIAL) && !served.includes(POWERBANK_SERIAL));

    assert.ok(String(await storage.get(CHARGER_LATEST)).includes(CHARGER_SERIAL));
    assert.ok(String(await storage.get(POWERBANK_LATEST)).includes(POWERBANK_SERIAL));
  } finally {
    resetStorageForTests();
  }
});
