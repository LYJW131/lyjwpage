import {
  getBasicPresence,
  type BasicPresenceResponse,
  type UserPlayedGamesResponse,
} from "psn-api";

import { accessToken } from "./auth.js";
import { config } from "./config.js";

/**
 * 通过 psn-api 读取两份 PSN 数据，再把回答规范化成信封里的形状。
 *
 * **规范化全在这一侧做完**（AGENTS.md 第 4 条）：ISO 时间戳换成 epoch 毫秒、
 * ISO-8601 时长换成毫秒、大小写不一的平台名统一。站点收到的应该是一份可以直接
 * 落库的东西，而不是又一种要它去猜的方言。
 *
 * ⚠️ 这两个请求都**没有用真实凭据跑过**。字段以 psn-api 的返回类型为准，但不是
 * 实测，所以读取一律走可选链 + 兜底，别指望上游一定给。
 */

/** 类型声明是理想响应；运行时仍把每层都当作可能缺席，保留原型阶段的防御性读取。 */
type Loose<T> =
  T extends Array<infer Item>
    ? Array<Loose<Item>>
    : T extends object
      ? { [Key in keyof T]?: Loose<T[Key]> }
      : T;

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
 * psn-api 的 call() 不检查 Response.status；业务函数发现响应里有 error 后，只把
 * error.message 装进普通 Error，状态码和响应对象都不会保留。因此 401 只能按上游
 * 的错误文案识别，不能再用 instanceof 或 status 判别。
 */
function isAccessTokenRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:\b401\b|\bunauthori[sz]ed\b|access token.+(?:expired|invalid)|(?:expired|invalid).+access token)/i.test(
    error.message,
  );
}

/** 401 就强制续一把再打一次，只重来这一次 —— 再不行就是别的问题了 */
async function withToken<T>(load: (token: string) => Promise<T>): Promise<T> {
  try {
    return await load(await accessToken());
  } catch (error) {
    if (!isAccessTokenRejected(error)) throw error;
    return load(await accessToken(true));
  }
}

/** PSN_LANGUAGE 非空时要带上的语言头。游戏名跟着它换官方译名 */
function languageHeader(): { "Accept-Language": string } | undefined {
  return config.psn.language ? { "Accept-Language": config.psn.language } : undefined;
}

/** 此刻在线 / 在玩什么。 */
export async function fetchPresence(): Promise<PresenceReport> {
  const language = languageHeader();
  const raw = (await withToken((token) =>
    getBasicPresence(
      { accessToken: token },
      config.psn.accountId,
      language ? { headerOverrides: language } : undefined,
    ),
  )) as Loose<BasicPresenceResponse>;

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
 * 「玩过的游戏」这一个请求不走 psn-api：它的 getUserPlayedGames 既不收
 * headerOverrides（其余函数都收，明显是漏了），2.18.1 的实现也不给请求带任何头，
 * `Accept-Language` 送不出去，游戏名就只剩英文。所以这里自己打同一个端点
 * （URL 与 psn-api src/user/getUserPlayedGames.ts 一致），上游把口子补上就切回去。
 */
const USER_GAMES_BASE_URL = "https://m.np.playstation.com/api/gamelist/v2/users";

async function requestPlayedGames(token: string): Promise<Loose<UserPlayedGamesResponse>> {
  const accountId = encodeURIComponent(config.psn.accountId);
  const response = await fetch(
    `${USER_GAMES_BASE_URL}/${accountId}/titles?limit=${config.psn.playedGamesLimit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...languageHeader(),
      },
    },
  );
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    // 状态码放进文案：401 时 isAccessTokenRejected 按 \b401\b 认出来，强制续期重试一次
    throw new Error(`PSN 返回 ${response.status}：${body}`);
  }
  return (await response.json()) as Loose<UserPlayedGamesResponse>;
}

/** 玩过的游戏，上游按最近游玩倒序给。这里只取 limit，不翻整个游戏库。 */
export async function fetchPlayedGames(): Promise<PlayedGamesReport> {
  const raw = await withToken(requestPlayedGames);

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
