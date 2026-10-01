import { encodeCodingYear } from "@/lib/coding-year";
import { loadLag, type LagResult } from "@/lib/lag-result";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { withStorage } from "@/lib/storage";
import type { CodingNowPayload, CodingUsagePayload, CodingYearPayload } from "@/lib/types";
import { codingActivityKey, parseStoredActivity } from "@shared/coding-store";
import { CODING_USAGE_SOURCE_NAMES } from "@shared/coding-usage-sources";
import { buildCodingNowAgents, type CodingUsageYearView } from "@shared/coding-usage-view";
import { LAG_KEYS } from "@shared/lag";


export function getCodingUsage(): Promise<LagResult<CodingUsagePayload>> {
  return loadLag<CodingUsagePayload>(LAG_KEYS.codingUsage, "尚未收到 coding 用量");
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

export async function getCodingYear(): Promise<LagResult<CodingYearPayload>> {
  return (await loadLag<CodingUsageYearView>(LAG_KEYS.codingYear, "尚未收到 coding 用量")).map((year) => encodeCodingYear(year, Date.now()));
}
