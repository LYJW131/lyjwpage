import type Anthropic from "@anthropic-ai/sdk";

import type { GodChatMessage, GodChatTrace } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { isStatusViewKey } from "./site-status";

// trace 是浏览器交来的，说明只用枚举（档位、登记过的视图键）和计数拼，访客塞不进任何文字。
function traceNote({ tier, views, searches, fallback }: GodChatTrace): string {
  const rank = tier ? `the ${GOD_CHAT_TIER_INFO[tier].persona} (${GOD_CHAT_TIER_INFO[tier].label})` : "an earlier rank";
  const who = fallback ? `another Claude model standing in for ${rank}, which declined it` : rank;
  const known = views?.filter(isStatusViewKey) ?? [];
  const used = [
    known.length && `called get_site_status for ${known.join(", ")}`,
    searches && `ran ${searches} web search${searches > 1 ? "es" : ""}`,
  ].filter(Boolean);
  return `The next assistant reply was written by ${who}. ${used.length ? `Before writing it, it ${used.join(" and ")}, so facts it states about those come from real tool results (they may be stale now).` : "It used no tools."}`;
}

// 说明插在被说明的那条回复之前：系统消息只能接在访客消息后面、后面跟着助手回复。
// 按 trace 确定性生成，同一段历史每次前缀逐字节相同，缓存才命中。
export function toModelMessages(history: GodChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return history.flatMap((m): Anthropic.Beta.BetaMessageParam[] =>
    m.role === "assistant" && m.trace
      ? [{ role: "system", content: traceNote(m.trace) }, { role: "assistant", content: m.content }]
      : [{ role: m.role, content: m.content }],
  );
}
