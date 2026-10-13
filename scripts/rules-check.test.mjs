import assert from "node:assert/strict";
import { test } from "node:test";

import { checkFetchHost, checkFile, checkScrollbarPair, checkTodo } from "./rules-check.mjs";

const rules = (file, text) => checkFile(file, text).map((issue) => `${issue.rule}@${issue.line}`);

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
