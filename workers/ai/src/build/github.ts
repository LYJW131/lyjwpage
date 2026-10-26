import { setTimeout as sleep } from "node:timers/promises";

import { BUILD_REPO, buildIssueBody, buildIssueMarker, PLAN_LABELS, planLanguage, type BuildRun, type BuildUpload } from "@shared/build-routine";
import type { GithubIssueResult } from "@shared/github-issue";
import { sha256Hex } from "@shared/sha256";
import type { StoredRun } from "./coordinator";
import { markdownDoc, outsidePlanPaths, ruleDoc } from "./validation";
import { GithubRequestError, validSha, type GithubBuildApi } from "./github-api";
import { assertBuildIdentity, assertOpenDraft, branchHead, BUILD_COMMIT_IDENTITY, BuildBlockedError, BuildPublicationPendingError, BuildPullRequestRejectedError, buildMarker, confirmedPullRequest, existingPullRequest, planPath, preparedCommit, type GithubPullRequest, type GithubCommit } from "./pull-request";

export { currentMain, githubAppJwt, GithubBuildApi, GithubRequestError, installationApi, validSha } from "./github-api";
export { BuildBlockedError, BuildPublicationPendingError, BuildPullRequestRejectedError } from "./pull-request";
export { BUILD_READY_CHECKS, markBuildReady, reconcileBuild } from "./checks";


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


export async function assertMainAncestor(api: GithubBuildApi, baseSha: string): Promise<void> {
  const comparison = await api.repo<{ status: string; merge_base_commit?: { sha: string } }>(`/compare/${baseSha}...main`);
  if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== baseSha) throw new BuildBlockedError("The base commit is not in main history.");
}

// 须与 .github/workflows/build.yml 中 implement job 的 --model 对应，scripts/build-actions.test.ts 核对。
const BUILD_CLAUDE_COAUTHOR = "Claude Opus 5.5 <noreply@anthropic.com>";


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
  { reason: "rules", test: ruleDoc },
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

function droppedSection(dropped: readonly string[], labels: (typeof PLAN_LABELS)[keyof typeof PLAN_LABELS]): string {
  return dropped.length ? `\n\n## ${labels.dropped}\n${dropped.map((path) => `- \`${path}\``).join("\n")}` : "";
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
  // 先关后评：关闭失败重试时已关的草稿直接返回，评论不会重复。原因可能来自 Claude 写的停下说明，放进代码块免得渲染成链接或图片。
  const reason = (run.state.reason ?? "unknown").replaceAll("`", "'").replaceAll("@", "@\u200b");
  try { await api.repo(`/issues/${pr.number}/comments`, "POST", { body: `${PLAN_LABELS[planLanguage(run.plan)].draftClosed}\n\n\`\`\`text\n${reason}\n\`\`\`` }); }
  catch (error) {
    console.error("[build] draft close comment failed", error);
  }
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

export async function createBuildPullRequest(api: GithubBuildApi, run: StoredRun, upload: BuildUpload & { dropped?: readonly string[] }, validatedBaseTree: string | undefined, recordImplementationHead: (sha: string, body: string) => Promise<void>): Promise<NonNullable<BuildRun["pr"]>> {
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
  const body = `${buildIssueBody(run.plan)}${reviewSection(review, labels, links)}${droppedSection(upload.dropped ?? [], labels)}\n\n---\n${labels.requestedBy(run.account)}\n\n${trailers}\n\n${labels.buildRun(run.state.runId)}\n\n${buildMarker(run.state)}`.replaceAll("@", "@\u200b");
  await recordImplementationHead(commit.sha, body);
  return recoverBuildPublication(api, { ...run, implementationHeadSha: commit.sha, publicationBody: body });
}
