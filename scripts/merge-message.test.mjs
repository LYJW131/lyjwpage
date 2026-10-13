import assert from "node:assert/strict";
import test from "node:test";

import { mergeMessage } from "./merge-message.mjs";

test("标题用 PR 标题加号，正文列提交主题并汇总去重后的协作者", () => {
  const result = mergeMessage({
    number: "207",
    title: "feat(site): 最近提交不显示同步合并",
    subjects: ["feat(site): 卡片跳过同步合并", "docs: 写合并格式"],
    authors: [
      "LYJW131 <153256373+LYJW131@users.noreply.github.com>",
      "Cursor Agent <cursoragent@cursor.com>",
    ],
    coAuthors: [
      "Claude Opus 5.5 (1M context) <noreply@anthropic.com>",
      "claude opus 5.5 (1M context) <NOREPLY@anthropic.com>",
      "gpt-6.1-sol <codex@openai.com>",
      "Claude Opus 5.5 <noreply@anthropic.com>",
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
  ].join("\n"));
});

test("标题已带号不重复加；没有协作者时正文只有提交主题", () => {
  const result = mergeMessage({ number: "9", title: "fix: x (#9) ", subjects: ["fix: x"], authors: [], coAuthors: [], owner: null });
  assert.deepEqual(result, { commit_title: "fix: x (#9)", commit_message: "- fix: x" });
});
