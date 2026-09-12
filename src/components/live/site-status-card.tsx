"use client";

import { Cloudflare, Github, Vercel } from "@lobehub/icons";
import { Card } from "@/components/ui/card";
import { RepoContributions } from "@/components/live/repo-contributions";
import { useStatus } from "@/hooks/use-status";
import { useStale } from "@/hooks/use-stale";
import { CLOUDFLARE_WORKERS, type CloudflareWorkersPayload } from "@/lib/cloudflare-workers-types";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { CLOUDFLARE_WORKERS_PATH, GITHUB_REPO_PATH, VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import { mergeSiteActivity } from "@/lib/site-activity";
import { site } from "@/lib/site";
import type { GithubRepoPayload, StatusResponse } from "@/lib/types";
import type { DeploymentState, VercelDeploymentsPayload, VercelWebVitals } from "@/lib/vercel-deployments-types";
import { cn } from "@/lib/utils";

const vercelUrl = "https://vercel.com/lyjw131s-projects/lyjwpage";
const cfUrl = "https://dash.cloudflare.com/209f2c881b1c494fec50851c067b3266/workers-and-pages";
const number = new Intl.NumberFormat("en-US");
const time = new Intl.DateTimeFormat("zh-CN", { timeZone: site.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const stateLabels: Record<DeploymentState, string> = { READY: "已部署", BUILDING: "构建中", QUEUED: "排队", INITIALIZING: "准备中", ERROR: "失败", CANCELED: "取消", UNKNOWN: "—" };
const cpu = (ms: number | null | undefined) => ms == null ? "—" : ms < 1 ? `${Math.round(ms * 1000)}µs` : `${Number(ms.toFixed(1))}ms`;

function Stamp({ at, interval = 15 * 60_000 }: { at?: number; interval?: number }) {
  const stale = useStale(at, interval);
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", !at ? "bg-live-off" : stale ? "bg-amber-500" : "bg-emerald-500/70")}
    title={at ? `${stale ? "上次数据" : "更新于"} ${time.format(at)} · UTC+8` : "暂无数据"} aria-label={at && stale ? "数据待更新" : undefined} />;
}

function Stat({ label, value, title }: { label: string; value?: number; title?: string }) {
  return <div className="min-w-0 px-4 py-3" title={title}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-medium tabular-nums md:text-3xl">{value == null ? "—" : number.format(value)}</dd></div>;
}

function Spark({ points, source }: { points: { at: number; requests: number }[]; source: "vercel" | "cloudflare" }) {
  const max = Math.max(1, ...points.map(point => point.requests));
  const first = points[0]?.at, last = points.at(-1)?.at;
  const tick = (at: number) => time.format(at).split(" ")[1];
  return <div className="col-span-4 row-start-2 mt-1 min-w-0 w-full md:mt-0 md:flex-1"
    title={points.length ? `${time.format(first!)} — ${time.format(last!)} · ${source === "vercel" ? "每 5 分钟" : "每小时"}调用` : undefined}>
    {points.length ? <>
      <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
        <div className="flex h-10 flex-col justify-between text-right text-[9px] tabular-nums text-muted-foreground"><span>{number.format(max)}次</span><span>0</span></div>
        <svg viewBox="0 0 160 40" preserveAspectRatio="none" className="h-10 w-full overflow-visible" role="img" aria-label={`${source === "vercel" ? "Vercel" : "Workers"} 调用趋势，${points.length} 个采样点，纵轴 0 至 ${max} 次，横轴 ${time.format(first!)} 至 ${time.format(last!)}`}>
          <path d="M0 1H160 M0 20H160" fill="none" className="stroke-line" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <path d="M0 0V39H160" fill="none" className="stroke-muted-foreground/40" vectorEffect="non-scaling-stroke" />
          <polyline fill="none" stroke="currentColor" className={source === "cloudflare" ? "text-orange-400" : undefined} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={points.map((point, i) => `${1 + i / Math.max(1, points.length - 1) * 158},${38 - point.requests / max * 36}`).join(" ")} />
        </svg>
      </div>
      <div className="ml-12 mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground"><span>{time.format(first!)}</span><span>{tick(first! + (last! - first!) / 2)}</span><span>{time.format(last!)}</span></div>
    </> : <span className="text-[9px] text-muted-foreground">—</span>}
  </div>;
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
  const activity = mergeSiteActivity(recentCommits, vercel);
  return <Card id="site-status" label="LYJWPAGE" className={cn("scroll-mt-28", className)} action={
    <div className="flex items-center gap-4">
      <a href="https://lyjw.me" target="_blank" rel="noreferrer" className="hover:text-foreground">lyjw.me ↗</a>
      <a href={site.repo} target="_blank" rel="noreferrer" aria-label="GitHub 仓库" className="hover:text-foreground"><Github size={15} /></a>
      <a href={vercelUrl} target="_blank" rel="noreferrer" aria-label="Vercel 控制台" className="hover:text-foreground"><Vercel size={15} /></a>
      <a href={cfUrl} target="_blank" rel="noreferrer" aria-label="Cloudflare 控制台"><Cloudflare.Color size={19} /></a>
    </div>
  }>
    <dl className="grid grid-cols-2 divide-line border-b border-line md:grid-cols-4 md:divide-x">
      <Stat label="浏览 · 7d" value={analytics?.pageviews} title={analytics ? `${time.format(analytics.start)} — ${time.format(analytics.end)} · UTC+8` : undefined} />
      <Stat label="访客 · 7d" value={analytics?.visitors} />
      <Stat label="提交" value={github?.totals.commits} />
      <Stat label="贡献者" value={github?.totals.contributors} />
    </dl>
    <section id="vercel-deployments" className="scroll-mt-28 border-b border-line" aria-label="提交与部署">
      <div className="flex h-11 items-center justify-between px-4 text-[11px] text-muted-foreground">
        <span>提交与部署</span><span className="flex items-center gap-2">{vercel?.production?.commit?.branch}<Stamp at={vercel?.fetchedAt} interval={5 * 60_000} /></span>
      </div>
      <ol className="divide-y divide-line">{activity.map(row => {
        const deployment = row.deployment;
        const status = row.production ? "当前线上" : !deployment ? "已提交" : deployment.state === "READY" && deployment.target === "preview" ? "预览就绪" : stateLabels[deployment.state];
        return <li key={row.key} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 px-4 py-3 md:grid-cols-[88px_minmax(0,1fr)_104px] md:gap-x-5">
          <div className="flex items-start pt-0.5">
            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]", row.production ? "text-emerald-600 dark:text-emerald-400" : deployment?.state === "ERROR" ? "text-red-500" : "text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full", row.production ? "bg-emerald-500" : deployment?.state === "ERROR" ? "bg-red-500" : deployment?.state === "BUILDING" ? "bg-amber-500" : "bg-muted-foreground/40")} />{status}
            </span>
          </div>
          <div className="min-w-0">
            <a href={row.sha ? `${site.repo}/commit/${row.sha}` : `${vercelUrl}/${deployment?.id.replace(/^dpl_/, "")}`} target="_blank" rel="noreferrer" className="block break-words text-xs leading-5 hover:underline">{row.title}</a>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              {row.sha && <a href={`${site.repo}/commit/${row.sha}`} target="_blank" rel="noreferrer" className="font-mono hover:text-foreground">{row.sha.slice(0, 7)}</a>}
              {deployment && <a href={`${vercelUrl}/${deployment.id.replace(/^dpl_/, "")}`} target="_blank" rel="noreferrer" className="hover:text-foreground">{deployment.target === "production" ? "Production" : "Preview"} ↗</a>}
              {deployment?.buildDurationMs != null && <span>构建 {(deployment.buildDurationMs / 1000).toFixed(0)}s</span>}
              {row.production && deployment?.state !== "READY" && deployment && <span>{stateLabels[deployment.state]}</span>}
              <time className="md:hidden">{row.at ? time.format(row.at) : "—"}</time>
            </div>
          </div>
          <time className="hidden pt-0.5 text-right text-[10px] tabular-nums text-muted-foreground md:block">{row.at ? time.format(row.at) : "—"}</time>
        </li>;
      })}</ol>
    </section>
    <section className="border-b border-line" aria-label="体验评分">
      <div className="flex h-11 items-center justify-between px-4 text-[11px] text-muted-foreground"><a href={`${vercelUrl}/speed-insights`} target="_blank" rel="noreferrer" className="hover:text-foreground">访问体验</a><span className="flex items-center gap-2">7d · P75 <Stamp at={speed?.fetchedAt} /></span></div>
      <div className="px-4 pt-3 pb-2">
        <div className="grid grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[9px] text-muted-foreground md:grid-cols-[88px_repeat(6,minmax(0,1fr))] md:text-[10px]">
          <span /><span title="Real Experience Score">RES</span>{vitalRows.map(row => <span key={row.key}>{row.label}</span>)}
        </div>
        {(["desktop", "mobile"] as const).map(device => {
          const score = speed?.[device].score;
          return <div key={device} className="grid h-11 grid-cols-[40px_repeat(6,minmax(0,1fr))] items-center gap-1 text-right text-[10px] tabular-nums md:grid-cols-[88px_repeat(6,minmax(0,1fr))] md:text-xs">
            <span className="text-left text-[11px] text-muted-foreground">{device === "desktop" ? "桌面" : "移动"}</span>
            <span className={cn("text-xl font-medium md:text-2xl", score == null ? "text-muted-foreground" : score > 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 50 ? "text-amber-600" : "text-red-500")}>{score ?? "—"}</span>
            {vitalRows.map(row => <span key={row.key}>{vital(speed?.[device][row.key], row.unit)}</span>)}
          </div>;
        })}
      </div>
    </section>
      <section id="cloudflare-workers" className="min-w-0 scroll-mt-28 border-b border-line" aria-label="服务运行">
        <div className="grid grid-cols-[minmax(0,1fr)_66px_42px_74px] items-center gap-2 h-11 px-4 text-right text-[10px] text-muted-foreground md:grid-cols-[minmax(0,1fr)_120px_100px_120px]">
          <span className="text-left text-[11px]">服务运行</span><span>调用</span><span>错误</span><span>CPU</span>
        </div>
        <div className="grid min-h-[52px] [&>span]:row-start-1 grid-cols-[minmax(0,1fr)_66px_42px_74px] items-center gap-2 border-b border-line px-4 py-2 text-right text-[11px] tabular-nums md:grid-cols-[minmax(0,1fr)_120px_100px_120px]">
          <div className="contents text-left md:col-start-1 md:row-start-1 md:flex md:min-w-0 md:items-center md:gap-6"><a href={`${vercelUrl}/observability/vercel-functions`} target="_blank" rel="noreferrer" className="col-start-1 row-start-1 flex items-center gap-1.5 md:w-48 md:shrink-0"><Vercel size={11} />Vercel <span className="text-[9px] text-muted-foreground">12h</span><Stamp at={functions?.fetchedAt} /></a><Spark points={functions?.history ?? []} source="vercel" /></div>
          <span title={functions ? `超时 ${functions.timeouts} 次 · 平均峰值内存 ${functions.memoryAvgMb == null ? "—" : `${Math.round(functions.memoryAvgMb)} MB`}` : undefined}>{functions ? number.format(functions.invocations) : "—"}</span>
          <span className={functions?.errors ? "text-amber-600" : ""}>{functions ? number.format(functions.errors) : "—"}</span><span>{cpu(functions?.cpuP75Ms)}<span className="ml-1 text-[8px] text-muted-foreground">P75</span></span>
        </div>
        {CLOUDFLARE_WORKERS.map(({ name }) => { const worker = cloudflare?.workers.find(w => w.name === name), metrics = worker?.metrics; return <div key={name} className="grid min-h-[52px] [&>span]:row-start-1 grid-cols-[minmax(0,1fr)_66px_42px_74px] items-center gap-2 border-b border-line px-4 py-2 text-right text-[11px] tabular-nums last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px_100px_120px]">
          <div className="contents text-left md:col-start-1 md:row-start-1 md:flex md:min-w-0 md:items-center md:gap-6" title={worker?.deployment ? `部署于 ${time.format(worker.deployment.deployedAt)} · ${worker.deployment.versions.map(v => `${v.id.slice(0, 8)} ${v.percentage}%`).join(" / ")}` : name}>
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 md:w-48 md:shrink-0"><span className="min-w-0 break-words leading-tight" title={name}>{name}</span><Stamp at={metrics ? cloudflare?.fetchedAt : undefined} /></div>
            <Spark points={worker?.history ?? []} source="cloudflare" />
          </div>
          <span title={metrics ? `子请求 ${number.format(metrics.subrequests)}` : undefined}>{metrics ? number.format(metrics.requests) : "—"}</span><span className={metrics?.errors ? "text-amber-600 dark:text-amber-400" : ""}>{metrics ? number.format(metrics.errors) : "—"}</span><span>{cpu(metrics?.cpuTimeP50Ms)}<span className="ml-1 text-[8px] text-muted-foreground">P50</span></span>
        </div>; })}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[9px] text-muted-foreground"><span className="flex items-center gap-1.5"><Cloudflare.Color size={12} />Workers · 24h</span><span title={cloudflare ? `${time.format(cloudflare.windowStart)} — ${time.format(cloudflare.windowEnd)} · UTC+8` : undefined}>Vercel · 5min / Workers · 1h</span></div>
      </section>
    <RepoContributions data={github} />
    <details className="border-t border-line px-4 py-2 text-[9px] text-muted-foreground">
      <summary className="w-fit cursor-pointer">统计口径</summary>
      <div className="mt-2 space-y-1 leading-5"><p>浏览与访客：前 7 个完整 UTC 日。评分：最近 7 天的生产访问，P75。</p><p>Vercel：12 小时函数调用。Workers：24 小时采样调用，错误为执行错误。各图独立刻度。</p><p>指标 5 分钟、部署 1 分钟、仓库 30 分钟更新；黄点表示数据待更新。</p></div>
    </details>
  </Card>;
}
