import { withRequestState } from "@shared/request-state";
import { layerOfPath } from "@/lib/status-views";
import { ensurePreviewState } from "./preview";
import { devOverridesEnabled, publicResponse } from "./public-api";
import { requestStore, type Env } from "./runtime";
import { createPublicStorage } from "./storage-driver";

export async function executePublicRequest(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  // 可滞后层只读 LAG KV，写入方不经 commitIngest 队列，屏障对它没有意义；跳过才不唤醒 StateHub。
  // 开着假数据注入时每条端点都先查 DO 里的注入，得照常过屏障。
  const lagOnly = layerOfPath(new URL(request.url).pathname) === "lag" && !devOverridesEnabled();
  if (!lagOnly) {
    await ensurePreviewState(hub);
    if (!(await hub.publicBarrier())) {
      return Response.json(
        { ok: false, error: "状态存储初始化中" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const storage = createPublicStorage(hub, () => env.STATE.get(env.STATE.idFromName("global")));
  return withRequestState(() => requestStore.run({ env, ctx, storage }, () => publicResponse(request)));
}
