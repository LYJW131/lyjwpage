"use client";

import Image from "next/image";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { GITHUB_REPO_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type { GithubRepoPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 本仓库的贡献卡片。统计变化慢，30 分钟一轮，没有推送。
 *
 * 没配 token 时取数层给的是空负载，这里直接不渲染 —— 和联系卡片里那张
 * 贡献日历同一条规矩：没数据就不占位。
 */
const REFRESH_MS = 30 * 60_000;

/** 头像展示 28px，取 56 那档原图，unoptimized 直连不进优化器。 */
const AVATAR_PX = 28;

function avatarSrc(url: string): string {
  return url.includes("?") ? `${url}&s=${AVATAR_PX * 2}` : `${url}?s=${AVATAR_PX * 2}`;
}

function formatMonthDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-2xl font-medium tracking-tight tabular-nums md:text-3xl">
        {value}
      </div>
    </div>
  );
}

export function GithubRepoCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<GithubRepoPayload>;
  className?: string;
}) {
  const { data } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, REFRESH_MS, { fallback });
  if (!data || data.contributors.length === 0) return null;

  const maxWeek = Math.max(1, ...data.weeks.map((week) => week.commits));
  const shown = data.contributors.slice(0, 5);

  return (
    <Card
      id="github-repo"
      label="GitHub"
      action={
        <a href={site.repo} target="_blank" rel="noreferrer noopener" className="transition-colors hover:text-foreground">
          {data.repo}
        </a>
      }
      className={cn("md:col-span-2", className)}
    >
      <div className="grid grid-cols-2 gap-4 px-4 pt-4 md:grid-cols-4 lg:px-5">
        <Stat label="Commits" value={data.totals.commits.toLocaleString("en-US")} />
        <Stat
          label="Additions"
          value={`+${data.totals.additions.toLocaleString("en-US")}`}
        />
        <Stat
          label="Deletions"
          value={`-${data.totals.deletions.toLocaleString("en-US")}`}
        />
        <Stat label="Contributors" value={String(data.totals.contributors)} />
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:px-5">
        <div className="min-w-0">
          <div className="label-mono text-muted-foreground">Top contributors</div>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {shown.map((item) => (
              <li key={item.login}>
                <a
                  href={`https://github.com/${item.login}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-3 py-2"
                >
                  {item.avatarUrl ? (
                    <Image
                      src={avatarSrc(item.avatarUrl)}
                      alt={`${item.login} 的 GitHub 头像`}
                      width={AVATAR_PX}
                      height={AVATAR_PX}
                      unoptimized
                      className="size-7 shrink-0 rounded-full border border-line bg-muted"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-muted text-xs text-muted-foreground"
                    >
                      {item.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:underline">
                    {item.login}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {item.commits.toLocaleString("en-US")} commits
                    <span className="ml-2 hidden sm:inline">
                      +{item.additions.toLocaleString("en-US")}/
                      -{item.deletions.toLocaleString("en-US")}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div className="label-mono text-muted-foreground">Commits · 近 {data.weeks.length} 周</div>
          <div
            className="mt-2 flex h-24 items-end gap-1 border-b border-line pb-0"
            role="img"
            aria-label={`近 ${data.weeks.length} 周每周 commit 数`}
          >
            {data.weeks.map((week) => {
              const date = new Date(week.weekStart);
              const label = `${date.getMonth() + 1}/${date.getDate()} 起一周：${week.commits} commits`;
              return (
                <div
                  key={week.weekStart}
                  title={label}
                  className="min-w-0 flex-1 bg-live"
                  style={{ height: `${Math.max(4, (week.commits / maxWeek) * 100)}%` }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>{data.weeks.length ? formatMonthDay(data.weeks[0].weekStart) : "—"}</span>
            <span>
              {data.weeks.length
                ? formatMonthDay(data.weeks[data.weeks.length - 1].weekStart)
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
