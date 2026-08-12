/**
 * motion 的动画特性包，单独一个文件是为了让它单独成 chunk。
 *
 * 这个文件**只能被动态 import**（各卡片里的 loadFeatures）。任何一处静态导入
 * 都会把它并回引用方所在的 chunk，那样 LazyMotion 就白配了 —— 首屏关键 JS 里
 * 又会躺着一份完整的动画运行时。
 *
 * 用 domMax 而不是 domAnimation：后者只有 renderer + 动画 + 手势，不含 layout。
 * 而「最近听过」和「最近在看」两个列表都给行挂了 layout={!reduced}，靠它在
 * popLayout 摘掉离场元素之后让剩下的平滑补位 —— 换成 domAnimation 的话 layout
 * 会变成一个不报错的空属性，补位从滑动退化成瞬移，而且没有任何地方会提示。
 * 多出来的 drag 这里用不上，但它和 layout 一起只有 domMax 这一个公开的组合，
 * 且整包都在这个懒加载 chunk 里，不占首屏。
 */
export { domMax as default } from "motion/react";
