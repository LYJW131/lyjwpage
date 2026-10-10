import type Anthropic from "@anthropic-ai/sdk";

import { ASK_VISITOR_TOOL, DESIGN_MAX_TOKENS, DESIGN_READ_LIMITS, PROPOSE_BUILD_TOOL } from "../src/chat/design";
import { FIND_REPO_FILES_TOOL, READ_REPO_FILE_TOOL } from "../src/chat/repo-file";
import { MAX_DOC_READS_PER_REPLY } from "../src/tools/project-docs";
import { SITE_TOOLS } from "../src/tools/registry";

export const PATHS = {
  start: "/api/design/start",
  turn: "/api/design/turn",
  llmBase: "/api/design/llm",
  plan: "/api/design/plan",
  status: "/status",
} as const;

// One visitor message buys one design turn (BuildCoordinator, as today); inside it the browser may make several model
// requests, so the proxy meters every request against this per-turn budget. Cost covers input too: the browser
// supplies the whole transcript, and stuffing it is the cheapest way to burn money.
export const TURN_LIMITS = {
  requests: 12,
  outputTokens: DESIGN_MAX_TOKENS,
  costMicroUsd: 1_000_000,
  wallMs: 5 * 60_000,
  bodyBytes: 384 * 1024,
  messages: 120,
  toolResultChars: 40_000,
  staleInflightMs: 3 * 60_000,
} as const;

// Opus 5.5 list prices in USD per million tokens, as in the pi-ai 1.1.0 catalog (dist/providers/data/anthropic.json).
export const OPUS_PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } as const;

export const DESIGN_TOOLS: Anthropic.Beta.BetaTool[] = [
  ...SITE_TOOLS.map(({ name, description, replyCap, inputSchema }) => ({
    name,
    description: replyCap ? `${description}\n${replyCap.replace(`at most ${MAX_DOC_READS_PER_REPLY} `, `at most ${DESIGN_READ_LIMITS.docs} `)}` : description,
    input_schema: inputSchema,
    strict: true,
  })),
  FIND_REPO_FILES_TOOL,
  READ_REPO_FILE_TOOL,
  ASK_VISITOR_TOOL,
  PROPOSE_BUILD_TOOL,
];

export const DESIGN_TOOL_NAMES = new Set(DESIGN_TOOLS.map((tool) => tool.name));
