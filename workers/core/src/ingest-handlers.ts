import { commitPreparedAgentsReport } from "./stores/agents";
import { recordPreparedClaudeCloudUsage } from "./stores/claude-cloud";
import { commitPreparedHomePodEvent } from "./homepod-ingest";
import { commitPreparedPhoneEnvelope } from "./phone-telemetry";
import { commitPreparedEmbyReport } from "./stores/emby";
import { commitPreparedPlaystationReport } from "./stores/playstation";
import { commitPreparedTelemetryEnvelope } from "./stores/telemetry";
import type { CoreCommand } from "@shared/ingest/prepare";
import { commitPreparedQuestReport } from "./stores/quest";

export async function commitPreparedIngest(command: CoreCommand): Promise<unknown> {
  switch (command.source) {
    case "mac": return commitPreparedTelemetryEnvelope(command);
    case "iphone": return commitPreparedPhoneEnvelope(command);
    case "homepod": return commitPreparedHomePodEvent(command);
    case "emby": return commitPreparedEmbyReport(command);
    case "playstation": return commitPreparedPlaystationReport(command);
    case "quest": return commitPreparedQuestReport(command);
    case "agents": return commitPreparedAgentsReport(command);
    case "agents-otlp": return recordPreparedClaudeCloudUsage(command);
    default: throw new Error(`状态核心不收这个来源：${(command as { source?: unknown }).source}`);
  }
}
