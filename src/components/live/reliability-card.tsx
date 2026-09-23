"use client";

import NumberFlow from "@number-flow/react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import type { DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import { SENTRY_PATH } from "@/lib/paths";
import type { SentryStatusPayload, UptimeDay } from "@/lib/sentry-status-types";
import { site } from "@/lib/site";
import type { StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Simple Icons 的 Sentry 标（CC0）；LobeHub 没有收这一家，单色随文字色 */
function SentryMark({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z" />
    </svg>
  );
}


const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: site.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const number = new Intl.NumberFormat("en-US");

/** 99.95% 这种要看到小数点后两位才有区别；整 100 就写 100% */
function percent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  const value = ratio * 100;
  return value >= 99.995 ? "100%" : `${value.toFixed(2)}%`;
}

const PERCENT_FORMAT = { style: "percent", maximumFractionDigits: 2 } as const;

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

/** Web Vitals 的官方档位：good / needs improvement / poor */
function vitalTone(value: number, good: number, poor: number) {
  return value <= good ? "text-emerald-600 dark:text-emerald-400" : value <= poor ? "text-amber-600" : "text-red-500";
}

const CRON_LABEL: Record<NonNullable<SentryStatusPayload["cron"]>["status"], string> = {
  ok: "OK",
  error: "Failing",
  missed: "Missed",
  timeout: "Timed out",
  unknown: "Waiting",
};

function uptimeTone(status: string | undefined): DotTone {
  return status === "up" ? "live" : status === "down" ? "off" : "idle";
}

/** 下排一格：小标签 + 一个数。细节都放进 title，版面只留结论 */
function Metric({ label, title, className, children }: { label: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3 md:px-5" title={title}>
      <div className="label-mono truncate text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 truncate text-xl font-medium tabular-nums", className)}>{children}</div>
    </div>
  );
}

export function ReliabilityCard({ fallback, className }: {
  fallback: StatusResponse<SentryStatusPayload>;
  className?: string;
}) {
  const { data } = useStatus<SentryStatusPayload>(SENTRY_PATH, 5 * 60_000, { fallback });
  const uptime = data?.uptime, errors = data?.errors, vitals = data?.vitals, cron = data?.cron, sessions = data?.sessions;
  const host = uptime?.url ? new URL(uptime.url).host : "lyjw.me";
  const errors24h = errors ? errors.site.count24h + errors.worker.count24h : null;
  const vital = (value: number | null | undefined, good: number, poor: number) =>
    value == null ? "text-muted-foreground" : vitalTone(value, good, poor);
  const vitalsTitle = vitals?.samples ? `p75 of ${number.format(vitals.samples)} real page loads, last 7 days` : "Real visitors, p75 over 7 days";

  return (
    <Card
      id="reliability"
      label="RELIABILITY"
      tone={uptimeTone(uptime?.status)}
      className={cn("scroll-mt-28", className)}
      action={
        <a href={site.sentry} target="_blank" rel="noreferrer" aria-label="Sentry dashboard" className="flex hover:text-foreground">
          <SentryMark />
        </a>
      }
    >
      <div className="flex flex-col gap-4 border-b border-line px-4 py-5 md:flex-row md:items-end md:gap-8 md:px-5">
        <div className="shrink-0" title={uptime ? `24h ${percent(uptime.availability24h)} · checked every ${uptime.intervalSeconds}s` : undefined}>
          <div className="label-mono text-muted-foreground">UPTIME · 30D</div>
          <div className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
            {uptime?.availability30d == null ? "—" : (
              // 截到两位小数再格式化，99.999% 不会被四舍五入成 100%
              <NumberFlow value={Math.floor(uptime.availability30d * 10_000) / 10_000} format={PERCENT_FORMAT} locales="en-US" />
            )}
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-muted-foreground"
            title={uptime?.lastCheck ? `Last check ${clock.format(uptime.lastCheck.at)} · HTTP ${uptime.lastCheck.httpStatus ?? "—"}` : undefined}>
            {host}{uptime?.lastCheck?.durationMs != null && <> · {number.format(uptime.lastCheck.durationMs)} ms</>}
          </div>
        </div>
        {uptime && uptime.days.length > 0 && (
          <div className="min-w-0 flex-1">
            <div className="flex h-7 gap-[3px]" role="img" aria-label={`Daily availability, last ${uptime.days.length} days`}>
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

      {/* 六格同一种样式：窄屏三列两行，宽屏一行；1px 缝靠底色透出来当分隔线 */}
      <div className="grid grid-cols-3 gap-px bg-line md:grid-cols-6">
        <Metric
          label="ERRORS"
          title={errors ? `Last 24h · Frontend ${number.format(errors.site.count24h)} · API ${number.format(errors.worker.count24h)} · ${number.format(errors.site.unresolved + errors.worker.unresolved)} unresolved` : undefined}
        >
          {errors24h == null ? "—" : number.format(errors24h)}
        </Metric>
        <Metric label="CRASH-FREE" title={sessions ? `${number.format(sessions.count)} browser sessions in 24h` : undefined}>
          {percent(sessions?.crashFreeRate)}
        </Metric>
        <Metric label="LCP" title={`Largest Contentful Paint · ${vitalsTitle}`} className={vital(vitals?.lcpP75Ms, 2500, 4000)}>
          {vitals?.lcpP75Ms == null ? "—" : `${(vitals.lcpP75Ms / 1000).toFixed(2)}s`}
        </Metric>
        <Metric label="INP" title={`Interaction to Next Paint · ${vitalsTitle}`} className={vital(vitals?.inpP75Ms, 200, 500)}>
          {vitals?.inpP75Ms == null ? "—" : `${Math.round(vitals.inpP75Ms)}ms`}
        </Metric>
        <Metric label="CLS" title={`Cumulative Layout Shift · ${vitalsTitle}`} className={vital(vitals?.clsP75, 0.1, 0.25)}>
          {vitals?.clsP75 == null ? "—" : String(Number(vitals.clsP75.toFixed(3)))}
        </Metric>
        <Metric label="API CRON" title={cron?.lastCheckInAt ? `Every-minute cron · last check-in ${clock.format(cron.lastCheckInAt)}` : "Every-minute cron on the API Worker"}>
          <span className="flex items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", cron?.status === "ok" ? "bg-live" : cron && cron.status !== "unknown" ? "bg-red-500" : "bg-live-off")} />
            {cron ? CRON_LABEL[cron.status] : "—"}
          </span>
        </Metric>
      </div>
    </Card>
  );
}
