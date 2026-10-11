import assert from "node:assert/strict";
import test from "node:test";

import { admitTurn, designRequestId, MAX_TURN_RECORDS, PREPARED_STALE_MS, trimTurnBook, turnInputText, VISITOR_REPLY_PREFIX, type DesignTurn, type TurnBook } from "./chat/design-turns.ts";

const NOW = 1_700_000_000_000;
const turn = (requestId: string, state: DesignTurn["state"], overrides: Partial<DesignTurn> = {}): DesignTurn => ({
  requestId,
  latest: `latest-${requestId}`,
  state,
  preparedAt: NOW,
  views: [],
  reads: [],
  ...overrides,
});
const book = (...turns: DesignTurn[]): TurnBook => ({ current: turns.at(-1)?.requestId, turns: Object.fromEntries(turns.map((entry) => [entry.requestId, entry])) });

test("同一 requestId 挂回自己的记录，finished 终结，cancelled 也按旧回合处理而不新建", () => {
  const submitted = book(turn("a", "submitted"));
  assert.deepEqual(admitTurn(submitted, "a", "latest-a", NOW).status, "attached");
  assert.deepEqual(admitTurn(book(turn("a", "finished")), "a", "latest-a", NOW).status, "finished");
  assert.deepEqual(admitTurn(book(turn("a", "cancelled")), "a", "latest-a", NOW).status, "attached");
  assert.deepEqual(admitTurn(book(turn("a", "prepared")), "a", "changed-latest", NOW).status, "mismatch");
});

test("当前回合 submitted 或新鲜 prepared 时别的请求判忙，终态与过期草稿放行", () => {
  assert.deepEqual(admitTurn(book(turn("a", "submitted")), "b", "latest-b", NOW).status, "busy");
  assert.deepEqual(admitTurn(book(turn("a", "prepared")), "b", "latest-b", NOW).status, "busy");
  assert.deepEqual(admitTurn(book(turn("a", "finished")), "b", "latest-b", NOW).status, "prepared");
  assert.deepEqual(admitTurn(book(turn("a", "cancelled")), "b", "latest-b", NOW).status, "prepared");
  const stale = book(turn("a", "prepared", { preparedAt: NOW - PREPARED_STALE_MS }));
  assert.deepEqual(admitTurn(stale, "b", "latest-b", NOW).status, "prepared");
});

test("新回合之后重放旧请求仍命中自己的记录，不挤掉最新回合", () => {
  const older = turn("a", "finished", { preparedAt: NOW - 10_000, result: { complete: true, asked: true, views: [] } });
  const newer = turn("b", "submitted");
  const ledger = book(older, newer);
  const replay = admitTurn(ledger, "a", "latest-a", NOW + 1);
  assert.equal(replay.status, "finished");
  assert.equal(replay.status === "finished" && replay.turn.result?.asked, true);
  assert.equal(ledger.current, "b");
  assert.equal(ledger.turns.b.state, "submitted");
});

test("裁剪优先丢最旧的终态与过期草稿，当前与在途记录一律保留", () => {
  const turns: DesignTurn[] = [];
  for (let index = 0; index < MAX_TURN_RECORDS + 4; index++) turns.push(turn(`t${index}`, "finished", { preparedAt: NOW - (MAX_TURN_RECORDS + 4 - index) }));
  const ledger = { current: "live", turns: Object.fromEntries(turns.map((entry) => [entry.requestId, entry])) };
  ledger.turns.live = turn("live", "submitted", { preparedAt: NOW });
  ledger.turns.fresh = turn("fresh", "prepared", { preparedAt: NOW });
  trimTurnBook(ledger, NOW);
  assert.equal(Object.keys(ledger.turns).length, MAX_TURN_RECORDS);
  assert.ok(ledger.turns.live && ledger.turns.fresh);
  assert.ok(!ledger.turns.t0 && !ledger.turns.t1 && !ledger.turns.t2 && !ledger.turns.t3);
});

test("turnInputText 只在存在挂起交互时给回复套上前缀", () => {
  assert.equal(turnInputText({ kind: "reply", text: "A" }, true), `${VISITOR_REPLY_PREFIX}A`);
  assert.equal(turnInputText({ kind: "reply", text: "A" }, false), "A");
  assert.match(turnInputText({ kind: "open", history: [{ role: "user", content: "X" }] }, false), /<visitor>\nX\n<\/visitor>/);
});

test("requestId 绑定上一条签章与最新访客消息：同历史同键，换上下文换键", async () => {
  const history = [
    { role: "user" as const, content: "first" },
    { role: "assistant" as const, content: "reply", seal: "seal-1" },
    { role: "user" as const, content: "same words" },
  ];
  const id = await designRequestId(history);
  assert.equal(id, await designRequestId(history));
  assert.notEqual(id, await designRequestId([history[0], { ...history[1], seal: "seal-2" }, history[2]]));
  assert.notEqual(id, await designRequestId([{ role: "user", content: "same words" }]));
});
