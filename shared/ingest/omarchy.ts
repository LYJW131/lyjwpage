import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { object } from "@shared/json";
import type { OmarchyDesktop, OmarchyPresence } from "@shared/omarchy";

export type PreparedOmarchyReport = { source: "omarchy"; receivedAt: number; presence: OmarchyPresence };

function text(value: unknown, max: number): string | null {
  if (value != null && typeof value !== "string") throw new Error("Omarchy 字段必须是字符串或 null");
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const points = [...trimmed];
  return points.length > max ? points.slice(0, max).join("") : trimmed;
}

function desktop(value: unknown): OmarchyDesktop | null {
  if (value === null) return null;
  const row = object(value);
  const applicationName = text(row?.applicationName, 128);
  if (!row || !applicationName) throw new Error("desktop 缺少 applicationName");
  return {
    applicationName,
    appId: text(row.appId, 256),
    windowTitle: text(row.windowTitle, 200),
    workspace: text(row.workspace, 64),
  };
}

export function prepareOmarchyReport(input: unknown, receivedAt = Date.now()): PreparedOmarchyReport {
  const envelope = object(input);
  const modules = object(envelope?.modules);
  const observedAt = envelope?.observedAt;
  if (envelope?.version !== 1 || !modules || !("desktop" in modules)
    || typeof observedAt !== "number" || !Number.isSafeInteger(observedAt) || observedAt <= 0
    || observedAt > receivedAt + INGEST_FUTURE_SKEW_MS) {
    throw new Error("Invalid Omarchy envelope");
  }
  return { source: "omarchy", receivedAt, presence: { observedAt, receivedAt, desktop: desktop(modules.desktop) } };
}
