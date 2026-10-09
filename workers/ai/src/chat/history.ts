import type Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_CARD_VIEWS, isGodChatCard, type GodChatMessage, type GodChatTrace } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO, type GodChatEffort } from "@shared/god-chat-tiers";

import { isProjectDocKey, projectDocPath } from "../tools/project-docs";
import { isStatusViewKey } from "../tools/site-status";

// trace 随整对历史验过章（src/chat/seal.ts），仍只用枚举（档位、登记过的视图键与文档键）和计数拼，不放任何自由文本。
function traceNote({ tier, views, docs, searches, fallback, design, plan, cards }: GodChatTrace): string {
  const rank = tier ? `the ${GOD_CHAT_TIER_INFO[tier].persona} (${GOD_CHAT_TIER_INFO[tier].label})` : "an earlier rank";
  const who = fallback ? `another Claude model standing in for ${rank}, which declined it` : rank;
  const shown = cards?.filter(isGodChatCard) ?? [];
  const behindCards = new Set<string>(shown.flatMap((card) => GOD_CHAT_CARD_VIEWS[card]));
  const known = views?.filter((view) => isStatusViewKey(view) && !behindCards.has(view)) ?? [];
  const read = docs?.filter(isProjectDocKey) ?? [];
  const used = [
    known.length && `called get_site_status for ${known.join(", ")}`,
    read.length && `read the project docs ${read.map(projectDocPath).join(", ")}`,
    searches && `ran ${searches} web search${searches > 1 ? "es" : ""}`,
    design && "worked with the visitor in a design session",
    plan && "proposed a site change for the visitor to review",
    shown.length && `showed the visitor live ${shown.join(", ")} card${shown.length > 1 ? "s" : ""} with show_card`,
  ].filter(Boolean);
  return `[Chat server note: the assistant reply that follows was written by ${who}${used.length ? ` after it ${used.join(" and ")}` : " without using tools"}.]`;
}

// 按 trace 确定性生成，同一段历史每次前缀逐字节相同，缓存才命中。
export function toModelMessages(history: GodChatMessage[], effort: GodChatEffort): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let activeEffort: GodChatEffort | undefined;
  for (const [i, m] of history.entries()) {
    const trace = history[i + 1]?.role === "assistant" ? history[i + 1].trace : undefined;
    if (m.role === "user") {
      const turnEffort = i === history.length - 1 ? effort : trace?.effort;
      if (turnEffort && turnEffort !== activeEffort) {
        messages.push({ role: "system", content: [], output_config: { effort: turnEffort } });
        activeEffort = turnEffort;
      }
    }
    messages.push(m.role === "user" && trace
      ? { role: "user", content: [{ type: "text", text: m.content }, { type: "text", text: traceNote(trace) }] }
      : { role: m.role, content: m.content });
  }
  return messages;
}
