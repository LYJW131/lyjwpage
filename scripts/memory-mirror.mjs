#!/usr/bin/env node
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MIRROR_KEEP = new Set(["README.md"]);

const REDACTIONS = [
  [/^ {2}modified: .*\n/gm, ""],
  [/https:\/\/claude\.ai\/\S*artifact\/[\w-]+/g, "<private claude.ai link>"],
  [/\b(?:env|session|cse|cagt)_[0-9A-Za-z]{10,}\b/g, "<internal id>"],
  [/\/Users\/[^/\s]+\//g, "~/"],
];

export function sanitize(text) {
  return REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export function syncMirror(sourceDir, mirrorDir) {
  const sources = readdirSync(sourceDir).filter((name) => name.endsWith(".md") && !name.startsWith("."));
  const changed = [];
  for (const name of sources) {
    const next = sanitize(readFileSync(path.join(sourceDir, name), "utf8"));
    let current = null;
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
    console.error("用法：node scripts/memory-mirror.mjs <项目记忆目录> [镜像目录，默认 .claude/memory]");
    process.exit(2);
  }
  const changed = syncMirror(sourceDir, mirrorDir);
  console.log(changed.length ? `已同步：${changed.join(" ")}` : "镜像已是最新");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
