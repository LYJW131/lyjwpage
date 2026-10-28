import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MODEL, SYSTEM_DENY_READ, rateLimitReset, reviewerConfig, runDevin, userOtel } from "../lib/devin.js";
import { parseFindings } from "../lib/findings.js";
import { triggerMessage } from "../lib/prompt.js";
import { type Case, WORKSPACES, caseWorkspace, loadCases } from "./cases.js";
import type { Raw } from "./judge.js";

const { values } = parseArgs({
  options: {
    variant: { type: "string" },
    prompt: { type: "string", default: new URL("../review.txt", import.meta.url).pathname },
    split: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    reps: { type: "string", default: "1" },
    concurrency: { type: "string", default: "6" },
    model: { type: "string", default: MODEL },
  },
});
if (!values.variant) {
  throw new Error("usage: devin-run.ts --variant <flow>/<variant> [--split train] [--case id] [--reps N]");
}
const VARIANT = values.variant;
const RUN_TIMEOUT_MS = 30 * 60_000;
// 免费档速率桶全账号共用；重置时间超过这个就记失败，不无限等。
const MAX_RATE_WAIT_MS = 2 * 60 * 60_000;

const all = await loadCases();
const picked = [...all.values()].filter(
  (c) => (!values.split || values.split.includes(c.split)) && (!values.case || values.case.includes(c.id)),
);
const reps = Number(values.reps);
const prompt = await readFile(values.prompt!, "utf8");

// 评审员不许读工作区外：仓库检出、别的用例快照（含后来的提交）、凭据和本机配置。
function denyRead(item: Case) {
  return [
    ...SYSTEM_DENY_READ,
    "/tmp/**",
    ...[...all.keys()].filter((id) => id !== item.id).map((id) => `${WORKSPACES}/${id}/**`),
  ];
}

async function runOne(item: Case, rep: number): Promise<Raw> {
  const cwd = await caseWorkspace(item);
  const stem = `${item.id}_rep${rep}`;
  const configPath = join(VARIANT, "cfg", `${stem}.json`);
  const promptPath = join(VARIANT, "cfg", `${stem}.md`);
  await writeFile(configPath, JSON.stringify(reviewerConfig(denyRead(item), userOtel()), null, 1));
  await writeFile(promptPath, `${prompt}\n\n---\n\n${triggerMessage(item)}\n`);
  const exportPath = join(VARIANT, "traces", `${stem}.json`);
  const base = { case_id: item.id, rep, model: values.model };
  for (let attempt = 0; attempt < 4; attempt++) {
    const run = await runDevin({ cwd, promptFile: promptPath, configPath, exportPath, model: values.model, timeoutMs: RUN_TIMEOUT_MS });
    const reset = rateLimitReset(`${run.stdout}\n${run.stderr}`);
    if (reset) {
      const wait = reset.getTime() - Date.now() + 30_000;
      if (wait > MAX_RATE_WAIT_MS) return { ...base, findings: null, error: `rate limit until ${reset.toISOString()}` };
      console.log(`${stem} rate limited, waiting until ${reset.toISOString()}`);
      await new Promise((r) => setTimeout(r, Math.max(wait, 30_000)));
      continue;
    }
    const tool_calls = await countTools(exportPath);
    if (run.code !== 0) {
      return { ...base, findings: null, latency_s: run.ms / 1000, tool_calls, error: `exit ${run.code}: ${(run.stderr || run.stdout).slice(-600)}` };
    }
    try {
      return { ...base, findings: parseFindings(run.stdout), reply: run.stdout.slice(-4000), latency_s: run.ms / 1000, tool_calls };
    } catch (error) {
      return { ...base, findings: null, reply: run.stdout.slice(-4000), latency_s: run.ms / 1000, tool_calls, error: `parse: ${String(error).slice(0, 400)}` };
    }
  }
  return { ...base, findings: null, error: "rate limited 4 times" };
}

async function countTools(exportPath: string) {
  if (!existsSync(exportPath)) return undefined;
  try {
    const steps = JSON.parse(await readFile(exportPath, "utf8")).steps as { tool_calls?: unknown[] }[] | undefined;
    return steps?.reduce((n, s) => n + (Array.isArray(s.tool_calls) ? s.tool_calls.length : 0), 0);
  } catch {
    return undefined;
  }
}

async function main() {
  await mkdir(join(VARIANT, "raw"), { recursive: true });
  await mkdir(join(VARIANT, "cfg"), { recursive: true });
  await mkdir(join(VARIANT, "traces"), { recursive: true });
  const jobs = picked.flatMap((item) => Array.from({ length: reps }, (_, rep) => ({ item, rep })));
  // 已有结果的跳过；上次出错的（限流超时、没交出结果）重跑。
  const todo = jobs.filter(({ item, rep }) => {
    const path = join(VARIANT, "raw", `${item.id}__rep${rep}.json`);
    return !existsSync(path) || Boolean((JSON.parse(readFileSync(path, "utf8")) as Raw).error);
  });
  console.log(`${todo.length} of ${jobs.length} runs to do`);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const { item, rep } = todo[next++];
      const raw = await runOne(item, rep);
      await writeFile(join(VARIANT, "raw", `${item.id}__rep${rep}.json`), JSON.stringify(raw, null, 1));
      console.log(`${item.id} rep${rep} ${raw.error ? `ERROR ${raw.error.slice(0, 200)}` : `${raw.findings?.length} findings`} ${raw.latency_s ?? "?"}s tools=${raw.tool_calls ?? "?"}`);
    }
  }
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
}

await main();
