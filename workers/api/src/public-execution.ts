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
  // 屏障在 StateHub.publicRead 里随读取一起过；可滞后层只读 LAG KV，不发读取也就不唤醒 StateHub。
  const lagOnly = layerOfPath(new URL(request.url).pathname) === "lag" && !devOverridesEnabled();
  if (!lagOnly) await ensurePreviewState(hub);
  let notReady = false;
  const storage = createPublicStorage(
    hub,
    () => env.STATE.get(env.STATE.idFromName("global")),
    () => { notReady = true; },
  );
  // 注入查询在信封外读存储，未就绪会直接抛出；loader 里的则被信封吞掉，两条都靠 notReady 判定。
  const response = await withRequestState(() => requestStore.run({ env, ctx, storage }, () => publicResponse(request)))
    .catch((error: unknown) => {
      if (notReady) return null;
      throw error;
    });
  if (response && !notReady) return response;
  return Response.json(
    { ok: false, error: "状态存储初始化中" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
