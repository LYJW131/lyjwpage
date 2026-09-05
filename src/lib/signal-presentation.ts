import type { ChargerSample } from "@/lib/types";

export type RecordSelection =
  | { kind: "live" }
  | { kind: "record"; id: string }
  | null;

/** A live selection follows track changes; archived records keep their identity. */
export function selectedRecordIndex(
  records: ReadonlyArray<{ key: string; track: unknown }>,
  selection: RecordSelection,
): number {
  if (!selection) return -1;
  if (selection.kind === "live") {
    const live = records.findIndex((record) => Boolean(record.track));
    // When playback stops, stay in detail on the most recent available record.
    return live >= 0 ? live : records.length ? 0 : -1;
  }
  return records.findIndex((record) => record.key === selection.id);
}

/** Preserve elapsed time between observations, including gaps in collection. */
export function powerTrace(samples: readonly ChargerSample[]): string {
  if (!samples.length) return "";
  const start = samples[0].t;
  const span = Math.max(1, samples[samples.length - 1].t - start);
  const maximum = Math.max(1, ...samples.map((sample) => sample.w));
  return samples
    .map(
      (sample) =>
        `${((sample.t - start) / span) * 480},${100 - (sample.w / maximum) * 90}`,
    )
    .join(" ");
}
