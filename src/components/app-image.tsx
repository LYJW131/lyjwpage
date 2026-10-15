"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

import {
  IMAGE_WIDTHS,
  displayWidthFromSizes,
  imageWidthBucket,
  optimizerImagePath,
  optimizerSrcSet,
  parseImageSource,
} from "@/lib/image-proxy";
import { isRestReady, resolveImageLoading, subscribeRestReady } from "@/lib/rest-ready";

export type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  // React SSR 会把非 lazy、非 low 的 <img> 提成 <head> 里排在样式表前的 preload；首屏外的 eager 图跟样式表抢带宽会推迟首帧。
  noPreload?: boolean;
  unoptimized?: boolean;
  quality?: number;
};

function subscribeNothing(): () => void {
  return () => {};
}

function notReady(): boolean {
  return false;
}

const FILL_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

export default function AppImage({
  src,
  fill,
  priority,
  noPreload,
  unoptimized,
  quality,
  loading,
  style,
  alt,
  sizes,
  width,
  decoding,
  fetchPriority,
  ...rest
}: ImageProps) {
  // WebKit 对 lazy 图（data URI 也一样）先挂可见性观察，回调在首帧绘制之后，内联图首帧必空。
  const inline = src.startsWith("data:");
  const fixed = Boolean(priority) || inline || loading === "eager";
  const restReady = useSyncExternalStore(
    fixed ? subscribeNothing : subscribeRestReady,
    fixed ? notReady : isRestReady,
    notReady,
  );
  const resolved = resolveImageLoading(restReady, loading, priority);

  const q = quality ?? 75;
  const optimizable = !unoptimized && parseImageSource(src) !== null;
  const numericWidth = typeof width === "number" && Number.isFinite(width) ? width : undefined;
  const displayWidth = numericWidth ?? displayWidthFromSizes(sizes);
  const optimizedSrc = optimizable
    ? optimizerImagePath(
        src,
        displayWidth === undefined ? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1] : imageWidthBucket(displayWidth),
        q,
      )
    : src;

  return (
    <img
      {...rest}
      src={optimizedSrc}
      srcSet={optimizable && displayWidth !== undefined ? optimizerSrcSet(src, q, displayWidth) : undefined}
      alt={alt ?? ""}
      width={width}
      loading={priority || inline ? undefined : (resolved.loading ?? "lazy")}
      decoding={decoding ?? "async"}
      fetchPriority={fetchPriority ?? (priority ? "high" : noPreload ? "low" : undefined)}
      style={fill ? { ...FILL_STYLE, ...style } : style}
    />
  );
}
