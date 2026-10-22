#!/usr/bin/env node
// 交互式 HTML 计划书（.claude/skills/lyjwpage-html-plan/SKILL.md）：先查计划 JSON 有没有 Claude 写计划时的常见毛病，过了再套模板出页面。
//
//   node scripts/html-plan.ts check <plan.json>
//   node scripts/html-plan.ts build <plan.json> --out <page.html>
//
// 退出码：0 通过（警告不挡）、1 有错误、2 参数错。build 有错误时不写页面。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { scriptJson } from "../src/lib/inline-script.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(REPO_ROOT, ".claude/skills/lyjwpage-html-plan/template.html");

// 上限照 Thariq 的 html-plan 公开描述：树最多三层、每条最多五个子项、每份二到五个决定。一份计划只有一个决定也放行，不逼人编假分叉。
export const MAX_DEPTH = 3;
export const MAX_CHILDREN = 5;
export const MAX_TOP = 6;
export const MAX_DECISIONS = 5;
export const MAX_SENTENCE = 60;
export const MAX_SENTENCES = 2;
export const MAX_CODE_LINES = 30;

const EXHIBITS_BY_LEVEL: Record<number, string[]> = {
  1: ["mock", "states", "table"],
  2: ["calls", "schema", "code", "table", "states"],
  3: ["code", "files"],
};

const THIRD_PERSON = /站主|站长|\bowner\b/i;
const BARE_URL = /https?:\/\/\S+/;
const CLOCK = /(?<![\d:])\d{1,2}:\d{2}(?![\d:])/;

export type Exhibit = {
  kind: string;
  html?: string | string[];
  by?: string;
  height?: number;
  rows?: string[][];
  head?: string[];
  text?: string;
  lang?: string;
  file?: string;
  symbol?: string;
  line?: number;
  files?: { file: string; symbol?: string; change: string }[];
};

export type Claim = { id: string; text: string; exhibit?: Exhibit; children?: Claim[] };

export type Decision = {
  id: string;
  under: string;
  q: string;
  options: { label: string; effect: string }[];
  default: number;
  why?: string;
};

export type Plan = { id: string; title: string; summary: string; kicker?: string; claims: Claim[]; decisions: Decision[] };

export type Repo = { exists(file: string): boolean; read(file: string): string };

export type Report = { errors: string[]; warnings: string[] };

export const diskRepo: Repo = {
  exists: (file) => existsSync(path.join(REPO_ROOT, file)),
  read: (file) => readFileSync(path.join(REPO_ROOT, file), "utf8"),
};

function sentences(text: string): string[] {
  return text.replace(/`[^`]*`/g, "X").split(/[。！？；!?;]|\.\s/).map((s) => s.trim()).filter(Boolean);
}

function proseIssues(where: string, text: string, report: Report) {
  if (!text?.trim()) {
    report.errors.push(`${where}：没有文字`);
    return;
  }
  if (/\n/.test(text)) report.errors.push(`${where}：一条主张写成了多段。拆成子项，或把细节放进展品`);
  if (/^\s*(?:[-*•]|\d+[.、])\s/m.test(text)) report.errors.push(`${where}：主张里写了列表。列表改成子项`);
  const parts = sentences(text);
  if (parts.length > MAX_SENTENCES) report.errors.push(`${where}：${parts.length} 句，超过 ${MAX_SENTENCES} 句。只写结论，理由放进展品`);
  for (const part of parts) {
    if ([...part].length > MAX_SENTENCE) report.errors.push(`${where}：句子 ${[...part].length} 字，超过 ${MAX_SENTENCE}。拆短：「${part.slice(0, 20)}…」`);
  }
  if (THIRD_PERSON.test(text)) report.errors.push(`${where}：第三人称写 lyjw，不写站主、站长、owner`);
  if (BARE_URL.test(text)) report.errors.push(`${where}：正文里有裸链接。链接放进展品或删掉`);
  if (CLOCK.test(text) && !/SGT/.test(text)) report.warnings.push(`${where}：有时刻没写时区，给 lyjw 看的时间用 SGT`);
}

function symbolIn(repo: Repo, file: string, symbol: string): boolean {
  return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(repo.read(file));
}

function locationIssues(where: string, file: string | undefined, symbol: string | undefined, repo: Repo, report: Report, required: boolean) {
  if (!file) {
    if (required) report.errors.push(`${where}：第三层要写代码在哪（file）`);
    return;
  }
  if (!repo.exists(file)) {
    report.errors.push(`${where}：${file} 不存在。新文件写成 files 展品，change 里写「新建」`);
    return;
  }
  if (symbol && !symbolIn(repo, file, symbol)) report.errors.push(`${where}：${file} 里找不到 ${symbol}`);
}

function exhibitIssues(where: string, level: number, exhibit: Exhibit | undefined, decisionIds: Set<string>, repo: Repo, report: Report) {
  if (!exhibit) {
    report.errors.push(`${where}：没有展品。每条主张配一件证据`);
    return;
  }
  const allowed = EXHIBITS_BY_LEVEL[level] ?? [];
  if (!allowed.includes(exhibit.kind)) report.errors.push(`${where}：第 ${level} 层不用 ${exhibit.kind}，可用 ${allowed.join("、")}`);
  if (exhibit.kind === "mock") {
    const variants = Array.isArray(exhibit.html) ? exhibit.html : [exhibit.html];
    if (variants.some((html) => !html?.trim())) report.errors.push(`${where}：草图没有内容`);
    if (variants.some((html) => html && /<script/i.test(html))) report.errors.push(`${where}：草图不放脚本，页面会拦下`);
    if (Array.isArray(exhibit.html) && !exhibit.by) report.errors.push(`${where}：草图有多个版本，要写 by 指向哪个决定`);
    if (exhibit.by && !decisionIds.has(exhibit.by)) report.errors.push(`${where}：草图的 by 指向不存在的决定 ${exhibit.by}`);
  }
  if (exhibit.kind === "code" || exhibit.kind === "schema" || exhibit.kind === "calls") {
    if (!exhibit.text?.trim()) report.errors.push(`${where}：${exhibit.kind} 没有内容`);
    const lines = exhibit.text?.split("\n").length ?? 0;
    if (lines > MAX_CODE_LINES) report.errors.push(`${where}：代码 ${lines} 行，超过 ${MAX_CODE_LINES}。只留要 lyjw 看的那段`);
  }
  if (exhibit.kind === "code") locationIssues(where, exhibit.file, exhibit.symbol, repo, report, level === 3);
  if (exhibit.kind === "files") {
    if (!exhibit.files?.length) report.errors.push(`${where}：files 是空的`);
    for (const entry of exhibit.files ?? []) {
      if (/新建|新增/.test(entry.change)) continue;
      locationIssues(where, entry.file, entry.symbol, repo, report, true);
    }
  }
  if (exhibit.kind === "table" || exhibit.kind === "states") {
    if (!exhibit.rows?.length) report.errors.push(`${where}：${exhibit.kind} 没有行`);
  }
}

export function lintPlan(plan: Plan, repo: Repo = diskRepo): Report {
  const report: Report = { errors: [], warnings: [] };
  if (!plan.id || !/^[a-z0-9-]+$/.test(plan.id)) report.errors.push("id：用小写字母、数字和连字符");
  if (!plan.title?.trim()) report.errors.push("title：没有标题");
  if ([...(plan.title ?? "")].length > 24) report.errors.push("title：标题超过 24 字，写成短名称");
  proseIssues("summary", plan.summary, report);

  const decisionIds = new Set((plan.decisions ?? []).map((d) => d.id));
  const claimIds = new Set<string>();
  const top = plan.claims ?? [];
  if (top.length < 2) report.errors.push("claims：第一层少于 2 条。一条就说完的事不用计划书");
  if (top.length > MAX_TOP) report.errors.push(`claims：第一层 ${top.length} 条，超过 ${MAX_TOP}。合并，或拆成两份计划`);

  const walk = (claims: Claim[], level: number, prefix: string) => {
    claims.forEach((claim, index) => {
      const where = `${prefix}${index + 1}`;
      if (!claim.id) report.errors.push(`${where}：没有 id`);
      else if (claimIds.has(claim.id)) report.errors.push(`${where}：id ${claim.id} 重复`);
      claimIds.add(claim.id);
      proseIssues(where, claim.text, report);
      exhibitIssues(where, level, claim.exhibit, decisionIds, repo, report);
      const children = claim.children ?? [];
      if (children.length > MAX_CHILDREN) report.errors.push(`${where}：${children.length} 个子项，超过 ${MAX_CHILDREN}`);
      if (children.length && level >= MAX_DEPTH) report.errors.push(`${where}：树超过 ${MAX_DEPTH} 层`);
      else walk(children, level + 1, `${where}.`);
    });
  };
  walk(top, 1, "");

  const decisions = plan.decisions ?? [];
  if (decisions.length > MAX_DECISIONS) report.errors.push(`decisions：${decisions.length} 个，超过 ${MAX_DECISIONS}。只问会改变做什么的分叉，其余自己定`);
  if (decisions.length === 0) report.warnings.push("decisions：没有要 lyjw 定的事。真没有就不用计划书，直接做");
  const seen = new Set<string>();
  for (const decision of decisions) {
    const where = `决定 ${decision.id}`;
    if (seen.has(decision.id)) report.errors.push(`${where}：id 重复`);
    seen.add(decision.id);
    if (!claimIds.has(decision.under)) report.errors.push(`${where}：under 指向不存在的主张 ${decision.under}`);
    proseIssues(`${where} 的问题`, decision.q, report);
    if (!/[？?]$/.test(decision.q?.trim() ?? "")) report.errors.push(`${where}：问题要写成问句`);
    const options = decision.options ?? [];
    if (options.length < 2 || options.length > 4) report.errors.push(`${where}：选项 ${options.length} 个，要 2 到 4 个`);
    if (!Number.isInteger(decision.default) || decision.default < 0 || decision.default >= options.length) report.errors.push(`${where}：default 要指向一个选项`);
    options.forEach((option, index) => {
      if (!option.label?.trim() || [...option.label].length > 20) report.errors.push(`${where} 选项 ${index + 1}：label 要有，且不超过 20 字`);
      proseIssues(`${where} 选项 ${index + 1} 的后果`, option.effect, report);
    });
    if (!decision.why?.trim()) report.warnings.push(`${where}：没写为什么推荐默认项`);
  }
  return report;
}

export function renderPlan(plan: Plan, template: string): string {
  const escaped = plan.title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return template.replace("{{TITLE}}", escaped).replace("{{PLAN}}", scriptJson(plan));
}

function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, help: { type: "boolean" } } });
  const [command, file] = positionals;
  if (values.help || !file || (command !== "check" && command !== "build") || (command === "build" && !values.out)) {
    console.error("用法：node scripts/html-plan.ts check <plan.json> | build <plan.json> --out <page.html>");
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(file, "utf8")) as Plan;
  const report = lintPlan(plan);
  for (const error of report.errors) console.error(`错误  ${error}`);
  for (const warning of report.warnings) console.error(`警告  ${warning}`);
  if (report.errors.length) process.exit(1);
  if (command === "build") {
    writeFileSync(values.out!, renderPlan(plan, readFileSync(TEMPLATE, "utf8")));
    console.error(`已写 ${values.out}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
