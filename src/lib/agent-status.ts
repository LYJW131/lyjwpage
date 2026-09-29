/**
 * 厂商状态页的取数与读取。
 *
 * 拉取在采集 Worker（`providerStatusJob`，结果写进可滞后层）；公开端点只读那一份，
 * 不推送，过没过时由卡片按 AGENT_STATUS_STALE_MS 判断。公开 webhook 只有少数几家
 * 提供，要人工订阅，回执也不签名，不能当事实来源。邮件比轮询更慢，正文没有稳定
 * 字段，所以不走 Email Routing。
 */

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
      // 只有对方明确拒绝（4xx）才不重试；5xx 和网络错误留给下一次尝试。
      if (/^4\d\d /.test(message)) break;
    }
  }
  throw last instanceof Error ? last : new Error(`${host} unreachable`);
}

/** 公开端点：可滞后层里采集 Worker 写的那份；还没写过就是等采集 */
export function getAgentStatus(): Promise<LagResult<AgentStatusPayload>> {
  return loadLag<AgentStatusPayload>(LAG_KEYS.agentStatus, "Waiting for the first status check");
}
