/**
 * Quest 活动没有 `assets.large_image` 时，使用 Discord 应用封面 / 图标。
 * `/applications/{id}/rpc` 公开，不必 bot token。
 */

export type ApplicationRpc = {
  name: string | null;
  coverUrl: string | null;
};

const cache = new Map<string, ApplicationRpc | null>();
const inflight = new Map<string, Promise<ApplicationRpc | null>>();

const USER_AGENT = "DiscordBot (https://lyjw.me, 0.1.0)";

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function coverUrlFromRpc(
  appId: string,
  rpc: { cover_image?: unknown; icon?: unknown },
): string | null {
  const hash = asText(rpc.cover_image) ?? asText(rpc.icon);
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/app-icons/${appId}/${hash}.${ext}?size=256`;
}

async function lookup(appId: string): Promise<ApplicationRpc | null> {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/applications/${encodeURIComponent(appId)}/rpc`,
      {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.status === 404) {
      cache.set(appId, null);
      return null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as {
      name?: unknown;
      cover_image?: unknown;
      icon?: unknown;
    };
    const info: ApplicationRpc = {
      name: asText(body.name),
      coverUrl: coverUrlFromRpc(appId, body),
    };
    cache.set(appId, info);
    return info;
  } catch {
    return null;
  }
}

export async function applicationRpc(appId: string): Promise<ApplicationRpc | null> {
  if (cache.has(appId)) return cache.get(appId)!;
  const pending = inflight.get(appId);
  if (pending) return pending;
  const job = lookup(appId);
  inflight.set(appId, job);
  try {
    return await job;
  } finally {
    inflight.delete(appId);
  }
}

export async function applicationCoverUrl(appId: string): Promise<string | null> {
  return (await applicationRpc(appId))?.coverUrl ?? null;
}
