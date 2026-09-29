import assert from "node:assert/strict";
import test from "node:test";

import { MOUNT_REFETCH_DEDUPE_MS, createMountRefetchGate, createRefetchLedger } from "./refetch-guard.ts";

const KEY = "/api/status/server";

test("挂载补取按键去重：窗口内只放第一个消费者，过了窗口或换键都放行", () => {
  const gate = createMountRefetchGate();
  assert.equal(gate.claim(KEY, 1_000), true);
  assert.equal(gate.claim(KEY, 1_000 + MOUNT_REFETCH_DEDUPE_MS - 1), false);
  assert.equal(gate.claim("/api/status/pulse", 1_001), true);
  assert.equal(gate.claim(KEY, 1_000 + MOUNT_REFETCH_DEDUPE_MS), true);
});

test("账本：被丢弃时还有别的在路上，就等它们都结束再补一次，补完清账", () => {
  const ledger = createRefetchLedger();
  const first = ledger.begin(KEY);
  const second = ledger.begin(KEY);
  ledger.end(KEY, first);
  ledger.discarded(KEY); // first 被 second 顶掉
  assert.equal(ledger.settle(KEY), false, "second 还在路上，先别补");
  ledger.end(KEY, second); // second 失败了，没有接受也没有丢弃
  assert.equal(ledger.settle(KEY), true, "全结束了、账还欠着，补一次");
  assert.equal(ledger.settle(KEY), false, "清过账就不再补");
});

test("账本：更晚发出的落地了，之前的丢弃不欠；先落地的更晚那条也让后到的丢弃不欠", () => {
  const ledger = createRefetchLedger();
  const first = ledger.begin(KEY);
  const second = ledger.begin(KEY);
  ledger.end(KEY, first);
  ledger.discarded(KEY);
  ledger.end(KEY, second);
  ledger.accepted(KEY);
  assert.equal(ledger.settle(KEY), false);

  const third = ledger.begin(KEY);
  const fourth = ledger.begin(KEY);
  ledger.end(KEY, fourth);
  ledger.accepted(KEY); // 更晚发出的先落地
  ledger.end(KEY, third);
  ledger.discarded(KEY); // 老的后到，被丢弃
  assert.equal(ledger.settle(KEY), false, "更新的数据已经在缓存里，不欠");
});

/**
 * 按 SWR 的丢弃规则做的离散事件模型：谁最后发出，谁是「当前」；成功返回时不是「当前」
 * 就被丢弃（被更晚的顶掉），是当前但和一次推送重叠也被丢弃，否则被接受；失败既不接受
 * 也不丢弃。结果在交给 SWR 之前先出账，宏任务里再看欠不欠补取。数出整个时间窗里发了几条。
 *
 * `policy: "always"` 是改之前的做法：被丢弃就立刻再问。
 */
function simulate(options: {
  initial: number;
  latencyMs: number | ((seq: number) => number);
  horizonMs: number;
  policy: "ledger" | "always";
  fails?: (seq: number) => boolean;
  overlapsPush?: (seq: number) => boolean;
}): number {
  const ledger = createRefetchLedger();
  let current = 0;
  let started = 0;
  const finishing: { at: number; seq: number }[] = [];
  const latencyOf = (seq: number) => (typeof options.latencyMs === "number" ? options.latencyMs : options.latencyMs(seq));
  const start = (at: number) => {
    const seq = ledger.begin(KEY);
    current = seq;
    started += 1;
    finishing.push({ at: at + latencyOf(seq), seq });
  };
  for (let index = 0; index < options.initial; index += 1) start(0);
  while (finishing.length) {
    finishing.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const { at, seq } = finishing.shift()!;
    if (at > options.horizonMs) break;
    ledger.end(KEY, seq);
    if (!options.fails?.(seq)) {
      if (current !== seq || options.overlapsPush?.(seq)) {
        ledger.discarded(KEY);
        if (options.policy === "always") start(at);
      } else {
        ledger.accepted(KEY);
      }
    }
    if (options.policy === "ledger" && ledger.settle(KEY)) start(at);
  }
  return started;
}

test("两个消费者同时补取：从前「被丢就再问」无限接力，记账之后到此为止", () => {
  // 2026-09 生产事故的形状：一个键两个消费者，挂载补取两条并发，往返 450 ms，观察 30 秒
  const before = simulate({ initial: 2, latencyMs: 450, horizonMs: 30_000, policy: "always" });
  const after = simulate({ initial: 2, latencyMs: 450, horizonMs: 30_000, policy: "ledger" });
  assert.ok(before > 100, `从前应当停不下来，实际只发了 ${before} 条`);
  assert.equal(after, 2, "记账之后只有最初那两条");
});

test("更晚发出的那条失败了：补一次，补的那次落地就收工（不会一直等到重新聚焦）", () => {
  const total = simulate({ initial: 2, latencyMs: 450, horizonMs: 30_000, policy: "ledger", fails: (seq) => seq === 2 });
  assert.equal(total, 3);
});

test("补的那次也失败了：不再接力", () => {
  const total = simulate({ initial: 2, latencyMs: 450, horizonMs: 30_000, policy: "ledger", fails: (seq) => seq >= 2 });
  assert.equal(total, 3);
});

test("更晚发出的先落地、老的后到被丢弃：不多补", () => {
  const total = simulate({ initial: 2, latencyMs: (seq) => (seq === 1 ? 900 : 300), horizonMs: 30_000, policy: "ledger" });
  assert.equal(total, 2);
});

test("回源途中被推送盖过（没有别的在路上）：照旧补一次，补的那条落地就收工", () => {
  const total = simulate({ initial: 1, latencyMs: 450, horizonMs: 30_000, policy: "ledger", overlapsPush: (seq) => seq === 1 });
  assert.equal(total, 2);
});

test("补的那次又被推送盖过：再补一次，每次都是单条在路上，不会滚成雪球", () => {
  const total = simulate({ initial: 1, latencyMs: 450, horizonMs: 30_000, policy: "ledger", overlapsPush: (seq) => seq <= 3 });
  assert.equal(total, 4);
});

test("两条都失败：没有丢弃就没有账，不补", () => {
  const total = simulate({ initial: 2, latencyMs: 450, horizonMs: 30_000, policy: "ledger", fails: () => true });
  assert.equal(total, 2);
});
