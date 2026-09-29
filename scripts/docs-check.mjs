#!/usr/bin/env node
/**
 * 文档与注释的漂移检查：`pnpm docs:check`，规范见根 AGENTS.md「文档与注释」。
 * 只查机器判得了的事（引用还在不在、体积、类型标注、时间线写法）；语义对不对交给人和评审。
 * 零依赖，只读；文件清单、忽略规则、子模块都问 git，所以浅克隆、没拉子模块的 CI 里结果和本地一致。
 *
 * 规则（输出里的 [规则]）：
 *   link      本地链接、HTML 的 src / href / srcset 指向的文件存在；`.md#锚点` 的标题还在
 *   path      围栏外行内代码里形如仓库路径的引用存在。远端路径写成 `主机:/绝对路径`，
 *             以 `/` 开头的绝对路径、URL、含 `<>*{}` 的占位符和 glob 都不查
 *   symbol    `path#symbol` 出处戳记：符号仍作为整词出现在该文件里（目标是 .md 时按标题锚点查）
 *   size      根 AGENTS.md ≤ 150 行（不计 next 自动块，含标记行），其余 AGENTS.md ≤ 60 行
 *   pair      非根 AGENTS.md 的同目录有内容恰为 `@AGENTS.md` 的 CLAUDE.md
 *   type      docs/ 下每篇文首（前 6 行）有 `> 类型：reference|runbook|decision|record`；
 *             record 另需「按 <sha> <日期> 核对，快照不维护，不当现状引用」
 *   index     docs/ 下每篇都登记在 docs/README.md，且登记行里的类型与文首一致
 *   timeline  非 record 文档里的日期，以及「MM-DD 起/后/前」「N 月 N 日」这类时间线写法；
 *             「核对于 <日期>」「按 <sha> <日期> 核对」两种核对戳不算
 *   allow     `<!-- allow: 理由 -->` 必须写理由
 *
 * 同一行末尾加 `<!-- allow: 理由 -->` 可放行该行的 link / path / symbol / timeline。
 * 围栏代码块整块不查；行内代码里的日期不查（那是字面值，不是叙述）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const posix = path.posix;

export const DOC_TYPES = ["reference", "runbook", "decision", "record"];
export const ROOT_AGENTS_MAX_LINES = 150;
export const NESTED_AGENTS_MAX_LINES = 60;
/** next dev 托管的自动块：整块（含两行标记）不计入根 AGENTS.md 的行数 */
export const NEXT_BLOCK_BEGIN = "<!-- BEGIN:nextjs-agent-rules -->";
export const NEXT_BLOCK_END = "<!-- END:nextjs-agent-rules -->";

/** 出现在文档里就当文件名核对的扩展名；不在表里的（`.env`、`lyjw.me`）一律不当路径 */
const PATH_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx",
  "yml", "yaml", "toml", "swift", "py", "sh", "sql", "css", "html", "plist", "xcconfig",
  "png", "webp", "gif", "svg", "jpg", "jpeg", "mp3", "txt",
]);
/** 长得像文件名的产品名 */
const NON_FILE_NAMES = new Set(["next.js", "node.js", "hls.js", "vue.js", "three.js", "d3.js"]);
/** 符号可带连字符（TOML 键、eslint 规则名）；点号分段的按段核对 */
const SYMBOL_RE = /^[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*(?:\(\))?$/;
const IMPLICIT_MODULE_EXTENSIONS = ["ts", "tsx", "mts", "mjs", "js", "json"];

/**
 * 检查上下文。CLI 用 `gitContext()` 从 git 取；测试直接给清单。
 * @param {object} o
 * @param {string[]} o.tracked 已跟踪文件（相对仓库根，正斜杠）
 * @param {string[]} [o.submodules] 子模块路径；CI 不拉子模块，引用它里面的文件一律不查
 * @param {(paths: string[]) => Set<string>} [o.ignored] 返回其中被 .gitignore 命中的路径（生成物、本地凭据文件）
 * @param {(rel: string) => string | null} o.readText
 * @param {boolean} [o.shallow] 浅克隆里老提交不在，record 的 sha 只在非浅克隆时核实
 * @param {(sha: string) => boolean} [o.commitExists]
 */
export function makeContext({ tracked, submodules = [], ignored = () => new Set(), readText, shallow = false, commitExists = () => true }) {
  const files = new Set(tracked);
  const dirs = new Set();
  const basenames = new Set();
  for (const file of files) {
    basenames.add(posix.basename(file));
    let dir = posix.dirname(file);
    while (dir !== "." && !dirs.has(dir)) {
      dirs.add(dir);
      dir = posix.dirname(dir);
    }
  }
  const topDirs = new Set([...dirs].filter((dir) => !dir.includes("/")));
  const cache = new Map();
  return {
    files,
    dirs,
    basenames,
    topDirs,
    submodules,
    ignored,
    shallow,
    commitExists,
    text(rel) {
      if (!cache.has(rel)) cache.set(rel, files.has(rel) ? readText(rel) : null);
      return cache.get(rel);
    },
    inSubmodule(rel) {
      return submodules.some((sub) => rel === sub || rel.startsWith(`${sub}/`));
    },
    exists(rel) {
      const clean = rel.replace(/\/+$/, "");
      return files.has(clean) || dirs.has(clean) || this.inSubmodule(clean);
    },
  };
}

/** 从 git 取文件清单、子模块、忽略规则。 */
export function gitContext(root) {
  const git = (args, input) => execFileSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] });
  // 已跟踪 + 还没 add 的新文件（本地提交前就能查到）；干净克隆里两者等价，所以 CI 与本地一致
  const tracked = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter((file) => file && existsSync(path.join(root, file)));
  const submodules = git(["ls-files", "-s", "-z"])
    .split("\0")
    .filter((entry) => entry.startsWith("160000 "))
    .map((entry) => entry.split("\t")[1]);
  return makeContext({
    tracked,
    submodules,
    readText: (rel) => readFileSync(path.join(root, rel), "utf8"),
    shallow: git(["rev-parse", "--is-shallow-repository"]).trim() === "true",
    commitExists: (sha) => {
      try {
        git(["cat-file", "-e", `${sha}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    },
    ignored: (paths) => {
      const checkIgnore = (batch) => git(["check-ignore", "--no-index", "-z", "--stdin"], `${batch.join("\0")}\0`).split("\0").filter(Boolean);
      const hits = new Set();
      if (paths.length === 0) return hits;
      try {
        for (const hit of checkIgnore(paths)) hits.add(hit);
      } catch (error) {
        if (error.status === 1) return hits; // 一个都没命中
        // 有路径落在符号链接后面（pnpm 的 node_modules）时整批被拒：逐个问，问不了的当没命中
        for (const one of paths) {
          try {
            for (const hit of checkIgnore([one])) hits.add(hit);
          } catch {
            // 没命中或问不了
          }
        }
      }
      return hits;
    },
  });
}

// ───────────────────────── Markdown 扫描 ─────────────────────────

/** 逐行给出 { n, text, inFence }；围栏（``` 或 ~~~）内的行标 inFence。 */
export function scanLines(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push({ n: i + 1, text: line, inFence: true });
      if (open && open[1][0] === fence.char && open[1].length >= fence.len && /^\s*(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      out.push({ n: i + 1, text: line, inFence: true });
      continue;
    }
    out.push({ n: i + 1, text: line, inFence: false });
  }
  return out;
}

/** 把行内代码换成等长空格，返回 { spans, rest }：spans 是代码内容，rest 用来找链接和日期。 */
export function splitInlineCode(line) {
  const spans = [];
  let rest = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      rest += line[i++];
      continue;
    }
    let run = 0;
    while (line[i + run] === "`") run++;
    const fenceText = "`".repeat(run);
    let close = -1;
    for (let j = i + run; j < line.length; j++) {
      if (line[j] !== "`") continue;
      let len = 0;
      while (line[j + len] === "`") len++;
      if (len === run) {
        close = j;
        break;
      }
      j += len - 1;
    }
    if (close === -1) {
      rest += fenceText;
      i += run;
      continue;
    }
    spans.push(line.slice(i + run, close).trim());
    rest += " ".repeat(close + run - i);
    i = close + run;
  }
  return { spans, rest };
}

/** GitHub 的标题锚点算法：小写，去掉字母数字下划线连字符空格以外的字符，空格换连字符。 */
export function githubSlug(heading) {
  let plain = heading.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  let previous;
  do {
    previous = plain;
    plain = plain.replace(/<[^<>]*>/g, "");
  } while (plain !== previous);
  return plain
    .replace(/[`*~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** 一篇 md 里所有可跳转的锚点（标题按 GitHub 规则，重名依次加 -1、-2；另收 id / name 属性）。 */
export function collectAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of scanLines(text)) {
    if (line.inFence) continue;
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (heading) {
      const slug = githubSlug(heading[1]);
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    for (const attr of line.text.matchAll(/\b(?:id|name)="([^"]+)"/g)) anchors.add(attr[1].toLowerCase());
  }
  return anchors;
}

const ALLOW_RE = /<!--\s*allow:(.*?)-->/;

const TIMELINE_PATTERNS = [
  /(?<![\d-])20\d{2}-\d{2}-\d{2}(?!\d)/g,
  /(?<![\d-])20\d{2}-(?:0[1-9]|1[0-2])(?![\d-])\s*(?:起|后|前|之后|之前|以后|以前|以来|开始)/g,
  /(?<![\d-])(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\s*(?:起|后|前|之后|之前|以后|以前|以来|开始)/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/g,
  /20\d{2}\s*年\s*\d{1,2}\s*月/g,
];

/** 一行里的时间线写法（核对戳除外）。 */
export function findTimeline(rest) {
  const hits = [];
  for (const pattern of TIMELINE_PATTERNS) {
    for (const match of rest.matchAll(pattern)) {
      const before = rest.slice(0, match.index);
      const after = rest.slice(match.index + match[0].length);
      if (/核对于\s*$/.test(before) || /^\s*核对/.test(after)) continue;
      hits.push(match[0]);
    }
  }
  return hits;
}

/** 从 md 文首找 `> 类型：…`，返回 { type, stamp }；没有就 null。 */
export function parseDocType(text) {
  const lines = text.split(/\r?\n/).slice(0, 6);
  const at = lines.findIndex((line) => /^>\s*类型：/.test(line));
  if (at === -1) return null;
  const quote = [];
  for (let i = at; i < lines.length && /^>/.test(lines[i]) && quote.length < 3; i++) quote.push(lines[i].replace(/^>\s*/, ""));
  const joined = quote.join(" ");
  const type = /类型：\s*([A-Za-z]+)/.exec(joined)?.[1] ?? "";
  const stamp = /按\s+([0-9a-f]{7,40})\s+(20\d{2}-\d{2}-\d{2})\s+核对，快照不维护，不当现状引用/.exec(joined);
  return { type, stamp: stamp ? { sha: stamp[1], date: stamp[2] } : null };
}

// ───────────────────────── 引用解析 ─────────────────────────

/**
 * 反引号里的内容是不是要核对的仓库路径。返回 { ref, symbol, bare, dirRef } 或 null。
 * 宁可漏查也别误报：不含已知扩展名的单个词、含空格或命令符号的片段、绝对路径、远端路径都不算。
 */
export function parsePathToken(raw, ctx) {
  let token = raw.trim().replace(/\(\)$/, ""); // `path#Class.method()` 的空括号
  if (!token || /\s/.test(token)) return null;
  if (/[<>*{}|()=,;$"'\\^!?[\]@…]/.test(token)) return null;
  if (/^[\w.-]+:[/~]/.test(token)) return null; // URL、file://、host:/abs
  if (/^[/~-]/.test(token) || /^(?:\.\/)?node_modules\//.test(token)) return null;
  token = token.replace(/:\d+(?:-\d+)?$/, "");

  let symbol = null;
  const hash = token.indexOf("#");
  if (hash > 0) {
    symbol = token.slice(hash + 1);
    token = token.slice(0, hash);
  } else if (hash === 0) {
    return null;
  }
  const ref = token.replace(/^\.\//, "");
  if (!ref || NON_FILE_NAMES.has(ref.toLowerCase())) return null;

  const segments = ref.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const ext = last.startsWith(".") && last.indexOf(".", 1) === -1 ? "" : posix.extname(last).slice(1).toLowerCase();
  // `api2.cursor.sh` 这类主机名的 TLD 恰好和脚本扩展名重名：无斜杠、三段以上按主机名算
  const hostname = !ref.includes("/") && (ext === "sh" || ext === "py") && ref.split(".").length >= 3;
  const knownExt = PATH_EXTENSIONS.has(ext) && !hostname;
  const dirRef = ref.endsWith("/");
  const first = segments[0] ?? "";
  const rooted = ctx.topDirs.has(first);
  const looksLikePath =
    knownExt || (dirRef && (segments.length >= 2 || rooted)) || (!ext && segments.length >= 2 && rooted);
  if (!looksLikePath) return null;
  const stamp = symbol === "" ? null : symbol;
  return { ref, symbol: stamp, symbolOk: stamp === null || ref.endsWith(".md") || SYMBOL_RE.test(stamp), bare: !ref.includes("/"), dirRef };
}

/** 从 md 文件 `mdFile` 出发解析 `ref`，返回命中的仓库相对路径；找不到返回 null。 */
export function resolveRef(ctx, mdFile, ref, { bare = false, dirRef = false } = {}) {
  const mdDir = posix.dirname(mdFile);
  const clean = ref.replace(/^\/+/, "");
  const candidates = (ref.startsWith("/") ? [clean] : [posix.join(mdDir, ref), ref])
    .map((candidate) => posix.normalize(candidate).replace(/\/+$/, ""))
    .filter((candidate) => candidate && candidate !== "." && !candidate.startsWith(".."));
  for (const candidate of candidates) if (ctx.exists(candidate)) return candidate;
  if (bare && ctx.basenames.has(ref)) return ref;
  if (!posix.extname(ref)) {
    for (const candidate of candidates) {
      for (const ext of IMPLICIT_MODULE_EXTENSIONS) {
        if (ctx.files.has(`${candidate}.${ext}`)) return `${candidate}.${ext}`;
        if (ctx.files.has(`${candidate}/index.${ext}`)) return `${candidate}/index.${ext}`;
      }
    }
  }
  const probes = candidates.map((candidate) => (dirRef ? `${candidate}/` : candidate));
  const ignored = ctx.ignored(probes);
  const hit = probes.findIndex((probe) => ignored.has(probe));
  return hit === -1 ? null : candidates[hit];
}

function symbolPresent(text, symbol) {
  return symbol
    .replace(/\(\)$/, "")
    .split(".")
    .every((part) => new RegExp(`(?<![\\w$])${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).test(text));
}

function anchorExists(anchors, fragment) {
  let wanted = fragment;
  try {
    wanted = decodeURIComponent(fragment);
  } catch {
    // 不是合法的百分号编码，按原样比
  }
  return anchors.has(wanted.toLowerCase());
}

// ───────────────────────── 单篇 md ─────────────────────────

const LINK_RE = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const DEFINITION_RE = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;
const HTML_REF_RE = /\b(?:src|href|srcset)\s*=\s*"([^"]+)"/gi;

function linkTargets(rest) {
  const targets = [];
  for (const match of rest.matchAll(LINK_RE)) targets.push(match[1]);
  const definition = DEFINITION_RE.exec(rest);
  if (definition) targets.push(definition[1]);
  for (const match of rest.matchAll(HTML_REF_RE)) {
    for (const part of match[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) targets.push(url);
    }
  }
  return targets;
}

/** 检查一篇 md 的内容规则。docType 为 "record" 时不查时间线。 */
export function checkMarkdown(ctx, file, text, { docType = null } = {}) {
  const issues = [];
  const add = (n, rule, message) => issues.push({ file, line: n, rule, message });
  const ownAnchors = collectAnchors(text);
  const anchorsOf = (rel) => {
    const other = ctx.text(rel);
    return other === null ? null : collectAnchors(other);
  };

  let managed = false; // next dev 托管的自动块不归我们写，也不查
  for (const line of scanLines(text)) {
    if (line.text.trim() === NEXT_BLOCK_BEGIN) managed = true;
    if (managed || line.inFence) {
      if (line.text.trim() === NEXT_BLOCK_END) managed = false;
      continue;
    }
    const allow = ALLOW_RE.exec(line.text);
    if (allow) {
      if (!allow[1].trim()) add(line.n, "allow", "`<!-- allow: … -->` 缺少理由");
      continue;
    }
    const { spans, rest } = splitInlineCode(line.text);

    for (const target of linkTargets(rest)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
      const [withoutQuery] = target.split("?");
      const hash = withoutQuery.indexOf("#");
      const pathPart = hash === -1 ? withoutQuery : withoutQuery.slice(0, hash);
      const fragment = hash === -1 ? "" : withoutQuery.slice(hash + 1);
      if (!pathPart) {
        if (fragment && !anchorExists(ownAnchors, fragment)) add(line.n, "link", `本文里没有标题锚点 #${fragment}`);
        continue;
      }
      const resolved = resolveRef(ctx, file, pathPart, { dirRef: pathPart.endsWith("/") });
      if (!resolved) {
        add(line.n, "link", `链接目标不存在：${pathPart}`);
      } else if (fragment && resolved.endsWith(".md")) {
        const anchors = anchorsOf(resolved);
        if (anchors && !anchorExists(anchors, fragment)) add(line.n, "link", `${resolved} 里没有标题锚点 #${fragment}`);
      }
    }

    for (const span of spans) {
      const parsed = parsePathToken(span, ctx);
      if (!parsed) continue;
      const resolved = resolveRef(ctx, file, parsed.ref, parsed);
      if (!resolved) {
        add(line.n, "path", `引用的路径不存在：${parsed.ref}`);
        continue;
      }
      if (!parsed.symbol) continue;
      if (resolved.endsWith(".md")) {
        const anchors = anchorsOf(resolved);
        if (anchors && !anchorExists(anchors, parsed.symbol)) add(line.n, "symbol", `${resolved} 里没有标题锚点 #${parsed.symbol}`);
        continue;
      }
      if (!parsed.symbolOk) {
        add(line.n, "symbol", `出处戳记 #${parsed.symbol} 不是标识符：写成 path#符号，不写行号`);
        continue;
      }
      const target = ctx.text(resolved);
      if (target !== null && !symbolPresent(target, parsed.symbol)) add(line.n, "symbol", `${resolved} 里已经没有符号 ${parsed.symbol}`);
    }

    if (docType !== "record") {
      for (const hit of findTimeline(rest)) add(line.n, "timeline", `现状文档里的时间线写法「${hit}」：历史在 git log；确需保留就在行尾加 <!-- allow: 理由 -->`);
    }
  }
  return issues;
}

// ───────────────────────── 结构规则 ─────────────────────────

/** 根 AGENTS.md 的有效行数：总行数减去 next 自动块（含标记行）。 */
export function countAgentsLines(text, { root }) {
  const lines = text.replace(/\n$/, "").split("\n");
  if (!root) return lines.length;
  const begin = lines.findIndex((line) => line.trim() === NEXT_BLOCK_BEGIN);
  const end = lines.findIndex((line) => line.trim() === NEXT_BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) return lines.length;
  return lines.length - (end - begin + 1);
}

function isDocsPage(file) {
  return file.startsWith("docs/") && /\.md$/.test(file) && !/(^|\/)(AGENTS|CLAUDE)\.md$/.test(file);
}

export function checkStructure(ctx, mdFiles) {
  const issues = [];
  const add = (file, line, rule, message) => issues.push({ file, line, rule, message });

  for (const file of mdFiles) {
    if (posix.basename(file) === "AGENTS.md") {
      const text = ctx.text(file) ?? "";
      const isRoot = file === "AGENTS.md";
      const limit = isRoot ? ROOT_AGENTS_MAX_LINES : NESTED_AGENTS_MAX_LINES;
      const count = countAgentsLines(text, { root: isRoot });
      if (count > limit) add(file, 1, "size", `${count} 行，超过 ${limit} 行上限${isRoot ? "（不计 next 自动块）" : ""}：细节挪到 README / docs，这里只留规则和指针`);
      const companion = posix.join(posix.dirname(file), "CLAUDE.md");
      const claude = ctx.text(companion);
      if (claude === null) add(file, 1, "pair", `同目录缺 ${companion}（内容一行 @AGENTS.md，Claude Code 只按需载入 CLAUDE.md）`);
      else if (claude.trim() !== "@AGENTS.md") add(companion, 1, "pair", "内容必须恰为一行 @AGENTS.md");
    }
  }

  const pages = mdFiles.filter(isDocsPage);
  const indexText = ctx.text("docs/README.md");
  const indexed = new Set();
  if (indexText !== null) {
    for (const line of scanLines(indexText)) {
      if (line.inFence) continue;
      const { rest } = splitInlineCode(line.text);
      for (const target of linkTargets(rest)) {
        const resolved = resolveRef(ctx, "docs/README.md", target.split("#")[0] || ".", {});
        if (resolved) indexed.add(resolved);
      }
    }
  }

  for (const file of pages) {
    const text = ctx.text(file) ?? "";
    const info = parseDocType(text);
    if (!info) {
      add(file, 1, "type", "文首缺类型标注：H1 之后第一行写 `> 类型：reference|runbook|decision|record`");
    } else if (!DOC_TYPES.includes(info.type)) {
      add(file, 1, "type", `类型「${info.type}」不在 ${DOC_TYPES.join(" / ")} 里`);
    } else if (info.type === "record") {
      if (!info.stamp) {
        add(file, 1, "type", "record 需要「按 <sha> <日期> 核对，快照不维护，不当现状引用」（紧跟在类型行后，同一段引用里）");
      } else if (!ctx.shallow && !ctx.commitExists(info.stamp.sha)) {
        add(file, 1, "type", `record 里的提交 ${info.stamp.sha} 不在仓库历史里`);
      }
    }
    if (file === "docs/README.md") continue;
    if (!indexed.has(file)) {
      add(file, 1, "index", "没有登记在 docs/README.md 的索引里");
    } else if (info && DOC_TYPES.includes(info.type) && indexText !== null) {
      const name = posix.relative("docs", file);
      const row = indexText.split(/\r?\n/).find((line) => line.includes(`](./${name}`) || line.includes(`](${name}`));
      if (row && !new RegExp(`(?<![A-Za-z])${info.type}(?![A-Za-z])`).test(row)) {
        add("docs/README.md", 1, "index", `索引里 ${file} 一行没有写类型 ${info.type}（与文首不一致）`);
      }
    }
  }
  return issues;
}

// ───────────────────────── 入口 ─────────────────────────

export function isScannedMarkdown(file, ctx) {
  return /\.md$/.test(file) && !/(^|\/)node_modules\//.test(file) && !ctx.inSubmodule(file);
}

export function runChecks(ctx) {
  const mdFiles = [...ctx.files].filter((file) => isScannedMarkdown(file, ctx)).sort();
  const issues = [];
  for (const file of mdFiles) {
    const text = ctx.text(file) ?? "";
    const docType = isDocsPage(file) ? parseDocType(text)?.type ?? null : null;
    issues.push(...checkMarkdown(ctx, file, text, { docType }));
  }
  issues.push(...checkStructure(ctx, mdFiles));
  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { issues, checked: mdFiles.length };
}

export function formatIssues(issues) {
  return issues.map((issue) => `${issue.file}:${issue.line}  [${issue.rule}] ${issue.message}`).join("\n");
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { issues, checked } = runChecks(gitContext(root));
  if (issues.length === 0) {
    console.log(`docs:check 通过（${checked} 篇 md）`);
    return;
  }
  console.error(formatIssues(issues));
  console.error(`\ndocs:check 发现 ${issues.length} 个问题（${checked} 篇 md）。规范见 AGENTS.md「文档与注释」。`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
