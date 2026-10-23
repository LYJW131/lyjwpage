#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HELP = `用法：node scripts/verify-ab.ts --effort <档> --execution-file <文件> --out <文件>
验证员 effort 对比（.github/workflows/verify.yml 的 verify 与 verify-ab 两个 job 各跑一次）：
从 claude-code-action 的 execution_file 取用时（结构化结果没在里面时读环境变量 STRUCTURED_OUTPUT）、轮数、token 与结构化结果的等级和各行结果，写成一行 JSON 到 --out，
同一段摘要追加进 GITHUB_STEP_SUMMARY。不读 GitHub、不影响回执；读不出来就只记 effort 和 error。`;

type Message = {
  type?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: { output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } };
  structured_output?: { level?: string; rows?: { id?: string; result?: string }[]; notVerified?: unknown[] };
};

export function summarize(effort: string, messages: Message[], structured?: Message["structured_output"]) {
  const result = messages.findLast((message) => message.type === "result");
  if (!result) return { effort, error: "execution_file 里没有 result" };
  const report = result.structured_output ?? structured;
  return {
    effort,
    durationS: Math.round((result.duration_ms ?? 0) / 1000),
    apiS: Math.round((result.duration_api_ms ?? 0) / 1000),
    turns: result.num_turns ?? null,
    outputTokens: result.usage?.output_tokens ?? null,
    thinkingTokens: result.usage?.output_tokens_details?.thinking_tokens ?? null,
    costUsd: result.total_cost_usd ?? null,
    level: report?.level ?? null,
    rows: (report?.rows ?? []).map((row) => `${row.id}:${row.result}`),
    notVerified: report?.notVerified?.length ?? 0,
  };
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      strict: true,
      options: { effort: { type: "string" }, "execution-file": { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(HELP);
    process.exit(2);
  }
  if (values.help || !values.effort || !values.out) {
    console.log(HELP);
    process.exit(values.help ? 0 : 2);
  }
  let line: ReturnType<typeof summarize>;
  try {
    const structured = process.env.STRUCTURED_OUTPUT ? (JSON.parse(process.env.STRUCTURED_OUTPUT) as Message["structured_output"]) : undefined;
    line = summarize(values.effort, JSON.parse(fs.readFileSync(values["execution-file"] ?? "", "utf8")) as Message[], structured);
  } catch (error) {
    line = { effort: values.effort, error: error instanceof Error ? error.message : String(error) };
  }
  const text = JSON.stringify(line);
  fs.mkdirSync(path.dirname(values.out), { recursive: true });
  fs.writeFileSync(values.out, `${text}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 验证员 effort ${values.effort}\n\n\`\`\`json\n${JSON.stringify(line, null, 2)}\n\`\`\`\n`);
  console.log(text);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
