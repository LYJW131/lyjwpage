"use client";

import { useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { PlaystationRow, type TrophyJump } from "@/components/live/playstation-card";
import { TrophyTeaser } from "@/components/live/trophy-teaser";
import { trophyRowKey } from "@/components/trophies/trophy-details";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/**
 * 提要和瓷砖行之间那点联动状态就住在这里。
 *
 * 只为一件事存在：点提要里的「最近解锁」要展开下面对应的那块瓷砖，而函数 prop
 * 过不了服务端边界 —— 递 onRecentClick 的那一层必须是客户端组件。数据仍旧由外面
 * 的服务端组件取好往下传，这里一份都不取。
 */
export function PlaystationPanel({
  anchorId,
  trophies,
  playing,
  playingNow,
}: {
  /** 外面那张卡的锚点 id，跳转时页面滚到它（它带着 scroll-mt-28 让开吸顶头） */
  anchorId: string;
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
}) {
  const reduced = useReducedMotion();
  const [jump, setJump] = useState<TrophyJump | null>(null);
  const clearJump = useCallback(() => setJump(null), []);

  return (
    <>
      <TrophyTeaser
        fallback={trophies}
        embedded
        onRecentClick={(unlock) => {
          setJump({
            npCommunicationId: unlock.npCommunicationId,
            trophyKey: trophyRowKey(unlock.npCommunicationId, unlock.groupId, unlock.id),
          });
          /*
           * 页面这一下点了就滚，不等瓷砖认出来：要看的东西本来就是这张卡。
           * 等展开面板量完高度再滚更晚，还得跟高度动画抢，不如让面板在已经
           * 对好的视口里长出来。
           */
          document.getElementById(anchorId)?.scrollIntoView({
            behavior: reduced ? "auto" : "smooth",
            block: "start",
          });
        }}
      />
      <div className="px-3 pb-3 pt-3">
        <PlaystationRow
          fallback={playing}
          nowFallback={playingNow}
          // 摘要取不到就传 null：那是「不知道」，传空数组会被读成「每款都没奖杯」
          titles={trophies.ok ? (trophies.data.titles ?? []) : null}
          jumpRequest={jump}
          onJumpDone={clearJump}
        />
      </div>
    </>
  );
}
