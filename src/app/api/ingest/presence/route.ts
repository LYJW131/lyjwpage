import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { recordPresence, telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 上报器的存活与上下线，独立于数据上报。
 *
 * 拆出来是为了让数据端点变成纯粹「有变化才发」：从前心跳是一个不带任何模块的
 * 遥测信封，跟真实数据挤在同一个路由上，接收端得先解析完整信封才能知道
 * 「这只是一次心跳」。
 *
 * 注意它取代不了超时判定。`state: "offline"` 只覆盖优雅离开（退出、睡眠）——
 * 崩溃、断网、强制关机时上报器发不出任何东西，那些仍然要靠「多久没收到心跳」
 * 兜底。所以这个端点同时承担两件事：周期心跳，和优雅离开时的显式声明。
 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => {
    const row = ((await jsonBody(request)) ?? {}) as {
      state?: unknown;
      active_modules?: unknown;
    };
    if (row.state !== "online" && row.state !== "offline") {
      throw new Error("state 必须是 online 或 offline");
    }
    const activeModules = Array.isArray(row.active_modules)
      ? row.active_modules.filter((value): value is string => typeof value === "string")
      : undefined;

    await recordPresence(row.state, activeModules);
    return null;
  });
}
