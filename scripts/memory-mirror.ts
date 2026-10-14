#!/usr/bin/env node
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MIRROR_KEEP = new Set(["README.md"]);

const REDACTIONS: [RegExp, string][] = [
  [/^ {2}modified: .*\n/gm, ""],
  [/https:\/\/claude\.ai\/\S*artifact\/[\w-]+/g, "<private claude.ai link>"],
  [/\b(?:env|session|cse|cagt)_[0-9A-Za-z]{10,}\b/g, "<internal id>"],
  [/\/Users\/[^/\s]+\//g, "~/"],
];

// 云端环境的显示名不是凭据，但同样不进公开镜像；新建环境时把名字加进来
export const CLOUD_ENV_NAMES = ["lyjwMain", "lyjwpage-build", "lyjwpage-canary"];

const SECRET_PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Anthropic / OpenAI key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["secret assignment", /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|NPSSO)[A-Z0-9_]*\s*[:=]\s*["']?(?![$<"'`])[^\s"'`]{8,}/],
  ["opaque token", /(?<![\w/.-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}(?![\w/.-])/],
];

export function sanitize(text: string) {
  const redacted = REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
  return CLOUD_ENV_NAMES.reduce((out, name) => out.replaceAll(name, "<cloud env>"), redacted);
}

export function findSecrets(text: string) {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function syncMirror(sourceDir: string, mirrorDir: string) {
  const sources = readdirSync(sourceDir).filter((name) => name.endsWith(".md") && !name.startsWith("."));
  const outputs = new Map(sources.map((name) => [name, sanitize(readFileSync(path.join(sourceDir, name), "utf8"))]));
  const leaks = [...outputs].flatMap(([name, text]) => findSecrets(text).map((label) => `${name}: ${label}`));
  if (leaks.length) throw new Error(`疑似凭据，未写入任何文件（先在项目记忆里删掉，或扩充 sanitize）：\n${leaks.join("\n")}`);
  const changed: string[] = [];
  for (const [name, next] of outputs) {
    let current: string | null = null;
    try {
      current = readFileSync(path.join(mirrorDir, name), "utf8");
    } catch {}
    if (current !== next) {
      writeFileSync(path.join(mirrorDir, name), next);
      changed.push(name);
    }
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
    changed = syncMirror(sourceDir, mirrorDir);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  console.log(changed.length ? `已同步：${changed.join(" ")}` : "镜像已是最新");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
