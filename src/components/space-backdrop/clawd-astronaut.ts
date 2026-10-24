import sprite from "./clawd-astronaut.json";

import type { AvoidRect } from "./space-field";

// 精灵前 LAUNCH 帧是起飞，之后 [LAUNCH, LOOP) 循环漂浮；背景里常驻，直接从漂浮段开始（claude.dev 页脚同样 skipIntro）。
const LAUNCH = 30;
const LOOP = 98;

export type FloatTarget = { x: number; y: number };

function decodeFrames(): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const pixels = Uint8Array.from([...sprite.base].map((c) => (c === "." ? 255 : +c)));
  frames.push(pixels.slice());
  for (const delta of sprite.deltas) {
    if (delta)
      for (const entry of delta.split(",")) {
        const end = entry.length - 1;
        pixels[parseInt(entry.slice(0, end), 36)] = entry[end] === "." ? 255 : +entry[end];
      }
    frames.push(pixels.slice());
  }
  return frames;
}

type AstronautOptions = {
  px?: number;
  home: () => FloatTarget;
  targetRef: () => FloatTarget | null;
  boundsX?: () => [number, number];
  reducedMotion?: boolean;
};

export function clawdAstronaut(host: HTMLElement, { px = 2.7, home, targetRef, boundsX, reducedMotion = false }: AstronautOptions) {
  const frames = decodeFrames();
  const cache = new Map<number, HTMLCanvasElement>();
  const rgb = sprite.palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const frameCanvas = (index: number) => {
    const hit = cache.get(index);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = sprite.w;
    c.height = sprite.h;
    const cctx = c.getContext("2d")!;
    const img = cctx.createImageData(sprite.w, sprite.h);
    const data = frames[index];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 255) continue;
      const [r, g, b] = rgb[data[i]];
      img.data[4 * i] = r;
      img.data[4 * i + 1] = g;
      img.data[4 * i + 2] = b;
      img.data[4 * i + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    cache.set(index, c);
    return c;
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const fit = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  };
  fit();

  const start = home();
  let x = start.x;
  let y = start.y;
  let vx = 0;
  let vy = 0;
  let tilt = 0;
  const t0 = performance.now();
  let prev = t0;
  const width = sprite.w * px;
  const height = sprite.h * px;

  const draw = () => {
    const now = performance.now();
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, Math.max(0.008, (now - prev) / 1000));
    prev = now;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const goal = { ...(targetRef() ?? home()) };
    goal.x += 0.028 * Math.sin(0.45 * t) + 0.018 * Math.sin(0.19 * t + 1.7);
    goal.y += 0.045 * Math.sin(0.62 * t + 0.8) + 0.03 * Math.sin(0.27 * t + 2.4);
    if (boundsX) {
      const [lo, hi] = boundsX();
      goal.x = Math.max(lo, Math.min(hi, goal.x));
    }
    vx += ((goal.x - x) * 0.12 - 0.8 * vx) * dt;
    vy += ((goal.y - y) * 0.12 - 0.8 * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    tilt += (Math.max(-8, Math.min(8, 55 * vx)) - tilt) * (1 - Math.exp(-(4 * dt)));
    const index = LAUNCH + (Math.floor(t * sprite.fps) % (LOOP - LAUNCH));
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(x * W, y * H);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(0, 4 * Math.sin(1.1 * t));
    ctx.drawImage(frameCanvas(index), -width / 2, -height / 2, width, height);
    ctx.restore();
  };

  let raf = 0;
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    draw();
    raf = requestAnimationFrame(loop);
  };
  const ro = new ResizeObserver(() => {
    fit();
    draw();
  });
  ro.observe(host);
  draw();
  if (!reducedMotion) raf = requestAnimationFrame(loop);

  return {
    canvas,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.remove();
    },
    getRect(): AvoidRect {
      return { left: x * canvas.clientWidth - width / 2, top: y * canvas.clientHeight - height / 2, w: width, h: height };
    },
  };
}
