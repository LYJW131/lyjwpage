"use client";

import useSWR from "swr";

import { ONLINE_CONNECTED_KEY, ONLINE_COUNT_KEY, useLiveEvents } from "@/hooks/use-live-events";

/**
 * 此刻可见的页面数与推送连接状态，页脚「Online now」用。
 *
 * 不另开连接：人数由推送房间自己数、随 `online` 事件推来（口径见
 * workers/api/src/live-census.ts），这里只订阅那条共用连接、读它写下的两个键。
 */
export function useOnlineCount(): { count: number | undefined; connected: boolean } {
  useLiveEvents();
  const { data: count } = useSWR<number>(ONLINE_COUNT_KEY, null);
  const { data: connected } = useSWR<boolean>(ONLINE_CONNECTED_KEY, null);
  return { count, connected: connected ?? false };
}
