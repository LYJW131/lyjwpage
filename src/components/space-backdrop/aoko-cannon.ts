import { type FxState, SCENE, hash, smooth, tone } from "./aoko-paint";
import type { HandPose } from "./aoko-rings";

// 掌心光炮，复刻剧场版最终预告开头（@mahoyo_movie 2026-10-10 的帖子）：掌心先冒出一点碎白光，约 0.2 秒长满手掌，
// 边缘翻滚着停一会儿，发射时收成一点、迸出几道不等角的细长光线，再扩出一圈细亮的环。
// 时间都相对 aoko-fx.ts 的 FIRE（since < 0 是发射前），只管光球本身：power 照旧喂给地面、背环、电弧和重打光。
// 参考帧 24fps：f19 点亮、f24 长满、f37 发射，换成秒就是 LIGHT、GROWN。
const LIGHT = 0.75;
const GROWN = 0.55;
// 掌心在立绘原图里的位置；原图画好的蓝色球在 aoko-fx.ts 的 ORB（掌根），闲置时那团光照它，这里是光炮的炮口。
const MUZZLE = [339, 298] as const;
const R = 70;
const TAU = Math.PI * 2;
// 动画「一拍二」的翻滚：轮廓每 1/12 秒换一次。
const BOIL_S = 1 / 12;
// 参考 f37–f40 的光线大致朝这几个方向（画布 y 朝下），每发再随机偏一点。
const RAYS = [-1.25, -0.4, 0.06, 0.45, 1.1, 2.05, 2.8, -2.55];
// 参考 f41 光线射出约 0.17 秒后才扩出那圈环，出现时半径约两个手掌宽。
const RING_AT = 0.14;

// 云团一样的鼓包轮廓：取一圈随机半径的点，经相邻中点用二次曲线连起来，边是圆鼓的而不是尖刺。
function billow(ctx: CanvasRenderingContext2D, r: number, seed: number, rough: number) {
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = ((i + hash(seed * 13 + i) * 0.5) / n) * TAU;
    const k = 1 + (hash(seed * 31 + i) - 0.5) * rough;
    return [Math.cos(a) * r * k * 1.25, Math.sin(a) * r * k * 0.85];
  });
  const mid = (i: number) => {
    const [ax, ay] = pts[i % n];
    const [bx, by] = pts[(i + 1) % n];
    return [(ax + bx) / 2, (ay + by) / 2];
  };
  ctx.beginPath();
  ctx.moveTo(...(mid(0) as [number, number]));
  for (let i = 1; i <= n; i++) {
    const [cx, cy] = pts[i % n];
    const [mx, my] = mid(i);
    ctx.quadraticCurveTo(cx, cy, mx, my);
  }
  ctx.closePath();
}

function glow(ctx: CanvasRenderingContext2D, r: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
}

function blob(ctx: CanvasRenderingContext2D, size: number, e: number, seed: number) {
  glow(ctx, size * 3, [
    [0, tone(SCENE.pale, 0.35 * e)],
    [0.35, tone(SCENE.brick, 0.22 * e)],
    [1, tone(SCENE.deep, 0)],
  ]);
  const body = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.2);
  body.addColorStop(0, tone(SCENE.white, e));
  body.addColorStop(0.35, tone(SCENE.white, 0.8 * e));
  body.addColorStop(0.7, tone(SCENE.pale, 0.55 * e));
  body.addColorStop(1, tone(SCENE.pale, 0.25 * e));
  ctx.fillStyle = body;
  billow(ctx, size, seed, 0.75);
  ctx.fill();
  ctx.fillStyle = tone(SCENE.white, e);
  billow(ctx, size * 0.5, seed + 7, 0.8);
  ctx.fill();
  const streak = ctx.createLinearGradient(-size * 1.7, 0, size * 1.7, 0);
  streak.addColorStop(0, tone(SCENE.white, 0));
  streak.addColorStop(0.5, tone(SCENE.white, 0.6 * e));
  streak.addColorStop(1, tone(SCENE.white, 0));
  ctx.fillStyle = streak;
  ctx.fillRect(-size * 1.7, -1, size * 3.4, 2);
}

function rays(ctx: CanvasRenderingContext2D, shot: number, reach: number, a: number) {
  RAYS.forEach((base, i) => {
    const angle = base + (hash(shot * 8 + i) - 0.5) * 0.25;
    const len = (300 + hash(shot * 8 + i + 0.5) * 450) * reach;
    ctx.save();
    ctx.rotate(angle);
    for (const [w, color, alpha] of [[12, SCENE.sky, 0.35], [3.2, SCENE.white, 1]] as const) {
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, tone(color, alpha * a));
      g.addColorStop(0.5, tone(color === SCENE.white ? SCENE.core : color, alpha * a * 0.7));
      g.addColorStop(1, tone(SCENE.sky, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -w / 2);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, w / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  });
}

function ring(ctx: CanvasRenderingContext2D, r: number, a: number) {
  for (const [w, color, alpha] of [[18, SCENE.sky, 0.4], [3, SCENE.white, 0.9]] as const) {
    ctx.globalAlpha = alpha * a;
    ctx.strokeStyle = tone(color, 1);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 减少动态效果时停在长满手掌那一刻，不留半截点亮。
const STILL_SINCE = -0.3;

export function palmCannon(ctx: CanvasRenderingContext2D, { flash, t, still }: FxState, since: number, palm: readonly number[] | null, pose: HandPose) {
  const at = still ? STILL_SINCE : since;
  if (at < -LIGHT) return;
  const fired = at >= 0;
  // 炮口跟着手层摆：与 aoko-rings.ts#cutArm 同一个变换。
  const [x, y] = palm ? [palm[0] + pose.zoom * (MUZZLE[0] + pose.dx - palm[0]), palm[1] + pose.zoom * (MUZZLE[1] + pose.dy - palm[1])] : MUZZLE;
  const tick = still ? 0 : Math.floor(t / BOIL_S);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 1;

  if (!fired) {
    const grow = smooth(-LIGHT, -GROWN, at);
    const size = 14 + (R - 14) * grow * grow;
    const pulse = still ? 1 : 1 + 0.03 * Math.sin(t * 9);
    blob(ctx, size * pulse, 0.75 + 0.25 * grow, tick);
  } else {
    // 发射：光团一下收紧、褪掉，核心剩一个亮点，光线在两三帧内射满，环紧跟着扩出去。
    const fade = 1 - smooth(0, 0.3, at);
    if (fade > 0) blob(ctx, R * (0.6 - 0.2 * smooth(0, 0.1, at)), fade, tick);
    glow(ctx, 30, [
      [0, tone(SCENE.white, flash)],
      [0.3, tone(SCENE.white, 0.7 * flash)],
      [1, tone(SCENE.core, 0)],
    ]);
    if (flash > 0.01) {
      rays(ctx, Math.round(t - at), 0.75 + 0.25 * smooth(0, 0.08, at), Math.min(1, flash * 1.6));
      ring(ctx, 200 + 1400 * Math.max(0, at - RING_AT), smooth(RING_AT, RING_AT + 0.03, at) * (1 - smooth(RING_AT, RING_AT + 0.35, at)));
      glow(ctx, 640, [
        [0, tone(SCENE.white, 0.35 * flash)],
        [1, tone(SCENE.sky, 0)],
      ]);
    }
  }
  ctx.restore();
}
