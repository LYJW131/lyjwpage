"use client";

import { useEffect } from "react";

import { markRestReady } from "@/lib/rest-ready";

export const OFFSCREEN_REVEALED_CLASS = "offscreen-revealed";
const OFFSCREEN_REVEALED_ATTR = "data-offscreen-revealed";
const DEFERRED_SELECTOR = ".defer-offscreen, .defer-offscreen-always";

function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

// 先撤掉 content-visibility 再切 eager，跳过渲染的子树可能丢失加载请求。
// 每帧只撤一块：一次撤完会把所有屏外卡片挤进同一帧排版，形成长帧。
// 最后仍给 html 加类，覆盖之后才挂载的卡片。
export function RestReady() {
  useEffect(() => {
    let cancel = () => {};

    const step = (reveals: (() => void)[]) => {
      const reveal = reveals.shift();
      if (!reveal) {
        markRestReady();
        return;
      }
      reveal();
      const frame = requestAnimationFrame(() => {
        cancel = whenIdle(() => step(reveals));
      });
      cancel = () => cancelAnimationFrame(frame);
    };

    const start = () => {
      const reveals = Array.from(document.querySelectorAll(DEFERRED_SELECTOR), (element) => () => {
        element.setAttribute(OFFSCREEN_REVEALED_ATTR, "");
      });
      reveals.push(() => document.documentElement.classList.add(OFFSCREEN_REVEALED_CLASS));
      cancel = whenIdle(() => step(reveals));
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
