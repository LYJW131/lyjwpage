import { config } from "./config.js";
import { waitForNextRound } from "./cadence.js";
import { refreshClaudeIfDue } from "./claude-oauth.js";
import { observeCursorActivity, runCursorNowLoop } from "./cursor-now.js";
import { collectCursorUsage, cursorUsageFailure } from "./cursor-usage.js";
import { collectAgents } from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { push, type PushPayload } from "./site.js";

/**
 * 各 agent 账号限额 → lyjwpage `/api/ingest/agents`。
 *
 * 限额是厂商账号侧的事实，跟哪台 Mac 无关，所以在容器里 24 小时跑。Cursor 的用量
 * 历史也是账号侧的云端事实，用同一份登录态拉，跟限额一起 POST：日行账本
 * （codingUsage）、最近活动（codingActivity）、5 分钟 token 桶（codingTokenBuckets）。
 * 其余来源的用量由 Mac 报。
 *
 * 每轮都 POST，内容没变也发 —— 那一封就是心跳。
 * 五家自己打各家限额接口。Claude 401 时 refreshClaudeOauth 再试一次；
 * Claude / Antigravity 默认从各自 CLI 安装程序读取 OAuth 客户端配置。
 */

const RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

type CursorFacts = Pick<PushPayload, "codingUsage" | "codingActivity" | "codingTokenBuckets">;

/**
 * Cursor 这一轮的三份事实。没登录 Cursor 什么都不带；拉失败只带一行 error 状态（站点不动历史），
 * 不带活动和桶：那一段是「没采到」，不能当成「确认没用」。
 */
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
  /**
   * Claude 预刷新失败不能连累整轮：这一封是心跳，不发出去站点会把各家都判成陈旧。
   * 预刷新失败后仍尝试采集，错误行由限额采集结果决定（`limits.ts#collectClaudeLive`）。
   * Cursor 历史拉失败同样不能挡住限额心跳，见 collectCursor。
   */
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
  /**
   * 一家都没有（全都「没配」）时不发：站点对空封回 400，发了只是白退避。
   * 这是启动后还没登录任何一家的样子，记一句就好。
   */
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
  // 限额轮发现 `cursor-now.ts#ACTIVE_WINDOW_MS` 内事件时唤醒。试跑和夹具模式不起它。
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
