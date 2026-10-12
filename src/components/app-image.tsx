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
  const fixed = Boolean(priority) || loading === "eager";
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
      loading={priority ? undefined : (resolved.loading ?? "lazy")}
      decoding={decoding ?? "async"}
      fetchPriority={fetchPriority ?? (priority ? "high" : undefined)}
      style={fill ? { ...FILL_STYLE, ...style } : style}
    />
  );
}
