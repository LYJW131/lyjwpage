import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { PLAYING_TAG,TROPHIES_TAG } from "@shared/live-events";
import { getPlaystationPlayedGames, getPlaystationPresence, getPlaystationTrophies } from "../playstation-store";
import { summarizeTrophies, trophiesContent } from "@shared/trophies";
import type {
  PlaystationPresencePayload
} from "@shared/types";
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

export async function commitPreparedPlaystationReport(prepared: PreparedPlaystationReport) {
  const {
    presence: incomingPresence,
    playedGames: incomingPlayedGames,
    trophies: incomingTrophies,
    receivedAt,
  } = prepared;

  const [previousPresence, previousPlayedGames, previousTrophies, quest] =
    await Promise.all([
      incomingPresence ? getPlaystationPresence() : null,
      incomingPlayedGames ? getPlaystationPlayedGames() : null,
      incomingTrophies ? getPlaystationTrophies() : null,
      incomingPresence ? questMirror.get() : null,
    ]);

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
