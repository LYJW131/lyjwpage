"use client";

import { useEffect, type RefObject } from "react";

// 懒加载的聊天卡片从占位换成整卡时 messages 不变，只靠依赖项触发会停在半截；内容树一变就补滚一次。
export function useStickToBottom(scrollRef: RefObject<HTMLElement | null>, stickRef: RefObject<boolean>, deps: unknown[]) {
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [scrollRef, stickRef]);
}
