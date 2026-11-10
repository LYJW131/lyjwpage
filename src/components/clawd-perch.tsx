"use client";

import { useEffect, useRef } from "react";

// 高度静态预留：Clawd 进场时只在这条带子里画缝，不推动下面的内容。
export function ClawdPerch() {
  const band = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = band.current;
    if (!el) return;
    let perch: { stop: () => void } | null = null;
    let loading = false;
    let disposed = false;
    const reset = () => {
      perch?.stop();
      perch = null;
      if (line.current) line.current.style.visibility = "";
    };
    const check = () => {
      const r = el.getBoundingClientRect();
      if (!perch && !loading && r.top < 0.8 * innerHeight && r.bottom > 0) {
        loading = true;
        void import("@/components/clawd-perch/perch").then(({ clawdPerch }) => {
          loading = false;
          if (disposed) return;
          const fresh = el.getBoundingClientRect();
          if (fresh.top >= innerHeight || fresh.bottom <= 0) return;
          perch = clawdPerch(el);
          if (perch && line.current) line.current.style.visibility = "hidden";
        });
      } else if (perch && (r.bottom < 0 || r.top > innerHeight)) reset();
    };
    addEventListener("scroll", check, { passive: true });
    addEventListener("resize", check, { passive: true });
    check();
    return () => {
      disposed = true;
      removeEventListener("scroll", check);
      removeEventListener("resize", check);
      reset();
    };
  }, []);

  return (
    <div aria-hidden className="pt-3">
      <div ref={band} className="relative h-14">
        <div ref={line} className="absolute inset-x-0 top-7 h-px bg-line" />
      </div>
    </div>
  );
}
