import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChargingDevice, readCover } from "./charging-device.ts";

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

test("封面对象键也收原样 JPEG", () => {
  const key = `${HASH}.jpg`;
  assert.deepEqual(readCover({ name: "Neon", iconHash: HASH, iconObjectKey: key }), {
    name: "Neon",
    iconHash: HASH,
    iconObjectKey: key,
    iconUrl: null,
  });
});
