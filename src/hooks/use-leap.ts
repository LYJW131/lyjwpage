"use client";

import { useState } from "react";

// 一次变化超过 maxStep 算跳变（水合对时、换锚点、换歌、拖动进度），动画该直接落位：
// 补间会让歌词滚过中间各行、数字滚过中间各值，看起来像连跳好几次。
export function useLeap(value: number, maxStep: number): boolean {
  const [last, setLast] = useState({ value, leap: true });
  if (last.value !== value) {
    const leap = Math.abs(value - last.value) > maxStep;
    setLast({ value, leap });
    return leap;
  }
  return last.leap;
}
