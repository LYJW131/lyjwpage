import { object } from "@shared/json";
import { BUILD_CLOSED_PHASES, BUILD_ISSUE_LOOKUP_GRACE_MS, BUILD_PLAN_TTL_MS, BUILD_RECONCILE_MS, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, BUILD_TOKEN_MAX_CHARS, branchForRun, newRunId, type BuildFireResult, type BuildIssueLookup } from "@shared/build-routine";
import { readJsonBody } from "../chat/guard";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";

import { BuildBlockedError, prepareBuildPullRequest, recoverBuildPublication, markBuildReady, currentMain, findPlanIssue, GithubBuildApi, GithubRequestError, installationApi, reconcileBuild } from "./github";
import { exchangeCode, revoke } from "./github-oauth";
import { readPlan, type PlanPayload } from "./plan";
import { bearerToken, buildCoordinator, fail, noStore, readBoundedBytes, validRunId } from "./http";
import { hashToken, signBuildToken, uploadTokenForRun, verifyBuildToken } from "./token";
import { applyGithubWebhook, outsideBuildBranches, verifyGithubWebhook } from "./webhook";

export { handleBuildProgress, handleBuildScreenshot, handleBuildUpload } from "./workflow-callbacks";

type StatusPayload = { kind: "status"; runId: string; expiresAt: number };

type GithubVisitor = { account: string; userId: number; name: string | null };

// 每次构建都由访客在弹窗里授权一次：换来的令牌只用来确认身份，用完立即撤销，Worker 不签发也不保存会话凭据。
export async function verifyGithubVisitor(code: string, codeVerifier: string, secret: string, fetcher: typeof fetch): Promise<GithubVisitor | Response> {
  let token: string | null = null;
  try {
    token = await exchangeCode(code, codeVerifier, secret, fetcher);
    if (!token) return fail(401, "GitHub sign-in did not complete.");
    const user = await new GithubBuildApi(token, fetcher).request<{ id: number; login: string; name: string | null }>("/user");
    if (!Number.isSafeInteger(user.id) || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) return fail(502, "GitHub identity could not be verified.");
    const name = typeof user.name === "string" ? user.name.replace(/[\r\n<>]/g, " ").trim().slice(0, 100) || null : null;
    return { account: user.login, userId: user.id, name };
  } catch (error) {
    console.error("[build] GitHub sign-in failed", error instanceof Error ? error.message : String(error));
    return fail(502, "GitHub sign-in is temporarily unavailable.");
  }
  finally { if (token) await revoke(token, secret, fetcher); }
}

type BuildContext = Pick<ExecutionContext, "waitUntil">;

async function buildResponse(run: StoredRun, secret: string): Promise<Response> {
  const { runId, branch, createdAt } = run.state;
  const statusToken = await signBuildToken<StatusPayload>({ kind: "status", runId, expiresAt: createdAt + BUILD_STATUS_TTL_MS }, secret);
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
    return buildResponse((await coordinator.readRun(existing.state.runId))!, env.BUILD_SESSION_SECRET);
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
      return existing ? buildResponse(existing, env.BUILD_SESSION_SECRET) : fail(409, "This plan has already been used.");
    }
    if (admission !== "ok") return fail(429, admission === "account" ? "This GitHub account has reached its hourly build limit." : "The site's hourly build limit has been reached.");
    reserved = true;
    await coordinator.scheduleDraftSweep();
    await prepareBuild(runId, env, fetcher, ctx);
    return buildResponse((await coordinator.readRun(runId))!, env.BUILD_SESSION_SECRET);
  } catch {
    if (reserved) {
      await coordinator.updateRun(runId, { reason: "The draft pull request could not be confirmed; the build workflow was not started." });
      return buildResponse((await coordinator.readRun(runId))!, env.BUILD_SESSION_SECRET);
    }
    return fail(502, "The build could not be started.");
  }
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
