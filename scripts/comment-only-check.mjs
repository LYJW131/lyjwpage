#!/usr/bin/env node
/**
 * 证明一批改动「只改了注释」：把基准版本和当前版本的文件都去掉注释后比较，逐个文件给出结论。
 * 清扫注释的改动收尾时用（根 AGENTS.md「文档与注释」）：输出里没有「除注释外有改动」
 * 「指令性注释有改动」这类结论，才能说这批只动了注释。
 *
 * 用法（在仓库里执行）：
 *   pnpm docs:comment-only [选项] [文件...]
 *
 *   文件         .ts .tsx .mts .cts .js .jsx .mjs .cjs .swift，相对仓库根或绝对路径。
 *                不给就取 `git diff --name-only <base>`（含未提交改动）里扩展名认识的那些。
 *   --base <ref> 基准，默认 HEAD。基准里没有的文件算「新增」，不能证明只改了注释。
 *   --to <ref>   拿 <base> 和 <ref> 比；不给就拿 <base> 和工作区比。
 *   --repo <dir> 仓库根，默认当前目录所在的仓库。TypeScript 依次从这个仓库、本脚本所在的仓库、
 *                环境变量 COMMENT_ONLY_REPO 指的仓库、当前目录的 node_modules 里取。
 *   --loose      Swift 的代码部分去掉全部空白再比（字符串字面量不受影响，见下）。默认保留换行和
 *                「有没有空白」，因为 Swift 里 `a -b` 与 `a - b`、换行与否可能是两回事。
 *                TS/JS 一律忽略排版。
 *   --context N  差异输出保留的行数上限，默认 30，0 表示不输出。
 *
 * 结论（每个文件一个）：
 *   仅注释           去掉注释后逐字相同，且指令性注释连同它们绑定的位置也没变
 *   没变化           两边内容逐字相同
 *   除注释外有改动   去掉注释后不同，同时输出差异
 *   指令性注释有改动 去掉注释后相同，但看着是注释、实际影响编译或检查的那类注释变了（正文变了，
 *                    或挪了位置），要人看一眼：`@ts-ignore`、`@ts-expect-error`、`eslint-disable`、
 *                    `/// <reference>`、`#__PURE__`、`/*!` 版权头、shebang、JS 里带类型的 JSDoc、
 *                    swiftlint 指令等，认得的写法见 TS_DIRECTIVES 与 SWIFT_DIRECTIVES
 *   解析失败、新增文件、已删除、不支持的类型  都不能证明只改了注释
 * 退出码：全部是「仅注释」或「没变化」为 0，有别的结论为 1，用法错误或环境缺失为 2。
 *
 * 做法：TS/JS 用 TypeScript 编译器 API 解析，`printer` 打开 `removeComments` 重新打印，所以字符串、
 * 模板、正则里的 `//` 不会被误当注释，排版差异也不算改动；JSX 里只含注释的花括号表达式和只含换行的
 * 空白文本按 JSX 语义等同于没有。Swift 用自带的词法扫描，认得嵌套的块注释、字符串插值、原始字符串
 * 和多行字符串。
 *
 * 字符串字面量逐字比较：里面的空白是内容，不是排版。TS/JS 的字符串、模板、正则、JSX 文本由 printer
 * 原样输出；Swift 的整个字符串（单行、多行、原始，含插值）当作一段原文，只比较字符串之外的代码，
 * `--loose` 也不放宽字符串里的空白。
 *
 * 指令性注释的绑定：它管哪一行、哪个表达式取决于位置（`@ts-ignore`、`eslint-disable-next-line`
 * 管下一行，`eslint-disable-line` 管所在行，`#__PURE__` 管后面的调用），所以每条指令连同它挨着的东西
 * 一起比：语法位置（TS 是它后面第一个语法节点的序号，Swift 是它前面有多少个非空白代码字符）、
 * 同一行里它前后的代码、它下一行的代码。代码一律去掉注释、压缩空白；下一行整行只有注释记作
 * 「«注释»」，与空行不同。判定宁滥勿缺：`///`、`/**` 写法都认，`@ts-*` 与 `__PURE__` 在注释里任何位置都算。
 * 代价：紧挨着指令的那行代码被重新排版、指令与目标行之间加了普通注释或空行，也报「指令性注释有改动」。
 *
 * 已知局限：Swift 的正则字面量里若含 `//`（如 `#/a//b/#`），后半段会被当成行注释；
 * 不在 TS_DIRECTIVES、SWIFT_DIRECTIVES 里的注释一律按普通注释处理。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TS_EXTENSIONS = new Map([
  [".ts", "TS"], [".mts", "TS"], [".cts", "TS"], [".tsx", "TSX"],
  [".js", "JS"], [".mjs", "JS"], [".cjs", "JS"], [".jsx", "JSX"],
]);
const SWIFT_EXTENSION = ".swift";

// ───────────────────────── 指令性注释的绑定（TS 与 Swift 共用）─────────────────────────

/**
 * 给每条指令性注释记下它挨着什么，返回逐条的描述串，compareContents 按串比较：
 *   位置    语法结构里的位置，由 atOf 按语言给
 *   同行前  同一行里它前面的代码，空串表示它独占行首
 *   同行后  同一行里它后面的代码
 *   下一行  它下一行的代码；整行只有注释记作「«注释»」，空行记作空串，没有下一行记作「无」
 * 代码一律去掉注释、压缩空白。
 * @param {string} source 源码原文
 * @param {{ start: number, end: number, text: string }[]} comments 全部注释，按位置排序、互不重叠
 * @param {(comment: object) => boolean} wanted 这条是不是指令
 * @param {(comment: object) => number} atOf 这条指令的语法位置
 */
function bindDirectives(source, comments, wanted, atOf) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const lineEnd = (line) => (line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : source.length);
  const squash = (text) => text.replace(/\s+/g, " ").trim();
  /** [from, to) 里去掉注释后的代码 */
  const codeIn = (from, to) => {
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
      const [from, to] = [lineStarts[last + 1], lineEnd(last + 1)];
      const code = codeIn(from, to);
      next = `「${code || (source.slice(from, to).trim() ? "«注释»" : "")}」`;
    }
    return `${squash(comment.text)}  ‹位置 ${atOf(comment)}，同行前「${codeIn(lineStarts[first], comment.start)}」，同行后「${codeIn(comment.end, lineEnd(last))}」，下一行${next}›`;
  });
}

// ───────────────────────── TS / JS ─────────────────────────

// 对整条注释（原文，不压缩空白）匹配。`[\s/*]*` 吃掉开头的 `/`、`*` 和空白，所以 `//`、`///`、块注释
// 的 `/*` 与 `/**` 开头一视同仁（TS 自己也认 `/// @ts-ignore`）；带 m 标志的按每一行的开头匹配，
// 因为编译指示可以出现在块注释的任意一行。
const TS_DIRECTIVES = [
  /^[\s/*]*<(?:reference|amd-module|amd-dependency)\b/,
  /@ts-(?:ignore|expect-error|nocheck|check)\b/,
  /^[\s/*]*(?:eslint|global|globals|exported|jshint|jscs)\b/,
  /^[\s/*]*@(?:jsx\w*|flow|vitest-environment|jest-environment|refresh|vite-ignore)\b/m,
  /^[\s/*]*(?:prettier-ignore|biome-ignore|istanbul ignore|c8 ignore|v8 ignore)/,
  /[@#]__(?:PURE|NO_SIDE_EFFECTS)__/,
  /^\/\*[\s*]*(?:webpack|turbopack|vite)[\w-]*\s*:/,
  /^\/\/[#@]\s*source(?:Mapping)?URL\s*=/,
  /^\/\*!/,
  /@(?:license|preserve)\b/,
];
/** 只在 JS 文件里算：JSDoc 里的类型标注会被 checkJs 读到。 */
const JS_JSDOC_TYPES = /@(type|typedef|param|returns?|template|satisfies|import|callback|this|enum|extends|augments|implements|overload)\b[^*]*\{/;

function isTsDirective(comment, kind) {
  if (TS_DIRECTIVES.some((re) => re.test(comment))) return true;
  return (kind === "JS" || kind === "JSX") && JS_JSDOC_TYPES.test(comment);
}

function allTokens(ts, sf) {
  const tokens = [];
  const walk = (node) => {
    const children = node.getChildren(sf);
    if (children.length === 0) tokens.push(node);
    else children.forEach(walk);
  };
  walk(sf);
  return tokens;
}

/** 收集文件里所有注释（按位置去重、排序）：{ start, end, text }，[start, end) 是它在源码里的范围。 */
function collectTsComments(ts, sf) {
  const seen = new Map();
  const text = sf.text;
  const add = (ranges) => {
    for (const range of ranges ?? []) seen.set(range.pos, { start: range.pos, end: range.end, text: text.slice(range.pos, range.end) });
  };
  for (const token of allTokens(ts, sf)) {
    add(ts.getLeadingCommentRanges(text, token.getFullStart()));
    add(ts.getTrailingCommentRanges(text, token.getEnd()));
  }
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

/** JSX 语义上等同于没有的子节点：只含换行的空白文本、只含注释（或空）的花括号表达式。 */
function isDroppedJsx(ts, node) {
  if (ts.isJsxText(node)) return node.containsOnlyTriviaWhiteSpaces && node.text.includes("\n");
  return ts.isJsxExpression(node) && !node.expression && !node.dotDotDotToken;
}

/**
 * 按前序排列的语法节点起点，指令性注释拿它算「后面第一个节点的序号」。JSX 里 isDroppedJsx 认定的节点
 * 不数：它们会被 printer 丢掉，别处加一条 JSX 注释不该让后面每条指令的序号都后移。
 */
function nodeStarts(ts, sf) {
  const starts = [];
  const visit = (node) => {
    if (isDroppedJsx(ts, node)) return;
    starts.push(node.getStart(sf));
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return starts;
}

function jsxTransformer(ts) {
  return (context) => (root) => {
    const f = context.factory;
    const clean = (children) => children.filter((child) => !isDroppedJsx(ts, child));
    const visit = (node) => {
      if (ts.isJsxElement(node)) {
        return f.updateJsxElement(
          node,
          ts.visitNode(node.openingElement, visit),
          clean(node.children).map((child) => ts.visitNode(child, visit)),
          ts.visitNode(node.closingElement, visit),
        );
      }
      if (ts.isJsxFragment(node)) {
        return f.updateJsxFragment(
          node,
          ts.visitNode(node.openingFragment, visit),
          clean(node.children).map((child) => ts.visitNode(child, visit)),
          ts.visitNode(node.closingFragment, visit),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  };
}

export function normalizeTs(ts, text, fileName, kind) {
  const scriptKind = { TS: ts.ScriptKind.TS, TSX: ts.ScriptKind.TSX, JS: ts.ScriptKind.JS, JSX: ts.ScriptKind.JSX }[kind];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const errors = (sf.parseDiagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const transformed = ts.transform(sf, [jsxTransformer(ts)]);
  let printed;
  try {
    printed = printer.printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
  const comments = collectTsComments(ts, sf);
  let starts;
  const directives = bindDirectives(text, comments, (comment) => isTsDirective(comment.text, kind), (comment) => {
    starts ??= nodeStarts(ts, sf);
    const index = starts.findIndex((start) => start >= comment.end);
    return index < 0 ? starts.length : index;
  });
  const shebang = /^#!.*/.exec(text)?.[0];
  if (shebang) directives.unshift(shebang);
  // printer 不保证保留 shebang：单独当指令比，正文里也去掉，免得两边处理不一致
  const body = shebang ? printed.replace(/^#!.*\n?/, "") : printed;
  return { code: body, directives, errors };
}

// ───────────────────────── Swift ─────────────────────────

/**
 * 去掉 Swift 的行注释和块注释（块注释可嵌套），字符串里的双斜杠不动。
 * 认得 "…"、"""…"""、#"…"#（任意个 #）与字符串插值 \( … )（里面可以再有字符串和括号）。
 *
 * 返回：
 *   code      去掉注释后的全部文本（块注释换成一个空格，行注释只剩换行）
 *   comments  每条注释的原文
 *   spans     与 comments 一一对应：{ start, end } 是它在源码里的范围，at 是它在 code 里的位置
 *   segments  code 切成的片段，kind 为 "string" 的是最外层的整个字符串（含定界符、# 与插值），
 *             其余是 "code"；串起来就是 code
 */
export function stripSwift(text) {
  let i = 0;
  let out = "";
  const comments = [];
  const spans = [];
  const strings = [];
  let stringDepth = 0;
  const n = text.length;

  const comment = (start) => {
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

  // i 停在开头的引号上（# 已由调用方吃掉），hashes 是原始字符串的 # 个数，from 是字符串在 out 里的起点（含 #）
  const string = (hashes, from) => {
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
      if (!multi && text[i] === "\n") break; // 没闭合的单行字符串，到行尾为止
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

  const code = (untilParen) => {
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

  const segments = [];
  let at = 0;
  for (const [from, to] of strings) {
    if (from > at) segments.push({ kind: "code", text: out.slice(at, from) });
    segments.push({ kind: "string", text: out.slice(from, to) });
    at = to;
  }
  if (at < out.length) segments.push({ kind: "code", text: out.slice(at) });
  return { code: out, comments, spans, segments };
}

// 宁滥勿缺：不要求指令在注释开头，`///` 与块注释里的写法也认。
const SWIFT_DIRECTIVES = /\b(?:swiftlint|swiftformat|sourcery|periphery)\s*:|\bswift-format-ignore\b/;
/** 字符串片段在压缩空白时的占位；源码里字符串之外不会有 NUL */
const STRING_SLOT = "\u0000";

export function normalizeSwift(text, { loose = false } = {}) {
  const { code, comments, spans, segments } = stripSwift(text);
  const strings = [];
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

  // 指令的语法位置：它前面有多少个非空白字符（字符串按原文数；两边字符串不同时先报「除注释外有改动」）
  const significant = [0];
  for (let k = 0; k < code.length; k++) significant.push(significant[k] + (/\s/.test(code[k]) ? 0 : 1));
  const ranges = comments.map((body, k) => ({ text: body, ...spans[k] }));
  const directives = bindDirectives(text, ranges, (range) => SWIFT_DIRECTIVES.test(range.text), (range) => significant[range.at]);
  const shebang = /^#!.*/.exec(text)?.[0];
  if (shebang) directives.unshift(shebang);
  return { code: shown, key: JSON.stringify([flat, strings]), directives, errors: [] };
}

// ───────────────────────── 比较 ─────────────────────────

/** 比较一个文件的前后内容，返回 { status, detail? }。 */
export function compareContents({ ts, file, before, after, loose = false }) {
  if (before === null) return { status: "new" };
  if (after === null) return { status: "deleted" };
  if (before === after) return { status: "unchanged" };
  const ext = path.extname(file).toLowerCase();
  let a;
  let b;
  if (TS_EXTENSIONS.has(ext)) {
    const kind = TS_EXTENSIONS.get(ext);
    a = normalizeTs(ts, before, file, kind);
    b = normalizeTs(ts, after, file, kind);
  } else if (ext === SWIFT_EXTENSION) {
    a = normalizeSwift(before, { loose });
    b = normalizeSwift(after, { loose });
  } else {
    return { status: "unsupported" };
  }
  if (b.errors.length > a.errors.length) return { status: "parse-error", detail: b.errors.slice(0, 3).join("\n") };
  // key 是比较用的严格形式；code 只用来给人看差异（没有 key 的语言两者相同）
  if ((a.key ?? a.code) !== (b.key ?? b.code)) return { status: "code", before: a.code, after: b.code };
  if (JSON.stringify(a.directives) !== JSON.stringify(b.directives)) {
    return { status: "directive", before: a.directives, after: b.directives };
  }
  return { status: "comment-only" };
}

function unifiedDiff(before, after, context) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "comment-only-"));
  try {
    writeFileSync(path.join(dir, "base"), `${before}\n`);
    writeFileSync(path.join(dir, "work"), `${after}\n`);
    const result = spawnSync("diff", ["-u", "-L", "去注释后·基准", "-L", "去注释后·当前", path.join(dir, "base"), path.join(dir, "work")], { encoding: "utf8" });
    const lines = (result.stdout ?? "").split("\n").filter(Boolean);
    if (lines.length === 0) return "（差异工具没有输出）";
    const shown = lines.slice(0, context);
    return shown.join("\n") + (lines.length > shown.length ? `\n… 还有 ${lines.length - shown.length} 行` : "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────── git 与命令行 ─────────────────────────

function git(repo, args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")} 失败：${result.stderr.trim()}`);
  }
  return result.stdout;
}

function loadTypeScript(repo) {
  const candidates = [repo, path.dirname(fileURLToPath(import.meta.url)), process.env.COMMENT_ONLY_REPO, process.cwd()].filter(Boolean);
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, "package.json"))("typescript");
    } catch {
      // 换下一个位置找
    }
  }
  throw new Error(`在 ${candidates.join("、")} 的 node_modules 里找不到 typescript：先在仓库里 pnpm install，或用 --repo / COMMENT_ONLY_REPO 指到装了它的仓库`);
}

export function readVersions({ repo, base, to, file }) {
  const rel = path.isAbsolute(file) ? path.relative(repo, file) : file;
  const before = git(repo, ["show", `${base}:${rel}`], { allowFail: true });
  let after;
  if (to) {
    after = git(repo, ["show", `${to}:${rel}`], { allowFail: true });
  } else {
    const abs = path.join(repo, rel);
    after = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }
  return { rel, before, after };
}

export function checkFiles({ repo, base = "HEAD", to = null, files, loose = false, ts }) {
  return files.map((file) => {
    const { rel, before, after } = readVersions({ repo, base, to, file });
    return { file: rel, ...compareContents({ ts, file: rel, before, after, loose }) };
  });
}

function parseArgs(argv) {
  const opts = { base: "HEAD", to: null, repo: null, loose: false, context: 30, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--to") opts.to = argv[++i];
    else if (arg === "--repo") opts.repo = argv[++i];
    else if (arg === "--context") opts.context = Number(argv[++i]);
    else if (arg === "--loose") opts.loose = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw new Error(`不认识的选项 ${arg}`);
    else opts.files.push(arg);
  }
  return opts;
}

const LABELS = {
  "comment-only": "仅注释",
  unchanged: "没变化",
  code: "除注释外有改动",
  directive: "指令性注释有改动",
  "parse-error": "解析失败",
  new: "新增文件",
  deleted: "已删除",
  unsupported: "不支持的类型",
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    // 文件头的块注释就是帮助文本
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const start = source.indexOf("/**") + 3;
    console.log(source.slice(start, source.indexOf("*/", start)).replace(/^ \* ?/gm, "").trim());
    return;
  }
  const repo = path.resolve(opts.repo ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim());
  const ts = loadTypeScript(repo);
  let files = opts.files;
  if (files.length === 0) {
    const changed = git(repo, ["diff", "--name-only", ...(opts.to ? [opts.base, opts.to] : [opts.base])]).split("\n").filter(Boolean);
    files = changed.filter((file) => TS_EXTENSIONS.has(path.extname(file).toLowerCase()) || path.extname(file).toLowerCase() === SWIFT_EXTENSION);
    if (files.length === 0) {
      console.log("没有可比较的 ts/tsx/mts/mjs/js/swift 改动");
      return;
    }
  }
  const results = checkFiles({ repo, base: opts.base, to: opts.to, files, loose: opts.loose, ts });
  const counts = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    if (result.status === "unchanged") continue;
    console.log(`${LABELS[result.status].padEnd(10, "　")} ${result.file}`);
    if (result.status === "code" && opts.context > 0) console.log(`${unifiedDiff(result.before, result.after, opts.context).replace(/^/gm, "    ")}`);
    if (result.status === "directive") {
      const list = (entries) => (entries.length ? entries.map((entry) => `      ${entry}`).join("\n") : "      （没有）");
      console.log(`    基准：\n${list(result.before)}\n    当前：\n${list(result.after)}`);
    }
    if (result.status === "parse-error") console.log(`    ${result.detail.replace(/\n/g, "\n    ")}`);
  }
  const bad = results.filter((r) => !["comment-only", "unchanged"].includes(r.status));
  console.log(`\n共 ${results.length} 个文件：仅注释 ${counts["comment-only"] ?? 0}，没变化 ${counts.unchanged ?? 0}，需要看 ${bad.length}`);
  if (bad.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
