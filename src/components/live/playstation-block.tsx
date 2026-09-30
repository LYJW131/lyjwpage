import { PlaystationPanel } from "@/components/live/playstation-panel";
import { Card } from "@/components/ui/card";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const ANCHOR = "playing";

export function PlaystationBlock({
  trophies,
  playing,
  playingNow,
  className,
}: {
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
  className?: string;
}) {
  return (
    <Card
      id={ANCHOR}
      label="PlayStation"
      action="PS5 Pro"
      className={cn("scroll-mt-28", className)}
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
