import { execFileSync } from "node:child_process";
import { parseComments, type Comment } from "../verify-receipt.ts";
import { isRuleOrVerifierFile } from "../verify-receipt/notes-only.ts";

export type Previous = { sha: string; level: string; text: string; changed: string[] };
export type History = { isAncestor: (from: string, to: string) => boolean; changed: (from: string, to: string) => string[] };

// 回执原文过长多半是验证员把输出贴进了证据，整段塞进提示词得不偿失，这时照常整轮重验
const MAX_TEXT = 12_000;

// 上一份回执能给这轮当底的条件：清单与原话没变（body 摘要相同）、按的提交是 head 的祖先、之间 PR 自己改过文件，且没改规则文档或验证员自己的文件。
// 只算 PR 自己的文件：合进来的 main 带的改动不在 PR 文件里；之间只合了 main 的，交给 verify-receipt 的 carried 判断，这里不接
export function previousReceipt(comments: Comment[], { head, body, prFiles, history }: { head: string; body: string; prFiles: string[]; history: History }): Previous | null {
  let last: { sha: string; level: string; body?: string | null; text: string } | null = null;
  for (const comment of comments) {
    const { receipt } = parseComments([comment]);
    if (receipt) last = { ...receipt, text: comment.body ?? "" };
  }
  if (!last || last.sha === head || last.body !== body || !history.isAncestor(last.sha, head)) return null;
  const between = history.changed(last.sha, head);
  if (between.some(isRuleOrVerifierFile)) return null;
  const own = new Set(prFiles);
  const changed = between.filter((file) => own.has(file));
  const text = last.text.split("\n").filter((line) => !line.startsWith("<img ")).join("\n").trim();
  if (changed.length === 0 || text.length > MAX_TEXT) return null;
  return { sha: last.sha, level: last.level, text, changed };
}

export const gitHistory: History = {
  isAncestor: (from, to) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", from, to], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
  changed: (from, to) => execFileSync("git", ["diff", "--name-only", "--no-renames", from, to], { encoding: "utf8" }).split("\n").filter(Boolean),
};
