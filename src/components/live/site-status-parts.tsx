"use client";

import { Container } from "lucide-react";
import { useStale } from "@/hooks/use-stale";
import { dateTimeText } from "@/lib/date-time-text";
import { cn } from "@/lib/utils";
import type { ReporterName, ReporterStat } from "@shared/reporter-ledger";
import { site } from "@shared/site";

export const number = new Intl.NumberFormat("en-US");
const timeDate = new Intl.DateTimeFormat("en-US", { timeZone: site.timezone, month: "short", day: "numeric" });
const timeClock = new Intl.DateTimeFormat("en-US", { timeZone: site.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
export const time = { format: (at: number | Date) => dateTimeText(at, timeDate, timeClock) };

export function CollectionWindow({ start, end }: { start?: number; end?: number }) {
  if (start == null || end == null) return null;
  const minutes = Math.round((end - start) / 60_000);
  const duration = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return <span className="ml-auto whitespace-nowrap" title={`${time.format(start)} — ${time.format(end)} · UTC+8`}>Last {duration}</span>;
}

export function CommitSha({ commit }: { commit: { sha: string; branch: string | null; message: string | null } | null | undefined }) {
  if (!commit) return null;
  return <a href={`${site.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer"
    title={commit.message ? `${commit.branch ?? "main"} · ${commit.message}` : commit.branch ?? undefined}
    className="-mt-2 ml-auto shrink-0 pt-2 font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline">{commit.sha.slice(0, 7)}</a>;
}

function Fact({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return <span className="whitespace-nowrap" title={title}>{label} <span className={cn("text-foreground", className)}>{value}</span></span>;
}

export function ErrBadge({ count, title }: { count: number | null | undefined; title: string }) {
  if (count == null) return null;
  return <span title={title} className={cn("shrink-0 text-2xs tabular-nums", count ? "text-signal-red" : "text-muted-foreground")}>{number.format(count)} err</span>;
}

const rtt = (ms: number | null | undefined) => ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

export function ReporterTile({ name, stat, staleMs, servedAt, title }: {
  name: ReporterName; stat: ReporterStat | null | undefined; staleMs: number;
  servedAt: number | undefined;
  title?: string;
}) {
  const stale = useStale(stat?.lastPushAt, staleMs, servedAt);
  return <li className="bg-surface px-4 py-2.5 lg:px-5" title={title}>
    <div className="flex min-w-0 items-center gap-1.5 text-2xs leading-4">
      <Container size={12} className="shrink-0" aria-hidden />
      <a href={`${site.repo}/tree/main/reporters/${name}`} target="_blank" rel="noreferrer" className="-my-1 min-w-0 truncate py-1 hover:underline">{name}</a>
      {stat && stale ? <span className="shrink-0 text-2xs text-signal-red">offline</span>
        : <ErrBadge count={stat?.errors} title="Errors the reporter logged itself in the window: failed pushes, failed collection, data the site rejected" />}
      <CommitSha commit={stat?.commit ? { sha: stat.commit, branch: null, message: `${name} image` } : null} />
    </div>
    <div className="mt-1 flex gap-x-3 text-2xs tabular-nums text-muted-foreground">
      <Fact label="Push" value={stat ? number.format(stat.pushes) : "—"} title="Reports this reporter pushed successfully" />
      <Fact label="RTT" value={rtt(stat?.rttMs)} title="Median round trip of a successful push to the core Worker" />
      <CollectionWindow start={stat?.start} end={stat?.end} />
    </div>
  </li>;
}
