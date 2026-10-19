import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Vector = { name: string; service: string; message: string; status?: number; signature: string; hash: string };
type Event = Record<string, unknown>;
type Request = { body: { timeframe: { from: number; to: number }; offset?: string; limit: number } };
type Signature = { signature: string; text: string; service: string; count: number; firstSeen: number; lastSeen: number; sample: { message: string; status: number | null } };
type Result = { window: { from: number; to: number }; events: number; previews: Record<string, number>; queries: number; sampled: boolean; truncated: boolean; signatures: Signature[] };

const source = readFileSync(new URL("./errors-query.js", import.meta.url), "utf8");
const vectors = JSON.parse(readFileSync(new URL("./signature-vectors.json", import.meta.url), "utf8")) as Vector[];
const HOUR = 3_600_000;
const TO = 1_800_000_000_000;

function run(window: { from: number; to: number }, respond: (request: Request) => { events: Event[]; abr?: number }): Promise<Result> {
  const rendered = source.replace("const WINDOW = { from: null, to: null };", `const WINDOW = { from: ${window.from}, to: ${window.to} };`);
  assert.notEqual(rendered, source);
  const request = async (options: Request) => {
    const { events, abr = 1 } = respond(options);
    return { success: true, result: { events: { events }, statistics: { abr_level: abr } } };
  };
  const query = new Function("cloudflare", "accountId", `return (${rendered})();`) as (cloudflare: unknown, accountId: string) => Promise<Result>;
  return query({ request }, "account");
}

function event(id: string, at: number, service: string, message: string, extra: { status?: number; preview?: string; error?: string } = {}): Event {
  return {
    timestamp: at,
    source: { message },
    $metadata: { id, service, level: "error", message, ...(extra.error ? { error: extra.error } : {}), trigger: "GET /x" },
    $workers: {
      scriptName: service,
      scriptVersion: { id: "v1" },
      event: extra.status === undefined ? { request: {} } : { request: {}, response: { status: extra.status } },
      ...(extra.preview ? { preview: { slug: extra.preview } } : {}),
    },
  };
}

test("签名与 check.py 跑同一份测试向量", async () => {
  const events = vectors.map((v, i) => event(`e${i}`, TO - HOUR + i, v.service, v.message, { status: v.status }));
  const result = await run({ from: TO - HOUR, to: TO }, () => ({ events }));
  const got = new Map(result.signatures.map((s) => [s.text, s.signature]));
  for (const v of vectors) assert.equal(got.get(v.signature), v.hash, v.name);
  assert.equal(result.events, vectors.length);
});

test("同一签名合并计数与首末时间，预览只计数，$metadata.error 优先于 message", async () => {
  const events = [
    event("a", TO - 30, "core", "Network connection lost."),
    event("b", TO - 10, "core", "Network connection lost."),
    event("c", TO - 20, "core", "Network connection lost."),
    event("d", TO - 5, "core", "boom", { preview: "claude-branch-x1" }),
    event("e", TO - 1, "ai", "log line", { error: "TypeError: x is undefined" }),
  ];
  const result = await run({ from: TO - HOUR, to: TO }, () => ({ events }));
  const lost = result.signatures.find((s) => s.text === "core: Network connection lost.");
  assert.deepEqual([lost?.count, lost?.firstSeen, lost?.lastSeen], [3, TO - 30, TO - 10]);
  assert.deepEqual(result.previews, { core: 1 });
  assert.deepEqual(result.signatures.map((s) => s.text).sort(), ["ai: TypeError: x is undefined", "core: Network connection lost."]);
});

test("抽样的时间段对半拆开重查，落在拆分点上的事件只算一次", async () => {
  const seen: Array<[number, number]> = [];
  const result = await run({ from: TO - HOUR, to: TO }, ({ body }) => {
    const { from, to } = body.timeframe;
    seen.push([from, to]);
    if (to - from > 30 * 60_000) return { events: [], abr: 10 };
    return { events: [event("edge", TO - 30 * 60_000, "site", "x")] };
  });
  assert.deepEqual(seen, [[TO - HOUR, TO], [TO - HOUR, TO - 30 * 60_000], [TO - 30 * 60_000, TO]]);
  assert.equal(result.sampled, false);
  assert.equal(result.signatures[0].count, 1);
});

test("拆到 15 分钟还抽样就照收并标 sampled", async () => {
  const result = await run({ from: TO - 15 * 60_000, to: TO }, () => ({ events: [event("a", TO - 1, "site", "x")], abr: 10 }));
  assert.equal(result.sampled, true);
  assert.equal(result.queries, 1);
  assert.equal(result.events, 1);
});

test("一页 2000 条满了就按最后一条的 id 翻页", async () => {
  const offsets: Array<string | undefined> = [];
  const result = await run({ from: TO - HOUR, to: TO }, ({ body }) => {
    offsets.push(body.offset);
    if (body.offset) return { events: [event("last", TO - 2, "site", "y")] };
    return { events: Array.from({ length: body.limit }, (_, i) => event(`p${i}`, TO - 3 - i, "site", "y")) };
  });
  assert.deepEqual(offsets, [undefined, `p${1999}`]);
  assert.equal(result.signatures[0].count, 2001);
  assert.equal(result.truncated, false);
});

test("窗口按 3 小时切段", async () => {
  const seen: Array<[number, number]> = [];
  await run({ from: TO - 7 * HOUR, to: TO }, ({ body }) => {
    seen.push([body.timeframe.from, body.timeframe.to]);
    return { events: [] };
  });
  assert.deepEqual(seen, [[TO - 7 * HOUR, TO - 4 * HOUR], [TO - 4 * HOUR, TO - HOUR], [TO - HOUR, TO]]);
});
