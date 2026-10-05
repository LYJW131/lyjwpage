import { patchHomePodEnrichment } from "./homepod-ingest";
import type { EnrichmentPatch } from "./listening-enrichment";
import { patchMacEnrichment } from "./stores/telemetry";

// 曲目已换（trackKey 对不上）或已存的那份不比补写差时丢弃，返回 false。
export function applyEnrichmentPatch({ target, enrichment }: EnrichmentPatch): Promise<boolean> {
  return target === "mac" ? patchMacEnrichment(enrichment) : patchHomePodEnrichment(enrichment);
}
