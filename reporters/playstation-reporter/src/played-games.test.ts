import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthSession } from "../dist/auth.js";
import type { Env } from "../dist/env.js";
import { durationMs, fetchPlayedGames } from "../dist/psn.js";
import { AUTH_KEY } from "../dist/state.js";
import { MemoryStore } from "../dist/store.js";

function environment(state: MemoryStore): Env {
  return {
    STATE: state,
    SITE_INGEST_URL: "https://ingest.example/api/ingest/playstation",
    ACCESS_CLIENT_ID: "client",
    ACCESS_CLIENT_SECRET: "secret",
  };
}

async function seedFreshAuth(state: MemoryStore): Promise<void> {
  const now = Date.now();
  await state.put(AUTH_KEY, JSON.stringify({
    accessToken: "test-access",
    refreshToken: "test-refresh",
    accessTokenIssuedAt: now,
    accessTokenExpiresAt: now + 3_600_000,
    refreshTokenIssuedAt: now,
    refreshTokenExpiresAt: now + 864_000_000,
  }));
}

test("ISO 时长换成毫秒，不是秒", () => {
  assert.equal(durationMs("PT1H2M3S"), (3600 + 120 + 3) * 1000);
  assert.equal(durationMs("PT799H55M7S"), (799 * 3600 + 55 * 60 + 7) * 1000);
});

test("游玩列表把时刻收成 epoch 毫秒、时长收成毫秒", async (t) => {
  const state = new MemoryStore();
  await seedFreshAuth(state);
  const first = "2018-04-05T11:18:27.460000Z";
  const last = "2023-01-29T16:03:44.310000Z";
  t.mock.method(globalThis, "fetch", async () => Response.json({
    titles: [{
      titleId: "CUSA01810_00",
      name: "Example",
      category: "ps4_game",
      playCount: 2,
      firstPlayedDateTime: first,
      lastPlayedDateTime: last,
      playDuration: "PT1H2M3S",
    }],
    totalItemCount: 1,
  }));
  const report = await fetchPlayedGames(environment(state), new AuthSession(environment(state)));
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0]?.playDurationMs, (3600 + 120 + 3) * 1000);
  assert.equal(report.items[0]?.firstPlayedAt, Date.parse(first));
  assert.equal(report.items[0]?.lastPlayedAt, Date.parse(last));
  assert.ok(report.observedAt > 1_000_000_000_000);
});

test("HTTP 200 的 error 正文不会变成空游玩列表", async (t) => {
  const state = new MemoryStore();
  await seedFreshAuth(state);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: { code: 2240526, message: "Not permitted" },
  }, { status: 200 }));
  await assert.rejects(
    fetchPlayedGames(environment(state), new AuthSession(environment(state))),
    /游玩列表/,
  );
});
