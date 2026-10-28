"use client";

import MetaMono from "@lobehub/icons/es/Meta/components/Mono";

import Image from "@/components/app-image";
import { NowGameRow } from "@/components/live/now-game-row";
import { NowReveal } from "@/components/live/now-reveal";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { STATUS_VIEWS } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";
import type { QuestNow } from "@shared/quest";

const NOW_REFRESH_MS = 60_000;

export function QuestNowCard({ nowFallback }: { nowFallback: StatusResponse<QuestNow> }) {
  useLiveEvents();
  const { data } = useStatus<QuestNow>(STATUS_VIEWS.questNow.path, NOW_REFRESH_MS, { fallback: nowFallback });
  const playing = data?.playing ?? null;

  return (
    <NowReveal revealKey="quest-now">
      {playing ? (
        <Card id="now-gaming" className="scroll-mt-28">
          <NowGameRow
            cover={
              playing.largeImageUrl ? (
                <Image src={playing.largeImageUrl} alt={playing.name} fill sizes="64px" loading="eager" className="object-cover" unoptimized />
              ) : (
                <MetaMono size={24} aria-hidden />
              )
            }
            platform="Meta Quest"
            title={playing.name}
            detail={[playing.details, playing.state].filter(Boolean).join(" · ") || null}
            startedAt={playing.startedAt}
          />
        </Card>
      ) : null}
    </NowReveal>
  );
}
