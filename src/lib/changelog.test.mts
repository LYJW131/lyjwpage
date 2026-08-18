import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANGELOG,
  LATEST_VERSION,
  compareRef,
  displayDate,
  unreadCount,
} from "./changelog.ts";

/**
 * 这个文件是手写维护的，而写歪的后果都很安静：版本号写重了「有几条没看过」
 * 会少数一条，顺序排反了 compare 链接的区间会掉个头，两样在页面上都不显眼。
 * 所以那几条不变量在这里拦。
 */

test("版本号严格递减，最新的在最前面", () => {
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    assert.ok(
      CHANGELOG[i - 1].version > CHANGELOG[i].version,
      `第 ${i} 条的版本号没有比上一条小：${CHANGELOG[i - 1].version} → ${CHANGELOG[i].version}`,
    );
  }
  assert.equal(LATEST_VERSION, CHANGELOG[0].version);
});

test("日期不递增，且是 YYYY-MM-DD", () => {
  for (const entry of CHANGELOG) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.title);
  }
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    // 同一天可以有多条，所以是「不早于」而不是「晚于」
    assert.ok(
      CHANGELOG[i - 1].date >= CHANGELOG[i].date,
      `第 ${i} 条的日期比上一条还新：${CHANGELOG[i - 1].date} → ${CHANGELOG[i].date}`,
    );
  }
});

test("每条都有标题和至少一条正文，commit 填了就得是短 sha", () => {
  for (const entry of CHANGELOG) {
    assert.ok(entry.title.length > 0, `第 ${entry.version} 条没有标题`);
    assert.ok(entry.notes.length > 0, `第 ${entry.version} 条没有正文`);
    if (entry.commit !== undefined) {
      assert.match(entry.commit, /^[0-9a-f]{7,40}$/, entry.title);
    }
  }
});

test("提交区间的起点取更旧那条，最旧的一条退成「从头到这里」", () => {
  assert.equal(compareRef(1), "compare/f653bf6...503c468");
  assert.equal(compareRef(CHANGELOG.length - 1), "commits/fe56985");
  // 没填 commit 的那条不给链接，而不是拼一个近似的区间出来
  assert.equal(compareRef(0), null);
  assert.equal(compareRef(CHANGELOG.length), null);
});

test("日期只做字符串替换，不过 Date", () => {
  assert.equal(displayDate("2026-08-18"), "2026/08/18");
});

test("第一次来的人没有「上一次」，不算未读", () => {
  assert.equal(unreadCount(null), 0);
  assert.equal(unreadCount(LATEST_VERSION), 0);
  assert.equal(unreadCount(LATEST_VERSION - 1), 1);
  assert.equal(unreadCount(0), CHANGELOG.length);
  // 先逛过预览部署、再回到线上那份时 seen 会比线上的还新，不能算出负数或倒着提示
  assert.equal(unreadCount(LATEST_VERSION + 5), 0);
});
