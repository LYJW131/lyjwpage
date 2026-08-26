"use client";

import { useSyncExternalStore } from "react";

import {
  getLocalCharging,
  getLocalChargingServerSnapshot,
  subscribeLocalCharging,
} from "@/lib/local-charging";

/**
 * 本机 SSE 连上之后才有值。这台浏览器没访问过 `/local/charging`、SSR、
 * 别人的浏览器都是 null，卡片继续用远端。
 */
export function useLocalCharging() {
  return useSyncExternalStore(
    subscribeLocalCharging,
    getLocalCharging,
    getLocalChargingServerSnapshot,
  );
}
