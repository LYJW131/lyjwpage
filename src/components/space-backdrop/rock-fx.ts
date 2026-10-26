import type { ClawdFx } from "./clawd-actor";

// 精灵坐标里的陨石位置（顶面、中心、底边、半宽）和冒 Z 的起点（头顶右侧），都相对精灵中心，单位 CSS 像素。
type RockGeometry = { px: number; topY: number; centerY: number; bottomY: number; halfW: number; headX: number; headY: number };
type Palette = { light: string; base: string; shade: string; sparkle: string; snore: string };

type Dust = { x: number; y: number; vx: number; vy: number; g: number; age: number; life: number; color: string };
type Sparkle = { x: number; y: number; age: number };
type Snore = { x: number; y: number; age: number };

const MAX_DUST = 60;
// 静止时也慢慢掉渣，动起来按速度加量；尾迹速度取陨石速度反向的一部分，看着是被甩在身后。
const DUST_IDLE_RATE = 2.5;
const DUST_PER_SPEED = 0.25;
const DUST_MAX_RATE = 30;
const SPARKLE_LIFE = 0.7;
const BURST = 10;
const SNORE_LIFE = 1.8;
const Z = ["###", "..#", ".#.", "#..", "###"];
const BURST_GRAVITY = 90;
const ORBITS = [
  { speed: 0.8, reach: 3, tilt: 0.28, phase: 0 },
  { speed: 0.55, reach: 7, tilt: 0.2, phase: 2.4 },
];

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function rockFx({ px, topY, centerY, bottomY, halfW, headX, headY }: RockGeometry, palette: Palette): ClawdFx & { burst: () => void; snore: (dx: number) => void } {
  const block = 2 * px;
  const snap = (v: number) => Math.round(v / px) * px;
  const dust: Dust[] = [];
  const sparkles: Sparkle[] = [];
  const snores: Snore[] = [];
  let owed = 0;
  let burst = 0;
  const tone = () => {
    const roll = Math.random();
    return roll < 0.2 ? palette.light : roll < 0.6 ? palette.base : palette.shade;
  };
  let nextSparkle = between(0.6, 1.6);

  const pebble = (ctx: CanvasRenderingContext2D, x: number, y: number, near: boolean) => {
    const size = near ? block : px;
    ctx.fillStyle = near ? palette.base : palette.shade;
    ctx.fillRect(snap(x - size / 2), snap(y - size / 2), size, size);
    if (!near) return;
    ctx.fillStyle = palette.light;
    ctx.fillRect(snap(x - size / 2), snap(y - size / 2), px, px);
  };
  const orbit = (ctx: CanvasRenderingContext2D, t: number, near: boolean) => {
    for (const o of ORBITS) {
      const a = o.phase + o.speed * t;
      if (Math.sin(a) > 0 !== near) continue;
      const r = halfW + o.reach * px;
      pebble(ctx, Math.cos(a) * r, centerY + Math.sin(a) * r * o.tilt, near);
    }
  };

  return {
    burst() {
      burst = BURST;
    },
    snore(dx) {
      snores.push({ x: headX + dx, y: headY, age: 0 });
    },
    world(ctx, dt, x, y, vx, vy) {
      for (; burst > 0 && dust.length < MAX_DUST; burst--) {
        const side = burst % 2 ? 1 : -1;
        dust.push({
          x: x + side * between(0.2, 0.7) * halfW,
          y: y + topY,
          vx: side * between(30, 75),
          vy: -between(25, 55),
          g: BURST_GRAVITY,
          age: 0,
          life: between(0.5, 0.9),
          color: tone(),
        });
      }
      burst = 0;
      const speed = Math.hypot(vx, vy);
      owed += dt * Math.min(DUST_MAX_RATE, DUST_IDLE_RATE + speed * DUST_PER_SPEED);
      for (; owed >= 1 && dust.length < MAX_DUST; owed--) {
        dust.push({
          x: x + between(-0.6, 0.6) * halfW,
          y: y + bottomY - block,
          vx: -0.4 * vx + between(-10, 10),
          vy: -0.4 * vy + between(6, 16),
          g: 0,
          age: 0,
          life: between(0.8, 1.5),
          color: tone(),
        });
      }
      owed = Math.min(owed, 1);
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        d.age += dt;
        if (d.age >= d.life) {
          dust.splice(i, 1);
          continue;
        }
        d.vy += d.g * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const k = d.age / d.life;
        // 透明度和尺寸都按台阶变，不做连续渐变，保持像素感。
        ctx.globalAlpha = k < 1 / 3 ? 1 : k < 2 / 3 ? 0.6 : 0.3;
        ctx.fillStyle = d.color;
        const size = k < 0.5 ? block : px;
        ctx.fillRect(snap(d.x - size / 2), snap(d.y - size / 2), size, size);
      }
      ctx.globalAlpha = 1;
    },
    back(ctx, t) {
      orbit(ctx, t, false);
    },
    front(ctx, t, dt) {
      orbit(ctx, t, true);
      nextSparkle -= dt;
      if (nextSparkle <= 0) {
        nextSparkle = between(1.2, 2.8);
        // 只闪在陨石两侧斜上方，不压到 Clawd 身上。
        const a = Math.random() < 0.5 ? between(-Math.PI, -2.3) : between(-0.85, 0);
        const r = halfW * between(0.9, 1.3);
        sparkles.push({ x: Math.cos(a) * r, y: centerY + Math.sin(a) * r * 0.8, age: 0 });
      }
      ctx.fillStyle = palette.snore;
      for (let i = snores.length - 1; i >= 0; i--) {
        const z = snores[i];
        z.age += dt;
        if (z.age >= SNORE_LIFE) {
          snores.splice(i, 1);
          continue;
        }
        const k = z.age / SNORE_LIFE;
        ctx.globalAlpha = k < 0.5 ? 1 : k < 0.8 ? 0.6 : 0.3;
        const x = snap(z.x + 14 * z.age + 3 * Math.sin(4 * z.age));
        const y = snap(z.y - 20 * z.age);
        Z.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && ctx.fillRect(x + c * px, y + r * px, px, px)));
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.sparkle;
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        s.age += dt;
        if (s.age >= SPARKLE_LIFE) {
          sparkles.splice(i, 1);
          continue;
        }
        const x = snap(s.x);
        const y = snap(s.y);
        ctx.fillRect(x, y, px, px);
        const k = s.age / SPARKLE_LIFE;
        if (k < 0.25 || k > 0.65) continue;
        ctx.fillRect(x - px, y, px, px);
        ctx.fillRect(x + px, y, px, px);
        ctx.fillRect(x, y - px, px, px);
        ctx.fillRect(x, y + px, px, px);
      }
    },
  };
}
