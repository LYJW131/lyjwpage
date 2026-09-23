import assert from "node:assert/strict";
import test from "node:test";

import { LEDGER_BUCKET_MS, LEDGER_WINDOW_MS, recordPush, reporterCommitOf, summarizeLedger } from "./reporter-ledger.ts";

const T0 = 1_790_200_200_000;

test("同一格累加、跨格新开，旧格子滑出窗口", () => {
  let ledger = recordPush(null, T0, "abc1234");
  ledger = recordPush(ledger, T0 + 1_000, "abc1234");
  ledger = recordPush(ledger, T0 + LEDGER_BUCKET_MS, "def5678");
  assert.equal(ledger.buckets.length, 2);
  assert.equal(summarizeLedger(ledger, T0 + LEDGER_BUCKET_MS)?.pushes, 3);
  assert.equal(ledger.commit, "def5678");

  const later = recordPush(ledger, T0 + LEDGER_WINDOW_MS + 2 * LEDGER_BUCKET_MS, "def5678");
  assert.deepEqual(later.buckets.map(([, n]) => n), [1]);
});

test("读的时候按此刻裁窗口：上报器停了，次数跟着掉下去", () => {
  const ledger = recordPush(recordPush(null, T0, null), T0 + 60_000, null);
  const fresh = summarizeLedger(ledger, T0 + 120_000)!;
  assert.equal(fresh.pushes, 2);
  // 账本刚开始记：起点是第一格，不冒充满 12 小时
  assert.ok(fresh.start > T0 - LEDGER_BUCKET_MS && fresh.start <= T0);
  const stale = summarizeLedger(ledger, T0 + LEDGER_WINDOW_MS + LEDGER_BUCKET_MS * 2)!;
  assert.equal(stale.pushes, 0);
  assert.equal(stale.end - stale.start, LEDGER_WINDOW_MS);
  assert.equal(summarizeLedger(null, T0), null);
});

test("报文里的提交只认十六进制哈希，乱写的当没带", () => {
  assert.equal(reporterCommitOf({ reporterCommit: "b15e3cc" }), "b15e3cc");
  assert.equal(reporterCommitOf({ reporterCommit: "not a sha" }), null);
  assert.equal(reporterCommitOf({}), null);
  assert.equal(reporterCommitOf(null), null);
});
