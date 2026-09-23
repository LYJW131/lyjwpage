import { recordPush, type ReporterName } from "@/lib/reporter-ledger";
import { ledgerMirror } from "@shared/reporters";

/**
 * 收件这一侧给常驻上报器记一笔。跑在 StateHub 里，同一个上报器的两封不会并发改账本。
 * 不发推送、不打缓存标签：这条视图是慢端点，分钟 cron 重渲染 KV 投影时带上就够了。
 */
export async function recordReporterPush(name: ReporterName, at: number, commit: string | null): Promise<void> {
  const mirror = ledgerMirror(name);
  await mirror.put(recordPush(await mirror.get(), at, commit));
}
