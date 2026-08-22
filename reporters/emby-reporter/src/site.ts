import { config } from "./config.js";
import type { ReportItem } from "./emby.js";

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
  device: string;
  /** 播放中那一项的详情，站点的续播列表里不一定有它 */
  item: ReportItem | null;
};

type PushResult = {
  /** 站点引用了却没有的图片键。据此补传 */
  missingImages: string[];
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return config.site.secret ? { Authorization: `Bearer ${config.site.secret}` } : {};
}

/**
 * 和另一份上报器的同名函数是同一段代码（只有下面那行注释不同，
 * 见 reporters/apple-music-reporter/src/site.ts），改一处记得同步另一处。
 *
 * 这不是随手的复制粘贴：它规定了「站点回了 `ok !== true` 就算失败」这条约定，
 * 是**协议**的一部分。两份哪天分了岔，症状会是其中一个上报器把站点的软失败当成
 * 了成功 —— 而没有任何测试或类型会拦住。两个上报器各自是独立的部署单元、
 * 各自 `docker compose up --build`，所以不抽成共享包（理由见 log.ts）。
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
