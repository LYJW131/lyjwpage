import {
  normalizeChargingDevice,
  normalizePowerBank,
  pickCharger,
  pickPowerBank,
  type RawChargingDevices,
} from "@/lib/charging-device";
import { number, object, text } from "@/lib/json";
import {
  normalizePlayingQueue,
  upcomingQueueTracks,
  type PlayingQueueTrack,
} from "@/lib/playing-queue";
import { IMAGE_OBJECT_KEY } from "@/lib/asset-url";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@/lib/types";
import type {
  ChargerStatus,
  LocalNowPlaying,
  PowerBankStatus,
  StoredVibeCodingYear,
  TimezoneActivity,
} from "@/lib/types";
import {
  normalizeVibeCodingNow,
  normalizeVibeCodingUsage,
  type ParsedVibeCodingNow,
  type ParsedVibeCodingUsage,
} from "@/lib/vibecoding-parse";
import { normalizeVibeCodingYear } from "@/lib/vibecoding-year";
import type { StoredDesktopActivity } from "@shared/telemetry";

/**
 * Mac 上报器 v4 信封（`/api/ingest/mac`）的收敛，上报入口那一半。
 *
 * 一个 envelope 可以只更新一个模块，未出现的模块保持原快照；modules 整个省略
 * （或给个空对象）就是一次纯心跳 —— 靠 presence 和 heartbeatAt 起作用。
 * 存活、合并、推送都在状态核心（workers/api/src/stores/telemetry.ts）；这里只校验、
 * 收敛，产出一份可以跨 RPC 结构化复制的命令。
 *
 * 较晚的模块校验不过时不在这里抛：把失败点记进 `failure`，状态核心在原执行位置
 * 抛错，排在它前面、已经承诺过的写（存活、充电头……）照样保留。
 */

type TelemetryEnvelope = {
  presence?: unknown;
  version?: unknown;
  heartbeatAt?: unknown;
  activeModules?: unknown;
  modules?: unknown;
};

type PreparedDesktop = {
  activity: StoredDesktopActivity | null;
  iconHash: string | null;
  iconObjectKey: string | null;
};

export type PreparedTelemetryEnvelope = {
  source: "mac";
  receivedAt: number;
  presence: "online" | "offline";
  activeModules: string[];
  modules: {
    chargingDevices?: {
      charger: ChargerStatus | null;
      powerBank: PowerBankStatus | null;
      failureAfterCharger?: string;
    };
    desktop?: PreparedDesktop;
    timezone?: TimezoneActivity | null;
    appleMusic?: { music: LocalNowPlaying | null; upcomingTracks: PlayingQueueTrack[] };
    appleMusicCredentials?: { musicUserToken: string };
    vibeCodingUsage?: ParsedVibeCodingUsage;
    vibeCodingNow?: ParsedVibeCodingNow;
    vibeCodingYear?: Omit<StoredVibeCodingYear, "pushedAt">;
  };
  /** 晚模块失败仍要让 DO 在原执行位置抛错，保留此前已承诺的写。 */
  failure?: {
    stage: "beforeCharging" | "beforeDesktop" | "beforeTimezone" | "beforeAppleMusic" | "beforeAppleMusicCredentials";
    message: string;
  };
};


function milliseconds(value: unknown, fallback = Date.now()) {
  const parsed = number(value);
  if (parsed == null) return fallback;
  return parsed > 1e12 ? parsed : parsed * 1000;
}


function normalizeDesktop(
  value: unknown,
  receivedAt: number,
): PreparedDesktop {
  const row = object(value);
  if (!row) return { activity: null, iconHash: null, iconObjectKey: null };
  const applicationName = text(row.applicationName);
  if (!applicationName) throw new Error("desktop 模块缺少 applicationName");
  const bundleIdentifier = text(row.bundleIdentifier);
  const windowTitle = normalizeWindowTitle(row.windowTitle, bundleIdentifier);
  const iconHash = text(row.iconHash);
  if (iconHash != null && !/^[a-f0-9]{64}$/.test(iconHash)) {
    throw new Error("desktop.iconHash 必须是 SHA-256 十六进制字符串");
  }
  /**
   * 两个哈希各司其职，不是同一个东西，别再把它们对等起来。
   *
   * - `iconHash` 是**这个应用的图标**的身份：应用有图标它就非空，哪怕编码失败、
   *   还没传上去。站点靠它当 desktopIconAssets 的键。
   * - `iconObjectKey` 是**已经躺在 R2 里的那份字节**的内容地址，直传成功才有。
   *
   * 从前两者都取自压缩后的字节，于是「这个应用没有图标」和「图标没准备好」
   * 都表现为 iconHash 为空 —— 下面的 iconAvailable 把后者也当成了「一切正常」，
   * 上报器再也收不到补传信号。实测因此静默丢了整整一批图标。
   */
  const iconObjectKey = text(row.iconObjectKey);
  if (iconObjectKey != null && !IMAGE_OBJECT_KEY.test(iconObjectKey)) {
    throw new Error("desktop.iconObjectKey 必须是 <sha256>.png 或 <sha256>.webp");
  }
  if (iconObjectKey != null && iconHash == null) {
    throw new Error("desktop.iconObjectKey 必须和 iconHash 一起上报");
  }

  if (row.iconData != null) throw new Error("desktop.iconData 已停用，请由上报器直传 R2");

  // 上报器一次性编好小图并直传 R2，只把对象键发回来。对象键落 SQLite，读取 /
  // 推送时才拼成 `/img/<键>` 这条同源路径，交付域由访客域名的边缘决定，
  // 见 lib/asset-url。
  //
  // 站点不在名称上报的热路径里 HEAD：上报器在后台 resolver 里先查后写，
  // 并按五分钟窗口复验，桶被清空时由它原地补回同一个内容地址。这里信任它
  // 已确认的对象键，避免图片存储的一次慢响应拖住整次前台切换。
  return {
    activity: {
      applicationName,
      bundleIdentifier,
      windowTitle,
      iconObjectKey: null,
      observedAt: milliseconds(row.observedAt, receivedAt),
    },
    iconHash,
    iconObjectKey,
  };
}

/** 窗口标题的长度上限，按码点算。够放完整的文件路径或网页标题，又不至于当作日志用。 */
const WINDOW_TITLE_MAX = 200;

/**
 * 当前窗口标题。缺席、null、空白都归 null —— 「没有标题」只有这一种表示。
 *
 * 类型不对要炸：标题是上报侧直接透传的系统值，收到数字或对象说明那边的取值
 * 路径错了，静默收敛成 null 只会让它一直错下去。超长则截断不报错，标题长短
 * 由用户此刻打开的文件决定，不是上报器的毛病。
 *
 * 按码点截：CJK 和 emoji 的标题很常见，按 UTF-16 码元切会把代理对劈成两半，
 * 留下一个永远画不出来的半字符。
 *
 * 前台应用被隐藏时强制清空：占位 bundle id 的意思就是「这一刻不许对外说我在干
 * 什么」，应用名已经是占位符，标题不跟着清等于从后门把它漏出去。
 */
function normalizeWindowTitle(value: unknown, bundleIdentifier: string | null) {
  if (value != null && typeof value !== "string") {
    throw new Error("desktop.windowTitle 必须是字符串或 null");
  }
  if (bundleIdentifier === HIDDEN_DESKTOP_BUNDLE_ID) return null;
  const title = text(value);
  if (title == null) return null;
  const points = [...title];
  return points.length > WINDOW_TITLE_MAX
    ? points.slice(0, WINDOW_TITLE_MAX).join("")
    : title;
}

function normalizeTimezone(
  value: unknown,
  receivedAt: number,
): TimezoneActivity | null {
  const row = object(value);
  if (!row) return null;
  const identifier = text(row.identifier);
  if (!identifier) return null;
  return {
    identifier,
    abbreviation: text(row.abbreviation),
    secondsFromGMT: Math.trunc(number(row.secondsFromGMT) ?? 0),
    observedAt: milliseconds(row.observedAt, receivedAt),
  };
}

function normalizeMusic(
  value: unknown,
  receivedAt: number,
): LocalNowPlaying | null {
  const row = object(value);
  if (!row) return null;
  const rawState = text(row.state);
  const state = rawState === "playing" || rawState === "paused" ? rawState : "stopped";
  const trackId = text(row.trackId);
  return {
    source: "apple-music",
    state,
    title: text(row.title),
    artist: text(row.artist),
    album: text(row.album),
    trackId,
    // 采集端不再上传封面二进制：读取时会查一次 Apple Music 目录拿曲目链接，
    // 那次查询的结果自带封面 URL，见 getNowListening
    artworkUrl: null,
    positionMs: Math.max(0, number(row.positionMs) ?? 0),
    durationMs: Math.max(0, number(row.durationMs) ?? 0),
    // 上报器发的是布尔值，字符串那支是给旧版采集器留的；缺字段按「不循环」处理
    repeatOne: text(row.repeatOne) === "true" || row.repeatOne === true,
    observedAt: milliseconds(row.observedAt, receivedAt),
  };
}


/**
 * 三份 coding 模块一律「先校验，后落库」：这里全部校验，任一坏掉整封在入口就拒，
 * 连 liveness 都不落；状态核心只把收敛好的那份包成写（stores/vibecoding）。
 */
function parseVibeCodingUsage(report: unknown): ParsedVibeCodingUsage {
  const payload = normalizeVibeCodingUsage(report);
  if (!payload) throw new Error("vibeCodingUsage 必须是 Mac Telemetry Hub 的用量摘要");
  return payload;
}

function parseVibeCodingNow(report: unknown): ParsedVibeCodingNow {
  const parsed = normalizeVibeCodingNow(report);
  if (!parsed) throw new Error("vibeCodingNow 必须带 agents 数组");
  /**
   * Cursor 的此刻归容器（`cursorNow`），Mac 那份即使带着 cursor 也丢掉：Hub 的会话扫描
   * 不看 Cursor，那一行永远是空时刻、不在用，推给浏览器会把容器报的活动盖掉。
   */
  return { ...parsed, agents: parsed.agents.filter((agent) => agent.id !== "cursor") };
}

function parseVibeCodingYear(report: unknown): Omit<StoredVibeCodingYear, "pushedAt"> {
  const payload = normalizeVibeCodingYear(report);
  if (!payload) throw new Error("vibeCodingYear 必须是从周日切起的 53 周日合计，并带每天前五的模型表");
  return payload;
}

/**
 * 信封里 `appleMusicCredentials` 模块的校验。
 *
 * 只认 `musicUserToken`。`developerToken` / `expiresAt` 从前也走这条，2026-09-11 起
 * developer token 由状态核心自签（见 workers/api/src/musickit-token.ts 的 issueApiDeveloperToken），
 * 这两个键再出现就是旧版上报器 —— 直接拒掉而不是静默忽略，和当年停用 `iconData`
 * 是同一种处理：把「你在跑旧合同」说出来，比收下一半让人误以为一切正常要好。
 */
export function parseAppleMusicCredentials(value: unknown): { musicUserToken: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("appleMusicCredentials 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if ("developerToken" in row || "expiresAt" in row) {
    throw new Error("appleMusicCredentials.developerToken 已停用：developer token 由 Worker 自签，只上报 musicUserToken");
  }
  const musicUserToken = typeof row.musicUserToken === "string" ? row.musicUserToken.trim() : "";
  if (!musicUserToken) throw new Error("appleMusicCredentials.musicUserToken 不能为空");
  return { musicUserToken };
}

export function prepareTelemetryEnvelope(input: unknown, receivedAt = Date.now()): PreparedTelemetryEnvelope {
  const envelope = object(input) as TelemetryEnvelope | null;
  if (!envelope || envelope.version !== 4) throw new Error("遥测协议 version 必须为 4");
  if (number(envelope.heartbeatAt) == null) throw new Error("遥测请求缺少 heartbeatAt");
  if (!Array.isArray(envelope.activeModules)) throw new Error("遥测请求缺少 activeModules");
  const activeModules = envelope.activeModules.filter(
    (value): value is string => typeof value === "string",
  );
  if (activeModules.length !== envelope.activeModules.length) {
    throw new Error("activeModules 只能包含字符串");
  }
  const presence = text(envelope.presence);
  if (presence !== "online" && presence !== "offline") {
    throw new Error("遥测请求的 presence 必须是 online 或 offline");
  }
  const normalizedPresence: "online" | "offline" = presence;
  if (envelope.modules != null && !object(envelope.modules)) {
    throw new Error("遥测请求的 modules 必须是对象");
  }
  const raw = object(envelope.modules) ?? {};

  // 这三份原本就先全校验；任一坏掉时连 liveness 都不落，保持既有契约。
  const codingUsage = "vibeCodingUsage" in raw
    ? parseVibeCodingUsage(raw.vibeCodingUsage)
    : undefined;
  const codingNow = "vibeCodingNow" in raw
    ? parseVibeCodingNow(raw.vibeCodingNow)
    : undefined;
  const codingYear = "vibeCodingYear" in raw
    ? parseVibeCodingYear(raw.vibeCodingYear)
    : undefined;

  const modules: PreparedTelemetryEnvelope["modules"] = {};
  const fail = (
    stage: NonNullable<PreparedTelemetryEnvelope["failure"]>["stage"],
    error: unknown,
  ): PreparedTelemetryEnvelope => ({
    source: "mac" as const,
    receivedAt,
    presence: normalizedPresence,
    activeModules,
    modules,
    failure: { stage, message: error instanceof Error ? error.message : String(error) },
  });

  if ("chargingDevices" in raw) {
    try {
      const devices = object(raw.chargingDevices) as RawChargingDevices | null;
      if (!devices) throw new Error("chargingDevices 模块必须是对象");
      const charger = pickCharger(devices);
      if (charger && !charger.updatedAt) throw new Error("chargingDevices 里的充电头缺少 updatedAt");
      modules.chargingDevices = {
        charger: charger ? normalizeChargingDevice(charger) : null,
        powerBank: null,
      };
      try {
        const powerBank = pickPowerBank(devices);
        if (powerBank && !powerBank.updatedAt) {
          throw new Error("chargingDevices 里的充电宝缺少 updatedAt");
        }
        modules.chargingDevices.powerBank = powerBank ? normalizePowerBank(powerBank) : null;
      } catch (error) {
        modules.chargingDevices.failureAfterCharger =
          error instanceof Error ? error.message : String(error);
        return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, modules };
      }
    } catch (error) {
      return fail("beforeCharging", error);
    }
  }
  if ("desktop" in raw) {
    try { modules.desktop = normalizeDesktop(raw.desktop, receivedAt); }
    catch (error) { return fail("beforeDesktop", error); }
  }
  if ("timezone" in raw) {
    try { modules.timezone = normalizeTimezone(raw.timezone, receivedAt); }
    catch (error) { return fail("beforeTimezone", error); }
  }
  if ("appleMusic" in raw) {
    try {
      const musicRow = object(raw.appleMusic);
      const music = normalizeMusic(raw.appleMusic, receivedAt);
      modules.appleMusic = {
        music,
        upcomingTracks: musicRow ? upcomingFromMusicRow(musicRow, music?.title ?? null) : [],
      };
    } catch (error) {
      return fail("beforeAppleMusic", error);
    }
  }
  if ("appleMusicCredentials" in raw) {
    try {
      modules.appleMusicCredentials = parseAppleMusicCredentials(raw.appleMusicCredentials);
    } catch (error) {
      return fail("beforeAppleMusicCredentials", error);
    }
  }
  if (codingUsage) modules.vibeCodingUsage = codingUsage;
  if (codingNow) modules.vibeCodingNow = codingNow;
  if (codingYear) modules.vibeCodingYear = codingYear;

  return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, modules };
}

function upcomingFromMusicRow(row: Record<string, unknown>, title: string | null) {
  return upcomingQueueTracks(normalizePlayingQueue(row.queue), title);
}
