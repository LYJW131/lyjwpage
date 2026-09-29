"use client";

import { useStaleAutoReload } from "@/hooks/use-stale-auto-reload";

/**
 * 不画任何东西：旧页面躺在后台时自己刷成新版，见 hooks/use-stale-auto-reload。
 * 单独成一个组件，是为了让它和版本提示卡（可能被用户关掉、也可能自己崩）互不牵连。
 */
export function StaleTabReload() {
  useStaleAutoReload("background");
  return null;
}
