"use client";

import { useEffect } from "react";

import { useWebPlayer } from "@/components/web-player/web-player-provider";
import { useVersionStatus } from "@/hooks/use-app-version";
import {
  autoReloadDecision,
  parseAutoReloadLedger,
  rebaseAutoReloadLedger,
  recordAutoReload,
  settleAutoReloadLedger,
  EMPTY_AUTO_RELOAD_LEDGER,
  type AutoReloadLedger,
  type AutoReloadTrigger,
} from "@/lib/app-version";

/**
 * 旧页面自己刷成新版：版本提示卡「告诉人」，这里在合适的时候「替人做」。
 * 什么场合能做、有哪几道闸（每个目标版本一轮最多试几次 / 冷却 / 播放器在放不刷 / 存储不可用不刷）见
 * lib/app-version 的 autoReloadDecision，这里只管把浏览器里的事实喂给它。
 *
 * - `background`：页面躺在后台时刷。`version` 推送在后台标签页里照样收得到（WebSocket
 *   不受页面可见性影响），所以旧页面通常在人切回来之前就已经换好了。前台不动，只有提示卡。
 * - `page-crash`：整页已经被错误页顶替（app/error.tsx），可见也刷。
 */

/** 这个标签页自动刷新的账，跨刷新保留、跨标签页隔离。账的形状变了就升版本号，旧存档不会被当成新的读 */
const LEDGER_KEY = "lyjw:auto-reload:v3";

function readLedger(): { usable: boolean; ledger: AutoReloadLedger } {
  try {
    return { usable: true, ledger: parseAutoReloadLedger(window.sessionStorage.getItem(LEDGER_KEY)) };
  } catch {
    return { usable: false, ledger: EMPTY_AUTO_RELOAD_LEDGER };
  }
}

/** 写进去再读回来确认：隐私模式下 setItem 可能不抛错却没落盘 */
function writeLedger(ledger: AutoReloadLedger): boolean {
  try {
    const raw = JSON.stringify(ledger);
    window.sessionStorage.setItem(LEDGER_KEY, raw);
    return window.sessionStorage.getItem(LEDGER_KEY) === raw;
  } catch {
    return false;
  }
}

export function useStaleAutoReload(trigger: AutoReloadTrigger): void {
  const { status, latestCommit, pageCommit } = useVersionStatus();
  const player = useWebPlayer();
  // 没有播放器上下文（error.tsx 这类独立页面）就是没有在放的东西
  const playerBusy = Boolean(player && (player.active || player.syncing));

  // 刷回来的页面已经是那个版本：那次尝试成功了，划掉，以后回滚到它还要能刷
  useEffect(() => {
    const stored = readLedger();
    if (!stored.usable) return;
    const settled = settleAutoReloadLedger(stored.ledger, pageCommit);
    if (settled !== stored.ledger) writeLedger(settled);
  }, [pageCommit]);

  useEffect(() => {
    if (status !== "stale" || !latestCommit) return;

    let timer: number | undefined;
    const attempt = () => {
      window.clearTimeout(timer);
      const stored = readLedger();
      const now = Date.now();
      // 系统时钟被拨回过时，冷却的起点落在「未来」：拉回现在并落盘（rebaseAutoReloadLedger 的说明）
      const ledger = rebaseAutoReloadLedger(stored.ledger, now);
      if (stored.usable && ledger !== stored.ledger) writeLedger(ledger);
      const decision = autoReloadDecision({
        status,
        latestCommit,
        trigger,
        hidden: document.visibilityState === "hidden",
        playerBusy,
        ledger: stored.usable ? ledger : null,
        now,
      });
      // 冷却里：到点再判一次（那时版本可能又变了，也可能人已经手动刷过）
      if (decision.action === "wait") {
        timer = window.setTimeout(attempt, decision.ms);
        return;
      }
      // 账必须先落下再刷新，否则刷回来还是旧页面时会无限循环
      if (decision.action === "reload" && writeLedger(recordAutoReload(ledger, latestCommit, now))) {
        window.location.reload();
      }
    };

    attempt();
    // 先看得见、后来被切走：切走那一刻再判一次
    if (trigger === "background") document.addEventListener("visibilitychange", attempt);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [status, latestCommit, trigger, playerBusy]);
}
