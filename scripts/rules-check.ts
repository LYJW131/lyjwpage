#!/usr/bin/env node
// 仓库级机械规则检查（AGENTS.md「规则 → 由什么强制」表里的 `pnpm rules:check`）：
//
//   todo-ticket    注释里的待办标记必须带跟踪单号（`#123` 或链接），AGENTS.md「文档与注释」
//   img-baked-url  不烧 `/img/` 交付域：R2 图片一律同源相对路径（shared/asset-url.ts#publicAssetPath），
//                  需要绝对地址的场合（OG、RSS）读环境变量
//   site-fetch-host 站点 src/ 里的网络调用不写字面量主机：后端调用走 backendUrl / workerUrl
//                  （PUBLIC_BACKEND_URL），浏览器必须直连的第三方主机在 ALLOWED_FETCH_HOSTS 登记
//   scrollbar-pair 隐藏滚动条两句缺一不可：scrollbar-none 管 Firefox，
//                  [&::-webkit-scrollbar]:hidden 管 Chromium（DESIGN.md「滚动区」）
//   manual-sleep   scripts/、shared/、workers/<x>/src/ 里等一段时间一律用
//                  import { setTimeout as sleep } from "node:timers/promises"，不手写
//                  new Promise 包 setTimeout；字符串里交给浏览器执行的代码不算
//   json-response-literal
//                  Worker 与 shared/ 的 JSON 响应统一走 shared/http-origins.ts#jsonResponse，
//                  不再手写 new Response(JSON.stringify(...))
//   jsdoc-internal JS / TS 源码不写 JSDoc 块注释（以 /** 开头）：仓库没有对外发布的库接口，文件头与说明用 //，
//                  AGENTS.md「文档与注释」
//   sha256-hex     src/、shared/、workers/<x>/src/ 的 SHA-256 十六进制一律用 shared/sha256.ts#sha256Hex，
//                  不再逐字复制 toString(16).padStart(2, "0")
//   json-object-guard
//                  同一范围里「是不是普通对象」只用 shared/json.ts#object 判断：一两句、只做
//                  typeof 与 Array.isArray 检查的单参数函数要改成调它（失败时抛错或回默认值包在外面）
//   inline-script-json
//                  内联脚本里的 JSON 只经 src/lib/inline-script.ts#scriptJson 转义小于号，不再各写一份 replace(/</g, …)
//   scripts-mjs    scripts/ 新写的脚本用 .ts（Node 直接跑，进 typecheck）；现存 .mjs 记在
//                  scripts/mjs-baseline.json，迁走一个就从基线删一个，基线只减不增（scripts/baseline-growth-check.ts）
//
// 退出码：有违例为 1。测试见 scripts/rules-check.test.ts。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type * as TS from "typescript";

export type Issue = { file: string; line: number; rule: string; message: string };
type Comment = { line: number; start: number; end: number; text: string };

const CODE_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "py", "sh",
  "yml", "yaml", "toml", "css", "html", "xml", "plist", "xcconfig", "json", "jsonc",
]);
const HASH_COMMENT_EXTS = new Set(["py", "sh", "yml", "yaml", "toml"]);
const SLASH_COMMENT_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "css"]);

export const ALLOWED_FETCH_HOSTS = new Set(["api.music.apple.com"]);

const TICKET_RE = /#\d+|https?:\/\/\S+/;
const TODO_RE = /\b(?:TODO|FIXME)\b/;
const BAKED_IMG_RE = /https?:\/\/[^\s"')`]+\/img\//;
const FETCH_CALLS = new Set(["fetch", "sendBeacon", "EventSource", "WebSocket"]);
const ABSOLUTE_URL_RE = /^\s*(?:https?|wss?):\/\/([a-zA-Z0-9.-]+)/;

const extOf = (file: string) => path.posix.extname(file).slice(1).toLowerCase();


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

export function checkTodo(file: string, text: string) {
  const issues: Issue[] = [];
  for (const comment of commentTexts(file, text)) {
    const match = TODO_RE.exec(comment.text);
    if (!match || TICKET_RE.test(comment.text)) continue;
    const line = comment.line + (comment.text.slice(0, match.index).match(/\n/g) ?? []).length;
    issues.push({ file, line, rule: "todo-ticket", message: `待办标记要挂跟踪单号：写成 TODO(#123) 或带上链接；现在就去做的就别留标记（AGENTS.md「文档与注释」）。` });
  }
  return issues;
}

export function checkBakedImgUrl(file: string, text: string) {
  const issues: Issue[] = [];
  text.split("\n").forEach((line, index) => {
    if (BAKED_IMG_RE.test(line)) {
      issues.push({ file, line: index + 1, rule: "img-baked-url", message: "R2 图片一律同源 /img/<objectKey>（shared/asset-url.ts#publicAssetPath），不烧交付域；要绝对地址的场合读环境变量。" });
    }
  });
  return issues;
}

export function checkFetchHost(file: string, text: string) {
  const ext = extOf(file);
  if (!TS_PARSE_EXTS.has(ext)) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, JSX_EXTS.has(ext) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const issues: Issue[] = [];
  const literalText = (arg: TS.Expression) => {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    if (ts.isTemplateExpression(arg)) return arg.head.text;
    return null;
  };
  const visit = (node: TS.Node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name && FETCH_CALLS.has(name)) {
        const raw = literalText(node.arguments[0]);
        const match = raw && ABSOLUTE_URL_RE.exec(raw);
        if (match && !ALLOWED_FETCH_HOSTS.has(match[1])) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          issues.push({ file, line: line + 1, rule: "site-fetch-host", message: `站点不字面量请求主机 ${match[1]}：后端调用走 backendUrl / workerUrl(PUBLIC_BACKEND_URL)，经 Service Binding 分流（跨域 fetch 会改写 CF-Connecting-IP，限流失效）；第三方 API 进后端 Worker，浏览器必须直连的登记进 rules-check 的 ALLOWED_FETCH_HOSTS（AGENTS.md「禁区」）。` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

const TS_PARSE_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const JSX_EXTS = new Set(["tsx", "jsx"]);
const MERGE_CALLS = new Set(["cn", "clsx", "classNames", "twMerge"]);
const TS_PACKAGE = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
let tsModule: typeof TS | undefined;
const loadTs = (): typeof TS => (tsModule ??= TS_PACKAGE("typescript") as typeof TS);

// 同一串类名才谈得上配对：JSX 的 className 属性是一个单元（其中 cn()/clsx() 的参数一起算），
// 没有 className 包裹时以最外层的类名合并调用为单元，都不是就按单个字符串字面量判断。
export function checkScrollbarPair(file: string, text: string) {
  const ext = extOf(file);
  if (!TS_PARSE_EXTS.has(ext)) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, JSX_EXTS.has(ext) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isClassNameAttr = (node: TS.Node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "className";
  const isMergeCall = (node: TS.Node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && MERGE_CALLS.has(node.expression.text);
  const unitOf = (node: TS.Node) => {
    let outerCall: TS.Node | null = null;
    for (let n = node.parent; n; n = n.parent) {
      if (isClassNameAttr(n)) return n;
      if (isMergeCall(n)) outerCall = n;
    }
    return outerCall ?? node;
  };
  const units = new Map<TS.Node, { line: number; parts: string[] }>();
  const addPiece = (node: TS.Node, raw: string) => {
    const unit = unitOf(node);
    let entry = units.get(unit);
    if (!entry) {
      const { line } = sf.getLineAndCharacterOfPosition(unit.getStart(sf));
      entry = { line: line + 1, parts: [] };
      units.set(unit, entry);
    }
    entry.parts.push(raw);
  };
  const visit = (node: TS.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addPiece(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      addPiece(node.head, node.head.text);
      for (const span of node.templateSpans) addPiece(span.literal, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const issues: Issue[] = [];
  for (const { line, parts } of units.values()) {
    // 只认 Tailwind 写法：scrollbar-none 类与 [&::-webkit-scrollbar]:hidden 成对；
    // 原生 CSS（html-preview 里注入 iframe 的 ::-webkit-scrollbar{display:none}）不算。
    const joined = parts.join(" ");
    const ff = joined.includes("scrollbar-none");
    const webkit = joined.includes("::-webkit-scrollbar]:hidden");
    if (ff !== webkit) {
      issues.push({ file, line, rule: "scrollbar-pair", message: "隐藏滚动条两句缺一不可：scrollbar-none 管 Firefox，[&::-webkit-scrollbar]:hidden 管 Chromium，写在同一个 className 表达式里（DESIGN.md「滚动区」）。" });
    }
  }
  return issues.sort((a, b) => a.line - b.line);
}

const NODE_SLEEP_SOURCE = /^(?:scripts|shared)\/|^workers\/[^/]+\/src\//;

export function checkManualSleep(file: string, text: string) {
  if (!NODE_SLEEP_SOURCE.test(file)) return [];
  const ext = extOf(file);
  if (!TS_PARSE_EXTS.has(ext)) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, JSX_EXTS.has(ext) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isSetTimeoutCallee = (expr: TS.Expression) =>
    (ts.isIdentifier(expr) && expr.text === "setTimeout")
    || (ts.isPropertyAccessExpression(expr) && expr.name.text === "setTimeout");
  const callsBare = (expr: TS.Node, name: string) => ts.isCallExpression(expr) && expr.arguments.length === 0 && ts.isIdentifier(expr.expression) && expr.expression.text === name;
  const resolvesBare = (arg: TS.Expression, name: string) => {
    if (ts.isIdentifier(arg)) return arg.text === name;
    if (!(ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) || arg.parameters.length > 0) return false;
    if (!ts.isBlock(arg.body)) return callsBare(arg.body, name);
    const [only] = arg.body.statements;
    return arg.body.statements.length === 1 && ts.isExpressionStatement(only) && callsBare(only.expression, name);
  };
  const issues: Issue[] = [];
  const visit = (node: TS.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Promise") {
      const executor = node.arguments?.[0];
      const param = executor && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor)) ? executor.parameters[0] : undefined;
      const resolved = param && ts.isIdentifier(param.name) ? param.name.text : null;
      let hit = false;
      if (resolved && executor && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) {
        const scan = (n: TS.Node) => {
          if (hit) return;
          if (ts.isCallExpression(n) && isSetTimeoutCallee(n.expression) && n.arguments.length > 0 && resolvesBare(n.arguments[0], resolved)) hit = true;
          else ts.forEachChild(n, scan);
        };
        scan(executor.body);
      }
      if (hit) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        issues.push({ file, line: line + 1, rule: "manual-sleep", message: '等一段时间用 import { setTimeout as sleep } from "node:timers/promises"，不手写 new Promise 包 setTimeout。' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

const SITE_SOURCE = /^src\//;
const WORKER_OR_SHARED_TS = /^(?:workers\/[^/]+\/src|shared)\/.+\.ts$/;
const TEST_OR_FIXTURE = /\.test\.|(^|\/)(?:__tests__|tests?|fixtures|dev-fixtures)\//i;
const JSON_RESPONSE_IMPL = new Set(["shared/http-origins.ts"]);

export function checkJsonResponseLiteral(file: string, text: string) {
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const issues: Issue[] = [];
  const isJsonStringify = (node: TS.Node) => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON"
    && node.expression.name.text === "stringify";
  const visit = (node: TS.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Response" && node.arguments?.[0] && isJsonStringify(node.arguments[0])) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      issues.push({ file, line: line + 1, rule: "json-response-literal", message: "JSON 响应统一走 shared/http-origins.ts#jsonResponse（Content-Type 与 Cache-Control 一处定义），不手写 new Response(JSON.stringify(...))。" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

// 注释范围取自 TypeScript 词法：正则字面量、模板插值、JSX 文本里的 /** 都按语法分清。
export function checkJsdoc(file: string, text: string) {
  const ext = extOf(file);
  if (!TS_PARSE_EXTS.has(ext)) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, JSX_EXTS.has(ext) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const seen = new Set<number>();
  const ranges: TS.CommentRange[] = [];
  const jsxText: Array<[number, number]> = [];
  const add = (found: TS.CommentRange[] | undefined) => {
    for (const range of found ?? []) if (!seen.has(range.pos)) { seen.add(range.pos); ranges.push(range); }
  };
  const walk = (node: TS.Node) => {
    if (ts.isJsxText(node)) { jsxText.push([node.pos, node.end]); return; }
    // JSDoc 会作为子节点挂在声明（以及文件末尾的 EndOfFileToken）下面，不跳过就会把注释内部当词元走，漏掉它本身。
    const children = node.getChildren(sf).filter((child) => child.kind < ts.SyntaxKind.FirstJSDocNode || child.kind > ts.SyntaxKind.LastJSDocNode);
    if (children.length > 0) { children.forEach(walk); return; }
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
  };
  walk(sf);
  const issues: Issue[] = [];
  for (const range of ranges) {
    // 开标签的尾随注释扫描会把紧跟的 JSX 文本当注释读，落在 JSX 文本里的不算。
    if (jsxText.some(([from, to]) => range.pos >= from && range.pos < to)) continue;
    const body = text.slice(range.pos, range.end);
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia || !body.startsWith("/**") || body === "/**/") continue;
    const { line } = sf.getLineAndCharacterOfPosition(range.pos);
    issues.push({ file, line: line + 1, rule: "jsdoc-internal", message: "仓库里没有对外发布的库接口，不写 JSDoc 块注释（/** 开头）：文件头和必要的说明用 // 行注释，能删的删掉（AGENTS.md「文档与注释」）。" });
  }
  return issues.sort((a, b) => a.line - b.line);
}

const HELPER_SCOPE = /^(?:src|shared|workers\/[^/]+\/src)\/.+\.(?:ts|tsx|mts)$/;
const SHA256_HEX_IMPL = "shared/sha256.ts";
const JSON_OBJECT_IMPL = "shared/json.ts";
const INLINE_SCRIPT_JSON_IMPL = "src/lib/inline-script.ts";
const LT_ESCAPE_RE = /\.replace\(\/<\/g,\s*["'`]\\\\u003c/;
const HEX_BYTE_RE = /toString\(16\)\.padStart\(2,\s*["'`]0["'`]\)/;

export function checkSha256Hex(file: string, text: string) {
  if (!HELPER_SCOPE.test(file) || file === SHA256_HEX_IMPL) return [];
  return text.split("\n").flatMap((line, index) => HEX_BYTE_RE.test(line)
    ? [{ file, line: index + 1, rule: "sha256-hex", message: "SHA-256 转十六进制用 @shared/sha256#sha256Hex，不再复制一份 toString(16).padStart(2, \"0\")。" }]
    : []);
}

export function checkInlineScriptJson(file: string, text: string) {
  if (!HELPER_SCOPE.test(file) || file === INLINE_SCRIPT_JSON_IMPL) return [];
  return text.split("\n").flatMap((line, index) => LT_ESCAPE_RE.test(line)
    ? [{ file, line: index + 1, rule: "inline-script-json", message: "内联脚本里的 JSON 用 @/lib/inline-script#scriptJson 转义，不再各写一份 replace(/</g, \"\\\\u003c\")。" }]
    : []);
}

export function checkJsonObjectGuard(file: string, text: string) {
  if (!HELPER_SCOPE.test(file) || file === JSON_OBJECT_IMPL) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const issues: Issue[] = [];
  const visit = (node: TS.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && node.parameters.length === 1 && ts.isIdentifier(node.parameters[0].name)) {
      const param = node.parameters[0].name.text;
      const small = !ts.isBlock(node.body) || node.body.statements.length <= 2;
      const body = node.body.getText(sf);
      const typeofObject = new RegExp(`typeof ${param} [!=]== ["']object["']`);
      if (small && typeofObject.test(body) && body.includes(`Array.isArray(${param})`)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        issues.push({ file, line: line + 1, rule: "json-object-guard", message: "判断普通对象用 @shared/json#object（失败返回 null），要抛错或回默认值就包在它外面，不再各写一份 typeof / Array.isArray。" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

export function checkFile(file: string, text: string): Issue[] {
  if (!CODE_EXTS.has(extOf(file)) || TEST_OR_FIXTURE.test(file)) return [];
  const issues = [...checkTodo(file, text), ...checkBakedImgUrl(file, text), ...checkManualSleep(file, text), ...checkJsdoc(file, text), ...checkSha256Hex(file, text), ...checkJsonObjectGuard(file, text), ...checkInlineScriptJson(file, text)];
  if (SITE_SOURCE.test(file)) issues.push(...checkFetchHost(file, text), ...checkScrollbarPair(file, text));
  if (WORKER_OR_SHARED_TS.test(file) && !JSON_RESPONSE_IMPL.has(file)) issues.push(...checkJsonResponseLiteral(file, text));
  return issues;
}

export const MJS_BASELINE_PATH = "scripts/mjs-baseline.json";
const SCRIPTS_MJS = /^scripts\/.+\.mjs$/;

export function checkScriptsMjs(files: string[], baseline: string[]): Issue[] {
  const listed = new Set(baseline);
  const present = new Set(files.filter((file) => SCRIPTS_MJS.test(file)));
  const added = [...present].filter((file) => !listed.has(file))
    .map((file) => ({ file, line: 1, rule: "scripts-mjs", message: "scripts/ 新脚本用 .ts（Node 直接跑，import 写 .ts 后缀），不再新增 .mjs。" }));
  const gone = [...listed].filter((file) => !present.has(file))
    .map((file) => ({ file: MJS_BASELINE_PATH, line: 1, rule: "scripts-mjs", message: `${file} 已不存在，从基线删掉。` }));
  return [...added, ...gone];
}

function trackedFiles(root: string) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && existsSync(path.join(root, file)));
}

function trackedSources(root: string) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file, index, all) => {
      if (!file || all.indexOf(file) !== index) return false;
      if (!CODE_EXTS.has(extOf(file))) return false;
      if (TEST_OR_FIXTURE.test(file)) return false;
      return existsSync(path.join(root, file));
    });
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const issues: Issue[] = [];
  const files = trackedSources(root);
  for (const file of files) issues.push(...checkFile(file, readFileSync(path.join(root, file), "utf8")));
  const baseline = JSON.parse(readFileSync(path.join(root, MJS_BASELINE_PATH), "utf8")) as string[];
  issues.push(...checkScriptsMjs(trackedFiles(root), baseline));
  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  if (issues.length === 0) {
    console.log(`rules:check 通过（${files.length} 个文件）`);
    return;
  }
  for (const issue of issues) console.error(`${issue.file}:${issue.line}  [${issue.rule}] ${issue.message}`);
  console.error(`\nrules:check 发现 ${issues.length} 个问题。`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
