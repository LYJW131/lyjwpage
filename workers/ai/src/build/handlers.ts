import * as Sentry from "@sentry/cloudflare";
import { BUILD_PROGRESS_PATH, BUILD_RECONCILE_MS, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, BUILD_TOKEN_MAX_CHARS, BUILD_UPLOAD_LIMITS, BUILD_UPLOAD_PATH, branchForRun, newRunId, type BuildFireResult } from "@shared/build-routine";
import { anthropicFetch } from "../chat/egress";
import { readJsonBody } from "../chat/guard";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";
import { BuildBlockedError, BuildPullRequestRejectedError, validateBuildBase, createBuildPullRequest, currentMain, GithubBuildApi, installationApi, reconcileBuild, requestAgentReviews } from "./github";
import { exchangeCode, revoke } from "./github-oauth";
import { readPlan } from "./plan";
import { readBoundedJson } from "./http";
import { hashToken, signBuildToken, verifyBuildToken } from "./token";
import { parseBuildUpload } from "./validation";
import { applyGithubWebhook, verifyGithubWebhook } from "./webhook";

type StatusPayload = { kind: "status"; runId: string; expiresAt: number };
const noStore = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: noStore });
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bearer = (request: Request) => /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
const validRunId = (id: string | null): id is string => !!id && /^[a-f0-9]{32}$/.test(id);
const BUILD_BLOCK_REASON_CHARS = 600;
const validSessionUrl = (url: string) => /^https:\/\/claude\.ai\/code\/[\w-]{1,200}$/.test(url);

type GithubVisitor = { account: string; userId: number; name: string | null };

// 每次构建都由访客在弹窗里授权一次：换来的令牌只用来确认身份，用完立即撤销，Worker 不签发也不保存会话凭据。
async function verifyGithubVisitor(code: string, codeVerifier: string, secret: string, fetcher: typeof fetch): Promise<GithubVisitor | Response> {
  let token: string | null = null;
  try {
    token = await exchangeCode(code, codeVerifier, secret, fetcher);
    if (!token) return fail(401, "GitHub sign-in did not complete.");
    const user = await new GithubBuildApi(token, fetcher).request<{ id: number; login: string; name: string | null }>("/user");
    if (!Number.isSafeInteger(user.id) || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) return fail(502, "GitHub identity could not be verified.");
    const name = typeof user.name === "string" ? user.name.replace(/[\r\n<>]/g, " ").trim().slice(0, 100) || null : null;
    return { account: user.login, userId: user.id, name };
  } catch { return fail(502, "GitHub sign-in is temporarily unavailable."); }
  finally { if (token) await revoke(token, secret, fetcher); }
}

export async function handleBuild(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR || !env.ROUTINE_FIRE_URL || !env.ROUTINE_FIRE_TOKEN || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_CLIENT_SECRET) return fail(503, "Builds are unavailable right now.");
  const data = object(await readJsonBody(request, BUILD_TOKEN_MAX_CHARS + 5000));
  if (!data || typeof data.planToken !== "string" || typeof data.code !== "string" || !/^[\w.-]{1,512}$/.test(data.code) || typeof data.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.codeVerifier)) return fail(400, "A signed plan and GitHub sign-in are required.");
  const plan = await readPlan(env, data.planToken);
  if (!plan) return fail(401, "The plan has expired.");
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  if (await coordinator.isPlanUsed(plan.id)) return fail(409, "This plan has already been used.");
  const session = await verifyGithubVisitor(data.code, data.codeVerifier, env.GITHUB_APP_CLIENT_SECRET, fetcher);
  if (session instanceof Response) return session;
  const runId = newRunId();
  const createdAt = Date.now();
  const uploadToken = newRunId() + newRunId();
  const branch = branchForRun(runId);
  let reserved = false;
  let dispatched = false;
  try {
    const baseSha = await currentMain(await installationApi(env, fetcher, true));
    const coauthor = `${session.name || session.account} <${session.userId}+${session.account}@users.noreply.github.com>`;
    const run: StoredRun = { state: { runId, branch, phase: "triggered", createdAt, updatedAt: createdAt }, plan: plan.plan, account: session.account, accountId: session.userId, coauthor, baseSha, uploadHash: await hashToken(uploadToken), uploadUsed: false, uploadExpiresAt: createdAt + BUILD_TIMEOUT_MS };
    const admission = await coordinator.reserveRun(run, plan.id, plan.expiresAt);
    if (admission === "used") return fail(409, "This plan has already been used.");
    if (admission !== "ok") return fail(429, admission === "account" ? "This GitHub account has reached its hourly build limit." : "The site's hourly build limit has been reached.");
    reserved = true;
    const statusToken = await signBuildToken<StatusPayload>({ kind: "status", runId, expiresAt: createdAt + BUILD_STATUS_TTL_MS }, env.BUILD_SESSION_SECRET);
    const origin = new URL(request.url).origin;
    const routineFetcher = anthropicFetch(env) ?? fetcher;
    dispatched = true;
    const response = await routineFetcher(env.ROUTINE_FIRE_URL, {
      method: "POST", headers: { Authorization: `Bearer ${env.ROUTINE_FIRE_TOKEN}`, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify({ runId, plan: plan.plan, coauthor, baseSha, uploadToken, uploadUrl: `${origin}${BUILD_UPLOAD_PATH}?runId=${runId}`, progressUrl: `${origin}${BUILD_PROGRESS_PATH}?runId=${runId}` }) }),
      signal: AbortSignal.timeout(20_000),
    });
    const confirmation = await readBoundedJson(response, 16_384);
    const sessionUrl = object(confirmation)?.claude_code_session_url;
    if (!response.ok) await coordinator.updateRun(runId, { phase: "failed", reason: "The routine rejected the build request." });
    else if (typeof sessionUrl !== "string") await coordinator.updateRun(runId, { reason: "The routine did not confirm the build request; its result is unknown." });
    else if (validSessionUrl(sessionUrl)) await coordinator.setSessionUrl(runId, sessionUrl);
    return Response.json({ runId, branch, statusToken } satisfies BuildFireResult, { status: 202, headers: noStore });
  } catch {
    if (reserved) {
      await coordinator.updateRun(runId, dispatched ? { reason: "Build dispatch was not confirmed; the routine result is unknown." } : { phase: "failed", reason: "The build could not be prepared; the routine was not started." });
      const statusToken = await signBuildToken<StatusPayload>({ kind: "status", runId, expiresAt: createdAt + BUILD_STATUS_TTL_MS }, env.BUILD_SESSION_SECRET);
      return Response.json({ runId, branch, statusToken } satisfies BuildFireResult, { status: 202, headers: noStore });
    }
    return fail(502, "The build could not be started.");
  }
}

export async function handleBuildStatus(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET") return fail(405, "Method not allowed.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR) return fail(503, "Build status is unavailable.");
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  const signature = token ? await verifyBuildToken<StatusPayload>(token, env.BUILD_SESSION_SECRET, "status") : null;
  if (!validRunId(runId) || signature?.runId !== runId) return fail(401, "The build status link is invalid or expired.");
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  const run = await coordinator.readRun(runId);
  if (!run) return fail(404, "Build not found.");
  if (run.state.pr && !["merged", "closed"].includes(run.state.phase) && (!run.state.reconciledAt || Date.now() - run.state.reconciledAt >= BUILD_RECONCILE_MS) && await coordinator.claimReconcile(runId)) {
    try {
      const patch = await reconcileBuild(await installationApi(env, fetcher, true), run.state);
      const state = await coordinator.updateRun(runId, patch, run.state.pr.headSha);
      return Response.json(state, { headers: noStore });
    } catch { /* Preserve the last observed facts when GitHub is unreachable. */ }
  }
  return Response.json(run.state, { headers: noStore });
}

export async function handleBuildUpload(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_COORDINATOR || !env.GITHUB_APP_PRIVATE_KEY) return fail(503, "Build uploads are unavailable.");
  const runId = new URL(request.url).searchParams.get("runId");
  const token = bearer(request);
  if (!validRunId(runId) || !token) return fail(401, "Invalid upload authorization.");
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  const run = await coordinator.claimUpload(runId, await hashToken(token));
  if (!run) return fail(401, "Upload authorization was used or expired.");
  let upload;
  try {
    upload = parseBuildUpload(await readJsonBody(request, BUILD_UPLOAD_LIMITS.requestBytes), run.plan.paths);
    if (upload.baseSha !== run.baseSha) throw new Error("The upload does not match the assigned base commit.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid upload.";
    await coordinator.updateRun(runId, { phase: "blocked", reason });
    return fail(400, reason);
  }
  try {
    const api = await installationApi(env, fetcher);
    const baseTree = await validateBuildBase(api, run, upload);
    await coordinator.updateRun(runId, { phase: "validated" });
    const pr = await createBuildPullRequest(api, run, upload, baseTree);
    const state = await coordinator.updateRun(runId, { phase: "pr_open", pr });
    if (env.CODEX_REVIEW_GITHUB_TOKEN) {
      try { await requestAgentReviews(env.CODEX_REVIEW_GITHUB_TOKEN, pr.number, fetcher); }
      catch (error) {
        console.warn("[build] agent review request failed", error);
        Sentry.captureException(error, { tags: { "build.step": "agent-review" } });
      }
    }
    return Response.json(state, { status: 201, headers: noStore });
  } catch (error) {
    const blocked = error instanceof BuildBlockedError;
    const reason = blocked || error instanceof BuildPullRequestRejectedError ? (error as Error).message : "GitHub did not confirm pull request creation; the result is unknown.";
    await coordinator.updateRun(runId, { phase: blocked ? "blocked" : "failed", reason });
    return fail(blocked ? 400 : 502, reason);
  }
}

export async function handleBuildProgress(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_COORDINATOR) return fail(503, "Build progress is unavailable.");
  const runId = new URL(request.url).searchParams.get("runId");
  const token = bearer(request);
  if (!validRunId(runId) || !token) return fail(401, "Invalid progress authorization.");
  const data = object(await readJsonBody(request, 2048));
  const blocked = data?.blocked === true;
  if (!data || typeof data.message !== "string" || !data.message.trim() || data.message.length > (blocked ? BUILD_BLOCK_REASON_CHARS : 200)) return fail(400, "Invalid progress message.");
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  const hash = await hashToken(token);
  const accepted = blocked
    ? await coordinator.blockRun(runId, hash, `The builder stopped without uploading: ${data.message.trim()}`)
    : await coordinator.progress(runId, hash, data.message.trim());
  return accepted ? Response.json({ accepted: true }, { headers: noStore }) : fail(401, "Progress authorization was used or expired.");
}

export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.GITHUB_WEBHOOK_SECRET || !env.BUILD_COORDINATOR) return fail(503, "GitHub webhooks are unavailable.");
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "Invalid webhook body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); return fail(413, "Webhook body is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  if (!await verifyGithubWebhook(body, request.headers.get("X-Hub-Signature-256"), env.GITHUB_WEBHOOK_SECRET)) return fail(401, "Invalid webhook signature.");
  const delivery = request.headers.get("X-GitHub-Delivery");
  if (!delivery || !/^[\w-]{1,100}$/.test(delivery)) return fail(400, "Invalid delivery identifier.");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return fail(400, "Invalid webhook body."); }
  const coordinator = env.BUILD_COORDINATOR.getByName("global");
  if (!await coordinator.hasDelivery(delivery)) {
    await applyGithubWebhook(env, request.headers.get("X-GitHub-Event") ?? "", payload);
    await coordinator.completeDelivery(delivery);
  }
  return Response.json({ accepted: true }, { headers: noStore });
}
