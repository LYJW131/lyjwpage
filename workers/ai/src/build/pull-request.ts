import { BUILD_REPO, branchForRun, type BuildRun } from "@shared/build-routine";
import type { StoredRun } from "./coordinator";
import { GithubRequestError, validSha, type GithubBuildApi } from "./github-api";

export class BuildBlockedError extends Error {}
export class BuildPullRequestRejectedError extends Error {}
export class BuildPublicationPendingError extends Error {}

export type GithubPullRequest = {
  number: number; node_id: string; html_url: string; state: string; merged: boolean; draft: boolean; body: string; updated_at: string;
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
  user: { id: number; login: string; type: string };
};
export type GithubCommit = { sha: string; tree: { sha: string }; parents: { sha: string }[] };
export const BUILD_COMMIT_IDENTITY = { name: "lyjw131[bot]", email: "338272049+lyjw131[bot]@users.noreply.github.com" };

export function buildMarker(run: Pick<BuildRun, "runId">): string { return `<!-- build-run:${run.runId} -->`; }
export function planPath(run: StoredRun): string { return `builds/${run.state.runId}.md`; }
export function assertBuildIdentity(run: StoredRun): void {
  if (!/^[a-f0-9]{32}$/.test(run.state.runId) || run.state.branch !== branchForRun(run.state.runId) || !validSha(run.baseSha)) throw new BuildBlockedError("The build branch identity is invalid.");
}
export function confirmedPullRequest(pr: GithubPullRequest, run: BuildRun, allowedHeads?: readonly string[]): NonNullable<BuildRun["pr"]> {
  const marker = pr.body?.includes(buildMarker(run));
  if (!Number.isSafeInteger(pr.number) || pr.number < 1 || pr.html_url !== `https://github.com/${BUILD_REPO}/pull/${pr.number}` || !validSha(pr.head?.sha)
    || pr.head.ref !== run.branch || pr.head.repo?.full_name !== BUILD_REPO || pr.base?.ref !== "main" || pr.base.repo?.full_name !== BUILD_REPO
    || pr.user?.id !== 338272049 || pr.user.login !== BUILD_COMMIT_IDENTITY.name || pr.user.type !== "Bot"
    || !marker || run.pr && pr.number !== run.pr.number || allowedHeads && !allowedHeads.includes(pr.head.sha)) throw new BuildBlockedError("The pull request does not match this build.");
  return { number: pr.number, url: pr.html_url, headSha: pr.head.sha, draft: pr.draft };
}
export async function branchHead(api: GithubBuildApi, branch: string): Promise<string | null> {
  try {
    const ref = await api.repo<{ ref: string; object: { sha: string } }>(`/git/ref/heads/${branch}`);
    if (ref.ref !== `refs/heads/${branch}` || !validSha(ref.object?.sha)) throw new BuildBlockedError("The build branch could not be verified.");
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GithubRequestError && error.status === 404) return null;
    throw error;
  }
}
export async function existingPullRequest(api: GithubBuildApi, run: StoredRun): Promise<GithubPullRequest | null> {
  if (run.state.pr) return api.repo<GithubPullRequest>(`/pulls/${run.state.pr.number}`);
  const head = encodeURIComponent(`${BUILD_REPO.split("/")[0]}:${run.state.branch}`);
  const prs = await api.repo<GithubPullRequest[]>(`/pulls?state=all&head=${head}&base=main&per_page=100`);
  if (!Array.isArray(prs) || prs.length > 1) throw new BuildBlockedError("The build branch has an ambiguous pull request history.");
  return prs[0] ?? null;
}
export function assertOpenDraft(pr: GithubPullRequest): void {
  if (pr.state !== "open" || pr.merged || pr.draft !== true) throw new BuildBlockedError("The build pull request is no longer an open draft.");
}

export async function preparedCommit(api: GithubBuildApi, run: StoredRun): Promise<GithubCommit> {
  assertBuildIdentity(run);
  if (!validSha(run.planCommitSha) || !run.state.pr) throw new BuildBlockedError("The build draft has not been prepared.");
  const commit = await api.repo<GithubCommit>(`/git/commits/${run.planCommitSha}`);
  if (commit.sha !== run.planCommitSha || !validSha(commit.tree?.sha) || commit.parents?.length !== 1 || commit.parents[0].sha !== run.baseSha) throw new BuildBlockedError("The plan commit does not match the assigned base commit.");
  return commit;
}
