import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyRequest, consoleClean, consoleProblems, isEnvNoise, loadFeatureMap, navOrigin, newSink, parseArgs, parseWidths, requiredCardIds, resolvePlaywright, updateOrigin } from "./site-verify.mjs";
import { STATUS_VIEWS } from "../shared/status-views.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "site-verify.mjs");
const FIXTURES = path.join(ROOT, "workers", "core", "dev-fixtures");
const KNOWN_PATHS = new Set(Object.values(STATUS_VIEWS).map((view) => view.path));

function run(args) {
  return spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
}

function headlessChromeCount() {
  const result = spawnSync("pgrep", ["-if", "chrom.*--headless"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split("\n").filter(Boolean).length : 0;
}

test("parseArgs 解析 --key value、--key=value、布尔开关与位置参数", () => {
  const { flags, positional } = parseArgs(["cards", "--url", "http://x:1", "--theme=dark", "--list", "--card", "a,b"]);
  assert.deepEqual(positional, ["cards"]);
  assert.equal(flags.url, "http://x:1");
  assert.equal(flags.theme, "dark");
  assert.equal(flags.list, true);
  assert.equal(flags.card, "a,b");
});

test("parseWidths 按宽度表补高度，非法输入返回 null", () => {
  assert.deepEqual(parseWidths("1280,375"), [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]);
  assert.equal(parseWidths("abc"), null);
  assert.equal(parseWidths("50"), null);
});

test("consoleClean：控制台错误、pageerror、同源失败请求都算脏；外源与 envNoise 不算", () => {
  assert.equal(consoleClean(newSink()), true);
  const withError = newSink();
  withError.errors.push("TypeError: x");
  assert.equal(consoleClean(withError), false);
  const withPageError = newSink();
  withPageError.pageErrors.push("ReferenceError: y");
  assert.equal(consoleClean(withPageError), false);
  const sameOrigin = newSink();
  sameOrigin.failedRequests.push({ url: "http://localhost:3211/api/status/x", status: 500, sameOrigin: true });
  assert.equal(consoleClean(sameOrigin), false);
  const externalOnly = newSink();
  externalOnly.failedRequests.push({ url: "https://cdn.example.com/a.png", status: 404, sameOrigin: false });
  externalOnly.envNoise.push("GET /favicon.ico → 404");
  assert.equal(consoleClean(externalOnly), true);
});

test("classifyRequest：favicon 与 ws 426 归噪声，同源 / 外源分开", () => {
  const origin = "http://localhost:3211";
  assert.equal(classifyRequest("http://localhost:3211/favicon.ico", 404, origin), "noise");
  assert.equal(classifyRequest("wss://localhost:3211/ws", 426, origin), "noise");
  assert.equal(classifyRequest("http://localhost:3211/api/status/pulse", 500, origin), "same-origin");
  assert.equal(classifyRequest("https://is1-ssl.mzstatic.com/a.webp", 404, origin), "external");
});

test("classifyRequest：ws 只有 426 豁免，其它失败按源分类", () => {
  const origin = "http://localhost:3211";
  assert.equal(classifyRequest("http://localhost:3211/ws", 500, origin), "same-origin");
  assert.equal(classifyRequest("wss://localhost:3211/ws", 401, origin), "same-origin");
  assert.equal(classifyRequest("wss://localhost:3211/ws", null, origin), "same-origin");
  assert.equal(classifyRequest("wss://lyjw.me/ws", null, origin), "external");
});

test("navOrigin / updateOrigin：跳转换域后第一方失败按新 origin 算同源", () => {
  const current = { origin: navOrigin("http://localhost:3211") };
  assert.equal(classifyRequest("https://lyjw.me/api/status/pulse", 500, current.origin), "external");
  updateOrigin(current, "https://lyjw.me/#frag");
  assert.equal(current.origin, "https://lyjw.me");
  assert.equal(classifyRequest("https://lyjw.me/api/status/pulse", 500, current.origin), "same-origin");
  // about:blank / data: 没有有效 origin，不改写（沿用跳转后的真实域）
  updateOrigin(current, "about:blank");
  assert.equal(current.origin, "https://lyjw.me");
  assert.equal(navOrigin("data:text/html,<p>x</p>"), null);
});

test("isEnvNoise：ws 失败消息必须含 426 才豁免", () => {
  assert.ok(isEnvNoise("WebSocket connection to 'wss://lyjw.me/ws' failed: Unexpected response code: 426"));
  assert.ok(!isEnvNoise("WebSocket connection to 'wss://lyjw.me/ws' failed: Unexpected response code: 401"));
  assert.ok(!isEnvNoise("WebSocket connection to 'wss://lyjw.me/ws' failed"));
});

test("requiredCardIds：不显式点名时跳过 conditional；--card 点名就算 required", () => {
  const map = { cards: { pulse: { conditional: false }, charger: { conditional: true } } };
  assert.deepEqual(requiredCardIds(map, ["pulse", "charger"], false), ["pulse"]);
  assert.deepEqual(requiredCardIds(map, ["pulse", "charger"], true), ["pulse", "charger"]);
});

test("功能地图每张卡有选择器或表头标签，组件、端点、夹具都真实存在", () => {
  const map = loadFeatureMap();
  assert.ok(map?.cards, "feature-map.json 读不到");
  for (const [id, card] of Object.entries(map.cards)) {
    assert.ok(card.selector || card.cardLabel, `${id} 缺 selector / cardLabel`);
    if (card.alternates !== undefined) {
      assert.ok(Array.isArray(card.alternates) && card.alternates.every((s) => typeof s === "string" && s.length > 0), `${id} alternates 要是非空字符串数组`);
    }
    assert.ok(fs.existsSync(path.join(ROOT, card.component)), `${id} 组件不存在：${card.component}`);
    assert.ok(typeof card.proves === "string" && card.proves.length > 0, `${id} 缺 proves`);
    for (const [endpoint, fixtures] of Object.entries(card.endpoints)) {
      assert.ok(KNOWN_PATHS.has(endpoint), `${id} 端点不在 STATUS_VIEWS：${endpoint}`);
      for (const fixture of fixtures) {
        assert.ok(fs.existsSync(path.join(FIXTURES, fixture)), `${id} 夹具不存在：${fixture}`);
      }
    }
  }
});

test("--help 退出 0 并列出全部子命令", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const sub of ["doctor", "cards", "shot", "override"]) assert.match(result.stdout, new RegExp(`\\b${sub}\\b`));
});

test("未知子命令退出 2，输出带 next 的 JSON 错误", () => {
  const result = run(["bogus"]);
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.match(body.error, /bogus/);
  assert.ok(body.next);
});

test("override --dry-run 不执行、只回显将跑的 dev:override 命令", () => {
  const result = run(["override", "--endpoint", "/api/status/pulse", "--fixture", "pulse-empty.json", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.command, "pnpm dev:override /api/status/pulse pulse-empty.json");
});

test("override 缺参数退出 2 并说明正确形状", () => {
  const result = run(["override", "--endpoint", "/api/status/pulse"]);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).next, /--fixture|--clear/);
});

test("doctor 对死端口报 site fail 且输出仍是 JSON", () => {
  const result = run(["doctor", "--url", "http://localhost:59999"]);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  const site = body.checks.find((c) => c.name === "site");
  assert.equal(site.status, "fail");
  assert.ok(site.next);
  assert.notEqual(result.status, 0);
});

test("consoleProblems 把 sink 脏处写成给人看的列表", () => {
  const sink = newSink();
  assert.equal(consoleProblems(sink), "");
  sink.pageErrors.push("TypeError: x");
  sink.failedRequests.push({ url: "http://localhost:3211/api/status/pulse", status: 500, sameOrigin: true });
  assert.match(consoleProblems(sink), /pageErrors 1 条；同源失败请求 1 条（如 http:\/\/localhost:3211\/api\/status\/pulse）/);
});

test("cards 找不到 required 卡片：退出码 1、ok:false 带 next，且不遗留 headless Chrome", async (t) => {
  const pw = await resolvePlaywright();
  if (!pw) return t.skip("本机解不到 playwright / playwright-core，浏览器清理路径验不了");
  const before = headlessChromeCount();
  const result = run(["cards", "--url", "data:text/html,<title>empty</title>", "--settle", "500"]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  // cards 字段非空才证明进了 openPage；没它说明死在更早的地方、退出码 1 是别的失败给的
  assert.ok(body.cards && Object.keys(body.cards).length > 0, "输出里没 cards，没走到浏览器那一步");
  assert.match(body.next, /缺卡|selector|夹具/);
  assert.equal(headlessChromeCount(), before, "cards 失败路径必须走 finally 关浏览器");
});

test("shot 控制台脏时退出码 1 且 next 指明哪张图什么原因", async (t) => {
  const pw = await resolvePlaywright();
  if (!pw) return t.skip("本机解不到 playwright / playwright-core，浏览器路径验不了");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-verify-"));
  try {
    const result = run(["shot", "--url", "data:text/html,<script>throw new Error('boom')</script>", "--widths", "375", "--out", out, "--settle", "500"]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.match(body.next, /page-375x\d+-light.*pageErrors 1 条/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("shot 失败时删掉同名旧图，不留上一轮产物冒充证据", async (t) => {
  const pw = await resolvePlaywright();
  if (!pw) return t.skip("本机解不到 playwright / playwright-core，浏览器路径验不了");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-verify-"));
  try {
    const stale = path.join(out, "digest-375x812-light.png");
    fs.writeFileSync(stale, "上一轮旧图");
    const result = run(["shot", "--url", "data:text/html,<title>empty</title>", "--widths", "375", "--card", "digest", "--out", out, "--settle", "300"]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(fs.existsSync(stale), false, "失败时旧图必须先被删掉");
    assert.equal(JSON.parse(result.stdout).shots[0].file, null);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
