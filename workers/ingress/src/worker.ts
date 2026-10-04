import { writeAppleMusicCredentials } from "@shared/credentials";
import { describeRejections } from "@shared/ingest/coding";
import { INGEST_SOURCES, prepareIngestForCommit, type PreparedIngest } from "@shared/ingest/prepare";
import { STORAGE_MAX_BYTES } from "@shared/storage-contract";

import { authorize } from "./access-auth";
import { previewWorkerEnabled, type Env } from "./env";
import { archiveIngest } from "./ingest-archive";
import { commitLagIngest } from "./lag-ingest";


const INGEST_PREFIX = "/api/ingest/";
const OTLP_INGEST_PATH = "/api/ingest/agents/otlp";
const SITE_DEPLOYED_PATH = "/api/internal/site-deployed";

export const DEPLOYMENT_JOBS = ["vercel-deployments", "cloudflare-deployments"];

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === SITE_DEPLOYED_PATH) {
    if (previewWorkerEnabled()) return new Response("Not found", { status: 404 });
    return handleSiteDeployed(request, env, ctx);
  }

  if (url.pathname === OTLP_INGEST_PATH) {
    return handleIngest(request, env, ctx, "agents-otlp", true);
  }

  if (url.pathname.startsWith(INGEST_PREFIX)) {
    return handleIngest(request, env, ctx, url.pathname.slice(INGEST_PREFIX.length));
  }

  if (url.pathname === "/") {
    return jsonResponse({ ok: true, service: "ingest" });
  }

  return new Response("Not found", { status: 404 });
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

async function handleIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  source: string,
  otlp = false,
): Promise<Response> {
  if (previewWorkerEnabled()) {
    return jsonResponse({ ok: false, error: "预览 Worker 不接收上报" }, { status: 403 });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });

  if (!otlp && !INGEST_SOURCES.has(source)) return jsonResponse({ ok: false, error: `没有这个上报来源：${source}` }, { status: 404 });
  const auth = await authorize(request, env, `ingest:${source}`);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });

  let raw: string;
  try {
    const encoding = otlp ? request.headers.get("Content-Encoding")?.trim().toLowerCase() : undefined;
    if (encoding && encoding !== "identity" && encoding !== "gzip") {
      return jsonResponse({ ok: false, error: `不支持的压缩：${encoding}` }, { status: 415 });
    }
    const body = encoding === "gzip" && request.body
      ? request.body.pipeThrough(new DecompressionStream("gzip"))
      : request.body;
    raw = await readBoundedBody(body);
  } catch (error) {
    console.error("[ingest] 读取请求体失败", source, reason(error));
    return jsonResponse({ ok: false, error: "无法读取上报数据" }, { status: 400 });
  }
  const response = await commitIngest(env, ctx, source, raw);
  // OTLP exporter 要求 ExportMetricsServiceResponse，不能直接返回普通上报回执。
  return otlp && response.status === 202 ? jsonResponse({}) : response;
}

async function commitIngest(env: Env, ctx: ExecutionContext, source: string, raw: string): Promise<Response> {
  try {
    const body = parseBody(raw);
    const command = await prepareIngestForCommit(source, body, () => env.CORE.ready(), env.IMAGES);
    if (!command) return jsonResponse({ ok: false, error: "状态存储初始化中" }, { status: 503 });
    if ((command.source === "mac" || command.source === "agents") && command.rejected.length) {
      console.warn("[ingest] rejected", source, describeRejections(command.rejected));
    }
    let data: unknown;
    let coreError: string | null = null;
    if (command.source === "server") {
      data = { id: command.status.id };
    } else {
      const reply = await env.CORE.commitIngest(command);
      if (!reply.ready) return jsonResponse({ ok: false, error: "状态存储初始化中" }, { status: 503 });
      if (!reply.ok && reply.retryable) return unavailable(source, reply.error);
      if (!reply.ok) {
        if (!partiallyAccepted(command)) throw new Error(reply.error);
        coreError = reply.error;
      } else {
        data = receiptData(command, reply.data);
      }
    }
    // 归档须先于 KV 写入启动，避免 KV 失败使状态核心已接受的数据漏归档。
    if (env.HISTORY) ctx.waitUntil(archiveIngest(env.HISTORY, command));
    if (env.LAG) {
      const tags = await commitLagIngest(env.LAG, command);
      if (tags.length) ctx.waitUntil(env.CORE.revalidate(tags).catch((error: unknown) => console.error("[revalidate]", reason(error))));
    }
    if (coreError) throw new Error(coreError);
    // user token 仅变化时上报，必须等凭据落库才回 202，否则失败后可能长期不再补传。
    if (command.source === "mac" && command.modules.appleMusicCredentials && env.CREDENTIALS) {
      await writeAppleMusicCredentials(env.CREDENTIALS, {
        musicUserToken: command.modules.appleMusicCredentials.musicUserToken,
        receivedAt: command.receivedAt,
      });
    }
    return jsonResponse({ ok: true, data }, { status: 202 });
  } catch (error) {
    if ((error as { retryable?: unknown } | null)?.retryable === true) return unavailable(source, reason(error));
    console.error("[ingest]", source, reason(error));
    return jsonResponse({ ok: false, error: "上报数据无效或处理失败" }, { status: 400 });
  }
}

// 4xx 不会被 OTLP exporter 和 Home Assistant 重试，暂时性的故障必须回 503。
function unavailable(source: string, why: string): Response {
  console.warn("[ingest] unavailable", source, why);
  return jsonResponse({ ok: false, error: "状态存储暂时不可用，请重试" }, { status: 503 });
}

function receiptData(command: PreparedIngest, data: unknown): unknown {
  if (command.source !== "mac" && command.source !== "agents") return data;
  const base = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return command.source === "mac"
    ? { ...base, ignored: command.ignored, rejected: command.rejected }
    : { ...base, rejected: command.rejected };
}

// 部分接受时仍须归档并公开已收下的训练，避免实时事实与展示列表分歧。
export function partiallyAccepted(command: PreparedIngest): boolean {
  return command.source === "iphone" && command.failure?.stage === "beforeActivity";
}

async function readBoundedBody(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > STORAGE_MAX_BYTES) { await reader.cancel(); throw new Error("Body too large"); }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function handleSiteDeployed(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });
  const auth = await authorize(request, env, "internal:site-deployed");
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });
  const delivered = await env.CORE.broadcastVersion();
  if (env.COLLECTOR) ctx.waitUntil(refreshDeployments(env.COLLECTOR));
  return jsonResponse({ ok: true, delivered });
}

async function refreshDeployments(collector: NonNullable<Env["COLLECTOR"]>): Promise<void> {
  try {
    for (const outcome of await collector.refresh(DEPLOYMENT_JOBS)) {
      if (outcome.status === "error") console.warn("[site-deployed] 重拉部署失败", outcome.job, outcome.detail ?? "");
    }
  } catch (error) {
    console.warn("[site-deployed] 调不到采集 Worker", reason(error));
  }
}
