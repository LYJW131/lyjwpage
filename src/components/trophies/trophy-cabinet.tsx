"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { GameFlags } from "@/components/trophies/game-flags";
import { PsPlusBadge } from "@/components/trophies/ps-plus";
import { TrophyMetal, trophyTypeLabel } from "@/components/trophies/trophy-metal";
import { useStatus } from "@/hooks/use-status";
import { countTrophies } from "@/lib/trophy-counts";
import { TROPHIES_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type {
  StatusResponse,
  TrophiesPayload,
  Trophy,
  TrophyTitle,
  TrophyType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10 * 60_000;
const TYPES: TrophyType[] = ["platinum", "gold", "silver", "bronze"];

type SortKey = "updated" | "progress" | "play" | "name";
type FilterKey = "all" | "incomplete" | "complete" | "unearned";

function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: site.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatMonth(key: string): string {
  const [year, month] = key.split("-");
  return `${Number(year)}/${Number(month)}`;
}

function monthKey(ms: number): string {
  return new Date(ms).toLocaleString("en-CA", {
    timeZone: site.timezone,
    year: "numeric",
    month: "2-digit",
  });
}

function playTime(milliseconds: number | null, playCount: number): string {
  if (milliseconds == null) {
    return playCount > 0 ? `游玩 ${playCount} 次` : "尚无游玩记录";
  }
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) return `累计 ${Math.round(hours)} 小时`;
  if (hours >= 1) return `累计 ${hours.toFixed(1).replace(/\.0$/, "")} 小时`;
  return `累计 ${Math.max(1, Math.round(milliseconds / 60_000))} 分钟`;
}

function displayName(title: TrophyTitle): string {
  return title.localizedName ?? title.name;
}

function trophyLabel(trophy: Trophy): string {
  return trophy.hidden && !trophy.earned ? "隐藏奖杯" : trophy.name;
}

function trophyDetail(trophy: Trophy): string | null {
  if (trophy.hidden && !trophy.earned) return "解锁后显示";
  return trophy.detail;
}

function rarityLabel(rate: number | null): string {
  if (rate == null) return "—";
  if (rate < 5) return "极稀有";
  if (rate < 15) return "非常稀有";
  if (rate < 50) return "稀有";
  return "常见";
}

function last13Months(now: number): string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: site.timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(now));
  let year = Number(parts.find((part) => part.type === "year")?.value);
  let month = Number(parts.find((part) => part.type === "month")?.value);
  const keys: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    keys.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

function LevelRing({
  level,
  progress,
  avatarUrl,
  name,
}: {
  level: number;
  progress: number;
  avatarUrl: string | null;
  name: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid h-32 w-32 place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          className="text-line"
          stroke="currentColor"
          strokeWidth="6"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          className="text-foreground"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress / 100)}
          strokeLinecap="butt"
        />
      </svg>
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name}
          width={96}
          height={96}
          sizes="96px"
          className="h-[5.5rem] w-[5.5rem] rounded-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center leading-none">
          <TrophyMetal kind="level" size="md" className="h-10 w-10" />
          <div className="mt-1 text-2xl font-bold tabular-nums">{level}</div>
        </div>
      )}
    </div>
  );
}

function TitleRow({
  title,
  query,
}: {
  title: TrophyTitle;
  query: string;
}) {
  const earned = countTrophies(title.earned);
  const defined = countTrophies(title.defined);
  const needle = query.trim().toLowerCase();

  return (
    <details className="border-b border-line last:border-b-0" {...(needle ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 text-left hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden border border-line bg-muted">
          {title.iconUrl ? (
            <Image
              src={title.iconUrl}
              alt=""
              fill
              sizes="48px"
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="label-mono grid h-full place-items-center text-muted-foreground">
              PS
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-sm font-medium">{displayName(title)}</h3>
            <span className="label-mono shrink-0 text-muted-foreground">{title.platform}</span>
            <GameFlags service={title.service} preOrder={title.preOrder} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {playTime(title.playDurationMs, title.playCount)}
            {title.lastUpdatedAt ? ` · 更新于 ${formatStamp(title.lastUpdatedAt)}` : ""}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {TYPES.map((type) =>
            title.earned[type] > 0 || title.defined[type] > 0 ? (
              <span key={type} className="flex items-center gap-0.5 text-xs tabular-nums">
                <TrophyMetal kind={type} size="sm" />
                {title.earned[type]}
              </span>
            ) : null,
          )}
        </div>
        <div className="w-16 shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums">{title.progress}%</div>
          <div className="label-mono text-muted-foreground">
            {earned}/{defined}
          </div>
        </div>
      </summary>
        <div className="border-t border-line bg-muted/30 px-3 py-3">
          {title.groups.length > 1 ? (
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {title.groups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center gap-2 border border-line bg-surface px-2 py-1.5"
                >
                  {group.iconUrl ? (
                    <Image
                      src={group.iconUrl}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized
                      className="h-7 w-7 object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{group.name}</div>
                    <div className="label-mono text-muted-foreground">{group.progress}%</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <ul className="grid gap-2">
            {title.trophies.map((trophy) => {
              const hidden = trophy.hidden && !trophy.earned;
              const match =
                needle.length > 0 &&
                `${trophyLabel(trophy)} ${trophy.detail ?? ""}`.toLowerCase().includes(needle);
              return (
                <li
                  key={`${title.npCommunicationId}-${trophy.groupId}-${trophy.id}`}
                  className={cn(
                    "flex items-start gap-3 border border-line bg-surface px-2 py-2",
                    match && "border-line-strong",
                  )}
                >
                  <div
                    className={cn(
                      "relative h-10 w-10 shrink-0 overflow-hidden bg-muted",
                      !trophy.earned && "grayscale",
                    )}
                  >
                    {trophy.iconUrl && !hidden ? (
                      <Image
                        src={trophy.iconUrl}
                        alt=""
                        fill
                        sizes="40px"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center">
                        <TrophyMetal kind={trophy.type} size="sm" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <TrophyMetal kind={trophy.type} size="sm" />
                      <span className={cn("text-sm font-medium", !trophy.earned && "text-muted-foreground")}>
                        {trophyLabel(trophy)}
                      </span>
                    </div>
                    {trophyDetail(trophy) ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{trophyDetail(trophy)}</p>
                    ) : null}
                    <div className="label-mono mt-1 text-muted-foreground">
                      {trophy.earned && trophy.earnedAt
                        ? formatStamp(trophy.earnedAt)
                        : "未解锁"}
                      {trophy.earnedRate != null
                        ? ` · ${trophy.earnedRate.toFixed(1)}% ${rarityLabel(trophy.earnedRate)}`
                        : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
    </details>
  );
}

export function TrophyCabinet({
  fallback,
}: {
  fallback: StatusResponse<TrophiesPayload>;
}) {
  const { data, error, isLoading } = useStatus<TrophiesPayload>(TROPHIES_PATH, REFRESH_MS, {
    fallback,
  });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [filter, setFilter] = useState<FilterKey>("all");

  const months = useMemo(
    () => (data ? last13Months(data.observedAt) : []),
    [data],
  );
  const cadence = useMemo(() => {
    const counts = new Map(months.map((key) => [key, 0]));
    for (const title of data?.titles ?? []) {
      for (const trophy of title.trophies) {
        if (!trophy.earned || trophy.earnedAt == null) continue;
        const key = monthKey(trophy.earnedAt);
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return months.map((key) => ({ key, count: counts.get(key) ?? 0 }));
  }, [data, months]);
  const peak = Math.max(1, ...cadence.map((item) => item.count));

  const titles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.titles ?? []).filter((title) => {
      const earned = countTrophies(title.earned);
      const defined = countTrophies(title.defined);
      if (filter === "complete" && earned < defined) return false;
      if (filter === "incomplete" && earned >= defined) return false;
      if (filter === "unearned" && !title.trophies.some((trophy) => !trophy.earned)) return false;
      if (!needle) return true;
      if (displayName(title).toLowerCase().includes(needle)) return true;
      if (title.name.toLowerCase().includes(needle)) return true;
      return title.trophies.some((trophy) =>
        `${trophyLabel(trophy)} ${trophy.detail ?? ""}`.toLowerCase().includes(needle),
      );
    });
    rows.sort((a, b) => {
      if (sort === "progress") return b.progress - a.progress || displayName(a).localeCompare(displayName(b), "zh");
      if (sort === "play") return (b.playDurationMs ?? 0) - (a.playDurationMs ?? 0);
      if (sort === "name") return displayName(a).localeCompare(displayName(b), "zh");
      return (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0);
    });
    return rows;
  }, [data, filter, query, sort]);

  if (isLoading && !data) {
    return (
      <div className="flex h-40 items-center justify-center border border-dashed border-line text-sm text-muted-foreground">
        正在读取奖杯目录
      </div>
    );
  }

  if ((error && !data) || !data) {
    return (
      <div className="flex h-40 items-center justify-center border border-dashed border-line text-sm text-muted-foreground">
        {error ?? "还没收到 PlayStation 奖杯遥测"}
      </div>
    );
  }

  const defined = data.titles.reduce((sum, title) => sum + countTrophies(title.defined), 0);
  const earned = countTrophies(data.profile.earned);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="paper-card flex items-center gap-4 border border-line-strong bg-surface px-5 py-4">
          <LevelRing
            level={data.profile.level}
            progress={data.profile.levelProgress}
            avatarUrl={data.profile.avatarUrl}
            name={data.profile.onlineId}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <div className="label-mono text-muted-foreground">{data.profile.onlineId}</div>
              {data.profile.plus ? (
                <PsPlusBadge
                  className="label-mono text-muted-foreground"
                  markClassName="h-3.5 w-3.5"
                />
              ) : null}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              等级 {data.profile.level} · {data.profile.trophyPoint.toLocaleString("zh-CN")} 点
            </div>
            <div className="label-mono mt-2 text-muted-foreground">
              距下一级 {data.profile.levelProgress}%
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPES.map((type) => (
            <div
              key={type}
              className="paper-card flex items-center gap-3 border border-line-strong bg-surface px-3 py-3"
            >
              <TrophyMetal kind={type} size="md" />
              <div>
                <div className="label-mono text-muted-foreground">{trophyTypeLabel(type)}</div>
                <div className="text-xl font-bold tabular-nums">{data.profile.earned[type]}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="label-mono text-muted-foreground">
        {earned} / {defined}
        {defined > 0 ? ` · ${Math.round((earned / defined) * 100)}%` : ""}
        {` · ${data.titles.length} 款游戏`}
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">解锁节奏</h3>
          <span className="label-mono text-muted-foreground">近 13 个月</span>
        </div>
        <div className="flex h-28 items-end gap-1 border border-line bg-surface px-2 pb-2 pt-4">
          {cadence.map((item) => (
            <div key={item.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className="w-full bg-foreground/80"
                style={{ height: `${Math.max(item.count ? 8 : 0, (item.count / peak) * 100)}%` }}
                title={`${formatMonth(item.key)} · ${item.count}`}
              />
              <div className="label-mono mt-1 truncate text-center text-[10px] text-muted-foreground">
                {Number(item.key.slice(5))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-medium">游戏</h3>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="trophy-query">
              搜索游戏或奖杯
            </label>
            <input
              id="trophy-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索游戏或奖杯"
              className="h-8 min-w-44 border border-line bg-surface px-2 text-sm outline-none focus:border-line-strong"
            />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="h-8 border border-line bg-surface px-2 text-sm"
              aria-label="排序"
            >
              <option value="updated">最近更新</option>
              <option value="progress">完成度</option>
              <option value="play">游玩时长</option>
              <option value="name">名称</option>
            </select>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as FilterKey)}
              className="h-8 border border-line bg-surface px-2 text-sm"
              aria-label="筛选"
            >
              <option value="all">全部</option>
              <option value="incomplete">未完成</option>
              <option value="complete">已完成</option>
              <option value="unearned">仍有未解锁</option>
            </select>
          </div>
        </div>
        <div className="paper-card overflow-hidden border border-line-strong bg-surface">
          {titles.length ? (
            titles.map((title) => (
              <TitleRow key={title.npCommunicationId} title={title} query={query} />
            ))
          ) : (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的游戏</div>
          )}
        </div>
      </section>
    </div>
  );
}
