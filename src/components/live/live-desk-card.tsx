"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import Image from "@/components/app-image";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useConfirmedStale, useReporterStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { findDesktopOverride } from "@/lib/desktop-app-overrides";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import { DESKTOP_PATH } from "@/lib/paths";
import type { DesktopActivity, DesktopPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const LOCK_SCREEN_BUNDLE_ID = "com.apple.loginwindow";

const REFRESH_MS = 60_000;

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

const TITLE_SWITCH_TRANSITION = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as const,
};

const TITLE_SWITCH_VARIANTS = {
  initial: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    y: -3,
  },
  animate: {
    opacity: 1,
    height: "auto",
    marginTop: 2,
    y: 0,
  },
  exit: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    y: -3,
  },
};

const TITLE_STATIC_VARIANTS = {
  initial: { opacity: 1, height: "auto", marginTop: 2, y: 0 },
  animate: { opacity: 1, height: "auto", marginTop: 2, y: 0 },
  exit: { opacity: 0, height: 0, marginTop: 0, y: 0 },
};

function WindowTitle({ title }: { title: string }) {
  return (
    <span
      className="mt-0.5 max-w-full truncate text-[11px] leading-tight text-muted-foreground"
      aria-hidden
    >
      {title}
    </span>
  );
}

export function HeaderDesktop({
  fallback,
  iconDataUri,
  className,
}: {
  fallback: StatusResponse<DesktopPayload>;
  iconDataUri: string | null;
  className?: string;
}) {
  useLiveEvents();
  const { data, error, isLoading, isValidating, servedAt } = useStatus<DesktopPayload>(DESKTOP_PATH, REFRESH_MS, {
    fallback,
  });
  const [displayedDesktop, setDisplayedDesktop] = useState<DesktopActivity | null>(null);
  const reduced = useReducedMotion();

  const { declared, byClock, settled } = useReporterStale(data, servedAt);
  const clockOffline = useConfirmedStale(byClock, isValidating, settled);
  const offline = Boolean(error || declared || clockOffline);
  const incomingDesktop = data?.desktop ?? null;
  const incomingBundleIdentifier = incomingDesktop?.bundleIdentifier ?? null;
  const incomingOverride = findDesktopOverride(incomingBundleIdentifier);
  const incomingApplicationName =
    incomingOverride?.displayName ?? incomingDesktop?.applicationName ?? null;
  const incomingIconUrl = incomingDesktop?.iconUrl ?? null;
  const incomingObservedAt = incomingDesktop?.observedAt ?? 0;

  useEffect(() => {
    if (offline || !incomingApplicationName) return;

    const sameApplication =
      displayedDesktop?.bundleIdentifier === incomingBundleIdentifier &&
      displayedDesktop?.applicationName === incomingApplicationName;

    const nextDesktop: DesktopActivity = {
      applicationName: incomingApplicationName,
      bundleIdentifier: incomingBundleIdentifier,
      windowTitle: null,
      iconUrl: incomingIconUrl ?? "",
      observedAt: incomingObservedAt,
    };

    if (incomingOverride || !incomingIconUrl) {
      if (sameApplication) return;
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setDisplayedDesktop(nextDesktop);
      });
      return () => {
        cancelled = true;
      };
    }

    if (sameApplication && displayedDesktop?.iconUrl === incomingIconUrl) return;

    let cancelled = false;
    const preload = new window.Image();
    preload.decoding = "async";

    const commit = () => {
      if (!cancelled) setDisplayedDesktop(nextDesktop);
    };

    preload.onload = commit;
    preload.onerror = commit;
    preload.src = incomingIconUrl;
    if (preload.complete) commit();
    const timeout = window.setTimeout(commit, 300);

    return () => {
      cancelled = true;
      preload.onload = null;
      preload.onerror = null;
      window.clearTimeout(timeout);
    };
  }, [
    displayedDesktop?.applicationName,
    displayedDesktop?.bundleIdentifier,
    displayedDesktop?.iconUrl,
    incomingApplicationName,
    incomingBundleIdentifier,
    incomingIconUrl,
    incomingObservedAt,
    incomingOverride,
    offline,
  ]);

  const desktop = displayedDesktop ?? (offline ? null : incomingDesktop);
  const activeOverride = findDesktopOverride(desktop?.bundleIdentifier);
  const locked = desktop?.bundleIdentifier === LOCK_SCREEN_BUNDLE_ID;
  const applicationKey = offline
    ? "offline"
    : activeOverride?.key ?? desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";
  const applicationName = offline
    ? "Offline"
    : locked
      ? "Locked"
      : activeOverride?.displayName ?? desktop?.applicationName ?? (isLoading ? "Loading…" : "Idle");
  const overrideText = offline || locked ? undefined : activeOverride?.renderText;
  // 图标预加载在同一应用内早退，窗口标题必须独立更新，并避免与旧应用图标错配。
  const windowTitle =
    !offline &&
    !locked &&
    desktop &&
    incomingBundleIdentifier === desktop.bundleIdentifier
      ? (incomingDesktop?.windowTitle ?? null)
      : null;

  const [titleCache, setTitleCache] = useState({
    key: applicationKey,
    current: windowTitle,
    cached: windowTitle,
  });

  if (windowTitle !== titleCache.current || applicationKey !== titleCache.key) {
    setTitleCache({
      key: applicationKey,
      current: windowTitle,
      cached: windowTitle ?? (applicationKey === titleCache.key ? titleCache.cached : null),
    });
  }

  const measuredTitle = windowTitle ?? titleCache.cached;
  const hoverText = offline
    ? "Mac reporter offline"
    : windowTitle
      ? `${applicationName} · ${windowTitle}`
      : applicationName;
  const ssrIconUrl = fallback.ok ? (fallback.data.desktop?.iconUrl ?? null) : null;

  const compact = Boolean(measuredTitle);
  const slotSize = compact ? 20 : 28;
  const glyphSize = compact ? 20 : 24;
  // motion 不为 column-gap 补 px，裸数字会成为无效样式。
  const rowGap = compact ? 6 : 8;
  const wordmarkHeight = compact ? 16 : 20;
  const sizeTransition = reduced ? STATIC_TRANSITION : TITLE_SWITCH_TRANSITION;
  const renderWordmark = (className?: string) =>
    overrideText ? (
      <motion.span
        className={cn("flex shrink-0 items-center", className)}
        initial={false}
        animate={{ height: wordmarkHeight }}
        transition={sizeTransition}
      >
        {overrideText({ size: 20, className: "h-full w-auto" })}
      </motion.span>
    ) : null;

  return (
    <div
      className={cn(
        "relative h-9 max-w-[min(20rem,calc(100vw-9rem))]",
        activeOverride?.key === "claude-code" ? "overflow-visible" : "overflow-hidden",
        className,
      )}
      aria-label={offline ? "Mac reporter offline" : `Using ${applicationName}`}
      aria-live="polite"
      title={hoverText}
    >
      <div className="pointer-events-none invisible flex flex-col items-center justify-center" aria-hidden>
        <motion.div
          className="flex shrink-0 items-center"
          initial={false}
          animate={{ columnGap: `${rowGap}px` }}
          transition={sizeTransition}
        >
          <motion.span
            className="shrink-0"
            initial={false}
            animate={{ width: slotSize, height: slotSize }}
            transition={sizeTransition}
          />
          {renderWordmark() ?? (
            <span className="shrink-0 text-sm font-medium leading-tight">{applicationName}</span>
          )}
        </motion.div>
        {measuredTitle ? <WindowTitle title={measuredTitle} /> : null}
      </div>
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
            className="absolute inset-0 flex min-w-0 flex-col items-center justify-center"
          >
            <motion.div
              className="flex shrink-0 items-center"
              initial={false}
              animate={{ columnGap: `${rowGap}px` }}
              transition={sizeTransition}
            >
              <motion.span
                className="flex shrink-0 items-center justify-center"
                initial={false}
                animate={{ width: slotSize, height: slotSize }}
                transition={sizeTransition}
              >
                {offline ? (
                  <MacBookProIcon className="size-5 text-muted-foreground" aria-hidden />
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
                ) : activeOverride ? (
                  <motion.span
                    className="flex items-center justify-center"
                    initial={false}
                    animate={{ width: glyphSize, height: glyphSize }}
                    transition={sizeTransition}
                  >
                    {activeOverride.renderIcon({ size: 24, className: "size-full" })}
                  </motion.span>
                ) : desktop?.iconUrl ? (
                  <Image
                    src={
                      iconDataUri && desktop.iconUrl === ssrIconUrl
                        ? iconDataUri
                        : desktop.iconUrl
                    }
                    alt=""
                    width={28}
                    height={28}
                    className="size-full object-contain"
                    unoptimized
                    decoding={
                      iconDataUri && desktop.iconUrl === ssrIconUrl ? "sync" : "async"
                    }
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">⌘</span>
                )}
              </motion.span>
              {renderWordmark("text-foreground") ?? (
                <span
                  className={cn(
                    "shrink-0 text-sm font-medium leading-tight",
                    offline && "text-muted-foreground",
                  )}
                >
                  {applicationName}
                </span>
              )}
            </motion.div>
            <AnimatePresence
              initial={false}
              onExitComplete={() => {
                // 离场旧面板仍可能回调，不能清掉新应用的接力状态。
                setTitleCache((prev) =>
                  prev.key === applicationKey ? { ...prev, cached: null } : prev,
                );
              }}
            >
              {windowTitle ? (
                <motion.span
                  key="window-title"
                  variants={reduced ? TITLE_STATIC_VARIANTS : TITLE_SWITCH_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={reduced ? STATIC_TRANSITION : TITLE_SWITCH_TRANSITION}
                  /* shrink-0 防止 flex 压扁标题，使 motion 把被压缩的高度误当作 auto 目标。 */
                  className="block max-w-full shrink-0 overflow-hidden truncate text-[11px] leading-tight text-muted-foreground"
                  aria-hidden
                >
                  {windowTitle}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
