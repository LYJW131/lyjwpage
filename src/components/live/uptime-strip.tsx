"use client";

import type { HealthSeries, SentryUptime, UptimeDay } from "@/lib/sentry-status-types";
import { cn } from "@/lib/utils";

const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const number = new Intl.NumberFormat("en-US");

/**
 * 99.95% 这种要看到小数点后两位才有区别。截断不四舍五入：99.999% 不会写成 100%，
 * 只有一次失败都没有才是 100%
 */
function percent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  return ratio >= 1 ? "100%" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

/**
 * 每日色块的档位，和状态页的习惯一致：全绿 / 有抖动 / 明显宕机。
 * 没有样本的日子（监测开通之前）画成底色，不冒充 100%。
 */
function dayTone(entry: UptimeDay): { className: string; label: string } {
  const total = entry.success + entry.failure;
  if (total === 0) return { className: "bg-muted", label: "No data" };
  const ratio = entry.success / total;
  if (ratio >= 0.9995) return { className: "bg-live/85", label: percent(ratio) };
  if (ratio >= 0.99) return { className: "bg-live-idle", label: percent(ratio) };
  return { className: "bg-red-500/80", label: percent(ratio) };
}

/** 状态页的叫法；down 是探测器连续失败到阈值之后才翻的 */
const STATUS: Record<HealthSeries["status"], { label: string; className: string }> = {
  up: { label: "Operational", className: "text-live" },
  down: { label: "Down", className: "text-red-500" },
  unknown: { label: "Unknown", className: "text-muted-foreground" },
};

/** 一个组件一块：顶上名字和此刻状态，中间每天一格，下面「30 days ago —— 99.97% uptime —— Today」 */
function HealthRow({ name, health, statusTitle, footTitle, unit }: {
  name: string; health: HealthSeries; statusTitle: string; footTitle: string; unit: string;
}) {
  // 缓存里旧形状的那份没有 status，按还没有记录处理
  const status = STATUS[health.status] ?? STATUS.unknown;
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{name}</span>
        <span className={cn("text-xs", status.className)} title={statusTitle}>{status.label}</span>
      </div>
      {health.days.length > 0 && (
        <div className="flex h-6 gap-[3px]" role="img" aria-label={`${name} daily availability, last ${health.days.length} days`}>
          {health.days.map((entry) => {
            const tone = dayTone(entry);
            const failed = entry.failure ? ` · ${number.format(entry.failure)} failed ${unit}` : "";
            return <span key={entry.dayStart} title={`${day.format(entry.dayStart)} · ${tone.label}${failed}`} className={cn("min-w-0 flex-1 rounded-[2px]", tone.className)} />;
          })}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span className="shrink-0">{health.days.length || 30} days ago</span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0 whitespace-nowrap" title={`24h ${percent(health.availability24h)} · ${footTitle}`}>
          {percent(health.availability30d)} uptime
        </span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0">Today</span>
      </div>
    </div>
  );
}

/**
 * 站点卡片里的在线状态，状态页的写法，一个组件一块：
 * - lyjw.me：Sentry 每分钟 HEAD /api/version。那是构建期生成的静态路由，只能说明 Vercel 还在出页面
 * - API：api Worker 分钟 cron 的 Sentry 心跳。每轮都要经过 Worker、Durable Object 和 KV，
 *   补上后端那一截；漏报、超时、报错都算失败
 * 数据来自 lib/sentry-status；两块都拿不到时整段不渲染，只缺一块就只画另一块。
 */
export function UptimeStrip({ site, api }: { site: SentryUptime | null; api: HealthSeries | null }) {
  if (!site && !api) return null;
  return (
    <div className="flex flex-col gap-5 border-t border-line px-4 py-4 md:px-5">
      {site && (
        <HealthRow name={site.url ? new URL(site.url).host : "lyjw.me"} health={site} unit="checks"
          statusTitle={`Per-minute check · HEAD ${site.url || "https://lyjw.me/"}`}
          footTitle={`checked every ${site.intervalSeconds}s`} />
      )}
      {api && (
        <HealthRow name="API" health={api} unit="heartbeats"
          statusTitle="Per-minute cron heartbeat of the api Worker (Durable Objects and KV)"
          footTitle="cron heartbeat every minute" />
      )}
    </div>
  );
}
