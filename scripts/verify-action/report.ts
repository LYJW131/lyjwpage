import { LEVELS, PASSING_RANK, stampLine, stampTitle, type Stamp } from "../verify-receipt.ts";
import type { ChecklistItem } from "./body.ts";

export const RESULTS = ["PASS", "FAIL", "SKIPPED"] as const;
const MAX_SHOTS = 12;
const MAX_NOT_VERIFIED = 3;
const BRIEF_CHARS = 160;

export const VERIFIER_SCHEMA = {
  type: "object",
  required: ["model", "level", "rows", "notVerified"],
  properties: {
    model: { type: "string" },
    level: { type: "string", enum: LEVELS },
    rows: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "check", "result", "evidence"],
        properties: {
          id: { type: "string" },
          check: { type: "string" },
          result: { type: "string", enum: RESULTS },
          evidence: { type: "string", minLength: 1 },
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

// 验证员自报的等级不直接用：清单里每一项都要有 PASS 行，有 FAIL 就是 verifier-failed，漏项、SKIPPED、没有检查行、PASS 没写证据或界面档没截图就是 verifier-blocked。
export function reconcile(checklist: ChecklistItem[], report: VerifierReport, { shots }: { shots?: number } = {}) {
  const problems: string[] = [];
  let failed = report.rows.some((row) => row.result === "FAIL");
  let blocked = false;
  if (report.rows.length === 0) {
    blocked = true;
    problems.push("没有任何检查行");
  }
  for (const row of report.rows) {
    if (row.result === "PASS" && !row.evidence?.trim()) {
      blocked = true;
      problems.push(`${row.id} 是 PASS 但没写证据`);
    }
  }
  for (const item of checklist) {
    const row = report.rows.find((candidate) => candidate.id === item.id);
    if (!row) {
      blocked = true;
      problems.push(`${item.id} 没有对应的检查行`);
    } else if (row.result === "FAIL") {
      failed = true;
      problems.push(`${item.id} 是 FAIL`);
    } else if (row.result !== "PASS") {
      blocked = true;
      problems.push(`${item.id} 结果是 ${row.result}`);
    }
  }
  const claimed = LEVELS.includes(report.level) ? report.level : "verifier-blocked";
  if (claimed === "live-ui-verified" && shots === 0) {
    blocked = true;
    problems.push("live-ui-verified 没有截图上传成功");
  }
  let level = claimed;
  if (failed) level = "verifier-failed";
  else if (blocked && (PASSING_RANK[claimed] ?? 0) > 0) level = "verifier-blocked";
  return { level, claimed, problems };
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim() || "—";

const header = (stamp: Stamp) => [stampTitle(stamp), stampLine(stamp)];

const brief = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > BRIEF_CHARS ? `${flat.slice(0, BRIEF_CHARS)}…` : flat;
};

const details = (summary: string, table: string[]) => ["<details>", `<summary>${summary}</summary>`, "", ...table, "", "</details>"];

// 评论只摆结论和没过的项，全表折叠：主线程与 lyjw 一眼看完，完整证据在 Action 日志与 verify-out artifact 里
export function receiptComment({
  stamp,
  report,
  checklist,
  problems,
  claimed,
  shots,
  runUrl,
}: {
  stamp: Stamp;
  report: VerifierReport;
  checklist: ChecklistItem[];
  problems: string[];
  claimed: string;
  shots: { name: string; url: string }[];
  runUrl: string;
}) {
  const lines = [...header(stamp), ""];
  const open = report.rows.filter((row) => row.result !== "PASS");
  if (open.length === 0) lines.push(`全过：${report.rows.map((row) => row.id).join(" ")}`);
  else lines.push("没过：", ...open.map((row) => `- ${row.id} ${row.result}：${brief(row.check)}（${brief(row.evidence)}）`));
  if (report.notVerified.length > 0) {
    const shown = report.notVerified.slice(0, MAX_NOT_VERIFIED).map((item) => `- ${brief(item)}`);
    const more = report.notVerified.length - shown.length;
    lines.push("", "没验到：", ...shown, ...(more > 0 ? [`- 另有 ${more} 条，见下面明细`] : []));
  }
  if (checklist.length === 0) lines.push("", "PR 描述里没有「验证清单」，验证员按 diff 自己挑的检查。");
  else if (problems.length > 0) lines.push("", `对照清单：${problems.join("；")}。`);
  if (stamp.level !== claimed) lines.push("", `验证员自报 ${claimed}，按清单对照改记 ${stamp.level}。`);
  if (shots.length > 0) {
    lines.push("");
    for (const shot of shots.slice(0, MAX_SHOTS)) lines.push(`<img src="${shot.url}" alt="${shot.name}" width="360">`);
  }
  const table = ["| 项 | 检查 | 结果 | 证据 |", "| --- | --- | --- | --- |", ...report.rows.map((row) => `| ${cell(row.id)} | ${cell(row.check)} | ${cell(row.result)} | ${cell(row.evidence)} |`)];
  if (report.notVerified.length > MAX_NOT_VERIFIED) table.push("", "没验到（全部）：", ...report.notVerified.map((item) => `- ${item}`));
  lines.push("", ...details(`明细（${report.rows.length} 项）`, table));
  lines.push("", `验证员：${report.model}，没写这段代码（[Action 运行](${runUrl})）`);
  return lines.join("\n");
}

// 判定员的结论不直接用：明细里有没做到的要求或有回归，就按 FAIL 签。
export function judgeVerdict(report: JudgeReport) {
  const complete = report.asks.length > 0 && report.asks.every((ask) => ask.met === true && ask.ask.trim() !== "" && ask.evidence.trim() !== "");
  return report.verdict === "PASS" && complete && report.regressions.length === 0 && report.fixes.length === 0 ? "PASS" : "FAIL";
}

export function judgeComment({ stamp, report, runUrl }: { stamp: Stamp; report: JudgeReport; runUrl: string }) {
  const lines = [...header(stamp), ""];
  const unmet = report.asks.filter((ask) => !ask.met);
  if (unmet.length === 0 && report.regressions.length === 0) lines.push(`要求 ${report.asks.length} 条都做到，没发现回归。`);
  if (unmet.length > 0) lines.push("没做到：", ...unmet.map((ask) => `- ${brief(ask.ask)}（${brief(ask.evidence)}）`));
  if (report.regressions.length > 0) lines.push("", "回归：", ...report.regressions.map((item) => `- ${brief(item)}`));
  if (report.fixes.length > 0) lines.push("", "要修：", ...report.fixes.map((item) => `- ${brief(item)}`));
  if (stamp.verdict !== report.verdict) lines.push("", `判定员自报 ${report.verdict}，明细里有没做到、没写依据的要求，或有回归、待修项（或没列要求），改记 ${stamp.verdict}。`);
  const table = ["| lyjw 要的 | 做到了 | 依据 |", "| --- | --- | --- |", ...report.asks.map((ask) => `| ${cell(ask.ask)} | ${ask.met ? "是" : "否"} | ${cell(ask.evidence)} |`)];
  lines.push("", ...details(`逐条（${report.asks.length} 条）`, table));
  lines.push("", `判定员：${report.model}，只读 lyjw 原话与 diff，没写这段代码，没看验证员的证据（[Action 运行](${runUrl})）`);
  return lines.join("\n");
}

export function blockedComment({ stamp, reason, runUrl }: { stamp: Stamp; reason: string; runUrl: string }) {
  return [...header(stamp), "", `没验到：${reason}`, "", `验证员：没跑成（[Action 运行](${runUrl})）`].join("\n");
}
