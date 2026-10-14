import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findSecrets, sanitize, syncMirror } from "./memory-mirror.mjs";

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
    "folder /Users/someone/Developer/lyjwpage in env lyjwMain",
    "",
  ].join("\n");
  const out = sanitize(input);
  assert.doesNotMatch(out, /modified:|claude\.ai\/|env_01|session_01|\/Users\//);
  assert.match(out, /<private claude\.ai link>/);
  assert.match(out, /folder ~\/Developer\/lyjwpage in env <cloud env>/);
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

test("凭据检测：真凭据报出来，记忆里常见的名字、引用、sha 与路径不误报", () => {
  const hits = (text) => findSecrets(text);
  assert.deepEqual(hits("key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv"), ["Anthropic / OpenAI key"]);
  assert.deepEqual(hits("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345"), ["GitHub token"]);
  assert.deepEqual(hits("-----BEGIN PRIVATE KEY-----"), ["private key"]);
  assert.deepEqual(hits("ACCESS_CLIENT_SECRET=9f8e7d6c5b4a3210"), ["secret assignment"]);
  assert.deepEqual(hits("token Zx9Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1Xc3Vb5Nm7Qa9Ws"), ["opaque token"]);
  for (const benign of [
    "env var `LYJWPAGE_ANTHROPIC_API_KEY`; use `ANTHROPIC_API_KEY=\"$LYJWPAGE_ANTHROPIC_API_KEY\"`",
    "secret APPLE_MUSIC_PRIVATE_KEY, ROUTINE_FIRE_TOKEN",
    "commit 5e077b49f0c5260d92dc70a1b2c3d4e5f6a7b8c9 merged",
    "Routine `trig_01C9Jj2Ax3WUm4XxxEke67SY`, issue #185",
    "`workers/ai/src/build/github.ts#BUILD_READY_CHECKS`",
  ]) assert.deepEqual(hits(benign), [], benign);
});

test("同步：发现疑似凭据时整批不写", () => {
  const src = mkdtempSync(path.join(tmpdir(), "mem-src-"));
  const dst = mkdtempSync(path.join(tmpdir(), "mem-dst-"));
  writeFileSync(path.join(src, "MEMORY.md"), "index\n");
  writeFileSync(path.join(src, "leak.md"), "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345\n");
  assert.throws(() => syncMirror(src, dst), /leak\.md: GitHub token/);
  assert.deepEqual(readdirSync(dst), []);
});
