import { BUILD_CLOSED_PHASES, type BuildRun, type BuildSignal } from "@shared/build-routine";
import { previewWorkerOrigin, SITE_PREVIEW_WORKER_SCRIPT } from "../../../../scripts/preview-worker-name.ts";
import type { StoredRun } from "./coordinator";
import { validSha, type GithubBuildApi } from "./github-api";
import { BuildBlockedError, confirmedPullRequest, existingPullRequest, preparedCommit, type GithubPullRequest } from "./pull-request";

type GithubCheck = { id?: number; name: string; status: string; conclusion: string | null; html_url?: string; details_url?: string; completed_at?: string; started_at?: string; app?: { slug: string } };
type GithubStatus = { context: string; state: string; target_url?: string; updated_at: string };

// 须与 .github/workflows/ci.yml 的 check 任务、codeql.yml 的 Analyze 任务名同步：缺一项草稿就不转待审
export const BUILD_READY_CHECKS = ["check", "Analyze (javascript-typescript)", "Analyze (actions)"] as const;

function checkKind(check: GithubCheck): "ci" | "preview" {
  return check.app?.slug === "cloudflare-workers-and-pages" && check.name === "Workers Builds: site" ? "preview" : "ci";
}

function newestSiteCheck(checks: GithubCheck[]): GithubCheck | null {
  let newest: GithubCheck | null = null;
  for (const check of checks) {
    if (checkKind(check) !== "preview") continue;
    if (!newest || (check.started_at ?? "") > (newest.started_at ?? "")
      || ((check.started_at ?? "") === (newest.started_at ?? "") && (check.id ?? 0) > (newest.id ?? 0))) {
      newest = check;
    }
  }
  return newest;
}

function checkState(check: GithubCheck): string {
  return check.status !== "completed" ? "pending" : check.conclusion ?? "unknown";
}

function aggregateState(states: string[]): string {
  if (states.some((state) => ["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"].includes(state))) return "failure";
  if (states.some((state) => ["pending", "queued", "in_progress"].includes(state))) return "pending";
  return states.length && states.every((state) => ["success", "neutral", "skipped"].includes(state)) ? "success" : "unknown";
}

function ciState(checks: GithubCheck[], statuses: GithubStatus[]): string {
  return aggregateState([...checks.filter((check) => checkKind(check) === "ci").map(checkState), ...statuses.map((item) => item.state)]);
}

function sitePreview(checks: GithubCheck[], branch: string): BuildSignal {
  const check = newestSiteCheck(checks);
  const updatedAt = Date.now();
  if (!check || check.conclusion === "skipped" || check.conclusion === "neutral") return { state: "unknown", updatedAt };
  if (check.status !== "completed") return { state: "pending", updatedAt };
  if (check.conclusion === "success") {
    const url = previewWorkerOrigin(branch, SITE_PREVIEW_WORKER_SCRIPT);
    return { state: "success", ...(url ? { url } : {}), updatedAt };
  }
  if (check.conclusion && ["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"].includes(check.conclusion)) {
    return { state: "failure", updatedAt };
  }
  return { state: "unknown", updatedAt };
}

async function allCheckRuns(api: GithubBuildApi, sha: string): Promise<GithubCheck[]> {
  const checks: GithubCheck[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await api.repo<{ total_count: number; check_runs: GithubCheck[] }>(`/commits/${sha}/check-runs?per_page=100&page=${page}`);
    if (!Number.isSafeInteger(result.total_count) || !Array.isArray(result.check_runs)) throw new Error("GitHub check results are incomplete.");
    checks.push(...result.check_runs);
    if (checks.length >= result.total_count) return checks;
    if (result.check_runs.length < 100) throw new Error("GitHub check results are incomplete.");
  }
  throw new Error("Too many GitHub checks to reconcile.");
}

type ReviewComment = { user: { login: string }; body: string; html_url: string; updated_at: string };
async function latestReview(api: GithubBuildApi, number: number): Promise<ReviewComment | null> {
  let latest: ReviewComment | null = null;
  for (let page = 1; page <= 10; page += 1) {
    const comments = await api.repo<ReviewComment[]>(`/issues/${number}/comments?per_page=100&page=${page}`);
    for (const comment of comments) {
      if (comment.user?.login === "claude[bot]" && (!latest || comment.updated_at > latest.updated_at)) latest = comment;
    }
    if (comments.length < 100) return latest;
  }
  throw new Error("The review history is too large to reconcile.");
}

export async function reconcileBuild(api: GithubBuildApi, run: BuildRun): Promise<Partial<BuildRun>> {
  if (!run.pr || BUILD_CLOSED_PHASES.includes(run.phase)) return {};
  const pr = await api.repo<GithubPullRequest>(`/pulls/${run.pr.number}`);
  const confirmed = confirmedPullRequest(pr, run);
  const result: Partial<BuildRun> = { phase: pr.merged ? "merged" : pr.state === "closed" ? "closed" : run.phase, pr: confirmed, reconciledAt: Date.now(), githubUpdatedAt: Date.parse(pr.updated_at) || undefined };
  if (result.phase === "merged" || result.phase === "closed") return result;
  result.ci = { state: "unknown", updatedAt: Date.now() };
  result.preview = { state: "unknown", updatedAt: Date.now() };
  result.review = { state: "unknown", updatedAt: Date.now() };
  const responses = await Promise.allSettled([
    allCheckRuns(api, pr.head.sha),
    api.repo<{ state: string; statuses: GithubStatus[]; total_count: number }>(`/commits/${pr.head.sha}/status?per_page=100`),
    latestReview(api, pr.number),
  ]);
  const [checkResult, statusResult, commentsResult] = responses;
  const checks = checkResult.status === "fulfilled" ? checkResult.value : [];
  if (checkResult.status === "fulfilled" && statusResult.status === "fulfilled" && statusResult.value.total_count <= statusResult.value.statuses.length) {
    result.ci = { state: ciState(checks, statusResult.value.statuses), updatedAt: Date.now() };
    result.preview = sitePreview(checks, run.branch);
  }
  if (commentsResult.status === "fulfilled") {
    const comment = commentsResult.value;
    if (comment) result.review = { state: comment.body.slice(0, 600), url: comment.html_url, updatedAt: Date.now() };
  }
  return result;
}

export async function markBuildReady(api: GithubBuildApi, run: StoredRun): Promise<NonNullable<BuildRun["pr"]> | null> {
  if (run.state.phase !== "pr_open" || !run.uploadUsed || !validSha(run.implementationHeadSha) || run.state.pr?.headSha !== run.implementationHeadSha || run.state.ci?.state !== "success") return null;
  await preparedCommit(api, run);
  const pr = await existingPullRequest(api, run);
  if (!pr) throw new BuildBlockedError("The build pull request is unavailable.");
  const confirmed = confirmedPullRequest(pr, run.state, [run.implementationHeadSha]);
  if (pr.state !== "open" || pr.merged) return null;
  if (!pr.draft) return confirmed;
  const [checks, statuses] = await Promise.all([
    allCheckRuns(api, run.implementationHeadSha),
    api.repo<{ statuses: GithubStatus[]; total_count: number }>(`/commits/${run.implementationHeadSha}/status?per_page=100`),
  ]);
  if (!Number.isSafeInteger(statuses.total_count) || statuses.total_count > statuses.statuses.length) return null;
  if (!BUILD_READY_CHECKS.every((name) => checks.some((check) => checkKind(check) === "ci" && check.name === name && check.app?.slug === "github-actions" && check.status === "completed" && check.conclusion === "success"))
    || ciState(checks, statuses.statuses) !== "success") return null;
  const latest = await existingPullRequest(api, run);
  if (!latest) return null;
  const latestConfirmed = confirmedPullRequest(latest, run.state, [run.implementationHeadSha]);
  if (latest.state !== "open" || latest.merged || !latest.node_id) return null;
  if (!latest.draft) return latestConfirmed;
  const mutation = await api.request<{ data?: { markPullRequestReadyForReview?: { pullRequest: { isDraft: boolean; headRefOid: string; number: number } } }; errors?: unknown[] }>("/graphql", "POST", {
    query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft headRefOid number}}}", variables: { id: latest.node_id },
  });
  const ready = mutation.data?.markPullRequestReadyForReview?.pullRequest;
  if (ready && ready.headRefOid !== run.implementationHeadSha) {
    await api.request("/graphql", "POST", { query: "mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{isDraft}}}", variables: { id: latest.node_id } });
    throw new BuildBlockedError("The pull request head changed while confirming readiness.");
  }
  if (mutation.errors?.length || !ready || ready.isDraft || ready.number !== confirmed.number) throw new Error("GitHub did not confirm readiness for review.");
  return { ...confirmed, draft: false };
}
