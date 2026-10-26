// 两只 Clawd 的精灵像素同尺度（眼睛都是 2×2），共用一个放大倍数，切主题时个头不变。
export const CLAWD_PX = 2.7;
export const EDGE = 12;

export function columnRect(): { left: number; right: number } {
  const column = document.querySelector(".max-w-5xl");
  const rect = column?.getBoundingClientRect();
  return rect && rect.width ? { left: rect.left, right: rect.right } : { left: innerWidth / 2, right: innerWidth / 2 };
}
