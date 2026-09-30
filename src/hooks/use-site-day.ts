"use client";

import { useSyncExternalStore } from "react";

import { nextZonedDayStart, zonedDay } from "@/lib/heatmap-window";
import { site } from "@/lib/site";

const ROLLOVER_GRACE_MS = 2_000;

function siteDayNow(): string {
  return zonedDay(Date.now() - ROLLOVER_GRACE_MS, site.timezone);
}

function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const now = Date.now() - ROLLOVER_GRACE_MS;
    timer = setTimeout(() => {
      onChange();
      arm();
    }, nextZonedDayStart(now, site.timezone) - now);
  };
  arm();
  return () => clearTimeout(timer);
}

export function useSiteDay(): string | null {
  return useSyncExternalStore(subscribe, siteDayNow, () => null);
}
