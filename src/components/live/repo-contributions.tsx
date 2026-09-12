"use client";

import ClaudeMono from "@lobehub/icons/es/Claude/components/Mono";
import CursorMono from "@lobehub/icons/es/Cursor/components/Mono";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import Image from "next/image";
import { Fragment, useEffect, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import type { CommitAuthor } from "@/lib/commit-authors";
import type { GithubRecentCommit } from "@/lib/github-recent-commits";
import { formatRelativeTime } from "@/lib/relative-time";
import { site } from "@/lib/site";
import type { GithubRepoContributor, GithubRepoPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { DeploymentState, VercelDeployment } from "@/lib/vercel-deployments-types";

/** 头像展示 28px，取 56 那档原图，unoptimized 直连不进优化器。 */
const AVATAR_PX = 28;

/** 名单只列前几位，不滚动；其余只进总数。和右边的提交列表一样长。 */
const CONTRIBUTOR_LIMIT = 6;

/**
 * 名单与顶部占比条的配色，按排名取色（#1 恒为蓝）。
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

export function colorForRank(index: number): string {
  return RANK_COLORS[index % RANK_COLORS.length] ?? "#3e70c9";
}

function avatarSrc(url: string): string {
  return url.includes("?") ? `${url}&s=${AVATAR_PX * 2}` : `${url}?s=${AVATAR_PX * 2}`;
}

/** 提交时间按站点时区显示，服务端和浏览器算出来的一样，和奖杯卡同一套。 */
const commitTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: site.timezone,
});

function formatCommitTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(commitTimeFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function ContributorRow({
  person,
  color,
}: {
  person: GithubRepoContributor;
  color: string;
}) {
  return (
    <a
      href={`https://github.com/${person.login}`}
      target="_blank"
      rel="noreferrer noopener"
      className="group relative flex min-h-[44px] min-w-0 items-center gap-2 border border-line bg-muted/40 px-3"
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

const stateLabels: Record<DeploymentState, string> = { READY: "已部署", BUILDING: "构建中", QUEUED: "排队", INITIALIZING: "准备中", ERROR: "失败", CANCELED: "取消", UNKNOWN: "—" };

/** 署名行的头像 16px；GitHub 头像取 32 那档，unoptimized 直连。 */
const AUTHOR_PX = 16;

/** 没有 GitHub 头像的 agent：品牌色圆底 + 单色图标，和 GitHub 给 claude 画的那种一致。 */
const AGENT_AVATARS: Record<NonNullable<CommitAuthor["agent"]>, { Icon: typeof ClaudeMono; background: string }> = {
  claude: { Icon: ClaudeMono, background: "#d97757" },
  cursor: { Icon: CursorMono, background: "#111111" },
  openai: { Icon: OpenAIMono, background: "#111111" },
};

function AuthorAvatar({ author }: { author: CommitAuthor }) {
  const className = "size-4 shrink-0 rounded-full border border-surface bg-muted";
  if (author.avatarUrl) {
    return <Image src={avatarSrc(author.avatarUrl).replace(`s=${AVATAR_PX * 2}`, `s=${AUTHOR_PX * 2}`)} alt="" width={AUTHOR_PX} height={AUTHOR_PX} unoptimized className={className} />;
  }
  const agent = author.agent ? AGENT_AVATARS[author.agent] : null;
  if (agent) {
    return (
      <span aria-hidden className={cn(className, "flex items-center justify-center")} style={{ backgroundColor: agent.background }}>
        <agent.Icon size={10} color="#fff" />
      </span>
    );
  }
  return <span aria-hidden className={cn(className, "flex items-center justify-center text-[9px] text-muted-foreground")}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * GitHub 提交页那一行：叠着的头像 + `A and B committed 13 minutes ago`。
 * 相对时间由「当下」推出，首帧（服务端和 hydrate）先画绝对时刻，挂载后换成相对的，每分钟再刷。
 */
function CommitByline({ authors, committedAt }: { authors: CommitAuthor[]; committedAt: string | null }) {
  const mountedAt = useMountedAt();
  const [tick, setTick] = useState(0);
  const now = tick || mountedAt;
  useEffect(() => {
    if (!mountedAt) return;
    const timer = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [mountedAt]);
  const at = committedAt ? Date.parse(committedAt) : NaN;
  const when = Number.isNaN(at) ? "—" : now ? formatRelativeTime(at, now) : formatCommitTime(committedAt);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
      {authors.length > 0 && (
        <span className="flex shrink-0 -space-x-1">
          {authors.map((author) => <AuthorAvatar key={author.login ?? author.name} author={author} />)}
        </span>
      )}
      <span className="min-w-0 truncate">
        {authors.map((author, index) => (
          <Fragment key={author.login ?? author.name}>
            {index > 0 && (authors.length === 2 ? " and " : index === authors.length - 1 ? ", and " : ", ")}
            {author.login
              ? <a href={`https://github.com/${author.login}`} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground hover:underline">{author.name}</a>
              : <span className="font-medium text-foreground">{author.name}</span>}
          </Fragment>
        ))}
        {authors.length > 0 ? " committed " : "committed "}
        <time dateTime={committedAt ?? undefined} title={committedAt ? formatCommitTime(committedAt) : undefined}>{when}</time>
      </span>
    </div>
  );
}

/** 一条提交的加高卡：标题 + 署名 + 部署状态，96px 正好占左边两行加一条缝。 */
function CommitCard({ commit, deploy }: {
  commit: GithubRecentCommit;
  deploy: { deployment: VercelDeployment; production: boolean } | undefined;
}) {
  const deployment = deploy?.deployment ?? null;
  const production = deploy?.production ?? false;
  const status = production ? "当前线上" : !deployment ? "已提交" : deployment.state === "READY" && deployment.target === "preview" ? "预览就绪" : stateLabels[deployment.state];
  return (
    <li className="flex min-h-[96px] flex-col justify-center gap-1 border border-line bg-muted/40 px-3 py-2">
      <a href={commit.url} target="_blank" rel="noreferrer noopener" title={commit.title} className="block truncate text-sm leading-5 hover:underline">{commit.title}</a>
      <CommitByline authors={commit.authors} committedAt={commit.committedAt} />
      <div className="flex items-center gap-x-2.5 text-[10px] leading-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", production ? "bg-emerald-500" : deployment?.state === "ERROR" ? "bg-red-500" : deployment?.state === "BUILDING" ? "bg-amber-500" : "bg-muted-foreground/40")} />
          <span className={cn(production ? "text-emerald-600 dark:text-emerald-400" : deployment?.state === "ERROR" ? "text-red-500" : undefined)}>{status}</span>
        </span>
        <a href={commit.url} target="_blank" rel="noreferrer noopener" className="font-mono hover:text-foreground">{commit.shortSha}</a>
        {deployment && <a href={`${site.vercel}/${deployment.id.replace(/^dpl_/, "")}`} target="_blank" rel="noreferrer noopener" className="hover:text-foreground">{deployment.target === "production" ? "Production" : "Preview"} ↗</a>}
        {deployment?.buildDurationMs != null && <span>构建 {(deployment.buildDurationMs / 1000).toFixed(0)}s</span>}
      </div>
    </li>
  );
}

/**
 * 左边 6 行名单、右边 3 张提交大卡：一张卡占左边两行加一条缝，
 * 两边总高严格对齐。窄屏自动上下堆叠；宽屏右栏用左边线分隔。
 */
export function RepoContributions({
  data,
  recentCommits = [],
  deploymentsBySha,
}: {
  data: GithubRepoPayload | undefined;
  recentCommits?: GithubRecentCommit[];
  deploymentsBySha: Map<string, { deployment: VercelDeployment; production: boolean }>;
}) {
  const hasContributors = Boolean(data?.contributors.length);
  const commits = recentCommits ?? [];
  if (!hasContributors && commits.length === 0) return null;

  const shown = data?.contributors.slice(0, CONTRIBUTOR_LIMIT) ?? [];

  return (
    <section id="github-repo" className="min-w-0 scroll-mt-28" aria-label="仓库贡献">
      {hasContributors ? (
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="min-w-0 p-4 md:pr-4 lg:pl-5">
            <div className="label-mono text-muted-foreground">Contributors</div>
            <div className="mt-2 grid min-w-0 grid-cols-1 content-start gap-2">
              {shown.map((person, index) => (
                <ContributorRow key={person.login} person={person} color={colorForRank(index)} />
              ))}
            </div>
          </div>
          {commits.length > 0 && (
            <div className="min-w-0 border-t border-line p-4 md:border-t-0 md:border-l md:border-line md:pl-4 lg:pr-5">
              <div className="label-mono text-muted-foreground">Commits</div>
              <ul className="mt-2 grid min-w-0 grid-cols-1 content-start gap-2">
                {commits.slice(0, 3).map((commit) => (
                  <CommitCard key={commit.sha} commit={commit} deploy={deploymentsBySha.get(commit.sha)} />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 lg:px-5">
          <div className="label-mono text-muted-foreground">Commits</div>
          <ul className="mt-2 grid min-w-0 grid-cols-1 content-start gap-2">
            {commits.slice(0, 3).map((commit) => (
              <CommitCard key={commit.sha} commit={commit} deploy={deploymentsBySha.get(commit.sha)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
