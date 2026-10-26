import { GOD_CHAT_NEXT_FENCE, GOD_CHAT_NEXT_MAX_CHARS } from "@shared/god-chat";

export { GOD_CHAT_NEXT_FENCE, GOD_CHAT_NEXT_MAX_CHARS };

const OPENER = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;
const CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

// 只认末尾的预测块：不在末尾的 next 块原样留在正文里。没收尾的块（流式输出中）同样切掉。
export function splitNextSuggestion(content: string): { body: string; next?: string } {
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  const openers = lines.map((line) => OPENER.exec(line));
  const at = openers.findLastIndex((open) => open?.[2].toLowerCase() === GOD_CHAT_NEXT_FENCE);
  const marker = openers[at]?.[1];
  if (!marker) return { body: content };
  const rest = lines.slice(at + 1);
  const close = rest.findIndex((line) => {
    const fence = CLOSER.exec(line)?.[1];
    return fence !== undefined && fence[0] === marker[0] && fence.length >= marker.length;
  });
  if (close >= 0 && rest.slice(close + 1).some((line) => line.trim())) return { body: content };
  const body = content.split("\n").slice(0, at).join("\n").trimEnd();
  const next = (close >= 0 ? rest.slice(0, close) : rest)[0]?.trim();
  return next && [...next].length <= GOD_CHAT_NEXT_MAX_CHARS ? { body, next } : { body };
}
