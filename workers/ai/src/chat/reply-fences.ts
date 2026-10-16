import { checkGodChatVisual, isGodChatVisualKind, type GodChatVisualKind } from "@shared/god-chat";

export type ReplyFence = { language: string; source: string; closed: boolean };
export type InvalidVisual = { kind: GodChatVisualKind; error: "json" | "shape" | "unclosed" };

// 与浏览器的 Markdown 解析对齐的最小子集：围栏最多缩进三格，收尾围栏同字符、不短于开头；语言标记取信息串第一个词、不分大小写。
export function replyFences(reply: string): ReplyFence[] {
  const fences: ReplyFence[] = [];
  let open: { marker: string; language: string; lines: string[] } | null = null;
  for (const line of reply.split("\n")) {
    if (!open) {
      const start = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(line);
      if (start) open = { marker: start[1], language: start[2].toLowerCase(), lines: [] };
      continue;
    }
    const end = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (end && end[1][0] === open.marker[0] && end[1].length >= open.marker.length) {
      fences.push({ language: open.language, source: open.lines.join("\n"), closed: true });
      open = null;
    } else open.lines.push(line);
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
