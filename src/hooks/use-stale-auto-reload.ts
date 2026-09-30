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


const LEDGER_KEY = "lyjw:auto-reload:v3";

function readLedger(): { usable: boolean; ledger: AutoReloadLedger } {
  try {
    return { usable: true, ledger: parseAutoReloadLedger(window.sessionStorage.getItem(LEDGER_KEY)) };
  } catch {
    return { usable: false, ledger: EMPTY_AUTO_RELOAD_LEDGER };
  }
}

// 隐私模式下 setItem 可能不抛错却未落盘，必须读回确认。
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
  const playerBusy = Boolean(player && (player.active || player.syncing));

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
      const ledger = rebaseAutoReloadLedger(stored.ledger, now);
      const usable = stored.usable && (ledger === stored.ledger || writeLedger(ledger));
      const decision = autoReloadDecision({
        status,
        latestCommit,
        trigger,
        hidden: document.visibilityState === "hidden",
        playerBusy,
        ledger: usable ? ledger : null,
        now,
      });
      if (decision.action === "wait") {
        timer = window.setTimeout(attempt, decision.ms);
        return;
      }
      // 账必须先落盘再刷新，否则拿回旧页面时会无限刷新。
      if (decision.action === "reload" && writeLedger(recordAutoReload(ledger, latestCommit, now))) {
        window.location.reload();
      }
    };

    attempt();
    if (trigger === "background") document.addEventListener("visibilitychange", attempt);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [status, latestCommit, trigger, playerBusy]);
}
