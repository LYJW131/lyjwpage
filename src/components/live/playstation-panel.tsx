"use client";

import { useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import {
  PlaystationRow,
  type TrophyJump,
} from "@/components/live/playstation-card";
import { TrophyTeaser } from "@/components/live/trophy-teaser";
import { trophyRowKey } from "@/components/trophies/trophy-details";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { playstationStaleMs } from "@/lib/freshness";
import { LIST_DURATION } from "@/lib/motion";
import { NOW_PLAYING_PATH } from "@/lib/paths";
import { playstationPresenceKind } from "@/lib/playstation-presence";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/** 和瓷砖行问 playing/now 同一个间隔，SWR 会去重。 */
const NOW_REFRESH_MS = 60_000;

/**
 * 提要和瓷砖行之间那点联动状态就住在这里。
 *
 * 只为一件事存在：点提要里的「最近解锁」要展开下面对应的那块瓷砖，而函数 prop
 * 过不了服务端边界 —— 递 onRecentClick 的那一层必须是客户端组件。数据仍旧由外面
 * 的服务端组件取好往下传；这里只跟 playing/now 再订一次，把头像那颗状态点
 * 接上同一份 SWR 缓存（和下面瓷砖行去重）。
 */
export function PlaystationPanel({
  anchorId,
  trophies,
  playing,
  playingNow,
  presentation = "card",
}: {
  /** 外面那张卡的锚点 id，跳转时页面滚到它（它带着 scroll-mt-28 让开吸顶头） */
  anchorId: string;
  trophies: StatusResponse<TrophiesSummaryPayload>;
  playing: StatusResponse<PlaystationPlayingPayload>;
  playingNow: StatusResponse<PlaystationPresencePayload>;
  presentation?: "card" | "gallery";
}) {
  const reduced = useReducedMotion();
  const summary = { data: trophies.ok ? trophies.data : null };
  const [jump, setJump] = useState<TrophyJump | null>(null);
  const clearJump = useCallback(() => setJump(null), [setJump]);
  const presence = useStatus<PlaystationPresencePayload>(
    NOW_PLAYING_PATH,
    NOW_REFRESH_MS,
    {
      fallback: playingNow,
    },
  );
  const mountedAt = useMountedAt();
  const presenceStale = useStale(
    presence.data?.observedAt,
    playstationStaleMs(),
  );
  /**
   * 首帧没有访客钟，不能拿服务端冻着的 presence 当真 —— 那份没过断流判定。
   * 挂载之后用自己的钟判 observedAt，和端点同一扇窗口；窗口到点 useStale 会自己翻。
   * 断流是不知道，不画点；离线是 availability: unavailable，画灰点。
   */
  const presenceKind =
    Boolean(mountedAt) && !presenceStale
      ? playstationPresenceKind(presence.data)
      : null;

  if (presentation === "gallery")
    return (
      <div className="playstation-exhibit">
        <PlaystationRow
          presentation="gallery"
          fallback={playing}
          nowFallback={playingNow}
          titles={summary.data?.titles ?? null}
          jumpRequest={jump}
          onJumpDone={clearJump}
        />
        {summary.data && (
          <div className="collection-signature">
            <span>PLAYSTATION NETWORK</span>
            <span>
              {Object.entries(summary.data.earned)
                .map(([type, count]) => `${type.toUpperCase()} ${count}`)
                .join(" / ")}
            </span>
            <span>
              {presenceKind === "online" ? "ONLINE" : "PERSONAL COLLECTION"}
            </span>
          </div>
        )}
      </div>
    );

  return (
    <>
      <TrophyTeaser
        fallback={trophies}
        embedded
        presence={presenceKind}
        onRecentClick={(unlock) => {
          setJump({
            npCommunicationId: unlock.npCommunicationId,
            trophyKey: trophyRowKey(
              unlock.npCommunicationId,
              unlock.groupId,
              unlock.id,
            ),
          });
          /*
           * 页面这一下点了就滚，不等瓷砖认出来：要看的东西本来就是这张卡。
           * 但面板的高度是分几段长的 —— 展开动画一段、奖杯目录从网络回来再一段。
           * 文档每长一次，先前那次滚动就可能又差一截；视口高的机器上更会被
           * 「文档还不够长」直接钳住，残差留给下一次点击就是「再点又挪一小段」。
           *
           * 所以不做一次性校正，而是在一个短窗口里盯着对齐：页面没在动而锚点
           * 还停在目标下方，就再滚一次；对齐够久或超时就收手。用户一有自己的
           * 滚动输入（滚轮 / 触摸 / 键盘）立刻整个放弃 —— 方向盘永远是他的。
           */
          const anchor = document.getElementById(anchorId);
          if (!anchor) return;
          const behavior = reduced ? ("auto" as const) : ("smooth" as const);
          const offset = () =>
            anchor.getBoundingClientRect().top -
            (parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0);
          // 已经对齐就一帧都别滚：smooth 差 1px 也会动画几帧，重复点击时
          // 滚动条肉眼可见地抖一下
          if (Math.abs(offset()) > 4)
            anchor.scrollIntoView({ behavior, block: "start" });
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
            if (!moving && off > 4)
              anchor.scrollIntoView({ behavior, block: "start" });
          }, 250);
          addEventListener("wheel", stop, { passive: true });
          addEventListener("touchstart", stop, { passive: true });
          addEventListener("keydown", stop);
        }}
      />
      <div className={"px-3 pb-3 pt-3"}>
        <PlaystationRow
          presentation="row"
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
