import assert from "node:assert/strict";
import { test } from "node:test";

import { checkFetchHost, checkFile, checkScriptsMjs, checkScrollbarPair, checkTodo } from "./rules-check.ts";

const rules = (file: string, text: string) => checkFile(file, text).map((issue) => `${issue.rule}@${issue.line}`);

test("不带单号的 TODO / FIXME 被拦，带 #单号或链接的放行", () => {
  assert.deepEqual(rules("src/lib/x.ts", "// TODO: 以后处理\nconst a = 1; // FIXME 同上"), ["todo-ticket@1", "todo-ticket@2"]);
  assert.equal(checkTodo("src/lib/x.ts", "// TODO(#256) 等上游修复\n// FIXME https://github.com/x/y/issues/1").length, 0);
  assert.equal(checkTodo("src/lib/x.ts", "/* TODO(#1) 块注释也行 */\n/* 等上游 API，见 https://linear.app/x/ISSUE-2 */").length, 0);
});

test("块注释里的 TODO：同行闭合、多行首行、注释后还有代码、一行多个注释", () => {
  assert.deepEqual(checkTodo("src/lib/x.ts", "/* TODO fix */ const a = 1;").map((i) => i.line), [1]);
  assert.deepEqual(checkTodo("src/lib/x.ts", "/* TODO 头行就带标记\n * 说明\n */\nconst a = 1;").map((i) => i.line), [1]);
  assert.deepEqual(checkTodo("src/lib/x.ts", "const a = 1; /* ok */ const b = 2; /* TODO 收尾 */").map((i) => i.line), [1]);
  assert.deepEqual(checkTodo("src/lib/x.ts", "/* TODO(#12) 有单号 */ /* FIXME 没单号 */").map((i) => i.line), [1]);
  assert.equal(checkTodo("src/lib/x.ts", "const a = 1; /* 正常注释 */ const b = 2; // 也正常").length, 0);
  assert.equal(checkTodo("src/lib/x.ts", 'const s = "/* TODO 字符串里的不算 */";').length, 0);
});

test("字符串与 URL 里的斜杠不当注释，// 在引号内不算注释", () => {
  assert.equal(checkTodo("src/lib/x.ts", 'const u = "https://a.b/c"; // 正常注释\nconst s = "字串里的待办词不算"').length, 0);
  // 跨行块注释也认得
  assert.deepEqual(checkTodo("src/lib/x.ts", "/* 说明\n   TODO 要有人跟\n*/\nconst ok = 1;").map((i) => i.line), [2]);
  // shell / yaml 用 # 注释
  assert.deepEqual(checkTodo("scripts/x.sh", '# TODO 修\necho hi # FIXME 也要单号').map((i) => i.line), [1, 2]);
  assert.equal(checkTodo("scripts/x.sh", 'COLOR="#fff"\necho "#123 不是注释"').length, 0);
});

test("烤交付域的 /img/ 绝对地址被拦，同源相对路径放行", () => {
  assert.deepEqual(rules("src/lib/x.ts", 'const u = "https://lyjw.me/img/ab12.webp";'), ["img-baked-url@1"]);
  assert.equal(rules("src/lib/x.ts", 'const u = publicAssetPath(key); // "/img/" + key\nconst v = `${base}/img/${key}`;').length, 0);
  assert.equal(rules("workers/core/dev-fixtures/x.json", '"poster": "/img/ab12.webp"').length, 0);
});

test("src/ 里字面量主机调用被拦，允许列表与 backendUrl 放行", () => {
  assert.deepEqual(rules("src/lib/x.ts", 'await fetch("https://api.lyjw.example/api/status");'), ["site-fetch-host@1"]);
  assert.deepEqual(rules("src/lib/x.ts", 'new WebSocket("wss://backend.example/ws");'), ["site-fetch-host@1"]);
  assert.equal(rules("src/lib/x.ts", 'await fetch(`https://api.music.apple.com${path}`);\nawait fetch(backendUrl("/api/status/x"));').length, 0);
  // src/ 之外的目录不受这条约束（checkFile 按路径分派；checkFetchHost 本身只管字面量）
  assert.equal(rules("workers/core/src/x.ts", 'await fetch("https://example.com/")').length, 0);
  assert.equal(checkFetchHost("workers/core/src/x.ts", 'await fetch("https://example.com/")').length, 1);
});

test("fetch 分行写字面量主机也拦，成员调用与模板串同样查首参", () => {
  assert.deepEqual(rules("src/lib/x.ts", 'await fetch(\n  "https://api.evil.example/x"\n);'), ["site-fetch-host@1"]);
  assert.deepEqual(rules("src/lib/x.ts", 'navigator.sendBeacon(\n  "https://track.example/e"\n);'), ["site-fetch-host@1"]);
  assert.deepEqual(rules("src/lib/x.ts", 'new WebSocket(\n  `wss://backend.example/ws`\n);'), ["site-fetch-host@1"]);
  assert.equal(rules("src/lib/x.ts", 'await fetch(\n  "https://api.music.apple.com/x"\n);\nawait fetch(\n  backendUrl("/api/x")\n);').length, 0);
});

test("隐藏滚动条两句缺一不可", () => {
  assert.deepEqual(rules("src/components/x.tsx", '<div className="overflow-y-auto scrollbar-none" />'), ["scrollbar-pair@1"]);
  assert.deepEqual(rules("src/components/x.tsx", '<div className="overflow-y-auto [&::-webkit-scrollbar]:hidden" />'), ["scrollbar-pair@1"]);
  assert.equal(
    rules("src/components/x.tsx", '<div className="overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden" />\n<div className="overflow-y-auto" />').length,
    0,
  );
  // 注入 iframe 的原生 CSS（::-webkit-scrollbar{display:none}）不是 Tailwind 类，不算
  assert.equal(rules("src/lib/html-preview.ts", 'const css = "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}";').length, 0);
  // Chromium 那句必须是 :hidden，换成 :block 等别的变体不算配对成功
  assert.deepEqual(rules("src/components/x.tsx", '<div className="overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:block" />'), ["scrollbar-pair@1"]);
});

test("滚动条配对按 className 表达式合并判断，不按源码行", () => {
  // cn() 多参数分行写：合起来看，两句齐就不报
  assert.equal(
    rules("src/components/x.tsx", 'const c = cn(\n  "overflow-y-auto scrollbar-none",\n  "[&::-webkit-scrollbar]:hidden",\n);').length,
    0,
  );
  // className={cn(...)} 跨行同理
  assert.equal(
    rules("src/components/x.tsx", '<div className={cn(\n  "scrollbar-none",\n  "[&::-webkit-scrollbar]:hidden",\n)} />').length,
    0,
  );
  // 拆进两个表达式：各自缺一半，两个单元都报
  assert.deepEqual(
    rules("src/components/x.tsx", '<div className={cn("overflow-y-auto scrollbar-none")} />\n<div className="[&::-webkit-scrollbar]:hidden" />'),
    ["scrollbar-pair@1", "scrollbar-pair@2"],
  );
  // cn() 结果存进变量再传给 className：cn 调用本身是一个单元
  assert.deepEqual(
    rules("src/components/x.tsx", 'const cls = cn("overflow-y-auto scrollbar-none");\n<div className={cls} />'),
    ["scrollbar-pair@1"],
  );
  // 模板串里混动态值：同一个 className 表达式里两句齐就行
  assert.equal(
    rules("src/components/x.tsx", '<div className={`overflow-y-auto scrollbar-none ${x} [&::-webkit-scrollbar]:hidden`} />').length,
    0,
  );
});

test("git 历史里的真实旧错误形态会被拦下", () => {
  // 39ab64f7 之前的形态：图片地址带交付域
  assert.deepEqual(rules("src/lib/x.ts", 'return `https://assets.example.com/img/${key}.webp`;'), ["img-baked-url@1"]);
  // 全仓注释清理前（43ef5895 / 24a4d324）的形态：裸待办标记
  assert.deepEqual(rules("src/lib/x.ts", "// TODO: 接新接口"), ["todo-ticket@1"]);
  // uptime-strip 修掉的那类问题不在这条脚本里（design:scale 管 radius），这里不重复报
  assert.equal(checkScrollbarPair("src/components/x.tsx", 'className="rounded-[2px]"').length, 0);
});

test("手写 sleep 被拦：具名封装、内联、改名 resolve、块里暂存 timer、无参回调", () => {
  assert.deepEqual(rules("scripts/x.mjs", 'await new Promise((resolve) => setTimeout(resolve, 100));'), ["manual-sleep@1"]);
  assert.deepEqual(rules("workers/core/src/x.ts", 'const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));'), ["manual-sleep@1"]);
  assert.deepEqual(rules("shared/x.ts", 'await new Promise((r) => setTimeout(r, 5));'), ["manual-sleep@1"]);
  assert.deepEqual(rules("workers/collector/src/x.ts", 'await Promise.race([a, new Promise((resolve) => { t = setTimeout(resolve, 5); })]);'), ["manual-sleep@1"]);
  assert.deepEqual(rules("scripts/x.mjs", 'await new Promise((resolve) => setTimeout(() => resolve(), 100));'), ["manual-sleep@1"]);
  assert.deepEqual(rules("shared/x.ts", 'await new Promise((done) => setTimeout(function () { done(); }, 100));'), ["manual-sleep@1"]);
});

test("manual-sleep 放行：node:timers/promises、带值 resolve、reject 超时、字符串与范围外", () => {
  assert.equal(rules("scripts/x.mjs", 'import { setTimeout as sleep } from "node:timers/promises";\nawait sleep(100);').length, 0);
  // 到时带值或 reject 的是超时 / 竞速，不是 sleep 壳子
  assert.equal(rules("shared/x.ts", 'const p = new Promise((resolve) => { t = setTimeout(() => resolve(x), 5); });').length, 0);
  assert.equal(rules("workers/ai/src/x.ts", 'const p = new Promise((_, reject) => { t = setTimeout(() => reject(e), 5); });').length, 0);
  // page.evaluate 的页面内代码是字符串，不是本文件代码
  assert.equal(rules("scripts/x.mjs", 'const SNIPPET = `await new Promise((resolve) => setTimeout(resolve, 60));`;').length, 0);
  // src/ 跑在浏览器里没有 node:timers/promises，不在范围内
  assert.equal(rules("src/lib/x.ts", 'await new Promise((resolve) => setTimeout(resolve, 100));').length, 0);
  // 测试与 fixtures 由 checkFile 统一跳过
  assert.equal(rules("scripts/x.test.mjs", 'await new Promise((resolve) => setTimeout(resolve, 1));').length, 0);
  assert.equal(rules("scripts/fixtures/x.mjs", 'await new Promise((resolve) => setTimeout(resolve, 1));').length, 0);
  assert.equal(rules("shared/x.ts", 'await new Promise((resolve) => setTimeout(() => resolve(value), 100));').length, 0);
});

test("workers/*/src 与 shared/ 手写 new Response(JSON.stringify(...)) 被拦，其余形态与范围外放行", () => {
  assert.deepEqual(rules("workers/example/src/x.ts", 'return new Response(JSON.stringify(data), { status: 200 });'), ["json-response-literal@1"]);
  assert.deepEqual(rules("shared/x.ts", 'const r = new Response(JSON.stringify(data));'), ["json-response-literal@1"]);
  assert.deepEqual(rules("workers/example/src/x.ts", 'return new Response (\n  JSON.stringify(data),\n);'), ["json-response-literal@1"]);
  assert.equal(rules("shared/x.ts", '// new Response(JSON.stringify(data))').length, 0);
  assert.equal(rules("workers/example/src/x.ts", 'const hint = "new Response(JSON.stringify(data))";').length, 0);
  assert.equal(rules("workers/example/src/x.ts", 'const hint = `new Response(JSON.stringify(${data}))`;').length, 0);
  // 共享实现自身豁免；范围外（src/、测试文件）与合规写法放行
  assert.equal(rules("shared/http-origins.ts", 'return new Response(JSON.stringify(data), { ...init, headers });').length, 0);
  assert.equal(rules("src/lib/x.ts", 'return new Response(JSON.stringify(data));').length, 0);
  assert.equal(rules("workers/example/src/x.test.ts", 'return new Response(JSON.stringify(data));').length, 0);
  assert.equal(rules("workers/example/src/x.ts", 'return Response.json(data, { headers: { "Cache-Control": "no-store" } });').length, 0);
});

test("checkFile 只扫认识的代码扩展名", () => {
  assert.equal(checkFile("AGENTS.md", "// TODO 文档不走这条").length, 0);
  assert.equal(checkFile("src/lib/x.md", "// TODO").length, 0);
});

test("scripts/ 新增 .mjs 被拦，基线里已迁走的条目要删，其余目录与 .ts 不管", () => {
  const baseline = ["scripts/old.mjs", "scripts/gone.mjs"];
  const files = ["scripts/old.mjs", "scripts/new.mjs", "scripts/fixtures/x.mjs", "scripts/ok.ts", "docs/explainer/a.mjs", "eslint.config.mjs"];
  const issues = checkScriptsMjs(files, baseline);
  assert.deepEqual(issues.map((issue) => issue.file), ["scripts/new.mjs", "scripts/fixtures/x.mjs", "scripts/mjs-baseline.json"]);
  assert.match(issues[2].message, /scripts\/gone\.mjs/);
  assert.equal(checkScriptsMjs(["scripts/old.mjs", "scripts/gone.mjs"], baseline).length, 0);
});

test("JSDoc 块注释被拦，行注释、普通块注释与字符串里的 /** 放行", () => {
  const reviewed = "#!/usr/bin/env node\n/**\n * 三份存量基线只许比目标分支少。\n */\nimport { readFileSync } from \"node:fs\";";
  assert.deepEqual(rules("scripts/baseline-growth-check.ts", reviewed), ["jsdoc-internal@2"]);
  assert.deepEqual(rules("src/lib/x.ts", "const a = 1;\n/** 说明 */\nexport const b = 2;"), ["jsdoc-internal@2"]);
  assert.equal(rules("src/lib/x.ts", '// 文件头\n/* 普通块注释 */\nconst s = "/** 字符串里的不算 */";\nconst e = 1; /**/').length, 0);
  assert.equal(rules("docs/x.md", "/** markdown 不查 */").length, 0);
  assert.equal(rules("src/lib/x.ts", "const pattern = /[/**]/;\nconst q = /\"/; const t = `/** 模板文本 */`;").length, 0);
  assert.deepEqual(rules("src/lib/x.ts", "const v = 1;\nconst r = `${/** 插值里的 */ v}`;"), ["jsdoc-internal@2"]);
  assert.deepEqual(rules("src/lib/x.ts", "const q = /\"/;\n/** 正则后面的 */\nexport const b = 2;"), ["jsdoc-internal@2"]);
  assert.deepEqual(rules("src/components/x.tsx", "export const A = () => <p>it's {/** JSX 里的 */ 1}</p>;"), ["jsdoc-internal@1"]);
  assert.equal(rules("src/components/x.tsx", "export const A = () => <p>/** JSX 文本 */</p>;").length, 0);
  assert.deepEqual(rules("src/lib/x.ts", "const x = 1;\n/** 文件末尾 */"), ["jsdoc-internal@2"]);
  assert.deepEqual(rules("src/lib/x.ts", "/** 声明前 */\nexport function f() { return 1; }"), ["jsdoc-internal@1"]);
});

test("SHA-256 十六进制在 shared/sha256.ts 以外复制一份被拦，scripts/ 与实现本身放行", () => {
  const copy = 'const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");';
  assert.deepEqual(rules("workers/collector/src/jobs/avatar-watch.ts", `const a = 1;\n${copy}`), ["sha256-hex@2"]);
  assert.deepEqual(rules("workers/core/src/pulse-score.ts", "const hash=Array.from(d,(b)=>b.toString(16).padStart(2,'0')).join('');"), ["sha256-hex@1"]);
  assert.equal(rules("shared/sha256.ts", copy).length, 0);
  assert.equal(rules("scripts/x.ts", copy).length, 0);
});

test("一两句只判普通对象的单参数函数被拦，用 shared/json 的和做更多校验的放行", () => {
  const nullable = 'function record(value: unknown) {\n  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;\n}';
  assert.deepEqual(rules("workers/core/src/pulse-score.ts", nullable), ["json-object-guard@1"]);
  const throwing = 'function record(value: unknown): Record<string, unknown> {\n  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad");\n  return value as Record<string, unknown>;\n}';
  assert.deepEqual(rules("shared/site-analytics.ts", throwing), ["json-object-guard@1"]);
  assert.deepEqual(rules("workers/ai/src/mcp.ts", 'const isObject = (value: unknown): value is Record<string, unknown> =>\n  typeof value === "object" && value !== null && !Array.isArray(value);'), ["json-object-guard@1"]);
  assert.equal(rules("shared/json.ts", nullable).length, 0);
  assert.equal(rules("shared/x.ts", 'function record(value: unknown) {\n  const row = object(value);\n  if (!row) throw new Error("bad");\n  return row;\n}').length, 0);
  const validator = 'export function isEnvelope(value: unknown) {\n  if (!value || typeof value !== "object" || Array.isArray(value)) return false;\n  const row = value as Record<string, unknown>;\n  if (typeof row.ok !== "boolean") return false;\n  return true;\n}';
  assert.equal(rules("src/lib/site-policy.ts", validator).length, 0);
});

test("内联脚本 JSON 的小于号转义在 src/lib/inline-script.ts 以外手写被拦", () => {
  const copy = 'const p = `${JSON.stringify(pool).replace(/</g, "\\\\u003c")}`;';
  assert.deepEqual(rules("src/components/live/digest-card.tsx", `const a = 1;\n${copy}`), ["inline-script-json@2"]);
  assert.equal(rules("src/lib/inline-script.ts", copy).length, 0);
  assert.equal(rules("src/lib/html-preview.ts", 'const e = (v: string) => v.replace(/</g, "&lt;");').length, 0);
});
