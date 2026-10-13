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
    hint: "间距只取 DESIGN.md「Layout」阶梯里的刻度。",
  },
  fontSize: {
    label: "任意值字号",
    re: new RegExp(String.raw`${BOUNDARY}text-(?:\[(?:length:[^\]\s]+|(?:calc|clamp|min|max)\([^\]\s]*|[\d.][^\]\s]*)\]|\(length:[^)\s]+\))${END}`, "g"),
    offScale: () => true,
    hint: "字号只取 DESIGN.md「Typography」的阶梯；图形内部的 10px 刻度这类例外写注释并进基线。",
  },
  translate: {
    label: "任意值位移",
    re: new RegExp(String.raw`${BOUNDARY}-?translate(?:-[xyz])?-(?:${ARBITRARY})${END}`, "g"),
    offScale: () => true,
    hint: "任意值位移只留给光学对齐微调，旁边写一行注释说明对齐的是什么。",
  },
  radius: {
    label: "任意值圆角",
    re: new RegExp(String.raw`${BOUNDARY}-?rounded(?:-[a-z]{1,3})?-(?:${ARBITRARY})${END}`, "g"),
    offScale: () => true,
    hint: "圆角一律 0：globals.css 已把所有 rounded-* 映射成 0，不写 rounded-[…] 绕开它；真正的圆（状态点、圆环、品牌圆标）才用 rounded-full。",
  },
  margin: {
    label: "子级外边距",
    re: new RegExp(String.raw`${BOUNDARY}-?m(?:[tby]|b[se])?-(\d+(?:\.\d+)?|px)${END}`, "g"),
    offScale: (match) => match[1] !== "0",
    hint: "间距只有一个主人：兄弟间距由父级 gap / space-* 设，子元素不各自带 mt- / mb- / my- / m-；光学对齐微调改用 translate 并写注释（DESIGN.md「Layout」）。",
  },
  rawColor: {
    label: "裸色值",
    re: /(?<=["'`(:=,\s[])#[0-9a-fA-F]{8}(?![0-9a-zA-Z])|(?<=["'`(:=,\s[])#[0-9a-fA-F]{6}(?![0-9a-zA-Z])|\b(?:oklch|oklab|rgba?|hsla?)\([^)\n]*\)/g,
    offScale: () => true,
    hint: "组件里不写裸 hex / oklch：颜色只用 globals.css 的语义 token 与 signal 系（DESIGN.md「Colors」）。品牌图标、PWA manifest 这类确需原色的，跑 --update 并在 PR 里说明。",
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
    for (const { kind, token, line } of scan(readText(file))) {
      const key = `${kind}:${token}`;
      counts[key] = (counts[key] ?? 0) + 1;
      (hits[key] ??= []).push(`${file}:${line}`);
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
    for (const kind of new Set(grew.map(({ token }) => token.slice(0, token.indexOf(":"))))) {
      console.error(`\n${RULES[kind].label}：${RULES[kind].hint}`);
    }
    console.error("\n确属合规例外时跑 `pnpm design:scale --update` 记进基线，并在 PR 里说明（见 DESIGN.md「交付与合并」）。");
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
