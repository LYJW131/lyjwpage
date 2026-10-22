import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { normalizeServer } from "@shared/server-parse";
import type { ReportedServerStatus } from "@shared/types";

export type PreparedServerReport = { source: "server"; receivedAt: number; status: ReportedServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  const status = normalizeServer(input);
  if (status.observedAt > receivedAt + INGEST_FUTURE_SKEW_MS) {
    throw new Error("服务器上报的 observedAt 晚于接收时刻");
  }
  return { source: "server", receivedAt, status };
}
