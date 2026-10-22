#!/usr/bin/env node
// 仓库级机械规则检查（AGENTS.md「规则 → 由什么强制」表里的 `pnpm rules:check`）：
//
//   todo-ticket    注释里的待办标记必须带跟踪单号（`#123` 或链接），AGENTS.md「文档与注释」
//   img-baked-url  不烧 `/img/` 交付域：R2 图片一律同源相对路径（shared/asset-url.ts#publicAssetPath），
//                  需要绝对地址的场合（OG、RSS）读环境变量
//   site-fetch-host 站点 src/ 里的网络调用不写字面量主机：后端调用走 backendUrl / workerUrl
//                  （PUBLIC_BACKEND_URL），浏览器必须直连的第三方主机在 ALLOWED_FETCH_HOSTS 登记；
//                  host 按 URL 语义解析，fetch / Request 等的首参（含其中 new URL 的两个参数）证明不了在允许列表内即报
//   scrollbar-pair 隐藏滚动条两句缺一不可：scrollbar-none 管 Firefox，
//                  [&::-webkit-scrollbar]:hidden 管 Chromium（DESIGN.md「滚动区」）
//   manual-sleep   scripts/、shared/、workers/<x>/src/ 里等一段时间一律用
//                  import { setTimeout as sleep } from "node:timers/promises"，不手写
//                  new Promise 包 setTimeout；字符串里交给浏览器执行的代码不算
//   json-response-literal
//                  Worker 与 shared/ 的 JSON 响应统一走 shared/http-origins.ts#jsonResponse，
//                  不再手写 new Response(JSON.stringify(...))
//   jsdoc-internal JS / TS 源码不写 JSDoc 块注释（以 /** 开头）：仓库没有对外发布的库接口，文件头与说明用 //，
//                  AGENTS.md「文档与注释」
//   sha256-hex     src/、shared/、workers/<x>/src/ 的 SHA-256 十六进制一律用 shared/sha256.ts#sha256Hex，
//                  不再逐字复制 toString(16).padStart(2, "0")
//   json-object-guard
//                  同一范围里「是不是普通对象」只用 shared/json.ts#object 判断：一两句、只做
//                  typeof 与 Array.isArray 检查的单参数函数要改成调它（失败时抛错或回默认值包在外面）
//   inline-script-json
//                  内联脚本里的 JSON 只经 src/lib/inline-script.ts#scriptJson 转义小于号，不再各写一份 replace(/</g, …)
//   scripts-mjs    scripts/ 新写的脚本用 .ts（Node 直接跑，进 typecheck）；现存 .mjs 记在
//                  scripts/mjs-baseline.json，迁走一个就从基线删一个，基线只减不增（scripts/baseline-growth-check.ts）
//
// 退出码：有违例为 1。测试见 scripts/rules-check.test.ts。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkFetchHost, checkJsdoc, checkJsonObjectGuard, checkJsonResponseLiteral, checkManualSleep, checkScrollbarPair } from "./rules-check/ast-rules.ts";
import { extOf, type Issue } from "./rules-check/source.ts";
import { checkBakedImgUrl, checkInlineScriptJson, checkSha256Hex, checkTodo } from "./rules-check/text-rules.ts";

export { ALLOWED_FETCH_HOSTS, checkFetchHost, checkJsdoc, checkJsonObjectGuard, checkJsonResponseLiteral, checkManualSleep, checkScrollbarPair } from "./rules-check/ast-rules.ts";
export { commentTexts, maskComments, type Issue } from "./rules-check/source.ts";
export { checkBakedImgUrl, checkInlineScriptJson, checkSha256Hex, checkTodo } from "./rules-check/text-rules.ts";

const CODE_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "swift", "py", "sh",
  "yml", "yaml", "toml", "css", "html", "xml", "plist", "xcconfig", "json", "jsonc",
]);

const SITE_SOURCE = /^src\//;
const WORKER_OR_SHARED_TS = /^(?:workers\/[^/]+\/src|shared)\/.+\.ts$/;
const TEST_OR_FIXTURE = /\.test\.|(^|\/)(?:__tests__|tests?|fixtures|dev-fixtures)\//i;
const JSON_RESPONSE_IMPL = new Set(["shared/http-origins.ts"]);

export function checkFile(file: string, text: string): Issue[] {
  if (!CODE_EXTS.has(extOf(file)) || TEST_OR_FIXTURE.test(file)) return [];
  const issues = [...checkTodo(file, text), ...checkBakedImgUrl(file, text), ...checkManualSleep(file, text), ...checkJsdoc(file, text), ...checkSha256Hex(file, text), ...checkJsonObjectGuard(file, text), ...checkInlineScriptJson(file, text)];
  if (SITE_SOURCE.test(file)) issues.push(...checkFetchHost(file, text), ...checkScrollbarPair(file, text));
  if (WORKER_OR_SHARED_TS.test(file) && !JSON_RESPONSE_IMPL.has(file)) issues.push(...checkJsonResponseLiteral(file, text));
  return issues;
}

export const MJS_BASELINE_PATH = "scripts/mjs-baseline.json";
const SCRIPTS_MJS = /^scripts\/.+\.mjs$/;

export function checkScriptsMjs(files: string[], baseline: string[]): Issue[] {
  const listed = new Set(baseline);
  const present = new Set(files.filter((file) => SCRIPTS_MJS.test(file)));
  const added = [...present].filter((file) => !listed.has(file))
    .map((file) => ({ file, line: 1, rule: "scripts-mjs", message: "scripts/ 新脚本用 .ts（Node 直接跑，import 写 .ts 后缀），不再新增 .mjs。" }));
  const gone = [...listed].filter((file) => !present.has(file))
    .map((file) => ({ file: MJS_BASELINE_PATH, line: 1, rule: "scripts-mjs", message: `${file} 已不存在，从基线删掉。` }));
  return [...added, ...gone];
}

function trackedFiles(root: string) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && existsSync(path.join(root, file)));
}

function trackedSources(root: string) {
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
  const issues: Issue[] = [];
  const files = trackedSources(root);
  for (const file of files) issues.push(...checkFile(file, readFileSync(path.join(root, file), "utf8")));
  const baseline = JSON.parse(readFileSync(path.join(root, MJS_BASELINE_PATH), "utf8")) as string[];
  issues.push(...checkScriptsMjs(trackedFiles(root), baseline));
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
