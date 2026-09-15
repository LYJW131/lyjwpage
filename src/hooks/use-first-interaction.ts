"use client";

import { useEffect, useState } from "react";

/** 任何一种「人来了」的信号，先到的算。滚动挂在 window 上，其余冒泡到 document。 */
const SIGNALS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * 「这个页面前面真的坐了个人」的闸门：第一次交互之后翻成 true，此后不再变。
 *
 * 给**只有动过手才用得上**的预热用 —— 比如播放器的封面：那个弹窗要点一下才开，
 * 没点过的访客一张都用不上。挂在首屏里拉，既占带宽又占解码，而且一个从头到尾
 * 没碰过页面的访客（含各种抓取和跑分）为此全额买单。挪到第一次交互后面，
 * 该预热的照样在弹窗出现之前就位，没交互的人一个字节都不花。
 *
 * 用 passive 监听，且只认一次：不给滚动加任何额外开销。
 */
export function useFirstInteraction(): boolean {
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (interacted) return;
    const fire = () => setInteracted(true);
    const options = { passive: true, once: true } as const;
    for (const signal of SIGNALS) {
      const target = signal === "scroll" ? window : document;
      target.addEventListener(signal, fire, options);
    }
    return () => {
      for (const signal of SIGNALS) {
        const target = signal === "scroll" ? window : document;
        target.removeEventListener(signal, fire);
      }
    };
  }, [interacted]);

  return interacted;
}
