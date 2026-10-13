"use client";

import { Bot, CodeXml, Cpu, Footprints, Gamepad2, GitCommitHorizontal, Music, Trophy, Tv, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { PULSE_REFRESH_MS } from "@/components/live/pulse-card";
import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { topicStrip } from "@/lib/digest-strips";
import { DIGEST_PATH, PULSE_PATH } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { DigestPayload, DigestTopic } from "@shared/digest";
import { DIGEST_STALE_MS } from "@shared/freshness";
import { modelLabel } from "@shared/god-chat-tiers";
import type { PulsePayload, StatusResponse } from "@shared/types";

const updatedTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  hour: "numeric",
  minute: "2-digit",
});

const updatedDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TOPICS: Record<DigestTopic, { label: string; icon: LucideIcon; tone: string }> = {
  coding: { label: "Coding", icon: CodeXml, tone: "var(--signal-blue)" },
  agents: { label: "Agents", icon: Bot, tone: "var(--claude)" },
  tokens: { label: "Tokens", icon: Cpu, tone: "var(--signal-orange)" },
  site: { label: "This site", icon: GitCommitHorizontal, tone: "var(--signal-green)" },
  music: { label: "Music", icon: Music, tone: "var(--signal-red)" },
  watching: { label: "Watching", icon: Tv, tone: "var(--signal-violet)" },
  gaming: { label: "Gaming", icon: Gamepad2, tone: "var(--pulse-both)" },
  trophies: { label: "Trophies", icon: Trophy, tone: "var(--signal-yellow)" },
  fitness: { label: "Fitness", icon: Footprints, tone: "var(--activity-move)" },
};

function Strip({ bins }: { bins: number[] }) {
  return (
    <svg viewBox={`0 0 ${bins.length} 10`} preserveAspectRatio="none" className="h-5 w-full sm:h-7" role="img" aria-label="When it happened over the past 24 hours">
      <line x1="0" x2={bins.length} y1="10" y2="10" stroke="var(--line)" vectorEffect="non-scaling-stroke" />
      {bins.map((value, index) => {
        if (value <= 0.02) return null;
        const height = Math.max(1, value * 10);
        return <rect key={index} x={index + 0.12} width="0.76" y={10 - height} height={height} fill="var(--tone)" />;
      })}
    </svg>
  );
}

export function DigestCard({
  fallback,
  pulseFallback,
  className,
}: {
  fallback: StatusResponse<DigestPayload>;
  pulseFallback: StatusResponse<PulsePayload>;
  className?: string;
}) {
  const { data, updatedAt, servedAt } = useStatus<DigestPayload>(DIGEST_PATH, { fallback });
  const { data: pulse } = useStatus<PulsePayload>(PULSE_PATH, PULSE_REFRESH_MS, { fallback: pulseFallback });
  const stale = useStale(updatedAt, DIGEST_STALE_MS, servedAt);
  if (!data || !updatedAt) return null;

  return (
    <Card id="digest" className={cn("scroll-mt-28", className)}>
      <div className="flex flex-col gap-3.5 p-4 pl-4.5 lg:p-5">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Past 24 hours</p>
          <h2 className="text-xl font-semibold leading-tight tracking-[-0.02em] text-balance sm:text-2xl">{data.headline}</h2>
        </div>
        <ul className={cn("grid grid-cols-1 gap-2.5 sm:gap-3", data.highlights.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3", stale && "opacity-60")}>
          {data.highlights.map((item) => {
            const { label, icon: Icon, tone } = TOPICS[item.topic] ?? TOPICS.coding;
            // 时间条画的是此刻往前 24 小时；摘要过期后数字和时间条对不上同一段时间，就不画了。
            const strip = pulse && !stale ? topicStrip(item.topic, pulse) : null;
            return (
              <li
                key={item.topic}
                className="flex flex-col gap-2 border border-t-3 border-line border-t-(--tone) bg-muted/60 p-3"
                style={{ "--tone": tone } as CSSProperties}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="grid size-6 place-items-center bg-(--tone)/15 text-(--tone)">
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                  <span className="label-mono uppercase tracking-wide">{label}</span>
                </div>
                <div className="flex items-baseline gap-2.5 sm:flex-col sm:items-start sm:gap-1">
                  <span className="whitespace-nowrap text-3xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-(--tone) sm:text-4xl">
                    {item.figure}
                  </span>
                  <span className="text-sm leading-snug text-muted-foreground text-pretty">{item.caption}</span>
                </div>
                {strip && <Strip bins={strip} />}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground" title={`${updatedDay.format(updatedAt)} UTC+8`}>
          {stale ? `Not updated since ${updatedDay.format(updatedAt)}` : `${modelLabel(data.model)} · updated ${updatedTime.format(updatedAt)}`}
        </p>
      </div>
    </Card>
  );
}
