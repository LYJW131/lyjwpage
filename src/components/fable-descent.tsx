"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type Descent = { key: number; x: number; y: number; top: number };

const GOLD = "#f5c542";
const PALE = "#fff6d5";
const DURATION = 4.4;

const SPARKS = Array.from({ length: 36 }, (_, i) => {
  const angle = (i / 36) * Math.PI * 2 + (i % 4) * 0.11;
  const distance = 220 + (i % 5) * 70;
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, delay: 0.35 + (i % 6) * 0.05, size: 3 + (i % 4) };
});

const EMBERS = Array.from({ length: 48 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: 0.3 + ((i * 13) % 20) / 10,
  duration: 1.6 + ((i * 7) % 10) / 10,
  size: 2 + (i % 4),
  drift: ((i % 7) - 3) * 18,
}));

function bolt(seed: number, length: number): string {
  let x = 0;
  const points = ["0,0"];
  for (let y = length / 8, i = 1; y <= length; y += length / 8, i++) {
    x += ((((seed * 31 + i * 17) % 11) - 5) / 5) * 26;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}
const BOLTS = [-1, 1, -0.5, 0.5].map((side, i) => ({ side, points: bolt(i + 3, 360), delay: 0.25 + i * 0.18 }));

export function FableDescent({ descent }: { descent: Descent | null }) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!descent || reduced) return;
    // 只震 main：给 body 加 transform 会让传送到 body 的 fixed 遮罩改以整页为参照，瞬间跳位。
    const target = document.querySelector("main");
    if (!target) return;
    const shake = target.animate(
      [0, -9, 8, -7, 6, -4, 3, -1, 0].map((dy, i) => ({ transform: `translate(${i % 2 ? dy * 0.6 : -dy * 0.4}px, ${dy}px)` })),
      { duration: 700, delay: 380, easing: "ease-out" },
    );
    return () => shake.cancel();
  }, [descent, reduced]);

  if (reduced || typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {descent && (
        <motion.div
          key={descent.key}
          className="pointer-events-none fixed inset-0 z-[100] overflow-hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 1, 0] }}
          transition={{ duration: DURATION, times: [0, 0.82, 1] }}
          aria-hidden
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: `radial-gradient(ellipse at ${descent.x}px ${descent.y}px, rgba(0,0,0,0) 0%, rgba(10,6,0,0.82) 75%)` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: DURATION, times: [0, 0.12, 0.75, 1] }}
          />

          <motion.div
            className="absolute"
            style={{
              left: descent.x,
              top: 0,
              height: descent.y,
              width: 160,
              marginLeft: -80,
              transformOrigin: "top",
              background: `linear-gradient(to bottom, rgba(255,246,213,0) 0%, rgba(255,246,213,0.9) 35%, ${GOLD} 100%)`,
              filter: "blur(6px)",
              boxShadow: `0 0 120px 40px rgba(245,197,66,0.55)`,
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: [0, 1, 1, 1], opacity: [0, 1, 0.85, 0], scaleX: [0.3, 1, 1.6, 2.4] }}
            transition={{ duration: 2.6, times: [0, 0.14, 0.6, 1], ease: "easeOut" }}
          />

          {BOLTS.map((b, i) => (
            <motion.svg
              key={i}
              className="absolute overflow-visible"
              style={{ left: descent.x + b.side * 110, top: Math.max(descent.y - 380, 0) }}
              width="1"
              height="1"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0, 1, 0.6, 0] }}
              transition={{ duration: 0.7, delay: b.delay, times: [0, 0.1, 0.25, 0.35, 0.6, 1] }}
            >
              <polyline points={b.points} fill="none" stroke={PALE} strokeWidth="3" style={{ filter: `drop-shadow(0 0 8px ${GOLD}) drop-shadow(0 0 18px ${GOLD})` }} />
            </motion.svg>
          ))}

          <motion.div
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0] }}
            transition={{ duration: 0.75, delay: 0.38, times: [0, 0.12, 1] }}
          />

          <motion.div
            className="absolute size-[260vmax] -translate-x-1/2 -translate-y-1/2"
            style={{
              left: descent.x,
              top: descent.y,
              background: `repeating-conic-gradient(from 0deg, rgba(245,197,66,0.5) 0deg 3deg, rgba(0,0,0,0) 3deg 12deg)`,
              maskImage: "radial-gradient(circle, black 0%, transparent 32%)",
              WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 32%)",
            }}
            initial={{ opacity: 0, rotate: 0, scale: 0.3 }}
            animate={{ opacity: [0, 1, 0.8, 0], rotate: 90, scale: 1 }}
            transition={{ duration: 3.6, delay: 0.4, ease: "easeOut" }}
          />

          {[0, 0.2, 0.4, 0.65].map((delay) => (
            <motion.div
              key={delay}
              className="absolute size-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: descent.x, top: descent.y, border: `3px solid ${GOLD}`, boxShadow: `0 0 40px ${GOLD}, inset 0 0 30px ${GOLD}` }}
              initial={{ opacity: 1, scale: 0 }}
              animate={{ opacity: 0, scale: 9 }}
              transition={{ duration: 1.8, delay: 0.4 + delay, ease: "easeOut" }}
            />
          ))}

          {SPARKS.map((spark, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ left: descent.x, top: descent.y, width: spark.size, height: spark.size, background: PALE, boxShadow: `0 0 12px ${GOLD}` }}
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ x: spark.x, y: spark.y, opacity: [0, 1, 0] }}
              transition={{ duration: 1.6, delay: spark.delay, ease: "easeOut" }}
            />
          ))}

          {EMBERS.map((ember, i) => (
            <motion.span
              key={i}
              className="absolute top-0 rounded-full"
              style={{ left: ember.left, width: ember.size, height: ember.size * 2.5, background: GOLD, boxShadow: `0 0 8px ${GOLD}` }}
              initial={{ y: -20, x: 0, opacity: 0 }}
              animate={{ y: "105vh", x: ember.drift, opacity: [0, 1, 1, 0] }}
              transition={{ duration: ember.duration, delay: ember.delay, ease: "easeIn" }}
            />
          ))}

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <motion.div
              className="label-mono text-xs font-bold sm:text-sm"
              style={{ color: GOLD, textShadow: `0 0 14px ${GOLD}, 0 0 30px ${GOLD}` }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: [0, 1, 1, 0], y: 0 }}
              transition={{ duration: 3.4, times: [0, 0.12, 0.85, 1], delay: 0.7 }}
            >
              ✦ Fable 5.1 · Summoned by Clef ✦
            </motion.div>
            <motion.div
              className="god-aura bg-clip-text text-5xl font-black uppercase leading-none text-transparent sm:text-8xl"
              style={{ filter: `drop-shadow(0 0 18px rgba(245,197,66,0.9)) drop-shadow(0 0 48px rgba(245,197,66,0.6))` }}
              initial={{ opacity: 0, scale: 3.2, letterSpacing: "0.6em" }}
              animate={{ opacity: [0, 1, 1, 0], scale: [3.2, 0.92, 1, 1.04], letterSpacing: ["0.6em", "0.08em", "0.12em", "0.16em"] }}
              transition={{ duration: 3.6, times: [0, 0.12, 0.2, 1], delay: 0.38, ease: "easeOut" }}
            >
              God Has
              <br />
              Descended
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
