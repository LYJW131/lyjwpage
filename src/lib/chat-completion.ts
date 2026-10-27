import type { ChatSession } from "@/lib/chat-archive";
import { GOD_CHAT_NEXT_MAX_CHARS } from "@shared/god-chat";

const fold = (text: string) => text.normalize("NFKC").toLowerCase();

// 返回接在草稿后面的剩余文字，保留候选句原来的写法；NFKC 可能改变长度，所以逐个码位找出与草稿等价的那段前缀。
export function chatCompletion(draft: string, next: string | undefined, candidates: readonly string[]): string {
  if (!draft) return next ?? "";
  if (!draft.trim() || draft.trimStart().startsWith("/")) return "";
  const typed = fold(draft);
  for (const candidate of next ? [next, ...candidates] : candidates) {
    if (!fold(candidate).startsWith(typed)) continue;
    let prefix = "";
    for (const char of candidate) {
      prefix += char;
      if (fold(prefix) === typed) {
        const rest = candidate.slice(prefix.length);
        if (rest) return rest;
        break;
      }
    }
  }
  return "";
}

export function chatHistoryLines(sessions: readonly ChatSession[]): string[] {
  const lines = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((session) => session.messages.filter((message) => message.role === "user" && !message.answers).map((message) => message.content.trim()).reverse())
    .filter((line) => line && !line.startsWith("/") && [...line].length <= GOD_CHAT_NEXT_MAX_CHARS);
  return [...new Set(lines)];
}
