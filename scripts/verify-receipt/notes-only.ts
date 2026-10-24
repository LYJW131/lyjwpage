import { execFileSync } from "node:child_process";

import { checkFiles, loadTypeScript } from "../comment-only-check.ts";
import { tierOf } from "../pr-gate/tier.ts";

export type NotesOnly = (from: string, to: string) => string[] | null;
type CompareCode = (files: string[]) => { file: string; status: string }[];

const SAME_CODE = new Set(["comment-only", "unchanged"]);

// 两个提交之间只改了文档档的文件（pr-gate/tier.ts 的 docs 档）或代码里的注释时，返回改了哪些文件；有一处别的改动就返回 null。
// 只看 from→to 的文件差异：中间合进来的 main 也算改动，所以合过 main 的照样重验。
export function notesOnlyFiles(files: string[], compareCode: CompareCode): string[] | null {
  const code = files.filter((file) => tierOf([file], { trustedAuthor: true }).name !== "docs");
  if (code.length === 0) return files;
  return compareCode(code).every((result) => SAME_CODE.has(result.status)) ? files : null;
}

export const gitNotesOnly: NotesOnly = (from, to) => {
  for (const sha of [from, to]) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    } catch {
      execFileSync("git", ["fetch", "-q", "origin", sha], { stdio: "ignore" });
    }
  }
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["diff", "--name-only", "--no-renames", from, to], { encoding: "utf8" }).split("\n").filter(Boolean);
  return notesOnlyFiles(files, (code) => checkFiles({ repo, base: from, to, files: code, ts: loadTypeScript(repo) }));
};
