/**
 * 和 NumberFlow 同一个盒子的「—」。
 *
 * NumberFlow 的盒子高 1.5em：数字一行 1em，上下各留 0.25em 给滚动动画的遮罩。
 * 同一位置没数时直接写「—」只有一行高，并排的几栏就会一高一矮，下面的分隔线和
 * 整排行跟着错开。这里用同样的内边距把盒子撑到一样高。
 */
export function FlowDash() {
  return <span className="inline-block py-[0.25em] leading-none">—</span>;
}
