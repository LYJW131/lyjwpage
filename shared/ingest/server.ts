import { normalizeServer } from "@/lib/server-parse";
import type { ReportedServerStatus } from "@/lib/types";

export type PreparedServerReport = { source: "server"; receivedAt: number; status: ReportedServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  return { source: "server", receivedAt, status: normalizeServer(input) };
}
