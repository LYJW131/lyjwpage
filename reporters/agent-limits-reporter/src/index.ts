import { config } from "./config.js";
import {
  claudeRefreshConfigured,
  refreshClaudeIfDue,
  refreshClaudeOauth,
} from "./claude-oauth.js";
import {
  collectAgents,
  fetchUsageLimits,
  resetUsageLimitsCache,
  translateAndOverlay,
  usageSaysClaudeReauth,
} from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { push, type PushPayload } from "./site.js";

/**
 * 各 agent 账号限额 → lyjwpage `/api/ingest/agents`。
 *
 * 限额是厂商账号侧的事实，跟哪台 Mac 无关，所以从 Mac 上报器拆出来，
 * 在 NAS 容器里 24 小时跑。用量仍由 Mac 报。
 *
 * 每轮都 POST，内容没变也发 —— 那一封就是心跳。
 */

const RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function collectPayload(): Promise<PushPayload> {
  /**
   * Claude 刷新失败不能连累整轮：这一封是心跳，不发出去站点会把五家都判成陈旧。
   * 刷不到时 TokenTracker 那边自然会报 AUTH_EXPIRED，claude 那一行带着 limitsError 照发。
   */
  try {
    await refreshClaudeIfDue();
  } catch (error) {
    failure("claude-oauth", error);
  }
  try {
    if (config.limitsFixture) {
      return {
        collectedAt: new Date().toISOString(),
        agents: await collectAgents(),
      };
    }

    let root = await fetchUsageLimits();
    if (usageSaysClaudeReauth(root) && claudeRefreshConfigured()) {
      info("TokenTracker 报 Claude AUTH_EXPIRED，刷新 OAuth 后再取一次");
      await refreshClaudeOauth();
      resetUsageLimitsCache();
      root = await fetchUsageLimits();
    }
    return {
      collectedAt: new Date().toISOString(),
      agents: await translateAndOverlay(root),
    };
  } catch (error) {
    if (config.limitsFixture) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      collectedAt: new Date().toISOString(),
      agents: config.agentIds.map((id) => ({
        id,
        plan: null,
        limits: [],
        limitsError: `TokenTracker ${id}：${message}`,
      })),
    };
  }
}

async function round(): Promise<void> {
  const payload = await collectPayload();
  if (config.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  await push(payload);
  recovered("push");
}

async function main() {
  info(
    config.dryRun
      ? "DRY_RUN：打印请求体然后退出"
      : `agent-limits-reporter 启动，每 ${config.pushIntervalMs}ms 推一次`,
  );
  let backoff = RETRY_MS;
  for (;;) {
    try {
      await round();
      backoff = RETRY_MS;
      if (config.dryRun) return;
      await sleep(config.pushIntervalMs);
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
