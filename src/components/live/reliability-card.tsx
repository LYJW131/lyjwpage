"use client";

import NumberFlow from "@number-flow/react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import type { DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import { SENTRY_PATH } from "@/lib/paths";
import type { SentryErrorSeries, SentryStatusPayload, UptimeDay } from "@/lib/sentry-status-types";
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

/**
 * 每日色块的档位，和状态页的习惯一致：全绿 / 有抖动 / 明显宕机。
 * 没有样本的日子（监测开通之前）画成底色，不冒充 100%。
 */
function dayTone(entry: UptimeDay): { className: string; label: string } {
  const total = entry.success + entry.failure;
  if (total === 0) return { className: "bg-muted", label: "No data" };
  const ratio = entry.success / total;
  if (ratio >= 0.9995) return { className: "bg-emerald-500/80 dark:bg-emerald-400/80", label: percent(ratio) };
  if (ratio >= 0.99) return { className: "bg-amber-500/80", label: percent(ratio) };
  return { className: "bg-red-500/80", label: percent(ratio) };
}

function Stat({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-medium tracking-tight tabular-nums md:text-4xl">{children}</div>
    </div>
  );
}

function UptimeBar({ days }: { days: UptimeDay[] }) {
  return (
    <div>
      <div className="flex h-8 gap-[3px]" role="img" aria-label={`Daily availability, last ${days.length} days`}>
        {days.map((entry) => {
          const tone = dayTone(entry);
          const downtime = entry.failure ? ` · ${number.format(entry.failure)} failed checks` : "";
          return (
            <span
              key={entry.dayStart}
              title={`${day.format(entry.dayStart)} · ${tone.label}${downtime}`}
              className={cn("min-w-0 flex-1 rounded-[2px]", tone.className)}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{days.length} days ago</span>
        <span>Today (UTC)</span>
      </div>
    </div>
  );
}

/** 24 根小时柱，前端在下、API 叠在上；全零时留一条基线，不画空白 */
function ErrorBars({ site: front, worker }: { site: SentryErrorSeries; worker: SentryErrorSeries }) {
  const hours = front.hourly.map((count, index) => ({ front: count, api: worker.hourly[index] ?? 0 }));
  const peak = Math.max(1, ...hours.map((hour) => hour.front + hour.api));
  return (
    <div className="flex h-10 items-end gap-[2px]" role="img" aria-label="Errors per hour, last 24 hours">
      {hours.map((hour, index) => {
        const total = hour.front + hour.api;
        return (
          <span
            key={index}
            title={`${24 - index}h ago · ${hour.front} frontend · ${hour.api} API`}
            className="flex min-w-0 flex-1 flex-col-reverse"
            style={{ height: `${Math.max(total / peak, 0.04) * 100}%` }}
          >
            {total === 0 ? (
              <span className="h-full rounded-[1px] bg-line" />
            ) : (
              <>
                <span className="rounded-[1px] bg-red-500/70" style={{ height: `${(hour.front / total) * 100}%` }} />
                <span className="rounded-[1px] bg-amber-500/80" style={{ height: `${(hour.api / total) * 100}%` }} />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Web Vitals 的官方档位：good / needs improvement / poor */
const VITALS = [
  { key: "lcpP75Ms", label: "LCP", title: "Largest Contentful Paint", good: 2500, poor: 4000, format: (v: number) => `${(v / 1000).toFixed(2)}s` },
  { key: "inpP75Ms", label: "INP", title: "Interaction to Next Paint", good: 200, poor: 500, format: (v: number) => `${Math.round(v)}ms` },
  { key: "clsP75", label: "CLS", title: "Cumulative Layout Shift", good: 0.1, poor: 0.25, format: (v: number) => String(Number(v.toFixed(3))) },
  { key: "ttfbP75Ms", label: "TTFB", title: "Time to First Byte", good: 800, poor: 1800, format: (v: number) => `${Math.round(v)}ms` },
] as const;

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

export function ReliabilityCard({ fallback, className }: {
  fallback: StatusResponse<SentryStatusPayload>;
  className?: string;
}) {
  const { data } = useStatus<SentryStatusPayload>(SENTRY_PATH, 5 * 60_000, { fallback });
  const uptime = data?.uptime, errors = data?.errors, vitals = data?.vitals, cron = data?.cron, sessions = data?.sessions;
  const errors24h = errors ? errors.site.count24h + errors.worker.count24h : null;
  const unresolved = errors ? errors.site.unresolved + errors.worker.unresolved : null;
  const host = uptime?.url ? new URL(uptime.url).host : "lyjw.me";

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
      <div className="border-b border-line px-4 py-5 md:px-5">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="UPTIME · 30D" title={`Availability of ${host}, checked every ${uptime?.intervalSeconds ?? 60}s`}>
            {percent(uptime?.availability30d)}
          </Stat>
          <Stat label="UPTIME · 24H">{percent(uptime?.availability24h)}</Stat>
          <Stat
            label="RESPONSE"
            title={uptime?.lastCheck ? `Last check ${clock.format(uptime.lastCheck.at)} · HTTP ${uptime.lastCheck.httpStatus ?? "—"}` : undefined}
          >
            {uptime?.lastCheck?.durationMs == null ? "—" : <><NumberFlow value={uptime.lastCheck.durationMs} locales="en-US" /><span className="text-lg text-muted-foreground">ms</span></>}
          </Stat>
          <Stat label="ERRORS · 24H" title={errors ? `${errors.site.count7d + errors.worker.count7d} in the last 7 days` : undefined}>
            {errors24h == null ? "—" : <NumberFlow value={errors24h} locales="en-US" />}
          </Stat>
        </div>
        {uptime && uptime.days.length > 0 && (
          <div className="mt-6">
            <UptimeBar days={uptime.days} />
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2">
        <section className="min-w-0 border-b border-line px-4 py-3 md:border-b-0 md:px-5" aria-label="Errors">
          <div className="mb-2 flex items-baseline justify-between text-[10px] text-muted-foreground">
            <span className="label-mono">Errors per hour</span>
            <span className="flex gap-3 tabular-nums">
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500/70" />Frontend <span className="text-foreground">{errors ? number.format(errors.site.count24h) : "—"}</span></span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500/80" />API <span className="text-foreground">{errors ? number.format(errors.worker.count24h) : "—"}</span></span>
            </span>
          </div>
          {errors ? <ErrorBars site={errors.site} worker={errors.worker} /> : <div className="h-10" />}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
            <span>Unresolved <span className="text-foreground">{unresolved == null ? "—" : number.format(unresolved)}</span></span>
            <span title={sessions ? `${number.format(sessions.count)} browser sessions in 24h` : undefined}>
              Crash-free sessions <span className="text-foreground">{percent(sessions?.crashFreeRate)}</span>
            </span>
          </div>
        </section>

        <section className="min-w-0 px-4 py-3 md:border-l md:border-line md:px-5" aria-label="Real user performance">
          <div className="mb-2 flex items-baseline justify-between text-[10px] text-muted-foreground">
            <span className="label-mono">Real users · p75 · 7d</span>
            <span className="tabular-nums">{vitals?.samples ? `${number.format(vitals.samples)} page loads` : "Awaiting visits"}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {VITALS.map((vital) => {
              const value = vitals?.[vital.key];
              return (
                <div key={vital.key} title={vital.title}>
                  <div className="text-[10px] text-muted-foreground">{vital.label}</div>
                  <div className={cn("mt-0.5 text-lg font-medium tabular-nums lg:text-xl", value == null ? "text-muted-foreground" : vitalTone(value, vital.good, vital.poor))}>
                    {value == null ? "—" : vital.format(value)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
            <span className="flex items-center gap-1.5" title={cron?.lastCheckInAt ? `Last check-in ${clock.format(cron.lastCheckInAt)}` : "Every-minute cron on the API Worker"}>
              API cron
              <span className={cn("size-1.5 rounded-full", cron?.status === "ok" ? "bg-live" : cron && cron.status !== "unknown" ? "bg-red-500" : "bg-live-off")} />
              <span className="text-foreground">{cron ? CRON_LABEL[cron.status] : "—"}</span>
            </span>
            {uptime?.lastCheck && <span>Checked {clock.format(uptime.lastCheck.at)}</span>}
          </div>
        </section>
      </div>
    </Card>
  );
}
