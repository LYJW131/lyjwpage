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
const GLOW_TEX = 160;
const TAU = Math.PI * 2;

// 展开从触地到定格的时长。
export const FLOOR_UNFOLD_S = 7;

// 展开的层次与节奏取自剧场版官方账号「魔法陣体験」那段地面投影（docs/references.md），按原片的地面亮度曲线排：
// 触地先亮一团光、溅出火星；旋臂猛地冲开（内盘的螺旋细线转着长出，伸出盘外成一圈冲到外缘的长辐条），然后停住一拍、辐条慢慢拉直；
// 再上一个台阶：四枚印依次弹出，宽刃、内盘外环、外圈由内到外一层层出来（内环一组、弦线一带、符文带）；
// 之后整面糊在泛光里亮着、微微起伏，最后暗下去一下，清晰的细节再亮回来。各层都是淡入加微微放大，互相交叠，不用硬边擦出；
// 整盘同时连续放大、越转越慢，前几秒整面糊着，最后才对焦清楚。
// 区间用秒写，换算成展开进度 0–1。
type Span = [number, number];
const sec = (a: number, b: number): Span => [a / FLOOR_UNFOLD_S, b / FLOOR_UNFOLD_S];
const SPARK = sec(0, 0.7);
const SPIRAL = sec(0.3, 1.6);
const GROW = sec(0.3, 1.6);
const RAYS = sec(0.4, 1.4);
const RAYS_STRAIGHTEN = sec(0.6, 3.6);
const SEALS = sec(1.9, 2.9);
const WEDGES = sec(2.2, 3.4);
const DISC_RIM = sec(2.7, 3.8);
const RINGS = sec(3.1, 4.3);
const CHORDS = sec(3.5, 4.7);
const RUNES = sec(3.9, 5.1);
const RAYS_OUT = sec(3.6, 4.8);
const BLOOM_IN = sec(1.0, 3.2);
const BLOOM_OUT = sec(5.4, 6.2);
const DIM = sec(5.4, 6.0);
const RELIT = sec(6.0, 7.0);
// 整盘从小连续放大到原尺寸，同时多转一段、越转越慢，到定格时多转的角度正好归零。
const ZOOM = sec(0.15, 3.6);
const ZOOM_FROM = 0.12;
const SPIN_EXTRA = 2.2;
// 对焦：前一秒多整面糊在光里，之后半糊着亮几秒，收尾暗下去时对焦到清晰。
const BLUR_EASE = sec(1.2, 3.4);
const BLUR_CLEAR = sec(5.4, 6.6);
// 糊的那两档摊薄了线条，按这个倍数补亮。
const BLUR_GAIN = [1.5, 2.2];
const MID_TEX = 400;
// 泛光那几秒的起伏：周期与幅度。
const BREATH_S = 1.6;
const BREATH = 0.15;
// 暗下去那一下压到的亮度。
const DIM_TO = 0.45;
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
// 伸出盘外的旋臂：根部弯、外段直，弯曲集中在离根 BEND 那么长的一段里；BEND 从比整盘还长缩到很短，
// 旋臂就从整条弯的风车慢慢变成根部一点弯、外面笔直的辐条。外圈各层出来后退掉。条数照参考帧数的，弯度是目测。
const RAY_COUNT = 16;
const RAY_CURL = 1.7;
const RAY_BEND: [number, number] = [1.4, 0.12];
const RAY_STEPS = 28;

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
// 一层在自己的区间里淡入，同时从略小放大到原位。
const appear = ([a, b]: Span, u: number) => smooth(a, b, u);
const settleScale = (span: Span, u: number) => 0.88 + 0.12 * ease(span, u);

// 只留半径 r0–r1 的圆环。
function ring(c: CanvasRenderingContext2D, r0: number, r1: number) {
  c.beginPath();
  c.arc(0, 0, r1, 0, TAU);
  c.arc(0, 0, r0, TAU, 0, true);
  c.clip();
}

// 外圈按半径拆成四圈：池心、内环一组、弦线一带、符文带。相邻两圈在交界 ±BAND_FEATHER 里线性一降一升，
// lighter 叠回去就是原图；每帧在 work.band 上现做，不预存四张整尺寸的图。
const BAND_EDGES = [INNER_R, OUTER_RINGS * R, OUTER_CHORDS * R];
const BAND_FEATHER = 0.04 * R;
function outerBand(t: CanvasRenderingContext2D, tex: HTMLCanvasElement, i: number) {
  const half = CIRCLE_TEX / 2;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = "source-over";
  t.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
  t.drawImage(tex, 0, 0);
  t.globalCompositeOperation = "destination-in";
  const g = t.createRadialGradient(half, half, 0, half, half, CIRCLE_TEX);
  const stop = (r: number, a: number) => g.addColorStop(Math.max(0, Math.min(1, r / CIRCLE_TEX)), tone(SCENE.white, a));
  const lo = BAND_EDGES[i - 1];
  const hi = BAND_EDGES[i];
  if (lo === undefined) stop(0, 1);
  else {
    stop(lo - BAND_FEATHER, 0);
    stop(lo + BAND_FEATHER, 1);
  }
  if (hi === undefined) stop(CIRCLE_TEX, 1);
  else {
    stop(hi - BAND_FEATHER, 1);
    stop(hi + BAND_FEATHER, 0);
  }
  t.fillStyle = g;
  t.fillRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
  return t.canvas;
}

type Textures = ReturnType<typeof floorTextures>;
type Work = { disc: CanvasRenderingContext2D; band: CanvasRenderingContext2D; mid: CanvasRenderingContext2D; glow: CanvasRenderingContext2D; up: CanvasRenderingContext2D };

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

  // 螺旋细线与宽刃（印以外）各自淡入、从略小放大到原位。
  for (const [img, span] of [[lines, SPIRAL], [fill, WEDGES]] as const) {
    const a = appear(span, u);
    if (a <= 0) continue;
    d.save();
    d.globalAlpha = a;
    d.beginPath();
    d.rect(-n / 2, -n / 2, n, n);
    for (let i = 0; i < SEAL_ANGLES.length; i++) {
      const [x, y] = seal(i);
      d.moveTo(x + SEAL_SIZE * rr, y);
      d.arc(x, y, SEAL_SIZE * rr, 0, TAU);
    }
    d.clip("evenodd");
    d.scale(settleScale(span, u), settleScale(span, u));
    d.drawImage(img, -n / 2, -n / 2);
    d.restore();
  }

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

  const rim = appear(DISC_RIM, u);
  if (rim > 0) {
    d.save();
    d.globalAlpha = rim;
    ring(d, BLADE_END * rr, n);
    d.scale(settleScale(DISC_RIM, u), settleScale(DISC_RIM, u));
    d.drawImage(inner, -n / 2, -n / 2);
    d.restore();
  }
}

// 展开中的法阵：都画在 scratch 里（原点在圆心、已按 spin 转好），投影仍由 floorPainter 一行行做。返回砖地该有的亮度。
function unfolding(s: CanvasRenderingContext2D, textures: Textures, work: Work, spin: number, base: number, u: number) {
  const { tex } = textures;
  const half = CIRCLE_TEX / 2;
  const alpha = base * (1 - (1 - DIM_TO) * (smooth(DIM[0], DIM[1], u) - smooth(RELIT[0], RELIT[1], u)));
  const settle = ease([0, 1], u);
  s.save();
  s.scale(ZOOM_FROM + (1 - ZOOM_FROM) * ease(ZOOM, u), ZOOM_FROM + (1 - ZOOM_FROM) * ease(ZOOM, u));
  s.rotate(SPIN_EXTRA * (1 - settle) ** 2);
  s.globalCompositeOperation = "lighter";
  for (const [i, span] of [GROW, RINGS, CHORDS, RUNES].entries()) {
    const a = appear(span, u);
    if (a <= 0) continue;
    const k = i ? settleScale(span, u) : 1;
    s.save();
    s.globalAlpha = alpha * a;
    s.scale(k, k);
    s.drawImage(outerBand(work.band, tex, i), -half, -half);
    s.restore();
  }
  s.globalAlpha = alpha;

  const rays = smooth(RAYS[0], RAYS[1], u) * (1 - smooth(RAYS_OUT[0], RAYS_OUT[1], u));
  if (rays > 0) {
    const bend = R * (RAY_BEND[0] + (RAY_BEND[1] - RAY_BEND[0]) * ease(RAYS_STRAIGHTEN, u));
    const root = INNER_R * 0.3;
    const reach = root + (R * 1.05 - root) * ease(RAYS, u);
    s.lineCap = s.lineJoin = "round";
    for (const [width, color, a] of [[0.07 * R, SCENE.sky, 0.22], [0.03 * R, SCENE.thread, 0.4], [0.012 * R, SCENE.ice, 0.9]] as const) {
      s.lineWidth = width;
      s.strokeStyle = tone(color, a * rays);
      s.beginPath();
      for (let i = 0; i < RAY_COUNT; i++) {
        const t = (i / RAY_COUNT) * TAU;
        for (let j = 0; j <= RAY_STEPS; j++) {
          const r = root + ((reach - root) * j) / RAY_STEPS;
          const angle = t + RAY_CURL * (1 - Math.exp(-(r - root) / bend));
          if (j) s.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
          else s.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        }
      }
      s.stroke();
    }
  }

  unfoldDisc(work.disc, textures, u);
  const grow = ease(GROW, u);
  s.save();
  s.globalCompositeOperation = "source-over";
  s.globalAlpha = alpha * smooth(GROW[0], GROW[1], u);
  s.rotate(-2.6 * spin - SWIRL * (1 - grow) ** 2);
  circle(s, work.disc.canvas, INNER_R);
  s.restore();
  s.restore();

  s.globalCompositeOperation = "lighter";
  const spark = ease(SPARK, u);
  // 进度 0 是还没开始（召唤白闪里、平时熄灭的暗场），光团要等进度动了才亮。
  const fade = smooth(0, 0.02, u) * (1 - smooth(SPARK[0] + 0.04, SPARK[1], u));
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

  // 对焦：把画好的整面缩成两档糊的，按糊的程度换掉清晰的那份（不是叠在清晰线条上），再叠一层起伏的泛光。
  const blur = 1 - 0.5 * smooth(BLUR_EASE[0], BLUR_EASE[1], u) - 0.5 * smooth(BLUR_CLEAR[0], BLUR_CLEAR[1], u);
  const strong = Math.max(0, 2 * blur - 1);
  const soft = blur > 0.5 ? 1 - strong : 2 * blur;
  const breath = 1 + BREATH * Math.sin(((u * FLOOR_UNFOLD_S) / BREATH_S) * TAU);
  const bloom = smooth(BLOOM_IN[0], BLOOM_IN[1], u) * (1 - smooth(BLOOM_OUT[0], BLOOM_OUT[1], u)) * breath;
  if (soft + strong > 0 || bloom > 0) {
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
    const sharp = 1 - soft - strong;
    if (sharp < 0.004) s.clearRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    else if (sharp < 1) {
      s.globalCompositeOperation = "destination-in";
      s.globalAlpha = sharp;
      s.fillStyle = tone(SCENE.white, 1);
      s.fillRect(0, 0, CIRCLE_TEX, CIRCLE_TEX);
    }
    s.globalCompositeOperation = "lighter";
    for (const [img, a] of [[mid.canvas, soft * BLUR_GAIN[0]], [up.canvas, strong * BLUR_GAIN[1]], [up.canvas, bloom], [up.canvas, bloom]] as const) {
      if (a <= 0) continue;
      s.globalAlpha = Math.min(1, a);
      s.drawImage(img, 0, 0, CIRCLE_TEX, CIRCLE_TEX);
      if (a > 1) {
        s.globalAlpha = a - 1;
        s.drawImage(img, 0, 0, CIRCLE_TEX, CIRCLE_TEX);
      }
    }
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
      work ??= { disc: canvas2d(inner.naturalWidth), band: canvas2d(CIRCLE_TEX), mid: canvas2d(MID_TEX), glow: canvas2d(GLOW_TEX), up: canvas2d(MID_TEX) };
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
