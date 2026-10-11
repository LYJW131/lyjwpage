import { AwaitingReport } from "@/lib/awaiting-report";
import { parseBuildCommit } from "@/lib/cloudflare-workers";
import { LagResult } from "@/lib/lag-result";
import { readLagEntry } from "@/lib/lag-store";
import type { SiteAnalyticsPayload } from "@/lib/site-analytics";
import {
  type PageSpeedPayload,
  type SiteDeployment,
  type SiteDeploymentSnapshot,
  type SiteDeploymentsPayload,
} from "@/lib/site-deployments-types";
import { LAG_KEYS } from "@shared/lag";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Site deployment response is invalid");
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function result(raw: unknown): unknown {
  const body = record(raw);
  if (body.success !== true) throw new Error("Site deployment query failed");
  return body.result;
}

export function parseSiteBuild(raw: unknown): SiteDeployment {
  const row = record(raw);
  const createdAt = timestamp(row.created_on);
  if (typeof row.build_uuid !== "string" || !row.build_uuid || createdAt === null) {
    throw new Error("Site build identity is invalid");
  }
  const state = row.status === "queued" ? "QUEUED"
    : row.status === "initializing" ? "INITIALIZING"
      : row.status === "running" ? "BUILDING"
        : row.status === "stopped" && row.build_outcome === "success" ? "READY"
          : row.status === "stopped" && ["cancelled", "terminated", "skipped"].includes(String(row.build_outcome)) ? "CANCELED"
            : row.status === "stopped" && row.build_outcome === "fail" ? "ERROR" : "UNKNOWN";
  const meta = row.build_trigger_metadata == null ? {} : record(row.build_trigger_metadata);
  const started = timestamp(row.running_on);
  const stopped = timestamp(row.stopped_on);
  return {
    id: `cloudflare-build:${row.build_uuid}`,
    state,
    createdAt,
    buildDurationMs: started !== null && stopped !== null && stopped >= started ? stopped - started : null,
    target: meta.branch === "main" ? "production" : "preview",
    commit: parseBuildCommit(meta),
  };
}

export function parseActiveSiteDeployment(raw: unknown): {
  createdAt: number;
  versions: { id: string; percentage: number }[];
} | null {
  const deployments = record(result(raw)).deployments;
  if (!Array.isArray(deployments)) throw new Error("Site deployment list is invalid");
  if (!deployments.length) return null;
  const active = record(deployments[0]);
  const createdAt = timestamp(active.created_on);
  if (createdAt === null || !Array.isArray(active.versions)) {
    throw new Error("Active site deployment is invalid");
  }
  const versions = active.versions.map((value) => {
    const version = record(value);
    if (typeof version.version_id !== "string" || !version.version_id ||
        typeof version.percentage !== "number" || !Number.isFinite(version.percentage) ||
        version.percentage < 0 || version.percentage > 100) {
      throw new Error("Active site version is invalid");
    }
    return { id: version.version_id, percentage: version.percentage };
  }).filter((version) => version.percentage > 0);
  if (!versions.length || new Set(versions.map((version) => version.id)).size !== versions.length ||
      Math.abs(versions.reduce((sum, version) => sum + version.percentage, 0) - 100) > 0.000001) {
    throw new Error("Active site traffic allocation is invalid");
  }
  return { createdAt, versions };
}

export async function fetchSiteDeployments(
  account: string,
  scriptTag: string,
  token: string,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<SiteDeploymentSnapshot> {
  if (!/^[a-f0-9]{32}$/i.test(scriptTag)) throw new Error("Site Worker tag is invalid");
  const signal = AbortSignal.timeout(15_000);
  const request = async (path: string): Promise<unknown> => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "lyjwpage-site-status" },
      signal,
    });
    if (!response.ok) throw new Error(`Site deployment query failed (${response.status})`);
    return response.json();
  };
  const [deploymentRaw, buildsRaw] = await Promise.all([
    request("/workers/scripts/site/deployments"),
    request(`/builds/workers/${encodeURIComponent(scriptTag)}/builds?page=1&per_page=5`),
  ]);
  const active = parseActiveSiteDeployment(deploymentRaw);
  const builds = result(buildsRaw);
  if (!Array.isArray(builds)) throw new Error("Site build list is invalid");
  const recent = builds.map(parseSiteBuild).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  let production: SiteDeployment | null = null;
  if (active?.versions.length === 1 && active.versions[0].percentage === 100) {
    const version = active.versions[0];
    const lookup = record(result(await request(`/builds/builds?version_ids=${encodeURIComponent(version.id)}`)));
    const byVersion = record(lookup.builds);
    const build = byVersion[version.id] == null ? null : parseSiteBuild(byVersion[version.id]);
    production = build
      ? { ...build, state: "READY", target: "production" }
      : {
          id: `cloudflare-version:${version.id}`,
          state: "READY",
          createdAt: active.createdAt,
          buildDurationMs: null,
          target: "production",
          commit: null,
        };
  }
  return { fetchedAt: now, production, recent, activeVersions: active?.versions ?? [] };
}

export async function getSiteDeployments(): Promise<LagResult<SiteDeploymentsPayload>> {
  const [deployments, analytics, pagespeed] = await Promise.all([
    readLagEntry<SiteDeploymentSnapshot>(LAG_KEYS.siteDeployments),
    readLagEntry<SiteAnalyticsPayload>(LAG_KEYS.siteAnalytics),
    readLagEntry<PageSpeedPayload>(LAG_KEYS.pagespeed),
  ]);
  if (!deployments) throw new AwaitingReport("Waiting for the first deployment check");
  return new LagResult(
    { ...deployments.data, analytics: analytics?.data ?? null, pagespeed: pagespeed?.data ?? null },
    deployments.updatedAt,
  );
}
