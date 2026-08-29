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
 * 「站点回了 `ok !== true` 就算失败」这条约定是**协议**的一部分，不是这个函数的
 * 内部实现 —— 站点的 ingestRoute 会用 200 之外的状态码和一个 `ok: false` 的信封
 * 表示软失败，认错了就会把它当成上报成功，而没有任何测试或类型会拦住。
 *
 * 这段代码从前和 Apple Music 上报器里的同名函数逐字相同，那边收编进站点之后只剩
 * 这一份了。将来再添上报器仍然是各自抄一份、各自是独立部署单元（理由见 log.ts），
 * 抄的时候连这条约定一起抄走。
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
