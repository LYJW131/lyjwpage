#!/usr/bin/env node
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { client, type FetchLike, type Pull } from "./pr-gate/github.ts";
import { parseBody } from "./verify-action/body.ts";

const HELP = `用法：node scripts/verify-jev.ts --pr <号> [--out <文件.json>]
试验：让 TypeSafe Jev（System One，决策模型）读 PR 的 diff、验证清单与 lyjw 原话，逐项给出概率，和 Verify Action 的 Haiku 验证员对照。
结果只写进 Action 的 job summary 与 --out 文件，不发 PR 评论，不进回执、判定，也不给写代码的线程看。
GITHUB_TOKEN 读 PR，TYPESAFE_API_KEY 调 Jev（云端出口代理会自动带上）。`;

export const JEV_MODEL = "jev-1.14.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// 官方建议 noul 起步阈值：≥0.7 当是，≤0.3 当否，中间算拿不准
export const YES = 0.7;
export const NO = 0.3;
// 默认上下文每题 32k token；超过就开 Long-Context（官方说更慢、更不准），再大就截断
const LONG_CONTEXT_CHARS = 60_000;
const MAX_DIFF_CHARS = 600_000;
const MAX_FILE_QUESTIONS = 40;
const SKIP = [/^pnpm-lock\.yaml$/, /-baseline\.json$/, /\.svg$/, /^docs\/diagrams\//, /^\.claude\/memory\//];

type FullPull = Pull & { head: { sha: string }; body?: string | null; title: string };
type FileDiff = { filename: string; status: string; patch?: string };
type Noul = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };
type Answer = { type: string; noul?: number };

const BUG: Noul["criteria"] = {
  true: "The changed lines will misbehave at runtime: wrong condition or comparison, wrong variable or field, off-by-one, missing case, broken control flow, wrong units, or a call that no longer matches its callee.",
  false: "The changed lines behave as their surrounding code and names intend, or the file is documentation, configuration text or tests that only describe behavior.",
};

export function buildRequest(pull: FullPull, files: FileDiff[]) {
  const { checklist, words } = parseBody(pull.body);
  let budget = MAX_DIFF_CHARS;
  const diffs = files
    .filter((file) => file.patch && !SKIP.some((re) => re.test(file.filename)))
    .map((file) => {
      const patch = (file.patch ?? "").slice(0, Math.max(0, budget));
      budget -= patch.length;
      return { file: file.filename, status: file.status, patch };
    })
    .filter((file) => file.patch);
  const state = {
    pr_title: pull.title,
    checklist: Object.fromEntries(checklist.map((item) => [item.id, item.text])),
    lyjw_words: words ?? pull.body ?? "",
    diff: diffs,
  };
  const questions: Record<string, Noul> = {
    asks_done: {
      type: "noul",
      instructions: "`lyjw_words` is what the site owner asked for, in Chinese. Does `diff` fully do what `lyjw_words` asks?",
    },
    bug: {
      type: "noul",
      instructions: "Does any file in `diff` introduce a bug in the changed lines?",
      criteria: BUG,
    },
    unasked: {
      type: "noul",
      instructions: "Does `diff` change runtime behavior that neither `lyjw_words` nor `checklist` mentions?",
    },
    doc_mismatch: {
      type: "noul",
      instructions: "Does a comment or documentation line added in `diff` describe the code differently from what the code in `diff` does?",
    },
  };
  for (const item of checklist) {
    questions[`check_${item.id}`] = {
      type: "noul",
      instructions: `\`checklist.${item.id}\` is a check the author promised will pass. Judging only from \`diff\`, will \`checklist.${item.id}\` pass?`,
    };
  }
  diffs.slice(0, MAX_FILE_QUESTIONS).forEach((file, index) => {
    questions[`file_${index}`] = {
      type: "noul",
      instructions: `Does the change to \`diff[${index}]\` (${file.file}) introduce a bug in its changed lines?`,
      criteria: BUG,
    };
  });
  const body = { model: JEV_MODEL, state, questions };
  return { body, long: JSON.stringify(body).length > LONG_CONTEXT_CHARS, diffs, checklist };
}

const verdict = (p: number | undefined) => (p === undefined ? "—" : p >= YES ? "是" : p <= NO ? "否" : "拿不准");
const pct = (p: number | undefined) => (p === undefined ? "—" : p.toFixed(2));

export function summary(opts: {
  pr: number;
  head: string;
  ms: number;
  long: boolean;
  usage?: { input_tokens?: number };
  answers: Record<string, Answer>;
  diffs: { file: string }[];
  checklist: { id: string; text: string }[];
  error?: string;
}) {
  const lines = [`## Jev 对照试验 #${opts.pr}（${opts.head.slice(0, 7)}）`, "", "只作对比：不进回执、判定，不发 PR 评论。"];
  if (opts.error) return [...lines, "", `调用失败：${opts.error}`].join("\n");
  const p = (key: string) => opts.answers[key]?.noul;
  lines.push(
    "",
    `模型 ${JEV_MODEL}，耗时 ${(opts.ms / 1000).toFixed(1)} s，输入 ${opts.usage?.input_tokens ?? "?"} token${opts.long ? "，开了 Long-Context" : ""}。阈值 ≥${YES} 是、≤${NO} 否。`,
    "",
    "| 问题 | 概率 | 读作 |",
    "| --- | --- | --- |",
    `| 做到了 lyjw 要的 | ${pct(p("asks_done"))} | ${verdict(p("asks_done"))} |`,
    `| 改出了 bug | ${pct(p("bug"))} | ${verdict(p("bug"))} |`,
    `| 改了没要求的行为 | ${pct(p("unasked"))} | ${verdict(p("unasked"))} |`,
    `| 注释或文档与代码不符 | ${pct(p("doc_mismatch"))} | ${verdict(p("doc_mismatch"))} |`,
    ...opts.checklist.map((item) => `| ${item.id} 会通过 | ${pct(p(`check_${item.id}`))} | ${verdict(p(`check_${item.id}`))} |`),
  );
  const files = opts.diffs
    .map((file, index) => ({ file: file.file, p: p(`file_${index}`) }))
    .filter((row) => row.p !== undefined)
    .sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
  if (files.length) {
    lines.push("", "逐文件「改出了 bug」：", "", "| 文件 | 概率 | 读作 |", "| --- | --- | --- |");
    for (const row of files) lines.push(`| \`${row.file}\` | ${pct(row.p)} | ${verdict(row.p)} |`);
  }
  return lines.join("\n");
}

async function ask(body: unknown, long: boolean, fetchImpl: typeof fetch) {
  const key = process.env.TYPESAFE_API_KEY;
  const started = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(long ? { "TypeSafe-Danger-Zone-Long-Context": "true" } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.ok) {
      const json = (await response.json()) as { model?: string; answers?: Record<string, Answer>; usage?: { input_tokens?: number } };
      return { ...json, ms: Date.now() - started };
    }
    if (attempt >= 4 || ![429, 529].includes(response.status)) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    await sleep(2 ** attempt * 1000);
  }
}

export async function main(argv: string[], fetchImpl: typeof fetch = fetch) {
  const { values } = parseArgs({ args: argv, strict: true, options: { pr: { type: "string" }, out: { type: "string", default: "" }, help: { type: "boolean", default: false } } });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0) throw new Error("缺 --pr");
  const gh = client(fetchImpl as FetchLike);
  const [pull, files] = await Promise.all([gh.get<FullPull>(`pulls/${pr}`), gh.all<FileDiff>(`pulls/${pr}/files`)]);
  const { body, long, diffs, checklist } = buildRequest(pull, files);
  const base = { pr, head: pull.head.sha, diffs, checklist };
  let record: Record<string, unknown>;
  let text: string;
  try {
    const result = await ask(body, long, fetchImpl);
    record = { ...base, model: result.model, ms: result.ms, long, usage: result.usage, answers: result.answers };
    text = summary({ ...base, ms: result.ms, long, usage: result.usage, answers: result.answers ?? {} });
  } catch (error) {
    record = { ...base, error: (error as Error).message };
    text = summary({ ...base, ms: 0, long, answers: {}, error: (error as Error).message });
  }
  if (values.out) fs.writeFileSync(values.out, JSON.stringify(record, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(text);
  return record.error ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
