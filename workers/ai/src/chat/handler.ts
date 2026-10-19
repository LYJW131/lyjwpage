import { setTimeout as sleep } from "node:timers/promises";

import Anthropic from "@anthropic-ai/sdk";

import {
  GOD_CHAT_ANTHROPIC_CONSENT,
  GOD_CHAT_PASS_TTL_MS,
  parseGodChatRequest,
  type GodChatEvent,
  type GodChatTrace,
  normalizeTrace,
} from "@shared/god-chat";
import { GOD_CHAT_DEFAULT_LINEUP, GOD_CHAT_DESIGN_TIER, GOD_CHAT_TIER_INFO, isGodChatTier, lineupTier, tierPlacement, type GodChatServedTier, type GodChatTier } from "@shared/god-chat-tiers";

import { getAllowedOrigins } from "@shared/http-origins";
import { aiDevEnabled, type Env } from "../runtime";
import type { ToolIO } from "../tools/registry";
import { anthropicFetch } from "./egress";
import { readJsonBody, turnstilePassed, verifyTurnstile } from "./guard";
import { issuePass, passExpiresAt, passValid } from "./pass";
import { sealExchange, sealedHistory, storedReply } from "./seal";
import { admitDesign, claimDesignOpen, designAvailable, plannerHistory, startDesign, type DesignAdmission } from "./design";
import { designApi, designTurn, turnMatches, type DesignApi, type DesignTurnInput, type SessionEvent } from "./designer";
import { CLEF_CHOICES, isClefChoice, presetRoute, routeWithClef, type RouteDecision } from "./router";
import { checkVisuals, replyFences } from "./reply-fences";
import { saveTranscript, type Transcript, type TranscriptOutcome } from "./transcripts";
import { converse, type TurnOutcome } from "./converse";
import { REFUSAL, downgradeNote } from "./prompts";

const MAX_BODY_BYTES = 256 * 1024;
// 抢输开场的补发等对方把开场发进会话：那边只隔着建事件流与一次发送，几秒内就该落地。
const OPENED_TURN_POLL_MS = 500;
const OPENED_TURN_POLLS = 20;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

type OpenDesign = Extract<DesignAdmission, { sessionId: string }>;

function devSwitch(env: Env, name: "CHAT_RATE_LIMIT" | "CHAT_FORCE_TIER"): string | undefined {
  return aiDevEnabled(env) ? env[name]?.trim() || undefined : undefined;
}

export function quotaStub(env: Env) {
  return env.CHAT_QUOTA?.get(env.CHAT_QUOTA.idFromName("global"));
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function fail(status: number, error: string, headers?: HeadersInit, code?: string): Response {
  return Response.json({ error, ...(code && { code }) }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function handleChat(request: Request, env: Env, io: ToolIO, ctx?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const startedAt = Date.now();
  // 记录是尽力而为的调试数据：有 ctx 时放到响应之后写，存储变慢也不拖住流的收尾。
  const record = async (entry: Transcript) => { const saving = saveTranscript(env, entry); if (ctx) ctx.waitUntil(saving); else await saving; };
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  const sealSecret = env.CHAT_HISTORY_SECRET;
  if (!env.ANTHROPIC_API_KEY || !env.DEEPSEEK_API_KEY || !env.TURNSTILE_SECRET_KEY || !sealSecret) return fail(503, "The oracle is offline.");

  const parsed = parseGodChatRequest(await readJsonBody(request, MAX_BODY_BYTES));
  if (!parsed) return fail(400, "Invalid message.");

  // 请求被取消时（要 enable_request_signal）停下来：在验人与路由之前就挂上，这两步期间断开的也能接住；之后每进一步付费调用前
  // 先看一眼。工具循环与上游请求经 SDK 的 fetch 信号一并掐断。线上流式途中收不到访客断开（docs/ops-facts.md），
  // 这条只在运行时真的报了取消时起作用。
  const abort = new AbortController();
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const gone = () => fail(499, "Request canceled.");

  const ip = clientIp(request);
  const forced = devSwitch(env, "CHAT_FORCE_TIER");
  // 强制值先按 Clef 选项认（flash、think 两种身份都有），只有 haiku、sonnet 这类档位名才连阵容一起定；
  // 要在额度预检之前定下阵容，预检按的空位才是实际出场那个阵容的。
  const placed = !isClefChoice(forced) && isGodChatTier(forced) ? tierPlacement(forced) : undefined;
  const lineup = placed?.lineup ?? parsed.lineup ?? GOD_CHAT_DEFAULT_LINEUP;
  // 额度缺绑定按超额处理：计数失效时宁可拒绝也不放行。
  const quota = quotaStub(env);
  if (!quota) return fail(503, "The oracle is offline.");
  const passed = parsed.humanPass !== undefined && await passValid(sealSecret, parsed.humanPass);
  if (!passed) {
    if (!parsed.turnstileToken) return fail(403, "Human verification expired. Please try again.", undefined, "human_pass_expired");
    const verdict = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, parsed.turnstileToken, ip);
    if (!turnstilePassed(verdict, getAllowedOrigins(env), aiDevEnabled(env))) {
      return fail(403, "Human verification failed. Please try again.");
    }
  }
  if (abort.signal.aborted) return gone();
  // 验过人才计数，计数在 Clef 之前：访客自己超额、全站路由满或哪一档都排不上时，不再触发付费的路由调用。
  const enforce = devSwitch(env, "CHAT_RATE_LIMIT") !== "off";
  let design: OpenDesign | undefined;
  if (parsed.designToken) {
    const admitted = await admitDesign(env, parsed.designToken, parsed.resume);
    if ("error" in admitted) return fail(admitted.status, admitted.error, undefined, admitted.code);
    design = admitted;
  } else {
    const admission = await quota.admitVisitor(ip, enforce, lineup);
    if (admission === "visitor") return fail(429, "Too many prayers. Please wait a moment.", { "Retry-After": "60" });
    if (admission === "site") return fail(429, "All the heavens are busy. Try again in a minute.", { "Retry-After": "60" });
  }

  const history = await sealedHistory(parsed.messages, sealSecret);
  const latest = history[history.length - 1].content;
  const preset = design ? undefined : presetRoute(history);
  const decision: RouteDecision = design ? { route: "think", source: "design" } : isClefChoice(forced)
    ? { ...CLEF_CHOICES[forced], source: "forced" }
    : placed
      ? { route: placed.rank, source: "forced" }
      : preset?.decision ?? await routeWithClef(env.AI, history);

  const encoder = new TextEncoder();
  const line = (event: GodChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  const headers = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  };

  if (decision.route === "refuse") {
    await record({ route: "refuse", tier: null, source: decision.source, messages: history, reply: REFUSAL, outcome: "refused" });
    return new Response(
      new Blob([line({ type: "route", route: "refuse", tier: null }), line({ type: "text", text: REFUSAL })]).stream(),
      { headers },
    );
  }

  if (abort.signal.aborted) return gone();
  // 对话发给 Anthropic 要访客点过头：DeepSeek 阵容里 Clef 选了神，卡片得先单独问；这一条拒绝了就改由先知答。
  const rank = !design && parsed.anthropic === "deny" && decision.route === "fable" ? "think" : decision.route;
  if (!design && parsed.anthropic !== "allow" && GOD_CHAT_TIER_INFO[lineupTier(lineup, rank)].provider === "anthropic") {
    return fail(409, "This reply needs your consent to send the conversation to Anthropic.", undefined, GOD_CHAT_ANTHROPIC_CONSENT);
  }
  const wanted = lineupTier(lineup, rank);
  const tier: GodChatServedTier | null = design ? GOD_CHAT_DESIGN_TIER : await quota.admitTier(ip, wanted, enforce, !decision.design, lineup);
  if (!tier) return fail(429, "All the heavens are busy. Try again in a minute.", { "Retry-After": "60" });

  const effort = GOD_CHAT_TIER_INFO[tier].effort;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: anthropicFetch(env) });
  const deepseek = new Anthropic({ apiKey: env.DEEPSEEK_API_KEY, baseURL: DEEPSEEK_BASE_URL });
  const api = designApi(client, env);
  // 设计会话的首回合推迟到访客同意之后：同意由客户端扣下 resume 请求来表达，Worker 见空会话即补开场，不重放校验。
  // 开场每个会话只发一次：同时到的补发（复制的标签页）抢不到开场，就等对方的开场落进会话，再按断线补发跟着看。
  let priorTurn = parsed.resume && design ? await api.turn(design.sessionId) : undefined;
  const opening = priorTurn?.length === 0 && await claimDesignOpen(env, design!.sessionId);
  if (priorTurn?.length === 0 && !opening) priorTurn = await openedTurn(api, design!.sessionId, abort.signal);
  if (parsed.resume && (!design || (!opening && !turnMatches(priorTurn!, latest)))) {
    return fail(409, "The interrupted reply could not be recovered. Send your message again.", undefined, "nothing_to_resume");
  }
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      let saved: { outcome: TranscriptOutcome; trace?: GodChatTrace } = { outcome: "failed" };
      const emit = (event: GodChatEvent) => {
        if (event.type === "text") reply += event.text;
        controller.enqueue(line(event));
      };
      // 通行证用掉一半就换新的：常来的访客一直不用重验，隔久了才再过一次 Turnstile。
      if (!passed || passExpiresAt(parsed.humanPass) - Date.now() < GOD_CHAT_PASS_TTL_MS / 2) emit({ type: "pass", ...await issuePass(sealSecret) });
      emit({ type: "route", route: wanted, tier, ...(tier !== wanted && !design && { downgradedFrom: wanted }) });
      if (design) emit({ type: "design", ...design.session });
      const plan = (sessionId: string, input: DesignTurnInput, views: string[] = []) => planTurn({ api, env, io, sessionId, input, views, emit, signal: abort.signal });
      try {
        let outcome: TurnOutcome;
        if (design) {
          const input: DesignTurnInput = parsed.resume
            ? opening ? { kind: "open", history: await plannerHistory(history, env) } : { kind: "resume" }
            : { kind: "reply", text: latest };
          outcome = await plan(design.sessionId, input);
        } else {
          const note = tier !== wanted && isGodChatTier(tier) ? downgradeNote(wanted, tier) : undefined;
          const prophet = lineupTier(lineup, "think");
          const upgrade = tier === lineupTier(lineup, "flash") ? async () => (await quota.admitTier(ip, prophet, enforce, false, lineup)) === prophet : undefined;
          const openDesign = decision.design === true && tier === prophet && designAvailable(env) ? () => startDesign(env, (id) => api.create(id)) : undefined;
          // start_design 只建会话发令牌，开场回合等访客同意后经 resume 补发：同意前访客数据不进 Managed Agents。
          const designOff = decision.design === true && !designAvailable(env);
          outcome = await converse({ clients: { anthropic: client, deepseek }, env, openDesign, designOff, lineup, tier: tier as GodChatTier, effort, note, upgrade, messages: history, prefetch: preset ? { calls: preset.decision.prefetch ?? [], source: "preset" } : { calls: decision.prefetch ?? [], source: decision.source }, show: preset?.show, startedAt, io, emit, signal: abort.signal });
        }
        const { complete, refused, trace, planToken, lead } = outcome;
        saved = { outcome: refused ? "refused" : complete ? "complete" : "incomplete", trace };
        if (complete && lead) emit({ type: "text", text: lead });
        // 只记代码块的语言标记与校验结论、不记内容：图示没画出来时（标记写错、没写、结构不对）靠它判断模型写了什么。
        const fences = replyFences(reply);
        if (fences.length) {
          const { invalid, repaired } = checkVisuals(fences);
          const line = JSON.stringify({ tier, fences: fences.map((fence) => fence.language.slice(0, 20)), ...(invalid.length > 0 && { invalid }), ...(repaired.length > 0 && { repaired }) });
          if (invalid.length || repaired.length) console.warn("[god-chat] fences", line);
          else console.info("[god-chat] fences", line);
        }
        const stored = storedReply(reply);
        if (complete && stored && !abort.signal.aborted) {
          emit({ type: "seal", seal: await sealExchange(sealSecret, latest, stored, trace, planToken), ...(trace && { trace }), ...(planToken && { planToken }) });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error(`[god-chat] stream failed (${tier})`, error);
          emit({ type: "text", text: "\n\n[The connection to the heavens was lost.]" });
        }
      } finally {
        await record({ route: wanted, tier: saved.trace?.tier ?? tier, source: decision.source, designSession: design?.sessionId, messages: history, reply, ...saved, ...(abort.signal.aborted && { outcome: "aborted" }) });
        // 访客中断时这条流已被取消，再 close 会抛错。
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, { headers });
}

async function openedTurn(api: DesignApi, sessionId: string, signal: AbortSignal): Promise<SessionEvent[]> {
  for (let tries = 0; tries < OPENED_TURN_POLLS && !signal.aborted; tries++) {
    await sleep(OPENED_TURN_POLL_MS);
    const turn = await api.turn(sessionId);
    if (turn.length) return turn;
  }
  return [];
}

async function planTurn({ views, ...turn }: Parameters<typeof designTurn>[0] & { views: string[] }): Promise<TurnOutcome> {
  const { complete, planToken, lead, views: read } = await designTurn(turn);
  const trace = normalizeTrace({ tier: GOD_CHAT_DESIGN_TIER, effort: GOD_CHAT_TIER_INFO[GOD_CHAT_DESIGN_TIER].effort, views: [...new Set([...views, ...read])], design: true, plan: Boolean(planToken) });
  return { complete, trace, ...(planToken && { planToken }), ...(lead && { lead }) };
}

