import type { PullTarget } from "./workspace.js";

// 接在 `review.txt` 后面的那段：线上与评测都用它，评审员看到的开场一致。
export function triggerMessage(target: PullTarget) {
  return [
    target.number ? `Pull request: ${target.owner}/${target.repo}#${target.number}` : `Pull request: ${target.owner}/${target.repo} (not opened yet)`,
    `Title: ${target.title}`,
    `Author: ${target.author}`,
    `Base: ${target.baseSha}`,
    `Head: ${target.headSha}`,
    "",
    "Review this pull request. Start with pr/meta.md and pr/diff.patch.",
  ].join("\n");
}
