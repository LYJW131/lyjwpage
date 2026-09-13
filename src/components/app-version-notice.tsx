"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useState } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { useAppVersion } from "@/hooks/use-app-version";

/**
 * 右下角的新版本提示条。
 *
 * 遵循整站的硬边纸片、直角网格与制图感规范，不使用任何圆角和漂浮毛玻璃。
 * 只在确认手上这份 HTML 比线上生产版本旧时出现；关掉后本次部署不再打扰，
 * 再次出现新部署时重新提醒。
 */
export function AppVersionNotice() {
  const { status, latestCommit } = useAppVersion();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const visible = status === "stale" && latestCommit !== dismissedFor;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          role="status"
          className="paper-card fixed right-4 bottom-4 z-50 flex items-stretch border border-line-strong bg-surface text-xs"
        >
          <div className="flex items-center gap-2 border-r border-line bg-muted px-2.5 py-1.5">
            <StatusDot tone="idle" />
            <span className="label-mono text-muted-foreground">UPDATE</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>线上有新版本</span>
            {latestCommit && (
              <span className="font-mono text-foreground">{latestCommit.slice(0, 7)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="border-l border-line px-3 py-1.5 label-mono font-medium text-foreground transition-colors hover:bg-surface-hover"
          >
            刷新
          </button>
          <button
            type="button"
            aria-label="不再提示这次更新"
            onClick={() => setDismissedFor(latestCommit)}
            className="flex items-center justify-center border-l border-line px-2 py-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
