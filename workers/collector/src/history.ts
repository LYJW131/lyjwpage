import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import type { VercelDeployment } from "@/lib/vercel-deployments-types";

import type { TrophiesReport } from "./playstation/trophies";

/**
 * 采集 Worker 往 D1 `lyjwpage-history` 追加的两张表（workers/api/migrations/0006）。
 *
 * 和上报侧的归档同一套写法：只拼语句、幂等 upsert，调用方在数据已经交出去之后
 * 顺手追加，失败只记日志。两张表都是「整份反复出现」的数据 —— 每封奖杯信都是整份
 * 目录、每分钟的部署列表都是同几条 —— 所以 `WHERE` 只放行真的变了的行，没变的
 * 不产生 D1 写入。
 */

/** D1 一次 batch 的语句数上限取 100，大目录分几批提交 */
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
export function trophyStatements(db: HistoryDb, report: TrophiesReport): HistoryStatement[] {
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

export async function archiveTrophies(db: HistoryDb, report: TrophiesReport): Promise<void> {
  try {
    await runBatched(db, trophyStatements(db, report));
  } catch (error) {
    console.error("[history]", "trophies", error instanceof Error ? error.message : String(error));
  }
}

const UPSERT_SITE_DEPLOY = `INSERT INTO site_deploys(id, created_at, build_duration_ms, state, target, commit_sha,
    commit_branch, commit_message, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, build_duration_ms = excluded.build_duration_ms,
    state = excluded.state, target = excluded.target, commit_sha = excluded.commit_sha,
    commit_branch = excluded.commit_branch, commit_message = excluded.commit_message, updated_at = excluded.updated_at
  WHERE site_deploys.created_at IS NOT excluded.created_at
    OR site_deploys.build_duration_ms IS NOT excluded.build_duration_ms OR site_deploys.state IS NOT excluded.state
    OR site_deploys.target IS NOT excluded.target OR site_deploys.commit_sha IS NOT excluded.commit_sha
    OR site_deploys.commit_branch IS NOT excluded.commit_branch
    OR site_deploys.commit_message IS NOT excluded.commit_message`;

/** 当前生产版本和最近几次部署，按 id 去重；构建中 → 就绪这类状态变化会改写同一行 */
export function siteDeployStatements(db: HistoryDb, deployments: readonly (VercelDeployment | null)[], observedAt: number): HistoryStatement[] {
  const byId = new Map<string, VercelDeployment>();
  for (const deployment of deployments) if (deployment) byId.set(deployment.id, deployment);
  return [...byId.values()].map((deployment) => db.prepare(UPSERT_SITE_DEPLOY).bind(
    deployment.id,
    deployment.createdAt,
    deployment.buildDurationMs,
    deployment.state,
    deployment.target,
    deployment.commit?.sha ?? null,
    deployment.commit?.branch ?? null,
    deployment.commit?.message ?? null,
    observedAt,
  ));
}

export async function archiveSiteDeploys(db: HistoryDb, deployments: readonly (VercelDeployment | null)[], observedAt: number): Promise<void> {
  try {
    await runBatched(db, siteDeployStatements(db, deployments, observedAt));
  } catch (error) {
    console.error("[history]", "site_deploys", error instanceof Error ? error.message : String(error));
  }
}
