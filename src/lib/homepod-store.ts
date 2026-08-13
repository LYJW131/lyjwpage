import { createHash } from "node:crypto";

import { numberish, object, text } from "@/lib/json";
import { mirrorKey } from "@/lib/redis";
import type { LocalNowPlaying } from "@/lib/types";

const TTL_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_DURATION_STALE_MS = 12 * 60 * 60 * 1000;
/**
 * 曲目本该放完之后，还愿意再等 HA 多久。
 *
 * Home Assistant 是按状态变化推送的，不是每秒推。曲目实际放完到下一条推送
 * 送达之间总有间隔（自动化触发延迟、单曲循环、HA 那边压根没触发），这段时间
 * 里推算进度必然超过时长 —— 那说明的是「还没收到下一首」，不是「数据不可信」，
 * 不该把整条记录作废。真正该判定不可信的信号是 HA 长时间完全没动静。
 */
const SILENCE_GRACE_MS = 5 * 60 * 1000;
/**
 * 单曲循环时 HA 可能一直不推新事件（曲目没变、状态没变），所以「这首该放完了」
 * 这条判据整个不适用，只能靠一个长得多的静默窗口兜底。
 * 真停掉时 HomePod 的 state 会变，那是状态变化，HA 照样会推。
 */
const REPEAT_SILENCE_GRACE_MS = 30 * 60 * 1000;

type StoredHomePod = {
  music: LocalNowPlaying;
  receivedAt: number;
};

/**
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 *
 * 「内存那份更新就不被 Redis 的旧值盖回去」原来是这里手写的，现在归到工厂里 ——
 * 其它几个 store 有同一个问题，只有这里当初发现了。
 */
const mirror = mirrorKey<StoredHomePod>(
  ["homepod", "nowPlaying"],
  (state) => state.receivedAt,
  { ttlMs: TTL_MS },
);

/**
 * 观测时刻，epoch 毫秒。
 *
 * 和 Mac 上报器的 `observedAt` 同名同单位 —— 两个入口喂的是同一个
 * LocalNowPlaying，字段名和单位就不该各说各话。HA 那边的
 * `media_position_updated_at` 是 ISO 串，模板里 `as_timestamp() * 1000` 转好再发。
 */
function observedAt(value: unknown, fallbackAt: number) {
  const parsed = numberish(value);
  if (parsed == null) return fallbackAt;
  // HA 的时钟不准时，不能让浏览器从未来开始推算进度
  return Math.min(parsed, fallbackAt);
}

/**
 * 内网 / 环回地址判定。
 *
 * 这个 URL 会原样发给访客的浏览器去加载，所以指向本地网络的地址既加载不出来，
 * 也等于把内网拓扑透给了访客。除了常见的私有段，还要挡住几个容易漏的：
 * 链路本地 169.254（云元数据就在这一段）、CGNAT 100.64/10（Tailscale 常用）、
 * IPv6 的环回与私有段，以及十进制/十六进制整数形式的 IP。
 */
function isPrivateHost(hostname: string) {
  // URL 里的 IPv6 带方括号，先剥掉
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    // fc00::/7 唯一本地，fe80::/10 链路本地
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (!mapped) return false;
    return isPrivateHost(mapped[1]);
  }

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  // 单标签主机名（含 2130706433、0x7f000001 这类整数形式的 IP）一律不放行：
  // 公网 CDN 不会长这样，能匹配到的只有内网名字
  return !host.includes(".");
}

function publicArtwork(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const homeAssistantUrl = new URL(raw, "http://home-assistant.invalid");
    const cachedArtwork = homeAssistantUrl.searchParams.get("cache");
    const relativeAppleArtwork =
      cachedArtwork &&
      !cachedArtwork.includes("..") &&
      /^Music\d+\/[A-Za-z0-9_./-]+\.(?:jpe?g|png)$/i.test(cachedArtwork)
        ? `https://is1-ssl.mzstatic.com/image/thumb/${cachedArtwork}/600x600bb.webp`
        : null;
    const candidate = (relativeAppleArtwork ?? cachedArtwork ?? raw)
      .replaceAll("{w}", "600")
      .replaceAll("{h}", "600")
      .replaceAll("{f}", "webp");
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (isPrivateHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 把 Home Assistant 的 rest_command 报文收敛成卡片的共用契约。
 *
 * 字段名和单位跟 Mac 上报器的 appleMusic 模块对齐（positionMs / durationMs /
 * repeatOne / observedAt），两个入口产出的都是 LocalNowPlaying，同一个概念
 * 不该有两套叫法。转换放在 HA 的模板里做 —— 那边本来就要写模板，而站点这侧
 * 一旦按来源分叉，往后每加一个播放来源就多一套字段要记。
 *
 * `entityId` 是 HomePod 独有的：它没有 Apple Music 的 trackId，只能拿实体加
 * 曲目信息哈希出一个身份。
 */
export function normalizeHomePodEvent(
  input: unknown,
  receivedAt = Date.now(),
): StoredHomePod {
  const row = object(input);
  if (!row) throw new Error("HomePod 请求必须是 JSON 对象");

  const rawState = text(row.state)?.toLowerCase();
  // buffering 是播放中的一个瞬时态，归成 stopped 会让曲目在缓冲那几秒从页面消失
  const state =
    rawState === "playing" || rawState === "buffering"
      ? "playing"
      : rawState === "paused"
        ? "paused"
        : "stopped";
  const title = text(row.title);
  const artist = text(row.artist);
  const album = text(row.album);
  const identity = [text(row.entityId), title, artist, album].filter(Boolean).join("\n");

  return {
    music: {
      source: "homepod",
      state,
      title,
      artist,
      album,
      trackId: identity
        ? createHash("sha256").update(identity).digest("hex").slice(0, 24)
        : null,
      artworkUrl: publicArtwork(row.artworkUrl),
      positionMs: Math.max(0, numberish(row.positionMs) ?? 0),
      durationMs: Math.max(0, numberish(row.durationMs) ?? 0),
      // HA 的 media_player.repeat 取值是 off / all / one，模板里判完再发布尔值
      repeatOne: row.repeatOne === true || text(row.repeatOne)?.toLowerCase() === "true",
      observedAt: observedAt(row.observedAt, receivedAt),
    },
    receivedAt,
  };
}

export async function recordHomePodEvent(input: unknown, receivedAt = Date.now()) {
  const stored = normalizeHomePodEvent(input, receivedAt);
  await mirror.put(stored);
  return stored;
}

/**
 * HomePod 上一份还在放的快照。停了或没标题就不给。
 *
 * 静默、放完由调用方按 receivedAt 现算（homePodVisibleAt），这里不按墙上的钟
 * 过滤 —— 过滤了就没法把 Redis 那份冻进缓存。
 */
export async function getHomePodSnapshot() {
  const stored = await mirror.get();
  if (!stored || stored.music.state === "stopped" || !stored.music.title) return null;
  return stored;
}

/**
 * 这份 HomePod 快照在 `now` 这一刻还算不算活的。
 *
 * Home Assistant 按状态变化推，不是每秒推。放完到下一条送达之间进度会超过
 * 时长，那是「还没收到下一首」，不是数据不可信。
 */
export function homePodVisibleAt(
  stored: { music: LocalNowPlaying; receivedAt: number },
  now: number,
) {
  const { music, receivedAt } = stored;
  if (music.repeatOne) return now - receivedAt <= REPEAT_SILENCE_GRACE_MS;
  if (music.durationMs > 0) {
    const remaining = Math.max(0, music.durationMs - music.positionMs);
    return now <= receivedAt + remaining + SILENCE_GRACE_MS;
  }
  return now - receivedAt <= UNKNOWN_DURATION_STALE_MS;
}

