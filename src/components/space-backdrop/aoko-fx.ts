// 青子立绘周围的施法场景，复刻《魔法使之夜》那段演出：脚下的地面法阵（img0607/0609，平视远景 img0633 里是脚下一条扁椭圆）、
// 身后的竖直光环与扫向手臂的电弧（img0627–0630）、套在手臂上的法阵（img0664/0667）与发射瞬间的星芒（img0660）。
// 坐标一律是立绘原图像素（934×1873，与 aoko.ts 的 SRC_W/SRC_H 同一套）。
import { floorPainter, floorTextures } from "./aoko-floor";
import { BOKEH, type FxState, SCENE, circle, hash, smooth, tone } from "./aoko-paint";
import { type Hand, type HandPose, armRings, cutArm, glints } from "./aoko-rings";

export type { FxState } from "./aoko-paint";
export type { HandPose } from "./aoko-rings";

export const FX_ASSET = (name: string) => `/mascots/aoko-fx-${name}.webp`;
const FX_NAMES = ["band", "runes", "ring", "octa", "bolt", "bolt-fine", "floor-outer", "floor-inner"];

// 在 img0628-HD（2100×1260）上量的位置，按两眼中点和瞳距换算进立绘：镜头瞳距 196px、立绘 85px。
const SHOT_K = 85 / 196;
const shot = (x: number, y: number): [number, number] => [(x - 1153) * SHOT_K + 488.5, (y - 507) * SHOT_K + 186];
// 身后光环圆心落在掌心一带；亮环外缘半径 940，符文带外缘 740（镜头像素）。
const [RING_X, RING_Y] = shot(936, 860);
const RING_R = 940 * SHOT_K;
const RUNE_R = 740 * SHOT_K;
// 电弧贴图是 2400×1440 的整帧，与 2100×1260 的镜头同框，按镜头左上角整帧铺上。
const [BOLT_X, BOLT_Y] = shot(0, 0);
const BOLT_W = 2100 * SHOT_K;
const BOLT_H = 1260 * SHOT_K;

export const ORB: [number, number] = [368, 318];
const FLARE_ANGLE = -0.5;
// 地面法阵：圆心在两脚之间；压扁比取平视偏高的机位，比 img0633 的近地机位厚；depth 是近大远小的程度（近端比圆心放大 1/(1-depth)）。
// 半径是 lyjw 要的大小：伸到卡片列背后的那半边被挡住也无妨（img0609 里法阵直径有人物身高的数倍，照比例画会出视口）。
const FLOOR = { x: 490, y: 1858, r: 1100, tilt: 0.21, depth: 0.22 };

// 一轮演出：闲置时法阵慢转、电弧偶尔噼啪；CHARGE 起蓄力，FIRE 时星芒一闪，之后回落。
const CYCLE = 20;
const CHARGE = 13;
const FIRE = 16;
const SETTLE = 18.5;

export function fxState(t: number): FxState {
  const c = t % CYCLE;
  const power = c < CHARGE ? 0 : c < FIRE ? ((c - CHARGE) / (FIRE - CHARGE)) ** 2 : 1 - smooth(FIRE, SETTLE, c);
  const flash = c >= FIRE ? Math.exp(-(c - FIRE) * 7) : 0;
  return { power, flash, t, still: false };
}

export const STILL: FxState = { power: 0.55, flash: 0, t: 0, still: true };

// 同一张图只取一次：秘技按到第一个键就开始预取，立绘挂上时拿到的是同一个 promise。取失败的不留，下次重取。
const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string) {
  const cached = images.get(src);
  if (cached) return cached;
  const load = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  images.set(src, load);
  load.catch(() => images.delete(src));
  return load;
}

export const preloadFx = () => FX_NAMES.map((name) => loadImage(FX_ASSET(name)));

// 召唤时分层渐显：地面法阵先亮，身后光环随后，各自 0–1。
export type Reveal = { floor: number; ring: number };
const SHOWN: Reveal = { floor: 1, ring: 1 };

type Sprites = Record<"band" | "runes" | "ring" | "octa", HTMLImageElement> & Record<"bolt" | "boltFine", HTMLCanvasElement>;

// 电弧贴图是镜头整帧，电弧在帧边被截断；搬到立绘旁边后帧边会露成一条直线，所以四边先渐隐。
function fadeFrame(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  const edge = 0.12;
  const across = ctx.createLinearGradient(0, 0, c.width, 0);
  const down = ctx.createLinearGradient(0, 0, 0, c.height);
  for (const g of [across, down]) {
    g.addColorStop(0, tone(SCENE.white, 0));
    g.addColorStop(edge, tone(SCENE.white, 1));
    g.addColorStop(1 - edge, tone(SCENE.white, 1));
    g.addColorStop(1, tone(SCENE.white, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export function aokoFx(back: HTMLCanvasElement, front: HTMLCanvasElement) {
  let sprites: Sprites | null = null;
  let floor: ReturnType<typeof floorTextures> | null = null;
  const paintFloor = floorPainter();
  let view = { left: 0, ox: 0, oy: 0, scale: 1, dpr: 1 };
  let hand: Hand | null = null;

  const begin = (ctx: CanvasRenderingContext2D) => {
    const { left, ox, oy, scale, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox - left), dpr * oy);
    ctx.globalCompositeOperation = "lighter";
  };

  const drawBack = (ctx: CanvasRenderingContext2D, s: Sprites, state: FxState, show: Reveal) => {
    const { power, flash, t } = state;
    begin(ctx);
    ctx.globalAlpha = show.floor;
    if (floor) paintFloor(ctx, floor, t * 0.03, 0.8 + 0.2 * power, FLOOR);
    ctx.globalAlpha = show.ring;

    for (let i = 0; i < 16; i++) {
      const p = (t * (0.08 + hash(i) * 0.1) + hash(i + 40)) % 1;
      const x = FLOOR.x + (hash(i + 7) * 2 - 1) * FLOOR.r * 0.8;
      const y0 = FLOOR.y + (hash(i + 13) - 0.5) * FLOOR.r * FLOOR.tilt - p * 900;
      const h = 120 + hash(i + 21) * 360;
      const a = Math.sin(Math.PI * p) * (0.18 + 0.3 * power);
      const g = ctx.createLinearGradient(0, y0, 0, y0 - h);
      g.addColorStop(0, tone(SCENE.thread, a));
      g.addColorStop(1, tone(SCENE.thread, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 1.5, y0 - h, 3, h);
    }

    for (let i = 0; i < 10; i++) {
      const x = -180 + hash(i + 3) * 1300;
      const y = 900 - ((hash(i + 9) * 1500 + t * (6 + hash(i) * 8)) % 1500);
      const r = 10 + hash(i + 5) * 26;
      const a = (0.1 + 0.18 * hash(i + 11)) * (0.6 + 0.4 * Math.sin(t * 0.9 + i * 2.1));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, tone(BOKEH[i % 4], a));
      g.addColorStop(0.7, tone(BOKEH[i % 4], a * 0.7));
      g.addColorStop(1, tone(BOKEH[i % 4], 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }

    // img0628 的亮环接近白青、外侧带一圈蓝晕：贴图本身偏青，叠两遍再垫一圈光晕。
    const ring = 0.6 + 0.4 * power + 0.3 * flash;
    ctx.save();
    ctx.translate(RING_X, RING_Y);
    const halo = ctx.createRadialGradient(0, 0, RING_R * 0.8, 0, 0, RING_R * 1.18);
    halo.addColorStop(0, tone(SCENE.deep, 0));
    halo.addColorStop(0.5, tone(SCENE.sky, 0.16 + 0.22 * power));
    halo.addColorStop(1, tone(SCENE.deep, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(-RING_R * 1.2, -RING_R * 1.2, RING_R * 2.4, RING_R * 2.4);
    ctx.save();
    ctx.rotate(t * 0.04);
    ctx.globalAlpha = Math.min(1, ring) * show.ring;
    circle(ctx, s.band, RING_R);
    ctx.globalAlpha = Math.min(1, ring * 0.55) * show.ring;
    circle(ctx, s.band, RING_R);
    ctx.restore();
    ctx.globalAlpha = Math.min(1, ring) * show.ring;
    ctx.rotate(-t * 0.07);
    circle(ctx, s.runes, RUNE_R / 0.96);
    ctx.restore();

    // img0628 里穿过圆心的一横一竖两道细线：在光环以内、往两头淡掉，画到环外硬收尾就像一道划痕。
    ctx.globalAlpha = (0.16 + 0.3 * power + 0.4 * flash) * show.ring;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const line = ctx.createLinearGradient(RING_X - dx * RING_R, RING_Y - dy * RING_R, RING_X + dx * RING_R, RING_Y + dy * RING_R);
      line.addColorStop(0, tone(SCENE.white, 0));
      line.addColorStop(0.5, tone(SCENE.white, 1));
      line.addColorStop(1, tone(SCENE.white, 0));
      ctx.fillStyle = line;
      ctx.fillRect(RING_X - dx * RING_R - dy * 0.75, RING_Y - dy * RING_R - dx * 0.75, dx * 2 * RING_R + dy * 1.5, dy * 2 * RING_R + dx * 1.5);
    }
    ctx.globalAlpha = 1;
  };

  const drawFront = (ctx: CanvasRenderingContext2D, s: Sprites, state: FxState, pose: HandPose) => {
    const { power, flash, t, still } = state;
    begin(ctx);
    armRings(ctx, s, state, false);
    if (hand) cutArm(ctx, hand, pose);
    // 闲置时电弧每几秒噼啪一阵，蓄力起持续闪；闪烁按 70ms 一格取随机亮度。
    const win = Math.floor(t / 3.2);
    const burst = (t % 3.2) - hash(win) * 2.4;
    const gate = still ? 0.7 : Math.max(burst > 0 && burst < 0.45 ? 1 : 0, smooth(0.15, 0.4, power));
    if (gate > 0) {
      const tick = Math.floor(t / 0.07);
      const a = gate * (still ? 1 : hash(tick) > 0.25 ? 0.5 + 0.5 * hash(tick + 0.5) : 0.15);
      const b = gate * (still ? 0.8 : hash(tick + 3) > 0.4 ? 0.6 + 0.4 * hash(tick + 9) : 0);
      ctx.globalAlpha = a * (0.6 + 0.4 * power);
      ctx.drawImage(s.bolt, BOLT_X, BOLT_Y, BOLT_W, BOLT_H);
      ctx.globalAlpha = b;
      ctx.drawImage(s.boltFine, BOLT_X, BOLT_Y, BOLT_W, BOLT_H);
    }

    armRings(ctx, s, state, true);
    glints(ctx, t, power);

    const r = 46 + 70 * power + 140 * flash;
    const g = ctx.createRadialGradient(ORB[0], ORB[1], 0, ORB[0], ORB[1], r);
    g.addColorStop(0, tone(SCENE.white, 0.3 + 0.45 * power + 0.25 * flash));
    g.addColorStop(0.35, tone(SCENE.core, 0.18 + 0.3 * power));
    g.addColorStop(1, tone(SCENE.sky, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(ORB[0] - r, ORB[1] - r, 2 * r, 2 * r);

    if (flash > 0.01) {
      ctx.save();
      ctx.translate(ORB[0], ORB[1]);
      for (const [angle, len] of [[FLARE_ANGLE, 520], [FLARE_ANGLE + Math.PI / 2, 360]]) {
        ctx.save();
        ctx.rotate(angle);
        const ray = ctx.createLinearGradient(-len, 0, len, 0);
        ray.addColorStop(0, tone(SCENE.sky, 0));
        ray.addColorStop(0.5, tone(SCENE.white, flash));
        ray.addColorStop(1, tone(SCENE.sky, 0));
        ctx.fillStyle = ray;
        ctx.fillRect(-len, -5 * flash - 1, 2 * len, 10 * flash + 2);
        ctx.restore();
      }
      const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, 640);
      bloom.addColorStop(0, tone(SCENE.white, 0.35 * flash));
      bloom.addColorStop(1, tone(SCENE.sky, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(-640, -640, 1280, 1280);
      ctx.restore();
    }
  };

  const ready = Promise.all(preloadFx()).then(([band, runes, ring, octa, bolt, boltFine, floorOuter, floorInner]) => {
    sprites = { band, runes, ring, octa, bolt: fadeFrame(bolt), boltFine: fadeFrame(boltFine) };
    floor = floorTextures(floorOuter, floorInner);
  })
    // 特效贴图缺一张时只是不画特效，立绘照常挂（aoko.ts 等这个 promise）。
    .catch(() => undefined);

  return {
    ready,
    layout(next: typeof view, width: number, height: number) {
      view = next;
      for (const c of [back, front]) {
        c.width = Math.round(width * next.dpr);
        c.height = Math.round(height * next.dpr);
        c.style.left = `${next.left}px`;
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
      }
    },
    setHand(next: Hand) {
      hand = next;
    },
    render(state: FxState, pose: HandPose, show = SHOWN) {
      if (!sprites) return;
      const b = back.getContext("2d");
      const f = front.getContext("2d");
      if (b) drawBack(b, sprites, state, show);
      if (f) drawFront(f, sprites, state, pose);
    },
  };
}
