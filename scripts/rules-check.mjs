#!/usr/bin/env node
/**
 * 仓库级机械规则检查（AGENTS.md「规则 → 由什么强制」表里的 `pnpm rules:check`）：
 *
 *   todo-ticket    注释里的待办标记必须带跟踪单号（`#123` 或链接），AGENTS.md「文档与注释」
 *   img-baked-url  不烧 `/img/` 交付域：R2 图片一律同源相对路径（shared/asset-url.ts#publicAssetPath），
 *                  需要绝对地址的场合（OG、RSS）读环境变量
 *   site-fetch-host 站点 src/ 里的网络调用不写字面量主机：后端调用走 backendUrl / workerUrl
 *                  （PUBLIC_BACKEND_URL），浏览器必须直连的第三方主机在 ALLOWED_FETCH_HOSTS 登记
 *   scrollbar-pair 隐藏滚动条两句缺一不可：scrollbar-none 管 Firefox，
 *                  [&::-webkit-scrollbar]:hidden 管 Chromium（DESIGN.md「滚动区」）
 *
 * 退出码：有违例为 1。测试见 scripts/rules-check.test.mjs。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CODE_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "py", "sh",
  "yml", "yaml", "toml", "css", "html", "xml", "plist", "xcconfig", "json", "jsonc",
]);
const HASH_COMMENT_EXTS = new Set(["py", "sh", "yml", "yaml", "toml"]);
const SLASH_COMMENT_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "css"]);

export const ALLOWED_FETCH_HOSTS = new Set(["api.music.apple.com"]);

const TICKET_RE = /#\d+|https?:\/\/\S+/;
const TODO_RE = /\b(?:TODO|FIXME)\b/;
const BAKED_IMG_RE = /https?:\/\/[^\s"')`]+\/img\//;
const FETCH_HOST_RE = /\b(?:fetch|sendBeacon|EventSource|WebSocket)\s*\(\s*["'`]\s*(?:https?|wss?):\/\/([a-zA-Z0-9.-]+)/g;

const extOf = (file) => path.posix.extname(file).slice(1).toLowerCase();


// 行内注释起点：跳过引号内的内容；`//` 不认 `://`（URL）；`/*` 会跨行。
export function commentRegion(line, inBlock, slashed, hashed) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    if (inBlock) {
      const close = line.indexOf("*/", i);
      if (close === -1) return { index: 0, inBlock: true };
      inBlock = false;
      i = close + 1;
      continue;
    }
    const char = line[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (slashed && char === "/" && line[i + 1] === "/" && line[i - 1] !== ":") return { index: i, inBlock: false };
    if (slashed && char === "/" && line[i + 1] === "*") { inBlock = true; i += 1; continue; }
    if (hashed && char === "#" && (i === 0 || /\s/.test(line[i - 1]))) return { index: i, inBlock: false };
  }
  return { index: -1, inBlock };
}

export function checkTodo(file, text) {
  const ext = extOf(file);
  const slashed = SLASH_COMMENT_EXTS.has(ext);
  const hashed = HASH_COMMENT_EXTS.has(ext);
  if (!slashed && !hashed) return [];
  const issues = [];
  let inBlock = false;
  text.split("\n").forEach((line, index) => {
    const region = commentRegion(line, inBlock, slashed, hashed);
    inBlock = region.inBlock;
    if (region.index === -1) return;
    const comment = line.slice(region.index);
    if (TODO_RE.test(comment) && !TICKET_RE.test(comment)) {
      issues.push({ file, line: index + 1, rule: "todo-ticket", message: `待办标记要挂跟踪单号：写成 TODO(#123) 或带上链接；现在就去做的就别留标记（AGENTS.md「文档与注释」）。` });
    }
  });
  return issues;
}

export function checkBakedImgUrl(file, text) {
  const issues = [];
  text.split("\n").forEach((line, index) => {
    if (BAKED_IMG_RE.test(line)) {
      issues.push({ file, line: index + 1, rule: "img-baked-url", message: "R2 图片一律同源 /img/<objectKey>（shared/asset-url.ts#publicAssetPath），不烧交付域；要绝对地址的场合读环境变量。" });
    }
  });
  return issues;
}

export function checkFetchHost(file, text) {
  const issues = [];
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(FETCH_HOST_RE)) {
      if (ALLOWED_FETCH_HOSTS.has(match[1])) continue;
      issues.push({ file, line: index + 1, rule: "site-fetch-host", message: `站点不字面量请求主机 ${match[1]}：后端调用走 backendUrl / workerUrl(PUBLIC_BACKEND_URL)，经 Service Binding 分流（跨域 fetch 会改写 CF-Connecting-IP，限流失效）；第三方 API 进后端 Worker，浏览器必须直连的登记进 rules-check 的 ALLOWED_FETCH_HOSTS（AGENTS.md「禁区」）。` });
    }
  });
  return issues;
}

export function checkScrollbarPair(file, text) {
  const issues = [];
  text.split("\n").forEach((line, index) => {
    // 只认 Tailwind 写法：scrollbar-none 类与 [&::-webkit-scrollbar]:… 任意变体；
    // 原生 CSS（html-preview 里注入 iframe 的 ::-webkit-scrollbar{display:none}）不算。
    const ff = line.includes("scrollbar-none");
    const webkit = line.includes("::-webkit-scrollbar]");
    if (ff !== webkit) {
      issues.push({ file, line: index + 1, rule: "scrollbar-pair", message: "隐藏滚动条两句缺一不可：scrollbar-none 管 Firefox，[&::-webkit-scrollbar]:hidden 管 Chromium，写在同一行（DESIGN.md「滚动区」）。" });
    }
  });
  return issues;
}

const SITE_SOURCE = /^src\//;
const TEST_OR_FIXTURE = /\.test\.|(^|\/)(?:__tests__|tests?|fixtures|dev-fixtures)\//i;

export function checkFile(file, text) {
  if (!CODE_EXTS.has(extOf(file)) || TEST_OR_FIXTURE.test(file)) return [];
  const issues = [...checkTodo(file, text), ...checkBakedImgUrl(file, text)];
  if (SITE_SOURCE.test(file)) issues.push(...checkFetchHost(file, text), ...checkScrollbarPair(file, text));
  return issues;
}

function trackedSources(root) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file, index, all) => {
      if (!file || all.indexOf(file) !== index) return false;
      if (!CODE_EXTS.has(extOf(file))) return false;
      if (TEST_OR_FIXTURE.test(file)) return false;
      return existsSync(path.join(root, file));
    });
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const issues = [];
  const files = trackedSources(root);
  for (const file of files) issues.push(...checkFile(file, readFileSync(path.join(root, file), "utf8")));
  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  if (issues.length === 0) {
    console.log(`rules:check 通过（${files.length} 个文件）`);
    return;
  }
  for (const issue of issues) console.error(`${issue.file}:${issue.line}  [${issue.rule}] ${issue.message}`);
  console.error(`\nrules:check 发现 ${issues.length} 个问题。`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
