"use client";

import useSWR from "swr";

import { ONLINE_CONNECTED_KEY, ONLINE_COUNT_KEY, useLiveEvents } from "@/hooks/use-live-events";

export function useOnlineCount(): { count: number | undefined; connected: boolean } {
  useLiveEvents();
  const { data: count } = useSWR<number>(ONLINE_COUNT_KEY, null);
  const { data: connected } = useSWR<boolean>(ONLINE_CONNECTED_KEY, null);
  return { count, connected: connected ?? false };
}
