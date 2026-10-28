import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullTarget, Source } from "./workspace.js";

const run = promisify(execFile);

export const REPO_DIR = new URL("../../..", import.meta.url).pathname;

export async function git(args: string[], repo = REPO_DIR): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function gitBuffer(args: string[], repo: string): Promise<Buffer> {
  const { stdout } = await run("git", ["-C", repo, ...args], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

// 浅克隆里没有旧提交；按完整 SHA 取，GitHub 允许取可达提交。
async function ensureCommit(sha: string, repo: string) {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], repo);
  } catch {
    await git(["fetch", "--quiet", "--depth=50", "origin", sha], repo);
  }
}

// diff 是 merge-base 到 head 的三点比较，与 PR 页面的 Files changed 一致；源码树是 head 的 `git archive`。
export function gitSource(target: PullTarget, repo = REPO_DIR): Source {
  return {
    async diff() {
      await Promise.all([ensureCommit(target.baseSha, repo), ensureCommit(target.headSha, repo)]);
      return git(["diff", "--no-color", "--no-ext-diff", `${target.baseSha}...${target.headSha}`], repo);
    },
    async tarball() {
      await ensureCommit(target.headSha, repo);
      return gitBuffer(["archive", "--format=tar.gz", "--prefix=snapshot/", target.headSha], repo);
    },
  };
}
