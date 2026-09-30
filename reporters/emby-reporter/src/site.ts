import { config } from "./config.js";
import type { ReportItem } from "./emby.js";
import type { PlaybackMedia, PlayMethod } from "./playback.js";

export type PushPayload = {
  resume?: { items: ReportItem[] };
  playing?: PlayingReport | null;
  images?: Array<{ imageKey: string; objectKey: string }>;
};

export type PlayingReport = {
  itemId: string;
  paused: boolean;
  positionTicks: number;
  runTimeTicks: number;
  client: string | null;
  deviceName: string | null;
  playMethod: PlayMethod | null;
  media: PlaybackMedia | null;
  item: ReportItem | null;
};

type PushResult = {
  missingImages: string[];
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };

function authHeaders(): Record<string, string> {
  return { "CF-Access-Client-Id": config.site.accessClientId, "CF-Access-Client-Secret": config.site.accessClientSecret };
}

async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
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
