import type { Transition } from "motion/react";

export const LIST_DURATION = 0.32;

export const LIST_TRANSITION: Transition = {
  duration: LIST_DURATION,
  ease: [0.22, 1, 0.36, 1],
};

export const LIST_ITEM_VARIANTS = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
};

export const ROW_ITEM_VARIANTS = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
};

// 交叉淡入需要 popLayout；wait 会在换曲时留下整块空白。
export const HERO_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: "easeIn" } },
};

export const STATIC_VARIANTS = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

export const STATIC_TRANSITION: Transition = { duration: 0 };
