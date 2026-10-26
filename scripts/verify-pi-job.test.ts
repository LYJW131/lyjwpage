import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const ACTION = ".github/actions/verify-agent/action.yml";

function agentScript() {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/verify.yml"), "utf8");
  const job = /\n {2}verify-pi:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/.exec(workflow)?.[1] ?? "";
  const step = /\n {6}- id: agent\n([\s\S]*?)(?=\n {6}- )/.exec(job)?.[1] ?? "";
  const run = /\n {8}run: \|\n((?: {10}.*\n?)+)/.exec(step)?.[1] ?? "";
  assert.ok(run, "verify-pi 里找不到 agent 步骤的 run 块");
  assert.match(step, new RegExp(`ACTION: ${ACTION.replace(/\./g, "\\.")}`));
  return run.replace(/^ {10}/gm, "");
}

function repo(history: { action: boolean }[], main?: { action: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-pi-agent-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "work");
  const commit = (action: boolean, message: string) => {
    fs.rmSync(path.join(dir, ".github"), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, "file"), message);
    if (action) {
      fs.mkdirSync(path.join(dir, path.dirname(ACTION)), { recursive: true });
      fs.writeFileSync(path.join(dir, ACTION), "name: x\n");
    }
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  history.forEach((state, index) => commit(state.action, `head-${index}`));
  if (main) {
    git("checkout", "-q", "-b", "main-side", "HEAD~" + (history.length - 1));
    commit(main.action, "main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "work");
  }
  return dir;
}

function present(dir: string) {
  const out = path.join(dir, ".output");
  fs.writeFileSync(out, "");
  const stdout = execFileSync("bash", ["-e", "-c", agentScript()], { cwd: dir, env: { ...process.env, ACTION, BASE: "main", GITHUB_OUTPUT: out }, encoding: "utf8" });
  const value = /^present=(.*)$/m.exec(fs.readFileSync(out, "utf8"))?.[1] ?? "";
  return { value, notice: stdout.includes("::notice::") };
}

test("verify-pi 的 agent 步骤：head 有 pi 验证员时 present=true", () => {
  assert.deepEqual(present(repo([{ action: true }], { action: true })), { value: "true", notice: false });
});

test("verify-pi 的 agent 步骤：head 与分叉点都没有（分支早于 pi 验证员）时 present=false 并记 notice", () => {
  assert.deepEqual(present(repo([{ action: false }, { action: false }], { action: true })), { value: "false", notice: true });
});

test("verify-pi 的 agent 步骤：PR 自己删掉了分叉点上有的 action 时 present 留空，末步照旧报红", () => {
  assert.deepEqual(present(repo([{ action: true }, { action: false }], { action: true })), { value: "", notice: false });
});

test("verify-pi 的 agent 步骤：读不到目标分支、算不出分叉点时 present 留空", () => {
  assert.deepEqual(present(repo([{ action: false }])), { value: "", notice: false });
});
