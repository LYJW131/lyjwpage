#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { DEFAULT_LIMIT, githubClient, renderSummary, runCodeqlAutofix } from "./codeql-autofix.mjs";
import { cursorClient, DEFAULT_MODEL } from "./cursor-cloud.mjs";

const { CURSOR_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY } = process.env;
const dryRun = process.env.DRY_RUN === "true";

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || (!dryRun && !CURSOR_API_KEY)) {
  console.error("::error::缺少 GITHUB_TOKEN、GITHUB_REPOSITORY 或 CURSOR_API_KEY");
  process.exit(1);
}

const limit = Number.parseInt(process.env.LIMIT ?? "", 10);

// Actions 取消任务时先发 SIGINT，过几秒再 SIGTERM；收到任一个就取消还在跑的 Cursor 运行。
const abort = new AbortController();
for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => abort.abort());

const { items, code } = await runCodeqlAutofix({
  repo: GITHUB_REPOSITORY,
  baseRef: process.env.BASE_REF || "main",
  github: githubClient({ token: GITHUB_TOKEN, repo: GITHUB_REPOSITORY }),
  cursor: cursorClient({ apiKey: CURSOR_API_KEY ?? "" }),
  model: process.env.CURSOR_MODEL?.trim() || DEFAULT_MODEL,
  limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  dryRun,
  signal: abort.signal,
});

const summary = renderSummary({ items, dryRun });
console.log(summary);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`);
process.exit(code);
