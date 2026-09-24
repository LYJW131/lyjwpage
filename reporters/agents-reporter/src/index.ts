import { config } from "./config.js";
import { waitForNextRound } from "./cadence.js";
import { refreshClaudeIfDue } from "./claude-oauth.js";
import { markCursorNowSent, observeCursorActivity, runCursorNowLoop } from "./cursor-now.js";
import { collectCursorUsage } from "./cursor-usage.js";
import { collectAgents } from "./limits.js";
import { failure, info, recovered } from "./log.js";
import { push, type PushPayload } from "./site.js";

/**
 * 各 agent 账号限额 → lyjwpage `/api/ingest/agents`。
 *
 * 限额是厂商账号侧的事实，跟哪台 Mac 无关，所以从 Mac 上报器拆出来，
 * 在容器里 24 小时跑。Cursor 的用量历史也是账号侧的云端事实，用同一份
 * 登录态拉，跟限额一起 POST。其余来源的用量仍由 Mac 报。
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

async function collectPayload(): Promise<PushPayload> {
  /**
   * Claude 刷新失败不能连累整轮：这一封是心跳，不发出去站点会把各家都判成陈旧。
   * 刷不到时 claude 那一行带着 limitsError 照发。
   * Cursor 历史拉失败同样不能挡住限额心跳，这一轮就不带 cursorUsage。
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
    collectCursorUsage().catch((error: unknown) => {
      failure("cursor-usage", error);
      return null;
    }),
  ]);
  const cursorNow = observeCursorActivity(cursor?.latest ?? null);
  return {
    collectedAt: new Date().toISOString(),
    agents,
    ...(cursor ? { cursorUsage: cursor.push } : {}),
    ...(cursorNow ? { cursorNow } : {}),
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
  if (!payload.agents?.length) {
    failure("collect", new Error("一家都没登录，没有可发的限额行"));
    return;
  }
  await push(payload);
  if (payload.cursorNow) markCursorNowSent(payload.cursorNow);
  recovered("collect");
  recovered("push");
}

async function main() {
  info(
    config.dryRun
      ? "DRY_RUN：打印请求体然后退出"
      : `agents-reporter 启动，三档 ${config.cadence.liveIntervalMs} / ${config.cadence.openIntervalMs} / ${config.cadence.idleIntervalMs}ms`,
  );
  // Cursor 活动的快循环平时睡着，等限额那一轮看到 5 分钟内的事件才醒。试跑和夹具模式不起它。
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
