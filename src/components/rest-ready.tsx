"use client";

import { useEffect } from "react";

import { markRestReady } from "@/lib/rest-ready";

function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

// 屏外卡片保持 content-visibility: auto：撤掉后它们会在首屏之后逐块排版、图和文字分别补进来，首屏视觉进度被拖慢。
export function RestReady() {
  useEffect(() => {
    let cancel: () => void = () => {};

    const start = () => {
      cancel = whenIdle(markRestReady);
    };

    if (document.readyState === "complete") start();
    else {
      window.addEventListener("load", start, { once: true });
      cancel = () => window.removeEventListener("load", start);
    }

    return () => cancel();
  }, []);

  return null;
}
