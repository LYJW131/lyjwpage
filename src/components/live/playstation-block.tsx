import { PlaystationPanel } from "@/components/live/playstation-panel";
import { Card } from "@/components/ui/card";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/** 卡片锚点。跳转要滚到的也是它，所以这个 id 只写一处。 */
const ANCHOR = "playing";

/**
 * PlayStation 整块：奖杯提要和最近在玩收在同一张卡里。
 * 点瓷砖展开该款奖杯。不跟 Emby「最近在看」那样先拉一条分区标题再铺一行瓷砖。
 *
 * 这一层留在服务端：只把服务端取好的三份信封交给里面那层客户端壳子。
 */
export function PlaystationBlock({
  trophies,
  playing,
  playingNow,
  presentation = "card",
}: {
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
  presentation?: "card" | "gallery";
}) {
  if (presentation === "gallery") {
    return (
      <div id={ANCHOR} className="game-collection scroll-mt-36">
        <PlaystationPanel
          anchorId={ANCHOR}
          trophies={trophies}
          playing={playing}
          playingNow={playingNow}
          presentation="gallery"
        />
      </div>
    );
  }
  return (
    <Card
      id={ANCHOR}
      label="PlayStation"
      action="PS5 Pro"
      // 卡片网格是 gap-3，这块在网格外，间隔也得是同一个 12px
      className="mt-3 scroll-mt-28"
    >
      <PlaystationPanel
        anchorId={ANCHOR}
        trophies={trophies}
        playing={playing}
        playingNow={playingNow}
      />
    </Card>
  );
}
