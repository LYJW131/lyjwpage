import assert from "node:assert/strict";
import { test } from "node:test";
import { authorFromTrailer, joinAuthorNames, mergeAuthors, parseCoAuthors } from "./commit-authors.ts";

test("GitHub noreply 邮箱直接拼出登录名和头像，agent 邮箱换成品牌图标，其余只留名字", () => {
  assert.deepEqual(authorFromTrailer("Grok 4.6", "304785771+grokkybara[bot]@users.noreply.github.com"), {
    name: "grokkybara[bot]", login: "grokkybara[bot]", avatarUrl: "https://avatars.githubusercontent.com/u/304785771?v=4", agent: null,
  });
  assert.deepEqual(authorFromTrailer("Yangjunwei Liang", "LYJW131@users.noreply.github.com"), {
    name: "LYJW131", login: "LYJW131", avatarUrl: "https://github.com/LYJW131.png", agent: null,
  });
  assert.deepEqual(authorFromTrailer("Claude Fable 5.1", "noreply@anthropic.com"), { name: "claude", login: null, avatarUrl: null, agent: "claude" });
  assert.deepEqual(authorFromTrailer("Cursor Agent", "cursoragent@cursor.com"), {
    name: "cursoragent",
    login: "cursoragent",
    avatarUrl: "https://avatars.githubusercontent.com/u/199161495?v=4",
    agent: "cursor",
  });
  assert.deepEqual(authorFromTrailer("gpt-6-astra", "codex@openai.com"), { name: "codex", login: null, avatarUrl: null, agent: "openai" });
  assert.deepEqual(authorFromTrailer("Someone", "someone@example.com"), { name: "Someone", login: null, avatarUrl: null, agent: null });
});

test("只认 Co-authored-by 尾注，大小写不敏感，保持顺序；Assisted-By 不算", () => {
  const message = [
    "feat: x", "", "body Co-authored-by: not a trailer <x@y>", "",
    "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>",
    "co-authored-by: Cursor Agent <cursoragent@cursor.com>",
    "Assisted-By: Gemini <gemini@google.com>",
  ].join("\n");
  assert.deepEqual(parseCoAuthors(message).map((author) => author.name), ["claude", "cursoragent"]);
  assert.deepEqual(parseCoAuthors("no trailers"), []);
});

test("作者在前、协作者去重（登录名不分大小写，同 agent 去重），主语按 GitHub 的写法连接", () => {
  const me = { name: "LYJW131", login: "LYJW131", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", agent: null };
  const merged = mergeAuthors(me, [
    authorFromTrailer("me", "1+lyjw131@users.noreply.github.com"),
    authorFromTrailer("Yangjunwei Liang", "LYJW131@users.noreply.github.com"),
    authorFromTrailer("Claude", "noreply@anthropic.com"),
    authorFromTrailer("Claude again", "noreply@anthropic.com"),
  ]);
  assert.deepEqual(merged.map((author) => author.name), ["LYJW131", "claude"]);
  assert.deepEqual(mergeAuthors(null, []), []);
  assert.equal(joinAuthorNames([]), "");
  assert.equal(joinAuthorNames(["A"]), "A");
  assert.equal(joinAuthorNames(["A", "B"]), "A and B");
  assert.equal(joinAuthorNames(["A", "B", "C"]), "A, B, and C");
});
