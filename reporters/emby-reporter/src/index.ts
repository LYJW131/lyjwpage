import { config } from "./config.js";
import {
  fetchImage,
  fetchItem,
  fetchResume,
  fetchSession,
  TICKS_PER_MS,
  type ImageRef,
  type MappedItem,
} from "./emby.js";
import { failure, info, recovered } from "./log.js";
import { push, type PlayingReport, type PushPayload } from "./site.js";
import { startWebhookServer } from "./webhook.js";

/**
 * Emby → lyjwpage 推送代理。
 *
 * 站点将来跑在 Vercel 上，够不着内网里的 Emby，所以由这台机器把该给的送过去：
 * - 续播列表，60 秒一轮，有变化才推
 * - 播放位置，在播时 2 秒一轮，但只在拖动进度条（偏离站点的推算值）时才推
 * - 海报，只推站点还没有的那些
 *
 * Emby 的播放通知（开始/暂停/继续/停止）也发到这里再转发 —— 它的 webhook
 * 配置项加不了自定义请求头，直发站点就得开一个不鉴权的入口。事件同时当作
 * 会话轮询的开关：开播才起 2 秒那一档，停了就歇着，空闲时不盲轮。
 */

/** 站点已经有的图片键 */
const knownImages = new Set<string>();
/** 待补传的图 */
const pendingImages = new Map<string, ImageRef>();
/**
 * 键 → 取图信息。站点只会用键说「我缺这张」，得能反查回怎么取。
 * 有上限：看过的条目越攒越多，而只有当前列表里那些还有意义。
 */
const REF_LIMIT = 256;
const imageRefs = new Map<string, ImageRef>();

function remember(refs: ImageRef[]) {
  for (const ref of refs) {
    imageRefs.delete(ref.key);
    imageRefs.set(ref.key, ref);
  }
  while (imageRefs.size > REF_LIMIT) {
    const oldest = imageRefs.keys().next();
    if (oldest.done) break;
    imageRefs.delete(oldest.value);
  }
}

/**
 * 所有推送排成一条队。
 *
 * 续播和会话两个循环各跑各的，撞在一起时会同时改 knownImages / pendingImages，
 * 也会让同一张图被下载两遍。串起来最省事，反正推送本来就不密。
 */
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

/**
 * 送了几次站点还是说没有的图，就不再送了。
 *
 * 多半是那张图站点存不下（sharp 认不出的编码之类），而键是跟着 ImageTag 走的、
 * 不会自己变，不设上限的话补传队列会永远空不掉，每 2 秒空推一次。
 */
const MAX_IMAGE_ATTEMPTS = 3;
const attempts = new Map<string, number>();

function queueImage(ref: ImageRef) {
  if (knownImages.has(ref.key)) return;
  if ((attempts.get(ref.key) ?? 0) >= MAX_IMAGE_ATTEMPTS) return;
  pendingImages.set(ref.key, ref);
}

/** 取这一批要补传的图。取不到的留在队列里，下一轮再说 */
async function collectImages(): Promise<Array<{ key: string; data: string }>> {
  const images: Array<{ key: string; data: string }> = [];
  for (const ref of [...pendingImages.values()].slice(0, config.imagesPerPush)) {
    try {
      images.push({ key: ref.key, data: await fetchImage(ref) });
      recovered("emby-image");
    } catch (error) {
      // 取不到就先不带这张，条目照样推 —— 少张海报比整条状态断了强
      failure("emby-image", error);
    }
  }
  return images;
}

/** 带上这次能捎的图，把 payload 送出去 */
async function deliver(payload: PushPayload, referenced: ImageRef[]) {
  remember(referenced);
  for (const ref of referenced) queueImage(ref);

  const images = await collectImages();
  // payload 本身没内容、图也一张都没取到，这一趟就没必要发了
  if (!images.length && !Object.keys(payload).length) return;

  const result = await push(images.length ? { ...payload, images } : payload);

  for (const image of images) {
    knownImages.add(image.key);
    pendingImages.delete(image.key);
    attempts.set(image.key, (attempts.get(image.key) ?? 0) + 1);
  }
  // 站点说没有的，从「已有」里划掉排进补传队列（多半是它那边被清空过）
  for (const key of result.missingImages) {
    knownImages.delete(key);
    const ref = imageRefs.get(key);
    if (ref) queueImage(ref);
  }
  // 这一轮站点没抱怨的，说明真收下了，重新计数
  for (const image of images) {
    if (!result.missingImages.includes(image.key)) attempts.delete(image.key);
  }

  recovered("push");
  if (pendingImages.size) scheduleImageFlush();
}

/* ── 续播列表 ──────────────────────────────────────────────── */

let resumeSignature = "";
let resumePushedAt = 0;

async function resumeTick() {
  const items = await fetchResume();
  recovered("emby-resume");

  const signature = JSON.stringify(items.map((entry) => entry.item));
  const due = Date.now() - resumePushedAt >= config.fullPushIntervalMs;
  if (signature === resumeSignature && !due) return;

  await deliver(
    { resume: { items: items.map((entry) => entry.item) } },
    items.flatMap((entry) => entry.images),
  );
  resumeSignature = signature;
  resumePushedAt = Date.now();
}

/* ── 播放位置 ──────────────────────────────────────────────── */

/** 站点手上那份锚点的副本，用来判断它推算出来的位置偏了多少 */
let anchor: { itemId: string; positionMs: number; paused: boolean; at: number } | null = null;
let playing: MappedItem | null = null;
/** 连续几轮没看到会话。要连着两轮才当真，免得和刚到的开播事件抢 */
let emptyPolls = 0;
/** 收到 webhook 后这个时刻之前都按活跃档跟 */
let wakeUntil = 0;
/**
 * 启动后有没有和站点对过一次账。
 *
 * 代理重启（换镜像、NAS 重开）时站点那份状态还在，而我们手上是空的。第一轮
 * 查到没人在播就得明确清一次，否则站点会挂着一条谁也不会来更正的「正在播放」，
 * 直到它自己推算过片尾。
 */
let synced = false;

function projectedMs(): number | null {
  if (!anchor) return null;
  return anchor.paused ? anchor.positionMs : anchor.positionMs + (Date.now() - anchor.at);
}

function awake() {
  return Date.now() < wakeUntil;
}

async function sessionTick(): Promise<number> {
  const session = await fetchSession();
  recovered("emby-session");

  const itemId = session?.NowPlayingItem?.Id;
  if (!session || !itemId) {
    emptyPolls += 1;
    if (!synced || (anchor && emptyPolls >= 2)) {
      await deliver({ playing: null }, []);
      anchor = null;
      playing = null;
      synced = true;
    }
    if (anchor || awake()) return config.sessionActiveIntervalMs;
    return config.sessionIdleIntervalMs;
  }

  emptyPolls = 0;
  synced = true;
  const positionMs = (Number(session.PlayState?.PositionTicks) || 0) / TICKS_PER_MS;
  const paused = Boolean(session.PlayState?.IsPaused);

  // 换了片子就重新取一次详情：会话接口不带挑图要的那些 tag。
  // 判据看手上这份详情是谁的，不看锚点 —— 推送失败时锚点不会前进，
  // 拿它当判据会在站点挂着的这段时间里每 2 秒重取一次详情
  const switched = anchor?.itemId !== itemId;
  if (playing?.item.id !== itemId) {
    playing = await fetchItem(itemId).catch((error) => {
      failure("emby-item", error);
      return null;
    });
  }

  const projected = projectedMs();
  const drifted =
    projected == null || Math.abs(positionMs - projected) > config.seekToleranceMs;
  const stale = !anchor || Date.now() - anchor.at >= config.reanchorMs;

  if (switched || paused !== anchor?.paused || drifted || stale) {
    const report: PlayingReport = {
      itemId,
      paused,
      positionTicks: Number(session.PlayState?.PositionTicks) || 0,
      runTimeTicks: Number(session.NowPlayingItem?.RunTimeTicks) || 0,
      device: session.Client?.trim() || session.DeviceName?.trim() || "",
      item: playing?.item ?? null,
    };
    await deliver({ playing: report }, playing?.images ?? []);
    anchor = { itemId, positionMs, paused, at: Date.now() };
  }

  // 暂停时位置不会自己走，跟得那么紧没有意义；继续播时 webhook 会把我们叫醒
  return paused && !awake() ? config.sessionIdleIntervalMs : config.sessionActiveIntervalMs;
}

/* ── 调度 ──────────────────────────────────────────────────── */

/**
 * 每个循环都是「跑完再排下一次」，不用 setInterval：
 * 上游卡住时 setInterval 会把任务越堆越多，而这里堆着也没用，最新那次才算数。
 *
 * 返回的 kick 用来插队：webhook 到了要立刻查一次，不能等这一轮的定时器。
 */
function loop(scope: string, task: () => Promise<number>, retryMs: number) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let again: number | null = null;

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
    timer.unref();
  };

  async function run() {
    running = true;
    let next = retryMs;
    try {
      next = await serial(task);
    } catch (error) {
      failure(scope, error);
    }
    running = false;
    // 这一轮跑着的时候被插队过：那次插队要的是「跑完之后的最新状态」，补一轮
    schedule(again ?? next);
    again = null;
  }

  void run();
  return (delay = 0) => {
    if (running) again = Math.min(again ?? Infinity, delay);
    else schedule(delay);
  };
}

let flushTimer: NodeJS.Timeout | null = null;

/** 一次推送最多捎几张图，剩下的隔一小会儿接着送，别把 body 撑大 */
function scheduleImageFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void serial(async () => {
      if (!pendingImages.size) return;
      try {
        // 只带图，不动列表和播放状态 —— 站点按键把地址补上即可。
        // 一张都没取到就干脆不推，否则会变成 2 秒一次的空请求
        await deliver({}, []);
      } catch (error) {
        failure("push", error);
      }
    });
  }, 2_000);
  flushTimer.unref();
}

function main() {
  info(`emby-reporter 启动：${config.emby.url} → ${config.site.ingestUrl}`);
  if (!config.site.secret) {
    info("警告：未配置 TELEMETRY_INGEST_SECRET，推送将不带鉴权头");
  }

  const kickResume = loop(
    "emby-resume",
    async () => {
      await resumeTick();
      return config.resumeIntervalMs;
    },
    config.resumeIntervalMs,
  );
  const kickSession = loop("emby-session", sessionTick, config.sessionIdleIntervalMs);

  startWebhookServer((event) => {
    if (event === "stop") {
      // Emby 明说停了，不必再等两轮空查证实
      wakeUntil = 0;
      void serial(async () => {
        anchor = null;
        playing = null;
        emptyPolls = 0;
        synced = true;
        try {
          await deliver({ playing: null }, []);
        } catch (error) {
          // 清不掉也不至于挂着：站点那份状态自己会推算到片尾然后作废
          failure("push", error);
        }
      });
    } else {
      wakeUntil = Date.now() + config.wakeWindowMs;
      kickSession();
    }
    // 播完一集、暂停一会儿，续播列表的进度和顺序都会变，顺手催一下。
    // 等几秒是因为 Emby 要先把这次播放写进 UserData，问太早还是旧的
    kickResume(3_000);
  });
}

// 一次失败不该带走整个进程：NAS 上重启它的只有 docker 的重启策略，
// 而 Emby 或站点抖一下本来就该等下一轮
process.on("unhandledRejection", (error) => failure("unhandled", error));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
