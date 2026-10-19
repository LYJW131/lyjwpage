import { useSWRConfig } from "swr";
import { useEffect, useState } from "react";

import { NOW_LISTENING_PATH } from "@/lib/paths";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@shared/limits";
import type { NowListeningElsewhere, NowListeningNext, NowListeningPayload } from "@shared/types";

// 推断的别处播放没有上报来续命：和源站一样按时长放完再留 LISTENING_ELSEWHERE_HOLD_MS 等下一首被推过来，到点就撤下并重新取一次。
export function useElsewhere(live: NowListeningPayload | null | undefined, localActive: boolean, mountedAt: number) {
  const [elsewhereTick, setElsewhereTick] = useState(0);
  const { mutate } = useSWRConfig();
  const inferred = live?.elsewhere ?? null;
  const inferredEnd = inferred ? inferred.startedAt + inferred.durationMs : null;
  const inferredUntil = inferredEnd == null ? null : inferredEnd + LISTENING_ELSEWHERE_HOLD_MS;
  const handoffAt = inferred?.next?.durationMs ? inferredEnd : null;
  useEffect(() => {
    if (inferredUntil == null) return;
    const timer = window.setTimeout(() => {
      setElsewhereTick(Date.now());
      void mutate(NOW_LISTENING_PATH);
    }, Math.max(250, inferredUntil - Date.now() + 250));
    return () => window.clearTimeout(timer);
  }, [inferredUntil, mutate]);
  useEffect(() => {
    if (handoffAt == null) return;
    const timer = window.setTimeout(() => setElsewhereTick(Date.now()), Math.max(0, handoffAt - Date.now() + 50));
    return () => window.clearTimeout(timer);
  }, [handoffAt]);
  const clock = Math.max(elsewhereTick, mountedAt);
  const shownElsewhere = !localActive && inferred && clock > 0 && clock < inferredUntil! ? inferred : null;
  // 放完到下一首被看见之间先换成猜的那首；key 与确认后的同一首一致，确认时 Hero 不重播入场动画。
  const predicted = shownElsewhere?.next?.durationMs && clock >= inferredEnd! ? shownElsewhere.next : null;
  const elsewhere: (NowListeningElsewhere & { basis?: NowListeningNext["basis"] }) | null = shownElsewhere && predicted
    ? {
        title: predicted.title,
        artist: predicted.artist,
        album: null,
        artworkUrl: predicted.artworkUrl,
        songId: predicted.songId,
        startedAt: inferredEnd!,
        durationMs: predicted.durationMs!,
        marginMs: shownElsewhere.marginMs,
        next: predicted.then ?? null,
        basis: predicted.basis,
      }
    : shownElsewhere;
  return elsewhere;
}
