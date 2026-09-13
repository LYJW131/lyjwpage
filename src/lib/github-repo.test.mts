import assert from "node:assert/strict";
import test from "node:test";

import {
  repoIdFromUrl,
  summarizeRepoStats,
  type ContributorStat,
} from "./github-repo.ts";

const W1 = 175_599_3600; // 2025-08-24 周日 0 点 UTC（秒）
const W2 = W1 + 604_800;
/** 落在 W2 那周的周三中午。 */
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

test("贡献者按 commit 倒序并加总每人的增删行", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW);
  assert.equal(payload.repo, "LYJW131/lyjwpage");
  assert.deepEqual(
    payload.contributors.map((item) => item.login),
    ["alice", "bob"],
  );
  assert.equal(payload.contributors[0]?.additions, 150);
  assert.equal(payload.contributors[0]?.deletions, 25);
  assert.equal(payload.contributors[1]?.additions, 7);
});

test("全仓总数只认传进来的那份，不把名单加起来", () => {
  /**
   * 这条盯的就是线上那个错：`/stats/contributors` 是「贡献」口径，一条
   * `Co-authored-by` 的提交在作者和协作者名下各记一次，加起来是真实值的两倍左右。
   * 名单里 10 + 3 = 13，真值只有 9。
   */
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW, {
    commits: 9,
    additions: 157,
    deletions: 95,
  });
  assert.deepEqual(payload.totals, {
    commits: 9,
    additions: 157,
    deletions: 95,
    contributors: 2,
  });
});

test("没传总数就是 null，卡片显示「—」，不拿名单的和顶上", () => {
  const payload = summarizeRepoStats(fixture(), "LYJW131", "lyjwpage", NOW);
  assert.deepEqual(payload.totals, {
    commits: null,
    additions: null,
    deletions: null,
    contributors: 2,
  });
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
  assert.equal(payload.contributors[0]?.commits, 2);
  assert.equal(payload.totals.contributors, 1);
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
