"use client";

import { Fragment, useEffect, useState } from "react";

import Image from "@/components/app-image";
import { useMountedAt } from "@/hooks/use-mounted-at";
import type { CommitAuthor } from "@shared/commit-authors";
import { deploymentFor, type RecentCommit, recentCommitsFrom } from "@/lib/recent-commits";
import { formatRelativeTime } from "@/lib/relative-time";
import { CLOUDFLARE_DASH_URL, site } from "@shared/site";
import type { GithubRepoContributor, GithubRepoPayload } from "@shared/types";
import { cn } from "@/lib/utils";
import type { SiteDeployment, SiteDeploymentState } from "@shared/site-deployments-types";

const AVATAR_PX = 28;

export const CONTRIBUTOR_LIMIT = 6;

const AVATAR_ACCENTS: Record<string, string> = {
  lyjw131: "var(--avatar-lyjw131)",
  claude: "var(--claude)",
  codex: "var(--avatar-codex)",
  cursoragent: "var(--avatar-cursor)",
  an0nch1hayaa: "var(--avatar-chihaya)",
  "grokkybara[bot]": "var(--avatar-grok)",
};

const FALLBACK_COLORS = [
  "var(--signal-blue)",
  "var(--signal-green)",
  "var(--signal-orange)",
  "var(--signal-violet)",
  "var(--signal-red)",
  "var(--signal-yellow)",
] as const;

export function colorForContributor(login: string, index: number): string {
  return AVATAR_ACCENTS[login.toLowerCase()] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function avatarSrc(url: string): string {
  return url.includes("?") ? `${url}&s=${AVATAR_PX * 2}` : `${url}?s=${AVATAR_PX * 2}`;
}

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
    <div
      title={`${person.login} · ${person.commits.toLocaleString("en-US")} commits (including Co-authored-by)`}
      className="relative flex min-h-[44px] min-w-0 items-center gap-2 border border-line bg-muted/40 px-3 max-sm:flex-wrap max-sm:gap-y-0 max-sm:py-1"
    >
      <span aria-hidden className="absolute top-[-1px] bottom-[-1px] left-[-1px] w-1" style={{ backgroundColor: color }} />
      <a
        href={`https://github.com/${person.login}`}
        target="_blank"
        rel="noreferrer noopener"
        className="group mr-auto flex min-w-0 items-center gap-2 self-stretch max-sm:items-start max-sm:self-auto"
      >
        {person.avatarUrl ? (
          <Image
            src={avatarSrc(person.avatarUrl)}
            alt={`${person.login}'s GitHub avatar`}
            width={AVATAR_PX}
            height={AVATAR_PX}
            unoptimized
            className="size-7 shrink-0 rounded-full border border-line bg-muted max-sm:mt-1"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-muted text-xs text-muted-foreground max-sm:mt-1"
          >
            {person.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 truncate text-sm font-medium group-hover:underline">
          {person.login}
        </span>
      </a>
      <span className="flex shrink-0 gap-2 font-mono text-2xs leading-4 tabular-nums max-sm:-mt-3 max-sm:basis-full max-sm:pl-9">
        <span className="text-muted-foreground">{person.commits.toLocaleString("en-US")} commits</span>
        <span>
          <span className="text-signal-green">+{person.additions.toLocaleString("en-US")}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-signal-red">−{person.deletions.toLocaleString("en-US")}</span>
        </span>
      </span>
    </div>
  );
}

const stateLabels: Record<SiteDeploymentState, string> = { READY: "Built", BUILDING: "Building", QUEUED: "Queued", INITIALIZING: "Initializing", ERROR: "Failed", CANCELED: "Canceled", UNKNOWN: "—" };

const CLOUDFLARE_BUILD_PREFIX = "cloudflare-build:";

function deploymentHref(deployment: SiteDeployment): string {
  if (deployment.id.startsWith(CLOUDFLARE_BUILD_PREFIX)) {
    const buildId = deployment.id.slice(CLOUDFLARE_BUILD_PREFIX.length);
    return `${CLOUDFLARE_DASH_URL}/workers/services/view/site/production/builds/${encodeURIComponent(buildId)}`;
  }
  return site.cloudflare;
}

const AUTHOR_PX = 16;

const AVATAR_CLASS = "size-4 shrink-0 rounded-full border border-surface bg-muted";

function AuthorAvatar({ author }: { author: CommitAuthor }) {
  if (author.avatarUrl) {
    return <Image src={avatarSrc(author.avatarUrl).replace(`s=${AVATAR_PX * 2}`, `s=${AUTHOR_PX * 2}`)} alt="" width={AUTHOR_PX} height={AUTHOR_PX} unoptimized className={AVATAR_CLASS} />;
  }
  return <span aria-hidden className={cn(AVATAR_CLASS, "flex items-center justify-center text-2xs text-muted-foreground")}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

function authorKey(author: CommitAuthor): string {
  return `${author.login ?? author.name}:${author.model ?? ""}`;
}

function AuthorLine({ authors, children }: { authors: CommitAuthor[]; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-2xs leading-4 text-muted-foreground">
      <span className="flex shrink-0 -space-x-1">
        {authors.map((author) => <AuthorAvatar key={authorKey(author)} author={author} />)}
      </span>
      <span className="-my-1 min-w-0 truncate py-1">{children}</span>
    </div>
  );
}

function joinLabels(count: number, index: number): string {
  if (index === 0) return "";
  return count === 2 ? " and " : index === count - 1 ? ", and " : ", ";
}

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
  const people = authors.filter((author) => !author.agent);
  const agents = authors.filter((author) => author.agent);
  const time = <time dateTime={committedAt ?? undefined} title={committedAt ? formatCommitTime(committedAt) : undefined}>{when}</time>;
  const agentNames = agents.map((author, index) => {
    const model = author.model && author.model.toLowerCase() !== author.name.toLowerCase() ? author.model : null;
    const name = author.login && !author.login.endsWith("[bot]")
      ? <a href={`https://github.com/${author.login}`} target="_blank" rel="noreferrer noopener" className="-my-1 inline-block py-1 font-medium text-foreground hover:underline">{author.name}</a>
      : <span className="font-medium text-foreground">{author.name}</span>;
    return (
      <Fragment key={authorKey(author)}>
        {joinLabels(agents.length, index)}
        {name}{model && <span className="font-medium text-foreground"> ({model})</span>}
      </Fragment>
    );
  });
  return (
    <div className="flex flex-col gap-2">
      {people.length > 0 ? (
        <AuthorLine authors={people}>
          {people.map((author, index) => (
            <Fragment key={authorKey(author)}>
              {joinLabels(people.length, index)}
              {author.login
                ? <a href={`https://github.com/${author.login}`} target="_blank" rel="noreferrer noopener" className="-my-1 inline-block py-1 font-medium text-foreground hover:underline">{author.name}</a>
                : <span className="font-medium text-foreground">{author.name}</span>}
            </Fragment>
          ))}
          {" committed "}{time}
        </AuthorLine>
      ) : agents.length > 0 ? (
        <AuthorLine authors={agents}>{agentNames}{" committed "}{time}</AuthorLine>
      ) : (
        <div className="min-w-0 truncate text-2xs leading-4 text-muted-foreground">committed {time}</div>
      )}
      {people.length > 0 && agents.length > 0 && <AuthorLine authors={agents}>with {agentNames}</AuthorLine>}
    </div>
  );
}

function CommitVerifiedIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      fill="currentColor"
      aria-label="Verified signature"
      className={className}
    >
      <path d="M8 0a1 1 0 0 1 .7.29l1.76 1.76h2.5a1 1 0 0 1 .99 1v2.49L15.7 7.3a1 1 0 0 1 0 1.4l-1.76 1.76v2.5a1 1 0 0 1-1 .99h-2.49L8.7 15.7a1 1 0 0 1-1.4 0l-1.76-1.76h-2.5a1 1 0 0 1-.99-1v-2.49L.3 8.7a1 1 0 0 1 0-1.4l1.76-1.76v-2.5a1 1 0 0 1 1-.99h2.49L7.3.3A1 1 0 0 1 8 0M6.6 3.11l-.44.44h-2.6v2.6L1.7 8l1.84 1.84v2.6h2.6l.45.45 1.4 1.4 1.4-1.4.44-.44h2.6v-2.6l.45-.45 1.4-1.4-1.84-1.84v-2.6h-2.6L8 1.7zm4.59 3.3-3.72 3.71c-.3.3-.77.3-1.06 0L4.8 8.53l1.07-1.06 1.06 1.06 3.18-3.18z" />
    </svg>
  );
}

function CommitCard({ commit, deploy }: {
  commit: RecentCommit;
  deploy: { deployment: SiteDeployment; production: boolean } | undefined;
}) {
  const deployment = deploy?.deployment ?? null;
  const production = deploy?.production ?? false;
  const status = production ? "Live" : !deployment ? "Committed" : deployment.state === "READY" && deployment.target === "preview" ? "Preview ready" : stateLabels[deployment.state];
  return (
    <li className="flex min-h-24 flex-col justify-center gap-1 border border-line bg-muted/40 px-3 py-1.5">
      <a href={commit.url} target="_blank" rel="noreferrer noopener" title={commit.title} className="-mt-2 block truncate pt-2 text-sm leading-5 hover:underline">{commit.title}</a>
      <CommitByline authors={commit.authors} committedAt={commit.committedAt} />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 whitespace-nowrap text-2xs leading-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", production ? "bg-emerald-500" : deployment?.state === "ERROR" ? "bg-red-500" : deployment?.state === "BUILDING" ? "bg-amber-500" : "bg-muted-foreground/40")} />
          <span className={cn(production ? "text-live-ink" : deployment?.state === "ERROR" ? "text-signal-red" : undefined)}>{status}</span>
        </span>
        <a
          href={commit.url}
          target="_blank"
          rel="noreferrer noopener"
          title={commit.verified ? `${commit.sha} · Verified signature` : commit.sha}
          className="group/sha -mb-2 inline-flex items-center gap-1 pb-2 font-mono hover:text-foreground"
        >
          <span>{commit.sha}</span>
          {commit.verified && (
            <CommitVerifiedIcon className="size-3 text-muted-foreground group-hover/sha:text-foreground" />
          )}
        </a>
        {deployment && <a href={deploymentHref(deployment)} target="_blank" rel="noreferrer noopener" className="-mb-2 pb-2 hover:text-foreground">{deployment.target === "production" ? "Production" : "Preview"} ↗</a>}
        {deployment?.buildDurationMs != null && <span>Build {(deployment.buildDurationMs / 1000).toFixed(0)}s</span>}
      </div>
    </li>
  );
}

const COMMIT_LIMIT = 3;

export function RepoContributions({
  data,
  deploymentsBySha,
}: {
  data: GithubRepoPayload | undefined;
  deploymentsBySha: Map<string, { deployment: SiteDeployment; production: boolean }>;
}) {
  const hasContributors = Boolean(data?.contributors.length);
  const commits = recentCommitsFrom(data?.recentCommits, COMMIT_LIMIT);
  if (!hasContributors && commits.length === 0) return null;

  const shown = data?.contributors.slice(0, CONTRIBUTOR_LIMIT) ?? [];

  return (
    <section id="github-repo" className="min-w-0 scroll-mt-28" aria-label="Repository contributions">
      {hasContributors ? (
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* 两栏并排时列表撑满同一高度、行按 1fr 均分，内容高度对不上时底边也对齐。 */}
          <div className="flex min-w-0 flex-col p-4 md:pr-4 lg:pl-5">
            <div className="label-mono text-muted-foreground">Contributors</div>
            <div className="mt-2 grid min-w-0 flex-1 grid-cols-1 content-start gap-2 md:auto-rows-fr md:content-stretch">
              {shown.map((person, index) => (
                <ContributorRow key={person.login} person={person} color={colorForContributor(person.login, index)} />
              ))}
            </div>
          </div>
          {commits.length > 0 && (
            <div className="flex min-w-0 flex-col border-t border-line p-4 md:border-t-0 md:border-l md:border-line md:pl-4 lg:pr-5">
              <div className="label-mono text-muted-foreground">Commits</div>
              <ul className="mt-2 grid min-w-0 flex-1 grid-cols-1 content-start gap-2 md:auto-rows-fr md:content-stretch">
                {commits.map((commit) => (
                  <CommitCard key={commit.sha} commit={commit} deploy={deploymentFor(commit, deploymentsBySha)} />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 lg:p-5">
          <div className="label-mono text-muted-foreground">Commits</div>
          <ul className="mt-2 grid min-w-0 grid-cols-1 content-start gap-2">
            {commits.map((commit) => (
              <CommitCard key={commit.sha} commit={commit} deploy={deploymentFor(commit, deploymentsBySha)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
