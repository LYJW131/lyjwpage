export type AvoidRect = { left: number; top: number; w: number; h: number };

type Shot = { x: number; y: number; vx: number; vy: number; t: number; life: number };

function hash(x: number, y: number, seed: number): number {
  let h = (0x165667b1 * x + 0x27d4eb2f * y + 69069 * seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x4bf19f61);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function valueNoise(x: number, y: number, seed: number, scale: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fy;
}

function driftNoise(x: number, y: number, seed: number, scale: number, time: number): number {
  const step = Math.floor(time);
  const f = time - step;
  const from = valueNoise(x, y, seed ^ Math.imul(step, 0x9e3779b1), scale);
  const to = valueNoise(x, y, seed ^ Math.imul(step + 1, 0x9e3779b1), scale);
  return from + (to - from) * (f * f * (3 - 2 * f));
}

const smooth = (v: number) => v * v * (3 - 2 * v);
const smoothClamp = (v: number) => smooth(Math.max(0, Math.min(1, v)));

// 整屏重绘一帧要几毫秒，常驻背景不能每帧跑；星云漂移很慢，空闲时 15fps 看不出差别，只有流星在飞时全速。
const IDLE_FRAME_MS = 1000 / 15;

const RING_COS = 0.9492354180824408;
const RING_SIN = 0.31456656061611776;

export type SpaceFieldOptions = {
  avoidRef?: () => AvoidRect | null;
  clickHost?: EventTarget;
  shouldShoot?: (event: MouseEvent) => boolean;
  spacing?: number;
  maxDensity?: number;
  grain?: number;
  mix?: number;
  reducedMotion?: boolean;
};

export function spaceField(host: HTMLElement, options: SpaceFieldOptions = {}) {
  const { avoidRef, clickHost = host, shouldShoot, spacing: h = 12, maxDensity = 0.34, grain = 0.7, mix = 0.5, reducedMotion = false } = options;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const seed = (0xffffffff * Math.random()) | 0;
  const grainScale = 12 * grain;
  const styles = getComputedStyle(document.documentElement);
  const dotColor = styles.getPropertyValue("--space-dot").trim();
  const shotColor = styles.getPropertyValue("--space-shot").trim() || dotColor;
  const shots: Shot[] = [];
  let drift = 0;
  let last: number | null = null;

  const fit = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();

  const onClick = (event: Event) => {
    const e = event as MouseEvent;
    if (reducedMotion || (shouldShoot && !shouldShoot(e))) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (cy < 0 || cy > rect.height) return;
    const speed = 400 + 220 * Math.random();
    const deg = Math.PI / 180;
    if (Math.random() < 0.75) {
      const fromLeft = Math.random() < 0.5;
      const dir = fromLeft ? 1 : -1;
      const edge = fromLeft ? -40 : rect.width + 40;
      let angle = (28 + 27 * Math.random()) * deg;
      const run = Math.abs(cx - edge);
      if (cy - Math.tan(angle) * run < 10) angle = Math.max(12 * deg, Math.atan((cy - 10) / run));
      // 角度压到下限后起点仍可能远在视口上方，固定寿命内飞不进来；起点挪到视口上沿，点击总有可见的流星。
      const entry = Math.min(run, (cy + 20) / Math.tan(angle));
      shots.push({ x: cx - dir * entry, y: cy - Math.tan(angle) * entry, vx: dir * Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: 0, life: 2.4 });
    } else {
      const angle = (28 + 27 * Math.random()) * deg;
      shots.push({ x: cx, y: cy, vx: (Math.random() < 0.5 ? 1 : -1) * Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: 0, life: 1.6 });
    }
  };
  clickHost.addEventListener("click", onClick);

  const drawShots = (dt: number, W: number, H: number) => {
    const ox = (W % h) / 2 + h / 2;
    const oy = (H % h) / 2 + h / 2;
    const snap = (v: number, o: number) => o + Math.round((v - o) / h) * h;
    const avoid = avoidRef?.() ?? null;
    ctx.fillStyle = shotColor;
    for (let s = shots.length - 1; s >= 0; s--) {
      const shot = shots[s];
      shot.t += dt;
      if (shot.t >= shot.life) {
        shots.splice(s, 1);
        continue;
      }
      const t = shot.t;
      const fade = Math.min(1, t / (0.25 * shot.life)) * Math.min(1, (shot.life - t) / (0.4 * shot.life));
      const hx = shot.x + shot.vx * t;
      const hy = shot.y + shot.vy * t;
      const v = Math.hypot(shot.vx, shot.vy) || 1;
      const ux = shot.vx / v;
      const uy = shot.vy / v;
      let px: number | null = null;
      let py: number | null = null;
      for (let k = 0; k < 9; k++) {
        const x = snap(hx - ux * h * k, ox);
        const y = snap(hy - uy * h * k, oy);
        if (x === px && y === py) continue;
        px = x;
        py = y;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        if (avoid && x > avoid.left - h && x < avoid.left + avoid.w + h && y > avoid.top - h && y < avoid.top + avoid.h + h) continue;
        const r = (k === 0 ? 0.267 * h : 0.15 * h * (1 - k / 12)) * fade;
        if (r < 0.4) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  };

  const draw = (now: number) => {
    if (last === null) last = now;
    const dt = Math.min(0.1, now - last);
    last = now;
    if (!reducedMotion) drift += 0.22 * dt;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    const floor = 0.62 - maxDensity * 0.42;
    const ceil = floor + 0.34 - 0.22 * mix;
    const avoid = avoidRef?.() ?? null;
    const offX = (W % h) / 2;
    const offY = (H % h) / 2;
    const rSmall = 0.15 * h;
    const rBig = 0.267 * h;
    const minSide = Math.min(W, H);

    const moonR = Math.min(Math.max(52, 0.115 * minSide), 0.3 * minSide);
    const moonX = Math.max(0.14 * W, 1.1 * moonR);
    const moonY = Math.max(0.3 * H, 1.1 * moonR);
    const biteR = 0.92 * moonR;
    const biteX = moonX + 0.45 * moonR;
    const moonRim = Math.max(0.12 * moonR, 0.9 * h);
    const biteRim = Math.max(0.18 * biteR, 0.9 * h);
    const moonHalo = (2.2 * moonR) ** 2;
    const planetR = Math.min(Math.max(60, 0.15 * minSide), 0.19 * minSide);
    const planetX = 0.8 * W;
    const planetY = H - 0.66 * planetR;
    const ringA = 1.75 * planetR;
    const ringB = 0.32 * planetR;
    const planetRim = Math.max(0.1 * planetR, 0.9 * h);

    // 返回 2 大点 / 1 小点 / 0 留空 / -1 交给星云。
    const body = (x: number, y: number, col: number, row: number): number => {
      const mdx = x - moonX;
      const mdy = y - moonY;
      const md2 = mdx * mdx + mdy * mdy;
      if (md2 < moonR * moonR) {
        const bx = x - biteX;
        const by = y - moonY;
        const bd2 = bx * bx + by * by;
        if (bd2 >= biteR * biteR) {
          const biteDist = Math.sqrt(bd2) - biteR;
          return moonR - Math.sqrt(md2) > moonRim && biteDist > biteRim ? 2 : 1;
        }
      }
      if (md2 < moonHalo) {
        const rel = Math.sqrt(md2) / moonR;
        if (rel < 1.4 || hash(col, row, 12295 ^ seed) > smoothClamp((rel - 1.4) / 0.8)) return 0;
      }
      const px = x - planetX;
      const py = y - planetY;
      const pd = Math.sqrt(px * px + py * py);
      const rx = RING_COS * px + RING_SIN * py;
      const ry = -(RING_SIN * px) + RING_COS * py;
      const ring = Math.sqrt((rx / ringA) * (rx / ringA) + (ry / ringB) * (ry / ringB));
      const onRing = ring > 0.8 && ring < 1.2;
      const ringDot = () => {
        const end = Math.abs(rx) / ringA;
        if (end > 0.9 && hash(col, row, 37191 ^ seed) < ((end - 0.9) / 0.1) * 0.9) return 0;
        return Math.abs(ring - 1) < 0.8 * 0.2 ? 2 : 1;
      };
      if (onRing && ry > 0) {
        const v = ringDot();
        if (v) return v;
      }
      if (ry > 0 && pd < planetR && ring > 1 - 0.34 && ring < 1.34) return 0;
      if (pd < planetR) {
        const edge = 1 - pd / planetR;
        if (edge < 0.05 && hash(col, row, 1812 ^ seed) > Math.pow(edge / 0.05, 1.4)) return 0;
        if (planetR - pd < planetRim) return 1;
        const light = 0.5 * (-((px / planetR) * 0.28) + -((py / planetR) * 0.82)) + 0.5 + (driftNoise(col, row, 2458 ^ seed, 3.1, 0) - 0.5) * 0.35;
        return light < 0.18 ? 0 : light > 0.82 ? 2 : 1;
      }
      if (onRing) {
        const v = ringDot();
        if (v) return v;
      }
      const halo = Math.min(pd / (1.18 * planetR), ring / 1.24);
      return halo < 1.32 && (halo < 1 || hash(col, row, 30634 ^ seed) > smoothClamp((halo - 1) / 0.32)) ? 0 : -1;
    };

    ctx.fillStyle = dotColor;
    for (let row = 0, y = offY + h / 2; y < H; row++, y += h)
      for (let col = 0, x = offX + h / 2; x < W; col++, x += h) {
        const fadeIn = 0.2 + (y / H) * 0.8;
        const kind = body(x, y, col, row);
        if (kind === 0 || (kind < 0 && hash(col, row, 170 ^ seed) > 1.15 * fadeIn)) continue;
        if (avoid) {
          const dx = Math.max(0, Math.max(avoid.left - x, x - (avoid.left + avoid.w)));
          const dy = Math.max(0, Math.max(avoid.top + 2 * h - y, y - (avoid.top + avoid.h)));
          const cells = Math.max(dx, dy) / h;
          if (cells <= 7 && hash(col, row, 3098 ^ seed) > smooth(Math.max(0, Math.min(1, (cells - 1) / 6)))) continue;
        }
        if (kind > 0) {
          ctx.beginPath();
          ctx.arc(x, y, kind === 2 ? rBig : rSmall, 0, 2 * Math.PI);
          ctx.fill();
          continue;
        }
        const region = valueNoise(col, row, 273 ^ seed, grainScale);
        const density = driftNoise(col, row, 546 ^ seed, 0.63 * grainScale, 0.5 * drift);
        const texture =
          (0.74 *
            (region < 0.38
              ? driftNoise(col / 9, row / 1.3, 819 ^ seed, 1, drift)
              : region < 0.52
                ? driftNoise(col / 1.3, row / 9, 1092 ^ seed, 1, drift)
                : region < 0.62
                  ? driftNoise((col + row) / 7, (col - row) / 1.4, 1365 ^ seed, 1, drift)
                  : driftNoise(col, row, 1638 ^ seed, 2.6, drift)) +
            0.2 * hash(col, row, 2184 ^ seed)) *
          (0.12 + 1.15 * Math.pow(density, 1.5));
        const star = hash(col, row, 1911 ^ seed);
        if (texture < floor) {
          if (star > 0.988) {
            ctx.beginPath();
            ctx.arc(x, y, rSmall * (0.7 + 25 * (star - 0.988)), 0, 2 * Math.PI);
            ctx.fill();
          }
          continue;
        }
        const level = smooth(Math.min(1, (texture - floor) / Math.max(1e-4, ceil - floor)));
        let r = 0.6 + (rBig - 0.6) * level;
        if (star > 0.9985) r += 1.2 * (0.5 + 0.5 * level);
        if (r < 0.45) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    drawShots(dt, W, H);
  };

  let frame = 0;
  let stopped = false;
  let drawnAt = -Infinity;
  const loop = (ms: number) => {
    if (stopped) return;
    if (shots.length || ms - drawnAt >= IDLE_FRAME_MS) {
      drawnAt = ms;
      draw(ms / 1000);
    }
    frame = requestAnimationFrame(loop);
  };
  const ro = new ResizeObserver(() => {
    fit();
    if (reducedMotion) draw(performance.now() / 1000);
  });
  ro.observe(host);
  if (reducedMotion) draw(performance.now() / 1000);
  else frame = requestAnimationFrame(loop);

  return {
    canvas,
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      clickHost.removeEventListener("click", onClick);
      canvas.remove();
    },
  };
}
