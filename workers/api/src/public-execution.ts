import { withRequestState } from "@shared/request-state";
import { publicResponse } from "./public-api";
import { requestStore, type Env } from "./runtime";
import { createPublicStorage } from "./storage-driver";

/** Run public loaders in an ordinary Worker after crossing StateHub's visibility barrier. */
export async function executePublicRequest(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  if (!(await hub.publicBarrier())) {
    return Response.json(
      { ok: false, error: "状态存储初始化中" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const storage = createPublicStorage(hub);
  return withRequestState(() => requestStore.run({ env, ctx, storage }, () => publicResponse(request)));
}
