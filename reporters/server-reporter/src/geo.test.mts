import assert from "node:assert/strict";
import test from "node:test";

import { GEO_TTL_MS, geoFor } from "../dist/geo.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("查成功才缓存；失败不入库，过期后的失败也不延长缓存", async (t) => {
  const started = Date.now();
  let now = started;
  t.mock.method(Date, "now", () => now);

  const calls: string[] = [];
  const handlers = new Map<string, () => Response>();
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = [...handlers.entries()].find(([prefix]) => url.startsWith(prefix))?.[1];
    return handler ? handler() : new Response("down", { status: 503 });
  });

  const ipSb = (ip: string) => `https://api.ip.sb/geoip/${ip}`;
  const ipApi = (ip: string) => `http://ip-api.com/json/${ip}`;
  const located = {
    country: "Japan",
    city: "Osaka",
    isp: "Example",
    asn: 42,
    organization: "Example Org",
  };

  handlers.set(ipSb("203.0.113.1"), () => json(located));
  const first = await geoFor("203.0.113.1");
  assert.equal(first.country, "Japan");
  assert.equal(first.city, "Osaka");
  assert.equal(first.asn, 42);
  assert.equal(first.asnOrg, "Example Org");
  const cachedCalls = calls.length;
  assert.deepEqual(await geoFor("203.0.113.1"), first);
  assert.equal(calls.length, cachedCalls);

  handlers.set(ipSb("203.0.113.2"), () => new Response("down", { status: 503 }));
  handlers.set(ipApi("203.0.113.2"), () => new Response("down", { status: 503 }));
  assert.deepEqual(await geoFor("203.0.113.2"), {
    country: null,
    city: "Tokyo",
    isp: null,
    asn: null,
    asnOrg: null,
  });
  assert.deepEqual(await geoFor("203.0.113.1"), first);
  assert.equal(calls.length, cachedCalls + 2);

  handlers.set(ipSb("203.0.113.2"), () => json({ ...located, city: "Saitama", asn: 99 }));
  const recovered = await geoFor("203.0.113.2");
  assert.equal(recovered.city, "Saitama");
  assert.equal(recovered.asn, 99);
  const afterRecovery = calls.length;
  assert.deepEqual(await geoFor("203.0.113.2"), recovered);
  assert.equal(calls.length, afterRecovery);

  handlers.set(ipSb("203.0.113.1"), () => json(located));
  assert.equal((await geoFor("203.0.113.1")).city, "Osaka");
  now = started + GEO_TTL_MS;
  handlers.set(ipSb("203.0.113.1"), () => new Response("down", { status: 503 }));
  handlers.set(ipApi("203.0.113.1"), () => new Response("down", { status: 503 }));
  const beforeRetry = calls.length;
  assert.equal((await geoFor("203.0.113.1")).city, "Osaka");
  assert.ok(calls.length > beforeRetry);
  const afterFailedRefresh = calls.length;
  assert.equal((await geoFor("203.0.113.1")).city, "Osaka");
  assert.ok(calls.length > afterFailedRefresh);
});
