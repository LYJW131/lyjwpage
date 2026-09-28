import { writeAppleMusicCredentials } from "@shared/credentials";
import { INGEST_SOURCES, prepareIngestForCommit, type PreparedIngest } from "@shared/ingest/prepare";
import { STORAGE_MAX_BYTES } from "@shared/storage-contract";

import { authorize } from "./access-auth";
import { previewWorkerEnabled, type Env } from "./env";
import { archiveIngest } from "./ingest-archive";
import { commitLagIngest } from "./lag-ingest";

/**
 * 上报入口的全部路由。只有三条路径，其余一律 404：
 *
 * - `POST /api/ingest/<来源>`：七个来源（shared/ingest/prepare.ts 的 INGEST_SOURCES），Access 权限 `ingest:<来源>`；
 * - `POST /api/ingest/agents/otlp`：Claude Code 云端遥测（OTLP/HTTP JSON，可 gzip），权限 `ingest:agents-otlp`；
 * - `POST /api/internal/site-deployed`：GitHub Actions 的部署通知，权限 `internal:site-deployed`。
 *
 * 回执是对上报器的契约，状态码和正文与这条路还在 api Worker 里时逐字一致：
 * 202 `{ ok: true, data }`，OTLP 成功回 200 `{}`；失败 400 / 401 / 403 / 404 / 405 / 415 / 503
 * 各自的 `{ ok: false, error }`。
 */

const INGEST_PREFIX = "/api/ingest/";
/** 云端遥测独享 ingest:agents-otlp 权限，不复用限额上报器的 ingest:agents。 */
const OTLP_INGEST_PATH = "/api/ingest/agents/otlp";
const SITE_DEPLOYED_PATH = "/api/internal/site-deployed";

/** 站点部署完成后让采集 Worker 立刻重拉的任务（不等下一次 cron），名单见 shared/collector.ts */
export const DEPLOYMENT_JOBS = ["vercel-deployments", "cloudflare-deployments"];

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === SITE_DEPLOYED_PATH) {
    // 预览版的推送房间连的是预览页，生产部署跟它无关
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
    // 只报存活，不碰状态核心
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

/** 统一 JSON 错误文案。 */
function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

/** 鉴权、解析与持久化在 202 应答前完成；状态核心那边的广播和首屏通知由它自己的 waitUntil 执行。 */
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
    // 只在 OTLP 路由解压；按解压后的实际字节数限制大小。
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
  // OTLP exporter 需要 ExportMetricsServiceResponse；只转换成功响应，保留失败状态。
  return otlp && response.status === 202 ? jsonResponse({}) : response;
}

/**
 * prepare 之后按数据层拆开写：
 *
 * 1. 实时那一半经 `StateCore.commitIngest` 交给状态核心（落地节点整封在可滞后层，不去）；
 * 2. 长期归档进 D1（waitUntil，失败只记日志）；
 * 3. 可滞后层直接写 KV，布局变了才请状态核心失效首屏；
 * 4. Mac 带来的 Apple Music user token 写凭据 KV。
 *
 * 任何一步抛错都回 400，上报器整封重发；各写入按自然键 / 整份覆盖，重发不重复。
 */
async function commitIngest(env: Env, ctx: ExecutionContext, source: string, raw: string): Promise<Response> {
  try {
    const body = parseBody(raw);
    const command = await prepareIngestForCommit(source, body, () => env.CORE.ready(), env.IMAGES);
    if (!command) return jsonResponse({ ok: false, error: "状态存储初始化中" }, { status: 503 });
    let data: unknown;
    /** 状态核心收下了前面的模块、后面的模块校验不过（见 partiallyAccepted）：写完已收下的那几份再回 400 */
    let rejected: string | null = null;
    if (command.source === "server") {
      // 落地节点整封都在可滞后层，不经过状态核心
      data = { id: command.status.id };
    } else {
      const reply = await env.CORE.commitIngest(command);
      if (!reply.ready) return jsonResponse({ ok: false, error: "状态存储初始化中" }, { status: 503 });
      if (!reply.ok) {
        if (!partiallyAccepted(command)) throw new Error(reply.error);
        rejected = reply.error;
      } else {
        data = reply.data;
      }
    }
    // 归档排在可滞后层之前：KV 写失败回 400 时，已收下的数据照样进 D1（按 received_at 幂等，
    // 上报器重发也不重复）。归档失败只记日志，不能让已落库的上报重发
    if (env.HISTORY) ctx.waitUntil(archiveIngest(env.HISTORY, command));
    // 可滞后层的那一半：状态核心收下之后直接写 KV，只写 prepare 判为有效的模块，布局变了才失效首屏
    if (env.LAG) {
      const tags = await commitLagIngest(env.LAG, command);
      // 失效通知要 REVALIDATE_SECRET，只在状态核心上：请它代发
      if (tags.length) ctx.waitUntil(env.CORE.revalidate(tags).catch((error: unknown) => console.error("[revalidate]", reason(error))));
    }
    if (rejected) throw new Error(rejected);
    // Apple Music user token 只在变了时才推，这一次写不进去就等下一次换令牌，所以等它写完再回 202
    if (command.source === "mac" && command.modules.appleMusicCredentials && env.CREDENTIALS) {
      await writeAppleMusicCredentials(env.CREDENTIALS, {
        musicUserToken: command.modules.appleMusicCredentials.musicUserToken,
        receivedAt: command.receivedAt,
      });
    }
    return jsonResponse({ ok: true, data }, { status: 202 });
  } catch (error) {
    console.error("[ingest]", source, reason(error));
    return jsonResponse({ ok: false, error: "上报数据无效或处理失败" }, { status: 400 });
  }
}

/**
 * 一封上报里前面的模块已经进了状态核心、后面的模块校验不过：眼下只有手机（训练收下、
 * 圆环被拒，见 shared/ingest/phone.ts 的 failure.stage）。这时可滞后层和归档照同样的口径写已收下
 * 的模块，Pulse 里那份训练和公开的训练列表才不会各说各话；回执照样是 400，上报器整封重发。
 */
export function partiallyAccepted(command: PreparedIngest): boolean {
  return command.source === "iphone" && command.failure?.stage === "beforeActivity";
}

/** 限制实际读取字节数，不依赖可能缺失或伪造的 Content-Length。超限按读不出来处理（400）。 */
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

/**
 * 站点新部署接管了生产域名。只有 GitHub Actions（.github/workflows/purge-esa.yml）调用，
 * 用它自己那把 Access service token；请求体不读 —— 推什么版本由域名上那次部署自己回答。
 *
 * 1. 请状态核心向所有连着的页面广播不带数据的 `version`（页面重问 /api/version），
 *    回执里的 `delivered` 是送达的连接数；
 * 2. 请采集 Worker 立刻重拉部署列表（waitUntil，不拖慢回执、失败只记日志）。
 */
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
