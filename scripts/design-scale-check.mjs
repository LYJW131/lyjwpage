#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASELINE_PATH = "scripts/design-scale-baseline.json";

export const SPACING_SCALE = new Set(["0", "px", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8"]);

const BOUNDARY = String.raw`(?<=^|[\s"'\`:!{(])`;
const END = String.raw`(?=$|[\s"'\`)}])`;

export const RULES = {
  spacing: {
    label: "阶梯外的间距",
    re: new RegExp(String.raw`${BOUNDARY}-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(\[[^\]\s]*\]|\d+(?:\.\d+)?|px)${END}`, "g"),
    offScale: (match) => !SPACING_SCALE.has(match[1]),
  },
  fontSize: {
    label: "任意值字号",
    re: new RegExp(String.raw`${BOUNDARY}text-\[[\d.][^\]\s]*\]${END}`, "g"),
    offScale: () => true,
  },
  translate: {
    label: "任意值位移",
    re: new RegExp(String.raw`${BOUNDARY}-?translate-[xy]-\[[^\]\s]*\]${END}`, "g"),
    offScale: () => true,
  },
};

export function scan(text) {
  const hits = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const [kind, rule] of Object.entries(RULES)) {
      for (const match of line.matchAll(rule.re)) {
        if (rule.offScale(match)) hits.push({ kind, token: match[0], line: index + 1 });
      }
    }
  });
  return hits;
}

export function countByFile(files, readText) {
  const counts = {};
  const hits = {};
  for (const file of files) {
    const found = scan(readText(file));
    if (found.length === 0) continue;
    hits[file] = found;
    counts[file] = {};
    for (const { kind } of found) counts[file][kind] = (counts[file][kind] ?? 0) + 1;
  }
  return { counts, hits };
}

export function compare(baseline, counts) {
  const grew = [];
  const shrank = [];
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
    for (const kind of Object.keys(RULES)) {
      const before = baseline[file]?.[kind] ?? 0;
      const after = counts[file]?.[kind] ?? 0;
      if (after > before) grew.push({ file, kind, before, after });
      else if (after < before) shrank.push({ file, kind, before, after });
    }
  }
  return { grew, shrank };
}

export function sortedBaseline(counts) {
  const out = {};
  for (const file of Object.keys(counts).sort()) {
    out[file] = {};
    for (const kind of Object.keys(RULES)) if (counts[file][kind]) out[file][kind] = counts[file][kind];
  }
  return out;
}

function trackedSources(root) {
  return execFileSync("git", ["ls-files", "-z", "--", "src/*.ts", "src/*.tsx"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && !/\.test\.m?tsx?$/.test(file));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const update = process.argv.includes("--update");
  const files = trackedSources(root);
  const { counts, hits } = countByFile(files, (file) => readFileSync(path.join(root, file), "utf8"));
  const baselineFile = path.join(root, BASELINE_PATH);

  if (update) {
    writeFileSync(baselineFile, `${JSON.stringify(sortedBaseline(counts), null, 2)}\n`);
    console.log(`已按现状重写 ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { grew, shrank } = compare(baseline, counts);
  for (const { file, kind, before, after } of grew) {
    console.error(`✗ ${file}：${RULES[kind].label} ${before} → ${after}`);
    for (const hit of hits[file].filter((h) => h.kind === kind)) console.error(`    ${file}:${hit.line}  ${hit.token}`);
  }
  for (const { file, kind, before, after } of shrank) {
    console.error(`✗ ${file}：${RULES[kind].label} ${before} → ${after}，基线没跟着收紧`);
  }
  if (grew.length > 0) {
    console.error("\n新代码只用 DESIGN.md 阶梯里的间距与字号。确属图形内部的 10px 刻度或光学对齐微调，跑 `pnpm design:scale --update` 并在 PR 里说明。");
  }
  if (shrank.length > 0) {
    console.error("\n违规变少了：跑 `pnpm design:scale --update` 把基线收紧后一起提交。");
  }
  if (grew.length > 0 || shrank.length > 0) process.exit(1);
  const total = Object.values(counts).reduce((sum, kinds) => sum + Object.values(kinds).reduce((a, b) => a + b, 0), 0);
  console.log(`design:scale 通过（存量 ${total} 处，未增加）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
