import { ingestRoute } from "@/lib/api";
import { mergeEmbyReceipt, recordEmbyReport } from "@/lib/emby";

/**
 * Emby 相关的全部数据都从这一个门进来，推送方是 NAS 上的代理
 * （reporters/emby-reporter）。路径按**数据来源**命名而不是按上报程序命名，
 * 和 /api/ingest/mac、/api/ingest/homepod 一致。
 *
 * 这个路径从前是 Emby webhook 的直收入口，不校验密钥 —— Emby 的 webhook
 * 配置项加不了自定义请求头，直发就只能不鉴权。那条路已经删了：现在 webhook
 * 先发给同机的代理，由它带上密钥转发，站点这边只剩一种鉴权方式。
 *
 * 一次上报可以只带其中一部分，见 lib/emby.ts 的 recordEmbyReport。
 * 响应里的 missingImages 是「引用了但本站没有的图片键」，代理据此补传；
 * 各部署各有各的 Redis，所以那份名单要并上对端的，见 mergeEmbyReceipt。
 */
export async function POST(request: Request) {
  return ingestRoute(request, recordEmbyReport, mergeEmbyReceipt);
}
