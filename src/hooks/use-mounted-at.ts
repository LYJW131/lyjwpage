"use client";

import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";

const subscribe = () => () => {};

// 只给不水合的一次性渲染（README 卡片）用：服务端首帧直接取出图时刻，配速、倒计时这类按时刻算的内容随图烧进去。
export const RenderClock = createContext(0);

// SSR 与水合首帧不能各读本机时钟，否则时间派生内容不一致；水合后挂载的组件没有服务端首帧要对齐，
// 首帧就取时刻：若等订阅后再取，进度和歌词会先按锚点画一帧再跳到此刻。
export function useMountedAt(): number {
  const renderClock = useContext(RenderClock);
  const at = useRef(0);
  const read = useCallback(() => {
    if (!at.current) at.current = Date.now();
    return at.current;
  }, []);

  return useSyncExternalStore(subscribe, read, () => renderClock);
}

// 只问「是否已在浏览器挂载」，不受 RenderClock 影响：出图那次仍按服务端首帧裁剪。
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
