import { normalizeServer } from "@/lib/server-parse";
import type { ServerStatus } from "@/lib/types";

export type PreparedServerReport = { source: "server"; receivedAt: number; status: ServerStatus };

export function prepareServerReport(input: unknown, receivedAt = Date.now()): PreparedServerReport {
  return { source: "server", receivedAt, status: normalizeServer(input) };
}
