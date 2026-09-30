"use client";

import { Fragment, type CSSProperties } from "react";

import Image from "@/components/app-image";
import { useFirstInteraction } from "@/hooks/use-first-interaction";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import { cn } from "@/lib/utils";

export const DIALOG_ARTWORK_PX = 96;
export const MINI_ARTWORK_PX = 24;

// 预载与展示须共用 Image 参数，最终 srcset 地址不同就无法命中缓存。
export function PlayerArtwork({
  artwork,
  size,
  className,
  style,
  eager = false,
}: {
  artwork: string | null;
  size: number;
  className?: string;
  style?: CSSProperties;
  eager?: boolean;
}) {
  const src = appleArtwork(artwork, size * ARTWORK_SCALE);
  const defaultSizeStyle = className?.includes("size-") ? undefined : { width: size, height: size };
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-muted", className)}
      style={{ ...defaultSizeStyle, ...style }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
          unoptimized={!needsOptimizing(artwork)}
          loading={eager ? "eager" : undefined}
          fetchPriority={eager ? "low" : undefined}
        />
      ) : null}
    </div>
  );
}

export function PlayerArtworkPreload({ artworks }: { artworks: string[] }) {
  const interacted = useFirstInteraction();
  if (!interacted || artworks.length === 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed -left-[9999px] top-0 size-px overflow-hidden"
    >
      {artworks.map((artwork) => (
        <Fragment key={artwork}>
          <PlayerArtwork artwork={artwork} size={DIALOG_ARTWORK_PX} eager />
          <PlayerArtwork artwork={artwork} size={MINI_ARTWORK_PX} eager />
        </Fragment>
      ))}
    </div>
  );
}
