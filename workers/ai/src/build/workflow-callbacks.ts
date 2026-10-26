import { object } from "@shared/json";
import { BUILD_PROGRESS_LIMITS, BUILD_UPLOAD_LIMITS } from "@shared/build-routine";
import { readJsonBody } from "../chat/guard";
import type { Env } from "../runtime";
import type { StoredRun } from "./coordinator";

import { ActionsOidcUnavailableError, buildWorkflowAudience, verifyActionsToken } from "./actions-oidc";
import { BuildBlockedError, BuildPublicationPendingError, BuildPullRequestRejectedError, validateBuildBase, createBuildPullRequest, installationApi } from "./github";
import { parseScreenshot, postScreenshotComment, SCREENSHOT_BODY_BYTES, screenshotObjectKey } from "./screenshots";
import { bearerToken, buildCoordinator, fail, noStore, validRunId } from "./http";
import { hashToken, uploadTokenForRun } from "./token";
import { parseBuildUpload } from "./validation";

function publishedImplementation(run: StoredRun): boolean {
  return run.uploadUsed && !!run.implementationHeadSha && run.state.pr?.headSha === run.implementationHeadSha && ["pr_open", "closed", "merged"].includes(run.state.phase);
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
    upload = parseBuildUpload(await readJsonBody(request, BUILD_UPLOAD_LIMITS.requestBytes));
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
      console.error("[build] screenshot comment failed", error);
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
