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

/**
 * coding 用量的三条读出口（实时层）。视图、年度、活动都由状态核心在收到事实时算好存着
 * （workers/api/src/stores/coding-*），这里只读，外加两件和钟有关的事：年度窗口从哪天起
 * （lib/coding-year 的 encodeCodingYear）、此刻的 Mac 存活。灯亮不亮、那一天是不是今天由浏览器现算。
 */

/** `/api/status/coding`：多来源合并后的用量视图，原样给 */
export async function getCodingUsage(): Promise<CodingUsagePayload> {
  const raw = await withStorage((storage) => storage.get(codingViewKey()), null);
  const view = parseStoredView(raw);
  if (!view) throw new AwaitingReport("尚未收到 coding 用量");
  return view;
}

/**
 * `/api/status/coding/now`：各 agent 各来源最近一条用量事件，和 `coding-now` 推送同一个拼法
 * （shared/coding-usage-view 的 buildCodingNowAgents），外加 Mac 的存活。
 */
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

/** `/api/status/coding/year`：任一来源有日行就出图 */
export async function getCodingYear(): Promise<CodingYearPayload> {
  const year = parseStoredYear(await withStorage((storage) => storage.get(codingYearKey()), null));
  if (!year) throw new AwaitingReport("尚未收到 coding 用量");
  return encodeCodingYear(year, Date.now());
}
