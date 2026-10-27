import { RIM, SCENE, circle, smooth, tone } from "./aoko-paint";

// 脚下的地面法阵就是 img0609（俯视）里那面：外圈 img0640（符文带、星形弦线、印章环）套内盘 img1627（旋刃、中心四枚印章、粗亮边），
// 底下是被法阵照成紫色的砖地。投到地面时按 img0633（平视远景）那样近大远小。
// 砖地铺到法阵外圈半径的 EXTENT 倍，多出来的一圈是砖地的余光。
const EXTENT = 1.6;
const BRICK_TEX = 1280;
const BRICK_R = BRICK_TEX / 2 / EXTENT;
// 法阵单独一张纹理，边长与 floor-outer 贴图一致（须与 scripts/aoko-fx-assets.ts 同步），2 倍屏上投到地面时不再放大。
// 砖地是柔和的渐变和砖缝，低一档的分辨率就够。
const CIRCLE_TEX = 1600;
const R = (CIRCLE_TEX / 2) * RIM;
// img0640 圈内 0.43 R 以内是空的，img0609 里内盘的粗亮边正好贴着这一圈。
const INNER_R = 0.43 * R;
// 法阵纹理在砖地坐标里占的半宽（砖地半宽记作 1）。
const CIRCLE_SPAN = 1 / (EXTENT * RIM);
// 泛光副本先缩到这个边长再放大回去，缩放的插值就是一道够宽的模糊。不用 ctx.filter：WebKit 的 Canvas2D 不认。
const GLOW_TEX = 200;

// 法阵展开的节奏，取自剧场版官方账号「魔法陣体験」那段地面投影（docs/references.md）：触地点先亮一个光点，
// 内盘的旋刃从一点转着长开，外圈从内往外擦出、整面糊在泛光里，泛光退下去才露出符文与弦线。各段是展开进度 0–1 上的区间。
const SEED: [number, number] = [0.04, 0.3];
const BLADES: [number, number] = [0.06, 0.4];
const WIPE: [number, number] = [0.18, 0.62];
const BLOOM_IN: [number, number] = [0.2, 0.5];
const BLOOM_OUT: [number, number] = [0.55, 1];
// 旋刃长开时多转的角度，随长开减速归零。
const BLADE_SWIRL = 2.4;
const FEATHER = 0.14 * R;
// 模糊副本把线条摊薄了，叠几遍才够参考里那种整面发白的泛光。
const BLOOM_PASSES = 2;

export function floorTextures(outer: HTMLImageElement, inner: HTMLImageElement) {
  const bricks = document.createElement("canvas");
  bricks.width = bricks.height = BRICK_TEX;
  const b = bricks.getContext("2d")!;
  const lit = b.createRadialGradient(BRICK_TEX / 2, BRICK_TEX / 2, 0, BRICK_TEX / 2, BRICK_TEX / 2, BRICK_TEX / 2);
  // 四成半径内保持亮，往外按 smoothstep 落到零，到边上斜率也归零；线性收尾在透视压扁的远端会显出一道硬边。
  for (let i = 0; i <= 16; i++) lit.addColorStop(i / 16, tone(SCENE.brick, 0.85 * (1 - smooth(0.4, 1, i / 16))));
  b.fillStyle = lit;
  b.fillRect(0, 0, BRICK_TEX, BRICK_TEX);
  b.globalCompositeOperation = "destination-out";
  b.fillStyle = tone(SCENE.brick, 0.6);
  const row = BRICK_R * 0.09;
  for (let y = 0, i = 0; y < BRICK_TEX; y += row, i++) {
    b.fillRect(0, y, BRICK_TEX, 4);
    for (let x = (i % 2) * row; x < BRICK_TEX; x += row * 2.1) b.fillRect(x, y, 3, row);
  }

  const tex = document.createElement("canvas");
  tex.width = tex.height = CIRCLE_TEX;
  const c = tex.getContext("2d")!;
  c.translate(CIRCLE_TEX / 2, CIRCLE_TEX / 2);
  const pool = c.createRadialGradient(0, 0, 0, 0, 0, R);
  pool.addColorStop(0, tone(SCENE.deep, 0.22));
  pool.addColorStop(1, tone(SCENE.deep, 0.08));
  c.fillStyle = pool;
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = "lighter";
  circle(c, outer, R);

  const small = document.createElement("canvas");
  small.width = small.height = GLOW_TEX;
  const g = small.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(tex, 0, 0, GLOW_TEX, GLOW_TEX);
  const glow = document.createElement("canvas");
  glow.width = glow.height = GLOW_TEX * 4;
  const w = glow.getContext("2d")!;
  w.imageSmoothingQuality = "high";
  w.drawImage(small, 0, 0, glow.width, glow.height);
  return { bricks, tex, inner, glow };
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;

// 展开中的法阵：都画在 scratch 里（原点在圆心、已按 spin 转好），投影仍由 floorPainter 一行行做。
function unfolding(s: CanvasRenderingContext2D, { tex, inner, glow }: ReturnType<typeof floorTextures>, spin: number, alpha: number, u: number) {
  const reach = INNER_R + (R + FEATHER * 1.2 - INNER_R) * easeOut(smooth(WIPE[0], WIPE[1], u));
  const bloom = smooth(BLOOM_IN[0], BLOOM_IN[1], u) * (1 - smooth(BLOOM_OUT[0], BLOOM_OUT[1], u));
  s.drawImage(tex, -CIRCLE_TEX / 2, -CIRCLE_TEX / 2);
  s.globalCompositeOperation = "lighter";
  s.globalAlpha = alpha * bloom;
  for (let i = 0; i < BLOOM_PASSES; i++) s.drawImage(glow, -CIRCLE_TEX / 2, -CIRCLE_TEX / 2, CIRCLE_TEX, CIRCLE_TEX);
  const opening = smooth(WIPE[0] - 0.04, WIPE[0] + 0.04, u);
  s.globalCompositeOperation = "destination-in";
  s.globalAlpha = opening;
  const mask = s.createRadialGradient(0, 0, Math.max(0, reach - FEATHER), 0, 0, reach);
  mask.addColorStop(0, tone(SCENE.white, 1));
  mask.addColorStop(1, tone(SCENE.white, 0));
  s.fillStyle = mask;
  s.fillRect(-CIRCLE_TEX / 2, -CIRCLE_TEX / 2, CIRCLE_TEX, CIRCLE_TEX);

  // 擦出的前沿亮一圈，擦到外缘后随泛光一起退。
  s.globalCompositeOperation = "lighter";
  s.globalAlpha = alpha * opening * (1 - smooth(WIPE[1] - 0.12, WIPE[1] + 0.06, u));
  const rim = s.createRadialGradient(0, 0, Math.max(0, reach - FEATHER), 0, 0, reach);
  rim.addColorStop(0, tone(SCENE.ice, 0));
  rim.addColorStop(0.6, tone(SCENE.ice, 0.55));
  rim.addColorStop(1, tone(SCENE.ice, 0));
  s.fillStyle = rim;
  s.fillRect(-reach, -reach, 2 * reach, 2 * reach);

  const grow = easeOut(smooth(BLADES[0], BLADES[1], u));
  s.globalCompositeOperation = "source-over";
  s.globalAlpha = alpha * smooth(BLADES[0], BLADES[0] + 0.06, u);
  s.rotate(-2.6 * spin - BLADE_SWIRL * (1 - grow) ** 2);
  if (grow > 0) circle(s, inner, INNER_R * grow);
  s.globalCompositeOperation = "lighter";
  s.globalAlpha = alpha * bloom * 0.6;
  if (grow > 0) circle(s, inner, INNER_R * grow);

  const flash = smooth(0, SEED[0], u) * (1 - smooth(SEED[0] + 0.06, SEED[1], u));
  if (flash > 0) {
    const r = INNER_R * (0.25 + 0.5 * grow);
    const seed = s.createRadialGradient(0, 0, 0, 0, 0, r);
    seed.addColorStop(0, tone(SCENE.white, flash));
    seed.addColorStop(0.3, tone(SCENE.ice, 0.6 * flash));
    seed.addColorStop(1, tone(SCENE.sky, 0));
    s.globalAlpha = 1;
    s.fillStyle = seed;
    s.fillRect(-r, -r, 2 * r, 2 * r);
  }
  s.globalCompositeOperation = "source-over";
  return smooth(0, WIPE[1], u);
}

export type FloorSpot = { x: number; y: number; r: number; tilt: number; depth: number };

// 法阵先在自己的纹理里转好，再和不转的砖地一起一行行按深度投到地面。unfold 是展开进度（召唤时、平时重新点亮时），到 1 就是完整法阵。条带用 source-over 互相覆盖，
// 所以地面必须是背景画布清空后画的第一样东西：叠加（lighter）模式下砖缝会从法阵亮线里透出来，压扁后成了横纹。
export function floorPainter() {
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = CIRCLE_TEX;
  const s = scratch.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  return (ctx: CanvasRenderingContext2D, textures: ReturnType<typeof floorTextures>, spin: number, alpha: number, spot: FloorSpot, unfold = 1) => {
    const { bricks, tex, inner } = textures;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    s.globalAlpha = alpha;
    s.translate(CIRCLE_TEX / 2, CIRCLE_TEX / 2);
    s.rotate(spin);
    let lit = 1;
    if (unfold < 1) lit = unfolding(s, textures, spin, alpha, unfold);
    else {
      s.drawImage(tex, -CIRCLE_TEX / 2, -CIRCLE_TEX / 2);
      s.rotate(-2.6 * spin);
      circle(s, inner, INNER_R);
    }

    // 透视按条带拼，每条按自己的深度横向缩放。条带取设备像素的整行、一行一条：条宽一变圆弧两端就是一级台阶，
    // 行高再小就看不出；条带也不能互相盖住，砖地是半透明的，盖住的那一线会叠两遍，整片地面出现细横纹。
    const { x, y, r, tilt, depth } = spot;
    const reach = r * EXTENT;
    const k = (reach * tilt) / depth;
    const m = ctx.getTransform();
    const rowAt = (v: number) => m.d * (y + k * (1 / (1 - depth * v) - 1)) + m.f;
    const vAt = (row: number) => Math.max(-1, Math.min(1, (1 - 1 / (((row - m.f) / m.d - y) / k + 1)) / depth));
    const cx = m.a * x + m.e;
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingQuality = "high";
    for (let row = Math.floor(rowAt(-1)); row < Math.ceil(rowAt(1)); row++) {
      const v0 = vAt(row);
      const v1 = vAt(row + 1);
      if (v1 <= v0) continue;
      const half = (m.a * reach) / (1 - (depth * (v0 + v1)) / 2);
      if (lit < 1) ctx.globalAlpha = base * lit;
      ctx.drawImage(bricks, 0, ((v0 + 1) / 2) * BRICK_TEX, BRICK_TEX, ((v1 - v0) / 2) * BRICK_TEX, cx - half, row, 2 * half, 1);
      const a0 = Math.max(v0, -CIRCLE_SPAN);
      const a1 = Math.min(v1, CIRCLE_SPAN);
      if (a1 <= a0) continue;
      const w = half * CIRCLE_SPAN;
      if (lit < 1) ctx.globalAlpha = base;
      ctx.drawImage(scratch, 0, ((a0 / CIRCLE_SPAN + 1) / 2) * CIRCLE_TEX, CIRCLE_TEX, ((a1 - a0) / CIRCLE_SPAN / 2) * CIRCLE_TEX, cx - w, row, 2 * w, 1);
    }
    ctx.restore();
  };
}
