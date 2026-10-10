import assert from "node:assert/strict";
import test from "node:test";

import { parseRepoFileInput, readRepoFile, REPO_FILE_LIMITS, repoFileUrl } from "./chat/repo-file.ts";

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
