import type Anthropic from "@anthropic-ai/sdk";

import { GITHUB_ISSUE_LIMITS, GITHUB_ISSUE_REPO } from "@shared/github-issue";

export const ISSUE_DRAFT_TOOL: Anthropic.Beta.BetaTool = {
  name: "draft_github_issue",
  description: [
    `Draft an issue for this site's GitHub repo (${GITHUB_ISSUE_REPO}).`,
    "The draft appears to the visitor as an editable form; they review it and submit it under their own GitHub account. You cannot submit it, and nothing is filed until they do.",
    "Use it when the visitor reports a bug or problem with this site, suggests a feature, or asks to open an issue. Draft at most one per reply.",
    "Call it before writing anything about the draft, then mention it once in a sentence or two: the form sits below the conversation, just above the message box.",
    "Write a short, specific title and a Markdown body: what happened or what is wanted, context from the conversation, and the expected behavior for bugs. Leave out anything personal about the visitor.",
  ].join(" "),
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: `Issue title, at most ${GITHUB_ISSUE_LIMITS.titleChars} characters` },
      body: { type: "string", description: `Issue body in Markdown, at most ${GITHUB_ISSUE_LIMITS.bodyChars} characters` },
    },
    required: ["title", "body"],
    additionalProperties: false,
  },
  strict: true,
};
