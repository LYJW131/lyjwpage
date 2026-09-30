"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";

import { CardBoundary } from "@/components/card-boundary";
import { DevToggle, DevToggleSlot, isDev } from "@/components/dev-toggles";
import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import { PowerBankCard } from "@/components/live/powerbank-card";
import type { LyricsFallback } from "@/hooks/use-lyrics";
import type { ArtworkPlaceholders } from "@/lib/artwork-placeholder";
import { chargingFeedClockStale, liveChargingFeed } from "@/lib/freshness";
import { CHARGER_PATH, LISTENING_PATH, NOW_LISTENING_PATH, POWERBANK_PATH } from "@/lib/paths";
import { chargerActive as chargerIsActive, powerBankActive as powerBankIsActive } from "@/lib/home-layout";
import type {
  ChargerPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// 固定槽高而非 min-height，避免两张半卡的固有高度改变右侧列表布局。
const SLOT_PX = 396;
const STACK_GAP_PX = 12;
const HALF_PX = (SLOT_PX - STACK_GAP_PX) / 2;

const CHARGER_READS = [CHARGER_PATH];
const POWERBANK_READS = [POWERBANK_PATH];
const LISTENING_READS = [LISTENING_PATH, NOW_LISTENING_PATH];

const CHARGER_TRANSITION = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1] as const,
};

type Slot = "charger" | "powerBank";

export function LiveMediaPair({
  chargerFallback,
  powerBankFallback,
  listeningFallback,
  nowListeningFallback,
  lyricsFallback,
  artworkPlaceholders,
}: {
  chargerFallback: StatusResponse<ChargerPayload>;
  powerBankFallback: StatusResponse<PowerBankPayload>;
  listeningFallback: StatusResponse<ListeningPayload>;
  nowListeningFallback: StatusResponse<NowListeningPayload>;
  lyricsFallback?: LyricsFallback | null;
  artworkPlaceholders: ArtworkPlaceholders;
}) {
  const [chargerActive, setChargerActive] = useState(
    chargerFallback.ok &&
      chargerIsActive(
        liveChargingFeed(
          chargerFallback.data,
          chargingFeedClockStale(chargerFallback.data, chargerFallback.servedAt ?? 0),
        ),
      ),
  );
  const [powerBankActive, setPowerBankActive] = useState(
    powerBankFallback.ok &&
      powerBankIsActive(
        liveChargingFeed(
          powerBankFallback.data,
          chargingFeedClockStale(powerBankFallback.data, powerBankFallback.servedAt ?? 0),
        ),
      ),
  );
  const [chargerOverride, setChargerOverride] = useState<boolean | null>(null);
  const [powerBankOverride, setPowerBankOverride] = useState<boolean | null>(null);

  const chargerOn = isDev && chargerOverride !== null ? chargerOverride : chargerActive;
  const powerBankOn =
    isDev && powerBankOverride !== null ? powerBankOverride : powerBankActive;
  const isVisible = chargerOn || powerBankOn;
  const both = chargerOn && powerBankOn;

  // 淡出时保留上一张卡，避免先闪回默认卡再收起。
  const [lastShown, setLastShown] = useState<Slot>("charger");
  const shown: Slot = chargerOn ? "charger" : powerBankOn ? "powerBank" : lastShown;
  if (shown !== lastShown) setLastShown(shown);

  const showing = (slot: Slot) => both || shown === slot;
  const heightFor = (slot: Slot) => (both ? HALF_PX : showing(slot) ? SLOT_PX : 0);

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
          <div
            className={cn(
              "charger-collapse min-h-0 md:h-full md:overflow-visible",
              isVisible ? "overflow-visible" : "overflow-hidden",
            )}
          >
            <div className="flex flex-col" style={{ height: SLOT_PX }}>
              <motion.div
                initial={false}
                animate={{ height: heightFor("charger"), opacity: showing("charger") ? 1 : 0 }}
                transition={reduced ? { duration: 0 } : CHARGER_TRANSITION}
                className={cn(
                  "min-h-0",
                  !showing("charger") && "pointer-events-none",
                )}
                aria-hidden={!showing("charger")}
              >
                <CardBoundary label="Charger" paths={CHARGER_READS}>
                  <ChargerCard
                    fallback={chargerFallback}
                    className="h-full"
                    onActiveChange={handleChargerActive}
                    compact={both}
                  />
                </CardBoundary>
              </motion.div>
              <motion.div
                initial={false}
                animate={{
                  height: heightFor("powerBank"),
                  opacity: showing("powerBank") ? 1 : 0,
                  marginTop: both ? STACK_GAP_PX : 0,
                }}
                transition={reduced ? { duration: 0 } : CHARGER_TRANSITION}
                className={cn(
                  "min-h-0",
                  !showing("powerBank") && "pointer-events-none",
                )}
                aria-hidden={!showing("powerBank")}
              >
                <CardBoundary label="Power Bank" paths={POWERBANK_READS}>
                  <PowerBankCard
                    fallback={powerBankFallback}
                    className="h-full"
                    onActiveChange={handlePowerBankActive}
                    compact={both}
                  />
                </CardBoundary>
              </motion.div>
            </div>
          </div>
        </motion.div>

        <div className="listening-shell min-w-0">
          <CardBoundary label="Recently Played" paths={LISTENING_READS}>
            <ListeningCard
              fallback={listeningFallback}
              nowFallback={nowListeningFallback}
              lyricsFallback={lyricsFallback}
              artworkPlaceholders={artworkPlaceholders}
              className="h-full"
              wide={!isVisible}
            />
          </CardBoundary>
        </div>
      </div>

      {isDev && (
        <DevToggleSlot>
          <DevToggle
            label="Charger"
            on={chargerOn}
            title="开发环境调试：切换 Charger 面板可见性"
            onClick={() => setChargerOverride((prev) => (prev !== null ? !prev : !chargerActive))}
          />
          <DevToggle
            label="Power Bank"
            on={powerBankOn}
            title="开发环境调试：切换 Power Bank 面板可见性"
            onClick={() =>
              setPowerBankOverride((prev) => (prev !== null ? !prev : !powerBankActive))
            }
          />
        </DevToggleSlot>
      )}
    </div>
  );
}
