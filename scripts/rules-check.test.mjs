import assert from "node:assert/strict";
import { test } from "node:test";

import { checkFetchHost, checkFile, checkScrollbarPair, checkTodo } from "./rules-check.mjs";

const rules = (file, text) => checkFile(file, text).map((issue) => `${issue.rule}@${issue.line}`);

test("不带单号的 TODO / FIXME 被拦，带 #单号或链接的放行", () => {
  assert.deepEqual(rules("src/lib/x.ts", "// TODO: 以后处理\nconst a = 1; // FIXME 同上"), ["todo-ticket@1", "todo-ticket@2"]);
  assert.equal(checkTodo("src/lib/x.ts", "// TODO(#256) 等上游修复\n// FIXME https://github.com/x/y/issues/1").length, 0);
  assert.equal(checkTodo("src/lib/x.ts", "/* TODO(#1) 块注释也行 */\n/* 等上游 API，见 https://linear.app/x/ISSUE-2 */").length, 0);
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

test("隐藏滚动条两句缺一不可", () => {
  assert.deepEqual(rules("src/components/x.tsx", '<div className="overflow-y-auto scrollbar-none" />'), ["scrollbar-pair@1"]);
  assert.deepEqual(rules("src/components/x.tsx", '<div className="overflow-y-auto [&::-webkit-scrollbar]:hidden" />'), ["scrollbar-pair@1"]);
  assert.equal(
    rules("src/components/x.tsx", '<div className="overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden" />\n<div className="overflow-y-auto" />').length,
    0,
  );
  // 注入 iframe 的原生 CSS（::-webkit-scrollbar{display:none}）不是 Tailwind 类，不算
  assert.equal(rules("src/lib/html-preview.ts", 'const css = "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}";').length, 0);
});

test("git 历史里的真实旧错误形态会被拦下", () => {
  // 39ab64f7 之前的形态：图片地址带交付域
  assert.deepEqual(rules("src/lib/x.ts", 'return `https://assets.example.com/img/${key}.webp`;'), ["img-baked-url@1"]);
  // 全仓注释清理前（43ef5895 / 24a4d324）的形态：裸待办标记
  assert.deepEqual(rules("src/lib/x.ts", "// TODO: 接新接口"), ["todo-ticket@1"]);
  // uptime-strip 修掉的那类问题不在这条脚本里（design:scale 管 radius），这里不重复报
  assert.equal(checkScrollbarPair("src/components/x.tsx", 'className="rounded-[2px]"').length, 0);
});

test("checkFile 只扫认识的代码扩展名", () => {
  assert.equal(checkFile("AGENTS.md", "// TODO 文档不走这条").length, 0);
  assert.equal(checkFile("src/lib/x.md", "// TODO").length, 0);
});
