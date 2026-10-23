#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { REPO } from "./pr-gate/github.ts";
import { stampRerun } from "./verify-action/body.ts";

const HELP = `用法：VERIFY_RERUN_ID=<运行号-尝试号> node scripts/verify-dispatch.ts [--pr <号>]
给 .github/workflows/verify-dispatch.yml 用：只改 PR 描述里的重跑标记，让 verify.yml 的 pull_request edited 跑验证。
PR 号取 --pr，没有则取环境变量 PR。不检出 PR。读改 GitHub 用 GITHUB_TOKEN。
退出码 0 成功、1 读写 GitHub 出错或 PR 不能跑、2 参数错。`;

const API = "https://api.github.com";

class UsageError extends Error {}

type FetchLike = (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
type PullBody = { state?: string; draft?: boolean; body?: string | null };

async function request(fetchImpl: FetchLike, path: string, init: { method?: string; body?: unknown } = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchImpl(`${API}/repos/${REPO}/${path}`, {
    method: init.method,
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status ?? ""}`.trim());
  return response.json();
}

export async function main(argv: string[], fetchImpl: FetchLike = fetch) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: { pr: { type: "string", default: "" }, help: { type: "boolean", default: false } } }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const pr = values.pr || process.env.PR || "";
  if (!/^[1-9]\d*$/.test(pr)) throw new UsageError("缺 --pr");
  const id = process.env.VERIFY_RERUN_ID ?? "";
  if (!/^\d+-\d+$/.test(id)) throw new UsageError("缺 VERIFY_RERUN_ID（运行号-尝试号）");
  const pull = (await request(fetchImpl, `pulls/${pr}`)) as PullBody;
  if (pull.state !== "open") throw new Error(`PR #${pr} 不是打开的（${pull.state ?? "unknown"}），不触发验证`);
  if (pull.draft === true) throw new Error(`PR #${pr} 是草稿，不跑验证；转为待审会自动跑`);
  // 读完整段再写回：和人同时改描述会盖掉对方那一版。手动重跑本身就是一次编辑，接受这个窗口。
  const next = stampRerun(pull.body, id);
  if (next === (pull.body ?? "")) throw new Error(`PR #${pr} 的重跑标记已是这次运行，pull_request edited 不会再触发`);
  await request(fetchImpl, `pulls/${pr}`, { method: "PATCH", body: { body: next } });
  console.log(`已更新 PR #${pr} 的重跑标记，verify.yml 会因描述编辑启动`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const usage = error instanceof UsageError;
    console.error(usage ? `${error.message}\n${HELP}` : (error as Error).message);
    process.exitCode = usage ? 2 : 1;
  }
}
