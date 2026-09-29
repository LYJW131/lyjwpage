import { questMirror, questNow } from "@shared/quest";
import type { PreparedQuestReport } from "@shared/ingest/quest";
import { fanout } from "@api/fanout";

export async function commitPreparedQuestReport({ presence, receivedAt }: PreparedQuestReport) {
  const previous = await questMirror.get();
  if (previous && presence.observedAt <= previous.observedAt) return { changed: false };
  const changed = !previous || !questNow(previous, receivedAt).available
    || previous.discordStatus !== presence.discordStatus
    || JSON.stringify(previous.playing) !== JSON.stringify(presence.playing);
  await fanout({
    writes: [questMirror.put(presence)],
    events: changed ? [{ type: "quest-now", payload: questNow(presence, receivedAt) }] : [],
  });
  return { changed };
}
