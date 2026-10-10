import { AwaitingReport } from "@/lib/awaiting-report";
import { LagResult } from "@/lib/lag-result";
import { readLagEntry } from "@/lib/lag-store";
import type { ReporterStat, ReportersPayload } from "@/lib/reporter-ledger";
import { LAG_KEYS } from "@shared/lag";

export async function getReportersStatus(): Promise<LagResult<ReportersPayload>> {
  const [server, agents] = await Promise.all([
    readLagEntry<ReporterStat>(LAG_KEYS.reporterServer),
    readLagEntry<ReporterStat>(LAG_KEYS.reporterAgents),
  ]);
  if (!server && !agents) throw new AwaitingReport("No reporter ledger yet");
  return new LagResult(
    { reporters: { "server-reporter": server?.data ?? null, "agents-reporter": agents?.data ?? null } },
    Math.max(server?.updatedAt ?? 0, agents?.updatedAt ?? 0),
  );
}
