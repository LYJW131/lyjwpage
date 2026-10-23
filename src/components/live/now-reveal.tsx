"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";

// motion 的 height:auto 包含 padding；内距须放在内层，否则收起到 0 仍会残留高度。
const EXPANDED = { height: "auto", opacity: 1, marginTop: 12, marginBottom: -3 };
const EXPANDED_TOP = { height: "auto", opacity: 1, marginTop: 0, marginBottom: 9 };
const COLLAPSED = { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 };

// 网格外的「此刻」卡片：有内容时展开、没有时收起；3px 留给卡片的硬阴影，不被 overflow 裁掉。
export function NowReveal({
  revealKey,
  top = false,
  children,
}: {
  revealKey: string;
  top?: boolean;
  children: ReactNode | null;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.div
          key={revealKey}
          initial={reduced ? false : COLLAPSED}
          animate={top ? EXPANDED_TOP : EXPANDED}
          exit={reduced ? undefined : COLLAPSED}
          transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
          className="-mr-[3px] overflow-hidden"
        >
          <div className="pb-[3px] pr-[3px]">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
