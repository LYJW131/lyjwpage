import { execFileSync } from "node:child_process";
import path from "node:path";

import { checkFiles, loadTypeScript } from "../comment-only-check.ts";
import { TS_EXTENSIONS } from "../comment-only/typescript.ts";
import { isTrustedAuthor, type Pull } from "../pr-gate/github.ts";
import { judgeAsked, tierOf, verifierFiles } from "../pr-gate/tier.ts";
import { isRulePath } from "../rule-drift.ts";

export type NotesOnly = (from: string, to: string) => string[] | null;
export type RulesChanged = (from: string, to: string) => boolean;
type CompareCode = (files: string[]) => { file: string; status: string }[];

const SAME_CODE = new Set(["comment-only", "unchanged"]);

// 两个提交之间只改了文档档的文件（pr-gate/tier.ts 的 docs 档）或代码里的注释时，返回改了哪些文件；有一处别的改动就返回 null。
// 只看 from→to 的文件差异：中间合进来的 main 也算改动，所以合过 main 的照样重验。
// 规则文档（AGENTS.md、CLAUDE.md、HUMAN.md、skill、.claude/rules 等）与验证员自己的文件改了，验证员和判定员照着读的就变了，回执不再算数。
// 合进来的 main 改了它们也算：PR 补丁没变（carried）照样重验。
export const isRuleOrVerifierFile = (file: string) => isRulePath(file) || /(^|\/)CLAUDE\.md$/.test(file) || verifierFiles([file]).length > 0;

export function notesOnlyFiles(files: string[], compareCode: CompareCode): string[] | null {
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

function ensureCommits(...shas: string[]) {
  for (const sha of shas) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    } catch {
      execFileSync("git", ["fetch", "-q", "origin", sha], { stdio: "ignore", timeout: 30_000 });
    }
  }
}

export const gitRulesChanged: RulesChanged = (from, to) => {
  ensureCommits(from, to);
  const files = execFileSync("git", ["diff", "--name-only", "--no-renames", from, to], { encoding: "utf8" }).split("\n").filter(Boolean);
  return files.some(isRuleOrVerifierFile);
};

export const gitNotesOnly: NotesOnly = (from, to) => {
  ensureCommits(from, to);
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const changes = parseRawDiff(execFileSync("git", ["diff", "--raw", "--no-renames", "--no-abbrev", from, to], { encoding: "utf8" }));
  if (changes.some((change) => change.modeChanged)) return null;
  return notesOnlyFiles(changes.map((change) => change.file), (code) => checkFiles({ repo, base: from, to, files: code, ts: loadTypeScript(repo) }));
};

// 读不到提交或解析失败时返回空：证明不了就照路径分档。
export function gitCommentOnlyFiles(base: string, head: string, paths: string[]): string[] {
  const files = paths.filter((file) => TS_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (files.length === 0) return [];
  try {
    ensureCommits(base, head);
    const from = execFileSync("git", ["merge-base", base, head], { encoding: "utf8" }).trim();
    const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const modeChanged = new Map(parseRawDiff(execFileSync("git", ["diff", "--raw", "--no-renames", "--no-abbrev", from, head, "--", ...files], { encoding: "utf8" })).map((change) => [change.file, change.modeChanged]));
    return checkFiles({ repo, base: from, to: head, files, ts: loadTypeScript(repo) })
      .filter((result) => result.status === "comment-only" && modeChanged.get(result.file) === false)
      .map((result) => result.file);
  } catch {
    return [];
  }
}

export function prTier(pull: Pull, paths: string[], commentOnly: typeof gitCommentOnlyFiles = gitCommentOnlyFiles) {
  const trustedAuthor = isTrustedAuthor(pull);
  const proven = trustedAuthor && pull.base?.sha ? commentOnly(pull.base.sha, pull.head.sha, paths) : [];
  return tierOf(paths, { trustedAuthor, judgeAsked: judgeAsked(pull), commentOnly: proven });
}
