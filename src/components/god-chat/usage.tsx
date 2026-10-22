"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { workerUrl } from "@/lib/worker-url";
import { GOD_CHAT_USAGE_PATH } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO, lineupTiers, type GodChatCount, type GodChatLineup, type GodChatUsage } from "@shared/god-chat-tiers";
import { RANK_TONE } from "@/components/god-chat/message-parts";

export const USAGE_URL = workerUrl(process.env.PUBLIC_BACKEND_URL, GOD_CHAT_USAGE_PATH);
function UsageBar({ count }: { count: GodChatCount }) {
  const full = count.used >= count.limit;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", full ? "bg-red-500" : "bg-foreground/60")}
          style={{ width: `${Math.min(100, (count.used / count.limit) * 100)}%` }}
        />
      </span>
      <span className={cn("tabular-nums", full && "text-signal-red")}>
        {count.used}/{count.limit}
      </span>
    </span>
  );
}

export type FetchedUsage = GodChatUsage & { resetAt: number };

function useCountdown(resetAt: number | null, onReset: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  });
  useEffect(() => {
    if (resetAt === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resetAt) {
        clearInterval(timer);
        onResetRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [resetAt]);
  return resetAt === null ? 0 : Math.max(0, Math.ceil((resetAt - now) / 1000));
}

export function UsagePanel({
  usage,
  lineup,
  onClose,
  onReset,
}: {
  usage: FetchedUsage | "loading";
  lineup: GodChatLineup;
  onClose: () => void;
  onReset: () => void;
}) {
  const ticking = usage !== "loading" && usage.resetInMs > 0 ? usage.resetAt : null;
  const secondsLeft = useCountdown(ticking, onReset);
  return (
    <div className="mb-2 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-2xs text-muted-foreground">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-foreground">
          Usage
          {usage !== "loading" && (
            <>
              {" "}· {usage.windowMs / 1000}s window
              {ticking !== null && <> · resets in {secondsLeft}s</>}
            </>
          )}
        </span>
        <button type="button" onClick={onClose} aria-label="Close usage" className="hover:text-foreground">
          esc
        </button>
      </div>
      {usage === "loading" ? (
        <div className="animate-pulse">Asking the temple…</div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1">
          <span />
          <span className="label-mono">you</span>
          <span className="label-mono">whole site</span>
          <span>All messages</span>
          <UsageBar count={usage.visitor} />
          <span>—</span>
          {lineupTiers(lineup).reverse().map((tier) => (
            <Fragment key={tier}>
              <span className={cn("truncate", RANK_TONE[tier])}>
                {GOD_CHAT_TIER_INFO[tier].persona} · {GOD_CHAT_TIER_INFO[tier].label}
              </span>
              <UsageBar count={usage.tiers[tier].visitor} />
              <UsageBar count={usage.tiers[tier].everyone} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
