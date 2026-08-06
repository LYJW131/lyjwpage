"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { ACTIVITY_PATH, useLiveStream } from "@/hooks/use-live-stream";
import { useStatus } from "@/hooks/use-status";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import type { ActivityPayload, DesktopActivity } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 推送断了才靠轮询顶着，这时要跟得紧 */
const REFRESH_MS = 3_000;
/** 推送正常时轮询只是兜底，压到最低 */
const PUSHED_REFRESH_MS = 30_000;

const APP_SWITCH_VARIANTS = {
  initial: {
    opacity: 1,
    x: -18,
    scale: 1.06,
    filter: "blur(8px)",
    clipPath: "inset(0 100% 0 0 round 6px)",
    zIndex: 0,
  },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: "blur(0px)",
    clipPath: "inset(0 0% 0 0 round 6px)",
    zIndex: 0,
  },
  exit: {
    opacity: 0,
    x: 20,
    scale: 1.06,
    filter: "blur(7px)",
    clipPath: "inset(0 0% 0 0 round 6px)",
    zIndex: 10,
  },
};

const APP_SWITCH_TRANSITION = {
  duration: 0.7,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function LiveDeskCard({ className }: { className?: string }) {
  // 推送把最新状态直接写进 SWR 缓存，所以这里照旧读同一个 key 就行
  const { connected } = useLiveStream();
  const { data, error, isLoading } = useStatus<ActivityPayload>(
    ACTIVITY_PATH,
    connected ? PUSHED_REFRESH_MS : REFRESH_MS,
  );
  const [displayedDesktop, setDisplayedDesktop] = useState<DesktopActivity | null>(null);
  const reduced = useReducedMotion();

  const offline = Boolean(error || data?.desktopStale);
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

    // onload 已保证图片完整可绘制。这里不再等待 decode()，避免部分浏览器的
    // decode Promise 长时间不结束，把已经下载好的新活动状态永久卡住。
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

  // 图标预加载门控是为了避免切换应用时旧图标闪空。首屏没有「旧的」可保护，
  // 等它只会让卡片白白多停一个网络往返，所以这时直接用刚到的数据渲染。
  const desktop = displayedDesktop ?? (offline ? null : incomingDesktop);
  // 只在前台应用真正切换时播放动效。
  const applicationKey = offline
    ? "offline"
    : desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";

  return (
    <Card
      label="Live Desk"
      tone={offline ? "off" : data ? "live" : "idle"}
      action={offline ? "离线" : data ? "在线" : "等待上报"}
      className={cn("md:col-span-2", className)}
    >
      {/* 本机播放已经并进 Recently Played 那张卡，这里只剩前台应用 */}
      <div className="px-4 pb-4 pt-3">
        <div className="flex min-h-28 flex-col justify-center rounded-md border border-line bg-background/40 p-4">
          <div className="label-mono text-muted-foreground">正在使用</div>
          <div className="relative mt-2 min-h-10 overflow-hidden">
            <div className="relative w-fit max-w-full">
              {/* 首屏占位不进 AnimatePresence：把它当成一个 child 的话，数据到达
                  时的这次 key 变化会被当作一次真实的应用切换，非要播完 0.7 秒的
                  模糊 + 滑入才显示出来。等有内容再挂载，initial={false} 就会直接
                  跳过入场动画，此后真正的应用切换照常有动效。 */}
              {!desktop && !offline ? (
                <div className="relative flex w-max max-w-full min-w-0 items-center gap-3">
                  <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden">
                    <span className="text-sm text-muted-foreground">⌘</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xl font-medium text-muted-foreground">
                      {isLoading ? "读取中…" : "暂无活动"}
                    </div>
                  </div>
                </div>
              ) : (
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={applicationKey}
                  variants={reduced ? STATIC_VARIANTS : APP_SWITCH_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={reduced ? STATIC_TRANSITION : APP_SWITCH_TRANSITION}
                  className="relative flex w-max max-w-full min-w-0 origin-left items-center gap-3 overflow-hidden rounded-md"
                >
                  <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden">
                    {desktop?.iconUrl && !offline ? (
                      <Image
                        src={desktop.iconUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">⌘</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xl font-medium">
                      {offline ? "—" : desktop?.applicationName ?? "暂无活动"}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
              )}
              {!reduced && displayedDesktop && (
                <span
                  key={`sheen-${applicationKey}`}
                  className="app-switch-sheen"
                  aria-hidden
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
