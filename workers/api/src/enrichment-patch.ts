import { patchHomePodEnrichment } from "./homepod-ingest";
import type { EnrichmentPatch } from "./listening-enrichment";
import { patchMacEnrichment } from "./stores/telemetry";

// 曲目已换（trackKey 对不上）或按块合并后没有一块变好时丢弃，返回 false。
export function applyEnrichmentPatch({ target, enrichment, upcomingKey }: EnrichmentPatch): Promise<boolean> {
  return target === "mac" ? patchMacEnrichment(enrichment, upcomingKey) : patchHomePodEnrichment(enrichment);
}
