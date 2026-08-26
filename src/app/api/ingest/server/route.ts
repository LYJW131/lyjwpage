import { ingestRoute } from "@/lib/api";
import { recordServerReport } from "@/lib/server";

/**
 * 落地节点的状态入口。推送方是跑在节点上的上报器
 * （reporters/server-reporter）。路径按数据是谁产生的命名，不是按上报程序
 * 命名 —— 换个采集脚本，这个 URL 也不该跟着改。
 */
export async function POST(request: Request) {
  return ingestRoute(request, recordServerReport);
}
