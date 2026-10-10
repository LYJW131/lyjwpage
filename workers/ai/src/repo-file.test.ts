import assert from "node:assert/strict";
import test from "node:test";

import { findRepoFiles, parseFindInput, parseRepoFileInput, readRepoFile, REPO_FILE_LIMITS, repoFileUrl } from "./chat/repo-file.ts";

test("repo file paths stay repository-relative and line ranges are sane", () => {
  assert.deepEqual(parseRepoFileInput({ path: "./workers/ai/src/chat/handler.ts", startLine: 20, endLine: 40 }), { path: "workers/ai/src/chat/handler.ts", startLine: 20, endLine: 40 });
  assert.deepEqual(parseRepoFileInput({ path: "README.md", startLine: 0, endLine: -3 }), { path: "README.md", startLine: 1 });
  assert.equal(parseRepoFileInput({ path: "/README.md" })?.path, "README.md");
  for (const path of ["", "../secrets", "src/../../etc", "a//b", 42, "x".repeat(REPO_FILE_LIMITS.pathChars + 1)]) assert.equal(parseRepoFileInput({ path }), null, String(path));
  assert.equal(repoFileUrl("src/app/[slug]/page.tsx", "raw"), "https://raw.githubusercontent.com/LYJW131/lyjwpage/main/src/app/%5Bslug%5D/page.tsx");
});

test("repo file reads number lines, cut long files with a continuation line and report missing files", async () => {
  const body = Array.from({ length: 2000 }, (_, index) => `const line${index + 1} = ${"x".repeat(20)};`).join("\n");
  const urls: string[] = [];
  const read = async (url: string) => { urls.push(url); return url.endsWith("missing.ts") ? new Response("", { status: 404 }) : new Response(body); };
  const first = await readRepoFile(read, { path: "src/big.ts", startLine: 1 });
  assert.ok(first.ok);
  assert.match(first.text, /^Source: https:\/\/github\.com\/LYJW131\/lyjwpage\/blob\/main\/src\/big\.ts\nLines 1-\d+ of 2000\n\n1: const line1/);
  const next = Number(/startLine=(\d+)/.exec(first.text)?.[1]);
  assert.ok(next > 1 && first.text.length < REPO_FILE_LIMITS.chars + 400);
  const range = await readRepoFile(read, { path: "src/big.ts", startLine: 10, endLine: 12 });
  assert.match(range.text, /Lines 10-12 of 2000\n\n10: const line10[^\n]*\n11: [^\n]*\n12: [^\n]*$/);
  const missing = await readRepoFile(read, { path: "src/missing.ts", startLine: 1 });
  assert.equal(missing.ok, false);
  assert.match(missing.text, /No such file on main/);
  assert.ok(urls.every((url) => url.startsWith("https://raw.githubusercontent.com/LYJW131/lyjwpage/main/")));
});

test("find_repo_files matches every fragment case-insensitively, shortest paths first, and a missing read suggests same-name files", async () => {
  const paths = ["src/components/build-plan-card.tsx", "src/components/build-plan-card.test.tsx", "src/lib/github-sign-in.ts", "workers/ai/src/build/github-oauth.ts", "README.md"];
  const tree = async () => paths;
  assert.deepEqual(parseFindInput({ query: "  Plan  CARD " }), ["plan", "card"]);
  assert.equal(parseFindInput({ query: "   " }), null);
  const found = await findRepoFiles(tree, ["plan", "card"]);
  assert.deepEqual(found.text.split("\n"), ["src/components/build-plan-card.tsx", "src/components/build-plan-card.test.tsx"]);
  assert.match((await findRepoFiles(tree, ["nothing"])).text, /^No paths contain all of: nothing/);
  assert.equal((await findRepoFiles(async () => null, ["plan"])).ok, false);
  const read = async () => new Response("", { status: 404 });
  const moved = await readRepoFile(read, { path: "src/components/live/build-plan-card.tsx", startLine: 1 }, tree);
  assert.match(moved.text, /Similar paths:\nsrc\/components\/build-plan-card\.tsx$/);
  const stem = await readRepoFile(read, { path: "src/lib/github-oauth.tsx", startLine: 1 }, tree);
  assert.match(stem.text, /Similar paths:\nworkers\/ai\/src\/build\/github-oauth\.ts$/);
  assert.match((await readRepoFile(read, { path: "src/x.ts", startLine: 1 }, tree)).text, /Use find_repo_files/);
});
