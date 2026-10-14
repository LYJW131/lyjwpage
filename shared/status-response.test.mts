import assert from "node:assert/strict";
import test from "node:test";

import { AwaitingReport } from "./awaiting-report.ts";
import { LagResult } from "./lag-result.ts";
import {
  loaderParams,
  sinceDateParam,
  sinceParam,
  statusEnvelope,
  statusResponse,
  titleIdsParam,
  withPublicCors,
} from "./status-response.ts";

const url = (query: string) => `https://lyjw.me/api/status/charger${query}`;
const req = (query: string) => new Request(url(query));

test("since 数字参数：有限数原样，非法或缺失为 undefined", () => {
  assert.equal(sinceParam(req("?since=1700000000000")), 1_700_000_000_000);
  assert.equal(sinceParam(req("?since=1.5")), 1.5);
  assert.equal(sinceParam(req("?since=-50")), -50);
  assert.equal(sinceParam(req("?since=")), 0);
  assert.equal(sinceParam(req("?since=abc")), undefined);
  assert.equal(sinceParam(req("?since=1e999")), undefined);
  assert.equal(sinceParam(req("")), undefined);
});

test("since 日期参数：只认 YYYY-MM-DD 完整形状", () => {
  assert.equal(sinceDateParam(req("?since=2026-10-14")), "2026-10-14");
  assert.equal(sinceDateParam(req("?since=2026-1-4")), undefined);
  assert.equal(sinceDateParam(req("?since=1700000000000")), undefined);
  assert.equal(sinceDateParam(req("?since=2026-10-14T00:00:00Z")), undefined);
  assert.equal(sinceDateParam(req("")), undefined);
});

test("titleids：缺省是 undefined（全量），空串是空集，逗号分隔去空白去空段", () => {
  assert.equal(titleIdsParam(req("")), undefined);
  assert.deepEqual(titleIdsParam(req("?titleids=")), []);
  assert.deepEqual(titleIdsParam(req("?titleids=a,b")), ["a", "b"]);
  assert.deepEqual(titleIdsParam(req("?titleids=a,+b+,,")), ["a", "b"]);
  assert.deepEqual(titleIdsParam(req("?titleids=a%2Cb")), ["a", "b"]);
});

test("loaderParams 一次拆齐三个参数", () => {
  assert.deepEqual(loaderParams(req("?since=2026-10-14&titleids=a,b")), {
    since: undefined,
    sinceDate: "2026-10-14",
    titleIds: ["a", "b"],
  });
  assert.deepEqual(loaderParams(req("?since=123")), {
    since: 123,
    sinceDate: undefined,
    titleIds: undefined,
  });
});

test("信封：普通值只带 servedAt，LagResult 另带 updatedAt", async () => {
  const plain = await statusEnvelope(async () => ({ n: 1 }));
  assert.equal(plain.ok, true);
  if (plain.ok) {
    assert.deepEqual(plain.data, { n: 1 });
    assert.equal(plain.updatedAt, undefined);
    assert.equal(typeof plain.servedAt, "number");
  }

  const lagged = await statusEnvelope(async () => new LagResult({ n: 2 }, 42));
  assert.deepEqual(lagged, { ok: true, data: { n: 2 }, updatedAt: 42, servedAt: lagged.ok ? lagged.servedAt : 0 });
});

test("信封：AwaitingReport 透传原因，其他错误一律改成「状态暂不可用」", async () => {
  const waiting = await statusEnvelope(async () => {
    throw new AwaitingReport("等待 server 首次上报");
  });
  assert.deepEqual(waiting, { ok: false, error: "等待 server 首次上报" });

  const failed = await statusEnvelope(async () => {
    throw new Error("db gone");
  });
  assert.deepEqual(failed, { ok: false, error: "状态暂不可用" });

  const thrown = await statusEnvelope(async () => {
    throw "boom";
  });
  assert.deepEqual(thrown, { ok: false, error: "状态暂不可用" });
});

test("statusResponse：200、no-store、取数时刻在头里而不是载荷里", async () => {
  const response = statusResponse({ ok: true, data: { n: 1 }, servedAt: 1_000 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("X-Fetched-At") ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await response.json(), { ok: true, data: { n: 1 }, servedAt: 1_000 });
});

test("withPublicCors 合并跨域头并暴露取数头，状态码原样", async () => {
  const base = new Response("body", { status: 201, headers: { "X-Origin": "a" } });
  const cors = new Headers({ "Access-Control-Allow-Origin": "*" });
  const merged = withPublicCors(base, cors);
  assert.equal(merged.status, 201);
  assert.equal(merged.headers.get("X-Origin"), "a");
  assert.equal(merged.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(merged.headers.get("Access-Control-Expose-Headers"), "X-Fetched-At, X-Edge-Cache");
  assert.equal(await merged.text(), "body");
});
