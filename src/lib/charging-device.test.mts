import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARGER_MODEL,
  POWER_BANK_MODEL,
  ankerModelLabel,
  normalizeChargingDevice,
  normalizePowerBank,
  readCover,
} from "./charging-device.ts";

const HASH = "a".repeat(64);
const KEY = `${HASH}.png`;

test("没有 cover 就是 null", () => {
  assert.equal(readCover(null), null);
  assert.equal(readCover(undefined), null);
});

test("封面要有名字；对象键必须和 hash 一起", () => {
  assert.deepEqual(readCover({ name: "  Neon  " }), {
    name: "Neon",
    iconHash: null,
    iconObjectKey: null,
    iconUrl: null,
  });
  assert.throws(() => readCover({ name: "" }));
  assert.throws(() => readCover({ name: "Neon", iconObjectKey: KEY }));
});

test("充电头归一化带上封面", () => {
  const status = normalizeChargingDevice({
    id: "SN",
    kind: "charger",
    connected: true,
    updatedAt: 1,
    cover: { name: "Neon", iconHash: HASH, iconObjectKey: KEY },
  });
  assert.deepEqual(status.cover, {
    name: "Neon",
    iconHash: HASH,
    iconObjectKey: KEY,
    iconUrl: null,
  });
});

test("归一化留下上报器给的型号", () => {
  const charger = normalizeChargingDevice({
    id: "SN",
    kind: "charger",
    model: " A2687 ",
    connected: true,
    updatedAt: 1,
  });
  assert.equal(charger.device.model, "A2687");

  const bank = normalizePowerBank({
    id: "SN",
    kind: "powerBank",
    model: "A110G",
    connected: true,
    updatedAt: 1,
  });
  assert.equal(bank.device.model, "A110G");
});

test("顶栏型号前面补 Anker，已经带了就不叠", () => {
  assert.equal(ankerModelLabel(null, CHARGER_MODEL), "Anker A2687");
  assert.equal(ankerModelLabel("A110G", POWER_BANK_MODEL), "Anker A110G");
  assert.equal(ankerModelLabel("Anker A2687", CHARGER_MODEL), "Anker A2687");
});

test("封面对象键也收原样 JPEG", () => {
  const key = `${HASH}.jpg`;
  assert.deepEqual(readCover({ name: "Neon", iconHash: HASH, iconObjectKey: key }), {
    name: "Neon",
    iconHash: HASH,
    iconObjectKey: key,
    iconUrl: null,
  });
});
