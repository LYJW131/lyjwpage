
import type { AgentStatusPayload } from "@/lib/agent-status-types";
import { loadLag, type LagResult } from "@/lib/lag-result";
import { LAG_KEYS } from "@shared/lag";

const TIMEOUT_MS = 15_000;
const USER_AGENT = "lyjwpage-agent-status/1.0 (+https://lyjw.me)";

export async function fetchText(url: string): Promise<string> {
  const host = new URL(url).host;
  let last: unknown;
  // 状态页偶发一次连接被掐（本地复现过 status.claude.com 的 fetch failed）。
  // 4xx 是对方拒绝，重试不会变好。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json, application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${response.status} ${host}`);
      return response.text();
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : "";
      if (/^4\d\d /.test(message)) break;
    }
  }
  throw last instanceof Error ? last : new Error(`${host} unreachable`);
}

export function getAgentStatus(): Promise<LagResult<AgentStatusPayload>> {
  return loadLag<AgentStatusPayload>(LAG_KEYS.agentStatus, "Waiting for the first status check");
}
