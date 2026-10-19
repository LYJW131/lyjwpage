import { bindDirectives, type Normalized } from "./directives.ts";

type SwiftSpan = { start: number; end: number; at: number };
type Segment = { kind: "code" | "string"; text: string };

export const SWIFT_EXTENSION = ".swift";

export function stripSwift(text: string): { code: string; comments: string[]; spans: SwiftSpan[]; segments: Segment[] } {
  let i = 0;
  let out = "";
  const comments: string[] = [];
  const spans: SwiftSpan[] = [];
  const strings: [number, number][] = [];
  let stringDepth = 0;
  const n = text.length;

  const comment = (start: number) => {
    comments.push(text.slice(start, i));
    spans.push({ start, end: i, at: out.length });
  };

  const blockComment = () => {
    const start = i;
    let depth = 0;
    while (i < n) {
      if (text[i] === "/" && text[i + 1] === "*") { depth++; i += 2; continue; }
      if (text[i] === "*" && text[i + 1] === "/") { depth--; i += 2; if (depth === 0) break; continue; }
      i++;
    }
    comment(start);
  };

  const string = (hashes: number, from: number) => {
    stringDepth++;
    const closing = "#".repeat(hashes);
    const multi = text.startsWith('"""', i);
    const open = multi ? '"""' : '"';
    out += open;
    i += open.length;
    while (i < n) {
      if (text.startsWith(open + closing, i)) {
        out += open + closing;
        i += open.length + closing.length;
        break;
      }
      if (!multi && text[i] === "\n") break;
      if (text[i] === "\\" && text.startsWith(closing, i + 1)) {
        const after = i + 1 + hashes;
        if (text[after] === "(") {
          out += text.slice(i, after + 1);
          i = after + 1;
          code(true);
          continue;
        }
        out += text.slice(i, after + 1);
        i = after + 1;
        continue;
      }
      out += text[i++];
    }
    stringDepth--;
    if (stringDepth === 0) strings.push([from, out.length]);
  };

  const code = (untilParen: boolean) => {
    let depth = 0;
    while (i < n) {
      const c = text[i];
      if (c === "/" && text[i + 1] === "/") {
        const start = i;
        while (i < n && text[i] !== "\n") i++;
        comment(start);
        continue;
      }
      if (c === "/" && text[i + 1] === "*") {
        blockComment();
        out += " ";
        continue;
      }
      if (c === '"') {
        string(0, out.length);
        continue;
      }
      if (c === "#") {
        let hashes = 0;
        while (text[i + hashes] === "#") hashes++;
        if (text[i + hashes] === '"') {
          const from = out.length;
          out += "#".repeat(hashes);
          i += hashes;
          string(hashes, from);
          continue;
        }
        out += text.slice(i, i + hashes);
        i += hashes;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") {
        if (untilParen && depth === 0) {
          out += c;
          i++;
          return;
        }
        depth--;
      }
      out += c;
      i++;
    }
  };

  code(false);

  const segments: Segment[] = [];
  let at = 0;
  for (const [from, to] of strings) {
    if (from > at) segments.push({ kind: "code", text: out.slice(at, from) });
    segments.push({ kind: "string", text: out.slice(from, to) });
    at = to;
  }
  if (at < out.length) segments.push({ kind: "code", text: out.slice(at) });
  return { code: out, comments, spans, segments };
}

const SWIFT_DIRECTIVES = /\b(?:swiftlint|swiftformat|sourcery|periphery)\s*:|\bswift-format-ignore\b/;
// 字符串之外不会出现 NUL，可安全用作保留原文的占位。
const STRING_SLOT = "\u0000";

export function normalizeSwift(text: string, { loose = false } = {}): Normalized {
  const { code, comments, spans, segments } = stripSwift(text);
  const strings: string[] = [];
  const skeleton = segments
    .map((segment) => {
      if (segment.kind === "code") return segment.text;
      strings.push(segment.text);
      return STRING_SLOT;
    })
    .join("");
  const flat = loose
    ? skeleton.replace(/\s+/g, "")
    : skeleton
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
  const shown = flat.split(STRING_SLOT).map((part, k) => part + (strings[k] ?? "")).join("");

  const significant = [0];
  for (let k = 0; k < code.length; k++) significant.push((significant[k] ?? 0) + (/\s/.test(code[k] ?? "") ? 0 : 1));
  const ranges = comments.map((body, k) => ({ text: body, ...(spans[k] as SwiftSpan) }));
  const directives = bindDirectives(text, ranges, (range) => SWIFT_DIRECTIVES.test(range.text), (range) => significant[range.at]);
  const shebang = /^#!.*/.exec(text)?.[0];
  if (shebang) directives.unshift(shebang);
  return { code: shown, key: JSON.stringify([flat, strings]), directives, errors: [] };
}
