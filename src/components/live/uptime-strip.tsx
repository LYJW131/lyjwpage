"use client";

import NumberFlow from "@number-flow/react";

import type { SentryUptime, UptimeDay } from "@/lib/sentry-status-types";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: site.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const number = new Intl.NumberFormat("en-US");
const PERCENT_FORMAT = { style: "percent", maximumFractionDigits: 2 } as const;

/** 99.95% 这种要看到小数点后两位才有区别；整 100 就写 100% */
function percent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  const value = ratio * 100;
  return value >= 99.995 ? "100%" : `${value.toFixed(2)}%`;
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

/**
 * 站点卡片里的在线率一条：左边 30 天可用率，右边每天一格。数据来自 Sentry 对
 * lyjw.me 的每分钟探测（HEAD /api/version，lib/sentry-status）；拿不到时整条不渲染，交给卡片其余部分。
 */
export function UptimeStrip({ uptime }: { uptime: SentryUptime }) {
  const host = uptime.url ? new URL(uptime.url).host : "lyjw.me";
  return (
    <div className="border-t border-line px-4 py-4 md:px-5">
      {/* 标签一左一右占满整条：左边说是什么，右边说统计了多久 */}
      <div className="flex justify-between label-mono text-muted-foreground">
        <span>UPTIME</span>
        <span>LAST {uptime.days.length || 30}D</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-3 md:flex-row md:items-end md:gap-8">
        <div className="shrink-0" title={`24h ${percent(uptime.availability24h)} · checked every ${uptime.intervalSeconds}s`}>
          <div className="text-3xl font-medium tracking-tight tabular-nums">
            {uptime.availability30d == null ? "—" : (
              // 截到两位小数再格式化，99.999% 不会被四舍五入成 100%
              <NumberFlow value={Math.floor(uptime.availability30d * 10_000) / 10_000} format={PERCENT_FORMAT} locales="en-US" />
            )}
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground"
            title={uptime.lastCheck ? `Last check ${clock.format(uptime.lastCheck.at)} · HTTP ${uptime.lastCheck.httpStatus ?? "—"}` : undefined}>
            {host}{uptime.lastCheck?.durationMs != null && <> · {number.format(uptime.lastCheck.durationMs)} ms</>}
          </div>
        </div>
        {uptime.days.length > 0 && (
          <div className="min-w-0 flex-1">
            <div className="flex h-6 gap-[3px]" role="img" aria-label={`Daily availability, last ${uptime.days.length} days`}>
              {uptime.days.map((entry) => {
                const tone = dayTone(entry);
                const failed = entry.failure ? ` · ${number.format(entry.failure)} failed checks` : "";
                return <span key={entry.dayStart} title={`${day.format(entry.dayStart)} · ${tone.label}${failed}`} className={cn("min-w-0 flex-1 rounded-[2px]", tone.className)} />;
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
              <span>{uptime.days.length} days ago</span>
              <span>Today</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
