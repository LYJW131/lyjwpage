"use client";

import { useEffect, useState } from "react";

import type { FocusMode } from "@shared/focus";
import { cn } from "@/lib/utils";

// 路径与时序逐帧取自 iOS 专注模式打开时的图标动画；动画规则在 globals.css 的 .focus-icon。
const FLOWER = "M6.943 4.31A13.75 13.75 0 1 0 6.943 -4.31M-0.261 8.167A13.75 13.75 0 1 0 7.204 3.858M-7.204 3.858A13.75 13.75 0 1 0 0.261 8.167M-6.943 -4.31A13.75 13.75 0 1 0 -6.943 4.31M0.261 -8.167A13.75 13.75 0 1 0 -7.204 -3.858M7.204 -3.858A13.75 13.75 0 1 0 -0.261 -8.167";
const BED = ["M8 17V4A4 4 0 0 1 12 0H64A4 4 0 0 1 68 4V17H61V10A2 2 0 0 0 59 8H44A2 2 0 0 0 42 10V17H35V10A2 2 0 0 0 33 8H18A2 2 0 0 0 16 10V17Z", "M0 26A5 5 0 0 1 5 21H71A5 5 0 0 1 76 26V48A2 2 0 0 1 74 50H71A2 2 0 0 1 69 48V43H7V48A2 2 0 0 1 5 50H2A2 2 0 0 1 0 48Z"];
const Z = "M-4.47 -6.18H4.47Q4.75 -6.18 4.75 -5.8V-4.09L-1.33 3.7H4.75V6.18H-4.75V4.09L1.33 -3.7H-4.47Z";

function Mindfulness() {
  return (
    <svg viewBox="-37 -37 74 74" aria-hidden>
      <g className="spin" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round">
        <path className="ink" d={FLOWER} />
        <path className="tint" d={FLOWER} />
      </g>
    </svg>
  );
}

const SLEEP_Z_REPLAY_MS = 30_000;

function Sleep() {
  const [round, setRound] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRound((n) => n + 1), SLEEP_Z_REPLAY_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <svg viewBox="0 0 76 50" aria-hidden>
      {(["ink", "tint"] as const).map((layer) => (
        <g key={layer} className={layer} fill="currentColor">
          {BED.map((d) => <path key={d} d={d} />)}
        </g>
      ))}
      <g key={round}>
        {[1, 2, 3].map((n) => <path key={n} className={`z z${n}`} d={Z} />)}
      </g>
    </svg>
  );
}

// 服务端先画未上色的图标，挂载后加 data-on 才开始动画：每次挂载播一次开场。
export function FocusIcon({ mode, className }: { mode: FocusMode; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span className={cn("focus-icon", `focus-${mode}`, className)} data-on={on ? "" : undefined} aria-hidden>
      {mode === "sleep" ? <Sleep /> : <Mindfulness />}
    </span>
  );
}
