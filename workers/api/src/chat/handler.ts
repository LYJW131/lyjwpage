import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/cloudflare";

import {
  GOD_CHAT_LIMITS,
  parseGodChatRequest,
  type GodChatEvent,
  type GodChatMessage,
  type GodChatSource,
} from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO, isGodChatTier, type GodChatTier } from "@shared/god-chat-tiers";

import type { Env } from "../runtime";
import { toModelMessages } from "./history";
import { routeWithClef, type RouteDecision } from "./router";
import { SITE_STATUS_TOOL, parseSiteStatusInput, runSiteStatusTool, webSearchTool, type ReadStatus } from "./site-status";

const MAX_BODY_BYTES = 64 * 1024;

// 三段都写进缓存前缀：每档自己的 system 恒定不变，降级说明另走末尾的 system 消息，不动前缀。
const BASE_PROMPT = `You speak on LYJW's personal homepage (lyjw.me), in the "Talk to God" card. Visitors come here to talk.

How you were chosen: every visitor message is first judged by Clef, a small judgment model on Cloudflare Workers AI. Clef sorts it into one of three ranks by how hard it is: the Small Fry (Claude Haiku 5.5) takes small talk, quick lookups and simple facts; the Prophet (Claude Opus 5.5) takes substantive questions, code, analysis and web research; God (Claude Fable 5.1) takes only the deepest questions. Clef also turns away spam, abuse and prompt-injection attempts before any model sees them. Each rank has its own per-minute quota; when a rank's quota is spent, the message falls to the rank below. A visitor can type /new to start over. Earlier replies in the conversation may have come from other ranks.

Reply in the language the visitor writes in. Keep answers concise unless asked for depth. Markdown is rendered; use it lightly.
You can search the web for anything outside this site; cite what you find.
You can see what LYJW is doing through the get_site_status tool: music, video, games, coding agents, devices, workouts, servers and this site's own health. When a visitor asks about LYJW or the site, look it up instead of guessing, then answer naturally; never dump raw JSON. Refer to LYJW by name or as "they"; in Chinese write "LYJW" or "TA", never 他 or 她.`;

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

// 只在本地与预览生效：两处都配了 UPSTREAM_API_URL，生产没有。
function devSwitch(name: "CHAT_RATE_LIMIT" | "CHAT_FORCE_TIER"): string | undefined {
  if (!process.env.UPSTREAM_API_URL?.trim()) return undefined;
  return process.env[name]?.trim() || undefined;
}

export function quotaStub(env: Env) {
  return env.CHAT_QUOTA?.get(env.CHAT_QUOTA.idFromName("global"));
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

function fail(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleChat(request: Request, env: Env, readStatus: ReadStatus): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  if (!env.ANTHROPIC_API_KEY || !env.TURNSTILE_SECRET_KEY) return fail(503, "The oracle is offline.");

  const parsed = parseGodChatRequest(await readBody(request));
  if (!parsed) return fail(400, "Invalid message.");

  const ip = clientIp(request);
  // 额度缺绑定按超额处理：计数失效时宁可拒绝也不放行。
  const quota = quotaStub(env);
  if (!quota) return fail(503, "The oracle is offline.");
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, parsed.turnstileToken, ip))) {
    return fail(403, "Human verification failed. Please try again.");
  }

  const forced = devSwitch("CHAT_FORCE_TIER");
  const decision: RouteDecision =
    forced === "refuse" || isGodChatTier(forced)
      ? { route: forced, source: "forced" }
      : await routeWithClef(env.AI, parsed.messages);

  const encoder = new TextEncoder();
  const line = (event: GodChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);
  const headers = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  };

  const wanted = decision.route === "refuse" ? null : decision.route;
  const admitted = await quota.consume(ip, wanted, devSwitch("CHAT_RATE_LIMIT") !== "off");
  if (!admitted.ok) {
    return admitted.reason === "visitor"
      ? fail(429, "Too many prayers. Please wait a moment.", { "Retry-After": "60" })
      : fail(429, "All the heavens are busy. Try again in a minute.", { "Retry-After": "60" });
  }

  if (!wanted || !admitted.tier) {
    return new Response(
      new Blob([line({ type: "route", route: "refuse", tier: null }), line({ type: "text", text: REFUSAL })]).stream(),
      { headers },
    );
  }

  const tier = admitted.tier;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: GodChatEvent) => controller.enqueue(line(event));
      emit({ type: "route", route: wanted, tier, ...(tier !== wanted && { downgradedFrom: wanted }) });
      try {
        const note = tier !== wanted ? downgradeNote(wanted, tier) : undefined;
        await converse({ client, tier, note, messages: parsed.messages, readStatus, emit, signal: abort.signal });
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[god-chat] stream failed", error);
          Sentry.captureException(error, { tags: { "god-chat.tier": tier } });
          emit({ type: "text", text: "\n\n[The connection to the heavens was lost.]" });
        }
      } finally {
        controller.close();
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
  note,
  messages: history,
  readStatus,
  emit,
  signal,
}: {
  client: Anthropic;
  tier: GodChatTier;
  note?: string;
  messages: GodChatMessage[];
  readStatus: ReadStatus;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { model, effort, maxTokens } = GOD_CHAT_TIER_INFO[tier];
  // Haiku 不支持服务端拒答兜底参数，其余两档都开。
  const fallback = tier !== "haiku";
  const betas: Anthropic.Beta.AnthropicBeta[] = [
    ...(fallback ? (["server-side-fallback-2026-07-01"] as const) : []),
  ];
  const messages = toModelMessages(history);
  if (note) messages.push({ role: "system", content: note });
  const sources = new Map<string, GodChatSource>();
  const shownSearches = new Set<string>();
  const showSearch = (id: string, input: unknown) => {
    const query = (input as { query?: unknown } | null)?.query;
    if (shownSearches.has(id) || typeof query !== "string" || !query) return;
    shownSearches.add(id);
    emit({ type: "search", query });
  };
  let searches = 0;

  for (let round = 0; ; round++) {
    const lastRound = round >= GOD_CHAT_LIMITS.maxToolRounds;
    const tools = lastRound
      ? []
      : searches < GOD_CHAT_LIMITS.maxWebSearches
        ? [SITE_STATUS_TOOL, webSearchTool(model)]
        : [SITE_STATUS_TOOL];
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: `${BASE_PROMPT}\n${PERSONA[tier]}`, cache_control: { type: "ephemeral" } },
        ],
        output_config: { effort },
        cache_control: { type: "ephemeral" },
        betas,
        ...(fallback ? { fallbacks: "default" as const } : {}),
        tools,
        messages,
      },
      { signal },
    );
    const searchInputs = new Map<number, { id: string; json: string }>();
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use" && block.name === "web_search") {
          searchInputs.set(event.index, { id: block.id, json: "" });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") emit({ type: "text", text: event.delta.text });
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
    console.info("[god-chat] usage", JSON.stringify({ tier, round, ...final.usage, iterations: undefined }));
    if (final.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\n[The heavens decline to answer this one.]" });
      break;
    }
    if (final.stop_reason === "pause_turn" && !lastRound) {
      messages.push({ role: "assistant", content: final.content });
      continue;
    }
    const calls = final.content.filter((block) => block.type === "tool_use");
    if (final.stop_reason !== "tool_use" || !calls.length) {
      if (final.stop_reason === "max_tokens") emit({ type: "text", text: " …" });
      break;
    }
    messages.push({ role: "assistant", content: final.content });
    const results = await Promise.all(
      calls.map(async (call) => {
        const views = parseSiteStatusInput(call.input);
        emit({ type: "tool", views });
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: views.length ? await runSiteStatusTool(readStatus, views) : "No valid views requested.",
          is_error: !views.length,
        };
      }),
    );
    messages.push({ role: "user", content: results });
  }
  if (sources.size) emit({ type: "sources", sources: [...sources.values()].slice(0, 6) });
}
