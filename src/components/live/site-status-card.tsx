"use client";

import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color";
import Github from "@lobehub/icons/es/Github/components/Mono";
import Vercel from "@lobehub/icons/es/Vercel/components/Mono";
import NumberFlow from "@number-flow/react";
import { Container } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FlowDash } from "@/components/ui/flow-dash";
import { colorForRank, RepoContributions } from "@/components/live/repo-contributions";
import { formatUptime } from "@/components/live/server-card";
import { SentryMark } from "@/components/live/sentry-mark";
import { UptimeStrip } from "@/components/live/uptime-strip";
import { useStale } from "@/hooks/use-stale";
import { fieldPerformanceScore } from "@/lib/field-score";
import {
  AGENT_LIMITS_STALE_MS,
  CLOUDFLARE_DEPLOYMENTS_STALE_MS,
  CLOUDFLARE_METRICS_STALE_MS,
  GITHUB_REPO_STALE_MS,
  PAGESPEED_STALE_MS,
  SENTRY_STALE_MS,
  SERVER_STALE_MS,
  VERCEL_DEPLOYMENTS_STALE_MS,
  VERCEL_METRICS_STALE_MS,
} from "@/lib/freshness";
import type { ReporterName, ReporterStat, ReportersPayload } from "@/lib/reporter-ledger";
import { useStatus } from "@/hooks/use-status";
import { CLOUDFLARE_WORKERS, type CloudflareWorkersPayload } from "@/lib/cloudflare-workers-types";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { CLOUDFLARE_WORKERS_PATH, GITHUB_REPO_PATH, REPORTERS_PATH, SENTRY_PATH, SERVER_PATH, VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { SentryBlock, SentryErrorSeries, SentryStatusPayload } from "@/lib/sentry-status-types";
import { site } from "@/lib/site";
import type { GithubRepoPayload, ServerPayload, StatusResponse } from "@/lib/types";
import type { LighthouseVitals, VercelDeployment, VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("en-US", { timeZone: site.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const cpu = (ms: number | null | undefined) => ms == null ? "—" : ms < 1 ? `${Math.round(ms * 1000)}µs` : ms < 10 ? `${Number(ms.toFixed(1))}ms` : `${Math.round(ms)}ms`;

function CollectionWindow({ start, end }: { start?: number; end?: number }) {
  if (start == null || end == null) return null;
  const minutes = Math.round((end - start) / 60_000);
  const duration = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return <span className="ml-auto whitespace-nowrap" title={`${time.format(start)} — ${time.format(end)} · UTC+8`}>Last {duration}</span>;
}

function CommitSha({ commit }: { commit: { sha: string; branch: string | null; message: string | null } | null | undefined }) {
  if (!commit) return null;
  return <a href={`${site.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer"
    title={commit.message ? `${commit.branch ?? "main"} · ${commit.message}` : commit.branch ?? undefined}
    className="-mt-2 ml-auto shrink-0 pt-2 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline">{commit.sha.slice(0, 7)}</a>;
}

function Stat({ label, value, title, prefix }: { label: string; value?: number | null; title?: string; prefix?: string }) {
  return (
    <div title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-2 whitespace-nowrap text-2xl font-medium tracking-tight min-[400px]:text-3xl lg:text-4xl">{value == null ? <FlowDash /> : <>{prefix}<NumberFlow value={value} locales="en-US" /></>}</div>
    </div>
  );
}

const vitalRows: { label: string; key: Exclude<keyof LighthouseVitals, "score">; unit: "s" | "ms" | ""; title: string }[] = [
  { label: "LCP", key: "lcpMs", unit: "s", title: "Largest Contentful Paint" },
  { label: "TBT/INP", key: "tbtMs", unit: "ms", title: "Total Blocking Time for lab runs; Interaction to Next Paint for real users" },
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

function Fact({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return <span className="whitespace-nowrap" title={title}>{label} <span className={cn("text-foreground", className)}>{value}</span></span>;
}

const fieldValues = (vitals: SentryStatusPayload["vitals"]) => ({
  lcpMs: vitals?.lcpP75Ms, tbtMs: vitals?.inpP75Ms, cls: vitals?.clsP75, fcpMs: vitals?.fcpP75Ms, ttfbMs: vitals?.ttfbP75Ms,
});

function ErrorCount({ series, title }: { series: SentryErrorSeries | undefined; title: string }) {
  if (!series) return null;
  return <span title={`${title} · ${number.format(series.count7d)} in 7d · ${number.format(series.unresolved)} unresolved`}
    className={cn("shrink-0 text-[10px] tabular-nums", series.count12h ? "text-red-500" : "text-muted-foreground")}>
    {number.format(series.count12h)} err
  </span>;
}

const rtt = (ms: number | null | undefined) => ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

function ReporterTile({ name, stat, staleMs, servedAt, title }: {
  name: ReporterName; stat: ReporterStat | null | undefined; staleMs: number;
  servedAt: number | undefined;
  title?: string;
}) {
  const stale = useStale(stat?.lastPushAt, staleMs, servedAt);
  return <li className="bg-surface px-4 py-2.5" title={title}>
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
      <Container size={12} className="shrink-0" aria-hidden />
      <a href={`${site.repo}/tree/main/reporters/${name}`} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">{name}</a>
      {stat && stale && <span className="shrink-0 text-[10px] text-red-500">offline</span>}
      <CommitSha commit={stat?.commit ? { sha: stat.commit, branch: null, message: `${name} image` } : null} />
    </div>
    <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
      <Fact label="Push" value={stat ? number.format(stat.pushes) : "—"} title="Reports this reporter pushed successfully" />
      <Fact label="RTT" value={rtt(stat?.rttMs)} title="Median round trip of a successful push to the API Worker" />
      <CollectionWindow start={stat?.start} end={stat?.end} />
    </div>
  </li>;
}

export function SiteStatusCard({ githubFallback, vercelFallback, cloudflareFallback, sentryFallback, serverFallback, reportersFallback, recentCommits, className }: {
  githubFallback: StatusResponse<GithubRepoPayload>;
  vercelFallback: StatusResponse<VercelDeploymentsPayload>;
  cloudflareFallback: StatusResponse<CloudflareWorkersPayload>;
  sentryFallback: StatusResponse<SentryStatusPayload>;
  serverFallback: StatusResponse<ServerPayload>;
  reportersFallback: StatusResponse<ReportersPayload>;
  recentCommits: GithubRecentCommit[];
  className?: string;
}) {
  const { data: github, servedAt: githubServedAt } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, { fallback: githubFallback });
  const { data: vercel, servedAt: vercelServedAt } = useStatus<VercelDeploymentsPayload>(VERCEL_DEPLOYMENTS_PATH, { fallback: vercelFallback });
  const { data: cloudflare, servedAt: cloudflareServedAt } = useStatus<CloudflareWorkersPayload>(CLOUDFLARE_WORKERS_PATH, { fallback: cloudflareFallback });
  const { data: sentry, servedAt: sentryServedAt } = useStatus<SentryStatusPayload>(SENTRY_PATH, { fallback: sentryFallback });
  const githubStale = useStale(github ? github.totalsAt ?? github.fetchedAt : undefined, GITHUB_REPO_STALE_MS, githubServedAt);
  const deploymentsStale = useStale(vercel?.fetchedAt, VERCEL_DEPLOYMENTS_STALE_MS, vercelServedAt);
  const functionsStale = useStale(vercel?.metrics?.functions?.fetchedAt, VERCEL_METRICS_STALE_MS, vercelServedAt);
  const analyticsStale = useStale(vercel?.metrics?.analytics?.fetchedAt, VERCEL_METRICS_STALE_MS, vercelServedAt);
  const pagespeedStale = useStale(vercel?.pagespeed?.fetchedAt, PAGESPEED_STALE_MS, vercelServedAt);
  const workerMetricsStale = useStale(cloudflare?.fetchedAt, CLOUDFLARE_METRICS_STALE_MS, cloudflareServedAt);
  const workerDeploymentsStale = useStale(cloudflare?.deploymentsFetchedAt, CLOUDFLARE_DEPLOYMENTS_STALE_MS, cloudflareServedAt);
  const sentryAt = (block: SentryBlock) => sentry ? sentry.blockAt?.[block] ?? sentry.fetchedAt : undefined;
  const uptimeStale = useStale(sentryAt("uptime"), SENTRY_STALE_MS, sentryServedAt);
  const heartbeatStale = useStale(sentryAt("heartbeat"), SENTRY_STALE_MS, sentryServedAt);
  const errorsStale = useStale(sentryAt("errors"), SENTRY_STALE_MS, sentryServedAt);
  const vitalsStale = useStale(sentryAt("vitals"), SENTRY_STALE_MS, sentryServedAt);
  const functions = functionsStale ? null : vercel?.metrics?.functions;
  const analytics = analyticsStale ? null : vercel?.metrics?.analytics;
  const totals = githubStale ? null : github?.totals;
  const production = deploymentsStale ? null : vercel?.production;
  const siteErrors = errorsStale ? undefined : sentry?.errors?.site, apiErrors = errorsStale ? undefined : sentry?.errors?.worker;
  const { data: server } = useStatus<ServerPayload>(SERVER_PATH, { fallback: serverFallback });
  const { data: reporters, servedAt: reportersServedAt } = useStatus<ReportersPayload>(REPORTERS_PATH, { fallback: reportersFallback });
  const measured = vercel?.pagespeed ? new URL(vercel.pagespeed.url).host : null;
  const pagespeed = pagespeedStale ? null : vercel?.pagespeed;
  const deploymentsBySha = new Map<string, { deployment: VercelDeployment; production: boolean }>();
  for (const deployment of [...vercel?.recent ?? [], ...vercel?.production ? [vercel.production] : []]) {
    const sha = deployment.commit?.sha;
    if (!sha) continue;
    const prev = deploymentsBySha.get(sha);
    if (!prev || deployment.createdAt > prev.deployment.createdAt) {
      deploymentsBySha.set(sha, { deployment, production: !deploymentsStale && vercel?.production?.commit?.sha === sha });
    }
  }
  const contributors = github?.contributors ?? [];
  // GitHub 协作者各计一次贡献，参与次数之和不能替代去重提交总数。
  const contributionShare = contributors.reduce((sum, person) => sum + person.commits, 0);
  return <Card id="site-status" label="LYJWPAGE" className={cn("scroll-mt-28", className)} action={
    <div className="flex items-center gap-4">
      <a href={site.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository" className="-m-2 flex p-2 hover:text-foreground"><Github size={15} /></a>
      <a href={site.vercel} target="_blank" rel="noreferrer" aria-label="Vercel dashboard" className="-m-2 flex p-2 hover:text-foreground"><Vercel size={15} /></a>
      <a href={site.cloudflare} target="_blank" rel="noreferrer" aria-label="Cloudflare dashboard" className="-m-2 flex p-2"><CloudflareColor size={19} /></a>
      <a href={site.sentry} target="_blank" rel="noreferrer" aria-label="Sentry dashboard" className="-m-2 flex p-2 hover:text-foreground"><SentryMark /></a>
    </div>
  }>
    <div className="border-b border-line px-4 py-5 md:px-5">
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="VIEWS · 7D" value={analytics?.pageviews} title={analytics ? `${time.format(analytics.start)} — ${time.format(analytics.end)} · UTC+8` : analyticsStale ? "Unavailable" : undefined} />
        <Stat label="COMMITS" value={totals?.commits} title={githubStale ? "Unavailable" : "Commits on the default branch"} />
        <Stat label="ADDITIONS" value={totals?.additions} prefix="+" title={githubStale ? "Unavailable" : "Total lines added"} />
        <Stat label="DELETIONS" value={totals?.deletions} prefix="−" title={githubStale ? "Unavailable" : "Total lines removed"} />
      </div>
      {contributionShare > 0 && (
        <div className="mt-6 flex h-2 overflow-hidden bg-muted" role="img" aria-label="Contribution share by commits">
          {contributors.map((person, index) => person.commits > 0 ? (
            <span key={person.login} title={`${person.login} · ${number.format(person.commits)} commits`} style={{ width: `${person.commits / contributionShare * 100}%`, backgroundColor: colorForRank(index) }} />
          ) : null)}
        </div>
      )}
    </div>
    <RepoContributions data={github} recentCommits={recentCommits} deploymentsBySha={deploymentsBySha} />
    {sentry && <UptimeStrip site={sentry.uptime} api={sentry.heartbeat ?? null} siteStale={uptimeStale} apiStale={heartbeatStale} />}
    <div className="grid border-t border-line lg:grid-cols-2">
      <section className="min-w-0 border-b border-line lg:border-b-0" aria-label="Performance">
        <div className="px-4 pt-3 pb-2">
          <div className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[9px] text-muted-foreground lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-[10px]">
            <span className="truncate text-left" title={pagespeed ? `PageSpeed Insights on ${pagespeed.url}\nMedian of ${pagespeed.samples} runs · ${time.format(pagespeed.start)} — ${time.format(pagespeed.fetchedAt)} · UTC+8` : pagespeedStale ? "Unavailable" : undefined}>{measured}</span>
            <span title="Lighthouse performance score, lab run on a simulated device">PERF</span>{vitalRows.map(row => <span key={row.key} title={row.title}>{row.label}</span>)}
          </div>
          {(["desktop", "mobile"] as const).map(device => {
            const score = pagespeed?.[device].score;
            return <div key={device} className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs">
              <span className="text-left text-[11px] text-muted-foreground">{device === "desktop" ? "Desktop" : "Mobile"}</span>
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}>{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key}>{vital(pagespeed?.[device][row.key], row.unit)}</span>)}
            </div>;
          })}
          {sentry?.vitals && (() => {
            const vitals = vitalsStale ? null : sentry.vitals;
            const field = fieldValues(vitals), samples = vitals?.samples, score = vitals ? fieldPerformanceScore(vitals) : null;
            return <div className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs"
              title={vitalsStale ? "Real visitors via Sentry · unavailable" : samples ? `Real visitors via Sentry · p75 of ${number.format(samples)} page loads, last 7 days` : "Real visitors via Sentry · no page loads sampled yet"}>
              <span className="text-left text-[11px] text-muted-foreground">Users</span>
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}
                title="Web Vitals score of real visitors: LCP 30%, INP 30%, CLS 15%, FCP 15%, TTFB 10%, from 7-day p75">{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key}>{vital(field[row.key], row.unit)}</span>)}
            </div>;
          })()}
        </div>
      </section>
      <section id="cloudflare-workers" className="min-w-0 scroll-mt-28 lg:border-l lg:border-line" aria-label="Services">
        <ul className="grid h-full auto-rows-fr grid-cols-1 gap-px bg-line sm:grid-cols-2">
          <li className="bg-surface px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] leading-4">
              <span className="flex items-center gap-1.5"><Vercel size={11} />Vercel</span>
              <ErrorCount series={siteErrors} title="Site errors in the last 12h (browser + functions)" />
              <CommitSha commit={production?.commit} />
            </div>
            <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap" title={functions ? `${functions.timeouts} timeouts · avg peak memory ${functions.memoryAvgMb == null ? "—" : `${Math.round(functions.memoryAvgMb)} MB`}` : undefined}>Req <span className="text-foreground">{functions ? number.format(functions.invocations) : "—"}</span></span>
              <span className="whitespace-nowrap" title="P75 CPU time per function invocation">CPU <span className="text-foreground">{cpu(functions?.cpuP75Ms)}</span></span>
              <CollectionWindow start={functions?.start} end={functions?.end} />
            </div>
          </li>
          {CLOUDFLARE_WORKERS.map(({ name }) => {
            const worker = cloudflare?.workers.find(w => w.name === name);
            const metrics = workerMetricsStale ? null : worker?.metrics, deployment = workerDeploymentsStale ? null : worker?.deployment;
            return <li key={name} className="bg-surface px-4 py-2.5" title={deployment ? `Deployed ${time.format(deployment.deployedAt)} · ${deployment.versions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : name}>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
                <span className="flex shrink-0"><CloudflareColor size={14} /></span>
                <span className="min-w-0 truncate">{name}</span>
                {name === "api" && <ErrorCount series={apiErrors} title="API Worker errors in the last 12h" />}
                <CommitSha commit={deployment?.commit} />
              </div>
              <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
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
