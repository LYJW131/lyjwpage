import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullTarget, Source } from "../bot/lib/workspace.js";

const run = promisify(execFile);

export const REPO_DIR = process.env.REVIEW_EVAL_REPO ?? new URL("../../..", import.meta.url).pathname;

async function git(args: string[], encoding: "utf8" | "buffer") {
  const { stdout } = await run("git", ["-C", REPO_DIR, ...args], { encoding, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

// 浅克隆里没有旧提交；按完整 SHA 取，GitHub 允许取可达提交。
async function ensureCommit(sha: string) {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], "utf8");
  } catch {
    await git(["fetch", "--quiet", "--depth=50", "origin", sha], "utf8");
  }
}

// 评测用本地 git 代替 GitHub API 取同一份 diff 与源码树，喂给模型的文件与线上一致。
export function gitSource(target: PullTarget): Source {
  return {
    async diff() {
      await Promise.all([ensureCommit(target.baseSha), ensureCommit(target.headSha)]);
      return String(await git(["diff", "--no-color", "--no-ext-diff", `${target.baseSha}...${target.headSha}`], "utf8"));
    },
    async tarball() {
      await ensureCommit(target.headSha);
      return Buffer.from(await git(["archive", "--format=tar.gz", "--prefix=snapshot/", target.headSha], "buffer"));
    },
  };
}
