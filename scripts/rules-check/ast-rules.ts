import type * as TS from "typescript";

import { extOf, HELPER_SCOPE, JSX_EXTS, loadTs, TS_PARSE_EXTS, type Issue } from "./source.ts";

export const ALLOWED_FETCH_HOSTS = new Set(["api.music.apple.com"]);

const FETCH_CALLS = new Set(["fetch", "sendBeacon", "EventSource", "WebSocket", "Request"]);
const NETWORK_SCHEMES = new Set(["http", "https", "ws", "wss"]);
const MERGE_CALLS = new Set(["cn", "clsx", "classNames", "twMerge"]);
const JSON_OBJECT_IMPL = "shared/json.ts";

// 按 WHATWG URL 取真实 host，不手写前缀正则：scheme 大小写、userinfo、`//` 与 `\\` 分隔都交给 URL 解析。
// 能认出是绝对地址却证明不了 host 在允许列表里（含 userinfo、host 被模板或拼接截断、解析失败）一律不放行。
const absoluteTarget = (raw: string, complete: boolean): { label: string; allowed: boolean } | null => {
  let lead = 0;
  while (lead < raw.length && raw.charCodeAt(lead) <= 0x20) lead++;
  const text = raw.slice(lead).replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  const protocolRelative = text.startsWith("//");
  if (!protocolRelative && !(scheme !== undefined && (NETWORK_SCHEMES.has(scheme) || text.slice(scheme.length + 1).startsWith("//")))) return null;
  const unproven = { label: text.slice(0, 60), allowed: false };
  if (!complete && !/[/?#]/.test(text.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/*/i, ""))) return unproven;
  try {
    const url = protocolRelative ? new URL(text, "https://placeholder.invalid") : new URL(text);
    if (url.username || url.password) return unproven;
    return { label: url.hostname, allowed: ALLOWED_FETCH_HOSTS.has(url.hostname) };
  } catch {
    return unproven;
  }
};

export function checkFetchHost(file: string, text: string) {
  const ext = extOf(file);
  if (!TS_PARSE_EXTS.has(ext)) return [];
  const ts = loadTs();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, JSX_EXTS.has(ext) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const issues: Issue[] = [];
  const literalPrefix = (arg: TS.Expression): { text: string; complete: boolean } | null => {
    if (ts.isParenthesizedExpression(arg)) return literalPrefix(arg.expression);
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return { text: arg.text, complete: true };
    if (ts.isTemplateExpression(arg)) return { text: arg.head.text, complete: false };
    if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literalPrefix(arg.left);
      return left && { text: left.text, complete: false };
    }
    return null;
  };
  const requestTarget = (arg: TS.Expression): { label: string; allowed: boolean } | null => {
    const inner = ts.isParenthesizedExpression(arg) ? arg.expression : arg;
    if (ts.isNewExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "URL" && inner.arguments?.length) {
      const [input, base] = inner.arguments;
      return requestTarget(input) ?? (base ? requestTarget(base) : null);
    }
    const prefix = literalPrefix(inner);
    return prefix && absoluteTarget(prefix.text, prefix.complete);
  };
  const visit = (node: TS.Node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name && FETCH_CALLS.has(name)) {
        const target = requestTarget(node.arguments[0]);
        if (target && !target.allowed) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          issues.push({ file, line: line + 1, rule: "site-fetch-host", message: `站点不字面量请求主机 ${target.label}（证明不了在允许列表内也算）：后端调用走 backendUrl / workerUrl(PUBLIC_BACKEND_URL)，经 Service Binding 分流（跨域 fetch 会改写 CF-Connecting-IP，限流失效）；第三方 API 进后端 Worker，浏览器必须直连的登记进 rules-check 的 ALLOWED_FETCH_HOSTS（AGENTS.md「禁区」）。` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

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
