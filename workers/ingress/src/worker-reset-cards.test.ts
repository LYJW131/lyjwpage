import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";
import { LIMITS_TAG } from "@shared/live-events";
import type { ClaudeResetCardStock } from "@shared/vibecoding-limits";

import { ALL, CLOUD, json, post, world } from "./testing/world";

const PATH = "/api/ingest/agents/cards";

const CARDS = { fable: [1_804_579_140, 1_804_579_140], standard: [] };

test("reset cards: the cloud token stores each card's expiry in their own lag key and purges the limits tag", async () => {
  const w = world();
  const response = await w.send(PATH, { ...post(CARDS), client: CLOUD });
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, data: CARDS });
  const stored = await readLag<ClaudeResetCardStock>(w.lag, LAG_KEYS.claudeResetCards);
  assert.deepEqual(stored?.data, CARDS);
  assert.deepEqual(w.calls.revalidated, [[LIMITS_TAG]]);
  assert.equal(await w.lag.get(LAG_KEYS.limits, "text"), null, "limits stay untouched");
  assert.equal(w.calls.commits.length, 0);
});

test("reset cards: other tokens are refused, the cloud token still cannot write limits, bad counts are 400", async () => {
  const w = world();
  assert.equal((await w.send(PATH, { ...post(CARDS), client: ALL })).status, 403);
  assert.equal((await w.send("/api/ingest/agents", { ...post({ agents: [] }), client: CLOUD })).status, 403);
  for (const body of [{ fable: [] }, { fable: 2, standard: 0 }, { fable: [-1], standard: [] }, { fable: [1.5], standard: [] }, { fable: ["2"], standard: [] }, []]) {
    const response = await w.send(PATH, { ...post(body), client: CLOUD });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal((await w.send(PATH, { method: "GET", client: CLOUD })).status, 405);
  assert.equal(await w.lag.get(LAG_KEYS.claudeResetCards, "text"), null);
});
