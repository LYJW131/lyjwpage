"use client";

import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color";
import Github from "@lobehub/icons/es/Github/components/Mono";
import Vercel from "@lobehub/icons/es/Vercel/components/Mono";
import NumberFlow from "@number-flow/react";
import { Card } from "@/components/ui/card";
import { colorForRank, RepoContributions } from "@/components/live/repo-contributions";
import { useStatus } from "@/hooks/use-status";
import { CLOUDFLARE_WORKERS, type CloudflareWorkersPayload } from "@/lib/cloudflare-workers-types";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { CLOUDFLARE_WORKERS_PATH, GITHUB_REPO_PATH, VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type { GithubRepoPayload, StatusResponse } from "@/lib/types";
import type { VercelDeployment, VercelDeploymentsPayload, VercelWebVitals } from "@/lib/vercel-deployments-types";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("zh-CN", { timeZone: site.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const cpu = (ms: number | null | undefined) => ms == null ? "—" : ms < 1 ? `${Math.round(ms * 1000)}µs` : `${Number(ms.toFixed(1))}ms`;

function CommitSha({ commit }: { commit: { sha: string; branch: string | null; message: string | null } | null | undefined }) {
  if (!commit) return null;
  return <a href={`${site.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer"
    title={commit.message ? `${commit.branch ?? "main"} · ${commit.message}` : commit.branch ?? undefined}
    className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline">{commit.sha.slice(0, 7)}</a>;
}

function Stat({ label, value, title, prefix }: { label: string; value?: number; title?: string; prefix?: string }) {
  return (
    <div title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">{value == null ? "—" : <>{prefix}<NumberFlow value={value} locales="en-US" /></>}</div>
    </div>
  );
}

const vitalRows: { label: string; key: keyof VercelWebVitals; unit: "s" | "ms" | "" }[] = [
  { label: "LCP", key: "lcpMs", unit: "s" }, { label: "INP", key: "inpMs", unit: "ms" },
  { label: "CLS", key: "cls", unit: "" }, { label: "FCP", key: "fcpMs", unit: "s" }, { label: "TTFB", key: "ttfbMs", unit: "s" },
];
function vital(value: number | null | undefined, unit: string) {
  if (value == null) return "—";
  return unit === "s" ? `${(value / 1000).toFixed(2)}s` : `${value}${unit}`;
}

export function SiteStatusCard({ githubFallback, vercelFallback, cloudflareFallback, recentCommits, className }: {
  githubFallback: StatusResponse<GithubRepoPayload>;
  vercelFallback: StatusResponse<VercelDeploymentsPayload>;
  cloudflareFallback: StatusResponse<CloudflareWorkersPayload>;
  recentCommits: GithubRecentCommit[];
  className?: string;
}) {
  const { data: github } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, 30 * 60_000, { fallback: githubFallback, revalidateOnMount: false, revalidateOnFocus: false });
  const { data: vercel } = useStatus<VercelDeploymentsPayload>(VERCEL_DEPLOYMENTS_PATH, 60_000, { fallback: vercelFallback });
  const { data: cloudflare } = useStatus<CloudflareWorkersPayload>(CLOUDFLARE_WORKERS_PATH, 300_000, { fallback: cloudflareFallback });
  const { speed, functions, analytics } = vercel?.metrics ?? {};
  const deploymentsBySha = new Map<string, { deployment: VercelDeployment; production: boolean }>();
  for (const deployment of [...vercel?.recent ?? [], ...vercel?.production ? [vercel.production] : []]) {
    const sha = deployment.commit?.sha;
    if (!sha) continue;
    const prev = deploymentsBySha.get(sha);
    if (!prev || deployment.createdAt > prev.deployment.createdAt) {
      deploymentsBySha.set(sha, { deployment, production: vercel?.production?.commit?.sha === sha });
    }
  }
  const contributors = github?.contributors ?? [];
  const contributorCommits = contributors.reduce((sum, person) => sum + person.commits, 0);
  return <Card id="site-status" label="LYJWPAGE" className={cn("scroll-mt-28", className)} action={
    <div className="flex items-center gap-4">
      <a href={site.repo} target="_blank" rel="noreferrer" aria-label="GitHub 仓库" className="hover:text-foreground"><Github size={15} /></a>
      <a href={site.vercel} target="_blank" rel="noreferrer" aria-label="Vercel 控制台" className="hover:text-foreground"><Vercel size={15} /></a>
      <a href={site.cloudflare} target="_blank" rel="noreferrer" aria-label="Cloudflare 控制台"><CloudflareColor size={19} /></a>
    </div>
  }>
    <div className="border-b border-line px-4 py-5 md:px-5">
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="VIEWS · 7D" value={analytics?.pageviews} title={analytics ? `${time.format(analytics.start)} — ${time.format(analytics.end)} · UTC+8` : undefined} />
        <Stat label="COMMITS" value={github?.totals.commits} />
        <Stat label="ADDITIONS" value={github?.totals.additions} prefix="+" title="Total lines added" />
        <Stat label="DELETIONS" value={github?.totals.deletions} prefix="−" title="Total lines removed" />
      </div>
      {contributorCommits > 0 && (
        <div className="mt-6 flex h-2 overflow-hidden bg-muted" role="img" aria-label={`按提交数分的贡献占比，共 ${number.format(contributorCommits)} 次提交`}>
          {contributors.map((person, index) => person.commits > 0 ? (
            <span key={person.login} title={`${person.login} · ${number.format(person.commits)} 次提交`} style={{ width: `${person.commits / contributorCommits * 100}%`, backgroundColor: colorForRank(index) }} />
          ) : null)}
        </div>
      )}
    </div>
    <RepoContributions data={github} recentCommits={recentCommits} deploymentsBySha={deploymentsBySha} />
    <div className="grid border-t border-line md:grid-cols-2">
      <section className="min-w-0 border-b border-line md:border-b-0" aria-label="体验评分">
        <div className="px-4 pt-3 pb-2">
          <div className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[9px] text-muted-foreground lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-[10px]">
            <span /><span title="Real Experience Score">RES</span>{vitalRows.map(row => <span key={row.key}>{row.label}</span>)}
          </div>
          {(["desktop", "mobile"] as const).map(device => {
            const score = speed?.[device].score;
            return <div key={device} className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs">
              <span className="text-left text-[11px] text-muted-foreground">{device === "desktop" ? "桌面" : "移动"}</span>
              <span className={cn("text-xl font-medium lg:text-2xl", score == null ? "text-muted-foreground" : score > 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 50 ? "text-amber-600" : "text-red-500")}>{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key}>{vital(speed?.[device][row.key], row.unit)}</span>)}
            </div>;
          })}
        </div>
      </section>
      <section id="cloudflare-workers" className="min-w-0 scroll-mt-28 md:border-l md:border-line" aria-label="服务运行">
        {/* 窄屏两列只剩 150px 左右，名字截断、数字拆行；单列到 sm 再回两列 */}
        <ul className="grid h-full auto-rows-fr grid-cols-1 gap-px bg-line sm:grid-cols-2">
          <li className="bg-surface px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] leading-4">
              <a href={`${site.vercel}/observability/vercel-functions`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline"><Vercel size={11} />Vercel</a>
              <CommitSha commit={vercel?.production?.commit} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap" title={functions ? `超时 ${functions.timeouts} 次 · 平均峰值内存 ${functions.memoryAvgMb == null ? "—" : `${Math.round(functions.memoryAvgMb)} MB`}` : undefined}>调用 <span className="text-foreground">{functions ? number.format(functions.invocations) : "—"}</span></span>
              <span className="whitespace-nowrap">CPU <span className="text-foreground">{cpu(functions?.cpuP75Ms)}</span> P75</span>
            </div>
          </li>
          {CLOUDFLARE_WORKERS.map(({ name }) => {
            const worker = cloudflare?.workers.find(w => w.name === name), metrics = worker?.metrics;
            return <li key={name} className="bg-surface px-4 py-2.5" title={worker?.deployment ? `部署于 ${time.format(worker.deployment.deployedAt)} · ${worker.deployment.versions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : name}>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
                <span className="flex shrink-0"><CloudflareColor size={14} /></span>
                <span className="min-w-0 truncate">{name}</span>
                <CommitSha commit={worker?.deployment?.commit} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                <span className="whitespace-nowrap" title={metrics ? `子请求 ${number.format(metrics.subrequests)}` : undefined}>调用 <span className="text-foreground">{metrics ? number.format(metrics.requests) : "—"}</span></span>
                <span className="whitespace-nowrap">CPU <span className="text-foreground">{cpu(metrics?.cpuTimeP50Ms)}</span> P50</span>
              </div>
            </li>;
          })}
        </ul>
      </section>
    </div>
  </Card>;
}
