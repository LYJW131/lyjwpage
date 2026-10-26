import { type FxState, SCENE, hash, smooth, tone } from "./aoko-paint";

// 伸出的是左手：前臂从腕口横过胸前通到画面右侧的肘，手腕回折、掌心朝外（握腕的是右手）。
// 套在前臂上的法阵（img0667、img0664）环面垂直于这段前臂，看上去是沿袖子排开的竖向窄椭圆；开口取 img0667 那样约 0.4。
// FOREARM 是底图里那段袖子的中线与半宽，用来遮住环在袖子后面的半圈。
const FOREARM = { from: [405, 368], to: [680, 418], half: 40 } as const;
const ARM_AXIS = Math.atan2(FOREARM.to[1] - FOREARM.from[1], FOREARM.to[0] - FOREARM.from[0]);
const RING_SQUASH = 0.42;
// 三圈大小不一（img0667 里也是一大几小）。靠手腕那圈的上沿紧挨下巴，再大就压到嘴，所以最大的放在中间。
const ARM_RINGS = [
  { at: 0.25, r: 100, spin: 0.6, seed: 1 },
  { at: 0.56, r: 140, spin: -0.45, seed: 2 },
  { at: 0.86, r: 78, spin: 0.8, seed: 3 },
] as const;
const ARM_SPOTS = ARM_RINGS.map((ring) => ({
  ...ring,
  x: FOREARM.from[0] + (FOREARM.to[0] - FOREARM.from[0]) * ring.at,
  y: FOREARM.from[1] + (FOREARM.to[1] - FOREARM.from[1]) * ring.at,
}));
// aoko.ts 的着色器按这组椭圆在环附近扭曲、照亮立绘，环的位置大小只在这里改。
export const ARM_RING_SHAPES = { axis: ARM_AXIS, squash: RING_SQUASH, rings: ARM_SPOTS.map(({ x, y, r }) => ({ x, y, r })) };

// 断口不固定：每处按自己的周期张开再合上，合上后换个随机位置再断（lyjw 要的），张开时断口一带有空间波纹。
const GAPS = 3;
const SHARD = 0.16;
const TAU = Math.PI * 2;
const TEX = 512;
const TEX_R = TEX / 2 - 24;

type Gap = { at: number; end: number; open: number };
type RingTex = { crisp: HTMLCanvasElement; glow: HTMLCanvasElement };

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

// img0667 的环：外圈一条又宽又亮的光带，带里镂着一行符文、被几道方口切成几段；里面一两圈断续的细环和刻度，中间是空的。
// 只有中间那圈带一枚齿轮印章。
function ringTexture(seed: number): RingTex {
  const crisp = document.createElement("canvas");
  crisp.width = crisp.height = TEX;
  const c = crisp.getContext("2d")!;
  const R = TEX_R;
  c.translate(TEX / 2, TEX / 2);
  c.fillStyle = tone(SCENE.ice, 0.92);
  c.beginPath();
  c.arc(0, 0, R * 0.95, 0, TAU);
  c.arc(0, 0, R * 0.84, 0, TAU, true);
  c.fill();
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = tone(SCENE.ice, 0.85);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const w = R * (0.012 + hash(seed * 31 + i) * 0.03);
    c.save();
    c.rotate(a);
    c.fillRect(R * 0.875, -w / 2, R * (0.02 + hash(seed + i) * 0.025), w);
    c.restore();
  }
  c.fillStyle = tone(SCENE.ice, 1);
  for (let i = 0; i < 7; i++) {
    c.save();
    c.rotate(hash(seed * 13 + i) * TAU);
    c.fillRect(R * 0.82, -R * 0.012, R * 0.16, R * (0.012 + hash(seed + i * 7) * 0.03));
    c.restore();
  }
  c.globalCompositeOperation = "source-over";
  c.strokeStyle = tone(SCENE.ice, 0.85);
  for (const [r, w, keep] of [
    [0.74, 2.5, 0.75],
    [0.66, 1.5, 0.55],
    [0.99, 1.5, 0.6],
  ]) {
    c.lineWidth = w;
    for (let i = 0; i < 9; i++) {
      const from = (i / 9) * TAU + hash(seed * 7 + i + r) * 0.3;
      c.beginPath();
      c.arc(0, 0, R * r, from, from + (TAU / 9) * keep);
      c.stroke();
    }
  }
  c.lineWidth = 1.5;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const long = i % 4 === 0 ? 0.06 : 0.03;
    c.beginPath();
    c.moveTo(Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76);
    c.lineTo(Math.cos(a) * R * (0.76 + long), Math.sin(a) * R * (0.76 + long));
    c.stroke();
  }
  if (seed === 2) {
    c.save();
    c.translate(Math.cos(0.9) * R * 0.78, Math.sin(0.9) * R * 0.78);
    const g = R * 0.11;
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * TAU;
      const rr = g * (i % 2 ? 1 : 0.86);
      c[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.stroke();
    c.beginPath();
    c.arc(0, 0, g * 0.6, 0, TAU);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.arc(-g * 0.1, 0, g * 0.32, -2, 2.2);
    c.stroke();
    c.restore();
  }
  const glow = document.createElement("canvas");
  glow.width = glow.height = TEX;
  const gl = glow.getContext("2d")!;
  gl.filter = "blur(10px)";
  gl.drawImage(crisp, 0, 0);
  gl.drawImage(crisp, 0, 0);
  gl.filter = "none";
  gl.globalCompositeOperation = "source-in";
  gl.fillStyle = tone(SCENE.sky, 1);
  gl.fillRect(0, 0, TEX, TEX);
  return { crisp, glow };
}

export function ringTextures() {
  return ARM_RINGS.map((ring) => ringTexture(ring.seed));
}

function wedge(ctx: CanvasRenderingContext2D, r: number, from: number, to: number) {
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, from, to);
  ctx.closePath();
}

function stamp(ctx: CanvasRenderingContext2D, tex: RingTex, r: number, alpha: number) {
  const half = (r * TEX) / 2 / (TEX_R * 0.95);
  ctx.globalAlpha = alpha;
  ctx.drawImage(tex.glow, -half, -half, 2 * half, 2 * half);
  ctx.drawImage(tex.crisp, -half, -half, 2 * half, 2 * half);
}

// 手腕比肘离镜头近，环上离镜头近的半圈在肘那一侧：near 画那半圈（立绘前面，亮），否则画手腕那半圈（暗一些，之后被手层和袖子擦掉被挡的部分）。
export function armRings(ctx: CanvasRenderingContext2D, rings: RingTex[], { power, flash, t }: FxState, near: boolean) {
  const tick = Math.floor(t / 0.07);
  ARM_SPOTS.forEach((ring, k) => {
    const tex = rings[k];
    ctx.save();
    ctx.translate(ring.x, ring.y);
    ctx.rotate(ARM_AXIS);
    ctx.beginPath();
    ctx.rect(near ? 0 : -ring.r * 2, -ring.r * 2, ring.r * 2, ring.r * 4);
    ctx.clip();
    ctx.scale(RING_SQUASH * (1 - 0.4 * flash), 1 + 0.1 * flash);
    const spin = t * ring.spin;
    ctx.rotate(spin);
    const a = Math.min(1, (near ? 1 : 0.6) * (0.6 + 0.4 * smooth(0.1 + 0.15 * k, 0.5 + 0.15 * k, power) + 0.4 * flash));
    const gaps = ringGaps(k, t);
    const cuts = gaps.map((gap) => ({ from: gap.at, to: gap.end + SHARD * gap.open }));
    const reach = ring.r * 1.4;
    ctx.save();
    ctx.beginPath();
    cuts.forEach((cut, j) => {
      const next = j + 1 < cuts.length ? cuts[j + 1].from : cuts[0].from + TAU;
      if (next > cut.to) wedge(ctx, reach, cut.to, next);
    });
    ctx.clip();
    // 转得快，往回再盖两层淡的，像 img0667 里环带拖出的残影。
    ctx.save();
    ctx.rotate(-0.05 * Math.sign(ring.spin));
    stamp(ctx, tex, ring.r, a * 0.25);
    ctx.restore();
    stamp(ctx, tex, ring.r, a);
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
      stamp(ctx, tex, ring.r, a * 0.85);
      ctx.restore();
      const cx = Math.cos((gap.at + gap.end) / 2) * ring.r * 0.9;
      const cy = Math.sin((gap.at + gap.end) / 2) * ring.r * 0.9;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = tone(SCENE.ice, 1);
      for (let w = 0; w < 3; w++) {
        const phase = (t * 1.6 + w / 3 + j * 0.37) % 1;
        ctx.globalAlpha = a * gap.open * (1 - phase) * 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r * (0.05 + 0.35 * phase), 0, TAU);
        ctx.stroke();
      }
    });
    // img0667 光带外沿那圈心电图似的电弧毛刺：沿外沿走大半圈，每 70ms 换一次形。
    ctx.globalAlpha = a;
    ctx.strokeStyle = tone(SCENE.white, 0.95);
    ctx.lineWidth = 1.6;
    for (let c = 0; c < 2; c++) {
      const from = hash(tick * 3 + c * 5 + k * 11) * TAU;
      const span = 1.4 + hash(tick + c + k) * 1.6;
      const steps = Math.round(span / 0.05);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const angle = from + (i / steps) * span;
        const spike = hash(tick * 17 + i + c * 101 + k * 7);
        const rr = ring.r * (0.97 + (spike > 0.82 ? (spike - 0.82) * 1.1 : spike * 0.04));
        ctx[i ? "lineTo" : "moveTo"](Math.cos(angle) * rr, Math.sin(angle) * rr);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
}

function onRing(k: number, angle: number, scale = 1): [number, number] {
  const ring = ARM_SPOTS[k];
  const lx = Math.cos(angle) * ring.r * RING_SQUASH * scale;
  const ly = Math.sin(angle) * ring.r * scale;
  return [ring.x + lx * Math.cos(ARM_AXIS) - ly * Math.sin(ARM_AXIS), ring.y + lx * Math.sin(ARM_AXIS) + ly * Math.cos(ARM_AXIS)];
}

// 环与环之间跳的细电弧、四处飘的四芒小星与碎光点（img0667 环周围那些），底下垫一层把手臂一带洗亮的青光。
export function ringSparks(ctx: CanvasRenderingContext2D, t: number, power: number) {
  const mid = ARM_SPOTS[1];
  const wash = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, mid.r * 2.2);
  wash.addColorStop(0, tone(SCENE.sky, 0.12 + 0.14 * power));
  wash.addColorStop(1, tone(SCENE.sky, 0));
  ctx.globalAlpha = 1;
  ctx.fillStyle = wash;
  ctx.fillRect(mid.x - mid.r * 2.2, mid.y - mid.r * 2.2, mid.r * 4.4, mid.r * 4.4);
  const tick = Math.floor(t / 0.09);
  ctx.strokeStyle = tone(SCENE.ice, 0.9);
  ctx.lineWidth = 1.4;
  for (let k = 0; k + 1 < ARM_SPOTS.length; k++) {
    if (hash(tick * 7 + k) < 0.45 - 0.35 * power) continue;
    const side = hash(tick + k * 3) > 0.5 ? -Math.PI / 2 : Math.PI / 2;
    const [x0, y0] = onRing(k, side + (hash(tick * 5 + k) - 0.5) * 0.6, 0.95);
    const [x1, y1] = onRing(k + 1, side + (hash(tick * 9 + k) - 0.5) * 0.6, 0.95);
    ctx.globalAlpha = 0.5 + 0.5 * power;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 1; i < 6; i++) {
      const u = i / 6;
      ctx.lineTo(x0 + (x1 - x0) * u + (hash(tick * 13 + i + k) - 0.5) * 26, y0 + (y1 - y0) * u + (hash(tick * 19 + i + k) - 0.5) * 26);
    }
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const k = i % ARM_SPOTS.length;
    const clock = t / (0.8 + hash(i) * 0.6) + hash(i + 2);
    const round = Math.floor(clock);
    const life = clock - round;
    const [x, y] = onRing(k, hash(round * 5 + i) * TAU, 1 + 0.25 * life * hash(round + i));
    const fade = Math.sin(Math.PI * life);
    const size = (i % 2 ? 4 : 9 + hash(round + i * 3) * 10) * fade;
    ctx.globalAlpha = (0.55 + 0.45 * power) * fade;
    const dot = ctx.createRadialGradient(x, y, 0, x, y, size * 0.6);
    dot.addColorStop(0, tone(SCENE.white, 0.95));
    dot.addColorStop(1, tone(SCENE.core, 0));
    ctx.fillStyle = dot;
    ctx.fillRect(x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2);
    if (i % 2) continue;
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
