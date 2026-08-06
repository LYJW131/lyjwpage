"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * 进入视口时的淡入上浮。
 *
 * 位移只有 12px —— 克制的关键就是别超过 16px，再大就从「有质感」
 * 变成「花哨」了。only: true 保证滚回去不会重播。
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  // 全局 CSS 的 prefers-reduced-motion 兜不住 JS 驱动的 transform，得在这里单独判
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
