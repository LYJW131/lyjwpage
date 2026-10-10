import type Anthropic from "@anthropic-ai/sdk";

import { BUILD_DESIGN_LIMITS } from "@shared/build-routine";

import type { Env } from "../runtime";

// Managed Agents 的会话记录与沙盒不会自己过期，访客在设计会话里说的话会一直留着；令牌过期后再留这么久，
// 让最后一回合跑完、断线的访客补发，然后整个删掉。
export const DESIGN_SESSION_GRACE_MS = 30 * 60_000;
// 一次定时任务最多删这么多，剩下的下一轮接着删，子请求数有上限。
const DELETE_BATCH = 100;

type SessionsApi = Pick<Anthropic["beta"]["sessions"], "list" | "delete">;

export async function deleteExpiredDesignSessions(sessions: SessionsApi, env: Env, now = Date.now()): Promise<number> {
  if (!env.DESIGN_AGENT_ID) return 0;
  const before = new Date(now - BUILD_DESIGN_LIMITS.ttlMs - DESIGN_SESSION_GRACE_MS).toISOString();
  const expired: string[] = [];
  for await (const session of sessions.list({ agent_id: env.DESIGN_AGENT_ID, "created_at[lt]": before, include_archived: true, limit: DELETE_BATCH })) {
    if (session.status === "running" || session.status === "rescheduling") continue;
    expired.push(session.id);
    if (expired.length >= DELETE_BATCH) break;
  }
  for (const id of expired) await sessions.delete(id);
  return expired.length;
}
