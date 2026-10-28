import { defaultGitHubAuth, githubChannel } from "@grok/agent-sdk/channels/github";
import { githubSource, reviewWorkspace } from "../lib/workspace.js";

const REPO = "lyjw131/lyjwpage";
// 与 Devin Review 同一时机：PR 打开、重开、转为待审时审一次；草稿与之后的推送不审。
const REVIEW_ACTIONS = new Set(["opened", "reopened", "ready_for_review"]);

export default githubChannel({
  botName: "lyjwpage-review",
  cursorAccount: { repos: [REPO] },
  deliverReplies: false,
  onComment: () => null,
  onPullRequest: (ctx, pr) => {
    if (ctx.repository.fullName.toLowerCase() !== REPO || pr.draft || !REVIEW_ACTIONS.has(pr.action)) {
      return null;
    }
    return {
      auth: defaultGitHubAuth(ctx),
      context: ["Review this pull request. Start with pr/meta.md and pr/diff.patch."],
      async workspaceFiles() {
        const octokit = await ctx.github.getOctokit();
        const { data } = await octokit.rest.pulls.get({
          owner: ctx.repository.owner,
          repo: ctx.repository.name,
          pull_number: pr.number,
        });
        const target = {
          owner: ctx.repository.owner,
          repo: ctx.repository.name,
          number: pr.number,
          title: data.title,
          body: data.body ?? "",
          author: data.user?.login ?? "unknown",
          baseSha: data.base.sha,
          headSha: data.head.sha,
        };
        return reviewWorkspace(githubSource(octokit, target), target);
      },
    };
  },
});
