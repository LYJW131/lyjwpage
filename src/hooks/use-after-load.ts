"use client";

import { useEffect, useState } from "react";

/** requestIdleCallback 在 Safari 上还没有，退回一小段延时。 */
const IDLE_FALLBACK_MS = 200;

/**
 * 「首屏那阵忙完了」的闸门：`load` 之后再等一次空闲，才翻成 true。
 *
 * 给**用户还没要、但迟早要**的活儿用 —— 提前拉播放器封面这类。它们自己再怎么
 * 标低优先级，也还是在首屏那段里多占几条连接、多几次解码；挪到这道闸门后面，
 * 首屏的取数、渲染和主线程一点都不分给它们，而用户真去点的时候东西早就到了。
 *
 * 挂载时页面已经 load 完（客户端路由进来的、或者水合得晚）就只等那次空闲。
 */
export function useAfterLoad(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let idle: number | undefined;
    const schedule = () => {
      const run = () => setReady(true);
      idle = typeof requestIdleCallback === "function"
        ? requestIdleCallback(run, { timeout: 2_000 })
        : window.setTimeout(run, IDLE_FALLBACK_MS);
    };
    if (document.readyState === "complete") {
      schedule();
      return () => cancel(idle);
    }
    window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      cancel(idle);
    };
  }, []);

  return ready;
}

function cancel(handle: number | undefined) {
  if (handle === undefined) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}
