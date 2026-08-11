import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { recordEmbyReport } from "@/lib/emby";
import { telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 接收 NAS 上推送代理（reporters/emby-reporter）的上报，Emby 相关的全部数据
 * 都从这一个门进来。
 *
 * 从前还有个 /api/ingest/emby 直收 Emby 的 webhook，不校验密钥 —— Emby 的
 * webhook 配置项加不了自定义请求头，直发就只能不鉴权。现在 webhook 先发给
 * 同机的代理，由它带上密钥转发，站点这边只剩一种鉴权方式。
 *
 * 一次上报可以只带其中一部分，见 lib/emby.ts 的 recordEmbyReport。
 * 响应里的 missingImages 是「引用了但本站没有的图片键」，代理据此补传。
 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => recordEmbyReport(await jsonBody(request)));
}
