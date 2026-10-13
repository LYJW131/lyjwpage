import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

import { compare, sortedBaseline } from "./design-scale-check.mjs";
import { scanText } from "./ui-copy-check.mjs";

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

test("基线比较沿用 design:scale 语义：新增算 grew，减少算 shrank", () => {
  const baseline = sortedBaseline({ "src/a.tsx": 2 });
  assert.deepEqual(compare(baseline, { "src/a.tsx": 3 }), { grew: [{ token: "src/a.tsx", before: 2, after: 3 }], shrank: [] });
  assert.deepEqual(compare(baseline, { "src/a.tsx": 1 }), { grew: [], shrank: [{ token: "src/a.tsx", before: 2, after: 1 }] });
});
