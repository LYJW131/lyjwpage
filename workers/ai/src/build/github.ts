import { setTimeout as sleep } from "node:timers/promises";

import { BUILD_CLOSED_PHASES, BUILD_REPO, branchForRun, buildIssueBody, buildIssueMarker, PLAN_LABELS, planLanguage, type BuildRun, type BuildSignal, type BuildUpload } from "@shared/build-routine";
import { previewWorkerOrigin, SITE_PREVIEW_WORKER_SCRIPT } from "../../../../scripts/preview-worker-name.ts";
import { GITHUB_APP_CLIENT_ID, type GithubIssueResult } from "@shared/github-issue";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";
import { readBoundedJson } from "./http";
import { markdownDoc, outsidePlanPaths } from "./validation";
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

export class GithubRequestError extends Error {
  status: number;
  constructor(status: number) { super(`GitHub request failed (${status}).`); this.status = status; }
}

export class GithubBuildApi {
  private token: string | undefined;
  private fetcher: typeof fetch;
  constructor(token: string | undefined, fetcher: typeof fetch = fetch) {
    this.token = token;
    // workerd 的全局 fetch 以别的对象作 this 调用会抛 Illegal invocation，存成方法前要包一层。
    this.fetcher = (input, init) => fetcher(input, init);
  }
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
  const data = await app.request<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, "POST", { repositories: [BUILD_REPO.split("/")[1]], permissions: { contents: readOnly ? "read" : "write", pull_requests: readOnly ? "read" : "write", issues: "read", ...(installation.permissions?.checks && { checks: "read" }), ...(installation.permissions?.statuses && { statuses: "read" }) } });
  if (typeof data.token !== "string") throw new Error("GitHub installation authorization failed.");
  return new GithubBuildApi(data.token, fetcher);
}

export async function currentMain(api: GithubBuildApi): Promise<string> {
  const data = await api.repo<{ object: { sha: string } }>("/git/ref/heads/main");
  if (!validSha(data.object?.sha)) throw new Error("GitHub main commit is unavailable.");
  return data.object.sha;
}

type GithubIssue = { number: number; html_url: string; created_at?: string; body?: string | null; pull_request?: unknown };
const ISSUE_PAGE_SIZE = 100;
const ISSUE_PAGE_LIMIT = 10;

// 列表接口按创建时间倒序、立即可见；搜索接口有索引延迟，访客刚提交就回来时查不到。
// since 按更新时间过滤，翻到创建时间早于计划签发的条目为止；翻不完就报错，不能当成没有 issue。
export async function findPlanIssue(api: GithubBuildApi, issueRef: string, since: number): Promise<GithubIssueResult | null> {
  const marker = buildIssueMarker(issueRef);
  const matches: GithubIssue[] = [];
  for (let page = 1; page <= ISSUE_PAGE_LIMIT; page += 1) {
    const params = new URLSearchParams({ state: "all", sort: "created", direction: "desc", per_page: String(ISSUE_PAGE_SIZE), page: String(page), since: new Date(since).toISOString() });
    const issues = await api.repo<GithubIssue[]>(`/issues?${params}`);
    if (!Array.isArray(issues)) throw new Error("GitHub returned an invalid issue list.");
    matches.push(...issues.filter((issue) => !issue.pull_request && Number.isSafeInteger(issue.number) && issue.number > 0 && typeof issue.body === "string" && issue.body.includes(marker) && issue.html_url === `https://github.com/${BUILD_REPO}/issues/${issue.number}`));
    const oldest = Date.parse(issues.at(-1)?.created_at ?? "");
    if (issues.length < ISSUE_PAGE_SIZE || oldest < since) {
      const found = matches.sort((a, b) => a.number - b.number)[0];
      return found ? { number: found.number, url: found.html_url } : null;
    }
  }
  throw new Error("Too many GitHub issues to check for this plan.");
}

export class BuildBlockedError extends Error {}
export class BuildPullRequestRejectedError extends Error {}
export class BuildPublicationPendingError extends Error {}

export async function assertMainAncestor(api: GithubBuildApi, baseSha: string): Promise<void> {
  const comparison = await api.repo<{ status: string; merge_base_commit?: { sha: string } }>(`/compare/${baseSha}...main`);
  if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== baseSha) throw new BuildBlockedError("The base commit is not in main history.");
}

// 须与 .github/workflows/build.yml 中 implement job 的 --model 对应，scripts/build-actions.test.mjs 核对。
const BUILD_CLAUDE_COAUTHOR = "Claude Opus 5.5 <noreply@anthropic.com>";

export function validSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }

export async function validateBuildBase(api: GithubBuildApi, run: StoredRun, upload: BuildUpload): Promise<string> {
  if (upload.baseSha !== run.baseSha) throw new BuildBlockedError("The upload does not match the assigned base commit.");
  await assertMainAncestor(api, upload.baseSha);
  const base = await api.repo<{ tree: { sha: string } }>(`/git/commits/${upload.baseSha}`);
  if (!validSha(base.tree?.sha)) throw new Error("GitHub base tree is unavailable.");
  const tree = await api.repo<{ truncated: boolean; tree: { path: string; type: string; mode: string }[] }>(`/git/trees/${base.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new BuildBlockedError("The base tree could not be fully checked.");
  const existing = new Map(tree.tree.map((entry) => [entry.path, entry]));
  const changed = new Set(uploadPaths(upload));
  for (const path of changed) {
    const entry = existing.get(path);
    if (path === planPath(run) && entry) throw new BuildBlockedError("The build plan path already exists in main.");
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

type ReviewReason = keyof (typeof PLAN_LABELS)["en"]["reasons"];
const REVIEW_RULES: { reason: Exclude<ReviewReason, "outside">; test: (path: string) => boolean }[] = [
  { reason: "contract", test: (path) => path.startsWith("shared/") },
  { reason: "auth", test: (path) => /^workers\/[^/]+\/src\/build\//.test(path) || path.startsWith("workers/ingress/") },
  { reason: "prompt", test: (path) => path.startsWith("workers/ai/src/chat/") },
  { reason: "docs", test: (path) => markdownDoc(path) && !path.startsWith("docs/") },
];

function uploadPaths(upload: Pick<BuildUpload, "files" | "deletions">): string[] {
  return [...upload.files.map((file) => file.path), ...upload.deletions];
}

export function reviewPaths(upload: Pick<BuildUpload, "files" | "deletions">, planPaths: readonly string[]): { path: string; reasons: ReviewReason[] }[] {
  const outside = new Set(outsidePlanPaths(upload, planPaths));
  return uploadPaths(upload).flatMap((path) => {
    const reasons: ReviewReason[] = [...(outside.has(path) ? ["outside" as const] : []), ...REVIEW_RULES.filter((rule) => rule.test(path)).map((rule) => rule.reason)];
    return reasons.length ? [{ path, reasons }] : [];
  });
}

function reviewSection(review: { path: string; reasons: ReviewReason[] }[], labels: (typeof PLAN_LABELS)[keyof typeof PLAN_LABELS], links: Map<string, string>): string {
  if (!review.length) return "";
  const line = ({ path, reasons }: { path: string; reasons: ReviewReason[] }) => {
    const name = links.has(path) ? `[\`${path}\`](${links.get(path)})` : `\`${path}\``;
    return `- ${name} — ${reasons.map((reason) => labels.reasons[reason]).join(", ")}`;
  };
  return `\n\n## ${labels.review}\n${review.map(line).join("\n")}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type GithubPullRequest = {
  number: number; node_id: string; html_url: string; state: string; merged: boolean; draft: boolean; body: string; updated_at: string;
  head: { sha: string; ref: string; repo: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
  user: { id: number; login: string; type: string };
};
type GithubCommit = { sha: string; tree: { sha: string }; parents: { sha: string }[] };
const BUILD_COMMIT_IDENTITY = { name: "lyjw131[bot]", email: "338272049+lyjw131[bot]@users.noreply.github.com" };

function buildMarker(run: Pick<BuildRun, "runId">): string { return `<!-- build-run:${run.runId} -->`; }
function planPath(run: StoredRun): string { return `builds/${run.state.runId}.md`; }
function assertBuildIdentity(run: StoredRun): void {
  if (!/^[a-f0-9]{32}$/.test(run.state.runId) || run.state.branch !== branchForRun(run.state.runId) || !validSha(run.baseSha)) throw new BuildBlockedError("The build branch identity is invalid.");
}
function confirmedPullRequest(pr: GithubPullRequest, run: BuildRun, allowedHeads?: readonly string[], allowLegacyMarker = false): NonNullable<BuildRun["pr"]> {
  const marker = pr.body?.includes(buildMarker(run));
  const legacy = !marker && allowLegacyMarker && Object.values(PLAN_LABELS).some((labels) => pr.body?.includes(labels.buildRun(run.runId)));
  if (!Number.isSafeInteger(pr.number) || pr.number < 1 || pr.html_url !== `https://github.com/${BUILD_REPO}/pull/${pr.number}` || !validSha(pr.head?.sha)
    || pr.head.ref !== run.branch || pr.head.repo?.full_name !== BUILD_REPO || pr.base?.ref !== "main" || pr.base.repo?.full_name !== BUILD_REPO
    || pr.user?.id !== 338272049 || pr.user.login !== BUILD_COMMIT_IDENTITY.name || pr.user.type !== "Bot"
    || !marker && !legacy || run.pr && pr.number !== run.pr.number || allowedHeads && !allowedHeads.includes(pr.head.sha)) throw new BuildBlockedError("The pull request does not match this build.");
  return { number: pr.number, url: pr.html_url, headSha: pr.head.sha, ...(!legacy && { draft: pr.draft }) };
}
async function branchHead(api: GithubBuildApi, branch: string): Promise<string | null> {
  try {
    const ref = await api.repo<{ ref: string; object: { sha: string } }>(`/git/ref/heads/${branch}`);
    if (ref.ref !== `refs/heads/${branch}` || !validSha(ref.object?.sha)) throw new BuildBlockedError("The build branch could not be verified.");
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GithubRequestError && error.status === 404) return null;
    throw error;
  }
}
async function existingPullRequest(api: GithubBuildApi, run: StoredRun): Promise<GithubPullRequest | null> {
  if (run.state.pr) return api.repo<GithubPullRequest>(`/pulls/${run.state.pr.number}`);
  const head = encodeURIComponent(`${BUILD_REPO.split("/")[0]}:${run.state.branch}`);
  const prs = await api.repo<GithubPullRequest[]>(`/pulls?state=all&head=${head}&base=main&per_page=100`);
  if (!Array.isArray(prs) || prs.length > 1) throw new BuildBlockedError("The build branch has an ambiguous pull request history.");
  return prs[0] ?? null;
}
function assertOpenDraft(pr: GithubPullRequest): void {
  if (pr.state !== "open" || pr.merged || pr.draft !== true) throw new BuildBlockedError("The build pull request is no longer an open draft.");
}

export async function prepareBuildPullRequest(api: GithubBuildApi, run: StoredRun): Promise<{ pr: NonNullable<BuildRun["pr"]>; planCommitSha: string }> {
  assertBuildIdentity(run);
  const path = planPath(run);
  const baseTree = await validateBuildBase(api, run, { baseSha: run.baseSha, message: "", files: [{ path, mode: "100644", content: "" }], deletions: [] });
  const contents = `# ${run.plan.title}\n\n${buildIssueBody(run.plan)}\n`;
  const blob = await api.repo<{ sha: string }>("/git/blobs", "POST", { encoding: "utf-8", content: contents });
  if (!validSha(blob.sha)) throw new Error("GitHub plan blob confirmation is unavailable.");
  const tree = await api.repo<{ sha: string }>("/git/trees", "POST", { base_tree: baseTree, tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }] });
  if (!validSha(tree.sha) || tree.sha === baseTree) throw new BuildBlockedError("The build plan must create a new file difference.");
  const identity = { ...BUILD_COMMIT_IDENTITY, date: new Date(run.state.createdAt).toISOString() };
  const commit = await api.repo<{ sha: string }>("/git/commits", "POST", { message: `docs: record build plan ${run.state.runId}`, tree: tree.sha, parents: [run.baseSha], author: identity, committer: identity });
  if (!validSha(commit.sha) || run.planCommitSha && run.planCommitSha !== commit.sha) throw new BuildBlockedError("GitHub plan commit confirmation does not match this build.");
  let head = await branchHead(api, run.state.branch);
  if (!head) {
    try { await api.repo("/git/refs", "POST", { ref: `refs/heads/${run.state.branch}`, sha: commit.sha }); }
    catch (error) {
      head = await branchHead(api, run.state.branch);
      if (!head) throw error;
    }
    head ??= await branchHead(api, run.state.branch);
  }
  if (head !== commit.sha) throw new BuildBlockedError("The build branch contains an unexpected commit.");
  let pr = await existingPullRequest(api, run);
  if (!pr) {
    try {
      pr = await api.repo<GithubPullRequest>("/pulls", "POST", { title: run.plan.title, head: run.state.branch, base: "main", draft: true, body: `${buildIssueBody(run.plan)}\n\n${buildMarker(run.state)}`.replaceAll("@", "@\u200b") });
    } catch (error) {
      pr = await existingPullRequest(api, run);
      if (!pr) {
        if (error instanceof GithubRequestError && error.status >= 400 && error.status < 500 && error.status !== 408) throw new BuildPullRequestRejectedError("GitHub rejected draft pull request creation; the build branch was preserved for retry.");
        throw error;
      }
    }
  }
  const confirmed = confirmedPullRequest(pr, run.state, [commit.sha]);
  assertOpenDraft(pr);
  return { pr: confirmed, planCommitSha: commit.sha };
}

export async function closeFailedDraft(api: GithubBuildApi, run: StoredRun): Promise<void> {
  if (!validSha(run.planCommitSha) || !run.state.pr || run.implementationHeadSha) throw new BuildBlockedError("Only a draft holding the build plan alone can be closed.");
  const pr = await existingPullRequest(api, run);
  if (!pr) throw new BuildBlockedError("The build pull request is unavailable.");
  confirmedPullRequest(pr, run.state, [run.planCommitSha]);
  if (pr.state === "closed") return;
  assertOpenDraft(pr);
  const closed = await api.repo<GithubPullRequest>(`/pulls/${pr.number}`, "PATCH", { state: "closed" });
  if (closed.state !== "closed") throw new Error("GitHub did not confirm closing the draft pull request.");
}

async function preparedCommit(api: GithubBuildApi, run: StoredRun): Promise<GithubCommit> {
  assertBuildIdentity(run);
  if (!validSha(run.planCommitSha) || !run.state.pr) throw new BuildBlockedError("The build draft has not been prepared.");
  const commit = await api.repo<GithubCommit>(`/git/commits/${run.planCommitSha}`);
  if (commit.sha !== run.planCommitSha || !validSha(commit.tree?.sha) || commit.parents?.length !== 1 || commit.parents[0].sha !== run.baseSha) throw new BuildBlockedError("The plan commit does not match the assigned base commit.");
  return commit;
}

async function confirmedPublication(api: GithubBuildApi, run: StoredRun, pr: GithubPullRequest): Promise<NonNullable<BuildRun["pr"]>> {
  const confirmed = confirmedPullRequest(pr, run.state, [run.implementationHeadSha!]);
  if (pr.state !== "open" || pr.merged || typeof pr.draft !== "boolean") throw new BuildBlockedError("The build pull request is no longer open.");
  if (await branchHead(api, run.state.branch) !== run.implementationHeadSha) throw new BuildBlockedError("The build branch contains an unexpected commit.");
  if (pr.draft === false && pr.body !== run.publicationBody) throw new BuildBlockedError("The published pull request review details do not match this build.");
  return confirmed;
}

export async function recoverBuildPublication(api: GithubBuildApi, run: StoredRun): Promise<NonNullable<BuildRun["pr"]>> {
  await preparedCommit(api, run);
  if (!validSha(run.implementationHeadSha)) throw new BuildBlockedError("The implementation commit has not been recorded.");
  const implementation = await api.repo<GithubCommit>(`/git/commits/${run.implementationHeadSha}`);
  if (implementation.sha !== run.implementationHeadSha || implementation.parents?.length !== 1 || implementation.parents[0].sha !== run.planCommitSha) throw new BuildBlockedError("The implementation commit does not continue this build plan.");
  const pr = await existingPullRequest(api, run);
  if (!pr) throw new BuildBlockedError("The build pull request is unavailable.");
  confirmedPullRequest(pr, run.state, [run.planCommitSha!, run.implementationHeadSha]);
  if (!run.publicationBody?.includes(buildMarker(run.state))) throw new BuildBlockedError("The implementation review details have not been recorded.");
  if (pr.draft === false) return confirmedPublication(api, run, pr);
  assertOpenDraft(pr);
  await api.repo(`/pulls/${pr.number}`, "PATCH", { body: run.publicationBody });
  const head = await branchHead(api, run.state.branch);
  if (head !== run.planCommitSha && head !== run.implementationHeadSha) throw new BuildBlockedError("The build branch contains an unexpected commit.");
  if (head !== run.implementationHeadSha) {
    try { await api.repo(`/git/refs/heads/${run.state.branch}`, "PATCH", { sha: run.implementationHeadSha, force: false }); }
    catch (error) { if (await branchHead(api, run.state.branch) !== run.implementationHeadSha) throw error; }
  }
  const updated = await pullRequestAfterPush(api, run);
  if (!updated) throw new Error("GitHub pull request confirmation is unavailable.");
  if (updated.head?.sha === run.planCommitSha) throw new BuildPublicationPendingError("GitHub has not moved the pull request to the implementation commit yet.");
  return confirmedPublication(api, run, updated);
}

// GitHub 推进 PR 的 head 晚于分支 ref，实测可滞后数分钟；仍停在计划提交时 run 留在 validated 由状态查询接着恢复，不当成篡改报 blocked
const PR_HEAD_SYNC_DELAYS_MS = [250, 500, 1000, 2000];

async function pullRequestAfterPush(api: GithubBuildApi, run: StoredRun): Promise<GithubPullRequest | null> {
  for (let attempt = 0; ; attempt += 1) {
    const pr = await existingPullRequest(api, run);
    if (pr?.head?.sha !== run.planCommitSha || attempt >= PR_HEAD_SYNC_DELAYS_MS.length) return pr;
    await sleep(PR_HEAD_SYNC_DELAYS_MS[attempt]);
  }
}

export async function createBuildPullRequest(api: GithubBuildApi, run: StoredRun, upload: BuildUpload, validatedBaseTree: string | undefined, recordImplementationHead: (sha: string, body: string) => Promise<void>): Promise<NonNullable<BuildRun["pr"]>> {
  if (run.implementationHeadSha) return recoverBuildPublication(api, run);
  if (!validatedBaseTree) await validateBuildBase(api, run, upload);
  if (upload.baseSha !== run.baseSha || uploadPaths(upload).some((path) => path === planPath(run) || path.startsWith("builds/"))) throw new BuildBlockedError("The upload cannot replace the recorded build plan.");
  const planCommit = await preparedCommit(api, run);
  const existing = await existingPullRequest(api, run);
  if (!existing) throw new BuildBlockedError("The build draft is unavailable.");
  confirmedPullRequest(existing, run.state, [run.planCommitSha!]);
  assertOpenDraft(existing);
  if (await branchHead(api, run.state.branch) !== run.planCommitSha) throw new BuildBlockedError("The build branch contains an unexpected commit.");
  const entries: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  for (const file of upload.files) {
    const blob = await api.repo<{ sha: string }>("/git/blobs", "POST", { encoding: "base64", content: file.content });
    if (!validSha(blob.sha)) throw new Error("GitHub blob confirmation is unavailable.");
    entries.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
  }
  for (const path of upload.deletions) entries.push({ path, mode: "100644", type: "blob", sha: null });
  const tree = await api.repo<{ sha: string }>("/git/trees", "POST", { base_tree: planCommit.tree.sha, tree: entries });
  if (!validSha(tree.sha) || tree.sha === planCommit.tree.sha) throw new BuildBlockedError("The upload does not contain implementation changes.");
  const message = upload.message.split(/\r\n?|\n/).filter((line) => !/^\s*(co-authored-by|claude-session)\s*:/i.test(line)).join("\n").trim() || run.plan.title;
  const trailers = `Co-authored-by: ${run.coauthor}\nCo-Authored-By: ${BUILD_CLAUDE_COAUTHOR}`;
  const commit = await api.repo<{ sha: string }>("/git/commits", "POST", { message: `${message}\n\n${trailers}`, tree: tree.sha, parents: [run.planCommitSha] });
  if (!validSha(commit.sha)) throw new Error("GitHub commit confirmation is unavailable.");
  const pr = run.state.pr!;
  const labels = PLAN_LABELS[planLanguage(run.plan)];
  const review = reviewPaths(upload, run.plan.paths);
  const links = new Map(await Promise.all(review.map(async ({ path }) => [path, `${pr.url}/files#diff-${await sha256Hex(path)}`] as const)));
  const body = `${buildIssueBody(run.plan)}${reviewSection(review, labels, links)}\n\n---\n${labels.requestedBy(run.account)}\n\n${trailers}\n\n${labels.buildRun(run.state.runId)}\n\n${buildMarker(run.state)}`.replaceAll("@", "@\u200b");
  await recordImplementationHead(commit.sha, body);
  return recoverBuildPublication(api, { ...run, implementationHeadSha: commit.sha, publicationBody: body });
}

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
  const confirmed = confirmedPullRequest(pr, run, undefined, run.pr.draft === undefined);
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
