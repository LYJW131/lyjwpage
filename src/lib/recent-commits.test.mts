import assert from "node:assert/strict";
import test from "node:test";

import { deploymentFor, recentCommitsFrom } from "@/lib/recent-commits";

const OID = "34d17804c0ffee00000000000000000000000001";

test("采集方补齐的字段原样进卡片", () => {
  const author = { name: "claude", login: "claude", avatarUrl: "https://avatars.githubusercontent.com/u/81847?v=4", agent: "claude" as const, model: "Claude Opus 5.5" };
  const [commit] = recentCommitsFrom([
    { sha: "34d1780", title: "docs", authors: ["claude"], committedAt: null, oid: OID, url: "https://example.test/c", verified: true, authorDetails: [author] },
  ], 3);
  assert.deepEqual(commit, { sha: "34d1780", oid: OID, title: "docs", url: "https://example.test/c", authors: [author], committedAt: null, verified: true });
});

test("旧载荷缺新字段时按名字降级：未签名、链接按短 sha 拼、作者没有头像", () => {
  const [commit] = recentCommitsFrom([{ sha: "34d1780", title: "docs", authors: ["LYJW131", "claude"], committedAt: "2026-10-12T04:10:00Z" }], 3);
  assert.equal(commit?.oid, null);
  assert.equal(commit?.verified, false);
  assert.equal(commit?.url, "https://github.com/LYJW131/lyjwpage/commit/34d1780");
  assert.deepEqual(commit?.authors.map((author) => [author.name, author.login, author.avatarUrl, author.agent]), [
    ["LYJW131", null, null, null],
    ["claude", null, null, null],
  ]);
});

test("只取前几条，缺席时是空表", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ sha: `${i}`.padStart(7, "0"), title: "t", authors: [], committedAt: null }));
  assert.equal(recentCommitsFrom(many, 3).length, 3);
  assert.deepEqual(recentCommitsFrom(undefined, 3), []);
});

test("部署按完整 sha 对上；旧载荷只有短 sha 时按前缀对", () => {
  const bySha = new Map([[OID, "live"]]);
  assert.equal(deploymentFor({ sha: "34d1780", oid: OID, title: "", url: "", authors: [], committedAt: null, verified: false }, bySha), "live");
  assert.equal(deploymentFor({ sha: "34d1780", oid: null, title: "", url: "", authors: [], committedAt: null, verified: false }, bySha), "live");
  assert.equal(deploymentFor({ sha: "fffffff", oid: null, title: "", url: "", authors: [], committedAt: null, verified: false }, bySha), undefined);
});
