"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * 挂载那一刻的时间戳（毫秒）；服务端预渲染和 hydrate 那一遍都是 0。
 *
 * Client Component 的首屏一样要在服务端画一遍，而服务端那一刻的钟和访客
 * hydrate 那一刻的钟对不上 —— 凡是由「当下」推出来的东西（钟面、播放进度、
 * 倒计时）首帧都不能画，否则必然是一次水合不一致。给页面喂了服务端数据之后
 * 这些分支才真的会在首屏渲染，所以这件事变成了硬性要求。
 *
 * 用法是 `const now = ticked || mountedAt`：挂载时先拿到一个真时刻，之后由各自
 * 的计时器往前推。
 *
 * 走 useSyncExternalStore 而不是 useState + useEffect：时钟本来就是外部数据源，
 * getServerSnapshot 正好表达「首帧没有时间」；在 effect 里同步 setState 会多一
 * 轮渲染，react-hooks/set-state-in-effect 也不许那么写。
 */
export function useMountedAt(): number {
  const at = useRef(0);

  // subscribe 跑在提交之后。这里没有真要订阅的东西，只是借这一次回调记下时刻 ——
  // React 订阅完会重新读一次快照，发现变了就再渲染一遍。
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
