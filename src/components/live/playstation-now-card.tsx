"use client";

import Image from "@/components/app-image";
import { NowGameRow } from "@/components/live/now-game-row";
import { NowReveal } from "@/components/live/now-reveal";
import { mediaApp, playTime } from "@/components/live/playstation/tiles";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useConfirmedClockStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { NOW_PLAYING_PATH, PLAYING_PATH } from "@/lib/paths";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import { PLAYSTATION_STALE_MS } from "@shared/freshness";
import type { PlaystationPlayingPayload, PlaystationPresencePayload, StatusResponse } from "@shared/types";

const NOW_REFRESH_MS = 60_000;
const LIST_REFRESH_MS = 10 * 60_000;
const COVER_PX = 64;

export function PlaystationNowCard({
  fallback,
  nowFallback,
}: {
  fallback: StatusResponse<PlaystationPlayingPayload>;
  nowFallback: StatusResponse<PlaystationPresencePayload>;
}) {
  useLiveEvents();
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, NOW_REFRESH_MS, { fallback: nowFallback });
  const list = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, LIST_REFRESH_MS, { fallback });
  const stale = useConfirmedClockStale(presence.data?.observedAt, PLAYSTATION_STALE_MS, {
    validating: presence.isValidating,
    servedAt: presence.servedAt,
  });
  const playing = stale ? null : (presence.data?.playing ?? null);
  // presence 不带分类，只能拿游玩列表认出媒体应用；列表里还没有的一律当游戏。
  const game = playing ? list.data?.items.find((item) => item.titleId === playing.titleId) : undefined;
  const inGame = playing && !mediaApp(game?.category) ? playing : null;
  const cover = playstationImage(inGame?.iconUrl ?? game?.imageUrl, COVER_PX * PLAYSTATION_IMAGE_SCALE);

  return (
    <NowReveal revealKey="playstation-now">
      {inGame ? (
        <Card id="now-playstation" className="scroll-mt-28">
          <NowGameRow
            cover={
              cover ? (
                <Image src={cover} alt={inGame.title} width={COVER_PX} height={COVER_PX} loading="eager" className="size-full object-cover" unoptimized />
              ) : (
                <span className="label-mono">PS</span>
              )
            }
            platform={inGame.launchPlatform ?? presence.data?.platform ?? "PlayStation"}
            title={inGame.title}
            detail={game ? playTime(game.playDurationMs, game.playCount) : null}
            startedAt={inGame.startedAt ?? null}
          />
        </Card>
      ) : null}
    </NowReveal>
  );
}
