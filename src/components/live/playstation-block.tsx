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
 * 点瓷砖展开该款奖杯。不跟 Emby「最近在看」那样先拉一条分区标题再铺一行瓷砖。
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
      action="PS5 Pro"
      className="mt-6 scroll-mt-28"
    >
      <TrophyTeaser fallback={trophies} embedded />
      <div className="px-3 pb-3 pt-3">
        <PlaystationRow
          fallback={playing}
          nowFallback={playingNow}
          // 摘要取不到就传 null：那是「不知道」，传空数组会被读成「每款都没奖杯」
          titles={trophies.ok ? (trophies.data.titles ?? []) : null}
        />
      </div>
    </Card>
  );
}
