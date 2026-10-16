import { checkGodChatVisual, isGodChatVisualKind, type GodChatVisualKind } from "@shared/god-chat";

export type ReplyFence = { language: string; source: string; closed: boolean };
export type InvalidVisual = { kind: GodChatVisualKind; error: "json" | "shape" | "unclosed" };

const CONTAINER = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*/;
const QUOTE = /^[ \t]*(?:>[ \t]?)+/;

// 浏览器按 Markdown 解析，围栏可以在引用块和列表项里；这里只认这两种容器前缀，不做完整解析。
// 引用块里的内容行去掉 `>` 才是原文；列表的缩进是 JSON 允许的空白，不用去。
export function replyFences(reply: string): ReplyFence[] {
  const fences: ReplyFence[] = [];
  let open: { marker: string; language: string; quoted: boolean; lines: string[] } | null = null;
  for (const line of reply.split(/\r?\n/)) {
    const prefix = CONTAINER.exec(line)?.[0] ?? "";
    const rest = line.slice(prefix.length);
    if (!open) {
      const start = /^(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(rest);
      if (start) open = { marker: start[1], language: start[2].toLowerCase(), quoted: prefix.includes(">"), lines: [] };
      continue;
    }
    const end = /^(`{3,}|~{3,})[ \t]*$/.exec(rest);
    if (end && end[1][0] === open.marker[0] && end[1].length >= open.marker.length) {
      fences.push({ language: open.language, source: open.lines.join("\n"), closed: true });
      open = null;
    } else open.lines.push(open.quoted ? line.replace(QUOTE, "") : line);
  }
  if (open) fences.push({ language: open.language, source: open.lines.join("\n"), closed: false });
  return fences;
}

// 回复结束后浏览器按整块校验，过不了就把 JSON 原样当代码显示；Worker 用同一份校验记下来，否则只有访客看得到。
// 没收尾的块多半是回复被字数上限截断，浏览器同样按整块校验，单独标出来。
export function invalidVisuals(fences: ReplyFence[]): InvalidVisual[] {
  const invalid: InvalidVisual[] = [];
  for (const { language, source, closed } of fences) {
    if (!isGodChatVisualKind(language)) continue;
    const { error } = checkGodChatVisual(language, source);
    if (error) invalid.push({ kind: language, error: closed ? error : "unclosed" });
  }
  return invalid;
}
