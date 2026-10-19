import type { BuildGap, summarizeChecks } from "./checks.ts";
import type { Pull } from "./github.ts";
import { CODEX_MAX_ROUNDS, type Reviewer } from "./reviewers.ts";
import type { buildThreads } from "./threads.ts";
import type { tierOf } from "./tier.ts";

export const REQUIRED_CHECKS = ["check"];
const ONCE_PER_PR_REVIEWERS = ["claude", "devin"];

export function decide({
  pull,
  tier,
  checks,
  builds,
  threads,
  reviewers,
  receipt,
  judge,
}: {
  pull: Pull;
  tier: ReturnType<typeof tierOf>;
  checks: ReturnType<typeof summarizeChecks>;
  builds: { missing: BuildGap[] };
  threads: ReturnType<typeof buildThreads>;
  reviewers: Reviewer[];
  receipt: { pass: boolean; next: string | null } | null;
  judge: boolean;
}) {
  const todo: string[] = [];
  const notes: string[] = [];
  if (pull.merged) todo.push("PR 已经合并：门槛不用再过");
  else if (pull.state !== "open") todo.push("PR 已关闭：要合先重新打开");
  if (pull.draft) todo.push("PR 还是草稿：确认要合时在 PR 页面转为待审（Ready for review）");
  if (pull.mergeable === false || pull.mergeable_state === "dirty") todo.push("和 main 有冲突：把 main 合进分支解决冲突（merge，不 rebase）");
  else if (pull.mergeable === null && pull.state === "open") todo.push("GitHub 还没算出能不能合并：过一会儿重跑本命令");
  for (const name of REQUIRED_CHECKS) {
    if (!checks.items.some((item) => item.name === name)) todo.push(`head 上还没有「${name}」检查：CI 可能还在排队，等它出现并跑完（带上限）再重跑本命令`);
  }
  if (checks.pending.length > 0) todo.push(`head 上还有检查在跑：${checks.pending.join("、")}；等它们跑完（带上限）再重跑本命令`);
  for (const failing of checks.failing) todo.push(`检查「${failing.name}」结论是 ${failing.result}：看 ${failing.url ?? "PR 的 Checks 页"} 找原因，修好再推`);
  for (const gap of builds.missing) todo.push(`该有的 Workers Builds: ${gap.worker} 没过：${gap.reason}；去 Cloudflare 看 ${gap.worker} 的分支构建`);
  if (!threads.resolvedKnown) {
    todo.push(`拿不到评审线程的解决状态（${threads.total} 条线程）：去 PR 的 Files changed 页逐条核对`);
  } else if (threads.unresolved.length > 0) {
    const answered = threads.unresolved.filter((thread) => thread.lastByLyjw).length;
    const blocking = threads.unresolved.filter((thread) => thread.level === "blocking" || thread.level === "security").length;
    todo.push(
      `还有 ${threads.unresolved.length} 条评审线程没解决（${blocking} 条红圈、P0/P1 或安全类；${answered} 条最后是我们回的，确认改了就点解决）：见 threads.unresolved，逐条改或回复理由后解决`,
    );
  }
  if (judge) {
    const codex = reviewers.find((reviewer) => reviewer.bot === "codex");
    if (codex && (codex.rounds ?? 0) >= CODEX_MAX_ROUNDS) notes.push(`Codex 已审 ${codex.rounds} 轮，到上限了，不再等它`);
    else if (codex?.status === "failed") notes.push("Codex 最近一轮没审成（多半是额度用完）：不等它，额度恢复后可在 PR 评论 @codex review");
    else if (!codex?.coversHead) todo.push(`Codex 还没审到 head（已用 ${codex?.rounds ?? 0}/${CODEX_MAX_ROUNDS} 轮，每次推送自动审一轮）：等它审完处理新意见，等待上限照 lyjwpage-verify「等待要有上限」`);
    for (const bot of ONCE_PER_PR_REVIEWERS) {
      if (!reviewers.some((reviewer) => reviewer.bot === bot)) todo.push(`${bot} 还没评审这个 PR（每个 PR 只审一次）：等它，等待上限照 lyjwpage-verify「等待要有上限」；超时在汇报里记它没跑成，不算通过`);
    }
  }
  if (receipt && !receipt.pass) todo.push(receipt.next ?? "回执或判定没通过：见 receipt");
  if (tier.ui.length > 0) notes.push("碰到界面：合并前还要 lyjw 看图点头，脚本不判断这一项");
  return { notes, ready: todo.length === 0, todo };
}
