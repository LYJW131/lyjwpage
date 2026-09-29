import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import type { TrophiesPayload } from "@/lib/types";

/**
 * 奖杯目录进 D1 `lyjwpage-history` 的 `trophies` 表（workers/api/migrations/0006）。
 *
 * 收下奖杯信封的是状态核心，所以归档写在这里，不在容器里。只拼语句、幂等 upsert，
 * 调用方在信封已经收下之后顺手追加，失败只记日志。每封都是整份目录，`WHERE`
 * 只放行真的变了的行。
 */

/** 一次 batch 提交的语句数，大目录分几批提交 */
export const HISTORY_BATCH_SIZE = 100;

export async function runBatched(db: HistoryDb, statements: HistoryStatement[], size = HISTORY_BATCH_SIZE): Promise<void> {
  for (let start = 0; start < statements.length; start += size) {
    await db.batch(statements.slice(start, start + size));
  }
}

const UPSERT_TROPHY = `INSERT INTO trophies(np_communication_id, trophy_id, title_id, game_name, trophy_name, grade,
    earned_at, rarity_percent, platform, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(np_communication_id, trophy_id) DO UPDATE SET title_id = excluded.title_id,
    game_name = excluded.game_name, trophy_name = excluded.trophy_name, grade = excluded.grade,
    earned_at = excluded.earned_at, rarity_percent = excluded.rarity_percent, platform = excluded.platform,
    updated_at = excluded.updated_at
  WHERE trophies.title_id IS NOT excluded.title_id OR trophies.game_name IS NOT excluded.game_name
    OR trophies.trophy_name IS NOT excluded.trophy_name OR trophies.grade IS NOT excluded.grade
    OR trophies.earned_at IS NOT excluded.earned_at OR trophies.rarity_percent IS NOT excluded.rarity_percent
    OR trophies.platform IS NOT excluded.platform`;

/**
 * 每个已获得的奖杯一行。游戏名取本地化名（和卡片上一致），titleId 取这份奖杯目录
 * 对上的第一个 SKU（PPSA… / CUSA…），对不上就空着。稀有度会随全网玩家变动，
 * 变了就改写这一行。上游偶尔不给获得时刻，那一行的 earned_at 为空，给了再补上。
 */
export function trophyStatements(db: HistoryDb, report: TrophiesPayload): HistoryStatement[] {
  return report.titles.flatMap((title) => title.trophies
    .filter((trophy) => trophy.earned)
    .map((trophy) => db.prepare(UPSERT_TROPHY).bind(
      title.npCommunicationId,
      trophy.id,
      title.titleIds[0] ?? null,
      title.localizedName ?? title.name,
      trophy.name,
      trophy.type,
      trophy.earnedAt,
      trophy.earnedRate,
      title.platform,
      report.observedAt,
    )));
}

export async function archiveTrophies(db: HistoryDb, report: TrophiesPayload): Promise<void> {
  try {
    await runBatched(db, trophyStatements(db, report));
  } catch (error) {
    console.error("[history]", "trophies", error instanceof Error ? error.message : String(error));
  }
}
