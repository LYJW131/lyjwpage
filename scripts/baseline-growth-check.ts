#!/usr/bin/env node
// 合规例外由 lyjw 给 PR 打 `baseline-exception` 标签放行（ci.yml 把标签传成 BASELINE_EXCEPTION=true）。
// CI 的 pull_request 检出的是合并结果，直接比目标分支最新提交；本地比与 origin/main 的分叉点，
// 免得分支落后于 main 时把 main 上删掉的条目误报成新增。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BASELINE_PATH as DESIGN_BASELINE_PATH, compare, type Counts } from "./design-scale-check.ts";
import { MJS_BASELINE_PATH } from "./rules-check.ts";
import { BASELINE_PATH as COPY_BASELINE_PATH, compareCopy, type CopyBaseline } from "./ui-copy-check.ts";

export const EXCEPTION_LABEL = "baseline-exception";

export function mjsGrowth(base: string[], head: string[]): string[] {
  const listed = new Set(base);
  return head.filter((file) => !listed.has(file)).map((file) => `新增 ${file}`);
}

export function designGrowth(base: Counts, head: Counts): string[] {
  return compare(base, head).grew.map(({ token, before, after }) => `${token}：${before} → ${after}`);
}

export function copyGrowth(base: CopyBaseline, head: CopyBaseline): string[] {
  const hits = Object.fromEntries(Object.entries(head).map(([file, texts]) => [file, texts.map((text) => ({ line: 0, text }))]));
  return compareCopy(base, hits).grew.flatMap(({ file, extras }) =>
    extras.map(({ text, extra }) => `${file}：“${text}”${extra > 1 ? `×${extra}` : ""}`),
  );
}

const CHECKS: { path: string; growth: (base: unknown, head: unknown) => string[] }[] = [
  { path: MJS_BASELINE_PATH, growth: (base, head) => mjsGrowth((base ?? []) as string[], head as string[]) },
  { path: DESIGN_BASELINE_PATH, growth: (base, head) => designGrowth((base ?? {}) as Counts, head as Counts) },
  { path: COPY_BASELINE_PATH, growth: (base, head) => copyGrowth((base ?? {}) as CopyBaseline, head as CopyBaseline) },
];

const git = (root: string, args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function resolveBase(root: string): string {
  if (process.env.BASELINE_BASE) return process.env.BASELINE_BASE;
  const target = process.env.GITHUB_BASE_REF;
  if (target) {
    git(root, ["fetch", "--no-tags", "--depth=1", "origin", target]);
    return "FETCH_HEAD";
  }
  try {
    return git(root, ["merge-base", "HEAD", "origin/main"]);
  } catch {
    console.error("找不到 origin/main：先 `git fetch origin main`，或用 BASELINE_BASE 指定对比的提交。");
    process.exit(2);
  }
}

function readAt(root: string, rev: string, file: string): unknown {
  try {
    return JSON.parse(git(root, ["show", `${rev}:${file}`]));
  } catch {
    return undefined;
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.env.GITHUB_ACTIONS === "true" && !process.env.GITHUB_BASE_REF && !process.env.BASELINE_BASE) {
    console.log("baselines:check 跳过（不是 PR，没有目标分支可比）");
    return;
  }
  const base = resolveBase(root);
  const grown = CHECKS.flatMap(({ path: file, growth }) =>
    growth(readAt(root, base, file), JSON.parse(readFileSync(path.join(root, file), "utf8"))).map((line) => `${file}  ${line}`),
  );
  if (grown.length === 0) {
    console.log("baselines:check 通过（三份基线都没比目标分支多）");
    return;
  }
  const excepted = process.env.BASELINE_EXCEPTION === "true";
  for (const line of grown) console[excepted ? "log" : "error"](`${excepted ? "!" : "✗"} ${line}`);
  if (excepted) {
    console.log(`\nbaselines:check 放行：PR 带 ${EXCEPTION_LABEL} 标签。`);
    return;
  }
  console.error(`\n基线只减不增。确属合规例外，在 PR 里写明理由，由 lyjw 打上 ${EXCEPTION_LABEL} 标签后重跑 CI。`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
