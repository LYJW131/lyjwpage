import assert from "node:assert/strict";
import test from "node:test";
import { prCoAuthors, withCoAuthors } from "./pr-coauthors.mjs";

const owner = { name: "Yangjunwei Liang", email: "153256373+LYJW131@users.noreply.github.com", login: "LYJW131" };
const claude = { name: "Claude Opus 5.5 (1M context)", email: "noreply@anthropic.com", login: "claude" };
const codex = { name: "GPT-5.5 Codex", email: "codex@openai.com", login: "codex" };

test("collects every commit author except the PR author, one line per model", () => {
  const pr = {
    author: { login: "LYJW131" },
    commits: [
      { authors: [owner, claude] },
      { authors: [owner, claude, codex] },
      { authors: [{ ...claude, name: "Claude Sonnet 5.5" }] },
    ],
  };
  assert.deepEqual(prCoAuthors(pr), [
    "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>",
    "Co-Authored-By: GPT-5.5 Codex <codex@openai.com>",
    "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>",
  ]);
});

test("keeps human co-authors when a bot opened the PR", () => {
  const pr = { author: { login: "app/lyjw-build" }, commits: [{ authors: [owner] }] };
  assert.deepEqual(prCoAuthors(pr), [`Co-Authored-By: ${owner.name} <${owner.email}>`]);
});

test("replaces the trailing trailer block so the trailers stay the last paragraph", () => {
  const body = "Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Old <old@example.com>\n";
  assert.equal(
    withCoAuthors(body, ["Co-Authored-By: New <new@example.com>"]),
    "Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: New <new@example.com>",
  );
});

test("leaves trailer-like lines inside the body alone", () => {
  const body = "Co-Authored-By: Quoted <q@example.com>\n\nSummary";
  assert.equal(withCoAuthors(body, ["Co-Authored-By: A <a@example.com>"]), `${body}\n\nCo-Authored-By: A <a@example.com>`);
});

test("handles an empty body and no co-authors", () => {
  assert.equal(withCoAuthors("", ["Co-Authored-By: A <a@example.com>"]), "Co-Authored-By: A <a@example.com>");
  assert.equal(withCoAuthors(null, []), "");
  assert.equal(withCoAuthors("Summary\r\n\r\nCo-Authored-By: A <a@example.com>", []), "Summary");
});
