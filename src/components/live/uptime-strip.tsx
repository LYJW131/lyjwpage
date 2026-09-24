"use client";

import type { SentryUptime, UptimeDay } from "@/lib/sentry-status-types";
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
const STATUS: Record<SentryUptime["status"], { label: string; className: string }> = {
  up: { label: "Operational", className: "text-live" },
  down: { label: "Down", className: "text-red-500" },
  unknown: { label: "Unknown", className: "text-muted-foreground" },
};

/**
 * 站点卡片里的在线率一条，状态页的写法：顶上一行站名和此刻状态，中间每天一格，下面一行「30 days ago —— 99.97% uptime
 * —— Today」。数据来自 Sentry 对 lyjw.me 的每分钟探测（HEAD /api/version，lib/sentry-status）；
 * 拿不到时整条不渲染，交给卡片其余部分。
 */
export function UptimeStrip({ uptime }: { uptime: SentryUptime }) {
  // 缓存里旧形状的那份没有 status，按还没探测过处理
  const status = STATUS[uptime.status] ?? STATUS.unknown;
  return (
    <div className="border-t border-line px-4 py-4 md:px-5">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{uptime.url ? new URL(uptime.url).host : "lyjw.me"}</span>
        <span className={cn("text-xs", status.className)} title={`Per-minute check · HEAD ${uptime.url || "https://lyjw.me/"}`}>{status.label}</span>
      </div>
      {uptime.days.length > 0 && (
        <div className="flex h-6 gap-[3px]" role="img" aria-label={`Daily availability, last ${uptime.days.length} days`}>
          {uptime.days.map((entry) => {
            const tone = dayTone(entry);
            const failed = entry.failure ? ` · ${number.format(entry.failure)} failed checks` : "";
            return <span key={entry.dayStart} title={`${day.format(entry.dayStart)} · ${tone.label}${failed}`} className={cn("min-w-0 flex-1 rounded-[2px]", tone.className)} />;
          })}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span className="shrink-0">{uptime.days.length || 30} days ago</span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0 whitespace-nowrap"
          title={`24h ${percent(uptime.availability24h)} · checked every ${uptime.intervalSeconds}s${uptime.url ? ` · ${uptime.url}` : ""}`}>
          {percent(uptime.availability30d)} uptime
        </span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0">Today</span>
      </div>
    </div>
  );
}
