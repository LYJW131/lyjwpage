#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASELINE_PATH = "scripts/design-scale-baseline.json";

export const SPACING_SCALE = new Set(["0", "px", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8"]);

const BOUNDARY = String.raw`(?<=^|[\s"'\`:!{(])`;
const END = String.raw`(?=$|[\s"'\`)}!/])`;
const ARBITRARY = String.raw`\[[^\]\s]*\]|\([^)\s]*\)`;

export const RULES = {
  spacing: {
    label: "阶梯外的间距",
    re: new RegExp(String.raw`${BOUNDARY}-?(?:p(?:b[se]|[xytrblse])?|m(?:b[se]|[xytrblse])?|gap(?:-[xy])?|space-[xy])-(${ARBITRARY}|\d+(?:\.\d+)?|px)${END}`, "g"),
    offScale: (match) => !SPACING_SCALE.has(match[1]),
  },
  fontSize: {
    label: "任意值字号",
    re: new RegExp(String.raw`${BOUNDARY}text-(?:\[(?:length:[^\]\s]+|calc\([^\]\s]*|[\d.][^\]\s]*)\]|\(length:[^)\s]+\))${END}`, "g"),
    offScale: () => true,
  },
  translate: {
    label: "任意值位移",
    re: new RegExp(String.raw`${BOUNDARY}-?translate(?:-[xyz])?-(?:${ARBITRARY})${END}`, "g"),
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

export function countTokens(files, readText) {
  const counts = {};
  const hits = {};
  for (const file of files) {
    for (const { token, line } of scan(readText(file))) {
      counts[token] = (counts[token] ?? 0) + 1;
      (hits[token] ??= []).push(`${file}:${line}`);
    }
  }
  return { counts, hits };
}

export function compare(baseline, counts) {
  const grew = [];
  const shrank = [];
  for (const token of [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort()) {
    const before = baseline[token] ?? 0;
    const after = counts[token] ?? 0;
    if (after > before) grew.push({ token, before, after });
    else if (after < before) shrank.push({ token, before, after });
  }
  return { grew, shrank };
}

export function sortedBaseline(counts) {
  return Object.fromEntries(Object.keys(counts).sort().map((token) => [token, counts[token]]));
}

function trackedSources(root) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src/*.ts", "src/*.tsx"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file, index, all) => file && all.indexOf(file) === index && existsSync(path.join(root, file)) && !/\.test\.m?tsx?$/.test(file));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const update = process.argv.includes("--update");
  const files = trackedSources(root);
  const { counts, hits } = countTokens(files, (file) => readFileSync(path.join(root, file), "utf8"));
  const baselineFile = path.join(root, BASELINE_PATH);

  if (update) {
    writeFileSync(baselineFile, `${JSON.stringify(sortedBaseline(counts), null, 2)}\n`);
    console.log(`已按现状重写 ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { grew, shrank } = compare(baseline, counts);
  for (const { token, before, after } of grew) {
    console.error(`✗ ${token}：${before} → ${after}`);
    for (const at of hits[token]) console.error(`    ${at}`);
  }
  if (grew.length > 0) {
    console.error("\n新代码只用 DESIGN.md 阶梯里的间距与字号。确属图形内部的 10px 刻度或光学对齐微调，跑 `pnpm design:scale --update` 并在 PR 里说明。");
    process.exit(1);
  }
  // 变少不算失败：访客构建（.github/build/implement.md）只能改 src/，写不了这份基线。
  if (shrank.length > 0) {
    console.log(`存量变少：${shrank.map(({ token, before, after }) => `${token} ${before} → ${after}`).join("，")}。跑 \`pnpm design:scale --update\` 收紧基线。`);
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`design:scale 通过（存量 ${total} 处，未增加）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
