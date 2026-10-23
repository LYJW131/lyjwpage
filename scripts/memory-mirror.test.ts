import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findSecrets, sanitize, syncMirror } from "./memory-mirror.ts";

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
  const hits = (text: string) => findSecrets(text);
  assert.deepEqual(hits(`key ${"sk-ant"}-api03-AbCdEfGhIjKlMnOpQrStUv`), ["Anthropic / OpenAI key", "opaque token"]);
  assert.deepEqual(hits(`${"ghp"}_AbCdEfGhIjKlMnOpQrStUvWxYz012345`), ["GitHub token", "opaque token"]);
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
  writeFileSync(path.join(src, "leak.md"), `${"ghp"}_AbCdEfGhIjKlMnOpQrStUvWxYz012345\n`);
  assert.throws(() => syncMirror(src, dst), /leak\.md: GitHub token/);
  assert.deepEqual(readdirSync(dst), []);
});

test("凭据检测：各家 token、分隔符与大小写变体、哈希密钥都报出来", () => {
  const cases: [string, string][] = [
    [`GitLab PAT：${"glpat"}-xK9mPq2wR7tY4uI8oL3s`, "GitLab token"],
    [`npm publish token: ${"npm"}_9xK2mQ7wR4tY8uI3oP6sA1dF5gH0jL`, "npm token"],
    [`${"SG"}.mG7xK9pQ2wR4tY6uI8oL0sA3dF5gH1jN2bV4cX6zM9kL7hJ3fD5gS8aQ2wE4rT6yU`, "Stripe / SendGrid / DigitalOcean / Shopify token"],
    [`${"xapp"}-1-a0bcd2efg-1234567890123-abcdef0123456789abcdef0123456789abcdef0123456789abcdef`, "Slack token"],
    [`Google API key ${"AIza"}SyB2cD4eF6gH8jK0mN2pQ4sU6wY8aC0eG2i`, "Google API key"],
    [`dop_v1_${"ab12".repeat(16)}`, "Stripe / SendGrid / DigitalOcean / Shopify token"],
    ["CLOUDFLARE_API_TOKEN\uff1axK9mQ7wR4tY8uI3oP6sA1d", "secret assignment"],
    ["MY_SECRET=`s3cr3tValue99x`", "secret assignment"],
    ["api_key=Ab3dEf7gH9jK1lM3nP5q", "secret assignment"],
    ['PASSWORD="a very long passphrase"', "secret assignment"],
    ["machine api.example.com login lyjw password c3v7K9x2mQ8wR4tY", "netrc credential"],
    ["webhook secret 3f9a1c7e5b2d4a6c8e0f1a3b5c7d9e2f4a6b8c0d1e3f5a7b9c2d4e6f8a0b1c3d", "hex secret"],
    ["-----BEGIN PGP PRIVATE KEY BLOCK-----", "private key"],
    ["Zx9Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1X", "opaque token"],
    ["Zx9.Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz1Xc3", "opaque token"],
  ];
  for (const [text, label] of cases) assert.ok(findSecrets(text).includes(label), `${text} -> ${findSecrets(text)}`);
});

test("凭据检测：中文行文里的 token 说明、提交哈希、带前缀的资源 ID 与 shell 默认值不误报", () => {
  for (const benign of [
    "token: write\u2060，在全新的会话里",
    "推送 token：只读，不写",
    "`merge_method`、`commit_title`",
    "sha 5e077b49f0c5260d92dc70a1b2c3d4e5f6a7b8c9 与 trig_01C9Jj2Ax3WUm4XxxEke67SY",
    "workspace wrkspc_01EKGUJQbX9gKyF1ohp8WmUo.",
    "thread cmsg_013ffYdQA2e4EWP3dvhZV6Pv3aMJrsR2xpA2B8eTvc9Ly8",
    'Stop runs `TOKENS_API_TOKEN="${TOKENS_API_TOKEN:-egress-proxy}" tokens cloud submit`.',
  ]) assert.deepEqual(findSecrets(benign), [], benign);
});

test("脱敏：claude.ai 分享链接与 Artifact 链接一样换掉", () => {
  const out = sanitize("see https://claude.ai/share/0a1b2c3d-4e5f-6789-abcd-ef0123456789 now");
  assert.equal(out, "see <private claude.ai link> now");
});

test("同步：文件名像凭据或需要脱敏时整批不写", () => {
  for (const name of [`notes-${"ghp"}_0123456789abcdefGHIJKLMN.md`, "env_01QTEP3pz3fccygZRKspQxyG.md", "lyjwMain-notes.md"]) {
    const src = mkdtempSync(path.join(tmpdir(), "mem-src-"));
    const dst = mkdtempSync(path.join(tmpdir(), "mem-dst-"));
    writeFileSync(path.join(src, "MEMORY.md"), "index\n");
    writeFileSync(path.join(src, name), "innocuous\n");
    assert.throws(() => syncMirror(src, dst), /文件名含/, name);
    assert.deepEqual(readdirSync(dst), []);
  }
});

test("同步：NUL 或非法 UTF-8 的源文件整批不写", () => {
  for (const bytes of [Buffer.from(`${"sk-ant"}-api03-AbCdEfGhIjKlMnOpQrStUv`, "utf16le"), Buffer.from([0x61, 0xff, 0xfe, 0x62])]) {
    const src = mkdtempSync(path.join(tmpdir(), "mem-src-"));
    const dst = mkdtempSync(path.join(tmpdir(), "mem-dst-"));
    writeFileSync(path.join(src, "MEMORY.md"), "index\n");
    writeFileSync(path.join(src, "bin.md"), bytes);
    assert.throws(() => syncMirror(src, dst), /不是 UTF-8 文本/);
    assert.deepEqual(readdirSync(dst), []);
  }
});

test("同步：源目录里的 .md 符号链接被跳过并报告，镜像里对应的旧文件被删", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mem-root-"));
  const src = path.join(root, "src");
  mkdirSync(src);
  const dst = path.join(root, "dst");
  mkdirSync(dst);
  writeFileSync(path.join(root, "private.txt"), "machine git.internal login lyjw\n");
  writeFileSync(path.join(src, "notes.md"), "notes\n");
  symlinkSync(path.join(root, "private.txt"), path.join(src, "linked.md"));
  writeFileSync(path.join(dst, "linked.md"), "old\n");
  const warnings: string[] = [];
  assert.deepEqual(syncMirror(src, dst, (message) => warnings.push(message)).sort(), ["linked.md", "notes.md"]);
  assert.deepEqual(readdirSync(dst), ["notes.md"]);
  assert.deepEqual(warnings, ["跳过符号链接：linked.md"]);
});

test("同步：镜像里的 .md 符号链接被替换成普通文件，链接目标不被改写", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mem-root-"));
  const src = path.join(root, "src");
  mkdirSync(src);
  const dst = path.join(root, "dst");
  mkdirSync(dst);
  const victim = path.join(root, "victim.txt");
  writeFileSync(victim, "ORIGINAL\n");
  writeFileSync(path.join(src, "topic.md"), "same\n");
  writeFileSync(path.join(src, "fresh.md"), "fresh\n");
  symlinkSync(victim, path.join(dst, "topic.md"));
  symlinkSync(path.join(root, "created-outside.txt"), path.join(dst, "fresh.md"));
  const warnings: string[] = [];
  syncMirror(src, dst, (message) => warnings.push(message));
  assert.equal(readFileSync(victim, "utf8"), "ORIGINAL\n");
  assert.equal(existsSync(path.join(root, "created-outside.txt")), false);
  for (const name of ["topic.md", "fresh.md"]) {
    assert.equal(lstatSync(path.join(dst, name)).isSymbolicLink(), false);
    assert.equal(readFileSync(path.join(dst, name), "utf8"), name === "topic.md" ? "same\n" : "fresh\n");
  }
  assert.equal(warnings.length, 2);
  assert.deepEqual(readdirSync(dst).sort(), ["fresh.md", "topic.md"]);
});
