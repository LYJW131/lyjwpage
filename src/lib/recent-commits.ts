import type { CommitAuthor } from "@shared/commit-authors";
import { site } from "@shared/site";
import type { GithubRepoCommit } from "@shared/types";

export type RecentCommit = {
  sha: string;
  oid: string | null;
  title: string;
  url: string;
  authors: CommitAuthor[];
  committedAt: string | null;
  verified: boolean;
};

const nameOnly = (name: string): CommitAuthor => ({ name, login: null, avatarUrl: null, agent: null, model: null });

const SYNC_MERGE = /^Merge (?:remote-tracking )?branch(?:es)? '/;

export function recentCommitsFrom(commits: GithubRepoCommit[] | undefined, limit: number): RecentCommit[] {
  return (commits ?? []).filter((commit) => !SYNC_MERGE.test(commit.title)).slice(0, limit).map((commit) => ({
    sha: commit.sha,
    oid: commit.oid ?? null,
    title: commit.title,
    url: commit.url ?? `${site.repo}/commit/${commit.oid ?? commit.sha}`,
    authors: commit.authorDetails ?? commit.authors.map(nameOnly),
    committedAt: commit.committedAt,
    verified: commit.verified ?? false,
  }));
}

export function deploymentFor<T>(commit: RecentCommit, bySha: ReadonlyMap<string, T>): T | undefined {
  if (commit.oid) return bySha.get(commit.oid);
  for (const [sha, value] of bySha) if (sha.startsWith(commit.sha)) return value;
  return undefined;
}
