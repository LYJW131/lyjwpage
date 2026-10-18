import assert from "node:assert/strict";
import { test } from "node:test";

import { inlineChargerIcon } from "@/lib/charger-icon-inline";
import type { SiteServices } from "@/server/site-context";
import type { ChargerPayload, StatusResponse } from "@shared/types";

const KEY = "f191011a7d09c3fcc6c753a4e239b51af9a077434c93b6840e28e3457e5ddf28.jpg";
const DATA_URI = "data:image/webp;base64,UklGRkgAAABXRUJQ+/=";

function payload(cover: ChargerPayload["cover"]): ChargerPayload {
  return {
    connected: true,
    totalPower: 60,
    maxPower: 160,
    ports: [],
    device: { firmwareVersion: "v0.0.5.2", model: "A2687" },
    cover,
    updatedAt: 1,
    history: [],
    historyPartial: false,
    pushedAt: 1,
    staleAfterMs: 1,
    lastSeenAt: 1,
    declaredOffline: false,
    heartbeatWindowMs: 1,
  };
}

function site(result: string | null, calls: string[][]): SiteServices {
  return {
    status: () => Promise.reject(new Error("unused")),
    lyrics: () => Promise.resolve(null),
    image: (url, px, fit) => {
      calls.push([url, String(px), fit]);
      return Promise.resolve(result);
    },
  };
}

test("有封面图标的快照把 iconUrl 换成内联 data URI", async () => {
  const calls: string[][] = [];
  const cover = { name: "FSF", iconHash: "h", iconObjectKey: KEY, iconUrl: `/img/${KEY}` };
  const charger: StatusResponse<ChargerPayload> = { ok: true, data: payload(cover) };
  const out = await inlineChargerIcon(site(DATA_URI, calls), charger);
  assert.deepEqual(calls, [[`/img/${KEY}`, "48", "contain"]]);
  assert.ok(out.ok);
  assert.equal(out.data.cover?.iconUrl, DATA_URI);
  assert.equal(out.data.cover?.iconObjectKey, KEY);
  assert.equal(charger.data.cover?.iconUrl, `/img/${KEY}`);
});

test("压图失败保留原 iconUrl", async () => {
  const cover = { name: "FSF", iconHash: "h", iconObjectKey: KEY, iconUrl: `/img/${KEY}` };
  const charger: StatusResponse<ChargerPayload> = { ok: true, data: payload(cover) };
  const out = await inlineChargerIcon(site(null, []), charger);
  assert.equal(out, charger);
});

test("降级信封与无图标封面不压图、原样返回", async () => {
  const calls: string[][] = [];
  const failed: StatusResponse<ChargerPayload> = { ok: false, error: "Status unavailable" };
  assert.equal(await inlineChargerIcon(site(DATA_URI, calls), failed), failed);
  const noCover: StatusResponse<ChargerPayload> = { ok: true, data: payload(null) };
  assert.equal(await inlineChargerIcon(site(DATA_URI, calls), noCover), noCover);
  const noKey: StatusResponse<ChargerPayload> = {
    ok: true,
    data: payload({ name: "FSF", iconHash: "h", iconObjectKey: null, iconUrl: null }),
  };
  assert.equal(await inlineChargerIcon(site(DATA_URI, calls), noKey), noKey);
  assert.deepEqual(calls, []);
});
