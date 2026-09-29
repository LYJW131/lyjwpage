"use client";

import { useEffect } from "react";

import { useWebPlayer } from "@/components/web-player/web-player-provider";
import { useVersionStatus } from "@/hooks/use-app-version";
import { shouldAutoReload, type AutoReloadTrigger } from "@/lib/app-version";

/**
 * 旧页面自己刷成新版：版本提示卡「告诉人」，这里在合适的时候「替人做」。
 * 什么场合能做、三道闸（同一目标只刷一次 / 播放器在放不刷 / 存储不可用不刷）见
 * lib/app-version 的 shouldAutoReload，这里只管把浏览器里的事实喂给它。
 *
 * - `background`：页面躺在后台时刷。`version` 推送在后台标签页里照样收得到（WebSocket
 *   不受页面可见性影响），所以旧页面通常在人切回来之前就已经换好了。
 * - `crash`：某张卡已经崩成兜底了。可见也刷，因为这时刷新就是修复。
 */

/** 记「这个标签页已经为哪个 sha 自动刷过」。sessionStorage 跨刷新保留、跨标签页隔离 */
const MARK_KEY = "lyjw:auto-reloaded-for";

function readMark(): { usable: boolean; value: string | null } {
  try {
    return { usable: true, value: window.sessionStorage.getItem(MARK_KEY) };
  } catch {
    return { usable: false, value: null };
  }
}

/** 写进去再读回来确认：隐私模式下 setItem 可能不抛错却没落盘 */
function writeMark(sha: string): boolean {
  try {
    window.sessionStorage.setItem(MARK_KEY, sha);
    return window.sessionStorage.getItem(MARK_KEY) === sha;
  } catch {
    return false;
  }
}

export function useStaleAutoReload(trigger: AutoReloadTrigger): void {
  const { status, latestCommit } = useVersionStatus();
  const player = useWebPlayer();
  // 没有播放器上下文（error.tsx 这类独立页面）就是没有在放的东西
  const playerBusy = Boolean(player && (player.active || player.syncing));

  useEffect(() => {
    if (status !== "stale" || !latestCommit) return;

    const attempt = () => {
      const mark = readMark();
      const go = shouldAutoReload({
        status,
        latestCommit,
        trigger,
        hidden: document.visibilityState === "hidden",
        playerBusy,
        reloadedFor: mark.value,
        storageUsable: mark.usable,
      });
      // 标记必须先落下再刷新，否则刷回来还是旧页面时会无限循环
      if (go && writeMark(latestCommit)) window.location.reload();
    };

    attempt();
    if (trigger !== "background") return;
    // 先看得见、后来被切走：切走那一刻再判一次
    document.addEventListener("visibilitychange", attempt);
    return () => document.removeEventListener("visibilitychange", attempt);
  }, [status, latestCommit, trigger, playerBusy]);
}
