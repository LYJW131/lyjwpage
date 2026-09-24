import { gamingLevel } from "@shared/pulse-levels";
import { object } from "@/lib/json";
import { PLAYING_TAG, TROPHIES_TAG } from "@/lib/live-events";
import { getPlaystationPlayedGames, getPlaystationPower, getPlaystationPresence, getPlaystationTrophies } from "@/lib/playstation-store";
import { normalizeTrophies, summarizeTrophies, trophiesContent } from "@/lib/trophies";
import type {
  PlaystationPresencePayload
} from "@/lib/types";
import { fanout, type PendingEvent } from "@api/fanout";
import { recordPulse } from "@api/stores/pulse";
import { setPlaystationPlayedGames, setPlaystationPower, setPlaystationPresence, setPlaystationTrophies } from "@api/stores/playstation-store";
import { normalizePlaystationPlayedGames, normalizePlaystationPower, normalizePlaystationPresence } from "@shared/playstation";

/** observedAt 是采集时刻，不参与“内容有没有变化”的判断。 */
function presenceContent(payload: PlaystationPresencePayload) {
  return {
    online: payload.online,
    availability: payload.availability,
    platform: payload.platform,
    lastOnlineAt: payload.lastOnlineAt,
    playing: payload.playing,
  };
}

/*
 * 首屏那份**不**过这道判定：它在预渲染里跑，而 Date.now() 进预渲染就是
 * E1432（首屏必须冻得住）。和充电头、活动圆环同一个取舍 —— 第一帧可能举着
 * 断流前的旧状态，挂载后第一次回源走上面的路由 overlay 就纠正了。
 */

/**
 * 三部分各自可省；缺席表示这次不谈这一项。站点再比一次内容，避免重试或手工
 * 兜底上报退化成广播。写、带数据推送与 tag 失效统一交给 fanout 排序。
 *
 * 奖杯目录只失效、不推：整份几百 KB，解锁又不是按秒翻的事。
 */
export async function recordPlaystationReport(input: unknown, receivedAt = Date.now()) {
  return commitPreparedPlaystationReport(preparePlaystationReport(input, receivedAt));
}

export type PreparedPlaystationReport = {
  source: "playstation";
  receivedAt: number;
  presence: ReturnType<typeof normalizePlaystationPresence> | null;
  playedGames: ReturnType<typeof normalizePlaystationPlayedGames> | null;
  trophies: ReturnType<typeof normalizeTrophies> | null;
  power: ReturnType<typeof normalizePlaystationPower> | null;
};

export function preparePlaystationReport(input: unknown, receivedAt = Date.now()): PreparedPlaystationReport {
  const envelope = object(input);
  if (!envelope || envelope.version !== 1) {
    throw new Error("PlayStation 遥测协议 version 必须为 1");
  }
  return {
    source: "playstation",
    receivedAt,
    presence: "presence" in envelope ? normalizePlaystationPresence(envelope.presence) : null,
    playedGames: "playedGames" in envelope
      ? normalizePlaystationPlayedGames(envelope.playedGames)
      : null,
    trophies: "trophies" in envelope ? normalizeTrophies(envelope.trophies) : null,
    power: "power" in envelope ? normalizePlaystationPower(envelope.power) : null,
  };
}

export async function commitPreparedPlaystationReport(prepared: PreparedPlaystationReport) {
  const {
    presence: incomingPresence,
    playedGames: incomingPlayedGames,
    trophies: incomingTrophies,
    power: incomingPower,
    receivedAt,
  } = prepared;

  const [previousPresence, previousPlayedGames, previousTrophies, previousPower] =
    await Promise.all([
      incomingPresence ? getPlaystationPresence() : null,
      incomingPlayedGames ? getPlaystationPlayedGames() : null,
      incomingTrophies ? getPlaystationTrophies() : null,
      // presence 这一封也要读：推送里的 presence 得带上电源，形状和读端点对齐
      incomingPresence || incomingPower ? getPlaystationPower() : null,
    ]);

  const presenceChanged =
    incomingPresence != null &&
    (!previousPresence ||
      JSON.stringify(presenceContent(previousPresence)) !==
      JSON.stringify(presenceContent(incomingPresence)));
  const playedGamesChanged =
    incomingPlayedGames != null &&
    JSON.stringify(previousPlayedGames?.items ?? null) !==
    JSON.stringify(incomingPlayedGames.items);
  const trophiesChanged =
    incomingTrophies != null &&
    JSON.stringify(previousTrophies ? trophiesContent(previousTrophies) : null) !==
    JSON.stringify(trophiesContent(incomingTrophies));
  /** 只看开关翻没翻面：HA 那条自动化只在 state 变化时触发，重复上报当没变 */
  const powerChanged =
    incomingPower != null && (!previousPower || previousPower.on !== incomingPower.on);

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];
  /** 推送里的 presence 要和读端点给的形状一致 —— 那边会把电源并进来，见 lib/playstation */
  const powerForEvent = incomingPower ?? previousPower;
  /** presence 那一封发没发过 playing-now；PendingEvent 可能是 promise，回头翻不出来 */
  let sentPlayingNow = false;

  if (incomingPresence) {
    /**
     * 内容没变也要落库：presence 是心跳（Worker 每轮 cron 都发一封），
     * observedAt 就是心跳本身，不刷新它的话读那侧永远判不出 Worker 是什么时候
     * 死的，断流判定（assertPresenceFresh）等于白写。
     *
     * 但没变就不广播 —— 推一条一模一样的事件是拿推送当轮询用。
     *
     * 首屏也不失效：「正在玩」那块瓷砖插在定高的三行网格最前面，开始 / 结束
     * 游戏只换网格内容，不改布局（见 lib/home-layout）。首屏交给定时重建，
     * 浏览器挂载后直接问 Worker；端点读的是 SQLite，不经过首屏缓存。
     */
    writes.push(setPlaystationPresence(incomingPresence));
    const gaming = gamingLevel(incomingPresence);
    writes.push(recordPulse("gaming", { t: receivedAt, level: gaming.level, hint: gaming.hint }));
    if (presenceChanged || !previousPresence) {
      events.push({ type: "playing-now", payload: { ...incomingPresence, power: powerForEvent } });
      sentPlayingNow = true;
    }
  }
  if (incomingPower) {
    /**
     * 电源状态不参与心跳：HA 只在开关翻面时发一封，没翻面就不必重写
     * observedAt —— 这份的新鲜度不代表任何上报器的死活，PSN 上报器的心跳
     * 仍然只看 presence。
     */
    if (powerChanged || !previousPower) {
      writes.push(setPlaystationPower(incomingPower));
      /**
       * 立刻广播一次：presence 要等 PSN 上报器下一轮（最慢一分多钟）才更新，
       * 而关机这件事局域网里当场就知道。presence 那一封已经发过事件时不再补，
       * 否则页面收到两条内容一样的。
       */
      if (!sentPlayingNow) {
        const presence = incomingPresence ?? (await getPlaystationPresence());
        if (presence) {
          events.push({ type: "playing-now", payload: { ...presence, power: incomingPower } });
        }
      }
    }
  }
  if (incomingPlayedGames && (playedGamesChanged || !previousPlayedGames)) {
    writes.push(setPlaystationPlayedGames(incomingPlayedGames));
    events.push({ type: "playing", payload: incomingPlayedGames });
    // 网格定高，只有空列表和有瓷砖之间换的是另一块占位
    if (!previousPlayedGames?.items.length !== !incomingPlayedGames.items.length) tags.push(PLAYING_TAG);
  }
  if (incomingTrophies && (trophiesChanged || !previousTrophies)) {
    writes.push(setPlaystationTrophies(incomingTrophies));
    /**
     * 推摘要，不推整份：摘要里的各款进度不吃游玩时长覆盖，拿进来的这份直接算，
     * 和端点读回去再算的是同一份。trophiesChanged 不看 observedAt 和游玩时长，
     * 上报器每轮整份重交也不会退化成定时广播。
     */
    events.push({ type: "trophies", payload: summarizeTrophies(incomingTrophies) });
    // 首屏的奖杯条只有「有没有」这一种布局差别；目录内容交给定时重建
    if (!previousTrophies) tags.push(TROPHIES_TAG);
  }

  await fanout({ writes, events, tags });
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged || powerChanged };
}
