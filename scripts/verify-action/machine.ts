import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isTestFile, prove, type Proof } from "../revert-proof.ts";

// 默认命令（node --test 加别名）在仓库根跑得动的测试：Worker 的测试命令与它同形，只差工作目录；上报器各有工具链，脚本不替它们证明
const PROOF_TEST = /^(scripts|src|shared|workers\/[\w-]+)\/.+\.test\.m?[jt]s$/;
const PROOF_TIMEOUT_MS = 240_000;

export const PROOF_VERDICTS: Record<string, string> = {
  proved: "撤回改动后新测试报红、HEAD 上转绿",
  "not-red": "撤回改动后新测试仍通过（不是修 bug 的 PR 就正常）",
  "red-not-assertion": "撤回改动后红了，但不是断言失败",
  "not-green": "HEAD 上新测试没通过",
  "only-tests": "只改了测试，没有可撤回的改动",
  "no-tests": "没改脚本能跑的测试",
  error: "脚本没跑成，看 Action 日志",
};

export const CI_STATES: Record<string, string> = {
  success: "通过",
  failure: "失败",
  cancelled: "被取消",
  timed_out: "超时",
  pending: "发评论时还没跑完",
  none: "head 上没有",
  error: "没查到，看 Action 日志",
};

export type ProofSummary = { verdict: string; tests: string[] };

export function proofPlan(changed: string[], exists: (file: string) => boolean = () => true) {
  const tests = changed.filter((file) => PROOF_TEST.test(file) && exists(file));
  if (tests.length === 0) return { tests, skip: "no-tests" };
  const keep = new Set(tests);
  if (changed.every((file) => isTestFile(file, keep))) return { tests, skip: "only-tests" };
  return { tests, skip: null };
}

export function runProof(root: string, base: string): { summary: ProofSummary; proof: Proof | null } {
  const changed = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...HEAD`], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const { tests, skip } = proofPlan(changed, (file) => existsSync(path.join(root, file)));
  if (skip) return { summary: { verdict: skip, tests }, proof: null };
  const proof = prove({ root, tests, base, timeoutMs: PROOF_TIMEOUT_MS });
  return { summary: { verdict: proof.verdict, tests }, proof };
}

const SAFE_PATH = /^[\w./-]+$/;

// 两项都来自跑过 PR 代码的 job：只认表里的值，路径只收安全字符，其余一律不显示
export function machineLine({ ci, proof }: { ci?: string | null; proof?: ProofSummary | null }) {
  const parts: string[] = [];
  if (ci && Object.hasOwn(CI_STATES, ci)) parts.push(`CI check ${CI_STATES[ci]}`);
  if (proof && Object.hasOwn(PROOF_VERDICTS, proof.verdict)) {
    const tests = Array.isArray(proof.tests) ? proof.tests.filter((file) => typeof file === "string" && SAFE_PATH.test(file)) : [];
    parts.push(`撤回证明：${PROOF_VERDICTS[proof.verdict]}${tests.length && proof.verdict !== "no-tests" ? `（${tests.map((file) => `\`${file}\``).join("、")}）` : ""}`);
  }
  return parts.length ? `脚本：${parts.join("；")}` : null;
}
