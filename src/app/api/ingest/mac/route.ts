import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { recordTelemetryEnvelope, telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mac 上报器的唯一入口：数据、心跳、优雅下线都是同一个 v4 信封。
 *
 * 从前分成 /telemetry 和 /presence 两个端点，为的是让数据端点变成纯粹
 * 「有变化才发」。但代价是同一台机器的同一件事被切成两条路：存活要在两处
 * 各记一遍，上报器也要维护两个 URL 和两套请求组装。心跳本来就只是一个不带
 * 模块的信封，用 modules 空不空来区分足够了，不值得为它开一个路由。
 *
 * 下线仍是两条互补的路：presence: "offline" 覆盖退出、睡眠这类优雅离开，
 * 崩溃、断网、强制关机只能靠站点这边「多久没收到」的超时兜底。
 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => recordTelemetryEnvelope(await jsonBody(request)));
}
