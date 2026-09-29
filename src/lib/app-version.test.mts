import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_RELOAD_COOLDOWN_MS,
  AUTO_RELOAD_MEMORY,
  EMPTY_AUTO_RELOAD_LEDGER,
  autoReloadDecision,
  parseAutoReloadLedger,
  recordAutoReload,
  resolveVersionStatus,
  settleAutoReloadLedger,
  type AutoReloadInput,
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

test("自动刷新：试过的目标不再刷，边缘 HTML 还是旧的也不循环", () => {
  const ledger = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, B, NOW - 3 * AUTO_RELOAD_COOLDOWN_MS);
  assert.equal(decide({ ledger }), "skip");
  assert.equal(decide({ ledger, trigger: "page-crash", hidden: false }), "skip");
});

test("自动刷新：版本接口在两个 sha 间来回，各试一次就停（只记最后一个的话会被交替覆盖、无限刷）", () => {
  let ledger = EMPTY_AUTO_RELOAD_LEDGER;
  let now = NOW;
  let reloads = 0;
  // ESA 一直吐旧 HTML（页面 sha 不变），版本接口 B、A、B、A…… 来回，每次间隔都超过冷却
  for (const latestCommit of [B, A, B, A, B, A, B, A]) {
    now += AUTO_RELOAD_COOLDOWN_MS + 1_000;
    if (autoReloadDecision({ ...base, latestCommit, ledger, now }).action === "reload") {
      reloads += 1;
      ledger = recordAutoReload(ledger, latestCommit, now);
    }
  }
  assert.equal(reloads, 2, "B 和 A 各一次，之后都被拦下");
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

test("自动刷新：系统时钟被往回拨过，冷却最多等一个冷却期", () => {
  const ledger = { shas: [A], at: NOW + 3_600_000 };
  assert.deepEqual(autoReloadDecision({ ...base, ledger }), { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS });
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
  assert.deepEqual(parseAutoReloadLedger(JSON.stringify({ shas: "nope", at: "yesterday" })), EMPTY_AUTO_RELOAD_LEDGER);
  assert.deepEqual(parseAutoReloadLedger(JSON.stringify({ shas: [A, 7, "", null, B], at: 123 })), { shas: [A, B], at: 123 });
  const many = Array.from({ length: AUTO_RELOAD_MEMORY + 5 }, (_, index) => `sha${index}`);
  const parsed = parseAutoReloadLedger(JSON.stringify({ shas: many, at: 1 }));
  assert.equal(parsed.shas.length, AUTO_RELOAD_MEMORY);
  assert.equal(parsed.shas.at(-1), many.at(-1));
});

test("账本：记一笔会去重、放到最新、按上限丢最老的，并盖上时刻", () => {
  let ledger = recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, 1);
  ledger = recordAutoReload(ledger, B, 2);
  ledger = recordAutoReload(ledger, A, 3);
  assert.deepEqual(ledger, { shas: [B, A], at: 3 });
  for (let index = 0; index < AUTO_RELOAD_MEMORY + 3; index += 1) ledger = recordAutoReload(ledger, `sha${index}`, 10 + index);
  assert.equal(ledger.shas.length, AUTO_RELOAD_MEMORY);
  assert.equal(ledger.shas.at(-1), `sha${AUTO_RELOAD_MEMORY + 2}`);
});

test("账本：刷回来的页面已经是那个版本就划掉它，之后部署回滚到它还能再刷；没试过的原样不动", () => {
  const ledger = recordAutoReload(recordAutoReload(EMPTY_AUTO_RELOAD_LEDGER, A, 1), B, 2);
  // 页面现在就是 B：B 那次成功了
  const settled = settleAutoReloadLedger(ledger, B);
  assert.deepEqual(settled.shas, [A]);
  assert.equal(settled.at, 2, "冷却的起点不变");
  // 没有变化时是同一个对象，调用方靠引用判要不要写回
  assert.equal(settleAutoReloadLedger(ledger, C), ledger);
  assert.equal(settleAutoReloadLedger(ledger, null), ledger);
  // 页面在 C 上、版本接口答回 B（回滚）：B 不在「试过」里了，可以再刷
  assert.equal(autoReloadDecision({ ...base, latestCommit: B, ledger: settled, now: NOW + AUTO_RELOAD_COOLDOWN_MS * 2 }).action, "reload");
});
