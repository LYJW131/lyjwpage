import {
  fetchDeveloperToken,
  type MediaItem,
  type MusicKitInstance,
  type QueueOptions,
} from "@/lib/musickit";
import type { ListeningItem } from "@/lib/types";

export const PLAYLIST_ROW_HEIGHT_PX = 32;
export const PLAYLIST_PADDING_Y_PX = 12;
export const PLAYLIST_BORDER_TOP_PX = 1;
export const PLAYLIST_EXTRA_HEIGHT_PX = PLAYLIST_PADDING_Y_PX + PLAYLIST_BORDER_TOP_PX;
export const PLAYLIST_MAX_VISIBLE_ROWS = 7;
export const PLAYLIST_MAX_HEIGHT_PX =
  PLAYLIST_MAX_VISIBLE_ROWS * PLAYLIST_ROW_HEIGHT_PX + PLAYLIST_EXTRA_HEIGHT_PX;

const playlistCache = new Map<string, MediaItem[]>();

export function getCachedPlaylist(id: string | null | undefined): MediaItem[] | undefined {
  if (!id) return undefined;
  return playlistCache.get(id);
}

export function setCachedPlaylist(id: string, items: MediaItem[]): void {
  if (!id || items.length === 0) return;
  playlistCache.set(id, items);
}

export function clearPlaylistCache(): void {
  playlistCache.clear();
}

export function playlistScrollportHeight(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(itemCount, PLAYLIST_MAX_VISIBLE_ROWS) * PLAYLIST_ROW_HEIGHT_PX;
}

export function computePlaylistHeight(itemCount: number): number {
  const scrollport = playlistScrollportHeight(itemCount);
  if (scrollport <= 0) return 0;
  return scrollport + PLAYLIST_EXTRA_HEIGHT_PX;
}

export function hasPersistedMusicUserToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storage = window.localStorage;
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      const lower = key.toLowerCase();
      if (lower.startsWith("music.") || lower.includes("musickit") || lower.includes("usertoken")) {
        const val = storage.getItem(key);
        if (val && val.length > 20) {
          return true;
        }
      }
    }
  } catch {
  }
  return false;
}

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
let authSnapshot: boolean | null = null;

export function getMusicAuthSnapshot(): boolean {
  if (authSnapshot !== null) return authSnapshot;
  return hasPersistedMusicUserToken();
}

export function getMusicAuthServerSnapshot(): boolean {
  return false;
}

export function setMusicAuthSnapshot(authorized: boolean): void {
  if (authSnapshot === authorized) return;
  authSnapshot = authorized;
  for (const listener of authListeners) {
    listener();
  }
}

export function subscribeMusicAuth(listener: AuthListener): () => void {
  authListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key && (e.key.toLowerCase().startsWith("music.") || e.key.toLowerCase().includes("usertoken"))) {
      setMusicAuthSnapshot(hasPersistedMusicUserToken());
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    authListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function resetMusicAuthStateForTesting(): void {
  authSnapshot = null;
  authListeners.clear();
}

export function queueOptionsFor(item: Pick<ListeningItem, "id" | "link">): QueueOptions | null {
  if (!item.link) return null;

  let parsed: URL;
  try {
    parsed = new URL(item.link);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kind = segments.find(
    (segment): segment is "album" | "playlist" | "station" =>
      segment === "album" || segment === "playlist" || segment === "station",
  );

  if (kind) {
    const id = item.id || segments[segments.length - 1];
    return { [kind]: id };
  }

  return { url: item.link };
}

export function catalogTracksPathFor(
  item: Pick<ListeningItem, "id" | "link">,
  defaultStorefront = "cn",
): string | null {
  if (!item.link) return null;

  let parsed: URL;
  try {
    parsed = new URL(item.link);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kindIdx = segments.findIndex(
    (segment) =>
      segment === "album" ||
      segment === "playlist" ||
      segment === "albums" ||
      segment === "playlists",
  );
  if (kindIdx < 0) return null;

  let storefront = defaultStorefront;
  if (kindIdx > 0 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) {
    storefront = segments[0].toLowerCase();
  }

  const rawKind = segments[kindIdx].toLowerCase();
  const kind = rawKind.startsWith("album") ? "albums" : "playlists";
  const id = item.id || segments[segments.length - 1];
  if (!id) return null;

  return `/v1/catalog/${storefront}/${kind}/${id}/tracks`;
}

export async function fetchCatalogTracks(
  item: Pick<ListeningItem, "id" | "link">,
  inst?: MusicKitInstance | null,
): Promise<MediaItem[]> {
  const path = catalogTracksPathFor(item, inst?.storefrontId);
  if (!path) return [];

  if (inst?.api?.music) {
    try {
      const res = await inst.api.music(path);
      const raw = res?.data;
      const data =
        raw && typeof raw === "object" && "data" in raw && Array.isArray(raw.data)
          ? raw.data
          : Array.isArray(raw)
            ? raw
            : null;
      if (data && data.length > 0) {
        return data as MediaItem[];
      }
    } catch {
    }
  }

  try {
    const token = await fetchDeveloperToken();
    const res = await fetch(`https://api.music.apple.com${path}`, {
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: MediaItem[] };
      if (Array.isArray(body?.data)) {
        return body.data;
      }
    }
  } catch {
  }

  return [];
}

type CatalogSong = {
  attributes?: {
    albumName?: string;
    artistName?: string;
    url?: string;
    artwork?: { url?: string };
  };
  relationships?: { albums?: { data?: { id?: string }[] } };
};

export async function fetchCatalogSongAlbum(
  songId: string,
  storefront = "cn",
): Promise<ListeningItem | null> {
  const token = await fetchDeveloperToken();
  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/songs/${encodeURIComponent(songId)}`,
    { headers: { Authorization: `Bearer ${token.token}` } },
  );
  if (!res.ok) throw new Error(`Apple Music returned ${res.status}`);
  const body = (await res.json()) as { data?: CatalogSong[] };
  const song = body.data?.[0];
  const albumId = song?.relationships?.albums?.data?.[0]?.id;
  const link = song?.attributes?.url;
  if (!albumId || !link) return null;
  return {
    id: albumId,
    title: song.attributes?.albumName ?? "",
    artist: song.attributes?.artistName ?? "",
    artwork: song.attributes?.artwork?.url ?? null,
    link,
    palette: [],
    durationMs: null,
  };
}

export function formatClock(milliseconds: number): string {
  if (Number.isNaN(milliseconds) || milliseconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const secondsStr = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const minutesStr = String(minutes).padStart(2, "0");
    return `${hours}:${minutesStr}:${secondsStr}`;
  }

  return `${minutes}:${secondsStr}`;
}

export function resolveVisibleQueue<T>(
  loadedAlbumId: string | null | undefined,
  currentAlbumId: string | null | undefined,
  queue: T[],
): T[] {
  if (!loadedAlbumId || !currentAlbumId || loadedAlbumId !== currentAlbumId) {
    return [];
  }
  return queue;
}

export function filterUserQueueItems(inst: MusicKitInstance | null | undefined): MediaItem[] {
  if (!inst?.queue) return [];
  const queue = inst.queue;
  if (Array.isArray(queue.userAddedItems) && queue.userAddedItems.length > 0) {
    return queue.userAddedItems;
  }
  const items = queue.items ?? [];
  return items.filter((item) => !item.isAutoplay);
}
