import { commitPreparedAgentsReport } from "./stores/agents";
import { recordPreparedClaudeCloudUsage } from "./stores/claude-cloud";
import { commitPreparedHomePodEvent } from "./homepod-ingest";
import { commitPreparedPhoneEnvelope } from "./phone-telemetry";
import { commitPreparedEmbyReport } from "./stores/emby";
import { commitPreparedPlaystationReport } from "./stores/playstation";
import { commitPreparedTelemetryEnvelope } from "./stores/telemetry";
import type { CoreCommand } from "@shared/ingest/prepare";

/**
 * StateHub 阶段：只做依赖权威最新状态的合并、差分与持久化。
 *
 * 命令在上报入口（workers/ingress）或采集 Worker 里 prepare 好（shared/ingest），经
 * `StateCore.commitIngest` 进来；这里只 import 它们的类型，不带任何校验代码。可滞后层
 * 那一半（落地节点、限额、账本、时区、圆环读数、训练列表）由上报入口直接写 KV，不进这里。
 */
export async function commitPreparedIngest(command: CoreCommand): Promise<unknown> {
  switch (command.source) {
    case "mac": return commitPreparedTelemetryEnvelope(command);
    case "iphone": return commitPreparedPhoneEnvelope(command);
    case "homepod": return commitPreparedHomePodEvent(command);
    case "emby": return commitPreparedEmbyReport(command);
    case "playstation": return commitPreparedPlaystationReport(command);
    case "agents": return commitPreparedAgentsReport(command);
    case "agents-otlp": return recordPreparedClaudeCloudUsage(command);
    default: throw new Error(`状态核心不收这个来源：${(command as { source?: unknown }).source}`);
  }
}
