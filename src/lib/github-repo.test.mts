import assert from "node:assert/strict";
import test from "node:test";

import {
  repoCommitsFrom,
  repoIdFromUrl,
  summarizeRepoStats,
  type ContributorStat,
} from "./github-repo.ts";

const W1 = 175_599_3600;
const W2 = W1 + 604_800;
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

test("最近提交只留短 sha、首行标题和去重的作者，协作者从 Co-authored-by 里补", () => {
  const commits = repoCommitsFrom([
    {
      sha: "fe67087f0123456789abcdef0123456789abcdef",
      commit: {
        message: "feat(chat): 首页对话能画卡片\n\n正文\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
        author: { name: "LYJW131", email: "x@example.com", date: "2026-10-09T10:00:00Z" },
      },
      author: { login: "LYJW131" },
    },
    { commit: { message: "no sha" } },
  ]);
  assert.deepEqual(commits, [
    { sha: "fe67087", title: "feat(chat): 首页对话能画卡片", authors: ["LYJW131", "claude"], committedAt: "2026-10-09T10:00:00Z" },
  ]);
});
