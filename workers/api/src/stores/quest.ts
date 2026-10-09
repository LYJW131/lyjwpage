import { PLAYSTATION_STALE_MS } from "@/lib/freshness";
import { QUEST_NOW_TAG } from "@/lib/live-events";
import { getPlaystationPresence } from "@/lib/playstation-store";
import { questMirror, questNow } from "@shared/quest";
import type { PreparedQuestReport } from "@shared/ingest/quest";
import { gamingFacts, questGamingFacts, type GamingFacts } from "@shared/pulse-timeline";
import { fanout } from "@api/fanout";
import { recordStateObservation } from "@api/stores/pulse";

// Quest 停玩时游戏道交还 PlayStation；PS 的状态也已过期就记离线，把这段 Quest 收住，不让它挂到保持期满。
async function playstationGamingFacts(at: number): Promise<GamingFacts> {
  const presence = await getPlaystationPresence();
  return presence && at - presence.observedAt < PLAYSTATION_STALE_MS
    ? gamingFacts(presence)
    : { state: "offline", titleId: null, title: null };
}

export async function commitPreparedQuestReport({ presence, receivedAt }: PreparedQuestReport) {
  const previous = await questMirror.get();
  if (previous && presence.observedAt <= previous.observedAt) return { changed: false };
  const before = previous ? questNow(previous, receivedAt) : null;
  const after = questNow(presence, receivedAt);
  const changed = !before?.available
    || previous?.discordStatus !== presence.discordStatus
    || JSON.stringify(previous?.playing) !== JSON.stringify(presence.playing);
  const writes: Promise<unknown>[] = [questMirror.put(presence)];
  if (after.playing) writes.push(recordStateObservation("gaming", receivedAt, questGamingFacts(after.playing)));
  // 按上一份存的「在玩」收尾、不看它新不新鲜：上报器断过一阵再回来报停玩，也要把那段 Quest 收住。
  else if (previous?.playing) writes.push(recordStateObservation("gaming", receivedAt, await playstationGamingFacts(receivedAt)));
  await fanout({
    writes,
    events: changed ? [{ type: "quest-now", payload: after }] : [],
    tags: Boolean(before?.playing) !== Boolean(after.playing) ? [QUEST_NOW_TAG] : [],
  });
  return { changed };
}
