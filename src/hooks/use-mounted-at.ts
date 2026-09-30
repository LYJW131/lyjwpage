"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

// SSR 与水合首帧不能各读本机时钟，否则时间派生内容不一致。
export function useMountedAt(): number {
  const at = useRef(0);

  const subscribe = useCallback(() => {
    if (!at.current) at.current = Date.now();
    return () => {};
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => at.current,
    () => 0,
  );
}
