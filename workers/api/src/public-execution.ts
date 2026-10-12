import { withRequestState } from "@shared/request-state";
import { publicResponse } from "./public-api";
import { requestStore, type Env } from "./runtime";
import { createPublicStorage } from "./storage-driver";

export async function executePublicRequest(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const hub = () => env.STATE.get(env.STATE.idFromName("global"));
  const storage = createPublicStorage(hub(), hub);
  return withRequestState(() => requestStore.run({ env, ctx, storage }, () => publicResponse(request)));
}
