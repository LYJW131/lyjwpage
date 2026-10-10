"use client";

import { useReducedMotion } from "motion/react";

import { HeroMotionArtwork } from "@/components/live/hero-motion-artwork";
import { DIALOG_ARTWORK_PX } from "@/components/web-player/player-artwork";
import { useMotionArtwork } from "@/hooks/use-motion-artwork";
import { heldVideoUrl } from "@/lib/track-enrichment";
import type { ListeningItem } from "@/lib/types";

export function PlayerCover({ item }: { item: ListeningItem | null }) {
  const storedUrl = item?.motion?.videoUrl ?? null;
  const { data } = useMotionArtwork(storedUrl ? null : item?.link);
  const reduced = useReducedMotion();
  return (
    <HeroMotionArtwork
      artwork={item?.artwork ?? null}
      title={item?.title ?? ""}
      videoUrl={heldVideoUrl(item?.motion, data)}
      reduced={Boolean(reduced)}
      sizePx={DIALOG_ARTWORK_PX}
    />
  );
}
