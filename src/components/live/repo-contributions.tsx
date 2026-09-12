import Image from "next/image";

import type { GithubRecentCommit } from "@/lib/github-recent-commits";
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

/** 一条提交的加高卡：状态 + 标题 + 构建信息，96px 正好占左边两行加一条缝。 */
function CommitCard({ commit, deploy }: {
  commit: GithubRecentCommit;
  deploy: { deployment: VercelDeployment; production: boolean } | undefined;
}) {
  const deployment = deploy?.deployment ?? null;
  const production = deploy?.production ?? false;
  const status = production ? "当前线上" : !deployment ? "已提交" : deployment.state === "READY" && deployment.target === "preview" ? "预览就绪" : stateLabels[deployment.state];
  return (
    <li className="flex min-h-[96px] flex-col justify-center gap-1 border border-line bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] leading-4">
        <span className={cn("size-1.5 shrink-0 rounded-full", production ? "bg-emerald-500" : deployment?.state === "ERROR" ? "bg-red-500" : deployment?.state === "BUILDING" ? "bg-amber-500" : "bg-muted-foreground/40")} />
        <span className={cn("shrink-0", production ? "text-emerald-600 dark:text-emerald-400" : deployment?.state === "ERROR" ? "text-red-500" : "text-muted-foreground")}>{status}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{formatCommitTime(commit.committedAt)}</span>
      </div>
      <a href={commit.url} target="_blank" rel="noreferrer noopener" title={commit.title} className="block truncate text-sm leading-5 hover:underline">{commit.title}</a>
      <div className="flex items-center gap-x-3 text-[10px] leading-4 text-muted-foreground">
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
