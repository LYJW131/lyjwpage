"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import { DESKTOP_PATH } from "@/lib/paths";
import type { DesktopActivity, DesktopPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 锁屏时前台是 loginwindow —— 那是 macOS 的锁屏进程，不是用户在用的应用。
 * 直接把进程名摆出来既没意义又像出了 bug，换成状态本身的说法。
 * 判据用 bundle ID 不用名字：名字会随系统语言变。
 */
const LOCK_SCREEN_BUNDLE_ID = "com.apple.loginwindow";

/** 轮询只是兜底：状态变化由实时推送送来，断线由 pusher-js 自己重连 */
const REFRESH_MS = 30_000;

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

export function LiveDeskCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<DesktopPayload>;
  className?: string;
}) {
  // 推送把最新状态直接写进 SWR 缓存，所以这里照旧读同一个 key 就行
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
  const locked = desktop?.bundleIdentifier === LOCK_SCREEN_BUNDLE_ID;
  // 只在前台应用真正切换时播放动效。
  const applicationKey = offline
    ? "offline"
    : desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";

  /**
   * 首屏那次不算切换。
   *
   * 扫光是个普通 span，CSS 动画挂载即播，靠 key 变化重新挂载来重播 —— 对
   * 「换了应用」是对的，但首屏时 displayedDesktop 从 null 变成第一个应用，
   * 这个元素也是第一次挂载，动画照样播。旁边那个 motion.div 有 initial={false}
   * 挡着，它在 AnimatePresence 外面，没人管。
   *
   * 记住见过的第一个 key，等它真的变过一次再开始渲染扫光。用的是「渲染期
   * setState 存上一轮信息」的官方模式，而不是 ref：判断必须在渲染扫光的同一次
   * render 里就为真，渲染期 setState 会让 React 在提交前立刻带新 state 重来
   * 一遍，正好满足；ref 虽然也能做到，但渲染期读写 ref 违反 react-hooks/refs
   * （并发渲染下一次被丢弃的 render 也会把 ref 写脏）。
   */
  const [seen, setSeen] = useState<{ key: string; switched: boolean } | null>(null);
  // 只在有真实应用时记基线：首屏那几帧 key 是 offline / idle，
  // 把它们算进去的话「offline → 第一个应用」就成了一次切换，扫光照样播
  if (displayedDesktop) {
    if (seen === null) {
      setSeen({ key: applicationKey, switched: false });
    } else if (seen.key !== applicationKey) {
      setSeen({ key: applicationKey, switched: true });
    }
  }

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
                    {desktop?.iconUrl && !offline && !locked ? (
                      <Image
                        src={desktop.iconUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : locked ? (
                      /*
                       * 自己画的锁，不用系统那个 —— macOS 原装的 LockedIcon.icns
                       * 是 Keychain 时代的拟物黄铜锁，跟这张卡不搭；SF Symbols
                       * 的 lock.fill 好看但授权限定在 Apple 平台，这是公开站点。
                       * currentColor 让它跟着主题走，和旁边那个 ⌘ 占位符同一种质感。
                       */
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-6 text-muted-foreground"
                        aria-hidden
                      >
                        <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                      </svg>
                    ) : (
                      <span className="text-sm text-muted-foreground">⌘</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xl font-medium">
                      {offline ? "—" : locked ? "已锁屏" : desktop?.applicationName ?? "暂无活动"}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
              )}
              {!reduced && displayedDesktop && seen?.switched && (
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
