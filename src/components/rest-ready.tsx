"use client";

import { useEffect } from "react";

import { markRestReady } from "@/lib/rest-ready";

/** 和 globals.css 里 `html.offscreen-revealed` 是同一个标记。 */
export const OFFSCREEN_REVEALED_CLASS = "offscreen-revealed";

/**
 * 首屏资源 load 完就揭开剩下的块。
 *
 * `content-visibility: auto` 只负责首屏那一轮排版。load 之后把标记打到 html 上，
 * 样式把这些块收回 visible；紧接着再翻图片的 eager。顺序不能反：子树还被跳过
 * 渲染时，浏览器可能直接丢掉这一次加载，滚到跟前也不会补。
 */
export function RestReady() {
  useEffect(() => {
    let frame = 0;
    let cancelled = false;

    const reveal = () => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        document.documentElement.classList.add(OFFSCREEN_REVEALED_CLASS);
        // 先把 content-visibility 刷成 visible，再让图片改 eager。
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
