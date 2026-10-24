"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribeDark(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const readDark = () => document.documentElement.classList.contains("dark");

export function SpaceBackdrop() {
  const host = useRef<HTMLDivElement>(null);
  const dark = useSyncExternalStore(subscribeDark, readDark, () => false);

  useEffect(() => {
    const el = host.current;
    if (!dark || !el) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void import("@/components/space-backdrop/scene").then(({ mountSpaceScene }) => {
      if (!cancelled) cleanup = mountSpaceScene(el);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [dark]);

  return <div ref={host} aria-hidden className="pointer-events-none fixed inset-0 -z-10 hidden opacity-70 dark:block" />;
}
