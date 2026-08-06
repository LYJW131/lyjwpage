"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import type { ActivityPayload, DesktopActivity, LocalNowPlaying } from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 3_000;

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

function formatClock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function effectivePosition(track: LocalNowPlaying, now: number) {
  const drift = track.state === "playing" ? Math.max(0, now - track.observedAt) : 0;
  return Math.min(track.durationMs, track.positionMs + drift);
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn("w-[3px] rounded-full bg-live", !active && "h-1.5 opacity-50")}
          style={
            active
              ? {
                  height: "100%",
                  animation: `equalizer ${0.8 + index * 0.18}s ease-in-out ${index * 0.12}s infinite`,
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

export function LiveDeskCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ActivityPayload>(
    "/api/status/activity",
    REFRESH_MS,
  );
  const [now, setNow] = useState(0);
  const [displayedDesktop, setDisplayedDesktop] = useState<DesktopActivity | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const offline = Boolean(error || data?.stale);
  const desktopOffline = Boolean(error || data?.desktopStale);
  const musicOffline = Boolean(error || data?.musicStale);
  const incomingDesktop = data?.desktop ?? null;

  useEffect(() => {
    if (desktopOffline || !incomingDesktop) return;

    const sameApplication =
      displayedDesktop?.bundleIdentifier === incomingDesktop.bundleIdentifier &&
      displayedDesktop?.applicationName === incomingDesktop.applicationName;
    if (sameApplication && displayedDesktop?.iconUrl === incomingDesktop.iconUrl) return;

    // 新应用没有图标时保留旧状态；Mac 推送器补齐图标后再整体切换。
    if (!incomingDesktop.iconUrl) return;

    let cancelled = false;
    const preload = new window.Image();
    preload.decoding = "async";

    const commit = async () => {
      try {
        await preload.decode();
      } catch {
        // 某些浏览器在 onload 后仍不支持 decode；naturalWidth 足以证明可绘制。
      }
      if (!cancelled && preload.naturalWidth > 0) {
        setDisplayedDesktop(incomingDesktop);
      }
    };

    preload.onload = () => void commit();
    // 下载或解码失败时不切换，避免新状态出现空图标。
    preload.src = incomingDesktop.iconUrl;
    if (preload.complete && preload.naturalWidth > 0) void commit();

    return () => {
      cancelled = true;
      preload.onload = null;
    };
  }, [
    displayedDesktop,
    incomingDesktop,
    desktopOffline,
  ]);

  const music = data?.music;
  const playing = Boolean(!musicOffline && music?.state === "playing" && music.title);
  const musicSource = music?.source === "homepod" ? "HomePod mini" : "MacBook Pro";
  const position = music ? effectivePosition(music, now) : 0;
  const progress = music?.durationMs ? (position / music.durationMs) * 100 : 0;
  const desktop = displayedDesktop;
  // 只在前台应用真正切换时播放动效；窗口标题变化不会反复触发。
  const applicationKey = desktopOffline
    ? "offline"
    : desktop?.bundleIdentifier ?? desktop?.applicationName ?? "idle";

  return (
    <Card
      label="Live Desk"
      tone={offline ? "off" : data ? "live" : "idle"}
      action={offline ? "离线" : data ? "在线" : "等待上报"}
      className={cn("md:col-span-2", className)}
    >
      <div className="grid gap-4 px-4 pb-4 pt-3 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.6fr)]">
        <div className="rounded-md border border-line bg-background/40 p-4">
          {!musicOffline && music?.title && music.state !== "stopped" ? (
            <>
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted">
                  {music.artworkUrl ? (
                    <Image
                      src={music.artworkUrl}
                      alt={`${music.title} 封面`}
                      fill
                      sizes="48px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <Equalizer active={playing} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={music.title ?? undefined}>
                    {music.title}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[music.artist, music.album].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {musicSource} · {playing ? "正在播放" : "已暂停"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-live transition-[width] duration-700"
                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                  />
                </div>
                <span className="label-mono min-w-20 text-right text-muted-foreground">
                  {formatClock(position)} / {formatClock(music.durationMs)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex min-h-20 items-center text-sm text-muted-foreground">
              {isLoading ? "正在读取播放状态…" : "当前没有播放"}
            </div>
          )}
        </div>

        <div className="flex min-h-28 flex-col justify-center rounded-md border border-line bg-background/40 p-4">
          <div className="label-mono text-muted-foreground">正在使用</div>
          <div className="relative mt-2 min-h-10 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={applicationKey}
                variants={reduced ? STATIC_VARIANTS : APP_SWITCH_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={reduced ? STATIC_TRANSITION : APP_SWITCH_TRANSITION}
                className="relative flex w-full min-w-0 origin-left items-center gap-3 overflow-hidden rounded-md"
              >
                <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden">
                  {desktop?.iconUrl && !desktopOffline ? (
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
                    {desktopOffline ? "—" : desktop?.applicationName ?? "暂无活动"}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
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
    </Card>
  );
}
