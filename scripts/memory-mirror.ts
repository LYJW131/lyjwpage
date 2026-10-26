#!/usr/bin/env node
import { closeSync, constants, lstatSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MIRROR_KEEP = new Set(["README.md"]);

const REDACTIONS: [RegExp, string][] = [
  [/^ {2}modified: .*\n/gm, ""],
  [/https:\/\/claude\.ai\/\S*(?:artifact|share)\/[\w-]+/g, "<private claude.ai link>"],
  [/\b(?:env|session|cse|cagt)_[0-9A-Za-z]{10,}\b/g, "<internal id>"],
  [/\/Users\/[^/\s]+\//g, "~/"],
];

// 云端环境的显示名不是凭据，但同样不进公开镜像；新建环境时把名字加进来
export const CLOUD_ENV_NAMES = ["lyjwMain", "lyjwpage-build", "lyjwpage-canary"];

const SECRET_PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/],
  ["Anthropic / OpenAI key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{15,}/],
  ["npm token", /\bnpm_[A-Za-z0-9]{30,}/],
  ["Slack token", /\b(?:xox[abeoprs]|xapp)-[A-Za-z0-9-]{10,}/i],
  ["Stripe / SendGrid / DigitalOcean / Shopify token", /\b(?:[rs]k_live_|whsec_|SG\.|dop_v1_|shpat_)[A-Za-z0-9._-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
  ["netrc credential", /\bmachine\s+\S+\s+login\s+\S+\s+password\s+\S+/i],
  ["secret assignment", /[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|NPSSO)[A-Za-z0-9_]*\s*[:=]\s*(?:(["'`])(?![$<])[^"'`\n]{8,}\1|["'`]?(?![$<"'`-])[^\s"'`\u0080-￿]{8,})/i],
  ["hex secret", /(?<![\w/.-])[a-f0-9]{64}(?![\w/.-])/],
  // `wrkspc_01…`、`cmsg_01…` 这类带类型前缀的资源 ID 不是凭据；句末句号不算进长度
  ["opaque token", /(?<![\w/.-])(?![a-z]+_01[A-Za-z0-9]+(?![\w/-]|\.[\w/.-]))(?=[A-Za-z0-9_.-]*[A-Z])(?=[A-Za-z0-9_.-]*[a-z])(?=[A-Za-z0-9_.-]*\d)[A-Za-z0-9_.-]{31,}[A-Za-z0-9_-](?![\w/-]|\.[\w/.-])/],
];

export function sanitize(text: string) {
  const redacted = REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
  return CLOUD_ENV_NAMES.reduce((out, name) => out.replaceAll(name, "<cloud env>"), redacted);
}

// 记忆里当作值写出的凭据变量名（`apiKeySource: ANTHROPIC_API_KEY`）不是凭据；只放行列出的确切名字，按形状放行会把 `PASSWORD=ABCD1234_KEY` 这类真密码一起放过
const KNOWN_CREDENTIAL_VARIABLE = /(?<=[:=]\s*["'`]?)(?:ANTHROPIC_API_KEY)(?=["'`]?[).,;:]*(?:[\s\u0080-\uffff]|$))/g;

const asReference = (view: string) => view.replace(KNOWN_CREDENTIAL_VARIABLE, "$$$&");

export function findSecrets(text: string) {
  const folded = text.normalize("NFKC");
  const views = [folded, folded.replace(/[`"']/g, "")].map(asReference);
  return SECRET_PATTERNS.filter(([, pattern]) => views.some((view) => pattern.test(view))).map(([label]) => label);
}

function readSource(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    bytes = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("NUL");
    return text;
  } catch {
    throw new Error(`${path.basename(file)}: 不是 UTF-8 文本（含 NUL 或非法字节），拒绝镜像`);
  }
}

export function syncMirror(sourceDir: string, mirrorDir: string, warn: (message: string) => void = () => {}) {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).filter((e) => e.name.endsWith(".md") && !e.name.startsWith("."));
  for (const entry of entries) if (entry.isSymbolicLink()) warn(`跳过符号链接：${entry.name}`);
  const sources = entries.filter((e) => e.isFile()).map((e) => e.name);
  const nameLeaks = sources.flatMap((name) => {
    const labels = findSecrets(name);
    if (sanitize(name) !== name) labels.push("需脱敏的内容");
    return labels.map((label) => `${name}: 文件名含 ${label}`);
  });
  const outputs = new Map(sources.map((name) => [name, sanitize(readSource(path.join(sourceDir, name)))]));
  const leaks = [...outputs].flatMap(([name, text]) => findSecrets(text).map((label) => `${name}: ${label}`));
  if (nameLeaks.length || leaks.length) {
    throw new Error(`疑似凭据，未写入任何文件（先在项目记忆里删掉，或扩充 sanitize）：\n${[...nameLeaks, ...leaks].join("\n")}`);
  }
  const changed: string[] = [];
  for (const [name, next] of outputs) {
    const dest = path.join(mirrorDir, name);
    let current: string | null = null;
    try {
      if (lstatSync(dest).isSymbolicLink()) warn(`镜像里的符号链接已替换为普通文件：${name}`);
      else current = readFileSync(dest, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current === next) continue;
    const tmp = path.join(mirrorDir, `.${name}.${process.pid}.tmp`);
    try {
      writeFileSync(tmp, next, { flag: "wx" });
      renameSync(tmp, dest);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    changed.push(name);
  }
  const keep = new Set([...sources, ...MIRROR_KEEP]);
  for (const name of readdirSync(mirrorDir)) {
    if (name.endsWith(".md") && !keep.has(name)) {
      rmSync(path.join(mirrorDir, name));
      changed.push(name);
    }
  }
  return changed;
}

function main() {
  const [sourceDir, mirrorDir = ".claude/memory"] = process.argv.slice(2);
  if (!sourceDir) {
    console.error("用法：node scripts/memory-mirror.ts <项目记忆目录> [镜像目录，默认 .claude/memory]");
    process.exit(2);
  }
  let changed;
  try {
    changed = syncMirror(sourceDir, mirrorDir, console.warn);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  console.log(changed.length ? `已同步：${changed.join(" ")}` : "镜像已是最新");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
