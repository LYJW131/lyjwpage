import assert from "node:assert/strict";
import test from "node:test";
import { childEnv, forbiddenRead, inside, sandboxed } from "./verify-agent/guard.ts";

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
