"use client";

import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color";
import Github from "@lobehub/icons/es/Github/components/Mono";
import Vercel from "@lobehub/icons/es/Vercel/components/Mono";
import NumberFlow from "@number-flow/react";
import { Server as ServerIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { colorForRank, RepoContributions } from "@/components/live/repo-contributions";
import { formatUptime } from "@/components/live/server-card";
import { SentryMark } from "@/components/live/sentry-mark";
import { useStale } from "@/hooks/use-stale";
import { fieldPerformanceScore } from "@/lib/field-score";
import { SERVER_STALE_MS } from "@/lib/freshness";
import { useStatus } from "@/hooks/use-status";
import { CLOUDFLARE_WORKERS, type CloudflareWorkersPayload } from "@/lib/cloudflare-workers-types";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { CLOUDFLARE_WORKERS_PATH, GITHUB_REPO_PATH, SENTRY_PATH, SERVER_PATH, VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { SentryErrorSeries, SentryStatusPayload } from "@/lib/sentry-status-types";
import { site } from "@/lib/site";
import type { GithubRepoPayload, ServerPayload, StatusResponse } from "@/lib/types";
import type { LighthouseVitals, VercelDeployment, VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("zh-CN", { timeZone: site.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
/** 10ms 以上不留小数：这一行只有 32 个字符的位置，`191.9ms` 那一位小数会把 Vercel 那格顶到两行 */
const cpu = (ms: number | null | undefined) => ms == null ? "—" : ms < 1 ? `${Math.round(ms * 1000)}µs` : ms < 10 ? `${Number(ms.toFixed(1))}ms` : `${Math.round(ms)}ms`;

function CollectionWindow({ start, end }: { start?: number; end?: number }) {
  if (start == null || end == null) return null;
  const minutes = Math.round((end - start) / 60_000);
  const duration = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  // 靠右，和名字那一行的提交哈希对齐成一列
  return <span className="ml-auto whitespace-nowrap" title={`${time.format(start)} — ${time.format(end)} · UTC+8`}>Last {duration}</span>;
}

function CommitSha({ commit }: { commit: { sha: string; branch: string | null; message: string | null } | null | undefined }) {
  if (!commit) return null;
  return <a href={`${site.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer"
    title={commit.message ? `${commit.branch ?? "main"} · ${commit.message}` : commit.branch ?? undefined}
    className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline">{commit.sha.slice(0, 7)}</a>;
}

function Stat({ label, value, title, prefix }: { label: string; value?: number | null; title?: string; prefix?: string }) {
  return (
    <div title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">{value == null ? "—" : <>{prefix}<NumberFlow value={value} locales="en-US" /></>}</div>
    </div>
  );
}

/**
 * 顺序按 Lighthouse 报告。实验室跑不出 INP（要真实用户才测得到），同轮的 TBT 占那一列；
 * 第三行真实访客（Sentry 采样的 p75）在这一列放的才是 INP。
 */
const vitalRows: { label: string; key: Exclude<keyof LighthouseVitals, "score">; unit: "s" | "ms" | ""; title: string }[] = [
  { label: "LCP", key: "lcpMs", unit: "s", title: "Largest Contentful Paint" },
  { label: "TBT/INP", key: "tbtMs", unit: "ms", title: "Total Blocking Time for lab runs; Interaction to Next Paint for real users" },
  { label: "CLS", key: "cls", unit: "", title: "Cumulative Layout Shift" },
  { label: "FCP", key: "fcpMs", unit: "s", title: "First Contentful Paint" },
  { label: "TTFB", key: "ttfbMs", unit: "ms", title: "Time to First Byte: server response of the root document" },
];
function vital(value: number | null | undefined, unit: string) {
  if (value == null) return "—";
  // CLS 是无量纲小数，Lighthouse 自己也把末尾的零去掉（0.004 / 0）
  return unit === "s" ? `${(value / 1000).toFixed(2)}s` : unit === "ms" ? `${Math.round(value)}ms` : String(Number(value.toFixed(3)));
}

/** 99.95% 这种要看到小数点后两位才有区别；整 100 就写 100% */
function percent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  const value = ratio * 100;
  return value >= 99.995 ? "100%" : `${value.toFixed(2)}%`;
}

/** Lighthouse 自己的档位：90 分及格算绿，50 到 89 黄；真实访客的分沿用同一套 */
const scoreTone = (score: number | null | undefined) =>
  score == null ? "text-muted-foreground" : score >= 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 50 ? "text-amber-600" : "text-red-500";

const CRON_LABEL = { ok: "OK", error: "Failing", missed: "Missed", timeout: "Timed out", unknown: "Waiting" } as const;

/** 服务格的一行小字：标签淡、值实，和 Req / CPU 那几段同一种写法 */
function Fact({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return <span className="whitespace-nowrap" title={title}>{label} <span className={cn("text-foreground", className)}>{value}</span></span>;
}

/** 真实访客那一行，列与上面两行对齐：TBT 那一列换成 INP */
const fieldValues = (vitals: SentryStatusPayload["vitals"]) => ({
  lcpMs: vitals?.lcpP75Ms, tbtMs: vitals?.inpP75Ms, cls: vitals?.clsP75, fcpMs: vitals?.fcpP75Ms, ttfbMs: vitals?.ttfbP75Ms,
});

/** 服务格名字那一行的错误数：有错才标红，零就淡着 */
function ErrorCount({ series, title }: { series: SentryErrorSeries | undefined; title: string }) {
  if (!series) return null;
  return <span title={`${title} · ${number.format(series.count7d)} in 7d · ${number.format(series.unresolved)} unresolved`}
    className={cn("shrink-0 text-[10px] tabular-nums", series.count12h ? "text-red-500" : "text-muted-foreground")}>
    {number.format(series.count12h)} err
  </span>;
}

export function SiteStatusCard({ githubFallback, vercelFallback, cloudflareFallback, sentryFallback, serverFallback, recentCommits, className }: {
  githubFallback: StatusResponse<GithubRepoPayload>;
  vercelFallback: StatusResponse<VercelDeploymentsPayload>;
  cloudflareFallback: StatusResponse<CloudflareWorkersPayload>;
  sentryFallback: StatusResponse<SentryStatusPayload>;
  serverFallback: StatusResponse<ServerPayload>;
  recentCommits: GithubRecentCommit[];
  className?: string;
}) {
  const { data: github } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, 30 * 60_000, { fallback: githubFallback, revalidateOnMount: false, revalidateOnFocus: false });
  const { data: vercel } = useStatus<VercelDeploymentsPayload>(VERCEL_DEPLOYMENTS_PATH, 60_000, { fallback: vercelFallback });
  const { data: cloudflare } = useStatus<CloudflareWorkersPayload>(CLOUDFLARE_WORKERS_PATH, 300_000, { fallback: cloudflareFallback });
  const { data: sentry } = useStatus<SentryStatusPayload>(SENTRY_PATH, 5 * 60_000, { fallback: sentryFallback });
  const { functions, analytics } = vercel?.metrics ?? {};
  const cron = sentry?.cron, siteErrors = sentry?.errors?.site, apiErrors = sentry?.errors?.worker;
  // 出口节点那张卡用的同一条键，SWR 只取一份
  const { data: server } = useStatus<ServerPayload>(SERVER_PATH, 60_000, { fallback: serverFallback });
  const serverStale = useStale(server?.pushedAt, server?.staleAfterMs ?? SERVER_STALE_MS) || Boolean(server?.staleAtSource);
  const unresolved = sentry?.errors ? sentry.errors.site.unresolved + sentry.errors.worker.unresolved : null;
  // 主站量的是 lyjw.me；把域名写在表头，省得和访客当前所在的域名混起来。
  // 每一格是滚动窗口内各轮实测的中位数，轮数和窗口在表头的提示里。
  const pagespeed = vercel?.pagespeed, measured = pagespeed ? new URL(pagespeed.url).host : null;
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
  /**
   * 只用来分占比条的宽度，不是全仓提交数。
   *
   * 一条「我 + agent」的提交在 GitHub 的贡献口径里作者和协作者各记一次，所以
   * 这个和会明显大于 totals.commits（这个仓大约是两倍）。占比条要的正是这个
   * 口径 —— 谁参与了多少 —— 顶部那个 COMMITS 才是去重后的真数。
   */
  const contributionShare = contributors.reduce((sum, person) => sum + person.commits, 0);
  return <Card id="site-status" label="LYJWPAGE" className={cn("scroll-mt-28", className)} action={
    <div className="flex items-center gap-4">
      <a href={site.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository" className="hover:text-foreground"><Github size={15} /></a>
      <a href={site.vercel} target="_blank" rel="noreferrer" aria-label="Vercel dashboard" className="hover:text-foreground"><Vercel size={15} /></a>
      <a href={site.cloudflare} target="_blank" rel="noreferrer" aria-label="Cloudflare dashboard"><CloudflareColor size={19} /></a>
      <a href={site.sentry} target="_blank" rel="noreferrer" aria-label="Sentry dashboard" className="flex hover:text-foreground"><SentryMark /></a>
    </div>
  }>
    <div className="border-b border-line px-4 py-5 md:px-5">
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="VIEWS · 7D" value={analytics?.pageviews} title={analytics ? `${time.format(analytics.start)} — ${time.format(analytics.end)} · UTC+8` : undefined} />
        <Stat label="COMMITS" value={github?.totals.commits} title="Commits on the default branch" />
        <Stat label="ADDITIONS" value={github?.totals.additions} prefix="+" title="Total lines added" />
        <Stat label="DELETIONS" value={github?.totals.deletions} prefix="−" title="Total lines removed" />
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
    {/*
      性能表和服务格到 lg 才并排：768–1023 之间并排的话每格只剩 150–200px，
      「Req · CPU · Last 12h」一行放不下会折行，所以这一段和手机一样上下叠。
    */}
    <div className="grid border-t border-line lg:grid-cols-2">
      <section className="min-w-0 border-b border-line lg:border-b-0" aria-label="Performance">
        <div className="px-4 pt-3 pb-2">
          <div className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[9px] text-muted-foreground lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-[10px]">
            <span className="truncate text-left" title={pagespeed ? `PageSpeed Insights on ${pagespeed.url}\nMedian of ${pagespeed.samples} runs · ${time.format(pagespeed.start)} — ${time.format(pagespeed.fetchedAt)} · UTC+8` : undefined}>{measured}</span>
            <span title="Lighthouse performance score, lab run on a simulated device">PERF</span>{vitalRows.map(row => <span key={row.key} title={row.title}>{row.label}</span>)}
          </div>
          {(["desktop", "mobile"] as const).map(device => {
            const score = pagespeed?.[device].score;
            return <div key={device} className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs">
              <span className="text-left text-[11px] text-muted-foreground">{device === "desktop" ? "Desktop" : "Mobile"}</span>
              {/* Lighthouse 自己的档位：90 分及格算绿，50 到 89 黄 */}
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}>{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key}>{vital(pagespeed?.[device][row.key], row.unit)}</span>)}
            </div>;
          })}
          {sentry?.vitals && (() => {
            const field = fieldValues(sentry.vitals), samples = sentry.vitals.samples, score = fieldPerformanceScore(sentry.vitals);
            return <div className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums lg:grid-cols-[88px_repeat(6,minmax(0,1fr))] lg:text-xs"
              title={samples ? `Real visitors via Sentry · p75 of ${number.format(samples)} page loads, last 7 days` : "Real visitors via Sentry · no page loads sampled yet"}>
              <span className="text-left text-[11px] text-muted-foreground">Users</span>
              <span className={cn("text-xl font-medium lg:text-2xl", scoreTone(score))}
                title="Web Vitals score of real visitors: LCP 30%, INP 30%, CLS 15%, FCP 15%, TTFB 10%, from 7-day p75">{score ?? "—"}</span>
              {vitalRows.map(row => <span key={row.key}>{vital(field[row.key], row.unit)}</span>)}
            </div>;
          })()}
        </div>
      </section>
      <section id="cloudflare-workers" className="min-w-0 scroll-mt-28 lg:border-l lg:border-line" aria-label="Services">
        {/* 窄屏两列只剩 150px 左右，名字截断、数字拆行；单列到 sm 再回两列 */}
        <ul className="grid h-full auto-rows-fr grid-cols-1 gap-px bg-line sm:grid-cols-2">
          <li className="bg-surface px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] leading-4">
              <a href={`${site.vercel}/observability/vercel-functions`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline"><Vercel size={11} />Vercel</a>
              <ErrorCount series={siteErrors} title="Site errors in the last 12h (browser + functions)" />
              <CommitSha commit={vercel?.production?.commit} />
            </div>
            <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap" title={functions ? `${functions.timeouts} timeouts · avg peak memory ${functions.memoryAvgMb == null ? "—" : `${Math.round(functions.memoryAvgMb)} MB`}` : undefined}>Req <span className="text-foreground">{functions ? number.format(functions.invocations) : "—"}</span></span>
              <span className="whitespace-nowrap" title="P75 CPU time per function invocation">CPU <span className="text-foreground">{cpu(functions?.cpuP75Ms)}</span></span>
              <CollectionWindow start={functions?.start} end={functions?.end} />
            </div>
          </li>
          {CLOUDFLARE_WORKERS.map(({ name }) => {
            const worker = cloudflare?.workers.find(w => w.name === name), metrics = worker?.metrics;
            return <li key={name} className="bg-surface px-4 py-2.5" title={worker?.deployment ? `Deployed ${time.format(worker.deployment.deployedAt)} · ${worker.deployment.versions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : name}>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
                <span className="flex shrink-0"><CloudflareColor size={14} /></span>
                <span className="min-w-0 truncate">{name}</span>
                {name === "api" && <ErrorCount series={apiErrors} title="API Worker errors in the last 12h" />}
                <CommitSha commit={worker?.deployment?.commit} />
              </div>
              <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
                <span className="whitespace-nowrap" title={metrics ? `${number.format(metrics.subrequests)} subrequests` : undefined}>Req <span className="text-foreground">{metrics ? number.format(metrics.requests) : "—"}</span></span>
                <span className="whitespace-nowrap" title="P50 CPU time per request">CPU <span className="text-foreground">{cpu(metrics?.cpuTimeP50Ms)}</span></span>
                <CollectionWindow start={cloudflare?.windowStart} end={cloudflare?.windowEnd} />
              </div>
            </li>;
          })}
          {/*
            和上面几格同一种写法：名字一行带上报器镜像的提交，小字一行是 12 小时窗口。
            Push 是上报器这段时间推了几轮（不叫 Req：那几格是收到的请求，这里是往外发的）；流量和此刻的 CPU / 内存 / 磁盘都在 Exit Node
            卡片上，这里只放窗口平均。
          */}
          <li className="bg-surface px-4 py-2.5"
            title={server ? `${server.hostname} · ${server.city ?? ""} · up ${formatUptime(server.uptimeSeconds)} · load ${server.load1.toFixed(2)}` : "Exit node"}>
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
              <ServerIcon size={12} className="shrink-0" aria-hidden />
              <a href="#exit-node" className="min-w-0 truncate hover:underline">{server?.id ?? "misaka-jp"}</a>
              {server && serverStale && <span className="shrink-0 text-[10px] text-red-500">offline</span>}
              <CommitSha commit={server?.reporterCommit ? { sha: server.reporterCommit, branch: null, message: "server-reporter image" } : null} />
            </div>
            <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
              <Fact label="Push" value={server?.window ? number.format(server.window.reports) : "—"}
                title="Reports pushed by server-reporter" />
              <Fact label="CPU" value={server?.window?.cpuAvgPercent != null ? `${server.window.cpuAvgPercent.toFixed(1)}%` : "—"}
                title="Average CPU usage over the window" />
              <CollectionWindow start={server?.window?.start} end={server?.window?.end} />
            </div>
          </li>
          <li className="bg-surface px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
              <a href={site.sentry} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline"><SentryMark size={12} />Sentry</a>
            </div>
            <div className="mt-1 flex gap-x-3 text-[10px] tabular-nums text-muted-foreground">
              <Fact label="Crash-free" value={percent(sentry?.sessions?.crashFreeRate)}
                title={sentry?.sessions ? `${number.format(sentry.sessions.count)} browser sessions in 24h` : undefined} />
              <Fact label="Open" value={unresolved == null ? "—" : number.format(unresolved)} title="Unresolved issues, site and API" />
              <Fact label="Cron" value={cron ? CRON_LABEL[cron.status] : "—"}
                className={cron && cron.status !== "ok" && cron.status !== "unknown" ? "text-red-500" : undefined}
                title={cron?.lastCheckInAt ? `API Worker every-minute cron · last check-in ${time.format(cron.lastCheckInAt)} UTC+8` : "API Worker every-minute cron"} />
            </div>
          </li>
        </ul>
      </section>
    </div>
  </Card>;
}
