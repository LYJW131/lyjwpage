"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import { DESKTOP_PATH } from "@/lib/paths";
import type { DesktopActivity, DesktopPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const LOCK_SCREEN_BUNDLE_ID = "com.apple.loginwindow";

/** 轮询只是兜底：状态变化由实时推送送来，断线由 pusher-js 自己重连 */
const REFRESH_MS = 30_000;

const APP_SWITCH_VARIANTS = {
  initial: {
    opacity: 0,
    x: -12,
  },
  animate: {
    opacity: 1,
    x: 0,
  },
  exit: {
    opacity: 0,
    x: 12,
  },
};

const APP_SWITCH_TRANSITION = {
  duration: 0.7,
  ease: [0.22, 1, 0.36, 1] as const,
};

/** 页头里的前台应用：只显示图标与名称，不带卡片、标题栏或状态边框。 */
export function HeaderDesktop({
  fallback,
  className,
}: {
  fallback: StatusResponse<DesktopPayload>;
  className?: string;
}) {
  useLiveEvents();
  const { data, error, isLoading } = useStatus<DesktopPayload>(DESKTOP_PATH, REFRESH_MS, {
    fallback,
  });
  const [displayedDesktop, setDisplayedDesktop] = useState<DesktopActivity | null>(null);
  const reduced = useReducedMotion();

  const offline = Boolean(error || data?.stale);
  const incomingDesktop = data?.desktop ?? null;
  const incomingApplicationName = incomingDesktop?.applicationName ?? null;
  const incomingBundleIdentifier = incomingDesktop?.bundleIdentifier ?? null;
  const incomingIconUrl = incomingDesktop?.iconUrl ?? null;
  const incomingObservedAt = incomingDesktop?.observedAt ?? 0;

  useEffect(() => {
    if (offline || !incomingApplicationName || !incomingIconUrl) return;

    const sameApplication =
      displayedDesktop?.bundleIdentifier === incomingBundleIdentifier &&
      displayedDesktop?.applicationName === incomingApplicationName;
    if (sameApplication && displayedDesktop?.iconUrl === incomingIconUrl) return;

    let cancelled = false;
    const preload = new window.Image();
    preload.decoding = "async";
    const nextDesktop: DesktopActivity = {
      applicationName: incomingApplicationName,
      bundleIdentifier: incomingBundleIdentifier,
      iconUrl: incomingIconUrl,
      observedAt: incomingObservedAt,
    };

    const commit = () => {
      if (!cancelled && preload.naturalWidth > 0) setDisplayedDesktop(nextDesktop);
    };

    preload.onload = commit;
    preload.src = incomingIconUrl;
    if (preload.complete && preload.naturalWidth > 0) commit();

    return () => {
      cancelled = true;
      preload.onload = null;
    };
  }, [
    displayedDesktop,
    incomingApplicationName,
    incomingBundleIdentifier,
    incomingIconUrl,
    incomingObservedAt,
    offline,
  ]);

  // 首屏直接用服务端 fallback；之后仍等新图标预加载好再交接，避免切换时闪空。
  const desktop = displayedDesktop ?? (offline ? null : incomingDesktop);
  const locked = desktop?.bundleIdentifier === LOCK_SCREEN_BUNDLE_ID;
  const applicationKey = offline
    ? "offline"
    : desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";
  const applicationName = offline
    ? "—"
    : locked
      ? "已锁屏"
      : desktop?.applicationName ?? (isLoading ? "读取中…" : "暂无活动");

  return (
    <div
      className={cn("relative h-8 min-w-0 overflow-hidden", className)}
      aria-label={`正在使用：${applicationName}`}
      aria-live="polite"
      title={applicationName}
    >
      {!desktop && !offline ? (
        <div className="absolute inset-0 flex min-w-0 items-center justify-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center text-xs text-muted-foreground">
            ⌘
          </span>
          <span className="truncate text-sm font-medium text-muted-foreground">
            {applicationName}
          </span>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <motion.div
            key={applicationKey}
            variants={reduced ? STATIC_VARIANTS : APP_SWITCH_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? STATIC_TRANSITION : APP_SWITCH_TRANSITION}
            className="absolute inset-0 flex min-w-0 items-center justify-center gap-2"
          >
            <span className="flex size-7 shrink-0 items-center justify-center">
              {desktop?.iconUrl && !offline && !locked ? (
                <Image
                  src={desktop.iconUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 object-contain"
                  unoptimized
                />
              ) : locked ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5 text-muted-foreground"
                  aria-hidden
                >
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                </svg>
              ) : (
                <span className="text-xs text-muted-foreground">⌘</span>
              )}
            </span>
            <span className="truncate text-sm font-medium">{applicationName}</span>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
