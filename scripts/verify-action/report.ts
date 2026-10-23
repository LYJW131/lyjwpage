import { LEVELS, PASSING_RANK } from "../verify-receipt.ts";
import type { ChecklistItem } from "./body.ts";

export const RESULTS = ["PASS", "FAIL", "SKIPPED"] as const;
const MAX_SHOTS = 12;

export const VERIFIER_SCHEMA = {
  type: "object",
  required: ["model", "level", "rows", "notVerified"],
  properties: {
    model: { type: "string" },
    level: { type: "string", enum: LEVELS },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "check", "result", "evidence"],
        properties: {
          id: { type: "string" },
          check: { type: "string" },
          result: { type: "string", enum: RESULTS },
          evidence: { type: "string" },
        },
      },
    },
    notVerified: { type: "array", items: { type: "string" } },
  },
};

export const JUDGE_SCHEMA = {
  type: "object",
  required: ["model", "verdict", "asks", "regressions", "fixes"],
  properties: {
    model: { type: "string" },
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    asks: {
      type: "array",
      items: {
        type: "object",
        required: ["ask", "met", "evidence"],
        properties: { ask: { type: "string" }, met: { type: "boolean" }, evidence: { type: "string" } },
      },
    },
    regressions: { type: "array", items: { type: "string" } },
    fixes: { type: "array", items: { type: "string" } },
  },
};

export type Row = { id: string; check: string; result: string; evidence: string };
export type VerifierReport = { model: string; level: string; rows: Row[]; notVerified: string[] };
export type JudgeReport = {
  model: string;
  verdict: string;
  asks: { ask: string; met: boolean; evidence: string }[];
  regressions: string[];
  fixes: string[];
};

// 验证员自报的等级不直接用：清单里每一项都要有 PASS 行，有 FAIL 就是 verifier-failed，漏项或 SKIPPED 就是 verifier-blocked。
export function reconcile(checklist: ChecklistItem[], report: VerifierReport) {
  const problems: string[] = [];
  let failed = report.rows.some((row) => row.result === "FAIL");
  let blocked = false;
  for (const item of checklist) {
    const row = report.rows.find((candidate) => candidate.id === item.id);
    if (!row) {
      blocked = true;
      problems.push(`${item.id} 没有对应的检查行`);
    } else if (row.result === "FAIL") {
      failed = true;
    } else if (row.result !== "PASS") {
      blocked = true;
      problems.push(`${item.id} 结果是 ${row.result}`);
    }
  }
  const claimed = LEVELS.includes(report.level) ? report.level : "verifier-blocked";
  let level = claimed;
  if (failed) level = "verifier-failed";
  else if (blocked && (PASSING_RANK[claimed] ?? 0) > 0) level = "verifier-blocked";
  return { level, claimed, problems };
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim() || "—";

export function receiptComment({
  firstLine,
  report,
  checklist,
  problems,
  claimed,
  shots,
  runUrl,
}: {
  firstLine: string;
  report: VerifierReport;
  checklist: ChecklistItem[];
  problems: string[];
  claimed: string;
  shots: { name: string; url: string }[];
  runUrl: string;
}) {
  const lines = [firstLine, "", "| 项 | 检查 | 结果 | 证据 |", "| --- | --- | --- | --- |"];
  for (const row of report.rows) lines.push(`| ${cell(row.id)} | ${cell(row.check)} | ${cell(row.result)} | ${cell(row.evidence)} |`);
  lines.push("", `没验到：${report.notVerified.length ? report.notVerified.map((item) => `\n- ${item}`).join("") : "无"}`);
  const level = firstLine.split(/[：:]/).pop()?.trim();
  lines.push(
    "",
    checklist.length === 0
      ? "对照清单：PR 描述里没有「验证清单」，验证员按 diff 自己挑的检查。"
      : problems.length === 0
        ? `对照清单：${checklist.length} 项都有 PASS。`
        : `对照清单：${problems.join("；")}。`,
  );
  if (level !== claimed) lines.push(`验证员自报 ${claimed}，按清单对照改记 ${level}。`);
  if (shots.length > 0) {
    lines.push("", "截图：", "");
    for (const shot of shots.slice(0, MAX_SHOTS)) lines.push(`<img src="${shot.url}" alt="${shot.name}" width="360">`);
  }
  lines.push("", `验证员：${report.model}，没写这段代码（[Action 运行](${runUrl})）`);
  return lines.join("\n");
}

export function judgeComment({ firstLine, report, runUrl }: { firstLine: string; report: JudgeReport; runUrl: string }) {
  const lines = [firstLine, "", "| lyjw 要的 | 做到了 | 依据 |", "| --- | --- | --- |"];
  for (const ask of report.asks) lines.push(`| ${cell(ask.ask)} | ${ask.met ? "是" : "否"} | ${cell(ask.evidence)} |`);
  lines.push("", `回归：${report.regressions.length ? report.regressions.map((item) => `\n- ${item}`).join("") : "没发现"}`);
  if (report.fixes.length > 0) lines.push("", `要修：${report.fixes.map((item) => `\n- ${item}`).join("")}`);
  lines.push("", `判定员：${report.model}，只读 lyjw 原话与 diff，没写这段代码，没看验证员的证据（[Action 运行](${runUrl})）`);
  return lines.join("\n");
}

export function blockedComment({ firstLine, reason, runUrl }: { firstLine: string; reason: string; runUrl: string }) {
  return [firstLine, "", `没验到：${reason}`, "", `验证员：没跑成（[Action 运行](${runUrl})）`].join("\n");
}
