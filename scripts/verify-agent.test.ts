import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { childEnv, filterGrepOutput, forbiddenRead, inside, readAllowed, realInside, sandboxed } from "./verify-agent/guard.ts";
import { docsSyncTool, removedIdentifiers } from "./verify-agent/tools.ts";

test("childEnv：凭据与 GitHub 的输出文件都不给子进程，TMPDIR 换成 runner 的临时目录", () => {
  const env = childEnv(
    {
      ANTHROPIC_API_KEY: "a",
      GITHUB_TOKEN: "b",
      GH_TOKEN: "c",
      ACTIONS_RUNTIME_URL: "d",
      ACTIONS_ID_TOKEN_REQUEST_URL: "e",
      GITHUB_OUTPUT: "/out",
      GITHUB_ENV: "/env",
      GITHUB_STEP_SUMMARY: "/sum",
      CLAUDE_CODE_OAUTH_TOKEN: "f",
      PATH: "/bin",
      HOME: "/home/runner",
      TMPDIR: "/elsewhere",
    },
    "/tmp/x",
  );
  assert.deepEqual(env, { TMPDIR: "/tmp/x", PATH: "/bin", HOME: "/home/runner" });
});

test("inside：只认目录本身与它下面的路径，../ 与同前缀的兄弟目录都不算", () => {
  assert.equal(inside("/r/out", "/r/out"), true);
  assert.equal(inside("/r/out", "/r/out/work/a.txt"), true);
  assert.equal(inside("/r/out", "/r/out-evil/a.txt"), false);
  assert.equal(inside("/r/out", "/r/out/../a.txt"), false);
  assert.equal(inside("/r/out", "/etc/passwd"), false);
});

test("forbiddenRead：拦 /proc、/sys、gh 凭据与本地密钥文件，不误拦普通源码", () => {
  for (const target of ["/proc/self/environ", "/proc", "/sys/kernel", "/home/u/.config/gh/hosts.yml", "/home/u/.git-credentials", "/r/.env", "/r/.env.local", "/r/workers/core/.dev.vars"])
    assert.equal(forbiddenRead(target), true, target);
  for (const target of ["/r/src/env.ts", "/r/.envrc-notes/readme.md", "/r/scripts/verify-agent.ts", "/r/processes/a.ts"]) assert.equal(forbiddenRead(target), false, target);
});

test("sandboxed：有 bwrap 时整条命令进 PID 命名空间，只绑可写目录；单引号转义后命令原样", () => {
  assert.equal(sandboxed("echo hi", ["/w"], false), "echo hi");
  const wrapped = sandboxed("echo 'a b'", ["/w", "/t"], true);
  assert.match(wrapped, /^exec bwrap --ro-bind \/ \/ --bind '\/w' '\/w' --bind '\/t' '\/t' .*--unshare-pid --die-with-parent bash -c /);
  assert.ok(wrapped.endsWith(`bash -c 'echo '\\''a b'\\'''`));
});

test("符号链接：指向 /proc/self/environ 的链接照样拦，写守卫按真实路径判、链接指出产物目录就拒", (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verify-agent-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "out");
  fs.mkdirSync(path.join(out, "work"), { recursive: true });
  fs.writeFileSync(path.join(root, "victim.txt"), "x");
  fs.symlinkSync("/proc/self/environ", path.join(root, "env-link"));
  fs.symlinkSync(path.join(root, "victim.txt"), path.join(out, "work", "file-link"));
  fs.symlinkSync(root, path.join(out, "work", "dir-link"));

  assert.equal(forbiddenRead(path.join(root, "env-link")), true);
  assert.equal(realInside(out, path.join(out, "work", "a.txt")), true);
  assert.equal(realInside(out, path.join(out, "work", "new", "b.txt")), true);
  assert.equal(realInside(out, path.join(out, "work", "file-link")), false);
  assert.equal(realInside(out, path.join(out, "work", "dir-link", "victim.txt")), false);
  assert.equal(realInside(out, path.join(out, "work", "dir-link", "new.txt")), false);
});

test("readAllowed：只许读点名的根目录；从 / 或 /proc 递归、根目录里的 .env 与指出根目录的链接都拒", (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verify-agent-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.symlinkSync(os.homedir(), path.join(repo, "home-link"));
  const roots = [repo];

  assert.equal(readAllowed(roots, repo), true);
  assert.equal(readAllowed(roots, path.join(repo, "src", "a.ts")), true);
  for (const target of ["/", "/proc", "/proc/1/environ", root, path.join(repo, ".env.local"), path.join(repo, "home-link"), path.join(repo, "home-link", ".ssh")])
    assert.equal(readAllowed(roots, target), false, target);
});

test("removedIdentifiers：只收 diff 里删掉、新代码里又没出现的标识符", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "-const OLD_LIMIT = 5;", "-useOldThing(verify-ab.yml)", "+const NEW_LIMIT = 5;", "+useOldThing()"].join("\n");
  assert.deepEqual(removedIdentifiers(patch).sort(), ["OLD_LIMIT", "verify-ab.yml"]);
});

test("filterGrepOutput：递归搜到 .env*、.dev.vars 里的行去掉（路径里带「-数字-」也认得出），普通文件的命中与上下文行保留", () => {
  const out = ["src/a.ts:3: MARK", "envprobe/.env.local:1: MARK=1", "workers/core/.dev.vars-2- MARK", "x-1-y/.env.local:1: MARK", "x-1-y/.env.local-2- MARK", "README.md-4- context", "无法解析的一行"].join("\n");
  const { text, dropped } = filterGrepOutput(out, "/repo");
  assert.equal(dropped, 4);
  assert.equal(text, ["src/a.ts:3: MARK", "README.md-4- context", "无法解析的一行"].join("\n"));
});

test("docs_sync：搜 HEAD 里的文字，工作区的 .claude/ 被换回目标分支的版本也不影响", async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
  git("init", "-q");
  fs.mkdirSync(path.join(repo, ".claude"));
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 OLD_LIMIT 判断\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 NEW_LIMIT 判断\n");
  git("commit", "-qam", "head");
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 OLD_LIMIT 判断\n");
  const tool = docsSyncTool({ cwd: repo, base: "HEAD~1", tmpDir: repo, run: async () => ({ code: 0, output: "" }), workLog: () => null });
  const out = (await tool.execute("1", { keywords: ["OLD_LIMIT", "NEW_LIMIT"], auto: false })).content[0].text;
  assert.match(out, /「OLD_LIMIT」：文档里 0 处/);
  assert.match(out, /「NEW_LIMIT」：1 处\n {2}\.claude\/skill\.md（这次改了）：1:用 NEW_LIMIT 判断/);
});
