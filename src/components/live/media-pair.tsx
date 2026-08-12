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

const SHOW_DEBUG_CONTROLS = process.env.NODE_ENV === "development";

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
  const [debugVisible, setDebugVisible] = useState<boolean | null>(null);
  const reduced = useReducedMotion();
  const visible = debugVisible ?? active;
  const handleActiveChange = useCallback((nextActive: boolean) => {
    setActive((current) => (current === nextActive ? current : nextActive));
  }, []);
  const toggleDebugVisibility = useCallback(() => {
    setDebugVisible((current) => !(current ?? active));
  }, [active]);

  return (
    <div className="md:col-span-2">
      {SHOW_DEBUG_CONTROLS && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={toggleDebugVisibility}
            aria-pressed={!visible}
            title="仅改变页面展示，不会修改真实充电器状态；刷新后恢复跟随遥测"
            data-debug-charger-toggle
            className="paper-card border border-line-strong bg-surface px-3 py-2 font-mono text-[0.6875rem] tracking-[0.08em] uppercase"
          >
            [DEBUG] {visible ? "隐藏充电卡" : "显示充电卡"}
          </button>
        </div>
      )}

      <div
        className={cn(
          "live-media-pair grid grid-cols-1 md:grid-cols-2 md:items-stretch",
          visible ? "is-connected" : "is-disconnected",
        )}
      >
        <motion.div
          initial={false}
          animate={
            reduced
              ? { opacity: visible ? 1 : 0, x: 0, scale: 1 }
              : {
                  opacity: visible ? 1 : 0,
                  x: visible ? 0 : -8,
                  scale: visible ? 1 : 0.985,
                }
          }
          transition={reduced ? { duration: 0 } : CHARGER_TRANSITION}
          className={cn(
            "charger-shell min-w-0 origin-left",
            !visible && "pointer-events-none",
          )}
          aria-hidden={!visible}
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
            wide={!visible}
          />
        </div>
      </div>
    </div>
  );
}
