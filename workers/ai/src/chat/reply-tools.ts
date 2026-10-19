import type Anthropic from "@anthropic-ai/sdk";

import type { GodChatCard, GodChatEvent, GodChatMessage, GodChatSource } from "@shared/god-chat";
import { GOD_CHAT_LIMITS } from "@shared/god-chat";

import type { Env } from "../runtime";
import { SITE_TOOLS, newLedger, type ToolIO } from "../tools/registry";
import { projectDocPath, projectDocUrl } from "../tools/project-docs";
import { START_DESIGN_TOOL, type DesignAdmission } from "./design";
import { findGame, parseShowCardInput, runShowCard, SHOW_CARD_TOOL } from "./show-card";
import { ANIME_SEARCH_TOOL, GAME_SEARCH_TOOL, STORE_LANGUAGES, animeSearch, gameSearch } from "./domain-search";
import { MAX_WEB_FETCHES, WEB_CATEGORIES, WEB_FETCH_TOOL, WEB_SEARCH_TOOL, searchResultBlocks, searchResultText, urlKey, urlsIn, webFetch, webSearch, webSearchProvider, type WebPage } from "./web-search";
import { UPGRADE_TOOL_NAME } from "./prompts";

export type ToolCall = { id: string; name: string; input: unknown };

export function replyTools({
  env,
  io,
  history,
  openDesign,
  deepseek,
  handoff,
  emit,
  signal,
}: {
  env: Env;
  io: ToolIO;
  history: GodChatMessage[];
  openDesign?: () => Promise<DesignAdmission>;
  deepseek: () => boolean;
  handoff: () => void;
  emit: (event: GodChatEvent) => void;
  signal: AbortSignal;
}) {
  const used = { searches: 0, fetches: 0 };
  let openedSessionId: string | undefined;
  const ledger = newLedger();
  const docKeys = new Set<string>();
  const cards = new Set<GodChatCard>();
  const shownCards = new Set<string>();
  const shownSearches = new Set<string>();
  const showSearch = (id: string, query: string | undefined) => {
    if (shownSearches.has(id) || !query) return;
    shownSearches.add(id);
    emit({ type: "search", query });
  };
  const search = webSearchProvider(env);
  const searched = new Map<string, GodChatSource>();
  const fetchable = new Set(history.flatMap((message) => (message.role === "user" ? urlsIn(message.content) : [])));
  const pageContent = (pages: WebPage[]) => (deepseek() ? searchResultText(pages) : searchResultBlocks(pages));
  const run = async (call: ToolCall, tools: Anthropic.Beta.BetaToolUnion[]): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
    signal.throwIfAborted();
    const result = (content: string, isError: boolean) => ({
      type: "tool_result" as const,
      tool_use_id: call.id,
      content,
      is_error: isError,
    });
    if (call.name === UPGRADE_TOOL_NAME) return result("The Prophet is unavailable right now; answer as well as you can yourself.", true);
    if (!tools.some((tool) => "name" in tool && tool.name === call.name)) return result("This tool is unavailable in this conversation.", true);
    if (call.name === START_DESIGN_TOOL.name) {
      if (openedSessionId) return result("A design session is already active.", true);
      const started = await openDesign!();
      if ("error" in started) return result(started.error, true);
      openedSessionId = started.sessionId;
      handoff();
      emit({ type: "design", ...started.session });
      return result("The design session is open; the planner takes over this reply.", false);
    }
    if (call.name === WEB_SEARCH_TOOL.name || call.name === ANIME_SEARCH_TOOL.name || call.name === GAME_SEARCH_TOOL.name) {
      const input = call.input as { query?: unknown; category?: unknown; language?: unknown };
      const query = typeof input.query === "string" ? input.query.trim().slice(0, 400) : "";
      if (!query) return result("Give a non-empty query.", true);
      if (used.searches >= GOD_CHAT_LIMITS.maxWebSearches) return result("No searches remain for this reply.", true);
      used.searches++;
      showSearch(call.id, query);
      const started = Date.now();
      const category = WEB_CATEGORIES.find((value) => value === input.category) ?? "web";
      const log = (fields: Record<string, unknown>) => console.info("[god-chat] web", JSON.stringify({ kind: call.name, ...(call.name === WEB_SEARCH_TOOL.name && { category, provider: search?.search.service }), ms: Date.now() - started, ...fields }));
      try {
        let pages: WebPage[];
        if (call.name === ANIME_SEARCH_TOOL.name) pages = await animeSearch(query, signal);
        else if (call.name === GAME_SEARCH_TOOL.name) pages = await gameSearch(query, STORE_LANGUAGES.find((value) => value === input.language) ?? "en", signal);
        else if (!search) return result("Web search is not available.", true);
        else {
          pages = await webSearch(search, query, category, signal);
          for (const item of pages) {
            const key = urlKey(item.url);
            if (key) fetchable.add(key);
          }
        }
        for (const item of pages) searched.set(item.url, { url: item.url, title: item.title });
        log({ results: pages.length });
        return pages.length ? { type: "tool_result" as const, tool_use_id: call.id, content: pageContent(pages), is_error: false } : result("No results.", false);
      } catch (error) {
        signal.throwIfAborted();
        log({ error: String(error).slice(0, 200) });
        return result("Search failed; try once more or answer without it.", true);
      }
    }
    if (call.name === WEB_FETCH_TOOL.name) {
      const input = call.input as { url?: unknown };
      const key = typeof input.url === "string" ? urlKey(input.url) : undefined;
      if (!key || !fetchable.has(key)) return result("Only http(s) URLs the visitor wrote or that web_search returned in this reply can be read.", true);
      if (!search) return result("Reading pages is not available.", true);
      if (used.fetches >= MAX_WEB_FETCHES) return result("No page reads remain for this reply.", true);
      used.fetches++;
      const started = Date.now();
      const log = (fields: Record<string, unknown>) => console.info("[god-chat] web", JSON.stringify({ kind: call.name, ms: Date.now() - started, ...fields }));
      try {
        const page = await webFetch(search, key, signal);
        log({ results: page ? 1 : 0 });
        if (!page) return result("The page could not be read.", true);
        searched.set(page.url, { url: page.url, title: page.title });
        emit({ type: "doc", doc: "web", path: key, url: key });
        return { type: "tool_result" as const, tool_use_id: call.id, content: pageContent([page]), is_error: false };
      } catch (error) {
        signal.throwIfAborted();
        log({ error: String(error).slice(0, 200) });
        return result("The page could not be read.", true);
      }
    }
    if (call.name === SHOW_CARD_TOOL.name) {
      const input = parseShowCardInput(call.input);
      if (!input) return result("Unknown card, or the game card without a game name; the valid cards are listed in the tool description.", true);
      const { card } = input;
      const game = input.game ? await findGame(io, input.game) : undefined;
      if (input.game && !game) return result(`No game matching "${input.game}" in LYJW's PlayStation play history. Try another name for it, or answer without the card.`, true);
      const key = game ? `${card}:${game.titleId}` : card;
      if (shownCards.has(key)) return result(`The ${game ? `${card} card for ${game.name}` : `${card} card`} is already in this reply.`, true);
      shownCards.add(key);
      cards.add(card);
      emit({ type: "card", card, ...(game && { game: game.titleId }) });
      return result(await runShowCard(card, io, ledger, game?.name), false);
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
  };
  return { run, used, opened: () => openedSessionId, ledger, docKeys, cards, showSearch, search, searched };
}
