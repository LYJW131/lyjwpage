#!/usr/bin/env node
/**
 * 界面文案英文（DESIGN.md「Copy」）：数 src/ 里 JSX 文本与字符串字面量中的
 * 中日韩字符，按文件与基线 scripts/ui-copy-baseline.json 比，变多就失败。
 * 注释、import 路径、正则字面量不进 AST 的字符串节点，天然不算。
 * 例外（仅开发可见的调试提示、按约定写中文的展示内容、数据源原文）跑
 * `pnpm ui:copy --update` 记进基线，并在 PR 里说明。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compare, sortedBaseline } from "./design-scale-check.mjs";

export const BASELINE_PATH = "scripts/ui-copy-baseline.json";

// 假名 + CJK 基本/扩展 A + 兼容：覆盖中文与日语
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const TRUNCATE = 36;

const loadTs = (root) => createRequire(path.join(root, "package.json"))("typescript");

export function scanText(ts, file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const add = (node, raw) => {
    if (!CJK_RE.test(raw)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ line: line + 1, text: raw.replace(/\s+/g, " ").trim().slice(0, TRUNCATE) });
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
  const counts = {};
  const hits = {};
  for (const file of files) {
    const fileHits = scanText(ts, file, readFileSync(path.join(root, file), "utf8"));
    if (fileHits.length > 0) {
      counts[file] = fileHits.length;
      hits[file] = fileHits;
    }
  }
  const baselineFile = path.join(root, BASELINE_PATH);

  if (update) {
    writeFileSync(baselineFile, `${JSON.stringify(sortedBaseline(counts), null, 2)}\n`);
    console.log(`已按现状重写 ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { grew, shrank } = compare(baseline, counts);
  for (const { token, before, after } of grew) {
    console.error(`✗ ${token}：${before} → ${after}`);
    for (const hit of hits[token]) console.error(`    ${token}:${hit.line}  “${hit.text}”`);
  }
  if (grew.length > 0) {
    console.error("\n界面文案一律英文（DESIGN.md「Copy」）。确属例外——仅开发环境可见的调试提示、按约定写中文的展示内容、数据源原文——跑 `pnpm ui:copy --update` 记进基线，并在 PR 里说明。");
    process.exit(1);
  }
  if (shrank.length > 0) {
    console.log(`存量变少：${shrank.map(({ token, before, after }) => `${token} ${before} → ${after}`).join("，")}。跑 \`pnpm ui:copy --update\` 收紧基线。`);
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`ui:copy 通过（存量 ${total} 处非英文文案，未增加）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
