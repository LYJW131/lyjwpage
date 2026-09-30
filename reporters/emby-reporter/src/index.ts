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
import { pickMedia, playMethod } from "./playback.js";
import { uploadImage } from "./r2.js";
import { push, type PlayingReport, type PushPayload } from "./site.js";
import { startWebhookServer } from "./webhook.js";


const knownImages = new Set<string>();
const pendingImages = new Map<string, ImageRef>();
const REF_LIMIT = 256;
const imageRefs = new Map<string, ImageRef>();

function capMap<V>(map: Map<string, V>, limit: number) {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function remember(refs: ImageRef[]) {
  for (const ref of refs) {
    imageRefs.delete(ref.key);
    imageRefs.set(ref.key, ref);
  }
  capMap(imageRefs, REF_LIMIT);
}

// 两个采集循环共享图片队列；推送必须串行，否则会重复下载并竞争更新队列。
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

// 取不到或上传后仍被拒的图都必须限次出队，否则会永久占据队头、饿死后续图片。
const MAX_IMAGE_ATTEMPTS = 3;
const ATTEMPT_LIMIT = 256;
const attempts = new Map<string, number>();

function countAttempt(key: string) {
  const tried = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, tried);
  capMap(attempts, ATTEMPT_LIMIT);
  if (tried >= MAX_IMAGE_ATTEMPTS) pendingImages.delete(key);
}

function queueImage(ref: ImageRef) {
  if (knownImages.has(ref.key)) return;
  if ((attempts.get(ref.key) ?? 0) >= MAX_IMAGE_ATTEMPTS) return;
  pendingImages.set(ref.key, ref);
}

async function collectImages(): Promise<Array<{ imageKey: string; objectKey: string }>> {
  const images: Array<{ imageKey: string; objectKey: string }> = [];
  for (const ref of [...pendingImages.values()].slice(0, config.imagesPerPush)) {
    try {
      const source = await fetchImage(ref);
      images.push({ imageKey: ref.key, objectKey: await uploadImage(source, ref.height) });
      recovered("emby-image");
    } catch (error) {
      failure("emby-image", error);
      countAttempt(ref.key);
    }
  }
  return images;
}

async function deliver(payload: PushPayload, referenced: ImageRef[]) {
  remember(referenced);
  for (const ref of referenced) queueImage(ref);

  const images = await collectImages();
  if (!images.length && !Object.keys(payload).length) return;

  const result = await push(images.length ? { ...payload, images } : payload);

  for (const image of images) {
    knownImages.add(image.imageKey);
    pendingImages.delete(image.imageKey);
    countAttempt(image.imageKey);
  }
  for (const key of result.missingImages) {
    knownImages.delete(key);
    const ref = imageRefs.get(key);
    if (ref) queueImage(ref);
  }
  for (const image of images) {
    if (!result.missingImages.includes(image.imageKey)) attempts.delete(image.imageKey);
  }

  recovered("push");
  if (pendingImages.size) scheduleImageFlush();
}


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


let anchor: {
  itemId: string;
  positionMs: number;
  paused: boolean;
  at: number;
  signature: string;
} | null = null;
let playing: MappedItem | null = null;
let emptyPolls = 0;
let wakeUntil = 0;
// 重启后本地锚点为空而站点仍可能保留播放状态，首次空查也必须显式清除。
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
  // 锚点必须取读到位置的时刻；若取推送完成时刻，传图耗时会被误判为每轮都在拖动进度。
  const observedAt = Date.now();
  const positionMs = (Number(session.PlayState?.PositionTicks) || 0) / TICKS_PER_MS;
  const paused = Boolean(session.PlayState?.IsPaused);

  // 详情缓存不能以锚点为准：推送失败时锚点不前进，会导致每轮重复取详情。
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

  const client = session.Client?.trim() || null;
  const deviceName = session.DeviceName?.trim() || null;
  const method = playMethod(session.PlayState);
  const media = pickMedia({
    playState: session.PlayState,
    nowPlaying: session.NowPlayingItem,
    item: playing?.media ?? null,
  });
  const signature = JSON.stringify([client, deviceName, method, media]);
  const changed = signature !== anchor?.signature;

  if (switched || paused !== anchor?.paused || drifted || stale || changed) {
    const report: PlayingReport = {
      itemId,
      paused,
      positionTicks: Number(session.PlayState?.PositionTicks) || 0,
      runTimeTicks: Number(session.NowPlayingItem?.RunTimeTicks) || 0,
      client,
      deviceName,
      playMethod: method,
      media,
      item: playing?.item ?? null,
    };
    await deliver({ playing: report }, playing?.images ?? []);
    anchor = { itemId, positionMs, paused, at: observedAt, signature };
  }

  return paused && !awake() ? config.sessionIdleIntervalMs : config.sessionActiveIntervalMs;
}


function loop(
  scope: string,
  task: () => Promise<number>,
  retryMs: number,
  maxRetryMs = retryMs,
) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let again: number | null = null;
  let backoff = retryMs;

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
    timer.unref();
  };

  async function run() {
    running = true;
    let next: number;
    try {
      next = await serial(task);
      backoff = retryMs;
    } catch (error) {
      failure(scope, error);
      next = backoff;
      backoff = Math.min(backoff * 2, maxRetryMs);
    }
    running = false;
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

function scheduleImageFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void serial(async () => {
      if (!pendingImages.size) return;
      try {
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

  const kickResume = loop(
    "emby-resume",
    async () => {
      await resumeTick();
      return config.resumeIntervalMs;
    },
    config.resumeIntervalMs,
  );
  const kickSession = loop(
    "emby-session",
    sessionTick,
    config.sessionActiveIntervalMs,
    config.sessionIdleIntervalMs,
  );

  startWebhookServer((event) => {
    if (event === "stop") {
      wakeUntil = 0;
      void serial(async () => {
        anchor = null;
        playing = null;
        emptyPolls = 0;
        synced = true;
        try {
          await deliver({ playing: null }, []);
        } catch (error) {
          failure("push", error);
        }
      });
    } else {
      wakeUntil = Date.now() + config.wakeWindowMs;
      kickSession();
    }
    // Emby 写入 UserData 有延迟；只延后刷新 stop/pause，start 含高频进度通知，会绕过轮询限流。
    if (event === "stop" || event === "pause") kickResume(3_000);
  });
}

process.on("unhandledRejection", (error) => failure("unhandled", error));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    info(`收到 ${signal}，退出`);
    process.exit(0);
  });
}

main();
