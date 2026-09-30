"use client";

import { useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { PlaystationRow, type TrophyJump } from "@/components/live/playstation-card";
import { TrophyTeaser } from "@/components/live/trophy-teaser";
import { trophyRowKey } from "@/components/trophies/trophy-details";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useConfirmedClockStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { PLAYSTATION_STALE_MS } from "@/lib/freshness";
import { LIST_DURATION } from "@/lib/motion";
import { NOW_PLAYING_PATH, TROPHIES_PATH } from "@/lib/paths";
import { playstationPresenceKind } from "@/lib/playstation-presence";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

const NOW_REFRESH_MS = 60_000;
const TROPHIES_REFRESH_MS = 10 * 60_000;

export function PlaystationPanel({
  anchorId,
  trophies,
  playing,
  playingNow,
}: {
  anchorId: string;
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
}) {
  const reduced = useReducedMotion();
  const [jump, setJump] = useState<TrophyJump | null>(null);
  const clearJump = useCallback(() => setJump(null), []);
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, NOW_REFRESH_MS, {
    fallback: playingNow,
  });
  const summary = useStatus<TrophiesSummaryPayload>(TROPHIES_PATH, TROPHIES_REFRESH_MS, {
    fallback: trophies,
  });
  const liveTrophies: StatusResponse<TrophiesSummaryPayload> = summary.data
    ? { ok: true, data: summary.data }
    : trophies;
  const mountedAt = useMountedAt();
  const presenceStale = useConfirmedClockStale(presence.data?.observedAt, PLAYSTATION_STALE_MS, {
    validating: presence.isValidating,
    servedAt: presence.servedAt,
  });
  const presenceKind =
    Boolean(mountedAt || presence.servedAt) && !presenceStale
      ? playstationPresenceKind(presence.data)
      : null;

  return (
    <>
      <TrophyTeaser
        fallback={liveTrophies}
        embedded
        presence={presenceKind}
        onRecentClick={(unlock) => {
          setJump({
            npCommunicationId: unlock.npCommunicationId,
            trophyKey: trophyRowKey(unlock.npCommunicationId, unlock.groupId, unlock.id),
          });
          /* 展开和目录返回会两次改变文档高度；短期持续校正，用户滚动立即放弃。 */
          const anchor = document.getElementById(anchorId);
          if (!anchor) return;
          const behavior = reduced ? ("auto" as const) : ("smooth" as const);
          const offset = () =>
            anchor.getBoundingClientRect().top -
            (parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0);
          if (Math.abs(offset()) > 4) anchor.scrollIntoView({ behavior, block: "start" });
          const startedAt = Date.now();
          let lastY = -1;
          const stop = () => {
            clearInterval(watch);
            removeEventListener("wheel", stop);
            removeEventListener("touchstart", stop);
            removeEventListener("keydown", stop);
          };
          const watch = setInterval(() => {
            const y = Math.round(scrollY);
            const moving = y !== lastY;
            lastY = y;
            const off = offset();
            const overdue = Date.now() - startedAt > 3000;
            const settled = Date.now() - startedAt > LIST_DURATION * 1000 + 300;
            if (overdue || (settled && off <= 4)) return stop();
            if (!moving && off > 4) anchor.scrollIntoView({ behavior, block: "start" });
          }, 250);
          addEventListener("wheel", stop, { passive: true });
          addEventListener("touchstart", stop, { passive: true });
          addEventListener("keydown", stop);
        }}
      />
      <div className="px-3 pb-3 pt-3">
        <PlaystationRow
          fallback={playing}
          nowFallback={playingNow}
          titles={liveTrophies.ok ? (liveTrophies.data.titles ?? []) : null}
          jumpRequest={jump}
          onJumpDone={clearJump}
        />
      </div>
    </>
  );
}
