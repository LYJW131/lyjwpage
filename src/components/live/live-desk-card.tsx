"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { MacBookProIcon } from "@/components/ui/device-icons";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useReporterStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { findDesktopOverride } from "@/lib/desktop-app-overrides";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import { DESKTOP_PATH } from "@/lib/paths";
import type { DesktopActivity, DesktopPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const LOCK_SCREEN_BUNDLE_ID = "com.apple.loginwindow";

/** 轮询只是兜底：状态变化由实时推送送来，断线由 use-live-events 退避重连。 */
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

/** 页头里的前台应用：只显示图标与名称，不带卡片、标题栏或状态边框。 */
export function HeaderDesktop({
  fallback,
  iconDataUri,
  className,
}: {
  fallback: StatusResponse<DesktopPayload>;
  /**
   * SSR 信封里那枚图标压好的内联副本（见 lib/desktop-icon-inline），
   * 只用于首屏那一帧；压不出来是 null，照旧走远端。
   */
  iconDataUri: string | null;
  className?: string;
}) {
  useLiveEvents();
  const { data, error, isLoading, isValidating } = useStatus<DesktopPayload>(DESKTOP_PATH, REFRESH_MS, {
    fallback,
  });
  const [displayedDesktop, setDisplayedDesktop] = useState<DesktopActivity | null>(null);
  const reduced = useReducedMotion();

  const { atSource, byClock } = useReporterStale(data);
  /**
   * 当标签页从后台唤醒时，SWR 会立即触发回源校验（isValidating）。在回源未完成前，
   * 不根据休眠期间老化的客户端时间戳（byClock）误判离线 —— 那段时间轮询是停的
   * （usePageActive），lastSeenAt 老化只说明没人去问，不说明 Mac 掉了。
   *
   * `atSource` 不受这条守卫限制，它不是本地钟算出来的：源站给这份数据时就已经
   * 判过一次。首屏尤其只能靠它 —— 那一帧 byClock 恒为 false，从前于是照着
   * Mac 掉线前最后那个前台应用画（睡下去的话就是「已锁屏」），要等挂载**并且**
   * 回源完成才翻成「已离线」，两级延迟叠在一起。
   */
  const offline = Boolean(error || atSource || (byClock && !isValidating));
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
      iconUrl: incomingIconUrl ?? "",
      observedAt: incomingObservedAt,
    };

    // 自带覆盖图标或暂时没图时无需预加载，但也不能在 effect 本体同步 setState。
    // 排进微任务既让名称在本帧交接，又给 cleanup 留出取消陈旧更新的机会。
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
    // 缓存未命中时别把整行名字卡住等图；300ms 够内存缓存的图落地，
    // 剩下的交给 <Image> 自己加载。
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

  // 首屏直接用服务端 fallback；之后名字立刻换，图标最多等 300ms 预加载。
  const desktop = displayedDesktop ?? (offline ? null : incomingDesktop);
  const activeOverride = findDesktopOverride(desktop?.bundleIdentifier);
  const locked = desktop?.bundleIdentifier === LOCK_SCREEN_BUNDLE_ID;
  const applicationKey = offline
    ? "offline"
    : activeOverride?.key ?? desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";
  const applicationName = offline
    ? "已离线"
    : locked
      ? "已锁屏"
      : activeOverride?.displayName ?? desktop?.applicationName ?? (isLoading ? "读取中…" : "暂无活动");
  /**
   * 离线 / 锁屏 > 应用替换 > 源图标，图标和文字必须是同一个优先级。
   *
   * 从前只有图标这么排，文字那边只看有没有 renderText —— 于是 Mac 掉线时图标
   * 翻成了笔记本、文字还挂着上一个应用的矢量字标（`applicationName` 早就算好
   * 是「已离线」了，只是根本没轮到它）。只有 Claude Code / Cursor 这类替换过
   * 文案的应用看得出来：其余应用走的就是 applicationName 那条路。
   *
   * 锁屏当下侥幸没出错 —— `com.apple.loginwindow` 谁都匹配不上，override 为空。
   * 但那是巧合不是设计：哪天有个应用的 match 宽到把它兜进去就一起坏。
   */
  const overrideText = offline || locked ? undefined : activeOverride?.renderText;
  /**
   * 内联副本只认 SSR 信封里那一枚图标，别的一律走远端。
   *
   * 这里刻意只比 URL、不碰上面那套 sameApplication / 预加载：内联是「首屏这一帧
   * 少一次往返」，不是新的一条数据通路。挂载后切了应用，iconUrl 就对不上，
   * 自然落回 `<Image>` 的远端路径，过渡逻辑一个字节都没被动过。
   *
   * 换回同一个应用时又会对上、又用内联那份，这是白赚的：内容寻址，同一个
   * objectKey 就是同一张图。
   */
  const ssrIconUrl = fallback.ok ? (fallback.data.desktop?.iconUrl ?? null) : null;

  return (
    <div
      className={cn(
        "relative h-8 max-w-[min(20rem,calc(100vw-9rem))]",
        activeOverride?.key === "claude-code" ? "overflow-visible" : "overflow-hidden",
        className,
      )}
      aria-label={offline ? "Mac 上报器已离线" : `正在使用：${applicationName}`}
      aria-live="polite"
      title={offline ? "Mac 上报器已离线" : applicationName}
    >
      {/* 内容绝对定位做切换动画，宽度得另开一行量，否则中间栏只剩 1/3 就开始省略。 */}
      <div className="pointer-events-none invisible flex items-center gap-2" aria-hidden>
        <span className="size-7 shrink-0" />
        {overrideText ? (
          <span className="flex shrink-0 items-center">{overrideText({ size: 20 })}</span>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium">{applicationName}</span>
        )}
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
            className="absolute inset-0 flex min-w-0 items-center justify-center gap-2"
          >
            <span className="flex size-7 shrink-0 items-center justify-center">
              {/* 和 overrideText 同一个优先级：离线 / 锁屏 > 应用替换 > 源图标 */}
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
                activeOverride.renderIcon({ size: 24 })
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
                  className="size-7 object-contain"
                  unoptimized
                  // 内联那帧同步解码，别让 async 的调度把它滑过首帧空一下；
                  // 理由同 contact-card 的头像，远端分支维持 async
                  decoding={
                    iconDataUri && desktop.iconUrl === ssrIconUrl ? "sync" : "async"
                  }
                />
              ) : (
                <span className="text-xs text-muted-foreground">⌘</span>
              )}
            </span>
            {overrideText ? (
              <span className="flex shrink-0 items-center text-foreground">
                {overrideText({ size: 20 })}
              </span>
            ) : (
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  offline && "text-muted-foreground",
                )}
              >
                {applicationName}
              </span>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
