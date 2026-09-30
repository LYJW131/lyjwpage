"use client";

import { useStaleAutoReload } from "@/hooks/use-stale-auto-reload";

export function StaleTabReload() {
  useStaleAutoReload("background");
  return null;
}
