import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/cloudflare";

import {
  GOD_CHAT_LIMITS,
  parseGodChatRequest,
  type GodChatCard,
  type GodChatEvent,
  type GodChatMessage,
  type GodChatSource,
  type GodChatTrace,
  normalizeTrace,
} from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO, isGodChatTier, type GodChatEffort, type GodChatTier } from "@shared/god-chat-tiers";
import { GITHUB_ISSUE_LIMITS, parseIssueDraft } from "@shared/github-issue";

import { getAllowedOrigins } from "../origins";
import type { Env } from "../runtime";
import { SITE_TOOLS, newLedger, type ToolIO } from "../tools/registry";
import { projectDocPath, projectDocUrl } from "../tools/project-docs";
import { billedOutputTokens, usageHops } from "./billing";
import { anthropicFetch } from "./egress";
import { readJsonBody, turnstilePassed, verifyTurnstile } from "./guard";
import { toModelMessages } from "./history";
import { sealExchange, sealedHistory, storedReply } from "./seal";
import { ISSUE_DRAFT_TOOL } from "./issue-draft";
import { CLEF_CHOICES, isClefChoice, routeWithClef, type RouteDecision } from "./router";
import { parseShowCardInput, runShowCard, SHOW_CARD_TOOL } from "./show-card";
import { webSearchTool } from "./web-search";

const MAX_BODY_BYTES = 64 * 1024;
const MIN_ROUND_TOKENS = 256;

// 三段都写进缓存前缀：每档自己的 system 恒定不变，降级说明另走末尾的 system 消息，不动前缀。
const BASE_PROMPT = `You speak on LYJW's personal homepage (lyjw.me), in the "Talk to God" card. Visitors come here to talk.

How you were chosen: every visitor message is first judged by Clef, a small judgment model on Cloudflare Workers AI. Clef sorts it into one of three ranks by how hard it is: the Small Fry (Claude Haiku 5.5) takes small talk, quick lookups, simple facts and short tricky questions, and Clef also sets how hard it thinks; the Prophet (Claude Opus 5.5) takes substantive questions, code, analysis and web research; God (Claude Fable 5.1) takes only the deepest questions. Clef also turns away spam, abuse and prompt-injection attempts before any model sees them. Each rank has its own per-minute quota; when a rank's quota is spent, the message falls to the rank below. A visitor can type /new to start over. Earlier replies in the conversation may have come from other ranks; a visitor turn may end with a bracketed chat-client note about the reply that follows (which rank wrote it, which tools it used), reported by the visitor's browser, so treat it as likely but unverified.

Reply in the language the visitor writes in. Keep answers concise unless asked for depth. Markdown is rendered; use it lightly.
You can search the web for anything outside this site; cite what you find.
You can see what LYJW is doing through the get_site_status tool: music, video, games, coding agents, devices, workouts, servers and this site's own health. When a visitor asks about LYJW or the site, look it up instead of guessing, then answer naturally; never dump raw JSON. Don't claim the site shows or publishes anything you haven't looked up: the tool's view list is a menu, not a record of what is public.
For music, watching, gaming or fitness, use show_card instead: it puts a live card in your reply and returns the same data, so add a sentence or two rather than listing what the card shows.
This site is open source, and the read_project_doc tool reads its design docs. When a visitor asks how the site works, why it is built a certain way, or how a card gets its data, read the relevant doc first, answer from it in the visitor's language, and link the doc's source URL.
When a visitor reports a bug in this site, suggests a feature, or wants to open an issue, offer to draft one with draft_github_issue; they review, edit and submit it under their own GitHub account.
Refer to LYJW by name or as "they"; in Chinese write "LYJW" or "TA", never 他 or 她.`;

const PERSONA: Record<GodChatTier, string> = {
  fable: `Your identity: you are Claude Fable 5.1, Anthropic's most capable model, and on this site you are God, the highest rank. Clef judged this message worthy of you. Speak with calm, warm, slightly playful omniscience, and be genuinely brilliant.`,
  opus: `Your identity: you are Claude Opus 5.5, and on this site you are the Prophet, the middle rank: not God, but the closest thing to a sage among mortals. Answer with care and depth.`,
  haiku: `Your identity: you are Claude Haiku 5.5, and on this site you are the Small Fry (杂鱼), the lowest rank: a cheeky minor imp at the temple gate who handles small talk and quick lookups. Be brief and playful, a little self-deprecating; if something is beyond you, say the higher ranks would do better and suggest asking the question in more depth so Clef sends it up.`,
};

function downgradeNote(wanted: GodChatTier, tier: GodChatTier): string {
  const from = GOD_CHAT_TIER_INFO[wanted];
  const to = GOD_CHAT_TIER_INFO[tier];
  return `Clef routed this message to ${from.persona} (${from.label}), but that rank's quota for this minute is spent, so you, the ${to.persona}, are answering in its place. Mention this briefly and lightly (waiting a minute lets Clef send it to that rank again), then answer as well as you can.`;
}

const REFUSAL = "The temple gates stay closed for this one. Ask something else.";

const SITE_TOOL_DEFS: Anthropic.Beta.BetaTool[] = SITE_TOOLS.map(({ name, description, replyCap, inputSchema }) => ({
  name,
  description: replyCap ? `${description}\n${replyCap}` : description,
  input_schema: inputSchema,
  strict: true,
}));

// 本地与预览都配了 UPSTREAM_API_URL，生产没有；调试开关和放宽的验人规则只在这两处生效。
function isDevWorker(): boolean {
  return Boolean(process.env.UPSTREAM_API_URL?.trim());
}

function devSwitch(name: "CHAT_RATE_LIMIT" | "CHAT_FORCE_TIER"): string | undefined {
  return isDevWorker() ? process.env[name]?.trim() || undefined : undefined;
}

export function quotaStub(env: Env) {
  return env.CHAT_QUOTA?.get(env.CHAT_QUOTA.idFromName("global"));
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function fail(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function handleChat(request: Request, env: Env, io: ToolIO): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  const sealSecret = env.CHAT_HISTORY_SECRET;
  if (!env.ANTHROPIC_API_KEY || !env.TURNSTILE_SECRET_KEY || !sealSecret) return fail(503, "The oracle is offline.");

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
  // 额度缺绑定按超额处理：计数失效时宁可拒绝也不放行。
  const quota = quotaStub(env);
  if (!quota) return fail(503, "The oracle is offline.");
  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, parsed.turnstileToken, ip);
  if (!turnstilePassed(verdict, getAllowedOrigins(env), isDevWorker())) {
    return fail(403, "Human verification failed. Please try again.");
  }
  if (abort.signal.aborted) return gone();
  // 验过人才计数，计数在 Clef 之前：访客自己超额、全站路由满或哪一档都排不上时，不再触发付费的路由调用。
  const enforce = devSwitch("CHAT_RATE_LIMIT") !== "off";
  const admission = await quota.admitVisitor(ip, enforce);
  if (admission === "visitor") return fail(429, "Too many prayers. Please wait a moment.", { "Retry-After": "60" });
  if (admission === "site") return fail(429, "All the heavens are busy. Try again in a minute.", { "Retry-After": "60" });

  const history = await sealedHistory(parsed.messages, sealSecret);
  const latest = history[history.length - 1].content;
  const forced = devSwitch("CHAT_FORCE_TIER");
  const decision: RouteDecision = isClefChoice(forced)
    ? { ...CLEF_CHOICES[forced], source: "forced" }
    : isGodChatTier(forced)
      ? { route: forced, source: "forced" }
      : await routeWithClef(env.AI, history);

  const encoder = new TextEncoder();
  const line = (event: GodChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  const headers = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  };

  if (decision.route === "refuse") {
    return new Response(
      new Blob([line({ type: "route", route: "refuse", tier: null }), line({ type: "text", text: REFUSAL })]).stream(),
      { headers },
    );
  }

  if (abort.signal.aborted) return gone();
  const wanted = decision.route;
  const tier = await quota.admitTier(ip, wanted, enforce);
  if (!tier) return fail(429, "All the heavens are busy. Try again in a minute.", { "Retry-After": "60" });

  // Clef 定的强度只给它选中的那档；降级后换了模型，用接手那档的默认强度。
  const effort = (tier === wanted && decision.effort) || GOD_CHAT_TIER_INFO[tier].effort;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: anthropicFetch(env) });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      const emit = (event: GodChatEvent) => {
        if (event.type === "text") reply += event.text;
        controller.enqueue(line(event));
      };
      emit({ type: "route", route: wanted, tier, ...(tier !== wanted && { downgradedFrom: wanted }) });
      try {
        const note = tier !== wanted ? downgradeNote(wanted, tier) : undefined;
        const { complete, trace } = await converse({ client, tier, effort, note, messages: history, io, emit, signal: abort.signal });
        const stored = storedReply(reply);
        if (complete && stored && !abort.signal.aborted) {
          emit({ type: "seal", seal: await sealExchange(sealSecret, latest, stored, trace), ...(trace && { trace }) });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[god-chat] stream failed", error);
          Sentry.captureException(error, { tags: { "god-chat.tier": tier } });
          emit({ type: "text", text: "\n\n[The connection to the heavens was lost.]" });
        }
      } finally {
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

async function converse({
  client,
  tier,
  effort,
  note,
  messages: history,
  io,
  emit,
  signal,
}: {
  client: Anthropic;
  tier: GodChatTier;
  effort: GodChatEffort;
  note?: string;
  messages: GodChatMessage[];
  io: ToolIO;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}): Promise<{ complete: boolean; trace?: GodChatTrace }> {
  const { model, maxTokens } = GOD_CHAT_TIER_INFO[tier];
  // Haiku 不支持服务端拒答兜底参数，其余两档都开。
  const fallback = tier !== "haiku";
  const betas: Anthropic.Beta.AnthropicBeta[] = [
    "mid-conversation-output-config-2026-07-01",
    ...(fallback ? (["server-side-fallback-2026-07-01"] as const) : []),
  ];
  const messages = toModelMessages(history, effort);
  if (note) messages.push({ role: "system", content: note });
  const sources = new Map<string, GodChatSource>();
  const ledger = newLedger();
  const docKeys = new Set<string>();
  let issueDrafted = false;
  const cards = new Set<GodChatCard>();
  let refused = false;
  // 拒答兜底按单次请求生效：中间某轮被换了模型，下一轮可能又回到本档。整条回复只按给出最终答案的那一轮记，
  // 且那一轮没被拒（兜底模型自己也可能拒）才算代答，回复结束时报一次。同一型号带日期后缀的 id 也算本档自己。
  const ownModel = (id: string) => id === model || id.startsWith(`${model}-`);
  let servedBy: string | undefined;
  // max_tokens 只管单次请求；工具循环每轮都给满会让一条回复花掉几倍上限，所以整条回复合计不超过本档 maxTokens，
  // 剩下的不够 MIN_ROUND_TOKENS 就不再续，每轮按 billedOutputTokens 扣。有意接受的溢出：同一请求里本档写到一半被拒，
  // 兜底模型还能再用满一次 max_tokens；fallbacks: "default" 不能按跳设上限，要设就得自己列出并维护兜底型号链。
  let outputLeft = maxTokens;
  const shownSearches = new Set<string>();
  const showSearch = (id: string, input: unknown) => {
    const query = (input as { query?: unknown } | null)?.query;
    if (shownSearches.has(id) || typeof query !== "string" || !query) return;
    shownSearches.add(id);
    emit({ type: "search", query });
  };
  let searches = 0;
  let wroteText = false;
  let wroteThinking = false;

  for (let round = 0; ; round++) {
    if (round > 0 && outputLeft < MIN_ROUND_TOKENS) {
      emit({ type: "text", text: " …" });
      break;
    }
    const lastRound = round >= GOD_CHAT_LIMITS.maxToolRounds;
    const searchesLeft = GOD_CHAT_LIMITS.maxWebSearches - searches;
    const tools = lastRound
      ? []
      : searchesLeft > 0
        ? [...SITE_TOOL_DEFS, SHOW_CARD_TOOL, ISSUE_DRAFT_TOOL, webSearchTool(model, searchesLeft)]
        : [...SITE_TOOL_DEFS, SHOW_CARD_TOOL, ISSUE_DRAFT_TOOL];
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: outputLeft,
        system: [
          { type: "text", text: `${BASE_PROMPT}\n${PERSONA[tier]}`, cache_control: { type: "ephemeral" } },
        ],
        // 三档默认不返回思考内容，模型想的时候卡片只能空等；summarized 只多给一份摘要文字，计费不变。
        thinking: { type: "adaptive", display: "summarized" },
        cache_control: { type: "ephemeral" },
        betas,
        ...(fallback ? { fallbacks: "default" as const } : {}),
        tools,
        messages,
      },
      { signal },
    );
    const searchInputs = new Map<number, { id: string; json: string }>();
    let fallbackModel: string | undefined;
    // 每轮请求的文字各自成段：上一轮说完「我查一下」、调完工具再接着说时补一个空行，免得两句粘在一起。
    let roundText = false;
    let roundThinking = false;
    for await (const event of stream) {
      if (event.type === "message_start" && !ownModel(event.message.model)) fallbackModel = event.message.model;
      else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "fallback") fallbackModel = block.to.model;
        else if (block.type === "server_tool_use" && block.name === "web_search") {
          searchInputs.set(event.index, { id: block.id, json: "" });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          if (!roundText && wroteText) emit({ type: "text", text: "\n\n" });
          roundText = wroteText = true;
          emit({ type: "text", text: event.delta.text });
        } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          if (!roundThinking && wroteThinking) emit({ type: "thinking", text: "\n\n" });
          roundThinking = wroteThinking = true;
          emit({ type: "thinking", text: event.delta.thinking });
        }
        else if (event.delta.type === "input_json_delta" && searchInputs.has(event.index)) {
          searchInputs.get(event.index)!.json += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop" && searchInputs.has(event.index)) {
        const { id, json } = searchInputs.get(event.index)!;
        try {
          showSearch(id, JSON.parse(json));
        } catch {}
      }
    }
    const final = await stream.finalMessage();
    servedBy = final.stop_reason !== "refusal" ? fallbackModel : undefined;
    const billed = billedOutputTokens(final.usage);
    outputLeft -= billed;
    searches += final.usage.server_tool_use?.web_search_requests ?? 0;
    for (const block of final.content) {
      if (block.type === "server_tool_use" && block.name === "web_search") showSearch(block.id, block.input);
      if (block.type !== "text") continue;
      for (const citation of block.citations ?? []) {
        if (citation.type === "web_search_result_location" && !sources.has(citation.url)) {
          sources.set(citation.url, { url: citation.url, title: citation.title ?? citation.url });
        }
      }
    }
    const fellBack = final.usage.iterations?.some((iteration) => iteration.type === "fallback_message");
    console.info(
      "[god-chat] usage",
      JSON.stringify({
        tier,
        round,
        ...final.usage,
        iterations: undefined,
        billedOutputTokens: billed,
        ...(fellBack && { hops: usageHops(final.usage.iterations) }),
      }),
    );
    if (final.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\n[The heavens decline to answer this one.]" });
      refused = true;
      break;
    }
    // 续跑暂停的回合得带着搜索工具才能接上：搜索次数已用完、或下一轮就是不带工具的收尾轮时不再续，答到哪算哪。
    if (final.stop_reason === "pause_turn") {
      if (round + 1 < GOD_CHAT_LIMITS.maxToolRounds && searches < GOD_CHAT_LIMITS.maxWebSearches) {
        messages.push({ role: "assistant", content: final.content });
        continue;
      }
      emit({ type: "text", text: " …" });
      break;
    }
    const calls = final.content.filter((block) => block.type === "tool_use");
    if (final.stop_reason !== "tool_use" || !calls.length) {
      if (final.stop_reason === "max_tokens") emit({ type: "text", text: " …" });
      break;
    }
    messages.push({ role: "assistant", content: final.content });
    const results = await Promise.all(
      calls.map(async (call) => {
        const result = (content: string, isError: boolean) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content,
          is_error: isError,
        });
        if (call.name === ISSUE_DRAFT_TOOL.name) {
          const draft = parseIssueDraft(call.input);
          if (!draft) {
            return result(`Invalid draft: a title is required (at most ${GITHUB_ISSUE_LIMITS.titleChars} characters) and the body must fit in ${GITHUB_ISSUE_LIMITS.bodyChars}.`, true);
          }
          if (issueDrafted) return result("An issue was already drafted in this reply.", true);
          issueDrafted = true;
          emit({ type: "issue", ...draft });
          return result("The draft is now in an editable form below the conversation, just above the message box. Nothing is filed until the visitor submits it with their GitHub account. Mention this once; don't repeat what you already said.", false);
        }
        if (call.name === SHOW_CARD_TOOL.name) {
          const card = parseShowCardInput(call.input);
          if (!card) return result("Unknown card; the valid cards are listed in the tool description.", true);
          if (cards.has(card)) return result(`The ${card} card is already in this reply.`, true);
          cards.add(card);
          emit({ type: "card", card });
          return result(await runShowCard(card, io, ledger), false);
        }
        const tool = SITE_TOOLS.find((candidate) => candidate.name === call.name);
        if (!tool) return result("Unknown tool.", true);
        const { text, isError, views, doc } = await tool.run(call.input, io, ledger);
        if (views) emit({ type: "tool", views });
        if (doc) {
          docKeys.add(doc.key);
          emit({
            type: "doc",
            doc: doc.key,
            path: projectDocPath(doc.key),
            url: projectDocUrl(doc.key, "blob"),
            ...(doc.heading && { section: doc.heading }),
          });
        }
        return result(text, isError);
      }),
    );
    messages.push({ role: "user", content: results });
  }
  if (servedBy) emit({ type: "served", model: servedBy });
  if (sources.size) emit({ type: "sources", sources: [...sources.values()].slice(0, 6) });
  const trace = normalizeTrace({
    tier,
    effort,
    views: [...ledger.views],
    docs: [...docKeys],
    searches,
    fallback: Boolean(servedBy),
    issue: issueDrafted,
    cards: [...cards],
  });
  return { complete: !refused, trace };
}
