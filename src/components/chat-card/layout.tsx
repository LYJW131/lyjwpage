"use client";

import { FadeInImage } from "@/components/fade-in-image";
import { createContext, useContext, type ReactNode } from "react";

import { COVER_PX as PLAYSTATION_COVER_PX } from "@/components/live/playstation-card";
import { StatusDot } from "@/components/ui/status-dot";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing, TRACK_ROW_ART_PX } from "@/lib/apple-artwork";
import { imageSourceFromInternalPath, optimizerImagePath } from "@/lib/image-proxy";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import { cn } from "@/lib/utils";

const TILE_PX = 80;
export const HERO_PX = 96;
const HERO_WIDE_PX = 128;
// 流式中新到的卡片里，条目按这个间隔依次淡入；八项约半秒排完。
const TILE_STAGGER_MS = 60;

export const Entering = createContext(false);

// 卡片按内容收缩，不铺满对话宽度；此刻卡的歌名专辑名可以很长，另设上限，超出就截断。
// 只有一排「最近」条目的卡片不带标题栏：条目排自己的小标题已经说明是什么。
export function Frame({ title, aside, compact = false, children }: { title?: string; aside?: ReactNode; compact?: boolean; children: ReactNode }) {
  return (
    <section className={cn("w-fit min-w-[min(100%,20rem)] overflow-hidden border border-line bg-surface", compact ? "max-w-[min(100%,32rem)]" : "max-w-full")}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="label-mono text-muted-foreground">{title}</span>
          {aside && <span className="label-mono min-w-0 truncate text-muted-foreground">{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Placeholder({ failed, children }: { failed: boolean; children?: ReactNode }) {
  return (
    <div className={cn("px-3 py-3 text-xs text-muted-foreground", !failed && !children && "animate-pulse")}>
      {failed ? "Couldn't load this right now." : (children ?? "Loading…")}
    </div>
  );
}

export function Idle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-3">
      <StatusDot tone="off" />
      <span className="label-mono text-muted-foreground">{children}</span>
    </div>
  );
}

// 封面先垫一张模糊的低清图（首页同尺寸的图或几十像素的小图，多半已在缓存或很快到），高清图加载完再淡入盖上。
// progress 把封面外框从左上角起顺时针逐段换成绿色，换了多长就是看了多少；不另占一行，有进度和没进度的条目文字对得齐。
export function Thumb({ src, preview, progress, platinum = false, optimize = false, wide = false, poster = false, px = wide ? HERO_WIDE_PX : TILE_PX }: { src: string | null; preview?: string | null; progress?: number | null; platinum?: boolean; optimize?: boolean; wide?: boolean; poster?: boolean; px?: number }) {
  return (
    <div
      title={platinum ? "Platinum earned" : undefined}
      className={cn(
        "relative shrink-0 bg-muted",
        platinum ? "platinum-frame" : "border border-line",
        poster ? "aspect-[2/3] w-full" : wide ? "aspect-video w-32" : "aspect-square w-full",
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        {preview && preview !== src && <FadeInImage src={preview} alt="" aria-hidden fill sizes={`${px}px`} className="scale-110 object-cover blur-md" unoptimized />}
        {src && <FadeInImage src={src} alt="" fill sizes={`${px}px`} className="object-cover" unoptimized={!optimize} />}
      </div>
      {/* 描边层铺满外框所在的盒子，2px 描边以盒子边缘为中线、外侧一半被 svg 自身裁掉，只剩正好压住 1px 外框的那一半：外框本身逐段变色，宽度不变。 */}
      {progress != null && progress > 0 && (
        <div aria-hidden className="pointer-events-none absolute -inset-px">
          <svg className="size-full text-signal-green">
            <rect width="100%" height="100%" pathLength={100} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={`${Math.min(100, progress)} 100`} />
          </svg>
        </div>
      )}
    </div>
  );
}

export function Hero({
  image,
  tone,
  status,
  title,
  subtitle,
  href,
  progress,
  meta,
}: {
  image: ReactNode;
  tone: "live" | "idle" | "off";
  status: string;
  title: string;
  subtitle?: string | null;
  href?: string | null;
  progress?: number | null;
  meta?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {image}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <StatusDot tone={tone} />
          <span className={cn("label-mono", tone === "live" ? "text-live-ink" : "text-muted-foreground")}>{status}</span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        <ProgressBar percent={progress} className="mt-2 h-1" />
        {meta && <div className="mt-1 font-mono text-2xs tabular-nums text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

function ProgressBar({ percent, className }: { percent?: number | null; className: string }) {
  if (percent == null) return null;
  return (
    <div className={cn(className, "overflow-hidden bg-muted")}>
      <div className="h-full bg-foreground/60" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-2 first:border-t-0 [header+&]:border-t-0">
      <div className="label-mono px-3 text-muted-foreground">{label}</div>
      <ul className="scrollbar-none flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-3 pt-2 [&::-webkit-scrollbar]:hidden">
        {children}
      </ul>
    </div>
  );
}

export function Tile({ index, href, image, title, subtitle }: { index: number; href?: string | null; image: ReactNode; title: string; subtitle?: string | null }) {
  const entering = useContext(Entering);
  const body = (
    <>
      {image}
      <div className="mt-1.5 truncate text-2xs leading-tight">{title}</div>
      {subtitle && <div className="truncate text-2xs leading-tight text-muted-foreground">{subtitle}</div>}
    </>
  );
  return (
    <li className={cn("w-20 shrink-0 snap-start", entering && "animate-headline-in")} style={entering ? { animationDelay: `${index * TILE_STAGGER_MS}ms` } : undefined}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" title={title} className="block hover:opacity-80">
          {body}
        </a>
      ) : (
        <div title={title}>{body}</div>
      )}
    </li>
  );
}

export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function artwork(url: string | null | undefined, px = TILE_PX) {
  if (!url) return { src: null };
  const optimize = needsOptimizing(url);
  return { src: appleArtwork(url, px * ARTWORK_SCALE), preview: optimize ? null : appleArtwork(url, TRACK_ROW_ART_PX * ARTWORK_SCALE), px, optimize };
}

// R2 里的海报经图片变体出小图，不拉原图；变体按内容哈希永久缓存。
const POSTER_WIDTH = 240;
const PREVIEW_WIDTH = 32;

export function posterImage(url: string | null | undefined) {
  if (!url || !imageSourceFromInternalPath(url)) return { src: url ?? null };
  return { src: optimizerImagePath(url, POSTER_WIDTH, 75), preview: optimizerImagePath(url, PREVIEW_WIDTH, 50) };
}

// 首页游戏卡同尺寸的封面多半已在缓存；比对话里的格子大，直接当正式图用。
export function gameCover(url: string | null | undefined) {
  return { src: playstationImage(url, PLAYSTATION_COVER_PX * PLAYSTATION_IMAGE_SCALE), preview: playstationImage(url, PREVIEW_WIDTH) };
}
