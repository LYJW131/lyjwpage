"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import Image from "@/components/app-image";
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

/**
 * 应用下方的窗口标题：字号缩小、淡色、居中并在超出时省略号截断。
 * 标题换得勤，读屏不必每次都念（容器本来就是 aria-live），完整文本挂在容器的 title 上。
 */
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

/** 页头里的前台应用：图标、名称，以及上报器放行的窗口标题；不带卡片、标题栏或状态边框。 */
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
      // 标题不走这条交接：它在渲染时直接取 incoming，见下面的 windowTitle
      windowTitle: null,
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
    ? "Offline"
    : locked
      ? "Locked"
      : activeOverride?.displayName ?? desktop?.applicationName ?? (isLoading ? "Loading…" : "Idle");
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
   * 窗口标题直接取 incoming，不进 displayedDesktop：那条交接为了图标预加载会在
   * 同一应用内早退，标题跟着进去就会冻在第一份上；而标题换得比应用勤得多
   * （切个文件就换），也不该每次都重跑预加载。只在 incoming 和正画着的是同一个
   * 应用时才拼上去，否则交接那 300ms 里新应用的标题会挂在旧应用的图标旁边。
   * 离线时 desktop 还留着最后那份，标题必须一起收掉。
   */
  const windowTitle =
    !offline &&
    !locked &&
    desktop &&
    incomingBundleIdentifier === desktop.bundleIdentifier
      ? (incomingDesktop?.windowTitle ?? null)
      : null;

  /**
   * 标题退场期间还占着位置的那份缓存，按应用记。
   *
   * 换了应用就不接力：新面板的尺寸只看它自己有没有标题。从前缓存不分应用，
   * 从带标题的 Ghostty 切到没标题的 Claude Code 时，新面板先按「有标题」的
   * 小号进场，等旧面板里那条标题收完（约 0.28 秒）才弹回大号 —— 字标和
   * 吉祥物在滑入尾声硬跳一号。离线和锁屏各自是一个 key，自然也会清掉。
   */
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

  /**
   * 有窗口标题才把图标缩一号，没标题就还是原来的 28px。
   *
   * 判据用 `measuredTitle` 而不是 `windowTitle`：标题正在淡出的那一帧还占着
   * 高度，图标这时候弹回大号会和标题的收起动画对着干。
   *
   * 尺寸、间距和字标高度都交给 motion，和标题共用同一份 transition。从前它们
   * 走 CSS transition（200ms ease-out），和标题的 280ms 曲线各走各的钟，两条
   * 曲线一起挪同一个垂直居中，看着就是一顿一顿的。量宽那行也要一起动：
   * 容器宽度跟着它，它要是瞬间变窄，正在缩的那一行会被 overflow-hidden 切掉
   * 两侧各 5px。
   */
  const compact = Boolean(measuredTitle);
  const slotSize = compact ? 20 : 28;
  const glyphSize = compact ? 20 : 24;
  // 带单位：motion 不给 column-gap 补 px，裸数字写进去是无效样式，间距就停在原地
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
        {/* 字标只给高度，宽度按 viewBox 比例自己算；h-full 压过它自带的 height 属性 */}
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
      {/* 内容绝对定位做切换动画，宽度得另开一行量，否则中间栏只剩 1/3 就开始省略。 */}
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
                  <motion.span
                    className="flex items-center justify-center"
                    initial={false}
                    animate={{ width: glyphSize, height: glyphSize }}
                    transition={sizeTransition}
                  >
                    {/* 替换图标自带 width/height 属性，size-full 压过去，跟着外面这层缩放 */}
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
                // 只清自己这个应用的那份：正在滑出的旧面板用的是它最后一次渲染的
                // props，这个回调可能从那里来，那时新应用的接力不归它管。
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
                  /*
                   * shrink-0 是必须的：容器定高 36px，标题进场那一刻图标还是 28px，
                   * 28 + 2 + 13.75 装不下，flex 会把标题这个 overflow:hidden 的项压到
                   * 8px —— motion 量 `auto` 高度量到的就是这个被压过的数，动画朝 8px
                   * 走，结束一放开又跳回 13.75px，肉眼就是一顿。
                   */
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
