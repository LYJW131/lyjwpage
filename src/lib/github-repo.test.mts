import assert from "node:assert/strict";
import test from "node:test";

import { repoIdFromUrl, summarizeRepoStats, type ContributorStat } from "./github-repo.ts";

const W1 = 175_599_3600; // 某周周日 0 点（秒）
const W2 = W1 + 604_800;

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
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", 1_000);
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
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", 1_000);
  assert.equal(payload.weeks.length, 2);
  assert.equal(payload.weeks[0]?.weekStart, W1 * 1000);
  assert.equal(payload.weeks[0]?.commits, 4);
  assert.equal(payload.weeks[1]?.commits, 9);
  assert.equal(payload.weeks[1]?.deletions, 75);
});

test("每人 weeks 与顶层对齐，空周补零", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", 1_000);
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
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", 1_000, 1);
  assert.equal(payload.weeks.length, 1);
  assert.equal(payload.weeks[0]?.weekStart, W2 * 1000);
  assert.equal(payload.contributors[0]?.weeks.length, 1);
});

test("匿名作者退回 ghost 且不丢数", () => {
  const payload = summarizeRepoStats(
    [{ author: null, total: 2, weeks: [{ w: W1, a: 1, d: 1, c: 2 }] }],
    "LYJW131",
    "lyjwpage",
    1_000,
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
