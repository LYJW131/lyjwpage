import assert from "node:assert/strict";
import test from "node:test";

import { mergeMethodReason, receiptReason } from "./guard-merge-method.ts";
import { stampLine, stampTitle } from "./verify-receipt.ts";
import { bodyDigest } from "./verify-action/body.ts";

const SHA = "6ed909e3c64a6fca7e2a172841db0278a479efc8";
const base = { owner: "LYJW131", repo: "lyjwpage", pullNumber: 7, expectedHeadSha: SHA };

test("少于 3 个提交只放行压缩合并", () => {
  assert.equal(mergeMethodReason({ ...base, merge_method: "squash" }, () => 2), null);
  assert.match(mergeMethodReason({ ...base, merge_method: "merge" }, () => 2) ?? "", /squash/);
  assert.match(mergeMethodReason({ ...base }, () => 1) ?? "", /squash/);
});

test("3 个及以上提交只放行合并提交", () => {
  assert.equal(mergeMethodReason({ ...base, merge_method: "merge" }, () => 3), null);
  assert.match(mergeMethodReason({ ...base, merge_method: "squash" }, () => 5) ?? "", /merge/);
  assert.match(mergeMethodReason({ ...base, merge_method: "rebase" }, () => 5) ?? "", /merge/);
});

test("缺 expectedHeadSha、数不出提交或数出 0 个都拦下", () => {
  assert.match(mergeMethodReason({ owner: "LYJW131", repo: "lyjwpage", merge_method: "squash" }, () => 1) ?? "", /expectedHeadSha/);
  assert.match(mergeMethodReason({ ...base, merge_method: "squash" }, () => { throw new Error("bad object"); }) ?? "", /git fetch/);
  assert.match(mergeMethodReason({ ...base, merge_method: "squash" }, () => 0) ?? "", /没有非合并提交/);
  assert.match(mergeMethodReason({ ...base, merge_method: "squash" }, () => Number.NaN) ?? "", /没有非合并提交/);
});

test("别的仓库不管", () => {
  assert.equal(mergeMethodReason({ owner: "someone", repo: "other", merge_method: "rebase" }, () => 1), null);
});

test("带 do-not-merge 标签、读不到标签或没给 PR 号都拦下", () => {
  const input = { ...base, merge_method: "squash" };
  assert.match(mergeMethodReason(input, () => 1, () => ["tier: logic", "do-not-merge"]) ?? "", /do-not-merge/);
  assert.equal(mergeMethodReason(input, () => 1, () => ["tier: logic"]), null);
  assert.match(mergeMethodReason(input, () => 1, () => { throw new Error("gh: not logged in"); }) ?? "", /gh auth status/);
  assert.match(mergeMethodReason({ ...input, pullNumber: undefined }, () => 1) ?? "", /pullNumber/);
});

const HEAD = "a".repeat(40);
const BOT = { id: 338272049 };

function fakeFetch(files: string[], comments: { user: { id: number }; body: string }[], { author = 153256373, labels = [] as string[] } = {}) {
  const routes: Record<string, unknown> = {
    "pulls/7": { number: 7, head: { sha: HEAD }, body: "", labels: labels.map((name) => ({ name })), user: { id: author } },
    "pulls/7/files": files.map((filename) => ({ filename })),
    "issues/7/comments": comments,
  };
  return async (url: string) => {
    const [key, query = ""] = url.replace("https://api.github.com/repos/LYJW131/lyjwpage/", "").split("?");
    const page = Number(/(?:^|&)page=(\d+)/.exec(query)?.[1] ?? 1);
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) };
    const body = routes[key];
    return { ok: true, json: async () => (Array.isArray(body) && page > 1 ? [] : body) };
  };
}

const stamped = async (stamp: { level?: string; verdict?: string }) => {
  const full = { sha: HEAD, ...stamp, body: await bodyDigest("") };
  return `${stampTitle(full)}\n${stampLine(full)}\n`;
};
const signed = async (stamp: { level?: string; verdict?: string }) => ({ user: BOT, body: await stamped(stamp) });

test("receiptReason：回执等级按分档，判定只在 PR 贴了 needs-judge 时要，文档档不要", async () => {
  assert.equal(await receiptReason(7, { fetch: fakeFetch(["docs/a.md"], []) }), null);
  const none = (await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], []) })) ?? "";
  assert.match(none, /logic 档.*unit-test-verified/);
  assert.doesNotMatch(none, /判定 PASS/);
  const receipt = await signed({ level: "unit-test-verified" });
  assert.equal(await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], [receipt]) }), null);
  assert.match((await receiptReason(7, { fetch: fakeFetch(["src/components/a.tsx"], [receipt]) })) ?? "", /ui 档.*live-ui-verified/);

  const labels = ["needs-judge"];
  assert.match((await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], [receipt], { labels }) })) ?? "", /判定 PASS/);
  const pass = await signed({ verdict: "PASS" });
  assert.equal(await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], [receipt, pass], { labels }) }), null);
});

test("receiptReason：没要判定，head 上有 FAIL 判定也提醒", async () => {
  const receipt = await signed({ level: "unit-test-verified" });
  const fail = await signed({ verdict: "FAIL" });
  assert.match((await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], [receipt, fail]) })) ?? "", /判定是 FAIL/);
});

test("receiptReason：lyjw 账号贴的同格式评论不算，读不到 GitHub 也提醒", async () => {
  const forged = { user: { id: 153256373 }, body: await stamped({ level: "unit-test-verified" }) };
  assert.match((await receiptReason(7, { fetch: fakeFetch(["scripts/a.ts"], [forged]) })) ?? "", /logic 档/);
  assert.match((await receiptReason(8, { fetch: fakeFetch(["scripts/a.ts"], []) })) ?? "", /读不到 #8 的回执/);
});
