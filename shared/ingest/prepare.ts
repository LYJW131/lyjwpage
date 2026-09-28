import { reporterBlockOf, type ReporterBlock } from "@/lib/reporter-ledger";

import { prepareAgentLimits, type PreparedAgentLimits } from "./agents";
import { prepareClaudeCloudUsage, type PreparedClaudeCloudUsage } from "./claude-cloud";
import { prepareEmbyReport, type PreparedEmbyReport } from "./emby";
import { prepareHomePodEvent, type PreparedHomePodEvent } from "./homepod";
import { preparePhoneEnvelope, type PreparedPhoneEnvelope } from "./phone";
import { preparePlaystationReport, type PreparedPlaystationReport } from "./playstation";
import type { ImageBucket } from "./r2-assets";
import { prepareServerReport, type PreparedServerReport } from "./server";
import { prepareTelemetryEnvelope, type PreparedTelemetryEnvelope } from "./telemetry";

/**
 * 上报的 prepare 阶段：输入收敛、逐字段校验（Emby 的 R2 HEAD 也在这里）。
 *
 * 跑在上报入口（workers/ingress）；采集 Worker 自己组的 PlayStation 信封也在它那边
 * 过这一道。产物是一份可以结构化复制的命令：实时那一半经 Service Binding 交给状态核心的
 * `StateCore.commitIngest`（workers/api，契约见 shared/state-core.ts），可滞后层、归档和
 * 凭据那几份由上报入口自己写。这里不碰任何存储、不读请求作用域，状态核心也不再 import
 * 这里的实现，只 import 类型 —— 改校验只需要发布上报入口，不动 Durable Object 那个 Worker。
 */

/** 常驻上报器（server、agents）的报文顶上带一个 `reporter` 块，上报入口收下后写进可滞后层（lag-ingest） */
type WithReporter<T> = T & { reporter?: ReporterBlock | null };

export type PreparedIngest = WithReporter<
  | PreparedTelemetryEnvelope
  | PreparedPhoneEnvelope
  | PreparedHomePodEvent
  | PreparedEmbyReport
  | PreparedPlaystationReport
  | PreparedServerReport
  | PreparedAgentLimits
  | PreparedClaudeCloudUsage
>;

/** 交给状态核心提交的那几种：落地节点（server）整封在可滞后层，不经过状态核心 */
export type CoreCommand = Exclude<PreparedIngest, { source: "server" }>;

export const INGEST_SOURCES = new Set([
  "mac", "iphone", "homepod", "emby", "playstation", "server", "agents",
]);

/** 没给桶就什么图都确认不了，和 R2 HEAD 失败时一样当「还没到」 */
const NO_IMAGES: ImageBucket = { head: async () => null };

/**
 * 按来源收敛一封上报。`images` 是上报器直传图片的那个桶（上报入口的 `env.IMAGES`），
 * 只有 emby 用得着。
 */
export async function prepareIngest(
  source: string,
  raw: unknown,
  receivedAt = Date.now(),
  images: ImageBucket = NO_IMAGES,
): Promise<PreparedIngest> {
  switch (source) {
    case "mac": return prepareTelemetryEnvelope(raw, receivedAt);
    case "iphone": return preparePhoneEnvelope(raw, receivedAt);
    case "homepod": return prepareHomePodEvent(raw, receivedAt);
    case "emby": return prepareEmbyReport(raw, receivedAt, images);
    case "playstation": return preparePlaystationReport(raw, receivedAt);
    case "server": return { ...prepareServerReport(raw, receivedAt), reporter: reporterBlockOf(raw) };
    case "agents": return { ...prepareAgentLimits(raw, receivedAt), reporter: reporterBlockOf(raw) };
    // Claude Code 云端线程的 OTLP 指标，走 /api/ingest/agents/otlp 与独立的 Access 权限，不在 INGEST_SOURCES 里
    case "agents-otlp": return prepareClaudeCloudUsage(raw, receivedAt);
    default: throw new Error("Unknown ingest source");
  }
}

/**
 * Valid reports proceed directly to commitIngest, which owns the authoritative
 * readiness check. Invalid reports probe readiness only to preserve the existing
 * uninitialized 503 priority over module-validation errors.
 */
export async function prepareIngestForCommit(
  source: string,
  raw: unknown,
  ready: () => Promise<boolean>,
  images?: ImageBucket,
): Promise<PreparedIngest | null> {
  try {
    return await prepareIngest(source, raw, Date.now(), images);
  } catch (error) {
    if (!(await ready())) return null;
    throw error;
  }
}
