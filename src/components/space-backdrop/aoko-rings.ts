import { type FxState, SCENE, circle, hash, smooth, tone } from "./aoko-paint";

// 伸出的是左手：前臂从腕口横过胸前通到画面右侧的肘，手腕回折、掌心朝外（握腕的是右手）。
// 套在前臂上的法阵（img0667、img0664）环面垂直于这段前臂，看上去是沿袖子排开的竖向窄椭圆；开口取 img0667 那样约 0.4。
// FOREARM 是底图里那段袖子的中线与半宽，用来遮住环在袖子后面的半圈。
const FOREARM = { from: [405, 368], to: [680, 418], half: 40 } as const;
const ARM_AXIS = Math.atan2(FOREARM.to[1] - FOREARM.from[1], FOREARM.to[0] - FOREARM.from[0]);
const RING_SQUASH = 0.42;
// 三圈大小不一：靠手腕的离镜头近、最大，往肘依次变小，和 img0667 一样；最大那圈的上沿要停在下巴以下，不压到嘴。
const ARM_RINGS = [
  { at: 0.24, r: 108, sprite: "ring", spin: 0.5 },
  { at: 0.54, r: 86, sprite: "octa", spin: -0.45 },
  { at: 0.82, r: 66, sprite: "runes", spin: 0.7 },
] as const;
const ARM_SPOTS = ARM_RINGS.map((ring) => ({
  ...ring,
  x: FOREARM.from[0] + (FOREARM.to[0] - FOREARM.from[0]) * ring.at,
  y: FOREARM.from[1] + (FOREARM.to[1] - FOREARM.from[1]) * ring.at,
}));
// aoko.ts 的着色器按这组椭圆在环附近扭曲立绘（空气折射），环的位置大小只在这里改。
export const ARM_RING_SHAPES = { axis: ARM_AXIS, squash: RING_SQUASH, rings: ARM_SPOTS.map(({ x, y, r }) => ({ x, y, r })) };

// img0667 的环是碎的：每圈几处断口，断口后一小段碎片往外错开，沿环有细碎的电弧毛刺。
// 断口不固定：每处按自己的周期张开再合上，合上后换个随机位置再断（lyjw 要的），张开时断口一带的立绘轻微扭曲（aoko.ts 着色器）。
const GAPS = 3;
const SHARD = 0.16;
const TAU = Math.PI * 2;

type Gap = { at: number; end: number; open: number };
export type RingSprites = Record<(typeof ARM_RINGS)[number]["sprite"], HTMLImageElement>;

// 角度在环自己转动的坐标里；open 为 0 时断口完全合上。
function ringGaps(k: number, t: number): Gap[] {
  return Array.from({ length: GAPS }, (_, j) => {
    const seed = k * 5 + j;
    const clock = t / (2.2 + hash(seed) * 1.8) + hash(seed + 9);
    const round = Math.floor(clock);
    const open = Math.sin(Math.PI * (clock - round)) ** 2;
    const at = hash(seed * 7 + round * 13) * TAU;
    return { at, end: at + (0.1 + hash(seed + round * 3) * 0.16) * open, open };
  }).sort((a, b) => a.at - b.at);
}

// 着色器在断口处扭曲立绘：每个断口给出它在立绘坐标里的位置和张开程度，按环、按断口排成 [x, y, open, …]。
export const RIFTS = ARM_RINGS.length * GAPS;
export function rifts(t: number, out: Float32Array) {
  const cos = Math.cos(ARM_AXIS);
  const sin = Math.sin(ARM_AXIS);
  ARM_SPOTS.forEach((ring, k) => {
    ringGaps(k, t).forEach((gap, j) => {
      const angle = (gap.at + gap.end) / 2 + t * ring.spin;
      const lx = Math.cos(angle) * ring.r * RING_SQUASH;
      const ly = Math.sin(angle) * ring.r;
      const i = (k * GAPS + j) * 3;
      out[i] = ring.x + lx * cos - ly * sin;
      out[i + 1] = ring.y + lx * sin + ly * cos;
      out[i + 2] = gap.open;
    });
  });
  return out;
}

function wedge(ctx: CanvasRenderingContext2D, r: number, from: number, to: number) {
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, from, to);
  ctx.closePath();
}

// 手腕比肘离镜头近，环上离镜头近的半圈在肘那一侧：near 画那半圈（立绘前面），否则画手腕那半圈（之后被手层和袖子擦掉被挡的部分）。
export function armRings(ctx: CanvasRenderingContext2D, sprites: RingSprites, { power, flash, t }: FxState, near: boolean) {
  const tick = Math.floor(t / 0.08);
  ARM_SPOTS.forEach((ring, k) => {
    ctx.save();
    ctx.translate(ring.x, ring.y);
    ctx.rotate(ARM_AXIS);
    ctx.beginPath();
    ctx.rect(near ? 0 : -ring.r * 2, -ring.r * 2, ring.r * 2, ring.r * 4);
    ctx.clip();
    ctx.scale(RING_SQUASH * (1 - 0.4 * flash), 1 + 0.1 * flash);
    ctx.rotate(t * ring.spin);
    const a = Math.min(1, 0.55 + 0.45 * smooth(0.1 + 0.15 * k, 0.5 + 0.15 * k, power) + 0.4 * flash);
    const gaps = ringGaps(k, t);
    const cuts = gaps.map((gap) => ({ from: gap.at, to: gap.end + SHARD * gap.open }));
    const reach = ring.r * 1.4;
    const paint = (alpha: number) => {
      ctx.globalAlpha = alpha;
      circle(ctx, sprites[ring.sprite], ring.r);
      ctx.globalAlpha = alpha * 0.6;
      circle(ctx, sprites[ring.sprite], ring.r);
    };
    ctx.save();
    ctx.beginPath();
    cuts.forEach((cut, j) => {
      const next = j + 1 < cuts.length ? cuts[j + 1].from : cuts[0].from + TAU;
      if (next > cut.to) wedge(ctx, reach, cut.to, next);
    });
    ctx.clip();
    paint(a);
    ctx.restore();
    gaps.forEach((gap, j) => {
      if (gap.open < 0.02) return;
      const mid = gap.end + (SHARD * gap.open) / 2;
      // 碎片随断口张开往外错开，再叠一点快抖，像隔着扭动的空气看。
      const push = ring.r * gap.open * (0.08 + 0.025 * Math.sin(t * 9 + j * 2 + k));
      ctx.save();
      ctx.translate(Math.cos(mid) * push, Math.sin(mid) * push);
      ctx.rotate(0.06 * gap.open * Math.sin(t * 7 + j));
      ctx.beginPath();
      wedge(ctx, reach, gap.end, gap.end + SHARD * gap.open);
      ctx.clip();
      paint(a * 0.85);
      ctx.restore();
    });
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = tone(SCENE.ice, 1);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let c = 0; c < 3; c++) {
      const from = hash(tick * 3 + c + k * 11) * TAU;
      for (let i = 0; i < 7; i++) {
        const angle = from + i * 0.06;
        const jag = ring.r * (1 + (hash(tick * 17 + i + c * 13 + k) - 0.5) * (i % 3 ? 0.08 : 0.22));
        ctx[i ? "lineTo" : "moveTo"](Math.cos(angle) * jag, Math.sin(angle) * jag);
      }
    }
    ctx.stroke();
    ctx.restore();
  });
}

// img0667 环边上一闪一闪的四芒小星。
export function glints(ctx: CanvasRenderingContext2D, t: number, power: number) {
  for (let i = 0; i < 8; i++) {
    const ring = ARM_SPOTS[i % ARM_SPOTS.length];
    const slot = Math.floor(t / 0.9 + hash(i) * 3);
    const life = (t / 0.9 + hash(i) * 3) % 1;
    const angle = hash(slot * 5 + i) * TAU;
    const lx = Math.cos(angle) * ring.r * RING_SQUASH;
    const ly = Math.sin(angle) * ring.r;
    const x = ring.x + lx * Math.cos(ARM_AXIS) - ly * Math.sin(ARM_AXIS);
    const y = ring.y + lx * Math.sin(ARM_AXIS) + ly * Math.cos(ARM_AXIS);
    const size = (8 + hash(slot + i * 3) * 12) * Math.sin(Math.PI * life);
    ctx.globalAlpha = (0.5 + 0.5 * power) * Math.sin(Math.PI * life);
    const dot = ctx.createRadialGradient(x, y, 0, x, y, size * 0.5);
    dot.addColorStop(0, tone(SCENE.white, 0.9));
    dot.addColorStop(1, tone(SCENE.core, 0));
    ctx.fillStyle = dot;
    ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
    ctx.fillStyle = tone(SCENE.white, 0.8);
    ctx.fillRect(x - size, y - 0.5, size * 2, 1);
    ctx.fillRect(x - 0.5, y - size, 1, size * 2);
  }
  ctx.globalAlpha = 1;
}

export type HandPose = { dx: number; dy: number; zoom: number };
export type Hand = { img: HTMLImageElement; box: readonly number[]; palm: readonly number[] };

// 擦掉手层与袖子覆盖的地方，环在手腕那一侧的半圈就落在手和袖子后面、身体前面；手层的摆动按 aoko.ts 的 handPose 跟上。
export function cutArm(ctx: CanvasRenderingContext2D, { img, box, palm }: Hand, { dx, dy, zoom }: HandPose) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  ctx.lineWidth = FOREARM.half * 2;
  ctx.beginPath();
  ctx.moveTo(FOREARM.from[0], FOREARM.from[1]);
  ctx.lineTo(FOREARM.to[0], FOREARM.to[1]);
  ctx.stroke();
  ctx.translate(palm[0], palm[1]);
  ctx.scale(zoom, zoom);
  ctx.translate(dx - palm[0], dy - palm[1]);
  ctx.drawImage(img, box[0], box[1], box[2], box[3]);
  ctx.restore();
}
