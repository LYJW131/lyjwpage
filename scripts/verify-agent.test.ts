import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { childEnv, filterGrepOutput, forbiddenRead, inside, readAllowed, realInside, sandboxed } from "./verify-agent/guard.ts";
import { checklistIds, lenientRows, reviewReport } from "./verify-agent/review.ts";
import { removedIdentifiers } from "./verify-agent/tools.ts";

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

test("checklistIds：从提示词里取清单 id，遇到第一行不是条目就停", () => {
  const prompt = "前文\nPR 作者写的验证清单，每一项都要有一行结果，行 id 照抄：\n- V1：页面打开\n- V2：单测绿\n\n清单之外……\n- X9：不是清单";
  assert.deepEqual(checklistIds(prompt), ["V1", "V2"]);
  assert.deepEqual(checklistIds("没有清单"), []);
});

test("reviewReport：漏清单行、没登记声明、声明指向不存在的行、「另：」里藏着缺陷、没跑通单测却签单测档、逻辑改动没对照，都退回", () => {
  const facts = { checklistIds: ["V1", "V2"], claims: [], hasDescription: true, logic: true, testsPassed: false, comparedBase: false };
  const report = {
    model: "m",
    level: "unit-test-verified",
    rows: [{ id: "V1", check: "c", result: "PASS", evidence: "grep 1 处。另：第 24 行报错文案仍含旧说法" }],
    notVerified: [],
  };
  const issues = reviewReport(report, facts);
  assert.equal(issues.length, 5);
  assert.match(issues[0], /V2/);
  assert.match(issues.join("\n"), /claims/);
  assert.match(issues.join("\n"), /V1 判 PASS/);
  assert.match(issues.join("\n"), /run_tests/);
  assert.match(issues.join("\n"), /compare_base/);
  assert.match(reviewReport(report, { ...facts, claims: [{ id: "C1", claim: "x", check: "X7" }] }).join("\n"), /C1→X7/);
});

test("reviewReport：写明改动前就有的「另：」、跑通了单测、对照过、声明都有行时放行", () => {
  const report = {
    model: "m",
    level: "unit-test-verified",
    rows: [
      { id: "V1", check: "c", result: "PASS", evidence: "ok。另：README 仍写旧说法，改动前就有" },
      { id: "X1", check: "c", result: "FAIL", evidence: "仍命中 1 处" },
    ],
    notVerified: [],
  };
  const facts = { checklistIds: ["V1"], claims: [{ id: "C1", claim: "x", check: "X1" }], hasDescription: true, logic: true, testsPassed: true, comparedBase: true };
  assert.deepEqual(reviewReport(report, facts), []);
  assert.deepEqual(lenientRows(report.rows), []);
});

test("removedIdentifiers：只收 diff 里删掉、新代码里又没出现的标识符", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "-const OLD_LIMIT = 5;", "-useOldThing(verify-ab.yml)", "+const NEW_LIMIT = 5;", "+useOldThing()"].join("\n");
  assert.deepEqual(removedIdentifiers(patch).sort(), ["OLD_LIMIT", "verify-ab.yml"]);
});

test("filterGrepOutput：递归搜到 .env*、.dev.vars 里的行去掉，普通文件的命中与上下文行保留", () => {
  const out = ["src/a.ts:3: MARK", "envprobe/.env.local:1: MARK=1", "workers/core/.dev.vars-2- MARK", "README.md-4- context", "无法解析的一行"].join("\n");
  const { text, dropped } = filterGrepOutput(out, "/repo");
  assert.equal(dropped, 2);
  assert.equal(text, ["src/a.ts:3: MARK", "README.md-4- context", "无法解析的一行"].join("\n"));
});
