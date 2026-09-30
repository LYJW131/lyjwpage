"use client";

import NextImage, { type ImageProps } from "next/image";
import { useSyncExternalStore } from "react";

import { isRestReady, resolveImageLoading, subscribeRestReady } from "@/lib/rest-ready";

function subscribeNothing(): () => void {
  return () => {};
}

function notReady(): boolean {
  return false;
}

export default function AppImage({ loading, priority, ...rest }: ImageProps) {
  const fixed = Boolean(priority) || loading === "eager";
  const restReady = useSyncExternalStore(
    fixed ? subscribeNothing : subscribeRestReady,
    fixed ? notReady : isRestReady,
    notReady,
  );
  const resolved = resolveImageLoading(restReady, loading, priority);
  return <NextImage {...rest} {...resolved} {...(priority ? { priority: true } : {})} />;
}
