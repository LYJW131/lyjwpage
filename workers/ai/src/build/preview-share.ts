import type { BuildRun } from "@shared/build-routine";

import type { Env } from "../runtime";

const VERCEL_API = "https://api.vercel.com";
// 访客构建的预览公开七天：够访客看效果、站主审 PR；过期后 Preview 回到需要登录 Vercel 的部署页。
export const PREVIEW_SHARE_TTL_S = 7 * 24 * 60 * 60;

export function vercelDeploymentId(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "vercel.com") return null;
    const id = parsed.pathname.split("/").filter(Boolean).at(-1);
    return id && /^[A-Za-z0-9]{16,64}$/.test(id) ? `dpl_${id}` : null;
  } catch { return null; }
}

async function createShare(env: Env, deploymentId: string, branch: string, fetcher: typeof fetch): Promise<NonNullable<BuildRun["previewShare"]>> {
  const team = `teamId=${encodeURIComponent(env.VERCEL_TEAM_ID!)}`;
  const headers = { Authorization: `Bearer ${env.VERCEL_TOKEN}`, "Content-Type": "application/json" };
  const deployment = await fetcher(`${VERCEL_API}/v13/deployments/${deploymentId}?${team}`, { headers });
  if (!deployment.ok) throw new Error(`Vercel deployment lookup returned ${deployment.status}.`);
  const { url, meta } = await deployment.json() as { url?: string; meta?: { githubCommitRef?: string } };
  // 只公开这个构建分支自己的部署；站点其他分支的预览照旧要登录。
  if (meta?.githubCommitRef !== branch || !url) throw new Error("The Vercel deployment does not belong to this build branch.");
  const response = await fetcher(`${VERCEL_API}/aliases/${deploymentId}/protection-bypass?${team}`, { method: "PATCH", headers, body: JSON.stringify({ ttl: PREVIEW_SHARE_TTL_S }) });
  if (!response.ok) throw new Error(`Vercel shareable link returned ${response.status}.`);
  const { protectionBypass } = await response.json() as { protectionBypass?: Record<string, { scope?: string; createdAt?: number; expires?: number }> };
  const [secret, link] = Object.entries(protectionBypass ?? {})
    .filter(([, entry]) => entry.scope === "shareable-link")
    .sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? [];
  if (!secret || !link?.expires) throw new Error("Vercel did not return a shareable link.");
  return { deploymentId, url: `https://${url}/?_vercel_share=${encodeURIComponent(secret)}`, expiresAt: link.expires * 1000 };
}

export async function withPreviewShare(env: Env, previous: BuildRun, patch: Partial<BuildRun>, fetcher: typeof fetch = fetch): Promise<Partial<BuildRun>> {
  if (!env.VERCEL_TOKEN || !env.VERCEL_TEAM_ID || patch.preview?.state !== "success") return patch;
  const deploymentId = vercelDeploymentId(patch.preview.url);
  if (!deploymentId) return patch;
  const kept = previous.previewShare;
  const share = kept?.deploymentId === deploymentId && kept.expiresAt > Date.now()
    ? kept
    : await createShare(env, deploymentId, previous.branch, fetcher).catch((error: unknown) => {
      console.error("[build] preview share failed", error instanceof Error ? error.message : "unknown");
      return null;
    });
  return share ? { ...patch, preview: { ...patch.preview, url: share.url }, previewShare: share } : patch;
}
