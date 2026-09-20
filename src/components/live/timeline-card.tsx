"use client";

import Image from "next/image";
import { Clapperboard, Dumbbell, Gamepad2, Rocket, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStatus } from "@/hooks/use-status";
import {
  PLAYING_PATH,
  VERCEL_DEPLOYMENTS_PATH,
  WATCHING_PATH,
  WORKOUTS_PATH,
} from "@/lib/paths";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import {
  composeTimeline,
  groupTimelineByDay,
  timelineDayLabel,
  timelineTime,
  type TimelineEvent,
  type TimelineKind,
} from "@/lib/timeline";
import type { VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";
import type {
  PlaystationPlayingPayload,
  StatusResponse,
  TrophiesSummaryPayload,
  WorkoutsPayload,
} from "@/lib/types";
import type { WatchingPayload } from "@shared/emby";
import { cn } from "@/lib/utils";

/**
 * 时间线：各来源已有的带时刻条目并成一条流水。合并规则在 lib/timeline。
 *
 * **不轮询。** 四路都读各自卡片已经在用的那个 SWR 键，缓存是共享的：这里只当个
 * 读者，取数、推送、重取全由原来那张卡驱动。自己再挂一个计时器的话，两个周期
 * 错开 SWR 的去重窗口就会把同一条端点打两遍。
 *
 * 奖杯那路没有键可读：它的首屏字段是提要、单端点是整份目录，两者形状不同
 * （`bootstrap: false`，见 status-views），浏览器从不裸读它。所以奖杯只吃服务端
 * 传来的那一份 —— 它随首屏缓存失效而更新，不跟着推送走，比别的几路慢一拍。
 */

const ICONS: Record<TimelineKind, LucideIcon> = {
  watch: Clapperboard,
  play: Gamepad2,
  trophy: Trophy,
  workout: Dumbbell,
  deploy: Rocket,
};

/**
 * 图标那一格的颜色。和卡片其余部分一样克制，只够把五类分开。
 * 底色和字色分开存：有缩略图的行只用得上字色那半，拆字符串取太脆。
 */
const TONES: Record<TimelineKind, { bg: string; fg: string }> = {
  watch: { bg: "bg-sky-400/10", fg: "text-sky-600 dark:text-sky-400" },
  play: { bg: "bg-indigo-400/10", fg: "text-indigo-600 dark:text-indigo-400" },
  trophy: { bg: "bg-amber-400/10", fg: "text-amber-600 dark:text-amber-400" },
  workout: { bg: "bg-lime-400/10", fg: "text-lime-600 dark:text-lime-400" },
  deploy: { bg: "bg-neutral-400/10", fg: "text-muted-foreground" },
};

const KIND_LABELS: Record<TimelineKind, string> = {
  watch: "Watched",
  play: "Played",
  trophy: "Unlocked",
  workout: "Trained",
  deploy: "Deployed",
};

/** 缩略图按 CSS 像素给的边长，PSN 那路按它的三倍在源站现缩 */
const THUMB_PX = 28;

function Thumb({ event }: { event: TimelineEvent }) {
  const Icon = ICONS[event.kind];
  /**
   * 奖杯图标不经 `playstationImage`：那几档缩图是狠压缩 JPEG，杯面原画在小尺寸上
   * 糊得可见，原图 512² 才是唯一的高质量档（理由见 lib/playstation-image）。
   * 游戏封面相反，源站现缩比拉原图便宜得多。
   */
  const src = event.kind === "play"
    ? playstationImage(event.imageUrl, THUMB_PX * PLAYSTATION_IMAGE_SCALE)
    : event.imageUrl;

  if (!src) {
    return (
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-sm",
          TONES[event.kind].bg,
          TONES[event.kind].fg,
        )}
        aria-hidden="true"
      >
        <Icon size={14} />
      </span>
    );
  }

  return (
    <span className="relative size-7 shrink-0 overflow-hidden rounded-sm bg-muted">
      <Image
        // 尺寸在源站或 R2 那边就定了，不进图片管道；理由见 lib/playstation-image
        src={src}
        alt=""
        width={THUMB_PX}
        height={THUMB_PX}
        loading="lazy"
        unoptimized
        className={cn("size-7", event.portrait ? "object-cover object-top" : "object-cover")}
      />
    </span>
  );
}

function Row({ event }: { event: TimelineEvent }) {
  const Icon = ICONS[event.kind];
  const body = (
    <>
      <time
        dateTime={new Date(event.at).toISOString()}
        className="label-mono w-[4.5rem] shrink-0 tabular-nums text-muted-foreground"
      >
        {timelineTime(event.at)}
      </time>
      <Thumb event={event} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {/* 图标在有缩略图时也保留：缩略图认不出类别，这一格才是「这是什么事」 */}
        {event.imageUrl && (
          <Icon size={12} className={cn("shrink-0 self-center", TONES[event.kind].fg)} aria-hidden="true" />
        )}
        <span className="truncate text-sm">{event.title}</span>
        {event.subtitle && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {event.subtitle}
          </span>
        )}
      </span>
      {event.meta && (
        <span className="label-mono shrink-0 tabular-nums text-muted-foreground">{event.meta}</span>
      )}
    </>
  );

  const className = "flex h-full w-full items-center gap-3 px-4 text-left transition-colors hover:bg-surface-hover";
  return (
    // 高度写在 li 上、分隔线算进这 44px（border-box）：行高一像素不差，
    // 吸附停稳后多栏才对得齐，最后一行少一条线也不会矮一格
    <li className="h-11 snap-start border-b border-line last:border-b-0">
      <span className="sr-only">{KIND_LABELS[event.kind]}: </span>
      {event.link ? (
        <a href={event.link} target="_blank" rel="noreferrer noopener" className={className}>
          {body}
        </a>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

export function TimelineCard({
  watchingFallback,
  playingFallback,
  workoutsFallback,
  deploymentsFallback,
  trophies,
  className,
}: {
  watchingFallback: StatusResponse<WatchingPayload>;
  playingFallback: StatusResponse<PlaystationPlayingPayload>;
  workoutsFallback: StatusResponse<WorkoutsPayload>;
  deploymentsFallback: StatusResponse<VercelDeploymentsPayload>;
  /** 服务端那一份提要，见文件头：这一路没有可读的浏览器缓存键 */
  trophies: StatusResponse<TrophiesSummaryPayload>;
  className?: string;
}) {
  // 四路一律 0 间隔 + 不在挂载和聚焦时回源：取数由各自那张卡驱动，这里只读缓存
  const reader = { revalidateOnMount: false, revalidateOnFocus: false } as const;
  const { data: watching } = useStatus<WatchingPayload>(WATCHING_PATH, 0, {
    fallback: watchingFallback,
    ...reader,
  });
  const { data: playing } = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, 0, {
    fallback: playingFallback,
    ...reader,
  });
  const { data: workouts } = useStatus<WorkoutsPayload>(WORKOUTS_PATH, 0, {
    fallback: workoutsFallback,
    ...reader,
  });
  const { data: deployments } = useStatus<VercelDeploymentsPayload>(VERCEL_DEPLOYMENTS_PATH, 0, {
    fallback: deploymentsFallback,
    ...reader,
  });

  const events = composeTimeline({
    watching,
    playing,
    trophies: trophies.ok ? trophies.data : undefined,
    workouts,
    deployments,
  });
  const days = groupTimelineByDay(events);
  // 首帧没有「当下」，那一遍全部按绝对日期画，挂载后 Today / Yesterday 才出现
  const now = useMountedAt();
  // 哪一路都还没数据时，说的是「还没收到」而不是「最近什么都没干」
  const awaiting = !watching && !playing && !workouts && !deployments && !trophies.ok;

  return (
    <Card
      id="timeline"
      label="Timeline"
      action="Watched · Played · Unlocked · Trained · Shipped"
      className={cn("scroll-mt-28", className)}
    >
      {events.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {awaiting ? "Awaiting activity reports" : "No recent activity"}
        </p>
      ) : (
        <div className="max-h-[352px] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden snap-y snap-mandatory">
          {days.map((day) => (
            <section key={day.key} aria-label={timelineDayLabel(day.key, now)}>
              {/*
                日期条吸在滚动容器顶上。它不参与吸附（没有 snap-start）——
                吸附点只给条目行，滚动停稳后永远是整行对齐。
              */}
              <h4 className="label-mono sticky top-0 z-10 border-b border-line bg-muted px-4 py-1.5 text-muted-foreground">
                {timelineDayLabel(day.key, now)}
              </h4>
              <ul>
                {day.events.map((event) => (
                  <Row key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
