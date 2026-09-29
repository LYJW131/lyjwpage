import { PLAYING_TAG, TROPHIES_TAG } from "@/lib/live-events";
import { getPlaystationPlayedGames, getPlaystationPresence, getPlaystationTrophies } from "@/lib/playstation-store";
import { summarizeTrophies, trophiesContent } from "@/lib/trophies";
import type {
  PlaystationPresencePayload
} from "@/lib/types";
import { fanout, type PendingEvent } from "@api/fanout";
import { historyArchiveEnabled, requestStore } from "@api/runtime";
import { recordStateObservation } from "@api/stores/pulse";
import { archiveTrophies } from "@api/stores/trophy-history";
import { gamingFacts } from "@shared/pulse-timeline";
import { setPlaystationPlayedGames, setPlaystationPresence, setPlaystationTrophies } from "@api/stores/playstation-store";
import type { PreparedPlaystationReport } from "@shared/ingest/playstation";

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

/**
 * 各部分各自可省（见 PreparedPlaystationReport）；缺席表示这次不谈这一项。站点再比一次内容，
 * 避免重试或手工兜底上报退化成广播。写、带数据推送与 tag 失效统一交给 fanout 排序。
 *
 * 奖杯内容变了推摘要，不推整份目录（整份很大，解锁又不是按秒翻的事）；首屏只在首次收到时失效。
 * 收敛在 prepare 那一侧（shared/ingest/playstation.ts），这里只收已经收敛过的那份。
 */
export async function commitPreparedPlaystationReport(prepared: PreparedPlaystationReport) {
  const {
    presence: incomingPresence,
    playedGames: incomingPlayedGames,
    trophies: incomingTrophies,
    receivedAt,
  } = prepared;

  const [previousPresence, previousPlayedGames, previousTrophies] =
    await Promise.all([
      incomingPresence ? getPlaystationPresence() : null,
      incomingPlayedGames ? getPlaystationPlayedGames() : null,
      incomingTrophies ? getPlaystationTrophies() : null,
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
  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  if (incomingPresence) {
    /**
     * 内容没变也要落库：presence 是心跳（容器每个完整 tick 都发一封），
     * observedAt 就是心跳本身，不刷新它的话浏览器永远判不出上报器是什么时候
     * 死的，卡片上的断流判定（按 observedAt 和 PLAYSTATION_STALE_MS）等于白写。
     *
     * 但没变就不广播 —— 推一条一模一样的事件是拿推送当轮询用。
     *
     * 首屏也不失效：「正在玩」那块瓷砖插在定高的三行网格最前面，开始 / 结束
     * 游戏只换网格内容，不改布局（见 lib/home-layout）。首屏交给定时重建，
     * 浏览器挂载后直接问 Worker；端点读的是 SQLite，不经过首屏缓存。
     */
    writes.push(setPlaystationPresence(incomingPresence));
    writes.push(recordStateObservation("gaming", receivedAt, gamingFacts(incomingPresence)));
    if (presenceChanged || !previousPresence) {
      events.push({ type: "playing-now", payload: incomingPresence });
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
  // 归档不挡这一封的回执。失败只记日志，下一封目录变了会再 upsert 一遍。
  const scope = requestStore.getStore();
  const history = scope?.env.HISTORY;
  if (incomingTrophies && history && scope && historyArchiveEnabled(scope.env)) {
    scope.ctx.waitUntil(archiveTrophies(history, incomingTrophies));
  }
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged };
}
