import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVercelFunctions, parseVercelAnalytics, parseVercelFunctions, parseVercelWebVitals } from "./vercel-metrics.ts";

test("Web Vitals uses the full-window P75 and preserves missing metrics instead of reporting zero", () => {
  const data = parseVercelWebVitals({ overview: { RES: { p75: 100 }, LCP: { p75: 700, p99: 5500 }, CLS: { p75: 0 } }, timeseries: [{ RES: { p75: 1 } }], token: "private" });
  assert.equal(data.score, 100);
  assert.equal(data.lcpMs, 700);
  assert.equal(data.cls, 0);
  assert.equal(data.inpMs, null);
  assert.doesNotMatch(JSON.stringify(data), /private|timeseries|p99/);
  assert.equal(parseVercelWebVitals({ overview: { RES: { p75: 101 } } }).score, null);
  assert.throws(() => parseVercelWebVitals({ error: "permission denied" }));
});

test("function totals come from the window summary, with empty and malformed responses distinguished", () => {
  const parsed = parseVercelFunctions({ summary: [{ total: 123, errors: 2, timeouts: 1, cpuP75Ms: 20, memoryAvgMb: 230, rawLogs: "private" }], data: [{ timestamp: "2026-09-12T00:05:00Z", total: 999 }] });
  assert.deepEqual(parsed, { invocations: 123, errors: 2, timeouts: 1, cpuP75Ms: 20, memoryAvgMb: 230 });
  assert.doesNotMatch(JSON.stringify(parsed), /private|history|999/);
  assert.equal(parseVercelFunctions({ summary: [] }).invocations, 0);
  assert.throws(() => parseVercelFunctions({ error: "forbidden" }));
  assert.throws(() => parseVercelFunctions({ summary: [{ total: 1 }, { total: 2 }] }));
  assert.throws(() => parseVercelFunctions({ summary: [{ total: 1, errors: 2, timeouts: 0 }] }));
});

test("analytics preserves the returned UTC reporting window and does not sum daily unique visitors", () => {
  const result = parseVercelAnalytics({ query: { since: "2026-09-05T00:00:00Z", until: "2026-09-12T00:00:00Z" }, data: { pageviews: 598, visitors: 91, clientIp: "private" } });
  assert.equal(result.visitors, 91);
  assert.equal(result.start, Date.parse("2026-09-05T00:00:00Z"));
  assert.doesNotMatch(JSON.stringify(result), /clientIp|private/);
  assert.throws(() => parseVercelAnalytics({ query: {}, data: { pageviews: 0, visitors: 0 } }));
});


test("functions query uses the caller-provided 12h window and asks for the summary only", async (t) => {
  const start = Date.parse("2026-09-12T04:15:00Z"), end = start + 12 * 3_600_000;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://vercel.com");
    assert.equal(url.searchParams.get("teamId"), "team-test");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-secret");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.summaryOnly, true);
    assert.equal(body.startTime, new Date(start).toISOString());
    assert.equal(body.endTime, new Date(end).toISOString());
    return Response.json({ summary: [{ total: 5, errors: 0, timeouts: 0 }] });
  });
  const result = await fetchVercelFunctions("project-test", "team-test", "test-secret", start, end);
  assert.equal(result.invocations, 5);
});
