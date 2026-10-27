import { RIM, SCENE, circle, hash, smooth, tone } from "./aoko-paint";

// 脚下的地面法阵就是 img0609（俯视）里那面：外圈 img0640（符文带、星形弦线、印章环）套内盘 img1627（旋刃、中心四枚印章、粗亮边），
// 底下是砖地：本身是暗灰紫，紫色是法阵照出来的，法阵暗了、熄了，那层紫跟着淡，只剩暗底。投到地面时按 img0633（平视远景）那样近大远小。
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
const GLOW_TEX = 160;
const TAU = Math.PI * 2;

// 展开从触地到回落成平时亮度的时长：原片那段 7.75 秒，加上 GAIN 回落的那段。
export const FLOOR_UNFOLD_S = 9.25;

// 展开逐帧照剧场版官方账号「魔法陣体験」那段地面投影（docs/references.md）。原片那面法阵就是内盘 img1627，
// 把原片每一帧按透视拉正回 img1627 的贴图坐标，按半径分圈、对细线与宽块两层做回归，量出每一圈每一刻的亮度：
// 法阵从头到尾是原尺寸、不转，从触地点往外显现（软前沿）；细线与靠中心的宽块跟着前沿出来，外半圈的宽刃先只有三四成亮，
// 等第二道波从半径 0.45 推到外缘才填满；整面糊在光里亮几秒、微微起伏；收尾细线和中心一带暗下去再亮回清晰版。
// 下面的关键帧除 BLUR、GAIN 外就是量出来的值，时间是从触地起的秒数、半径以内盘外缘为 1，中间线性插值；7.75 秒以后都是平时的完整法阵，只剩 GAIN 往下回落。
// 原片没有 img0640 外圈，显现前沿过了内盘外缘就接着往外推，把外圈也显出来。
type Keys = [number, number][];
// 显现前沿（亮到一半处）的半径。
// 过了内盘外缘照原片末段的速度（约每秒一个内盘半径）接着往外推。
const REVEAL: Keys = [[0, -0.1], [0.2, 0.05], [0.55, 0.15], [0.7, 0.25], [0.8, 0.35], [0.88, 0.45], [1.12, 0.55], [1.2, 0.65], [1.35, 0.75], [1.45, 0.85], [1.55, 0.95], [1.62, 1.05], [2.2, 1.7], [2.8, 2.45], [3.1, 3.9]];
// 软边按原片「最早出现光」比「亮到一半」领先约 0.2 定的。
const REVEAL_FEATHER = 0.4;
// 宽刃第二道波的前沿半径；波到之前，半径 FILL_INNER 以外（印以外）的宽块只有 FILL_EARLY 那么亮。
// 回归里中心一带的宽块偏亮，对照画面看是印的粗边和糊开的细线，宽刃本身这时还没亮。
const WAVE: Keys = [[0, 0.3], [2.3, 0.3], [3, 0.9], [3.15, 1.2]];
const WAVE_FEATHER = 0.15;
const FILL_INNER = 0.3;
const FILL_EARLY = 0.15;
// 两层的整体亮度，平时为 1：显现时细线比平稳时亮一截，6–6.6 秒再起一点；收尾细线与宽块暗下去再亮回。
const LINES: Keys = [[0, 1.6], [2.8, 1.5], [4, 1], [6, 0.97], [6.6, 1.07], [6.75, 1.05], [7.25, 0.25], [7.75, 1]];
const FILL: Keys = [[0, 1], [6.75, 1], [7.25, 0.65], [7.75, 1]];
// 糊的程度（1 = 整面换成糊的那份）与额外泛光。原片糊到 6.75 秒，lyjw 嫌长，宽刃填满后就对焦。
const BLUR: Keys = [[0, 1], [3.2, 1], [4, 0], [7.75, 0]];
const BLOOM: Keys = [[0, 0], [0.5, 0.25], [2.75, 0.25], [4.5, 0.2], [6, 0.22], [6.6, 0.28], [7.1, 0], [7.75, 0]];
// 整面的增益：展开时比平时亮（lyjw 要的），定格后用 1.5 秒回落到平时亮度。
const GAIN: Keys = [[0, 1.5], [7.75, 1.5], [9.25, 1]];
// 原片没有外圈；泛光那几秒外圈先压暗，免得粗亮环抢了内盘。
const OUTER: Keys = [[0, 0.6], [6.75, 0.6], [7.75, 1]];
const SPARK_S = 0.5;
// 径向亮度分布按这么多段做成渐变，覆盖到内盘半径的 PROFILE_MAX 倍。
const PROFILE_STEPS = 24;
const PROFILE_MAX = 1.25;
// 外圈那张遮罩的渐变半径（以内盘外缘为 1）要盖到整张纹理的角上。
const OUTER_SPAN = 3.2;
// 糊的那份由两档各占一半（原片糊得比一档缩放更厉害），摊薄了线条，按这个倍数补亮。
const BLUR_GAIN = [0.6, 0.75];
const MID_TEX = 400;
const SPARKS = 14;
// 暗底与照亮的那层同一张砖缝、同一条衰减，叠起来只差颜色。
function brickTexture(color: string) {
  const bricks = document.createElement("canvas");
  bricks.width = bricks.height = BRICK_TEX;
  const b = bricks.getContext("2d")!;
  const lit = b.createRadialGradient(BRICK_TEX / 2, BRICK_TEX / 2, 0, BRICK_TEX / 2, BRICK_TEX / 2, BRICK_TEX / 2);
  // 四成半径内保持亮，往外按 smoothstep 落到零，到边上斜率也归零；线性收尾在透视压扁的远端会显出一道硬边。
  for (let i = 0; i <= 16; i++) lit.addColorStop(i / 16, tone(color, 0.85 * (1 - smooth(0.4, 1, i / 16))));
  b.fillStyle = lit;
  b.fillRect(0, 0, BRICK_TEX, BRICK_TEX);
  b.globalCompositeOperation = "destination-out";
  b.fillStyle = tone(color, 0.6);
  const row = BRICK_R * 0.09;
  for (let y = 0, i = 0; y < BRICK_TEX; y += row, i++) {
    b.fillRect(0, y, BRICK_TEX, 4);
    for (let x = (i % 2) * row; x < BRICK_TEX; x += row * 2.1) b.fillRect(x, y, 3, row);
  }
  return bricks;
}

export function floorTextures(outer: HTMLImageElement, inner: HTMLImageElement, innerFill: HTMLImageElement) {
  const bricks = brickTexture(SCENE.brick);
  const dark = brickTexture(SCENE.brickDark);

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
  return { bricks, dark, tex, inner, fill: split("destination-in"), lines: split("destination-out") };
}

const at = (keys: Keys, t: number) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [b, vb] = keys[i];
    if (t > b) continue;
    const [a, va] = keys[i - 1];
    return va + ((vb - va) * (t - a)) / (b - a);
  }
  return keys[keys.length - 1][1];
};

// 前沿在 edge、软边宽 feather 时，半径 rho 处亮几成。
const front = (rho: number, edge: number, feather: number) => smooth(0, 1, (edge - rho) / feather + 0.5);

// 以 radius 为 1 的径向渐变，按 f(rho) 给 alpha。
function profile(c: CanvasRenderingContext2D, radius: number, f: (rho: number) => number) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, radius * PROFILE_MAX);
  for (let i = 0; i <= PROFILE_STEPS; i++) g.addColorStop(i / PROFILE_STEPS, tone(SCENE.white, f((i / PROFILE_STEPS) * PROFILE_MAX)));
  return g;
}

type Textures = ReturnType<typeof floorTextures>;
type Work = { disc: CanvasRenderingContext2D; layer: CanvasRenderingContext2D; mid: CanvasRenderingContext2D; glow: CanvasRenderingContext2D; up: CanvasRenderingContext2D };

// 展开中的法阵：都画在 scratch 里（原点在圆心、已按 spin 转好），投影仍由 floorPainter 一行行做。返回显现前沿到了砖地的几成与整面增益。
function unfolding(s: CanvasRenderingContext2D, textures: Textures, work: Work, spin: number, base: number, u: number) {
  const { tex, inner, fill, lines } = textures;
  const half = CIRCLE_TEX / 2;
  const t = u * FLOOR_UNFOLD_S;
  const edge = at(REVEAL, t);
  const wave = at(WAVE, t);
  const fillGain = at(FILL, t);

  // 外圈与暗池：前沿过了内盘外缘才显出来。
  s.globalAlpha = base * fillGain * at(OUTER, t);
  s.drawImage(tex, -half, -half);
  s.save();
  s.globalCompositeOperation = "destination-in";
  s.globalAlpha = 1;
  s.fillStyle = profile(s, INNER_R * OUTER_SPAN, (x) => front(x * OUTER_SPAN, edge, REVEAL_FEATHER));
  s.fillRect(-half, -half, CIRCLE_TEX, CIRCLE_TEX);
  s.restore();

  // 内盘两层（alpha 互补）各按自己的径向亮度分布叠进 work.disc，亮度大于 1 时多叠几遍。
  const n = inner.naturalWidth;
  const rr = (n / 2) * RIM;
  const d = work.disc;
  d.setTransform(1, 0, 0, 1, 0, 0);
  d.clearRect(0, 0, n, n);
  const lineShape = (rho: number) => front(rho, edge, REVEAL_FEATHER);
  const fillShape = (rho: number) => lineShape(rho) * (rho < FILL_INNER ? 1 : FILL_EARLY + (1 - FILL_EARLY) * front(rho, wave, WAVE_FEATHER));
  for (const [img, shape, gain] of [[lines, lineShape, at(LINES, t)], [fill, fillShape, fillGain]] as const) {
    const l = work.layer;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "source-over";
    l.globalAlpha = 1;
    l.clearRect(0, 0, n, n);
    l.drawImage(img, 0, 0);
    l.translate(n / 2, n / 2);
    l.globalCompositeOperation = "destination-in";
    l.fillStyle = profile(l, rr, shape);
    l.fillRect(-n / 2, -n / 2, n, n);
    d.globalCompositeOperation = "lighter";
    for (let left = gain; left > 0; left--) {
      d.globalAlpha = Math.min(1, left);
      d.drawImage(l.canvas, 0, 0);
    }
  }
  s.save();
  s.globalAlpha = base;
  s.rotate(-2.6 * spin);
  circle(s, d.canvas, INNER_R);
  s.restore();
  const reach = INNER_R * edge;

  s.globalCompositeOperation = "lighter";
  // 进度 0 是还没开始（召唤白闪里、平时熄灭的暗场），光团要等进度动了才亮。
  const fade = smooth(0, 0.02, u) * (1 - smooth(0.1, SPARK_S, t));
  if (fade > 0) {
    const spark = 1 - (1 - Math.min(1, t / SPARK_S)) ** 3;
    s.globalAlpha = 1;
    const core = INNER_R * (0.15 + 0.25 * spark);
    const seed = s.createRadialGradient(0, 0, 0, 0, 0, core);
    seed.addColorStop(0, tone(SCENE.white, fade));
    seed.addColorStop(0.3, tone(SCENE.ice, 0.6 * fade));
    seed.addColorStop(1, tone(SCENE.sky, 0));
    s.fillStyle = seed;
    s.fillRect(-core, -core, 2 * core, 2 * core);
    for (let i = 0; i < SPARKS; i++) {
      const a = hash(i + 70) * TAU;
      const dist = INNER_R * (0.1 + 0.5 * hash(i + 90)) * spark;
      const r = 0.01 * R * (1 + hash(i + 110));
      const x = Math.cos(a) * dist;
      const y = Math.sin(a) * dist;
      const g = s.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, tone(SCENE.white, fade));
      g.addColorStop(1, tone(SCENE.ice, 0));
      s.fillStyle = g;
      s.fillRect(x - 2 * r, y - 2 * r, 4 * r, 4 * r);
    }
  }

  // 糊：把画好的整面缩小再放大，按 BLUR 换掉清晰的那份（不是叠在清晰线条上），再叠一层更糊的泛光。
  const soft = at(BLUR, t);
  const bloom = at(BLOOM, t);
  if (soft > 0 || bloom > 0) {
    // 缩放都逐级走：一步从 160 放大到 1600，斜线会放出一格格的台阶。
    const { mid, glow, up } = work;
    mid.clearRect(0, 0, MID_TEX, MID_TEX);
    mid.drawImage(s.canvas, 0, 0, MID_TEX, MID_TEX);
    glow.clearRect(0, 0, GLOW_TEX, GLOW_TEX);
    glow.drawImage(mid.canvas, 0, 0, GLOW_TEX, GLOW_TEX);
    // 细线缩到 160 时比一个像素还细，直接放大会沿线断成一颗颗亮珠；错开半格叠四份取平均把它抹匀。
    up.clearRect(0, 0, MID_TEX, MID_TEX);
    up.globalCompositeOperation = "lighter";
    up.globalAlpha = 0.25;
    const k = MID_TEX / GLOW_TEX;
    for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) up.drawImage(glow.canvas, dx * k, dy * k, MID_TEX, MID_TEX);
    s.save();
    s.setTransform(1, 0, 0, 1, 0, 0);
    // globalAlpha 为 0 时浏览器直接跳过这次绘制，destination-in 就清不掉，所以全换成糊的时直接清空。
    const sharp = 1 - soft;
    if (sharp < 0.004) s.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    else if (sharp < 1) {
      s.globalCompositeOperation = "destination-in";
      s.globalAlpha = sharp;
      s.fillStyle = tone(SCENE.white, 1);
      s.fillRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    }
    s.globalCompositeOperation = "lighter";
    for (const [img, a] of [[mid.canvas, soft * BLUR_GAIN[0]], [up.canvas, soft * BLUR_GAIN[1] + bloom]] as const) {
      for (let left = a; left > 0; left--) {
        s.globalAlpha = Math.min(1, left);
        s.drawImage(img, 0, 0, CIRCLE_TEX, CIRCLE_TEX);
      }
    }
    s.restore();
  }
  // 增益超出 1 的部分把整面再叠一遍：同一张画布画到自己身上时浏览器先拷一份再画。
  const gain = at(GAIN, t);
  if (gain > 1) {
    s.save();
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = "lighter";
    s.globalAlpha = Math.min(1, gain - 1);
    s.drawImage(s.canvas, 0, 0);
    s.restore();
  }
  s.globalCompositeOperation = "source-over";
  s.globalAlpha = base;
  return { reach: Math.max(0, Math.min(1, reach / R)), gain };
}

export type FloorSpot = { x: number; y: number; r: number; tilt: number; depth: number };

// 法阵先在自己的纹理里转好，再和不转的砖地一起一行行按深度投到地面。unfold 是展开进度（召唤时、平时重新点亮时），到 1 就是完整法阵；
// alpha 是法阵亮度，砖地上那层紫按它照亮；暗底不低于 ground：召唤时给 0，砖地跟着显现前沿一起出来，平时重放给 1，熄的只是法阵和它照出的紫。条带用 source-over 互相覆盖，
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
  return (ctx: CanvasRenderingContext2D, textures: Textures, spin: number, alpha: number, spot: FloorSpot, unfold = 1, ground = 1) => {
    const { bricks, dark, tex, inner } = textures;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    s.globalAlpha = alpha;
    s.translate(CIRCLE_TEX / 2, CIRCLE_TEX / 2);
    s.rotate(spin);
    let lit = 1;
    let gain = 1;
    if (unfold < 1) {
      work ??= { disc: canvas2d(inner.naturalWidth), layer: canvas2d(inner.naturalWidth), mid: canvas2d(MID_TEX), glow: canvas2d(GLOW_TEX), up: canvas2d(MID_TEX) };
      ({ reach: lit, gain } = unfolding(s, textures, work, spin, alpha, unfold));
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
    const ambient = base * Math.max(ground, lit);
    const light = base * Math.min(1, alpha * gain) * lit;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingQuality = "high";
    for (let row = Math.floor(rowAt(-1)); row < Math.ceil(rowAt(1)); row++) {
      const v0 = vAt(row);
      const v1 = vAt(row + 1);
      if (v1 <= v0) continue;
      const half = (m.a * reach) / (1 - (depth * (v0 + v1)) / 2);
      const sy = ((v0 + 1) / 2) * BRICK_TEX;
      const sh = ((v1 - v0) / 2) * BRICK_TEX;
      ctx.globalAlpha = ambient;
      ctx.drawImage(dark, 0, sy, BRICK_TEX, sh, cx - half, row, 2 * half, 1);
      if (light > 0) {
        ctx.globalAlpha = light;
        ctx.drawImage(bricks, 0, sy, BRICK_TEX, sh, cx - half, row, 2 * half, 1);
      }
      const a0 = Math.max(v0, -CIRCLE_SPAN);
      const a1 = Math.min(v1, CIRCLE_SPAN);
      if (a1 <= a0) continue;
      const w = half * CIRCLE_SPAN;
      ctx.globalAlpha = base;
      ctx.drawImage(scratch, 0, ((a0 / CIRCLE_SPAN + 1) / 2) * CIRCLE_TEX, CIRCLE_TEX, ((a1 - a0) / CIRCLE_SPAN / 2) * CIRCLE_TEX, cx - w, row, 2 * w, 1);
    }
    ctx.restore();
  };
}
