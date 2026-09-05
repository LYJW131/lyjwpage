import { config } from "./config.js";
import { refreshClaudeIfDue } from "./claude-oauth.js";
import { collectAgents } from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { push, type PushPayload } from "./site.js";

/**
 * 各 agent 账号限额 → lyjwpage `/api/ingest/agents`。
 *
 * 限额是厂商账号侧的事实，跟哪台 Mac 无关，所以从 Mac 上报器拆出来，
 * 在 NAS 容器里 24 小时跑。用量仍由 Mac 报。
 *
 * 每轮都 POST，内容没变也发 —— 那一封就是心跳。
 * 五家自己打各家限额接口。Claude 401 时 refreshClaudeOauth 再试一次；
 * Antigravity 到期或 401 时用环境变量里的 Google OAuth 客户端刷新。
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
   * Claude 刷新失败不能连累整轮：这一封是心跳，不发出去站点会把各家都判成陈旧。
   * 刷不到时 claude 那一行带着 limitsError 照发。
   */
  try {
    await refreshClaudeIfDue();
  } catch (error) {
    failure("claude-oauth", error);
  }
  return {
    collectedAt: new Date().toISOString(),
    agents: await collectAgents(),
  };
}

async function round(): Promise<void> {
  const payload = await collectPayload();
  if (config.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (!config.site.ingestUrl) {
    throw new Error("缺少环境变量 SITE_URL 或 SITE_INGEST_URL");
  }
  /**
   * 一家都没有（全都「没配」）时不发：站点对空封回 400，发了只是白退避。
   * 这是启动后还没登录任何一家的样子，记一句就好。
   */
  if (payload.agents.length === 0) {
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
