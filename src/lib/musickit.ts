import { commit } from "@/lib/build-info";
import { site } from "@/lib/site";
import { workerUrl } from "@/lib/worker-url";
import { pastHalfLife } from "@shared/token-lifetime";


// 客户端环境变量必须用完整字面量，构建替换不支持解构或动态取键。
export const MUSICKIT_TOKEN_ENDPOINT = workerUrl(
  process.env.NEXT_PUBLIC_BACKEND_URL,
  "/api/musickit/token",
);

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

export const PLAYBACK_STATE = {
  none: 0,
  loading: 1,
  playing: 2,
  paused: 3,
  stopped: 4,
  ended: 5,
  seeking: 6,
  waiting: 8,
  stalled: 9,
} as const;

export const REPEAT_MODE = {
  none: 0,
  one: 1,
} as const;

export function applyRepeatMode(music: MusicKitInstance, repeatOne: boolean) {
  if ("repeatMode" in music) {
    music.repeatMode = repeatOne ? REPEAT_MODE.one : REPEAT_MODE.none;
  }
  if ("autoplayEnabled" in music) music.autoplayEnabled = !repeatOne;
}

export type MediaItemAttributes = {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  artwork?: { url?: string };
  url?: string;
  hasLyrics?: boolean;
};
export type MediaItem = {
  id?: string;
  attributes?: MediaItemAttributes;
  isAutoplay?: boolean;
};
export type QueueOptions = {
  song?: string;
  album?: string;
  playlist?: string;
  station?: string;
  url?: string;
  startPlaying?: boolean;
};

export type MusicKitInstance = {
  isAuthorized: boolean;
  storefrontId?: string;
  playbackState: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  volume: number;
  nowPlayingItem: MediaItem | null;
  queue?: {
    items?: MediaItem[];
    userAddedItems?: MediaItem[];
    autoplayItems?: MediaItem[];
  };
  autoplayEnabled?: boolean;
  repeatMode?: number;
  api?: {
    music?: (
      path: string,
      query?: Record<string, unknown>,
    ) => Promise<{ data?: { data?: unknown[]; [key: string]: unknown } | unknown[] }>;
  };
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  // 进度对齐只在加载后 seek；不要给 setQueue 暴露不可靠的 startTime。
  setQueue(options: QueueOptions): Promise<unknown>;
  playNext(options: { song?: string }, clear?: boolean): Promise<unknown>;
  playLater(options: { song?: string }): Promise<unknown>;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  changeToMediaAtIndex(index: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  addEventListener(name: string, handler: (event: unknown) => void): void;
  removeEventListener(name: string, handler: (event: unknown) => void): void;
};

type MusicKitGlobal = {
  configure(config: {
    developerToken: string;
    app: { name: string; build: string };
    storefrontId?: string;
  }): Promise<MusicKitInstance>;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

let scriptPromise: Promise<MusicKitGlobal> | null = null;

function loadMusicKitScript(): Promise<MusicKitGlobal> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<MusicKitGlobal>((resolve, reject) => {
    // 脚本可能在监听挂载前已加载；onload 和 musickitloaded 两路都要检查全局。
    const settle = () => {
      if (!window.MusicKit) return false;
      document.removeEventListener("musickitloaded", onLoaded);
      resolve(window.MusicKit);
      return true;
    };
    const onLoaded = () => settle();
    document.addEventListener("musickitloaded", onLoaded);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MUSICKIT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      // 事件可能比 load 晚一点点，没挂上就继续等 musickitloaded
      settle();
    });
    script.addEventListener("error", () => {
      document.removeEventListener("musickitloaded", onLoaded);
      scriptPromise = null;
      reject(new Error("MusicKit script failed to load"));
    });

    if (!existing) {
      script.src = MUSICKIT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

export type DeveloperToken = {
  token: string;
  issuedAt: number;
  expiresAt: number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

let cachedToken: DeveloperToken | null = null;

export async function fetchDeveloperToken(): Promise<DeveloperToken> {
  if (!MUSICKIT_TOKEN_ENDPOINT) throw new Error("MusicKit token endpoint is not configured");

  if (cachedToken && !pastHalfLife(cachedToken, nowSeconds())) return cachedToken;

  const response = await fetch(MUSICKIT_TOKEN_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail || `Token service returned ${response.status}`);
  }

  const token = (await response.json()) as DeveloperToken;
  if (!token.token) throw new Error("Token service returned no token");
  if (!Number.isFinite(token.issuedAt) || !Number.isFinite(token.expiresAt)) {
    throw new Error("Token service returned no issue / expiry time");
  }
  cachedToken = token;
  return token;
}

// MusicKit.configure 会覆盖全局实例，必须用同一个 Promise 防止并发重配。
let instancePromise: Promise<MusicKitInstance> | null = null;

export function getMusicKit(): Promise<MusicKitInstance> {
  // 实例 Promise 会跳过取 token 流程，半衰期校验不能只放在 fetchDeveloperToken 内。
  if (instancePromise && cachedToken && pastHalfLife(cachedToken, nowSeconds())) {
    instancePromise = null;
  }
  if (instancePromise) return instancePromise;

  instancePromise = (async () => {
    const [MusicKit, developer] = await Promise.all([
      loadMusicKitScript(),
      fetchDeveloperToken(),
    ]);
    const instance = await MusicKit.configure({
      developerToken: developer.token,
      app: { name: site.name, build: commit?.short ?? "dev" },
    });
    applyRepeatMode(instance, false);
    return instance;
  })().catch((error: unknown) => {
    // 失败不留缓存，否则第一次网络抖动之后按钮就再也点不动了
    instancePromise = null;
    throw error;
  });

  return instancePromise;
}
