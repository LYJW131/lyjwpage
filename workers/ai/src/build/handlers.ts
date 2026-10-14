import * as Sentry from "@sentry/cloudflare";
import { BUILD_CLOSED_PHASES, BUILD_ISSUE_LOOKUP_GRACE_MS, BUILD_PLAN_TTL_MS, BUILD_PROGRESS_LIMITS, BUILD_RECONCILE_MS, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, BUILD_TOKEN_MAX_CHARS, BUILD_UPLOAD_LIMITS, branchForRun, newRunId, type BuildFireResult, type BuildIssueLookup } from "@shared/build-routine";
import { readJsonBody } from "../chat/guard";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";

import { ActionsOidcUnavailableError, buildWorkflowAudience, verifyActionsToken } from "./actions-oidc";
import { BuildBlockedError, BuildPublicationPendingError, BuildPullRequestRejectedError, validateBuildBase, createBuildPullRequest, prepareBuildPullRequest, recoverBuildPublication, markBuildReady, currentMain, findPlanIssue, GithubBuildApi, GithubRequestError, installationApi, reconcileBuild } from "./github";
import { exchangeCode, revoke } from "./github-oauth";
import { readPlan, type PlanPayload } from "./plan";
import { parseScreenshot, postScreenshotComment, SCREENSHOT_BODY_BYTES, screenshotObjectKey } from "./screenshots";
import { bearerToken, buildCoordinator, fail, object, readBoundedBytes } from "./http";
import { hashToken, signBuildToken, uploadTokenForRun, verifyBuildToken } from "./token";
import { parseBuildUpload } from "./validation";
import { applyGithubWebhook, outsideBuildBranches, verifyGithubWebhook } from "./webhook";

type StatusPayload = { kind: "status"; runId: string; expiresAt: number };
const noStore = { "Cache-Control": "no-store" };
const validRunId = (id: string | null): id is string => !!id && /^[a-f0-9]{32}$/.test(id);

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

type BuildContext = Pick<ExecutionContext, "waitUntil">;

async function buildResponse(run: StoredRun, env: Env): Promise<Response> {
  const { runId, branch, createdAt } = run.state;
  const statusToken = await signBuildToken<StatusPayload>({ kind: "status", runId, expiresAt: createdAt + BUILD_STATUS_TTL_MS }, env.BUILD_SESSION_SECRET!);
  return Response.json({ runId, branch, statusToken, run: run.state } satisfies BuildFireResult, { status: 202, headers: noStore });
}

async function dispatchBuild(runId: string, env: Env, fetcher: typeof fetch): Promise<void> {
  const coordinator = buildCoordinator(env);
  let dispatched = false;
  try {
    const run = await coordinator.readRun(runId);
    if (!run?.callbackOrigin || !run.state.pr || !run.planCommitSha || !env.BUILD_SESSION_SECRET) return;
    if (await hashToken(await uploadTokenForRun(runId, env.BUILD_SESSION_SECRET)) !== run.uploadHash) {
      await coordinator.updateRun(runId, { phase: "failed", reason: "Build authorization changed; the build workflow was not started." });
      return;
    }
    const api = await installationApi(env, fetcher);
    if (!await coordinator.claimDispatch(runId)) return;
    dispatched = true;
    await api.repo("/dispatches", "POST", { event_type: "build", client_payload: { runId, planCommitSha: run.planCommitSha, baseSha: run.baseSha, prNumber: run.state.pr.number, callbackOrigin: run.callbackOrigin } });
  } catch (error) {
    if (!dispatched) return;
    const rejected = error instanceof GithubRequestError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
    await coordinator.failDispatch(runId, rejected
      ? "GitHub rejected the build workflow dispatch. The pull request remains a draft."
      : "Build dispatch was not confirmed; the build workflow result is unknown. The pull request remains a draft.", rejected);
  }
}

async function prepareBuild(runId: string, env: Env, fetcher: typeof fetch, ctx?: BuildContext): Promise<void> {
  const coordinator = buildCoordinator(env);
  const lease = await coordinator.claimPreparation(runId);
  if (!lease) return;
  try {
    const run = await coordinator.readRun(runId);
    if (!run) return;
    const prepared = await prepareBuildPullRequest(await installationApi(env, fetcher), run);
    if (!await coordinator.setPrepared(runId, prepared.planCommitSha, prepared.pr, lease)) return;
  } catch (error) {
    await coordinator.failPreparation(runId, lease, error instanceof BuildBlockedError
      ? error.message
      : "GitHub did not confirm the draft pull request. Preparation will be checked again; the build workflow was not started.", error instanceof BuildBlockedError);
    return;
  } finally {
    await coordinator.releasePreparation(runId, lease);
  }
  const dispatch = dispatchBuild(runId, env, fetcher);
  if (ctx) ctx.waitUntil(dispatch);
  else await dispatch;
}

export async function handleBuild(request: Request, env: Env, fetcher: typeof fetch = fetch, ctx?: BuildContext): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_CLIENT_SECRET) return fail(503, "Builds are unavailable right now.");
  const data = object(await readJsonBody(request, BUILD_TOKEN_MAX_CHARS + 5000));
  if (!data || typeof data.planToken !== "string" || typeof data.code !== "string" || !/^[\w.-]{1,512}$/.test(data.code) || typeof data.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.codeVerifier)) return fail(400, "A signed plan and GitHub sign-in are required.");
  const plan = await readPlan(env, data.planToken);
  if (!plan) return fail(401, "The plan has expired.");
  const coordinator = buildCoordinator(env);
  if (await coordinator.isPlanUsed(plan.id) && !await coordinator.hasPlanRun(plan.id)) return fail(409, "This plan has already been used.");
  const session = await verifyGithubVisitor(data.code, data.codeVerifier, env.GITHUB_APP_CLIENT_SECRET, fetcher);
  if (session instanceof Response) return session;
  if (await coordinator.isPlanUsed(plan.id)) {
    const existing = await coordinator.findPlanRun(plan.id, session.userId);
    if (!existing) return fail(409, "This plan has already been used by another GitHub account.");
    await prepareBuild(existing.state.runId, env, fetcher, ctx);
    return buildResponse((await coordinator.readRun(existing.state.runId))!, env);
  }
  const runId = newRunId();
  const createdAt = Date.now();
  const uploadToken = await uploadTokenForRun(runId, env.BUILD_SESSION_SECRET);
  const branch = branchForRun(runId);
  let reserved = false;
  try {
    const readApi = await installationApi(env, fetcher, true);
    // 不走 handleBuildIssue 的节流：访客已经登录、马上要花一次构建额度，这里必须看到 GitHub 当下的状态。
    const issue = await coordinator.planIssue(plan.id) ?? await findPlanIssue(readApi, plan.id, plan.expiresAt - BUILD_PLAN_TTL_MS);
    if (issue) {
      await coordinator.recordPlanIssue(plan.id, issue, plan.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS);
      return Response.json({ error: `This plan was already filed as issue #${issue.number}.`, issue }, { status: 409, headers: noStore });
    }
    const baseSha = await currentMain(readApi);
    const coauthor = `${session.name || session.account} <${session.userId}+${session.account}@users.noreply.github.com>`;
    const run: StoredRun = { state: { runId, branch, phase: "triggered", createdAt, updatedAt: createdAt }, plan: plan.plan, account: session.account, accountId: session.userId, coauthor, baseSha, callbackOrigin: new URL(request.url).origin, uploadHash: await hashToken(uploadToken), uploadUsed: false, uploadExpiresAt: createdAt + BUILD_TIMEOUT_MS };
    const admission = await coordinator.reserveRun(run, plan.id, plan.expiresAt);
    if (admission === "used") {
      const existing = await coordinator.findPlanRun(plan.id, session.userId);
      return existing ? buildResponse(existing, env) : fail(409, "This plan has already been used.");
    }
    if (admission !== "ok") return fail(429, admission === "account" ? "This GitHub account has reached its hourly build limit." : "The site's hourly build limit has been reached.");
    reserved = true;
    await coordinator.scheduleDraftSweep();
    await prepareBuild(runId, env, fetcher, ctx);
    return buildResponse((await coordinator.readRun(runId))!, env);
  } catch {
    if (reserved) {
      await coordinator.updateRun(runId, { reason: "The draft pull request could not be confirmed; the build workflow was not started." });
      return buildResponse((await coordinator.readRun(runId))!, env);
    }
    return fail(502, "The build could not be started.");
  }
}

function publishedImplementation(run: StoredRun): boolean {
  return run.uploadUsed && !!run.implementationHeadSha && run.state.pr?.headSha === run.implementationHeadSha && ["pr_open", "closed", "merged"].includes(run.state.phase);
}

export async function handleBuildIssue(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET") return fail(405, "Method not allowed.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR || !env.GITHUB_APP_PRIVATE_KEY) return fail(503, "Issue lookup is unavailable.");
  const token = bearerToken(request);
  const plan = token ? await verifyBuildToken<PlanPayload>(token, env.BUILD_SESSION_SECRET, "plan", Date.now() - BUILD_ISSUE_LOOKUP_GRACE_MS) : null;
  if (!plan || typeof plan.id !== "string") return fail(401, "The plan link is invalid or expired.");
  const coordinator = buildCoordinator(env);
  const recorded = await coordinator.planIssue(plan.id);
  if (recorded || !await coordinator.claimIssueCheck(plan.id)) return Response.json({ issue: recorded } satisfies BuildIssueLookup, { headers: noStore });
  try {
    const issue = await findPlanIssue(await installationApi(env, fetcher, true), plan.id, plan.expiresAt - BUILD_PLAN_TTL_MS);
    if (issue) await coordinator.recordPlanIssue(plan.id, issue, plan.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS);
    return Response.json({ issue } satisfies BuildIssueLookup, { headers: noStore });
  } catch { return fail(502, "GitHub could not be checked right now."); }
}

export async function handleBuildStatus(request: Request, env: Env, fetcher: typeof fetch = fetch, ctx?: BuildContext): Promise<Response> {
  if (request.method !== "GET") return fail(405, "Method not allowed.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR) return fail(503, "Build status is unavailable.");
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const token = bearerToken(request);
  const signature = token ? await verifyBuildToken<StatusPayload>(token, env.BUILD_SESSION_SECRET, "status") : null;
  if (!validRunId(runId) || signature?.runId !== runId) return fail(401, "The build status link is invalid or expired.");
  const coordinator = buildCoordinator(env);
  let run = await coordinator.readRun(runId);
  if (!run) return fail(404, "Build not found.");
  if (!run.dispatchAttempted && run.callbackOrigin && run.state.phase === "triggered" && env.GITHUB_APP_PRIVATE_KEY) {
    await prepareBuild(runId, env, fetcher, ctx);
    run = (await coordinator.readRun(runId))!;
  }
  if (run.state.pr && !BUILD_CLOSED_PHASES.includes(run.state.phase) && (!run.state.reconciledAt || Date.now() - run.state.reconciledAt >= BUILD_RECONCILE_MS) && await coordinator.claimReconcile(runId)) {
    try {
      if (run.implementationHeadSha && run.uploadUsed && ["validated", "failed", "timeout"].includes(run.state.phase)) {
        const pr = await recoverBuildPublication(await installationApi(env, fetcher), run);
        if (!await coordinator.completePublication(runId, pr)) throw new Error("The implementation publication could not be recorded.");
        run = (await coordinator.readRun(runId))!;
      }
      const patch = await reconcileBuild(await installationApi(env, fetcher, true), run.state);
      let state = await coordinator.updateRun(runId, patch, run.state.pr!.headSha);
      if (state?.phase === "pr_open" && state.pr?.draft && state.ci?.state === "success") {
        const current = (await coordinator.readRun(runId))!;
        const expectedHeadSha = state.pr.headSha;
        try {
          const pr = await markBuildReady(await installationApi(env, fetcher), current);
          if (pr) state = await coordinator.updateRun(runId, { pr, reason: undefined }, expectedHeadSha);
        } catch (error) {
          state = await coordinator.failPublication(runId, error instanceof BuildBlockedError
            ? { phase: "blocked", reason: error.message }
            : { reason: "GitHub did not confirm readiness for review. Status will be checked again." }, current.state);
        }
      }
      return Response.json(state, { headers: noStore });
    } catch (error) {
      if (error instanceof BuildBlockedError) return Response.json(await coordinator.failPublication(runId, { phase: "blocked", reason: error.message }, run.state), { headers: noStore });
    }
  }
  return Response.json(run.state, { headers: noStore });
}

// 鉴权后换回该 run 原有的上传令牌哈希：一次性上传、停下即作废、截图只在上传前收，仍全由 coordinator 判定。
async function workflowUploadHash(request: Request, env: Env, fetcher: typeof fetch, invalid: string): Promise<{ runId: string; hash: string } | Response> {
  const runId = new URL(request.url).searchParams.get("runId");
  const token = bearerToken(request);
  if (!validRunId(runId) || !token || !env.BUILD_SESSION_SECRET) return fail(401, invalid);
  const run = await buildCoordinator(env).readRun(runId);
  if (!run?.callbackOrigin) return fail(401, invalid);
  try {
    if (!await verifyActionsToken(token, buildWorkflowAudience(run.callbackOrigin, runId), fetcher)) return fail(401, invalid);
  } catch (error) {
    if (error instanceof ActionsOidcUnavailableError) return fail(503, "Build authorization cannot be checked right now.");
    throw error;
  }
  return { runId, hash: await hashToken(await uploadTokenForRun(runId, env.BUILD_SESSION_SECRET)) };
}

export async function handleBuildUpload(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_COORDINATOR || !env.BUILD_SESSION_SECRET || !env.GITHUB_APP_PRIVATE_KEY) return fail(503, "Build uploads are unavailable.");
  const authorized = await workflowUploadHash(request, env, fetcher, "Invalid upload authorization.");
  if (authorized instanceof Response) return authorized;
  const { runId } = authorized;
  const coordinator = buildCoordinator(env);
  const run = await coordinator.claimUpload(runId, authorized.hash);
  if (!run) return fail(401, "Upload authorization was used or expired.");
  let publicationState = run.state;
  let upload;
  try {
    upload = parseBuildUpload(await readJsonBody(request, BUILD_UPLOAD_LIMITS.requestBytes), run.plan.paths);
    if (upload.baseSha !== run.baseSha) throw new Error("The upload does not match the assigned base commit.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid upload.";
    await coordinator.failPublication(runId, { phase: "blocked", reason }, publicationState);
    return fail(400, reason);
  }
  try {
    const api = await installationApi(env, fetcher);
    const baseTree = await validateBuildBase(api, run, upload);
    publicationState = (await coordinator.updateRun(runId, { phase: "validated" }))!;
    const pr = await createBuildPullRequest(api, run, upload, baseTree, async (sha, body) => {
      if (!await coordinator.setImplementationHead(runId, sha, body)) throw new Error("The implementation commit could not be recorded.");
    });
    const state = await coordinator.completePublication(runId, pr);
    if (!state) throw new Error("The implementation publication could not be recorded.");
    try { await postScreenshotComment(api, pr.number, run); }
    catch (error) {
      console.warn("[build] screenshot comment failed", error);
      Sentry.captureException(error, { tags: { "build.step": "screenshots" } });
    }
    return Response.json(state, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof BuildPublicationPendingError) return Response.json((await coordinator.readRun(runId))!.state, { status: 202, headers: noStore });
    const blocked = error instanceof BuildBlockedError;
    const reason = blocked || error instanceof BuildPullRequestRejectedError ? (error as Error).message : "GitHub did not confirm publication of the implementation; the result is unknown. The pull request remains a draft.";
    await coordinator.failPublication(runId, { phase: blocked ? "blocked" : "failed", reason }, publicationState);
    const current = await coordinator.readRun(runId);
    if (current && publishedImplementation(current)) return Response.json(current.state, { status: 201, headers: noStore });
    return fail(blocked ? 400 : 502, reason);
  }
}

export async function handleBuildProgress(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_COORDINATOR || !env.BUILD_SESSION_SECRET) return fail(503, "Build progress is unavailable.");
  const authorized = await workflowUploadHash(request, env, fetcher, "Invalid progress authorization.");
  if (authorized instanceof Response) return authorized;
  const { runId, hash } = authorized;
  const data = object(await readJsonBody(request, 2048));
  const blocked = data?.blocked === true;
  if (!data || typeof data.message !== "string" || !data.message.trim() || data.message.length > (blocked ? BUILD_PROGRESS_LIMITS.blockedChars : BUILD_PROGRESS_LIMITS.messageChars)) return fail(400, "Invalid progress message.");
  const coordinator = buildCoordinator(env);
  const accepted = blocked
    ? await coordinator.blockRun(runId, hash, `The builder stopped without uploading: ${data.message.trim()}`)
    : await coordinator.progress(runId, hash, data.message.trim());
  return accepted ? Response.json({ accepted: true }, { headers: noStore }) : fail(401, "Progress authorization was used or expired.");
}

// 截图在上传前提交、随上传令牌失效；对象按内容寻址进 R2 图片桶，PR 开出后由 App 一次评论出来。
export async function handleBuildScreenshot(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.BUILD_COORDINATOR || !env.BUILD_SESSION_SECRET || !env.IMAGES) return fail(503, "Build screenshots are unavailable.");
  const authorized = await workflowUploadHash(request, env, fetcher, "Invalid screenshot authorization.");
  if (authorized instanceof Response) return authorized;
  const { runId, hash } = authorized;
  const coordinator = buildCoordinator(env);
  if (!await coordinator.canAddScreenshot(runId, hash)) return fail(409, "Screenshot authorization was used or expired, or the screenshot limit was reached.");
  let shot;
  try { shot = parseScreenshot(await readJsonBody(request, SCREENSHOT_BODY_BYTES)); }
  catch (error) { return fail(400, error instanceof Error ? error.message : "Invalid screenshot."); }
  const objectKey = await screenshotObjectKey(shot);
  await env.IMAGES.put(objectKey, shot.bytes, { httpMetadata: { contentType: shot.contentType, cacheControl: "public, max-age=31536000, immutable" } });
  if (!await coordinator.addScreenshot(runId, hash, { objectKey, caption: shot.caption })) return fail(409, "Screenshot authorization was used or expired, or the screenshot limit was reached.");
  return Response.json({ accepted: true }, { status: 201, headers: noStore });
}

export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.GITHUB_WEBHOOK_SECRET || !env.BUILD_COORDINATOR) return fail(503, "GitHub webhooks are unavailable.");
  if (!request.body) return fail(400, "Invalid webhook body.");
  const body = await readBoundedBytes(request.body, 1024 * 1024);
  if (!body) return fail(413, "Webhook body is too large.");
  if (!await verifyGithubWebhook(body, request.headers.get("X-Hub-Signature-256"), env.GITHUB_WEBHOOK_SECRET)) return fail(401, "Invalid webhook signature.");
  const delivery = request.headers.get("X-GitHub-Delivery");
  if (!delivery || !/^[\w-]{1,100}$/.test(delivery)) return fail(400, "Invalid delivery identifier.");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return fail(400, "Invalid webhook body."); }
  const event = request.headers.get("X-GitHub-Event") ?? "";
  if (outsideBuildBranches(event, payload)) return Response.json({ accepted: true }, { headers: noStore });
  const coordinator = buildCoordinator(env);
  if (!await coordinator.hasDelivery(delivery)) {
    await applyGithubWebhook(env, event, payload);
    await coordinator.completeDelivery(delivery);
  }
  return Response.json({ accepted: true }, { headers: noStore });
}
