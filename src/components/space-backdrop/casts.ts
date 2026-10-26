import astronaut from "./clawd-astronaut.json";
import { frameCanvases } from "./sprite";

import type { ClawdCast } from "./clawd-actor";

// 精灵前 LAUNCH 帧是起飞，之后 [LAUNCH, LOOP) 循环漂浮；背景里常驻，直接从漂浮段开始（claude.dev 页脚同样 skipIntro）。
const LAUNCH = 30;
const LOOP = 98;

export function astronautCast(): ClawdCast {
  const frame = frameCanvases(astronaut);
  return { w: astronaut.w, h: astronaut.h, frame: (t) => frame(LAUNCH + (Math.floor(t * astronaut.fps) % (LOOP - LAUNCH))) };
}
