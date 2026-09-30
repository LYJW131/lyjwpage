"use client";

import { useEffect } from "react";

import { markRestReady } from "@/lib/rest-ready";

export const OFFSCREEN_REVEALED_CLASS = "offscreen-revealed";

// 先撤掉 content-visibility 再切 eager，跳过渲染的子树可能丢失加载请求。
export function RestReady() {
  useEffect(() => {
    let frame = 0;
    let cancelled = false;

    const reveal = () => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        document.documentElement.classList.add(OFFSCREEN_REVEALED_CLASS);
        void document.documentElement.offsetHeight;
        markRestReady();
      });
    };

    if (document.readyState === "complete") reveal();
    else window.addEventListener("load", reveal, { once: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("load", reveal);
    };
  }, []);

  return null;
}
