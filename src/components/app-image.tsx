"use client";

import type { CSSProperties } from "react";

import {
  IMAGE_WIDTHS,
  displayWidthFromSizes,
  imageWidthBucket,
  optimizerImagePath,
  optimizerSrcSet,
  parseImageSource,
} from "@/lib/image-proxy";

export type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  // React SSR 会把非 lazy、非 low 的 <img> 提成 <head> 里排在样式表前的 preload；首屏外的 eager 图跟样式表抢带宽会推迟首帧。
  noPreload?: boolean;
  unoptimized?: boolean;
  quality?: number;
};

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
  srcSet,
  ...rest
}: ImageProps) {
  // WebKit 对 lazy 图（data URI 也一样）先挂可见性观察，回调在首帧绘制之后，内联图首帧必空。
  const inline = src.startsWith("data:");
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
      srcSet={optimizable && displayWidth !== undefined ? optimizerSrcSet(src, q, displayWidth) : srcSet}
      alt={alt ?? ""}
      width={width}
      loading={priority || inline ? undefined : (loading ?? "lazy")}
      decoding={decoding ?? "async"}
      fetchPriority={fetchPriority ?? (priority ? "high" : noPreload ? "low" : undefined)}
      style={fill ? { ...FILL_STYLE, ...style } : style}
    />
  );
}
