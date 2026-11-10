import config from "./clawd-perch.json";

import type { AnimationItem, LottiePlayer } from "lottie-web";

// Lottie 画布是 2750×1850，Clawd 身体宽占画布宽的 0.433；身体中心在画布 0.4855 处、脚底在 0.995 处，量不出来时用这组默认值。
export const BODY_FRAC = 0.433;
export const ASPECT = 1850 / 2750;
export const CENTER = 0.269 + 0.2165;
export const FEET = 0.995;

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let player: Promise<LottiePlayer> | null = null;
export function lottie() {
  player ??= import("lottie-web/build/player/lottie_light_canvas").then((m) => m.default);
  return player;
}

export function loadAnim(container: HTMLElement, file: string, loop = false) {
  return lottie().then((l) =>
    l.loadAnimation({ container, renderer: "canvas", loop, autoplay: false, path: config.base + file }),
  );
}

export const onLoaded = (anim: AnimationItem, fn: () => void) => anim.addEventListener("DOMLoaded", fn);

export function stageBox(bodyPx: number) {
  const w = Math.round(bodyPx / BODY_FRAC);
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;bottom:0;width:${w}px;height:${Math.round(w * ASPECT)}px;pointer-events:none;`;
  return el;
}

export const clampDip = (v: number) => Math.max(-2, Math.min(2, v));

type Box = { x0: number; x1: number; y0: number; y1: number; w: number; h: number };

export function alphaBox(canvas: HTMLCanvasElement, step = 2): Box | null {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w;
  let x1 = 0;
  let y0 = h;
  let y1 = 0;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step)
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 > x0 ? { x0, x1, y0, y1, w, h } : null;
}

// 不同动画里身体占画布的比例略有出入：按身体实宽把舞台缩到和走路时一样大，再记下身体中心与脚底的位置，换动画时脚踩在同一点上。
export type Footprint = { cx: number; feet: number; w: number; h: number };

export function fitStage(stage: HTMLElement, anim: AnimationItem, bodyPx: number, frame = 0): Footprint {
  const fallbackW = parseInt(stage.style.width, 10);
  const fallback = { cx: CENTER, feet: FEET, w: fallbackW, h: parseInt(stage.style.height, 10) };
  anim.goToAndStop(frame, true);
  const canvas = stage.querySelector("canvas");
  const box = canvas && alphaBox(canvas);
  if (!box) return fallback;
  const w = Math.round(bodyPx / ((box.x1 - box.x0) / box.w));
  const h = Math.round(w * ASPECT);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  anim.resize();
  return { cx: (box.x0 + box.x1) / 2 / box.w, feet: box.y1 / box.h, w, h };
}

// 眼睛是身体上半部里的深色像素：逐帧量眼睛相对第 0 帧挪了多少，按「上下 4 行 × 左中右 3 列」各挑挪得最远的一帧，光标在哪个方向就停在哪帧。
export type GazeMap = { grid: number[][]; cx: number; feet: number; fracW: number };

export function buildGazeMap(stage: HTMLElement, anim: AnimationItem): GazeMap {
  const canvas = stage.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  const total = Math.floor(anim.totalFrames);
  const measure = () => {
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2)
        if (data[(y * w + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    const yEnd = y0 + (y1 - y0) * 0.6;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = y0; y < yEnd; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] > 10 && data[i] < 70 && data[i + 1] < 70 && data[i + 2] < 70) {
          sx += x;
          sy += y;
          n++;
        }
      }
    return { eye: n ? [sx / n, sy / n] : null, box: [x0, x1, y0, y1] };
  };
  anim.goToAndStop(0, true);
  const rest = measure();
  const shifts: ([number, number] | null)[] = [];
  for (let f = 0; f < total; f++) {
    anim.goToAndStop(f, true);
    const m = measure();
    shifts.push(m.eye && rest.eye ? [m.eye[0] - rest.eye[0], m.eye[1] - rest.eye[1]] : null);
  }
  anim.goToAndStop(0, true);
  const [x0, x1, , y1] = rest.box;
  const moves = shifts.flatMap((s, f) => (s ? [{ f, dx: s[0], dy: s[1] }] : []));
  const grid: (number | null)[][] = Array.from({ length: 4 }, () => [null, null, null]);
  if (moves.length) {
    const maxX = Math.max(...moves.map((m) => Math.abs(m.dx))) || 1;
    const minY = Math.min(...moves.map((m) => m.dy));
    const maxY = Math.max(...moves.map((m) => m.dy));
    for (const m of moves) {
      const col = m.dx < -0.33 * maxX ? 0 : m.dx > 0.33 * maxX ? 2 : 1;
      const row = Math.min(3, Math.floor(((m.dy - minY) / Math.max(1e-6, maxY - minY)) * 4));
      const held = grid[row][col];
      if (held === null || Math.hypot(m.dx, m.dy) > Math.hypot(...shifts[held]!)) grid[row][col] = m.f;
    }
    for (const row of grid) for (let c = 0; c < 3; c++) row[c] ??= row[1] ?? row[0] ?? row[2];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 3; c++)
        if (grid[r][c] === null) grid[r][c] = grid.find((row) => row[c] !== null)?.[c] ?? null;
  }
  return {
    grid: grid.map((row) => row.map((f) => f ?? 0)),
    cx: (x0 + x1) / 2 / canvas.width,
    feet: y1 / canvas.height,
    fracW: (x1 - x0) / canvas.width,
  };
}

export function gazeFrame(map: GazeMap, dx: number, dy: number) {
  const len = Math.hypot(dx, dy) || 1;
  const row = Math.min(3, Math.max(0, Math.floor(((dy / len + 1) / 2) * 4)));
  const col = dx < -0.28 * len ? 0 : dx > 0.28 * len ? 2 : 1;
  return map.grid[row][col];
}
