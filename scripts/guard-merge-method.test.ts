import assert from "node:assert/strict";
import test from "node:test";

import { mergeMethodReason } from "./guard-merge-method.ts";

const SHA = "6ed909e3c64a6fca7e2a172841db0278a479efc8";
const base = { owner: "LYJW131", repo: "lyjwpage", expectedHeadSha: SHA };

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
