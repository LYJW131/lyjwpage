import type { Transition } from "motion/react";

/** 秒。调用方要按同一条时间线安排收尾动作时拿它对齐 */
export const LIST_DURATION = 0.32;

/**
 * 列表增删和重排统一用这一组过渡。
 *
 * 位移刻意压得很小（≤8px）：这些卡片会自己刷新，动效太大就成了干扰。
 */
export const LIST_TRANSITION: Transition = {
  duration: LIST_DURATION,
  ease: [0.22, 1, 0.36, 1],
};

/** 上下排列的列表：新条目从上方落入，离场时向下退出 */
export const LIST_ITEM_VARIANTS = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
};

/** 横向排列的列表：新条目从左侧推入 */
export const ROW_ITEM_VARIANTS = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
};

/** 主展示位切换时的交叉淡入 */
export const HERO_VARIANTS = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

/** 开了「减弱动态效果」时，把所有位移和时长抹平 */
export const STATIC_VARIANTS = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

export const STATIC_TRANSITION: Transition = { duration: 0 };
