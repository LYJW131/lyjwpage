import Image from "@/components/app-image";
import { PsPlusMark } from "@/components/trophies/ps-plus";
import { TrophyMetal, trophyTypeLabel } from "@/components/trophies/trophy-metal";
import {
  PLAYSTATION_IMAGE_SCALE,
} from "@/lib/playstation-image";
import type { PlaystationPresenceKind } from "@/lib/playstation-presence";
import { site } from "@/lib/site";
import type {
  StatusResponse,
  TrophiesSummaryPayload,
  TrophyType,
  TrophyUnlock,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESENCE_DOT: Record<PlaystationPresenceKind, { className: string; label: string }> = {
  online: { className: "bg-live", label: "Online" },
  busy: { className: "bg-live-idle", label: "Busy" },
  offline: { className: "bg-live-off", label: "Offline" },
};

const TYPES: TrophyType[] = ["platinum", "gold", "silver", "bronze"];

const RECENT_PX = 28;

const AVATAR_PX = 40;

function formatUnlock(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: site.timezone,
    month: "short",
    day: "numeric",
  });
}

function Count({ type, value }: { type: TrophyType; value: number }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-1.5 gap-y-1 leading-tight sm:gap-y-0">
      <TrophyMetal kind={type} size="sm" className="max-sm:row-start-2 sm:row-span-2" />
      <div className="label-mono text-muted-foreground max-sm:col-span-2 max-sm:row-start-1">
        {trophyTypeLabel(type)}
      </div>
      <div className="text-sm font-medium tabular-nums max-sm:row-start-2">{value}</div>
    </div>
  );
}

export function TrophyTeaser({
  fallback,
  embedded = false,
  presence = null,
  onRecentClick,
}: {
  fallback: StatusResponse<TrophiesSummaryPayload>;
  embedded?: boolean;
  presence?: PlaystationPresenceKind | null;
  onRecentClick: (unlock: TrophyUnlock) => void;
}) {
  if (!fallback.ok) return null;
  const data = fallback.data;
  const recent = data.recent[0];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-3 py-3 md:flex-row md:flex-wrap md:items-center md:gap-x-5 lg:flex-nowrap",
        embedded
          ? "border-b border-line"
          : "paper-card mb-3 border border-line-strong bg-surface",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="relative grid h-14 w-14 shrink-0 place-items-center"
          title={`${data.profile.trophyPoint.toLocaleString("en-US")} / ${data.profile.levelNextPoint.toLocaleString("en-US")} pts`}
        >
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
          <div className="relative grid h-10 w-10 place-items-center">
            {data.profile.avatarUrl ? (
              <Image
                src={data.profile.avatarUrl}
                alt={data.profile.onlineId}
                /* next/image 只生成 1x/2x 档，申报半个 3x 目标以覆盖高 DPR；sizes 会引入过大的 src 回退。 */
                width={(AVATAR_PX * PLAYSTATION_IMAGE_SCALE) / 2}
                height={(AVATAR_PX * PLAYSTATION_IMAGE_SCALE) / 2}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <TrophyMetal kind="level" size="md" className="h-8 w-8" />
            )}
            {presence ? (
              <span
                className={cn(
                  "absolute right-0 bottom-0 z-10 size-2.5 rounded-full ring-2 ring-surface",
                  PRESENCE_DOT[presence].className,
                )}
                title={PRESENCE_DOT[presence].label}
                role="status"
                aria-label={PRESENCE_DOT[presence].label}
              />
            ) : null}
          </div>
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{data.profile.onlineId}</span>
            {data.profile.plus ? <PsPlusMark className="h-3.5 w-3.5" /> : null}
          </div>
          <div className="label-mono mt-1.5 text-muted-foreground">
            Trophy Level {data.profile.level}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 border-t border-line pt-3 md:ml-auto md:shrink-0 md:gap-5 md:border-t-0 md:pt-0 lg:ml-0">
        {TYPES.map((type) => (
          <Count key={type} type={type} value={data.earned[type]} />
        ))}
      </div>

      {recent ? (
        <div className="min-w-0 border-t border-line pt-3 md:basis-full lg:ml-auto lg:max-w-64 lg:basis-auto lg:border-t-0 lg:pt-0 lg:text-right">
          <button
            type="button"
            onClick={() => onRecentClick(recent)}
            aria-label={`Open ${recent.titleName} trophies at “${recent.trophyName}”`}
            className="-mx-2 block cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-hover lg:text-right"
          >
            <div className="label-mono text-muted-foreground">
              Latest · {formatUnlock(recent.earnedAt)}
            </div>
            <div className="mt-1.5 flex items-center gap-2 lg:justify-end">
              {recent.iconUrl ? (
                <Image
                  src={recent.iconUrl}
                  alt=""
                  width={RECENT_PX}
                  height={RECENT_PX}
                  unoptimized
                  className="h-7 w-7 shrink-0 object-cover"
                />
              ) : null}
              <div className="min-w-0 truncate text-sm">
                {recent.trophyName}
                <span className="text-muted-foreground"> · {recent.titleName}</span>
              </div>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  );
}
