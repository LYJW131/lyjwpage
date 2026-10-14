"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const subscribe = () => () => {};

// SSR 与水合首帧不能各读本机时钟，否则时间派生内容不一致；水合后挂载的组件没有服务端首帧要对齐，
// 首帧就取时刻：若等订阅后再取，进度和歌词会先按锚点画一帧再跳到此刻。
export function useMountedAt(): number {
  const at = useRef(0);
  const read = useCallback(() => {
    if (!at.current) at.current = Date.now();
    return at.current;
  }, []);

  return useSyncExternalStore(subscribe, read, () => 0);
}
