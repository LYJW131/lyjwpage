import { CLAWD_PX } from "./layout";

import type { AvoidRect } from "./space-field";

export type FloatTarget = { x: number; y: number };

// world 在视口坐标里画（拖在身后的东西），back / front 在精灵坐标里画（原点是精灵中心、单位 CSS 像素，随倾斜和浮动一起动），分别垫在精灵下面和盖在上面。
export type ClawdFx = {
  world: (ctx: CanvasRenderingContext2D, dt: number, x: number, y: number, vx: number, vy: number) => void;
  back: (ctx: CanvasRenderingContext2D, t: number) => void;
  front: (ctx: CanvasRenderingContext2D, t: number, dt: number) => void;
};

// w、h 是精灵像素数；frame(t) 返回 t 秒时那一帧的 w×h 画布，按 CLAWD_PX 放大绘制。
export type ClawdCast = { w: number; h: number; frame: (t: number) => CanvasImageSource; fx?: ClawdFx; poke?: () => void };

type ActorOptions = ClawdCast & {
  home: () => FloatTarget;
  targetRef: () => FloatTarget | null;
  boundsX?: () => [number, number];
  reducedMotion?: boolean;
  phase?: number;
};

export function clawdActor(host: HTMLElement, { w, h, frame, fx, home, targetRef, boundsX, reducedMotion = false, phase = 0 }: ActorOptions) {
  const px = CLAWD_PX;
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
  const width = w * px;
  const height = h * px;

  const draw = () => {
    const now = performance.now();
    const elapsed = (now - t0) / 1000;
    const t = elapsed + phase;
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
    if (boundsX) {
      const [lo, hi] = boundsX();
      if (x < lo || x > hi) {
        x = Math.max(lo, Math.min(hi, x));
        vx = 0;
      }
    }
    tilt += (Math.max(-8, Math.min(8, 55 * vx)) - tilt) * (1 - Math.exp(-(4 * dt)));
    ctx.clearRect(0, 0, W, H);
    const bob = 4 * Math.sin(1.1 * t);
    const step = reducedMotion ? 0 : dt;
    fx?.world(ctx, step, x * W, y * H + bob, vx * W, vy * H);
    ctx.save();
    ctx.translate(x * W, y * H);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(0, bob);
    fx?.back(ctx, t);
    ctx.drawImage(frame(elapsed), -width / 2, -height / 2, width, height);
    fx?.front(ctx, t, step);
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
    place(nx: number) {
      x = nx;
      vx = 0;
    },
    getRect(): AvoidRect {
      return { left: x * canvas.clientWidth - width / 2, top: y * canvas.clientHeight - height / 2, w: width, h: height };
    },
  };
}
