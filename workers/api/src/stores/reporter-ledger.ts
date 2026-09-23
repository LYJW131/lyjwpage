import type { ReporterBlock, ReporterName } from "@/lib/reporter-ledger";
import { ledgerMirror } from "@shared/reporters";

/**
 * 收下常驻上报器报文里的 `reporter` 块，存最新那份。跑在 StateHub 里。
 * 不发推送、不打缓存标签：这条视图是慢端点，分钟 cron 重渲染 KV 投影时带上就够了。
 */
export async function recordReporterBlock(name: ReporterName, block: ReporterBlock, at: number): Promise<void> {
  await ledgerMirror(name).put({ ...block, lastPushAt: at });
}
