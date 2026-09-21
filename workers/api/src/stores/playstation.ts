import { gamingLevel } from "@shared/pulse-levels";
import { object } from "@/lib/json";
import { NOW_PLAYING_TAG, PLAYING_TAG, TROPHIES_TAG } from "@/lib/live-events";
import { getPlaystationPlayedGames, getPlaystationPower, getPlaystationPresence, getPlaystationTrophies } from "@/lib/playstation-store";
import { normalizeTrophies, trophiesContent } from "@/lib/trophies";
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
     * 但没变就不广播 —— 推一条一模一样的事件是拿推送当轮询用。tag 仍然要推，
     * 走普通那半：不推的话 'use cache' 里那份快照的 observedAt 跟着冻住，心跳
     * 刷新的只有 SQLite，端点读到的还是老时刻。普通 tag 给的是
     * stale-while-revalidate，落后一个刷新周期，窗口已经把这一截算进去了。
     */
    writes.push(setPlaystationPresence(incomingPresence));
    const gaming = gamingLevel(incomingPresence);
    writes.push(recordPulse("gaming", { t: receivedAt, level: gaming.level, hint: gaming.hint }));
    if (presenceChanged || !previousPresence) {
      events.push({ type: "playing-now", payload: { ...incomingPresence, power: powerForEvent } });
      sentPlayingNow = true;
      // 「正在游玩」和听歌 now 一样：不能先把旧值再顶几分钟。
      tags.push(NOW_PLAYING_TAG);
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
      tags.push(NOW_PLAYING_TAG);
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
    tags.push(PLAYING_TAG);
    // 奖杯目录的时长和 Plus / 预购是读时按 titleIds 盖上去的，游玩一变就得重算。
    tags.push(TROPHIES_TAG);
  }
  if (incomingTrophies && (trophiesChanged || !previousTrophies)) {
    writes.push(setPlaystationTrophies(incomingTrophies));
    // 目录是整份替换：旧标题必须立刻从 status 里消失，不能再 SWR 几分钟。
    tags.push(TROPHIES_TAG);
  }

  await fanout({ writes, events, tags });
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged || powerChanged };
}
