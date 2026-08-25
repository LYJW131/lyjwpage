import Image from "next/image";
import Link from "next/link";

import { PsPlusBadge } from "@/components/trophies/ps-plus";
import { TrophyMetal, trophyTypeLabel } from "@/components/trophies/trophy-metal";
import { countTrophies } from "@/lib/trophy-counts";
import { site } from "@/lib/site";
import type { StatusResponse, TrophiesSummaryPayload, TrophyType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES: TrophyType[] = ["platinum", "gold", "silver", "bronze"];

function formatUnlock(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: site.timezone,
    month: "numeric",
    day: "numeric",
  });
}

function Count({ type, value }: { type: TrophyType; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <TrophyMetal kind={type} size="sm" />
      <div className="leading-tight">
        <div className="label-mono text-muted-foreground">{trophyTypeLabel(type)}</div>
        <div className="text-sm font-medium tabular-nums">{value}</div>
      </div>
    </div>
  );
}

/**
 * 首屏提要。只吃服务端裁过的摘要，不订阅 /api/status/trophies ——
 * 那个端点是整份目录，和这里的形状不是一份，塞进同一个 SWR 键会互相冲掉。
 */
export function TrophyTeaser({
  fallback,
  embedded = false,
}: {
  fallback: StatusResponse<TrophiesSummaryPayload>;
  /** 嵌在 PlayStation 整块里：不再自己套一张纸卡片，也不重复「陈列室」。 */
  embedded?: boolean;
}) {
  if (!fallback.ok) return null;
  const data = fallback.data;
  const defined = countTrophies(data.defined);
  const recent = data.recent[0];

  return (
    <Link
      href="/trophies"
      className={cn(
        "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:gap-5",
        "transition-colors hover:bg-surface-hover",
        embedded
          ? "border-b border-line"
          : "paper-card mb-3 border border-line-strong bg-surface",
      )}
    >
      <div className="flex items-center gap-3 sm:min-w-36">
        <div className="relative grid h-14 w-14 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90 text-line" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              className="text-foreground"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={2 * Math.PI * 15}
              strokeDashoffset={2 * Math.PI * 15 * (1 - data.profile.levelProgress / 100)}
              strokeLinecap="butt"
            />
          </svg>
          {data.profile.avatarUrl ? (
            <Image
              src={data.profile.avatarUrl}
              alt={data.profile.onlineId}
              width={40}
              height={40}
              sizes="40px"
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <TrophyMetal kind="level" size="md" className="h-8 w-8" />
          )}
        </div>
        <div className="leading-tight">
          <div className="label-mono text-muted-foreground">奖杯等级</div>
          <div className="flex items-center gap-1.5">
            <div className="text-xl font-bold tabular-nums">{data.profile.level}</div>
            {data.profile.plus ? (
              <PsPlusBadge className="label-mono text-muted-foreground" markClassName="h-4 w-4" />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-4 gap-2 sm:gap-4">
        {TYPES.map((type) => (
          <Count key={type} type={type} value={data.profile.earned[type]} />
        ))}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-line pt-3 sm:max-w-64 sm:border-t-0 sm:pt-0 sm:text-right">
        <div className="min-w-0">
          <div className="label-mono text-muted-foreground">
            {data.earnedCount} / {defined}
            {defined > 0 ? ` · ${Math.round((data.earnedCount / defined) * 100)}%` : ""}
          </div>
          {recent ? (
            <div className="mt-0.5 flex items-center gap-2 sm:justify-end">
              {recent.iconUrl ? (
                <Image
                  src={recent.iconUrl}
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="h-5 w-5 shrink-0 object-cover"
                />
              ) : null}
              <div className="min-w-0 truncate text-xs text-muted-foreground">
                {formatUnlock(recent.earnedAt)} · {recent.trophyName}
              </div>
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-muted-foreground">{data.titleCount} 款游戏</div>
          )}
        </div>
        {embedded ? null : (
          <span className="label-mono shrink-0 text-foreground">陈列室 →</span>
        )}
      </div>
    </Link>
  );
}
