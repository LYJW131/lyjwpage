import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Finding } from "../lib/review-body.js";
import { type Case, caseWorkspace, loadCases } from "./cases.js";

// 跑评审员的那一侧每个 (用例, 轮次) 写一份：findings 为 null 表示没交出能解析的结果。
export type Raw = {
  case_id: string;
  rep: number;
  findings: Finding[] | null;
  reply?: string;
  error?: string;
  latency_s?: number;
  tool_calls?: number;
  model?: string;
};
type Verdict = "match" | "real" | "edge" | "wrong" | "unsure";
type Grade = { index: number; matches: string[]; verdict: Verdict; reason: string };

const { values } = parseArgs({
  options: {
    variant: { type: "string" },
    concurrency: { type: "string", default: "4" },
    model: { type: "string", default: "claude-opus-5-5" },
    effort: { type: "string", default: "high" },
  },
});
if (!values.variant) {
  throw new Error("usage: judge.ts --variant <flow>/<variant>");
}
const VARIANT = values.variant;
const JUDGE_TIMEOUT_MS = 15 * 60_000;
const PROMPT = await readFile(new URL("./judge.txt", import.meta.url), "utf8");
const CASES = await loadCases();

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          matches: { type: "array", items: { type: "string" } },
          verdict: { type: "string", enum: ["match", "real", "edge", "wrong", "unsure"] },
          reason: { type: "string" },
        },
        required: ["index", "matches", "verdict", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["grades"],
  additionalProperties: false,
});

function labels(item: Case) {
  return [
    ...item.gold.mustFind.map((label, i) => ({ id: `M${i + 1}`, label })),
    ...item.gold.later.map((label, i) => ({ id: `L${i + 1}`, label })),
    ...item.gold.shouldNotReport.map((label, i) => ({ id: `N${i + 1}`, label })),
  ];
}

// 评审 bot 的评论尾巴（Devin 的徽章、Codex 的反馈提示）与 HTML 对判分没用。
function clean(comment: string) {
  return comment
    .split(/\n<a href=|\n---\n\*Was this helpful|\nUseful\? React/)[0]
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

function message(item: Case, findings: Finding[]) {
  const out = [`Pull request #${item.number}: ${item.title}`, "", "## Labels", ""];
  const all = labels(item);
  if (all.length === 0) {
    out.push("None. Other reviewers raised nothing on this pull request.", "");
  }
  for (const { id, label } of all) {
    out.push(`[${id}] ${label.kind} · ${label.path}:${label.line ?? "?"} · ${label.title}`, clean(label.comment));
    if (label.reply) {
      out.push(`Reply: ${label.reply.slice(0, 400)}`);
    }
    out.push("");
  }
  out.push("## Findings", "");
  findings.forEach((f, i) => {
    out.push(`[${i}] ${f.kind} ${f.severity} · ${f.file}:${f.line} · ${f.title}`, f.detail, "");
  });
  return out.join("\n");
}

// 裁判走 lyjw 的 Claude 订阅（`claude -p`）；不读任何设置与 CLAUDE.md，只给只读工具。
function claude(cwd: string, input: string): Promise<Record<string, unknown>> {
  const env = { ...process.env };
  for (const key of [
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_REMOTE_SESSION_ID",
    "CLAUDE_ADDITIONAL_DIRECTORIES",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD",
  ]) {
    delete env[key];
  }
  const args = [
    "-p",
    "--model",
    values.model!,
    "--effort",
    values.effort!,
    "--system-prompt",
    PROMPT,
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--tools",
    "Read,Grep,Glob",
    "--allowedTools",
    "Read,Grep,Glob",
    "--json-schema",
    SCHEMA,
    "--output-format",
    "json",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env, timeout: JUDGE_TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`claude exited ${code ?? signal}: ${(stderr || stdout).slice(-800)}`));
      }
    });
    child.stdin.end(input);
  });
}

function check(grades: Grade[], findings: Finding[], ids: Set<string>) {
  if (grades.length !== findings.length) {
    throw new Error(`judge returned ${grades.length} grades for ${findings.length} findings`);
  }
  grades.forEach((g, i) => {
    if (g.index !== i) throw new Error(`grade ${i} has index ${g.index}`);
    const unknown = g.matches.filter((id) => !ids.has(id));
    if (unknown.length > 0) throw new Error(`grade ${i} matches unknown ${unknown.join(",")}`);
    if ((g.verdict === "match") !== g.matches.length > 0) throw new Error(`grade ${i} verdict/matches disagree`);
  });
}

// 召回只数 M；L 提前报出算加分；N 里 policy 的不计，其余报成 high / medium 记一次。
// 同一个问题先被回「不改」、后来又修掉时会同时对上 N 和 M / L，以修掉为准。
function score(item: Case, findings: Finding[], grades: Grade[]) {
  const must = item.gold.mustFind.length;
  const policy = new Set(
    item.gold.shouldNotReport.flatMap((label, i) => (label.reason === "policy" ? [`N${i + 1}`] : [])),
  );
  const hits = new Set<string>();
  const later = new Set<string>();
  let negHits = 0;
  let falseAlarms = 0;
  let realExtra = 0;
  let unsure = 0;
  grades.forEach((g, i) => {
    const loud = findings[i].severity !== "low";
    for (const id of g.matches) {
      if (id.startsWith("M")) hits.add(id);
      if (id.startsWith("L")) later.add(id);
    }
    const fixedLater = g.matches.some((id) => !id.startsWith("N"));
    if (loud && !fixedLater && g.matches.some((id) => id.startsWith("N") && !policy.has(id))) negHits += 1;
    if (g.verdict === "wrong" || (g.verdict === "edge" && loud)) falseAlarms += 1;
    if (g.verdict === "real") realExtra += 1;
    if (g.verdict === "unsure") unsure += 1;
  });
  const grade: Record<string, number> = {
    false_alarms: falseAlarms,
    neg_hits: negHits,
    real_extra: realExtra,
    later_hits: later.size,
    findings: findings.length,
    unsure,
  };
  if (must > 0) grade.recall = hits.size / must;
  return { grade, must_total: must, must_hit: hits.size, matched: [...hits, ...later].sort() };
}

async function done(path: string) {
  if (!existsSync(path)) return new Set<string>();
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  return new Set(lines.map((line) => JSON.parse(line)).map((row) => `${row.case_id}#${row.rep}`));
}

async function judgeOne(raw: Raw) {
  const item = CASES.get(raw.case_id);
  if (!item) throw new Error(`unknown case ${raw.case_id}`);
  const findings = raw.findings ?? [];
  let grades: Grade[] = [];
  let judge: Record<string, unknown> = {};
  if (findings.length > 0) {
    const cwd = await caseWorkspace(item);
    const input = message(item, findings);
    const ids = new Set(labels(item).map((l) => l.id));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        judge = await claude(cwd, input);
        grades = ((judge.structured_output as { grades?: Grade[] } | undefined)?.grades ?? []) as Grade[];
        check(grades, findings, ids);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }
  const { grade, must_total, must_hit, matched } = score(item, findings, grades);
  await mkdir(join(VARIANT, "traces"), { recursive: true });
  await writeFile(
    join(VARIANT, "traces", `${raw.case_id.replaceAll("/", "_")}_rep${raw.rep}.judge.json`),
    JSON.stringify({ findings, grades, judge }, null, 2),
  );
  return {
    case_id: raw.case_id,
    rep: raw.rep,
    split: item.split,
    status: "ok",
    model: raw.model,
    grade,
    must_total,
    must_hit,
    matched,
    latency_s: raw.latency_s,
    tool_calls: raw.tool_calls,
    judge_cost_usd: judge.total_cost_usd,
    judge_turns: judge.num_turns,
  };
}

async function main() {
  const resultsPath = join(VARIANT, "results.jsonl");
  const errorsPath = join(VARIANT, "errors.jsonl");
  const seen = await done(resultsPath);
  const rawDir = join(VARIANT, "raw");
  const raws: Raw[] = [];
  for (const name of (await readdir(rawDir)).filter((n) => n.endsWith(".json")).sort()) {
    const raw = JSON.parse(await readFile(join(rawDir, name), "utf8")) as Raw;
    if (!seen.has(`${raw.case_id}#${raw.rep}`)) raws.push(raw);
  }
  let next = 0;
  async function worker() {
    while (next < raws.length) {
      const raw = raws[next++];
      if (raw.error || raw.findings === null) {
        await appendFile(errorsPath, `${JSON.stringify({ case_id: raw.case_id, rep: raw.rep, class: "agent", error: raw.error ?? "no post_findings" })}\n`);
        continue;
      }
      try {
        const row = await judgeOne(raw);
        await appendFile(resultsPath, `${JSON.stringify(row)}\n`);
        console.log(`${raw.case_id} rep${raw.rep} ${JSON.stringify(row.grade)}`);
      } catch (error) {
        await appendFile(errorsPath, `${JSON.stringify({ case_id: raw.case_id, rep: raw.rep, class: "judge", error: String(error) })}\n`);
        console.error(`${raw.case_id} rep${raw.rep} judge failed: ${String(error).slice(0, 300)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  await summarize(resultsPath);
}

async function summarize(resultsPath: string) {
  if (!existsSync(resultsPath)) return;
  const rows = (await readFile(resultsPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const splits: Record<string, Record<string, number>> = {};
  for (const split of ["train", "val", "test", "all"]) {
    const pick = rows.filter((r) => split === "all" || r.split === split);
    const sum = (key: string) => pick.reduce((acc, r) => acc + (r.grade[key] ?? 0), 0);
    const mustTotal = pick.reduce((acc, r) => acc + r.must_total, 0);
    splits[split] = {
      rows: pick.length,
      recall_micro: mustTotal ? pick.reduce((acc, r) => acc + r.must_hit, 0) / mustTotal : 0,
      false_alarms: sum("false_alarms"),
      neg_hits: sum("neg_hits"),
      real_extra: sum("real_extra"),
      later_hits: sum("later_hits"),
      findings: sum("findings"),
      unsure: sum("unsure"),
    };
  }
  await writeFile(join(VARIANT, "summary.json"), JSON.stringify({ splits }, null, 2));
  console.log(JSON.stringify(splits, null, 2));
}

await main();
