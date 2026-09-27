import assert from "node:assert/strict";
import { test } from "node:test";
import { deliver, withTimeout, headCount, readPower } from "../../workers/playstation-reporter/src/site.ts";
import type { Env } from "../../workers/playstation-reporter/src/env.ts";

function environment(overrides: Partial<NonNullable<Env["API"]>> = {}): Env {
  return { API: {
    ingest: async () => Response.json({ ok: true, data: { changed: false } }, { status: 202 }),
    count: async () => Response.json({ connections: 3 }),
    playingNow: async () => Response.json({ data: { power: { on: false, observedAt: 123 } } }),
    ...overrides,
  } } as Env;
}

test("PS reporter uses RPC for ingest, connection count and power", async () => {
  let payload: unknown;
  const env = environment({ ingest: async (raw) => {
    payload = JSON.parse(raw);
    return Response.json({ ok: true, data: { changed: true } }, { status: 202 });
  } });
  assert.deepEqual(await deliver(env, { version: 1 }), { changed: true });
  assert.deepEqual(payload, { version: 1 });
  assert.equal(await headCount(() => env.API!.count(), "connections"), 3);
  assert.deepEqual(await readPower(env), { on: false, observedAt: 123 });
});

test("failed and invalid reads preserve independent cadence fallbacks", async () => {
  const failure = async (): Promise<Response> => { throw new Error("unavailable"); };
  assert.equal(await headCount(failure, "connections"), 0);
  assert.equal(await headCount(async () => Response.json({ connections: -1 }), "connections"), 0);
  assert.equal(await headCount(async () => Response.json({ connections: 2 }, { status: 503 }), "connections"), 0);
  assert.equal(await readPower(environment({ playingNow: failure })), null);
  assert.equal(await readPower(environment({ playingNow: async () => Response.json({ data: { power: { on: false } } }) })), null);
  assert.equal(await headCount(undefined, "connections"), 0);
  assert.equal(await readPower({} as Env), null);
  assert.equal(await headCount(async () => Response.json({ online: 1 }), "online"), 1);
});

test("RPC errors and timeout do not become successful ingest receipts", async () => {
  await assert.rejects(deliver(environment({ ingest: async () => Response.json({ ok: false }, { status: 400 }) }), { version: 1 }));
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /超时/);
});
