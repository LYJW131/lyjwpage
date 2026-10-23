#!/usr/bin/env node
// 证明一批改动「只改了注释」：把基准版本和当前版本的文件都去掉注释后比较，逐个文件给出结论。
// 清扫注释的改动收尾时用（根 AGENTS.md「文档与注释」）：输出里没有「除注释外有改动」
// 「指令性注释有改动」这类结论，才能说这批只动了注释。
//
// 用法（在仓库里执行）：
//   pnpm docs:comment-only [选项] [文件...]
//
//   文件         .ts .tsx .mts .cts .js .jsx .mjs .cjs .swift，相对仓库根或绝对路径。
//                不给就取 `git diff --name-only <base>`（含未提交改动）里扩展名认识的那些。
//   --base <ref> 基准，默认 HEAD。基准里没有的文件算「新增」，不能证明只改了注释。
//   --to <ref>   拿 <base> 和 <ref> 比；不给就拿 <base> 和工作区比。
//   --repo <dir> 仓库根，默认当前目录所在的仓库。TypeScript 依次从这个仓库、本脚本所在的仓库、
//                环境变量 COMMENT_ONLY_REPO 指的仓库、当前目录的 node_modules 里取。
//   --loose      Swift 的代码部分去掉全部空白再比（字符串字面量不受影响，见下）。默认保留换行和
//                「有没有空白」，因为 Swift 里 `a -b` 与 `a - b`、换行与否可能是两回事。
//                TS/JS 一律忽略排版。
//   --context N  差异输出保留的行数上限，默认 30，0 表示不输出。
//
// 结论（每个文件一个）：
//   仅注释           去掉注释后逐字相同，且指令性注释连同它们绑定的位置也没变
//   没变化           两边内容逐字相同
//   除注释外有改动   去掉注释后不同，同时输出差异
//   指令性注释有改动 去掉注释后相同，但看着是注释、实际影响编译或检查的那类注释变了（正文变了，
//                    或挪了位置），要人看一眼：`@ts-ignore`、`@ts-expect-error`、`eslint-disable`、
//                    `/// <reference>`、`#__PURE__`、`/*!` 版权头、shebang、JS 里带类型的 JSDoc、
//                    swiftlint 指令等，认得的写法见 scripts/comment-only/ 下的 TS_DIRECTIVES 与 SWIFT_DIRECTIVES
//   解析失败、新增文件、已删除、不支持的类型  都不能证明只改了注释
// 退出码：全部是「仅注释」或「没变化」为 0，有别的结论为 1，用法错误或环境缺失为 2。
//
// 做法：TS/JS 用 TypeScript 编译器 API 解析，`printer` 打开 `removeComments` 重新打印，所以字符串、
// 模板、正则里的 `//` 不会被误当注释，排版差异也不算改动；JSX 里只含注释的花括号表达式和只含换行的
// 空白文本按 JSX 语义等同于没有。Swift 用自带的词法扫描，认得嵌套的块注释、字符串插值、原始字符串
// 和多行字符串。
//
// 字符串字面量逐字比较：里面的空白是内容，不是排版。TS/JS 的字符串、模板、正则、JSX 文本由 printer
// 原样输出；Swift 的整个字符串（单行、多行、原始，含插值）当作一段原文，只比较字符串之外的代码，
// `--loose` 也不放宽字符串里的空白。
//
// 指令性注释的绑定：它管哪一行、哪个表达式取决于位置（`@ts-ignore`、`eslint-disable-next-line`
// 管下一行，`eslint-disable-line` 管所在行，`#__PURE__` 管后面的调用），所以每条指令连同它挨着的东西
// 一起比：语法位置（TS 是它后面第一个语法节点的序号，Swift 是它前面有多少个非空白代码字符）、
// 同一行里它前后的代码、它下一行的代码。代码一律去掉注释、压缩空白；下一行整行只有注释记作
// 「«注释»」，与空行不同。判定宁滥勿缺：`///`、`/**` 写法都认，`@ts-*` 与 `__PURE__` 在注释里任何位置都算。
// 代价：紧挨着指令的那行代码被重新排版、指令与目标行之间加了普通注释或空行，也报「指令性注释有改动」。
//
// Swift 的 `#/…/#` 正则字面量（井号个数不限）按转义读完；正文里含 `//`、`/*`、`*/` 时注释边界无法证明，
// 两边任一边出现就报解析失败，不给结论。不带井号的 `/…/` 正则字面量不认得。
// 已知局限：不在 TS_DIRECTIVES、SWIFT_DIRECTIVES 里的注释一律按普通注释处理。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type * as TS from "typescript";

import { type Normalized } from "./comment-only/directives.ts";
import { SWIFT_EXTENSION, normalizeSwift } from "./comment-only/swift.ts";
import { TS_EXTENSIONS, normalizeTs } from "./comment-only/typescript.ts";

export { normalizeSwift, stripSwift } from "./comment-only/swift.ts";
export { normalizeTs } from "./comment-only/typescript.ts";

export type Comparison =
  | { status: "new" | "deleted" | "unchanged" | "unsupported" | "comment-only" }
  | { status: "parse-error"; detail: string }
  | { status: "code"; before: string; after: string }
  | { status: "directive"; before: string[]; after: string[] };
type Status = Comparison["status"];

export function compareContents({ ts, file, before, after, loose = false }: { ts: typeof TS; file: string; before: string | null; after: string | null; loose?: boolean }): Comparison {
  if (before === null) return { status: "new" };
  if (after === null) return { status: "deleted" };
  if (before === after) return { status: "unchanged" };
  const ext = path.extname(file).toLowerCase();
  let a: Normalized;
  let b: Normalized;
  const kind = TS_EXTENSIONS.get(ext);
  if (kind) {
    a = normalizeTs(ts, before, file, kind);
    b = normalizeTs(ts, after, file, kind);
  } else if (ext === SWIFT_EXTENSION) {
    a = normalizeSwift(before, { loose });
    b = normalizeSwift(after, { loose });
  } else {
    return { status: "unsupported" };
  }
  const unprovable = ext === SWIFT_EXTENSION ? [...b.errors, ...a.errors] : b.errors.length > a.errors.length ? b.errors : [];
  if (unprovable.length > 0) return { status: "parse-error", detail: unprovable.slice(0, 3).join("\n") };
  if ((a.key ?? a.code) !== (b.key ?? b.code)) return { status: "code", before: a.code, after: b.code };
  if (JSON.stringify(a.directives) !== JSON.stringify(b.directives)) {
    return { status: "directive", before: a.directives, after: b.directives };
  }
  return { status: "comment-only" };
}

function unifiedDiff(before: string, after: string, context: number): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "comment-only-"));
  try {
    writeFileSync(path.join(dir, "base"), `${before}\n`);
    writeFileSync(path.join(dir, "work"), `${after}\n`);
    const result = spawnSync("diff", ["-u", "-L", "去注释后·基准", "-L", "去注释后·当前", path.join(dir, "base"), path.join(dir, "work")], { encoding: "utf8" });
    const lines = (result.stdout ?? "").split("\n").filter(Boolean);
    if (lines.length === 0) return "（差异工具没有输出）";
    const shown = lines.slice(0, context);
    return shown.join("\n") + (lines.length > shown.length ? `\n… 还有 ${lines.length - shown.length} 行` : "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


function git(repo: string, args: string[], { allowFail = false } = {}): string | null {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")} 失败：${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function loadTypeScript(repo: string): typeof TS {
  const candidates = [repo, path.dirname(fileURLToPath(import.meta.url)), process.env.COMMENT_ONLY_REPO, process.cwd()].filter((base): base is string => Boolean(base));
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, "package.json"))("typescript") as typeof TS;
    } catch {
    }
  }
  throw new Error(`在 ${candidates.join("、")} 的 node_modules 里找不到 typescript：先在仓库里 pnpm install，或用 --repo / COMMENT_ONLY_REPO 指到装了它的仓库`);
}

export function readVersions({ repo, base, to, file }: { repo: string; base: string; to: string | null; file: string }) {
  const rel = path.isAbsolute(file) ? path.relative(repo, file) : file;
  const before = git(repo, ["show", `${base}:${rel}`], { allowFail: true });
  let after: string | null;
  if (to) {
    after = git(repo, ["show", `${to}:${rel}`], { allowFail: true });
  } else {
    const abs = path.join(repo, rel);
    after = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }
  return { rel, before, after };
}

export function checkFiles({ repo, base = "HEAD", to = null, files, loose = false, ts }: { repo: string; base?: string; to?: string | null; files: string[]; loose?: boolean; ts: typeof TS }) {
  return files.map((file) => {
    const { rel, before, after } = readVersions({ repo, base, to, file });
    return { file: rel, ...compareContents({ ts, file: rel, before, after, loose }) };
  });
}

type Options = { base: string; to: string | null; repo: string | null; loose: boolean; context: number; files: string[]; help?: boolean };

function parseArgs(argv: string[]): Options {
  const opts: Options = { base: "HEAD", to: null, repo: null, loose: false, context: 30, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} 后面缺值`);
      return next;
    };
    if (arg === "--base") opts.base = value();
    else if (arg === "--to") opts.to = value();
    else if (arg === "--repo") opts.repo = value();
    else if (arg === "--context") opts.context = Number(value());
    else if (arg === "--loose") opts.loose = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--")) throw new Error(`不认识的选项 ${arg}`);
    else opts.files.push(arg);
  }
  return opts;
}

const LABELS: Record<Status, string> = {
  "comment-only": "仅注释",
  unchanged: "没变化",
  code: "除注释外有改动",
  directive: "指令性注释有改动",
  "parse-error": "解析失败",
  new: "新增文件",
  deleted: "已删除",
  unsupported: "不支持的类型",
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    // 文件头的行注释就是帮助文本
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const header = source.split("\n").slice(1);
    const end = header.findIndex((line) => !line.startsWith("//"));
    console.log(header.slice(0, end < 0 ? header.length : end).map((line) => line.replace(/^\/\/ ?/, "")).join("\n").trim());
    return;
  }
  const repo = path.resolve(opts.repo ?? (git(process.cwd(), ["rev-parse", "--show-toplevel"]) ?? "").trim());
  const ts = loadTypeScript(repo);
  let files = opts.files;
  if (files.length === 0) {
    const changed = (git(repo, ["diff", "--name-only", ...(opts.to ? [opts.base, opts.to] : [opts.base])]) ?? "").split("\n").filter(Boolean);
    files = changed.filter((file) => TS_EXTENSIONS.has(path.extname(file).toLowerCase()) || path.extname(file).toLowerCase() === SWIFT_EXTENSION);
    if (files.length === 0) {
      console.log("没有可比较的 ts/tsx/mts/mjs/js/swift 改动");
      return;
    }
  }
  const results = checkFiles({ repo, base: opts.base, to: opts.to, files, loose: opts.loose, ts });
  const counts: Partial<Record<Status, number>> = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    if (result.status === "unchanged") continue;
    console.log(`${LABELS[result.status].padEnd(10, "　")} ${result.file}`);
    if (result.status === "code" && opts.context > 0) console.log(`${unifiedDiff(result.before, result.after, opts.context).replace(/^/gm, "    ")}`);
    if (result.status === "directive") {
      const list = (entries: string[]) => (entries.length ? entries.map((entry) => `      ${entry}`).join("\n") : "      （没有）");
      console.log(`    基准：\n${list(result.before)}\n    当前：\n${list(result.after)}`);
    }
    if (result.status === "parse-error") console.log(`    ${result.detail.replace(/\n/g, "\n    ")}`);
  }
  const bad = results.filter((r) => !["comment-only", "unchanged"].includes(r.status));
  console.log(`\n共 ${results.length} 个文件：仅注释 ${counts["comment-only"] ?? 0}，没变化 ${counts.unchanged ?? 0}，需要看 ${bad.length}`);
  if (bad.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
