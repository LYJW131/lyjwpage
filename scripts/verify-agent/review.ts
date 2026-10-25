import type { Row, VerifierReport } from "../verify-action/report.ts";

export type Claim = { id: string; claim: string; check: string };
export type ReviewFacts = {
  checklistIds: string[];
  claims: Claim[];
  hasDescription: boolean;
  logic: boolean;
  testsPassed: boolean;
  comparedBase: boolean;
};

// 「另：」只留给改动前就有、与本次改动无关的事；写了这些字眼又判 PASS 的，多半是把该判 FAIL 的降级了
const NEGATIVE = /仍|还在|还是|残留|没同步|未同步|没改|未改|没有更新|未更新|不一致|不符|不满足|漏|过期|字面|没删|未删|没跟上/;
const EXCUSED = /改动前|与本次改动无关|不是本次|存量|main 上同样/;

export function checklistIds(prompt: string): string[] {
  const block = prompt.split("每一项都要有一行结果，行 id 照抄：\n")[1];
  if (!block) return [];
  const ids: string[] = [];
  for (const line of block.split("\n")) {
    const match = /^- ([^：:]+)[：:]/.exec(line);
    if (!match) break;
    ids.push(match[1].trim());
  }
  return ids;
}

export const isLogicTier = (prompt: string) => /分档：[^，\n]*logic/.test(prompt);
export const hasDescription = (prompt: string) => /\n描述：\n\s*\S/.test(prompt);

const after = (evidence: string) => evidence.split("另：").slice(1).join("另：");

export function lenientRows(rows: Row[]): Row[] {
  return rows.filter((row) => row.result === "PASS" && NEGATIVE.test(after(row.evidence)) && !EXCUSED.test(after(row.evidence)));
}

export function reviewReport(report: VerifierReport, facts: ReviewFacts): string[] {
  const issues: string[] = [];
  const ids = new Set(report.rows.map((row) => row.id));
  const missing = facts.checklistIds.filter((id) => !ids.has(id));
  if (missing.length) issues.push(`清单项 ${missing.join("、")} 没有对应的行：每个清单 id 都要有一行，验不了就写 SKIPPED 并说明。`);
  if (facts.hasDescription && facts.claims.length === 0)
    issues.push("还没用 claims 工具列出 PR 标题、描述、清单与新注释里的行为声明。先列出来（每条写打算用哪一行检查它），再交。");
  const unchecked = facts.claims.filter((claim) => !ids.has(claim.check));
  if (unchecked.length) issues.push(`这些声明登记的检查行不在结果里：${unchecked.map((claim) => `${claim.id}→${claim.check}`).join("、")}。补上那一行，或把声明的 check 改成实际核对它的行。`);
  for (const row of lenientRows(report.rows))
    issues.push(
      `${row.id} 判 PASS，但「另：」里写了「${after(row.evidence).slice(0, 80)}」。若它违反了清单的字面要求、PR 描述或注释里的声明、或 AGENTS.md 的同步规则，就是这次改动带进来的缺陷，改判 FAIL；确实是改动前就有的，在「另：」里写明「改动前就有」再交。`,
    );
  if (report.level === "unit-test-verified" && !facts.testsPassed)
    issues.push("level 写了 unit-test-verified，但这一轮 run_tests 没有一次退出码 0：先用 run_tests 跑覆盖改动的单测，跑不了就把 level 降到 type-check-only。");
  if (facts.logic && !facts.comparedBase && !report.notVerified.some((line) => /对照|差分|compare_base/.test(line)))
    issues.push("这是逻辑改动，还没用 compare_base 在目标分支与 HEAD 上跑同一个探针对照过：针对 PR 声称的行为造一个输入跑一次；确实没法对照的，在 notVerified 写明原因。");
  return issues;
}
