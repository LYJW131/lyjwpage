import {
  CredentialsRejected,
  fetchRecent,
  getContainerDuration,
  normalize,
  type AppleResource,
} from "./apple-music.js";
import { config } from "./config.js";
import { failure, info, recovered } from "./log.js";
import { fetchCredentials, push, type Credentials, type ListeningReport } from "./site.js";

/**
 * 「最近在听」上报器。
 *
 * 站点从前自己去 api.music.apple.com 拉这份列表 —— 全站唯一一路主动回源，
 * 而且每个访客的每一轮轮询都要重走一遍缓存。搬到这里之后站点读自己的
 * 数据缓存，不再打 Apple。
 *
 * 更要紧的是「此刻在不在听」：Apple 没有可查的「当前播放」接口，只能观测最近
 * 播放列表里排第一的那项**什么时候变成第一的**。这个观测状态在站点里存在进程
 * 内存中，serverless 上每个实例各有一份、活不到下一次切换，等于永远推断不出来。
 * 观测需要一个按固定节奏一直看着的进程，那就是这里。
 */

/** 提前这么久就去换新的凭据，别等它真的过期 */
const RENEW_BEFORE_MS = 60 * 60_000;

let credentials: Credentials | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 手上那份凭据，必要时去站点换新的。
 *
 * 换新失败但旧的还没过期时继续用旧的：站点重部署那几十秒不该把上报也一起停掉。
 */
async function currentCredentials(force = false): Promise<Credentials> {
  const now = Date.now();
  const stale = credentials != null && credentials.expiresAt * 1000 - now < RENEW_BEFORE_MS;
  if (credentials && !force && !stale) return credentials;

  try {
    const fresh = await fetchCredentials();
    const changed = fresh.developerToken !== credentials?.developerToken;
    credentials = fresh;
    if (changed) {
      info(`取到凭据，标称 ${new Date(fresh.expiresAt * 1000).toISOString()} 到期`);
    }
    return fresh;
  } catch (error) {
    // 旧的还能用就先扛着；一份都没有就只能把错误抛回循环
    if (credentials && credentials.expiresAt * 1000 > now) {
      failure("credentials", error);
      return credentials;
    }
    throw error;
  }
}

/**
 * 上一次观测到排在最前的那一项。
 *
 * switchedAt 只有在真的看见「它从别的东西换成了它」时才有值。刚起来时看到的
 * 第一项是 null —— 那个时间戳只是我们开始看的时刻，不是它开始播的时刻，拿它去
 * 算时长会凭空造出一段「播放中」。
 *
 * 不做持久化：重启后要重新观测到一次切换才会再判定「在听」。站点那份从前是每次
 * 冷启动都要重来一遍，这里只有容器重启才会，代价小得多，不值得为它挂个卷。
 */
let lastSeen: { id: string; switchedAt: number | null } | null = null;

function observe(id: string, now: number): number | null {
  if (!lastSeen || lastSeen.id !== id) {
    lastSeen = { id, switchedAt: lastSeen === null ? null : now };
  }
  return lastSeen.switchedAt;
}

/**
 * 推断此刻在不在听。
 *
 * 判定为「在听」要同时满足两个条件，缺一个就返回 null：
 * 1. 确实记录到了它变成第一的那个时刻（不是刚起来时它本来就在那儿）
 * 2. 距那一刻还没超过这张专辑 / 这个歌单的总时长
 *
 * 已知的不精确之处（和从前一样，是这个推断本身的性质）：
 * - 一直循环同一张专辑时 id 不变，会被当成已经停了
 * - 只听了专辑里一首歌就走开，仍会按整张时长算，这段时间内都显示在听
 * - 换歌时刻最多晚一个轮询间隔被记下
 */
async function inferNowPlaying(
  top: AppleResource,
  credentials: Credentials,
  now: number,
): Promise<{ guess: ListeningReport["nowPlaying"]; durationMs: number }> {
  const id = String(top.id ?? "");
  if (!id) return { guess: null, durationMs: 0 };

  const switchedAt = observe(id, now);
  // 时长无论如何都要算：hero 那一格要显示它，缓存一天，稳定状态下不打上游
  const durationMs = await getContainerDuration(top, credentials);

  if (switchedAt === null || !durationMs || now - switchedAt >= durationMs) {
    return { guess: null, durationMs };
  }
  return { guess: { itemId: id, startedAt: switchedAt, durationMs }, durationMs };
}

/** 上一次真的推上去的内容和时刻，用来决定这轮要不要推 */
let pushedContent = "";
let pushedAt = 0;

async function tick() {
  const credentials = await currentCredentials();
  const resources = await fetchRecent(credentials);
  const now = Date.now();

  const items: ListeningReport["items"] = [];
  for (const resource of resources.slice(0, config.recentLimit)) {
    items.push(await normalize(resource, credentials));
  }

  const top = resources[0];
  let nowPlaying: ListeningReport["nowPlaying"] = null;
  if (top) {
    const inferred = await inferNowPlaying(top, credentials, now);
    nowPlaying = inferred.guess;
    const first = items[0];
    if (first && inferred.durationMs > 0) {
      items[0] = { ...first, durationMs: inferred.durationMs };
    }
  }

  const report: ListeningReport = { items, nowPlaying };
  const content = JSON.stringify(report);
  const due = now - pushedAt >= config.fullPushIntervalMs;
  // 没变也没到兜底时刻就不打扰站点 —— 那边是按调用计费的函数
  if (content === pushedContent && !due) return;

  const result = await push(report);
  pushedContent = content;
  pushedAt = Date.now();
  if (result.changed) {
    info(`推送 ${result.items} 项${nowPlaying ? "，此刻在听" : ""}`);
  }
}

async function loop() {
  for (;;) {
    try {
      await tick();
      recovered("tick");
    } catch (error) {
      failure("tick", error);
      // 凭据被上游拒了：下一轮开始前先换一份，别拿着同一份死磕整个间隔
      if (error instanceof CredentialsRejected) {
        await currentCredentials(true).catch((reason) => failure("credentials", reason));
      }
    }
    await sleep(config.recentIntervalMs);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    process.exit(0);
  });
}

info(`apple-music-reporter 启动：${config.site.ingestUrl}，每 ${config.recentIntervalMs / 1000} 秒一轮`);
if (!config.site.secret) info("没配 TELEMETRY_INGEST_SECRET —— 只有站点也没配时才可以这样");
void loop();
