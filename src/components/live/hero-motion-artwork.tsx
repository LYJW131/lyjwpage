"use client";

import type { Level } from "hls.js";
import { useEffect, useRef, useState } from "react";

import Image from "@/components/app-image";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import type { ArtworkDataUri } from "@/lib/artwork-placeholder";
import { cn } from "@/lib/utils";

// ABR 只看带宽，会为小封面拉最高档并放大下采样锯齿，按显示尺寸锁定档位。
function smallestAdequateLevel(levels: Level[], video: HTMLVideoElement): number {
  if (!levels.length) return -1;

  const dpr = window.devicePixelRatio || 1;
  const box = Math.round(video.getBoundingClientRect().width) || 80;
  const target = box * dpr;

  const bySize = levels
    .map((level, index) => ({ index, width: level.width, bitrate: level.bitrate }))
    .sort((a, b) => a.width - b.width || a.bitrate - b.bitrate);

  return (bySize.find((level) => level.width >= target) ?? bySize[bySize.length - 1])
    .index;
}

export function HeroMotionArtwork({
  artwork,
  title,
  videoUrl,
  placeholder,
  reduced = false,
  sizePx = 80,
}: {
  artwork: string | null;
  title: string;
  videoUrl: string | null | undefined;
  placeholder?: ArtworkDataUri;
  reduced?: boolean;
  sizePx?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || reduced) return;

    let unmounted = false;
    let hls: { destroy: () => void } | null = null;
    let fellBack = false;
    let frameHandle = 0;

    setIsPlaying(false);
    video.muted = true;
    video.defaultMuted = true;

    const startHls = async () => {
      if (fellBack) return;
      fellBack = true;

      const { default: Hls } = await import("hls.js");
      if (unmounted || !Hls.isSupported()) return;

      video.removeAttribute("src");
      video.load();

      const instance = new Hls({
        autoStartLoad: false,
        maxBufferLength: 10,
        enableWorker: true,
      });
      hls = instance;

      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            instance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            instance.recoverMediaError();
            break;
          default:
            instance.destroy();
            break;
        }
      });
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (unmounted) return;
        const level = smallestAdequateLevel(instance.levels, video);
        if (level >= 0) {
          instance.startLevel = level;
          instance.currentLevel = level;
        }
        instance.startLoad();
        video.play().catch(() => {});
      });

      instance.loadSource(videoUrl);
      instance.attachMedia(video);
      awaitFirstFrame();
    };

    /* Safari 的 playing 早于首帧合成；必须等 rVFC 再淡入，避免静态封面突然切帧。 */
    const reveal = () => {
      if (!unmounted) setIsPlaying(true);
    };

    const awaitFirstFrame = () => {
      if (!("requestVideoFrameCallback" in video)) return;
      if (frameHandle) video.cancelVideoFrameCallback(frameHandle);
      frameHandle = video.requestVideoFrameCallback(() => {
        frameHandle = 0;
        reveal();
      });
    };

    const onTimeUpdate = () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      reveal();
    };

    const onError = () => {
      setIsPlaying(false);
      void startHls();
    };
    // Safari 的 VOD 流偶尔不遵守 loop。
    const onEnded = () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("error", onError);
    video.addEventListener("ended", onEnded);
    awaitFirstFrame();

    /* Chromium 对 HLS 可返回 canPlayType=maybe 却无法播放，须按实际 error 切到 hls.js。 */
    video.src = videoUrl;
    video.play().catch(() => {});

    return () => {
      unmounted = true;
      if (frameHandle) video.cancelVideoFrameCallback(frameHandle);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onError);
      video.removeEventListener("ended", onEnded);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl, reduced]);

  return (
    <div
      className="relative aspect-square shrink-0 overflow-hidden rounded-md border border-line bg-muted"
      style={{ width: sizePx }}
      onMouseEnter={() => {
        // Safari 低电量模式等拒绝自动播放时不触发 error，仍需手动入口。
        if (videoRef.current && videoUrl && !reduced) {
          videoRef.current.play().catch(() => {});
        }
      }}
    >
      <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]">
        {/* CSS placeholder 无法指定 decoding，水合期可能闪空；独立内联图可同步解码。 */}
        {placeholder && (
          <Image
            src={placeholder}
            alt=""
            aria-hidden
            fill
            sizes={`${sizePx}px`}
            className="object-cover"
            decoding="sync"
          />
        )}
        {artwork && (
          <Image
            src={appleArtwork(artwork, sizePx * ARTWORK_SCALE)!}
            alt={`${title} artwork`}
            fill
            sizes={`${sizePx}px`}
            priority
            className="object-cover"
            unoptimized={!needsOptimizing(artwork)}
          />
        )}

        {videoUrl && !reduced && (
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden
            /* Safari 会为空 video 绘制问号占位，poster 必须与底下的静态图一致。 */
            poster={artwork ? (appleArtwork(artwork, sizePx * ARTWORK_SCALE) ?? undefined) : undefined}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-[1.2s] ease-[cubic-bezier(0.45,0,0.55,1)]",
              isPlaying ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
        )}
      </div>
    </div>
  );
}
