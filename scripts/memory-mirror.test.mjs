import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sanitize, syncMirror } from "./memory-mirror.mjs";

test("脱敏：去掉 modified 行、私有链接、内部 ID 与 Mac 用户目录", () => {
  const input = [
    "---",
    "name: x",
    "metadata:",
    "  type: project",
    "  modified: 2026-10-13T12:00:00.000Z",
    "---",
    "Report: https://claude.ai/code/artifact/bbe14df1-a225-4d34",
    "env env_01QTEP3pz3fccygZRKspQxyG, session session_01KoUx6WrPJyhfAvpPXp3mZJ",
    "folder /Users/someone/Developer/lyjwpage",
    "",
  ].join("\n");
  const out = sanitize(input);
  assert.doesNotMatch(out, /modified:|claude\.ai\/|env_01|session_01|\/Users\//);
  assert.match(out, /<private claude\.ai link>/);
  assert.match(out, /folder ~\/Developer\/lyjwpage/);
});

test("同步：写入新增与变更，删除源里已没有的主题，保留 README", () => {
  const src = mkdtempSync(path.join(tmpdir(), "mem-src-"));
  const dst = mkdtempSync(path.join(tmpdir(), "mem-dst-"));
  writeFileSync(path.join(src, "MEMORY.md"), "index\n");
  writeFileSync(path.join(src, "a.md"), "a\n");
  writeFileSync(path.join(src, ".memory-sync"), "{}");
  writeFileSync(path.join(dst, "a.md"), "a\n");
  writeFileSync(path.join(dst, "gone.md"), "old\n");
  writeFileSync(path.join(dst, "README.md"), "readme\n");
  assert.deepEqual(syncMirror(src, dst).sort(), ["MEMORY.md", "gone.md"]);
  assert.deepEqual(readdirSync(dst).sort(), ["MEMORY.md", "README.md", "a.md"]);
  assert.equal(readFileSync(path.join(dst, "MEMORY.md"), "utf8"), "index\n");
  assert.deepEqual(syncMirror(src, dst), []);
});
