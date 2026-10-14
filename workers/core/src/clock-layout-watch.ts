import { withRequestState } from "@shared/request-state";
import { AwaitingReport } from "@shared/awaiting-report";
import { chargingFeedClockStale, liveChargingFeed, type ChargingFeed } from "@shared/freshness";
import { chargerActive, powerBankActive } from "@shared/home-layout";
import { CHARGER_TAG, DESKTOP_TAG, NOW_LISTENING_TAG, POWERBANK_TAG } from "@shared/live-events";
import { offlineByLiveness, readLiveness, type Liveness } from "@shared/reporter-liveness";
import type { ChargerStatus, PowerBankStatus } from "@shared/types";

import { getChargerLayoutFeed } from "./anker";
import { expireStatusTags } from "./live-platform";
import { getPowerBankSnapshot } from "./powerbank";
import { currentContext, requestStore } from "./runtime";
import { createPublicStorage } from "./storage-driver";

// 定时一轮每分钟一次；回看略长于一轮，相邻两轮重叠时多失效一次无害，留缝就会漏掉一次藏卡。
export const CLOCK_LAYOUT_LOOKBACK_MS = 90_000;

export type ClockLayoutFeeds = {
  liveness: Liveness;
  charger: (ChargingFeed & Pick<ChargerStatus, "totalPower">) | null;
  powerBank: (ChargingFeed & Pick<PowerBankStatus, "charging" | "outputPower">) | null;
};

function hidSince<T extends ChargingFeed>(feed: T, active: (feed: T) => boolean, before: number, now: number): boolean {
  return active(liveChargingFeed(feed, chargingFeedClockStale(feed, before))) &&
    !active(liveChargingFeed(feed, chargingFeedClockStale(feed, now)));
}

// 断档那一刻没有上报能触发失效，首屏缓存里还亮着的卡要等浏览器按时钟藏起，刷新时先亮后收；这里补上这次失效。
export function clockLayoutTags(feeds: ClockLayoutFeeds, now: number, lookbackMs = CLOCK_LAYOUT_LOOKBACK_MS): string[] {
  const before = now - lookbackMs;
  const tags: string[] = [];
  if (!offlineByLiveness(feeds.liveness, before) && offlineByLiveness(feeds.liveness, now)) {
    tags.push(DESKTOP_TAG, NOW_LISTENING_TAG);
  }
  if (feeds.charger && hidSince(feeds.charger, chargerActive, before, now)) tags.push(CHARGER_TAG);
  if (feeds.powerBank && hidSince(feeds.powerBank, powerBankActive, before, now)) tags.push(POWERBANK_TAG);
  return tags;
}

const awaiting = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (error instanceof AwaitingReport) return null;
    throw error;
  });

export async function watchClockLayout(now = Date.now()): Promise<string[]> {
  const { env, ctx } = currentContext();
  const hub = () => env.STATE.get(env.STATE.idFromName("global"));
  const storage = createPublicStorage(hub(), hub);
  return withRequestState(() => requestStore.run({ env, ctx, storage }, async () => {
    const [liveness, charger, powerBank] = await Promise.all([
      readLiveness(),
      getChargerLayoutFeed(),
      awaiting(getPowerBankSnapshot()),
    ]);
    const tags = clockLayoutTags({ liveness, charger, powerBank }, now);
    if (tags.length) await expireStatusTags(tags);
    return tags;
  }));
}
