import { readFile } from "node:fs/promises";

import { fetchAntigravityViaCli, parseAgyUsage } from "./cli-usage.js";
import { claudeRefreshConfigured, refreshClaudeOauth } from "./claude-oauth.js";
import { config, type AgentId } from "./config.js";
import { info } from "./log.js";
import {
  fetchClaude,
  isClaudeAuthExpired,
  rowFromClaudeUsage,
  CLAUDE_AUTH_EXPIRED_MESSAGE,
} from "./providers/claude.js";
import { fetchCodex, rowFromCodexUsage } from "./providers/codex.js";
import { fetchGrok, rowFromGrokBilling } from "./providers/grok.js";
import type { AgentRow } from "./site.js";
import { object } from "./windows.js";

export { agentPlanLabel, claudeWindows, codexWindows, genericWindows } from "./windows.js";

async function loadFixture(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const rec = object(parsed);
  if (!rec) throw new Error("LIMITS_FIXTURE 不是对象");
  return rec;
}

function errorRow(id: string, error: unknown): AgentRow {
  const message = error instanceof Error ? error.message : String(error);
  return { id, plan: null, limits: [], limitsError: message };
}

function rowFromFixture(id: AgentId, body: unknown): AgentRow | null {
  if (body == null) return null;
  switch (id) {
    case "claude":
      return rowFromClaudeUsage(body);
    case "codex":
      return rowFromCodexUsage(body);
    case "grok":
      return rowFromGrokBilling(body);
    case "antigravity":
      if (typeof body === "string") {
        const limits = parseAgyUsage(body);
        if (limits.length === 0) {
          return {
            id,
            plan: null,
            limits: [],
            limitsError: "agy /usage 没有输出可解析的限额行，多半是没登录",
          };
        }
        return { id, plan: null, limits, limitsError: null };
      }
      return null;
    case "cursor":
      return null;
  }
}

async function collectClaudeLive(): Promise<AgentRow | null> {
  try {
    return await fetchClaude();
  } catch (error) {
    if (isClaudeAuthExpired(error) && claudeRefreshConfigured()) {
      info("Claude 401，刷新 OAuth 后再取一次");
      try {
        await refreshClaudeOauth();
        return await fetchClaude();
      } catch (retryError) {
        const message =
          retryError instanceof Error ? retryError.message : CLAUDE_AUTH_EXPIRED_MESSAGE;
        return { id: "claude", plan: null, limits: [], limitsError: message };
      }
    }
    if (isClaudeAuthExpired(error)) {
      return { id: "claude", plan: null, limits: [], limitsError: CLAUDE_AUTH_EXPIRED_MESSAGE };
    }
    return errorRow("claude", error);
  }
}

async function collectLive(id: AgentId): Promise<AgentRow | null> {
  switch (id) {
    case "claude":
      return collectClaudeLive();
    case "codex":
      return fetchCodex();
    case "grok":
      return fetchGrok();
    case "antigravity":
      return fetchAntigravityViaCli();
    case "cursor":
      return null;
  }
}

/**
 * 对 config.agentIds 里每家并发取。一家抛错只变成那一行的 limitsError。
 * cursor 仍不发。LIMITS_FIXTURE 形状是 `{ "<id>": <该家原始 HTTP 响应体> }`。
 */
export async function collectAgents(): Promise<AgentRow[]> {
  const fixture = config.limitsFixture ? await loadFixture(config.limitsFixture) : null;
  const settled = await Promise.allSettled(
    config.agentIds.map(async (id) => {
      if (fixture) return rowFromFixture(id, fixture[id]);
      return collectLive(id);
    }),
  );
  const agents: AgentRow[] = [];
  for (const [index, result] of settled.entries()) {
    const id = config.agentIds[index] ?? "unknown";
    if (result.status === "fulfilled") {
      if (result.value) agents.push(result.value);
      continue;
    }
    agents.push(errorRow(id, result.reason));
  }
  return agents;
}
