import { config } from "./config.js";
import { waitForNextRound } from "./cadence.js";
import { refreshClaudeIfDue } from "./claude-oauth.js";
import { observeCursorActivity, runCursorNowLoop } from "./cursor-now.js";
import { collectCursorUsage, cursorUsageFailure } from "./cursor-usage.js";
import { collectAgents } from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { push, type PushPayload } from "./site.js";


const RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

type CursorFacts = Pick<PushPayload, "codingUsage" | "codingActivity" | "codingTokenBuckets">;

async function collectCursor(): Promise<CursorFacts> {
  try {
    const collected = await collectCursorUsage();
    if (!collected) return {};
    recovered("cursor-usage");
    observeCursorActivity(collected.latestAt);
    return {
      codingUsage: { agents: [collected.usage] },
      codingActivity: collected.activity,
      codingTokenBuckets: collected.buckets,
    };
  } catch (error) {
    failure("cursor-usage", error);
    return { codingUsage: { agents: [await cursorUsageFailure(error)] } };
  }
}

async function collectPayload(): Promise<PushPayload> {
  const [agents, cursor] = await Promise.all([
    (async () => {
      try {
        await refreshClaudeIfDue();
      } catch (error) {
        failure("claude-oauth", error);
      }
      return collectAgents();
    })(),
    collectCursor(),
  ]);
  return {
    collectedAt: new Date().toISOString(),
    agents,
    ...cursor,
  };
}

async function round(): Promise<void> {
  const payload = await collectPayload();
  if (config.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (!config.site.ingestUrl) {
    throw new Error("缺少环境变量 SITE_INGEST_URL");
  }
  if (!config.site.accessClientId || !config.site.accessClientSecret) {
    throw new Error("缺少环境变量 ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET");
  }
  if (!payload.agents?.length) {
    failure("collect", new Error("一家都没登录，没有可发的限额行"));
    return;
  }
  await push(payload);
  recovered("collect");
  recovered("push");
}

async function main() {
  info(
    config.dryRun
      ? "DRY_RUN：打印请求体然后退出"
      : `agents-reporter 启动，三档 ${config.cadence.liveIntervalMs} / ${config.cadence.openIntervalMs} / ${config.cadence.idleIntervalMs}ms`,
  );
  if (!config.dryRun && !config.limitsFixture && config.site.ingestUrl) void runCursorNowLoop();
  let backoff = RETRY_MS;
  for (;;) {
    try {
      await round();
      backoff = RETRY_MS;
      if (config.dryRun) return;
      await waitForNextRound();
    } catch (error) {
      failure("push", error);
      if (config.dryRun) throw error;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_RETRY_MS);
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
