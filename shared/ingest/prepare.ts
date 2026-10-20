import { reporterBlockOf, type ReporterBlock } from "@shared/reporter-ledger";

import { prepareAgentLimits, type PreparedAgentLimits } from "./agents";
import { prepareAgentsOtlpUsage, type PreparedAgentsOtlpUsage } from "./agents-otlp";
import { prepareEmbyReport, type PreparedEmbyReport } from "./emby";
import { prepareHomePodEvent, type PreparedHomePodEvent } from "./homepod";
import { preparePhoneEnvelope, type PreparedPhoneEnvelope } from "./phone";
import { preparePlaystationReport, type PreparedPlaystationReport } from "./playstation";
import type { ImageBucket } from "./r2-assets";
import { prepareServerReport, type PreparedServerReport } from "./server";
import { prepareQuestReport, type PreparedQuestReport } from "./quest";
import { prepareTelemetryEnvelope, type PreparedTelemetryEnvelope } from "./telemetry";


type WithReporter<T> = T & { reporter?: ReporterBlock | null };

export type PreparedIngest = WithReporter<
  | PreparedTelemetryEnvelope
  | PreparedPhoneEnvelope
  | PreparedHomePodEvent
  | PreparedEmbyReport
  | PreparedPlaystationReport
  | PreparedServerReport
  | PreparedAgentLimits
  | PreparedAgentsOtlpUsage
  | PreparedQuestReport
>;

export type CoreCommand = Exclude<PreparedIngest, { source: "server" }>;

export const INGEST_SOURCES = new Set([
  "mac", "iphone", "homepod", "emby", "playstation", "server", "agents", "quest",
]);

const NO_IMAGES: ImageBucket = { head: async () => null };

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
    case "quest": return prepareQuestReport(raw, receivedAt);
    case "server": return { ...prepareServerReport(raw, receivedAt), reporter: reporterBlockOf(raw) };
    case "agents": return { ...prepareAgentLimits(raw, receivedAt), reporter: reporterBlockOf(raw) };
    case "agents-otlp":
    case "mac-otlp": return prepareAgentsOtlpUsage(raw, receivedAt, source);
    default: throw new Error("Unknown ingest source");
  }
}
