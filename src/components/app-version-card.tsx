"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { DevToggle, DevToggleSlot } from "@/components/dev-toggles";
import { useAppVersion } from "@/hooks/use-app-version";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";

/**
 * 展开 / 收起两态。
 *
 * 展开时下方带 12px 外边距（即 gap-3），与下方的 bento 网格整齐对齐。
 * 收起时高度和下边距全部归零，完全不占页面位置，卸载不抖动。
 */
const EXPANDED = { height: "auto", opacity: 1, marginBottom: 12 };
const COLLAPSED = { height: 0, opacity: 0, marginBottom: 0 };

/**
 * 等「滑到顶」最多等这么久。
 *
 * 平滑滚动被用户自己的滚动打断时会就地停下，scrollY 永远到不了 0，没有这道
 * 时限卡片就再也不出现了。3000px 一趟实测 1.3s，留够余量。
 */
const SCROLL_TO_TOP_TIMEOUT_MS = 2000;

/**
 * 最顶部的版本更新卡片。
 *
 * 遵循整站技术图纸风格的硬边纸片（paper-card）与分段布局规范。
 * 平时完全收起隐藏，仅在检测到线上存在更新的生产部署时平滑展开。
 * 在开发环境下默认收起，并通过右下角 DevToggle 调试开关自由切换预览。
 */
export function AppVersionCard() {
  const { status, latestCommit, pageCommit, production, isDev } = useAppVersion();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // 开发环境调试覆盖：默认跟随真实状态（平时隐藏），可通过右下角调试开关随时展开/收起
  const [override, setOverride] = useState<boolean | null>(null);
  const reduced = useReducedMotion();

  // 生产环境看真实对比；开发环境允许通过 override 强制切换
  const isStale = status === "stale" && latestCommit !== dismissedFor;
  const visible = override !== null ? override : isStale;

  // 开发环境如果线上数据尚未抵达，使用代表性占位信息
  const displayLatestCommit =
    latestCommit ?? (isDev ? "5480b269a939558d1599c26310d2dfeb3d92294a" : null);
  const displayPageCommit =
    pageCommit ?? (isDev ? "452c6ce4599787f5ed76044e0fa7f1399dbb5506" : null);
  const commitMessage =
    production?.commit?.message ??
    (isDev ? "refactor(ui): 版本提示改用硬边直角面板，去除圆角与胶囊形态" : null);
  // 取整成 0s 的不显示：那不是「构建很快」，是这一版的 ready / buildingAt 还没齐
  const buildDuration =
    production?.buildDurationMs != null && production.buildDurationMs >= 1000
      ? `${(production.buildDurationMs / 1000).toFixed(0)}s`
      : isDev
        ? "32s"
        : null;

  /**
   * 卡片刚出现时把页面拉回顶部 —— **先滑到顶，到了顶再展开**，两件事不重叠。
   *
   * 它固定在最上面，而提示是异步来的，人多半正停在半页处看别的卡，不拉一把等于
   * 没提示。只在「这一轮刚出现」时滚一次：`visible` 一直为真的那些渲染不滚，
   * DISMISS 之后也不会因为别的状态更新又把人拽上去。
   *
   * 顺序是量出来的，不是排出来的。从前是「展开完再滚」，结果展开那 350ms 里页面
   * 一顿一顿：卡片从 height 0 长出来会逐帧改变上方内容的高度，浏览器的滚动锚定
   * 跟着逐帧回推 scrollTop —— 45 帧里有 20 帧在往回走、18 帧原地不动，然后才切到
   * 平滑滚动。（更早那版还想在同一 tick 里滚，那些回推会直接把刚起步的平滑滚动
   * 取消掉，scrollY 从 3000 飘到 3059 就不动了。）
   *
   * 反过来排就一干二净：滑的时候卡片还收着，文档高度不变，锚定没有可修正的东西，
   * 实测滚动那 1.3s 里 269 帧零回退、零掉帧；滑到顶了再展开，卡片上方什么都没有，
   * 长高也不会推动视口。
   *
   * 不传 `behavior`：默认值 `auto` 的含义是「按元素上 scroll-behavior 的计算值来」，
   * 而 globals.css 已经给 html 设了 smooth、并在 prefers-reduced-motion 里用
   * !important 关掉。写死 "smooth" 反而会绕开那条无障碍开关；降级动效下这一滚是
   * 瞬时的，下一帧就到顶，紧接着展开。
   */
  const wasVisible = useRef(false);
  const [atTop, setAtTop] = useState(false);
  useEffect(() => {
    const appeared = visible && !wasVisible.current;
    wasVisible.current = visible;

    let frame = 0;
    let timer = 0;
    // 三处放行都排进下一帧再 setState：在 effect 体里同步 setState 会被
    // react-hooks/set-state-in-effect 拦下，而且那本来也是一次白跑的级联渲染
    const settle = (value: boolean) => {
      frame = requestAnimationFrame(() => setAtTop(value));
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };

    if (!visible) {
      settle(false);
      return stop;
    }
    if (!appeared) return;
    if (window.scrollY <= 0) {
      settle(true);
      return stop;
    }

    // 到顶就放行。中途被用户自己的滚动打断时平滑滚动会就地停下、永远到不了 0，
    // 所以另有一道时限兜底：那种情况就在原地展开，晚一点也好过一直不出现
    const watch = () => {
      if (window.scrollY <= 0) return settle(true);
      frame = requestAnimationFrame(watch);
    };
    timer = window.setTimeout(() => settle(true), SCROLL_TO_TOP_TIMEOUT_MS);
    window.scrollTo({ top: 0 });
    frame = requestAnimationFrame(watch);
    return stop;
  }, [visible]);

  const handleDismiss = () => {
    if (isDev) {
      setOverride(false);
    } else if (latestCommit) {
      setDismissedFor(latestCommit);
    }
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {/* atTop：滑到顶之前先按住不展开，理由见上面那个 effect */}
        {visible && atTop && displayLatestCommit && (
          <motion.div
            key="app-version-card"
            initial={reduced ? false : COLLAPSED}
            animate={EXPANDED}
            exit={reduced ? undefined : COLLAPSED}
            transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
            // 抵消 paper-card 右下角的 3px 投影，确保收起动画时无残留像素
            className="-mr-[3px] overflow-hidden"
          >
            <div className="pb-[3px] pr-[3px]">
              <Card
                id="app-version-notice"
                label="UPDATE"
                action={
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
                    title="Dismiss update notice"
                  >
                    <span>DISMISS</span>
                    <X className="size-3" aria-hidden />
                  </button>
                }
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium">
                      <div className="flex items-center gap-1.5">
                        <StatusDot tone="idle" />
                        <span>新版本!</span>
                      </div>
                      <span className="label-mono rounded-sm border border-line bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {displayPageCommit ? `${displayPageCommit.slice(0, 7)} → ` : ""}
                        {displayLatestCommit.slice(0, 7)}
                      </span>
                      {buildDuration && (
                        <span className="label-mono text-[10px] text-muted-foreground">
                          · 构建 {buildDuration}
                        </span>
                      )}
                    </div>
                    {commitMessage && (
                      <div
                        className="mt-1.5 truncate font-mono text-xs text-foreground/80"
                        title={commitMessage}
                      >
                        {commitMessage}
                      </div>
                    )}
                  </div>

                  <div className="flex w-full shrink-0 items-center sm:w-auto sm:self-center">
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="paper-card inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90 sm:w-auto"
                    >
                      <RotateCw className="size-3" />
                      <span>立即刷新</span>
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 开发环境调试：像 Charger / Power Bank 一样在右下角提供单独的调试开关 */}
      {isDev && (
        <DevToggleSlot>
          <DevToggle
            label="Update"
            on={visible}
            title="开发环境调试：切换顶部更新卡片可见性"
            onClick={() => setOverride((prev) => (prev !== null ? !prev : !visible))}
          />
        </DevToggleSlot>
      )}
    </>
  );
}
