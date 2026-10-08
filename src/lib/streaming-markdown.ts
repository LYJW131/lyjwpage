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

// 流式输出时只交出已经闭合的 Markdown：没收尾的代码块、正在长的表格、没配对的行内标记先压着，闭合后整块出现。
export function stableMarkdown(text: string): string {
  const lines = text.split("\n");
  const fences = lines.flatMap((line, i) => (FENCE.test(line) ? [i] : []));
  if (fences.length % 2 === 1) return lines.slice(0, fences[fences.length - 1]).join("\n").trimEnd();

  const lastFenceEnd = fences.length ? lines.slice(0, fences[fences.length - 1] + 1).join("\n").length : 0;
  const gap = text.lastIndexOf("\n\n");
  const blockStart = Math.max(gap === -1 ? 0 : gap + 2, lastFenceEnd);
  const head = text.slice(0, blockStart);
  const block = text.slice(blockStart);

  const blockLines = block.split("\n").filter((line) => line.trim());
  if (blockLines.length && blockLines.every((line) => line.trimStart().startsWith("|"))) return head.trimEnd();

  const tail = block.slice(0, inlineCut(block)).replace(/[*`~_#|>[\]]+$/, "");
  return (head + tail).trimEnd();
}
