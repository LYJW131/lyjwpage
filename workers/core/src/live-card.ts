import { appleArtwork } from "@shared/apple-artwork";
import { AwaitingReport } from "@shared/awaiting-report";
import { readBoundedBytes } from "@shared/read-bounded-bytes";

import { getCodingNow } from "./coding-usage";
import { getNowWatching } from "./emby";
import { pickLiveActivity, type LiveActivity, type LiveActivityInput } from "./live-activity";
import { renderLiveCard } from "./live-card-render";
import { getPlayingNow } from "./playstation";
import { getQuestNow } from "./quest";
import { currentContext, type Env } from "./runtime";
import { getNowListening } from "./telemetry";

export const LIVE_CARD_PATH = "/api/cards/now.svg";

// 「此刻」比另两张卡变得快，缓存给短一点；README 图经 GitHub camo，本来就不精确到秒。
export const LIVE_CARD_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";
// 取数整体失败时仍回一张 idle 卡（200），README 不出破图；只把缓存缩到一分钟让恢复更快被看到。
const LIVE_CARD_FAILED_CACHE_CONTROL = "public, max-age=60";

const ART_PIXELS = 160;
const ART_MAX_BYTES = 40 * 1024;
// 抓进来的原图上限：PSN 图标是几百 KB 的 PNG，4MB 足够盖住又挡住了异常大文件。
const ART_SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const ART_TIMEOUT_MS = 1_500;
const ART_MAX_REDIRECTS = 2;

// 只对这几处明确的远端来源发请求：Apple 的图 CDN（模板与签名链接）、Discord 的图 CDN、
// PSN 的图标域。本站图一律走 IMAGE_OBJECTS 绑定按对象键读，不经 URL。
const REMOTE_ART_EXACT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "image.api.playstation.com",
  "psn-rsc.prod.dl.playstation.net",
  "psnobj.prod.dl.playstation.net",
]);
const REMOTE_ART_SUFFIX_HOSTS = ["mzstatic.com", "blobstore.apple.com"];

// 没有 transform 绑定时（本地、测试）只内联本来就够小的静态图；SVG 不内联（来源里也没有）。
const INLINE_ART_TYPES = new Set(["image/webp", "image/png", "image/jpeg", "image/avif", "image/gif"]);

const OBJECT_EXT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function remoteArtUrl(raw: string): string | null {
  const sized = appleArtwork(raw, ART_PIXELS);
  if (!sized) return null;
  let url: URL;
  try {
    url = new URL(sized);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  const allowed = REMOTE_ART_EXACT_HOSTS.has(host)
    || REMOTE_ART_SUFFIX_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return allowed ? url.href : null;
}

type ArtSource = { bytes: Uint8Array; type: string | null };

// 白名单逐跳重验，重定向目标同样过 remoteArtUrl；目标不可信、超时、非 2xx、非 image/*、
// 声明或实际超上限都返回 null，由调用方决定不放封面。
export async function remoteArtBytes(raw: string, fetchImpl: typeof fetch, deadline: number): Promise<ArtSource | null> {
  let href = remoteArtUrl(raw);
  for (let hop = 0; href !== null && hop <= ART_MAX_REDIRECTS; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    let response: Response;
    try {
      response = await fetchImpl(href, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        headers: { Accept: "image/*" },
      });
    } catch {
      return null;
    }
    if (Date.now() >= deadline) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      try {
        href = remoteArtUrl(new URL(location, href).href);
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null;
    if (type !== null && !type.startsWith("image/")) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > ART_SOURCE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    try {
      return { bytes: await readBoundedBytes(response.body, ART_SOURCE_MAX_BYTES), type };
    } catch {
      return null;
    }
  }
  return null;
}

async function r2ArtBytes(bucket: R2Bucket | undefined, objectKey: string): Promise<ArtSource | null> {
  if (!bucket) return null;
  try {
    const object = await bucket.get(objectKey);
    if (!object) return null;
    if (object.size > ART_SOURCE_MAX_BYTES) {
      await object.body.cancel().catch(() => undefined);
      return null;
    }
    const type = object.httpMetadata?.contentType ?? OBJECT_EXT_TYPES[objectKey.split(".").pop() ?? ""] ?? null;
    return { bytes: new Uint8Array(await object.arrayBuffer()), type };
  } catch {
    return null;
  }
}

// 有 IMAGES 绑定就统一裁成 160×160 webp（PSN 的大 PNG 也靠它缩到上限内）；
// 没有或 transform 失败时，本来就小的图按原字节内联，其余放弃。
async function artDataUri(source: ArtSource, images: ImagesBinding | undefined): Promise<string | null> {
  if (images) {
    try {
      const result = await images
        .input(bytesStream(source.bytes))
        .transform({ width: ART_PIXELS, height: ART_PIXELS, fit: "cover" })
        .output({ format: "image/webp", quality: 70 });
      const response = result.response();
      if (!response.ok) return null;
      const out = await response.arrayBuffer();
      if (out.byteLength > ART_MAX_BYTES) return null;
      return `data:image/webp;base64,${Buffer.from(out).toString("base64")}`;
    } catch {
      // transform 挂了退回按原字节内联
    }
  }
  if (source.bytes.length <= ART_MAX_BYTES && source.type && INLINE_ART_TYPES.has(source.type)) {
    return `data:${source.type};base64,${Buffer.from(source.bytes).toString("base64")}`;
  }
  return null;
}

export async function liveCardArtwork(
  activity: Pick<LiveActivity, "artworkKey" | "artworkUrl">,
  env: Pick<Env, "IMAGE_OBJECTS" | "IMAGES">,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (activity.artworkKey) {
    const source = await r2ArtBytes(env.IMAGE_OBJECTS, activity.artworkKey);
    return source ? artDataUri(source, env.IMAGES) : null;
  }
  if (activity.artworkUrl) {
    const source = await remoteArtBytes(activity.artworkUrl, fetchImpl, Date.now() + ART_TIMEOUT_MS);
    return source ? artDataUri(source, env.IMAGES) : null;
  }
  return null;
}

// 单一来源读不到只是「这一路此刻没数据」，AwaitingReport（还没上报过）连日志都不用打；
// 真出错的记为 degraded：整张卡还是 200，但用短缓存让故障恢复后更快被看到。
async function liveCardInput(): Promise<{ input: LiveActivityInput; degraded: boolean }> {
  let degraded = false;
  const attempt = async <T>(load: () => Promise<T>, label: string): Promise<T | null> => {
    try {
      return await load();
    } catch (error) {
      if (!(error instanceof AwaitingReport)) {
        degraded = true;
        console.error("[live-card]", label, error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
      return null;
    }
  };
  const [nowListening, nowWatching, playingNow, questNow, codingNow] = await Promise.all([
    attempt(getNowListening, "listening"),
    attempt(getNowWatching, "watching"),
    attempt(getPlayingNow, "playstation"),
    attempt(getQuestNow, "quest"),
    attempt(getCodingNow, "coding"),
  ]);
  return { input: { nowListening, nowWatching, playingNow, questNow, codingNow }, degraded };
}

const svgHeaders = (cacheControl: string): HeadersInit => ({
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": cacheControl,
});

export async function liveCardResponse(): Promise<Response> {
  const now = Date.now();
  try {
    const { input, degraded } = await liveCardInput();
    const activity = pickLiveActivity(input, now);
    const artwork = await liveCardArtwork(activity, currentContext().env);
    const svg = renderLiveCard(
      {
        kind: activity.kind,
        title: activity.title,
        subtitle: activity.subtitle,
        artwork,
        alsoListening: activity.alsoListening,
        lastActiveAt: activity.lastActiveAt,
      },
      now,
    );
    return new Response(svg, {
      headers: svgHeaders(degraded ? LIVE_CARD_FAILED_CACHE_CONTROL : LIVE_CARD_CACHE_CONTROL),
    });
  } catch (error) {
    console.error("[live-card]", error instanceof Error ? (error.stack ?? error.message) : String(error));
    const svg = renderLiveCard(
      { kind: "idle", title: null, subtitle: null, artwork: null, alsoListening: null, lastActiveAt: null },
      now,
    );
    return new Response(svg, { headers: svgHeaders(LIVE_CARD_FAILED_CACHE_CONTROL) });
  }
}
