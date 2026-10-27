import { RIM, SCENE, circle, hash, smooth, tone } from "./aoko-paint";

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
// 泛光取当帧画好的法阵缩到这个边长再放大回去，缩放的插值就是一道够宽的模糊。不用 ctx.filter：WebKit 的 Canvas2D 不认。
const GLOW_TEX = 200;
const TAU = Math.PI * 2;

// 展开的层次与先后取自剧场版官方账号「魔法陣体験」那段地面投影（docs/references.md）：触地点先亮、溅出火星；
// 内盘的螺旋细线转着从中心长出去、伸出盘外成一圈冲到外缘的长辐条，四枚印依次弹出，宽刃由内往外填满，内盘外环描一圈；
// 外圈再由内到外一层层出来：内环一组描圈、弦线一带擦出、符文带描圈。中段整面糊在泛光里，最后退下去露出细节。
// 各段是展开进度 0–1 上的区间。
type Span = [number, number];
const SPARK: Span = [0, 0.14];
const RAYS: Span = [0.1, 0.36];
const RAYS_STRAIGHTEN: Span = [0.2, 0.55];
const RAYS_OUT: Span = [0.55, 0.78];
const SPIRAL: Span = [0.03, 0.3];
const GROW: Span = [0.03, 0.4];
const SEALS: Span = [0.16, 0.4];
const WEDGES: Span = [0.3, 0.55];
const DISC_RIM: Span = [0.45, 0.62];
const RINGS: Span = [0.55, 0.72];
const CHORDS: Span = [0.62, 0.8];
const RUNES: Span = [0.72, 0.92];
const BLOOM_IN: Span = [0.25, 0.5];
const BLOOM_OUT: Span = [0.6, 1];
// 内盘长开时多转的角度，随长开减速归零。
const SWIRL = 2.4;
// img1627 内盘里量的位置（以内盘外缘半径为 1、纹理坐标 y 朝下）：四枚印的圆心半径、方位（按弹出先后）与印的半径，
// 宽刃到 BLADE_END 为止，再往外是粗外环与菱形印框。
const SEAL_RHO = 0.283;
const SEAL_ANGLES = [-2.9, -1.34, 0.235, 1.82];
const SEAL_SIZE = 0.16;
const BLADE_END = 0.86;
// img0640 外圈的分层（以 R 为 1）：内环一组到 OUTER_RINGS，弦线与小印到 OUTER_CHORDS，再往外是符文带。
const OUTER_RINGS = 0.62;
const OUTER_CHORDS = 0.84;
const SPARKS = 14;
// 伸出盘外的辐条边冲边拉直，外圈各层出来后退掉。条数照参考帧数的，弯度是目测。
const RAY_COUNT = 16;
const RAY_CURL = 0.9;

export function floorTextures(outer: HTMLImageElement, inner: HTMLImageElement, innerFill: HTMLImageElement) {
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

  // 内盘拆成宽块（宽刃、粗外环、印的粗边）和其余（螺旋细线、符文、印里的字）两层；两层 alpha 互补，lighter 叠回去就是原图。
  const split = (op: GlobalCompositeOperation) => {
    const c = document.createElement("canvas");
    c.width = c.height = inner.naturalWidth;
    const x = c.getContext("2d")!;
    x.drawImage(inner, 0, 0);
    x.globalCompositeOperation = op;
    x.drawImage(innerFill, 0, 0, c.width, c.height);
    return c;
  };
  return { bricks, tex, inner, fill: split("destination-in"), lines: split("destination-out") };
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const ease = ([a, b]: Span, u: number) => easeOut(Math.max(0, Math.min(1, (u - a) / (b - a))));

// 只留半径 r0–r1 的圆环；sweep < 1 时只留从 from 角起按 dir 方向扫过的那一段。
function band(c: CanvasRenderingContext2D, r0: number, r1: number, sweep = 1, from = 0, dir = 1) {
  c.beginPath();
  if (sweep >= 1) {
    c.arc(0, 0, r1, 0, TAU);
    c.arc(0, 0, r0, TAU, 0, true);
  } else {
    const to = from + dir * sweep * TAU;
    c.arc(0, 0, r1, from, to, dir < 0);
    c.arc(0, 0, r0, to, from, dir > 0);
    c.closePath();
  }
  c.clip();
}

function sweepHead(c: CanvasRenderingContext2D, r0: number, r1: number, angle: number, a: number) {
  if (a <= 0) return;
  const w = 0.012 * R;
  c.save();
  c.rotate(angle);
  const g = c.createLinearGradient(0, -w, 0, w);
  g.addColorStop(0, tone(SCENE.ice, 0));
  g.addColorStop(0.5, tone(SCENE.white, a));
  g.addColorStop(1, tone(SCENE.ice, 0));
  c.fillStyle = g;
  c.fillRect(r0, -w, r1 - r0, 2 * w);
  c.restore();
}

function wipeFront(c: CanvasRenderingContext2D, r: number, w: number, a: number) {
  if (a <= 0 || r <= 0) return;
  const g = c.createRadialGradient(0, 0, Math.max(0, r - w), 0, 0, r);
  g.addColorStop(0, tone(SCENE.ice, 0));
  g.addColorStop(0.7, tone(SCENE.ice, a));
  g.addColorStop(1, tone(SCENE.ice, 0));
  c.fillStyle = g;
  c.fillRect(-r, -r, 2 * r, 2 * r);
}

type Textures = ReturnType<typeof floorTextures>;
type Work = { disc: CanvasRenderingContext2D; glow: CanvasRenderingContext2D };

// 展开中的内盘：各层拼进 work.disc（内盘原尺寸、原点在圆心）。印、宽刃与螺旋线、外环三块区域互不重叠，
// 全部出齐时用 lighter 叠回去正好是原图。
function unfoldDisc(d: CanvasRenderingContext2D, { inner, fill, lines }: Textures, u: number) {
  const n = inner.naturalWidth;
  const rr = (n / 2) * RIM;
  d.setTransform(1, 0, 0, 1, 0, 0);
  d.clearRect(0, 0, n, n);
  d.translate(n / 2, n / 2);
  d.globalCompositeOperation = "lighter";
  const seal = (i: number): [number, number] => [Math.cos(SEAL_ANGLES[i]) * SEAL_RHO * rr, Math.sin(SEAL_ANGLES[i]) * SEAL_RHO * rr];

  const spiral = ease(SPIRAL, u) * BLADE_END * rr;
  const wedges = ease(WEDGES, u) * BLADE_END * rr;
  for (const [img, reach] of [[lines, spiral], [fill, wedges]] as const) {
    if (reach <= 0) continue;
    d.save();
    d.beginPath();
    d.arc(0, 0, reach, 0, TAU);
    for (let i = 0; i < SEAL_ANGLES.length; i++) {
      const [x, y] = seal(i);
      d.moveTo(x + SEAL_SIZE * rr, y);
      d.arc(x, y, SEAL_SIZE * rr, 0, TAU);
    }
    d.clip("evenodd");
    d.drawImage(img, -n / 2, -n / 2);
    d.restore();
  }
  d.globalCompositeOperation = "lighter";
  wipeFront(d, spiral, 0.08 * rr, 0.5 * (1 - smooth(SPIRAL[1] - 0.06, SPIRAL[1], u)));
  wipeFront(d, wedges, 0.1 * rr, 0.7 * (1 - smooth(WEDGES[1] - 0.06, WEDGES[1], u)));

  const step = (SEALS[1] - SEALS[0]) / (SEAL_ANGLES.length + 1);
  for (let i = 0; i < SEAL_ANGLES.length; i++) {
    const k = ease([SEALS[0] + i * step, SEALS[0] + (i + 2) * step], u);
    if (k <= 0) continue;
    const [x, y] = seal(i);
    d.save();
    d.beginPath();
    d.arc(x, y, SEAL_SIZE * rr, 0, TAU);
    d.clip();
    d.globalAlpha = Math.min(1, k * 2);
    d.translate(x, y);
    d.scale(0.4 + 0.6 * k, 0.4 + 0.6 * k);
    d.drawImage(inner, -n / 2 - x, -n / 2 - y);
    d.restore();
  }

  const rim = ease(DISC_RIM, u);
  if (rim > 0) {
    d.save();
    band(d, BLADE_END * rr, n, rim, -Math.PI / 2);
    d.drawImage(inner, -n / 2, -n / 2);
    d.restore();
    sweepHead(d, BLADE_END * rr, rr, -Math.PI / 2 + rim * TAU, 0.8 * (1 - smooth(0.9, 1, rim)));
  }
}

// 展开中的法阵：都画在 scratch 里（原点在圆心、已按 spin 转好），投影仍由 floorPainter 一行行做。返回砖地该有的亮度。
function unfolding(s: CanvasRenderingContext2D, textures: Textures, work: Work, spin: number, alpha: number, u: number) {
  const { tex } = textures;
  const half = CIRCLE_TEX / 2;
  const layer = (r0: number, r1: number, sweep: number, from: number, dir: number) => {
    if (sweep <= 0) return;
    s.save();
    band(s, r0, r1, sweep, from, dir);
    s.drawImage(tex, -half, -half);
    s.restore();
  };
  s.globalAlpha = alpha * smooth(GROW[0], GROW[1], u);
  layer(0, INNER_R, 1, 0, 1);
  s.globalAlpha = alpha;
  const rings = ease(RINGS, u);
  layer(INNER_R, OUTER_RINGS * R, rings, Math.PI / 2, -1);
  const chords = ease(CHORDS, u);
  layer(OUTER_RINGS * R, OUTER_RINGS * R + (OUTER_CHORDS - OUTER_RINGS) * R * chords, 1, 0, 1);
  const runes = ease(RUNES, u);
  layer(OUTER_CHORDS * R, half * 1.5, runes, -Math.PI / 2, 1);
  s.globalCompositeOperation = "lighter";
  sweepHead(s, INNER_R, OUTER_RINGS * R, Math.PI / 2 - rings * TAU, rings > 0 ? 0.8 * (1 - smooth(0.9, 1, rings)) : 0);
  wipeFront(s, OUTER_RINGS * R + (OUTER_CHORDS - OUTER_RINGS) * R * chords, 0.06 * R, chords > 0 ? 0.6 * (1 - smooth(0.85, 1, chords)) : 0);
  sweepHead(s, OUTER_CHORDS * R, R, -Math.PI / 2 + runes * TAU, runes > 0 ? 0.8 * (1 - smooth(0.9, 1, runes)) : 0);

  const rays = ease(RAYS, u);
  const rayFade = 1 - smooth(RAYS_OUT[0], RAYS_OUT[1], u);
  if (rays > 0 && rayFade > 0) {
    const curl = RAY_CURL * (1 - ease(RAYS_STRAIGHTEN, u));
    const reach = INNER_R * 0.5 + (R * 1.02 - INNER_R * 0.5) * rays;
    s.lineCap = "round";
    for (const [width, color, a] of [[0.06 * R, SCENE.sky, 0.22], [0.028 * R, SCENE.thread, 0.35], [0.011 * R, SCENE.ice, 0.9]] as const) {
      s.lineWidth = width;
      s.strokeStyle = tone(color, a * rayFade);
      s.beginPath();
      for (let i = 0; i < RAY_COUNT; i++) {
        const t = (i / RAY_COUNT) * TAU;
        const mid = (INNER_R * 0.5 + reach) / 2;
        s.moveTo(Math.cos(t) * INNER_R * 0.5, Math.sin(t) * INNER_R * 0.5);
        s.quadraticCurveTo(Math.cos(t + curl * 0.6) * mid, Math.sin(t + curl * 0.6) * mid, Math.cos(t + curl) * reach, Math.sin(t + curl) * reach);
      }
      s.stroke();
    }
  }

  unfoldDisc(work.disc, textures, u);
  const grow = ease(GROW, u);
  s.save();
  s.globalCompositeOperation = "source-over";
  s.globalAlpha = alpha;
  s.rotate(-2.6 * spin - SWIRL * (1 - grow) ** 2);
  if (grow > 0) circle(s, work.disc.canvas, INNER_R * (0.25 + 0.75 * grow));
  s.restore();

  s.globalCompositeOperation = "lighter";
  const spark = ease(SPARK, u);
  const fade = 1 - smooth(SPARK[0] + 0.04, SPARK[1], u);
  if (fade > 0) {
    s.globalAlpha = 1;
    const core = INNER_R * (0.2 + 0.4 * spark);
    const seed = s.createRadialGradient(0, 0, 0, 0, 0, core);
    seed.addColorStop(0, tone(SCENE.white, fade));
    seed.addColorStop(0.3, tone(SCENE.ice, 0.6 * fade));
    seed.addColorStop(1, tone(SCENE.sky, 0));
    s.fillStyle = seed;
    s.fillRect(-core, -core, 2 * core, 2 * core);
    for (let i = 0; i < SPARKS; i++) {
      const a = hash(i + 70) * TAU;
      const d = INNER_R * (0.15 + 1.1 * hash(i + 90)) * spark;
      const r = 0.01 * R * (1 + hash(i + 110));
      const g = s.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r * 2);
      g.addColorStop(0, tone(SCENE.white, fade));
      g.addColorStop(1, tone(SCENE.ice, 0));
      s.fillStyle = g;
      s.fillRect(Math.cos(a) * d - 2 * r, Math.sin(a) * d - 2 * r, 4 * r, 4 * r);
    }
  }

  const bloom = smooth(BLOOM_IN[0], BLOOM_IN[1], u) * (1 - smooth(BLOOM_OUT[0], BLOOM_OUT[1], u));
  if (bloom > 0) {
    const g = work.glow;
    g.clearRect(0, 0, GLOW_TEX, GLOW_TEX);
    g.drawImage(s.canvas, 0, 0, GLOW_TEX, GLOW_TEX);
    s.save();
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = bloom;
    s.drawImage(g.canvas, 0, 0, CIRCLE_TEX, CIRCLE_TEX);
    s.drawImage(g.canvas, 0, 0, CIRCLE_TEX, CIRCLE_TEX);
    s.restore();
  }
  s.globalCompositeOperation = "source-over";
  s.globalAlpha = alpha;
  return smooth(RAYS[0], CHORDS[1], u);
}

export type FloorSpot = { x: number; y: number; r: number; tilt: number; depth: number };

// 法阵先在自己的纹理里转好，再和不转的砖地一起一行行按深度投到地面。unfold 是展开进度（召唤时、平时重新点亮时），到 1 就是完整法阵。条带用 source-over 互相覆盖，
// 所以地面必须是背景画布清空后画的第一样东西：叠加（lighter）模式下砖缝会从法阵亮线里透出来，压扁后成了横纹。
export function floorPainter() {
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = CIRCLE_TEX;
  const s = scratch.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  let work: Work | null = null;
  const canvas2d = (size: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    return x;
  };
  return (ctx: CanvasRenderingContext2D, textures: Textures, spin: number, alpha: number, spot: FloorSpot, unfold = 1) => {
    const { bricks, tex, inner } = textures;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    s.globalAlpha = alpha;
    s.translate(CIRCLE_TEX / 2, CIRCLE_TEX / 2);
    s.rotate(spin);
    let lit = 1;
    if (unfold < 1) {
      work ??= { disc: canvas2d(inner.naturalWidth), glow: canvas2d(GLOW_TEX) };
      lit = unfolding(s, textures, work, spin, alpha, unfold);
    }
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
