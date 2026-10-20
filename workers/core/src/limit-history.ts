import { siteDay } from "@shared/history-ingest";
import { LIMIT_HISTORY_DAYS, limitHistoryFromRows, type LimitHistoryPayload, type LimitSnapshotRow } from "@shared/limit-history";
import { currentContext } from "./runtime";

const DAY_MS = 86_400_000;

// 只读归档；本地与预览没有 HISTORY 绑定时回空序列，页面退回只按当前读数预测。
export async function getLimitHistory(now = Date.now()): Promise<LimitHistoryPayload> {
  const db = currentContext().env.HISTORY;
  if (!db) return { days: LIMIT_HISTORY_DAYS, series: [] };
  const since = siteDay(now - (LIMIT_HISTORY_DAYS - 1) * DAY_MS);
  const { results } = await db
    .prepare(`SELECT agent, limit_key, window_minutes, used_percent, resets_at, received_at
      FROM limit_snapshots WHERE date >= ? ORDER BY received_at`)
    .bind(since)
    .all<LimitSnapshotRow>();
  return limitHistoryFromRows(results);
}
