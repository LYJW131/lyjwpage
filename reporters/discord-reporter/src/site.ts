import type { PresenceReport } from "./presence.js";

export type SiteSettings = {
  ingestUrl: string;
  clientId: string;
  clientSecret: string;
  pushTimeoutMs: number;
  dryRun: boolean;
};

type SiteEnvelope = { ok?: boolean; error?: string; data?: { changed?: boolean } };

export function createSitePush(settings: SiteSettings, fetcher: typeof fetch = fetch) {
  return async (presence: PresenceReport, signal?: AbortSignal): Promise<{ changed: boolean }> => {
    if (settings.dryRun) return { changed: false };
    const response = await fetcher(settings.ingestUrl, {
      method: "POST",
      headers: {
        "CF-Access-Client-Id": settings.clientId,
        "CF-Access-Client-Secret": settings.clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: 1, presence }),
      signal: AbortSignal.any([AbortSignal.timeout(settings.pushTimeoutMs), signal ?? new AbortController().signal]),
    });
    const body = (await response.json().catch(() => null)) as SiteEnvelope | null;
    if (!response.ok || body?.ok !== true) {
      throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
    }
    return { changed: body.data?.changed === true };
  };
}
