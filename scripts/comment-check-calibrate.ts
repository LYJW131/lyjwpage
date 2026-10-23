#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ask, buildRequests, type Found } from "./comment-check.ts";

const USAGE = `用法：NODE_USE_ENV_PROXY=1 node scripts/comment-check-calibrate.ts [--cases <文件>] [--runs <次数>]
拿标注过的注释集（默认 scripts/comment-check-cases.json，delete 为该删）问 Jev，按几个阈值给出精确率、召回率，列出 0.7 下判错的条目。
改 scripts/comment-check.ts 的 RULE、CRITERIA 或阈值前后各跑一遍对比。`;

const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

type Case = Pick<Found, "file" | "comment" | "code"> & { delete: boolean; source: string };

export function score(cases: Case[], p: number[], threshold: number) {
  let tp = 0, fp = 0, fn = 0;
  cases.forEach((item, i) => {
    const flagged = (p[i] ?? 0) >= threshold;
    if (flagged && item.delete) tp += 1;
    else if (flagged) fp += 1;
    else if (item.delete) fn += 1;
  });
  return { threshold, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1 };
}

async function main(argv: string[]) {
  const { values } = parseArgs({ args: argv, strict: true, options: { cases: { type: "string", default: "scripts/comment-check-cases.json" }, runs: { type: "string", default: "1" }, help: { type: "boolean", default: false } } });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const cases = JSON.parse(fs.readFileSync(values.cases, "utf8")) as Case[];
  const found = cases.map((item) => ({ ...item, line: 1, endLine: 1 }));
  for (let run = 1; run <= Number(values.runs); run += 1) {
    const answers = await Promise.all(buildRequests(found).map((body) => ask(body)));
    const p: number[] = [];
    for (const batch of answers) for (const [key, answer] of Object.entries(batch)) if (typeof answer.noul === "number") p[Number(key.slice(1))] = answer.noul;
    console.log(`\n第 ${run} 次：${cases.length} 条，该删 ${cases.filter((item) => item.delete).length}`);
    for (const row of THRESHOLDS.map((t) => score(cases, p, t))) console.log(`  ≥${row.threshold}  精确率 ${row.precision.toFixed(2)}  召回率 ${row.recall.toFixed(2)}  （对 ${row.tp}，误报 ${row.fp}，漏 ${row.fn}）`);
    cases.forEach((item, i) => {
      const flagged = (p[i] ?? 0) >= 0.7;
      if (flagged !== item.delete) console.log(`  ${flagged ? "误报" : "漏"} ${(p[i] ?? NaN).toFixed(2)} ${item.source} ${item.file}  ${item.comment.split("\n")[0]?.slice(0, 80)}`);
    });
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
