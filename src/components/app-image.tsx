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

/**
 * 全站图片的入口。首屏期间行为和 next/image 一致；`RestReady` 标记首屏 load
 * 完成之后，还在 lazy 的图改成立刻加载。已经 eager / priority 的不订阅这次
 * 翻转，避免 LCP 那张跟着再渲染一遍。
 */
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
