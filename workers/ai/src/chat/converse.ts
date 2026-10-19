import type Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_LIMITS, normalizeTrace, type GodChatEvent, type GodChatMessage, type GodChatPresetCall, type GodChatSource, type GodChatTrace } from "@shared/god-chat";
import { PLAN_LABELS, textLanguage } from "@shared/build-routine";
import { GOD_CHAT_TIER_INFO, lineupTier, type GodChatEffort, type GodChatLineup, type GodChatServedTier, type GodChatTier } from "@shared/god-chat-tiers";

import type { Env } from "../runtime";
import { SITE_TOOLS, replyToolDescription, type ToolIO } from "../tools/registry";
import { billedOutputTokens, usageHops } from "./billing";
import { toModelMessages } from "./history";
import { plannerHistory, START_DESIGN_TOOL, type DesignAdmission } from "./design";
import type { RouteDecision } from "./router";
import { SHOW_CARD_TOOL } from "./show-card";
import { TOOL_SEARCH_TOOL, docSearchQuery } from "./doc-search";
import { ANIME_SEARCH_TOOL, DOMAIN_SEARCH_TOOLS, GAME_SEARCH_TOOL } from "./domain-search";
import { MAX_WEB_FETCHES, WEB_FETCH_TOOL, WEB_SEARCH_TOOL, urlKey, urlsIn } from "./web-search";
import { BASE_PROMPTS, DEEPSEEK_NOTE, DESIGN_OFF_NOTE, FINAL_ROUND_NOTE, PERSONA, UPGRADE_NOTE, UPGRADE_TOOL_NAME, UPGRADE_TOOLS, replyLanguageNote } from "./prompts";
import { replyTools, type ToolCall } from "./reply-tools";

const MIN_ROUND_TOKENS = 256;
// 开着思考又带工具时，DeepSeek 要求每条带 tool_use 的助手消息都回传 thinking 块，缺了整轮 400。Worker 代跑的预取、
// 以及关思考的 Small Fry 升档前写下的调用都没有思考，补一个占位块；签名 DeepSeek 不校验。
const PLACEHOLDER_THINKING = { type: "thinking" as const, thinking: "Reading what the visitor's question needs.", signature: "worker" };

function withThinking(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") return message;
    const blocks = message.content;
    if (!blocks.some((block) => block.type === "tool_use") || blocks.some((block) => block.type === "thinking")) return message;
    return { ...message, content: [PLACEHOLDER_THINKING, ...blocks] };
  });
}

// DeepSeek 不支持 tool search 与延迟加载，领域工具直接常驻；它们的说明很短，常驻不占多少上下文。
const eager = (tool: Anthropic.Beta.BetaTool): Anthropic.Beta.BetaTool => ({ ...tool, defer_loading: false });

const PARALLEL_TOOLS = new Set([WEB_SEARCH_TOOL.name, WEB_FETCH_TOOL.name, ANIME_SEARCH_TOOL.name, GAME_SEARCH_TOOL.name]);

const SITE_TOOL_DEFS: Anthropic.Beta.BetaTool[] = SITE_TOOLS.map((tool) => ({
  name: tool.name,
  description: replyToolDescription(tool),
  input_schema: tool.inputSchema,
  strict: true,
}));

export type TurnOutcome = { complete: boolean; refused?: true; trace?: GodChatTrace; planToken?: string; lead?: string };

export async function converse({
  clients,
  env,
  openDesign,
  designOff,
  lineup,
  tier: startTier,
  effort: startEffort,
  note,
  upgrade,
  messages: history,
  prefetch,
  show,
  startedAt,
  io,
  emit: emitEvent,
  signal,
}: {
  clients: Record<"anthropic" | "deepseek", Anthropic>;
  env: Env;
  openDesign?: () => Promise<DesignAdmission>;
  designOff?: boolean;
  lineup: GodChatLineup;
  tier: GodChatTier;
  effort: GodChatEffort;
  note?: string;
  upgrade?: () => Promise<boolean>;
  messages: GodChatMessage[];
  prefetch: { calls: GodChatPresetCall[]; source: RouteDecision["source"] };
  show?: string;
  startedAt: number;
  io: ToolIO;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}): Promise<TurnOutcome> {
  let replyText = "";
  const emit = (event: GodChatEvent) => {
    if (event.type === "text") replyText += event.text;
    emitEvent(event);
  };
  let tier = startTier;
  let effort = startEffort;
  let upgradeOpen = upgrade !== undefined;
  const betasFor = (served: GodChatServedTier): Anthropic.Beta.AnthropicBeta[] => [
    "mid-conversation-output-config-2026-07-01",
    ...(GOD_CHAT_TIER_INFO[served].serverFallback ? (["server-side-fallback-2026-07-01"] as const) : []),
  ];
  const messages = toModelMessages(await plannerHistory(history, env), effort);
  if (note) messages.push({ role: "system", content: note });
  const language = replyLanguageNote(history.at(-1)?.content ?? "");
  if (language) messages.push({ role: "system", content: language });
  if (designOff) messages.push({ role: "system", content: DESIGN_OFF_NOTE });
  if (show) messages.push({ role: "system", content: `This is one of the homepage's sample questions, picked to show visitors what this chat can draw. ${show}` });
  const sources = new Map<string, GodChatSource>();
  let refused = false;
  // 拒答兜底按单次请求生效：中间某轮被换了模型，下一轮可能又回到本档。整条回复只按给出最终答案的那一轮记，
  // 且那一轮没被拒（兜底模型自己也可能拒）才算代答，回复结束时报一次。同一型号带日期后缀的 id 也算本档自己。
  const ownModel = (id: string) => id === GOD_CHAT_TIER_INFO[tier].model || id.startsWith(`${GOD_CHAT_TIER_INFO[tier].model}-`);
  let servedBy: string | undefined;
  // max_tokens 只管单次请求；工具循环每轮都给满会让一条回复花掉几倍上限，所以整条回复合计不超过本档 maxTokens，
  // 剩下的不够 MIN_ROUND_TOKENS 就不再续，每轮按 billedOutputTokens 扣。有意接受的溢出：同一请求里本档写到一半被拒，
  // 兜底模型还能再用满一次 max_tokens；fallbacks: "default" 不能按跳设上限，要设就得自己列出并维护兜底型号链。
  let outputLeft = GOD_CHAT_TIER_INFO[tier].maxTokens;
  const mcpCalls = new Set<string>();
  let wroteText = false;
  let wroteThinking = false;
  let finalRound = 0;
  let finalRoundText = false;
  let cardAfterAnswer = false;

  const deepseek = () => GOD_CHAT_TIER_INFO[tier].provider === "deepseek";
  const { run, used, opened, ledger, docKeys, cards, showSearch, search, searched } = replyTools({
    env,
    io,
    history,
    openDesign,
    deepseek,
    // 访客要先看到普通对话这边的一句交接，再看到规划者接手；模型没写就补一句固定的。
    handoff: () => {
      if (wroteText) return;
      emit({ type: "text", text: PLAN_LABELS[textLanguage(history.at(-1)?.content ?? "")].handoff });
      wroteText = true;
    },
    emit,
    signal,
  });
  const roundTools = (): Anthropic.Beta.BetaToolUnion[] => [...SITE_TOOL_DEFS, SHOW_CARD_TOOL,
    ...(openDesign ? [START_DESIGN_TOOL] : []),
    ...(search && used.searches < GOD_CHAT_LIMITS.maxWebSearches ? [WEB_SEARCH_TOOL] : []),
    ...(search && used.fetches < MAX_WEB_FETCHES ? [WEB_FETCH_TOOL] : []),
    ...(upgradeOpen ? [UPGRADE_TOOLS[lineup]] : []),
    ...(deepseek() ? DOMAIN_SEARCH_TOOLS.map(eager) : [...DOMAIN_SEARCH_TOOLS, TOOL_SEARCH_TOOL])];
  // 示例问题写定的、或 Clef 判出要读的工具调用由 Worker 先跑：写成模型自己调过的一轮，第一次请求就带着结果，省掉一轮往返。
  if (prefetch.calls.length) {
    const tools = roundTools();
    const calls: ToolCall[] = prefetch.calls
      .filter((call) => tools.some((tool) => "name" in tool && tool.name === call.name))
      .map((call, index) => ({ id: `toolu_prefetch_${index}`, name: call.name, input: call.input }));
    if (calls.length) {
      const results = await Promise.all(calls.map((call) => run(call, tools)));
      console.info("[god-chat] prefetch", JSON.stringify({ tier, source: prefetch.source, calls: calls.map((call, index) => ({ name: call.name, error: results[index].is_error })) }));
      messages.push({ role: "assistant", content: calls.map((call) => ({ type: "tool_use" as const, ...call })) }, { role: "user", content: results });
    }
  }

  for (let round = 0; ; round++) {
    signal.throwIfAborted();
    const { model, serverFallback: fallback, provider, thinking } = GOD_CHAT_TIER_INFO[tier];
    if (round > 0 && outputLeft < MIN_ROUND_TOKENS) {
      emit({ type: "text", text: " …" });
      break;
    }
    const lastRound = round >= GOD_CHAT_LIMITS.maxToolRounds;
    if (lastRound) messages.push({ role: "system", content: FINAL_ROUND_NOTE });
    // 收尾轮照带全部工具、用 tool_choice none 禁掉调用：历史里 tool search 留下的 tool_reference 指向的工具不在列表里，API 整轮 400。
    const tools = roundTools();
    const betas = betasFor(tier);
    const sentAt = Date.now();
    const timing = { firstTokenMs: -1, firstTextMs: -1, textDeltas: 0, maxTextGapMs: 0 };
    let lastTextAt = 0;
    const stream = clients[provider].beta.messages.stream(
      {
        model,
        max_tokens: outputLeft,
        system: [
          { type: "text", text: `${BASE_PROMPTS[lineup]}\n${PERSONA[tier]}${provider === "deepseek" ? `\n${DEEPSEEK_NOTE}` : ""}`, cache_control: { type: "ephemeral" } },
        ],
        // 不开 display: "summarized"：实测开了以后思考摘要和正文都攒到这一轮结束才一起到，首字晚好几秒、正文也不再流式。
        thinking: thinking ? { type: "adaptive" } : { type: "disabled" },
        cache_control: { type: "ephemeral" },
        ...(provider === "anthropic" && { betas }),
        ...(fallback ? { fallbacks: "default" as const } : {}),
        tools,
        ...(lastRound && { tool_choice: { type: "none" as const } }),
        messages: provider === "deepseek" && thinking ? withThinking(messages) : messages,
      },
      { signal },
    );
    const searchInputs = new Map<number, { id: string; server: string; tool: string; json: string }>();
    let fallbackModel: string | undefined;
    // 每轮请求的文字各自成段：上一轮说完「我查一下」、调完工具再接着说时补一个空行，免得两句粘在一起。
    let roundText = false;
    finalRound = round;
    finalRoundText = false;
    let roundThinking = false;
    for await (const event of stream) {
      if (event.type === "message_start" && !ownModel(event.message.model)) fallbackModel = event.message.model;
      else if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "fallback") fallbackModel = block.to.model;
        else if (block.type === "mcp_tool_use") {
          mcpCalls.add(block.id);
          searchInputs.set(event.index, { id: block.id, server: block.server_name, tool: block.name, json: "" });
        }
      } else if (event.type === "content_block_delta") {
        const at = Date.now();
        if (timing.firstTokenMs < 0) timing.firstTokenMs = at - sentAt;
        if (event.delta.type === "text_delta") {
          if (timing.firstTextMs < 0) timing.firstTextMs = at - sentAt;
          else timing.maxTextGapMs = Math.max(timing.maxTextGapMs, at - lastTextAt);
          lastTextAt = at;
          timing.textDeltas++;
          if (!roundText && wroteText) emit({ type: "text", text: "\n\n" });
          roundText = wroteText = finalRoundText = true;
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
        const { id, server, tool, json } = searchInputs.get(event.index)!;
        try {
          showSearch(id, docSearchQuery(server, tool, JSON.parse(json)));
        } catch {}
      }
    }
    const final = await stream.finalMessage();
    console.info("[god-chat] timing", JSON.stringify({ tier, round, sinceRequestMs: sentAt - startedAt, ...timing, roundMs: Date.now() - sentAt }));
    servedBy = final.stop_reason !== "refusal" ? fallbackModel : undefined;
    const billed = billedOutputTokens(final.usage);
    outputLeft -= billed;
    for (const block of final.content) {
      if (block.type === "mcp_tool_use") {
        mcpCalls.add(block.id);
        showSearch(block.id, docSearchQuery(block.server_name, block.name, block.input));
      }
      if (block.type !== "text") continue;
      for (const citation of block.citations ?? []) {
        if (citation.type === "search_result_location" && /^https?:\/\//.test(citation.source) && !sources.has(citation.source)) {
          sources.set(citation.source, { url: citation.source, title: citation.title ?? citation.source });
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
    // 文档 MCP 跑在服务端，长了会 pause_turn；续跑得带着 toolset，下一轮就是禁用工具的收尾轮时不再续，答到哪算哪。
    if (final.stop_reason === "pause_turn") {
      if (round + 1 < GOD_CHAT_LIMITS.maxToolRounds) {
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
    if (lastRound) {
      emit({ type: "text", text: " …" });
      break;
    }
    if (upgradeOpen && calls.some((call) => call.name === UPGRADE_TOOL_NAME)) {
      signal.throwIfAborted();
      if (await upgrade!()) {
        tier = lineupTier(lineup, "think");
        const upgradedEffort = GOD_CHAT_TIER_INFO[tier].effort;
        upgradeOpen = false;
        outputLeft = GOD_CHAT_TIER_INFO[tier].maxTokens;
        console.info("[god-chat] upgrade", JSON.stringify({ round }));
        emit({ type: "route", route: tier, tier });
        // 历史里已插着杂鱼的强度（Haiku 是 medium）；先知强度不同就追加一条，否则 Sonnet 照旧按杂鱼的强度跑。
        if (upgradedEffort !== effort) messages.push({ role: "system", content: [], output_config: { effort: upgradedEffort } });
        effort = upgradedEffort;
        messages.push({ role: "system", content: UPGRADE_NOTE });
        continue;
      }
      upgradeOpen = false;
    }
    cardAfterAnswer = wroteText && calls.every((call) => call.name === SHOW_CARD_TOOL.name);
    messages.push({ role: "assistant", content: final.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    // 搜索与读页互不依赖，先一起发出、结果按原顺序回：次数在各自第一个 await 之前同步占用。其余工具仍按顺序逐个跑。
    const early = new Map(calls.filter((call) => PARALLEL_TOOLS.has(call.name)).map((call) => [call.id, run(call, tools)]));
    for (const pending of early.values()) pending.catch(() => {});
    for (const call of calls) {
      const outcome = await (early.get(call.id) ?? run(call, tools));
      console.info("[god-chat] tool", JSON.stringify({ tier, round, name: call.name, error: outcome.is_error, ...(outcome.is_error && { reason: String(outcome.content).slice(0, 200) }) }));
      results.push(outcome);
    }
    if (opened()) break;
    messages.push({ role: "user", content: results });
  }
  // 最后一轮一个字没写时，访客多半只看得到开场白，像是对话卡死了。例外是先写完答案、上一轮只调了 show_card，
  // 没到收尾轮就空着停下：卡片本身就是收尾。查数据类工具之后的空轮仍要提示，那时访客手里没有答案。
  const answeredWithCard = cardAfterAnswer && finalRound < GOD_CHAT_LIMITS.maxToolRounds;
  if (!refused && finalRound > 0 && !finalRoundText && !answeredWithCard && !opened()) emit({ type: "text", text: "\n\n(This reply ran out of steps before finishing. Send another message to continue.)" });
  if (servedBy) emit({ type: "served", model: servedBy });
  if (deepseek()) {
    const linked = new Set(urlsIn(replyText));
    for (const [url, source] of searched) if (!sources.has(url) && linked.has(urlKey(url) ?? url)) sources.set(url, source);
  }
  if (sources.size) emit({ type: "sources", sources: [...sources.values()].slice(0, 6) });
  const trace = normalizeTrace({
    tier,
    effort,
    views: [...ledger.views],
    docs: [...docKeys],
    searches: used.searches + mcpCalls.size,
    fallback: Boolean(servedBy),
    cards: [...cards],
  });
  return { complete: !refused, ...(refused && { refused: true as const }), trace };
}

