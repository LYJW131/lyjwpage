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
    writes.push(setPlaystationPresence(incomingPresence));
    // Quest 正在玩时游戏道归 Quest：PS 这一封的「在线」不能把那段截断。
    const quest = await questMirror.get();
    const questPlaying = quest ? questNow(quest, receivedAt).playing : null;
    writes.push(recordStateObservation("gaming", receivedAt, questPlaying ? questGamingFacts(questPlaying) : gamingFacts(incomingPresence)));
    if (presenceChanged || !previousPresence) {
      events.push({ type: "playing-now", payload: incomingPresence });
    }
  }
  if (incomingPlayedGames && (playedGamesChanged || !previousPlayedGames)) {
    writes.push(setPlaystationPlayedGames(incomingPlayedGames));
    events.push({ type: "playing", payload: incomingPlayedGames });
    if (!previousPlayedGames?.items.length !== !incomingPlayedGames.items.length) tags.push(PLAYING_TAG);
  }
  if (incomingTrophies && (trophiesChanged || !previousTrophies)) {
    writes.push(setPlaystationTrophies(incomingTrophies));
    events.push({ type: "trophies", payload: summarizeTrophies(incomingTrophies) });
    if (!previousTrophies) tags.push(TROPHIES_TAG);
  }

  await fanout({ writes, events, tags });
  const scope = requestStore.getStore();
  const history = scope?.env.HISTORY;
  if (incomingTrophies && history && scope && historyArchiveEnabled(scope.env)) {
    scope.ctx.waitUntil(archiveTrophies(history, incomingTrophies));
  }
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged };
}
