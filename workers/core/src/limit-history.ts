import { siteDay } from "@shared/history-ingest";
import {
  LIMIT_HISTORY_DAYS,
  LIMIT_HISTORY_HOURLY_DAYS,
  LIMIT_HISTORY_SERIES,
  limitHistoryFromRows,
  type LimitHistoryPayload,
  type LimitHistoryRow,
} from "@shared/limit-history";
import { currentContext } from "./runtime";

const DAY_MS = 86_400_000;

// 只读归档；本地与预览没有 HISTORY 绑定时回空序列，页面退回只按当前读数预测。
export async function getLimitHistory(now = Date.now()): Promise<LimitHistoryPayload> {
  const db = currentContext().env.HISTORY;
  if (!db) return limitHistoryFromRows([], []);
  const series = LIMIT_HISTORY_SERIES.map(() => "(agent = ? AND limit_key = ?)").join(" OR ");
  const keys = LIMIT_HISTORY_SERIES.flatMap(({ agent, key }) => [agent, key]);
  const [daily, hourly] = await db.batch<LimitHistoryRow>([
    db.prepare(`SELECT agent, limit_key, window_minutes, used_percent, resets_at, received_at
      FROM limit_snapshots WHERE date >= ? AND (${series})`)
      .bind(siteDay(now - (LIMIT_HISTORY_DAYS - 1) * DAY_MS), ...keys),
    db.prepare(`SELECT agent, limit_key, window_minutes, used_percent, resets_at, received_at
      FROM limit_hours WHERE hour_at >= ? AND (${series})`)
      .bind(now - LIMIT_HISTORY_HOURLY_DAYS * DAY_MS, ...keys),
  ]);
  return limitHistoryFromRows(daily?.results ?? [], hourly?.results ?? []);
}
