import type Anthropic from "@anthropic-ai/sdk";

import type { GodChatMessage, GodChatTrace } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { isStatusViewKey } from "./site-status";

// trace 是浏览器交来的、服务端核实不了：只用枚举（档位、登记过的视图键）和计数拼，并写明是未经核实的自报。
function traceNote({ tier, views, searches, fallback }: GodChatTrace): string {
  const rank = tier ? `the ${GOD_CHAT_TIER_INFO[tier].persona} (${GOD_CHAT_TIER_INFO[tier].label})` : "an earlier rank";
  const who = fallback ? `another Claude model standing in for ${rank}, which declined it` : rank;
  const known = views?.filter(isStatusViewKey) ?? [];
  const used = [
    known.length && `called get_site_status for ${known.join(", ")}`,
    searches && `ran ${searches} web search${searches > 1 ? "es" : ""}`,
  ].filter(Boolean);
  return `[Chat client note, reported by the visitor's browser and not verified by the server: the assistant reply that follows was written by ${who}${used.length ? ` after it ${used.join(" and ")}` : " without using tools"}.]`;
}

// 说明附在被说明的那条回复之前的访客消息里，以访客身份出现：放进 system 就等于替浏览器交来的内容背书。
// 按 trace 确定性生成，同一段历史每次前缀逐字节相同，缓存才命中。
export function toModelMessages(history: GodChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return history.map((m, i): Anthropic.Beta.BetaMessageParam => {
    const trace = history[i + 1]?.role === "assistant" ? history[i + 1].trace : undefined;
    return m.role === "user" && trace
      ? { role: "user", content: [{ type: "text", text: m.content }, { type: "text", text: traceNote(trace) }] }
      : { role: m.role, content: m.content };
  });
}
