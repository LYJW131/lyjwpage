import { enrichCommand, type EnrichedCommand } from "@shared/command-enrichment";
import { writeAppleMusicCredentials } from "@shared/credentials";
import type { OtlpCodingSource } from "@shared/coding-usage-sources";
import { ACTIVE_COLLECTOR_JOBS, type CollectorJobOutcome } from "@shared/collector";
import { jsonResponse } from "@shared/http-origins";
import { describeRejections } from "@shared/ingest/coding";
import { decodeOtlpLogsJson, decodeOtlpLogsProtobuf, OtlpDecodeError, type OtlpLogRecord } from "@shared/ingest/otlp-logs";
import { preparePlayerEvents } from "@shared/ingest/player";
import { INGEST_SOURCES, prepareIngest, type CoreCommand, type PreparedIngest } from "@shared/ingest/prepare";
import type { PlayerDevice } from "@shared/player-store";
import { LAG_KEYS, writeLag } from "@shared/lag";
import { LIMITS_TAG } from "@shared/live-events";
import { parseClaudeResetCards } from "@shared/vibecoding-limits";

import { authorize } from "./access-auth";
import { decompressedBody, readBoundedBody, readBoundedBytes, UnsupportedEncoding } from "./body";
import { previewWorkerEnabled, type Env } from "./env";
import { archiveIngest } from "./ingest-archive";
import { commitLagIngest } from "./lag-ingest";


const INGEST_PREFIX = "/api/ingest/";
const OTLP_INGEST_PATH = "/api/ingest/agents/otlp";
// 一个 OTLP 入口，按凭据持有的权限分来源：云端环境的 token 记 agents-otlp，Mac 的记 mac-otlp，Omarchy 的记 omarchy-otlp。
// 不看 payload 里的 os.type 或资源属性，那是客户端自报的。
const OTLP_SOURCES = ["agents-otlp", "mac-otlp", "omarchy-otlp"] as const satisfies readonly OtlpCodingSource[];
// 重置卡张数不是哪台机器观测到的，是 lyjw 口述、云端线程代写的账户事实，归 agents；只放行 ingest:agents-cards，
// 拿这把权限写不了限额本身。
const RESET_CARDS_PATH = "/api/ingest/agents/cards";
// 音乐播放器（Ringo）在哪台机器上放，播放事件就归哪个来源，用那台机器的那把 token（权限 ingest:<来源>-otlp）。
const PLAYER_OTLP_PATHS: Record<string, PlayerDevice> = {
  "/api/ingest/mac/otlp": "mac",
  "/api/ingest/omarchy/otlp": "omarchy",
};
const SITE_DEPLOYED_PATH = "/api/internal/site-deployed";
const COLLECTOR_REFRESH_PATH = "/api/internal/collector-refresh";
const COLLECT_LAST: ReadonlySet<string> = new Set(["digest"]);

export const DEPLOYMENT_JOBS = ["site-deployments", "cloudflare-deployments", "github-repo"];

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === SITE_DEPLOYED_PATH) {
    if (previewWorkerEnabled()) return new Response("Not found", { status: 404 });
    return handleSiteDeployed(request, env, ctx);
  }

  if (url.pathname === COLLECTOR_REFRESH_PATH) {
    if (previewWorkerEnabled()) return new Response("Not found", { status: 404 });
    return handleCollectorRefresh(request, env, ctx, url.searchParams.getAll("job"));
  }

  if (url.pathname === OTLP_INGEST_PATH) {
    return handleIngest(request, env, ctx, OTLP_SOURCES, true);
  }

  const playerDevice = PLAYER_OTLP_PATHS[url.pathname];
  if (playerDevice) {
    return handlePlayerOtlp(request, env, ctx, playerDevice);
  }

  if (url.pathname === RESET_CARDS_PATH) {
    return handleResetCards(request, env, ctx);
  }

  if (url.pathname.startsWith(INGEST_PREFIX)) {
    return handleIngest(request, env, ctx, url.pathname.slice(INGEST_PREFIX.length));
  }

  if (url.pathname === "/") {
    return jsonResponse({ ok: true, service: "ingest" });
  }

  return new Response("Not found", { status: 404 });
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
  sources: string | readonly OtlpCodingSource[],
  otlp = false,
): Promise<Response> {
  if (previewWorkerEnabled()) {
    return jsonResponse({ ok: false, error: "预览 Worker 不接收上报" }, { status: 403 });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });

  if (typeof sources === "string" && !INGEST_SOURCES.has(sources)) {
    return jsonResponse({ ok: false, error: `没有这个上报来源：${sources}` }, { status: 404 });
  }
  const auth = await authorize(request, env, typeof sources === "string" ? `ingest:${sources}` : sources.map((entry) => `ingest:${entry}` as const));
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });
  const source = auth.permission.slice("ingest:".length);

  let raw: string;
  try {
    raw = await readBoundedBody(otlp ? decompressedBody(request) : request.body);
  } catch (error) {
    if (error instanceof UnsupportedEncoding) return jsonResponse({ ok: false, error: error.message }, { status: 415 });
    console.error("[ingest] 读取请求体失败", source, reason(error));
    return jsonResponse({ ok: false, error: "无法读取上报数据" }, { status: 400 });
  }
  const response = await commitIngest(env, ctx, source, raw);
  // OTLP exporter 要求 ExportMetricsServiceResponse，不能直接返回普通上报回执。
  return otlp && response.status === 202 ? jsonResponse({}) : response;
}

async function commitIngest(env: Env, ctx: ExecutionContext, source: string, raw: string): Promise<Response> {
  let command: PreparedIngest;
  try {
    command = await prepareIngest(source, parseBody(raw), Date.now(), env.IMAGES);
  } catch (error) {
    if ((error as { retryable?: unknown } | null)?.retryable === true) return unavailable(source, reason(error));
    console.error("[ingest]", source, reason(error));
    return jsonResponse({ ok: false, error: "上报数据无效或处理失败" }, { status: 400 });
  }
  return commitPrepared(env, ctx, source, command);
}

async function commitPrepared(env: Env, ctx: ExecutionContext, source: string, command: PreparedIngest): Promise<Response> {
  try {
    if ((command.source === "mac" || command.source === "agents") && command.rejected.length) {
      console.warn("[ingest] rejected", source, describeRejections(command.rejected));
    }
    let data: unknown;
    let coreError: string | null = null;
    if (command.source === "server") {
      data = { id: command.status.id };
    } else {
      const { command: enriched, followUp } = await enrichListening(env, command);
      const reply = await env.CORE.commitIngest(enriched);
      if (!reply.ready) return unavailable(source, "state core not ready");
      if (!reply.ok && reply.retryable) return unavailable(source, reply.error);
      if (!reply.ok) {
        if (!partiallyAccepted(command)) throw new Error(reply.error);
        coreError = reply.error;
      } else {
        data = receiptData(command, reply.data);
        if (followUp && env.COLLECTOR) {
          ctx.waitUntil(env.COLLECTOR.followUpTrack(followUp).catch((error: unknown) => console.warn("[enrichment] follow-up", reason(error))));
        }
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

async function handlePlayerOtlp(request: Request, env: Env, ctx: ExecutionContext, device: PlayerDevice): Promise<Response> {
  if (previewWorkerEnabled()) {
    return jsonResponse({ ok: false, error: "预览 Worker 不接收上报" }, { status: 403 });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });
  const source = `${device}-otlp`;
  const auth = await authorize(request, env, `ingest:${source}`);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });

  const type = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-protobuf" && type !== "application/json") {
    return jsonResponse({ ok: false, error: "只接受 application/x-protobuf 或 application/json" }, { status: 415 });
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBytes(decompressedBody(request));
  } catch (error) {
    if (error instanceof UnsupportedEncoding) return jsonResponse({ ok: false, error: error.message }, { status: 415 });
    console.error("[ingest] 读取请求体失败", source, reason(error));
    return jsonResponse({ ok: false, error: "无法读取上报数据" }, { status: 400 });
  }
  let records: OtlpLogRecord[];
  try {
    records = type === "application/x-protobuf"
      ? decodeOtlpLogsProtobuf(bytes)
      : decodeOtlpLogsJson(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } catch (error) {
    if (!(error instanceof OtlpDecodeError || error instanceof SyntaxError)) throw error;
    console.error("[ingest]", source, reason(error));
    return jsonResponse({ ok: false, error: "上报数据无效或处理失败" }, { status: 400 });
  }

  const command = preparePlayerEvents(records, device, Date.now());
  if (command && command.events.length < records.length) {
    console.warn("[ingest] 跳过", source, records.length - command.events.length, "条不是播放事件或缺曲目、时刻的记录");
  }
  if (command) {
    const response = await commitPrepared(env, ctx, source, command);
    if (response.status !== 202) return response;
  }
  // OTLP exporter 要的是 ExportLogsServiceResponse：protobuf 请求回空体（空消息），JSON 请求回 {}。
  return type === "application/x-protobuf"
    ? new Response(null, { status: 200, headers: { "Content-Type": "application/x-protobuf", "Cache-Control": "no-store" } })
    : jsonResponse({});
}

// collector 调不通时原样提交：状态核心不请求 Apple，没带 enrichment 只沿用同一曲目已存的补全；补全失败不该挡住上报。
async function enrichListening(env: Env, command: CoreCommand): Promise<EnrichedCommand> {
  const collector = env.COLLECTOR;
  if (!collector) return { command, followUp: null };
  try {
    return await enrichCommand(command, (music, upcomingTracks) => collector.enrichTrack(music, upcomingTracks));
  } catch (error) {
    console.warn("[enrichment]", command.source, reason(error));
    return { command, followUp: null };
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

// 部分接受时仍须归档并公开已收下的训练与圆环，避免实时事实与展示列表分歧。
export function partiallyAccepted(command: PreparedIngest): boolean {
  return command.source === "iphone" && (command.failure?.stage === "beforeActivity" || command.failure?.stage === "beforeFocus");
}

async function handleResetCards(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (previewWorkerEnabled()) {
    return jsonResponse({ ok: false, error: "预览 Worker 不接收上报" }, { status: 403 });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });
  const auth = await authorize(request, env, "ingest:agents-cards");
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });
  if (!env.LAG) return unavailable("agents-cards", "LAG binding missing");
  let cards;
  try {
    cards = parseClaudeResetCards(parseBody(await readBoundedBody(request.body)));
  } catch (error) {
    return jsonResponse({ ok: false, error: reason(error) }, { status: 400 });
  }
  try {
    await writeLag(env.LAG, LAG_KEYS.claudeResetCards, cards, Date.now());
  } catch (error) {
    return unavailable("agents-cards", reason(error));
  }
  ctx.waitUntil(env.CORE.revalidate([LIMITS_TAG]).catch((error: unknown) => console.error("[revalidate]", reason(error))));
  return jsonResponse({ ok: true, data: cards }, { status: 202 });
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

function runOne(collector: NonNullable<Env["COLLECTOR"]>, job: string): Promise<CollectorJobOutcome> {
  return collector.refresh([job]).then(
    ([outcome]): CollectorJobOutcome => outcome ?? { job, status: "error", detail: "采集 Worker 没有回结果", ms: 0 },
    (error: unknown): CollectorJobOutcome => ({ job, status: "error", detail: reason(error), ms: 0 }),
  );
}

async function handleCollectorRefresh(request: Request, env: Env, ctx: ExecutionContext, named: string[]): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "只接受 POST" }, { status: 405 });
  const auth = await authorize(request, env, "internal:collector-refresh");
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, { status: auth.status });
  const collector = env.COLLECTOR;
  if (!collector) return jsonResponse({ ok: false, error: "没有绑定采集 Worker" }, { status: 503 });
  const jobs = named.length ? [...new Set(named)] : ACTIVE_COLLECTOR_JOBS;
  const ordered = [...jobs.filter((job) => !COLLECT_LAST.has(job)), ...jobs.filter((job) => COLLECT_LAST.has(job))];
  // 逐个串行跑：经 Service Binding 触发的 Worker 和这次请求共用 6 个等响应头的连接，并发扇出会让短预算任务耗在排队上。
  // 摘要读的是别的任务写出的视图（仓库提交、站点部署……），排在最后才总结得到这一轮刚采集的数据。
  const run = (async () => {
    const byJob = new Map<string, CollectorJobOutcome>();
    for (const job of ordered) byJob.set(job, await runOne(collector, job));
    return jobs.map((job) => byJob.get(job)!);
  })();
  // 调用方断开（如 curl 超时）时任务不随连接立刻取消，但只多 waitUntil 的宽限，长任务不保证跑完。
  ctx.waitUntil(run);
  const outcomes = await run;
  return jsonResponse({ ok: outcomes.every((outcome) => outcome.status !== "error"), outcomes });
}
