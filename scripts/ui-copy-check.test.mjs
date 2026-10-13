import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

import { compareCopy, copyBaseline, scanText } from "./ui-copy-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "package.json"))("typescript");

const scan = (file, text) => scanText(ts, file, text);

test("JSX 文本、字符串属性与按钮文案里的中文被拦", () => {
  const hits = scan("src/components/x.tsx", `export function X() {
  return <button aria-label="关闭面板">确定</button>;
}`);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.line), [2, 2]);
});

test("字符串对象里的中文文案算，注释与代码里的中文不算", () => {
  const hits = scan("src/lib/x.ts", `// 这条注释有中文，不算
const copy = { label: "重试" };
/* 块注释里的「中文」也不算 */
const url = "https://example.com/中文路径参数也不该出现"; // 但它在字符串里，算
`);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].text, "重试");
});

test("模板字符串各段都查；假名也拦", () => {
  const hits = scan("src/lib/x.ts", "const a = `前缀${x}后缀`;\nconst b = `ログインしてください`;\nconst c = `all english ${y}`;");
  assert.equal(hits.length, 3); // a 的头尾两段 + b 一整条无插值模板
});

test("正则字面量与 import 路径不拦", () => {
  const hits = scan("src/lib/x.ts", 'import x from "@/lib/模块";\nconst re = /[一-龥]/;\nconst s = "English only";');
  assert.equal(hits.length, 1); // import specifier 是字符串节点，按现状计入（真实代码不会有）
  assert.equal(hits[0].line, 1);
});

test("tsx 与 ts 分别按 ScriptKind 解析", () => {
  assert.equal(scan("src/lib/x.ts", "const t = <string>v;").length, 0); // ts 里 <string> 是断言不是 JSX
  assert.equal(scan("src/lib/x.tsx", "const t = <div>确定</div>;").length, 1);
});

test("谚文也拦：JSX 文本与字符串属性各一条", () => {
  const hits = scan("src/components/x.tsx", `export function X() {
  return <button aria-label="닫기">확인</button>;
}`);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.text), ["닫기", "확인"]);
});

test("基线按「文件 → 命中文本」逐条比：同文件删一条加一条不能抵消", () => {
  const baseline = copyBaseline({ "src/a.tsx": [{ line: 3, text: "旧文案" }] });
  const swapped = compareCopy(baseline, { "src/a.tsx": [{ line: 7, text: "新文案" }] });
  assert.equal(swapped.grew.length, 1);
  assert.equal(swapped.grew[0].extras[0].text, "新文案");
  assert.equal(swapped.shrank.length, 1);
  assert.equal(swapped.shrank[0].missing[0].text, "旧文案");
});

test("超过 36 字的差异也分得清：比较用全文，截断只做展示", () => {
  const head = "相同前缀".repeat(10); // 40 字，超过截断长度
  const hits = scan("src/lib/x.ts", `const s = "${head}尾巴新";`);
  assert.equal(hits[0].text, `${head}尾巴新`); // 存的是完整规范化文本
  const baseline = copyBaseline({ "src/a.tsx": [{ line: 1, text: `${head}尾巴旧` }] });
  const { grew } = compareCopy(baseline, { "src/a.tsx": [{ line: 2, text: `${head}尾巴新` }] });
  assert.equal(grew.length, 1);
  assert.equal(grew[0].extras[0].text, `${head}尾巴新`);
});

test("同一文本按出现次数计：基线两次、现状三次算新增", () => {
  const baseline = { "src/a.tsx": ["确定", "确定"] };
  const hits = { "src/a.tsx": [{ line: 1, text: "确定" }, { line: 2, text: "确定" }, { line: 9, text: "确定" }] };
  const { grew } = compareCopy(baseline, hits);
  assert.equal(grew.length, 1);
  assert.equal(grew[0].extras[0].extra, 1);
  assert.deepEqual(grew[0].extras[0].lines, [1, 2, 9]);
  assert.equal(compareCopy(baseline, { "src/a.tsx": hits["src/a.tsx"].slice(0, 2) }).grew.length, 0);
});
