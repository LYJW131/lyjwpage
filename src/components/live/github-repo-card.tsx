"use client";

import Image from "next/image";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { GITHUB_REPO_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type { GithubRepoContributor, GithubRepoPayload, GithubRepoWeek, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 本仓库的贡献卡片。统计变化慢，30 分钟一轮，没有推送。
 *
 * 没配 token 时取数层给的是空负载，这里直接不渲染 —— 和联系卡片里那张
 * 贡献日历同一条规矩：没数据就不占位。
 *
 * 最近提交标题由服务端构建期焊进 props，不走这条轮询。
 */
const REFRESH_MS = 30 * 60_000;

/** 头像展示 28px，取 56 那档原图，unoptimized 直连不进优化器。 */
const AVATAR_PX = 28;

/** 明细里最多列几位；其余只进总数。 */
const CONTRIBUTOR_LIMIT = 8;

/**
 * 堆叠柱的分段配色，按排名取色（#1 恒为蓝）。
 *
 * 固定 hex，不跟主题走：这几个都是在纸面底和深色底上都立得住的中间调。
 * 人比色多时按排名循环，最后一名的色块极小，撞色也看不出来。
 */
const RANK_COLORS = [
  "#3e70c9",
  "#3d7f50",
  "#d66b35",
  "#8255c7",
  "#c84d3d",
  "#b8962a",
  "#0f9b9b",
  "#d64f7e",
] as const;

function colorForRank(index: number): string {
  return RANK_COLORS[index % RANK_COLORS.length] ?? "#3e70c9";
}

function avatarSrc(url: string): string {
  return url.includes("?") ? `${url}&s=${AVATAR_PX * 2}` : `${url}?s=${AVATAR_PX * 2}`;
}

function formatMonthDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatWeekRange(weekStart: number): string {
  const end = new Date(weekStart + 6 * 86_400_000);
  return `${formatMonthDay(weekStart)}–${end.getMonth() + 1}/${end.getDate()}`;
}

function formatCommitDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-2xl font-medium tracking-tight tabular-nums md:text-3xl">
        {value}
      </div>
    </div>
  );
}

function ContributorRow({
  person,
  color,
}: {
  person: GithubRepoContributor;
  /** 和柱状图里同一人的分段同色 */
  color: string;
}) {
  return (
    <a
      href={`https://github.com/${person.login}`}
      target="_blank"
      rel="noreferrer noopener"
      className="group relative flex min-h-[44px] min-w-0 snap-start items-center gap-2 border border-line bg-muted/40 px-3"
    >
      {/* 骑在左边框上，和外框齐平，不被框线包在里面 */}
      <span aria-hidden className="absolute top-[-1px] bottom-[-1px] left-[-1px] w-1" style={{ backgroundColor: color }} />
      {person.avatarUrl ? (
        <Image
          src={avatarSrc(person.avatarUrl)}
          alt={`${person.login} 的 GitHub 头像`}
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
          {person.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:underline">
        {person.login}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {person.commits.toLocaleString("en-US")} commits
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums">
        <span style={{ color: "var(--signal-green)" }}>+{person.additions.toLocaleString("en-US")}</span>
        <span className="text-muted-foreground">/</span>
        <span style={{ color: "var(--signal-red)" }}>−{person.deletions.toLocaleString("en-US")}</span>
      </span>
    </a>
  );
}

/** 提交历史的一行，和左边的名单行同款 44px 盒子，只是不分色、不带色条。 */
function CommitRow({ commit }: { commit: GithubRecentCommit }) {
  return (
    <li className="snap-start">
      <a
        href={commit.url}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex min-h-[44px] min-w-0 items-center gap-2.5 border border-line bg-muted/40 px-3"
      >
        <span className="label-mono shrink-0 text-muted-foreground">{commit.shortSha}</span>
        <span className="min-w-0 flex-1 truncate text-sm group-hover:underline" title={commit.title}>
          {commit.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatCommitDay(commit.committedAt)}
        </span>
      </a>
    </li>
  );
}

/**
 * 全仓一张堆叠周柱状图：每根柱子按贡献者分区，颜色和下面的排名一一对应。
 * 纯展示，不可交互；明细直接读下面的名单和提交历史。
 */
function RepoChart({
  weeks,
  contributors,
}: {
  weeks: GithubRepoWeek[];
  contributors: GithubRepoContributor[];
}) {
  /** login → 排名序号，堆叠分段和图例都从这里取色，保证两边一致 */
  const rankByLogin = useMemo(
    () => new Map(contributors.map((person, index) => [person.login, index])),
    [contributors],
  );

  if (!weeks.length) return null;

  const max = Math.max(1, ...weeks.map((week) => week.commits));
  const first = weeks[0];
  const mid = weeks[Math.floor(weeks.length / 2)];
  const last = weeks[weeks.length - 1];

  return (
    <div className="min-w-0">
      <div className="flex gap-2">
        <div
          className="flex h-24 min-w-0 flex-1 items-end gap-1 border-b border-line"
          role="img"
          aria-label={`近 ${weeks.length} 周每周 commit 数，按贡献者分色`}
        >
          {weeks.map((week) => {
            const height = week.commits ? Math.max(4, (week.commits / max) * 100) : 0;
            const label = `${formatWeekRange(week.weekStart)}：${week.commits} commits`;
            // 按当周 commits 升序：少的先画在上面，多的沉底。颜色仍跟全局排名走。
            // 分段高度按当周总数归一，柱子总高度仍按全仓最高周缩放。
            const stack = contributors
              .map((person) => {
                const seg = person.weeks.find((item) => item.weekStart === week.weekStart);
                if (!seg || seg.commits <= 0) return null;
                return { login: person.login, commits: seg.commits };
              })
              .filter((item): item is { login: string; commits: number } => item != null)
              .sort((a, b) => a.commits - b.commits);
            return (
              <div
                key={week.weekStart}
                title={label}
                // 不裁溢出：极小的分段有 2px 保底，几根加起来可能略超 100%，
                // 多出来的部分向上冒一点，不影响柱子底座对齐
                className="min-w-0 flex-1"
                style={{ height: `${height}%`, minHeight: week.commits ? 4 : 0 }}
              >
                <span className="flex h-full w-full flex-col justify-end" aria-hidden>
                  {stack.map((seg) => (
                    <span
                      key={seg.login}
                      className="w-full shrink-0"
                      style={{
                        height: `${(seg.commits / week.commits) * 100}%`,
                        minHeight: 2,
                        backgroundColor: colorForRank(rankByLogin.get(seg.login) ?? 0),
                      }}
                    />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        <div
          className="flex h-24 w-7 shrink-0 flex-col justify-between border-l border-dashed border-line pl-1 font-mono text-[10px] leading-none text-muted-foreground"
          aria-hidden
        >
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
      </div>
      <div className="mt-1 flex justify-between pr-8 font-mono text-[10px] text-muted-foreground">
        <span>{first ? formatMonthDay(first.weekStart) : "—"}</span>
        <span>{mid ? formatMonthDay(mid.weekStart) : "—"}</span>
        <span>{last ? formatMonthDay(last.weekStart) : "—"}</span>
      </div>

    </div>
  );
}

export function GithubRepoCard({
  fallback,
  recentCommits,
  className,
}: {
  fallback: StatusResponse<GithubRepoPayload>;
  /** 构建期焊进的最近提交；空数组就不画这一栏 */
  recentCommits: GithubRecentCommit[];
  className?: string;
}) {
  const { data } = useStatus<GithubRepoPayload>(GITHUB_REPO_PATH, REFRESH_MS, {
    fallback,
    // 统计慢，首屏已经带了；生产 Worker 未上线时回源 404，别一挂载就把好数据冲掉。
    revalidateOnMount: false,
    revalidateOnFocus: false,
  });

  const hasContributors = Boolean(data?.contributors.length);
  if (!hasContributors && recentCommits.length === 0) return null;

  const shown = data?.contributors.slice(0, CONTRIBUTOR_LIMIT) ?? [];
  const repoName =
    (data?.repo ?? site.repo.replace(/^https:\/\/github\.com\//, "")).split("/").pop() || "lyjwpage";

  return (
    <Card
      id="github-repo"
      label="This repo"
      action={
        <a href={site.repo} target="_blank" rel="noreferrer noopener" className="transition-colors hover:text-foreground">
          {repoName}
        </a>
      }
      className={cn("md:col-span-2", className)}
    >
      {data && hasContributors && (
        <>
          <div className="grid grid-cols-2 gap-4 px-4 pt-4 md:grid-cols-4 lg:px-5">
            <Stat label="Commits" value={data.totals.commits.toLocaleString("en-US")} />
            <Stat label="Additions" value={`+${data.totals.additions.toLocaleString("en-US")}`} />
            <Stat label="Deletions" value={`−${data.totals.deletions.toLocaleString("en-US")}`} />
            <Stat label="Contributors" value={String(data.totals.contributors)} />
          </div>

          <div className="px-4 pt-4 pb-4 lg:px-5">
            <RepoChart weeks={data.weeks} contributors={data.contributors} />
          </div>

          {/*
            左边名单、右边提交历史：两边同框式（标题 + 44px 盒子行），
            各自最多露 5 行（5×44 + 4×8 = 252px），多的在栏内滚动。
            窄屏自动上下堆叠；宽屏右栏用左边线分隔。
            分割线与内容同左右边距，不贴卡片两侧。
          */}
          <div className="mx-4 border-t border-line lg:mx-5" aria-hidden />
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:px-5">
            <div className="min-w-0">
              <div className="label-mono text-muted-foreground">Contributors</div>
              <div className="mt-2 grid max-h-[252px] min-w-0 grid-cols-1 content-start gap-2 overflow-y-auto overscroll-y-contain snap-y snap-mandatory scrollbar-none [&::-webkit-scrollbar]:hidden">
                {shown.map((person, index) => (
                  <ContributorRow key={person.login} person={person} color={colorForRank(index)} />
                ))}
              </div>
            </div>
            {recentCommits.length > 0 && (
              <div className="min-w-0 md:border-l md:border-line md:pl-4">
                <div className="label-mono text-muted-foreground">Commits</div>
                <ul className="mt-2 grid max-h-[252px] min-w-0 grid-cols-1 content-start gap-2 overflow-y-auto overscroll-y-contain snap-y snap-mandatory scrollbar-none [&::-webkit-scrollbar]:hidden">
                  {recentCommits.map((commit) => (
                    <CommitRow key={commit.sha} commit={commit} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {!hasContributors && recentCommits.length > 0 && (
        <div className="px-4 py-4 lg:px-5">
          <div className="label-mono text-muted-foreground">Commits</div>
          <ul className="mt-2 grid max-h-[252px] min-w-0 grid-cols-1 content-start gap-2 overflow-y-auto overscroll-y-contain snap-y snap-mandatory scrollbar-none [&::-webkit-scrollbar]:hidden">
            {recentCommits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
