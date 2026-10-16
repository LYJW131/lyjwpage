import { GOD_CHAT_VISUAL_KINDS } from "@shared/god-chat";

const FENCE = /^\s{0,3}(```|~~~)/;

function positions(text: string, token: string): number[] {
  const hits: number[] = [];
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) hits.push(i);
  return hits;
}

// 行内标记只在最后一段里检查：段落之间隔着空行，前面的段落已经闭合。
function inlineCut(block: string): number {
  let cut = block.length;
  const ticks = positions(block, "`");
  if (ticks.length % 2 === 1) cut = Math.min(cut, ticks[ticks.length - 1]);
  const masked = block.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));

  const strong = positions(masked, "**");
  if (strong.length % 2 === 1) cut = Math.min(cut, strong[strong.length - 1]);
  const strike = positions(masked, "~~");
  if (strike.length % 2 === 1) cut = Math.min(cut, strike[strike.length - 1]);

  const single = [...masked.replace(/\*\*/g, "  ").matchAll(/\*/g)]
    .map((m) => m.index!)
    .filter((i) => !/^[ \t]*$/.test(masked.slice(masked.lastIndexOf("\n", i - 1) + 1, i)) || masked[i + 1] !== " ");
  if (single.length % 2 === 1) cut = Math.min(cut, single[single.length - 1]);

  const open = masked.lastIndexOf("[");
  if (open > masked.lastIndexOf("]")) cut = Math.min(cut, open);
  const target = masked.lastIndexOf("](");
  if (target !== -1 && masked.indexOf(")", target) === -1) cut = Math.min(cut, masked.lastIndexOf("[", target));
  return cut;
}

const VISUAL_FENCE = new RegExp(`^\\s{0,3}(\`{3,}|~{3,})\\s*(html|${GOD_CHAT_VISUAL_KINDS.join("|")})\\s*$`, "i");

// 流式输出时只交出已经闭合的 Markdown：没收尾的代码块、正在长的表格、没配对的行内标记先压着，闭合后整块出现。
// 例外是图示代码块（html 与原生图示）：换成同语言的空代码块，图示先占位，收尾后整块画出来。
export function stableMarkdown(text: string): string {
  const lines = text.split("\n");
  const fences = lines.flatMap((line, i) => (FENCE.test(line) ? [i] : []));
  if (fences.length % 2 === 1) {
    const at = fences[fences.length - 1];
    const open = lines[at].match(VISUAL_FENCE);
    const head = lines.slice(0, at).join("\n").trimEnd();
    if (!open) return head;
    // 没收尾的图示代码块带着已写出的部分补上收尾：JSON 图示按写完的条目先画，html 增量推进 iframe。末行可能是写到一半的收尾符，先压着。
    const body = lines.slice(at + 1);
    if (body.length && /^\s*[`~]+\s*$/.test(body[body.length - 1])) body.pop();
    const written = body.join("\n");
    return `${head}\n\n${open[1]}${open[2]}\n${written.trim() ? `${written}\n` : ""}${open[1]}`;
  }

  const lastFenceEnd = fences.length ? lines.slice(0, fences[fences.length - 1] + 1).join("\n").length : 0;
  const gap = text.lastIndexOf("\n\n");
  const blockStart = Math.max(gap === -1 ? 0 : gap + 2, lastFenceEnd);
  const head = text.slice(0, blockStart);
  const block = text.slice(blockStart);

  const blockLines = block.split("\n").filter((line) => line.trim());
  if (blockLines.length && blockLines.every((line) => line.trimStart().startsWith("|"))) return head.trimEnd();

  // 已经配对的标记原样保留（末尾的反引号、星号可能正是收尾符）；最后一行只有块级起始标记、还没正文时整行先压着。
  const tail = block.slice(0, inlineCut(block)).replace(/(^|\n)[ \t]*(#{1,6}|>|[-*+]|\d+[.)]|\||`{1,2}|~{1,2})[ \t]*$/, "$1");
  return (head + tail).trimEnd();
}

// 模型的文字成块到达（一次几十字），原样画出来像整段蹦出。前端按积压量匀速放字：积压越多放得越快，
// 约 STREAM_DRAIN_MS 放完；流结束后按 STREAM_FLUSH_MS 收尾，不让回复在服务端早已答完后还拖很久。
export const STREAM_DRAIN_MS = 1_000;
export const STREAM_FLUSH_MS = 400;
const STREAM_MIN_CHARS_PER_SECOND = 30;

export function revealedLength(text: string, shown: number, elapsedMs: number, finished: boolean): number {
  const backlog = text.length - shown;
  if (backlog <= 0) return text.length;
  const perSecond = Math.max(STREAM_MIN_CHARS_PER_SECOND, (backlog * 1000) / (finished ? STREAM_FLUSH_MS : STREAM_DRAIN_MS));
  return Math.min(text.length, shown + Math.max(1, (perSecond * elapsedMs) / 1000));
}

// 不切在代理对中间，免得半个 emoji 闪一下。
export function revealedText(text: string, shown: number): string {
  let end = Math.floor(shown);
  if (end > 0 && end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
  return text.slice(0, end);
}
