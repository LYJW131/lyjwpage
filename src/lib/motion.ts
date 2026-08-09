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

/**
 * 主展示位切换：真正的交叉淡入，不位移。
 *
 * 要配 AnimatePresence 的 `mode="popLayout"` —— 旧的那份被摘出文档流，新旧在
 * 同一个位置叠着淡。从前是 `mode="wait"` 加 ±6px 位移：旧的退完才进新的，
 * 一去一回 0.44 秒，中间还空一拍整块都没有东西，换歌时那一下比内容变化本身
 * 还显眼。
 *
 * 出场比入场快得多：两张封面各自半透明地叠着会糊成重影，让旧的先退干净，
 * 剩下的时间交给新的淡入。时长各自写在 variant 里，不靠调用方传 —— 非对称
 * 正是这套动效的关键，放在外面容易被一个统一的 transition 抹平。
 */
export const HERO_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: "easeIn" } },
};

/** 开了「减弱动态效果」时，把所有位移和时长抹平 */
export const STATIC_VARIANTS = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

export const STATIC_TRANSITION: Transition = { duration: 0 };
