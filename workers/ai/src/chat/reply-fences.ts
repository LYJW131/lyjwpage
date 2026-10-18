import { checkGodChatVisual, isGodChatVisualKind, type GodChatVisualKind } from "@shared/god-chat";

export type ReplyFence = { language: string; source: string; closed: boolean };
export type InvalidVisual = { kind: GodChatVisualKind; error: "json" | "shape" | "unclosed" };

const CONTAINER = /^ {0,3}(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const QUOTE = /^[ \t]*(?:>[ \t]?)+/;

// 浏览器按 Markdown 解析，围栏可以在引用块和列表项里；这里只认这两种容器前缀，不做完整解析。
// 顶层缩进四格起是缩进代码块，浏览器当普通代码显示；只有在列表里，更深的缩进才是列表项的续行。
// 引用块里的内容行去掉 `>` 才是原文；列表的缩进是 JSON 允许的空白，不用去。
export function replyFences(reply: string): ReplyFence[] {
  const fences: ReplyFence[] = [];
  let open: { marker: string; language: string; quoted: boolean; lines: string[] } | null = null;
  let inList = false;
  for (const line of reply.split(/\r?\n/)) {
    if (!open && line.trim()) inList = LIST_ITEM.test(line) || (inList && /^[ \t]/.test(line));
    const prefix = inList ? (/^[ \t]*/.exec(line)?.[0] ?? "") + (CONTAINER.exec(line.trimStart())?.[0] ?? "") : (CONTAINER.exec(line)?.[0] ?? "");
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
// repaired 是漏写末尾括号、补齐后画出来的块：访客看得到图，但记下来才知道模型多常这样写。
export function checkVisuals(fences: ReplyFence[]): { invalid: InvalidVisual[]; repaired: GodChatVisualKind[] } {
  const invalid: InvalidVisual[] = [];
  const repaired: GodChatVisualKind[] = [];
  for (const { language, source, closed } of fences) {
    if (!isGodChatVisualKind(language)) continue;
    const check = checkGodChatVisual(language, source);
    if (check.error) invalid.push({ kind: language, error: closed ? check.error : "unclosed" });
    else if (check.repaired) repaired.push(language);
  }
  return { invalid, repaired };
}
