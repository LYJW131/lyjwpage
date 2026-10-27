import { hash } from "./aoko-paint";

// 伸出的是左手：前臂从腕口横过胸前通到画面右侧的肘，手腕回折、掌心朝外（握腕的是右手）。
// 套在前臂上的法阵（img0667、img0664）环面垂直于这段前臂，看上去是沿袖子排开的竖向窄椭圆；开口取 img0667 那样约 0.4。
// FOREARM 是底图里那段袖子的中线与半宽，aoko-front.ts 拿它立一根只写深度的圆柱，挡住环在袖子后面的半圈。
export const FOREARM = { from: [405, 368], to: [680, 418], half: 40 } as const;
export const ARM_AXIS = Math.atan2(FOREARM.to[1] - FOREARM.from[1], FOREARM.to[0] - FOREARM.from[0]);
// 环面法线（前臂方向）朝镜头的分量就是椭圆的开口：手腕近、肘远，前臂往画面里斜。
export const RING_SQUASH = 0.42;
// 三圈大小不一：靠手腕的离镜头近、最大，往肘依次变小，和 img0667 一样；最大那圈的上沿要停在下巴以下，不压到嘴。
export const ARM_RINGS = [
  { at: 0.24, r: 108, sprite: "ring", spin: 0.5 },
  { at: 0.54, r: 86, sprite: "octa", spin: -0.45 },
  { at: 0.82, r: 66, sprite: "runes", spin: 0.7 },
] as const;
export const ARM_SPOTS = ARM_RINGS.map((ring) => ({
  ...ring,
  x: FOREARM.from[0] + (FOREARM.to[0] - FOREARM.from[0]) * ring.at,
  y: FOREARM.from[1] + (FOREARM.to[1] - FOREARM.from[1]) * ring.at,
}));
// aoko-figure.ts 的着色器按这组椭圆在环附近扭曲立绘（空气折射），环的位置大小只在这里改。
export const ARM_RING_SHAPES = { axis: ARM_AXIS, squash: RING_SQUASH, rings: ARM_SPOTS.map(({ x, y, r }) => ({ x, y, r })) };

// img0667 的环是碎的：每圈几处断口，断口后一小段碎片往外错开，沿环有细碎的电弧毛刺。
// 断口不固定：每处按自己的周期张开再合上，合上后换个随机位置再断（lyjw 要的），张开时断口一带的立绘轻微扭曲（aoko-figure.ts 着色器）。
export const GAPS = 3;
export const SHARD = 0.16;
const TAU = Math.PI * 2;

export type Gap = { at: number; end: number; open: number };

// 角度在环自己转动的坐标里；open 为 0 时断口完全合上。
export function ringGaps(k: number, t: number): Gap[] {
  return Array.from({ length: GAPS }, (_, j) => {
    const seed = k * 5 + j;
    const clock = t / (2.2 + hash(seed) * 1.8) + hash(seed + 9);
    const round = Math.floor(clock);
    const open = Math.sin(Math.PI * (clock - round)) ** 2;
    const at = hash(seed * 7 + round * 13) * TAU;
    return { at, end: at + (0.1 + hash(seed + round * 3) * 0.16) * open, open };
  }).sort((a, b) => a.at - b.at);
}

// 椭圆环上第 angle 处在立绘坐标里的位置（环自己的转动已算进 angle）。
export function onRing(ring: (typeof ARM_SPOTS)[number], angle: number): [number, number] {
  const lx = Math.cos(angle) * ring.r * RING_SQUASH;
  const ly = Math.sin(angle) * ring.r;
  return [ring.x + lx * Math.cos(ARM_AXIS) - ly * Math.sin(ARM_AXIS), ring.y + lx * Math.sin(ARM_AXIS) + ly * Math.cos(ARM_AXIS)];
}

// 着色器在断口处扭曲立绘：每个断口给出它在立绘坐标里的位置和张开程度，按环、按断口排成 [x, y, open, …]。
export const RIFTS = ARM_RINGS.length * GAPS;
export function rifts(t: number, out: Float32Array) {
  ARM_SPOTS.forEach((ring, k) => {
    ringGaps(k, t).forEach((gap, j) => {
      const [x, y] = onRing(ring, (gap.at + gap.end) / 2 + t * ring.spin);
      const i = (k * GAPS + j) * 3;
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = gap.open;
    });
  });
  return out;
}

// 沿环的电弧毛刺：每 0.08 秒换一组，每组三段、每段七个点，半径上下抖；坐标在环自己转动、压扁前的平面里。
export const JAG_ARCS = 3;
export const JAG_POINTS = 7;
export function jags(k: number, r: number, t: number) {
  const tick = Math.floor(t / 0.08);
  return Array.from({ length: JAG_ARCS }, (_, c) => {
    const from = hash(tick * 3 + c + k * 11) * TAU;
    return Array.from({ length: JAG_POINTS }, (_, i) => {
      const angle = from + i * 0.06;
      const jag = r * (1 + (hash(tick * 17 + i + c * 13 + k) - 0.5) * (i % 3 ? 0.08 : 0.22));
      return [Math.cos(angle) * jag, Math.sin(angle) * jag] as const;
    });
  });
}

// 环上一闪一闪的星点：8 颗轮流挂在三圈环上，每颗 0.9 秒亮灭一次、换个位置。
export function glints(t: number) {
  return Array.from({ length: 8 }, (_, i) => {
    const ring = ARM_SPOTS[i % ARM_SPOTS.length];
    const slot = Math.floor(t / 0.9 + hash(i) * 3);
    const life = (t / 0.9 + hash(i) * 3) % 1;
    const [x, y] = onRing(ring, hash(slot * 5 + i) * TAU);
    return { x, y, size: (8 + hash(slot + i * 3) * 12) * Math.sin(Math.PI * life), life };
  });
}

export type HandPose = { dx: number; dy: number; zoom: number };
