import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVercelAnalytics, parseVercelFunctions, parseVercelWebVitals } from "./vercel-metrics.ts";

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
  assert.deepEqual(parseVercelFunctions({ summary: [{ total: 123, errors: 2, timeouts: 1, cpuP75Ms: 20, memoryAvgMb: 230 }], data: [{ timestamp: "2026-09-12T00:05:00Z", total: 999 }], rawLogs: "private" }),
    { invocations: 123, errors: 2, timeouts: 1, cpuP75Ms: 20, memoryAvgMb: 230, history: [{ at: Date.parse("2026-09-12T00:05:00Z"), requests: 999 }] });
  assert.equal(parseVercelFunctions({ summary: [], data: [] }).invocations, 0);
  assert.throws(() => parseVercelFunctions({ error: "forbidden" }));
  assert.throws(() => parseVercelFunctions({ summary: [], data: [{ total: 1 }] }));
  assert.throws(() => parseVercelFunctions({ summary: [{ total: 1, errors: 2, timeouts: 0 }] }));
});

test("analytics preserves the returned UTC reporting window and does not sum daily unique visitors", () => {
  const result = parseVercelAnalytics({ query: { since: "2026-09-05T00:00:00Z", until: "2026-09-12T00:00:00Z" }, data: { pageviews: 598, visitors: 91, clientIp: "private" } });
  assert.equal(result.visitors, 91);
  assert.equal(result.start, Date.parse("2026-09-05T00:00:00Z"));
  assert.doesNotMatch(JSON.stringify(result), /clientIp|private/);
  assert.throws(() => parseVercelAnalytics({ query: {}, data: { pageviews: 0, visitors: 0 } }));
});


test("function history is ordered, projects only public fields, and rejects invalid samples", () => {
  const summary = [{ total: 10, errors: 0, timeouts: 0 }];
  const data = [{ timestamp: "2026-09-12T00:05:00Z", total: 7, private: "secret" }, { timestamp: "2026-09-12T00:00:00Z", total: 3 }];
  const parsed = parseVercelFunctions({ summary, data });
  assert.deepEqual(parsed.history.map(p => p.requests), [3, 7]);
  assert.doesNotMatch(JSON.stringify(parsed), /private|secret/);
  assert.throws(() => parseVercelFunctions({ summary, data: [{ total: 1 }] }));
  assert.throws(() => parseVercelFunctions({ summary, data: [{ timestamp: data[0].timestamp, total: -1 }] }));
  assert.throws(() => parseVercelFunctions({ summary, data: [data[0], data[0]] }));
  assert.deepEqual(parseVercelFunctions({ summary: [], data: [] }).history, []);
});
