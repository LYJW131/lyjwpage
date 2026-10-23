
import type { IssueComment, Review } from "./github.ts";

export const BOTS: Record<string, string> = {
  "chatgpt-codex-connector[bot]": "codex",
  "devin-ai-integration[bot]": "devin",
  "claude[bot]": "claude",
  "cursor[bot]": "cursor",
};

export const CODEX_MAX_ROUNDS = 3;

// claude 的评审以「## Code review」汇总评论交付，devin 只交 pull review；报错、@claude 问答这类普通评论不算审过一次。
const REVIEW_COMMENT: Partial<Record<string, RegExp>> = { claude: /^## Code review/m, devin: /(?!)/ };

type CodexState = { commit_sha?: string | null; status?: string | null };

function codexState(comments: IssueComment[]): CodexState | null {
  let state: CodexState | null = null;
  for (const comment of comments) {
    if (BOTS[comment.user?.login ?? ""] !== "codex") continue;
    const match = /<!-- codex-review-state:v1 (\{.*?\}) -->/.exec(comment.body ?? "");
    if (!match) continue;
    try {
      state = (JSON.parse(match[1]) as { code_review?: CodexState }).code_review ?? state;
    } catch {}
  }
  return state;
}

export type Reviewer = {
  bot: string;
  reviews: number;
  rounds?: number;
  maxRounds?: number;
  status?: string | null;
  statusCommit?: string | null;
  lastReviewed: string | null;
  coversHead: boolean;
};

export function reviewerSummary(reviews: Review[], comments: IssueComment[], head: string): Reviewer[] {
  const reviewers: Reviewer[] = [];
  for (const [login, bot] of Object.entries(BOTS)) {
    // 被驳回的评审不算审过：作者推了修复后 lyjw 会驳回旧评审，留着它会把旧 head 记成审过。
    const own = reviews.filter((review) => review.user?.login === login && review.commit_id || review.state !== "DISMISSED");
    const marker = REVIEW_COMMENT[bot];
    const commented = comments.some((comment) => comment.user?.login === login && (!marker || marker.test(comment.body ?? "")));
    if (own.length === 0 && !commented) continue;
    let lastReviewed = own.at(-1)?.commit_id ?? null;
    let codex = {};
    if (bot === "codex") {
      const state = codexState(comments);
      const rounds = new Set(own.map((review) => review.commit_id));
      // 没意见的一轮只回个 👍、不留评审，只能从汇总评论里那份状态看出来。
      if (state?.status === "completed" && state.commit_sha) {
        rounds.add(state.commit_sha);
        lastReviewed = state.commit_sha;
      }
      codex = { rounds: rounds.size, maxRounds: CODEX_MAX_ROUNDS, status: state?.status ?? null, statusCommit: state?.commit_sha ?? null };
    }
    reviewers.push({ bot, reviews: own.length, ...codex, lastReviewed, coversHead: lastReviewed === head });
  }
  return reviewers;
}
