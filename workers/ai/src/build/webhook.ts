import { BUILD_REPO, runIdFromBranch, type BuildRun } from "@shared/build-routine";
import type { Env } from "../runtime";

export async function verifyGithubWebhook(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (part) => parseInt(part, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, bytes, Uint8Array.from(body));
}

type WebhookPayload = {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number: number; state: string; merged: boolean; html_url: string; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string }; updated_at: string };
  check_run?: { name: string; head_sha: string; status: string; conclusion: string | null; details_url?: string; completed_at?: string; started_at?: string; app?: { slug: string } };
  check_suite?: { head_sha: string; status: string; conclusion: string | null; updated_at?: string; app?: { slug: string } };
  sha?: string; state?: string; context?: string; target_url?: string; updated_at?: string;
  issue?: { number: number };
  comment?: { user: { login: string }; body: string; html_url: string; updated_at: string };
};

export async function applyGithubWebhook(env: Env, event: string, payload: WebhookPayload): Promise<void> {
  if (!env.BUILD_COORDINATOR || payload.repository?.full_name?.toLowerCase() !== BUILD_REPO.toLowerCase()) return;
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  let runId: string | null = null;
  const patch: Partial<BuildRun> = {};
  if (event === "pull_request" && payload.pull_request) {
    const pr = payload.pull_request;
    if (pr.head.repo?.full_name?.toLowerCase() !== BUILD_REPO.toLowerCase() || pr.base?.ref !== "main") return;
    runId = runIdFromBranch(pr.head.ref);
    const existing = runId ? await coordinator.readRun(runId) : null;
    if (!existing?.uploadUsed || existing.state.pr && existing.state.pr.number !== pr.number || !["validated", "pr_open", "closed", "merged", "failed", "timeout"].includes(existing.state.phase)) return;
    patch.phase = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "pr_open";
    if (!Number.isFinite(Date.parse(pr.updated_at))) return;
    patch.githubUpdatedAt = Date.parse(pr.updated_at);
    patch.pr = { number: pr.number, url: pr.html_url, headSha: pr.head.sha };
  } else if (event === "issue_comment" && payload.issue && payload.comment?.user.login === "claude[bot]") {
    runId = (await coordinator.findRun(undefined, payload.issue.number))?.state.runId ?? null;
    patch.review = { state: payload.action === "deleted" ? "unknown" : payload.comment.body.slice(0, 600), url: payload.comment.html_url, updatedAt: payload.action === "deleted" ? Date.now() : Date.parse(payload.comment.updated_at) || Date.now() };
  } else if (event === "check_run" && payload.check_run) {
    const check = payload.check_run;
    runId = (await coordinator.findRun(check.head_sha))?.state.runId ?? null;
    if (/vercel/i.test(`${check.name} ${check.app?.slug}`)) patch.preview = { state: check.conclusion ?? check.status, url: check.details_url, updatedAt: Date.parse(check.completed_at ?? check.started_at ?? "") || Date.now() };
    // A single check cannot establish the aggregate CI result; reconciliation reads every check on the current head.
    patch.reconciledAt = 0;
  } else if (event === "check_suite" && payload.check_suite) {
    runId = (await coordinator.findRun(payload.check_suite.head_sha))?.state.runId ?? null;
    patch.reconciledAt = 0;
  } else if (event === "status" && payload.sha) {
    runId = (await coordinator.findRun(payload.sha))?.state.runId ?? null;
    if (/vercel/i.test(payload.context ?? "")) patch.preview = { state: payload.state ?? "unknown", url: payload.target_url, updatedAt: Date.parse(payload.updated_at ?? "") || Date.now() };
    patch.reconciledAt = 0;
  }
  if (runId) await coordinator.updateRun(runId, patch);
}
