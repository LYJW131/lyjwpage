"use client";

import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color";
import Github from "@lobehub/icons/es/Github/components/Mono";
import NumberFlow from "@/components/ui/number-flow";
import { Card } from "@/components/ui/card";
import { FlowDash } from "@/components/ui/flow-dash";
import { colorForContributor, CONTRIBUTOR_LIMIT, RepoContributions } from "@/components/live/repo-contributions";
import { formatUptime } from "@/components/live/server-card";
import { UptimeStrip } from "@/components/live/uptime-strip";
import { useStale } from "@/hooks/use-stale";
import { fieldPerformanceScore } from "@/lib/field-score";
import {
  AGENT_LIMITS_STALE_MS,
  CLOUDFLARE_DEPLOYMENTS_STALE_MS,
  CLOUDFLARE_METRICS_STALE_MS,
  GITHUB_REPO_STALE_MS,
  PAGESPEED_STALE_MS,
  HEALTH_STALE_MS,
  SERVER_STALE_MS,
  SITE_ANALYTICS_STALE_MS,
  SITE_DEPLOYMENTS_STALE_MS,
} from "@shared/freshness";
import type { ReportersPayload } from "@shared/reporter-ledger";
import { useStatus } from "@/hooks/use-status";
import { CollectionWindow, CommitSha, ErrBadge, number, ReporterTile, time } from "@/components/live/site-status-parts";
import { CLOUDFLARE_WORKERS, type CloudflareWorkersPayload } from "@shared/cloudflare-workers-types";
import { CLOUDFLARE_WORKERS_PATH, GITHUB_REPO_PATH, REPORTERS_PATH, HEALTH_PATH, SERVER_PATH, SITE_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { ErrorSeries, HealthBlock, HealthPayload } from "@shared/health-types";
import { CLOUDFLARE_DASH_URL, site } from "@shared/site";
import type { GithubRepoPayload, ServerPayload, StatusResponse } from "@shared/types";
import type { LighthouseVitals, SiteDeployment, SiteDeploymentsPayload } from "@shared/site-deployments-types";
import { cn } from "@/lib/utils";

const cpu = (ms: number | null | undefined) => ms == null ? "—" : ms < 1 ? `${Math.round(ms * 1000)}µs` : ms < 10 ? `${Number(ms.toFixed(1))}ms` : `${Math.round(ms)}ms`;

function Stat({ label, value, title, prefix }: { label: string; value?: number | null; title?: string; prefix?: string }) {
  return (
    <div title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-2 whitespace-nowrap text-2xl font-medium tracking-tight min-[400px]:text-3xl lg:text-4xl">{value == null ? <FlowDash /> : <>{prefix}<NumberFlow value={value} locales="en-US" /></>}</div>
    </div>
  );
}

const vitalRows: { label: string; key: Exclude<keyof LighthouseVitals, "score">; unit: "s" | "ms" | ""; title: string; labTitle?: string; fieldTitle?: string }[] = [
  { label: "LCP", key: "lcpMs", unit: "s", title: "Largest Contentful Paint" },
  { label: "RESP", key: "tbtMs", unit: "ms", title: "Responsiveness: Total Blocking Time in lab runs, Interaction to Next Paint for real users", labTitle: "Total Blocking Time · Lighthouse lab run", fieldTitle: "Interaction to Next Paint · p75 of real visitors" },
  { label: "CLS", key: "cls", unit: "", title: "Cumulative Layout Shift" },
  { label: "FCP", key: "fcpMs", unit: "s", title: "First Contentful Paint" },
  { label: "TTFB", key: "ttfbMs", unit: "ms", title: "Time to First Byte: server response of the root document" },
];
function vital(value: number | null | undefined, unit: string) {
  if (value == null) return "—";
  return unit === "s" ? `${(value / 1000).toFixed(2)}s` : unit === "ms" ? `${Math.round(value)}ms` : String(Number(value.toFixed(3)));
}

const scoreTone = (score: number | null | undefined) =>
  score == null ? "text-muted-foreground" : score >= 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 50 ? "text-amber-600" : "text-red-500";

const fieldValues = (vitals: HealthPayload["vitals"]) => ({
  lcpMs: vitals?.lcpP75Ms, tbtMs: vitals?.inpP75Ms, cls: vitals?.clsP75, fcpMs: vitals?.fcpP75Ms, ttfbMs: vitals?.ttfbP75Ms,
});

function ErrorCount({ series, title }: { series: ErrorSeries | undefined; title: string }) {
  if (!series) return null;
  return <ErrBadge count={series.count12h} title={`${title} · ${number.format(series.count7d)} in 7d · ${number.format(series.unresolved)} active ${series.unresolved === 1 ? "issue" : "issues"} · Workers Observability, sampled`} />;
}

export function SiteStatusCard({ githubFallback, siteFallback, cloudflareFallback, healthFallback, serverFallback, reportersFallback, className }: {
  githubFallback: StatusResponse<GithubRepoPayload>;
  siteFallback: StatusResponse<SiteDeploymentsPayload>;
  cloudflareFallback: StatusResponse<CloudflareWorkersPayload>;
  healthFallback: StatusResponse<HealthPayload>;
  serverFallback: StatusResponse<ServerPayload>;
  reportersFallback: StatusResponse<ReportersPayload>;
  className?: string;
}) {
  const { data: github, servedAt: githubServedAt } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, { fallback: githubFallback });
  const { data: siteDeployments, servedAt: siteServedAt } = useStatus<SiteDeploymentsPayload>(SITE_DEPLOYMENTS_PATH, { fallback: siteFallback });
  const { data: cloudflare, servedAt: cloudflareServedAt } = useStatus<CloudflareWorkersPayload>(CLOUDFLARE_WORKERS_PATH, { fallback: cloudflareFallback });
  const { data: health, servedAt: healthServedAt } = useStatus<HealthPayload>(HEALTH_PATH, { fallback: healthFallback });
  const githubStale = useStale(github ? github.totalsAt ?? github.fetchedAt : undefined, GITHUB_REPO_STALE_MS, githubServedAt);
  const deploymentsStale = useStale(siteDeployments?.fetchedAt, SITE_DEPLOYMENTS_STALE_MS, siteServedAt);
  const analyticsStale = useStale(siteDeployments?.analytics?.fetchedAt, SITE_ANALYTICS_STALE_MS, siteServedAt);
  const pagespeedStale = useStale(siteDeployments?.pagespeed?.fetchedAt, PAGESPEED_STALE_MS, siteServedAt);
  const workerMetricsStale = useStale(cloudflare?.fetchedAt, CLOUDFLARE_METRICS_STALE_MS, cloudflareServedAt);
  const workerDeploymentsStale = useStale(cloudflare?.deploymentsFetchedAt, CLOUDFLARE_DEPLOYMENTS_STALE_MS, cloudflareServedAt);
  const healthAt = (block: HealthBlock) => health ? health.blockAt?.[block] ?? health.fetchedAt : undefined;
  const uptimeStale = useStale(healthAt("uptime"), HEALTH_STALE_MS, healthServedAt);
  const heartbeatStale = useStale(healthAt("heartbeat"), HEALTH_STALE_MS, healthServedAt);
  const errorsStale = useStale(healthAt("errors"), HEALTH_STALE_MS, healthServedAt);
  const vitalsStale = useStale(healthAt("vitals"), HEALTH_STALE_MS, healthServedAt);
  const analytics = analyticsStale ? null : siteDeployments?.analytics;
  const totals = githubStale ? null : github?.totals;
  const production = deploymentsStale ? null : siteDeployments?.production;
  const siteErrors = errorsStale ? undefined : health?.errors?.site, coreErrors = errorsStale ? undefined : health?.errors?.worker;
  const siteWorker = cloudflare?.workers.find(w => w.name === "site");
  const siteMetrics = workerMetricsStale ? null : siteWorker?.metrics;
  const { data: server } = useStatus<ServerPayload>(SERVER_PATH, { fallback: serverFallback });
  const { data: reporters, servedAt: reportersServedAt } = useStatus<ReportersPayload>(REPORTERS_PATH, { fallback: reportersFallback });
  const pagespeed = pagespeedStale ? null : siteDeployments?.pagespeed;
  const deploymentsBySha = new Map<string, { deployment: SiteDeployment; production: boolean }>();
  for (const deployment of [...siteDeployments?.recent ?? [], ...siteDeployments?.production ? [siteDeployments.production] : []]) {
    const sha = deployment.commit?.sha;
    if (!sha) continue;
    const prev = deploymentsBySha.get(sha);
    if (!prev || deployment.createdAt > prev.deployment.createdAt) {
      deploymentsBySha.set(sha, { deployment, production: !deploymentsStale && siteDeployments?.production?.commit?.sha === sha });
    }
  }
  const contributors = github?.contributors ?? [];
  // GitHub 协作者各计一次贡献，参与次数之和不能替代去重提交总数。
  const contributionShare = contributors.reduce((sum, person) => sum + person.commits, 0);
  const otherCommits = contributors.slice(CONTRIBUTOR_LIMIT).reduce((sum, person) => sum + person.commits, 0);
  return <Card id="site-status" label="LYJWPAGE" className={cn("scroll-mt-28", className)} action={
    <div className="flex items-center gap-4">
      <a href={site.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository" className="-m-2 flex p-2 hover:text-foreground"><Github size={15} /></a>
      <a href={site.cloudflare} target="_blank" rel="noreferrer" aria-label="Cloudflare dashboard" className="-m-2 flex p-2"><CloudflareColor size={19} /></a>
    </div>
  }>
    <div className="border-b border-line px-4 py-5 lg:px-5">
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="VIEWS · 7D" value={analytics?.pageviews} title={analytics ? `Cloudflare Web Analytics pageviews · last 7 × 24h · ${time.format(analytics.start)} — ${time.format(analytics.end)} · UTC+8` : analyticsStale ? "Unavailable" : undefined} />
        <Stat label="COMMITS" value={totals?.commits} title={githubStale ? "Unavailable" : "Commits on the default branch"} />
        <Stat label="ADDITIONS" value={totals?.additions} prefix="+" title={githubStale ? "Unavailable" : "Total lines added"} />
        <Stat label="DELETIONS" value={totals?.deletions} prefix="−" title={githubStale ? "Unavailable" : "Total lines removed"} />
      </div>
      {contributionShare > 0 && (
        <div className="mt-6 flex h-2 overflow-hidden bg-muted" role="img" aria-label="Contribution share by commits">
          {contributors.slice(0, CONTRIBUTOR_LIMIT).map((person, index) => person.commits > 0 ? (
            <span key={person.login} title={`${person.login} · ${number.format(person.commits)} commits`} style={{ width: `${person.commits / contributionShare * 100}%`, backgroundColor: colorForContributor(person.login, index) }} />
          ) : null)}
          {otherCommits > 0 && <span title={`Others · ${number.format(otherCommits)} commits`} className="bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_2px,transparent_2px_4px)]" style={{ width: `${otherCommits / contributionShare * 100}%` }} />}
        </div>
      )}
    </div>
    <RepoContributions data={github} deploymentsBySha={deploymentsBySha} />
    {health && <UptimeStrip site={health.uptime} core={health.heartbeat ?? null} siteStale={uptimeStale} coreStale={heartbeatStale} />}
    <div className="grid border-t border-line lg:grid-cols-2">
      <section className="min-w-0 border-b border-line lg:border-b-0" aria-label="Performance">
        <div className="px-4 pt-3 pb-2 lg:px-5">
          <div className="grid grid-cols-[48px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-2xs text-muted-foreground lg:grid-cols-[88px_repeat(6,minmax(0,1fr))]">
            <span />
            <span title={`Lighthouse performance score, lab run on a simulated device${pagespeed ? `\nPageSpeed Insights on ${pagespeed.url}\nMedian of ${pagespeed.samples} runs · ${time.format(pagespeed.start)} — ${time.format(pagespeed.fetchedAt)} · UTC+8` : pagespeedStale ? "\nUnavailable" : ""}`}>PERF</span>{vitalRows.map(row => <span key={row.key} title={row.title}>{row.label}</span>)}
          </div>
          {(["desktop", "mobile"] as const).map(device => {
            const score = pagespeed?.[device].score;
            return <div key={device} className="grid h-11 grid-cols-[48px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-2xs tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs">
              <span className="text-left text-2xs text-muted-foreground">{device === "desktop" ? "Desktop" : "Mobile"}</span>
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}>{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key} title={row.labTitle}>{vital(pagespeed?.[device][row.key], row.unit)}</span>)}
            </div>;
          })}
          {health?.vitals && (() => {
            const vitals = vitalsStale ? null : health.vitals;
            const field = fieldValues(vitals), samples = vitals?.samples, score = vitals ? fieldPerformanceScore(vitals) : null;
            return <div className="grid h-11 grid-cols-[48px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-2xs tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs"
              title={vitalsStale ? "Real visitors via Cloudflare Web Analytics · unavailable" : samples ? `Real visitors via Cloudflare Web Analytics · p75 of ${number.format(samples)} Web Vitals reports, last 7 days` : "Real visitors via Cloudflare Web Analytics · no reports yet"}>
              <span className="text-left text-2xs text-muted-foreground">Users</span>
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}
                title="Web Vitals score of real visitors: LCP 30%, INP 30%, CLS 15%, FCP 15%, TTFB 10%, from 7-day p75">{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key} title={row.fieldTitle}>{vital(field[row.key], row.unit)}</span>)}
            </div>;
          })()}
        </div>
      </section>
      <section id="cloudflare-workers" className="min-w-0 scroll-mt-28 lg:border-l lg:border-line" aria-label="Services">
        <ul className="grid h-full auto-rows-fr grid-cols-1 gap-px bg-line sm:grid-cols-2">
          <li className="bg-surface px-4 py-2.5 lg:px-5" title={siteDeployments?.activeVersions.length ? `Serving ${siteDeployments.activeVersions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : undefined}>
            <div className="flex items-center gap-1.5 text-2xs leading-4">
              <a href={`${CLOUDFLARE_DASH_URL}/workers/services/view/site/production`} target="_blank" rel="noreferrer" className="relative flex items-center gap-1.5 before:absolute before:inset-x-0 before:-inset-y-1 hover:underline"><CloudflareColor size={11} />site</a>
              <ErrorCount series={siteErrors} title="Site errors in the last 12h (browser + worker)" />
              <CommitSha commit={production?.commit} />
            </div>
            <div className="mt-1 flex gap-x-3 text-2xs tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap" title={siteMetrics ? `${number.format(siteMetrics.subrequests)} subrequests · Worker invocations, not visits or pageviews` : undefined}>Req <span className="text-foreground">{siteMetrics ? number.format(siteMetrics.requests) : "—"}</span></span>
              <span className="whitespace-nowrap" title="P50 CPU time per Worker request">CPU <span className="text-foreground">{cpu(siteMetrics?.cpuTimeP50Ms)}</span></span>
              {!workerMetricsStale && <CollectionWindow start={cloudflare?.windowStart ?? undefined} end={cloudflare?.windowEnd ?? undefined} />}
            </div>
          </li>
          {CLOUDFLARE_WORKERS.filter(({ name }) => name !== "site").map(({ name }) => {
            const worker = cloudflare?.workers.find(w => w.name === name);
            const metrics = workerMetricsStale ? null : worker?.metrics, deployment = workerDeploymentsStale ? null : worker?.deployment;
            return <li key={name} className="bg-surface px-4 py-2.5 lg:px-5" title={deployment ? `Deployed ${time.format(deployment.deployedAt)} · ${deployment.versions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : name}>
              <div className="flex min-w-0 items-center gap-1.5 text-2xs leading-4">
                <span className="flex shrink-0"><CloudflareColor size={14} /></span>
                <a href={`${CLOUDFLARE_DASH_URL}/workers/services/view/${name}/production`} target="_blank" rel="noreferrer" className="relative shrink-0 before:absolute before:inset-x-0 before:-inset-y-1 hover:underline">{name}</a>
                {name === "core" ? <ErrorCount series={coreErrors} title="Backend Worker errors in the last 12h (core, ai, ingress, collector)" />
                  : <ErrBadge count={metrics?.errors} title="Invocations that ended in an error (uncaught exception or exceeded limit) in the window · Workers Analytics" />}
                <CommitSha commit={deployment?.commit} />
              </div>
              <div className="mt-1 flex gap-x-3 text-2xs tabular-nums text-muted-foreground">
                <span className="whitespace-nowrap" title={metrics ? `${number.format(metrics.subrequests)} subrequests` : undefined}>Req <span className="text-foreground">{metrics ? number.format(metrics.requests) : "—"}</span></span>
                <span className="whitespace-nowrap" title="P50 CPU time per request">CPU <span className="text-foreground">{cpu(metrics?.cpuTimeP50Ms)}</span></span>
                {!workerMetricsStale && <CollectionWindow start={cloudflare?.windowStart ?? undefined} end={cloudflare?.windowEnd ?? undefined} />}
              </div>
            </li>;
          })}
          <ReporterTile name="server-reporter" stat={reporters?.reporters["server-reporter"]} staleMs={SERVER_STALE_MS}
            servedAt={reportersServedAt}
            title={server ? `Exit node ${server.id} · ${server.hostname} · up ${formatUptime(server.uptimeSeconds)} · load ${server.load1.toFixed(2)}` : undefined} />
          <ReporterTile name="agents-reporter" stat={reporters?.reporters["agents-reporter"]} staleMs={AGENT_LIMITS_STALE_MS}
            servedAt={reportersServedAt}
            title="Coding agent plan limits and Cursor usage" />
        </ul>
      </section>
    </div>
  </Card>;
}
