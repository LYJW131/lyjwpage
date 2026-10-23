import type * as TS from "typescript";

import { bindDirectives, type CommentRange, type Normalized } from "./directives.ts";

export type TsKind = "TS" | "TSX" | "JS" | "JSX";

export const TS_EXTENSIONS = new Map<string, TsKind>([
  [".ts", "TS"], [".mts", "TS"], [".cts", "TS"], [".tsx", "TSX"],
  [".js", "JS"], [".mjs", "JS"], [".cjs", "JS"], [".jsx", "JSX"],
]);

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
const JS_JSDOC_TYPES = /@(type|typedef|param|returns?|template|satisfies|import|callback|this|enum|extends|augments|implements|overload)\b[^*]*\{/;

export function isTsDirective(comment: string, kind: TsKind): boolean {
  if (TS_DIRECTIVES.some((re) => re.test(comment))) return true;
  return (kind === "JS" || kind === "JSX") && JS_JSDOC_TYPES.test(comment);
}

function allTokens(sf: TS.SourceFile): TS.Node[] {
  const tokens: TS.Node[] = [];
  const walk = (node: TS.Node) => {
    const children = node.getChildren(sf);
    if (children.length === 0) tokens.push(node);
    else children.forEach(walk);
  };
  walk(sf);
  return tokens;
}

export function collectTsComments(ts: typeof TS, sf: TS.SourceFile): CommentRange[] {
  const seen = new Map<number, CommentRange>();
  const text = sf.text;
  const add = (ranges: TS.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) seen.set(range.pos, { start: range.pos, end: range.end, text: text.slice(range.pos, range.end) });
  };
  for (const token of allTokens(sf)) {
    add(ts.getLeadingCommentRanges(text, token.getFullStart()));
    add(ts.getTrailingCommentRanges(text, token.getEnd()));
  }
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

function isDroppedJsx(ts: typeof TS, node: TS.Node): boolean {
  if (ts.isJsxText(node)) return node.containsOnlyTriviaWhiteSpaces && node.text.includes("\n");
  return ts.isJsxExpression(node) && !node.expression && !node.dotDotDotToken;
}

// JSX 空节点会被 printer 丢弃，不能让它们改变后续指令的语法位置。
function nodeStarts(ts: typeof TS, sf: TS.SourceFile): number[] {
  const starts: number[] = [];
  const visit = (node: TS.Node): void => {
    if (isDroppedJsx(ts, node)) return;
    starts.push(node.getStart(sf));
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return starts;
}

function jsxTransformer(ts: typeof TS): TS.TransformerFactory<TS.SourceFile> {
  return (context) => (root) => {
    const f = context.factory;
    const clean = (children: TS.NodeArray<TS.JsxChild>) => children.filter((child) => !isDroppedJsx(ts, child));
    const visit = (node: TS.Node): TS.Node => {
      if (ts.isJsxElement(node)) {
        return f.updateJsxElement(
          node,
          ts.visitNode(node.openingElement, visit, ts.isJsxOpeningElement),
          clean(node.children).map((child) => ts.visitNode(child, visit, ts.isJsxChild)),
          ts.visitNode(node.closingElement, visit, ts.isJsxClosingElement),
        );
      }
      if (ts.isJsxFragment(node)) {
        return f.updateJsxFragment(
          node,
          ts.visitNode(node.openingFragment, visit, ts.isJsxOpeningFragment),
          clean(node.children).map((child) => ts.visitNode(child, visit, ts.isJsxChild)),
          ts.visitNode(node.closingFragment, visit, ts.isJsxClosingFragment),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit, ts.isSourceFile);
  };
}

export function normalizeTs(ts: typeof TS, text: string, fileName: string, kind: TsKind): Normalized {
  const scriptKind = { TS: ts.ScriptKind.TS, TSX: ts.ScriptKind.TSX, JS: ts.ScriptKind.JS, JSX: ts.ScriptKind.JSX }[kind];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const errors = ((sf as TS.SourceFile & { parseDiagnostics?: TS.Diagnostic[] }).parseDiagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const transformed = ts.transform(sf, [jsxTransformer(ts)]);
  let printed: string;
  try {
    printed = printer.printFile(transformed.transformed[0] ?? sf);
  } finally {
    transformed.dispose();
  }
  const comments = collectTsComments(ts, sf);
  let starts: number[] | undefined;
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
