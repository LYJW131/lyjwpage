import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGitHubPrContinuationKey } from "@grok/agent-sdk/channels/github";
import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { type Finding, commentableLines, reviewPayload } from "../lib/review-body.js";

const SHA = /^[0-9a-f]{40}$/i;

const finding = z.object({
  kind: z.enum(["bug", "security"]),
  severity: z.enum(["high", "medium", "low"]),
  file: z.string().min(1).max(240).describe("Path relative to the repository root, as in pr/diff.patch."),
  line: z.number().int().positive().describe("Line number in the head version of the file."),
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(1200).describe("What breaks, the input or path that triggers it, and the fix."),
});

export default defineTool({
  description:
    "Post the review on this session's pull request. Call exactly once, after you finish reading. Empty findings = CLEAN.",
  inputSchema: z.object({
    findings: z.array(finding).max(12).describe("Most severe first. Empty when nothing qualifies."),
  }),
  async execute({ findings }, ctx) {
    if (ctx.session.purpose === "eval") {
      return { posted: false, reason: "eval", count: findings.length };
    }
    const ref = parseGitHubPrContinuationKey(ctx.session.continuationKey ?? "");
    if (ref === undefined) {
      throw new Error("post_findings requires a GitHub pull request session");
    }
    const [headSha, diff] = await Promise.all([
      readFile(join(ctx.workspaceDir, "pr/head.sha"), "utf8").then((text) => text.trim()),
      readFile(join(ctx.workspaceDir, "pr/diff.patch"), "utf8"),
    ]);
    if (!SHA.test(headSha)) {
      throw new Error("missing pr/head.sha");
    }
    const { body, comments } = reviewPayload(findings as Finding[], commentableLines(diff));
    const octokit = await ctx.host.github.getOctokit();
    const response = await octokit.rest.pulls.createReview({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      commit_id: headSha,
      body,
      event: "COMMENT",
      comments,
    });
    return { posted: true, url: response.data.html_url, inline: comments.length, count: findings.length };
  },
});
