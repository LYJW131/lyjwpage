import type { CodingUsageAgent } from "./coding-usage.js";
import { config, type AgentId } from "./config.js";
import { Schedule, waitForNextRound } from "./cadence.js";
import { refreshClaudeIfDue } from "./claude-oauth.js";
import { observeCursorActivity, runCursorNowLoop } from "./cursor-now.js";
import { collectCursorUsage, cursorUsageFailure } from "./cursor-usage.js";
import { collectDevinUsage, devinUsageFailure } from "./devin-usage.js";
import { collectAgents } from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { runRounds } from "./round-loop.js";
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

async function collectDevin(): Promise<CodingUsageAgent | null> {
  try {
    const usage = await collectDevinUsage();
    if (usage) recovered("devin-usage");
    return usage;
  } catch (error) {
    failure("devin-usage", error);
    return await devinUsageFailure(error);
  }
}

async function collectPayload(ids: readonly AgentId[] = config.agentIds): Promise<PushPayload> {
  const [agents, cursor, devin] = await Promise.all([
    (async () => {
      try {
        await refreshClaudeIfDue();
      } catch (error) {
        failure("claude-oauth", error);
      }
      return collectAgents(ids);
    })(),
    collectCursor(),
    collectDevin(),
  ]);
  const usage = [...(cursor.codingUsage?.agents ?? []), ...(devin ? [devin] : [])];
  return {
    collectedAt: new Date().toISOString(),
    agents,
    ...cursor,
    ...(usage.length ? { codingUsage: { agents: usage } } : {}),
  };
}

type Round = { payload: PushPayload; agentIds: AgentId[]; at: number };

const schedule = new Schedule(config.agentIds);

async function collectRound(): Promise<Round | null> {
  const at = performance.now();
  const agentIds = schedule.due(at);
  if (agentIds.length === 0) return null;
  const { agents, ...payload } = await collectPayload(agentIds);
  if (agents?.length) recovered("collect");
  else if (agentIds.length === config.agentIds.length) failure("collect", new Error("一家都没登录，没有可发的限额行"));
  const round: PushPayload = agents?.length ? { ...payload, agents } : payload;
  if (round.agents || round.codingUsage || round.codingActivity || round.codingTokenBuckets) {
    return { payload: round, agentIds, at };
  }
  // 没登录的那几家也记作这一轮取过，否则它们一直到期，等待会立刻返回、空转。
  schedule.collected(agentIds, at);
  return null;
}

async function pushRound({ payload, agentIds, at }: Round): Promise<void> {
  if (!config.site.ingestUrl) {
    throw new Error("缺少环境变量 SITE_INGEST_URL");
  }
  if (!config.site.accessClientId || !config.site.accessClientSecret) {
    throw new Error("缺少环境变量 ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET");
  }
  await push(payload);
  schedule.collected(agentIds, at);
  recovered("push");
}

async function main() {
  info(
    config.dryRun
      ? "DRY_RUN：打印请求体然后退出"
      : `agents-reporter 启动，在用 / 闲置 ${config.cadence.activeIntervalMs} / ${config.cadence.idleIntervalMs}ms`,
  );
  if (config.dryRun) {
    process.stdout.write(`${JSON.stringify(await collectPayload(), null, 2)}\n`);
    return;
  }
  if (!config.limitsFixture && config.site.ingestUrl) void runCursorNowLoop();
  await runRounds({
    collect: collectRound,
    push: pushRound,
    waitForNextRound: () => waitForNextRound(schedule),
    sleep,
    onPushFailure: (error) => failure("push", error),
    now: () => Date.now(),
    reuseMs: config.cadence.activeIntervalMs,
    retryMs: RETRY_MS,
    maxRetryMs: MAX_RETRY_MS,
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
