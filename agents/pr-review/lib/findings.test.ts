import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimitReset } from "./devin.js";
import { parseFindings } from "./findings.js";

const one = { kind: "bug", severity: "medium", file: "a.ts", line: 3, title: "t", detail: "d" };

test("parseFindings 取最后一个能解析的 findings 对象，容忍前置文字与代码块", () => {
  assert.deepEqual(parseFindings(`{"findings": []}`), []);
  assert.deepEqual(parseFindings(`I checked it.\n\`\`\`json\n${JSON.stringify({ findings: [one] })}\n\`\`\`\n`), [one]);
  assert.deepEqual(parseFindings(`draft {"findings": [1]} final ${JSON.stringify({ findings: [one] })}`), [one]);
});

test("parseFindings 没有对象或字段不合规时抛错，不当作没有发现", () => {
  assert.throws(() => parseFindings("No issues found."));
  assert.throws(() => parseFindings(JSON.stringify({ findings: [{ ...one, severity: "critical" }] })));
});

test("rateLimitReset 读出 UTC 重置时刻，已过的算到第二天", () => {
  const now = new Date("2026-10-28T05:00:00Z");
  assert.equal(rateLimitReset("Reached free model rate limit, reset in 1 hour (at 06:01 UTC)", now)?.toISOString(), "2026-10-28T06:01:00.000Z");
  assert.equal(rateLimitReset("rate limit reset at 04:10 UTC", now)?.toISOString(), "2026-10-29T04:10:00.000Z");
  assert.equal(rateLimitReset("connection error", now), null);
});
