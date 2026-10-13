#!/usr/bin/env node
/**
 * 界面文案英文（DESIGN.md「Copy」）：收集 src/ 里 JSX 文本与字符串字面量中
 * 含中日韩字符的命中，按「文件 → 命中文本清单」与基线
 * scripts/ui-copy-baseline.json 逐条比，出现基线外的文本（或同文本
 * 出现次数变多）就失败——同文件删一条加一条不能互相抵消。
 * 注释、import 路径、正则字面量不进 AST 的字符串节点，天然不算。
 * 例外（仅开发可见的调试提示、按约定写中文的展示内容、数据源原文）跑
 * `pnpm ui:copy --update` 记进基线，并在 PR 里说明。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASELINE_PATH = "scripts/ui-copy-baseline.json";

// 假名 + CJK 基本/扩展 A + 兼容 + 谚文音节 / 字母 / 兼容字母：覆盖中日韩
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
// 命中按规范化全文比较与入基线；截断只用于报错展示
const TRUNCATE = 36;
const preview = (text) => (text.length > TRUNCATE ? `${text.slice(0, TRUNCATE)}…` : text);

const loadTs = (root) => createRequire(path.join(root, "package.json"))("typescript");

export function scanText(ts, file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const add = (node, raw) => {
    if (!CJK_RE.test(raw)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ line: line + 1, text: raw.replace(/\s+/g, " ").trim() });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) add(span.literal, span.literal.text);
    } else if (ts.isJsxText(node)) add(node, node.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// hits 形如 { "src/a.tsx": [{ line, text }] }；基线形如 { "src/a.tsx": ["文本", …] }。
export function copyBaseline(hits) {
  return Object.fromEntries(
    Object.keys(hits).sort().map((file) => [file, hits[file].map((hit) => hit.text).sort()]),
  );
}

const multiset = (texts) => {
  const map = new Map();
  for (const text of texts) map.set(text, (map.get(text) ?? 0) + 1);
  return map;
};

export function compareCopy(baseline, hits) {
  const grew = [];
  const shrank = [];
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(hits)])].sort();
  for (const file of files) {
    const before = multiset(baseline[file] ?? []);
    const fileHits = hits[file] ?? [];
    const now = multiset(fileHits.map((hit) => hit.text));
    const extras = [...now.entries()]
      .filter(([text, n]) => n > (before.get(text) ?? 0))
      .map(([text, n]) => ({ text, extra: n - (before.get(text) ?? 0), lines: fileHits.filter((hit) => hit.text === text).map((hit) => hit.line) }));
    if (extras.length > 0) grew.push({ file, extras });
    const missing = [...before.entries()]
      .filter(([text, n]) => n > (now.get(text) ?? 0))
      .map(([text, n]) => ({ text, extra: n - (now.get(text) ?? 0) }));
    if (missing.length > 0) shrank.push({ file, missing });
  }
  return { grew, shrank };
}

function trackedSources(root) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src/*.ts", "src/*.tsx"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file, index, all) => file && all.indexOf(file) === index && existsSync(path.join(root, file)) && !/\.test\.[a-z]+$/.test(file));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const update = process.argv.includes("--update");
  const ts = loadTs(root);
  const files = trackedSources(root);
  const hits = {};
  for (const file of files) {
    const fileHits = scanText(ts, file, readFileSync(path.join(root, file), "utf8"));
    if (fileHits.length > 0) hits[file] = fileHits;
  }
  const baselineFile = path.join(root, BASELINE_PATH);

  if (update) {
    writeFileSync(baselineFile, `${JSON.stringify(copyBaseline(hits), null, 2)}\n`);
    console.log(`已按现状重写 ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { grew, shrank } = compareCopy(baseline, hits);
  for (const { file, extras } of grew) {
    for (const { text, extra, lines } of extras) {
      console.error(`✗ ${file}：新增非英文文案 “${preview(text)}”${extra > 1 ? `（多 ${extra} 处）` : ""}`);
      for (const line of lines) console.error(`    ${file}:${line}`);
    }
  }
  if (grew.length > 0) {
    console.error("\n界面文案一律英文（DESIGN.md「Copy」）。确属例外——仅开发环境可见的调试提示、按约定写中文的展示内容、数据源原文——跑 `pnpm ui:copy --update` 记进基线，并在 PR 里说明。");
    process.exit(1);
  }
  if (shrank.length > 0) {
    const detail = shrank
      .flatMap(({ file, missing }) => missing.map(({ text, extra }) => `${file} 删去 “${preview(text)}”${extra > 1 ? `×${extra}` : ""}`))
      .join("，");
    console.log(`存量变少：${detail}。跑 \`pnpm ui:copy --update\` 收紧基线。`);
  }
  const total = Object.values(hits).reduce((sum, fileHits) => sum + fileHits.length, 0);
  console.log(`ui:copy 通过（存量 ${total} 处非英文文案，未增加）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
