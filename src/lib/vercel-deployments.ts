import { cached, get, put } from "@/lib/cache";
import { getVercelMetrics } from "@/lib/vercel-metrics";
import { DEPLOYMENT_STATES, type DeploymentState, type VercelDeployment, type VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vercel 部署格式无效");
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** 明确投影公开字段，绝不透传 env、creator、meta 或平台错误详情。 */
export function parseVercelDeployment(raw: unknown): VercelDeployment {
  const row = record(raw);
  const createdAt = timestamp(row.createdAt ?? row.created);
  // v6 列表使用 uid；v13 详情使用 id。
  const id = row.id ?? row.uid;
  if (typeof id !== "string" || !id || !createdAt) throw new Error("Vercel 部署标识无效");
  const state = row.readyState ?? row.state;
  const buildingAt = timestamp(row.buildingAt);
  const ready = timestamp(row.ready);
  const meta = row.meta == null ? {} : record(row.meta);
  const sha = typeof meta.githubCommitSha === "string" && /^[a-f0-9]{40}$/i.test(meta.githubCommitSha) ? meta.githubCommitSha : null;
  return {
    id,
    state: DEPLOYMENT_STATES.includes(state as DeploymentState) ? state as DeploymentState : "UNKNOWN",
    createdAt,
    buildDurationMs: buildingAt && ready && ready >= buildingAt ? ready - buildingAt : null,
    target: row.target === "production" ? "production" : "preview",
    commit: sha ? {
      sha,
      branch: typeof meta.githubCommitRef === "string" ? meta.githubCommitRef.slice(0, 100) : null,
      message: typeof meta.githubCommitMessage === "string" ? meta.githubCommitMessage.split("\n")[0].slice(0, 180) : null,
    } : null,
  };
}

/** 只在 API Worker 调用；当前生产版本以项目 targets.production 为准，支持回滚。 */
export async function fetchVercelDeployments(project: string, team: string, token: string): Promise<VercelDeploymentsPayload> {
  const signal = AbortSignal.timeout(8_000);
  const request = async (path: string, params: Record<string, string> = {}) => {
    const url = new URL(path, "https://api.vercel.com");
    url.search = new URLSearchParams({ teamId: team, ...params }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "lyjwpage-deployment-status" }, signal });
    if (!response.ok) throw new Error(`Vercel 查询失败 (${response.status})`);
    return record(await response.json());
  };
  const [projectData, list] = await Promise.all([
    request(`/v9/projects/${encodeURIComponent(project)}`),
    request("/v6/deployments", { projectId: project, limit: "5" }),
  ]);
  if (!Array.isArray(list.deployments)) throw new Error("Vercel 部署列表缺失");
  const target = projectData.targets == null ? null : record(projectData.targets).production;
  const productionId = target == null ? null : record(target).id;
  if (target != null && (typeof productionId !== "string" || !productionId)) throw new Error("Vercel 生产版本无效");
  const production = productionId ? parseVercelDeployment(await request(`/v13/deployments/${encodeURIComponent(String(productionId))}`)) : null;
  return {
    fetchedAt: Date.now(),
    production,
    recent: list.deployments.map(parseVercelDeployment).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  };
}

export async function getVercelDeployments(): Promise<VercelDeploymentsPayload> {
  const token = process.env.VERCEL_TOKEN?.trim();
  const project = process.env.VERCEL_PROJECT_ID?.trim();
  const team = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !project || !team) throw new Error("Vercel 部署读取未配置");
  const key = `vercel-deployments:v1:${team}:${project}`;
  const [deployments, metrics] = await Promise.all([cached<VercelDeploymentsPayload>(key, 60_000, async () => {
    try {
      const data = await fetchVercelDeployments(project, team, token);
      await put(`${key}:last-good`, data, 86_400_000);
      return data;
    } catch (error) {
      console.warn("[vercel-deployments]", error instanceof Error && error.message.startsWith("Vercel ") ? error.message : "上游网络请求失败");
      const previous = await get<VercelDeploymentsPayload>(`${key}:last-good`);
      if (previous) return previous;
      throw new Error("Vercel 部署暂不可用");
    }
  }), getVercelMetrics(project, team, token)]);
  return { ...deployments, metrics };
}
