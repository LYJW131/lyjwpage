import { config } from "./config.js";
import type { ReportItem } from "./emby.js";
import type { PlaybackMedia, PlayMethod } from "./playback.js";

/** 站点 /api/ingest/emby 的请求体。三部分各推各的，都可以省略 */
export type PushPayload = {
  resume?: { items: ReportItem[] };
  /**
   * 缺席 = 这次不谈播放状态；显式 null = 确认没人在看了，站点要清掉。
   * JSON.stringify 会把 undefined 的键整个丢掉，正好是我们要的语义。
   */
  playing?: PlayingReport | null;
  /**
   * imageKey 是 Emby 侧的键（itemId:kind:tag:height），objectKey 是这份字节
   * 在 R2 上的内容地址。两个键挨在一起，名字得各自说清是谁的键。
   */
  images?: Array<{ imageKey: string; objectKey: string }>;
};

export type PlayingReport = {
  itemId: string;
  paused: boolean;
  positionTicks: number;
  runTimeTicks: number;
  /** 会话原样给的客户端名和设备名，拼法留给站点 */
  client: string | null;
  deviceName: string | null;
  playMethod: PlayMethod | null;
  /** 正在放的这一路的规格，见 playback.ts */
  media: PlaybackMedia | null;
  /** 播放中那一项的详情，站点的续播列表里不一定有它 */
  item: ReportItem | null;
};

type PushResult = {
  /** 站点引用了却没有的图片键。据此补传 */
  missingImages: string[];
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

/** 这个来源专用的 Access service token：Access 在边缘核对，放行后 Worker 验 JWT */
function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

/**
 * 成功 = HTTP 2xx 且信封 `ok === true`，两个条件都要判。上报入口成功回 202
 * `{ ok: true, data }`，失败回 4xx / 5xx `{ ok: false, error }`
 * （workers/ingress/src/worker.ts 的 handleIngest）。
 */
async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    // 把站点给的原因带出来：401/400 是配置问题，光看状态码要猜半天
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

export async function push(payload: PushPayload): Promise<PushResult> {
  const response = await fetch(config.site.ingestUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.pushTimeoutMs),
  });

  const data = await readEnvelope<{ missingImages?: unknown }>(response);
  const missing = data?.missingImages;
  return {
    missingImages: Array.isArray(missing)
      ? missing.filter((key): key is string => typeof key === "string")
      : [],
  };
}
