#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { REPO } from "./pr-gate/github.ts";

export const RUN_VERIFY_LABEL = "run-verify";
const LABEL_COLOR = "5319e7";
const LABEL_DESCRIPTION = "Queues a Verify run. The merge gate does not read this label.";
const REQUEST_TIMEOUT_MS = 30_000;
const API = "https://api.github.com";

class UsageError extends Error {}

type Init = { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
export type FetchLike = (url: string, init: Init) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const HELP = `用法：node scripts/verify-kick.ts --pr <号>
给 .github/workflows/verify-dispatch.yml 用：给 PR 贴上 ${RUN_VERIFY_LABEL} 再揭掉，让 verify.yml 的 pull_request 去跑。
不检出 PR。读 GitHub 用 GITHUB_TOKEN；在 Action 外跑时云端要加 NODE_USE_ENV_PROXY=1。
退出码 0 成功、1 读写 GitHub 出错、2 参数错。`;

function assertDefaultBranch() {
  const expected = process.env.DEFAULT_REF;
  const actual = process.env.GITHUB_REF;
  if (!expected && !actual) return;
  if (!expected || !actual || actual !== expected) throw new Error(`只在默认分支上排队，当前 ref 是 ${actual || "空"}`);
}

function alreadyExists(body: unknown) {
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: unknown }).errors;
  return Array.isArray(errors) && errors.some((error) => !!error && typeof error === "object" && (error as { code?: unknown }).code === "already_exists");
}

async function call(fetchImpl: FetchLike, method: string, path: string, body?: unknown, accept: number[] = []) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchImpl(`${API}/repos/${REPO}/${path}`, {
    method,
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let parsed: unknown = null;
  if (response.status !== 204 && response.status !== 205) {
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  }
  if (!response.ok && !accept.includes(response.status)) throw new Error(`${method} ${path} HTTP ${response.status}`);
  return { status: response.status, body: parsed };
}

// 先揭再贴：标签已经在 PR 上时再贴不会触发 labeled。贴上之后再揭掉，避免标签留在 PR 上；
// 揭掉触发的 unlabeled 在 verify.yml 里进 noop 组，不会取消刚排上的验证。
export async function queueRunVerify(pr: number, fetchImpl: FetchLike = fetch) {
  assertDefaultBranch();
  const pull = await call(fetchImpl, "GET", `pulls/${pr}`);
  const number = pull.body && typeof pull.body === "object" ? (pull.body as { number?: unknown }).number : undefined;
  if (number !== pr) throw new Error(`pulls/${pr} 不是这个仓库的 PR`);
  const label = encodeURIComponent(RUN_VERIFY_LABEL);
  const existing = await call(fetchImpl, "GET", `labels/${label}`, undefined, [404]);
  if (existing.status === 404) {
    const created = await call(fetchImpl, "POST", "labels", { name: RUN_VERIFY_LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION }, [422]);
    if (created.status === 422 && !alreadyExists(created.body)) throw new Error(`建 ${RUN_VERIFY_LABEL} 标签失败`);
  }
  const onPull = `issues/${pr}/labels/${label}`;
  await call(fetchImpl, "DELETE", onPull, undefined, [404]);
  await call(fetchImpl, "POST", `issues/${pr}/labels`, { labels: [RUN_VERIFY_LABEL] });
  await call(fetchImpl, "DELETE", onPull);
  console.log(`已排队验证 PR ${pr}`);
}

export async function main(argv: string[], fetchImpl: FetchLike = fetch) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: { pr: { type: "string" }, help: { type: "boolean", default: false } } }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0) throw new UsageError("缺 --pr，或 --pr 不是正整数");
  await queueRunVerify(pr, fetchImpl);
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
