import { BUILD_REPO, buildIssueBody, type BuildRun, type BuildUpload } from "@shared/build-routine";
import { GITHUB_APP_CLIENT_ID } from "@shared/github-issue";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";
import { readBoundedJson } from "./http";
import { base64url } from "./token";
import { GITHUB_API, GITHUB_API_HEADERS } from "./github-oauth";

function der(tag: number, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const length: number[] = [];
  for (let n = bytes.length; n; n >>>= 8) length.unshift(n & 255);
  return Uint8Array.from([tag, ...(bytes.length < 128 ? [bytes.length] : [128 | length.length, ...length]), ...bytes]);
}

export async function githubAppJwt(privateKey: string, now = Date.now()): Promise<string> {
  const pem = privateKey.replaceAll("\\n", "\n");
  let bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (char) => char.charCodeAt(0));
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    bytes = der(0x30, Uint8Array.from([2, 1, 0, 0x30, 0x0d, 6, 9, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0, ...der(4, bytes)]));
  }
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify({ iss: GITHUB_APP_CLIENT_ID, iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540 })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

class GithubRequestError extends Error {
  status: number;
  constructor(status: number) { super(`GitHub request failed (${status}).`); this.status = status; }
}

export class GithubBuildApi {
  private token: string | undefined;
  private fetcher: typeof fetch;
  constructor(token: string | undefined, fetcher: typeof fetch = fetch) { this.token = token; this.fetcher = fetcher; }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.fetcher(`${GITHUB_API}${path}`, {
      method, headers: { ...GITHUB_API_HEADERS, ...(this.token && { Authorization: `Bearer ${this.token}` }), ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new GithubRequestError(response.status);
    if (response.status === 204) return undefined as T;
    const data = await readBoundedJson(response, 8 * 1024 * 1024);
    if (data === null) throw new Error("GitHub returned an invalid or oversized response.");
    return data as T;
  }
  repo<T>(path: string, method = "GET", body?: unknown): Promise<T> { return this.request<T>(`/repos/${BUILD_REPO}${path}`, method, body); }
}

export async function installationApi(env: Env, fetcher: typeof fetch = fetch, readOnly = false): Promise<GithubBuildApi> {
  if (!env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub builds are unavailable.");
  const app = new GithubBuildApi(await githubAppJwt(env.GITHUB_APP_PRIVATE_KEY), fetcher);
  const installation = await app.repo<{ id: number; permissions?: Record<string, string> }>("/installation");
  if (!Number.isSafeInteger(installation.id)) throw new Error("GitHub installation is unavailable.");
  const data = await app.request<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, "POST", { repositories: [BUILD_REPO.split("/")[1]], permissions: { contents: readOnly ? "read" : "write", pull_requests: readOnly ? "read" : "write", issues: "read", ...(readOnly && installation.permissions?.checks && { checks: "read" }), ...(readOnly && installation.permissions?.statuses && { statuses: "read" }) } });
  if (typeof data.token !== "string") throw new Error("GitHub installation authorization failed.");
  return new GithubBuildApi(data.token, fetcher);
}

export async function currentMain(api: GithubBuildApi): Promise<string> {
  const data = await api.repo<{ object: { sha: string } }>("/git/ref/heads/main");
  if (!/^[a-f0-9]{40}$/.test(data.object?.sha)) throw new Error("GitHub main commit is unavailable.");
  return data.object.sha;
}

export class BuildBlockedError extends Error {}
export class BuildPullRequestRejectedError extends Error {}

export async function assertMainAncestor(api: GithubBuildApi, baseSha: string): Promise<void> {
  const comparison = await api.repo<{ status: string; merge_base_commit?: { sha: string } }>(`/compare/${baseSha}...main`);
  if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== baseSha) throw new BuildBlockedError("The base commit is not in main history.");
}

function validSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }

export async function validateBuildBase(api: GithubBuildApi, run: StoredRun, upload: BuildUpload): Promise<string> {
  if (upload.baseSha !== run.baseSha) throw new BuildBlockedError("The upload does not match the assigned base commit.");
  await assertMainAncestor(api, upload.baseSha);
  const base = await api.repo<{ tree: { sha: string } }>(`/git/commits/${upload.baseSha}`);
  if (!validSha(base.tree?.sha)) throw new Error("GitHub base tree is unavailable.");
  const tree = await api.repo<{ truncated: boolean; tree: { path: string; type: string; mode: string }[] }>(`/git/trees/${base.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new BuildBlockedError("The base tree could not be fully checked.");
  const existing = new Map(tree.tree.map((entry) => [entry.path, entry]));
  const changed = new Set([...upload.files.map((file) => file.path), ...upload.deletions]);
  for (const path of changed) {
    const entry = existing.get(path);
    if (entry && (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))) throw new BuildBlockedError("Replacing directories, symlinks or submodules is blocked.");
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (changed.has(parent) || existing.has(parent) && existing.get(parent)?.type !== "tree") throw new BuildBlockedError("A changed path has a non-directory parent.");
    }
    if (upload.deletions.includes(path) && !entry) throw new BuildBlockedError("A deleted file does not exist in the base tree.");
  }
  return base.tree.sha;
}

export async function createBuildPullRequest(api: GithubBuildApi, run: StoredRun, upload: BuildUpload, validatedBaseTree?: string): Promise<NonNullable<BuildRun["pr"]>> {
  const baseTree = validatedBaseTree ?? await validateBuildBase(api, run, upload);
  const entries: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  for (const file of upload.files) {
    const blob = await api.repo<{ sha: string }>("/git/blobs", "POST", { encoding: "base64", content: file.content });
    if (!validSha(blob.sha)) throw new Error("GitHub blob confirmation is unavailable.");
    entries.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
  }
  for (const path of upload.deletions) entries.push({ path, mode: "100644", type: "blob", sha: null });
  const tree = await api.repo<{ sha: string }>("/git/trees", "POST", { base_tree: baseTree, tree: entries });
  if (!validSha(tree.sha)) throw new Error("GitHub tree confirmation is unavailable.");
  const message = upload.message.split(/\r\n?|\n/).filter((line) => !/^\s*co-authored-by\s*:/i.test(line)).join("\n").trim() || run.plan.title;
  const commit = await api.repo<{ sha: string }>("/git/commits", "POST", { message: `${message}\n\nCo-authored-by: ${run.coauthor}`, tree: tree.sha, parents: [upload.baseSha] });
  if (!validSha(commit.sha)) throw new Error("GitHub commit confirmation is unavailable.");
  await api.repo("/git/refs", "POST", { ref: `refs/heads/${run.state.branch}`, sha: commit.sha });
  let pr: { number: number; html_url: string; head: { sha: string } };
  try {
    pr = await api.repo("/pulls", "POST", {
      title: run.plan.title, head: run.state.branch, base: "main", draft: false,
      // GitHub can still turn a backslash-escaped @ into a mention.
      body: `${buildIssueBody(run.plan)}\n\n---\nRequested by @${run.account}.\n\nCo-authored-by: ${run.coauthor}\n\nBuild run: \`${run.state.runId}\`. Claude review is advisory; it does not authorize merging.`.replaceAll("@", "@\u200b"),
    });
  } catch (error) {
    if (!(error instanceof GithubRequestError) || error.status < 400 || error.status >= 500 || error.status === 408) throw error;
    try { await api.repo(`/git/refs/heads/${run.state.branch}`, "DELETE"); }
    catch { throw new BuildPullRequestRejectedError("GitHub rejected pull request creation; the build branch could not be removed."); }
    throw new BuildPullRequestRejectedError("GitHub rejected pull request creation; the build branch was removed.");
  }
  if (!Number.isSafeInteger(pr.number) || pr.number < 1 || pr.html_url !== `https://github.com/${BUILD_REPO}/pull/${pr.number}` || !validSha(pr.head?.sha)) throw new Error("GitHub pull request confirmation is unavailable.");
  return { number: pr.number, url: pr.html_url, headSha: pr.head.sha };
}

type GithubCheck = { name: string; status: string; conclusion: string | null; html_url?: string; details_url?: string; completed_at?: string; started_at?: string; app?: { slug: string } };
type GithubStatus = { context: string; state: string; target_url?: string; updated_at: string };

function vercelDeploymentName(name: string): boolean {
  return /^Vercel(?: [-–] [a-z0-9][a-z0-9._-]*)?$/i.test(name);
}

function checkKind(check: GithubCheck): "ci" | "preview" | "auxiliary" {
  if (check.app?.slug === "vercel") {
    if (check.name === "Vercel Preview Comments") return "auxiliary";
    if (vercelDeploymentName(check.name)) return "preview";
  }
  if (check.app?.slug === "cloudflare-workers-and-pages" && /^Workers Builds: \S/.test(check.name)) return "preview";
  return "ci";
}

function isPreviewStatus(status: GithubStatus): boolean {
  if (!vercelDeploymentName(status.context)) return false;
  try {
    const url = new URL(status.target_url ?? "");
    return url.protocol === "https:" && url.hostname === "vercel.com";
  } catch { return false; }
}

function checkState(check: GithubCheck): string {
  return check.status !== "completed" ? "pending" : check.conclusion ?? "unknown";
}

function aggregateState(states: string[]): string {
  if (states.some((state) => ["failure", "error", "timed_out", "cancelled", "action_required", "startup_failure"].includes(state))) return "failure";
  if (states.some((state) => ["pending", "queued", "in_progress"].includes(state))) return "pending";
  return states.length && states.every((state) => ["success", "neutral", "skipped"].includes(state)) ? "success" : "unknown";
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
  if (!run.pr || ["merged", "closed"].includes(run.phase)) return {};
  const pr = await api.repo<{ state: string; merged: boolean; head: { sha: string }; html_url: string; number: number; updated_at: string }>(`/pulls/${run.pr.number}`);
  const result: Partial<BuildRun> = { phase: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "pr_open", pr: { number: pr.number, url: pr.html_url, headSha: pr.head.sha }, reconciledAt: Date.now(), githubUpdatedAt: Date.parse(pr.updated_at) || undefined };
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
  const status = statusResult.status === "fulfilled" ? statusResult.value : null;
  const ciChecks = checks.filter((check) => checkKind(check) === "ci");
  const ciStatuses = status?.statuses.filter((item) => !isPreviewStatus(item)) ?? [];
  if (checkResult.status === "fulfilled" && statusResult.status === "fulfilled" && statusResult.value.total_count <= statusResult.value.statuses.length) {
    result.ci = { state: aggregateState([...ciChecks.map(checkState), ...ciStatuses.map((item) => item.state)]), updatedAt: Date.now() };
    const previews = [
      ...statusResult.value.statuses.filter(isPreviewStatus).map((item) => ({ state: item.state, url: item.target_url })),
      ...checks.filter((check) => checkKind(check) === "preview").map((check) => ({ state: checkState(check), url: check.details_url ?? check.html_url })),
    ];
    const state = aggregateState(previews.map((preview) => preview.state));
    result.preview = { state, url: previews.find((preview) => aggregateState([preview.state]) === state)?.url, updatedAt: Date.now() };
  }
  if (commentsResult.status === "fulfilled") {
    const comment = commentsResult.value;
    if (comment) result.review = { state: comment.body.slice(0, 600), url: comment.html_url, updatedAt: Date.now() };
  }
  return result;
}
