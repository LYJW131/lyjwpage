import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type * as TS from "typescript";

export type Issue = { file: string; line: number; rule: string; message: string };
type Comment = { line: number; start: number; end: number; text: string };

const HASH_COMMENT_EXTS = new Set(["py", "sh", "yml", "yaml", "toml"]);
const SLASH_COMMENT_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "css"]);
export const TS_PARSE_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
export const JSX_EXTS = new Set(["tsx", "jsx"]);
export const HELPER_SCOPE = /^(?:src|shared|workers\/[^/]+\/src)\/.+\.(?:ts|tsx|mts)$/;

export const extOf = (file: string) => path.posix.extname(file).slice(1).toLowerCase();

const TS_PACKAGE = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"));
let tsModule: typeof TS | undefined;
export const loadTs = (): typeof TS => (tsModule ??= TS_PACKAGE("typescript") as typeof TS);

// 全文件注释扫描：跳过引号与模板串内容，逐条给出注释的行号与起止偏移；
// 同行多个注释、块注释同行闭合、注释后还有代码都各自成条。
export function commentTexts(file: string, text: string): Comment[] {
  const ext = extOf(file);
  const slashed = SLASH_COMMENT_EXTS.has(ext);
  const hashed = HASH_COMMENT_EXTS.has(ext);
  if (!slashed && !hashed) return [];
  const comments: Comment[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let quote: string | null = null;
  while (i < n) {
    const char = text[i];
    if (char === "\n") { line += 1; i += 1; continue; }
    if (quote) {
      if (char === "\\") { if (text[i + 1] === "\n") line += 1; i += 2; continue; }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (slashed && (char === '"' || char === "'" || char === "`")) { quote = char; i += 1; continue; }
    if (slashed && char === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      const start = i;
      let end = i;
      while (end < n && text[end] !== "\n") end += 1;
      comments.push({ line, start, end, text: text.slice(start, end) });
      i = end;
      continue;
    }
    if (slashed && char === "/" && text[i + 1] === "*") {
      const start = i;
      const startLine = line;
      let end = i + 2;
      while (end < n && !(text[end] === "*" && text[end + 1] === "/")) end += 1;
      end = Math.min(end + 2, n);
      const comment = text.slice(start, end);
      comments.push({ line: startLine, start, end, text: comment });
      line += (comment.match(/\n/g) ?? []).length;
      i = end;
      continue;
    }
    if (hashed && char === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const start = i;
      let end = i;
      while (end < n && text[end] !== "\n") end += 1;
      comments.push({ line, start, end, text: text.slice(start, end) });
      i = end;
      continue;
    }
    i += 1;
  }
  return comments;
}

// 把注释内容抹成等长空位（保留换行与行号），供逐行扫描的检查跳过注释里的字样。
export function maskComments(file: string, text: string) {
  const comments = commentTexts(file, text);
  if (comments.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const { start, end } of comments) {
    out += text.slice(cursor, start) + text.slice(start, end).replace(/[^\n]/g, " ");
    cursor = end;
  }
  return out + text.slice(cursor);
}
