import { normalizeServer } from "@shared/server-parse";
import type { ReportedServerStatus } from "@shared/types";

export type PreparedServerReport = { source: "server"; receivedAt: number; status: ReportedServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  return { source: "server", receivedAt, status: normalizeServer(input) };
}
