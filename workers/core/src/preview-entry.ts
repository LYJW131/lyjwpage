import { PREVIEW_REVISION_PATH } from "../../../scripts/preview-worker-name.ts";
import { AlarmEgressProbe, handleAlarmEgressProbe } from "../../ai/src/alarm-egress-probe";
import { AnthropicEgress, BuildCoordinator, ChatQuota } from "../../ai/src/index";
import type { Env as AiEnv } from "../../ai/src/runtime";
import aiWorker from "../../ai/src/worker";

import apiWorker, { LivePushRoom, StateHub } from "./index";
import { readPublicStatus } from "./public-status";
import type { Env as ApiEnv } from "./runtime";

export { AlarmEgressProbe, AnthropicEgress, BuildCoordinator, ChatQuota, LivePushRoom, StateHub };

type PreviewEnv = ApiEnv & Omit<AiEnv, "PUBLIC_STATUS"> & { PREVIEW_COMMIT_SHA?: string; ALARM_PROBE_API_KEY?: string; ALARM_EGRESS_PROBE: DurableObjectNamespace<AlarmEgressProbe> };

export default {
  async fetch(request: Request, env: PreviewEnv, ctx: ExecutionContext): Promise<Response> {
    if (env.PREVIEW_WORKER !== "true") return new Response("Not found", { status: 404 });
    if (new URL(request.url).pathname.startsWith("/api/preview/anthropic-alarm/")) return handleAlarmEgressProbe(request, env);
    if (new URL(request.url).pathname === PREVIEW_REVISION_PATH) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return Response.json({ commitSha: env.PREVIEW_COMMIT_SHA ?? "" }, { headers: { "Cache-Control": "no-store" } });
    }
    const aiEnv: AiEnv = { ...env, PUBLIC_STATUS: { readStatus: (path) => readPublicStatus(path, env, ctx) } };
    const apiEnv = {
      ...env,
      AI_SERVICE: { fetch: (input: RequestInfo | URL, init?: RequestInit) => aiWorker.fetch(new Request(input, init), aiEnv) },
    };
    return apiWorker.fetch(request, apiEnv, ctx);
  },
} satisfies ExportedHandler<PreviewEnv>;
