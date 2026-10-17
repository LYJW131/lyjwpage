"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { isRestReady, subscribeRestReady } from "@/lib/rest-ready";

function notReady(): boolean {
  return false;
}

// 屏外卡片先占位，滚到附近才渲染：首屏 SSR 只出前几张卡，HTML、DOM 和水合量都跟着降。
// 观察器要等首屏画完（rest ready）才挂：水合时就把整块树插进 DOM 会把首帧一起推后。
export function DeferredCard({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const awake = useSyncExternalStore(subscribeRestReady, isRestReady, notReady);

  useEffect(() => {
    if (!awake || shown) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== "function") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [awake, shown]);

  if (shown) return <Suspense fallback={null}>{children}</Suspense>;
  return (
    <div ref={ref} aria-hidden className={className} style={{ height, contain: "layout paint" }} />
  );
}
