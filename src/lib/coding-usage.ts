import { AwaitingReport } from "@/lib/awaiting-report";
import { encodeCodingYear } from "@/lib/coding-year";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { withStorage } from "@/lib/storage";
import type { CodingNowPayload, CodingUsagePayload, CodingYearPayload } from "@/lib/types";
import {
  codingActivityKey,
  codingViewKey,
  codingYearKey,
  parseStoredActivity,
  parseStoredView,
  parseStoredYear,
} from "@shared/coding-store";
import { CODING_USAGE_SOURCE_NAMES } from "@shared/coding-usage-sources";
import { buildCodingNowAgents } from "@shared/coding-usage-view";


export async function getCodingUsage(): Promise<CodingUsagePayload> {
  const raw = await withStorage((storage) => storage.get(codingViewKey()), null);
  const view = parseStoredView(raw);
  if (!view) throw new AwaitingReport("No coding usage report yet");
  return view;
}

export async function getCodingNow(): Promise<CodingNowPayload> {
  const [values, liveness] = await Promise.all([
    withStorage(async (storage) => {
      const batch = storage.batch();
      for (const source of CODING_USAGE_SOURCE_NAMES) batch.get(codingActivityKey(source));
      return batch.execute();
    }, [] as unknown[]),
    readLiveness(),
  ]);
  const activities = Object.fromEntries(CODING_USAGE_SOURCE_NAMES.map((source, index) => [source, parseStoredActivity(values[index])]));
  return withPresence({ agents: buildCodingNowAgents(activities) }, liveness);
}

export async function getCodingYear(): Promise<CodingYearPayload> {
  const year = parseStoredYear(await withStorage((storage) => storage.get(codingYearKey()), null));
  if (!year) throw new AwaitingReport("No coding usage report yet");
  return encodeCodingYear(year, Date.now());
}
