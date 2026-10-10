#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { cursorClient, DEFAULT_MODEL, githubClient, runCursorAgent } from "./cursor-agent.mjs";

const { CURSOR_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_SERVER_URL, GITHUB_RUN_ID } = process.env;

if (!CURSOR_API_KEY || !GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_EVENT_NAME || !GITHUB_EVENT_PATH) {
  console.error("::error::缺少 CURSOR_API_KEY、GITHUB_TOKEN 或 GitHub Actions 事件环境变量");
  process.exit(1);
}

// Actions 取消任务时先发 SIGINT，过几秒再 SIGTERM；收到任一个就取消 Cursor 运行并写完终态评论。
const abort = new AbortController();
for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => abort.abort());

const code = await runCursorAgent({
  eventName: GITHUB_EVENT_NAME,
  payload: JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8")),
  repo: GITHUB_REPOSITORY,
  model: process.env.CURSOR_MODEL?.trim() || DEFAULT_MODEL,
  runUrl: GITHUB_RUN_ID ? `${GITHUB_SERVER_URL ?? "https://github.com"}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined,
  github: githubClient({ token: GITHUB_TOKEN, repo: GITHUB_REPOSITORY }),
  cursor: cursorClient({ apiKey: CURSOR_API_KEY }),
  signal: abort.signal,
});
process.exit(code);
