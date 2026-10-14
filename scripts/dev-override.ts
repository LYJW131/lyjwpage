#!/usr/bin/env node
import { callWorker, clearOverride, fixturePath, putOverride, readJson, stampNow, switchOverrides, WorkerError } from "./dev-fixtures.ts";

const USAGE = [
  "用法：",
  "  pnpm dev:override <端点路径> <夹具.json>",
  "  pnpm dev:override <端点路径> --clear",
  "  pnpm dev:override --list",
  "  pnpm dev:override --on | --off",
  "",
  "端点路径可带查询串（如 /api/lyrics?song=1490256995），带了就只答这一个查询；",
  "成套注入（摘要、Pulse、标题、歌词一次对齐）用 pnpm dev:scene，见 pnpm dev:scene --help。",
].join("\n");

async function main([first, second]: string[]): Promise<unknown> {
  if (first === "--list") return callWorker("/api/dev/overrides");
  if (first === "--on" || first === "--off") return switchOverrides(first === "--on");
  if (!first?.startsWith("/api/") || !second) throw new UsageError();
  if (second === "--clear") return clearOverride(first);
  return putOverride(first, stampNow(readJson(fixturePath(second)), Date.now()));
}

class UsageError extends Error {}

try {
  if (process.argv[2] === "--help") {
    console.log(USAGE);
  } else {
    console.log(JSON.stringify(await main(process.argv.slice(2))));
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(USAGE);
    process.exit(2);
  }
  console.error(error instanceof WorkerError ? error.message : error);
  process.exit(1);
}
