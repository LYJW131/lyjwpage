import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import type { VercelDeployment } from "@/lib/vercel-deployments-types";

/**
 * 采集 Worker 往 D1 `lyjwpage-history` 写的站点部署表（workers/api/migrations/0006）。
 *
 * 奖杯表由 api 在收下奖杯信封后写（`workers/api/src/stores/trophy-history.ts`）。
 * 这里只拼语句、幂等 upsert，调用方在数据已经交出去之后顺手追加，失败只记日志。
 * 每分钟的部署列表都是同几条，所以 `WHERE` 只放行真的变了的行。
 */

/** 一次 batch 提交的语句数 */
export const HISTORY_BATCH_SIZE = 100;

export async function runBatched(db: HistoryDb, statements: HistoryStatement[], size = HISTORY_BATCH_SIZE): Promise<void> {
  for (let start = 0; start < statements.length; start += size) {
    await db.batch(statements.slice(start, start + size));
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
