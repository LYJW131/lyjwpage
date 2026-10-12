import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRecentCommits,
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

const RECENT_ITEM = {
  sha: "fe67087f0123456789abcdef0123456789abcdef",
  html_url: "https://github.com/LYJW131/lyjwpage/commit/fe67087f0123456789abcdef0123456789abcdef",
  commit: {
    message: "feat(chat): 首页对话能画卡片\n\n正文\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    author: { name: "LYJW131", email: "x@example.com", date: "2026-10-09T10:00:00Z" },
    verification: { verified: true },
  },
  author: { login: "LYJW131", avatar_url: "https://avatars.githubusercontent.com/u/153256373?v=4" },
};

test("最近提交留短 sha、首行标题和去重的作者，协作者从 Co-authored-by 里补，另带完整 sha、链接、签名与作者明细", () => {
  const commits = repoCommitsFrom([RECENT_ITEM, { commit: { message: "no sha" } }]);
  assert.equal(commits.length, 1);
  const [commit] = commits;
  assert.equal(commit?.sha, "fe67087");
  assert.equal(commit?.title, "feat(chat): 首页对话能画卡片");
  assert.deepEqual(commit?.authors, ["LYJW131", "claude"]);
  assert.equal(commit?.committedAt, "2026-10-09T10:00:00Z");
  assert.equal(commit?.oid, RECENT_ITEM.sha);
  assert.equal(commit?.url, RECENT_ITEM.html_url);
  assert.equal(commit?.verified, true);
  assert.deepEqual(commit?.authorDetails?.map((author) => [author.login, author.agent, author.model]), [
    ["LYJW131", null, null],
    ["claude", "claude", "Claude Opus 5.5"],
  ]);
});

test("GraphQL 给出的作者明细优先于 REST 与尾注拼出来的那份", () => {
  const graph = [{ name: "someone", login: "someone", avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4", agent: null, model: null }];
  const [commit] = repoCommitsFrom([RECENT_ITEM], new Map([[RECENT_ITEM.sha, graph]]));
  assert.deepEqual(commit?.authorDetails, graph);
  assert.deepEqual(commit?.authors, ["LYJW131", "claude"]);
});

test("没有签名信息与链接时记为未签名、链接按仓库拼", () => {
  const [commit] = repoCommitsFrom([{ sha: RECENT_ITEM.sha, commit: { message: "x" } }]);
  assert.equal(commit?.verified, false);
  assert.equal(commit?.url, `https://github.com/LYJW131/lyjwpage/commit/${RECENT_ITEM.sha}`);
});

test("GraphQL 取作者失败时最近提交照样写出，作者退回 REST 与尾注", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    if (String(input).endsWith("/graphql")) return new Response(JSON.stringify({ errors: [{ message: "nope" }] }), { status: 200 });
    return Response.json([RECENT_ITEM]);
  });
  const [commit] = await fetchRecentCommits("token", "LYJW131", "lyjwpage", 5_000);
  assert.equal(commit?.oid, RECENT_ITEM.sha);
  assert.deepEqual(commit?.authorDetails?.map((author) => author.login), ["LYJW131", "claude"]);
});

test("GraphQL 作者带上 GitHub 识别出的协作者头像", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    if (String(input).endsWith("/graphql")) {
      return Response.json({ data: { repository: { c0: { authors: { nodes: [
        { name: "LYJW131", email: "x@example.com", avatarUrl: "https://avatars.githubusercontent.com/u/153256373?v=4", user: { login: "LYJW131" } },
        { name: "Claude Opus 5.5", email: "noreply@anthropic.com", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", user: null },
      ] } } } } });
    }
    return Response.json([RECENT_ITEM]);
  });
  const [commit] = await fetchRecentCommits("token", "LYJW131", "lyjwpage", 5_000);
  assert.deepEqual(commit?.authorDetails?.map((author) => [author.login, author.agent, author.avatarUrl]), [
    ["LYJW131", null, "https://avatars.githubusercontent.com/u/153256373?v=4"],
    ["claude", "claude", "https://avatars.githubusercontent.com/u/81847?v=4"],
  ]);
});
