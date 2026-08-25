import Link from "next/link";

import { PlaystationRow } from "@/components/live/playstation-card";
import { TrophyTeaser } from "@/components/live/trophy-teaser";
import { Card } from "@/components/ui/card";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/**
 * PlayStation 整块：奖杯提要和最近在玩收在同一张卡里。
 * 不跟 Emby「最近在看」那样先拉一条分区标题再铺一行瓷砖。
 */
export function PlaystationBlock({
  trophies,
  playing,
  playingNow,
}: {
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
}) {
  return (
    <Card
      id="playing"
      label="PlayStation"
      action={
        <Link href="/trophies" className="transition-colors hover:text-foreground">
          陈列室 →
        </Link>
      }
      className="mt-6 scroll-mt-28"
    >
      <TrophyTeaser fallback={trophies} embedded />
      <div className="px-3 pb-3 pt-3">
        <PlaystationRow
          fallback={playing}
          nowFallback={playingNow}
          titles={trophies.ok ? (trophies.data.titles ?? []) : []}
          inset
        />
      </div>
    </Card>
  );
}
