import assert from "node:assert/strict";
import test from "node:test";

import {
  repoIdFromUrl,
  summarizeRepoStats,
  weekStartMs,
  type ContributorStat,
} from "./github-repo.ts";

const W1 = 175_599_3600; // 2025-08-24 周日 0 点 UTC（秒）
const W2 = W1 + 604_800;
/** 落在 W2 那周的周三中午，窗口以 W2 收尾。 */
const NOW = (W2 + 3 * 86_400 + 43_200) * 1000;

function fixture(): ContributorStat[] {
  return [
    {
      author: { login: "alice", avatar_url: "https://avatars.example/a" },
      total: 10,
      weeks: [
        { w: W1, a: 100, d: 20, c: 4 },
        { w: W2, a: 50, d: 5, c: 6 },
      ],
    },
    {
      author: { login: "bob", avatar_url: "https://avatars.example/b" },
      total: 3,
      weeks: [{ w: W2, a: 7, d: 70, c: 3 }],
    },
  ];
}

test("贡献者按 commit 倒序并加总增删行", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW);
  assert.equal(payload.repo, "LYJW131/lyjwpage");
  assert.deepEqual(
    payload.contributors.map((item) => item.login),
    ["alice", "bob"],
  );
  assert.equal(payload.contributors[0]?.additions, 150);
  assert.equal(payload.contributors[0]?.deletions, 25);
  assert.deepEqual(payload.totals, {
    commits: 13,
    additions: 157,
    deletions: 95,
    contributors: 2,
  });
});

test("同周跨人加总并按周升序", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW, 2);
  assert.equal(payload.weeks.length, 2);
  assert.equal(payload.weeks[0]?.weekStart, W1 * 1000);
  assert.equal(payload.weeks[0]?.commits, 4);
  assert.equal(payload.weeks[1]?.commits, 9);
  assert.equal(payload.weeks[1]?.deletions, 75);
});

test("每人 weeks 与顶层对齐，空周补零", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW, 2);
  const bob = payload.contributors.find((item) => item.login === "bob");
  assert.ok(bob);
  assert.equal(bob.weeks.length, 2);
  assert.equal(bob.weeks[0]?.weekStart, W1 * 1000);
  assert.equal(bob.weeks[0]?.commits, 0);
  assert.equal(bob.weeks[1]?.commits, 3);
  assert.deepEqual(
    bob.weeks.map((week) => week.weekStart),
    payload.weeks.map((week) => week.weekStart),
  );
});

test("只留窗尾几周", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW, 1);
  assert.equal(payload.weeks.length, 1);
  assert.equal(payload.weeks[0]?.weekStart, W2 * 1000);
  assert.equal(payload.contributors[0]?.weeks.length, 1);
});

test("横轴是连续的日历周：中间没提交的周和窗尾的安静周都补零", () => {
  const W0 = W1 - 604_800;
  const W3 = W2 + 604_800;
  // 只有 W0 和 W2 有提交（commits 回退就长这样），now 落在 W3。
  const raw: ContributorStat[] = [
    {
      author: { login: "alice" },
      total: 2,
      weeks: [
        { w: W0, c: 1 },
        { w: W2, c: 1 },
      ],
    },
  ];
  const payload = summarizeRepoStats(raw, "LYJW131", "lyjwpage", W3 * 1000 + 1, 4);
  assert.deepEqual(
    payload.weeks.map((week) => week.weekStart),
    [W0, W1, W2, W3].map((w) => w * 1000),
  );
  assert.deepEqual(
    payload.weeks.map((week) => week.commits),
    [1, 0, 1, 0],
  );
  assert.deepEqual(
    payload.contributors[0]?.weeks.map((week) => week.commits),
    [1, 0, 1, 0],
  );
});

test("weekStartMs 取 UTC 周日 0 点", () => {
  // W2 那周的周六 23:59:59 UTC 仍归 W2；下一秒进 W2+1 周。
  assert.equal(weekStartMs((W2 + 7 * 86_400 - 1) * 1000), W2 * 1000);
  assert.equal(weekStartMs((W2 + 7 * 86_400) * 1000), (W2 + 604_800) * 1000);
  assert.equal(weekStartMs(W2 * 1000), W2 * 1000);
});

test("匿名作者退回 ghost 且不丢数", () => {
  const payload = summarizeRepoStats(
    [{ author: null, total: 2, weeks: [{ w: W1, a: 1, d: 1, c: 2 }] }],
    "LYJW131",
    "lyjwpage",
    NOW,
  );
  assert.equal(payload.contributors[0]?.login, "ghost");
  assert.equal(payload.contributors[0]?.avatarUrl, null);
  assert.equal(payload.totals.commits, 2);
});

test("从 site.repo 抠出 owner/name", () => {
  assert.deepEqual(repoIdFromUrl("https://github.com/LYJW131/lyjwpage"), {
    owner: "LYJW131",
    name: "lyjwpage",
  });
  assert.deepEqual(repoIdFromUrl("https://github.com/LYJW131/lyjwpage/"), {
    owner: "LYJW131",
    name: "lyjwpage",
  });
});
