export type CommentRange = { start: number; end: number; text: string };
export type Normalized = { code: string; key?: string; directives: string[]; errors: string[] };

export function bindDirectives<C extends CommentRange>(source: string, comments: C[], wanted: (comment: C) => boolean, atOf: (comment: C) => number | undefined): string[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lineEnd = (line: number) => (line + 1 < lineStarts.length ? (lineStarts[line + 1] ?? 0) - 1 : source.length);
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const codeIn = (from: number, to: number) => {
    let code = "";
    let pos = from;
    for (const comment of comments) {
      if (comment.end <= pos) continue;
      if (comment.start >= to) break;
      code += source.slice(pos, comment.start);
      pos = Math.min(comment.end, to);
    }
    return squash(code + source.slice(pos, to));
  };

  return comments.filter(wanted).map((comment) => {
    const first = lineOf(comment.start);
    const last = lineOf(Math.max(comment.start, comment.end - 1));
    let next = "无";
    if (last + 1 < lineStarts.length) {
      const [from, to] = [lineStarts[last + 1] ?? 0, lineEnd(last + 1)];
      const code = codeIn(from, to);
      next = `「${code || (source.slice(from, to).trim() ? "«注释»" : "")}」`;
    }
    return `${squash(comment.text)}  ‹位置 ${atOf(comment)}，同行前「${codeIn(lineStarts[first] ?? 0, comment.start)}」，同行后「${codeIn(comment.end, lineEnd(last))}」，下一行${next}›`;
  });
}
