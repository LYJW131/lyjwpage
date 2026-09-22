/**
 * 厂商状态的缓存和每分钟刷新。
 *
 * 读路径只在缓存是空的时候才打上游（部署后的第一次）。之后由 API Worker
 * 的 cron 每分钟重拉，变了才推 `agent-status`。公开 webhook 只有 Claude 和
 * Cursor 开着，要人工订阅，回执也不签名，不能当事实来源。邮件比这一分钟
 * 更慢，正文没有稳定字段，所以不走 Email Routing。
 */

import { collectAgentStatus, agentStatusFingerprint, emptyAgentStatus } from "@/lib/agent-status-parse";
import type { AgentStatusPayload } from "@/lib/agent-status-types";
import { get, put } from "@/lib/cache";

const CACHE_KEY = "agent-status:v1";
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "lyjwpage-agent-status/1.0 (+https://lyjw.me)";

async function fetchText(url: string): Promise<string> {
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
      if (/^[45]\d\d /.test(message)) break;
    }
  }
  throw last instanceof Error ? last : new Error(`${host} unreachable`);
}

/**
 * 拉一轮并写进缓存。
 *
 * 返回值是「这一轮和上一轮不一样」时的新快照，没变就是 null。
 * 调用方用它决定要不要推送。检查时刻每分钟都变，不在比较里。
 */
export async function refreshAgentStatus(): Promise<AgentStatusPayload | null> {
  try {
    const previous = (await get<AgentStatusPayload>(CACHE_KEY)) ?? null;
    const payload = await collectAgentStatus(previous, fetchText);
    await put(CACHE_KEY, payload, KEEP_MS);
    return agentStatusFingerprint(previous) === agentStatusFingerprint(payload) ? null : payload;
  } catch (error) {
    console.warn("[agent-status]", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 页面和 `/api/home` 只读缓存。缓存还没有时现拉一轮，不让第一眼是空白。 */
export async function getAgentStatus(): Promise<AgentStatusPayload> {
  const hit = await get<AgentStatusPayload>(CACHE_KEY);
  if (hit) return hit;
  const changed = await refreshAgentStatus();
  if (changed) return changed;
  return (await get<AgentStatusPayload>(CACHE_KEY)) ?? emptyAgentStatus();
}
