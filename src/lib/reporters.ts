import { AwaitingReport } from "@/lib/awaiting-report";
import { LagResult } from "@/lib/lag-result";
import { readLagEntry } from "@/lib/lag-store";
import type { ReporterStat, ReportersPayload } from "@/lib/reporter-ledger";
import { LAG_KEYS } from "@shared/lag";

/**
 * 两个常驻上报器最新报来的账本（12 小时推送次数、镜像提交），各在可滞后层一条；
 * 还没收到过的是 null。各格按自己的 lastPushAt 判断上报器还活着没有。
 */
export async function getReportersStatus(): Promise<LagResult<ReportersPayload>> {
  const [server, agents] = await Promise.all([
    readLagEntry<ReporterStat>(LAG_KEYS.reporterServer),
    readLagEntry<ReporterStat>(LAG_KEYS.reporterAgents),
  ]);
  if (!server && !agents) throw new AwaitingReport("尚未收到常驻上报器的账本");
  return new LagResult(
    { reporters: { "server-reporter": server?.data ?? null, "agents-reporter": agents?.data ?? null } },
    Math.max(server?.updatedAt ?? 0, agents?.updatedAt ?? 0),
  );
}
