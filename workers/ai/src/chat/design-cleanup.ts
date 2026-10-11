import type { Env } from "../runtime";

// 设计会话的 Durable Object 不会自己消失：转录、挂起的题目与计划、仓库快照都在里面；令牌过期后再留这么久，
// 让最后一回合跑完、断线的访客补发，然后整个删掉。名册在 BuildCoordinator，删成功才除名，失败下轮重试。
export const DESIGN_SESSION_GRACE_MS = 30 * 60_000;
// 一次定时任务最多删这么多，剩下的下一轮接着删，子请求数有上限。
const DELETE_BATCH = 100;

export async function deleteExpiredDesignSessions(env: Env, now = Date.now()): Promise<number> {
  if (!env.BUILD_COORDINATOR || !env.DESIGN_SESSIONS) return 0;
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  const expired = await coordinator.expiredDesignSessions(now - DESIGN_SESSION_GRACE_MS, DELETE_BATCH);
  let deleted = 0;
  for (const id of expired) {
    try {
      await env.DESIGN_SESSIONS.getByName(id).disposeSession();
      await coordinator.forgetDesignSession(id);
      deleted += 1;
    } catch {
      // 除名留在名册里，下一轮定时任务接着试。
    }
  }
  return deleted;
}
