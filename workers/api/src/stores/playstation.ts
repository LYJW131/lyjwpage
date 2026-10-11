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
import { gamingFacts, questGamingFacts } from "@shared/pulse-timeline";
import { questMirror, questNow } from "@shared/quest";
import { setPlaystationPlayedGames, setPlaystationPresence, setPlaystationTrophies } from "@api/stores/playstation-store";
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

  const [previousPresence, previousPlayedGames, previousTrophies] =
    await Promise.all([
      incomingPresence ? getPlaystationPresence() : null,
      incomingPlayedGames ? getPlaystationPlayedGames() : null,
      incomingTrophies ? getPlaystationTrophies() : null,
    ]);

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  // 晚到的信封 receivedAt 是现在。旧 observedAt 若落库，会按到达时刻把游戏道倒回去。
  const presenceFresh = incomingPresence != null && (previousPresence == null || incomingPresence.observedAt > previousPresence.observedAt);
  const playedGamesFresh = incomingPlayedGames != null && (previousPlayedGames == null || incomingPlayedGames.observedAt > previousPlayedGames.observedAt);
  const trophiesFresh = incomingTrophies != null && (previousTrophies == null || incomingTrophies.observedAt > previousTrophies.observedAt);
  let presenceChanged = false;
  let playedGamesChanged = false;
  let trophiesChanged = false;

  if (presenceFresh && incomingPresence) {
    presenceChanged = !previousPresence || JSON.stringify(presenceContent(previousPresence)) !== JSON.stringify(presenceContent(incomingPresence));
    writes.push(setPlaystationPresence(incomingPresence));
    // Quest 正在玩时游戏道归 Quest：PS 这一封的「在线」不能把那段截断。
    const quest = await questMirror.get();
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
  const history = scope?.env.HISTORY;
  if (trophiesFresh && incomingTrophies && history && scope && historyArchiveEnabled(scope.env)) {
    scope.ctx.waitUntil(archiveTrophies(history, incomingTrophies));
  }
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged };
}
