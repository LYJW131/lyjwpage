"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import type {
  ChargerPayload,
  ListeningPayload,
  NowListeningPayload,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const CHARGER_TRANSITION = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1] as const,
};

/**
 * 充电卡与最近播放共享一个布局状态：
 *
 * - 单列时，充电卡所在的网格轨道收拢，最近播放顺势上移；
 * - 双列时，充电卡保留行高但淡出，最近播放用 FLIP 从右格铺满整行。
 *
 * ChargerCard 始终挂载，因此断开或待机而不可见时，仍能收到下一次轮询/推送。
 */
export function LiveMediaPair({
  chargerFallback,
  listeningFallback,
  nowListeningFallback,
}: {
  chargerFallback: StatusResponse<ChargerPayload>;
  listeningFallback: StatusResponse<ListeningPayload>;
  nowListeningFallback: StatusResponse<NowListeningPayload>;
}) {
  const [active, setActive] = useState(
    chargerFallback.ok &&
      chargerFallback.data.connected &&
      chargerFallback.data.totalPower > 1,
  );
  const reduced = useReducedMotion();
  const handleActiveChange = useCallback((nextActive: boolean) => {
    setActive((current) => (current === nextActive ? current : nextActive));
  }, []);

  return (
    <div className="md:col-span-2">
      <div
        className={cn(
          "live-media-pair grid grid-cols-1 md:grid-cols-2 md:items-stretch",
          active ? "is-connected" : "is-disconnected",
        )}
      >
        <motion.div
          initial={false}
          animate={
            reduced
              ? { opacity: active ? 1 : 0, x: 0, scale: 1 }
              : {
                  opacity: active ? 1 : 0,
                  x: active ? 0 : -8,
                  scale: active ? 1 : 0.985,
                }
          }
          transition={reduced ? { duration: 0 } : CHARGER_TRANSITION}
          className={cn(
            "charger-shell min-w-0 origin-left",
            !active && "pointer-events-none",
          )}
          aria-hidden={!active}
        >
          <div className="charger-collapse min-h-0 overflow-hidden md:h-full md:overflow-visible">
            <ChargerCard
              fallback={chargerFallback}
              className="h-full"
              onActiveChange={handleActiveChange}
            />
          </div>
        </motion.div>

        <div className="listening-shell min-w-0">
          <ListeningCard
            fallback={listeningFallback}
            nowFallback={nowListeningFallback}
            className="h-full"
            wide={!active}
          />
        </div>
      </div>
    </div>
  );
}
