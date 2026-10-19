import type Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_CARD_VIEWS, GOD_CHAT_CARDS, isGodChatCard, type GodChatCard } from "@shared/god-chat";
import type { PlaystationPlayingPayload } from "@shared/playstation-types";
import { STATUS_VIEWS } from "@shared/status-views";

import type { ToolIO, ToolLedger } from "../tools/registry";
import { SITE_STATUS_TOOL } from "../tools/site-status";
import { normalize } from "../tools/status-shape";

const CARD_NOTES = {
  nowListening: "the song playing right now, including one inferred as playing on another device, or that nothing is playing",
  listening: "recently played albums and playlists",
  nowWatching: "what is playing on Emby right now, or that nothing is",
  watching: "recently watched movies and episodes",
  playingNow: "PlayStation online status and the game being played right now",
  playing: "recently played games with play time",
  activity: "Apple Watch activity rings today",
  workouts: "recent workouts",
  game: "one game the visitor asked about: cover, play time, sessions, last played and trophy progress; put its name in game",
} as const satisfies Record<GodChatCard, string>;

export const SHOW_CARD_TOOL: Anthropic.Beta.BetaTool = {
  name: "show_card",
  description: [
    "Show the visitor a live card inside your reply. The site draws it from the same public data as its homepage cards and keeps it updated; you only pick which card.",
    "The result also returns that data (the get_site_status view behind the card), so you don't need get_site_status for the same topic.",
    "Each card covers one thing: what is happening now, or what happened recently. Show only what the visitor asked about: \"what is LYJW listening to\" gets nowListening alone, \"what has LYJW been listening to lately\" gets listening alone. Show both only when the visitor asks for both, or when nothing is happening now and the recent card answers the question better.",
    "When the visitor asks about one specific game LYJW played, show the game card for it instead of the playing card. Game names may be in Chinese, English or Japanese; if no game matches, try another name.",
    "Each card at most once per reply (the game card once per game). The card already lists the details: don't repeat them as a list, answer in a sentence or two and don't say where the card is.",
    "Cards:",
    ...GOD_CHAT_CARDS.map((card) => `- ${card}: ${CARD_NOTES[card]}`),
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      card: { type: "string", enum: GOD_CHAT_CARDS, description: "Which card to show" },
      game: { type: "string", description: "For the game card, the game's name as the visitor or the play history writes it; an empty string for every other card" },
    },
    required: ["card", "game"],
    additionalProperties: false,
  },
  strict: true,
};

export type ShowCardInput = { card: GodChatCard; game?: string };

export function parseShowCardInput(input: unknown): ShowCardInput | null {
  const { card, game } = (input ?? {}) as { card?: unknown; game?: unknown };
  if (!isGodChatCard(card)) return null;
  if (card !== "game") return { card };
  const name = typeof game === "string" ? game.trim() : "";
  return name ? { card, game: name.slice(0, 100) } : null;
}

// 模型写的游戏名常和记录里的差在空格、冒号、破折号上，比较前去掉这些。
const gameKey = (name: string) => normalize(name).replace(/[\s\p{P}\p{S}]+/gu, "");

// 模型给的是游戏名，浏览器要的是游玩列表里的 titleId：Worker 在这里按名字找一次，找不到就不画卡。
export async function findGame(io: ToolIO, name: string): Promise<{ titleId: string; name: string } | null> {
  let body: { data?: PlaystationPlayingPayload };
  try {
    const response = await io.readStatus(STATUS_VIEWS.playing.path);
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }
  const needle = gameKey(name);
  if (!needle) return null;
  const items = body.data?.items ?? [];
  const match = items.find((game) => gameKey(game.name) === needle) ?? items.find((game) => gameKey(game.name).includes(needle));
  return match ? { titleId: match.titleId, name: match.name } : null;
}

// 卡片背后的视图照样记进这条回复的读取账本（claimViews 的额度与去重），读过的不再读。
export async function runShowCard(card: GodChatCard, io: ToolIO, ledger: ToolLedger, game?: string): Promise<string> {
  const { text } = await SITE_STATUS_TOOL.run({ views: GOD_CHAT_CARD_VIEWS[card], ...(game && { query: game }) }, io, ledger);
  const shown = game ? `The ${card} card for ${game}` : `The ${card} card`;
  return `${shown} is now in your reply, showing this data live. Don't restate it as a list or mention where the card is.\n\n${text}`;
}
