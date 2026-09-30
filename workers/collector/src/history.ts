import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import type { VercelDeployment } from "@/lib/vercel-deployments-types";


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
