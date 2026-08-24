import { assertUsableCredentials, RefreshRejected } from "./auth.js";
import { config, dryRun } from "./config.js";
import { failure, info, recovered } from "./log.js";
import { fetchPlayedGames, fetchPresence, type PlayedGamesReport, type PresenceReport } from "./psn.js";
import { announceTarget, deliver, type PlaystationEnvelope } from "./site.js";

/**
 * PlayStation 上报器 —— **原型**。
 *
 * 两路轮询，一个信封：
 * - presence（30 秒）：此刻在线 / 在玩什么。**翻面才推** —— 开始玩、换游戏、下线。
 * - 已玩列表（5 分钟）：玩过哪些、各玩了多久。内容变了才推，另每 10 分钟兜底整推。
 *
 * 「变了才推 + 定时兜底整推」是这个仓库里两张列表的既定模式，理由见根 README：
 * 站点将来在 Vercel 上是按调用计费的函数，而 Redis 可能被清空、也可能因为部署
 * 换了库，只靠「有变化才推」会空在那儿等一个永远不来的变化。
 *
 * ⚠️ **从没用真实凭据跑过。** PSN 请求交给 psn-api，但返回数据和错误路径仍没有
 * 经过真实账号验证。详见 README 顶部的声明。
 */

const once = process.argv.slice(2).includes("--once");

/* ── 一次只让一件事在推 ────────────────────────────────────── */

let tail: Promise<unknown> = Promise.resolve();

/**
 * 两路轮询整轮串起来跑，不并发。
 *
 * 直接的理由是推送：省得站点那边收到两份交错的信封。顺带还消掉一件麻烦事 ——
 * 两路同时发现 access token 该续了、于是同时去换一份，后换的那次会把先换的
 * 作废掉。串起来之后 auth.ts 里那个 inflight 只是第二道保险。
 *
 * 代价是 presence 那一轮卡住时已玩列表得跟着等，上限是一个请求超时（默认 10 秒），
 * 相对 5 分钟的间隔可以忽略。
 */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = tail.then(task, task);
  tail = next.catch(() => {});
  return next;
}

/* ── 变化判定 ──────────────────────────────────────────────── */

/**
 * 判「翻没翻面」用的指纹里**不含 observedAt** —— 那个每轮都在变，含进去等于
 * 每轮都推一次，「变更才推」就白写了。
 */
function presenceSignature(report: PresenceReport): string {
  const { observedAt: _observedAt, ...rest } = report;
  return JSON.stringify(rest);
}

function playedGamesSignature(report: PlayedGamesReport): string {
  return JSON.stringify(report.items);
}

/** 一路数据的推送闸门：内容变了、或者到了兜底时刻，才真的交出去 */
function gate() {
  let signature: string | null = null;
  let pushedAt = 0;

  return async function push(
    current: string,
    envelope: PlaystationEnvelope,
  ): Promise<boolean> {
    const due = Date.now() - pushedAt >= config.fullPushIntervalMs;
    if (current === signature && !due) return false;
    await deliver(envelope);
    signature = current;
    pushedAt = Date.now();
    return true;
  };
}

const pushPresence = gate();
const pushPlayedGames = gate();

/* ── 两路轮询各自的一轮 ────────────────────────────────────── */

async function presenceTick(): Promise<number> {
  const presence = await fetchPresence();
  const pushed = await pushPresence(presenceSignature(presence), { version: 1, presence });
  if (pushed && !dryRun) {
    info(
      presence.playing
        ? `此刻在玩 ${presence.playing.title}（${presence.playing.format ?? "未知平台"}）`
        : `此刻没在玩（${presence.online ? "在线" : "离线"}）`,
    );
  }
  return config.presenceIntervalMs;
}

async function playedGamesTick(): Promise<number> {
  const playedGames = await fetchPlayedGames();
  const pushed = await pushPlayedGames(playedGamesSignature(playedGames), {
    version: 1,
    playedGames,
  });
  if (pushed && !dryRun) info(`推送已玩列表 ${playedGames.items.length} 项`);
  return config.playedGamesIntervalMs;
}

/* ── 调度 ──────────────────────────────────────────────────── */

/**
 * 每个循环都是「跑完再排下一次」，不用 setInterval：
 * 上游卡住时 setInterval 会把任务越堆越多，而这里堆着也没用，最新那次才算数。
 * 抄自 reporters/emby-reporter/src/index.ts 的同名函数（那边还多一个 kick，
 * 用来让 webhook 插队；这边没有事件源，用不上）。
 *
 * `RETRY_MS` / `MAX_RETRY_MS` 只管**出错之后**隔多久再来一次：从前者起每连错
 * 一次翻倍，到后者封顶，跑通一次就复位。两个数和「闲着时多久轮一次」是分开的，
 * 因为那根本不是一回事 —— 已玩列表 5 分钟一轮，但站点抖一下不该也等五分钟。
 * 这条同时是「refresh 失败」那种
 * 失败态的兜底 —— 续不上 token 只是这一轮抛了个错，退避着重试，进程不会退出，
 * 也不会变成一秒一次的 crash loop。
 *
 * 定时器**不 unref**：这个进程没有别的东西吊着事件循环（emby 那份有个 webhook
 * 服务器），unref 掉会让它排完第一轮就干净利落地退出。
 */
function loop(scope: string, task: () => Promise<number>) {
  let backoff = config.retryMs;

  async function run() {
    let next: number;
    try {
      next = await serial(task);
      recovered(scope);
      backoff = config.retryMs;
    } catch (error) {
      next = backoff;
      backoff = Math.min(backoff * 2, config.maxRetryMs);
      // 「隔多久再来」和错误本身写成同一条，而不是各写一行：log.ts 是按条退避的，
      // 另起一行就绕过了那套退避，久挂时会把 docker logs 冲满 —— 失败态三的
      // 模拟跑第一版正是这样，两路轮询各刷四行运维提醒
      failure(scope, new Error(`${Math.round(next / 1000)} 秒后重试 —— ${explain(error)}`));
    }
    setTimeout(run, next);
  }

  void run();
}

/* ── 入口 ──────────────────────────────────────────────────── */

/** `--once`：认证 + 两个端点各拉一次 + 输出信封，然后退出。用来冒烟 */
async function runOnce(): Promise<void> {
  const presence = await fetchPresence();
  const playedGames = await fetchPlayedGames();
  // 一次性跑就把两部分装进同一个信封 —— 常驻时它们各推各的，这里没有节奏可言
  await deliver({ version: 1, presence, playedGames });
  if (!dryRun) info(`推送完成：此刻状态 + 已玩列表 ${playedGames.items.length} 项`);
}

function explain(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  info(`playstation-reporter 启动${once ? "（--once）" : ""}`);
  announceTarget();

  // 失败态一：连一份能用的凭据都没有。在**起来的那一刻**就说清楚，
  // 而不是等第一轮打完上游才发现，也不要在那之前先去打任何上游
  try {
    await assertUsableCredentials();
  } catch (error) {
    console.error(`${new Date().toISOString()} [启动] ${explain(error)}`);
    process.exit(1);
  }

  if (once) {
    try {
      await runOnce();
      process.exit(0);
    } catch (error) {
      // 失败态二：NPSSO 过期 / 无效，报错里带着该怎么办
      console.error(`${new Date().toISOString()} [--once] ${explain(error)}`);
      if (error instanceof RefreshRejected) {
        console.error("  · 状态文件里的 refresh token 不作数了，配一份新的 PSN_NPSSO 再来");
      }
      process.exit(1);
    }
  }

  info(
    `presence 每 ${config.presenceIntervalMs / 1000} 秒一轮，` +
      `已玩列表每 ${config.playedGamesIntervalMs / 1000} 秒一轮，` +
      `兜底整推间隔 ${config.fullPushIntervalMs / 1000} 秒`,
  );
  loop("presence", presenceTick);
  loop("played-games", playedGamesTick);
}

process.on("unhandledRejection", (error) => failure("unhandled", error));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    process.exit(0);
  });
}

void main();
