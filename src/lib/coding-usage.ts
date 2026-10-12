import { AwaitingReport } from "@/lib/awaiting-report";
import { encodeCodingYear } from "@/lib/coding-year";
import { readLiveness, withPresence } from "@shared/reporter-liveness";
import { getStorage } from "@shared/storage";
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
  const raw = await getStorage().get(codingViewKey());
  const view = parseStoredView(raw);
  if (!view) throw new AwaitingReport("尚未收到 coding 用量");
  return view;
}

export async function getCodingNow(): Promise<CodingNowPayload> {
  const batch = getStorage().batch();
  for (const source of CODING_USAGE_SOURCE_NAMES) batch.get(codingActivityKey(source));
  const [values, liveness] = await Promise.all([batch.execute(), readLiveness()]);
  const activities = Object.fromEntries(CODING_USAGE_SOURCE_NAMES.map((source, index) => [source, parseStoredActivity(values[index])]));
  return withPresence({ agents: buildCodingNowAgents(activities) }, liveness);
}

export async function getCodingYear(): Promise<CodingYearPayload> {
  const year = parseStoredYear(await getStorage().get(codingYearKey()));
  if (!year) throw new AwaitingReport("尚未收到 coding 用量");
  return encodeCodingYear(year, Date.now());
}
