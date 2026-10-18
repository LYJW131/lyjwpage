"use client";

import { useState } from "react";

import Image, { type ImageProps } from "@/components/app-image";
import { cn } from "@/lib/utils";

// 对话里的封面在灰底占位上等加载完再淡入，不从空白一下子蹦出来；加载失败就留着灰底。
export function FadeInImage({ className, onLoad, ...props }: ImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Image
      {...props}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      className={cn("transition-opacity duration-300 ease-out", loaded ? "opacity-100" : "opacity-0", className)}
    />
  );
}
