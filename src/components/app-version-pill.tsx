"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useState } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { useAppVersion } from "@/hooks/use-app-version";

/**
 * 右下角的新版本提示。只在确认手上这份 HTML 比线上旧时出现，
 * 点刷新拿新版；关掉后这一次部署不再打扰，再有新部署会重新冒出来。
 *
 * 灯用 idle 那盏黄：它不是实时数据，用不着 live 的绿，更不能呼吸着抢注意力。
 */
export function AppVersionPill() {
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
          transition={{ duration: 0.2 }}
          role="status"
          className="fixed right-4 bottom-4 z-50 flex items-center gap-2.5 rounded-full border border-line bg-surface/90 py-2 pr-2 pl-3.5 shadow-none backdrop-blur"
        >
          <StatusDot tone="idle" />
          <span className="label-mono text-muted-foreground">
            有新版本{latestCommit ? ` · ${latestCommit.slice(0, 7)}` : null}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="label-mono rounded-full bg-foreground px-3 py-1 text-background transition-opacity hover:opacity-80"
          >
            刷新
          </button>
          <button
            type="button"
            aria-label="不再提示这次更新"
            onClick={() => setDismissedFor(latestCommit)}
            className="rounded-full p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
