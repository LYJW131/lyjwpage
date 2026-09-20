/**
 * 从 Gateway 原始 presence 里抽出Quest 正在玩。
 *
 * discord.js 的 Activity 构造函数不拷 `platform`（Gateway 未文档字段），
 * 走它的 Presence 对象永远筛不出 Quest。这里只认 raw payload。
 */

export const GAME_PLATFORMS = ["meta_quest"] as const;
export type GamePlatform = (typeof GAME_PLATFORMS)[number];

const ALLOWED = new Set<string>(GAME_PLATFORMS);
/** Discord ActivityType.Playing。不从 discord.js 再进口径，这份文件保持纯解析。 */
const PLAYING = 0;

export type RawActivity = {
  name?: unknown;
  type?: unknown;
  platform?: unknown;
  details?: unknown;
  state?: unknown;
  timestamps?: { start?: unknown } | null;
  created_at?: unknown;
  application_id?: unknown;
  parent_application_id?: unknown;
  assets?: { large_image?: unknown } | null;
};

export type RawPresence = {
  status?: unknown;
  activities?: RawActivity[] | null;
};

export type PlayingReport = {
  name: string;
  platform: GamePlatform;
  details: string | null;
  state: string | null;
  startedAt: number | null;
  applicationId: string | null;
  /** Gateway `parent_application_id`。Quest 的 application_id 经常是 Meta 壳。 */
  parentApplicationId: string | null;
  largeImageUrl: string | null;
};

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  connections?: { type: string; id: string; name: string }[];
};

export type PresenceReport = {
  profile: PublicProfile | null;
  observedAt: number;
  discordStatus: string;
  playing: PlayingReport | null;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function platformOf(value: unknown): GamePlatform | null {
  if (typeof value === "string" && ALLOWED.has(value)) return value as GamePlatform;
  return null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function startedAtOf(activity: RawActivity): number | null {
  return epochMs(activity.timestamps?.start);
}

/**
 * 多个 Quest 活动同时存在时，选择开始时间最近的一项。
 * 优先 `timestamps.start`；没有就退到 `created_at`；还没有就认数组里更靠后的。
 */
function recencyOf(activity: RawActivity): number {
  return startedAtOf(activity) ?? epochMs(activity.created_at) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Discord 封面有两种：应用资源 id，或 `mp:` 媒体代理路径。
 * 对不上的前缀（spotify / youtube 那些）Quest 游戏用不到，丢掉。
 */
export function largeImageUrlOf(activity: RawActivity): string | null {
  const image = asText(activity.assets?.large_image);
  if (!image) return null;
  if (image.includes(":")) {
    const colon = image.indexOf(":");
    const kind = image.slice(0, colon);
    const rest = image.slice(colon + 1);
    if (kind === "mp" && rest) return `https://media.discordapp.net/${rest}`;
    return null;
  }
  const appId = asText(activity.application_id);
  if (!appId) return null;
  return `https://cdn.discordapp.com/app-assets/${appId}/${image}.png?size=256`;
}

function playingOf(activity: RawActivity): PlayingReport | null {
  if (activity.type !== PLAYING) return null;
  const name = asText(activity.name);
  const platform = platformOf(activity.platform);
  if (!name || !platform) return null;
  return {
    name,
    platform,
    details: asText(activity.details),
    state: asText(activity.state),
    startedAt: startedAtOf(activity),
    applicationId: asText(activity.application_id),
    parentApplicationId: asText(activity.parent_application_id),
    largeImageUrl: largeImageUrlOf(activity),
  };
}

export function pickPlaying(presence: RawPresence | null | undefined): PlayingReport | null {
  if (!presence?.activities || presence.status === "offline") return null;
  let best: PlayingReport | null = null;
  let bestRecency = Number.NEGATIVE_INFINITY;
  for (const activity of presence.activities) {
    const playing = playingOf(activity);
    if (!playing) continue;
    const recency = recencyOf(activity);
    if (!best || recency >= bestRecency) {
      best = playing;
      bestRecency = recency;
    }
  }
  return best;
}

export function reportFrom(presence: RawPresence | null | undefined, now = Date.now()): PresenceReport {
  return {
    profile: null,
    observedAt: now,
    discordStatus: asText(presence?.status) ?? "offline",
    playing: pickPlaying(presence),
  };
}

export function describeActivities(presence: RawPresence | null | undefined): string {
  const activities = presence?.activities ?? [];
  if (activities.length === 0) return "无活动";
  return activities
    .map((activity) => {
      const type = typeof activity.type === "number" ? String(activity.type) : "?";
      const name = asText(activity.name) ?? "?";
      const platform = asText(activity.platform) ?? "-";
      const app = asText(activity.application_id) ?? "-";
      const parent = asText(activity.parent_application_id);
      return parent
        ? `${type}:${name}@${platform} app=${app} parent=${parent}`
        : `${type}:${name}@${platform} app=${app}`;
    })
    .join(", ");
}
