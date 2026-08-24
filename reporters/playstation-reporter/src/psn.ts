import { AccessTokenRejected, accessToken } from "./auth.js";
import { config } from "./config.js";

/**
 * 我们真正要打的两个 PSN 端点，以及把它们的回答规范化成信封里的形状。
 *
 * 端点和参数原样抄自 psn-api@2.18.1（MIT，achievements-app/psn-api），出处标在
 * 各自旁边；只抄这两个，不抄整个包 —— 运行时依赖保持为零，fetch 用 Node 20 自带的。
 *
 * **规范化全在这一侧做完**（AGENTS.md 第 4 条）：ISO 时间戳换成 epoch 毫秒、
 * ISO-8601 时长换成毫秒、大小写不一的平台名统一。站点收到的应该是一份可以直接
 * 落库的东西，而不是又一种要它去猜的方言。
 *
 * ⚠️ 这两个请求都**没有用真实凭据跑过**，下面的字段名来自 psn-api 的类型声明
 * （src/models/*.model.ts，随包发布的 dist/index.d.ts 里有完整注释和示例值），
 * 不是实测。所以读取一律走可选链 + 兜底，别指望上游一定给。
 */

/* ── 常量：全部抄自 psn-api@2.18.1 ─────────────────────────── */

/** psn-api@2.18.1 src/user/USER_BASE_URL.ts 的 USER_BASE_URL */
const USER_BASE_URL = "https://m.np.playstation.com/api/userProfile/v1/internal/users";

/** psn-api@2.18.1 src/user/USER_BASE_URL.ts 的 USER_GAMES_BASE_URL */
const USER_GAMES_BASE_URL = "https://m.np.playstation.com/api/gamelist/v2/users";

/* ── 上游响应的形状（照 psn-api 的类型声明写，全部可选） ───── */

type BasicPresenceResponse = {
  basicPresence?: {
    availability?: string;
    lastAvailableDate?: string;
    primaryPlatformInfo?: {
      onlineStatus?: string;
      platform?: string;
      lastOnlineDate?: string;
    };
    gameTitleInfoList?: Array<{
      npTitleId?: string;
      titleName?: string;
      /** 上游这里大小写是混的：`"ps4" | "PS5"`，见 dist/index.d.ts */
      format?: string;
      launchPlatform?: string;
      npTitleIconUrl?: string;
      conceptIconUrl?: string;
    }>;
  };
};

type UserPlayedGamesResponse = {
  titles?: Array<{
    titleId?: string;
    name?: string;
    localizedName?: string;
    imageUrl?: string;
    localizedImageUrl?: string;
    category?: string;
    playCount?: number;
    firstPlayedDateTime?: string;
    lastPlayedDateTime?: string;
    /** ISO-8601 时长，例如 "PT228H56M33S" */
    playDuration?: string;
  }>;
  totalItemCount?: number;
  nextOffset?: number;
};

/* ── 规范化之后的形状（就是信封里的那份） ─────────────────── */

export type NowPlaying = {
  /** PSN 侧的 title id，形如 PPSA01521_00 / CUSA01433_00 */
  titleId: string;
  title: string;
  /** PS4 / PS5，统一成大写 */
  format: string | null;
  launchPlatform: string | null;
  /** 来源侧的图标地址（image.api.playstation.com），不是 R2 对象键，所以不叫 objectKey */
  iconUrl: string | null;
};

export type PresenceReport = {
  observedAt: number;
  online: boolean;
  /** availableToPlay / unavailable，上游原词 */
  availability: string | null;
  /** 主平台，PS4 / PS5，统一成大写 */
  platform: string | null;
  lastOnlineAt: number | null;
  /** 没在玩就是 null */
  playing: NowPlaying | null;
};

export type PlayedGame = {
  titleId: string;
  name: string;
  /** ps4_game / ps5_native_game / pspc_game / unknown，上游原词（是枚举不是展示文本，不动它） */
  category: string | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  /** playDuration 那串 ISO-8601 时长换算成的毫秒 */
  playDurationMs: number | null;
  imageUrl: string | null;
};

export type PlayedGamesReport = {
  observedAt: number;
  items: PlayedGame[];
};

/* ── 规范化的零件 ──────────────────────────────────────────── */

/** ISO 时间戳 → epoch 毫秒。上游给的是 "2024-08-03T19:28:27.12Z" 这种 */
function epochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/**
 * 平台名统一成大写。
 *
 * 上游同一个字段里 PS4 写作 `"ps4"`、PS5 写作 `"PS5"`（psn-api 的类型声明就是
 * `"ps4" | "PS5"`，不是笔误）。这种东西留到站点侧就会变成两处各写一遍
 * `toUpperCase()`，或者更糟 —— 一处写了一处没写。
 */
function platformName(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value.toUpperCase() : null;
}

/**
 * ISO-8601 时长 → 毫秒。
 *
 * 上游给的是 `"PT228H56M33S"`（累计游玩时长，可以轻松超过 24 小时，所以小时位
 * 不进位到天）。天和周这两段照规范一起认下来 —— 没见过上游给，但认了也不亏，
 * 漏认的代价是整条变成 null。
 */
export function durationMs(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const matched =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!matched) return null;
  const [, weeks, days, hours, minutes, seconds] = matched;
  // 一段都没匹配上（比如光一个 "P" 或 "PT"）不能算 0，那是解析失败
  if (![weeks, days, hours, minutes, seconds].some((part) => part !== undefined)) return null;
  const total =
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Number.isFinite(total) ? Math.round(total * 1000) : null;
}

/* ── 请求 ──────────────────────────────────────────────────── */

/**
 * 带 Bearer 打一个 PSN 端点。
 *
 * 401 单独成一类：那是这把 access token 不作数了（上游提前作废、或者我们算错了
 * 半衰期），调用方据此强制续一次再来，而不是干等下一轮。
 */
async function psnFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    if (response.status === 401) {
      throw new AccessTokenRejected(`access token 被拒（401）：${body}`);
    }
    throw new Error(`PSN 返回 ${response.status}：${body}`);
  }

  return (await response.json()) as T;
}

/** 401 就强制续一把再打一次，只重来这一次 —— 再不行就是别的问题了 */
async function withToken<T>(load: (token: string) => Promise<T>): Promise<T> {
  try {
    return await load(await accessToken());
  } catch (error) {
    if (!(error instanceof AccessTokenRejected)) throw error;
    return load(await accessToken(true));
  }
}

/**
 * 此刻在线 / 在玩什么。
 *
 * 端点抄自 psn-api@2.18.1 src/user/getBasicPresence.ts：
 * `USER_BASE_URL + "/:accountId/basicPresences?type=primary"`，
 * `:accountId` 由 src/utils/buildRequestUrl.ts 就地替换。
 */
export async function fetchPresence(): Promise<PresenceReport> {
  const accountId = encodeURIComponent(config.psn.accountId);
  const raw = await withToken((token) =>
    psnFetch<BasicPresenceResponse>(
      `${USER_BASE_URL}/${accountId}/basicPresences?type=primary`,
      token,
    ),
  );

  const presence = raw.basicPresence;
  const primary = presence?.primaryPlatformInfo;
  // 类型声明说 gameTitleInfoList 必给，但那是别人从观测里写下的，不是合同 —— 兜一下
  const title = presence?.gameTitleInfoList?.[0];

  return {
    observedAt: Date.now(),
    online: primary?.onlineStatus === "online",
    availability: presence?.availability?.trim() || null,
    platform: platformName(primary?.platform),
    lastOnlineAt: epochMs(primary?.lastOnlineDate),
    playing:
      title?.npTitleId && title.titleName
        ? {
            titleId: title.npTitleId,
            title: title.titleName,
            format: platformName(title.format),
            launchPlatform: platformName(title.launchPlatform),
            // 两个都是来源侧地址，优先本作自己那张图标，退到「概念」级那张
            iconUrl: title.npTitleIconUrl?.trim() || title.conceptIconUrl?.trim() || null,
          }
        : null,
  };
}

/**
 * 玩过的游戏，上游按最近游玩倒序给。
 *
 * 端点抄自 psn-api@2.18.1 src/user/getUserPlayedGames.ts：
 * `USER_GAMES_BASE_URL + "/:accountId/titles"`，limit / offset / categories
 * 作查询参数（同样由 buildRequestUrl 拼）。这里只用 limit：要的是「最近在玩」，
 * 翻页把整个游戏库拉回来没有意义。
 */
export async function fetchPlayedGames(): Promise<PlayedGamesReport> {
  const accountId = encodeURIComponent(config.psn.accountId);
  const raw = await withToken((token) =>
    psnFetch<UserPlayedGamesResponse>(
      `${USER_GAMES_BASE_URL}/${accountId}/titles?limit=${config.psn.playedGamesLimit}`,
      token,
    ),
  );

  const items: PlayedGame[] = [];
  for (const title of raw.titles ?? []) {
    if (!title?.titleId) continue;
    items.push({
      titleId: title.titleId,
      // localizedName 是按请求的 Accept-Language 本地化过的那份；我们没发那个头，
      // 两者通常一样。取 name 为准，缺了才退到 localizedName
      name: title.name?.trim() || title.localizedName?.trim() || "",
      category: title.category?.trim() || null,
      playCount: Number(title.playCount) || 0,
      firstPlayedAt: epochMs(title.firstPlayedDateTime),
      lastPlayedAt: epochMs(title.lastPlayedDateTime),
      playDurationMs: durationMs(title.playDuration),
      imageUrl: title.imageUrl?.trim() || title.localizedImageUrl?.trim() || null,
    });
  }

  return { observedAt: Date.now(), items: items.slice(0, config.psn.playedGamesLimit) };
}
