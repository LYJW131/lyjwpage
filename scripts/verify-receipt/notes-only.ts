import { execFileSync } from "node:child_process";

import { checkFiles, loadTypeScript } from "../comment-only-check.ts";
import { tierOf, verifierFiles } from "../pr-gate/tier.ts";
import { isRulePath } from "../rule-drift.ts";

export type NotesOnly = (from: string, to: string) => string[] | null;
type CompareCode = (files: string[]) => { file: string; status: string }[];

const SAME_CODE = new Set(["comment-only", "unchanged"]);

// 两个提交之间只改了文档档的文件（pr-gate/tier.ts 的 docs 档，规则文档除外）或代码里的注释时，返回改了哪些文件；有一处别的改动就返回 null。
// 只看 from→to 的文件差异：中间合进来的 main 也算改动，所以合过 main 的照样重验。
// 规则文档（AGENTS.md、CLAUDE.md、HUMAN.md、skill、.claude/rules 等）与验证员自己的文件改了，验证员和判定员照着读的就变了，回执不再算数。
const changesRules = (file: string) => isRulePath(file) || /(^|\/)CLAUDE\.md$/.test(file) || verifierFiles([file]).length > 0;

export function notesOnlyFiles(files: string[], compareCode: CompareCode): string[] | null {
  if (files.some(changesRules)) return null;
  const code = files.filter((file) => tierOf([file], { trustedAuthor: true }).name !== "docs");
  if (code.length === 0) return files;
  return compareCode(code).every((result) => SAME_CODE.has(result.status)) ? files : null;
}

// 内容比较看不见可执行位：去掉 x 位会让钩子脚本跑不起来，模式变了一律不算只改注释。新增、删除的文件一边模式是 000000，不算模式变化。
export function parseRawDiff(raw: string) {
  return raw.split("\n").filter((line) => line.startsWith(":")).map((line) => {
    const [meta = "", file = ""] = line.split("\t");
    const [oldMode = "", newMode = ""] = meta.slice(1).split(" ");
    return { file, modeChanged: oldMode !== newMode && oldMode !== "000000" && newMode !== "000000" };
  });
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
  const changes = parseRawDiff(execFileSync("git", ["diff", "--raw", "--no-renames", "--no-abbrev", from, to], { encoding: "utf8" }));
  if (changes.some((change) => change.modeChanged)) return null;
  return notesOnlyFiles(changes.map((change) => change.file), (code) => checkFiles({ repo, base: from, to, files: code, ts: loadTypeScript(repo) }));
};
