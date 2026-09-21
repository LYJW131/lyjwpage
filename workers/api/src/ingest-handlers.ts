import { commitPreparedHomePodEvent, prepareHomePodEvent, type PreparedHomePodEvent } from "./homepod-ingest";
import { commitPreparedPhoneEnvelope, preparePhoneEnvelope, type PreparedPhoneEnvelope } from "./phone-telemetry";
import { commitPreparedEmbyReport, prepareEmbyReport, type PreparedEmbyReport } from "./stores/emby";
import { commitPreparedPlaystationReport, preparePlaystationReport, type PreparedPlaystationReport } from "./stores/playstation";
import { commitPreparedServerReport, prepareServerReport, type PreparedServerReport } from "./stores/server";
import { commitPreparedTelemetryEnvelope, prepareTelemetryEnvelope, type PreparedTelemetryEnvelope } from "./stores/telemetry";
import { prepareAgentLimits, recordPreparedAgentLimits, type PreparedAgentLimits } from "./stores/vibecoding";

export type PreparedIngest =
  | PreparedTelemetryEnvelope
  | PreparedPhoneEnvelope
  | PreparedHomePodEvent
  | PreparedEmbyReport
  | PreparedPlaystationReport
  | PreparedServerReport
  | PreparedAgentLimits;

export const INGEST_SOURCES = new Set([
  "mac", "iphone", "homepod", "emby", "playstation", "server", "agents",
]);

/** 普通 Worker 阶段：输入收敛；Emby 的 R2 HEAD 也在这里完成。 */
export async function prepareIngest(
  source: string,
  raw: unknown,
  receivedAt = Date.now(),
): Promise<PreparedIngest> {
  switch (source) {
    case "mac": return prepareTelemetryEnvelope(raw, receivedAt);
    case "iphone": return preparePhoneEnvelope(raw, receivedAt);
    case "homepod": return prepareHomePodEvent(raw, receivedAt);
    case "emby": return prepareEmbyReport(raw, receivedAt);
    case "playstation": return preparePlaystationReport(raw, receivedAt);
    case "server": return prepareServerReport(raw, receivedAt);
    case "agents": return prepareAgentLimits(raw, receivedAt);
    default: throw new Error("Unknown ingest source");
  }
}

/** StateHub 阶段：只做依赖权威最新状态的合并、差分与持久化。 */
export async function commitPreparedIngest(command: PreparedIngest): Promise<unknown> {
  switch (command.source) {
    case "mac": return commitPreparedTelemetryEnvelope(command);
    case "iphone": return commitPreparedPhoneEnvelope(command);
    case "homepod": return commitPreparedHomePodEvent(command);
    case "emby": return commitPreparedEmbyReport(command);
    case "playstation": return commitPreparedPlaystationReport(command);
    case "server": return commitPreparedServerReport(command);
    case "agents": return recordPreparedAgentLimits(command.limits, command.receivedAt);
  }
}
