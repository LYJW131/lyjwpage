import {
  appleFetchRaw,
  appleStorefront,
  resolveCredentials,
  type Credentials,
} from "@/lib/apple-music";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { cached, get, put } from "@/lib/cache";
import type { ListeningItem, RecentTrack } from "@/lib/types";

import { ok, skipMissing, type Job } from "../job";
import { epochMinute } from "../schedule";


// 上游硬限制此数量，增加 limit 会直接返回 400。
const RECENT_LIMIT = 10;
const RECENT_TRACKS_LIMIT = 10;
const RECENT_TRACK_TYPES = "songs,library-songs";
const DURATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TRACK_PAGES = 5;
// 资料库封面是预签名 URL，缓存期限必须短于签名有效期并留出分发余量。
const LIBRARY_ARTWORK_TTL_MS = 12 * 60 * 60 * 1000;
const USER_PLAYLIST_PREFIX = "pl.u-";

// 列表只说明两次刷新之间变过：闲时按 Pulse 的 5 分钟桶拉；列表一变就进活跃档每分钟拉，
// 一首歌只要放过就能单独落进一段，ACTIVE_HOLD_MS 内没再变化才回闲档。
export const IDLE_EVERY_MINUTES = 5;
export const ACTIVE_HOLD_MS = 10 * 60 * 1000;
const LAST_CHANGE_KEY = "apple-recent:last-change";

export function appleRecentDue(now: number, lastChangeAt: number | undefined): boolean {
  return epochMinute(now) % IDLE_EVERY_MINUTES === 0 || (lastChangeAt !== undefined && now - lastChangeAt < ACTIVE_HOLD_MS);
}

type AppleArtwork = {
  url?: string;
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
  textColor3?: string;
  textColor4?: string;
};

type AppleResource = {
  id?: string;
  type?: string;
  href?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    curatorName?: string;
    url?: string;
    artwork?: AppleArtwork;
    playParams?: { id?: string };
  };
};

type AppleTrack = {
  id?: string;
  type?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
    playParams?: { catalogId?: string };
  };
};

type TrackRelationship = {
  data?: Array<{ attributes?: { durationInMillis?: number } }>;
  next?: string;
};

type ContainerDetail = {
  relationships?: { tracks?: TrackRelationship };
};

type CatalogPlaylistWithLibrary = {
  relationships?: {
    library?: { data?: Array<{ attributes?: { artwork?: { url?: string } } }> };
  };
};

async function appleFetchList<T>(url: string, credentials: Credentials): Promise<T[]> {
  const json = await appleFetchRaw<{ data?: T[] }>(url, credentials);
  return Array.isArray(json?.data) ? json.data : [];
}

export function artworkPalette(artwork?: AppleArtwork): string[] {
  if (!artwork) return [];
  return [
    artwork.bgColor,
    artwork.textColor1,
    artwork.textColor2,
    artwork.textColor3,
    artwork.textColor4,
  ]
    .filter((value): value is string => typeof value === "string" && /^[0-9a-f]{6}$/i.test(value))
    .map((value) => `#${value}`);
}

async function libraryPlaylistCover(id: string, credentials: Credentials): Promise<string | null> {
  if (!id.startsWith(USER_PLAYLIST_PREFIX)) return null;
  try {
    const url = await cached(`apple-music:library-art:v1:${id}`, LIBRARY_ARTWORK_TTL_MS, async () => {
      const rows = await appleFetchList<CatalogPlaylistWithLibrary>(
        `https://api.music.apple.com/v1/catalog/${appleStorefront()}/playlists/${id}?include=library`,
        credentials,
      );
      for (const copy of rows[0]?.relationships?.library?.data ?? []) {
        const found = copy.attributes?.artwork?.url;
        if (found) return found;
      }
      return "";
    });
    return url || null;
  } catch {
    return null;
  }
}

async function containerDuration(
  resource: AppleResource,
  credentials: Credentials,
): Promise<number> {
  const href = resource.href;
  const id = resource.id;
  if (!href || !id) return 0;

  return cached(`apple-music:duration:v1:${id}`, DURATION_TTL_MS, async () => {
    let total = 0;
    let url: string | undefined = `${href}?include=tracks`;

    for (let page = 0; page < MAX_TRACK_PAGES && url; page += 1) {
      const detail: ContainerDetail[] = await appleFetchList<ContainerDetail>(
        url.startsWith("http") ? url : `https://api.music.apple.com${url}`,
        credentials,
      );

      const tracks: TrackRelationship | undefined = detail[0]?.relationships?.tracks;
      for (const track of tracks?.data ?? []) {
        total += Number(track.attributes?.durationInMillis) || 0;
      }
      url = tracks?.next;
    }

    return total;
  });
}

async function normalize(
  resource: AppleResource,
  credentials: Credentials,
): Promise<ListeningItem> {
  const attributes = resource.attributes ?? {};
  const id = String(resource.id ?? attributes.playParams?.id ?? "");

  // catalog 常返回自动拼图；用户自选封面必须优先从资料库读取。
  const fromLibrary = await libraryPlaylistCover(id, credentials);

  return {
    id,
    title: attributes.name ?? "",
    artist: attributes.artistName ?? attributes.curatorName ?? "",
    artwork: fromLibrary ?? attributes.artwork?.url ?? null,
    link: attributes.url ?? null,
    palette: artworkPalette(attributes.artwork),
    durationMs: null,
  };
}

export async function assemble(credentials: Credentials): Promise<ListeningItem[]> {
  const resources = await appleFetchList<AppleResource>(
    `https://api.music.apple.com/v1/me/recent/played?limit=${RECENT_LIMIT}`,
    credentials,
  );

  const items = await Promise.all(
    resources.slice(0, RECENT_LIMIT).map((resource) => normalize(resource, credentials)),
  );

  const top = resources[0];
  if (top && items[0]) {
    const durationMs = await containerDuration(top, credentials).catch(() => 0);
    if (durationMs > 0) items[0] = { ...items[0], durationMs };
  }

  return items;
}

export async function assembleRecentTracks(credentials: Credentials): Promise<RecentTrack[]> {
  const tracks = await appleFetchList<AppleTrack>(
    `https://api.music.apple.com/v1/me/recent/played/tracks?types=${RECENT_TRACK_TYPES}&limit=${RECENT_TRACKS_LIMIT}`,
    credentials,
  );
  return tracks.slice(0, RECENT_TRACKS_LIMIT).flatMap((track) => track.id ? [{
    id: String(track.id),
    title: track.attributes?.name ?? "",
    artist: track.attributes?.artistName ?? "",
    album: track.attributes?.albumName ?? null,
    durationMs: Number(track.attributes?.durationInMillis) || null,
    songId: track.attributes?.playParams?.catalogId ?? (track.type === "songs" ? String(track.id) : null),
    artworkUrl: track.attributes?.artwork?.url ?? null,
  }] : []);
}

export const appleRecentJob: Job = {
  name: "apple-recent",
  everyMinutes: 1,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env, now, scheduled }) {
    if (scheduled && !appleRecentDue(now, await get<number>(LAST_CHANGE_KEY))) return { status: "skipped", detail: "idle" };
    const credentials = await readAppleMusicCredentials();
    if (!credentials.ok && credentials.reason === "never-pushed") {
      return skipMissing("apple-recent", ["CREDENTIALS apple-music:v1"]);
    }
    const resolved = await resolveCredentials();
    const [items, tracks] = await Promise.allSettled([
      assemble(resolved),
      assembleRecentTracks(resolved).then((list) => ({ list, observedAt: Date.now() })),
    ]);
    if (items.status === "rejected") throw items.reason;
    const { changed } = await env.CORE.commitRecentlyPlayed(items.value);
    if (tracks.status === "rejected") throw tracks.reason;
    const { traced } = await env.CORE.commitRecentTracks(tracks.value.list, tracks.value.observedAt);
    if (changed || traced) await put(LAST_CHANGE_KEY, now, ACTIVE_HOLD_MS);
    return ok([changed && "changed", traced && "traced"].filter(Boolean).join(",") || undefined);
  },
};
