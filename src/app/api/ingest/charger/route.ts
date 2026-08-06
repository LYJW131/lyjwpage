import { normalizeRawStatus, type RawStatus } from "@/lib/anker";
import { recordStatus } from "@/lib/charger-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 接收充电头状态推送。
 *
 * 直接把 a2687-telemetry 的 /status 原样 JSON POST 过来即可 ——
 * 它自带的上报器就是这么发的，设置两个环境变量就行：
 *
 *   A2687_POST_URL=http://<本站>/api/ingest/charger
 *   A2687_POST_INTERVAL=30
 *
 * 没有做认证：按约定这个端点不对公网暴露，只在 Tailscale 虚拟局域网里可达，
 * 访问控制由网络层负责。
 */
export async function POST(request: Request) {
  let raw: RawStatus;
  try {
    raw = (await request.json()) as RawStatus;
  } catch {
    return new Response("请求体不是合法 JSON", { status: 400 });
  }

  // a2687 的上报器在拿到第一帧有效数据前不会发，所以缺 updated_at 视为异常
  if (!raw || typeof raw !== "object" || raw.updated_at == null) {
    return new Response("缺少 updated_at，不像是 a2687 的 /status 数据", { status: 400 });
  }

  await recordStatus(normalizeRawStatus(raw));
  return new Response(null, { status: 204 });
}
