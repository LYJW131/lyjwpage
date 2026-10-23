#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HELP = `用法：node scripts/revert-proof.ts --test <测试文件> [选项]

撤回证明：在临时克隆里把改动过的非测试文件换回基线版本，跑新测试，要求它以断言失败报红；
再换回 HEAD 跑同一测试，要求通过。不动当前工作区，证明按 HEAD 的提交做（未提交的改动不算）。
输出 JSON；退出码 0 证明成立、1 不成立、2 参数错。

选项：
  --test <路径>      回归测试文件，相对仓库根；可给多次（必填）
  --keep <路径>      其他也保持 HEAD 版本的文件（测试夹具、测试专用的辅助文件）；可给多次
  --base <引用>      基线，默认 origin/main（取它与 HEAD 的 merge-base）
  --cmd <命令>       跑测试的 shell 命令，在临时克隆的根执行；默认
                     node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs <测试文件>
  --timeout <秒>     每次跑测试的上限，默认 300
  --help             显示本说明

基线上没有的新文件两次都保持 HEAD 版本，列在 addedKept 里：修复若落在新文件里，红的那次会照样通过，
证明不成立，就在回执的「没验到」里写明。`;

const TEST_FILE = /(^|\/)(fixtures?|__fixtures__)\/|\.test\.[cm]?[jt]sx?$/;
const ASSERTION = /AssertionError|ERR_ASSERTION/;
const TAIL_LINES = 15;

export type RunResult = { exit: number | null; assertion: boolean; tests: number | null; tail: string };
export type Proof = {
  base: string;
  head: string;
  reverted: string[];
  addedKept: string[];
  red: RunResult;
  green: RunResult | null;
  verdict: "proved" | "not-red" | "red-not-assertion" | "not-green";
  next: string | null;
};

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();

export function isTestFile(file: string, keep: Set<string>) {
  return keep.has(file) || TEST_FILE.test(file);
}

export function summarize(exit: number | null, output: string): RunResult {
  const tests = /^# tests (\d+)$/m.exec(output);
  return {
    exit,
    assertion: ASSERTION.test(output),
    tests: tests ? Number(tests[1]) : null,
    tail: output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n"),
  };
}

export function verdictOf(red: RunResult, green: RunResult | null): Pick<Proof, "verdict" | "next"> {
  if (red.exit === 0) return { verdict: "not-red", next: "换回基线后测试仍通过：它没有抓住这个 bug，或修复落在 addedKept 的新文件里；改测试或在「没验到」里写明" };
  if (!red.assertion || red.tests === 0) return { verdict: "red-not-assertion", next: "红了但不是断言失败（编译、导入出错或没跑到测试）：测试可能离不开新文件，用 --keep 保留它们，或在「没验到」里写明" };
  if (green?.exit !== 0) return { verdict: "not-green", next: "HEAD 上同一测试没通过：先修到绿再证明" };
  return { verdict: "proved", next: null };
}

// 临时克隆里没有依赖：把主检出里各包的 node_modules 链过去，跑测试与主检出用同一份依赖。
function linkNodeModules(root: string, tree: string) {
  const dirs = [".", ...["workers", "reporters", "packages", "apps"].flatMap((group) =>
    existsSync(path.join(root, group)) ? readdirSync(path.join(root, group)).map((name) => path.join(group, name)) : [])];
  for (const dir of dirs) {
    const source = path.join(root, dir, "node_modules");
    const target = path.join(tree, dir, "node_modules");
    if (existsSync(source) && existsSync(path.join(tree, dir)) && !existsSync(target)) symlinkSync(source, target, "dir");
  }
}

// 在 node --test 里调用时会继承 NODE_TEST_CONTEXT，子进程的 node --test 就把结果报给外层而不按失败退出。
function runTests(cwd: string, cmd: string, timeoutMs: number): RunResult {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync("sh", ["-c", cmd], { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
  return summarize(result.status, output);
}

const quote = (file: string) => `'${file.replaceAll("'", "'\\''")}'`;

export function prove(
  { root, tests, keep = [], base = "origin/main", cmd, timeoutMs = 300_000 }:
    { root: string; tests: string[]; keep?: string[]; base?: string; cmd?: string; timeoutMs?: number },
): Proof {
  const head = git(root, ["rev-parse", "HEAD"]);
  const mergeBase = git(root, ["merge-base", base, head]);
  const keepSet = new Set([...tests, ...keep]);
  const changed = git(root, ["diff", "--name-status", "--no-renames", mergeBase, head]).split("\n").filter(Boolean).map((line) => {
    const [status, file] = line.split("\t");
    return { status, file };
  });
  const source = changed.filter(({ file }) => !isTestFile(file, keepSet));
  const reverted = source.filter(({ status }) => status !== "A").map(({ file }) => file);
  const addedKept = source.filter(({ status }) => status === "A").map(({ file }) => file);
  const deletedAtHead = new Set(source.filter(({ status }) => status === "D").map(({ file }) => file));
  const command = cmd ?? `node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs ${tests.map(quote).join(" ")}`;

  const tree = mkdtempSync(path.join(tmpdir(), "revert-proof-"));
  try {
    git(root, ["clone", "-q", "--shared", "--no-checkout", root, tree]);
    git(tree, ["checkout", "-q", "--detach", head]);
    linkNodeModules(root, tree);
    if (reverted.length > 0) git(tree, ["checkout", mergeBase, "--", ...reverted]);
    const red = runTests(tree, command, timeoutMs);
    let green: RunResult | null = null;
    if (red.exit !== 0) {
      const atHead = reverted.filter((file) => !deletedAtHead.has(file));
      if (atHead.length > 0) git(tree, ["checkout", head, "--", ...atHead]);
      for (const file of deletedAtHead) rmSync(path.join(tree, file), { force: true });
      git(tree, ["reset", "-q"]);
      green = runTests(tree, command, timeoutMs);
    }
    return { base: mergeBase, head, reverted, addedKept, red, green, ...verdictOf(red, green) };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      options: {
        test: { type: "string", multiple: true },
        keep: { type: "string", multiple: true, default: [] },
        base: { type: "string", default: "origin/main" },
        cmd: { type: "string" },
        timeout: { type: "string", default: "300" },
        help: { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n用法见 --help`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const timeout = Number(values.timeout);
  if (!values.test?.length || !Number.isFinite(timeout) || timeout <= 0) {
    console.error("要给 --test <测试文件>，--timeout 是正数秒；见 --help");
    return 2;
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const missing = values.test.filter((file) => !existsSync(path.join(root, file)));
  if (missing.length > 0) {
    console.error(`测试文件不存在（路径相对仓库根）：${missing.join("、")}`);
    return 2;
  }
  if (git(root, ["status", "--porcelain", "--untracked-files=no"])) console.error("提醒：工作区有未提交改动，证明按 HEAD 的提交做，不含这些改动。");
  const proof = prove({ root, tests: values.test, keep: values.keep, base: values.base, cmd: values.cmd, timeoutMs: timeout * 1000 });
  console.log(JSON.stringify(proof, null, 2));
  return proof.verdict === "proved" ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
