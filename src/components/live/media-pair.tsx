"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import { PowerBankCard } from "@/components/live/powerbank-card";
import { StatusDot } from "@/components/ui/status-dot";
import type {
  ChargerPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const CHARGER_TRANSITION = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1] as const,
};

type Slot = "charger" | "powerBank";

/**
 * 充电卡与最近播放共享一个布局状态：
 *
 * - 单列时，充电卡所在的网格轨道收拢，最近播放顺势上移；
 * - 双列时，充电卡保留行高但淡出，最近播放用 FLIP 从右格铺满整行。
 *
 * **充电头和充电宝共用左边这一格。** 谁真的在收放电就显示谁，两个都在动时充电头
 * 优先 —— 它是插在墙上的那台，出现的理由更强。两张卡都始终挂载，只是把没轮到的
 * 那张 display:none：卸载了它就收不到下一次轮询和推送，也就永远不知道该回来了。
 */
export function LiveMediaPair({
  chargerFallback,
  powerBankFallback,
  listeningFallback,
  nowListeningFallback,
}: {
  chargerFallback: StatusResponse<ChargerPayload>;
  powerBankFallback: StatusResponse<PowerBankPayload>;
  listeningFallback: StatusResponse<ListeningPayload>;
  nowListeningFallback: StatusResponse<NowListeningPayload>;
}) {
  const [chargerActive, setChargerActive] = useState(
    chargerFallback.ok &&
      chargerFallback.data.connected &&
      chargerFallback.data.totalPower > 1,
  );
  const [powerBankActive, setPowerBankActive] = useState(
    powerBankFallback.ok &&
      powerBankFallback.data.connected &&
      (powerBankFallback.data.inputPower > 1 || powerBankFallback.data.outputPower > 1),
  );
  const [chargerOverride, setChargerOverride] = useState<boolean | null>(null);
  const [powerBankOverride, setPowerBankOverride] = useState<boolean | null>(null);
  const isDev = process.env.NODE_ENV === "development";

  const chargerOn = isDev && chargerOverride !== null ? chargerOverride : chargerActive;
  const powerBankOn =
    isDev && powerBankOverride !== null ? powerBankOverride : powerBankActive;
  const isVisible = chargerOn || powerBankOn;

  /**
   * 淡出期间继续显示刚才那张卡。不记住的话，充电宝停下的那一刻格子会先闪回充电头
   * 再淡出 —— 观众看到的是一次错误的换卡，而不是一次收起。
   */
  const [lastShown, setLastShown] = useState<Slot>("charger");
  const shown: Slot = chargerOn ? "charger" : powerBankOn ? "powerBank" : lastShown;
  // 渲染期间就地对齐，不放进 effect：这样换卡和淡出发生在同一帧，中间不会先画错一次
  if (shown !== lastShown) setLastShown(shown);

  const reduced = useReducedMotion();
  const handleChargerActive = useCallback((nextActive: boolean) => {
    setChargerActive((current) => (current === nextActive ? current : nextActive));
  }, []);
  const handlePowerBankActive = useCallback((nextActive: boolean) => {
    setPowerBankActive((current) => (current === nextActive ? current : nextActive));
  }, []);

  return (
    <div className="md:col-span-2">
      <div
        className={cn(
          "live-media-pair grid grid-cols-1 md:grid-cols-2 md:items-stretch",
          isVisible ? "is-connected" : "is-disconnected",
        )}
      >
        <motion.div
          initial={false}
          animate={
            reduced
              ? { opacity: isVisible ? 1 : 0, x: 0, scale: 1 }
              : {
                  opacity: isVisible ? 1 : 0,
                  x: isVisible ? 0 : -8,
                  scale: isVisible ? 1 : 0.985,
                }
          }
          transition={reduced ? { duration: 0 } : CHARGER_TRANSITION}
          className={cn(
            "charger-shell min-w-0 origin-left",
            !isVisible && "pointer-events-none",
          )}
          aria-hidden={!isVisible}
        >
          <div className="charger-collapse min-h-0 overflow-hidden md:h-full md:overflow-visible">
            <div className={cn("h-full", shown !== "charger" && "hidden")}>
              <ChargerCard
                fallback={chargerFallback}
                className="h-full"
                onActiveChange={handleChargerActive}
              />
            </div>
            <div className={cn("h-full", shown !== "powerBank" && "hidden")}>
              <PowerBankCard
                fallback={powerBankFallback}
                className="h-full"
                onActiveChange={handlePowerBankActive}
              />
            </div>
          </div>
        </motion.div>

        <div className="listening-shell min-w-0">
          <ListeningCard
            fallback={listeningFallback}
            nowFallback={nowListeningFallback}
            className="h-full"
            wide={!isVisible}
          />
        </div>
      </div>

      {isDev && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
          <DevToggle
            label="Charger"
            on={chargerOn}
            onClick={() => setChargerOverride((prev) => (prev !== null ? !prev : !chargerActive))}
          />
          <DevToggle
            label="Power Bank"
            on={powerBankOn}
            onClick={() =>
              setPowerBankOverride((prev) => (prev !== null ? !prev : !powerBankActive))
            }
          />
        </div>
      )}
    </div>
  );
}

/** 开发环境调试：单独强制某张卡的可见性，用来看两张卡抢同一个格子的效果 */
function DevToggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="paper-card flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      title={`开发环境调试：切换${label}面板可见性`}
    >
      <StatusDot tone={on ? "live" : "off"} />
      <span className="label-mono">
        {label}: {on ? "Shown" : "Hidden"}
      </span>
    </button>
  );
}
