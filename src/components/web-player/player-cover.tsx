"use client";

import { useReducedMotion } from "motion/react";

import { HeroMotionArtwork } from "@/components/live/hero-motion-artwork";
import { DIALOG_ARTWORK_PX } from "@/components/web-player/player-artwork";
import { useMotionArtwork } from "@/hooks/use-motion-artwork";
import type { ListeningItem } from "@/lib/types";

export function PlayerCover({ item }: { item: ListeningItem | null }) {
  const { data } = useMotionArtwork(item?.link);
  const reduced = useReducedMotion();
  return (
    <HeroMotionArtwork
      artwork={item?.artworkUrl ?? null}
      title={item?.title ?? ""}
      videoUrl={data?.hasMotion ? data.videoUrl : null}
      reduced={Boolean(reduced)}
      sizePx={DIALOG_ARTWORK_PX}
    />
  );
}
