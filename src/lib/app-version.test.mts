import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_RELOAD_COOLDOWN_MS,
  AUTO_RELOAD_MAX_TRIES,
  AUTO_RELOAD_MEMORY,
  AUTO_RELOAD_RETRY_AFTER_MS,
  EMPTY_AUTO_RELOAD_LEDGER,
  autoReloadDecision,
  parseAutoReloadLedger,
  rebaseAutoReloadLedger,
  recordAutoReload,
  resolveVersionStatus,
  settleAutoReloadLedger,
  type AutoReloadInput,
  type AutoReloadLedger,
} from "./app-version.ts";

test("两边 sha 一致就是最新", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "a".repeat(40)), "current");
});

test("对不上就是旧页面", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "b".repeat(40)), "stale");
});

test("任一边拿不到都是 unknown，不误报成旧", () => {
  assert.equal(resolveVersionStatus(null, "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), null), "unknown");
  assert.equal(resolveVersionStatus(null, null), "unknown");
  assert.equal(resolveVersionStatus("", "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), ""), "unknown");
});

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const NOW = 10_000_000;
const base: AutoReloadInput = {
  status: "stale",
  latestCommit: B,
  trigger: "background",
  hidden: true,
  playerBusy: false,
  ledger: EMPTY_AUTO_RELOAD_LEDGER,
  now: NOW,
};
const decide = (patch: Partial<AutoReloadInput>) => autoReloadDecision({ ...base, ...patch }).action;

test("自动刷新：旧页面在后台就刷", () => {
  assert.equal(decide({}), "reload");
});

test("自动刷新：后台场景下页面看得见就不动，前台只提示、交给版本提示卡", () => {
  assert.equal(decide({ hidden: false }), "skip");
});

test("自动刷新：整页已被错误页顶替（page-crash）没有交互可打断，可见也刷", () => {
  assert.equal(decide({ trigger: "page-crash", hidden: false }), "reload");
  assert.equal(decide({ trigger: "page-crash", hidden: true }), "reload");
});

test("自动刷新：不是确知的旧页面（最新 / unknown）一律不刷", () => {
  assert.equal(decide({ status: "current" }), "skip");
  assert.equal(decide({ status: "unknown" }), "skip");
  assert.equal(decide({ status: "unknown", trigger: "page-crash", hidden: false }), "skip");
  assert.equal(decide({ latestCommit: null }), "skip");
});

test("自动刷新：同一个目标一轮最多试 AUTO_RELOAD_MAX_TRIES 次，试满就等到这一轮过去，之后缓存恢复了还刷得到", () => {
  // ESA 边缘一直吐旧 HTML：页面 sha 不变，版本接口一直答 B
  let ledger = EMPTY_AUTO_RELOAD_LEDGER;
  let now = NOW;
  const decide = (patch: Partial<AutoReloadInput> = {}) => autoReloadDecision({ ...base, latestCommit: B, ledger, now, ...patch });
  const reload = () => {
    assert.equal(decide().action, "reload");
    ledger = recordAutoReload(ledger, B, now);
  };

  reload();
  assert.deepEqual(decide(), { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS }, "刷回来还是旧的：先过冷却，不是立刻再刷");
  for (let attempt = 2; attempt <= AUTO_RELOAD_MAX_TRIES; attempt += 1) {
    now += AUTO_RELOAD_COOLDOWN_MS;
    reload();
  }
  // 每次都等满了冷却，这时拦住它的只会是「试满了」
  now += AUTO_RELOAD_COOLDOWN_MS;
  const lastTryAt = now - AUTO_RELOAD_COOLDOWN_MS;
  const untilNextRound = lastTryAt + AUTO_RELOAD_RETRY_AFTER_MS - now;
  assert.deepEqual(decide(), { action: "wait", ms: untilNextRound });
  assert.deepEqual(decide({ trigger: "page-crash", hidden: false }), { action: "wait", ms: untilNextRound }, "错误页也一样");
  now += untilNextRound - 1;
  assert.deepEqual(decide(), { action: "wait", ms: 1 });
  // 这一轮过去了，缓存若已恢复，页面就刷到新版；没恢复就再试一轮，次数从头数
  now += 1;
  reload();
  assert.equal(ledger.tries.find((entry) => entry.sha === B)?.count, 1);
});

test("自动刷新：版本接口在两个 sha 间来回，每个目标各试 AUTO_RELOAD_MAX_TRIES 次就停（只记最后一个的话会被交替覆盖、无限刷）", () => {
  let ledger = EMPTY_AUTO_RELOAD_LEDGER;
  let now = NOW;
  let reloads = 0;
  // ESA 一直吐旧 HTML（页面 sha 不变），版本接口 B、A、B、A…… 来回，每次间隔都超过冷却，
  // 总时长不到一轮，挡住后面几次的只有「试满了」
  const steps = 2 * AUTO_RELOAD_MAX_TRIES + 1;
  assert.ok(steps * (AUTO_RELOAD_COOLDOWN_MS + 1_000) < AUTO_RELOAD_RETRY_AFTER_MS, "调过常量：这里的总时长要仍小于一轮");
  for (let step = 0; step < steps; step += 1) {
    const latestCommit = step % 2 === 0 ? B : A;
    now += AUTO_RELOAD_COOLDOWN_MS + 1_000;
    if (autoReloadDecision({ ...base, latestCommit, ledger, now }).action === "reload") {
      reloads += 1;
      ledger = recordAutoReload(ledger, latestCommit, now);
    }
  }
  assert.equal(reloads, 2 * AUTO_RELOAD_MAX_TRIES, "B 和 A 各试满，之后都被拦下");
});

test("自动刷新：冷却里来了新版本先等，等满了再刷；版本一直在变也一次冷却只刷一次", () => {
  const ledger = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, NOW - 60_000);
  const early = autoReloadDecision({ ...base, latestCommit: B, ledger });
  assert.deepEqual(early, { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS - 60_000 });
  assert.equal(autoReloadDecision({ ...base, latestCommit: B, ledger, now: NOW + (AUTO_RELOAD_COOLDOWN_MS - 60_000) }).action, "reload");
  // 一连串新版本：只要每次都在冷却里，就一次也不刷
  let current = ledger;
  let reloads = 0;
  for (let step = 0; step < 6; step += 1) {
    const now = NOW + step * 10_000;
    const latestCommit = String(step).repeat(40);
    if (autoReloadDecision({ ...base, latestCommit, ledger: current, now }).action === "reload") {
      reloads += 1;
      current = recordAutoReload(current, latestCommit, now);
    }
  }
  assert.equal(reloads, 0);
});

test("自动刷新：系统时钟被往回拨过，冷却从现在重新数一个冷却期，落盘后等满就刷", () => {
  // 上一次刷新记的是 NOW + 1 小时，之后时钟被拨回到 NOW
  const skewed = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, NOW + 3_600_000);
  // 不落盘（hook 修之前的做法）：每次读出来的都是那个未来的时刻，判定永远只会说再等一个冷却期
  let now = NOW;
  for (let round = 0; round < 5; round += 1) {
    const stuck = autoReloadDecision({ ...base, latestCommit: B, ledger: skewed, now });
    assert.deepEqual(stuck, { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS });
    now += AUTO_RELOAD_COOLDOWN_MS;
  }
  // 按 hook 的做法：判定前先拉回并落盘，之后时间照常往前走
  let stored = skewed;
  const attempt = (at: number) => {
    stored = rebaseAutoReloadLedger(stored, at);
    return autoReloadDecision({ ...base, latestCommit: B, ledger: stored, now: at });
  };
  assert.deepEqual(attempt(NOW), { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS });
  assert.equal(stored.at, NOW, "冷却的起点被拉回到现在");
  assert.deepEqual(attempt(NOW + 60_000), { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS - 60_000 });
  assert.equal(attempt(NOW + AUTO_RELOAD_COOLDOWN_MS).action, "reload");

  // 试满的目标：「一轮」也从现在重新数，最多等一轮，不会照着未来的时刻等
  let exhausted: AutoReloadLedger = EMPTY_AUTO_RELOAD_LEDGER;
  for (let count = 1; count <= AUTO_RELOAD_MAX_TRIES; count += 1) exhausted = recordAutoReload(exhausted, B, NOW + 3_600_000 + count);
  assert.deepEqual(
    autoReloadDecision({ ...base, latestCommit: B, ledger: rebaseAutoReloadLedger(exhausted, NOW), now: NOW }),
    { action: "wait", ms: AUTO_RELOAD_RETRY_AFTER_MS },
  );
});

test("账本：只有时刻晚于现在才拉回，其余原样返回同一个对象", () => {
  const ledger = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, NOW);
  assert.equal(rebaseAutoReloadLedger(ledger, NOW), ledger);
  assert.equal(rebaseAutoReloadLedger(ledger, NOW + 1), ledger);
  assert.equal(rebaseAutoReloadLedger(EMPTY_AUTO_RELOAD_LEDGER, NOW), EMPTY_AUTO_RELOAD_LEDGER);
  const rebased = rebaseAutoReloadLedger(ledger, NOW - 1);
  assert.deepEqual(rebased, { tries: [{ sha: A, count: 1, at: NOW - 1 }], at: NOW - 1 });
  assert.equal(rebaseAutoReloadLedger(rebased, NOW - 1), rebased, "拉回之后再判不再变，调用方不会反复写存储");
  // 冷却的起点已经落在过去、但某个目标的时刻在未来（settle 划掉别的条目后剩下的）：只改那一条
  const mixed: AutoReloadLedger = { tries: [{ sha: A, count: 1, at: NOW - 10 }, { sha: B, count: 2, at: NOW + 10 }], at: NOW - 10 };
  assert.deepEqual(rebaseAutoReloadLedger(mixed, NOW), { tries: [{ sha: A, count: 1, at: NOW - 10 }, { sha: B, count: 2, at: NOW }], at: NOW - 10 });
});

test("自动刷新：播放器在放或在同步就不刷，音乐比一张旧卡贵", () => {
  assert.equal(decide({ playerBusy: true }), "skip");
  assert.equal(decide({ playerBusy: true, trigger: "page-crash", hidden: false }), "skip");
});

test("自动刷新：记不住账（sessionStorage 不可用）就不刷，宁可不修也不冒循环的险", () => {
  assert.equal(decide({ ledger: null }), "skip");
  assert.equal(decide({ ledger: null, trigger: "page-crash", hidden: false }), "skip");
});

test("账本：读不懂的存档一律当空，能读的部分保留并按上限截尾", () => {
  assert.deepEqual(parseAutoReloadLedger(null), EMPTY_AUTO_RELOAD_LEDGER);
  assert.deepEqual(parseAutoReloadLedger(""), EMPTY_AUTO_RELOAD_LEDGER);
  assert.deepEqual(parseAutoReloadLedger("{not json"), EMPTY_AUTO_RELOAD_LEDGER);
  assert.deepEqual(parseAutoReloadLedger("42"), EMPTY_AUTO_RELOAD_LEDGER);
  assert.deepEqual(parseAutoReloadLedger(JSON.stringify({ tries: "nope", at: "yesterday" })), EMPTY_AUTO_RELOAD_LEDGER);
  const rows = [
    { sha: A, count: 1, at: 5 },
    7,
    null,
    { sha: "", count: 1, at: 1 },
    { sha: C, count: 0, at: 1 },
    { sha: C, count: 1.5, at: 1 },
    { sha: C, count: 1, at: "x" },
    { sha: B, count: 2, at: 6 },
  ];
  assert.deepEqual(parseAutoReloadLedger(JSON.stringify({ tries: rows, at: 123 })), {
    tries: [{ sha: A, count: 1, at: 5 }, { sha: B, count: 2, at: 6 }],
    at: 123,
  });
  // 同一个 sha 重复时后面的当最新，并排到末尾
  const repeated = [{ sha: A, count: 1, at: 1 }, { sha: B, count: 1, at: 2 }, { sha: A, count: 2, at: 3 }];
  assert.deepEqual(parseAutoReloadLedger(JSON.stringify({ tries: repeated, at: 3 })).tries, [{ sha: B, count: 1, at: 2 }, { sha: A, count: 2, at: 3 }]);
  const many = Array.from({ length: AUTO_RELOAD_MEMORY + 5 }, (_, index) => ({ sha: `sha${index}`, count: 1, at: index }));
  const parsed = parseAutoReloadLedger(JSON.stringify({ tries: many, at: 1 }));
  assert.equal(parsed.tries.length, AUTO_RELOAD_MEMORY);
  assert.equal(parsed.tries.at(-1)?.sha, many.at(-1)?.sha);
});

test("账本：记一笔会去重、放到最新、按上限丢最老的；一轮内次数累加，过了一轮从头数，并盖上时刻", () => {
  let ledger = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, 1);
  ledger = recordAutoReload(ledger, B, 2);
  ledger = recordAutoReload(ledger, A, 3);
  assert.deepEqual(ledger, { tries: [{ sha: B, count: 1, at: 2 }, { sha: A, count: 2, at: 3 }], at: 3 });
  // 距 A 上一次试已经过了一轮：次数从头数
  ledger = recordAutoReload(ledger, A, 3 + AUTO_RELOAD_RETRY_AFTER_MS);
  assert.deepEqual(ledger.tries.at(-1), { sha: A, count: 1, at: 3 + AUTO_RELOAD_RETRY_AFTER_MS });
  for (let index = 0; index < AUTO_RELOAD_MEMORY + 3; index += 1) ledger = recordAutoReload(ledger, `sha${index}`, 10 + index);
  assert.equal(ledger.tries.length, AUTO_RELOAD_MEMORY);
  assert.equal(ledger.tries.at(-1)?.sha, `sha${AUTO_RELOAD_MEMORY + 2}`);
});

test("账本：刷回来的页面已经是那个版本就划掉它（试满的也一样），之后部署回滚到它还能再刷；没试过的原样不动", () => {
  const ledger = recordAutoReload(recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, 1), B, 2);
  // 页面现在就是 B：B 那次成功了
  const settled = settleAutoReloadLedger(ledger, B);
  assert.deepEqual(settled.tries.map((entry) => entry.sha), [A]);
  assert.equal(settled.at, 2, "冷却的起点不变");
  // 没有变化时是同一个对象，调用方靠引用判要不要写回
  assert.equal(settleAutoReloadLedger(ledger, C), ledger);
  assert.equal(settleAutoReloadLedger(ledger, null), ledger);
  // 页面在 C 上、版本接口答回 B（回滚）：B 不在账里了，可以再刷
  assert.equal(autoReloadDecision({ ...base, latestCommit: B, ledger: settled, now: NOW + AUTO_RELOAD_COOLDOWN_MS * 2 }).action, "reload");
  // B 之前试满过：划掉之后同样不再拦着
  let exhausted = EMPTY_AUTO_RELOAD_LEDGER;
  for (let count = 1; count <= AUTO_RELOAD_MAX_TRIES; count += 1) exhausted = recordAutoReload(exhausted, B, NOW - 1_000 + count);
  const afterSettle = settleAutoReloadLedger(exhausted, B);
  assert.deepEqual(autoReloadDecision({ ...base, latestCommit: B, ledger: exhausted }), { action: "wait", ms: AUTO_RELOAD_RETRY_AFTER_MS - 1_000 + AUTO_RELOAD_MAX_TRIES });
  assert.equal(autoReloadDecision({ ...base, latestCommit: B, ledger: afterSettle }).action, "wait", "冷却还在");
  assert.equal(autoReloadDecision({ ...base, latestCommit: B, ledger: afterSettle, now: NOW + AUTO_RELOAD_COOLDOWN_MS }).action, "reload");
});
