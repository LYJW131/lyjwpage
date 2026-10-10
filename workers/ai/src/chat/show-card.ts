import type Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_CARD_VIEWS, GOD_CHAT_CARDS, isGodChatCard, type GodChatCard } from "@shared/god-chat";

import type { ToolIO, ToolLedger } from "../tools/registry";
import { SITE_STATUS_TOOL } from "../tools/site-status";

const CARD_NOTES = {
  nowListening: "the song playing right now, or that nothing is playing",
  listening: "recently played albums and playlists",
  nowWatching: "what is playing on Emby right now, or that nothing is",
  watching: "recently watched movies and episodes",
  playingNow: "PlayStation online status and the game being played right now",
  playing: "recently played games with play time",
  activity: "Apple Watch activity rings today",
  workouts: "recent workouts",
} as const satisfies Record<GodChatCard, string>;

export const SHOW_CARD_TOOL: Anthropic.Beta.BetaTool = {
  name: "show_card",
  description: [
    "Show the visitor a live card inside your reply. The site draws it from the same public data as its homepage cards and keeps it updated; you only pick which card.",
    "The result also returns that data (the get_site_status view behind the card), so you don't need get_site_status for the same topic.",
    "Each card covers one thing: what is happening now, or what happened recently. Show only what the visitor asked about: \"what is LYJW listening to\" gets nowListening alone, \"what has LYJW been listening to lately\" gets listening alone. Show both only when the visitor asks for both, or when nothing is happening now and the recent card answers the question better.",
    "Each card at most once per reply. The card already lists the details: don't repeat them as a list, answer in a sentence or two and don't say where the card is.",
    "Cards:",
    ...GOD_CHAT_CARDS.map((card) => `- ${card}: ${CARD_NOTES[card]}`),
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      card: { type: "string", enum: GOD_CHAT_CARDS, description: "Which card to show" },
    },
    required: ["card"],
    additionalProperties: false,
  },
  strict: true,
};

export function parseShowCardInput(input: unknown): GodChatCard | null {
  const card = (input as { card?: unknown } | null)?.card;
  return isGodChatCard(card) ? card : null;
}

// 卡片背后的视图照样记进这条回复的读取账本（claimViews 的额度与去重），读过的不再读。
export async function runShowCard(card: GodChatCard, io: ToolIO, ledger: ToolLedger): Promise<{ text: string; isError: boolean }> {
  const outcome = await SITE_STATUS_TOOL.run({ views: GOD_CHAT_CARD_VIEWS[card] }, io, ledger);
  if (outcome.isError && /"error":/.test(outcome.text)) {
    return {
      text: `The ${card} card is in the reply, but its live data could not be read. Say so; do not invent what it shows.\n\n${outcome.text}`,
      isError: true,
    };
  }
  if (outcome.isError) return { text: outcome.text, isError: true };
  return {
    text: `The ${card} card is now in your reply, showing this data live. Don't restate it as a list or mention where the card is.\n\n${outcome.text}`,
    isError: false,
  };
}
