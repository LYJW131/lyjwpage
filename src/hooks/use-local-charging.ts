"use client";

import { useSyncExternalStore } from "react";

import {
  getLocalCharging,
  getLocalChargingServerSnapshot,
  subscribeLocalCharging,
} from "@/lib/local-charging";

export function useLocalCharging() {
  return useSyncExternalStore(
    subscribeLocalCharging,
    getLocalCharging,
    getLocalChargingServerSnapshot,
  );
}
