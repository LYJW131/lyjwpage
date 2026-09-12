import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import type { VercelDeployment, VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";

export type SiteActivity = {
  key: string;
  sha: string | null;
  title: string;
  at: number;
  deployment: VercelDeployment | null;
  production: boolean;
};

/** 同一 SHA 只占一行；线上版本始终可见，重试构建取最近一次状态。 */
export function mergeSiteActivity(commits: GithubRecentCommit[], vercel: VercelDeploymentsPayload | undefined): SiteActivity[] {
  const rows = new Map<string, SiteActivity>();
  for (const commit of commits) rows.set(commit.sha, {
    key: commit.sha, sha: commit.sha, title: commit.title,
    at: Date.parse(commit.committedAt ?? "") || 0, deployment: null, production: false,
  });
  const deployments = [...vercel?.recent ?? [], ...vercel?.production ? [vercel.production] : []];
  for (const deployment of deployments) {
    const sha = deployment.commit?.sha ?? null, key = sha ?? deployment.id;
    const row = rows.get(key) ?? { key, sha, title: deployment.commit?.message ?? "手动部署", at: 0, deployment: null, production: false };
    row.at = Math.max(row.at, deployment.createdAt);
    if (!row.deployment || deployment.createdAt > row.deployment.createdAt) row.deployment = deployment;
    if (deployment.id === vercel?.production?.id) row.production = true;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => Number(b.production) - Number(a.production) || b.at - a.at).slice(0, 5);
}
