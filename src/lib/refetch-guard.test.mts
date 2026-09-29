import assert from "node:assert/strict";
import test from "node:test";

import {
  MOUNT_REFETCH_DEDUPE_MS,
  createInflightLedger,
  createMountRefetchGate,
  shouldReaskAfterDiscard,
} from "./refetch-guard.ts";

test("在路上的回源按键记账，出账不会记成负数", () => {
  const ledger = createInflightLedger();
  assert.equal(ledger.pending("/api/status/server"), 0);
  ledger.begin("/api/status/server");
  ledger.begin("/api/status/server");
  ledger.begin("/api/status/pulse");
  assert.equal(ledger.pending("/api/status/server"), 2);
  assert.equal(ledger.pending("/api/status/pulse"), 1);
  ledger.end("/api/status/server");
  assert.equal(ledger.pending("/api/status/server"), 1);
  ledger.end("/api/status/server");
  ledger.end("/api/status/server");
  assert.equal(ledger.pending("/api/status/server"), 0);
});

test("被丢弃时别处还有回源在路上就不再问，没有才再问（被推送盖过的那种）", () => {
  assert.equal(shouldReaskAfterDiscard(0), true);
  assert.equal(shouldReaskAfterDiscard(1), false);
  assert.equal(shouldReaskAfterDiscard(3), false);
});

test("挂载补取按键去重：窗口内只放第一个消费者，过了窗口或换键都放行", () => {
  const gate = createMountRefetchGate();
  assert.equal(gate.claim("/api/status/server", 1_000), true);
  assert.equal(gate.claim("/api/status/server", 1_000 + MOUNT_REFETCH_DEDUPE_MS - 1), false);
  assert.equal(gate.claim("/api/status/pulse", 1_001), true);
  assert.equal(gate.claim("/api/status/server", 1_000 + MOUNT_REFETCH_DEDUPE_MS), true);
});

/**
 * 按 SWR 的丢弃规则做的离散事件模型：谁最后发出，谁是「当前」；完成时不是「当前」
 * 就被丢弃，交给 onDiscarded；结果在交给 SWR 之前先出账。数出整个时间窗里一共发了几条请求。
 */
function simulate(reask: (pendingOthers: number) => boolean, initial: number, latencyMs: number, horizonMs: number): number {
  let nextId = 0;
  let current = -1;
  let started = 0;
  const pending = new Set<number>();
  const finishing: { at: number; id: number }[] = [];
  const start = (at: number) => {
    const id = nextId++;
    started += 1;
    current = id;
    pending.add(id);
    finishing.push({ at: at + latencyMs, id });
  };
  for (let index = 0; index < initial; index += 1) start(0);
  while (finishing.length) {
    finishing.sort((a, b) => a.at - b.at || a.id - b.id);
    const { at, id } = finishing.shift()!;
    if (at > horizonMs) break;
    pending.delete(id);
    if (current !== id && reask(pending.size)) start(at);
  }
  return started;
}

test("两个消费者同时补取：从前「被丢就再问」无限接力，闸门之后到此为止", () => {
  // 2026-09 生产事故的形状：一个键两个消费者，挂载补取两条并发，往返 450 ms，观察 30 秒
  const before = simulate(() => true, 2, 450, 30_000);
  const after = simulate(shouldReaskAfterDiscard, 2, 450, 30_000);
  assert.ok(before > 100, `从前应当停不下来，实际只发了 ${before} 条`);
  assert.equal(after, 2, "闸门之后只有最初那两条");
});
