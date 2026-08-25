import { ingestRoute } from "@/lib/api";
import { recordPlaystationReport } from "@/lib/playstation";

/**
 * PlayStation 状态的唯一入口。Worker 的 presence / playedGames / trophies
 * 三部分各自可省，公共的 Bearer 鉴权、跨部署传播和成功信封由 ingestRoute 统一处理。
 */
export async function POST(request: Request) {
  return ingestRoute(request, recordPlaystationReport);
}
