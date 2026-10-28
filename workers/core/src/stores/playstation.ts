import { INGEST_FUTURE_SKEW_MS, PLAYSTATION_STALE_MS } from "@shared/freshness";
import { NOW_PLAYING_TAG, PLAYING_TAG, TROPHIES_TAG } from "@shared/live-events";
import { getPlaystationPlayedGames, getPlaystationPresence, getPlaystationTrophies } from "../playstation-store";
import { summarizeTrophies, trophiesContent } from "@shared/trophies";
import type { PlaystationPresencePayload, PlaystationPresenceReport } from "@shared/types";
import { fanout, type PendingEvent } from "@core/fanout";
import { historyArchive, requestStore } from "@core/runtime";
import { recordStateObservation } from "@core/stores/pulse";
import { archiveTrophies } from "@core/stores/trophy-history";
import { gamingFacts, questGamingFacts } from "@shared/pulse-timeline";
import { questMirror, questNow } from "@shared/quest";
import { setPlaystationPlayedGames, setPlaystationPresence, setPlaystationTrophies } from "@core/stores/playstation-store";
import type { PreparedPlaystationReport } from "@shared/ingest/playstation";

function presenceContent(payload: PlaystationPresencePayload) {
  return {
    online: payload.online,
    availability: payload.availability,
    platform: payload.platform,
    lastOnlineAt: payload.lastOnlineAt,
    playing: payload.playing,
  };
}

// 同一款接着上一份在玩、且上一份没过期，就沿用它的开局时刻；换游戏、停过或断流后都从这一封重新算。
export function withStartedAt(
  report: PlaystationPresenceReport,
  previous: PlaystationPresencePayload | null,
): PlaystationPresencePayload {
  if (!report.playing) return { ...report, playing: null };
  const before = previous?.playing;
  // 旧版存下的在玩没有 startedAt，从这一封起算。
  const startedAt =
    previous && before?.titleId === report.playing.titleId && before.startedAt != null && report.observedAt - previous.observedAt < PLAYSTATION_STALE_MS
      ? before.startedAt
      : report.observedAt;
  return { ...report, playing: { ...report.playing, startedAt } };
}

export async function commitPreparedPlaystationReport(prepared: PreparedPlaystationReport) {
  const {
    presence: reportedPresence,
    playedGames: incomingPlayedGames,
    trophies: incomingTrophies,
    receivedAt,
  } = prepared;

  const [previousPresence, previousPlayedGames, previousTrophies, quest] =
    await Promise.all([
      reportedPresence ? getPlaystationPresence() : null,
      incomingPlayedGames ? getPlaystationPlayedGames() : null,
      incomingTrophies ? getPlaystationTrophies() : null,
      reportedPresence ? questMirror.get() : null,
    ]);
  const incomingPresence = reportedPresence && withStartedAt(reportedPresence, previousPresence);

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  // 晚到的信封 receivedAt 是现在。旧 observedAt 若落库，会按到达时刻把游戏道倒回去。
  // 超前接收时刻的水位按 0 算：已落库的毒值不会否决之后的真实上报。
  const plausibleAt = (observedAt: number) => (observedAt > receivedAt + INGEST_FUTURE_SKEW_MS ? 0 : observedAt);
  const presenceFresh = incomingPresence != null && (previousPresence == null || plausibleAt(incomingPresence.observedAt) > plausibleAt(previousPresence.observedAt));
  const playedGamesFresh = incomingPlayedGames != null && (previousPlayedGames == null || plausibleAt(incomingPlayedGames.observedAt) > plausibleAt(previousPlayedGames.observedAt));
  const trophiesFresh = incomingTrophies != null && (previousTrophies == null || plausibleAt(incomingTrophies.observedAt) > plausibleAt(previousTrophies.observedAt));
  let presenceChanged = false;
  let playedGamesChanged = false;
  let trophiesChanged = false;

  if (presenceFresh && incomingPresence) {
    presenceChanged = !previousPresence || JSON.stringify(presenceContent(previousPresence)) !== JSON.stringify(presenceContent(incomingPresence));
    writes.push(setPlaystationPresence(incomingPresence));
    // Quest 正在玩时游戏道归 Quest：PS 这一封的「在线」不能把那段截断。
    const questPlaying = quest ? questNow(quest, receivedAt).playing : null;
    writes.push(recordStateObservation("gaming", receivedAt, questPlaying ? questGamingFacts(questPlaying) : gamingFacts(incomingPresence)));
    if (presenceChanged || !previousPresence) {
      events.push({ type: "playing-now", payload: incomingPresence });
    }
    // 首页的 PlayStation 正在玩卡随「在玩」有无展开收起，只有这时首屏布局变。
    if (Boolean(previousPresence?.playing) !== Boolean(incomingPresence.playing)) tags.push(NOW_PLAYING_TAG);
  }
  if (playedGamesFresh && incomingPlayedGames) {
    playedGamesChanged = JSON.stringify(previousPlayedGames?.items ?? null) !== JSON.stringify(incomingPlayedGames.items);
    if (playedGamesChanged || !previousPlayedGames) {
      writes.push(setPlaystationPlayedGames(incomingPlayedGames));
      events.push({ type: "playing", payload: incomingPlayedGames });
      if (!previousPlayedGames?.items.length !== !incomingPlayedGames.items.length) tags.push(PLAYING_TAG);
    }
  }
  if (trophiesFresh && incomingTrophies) {
    trophiesChanged = JSON.stringify(previousTrophies ? trophiesContent(previousTrophies) : null) !== JSON.stringify(trophiesContent(incomingTrophies));
    if (trophiesChanged || !previousTrophies) {
      writes.push(setPlaystationTrophies(incomingTrophies));
      events.push({ type: "trophies", payload: summarizeTrophies(incomingTrophies) });
      if (!previousTrophies) tags.push(TROPHIES_TAG);
    }
  }

  await fanout({ writes, events, tags });
  const scope = requestStore.getStore();
  const history = scope && historyArchive(scope.env);
  if (trophiesFresh && incomingTrophies && history && scope) {
    scope.ctx.waitUntil(archiveTrophies(history, incomingTrophies));
  }
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged };
}
