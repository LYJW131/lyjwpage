import type Anthropic from "@anthropic-ai/sdk";

import type { GodChatMessage, GodChatTrace } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { isProjectDocKey, projectDocPath } from "./project-docs";
import { isStatusViewKey } from "./site-status";

// trace 随整对历史验过章（src/chat/seal.ts），仍只用枚举（档位、登记过的视图键与文档键）和计数拼，不放任何自由文本。
function traceNote({ tier, views, docs, searches, fallback, issue }: GodChatTrace): string {
  const rank = tier ? `the ${GOD_CHAT_TIER_INFO[tier].persona} (${GOD_CHAT_TIER_INFO[tier].label})` : "an earlier rank";
  const who = fallback ? `another Claude model standing in for ${rank}, which declined it` : rank;
  const known = views?.filter(isStatusViewKey) ?? [];
  const read = docs?.filter(isProjectDocKey) ?? [];
  const used = [
    known.length && `called get_site_status for ${known.join(", ")}`,
    read.length && `read the project docs ${read.map(projectDocPath).join(", ")}`,
    searches && `ran ${searches} web search${searches > 1 ? "es" : ""}`,
    issue && "drafted a GitHub issue for the visitor to review and submit",
  ].filter(Boolean);
  return `[Chat server note: the assistant reply that follows was written by ${who}${used.length ? ` after it ${used.join(" and ")}` : " without using tools"}.]`;
}

// 按 trace 确定性生成，同一段历史每次前缀逐字节相同，缓存才命中。
export function toModelMessages(history: GodChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return history.map((m, i): Anthropic.Beta.BetaMessageParam => {
    const trace = history[i + 1]?.role === "assistant" ? history[i + 1].trace : undefined;
    return m.role === "user" && trace
      ? { role: "user", content: [{ type: "text", text: m.content }, { type: "text", text: traceNote(trace) }] }
      : { role: m.role, content: m.content };
  });
}
