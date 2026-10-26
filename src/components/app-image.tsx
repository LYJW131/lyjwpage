"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

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
  onError,
  onLoad,
  ...rest
}: ImageProps) {
  const [failed, setFailed] = useState({ src, count: 0 });
  const failures = failed.src === src ? failed.count : 0;
  const imgRef = useRef<HTMLImageElement>(null);
  // SSR 出的图可能在水合前就加载失败，React 不重放那次 error 事件，挂载时补查一次。
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0 && img.currentSrc) setFailed((prev) => (prev.src === src && prev.count > 0 ? prev : { src, count: 1 }));
  }, [src]);
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
  // 访客网络连不上第三方图床时，直连图改走一次站点代理；代理也失败就藏起图，露出容器底色而不是 alt 文字。
  const proxyFallback =
    !optimizable && !inline && parseImageSource(src) !== null
      ? optimizerImagePath(src, numericWidth === undefined ? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1] : imageWidthBucket(numericWidth * 2), q)
      : null;
  const retrying = failures > 0 && proxyFallback !== null;
  const hidden = failures > (proxyFallback === null ? 0 : 1);

  return (
    <img
      {...rest}
      ref={imgRef}
      src={retrying ? proxyFallback : optimizedSrc}
      srcSet={!retrying && optimizable && displayWidth !== undefined ? optimizerSrcSet(src, q, displayWidth) : undefined}
      onLoad={(event) => {
        if (failed.src !== src || failures > 1) setFailed({ src, count: Math.min(failures, 1) });
        onLoad?.(event);
      }}
      onError={(event) => {
        setFailed({ src, count: failures + 1 });
        onError?.(event);
      }}
      alt={alt ?? ""}
      width={width}
      loading={priority || inline ? undefined : (resolved.loading ?? "lazy")}
      decoding={decoding ?? "async"}
      fetchPriority={fetchPriority ?? (priority ? "high" : noPreload ? "low" : undefined)}
      style={hidden ? { ...(fill ? FILL_STYLE : null), ...style, visibility: "hidden" } : fill ? { ...FILL_STYLE, ...style } : style}
    />
  );
}
