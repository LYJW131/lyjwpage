import assert from "node:assert/strict";
import test from "node:test";

import { devinUsageDays } from "../dist/devin-usage.js";

const model = (input: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number, cost: number) => ({
  input, output, cacheRead, cacheWrite, reasoning, cost, tokens: input + output + cacheRead + cacheWrite + reasoning, messages: 1,
});

const body = {
  contributions: [
    { date: "2026-10-09", clients: [{ client: "devin-cli", models: { "swe-2-high": model(10, 5, 100, 0, 0, 0) } }] },
    { date: "2026-10-08", clients: [{ client: "claude", models: { "claude-opus-5-5": model(1, 1, 1, 1, 0, 1) } }] },
    { date: "2026-10-10", clients: [{ client: "codex", models: { "gpt-6.1-sol": model(1, 2, 3, 0, 4, 1) } }] },
    {
      date: "2026-10-11",
      clients: [
        { client: "codex", models: { "gpt-6.1-sol": model(1, 2, 3, 0, 4, 1) } },
        {
          client: "devin-cli",
          models: { "gpt-6-astra-xhigh": model(1, 2, 30, 7, 3, 1.5), summarizer: model(0, 0, 0, 0, 0, 0) },
        },
      ],
    },
  ],
};

test("devinUsageDays keeps only devin-cli and confirms zero days after its first appearance", () => {
  const days = devinUsageDays(body);
  assert.deepEqual(days.map((day) => day.date), ["2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.equal(days[0].totalTokens, 115);
  assert.equal(days[0].costComplete, false);
  assert.deepEqual(days[0].models, [{ model: "swe-2-high", tokens: 115 }]);
  assert.equal(days[1].totalTokens, 0);
  assert.deepEqual(days[1].models, []);
  assert.equal(days[1].costComplete, true);
});

test("devinUsageDays folds reasoning into output so the four columns add up", () => {
  const day = devinUsageDays(body).at(-1)!;
  assert.equal(day.outputTokens, 5);
  assert.equal(day.reasoningTokens, 3);
  assert.equal(day.totalTokens, 1 + 5 + 30 + 7);
  assert.equal(day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheCreationTokens, day.totalTokens);
  assert.equal(day.apiEquivalentCostUSD, 1.5);
  assert.equal(day.costComplete, true);
  assert.deepEqual(day.models, [{ model: "gpt-6-astra-xhigh", tokens: 43 }]);
});

test("devinUsageDays returns nothing before Devin CLI is ever used and rejects malformed rows", () => {
  assert.deepEqual(devinUsageDays({ contributions: [body.contributions[1]] }), []);
  assert.throws(() => devinUsageDays({}), /contributions missing/);
  assert.throws(
    () => devinUsageDays({ contributions: [{ date: "2026-10-11", clients: [{ client: "devin-cli", models: { x: { input: -1 } } }] }] }),
    /invalid/,
  );
});
