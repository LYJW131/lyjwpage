"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { DevToggle, DevToggleSlot } from "@/components/dev-toggles";
import { useAppVersion } from "@/hooks/use-app-version";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";

const EXPANDED = { height: "auto", opacity: 1, marginBottom: 12 };
const COLLAPSED = { height: 0, opacity: 0, marginBottom: 0 };

// 用户打断平滑滚动后 scrollY 可能永远不到 0，必须有超时放行。
const SCROLL_TO_TOP_TIMEOUT_MS = 2000;

export function AppVersionCard() {
  const { status, latestCommit, pageCommit, message, buildDurationMs, isDev } = useAppVersion();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [override, setOverride] = useState<boolean | null>(null);
  const reduced = useReducedMotion();

  const isStale = status === "stale" && latestCommit !== dismissedFor;
  const visible = override !== null ? override : isStale;

  const displayLatestCommit =
    latestCommit ?? (isDev ? "5480b269a939558d1599c26310d2dfeb3d92294a" : null);
  const displayPageCommit =
    pageCommit ?? (isDev ? "452c6ce4599787f5ed76044e0fa7f1399dbb5506" : null);
  const commitMessage =
    message ??
    (isDev ? "refactor(ui): 版本提示改用硬边直角面板，去除圆角与胶囊形态" : null);
  const buildDuration =
    buildDurationMs != null && buildDurationMs >= 1000
      ? `${(buildDurationMs / 1000).toFixed(0)}s`
      : isDev
        ? "32s"
        : null;

  // 先滚到顶再展开，避免滚动锚定抵消或取消平滑滚动。
  // 不写死 behavior: smooth，以保留 CSS 的 prefers-reduced-motion 设置。
  const wasVisible = useRef(false);
  const [atTop, setAtTop] = useState(false);
  useEffect(() => {
    const appeared = visible && !wasVisible.current;
    wasVisible.current = visible;

    let frame = 0;
    let timer = 0;
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
        {visible && atTop && displayLatestCommit && (
          <motion.div
            key="app-version-card"
            initial={reduced ? false : COLLAPSED}
            animate={EXPANDED}
            exit={reduced ? undefined : COLLAPSED}
            transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
            // 裁切范围包含 paper-card 的投影，避免收起后残留像素。
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
                        <span>New version</span>
                      </div>
                      <span className="label-mono rounded-sm border border-line bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {displayPageCommit ? `${displayPageCommit.slice(0, 7)} → ` : ""}
                        {displayLatestCommit.slice(0, 7)}
                      </span>
                      {buildDuration && (
                        <span className="label-mono text-[10px] text-muted-foreground">
                          <span className="max-sm:hidden">· </span>built in {buildDuration}
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
                      <span>Reload</span>
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
