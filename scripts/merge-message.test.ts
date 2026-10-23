import assert from "node:assert/strict";
import test from "node:test";

import { mergeMessage, mergeMethodFor } from "./merge-message.ts";

test("标题用 PR 标题加号，正文汇总去重后的协作者：跳过仓库主人，只收认得出的身份", () => {
  const result = mergeMessage({
    number: "207",
    title: "feat(site): 最近提交不显示同步合并",
    subjects: ["feat(site): 卡片跳过同步合并", "docs: 写合并格式"],
    authors: [
      "LYJW131 <153256373+LYJW131@users.noreply.github.com>",
      "Cursor Agent <cursoragent@cursor.com>",
      "千早 愛音 <lyjw131@icloud.com>",
      "An0nCh1hayaa <300701323+An0nCh1hayaa@users.noreply.github.com>",
    ],
    coAuthors: [
      "Claude Opus 5.5 (1M context) <noreply@anthropic.com>",
      "claude opus 5.5 (1M context) <NOREPLY@anthropic.com>",
      "gpt-6.1-sol <codex@openai.com>",
      "Claude Opus 5.5 <noreply@anthropic.com>",
      "Yangjunwei Liang <LYJW131@users.noreply.github.com>",
      "千早 愛音 <lyjw131@icloud.com>",
    ],
    owner: "LYJW131",
  });
  assert.equal(result.commit_title, "feat(site): 最近提交不显示同步合并 (#207)");
  assert.equal(result.commit_message, [
    "- feat(site): 卡片跳过同步合并",
    "- docs: 写合并格式",
    "",
    "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>",
    "Co-Authored-By: gpt-6.1-sol <codex@openai.com>",
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    "Co-Authored-By: Cursor Agent <cursoragent@cursor.com>",
    "Co-Authored-By: An0nCh1hayaa <300701323+An0nCh1hayaa@users.noreply.github.com>",
  ].join("\n"));
});

test("标题已带号不重复加；没有协作者时正文只有提交主题", () => {
  const result = mergeMessage({ number: "9", title: "fix: x (#9) ", subjects: ["fix: x"], authors: [], coAuthors: [], owner: null });
  assert.deepEqual(result, { commit_title: "fix: x (#9)", commit_message: "- fix: x" });
});

test("少于 3 个非合并提交压缩合并，3 个及以上留合并提交", () => {
  assert.equal(mergeMethodFor(1), "squash");
  assert.equal(mergeMethodFor(2), "squash");
  assert.equal(mergeMethodFor(3), "squash");
  assert.equal(mergeMethodFor(4), "merge");
});
