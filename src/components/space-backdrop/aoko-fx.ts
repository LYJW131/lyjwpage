// 青子立绘周围的施法场景，复刻《魔法使之夜》那段演出：脚下的地面法阵（img0607/0609，平视远景 img0633 里是脚下一条扁椭圆）、
// 身后的竖直光环与扫向手臂的电弧（img0627–0630）、套在手臂上的法阵（img0664/0667）与掌心光炮。
// 这里只放节奏和摆位，画法在 aoko-back.ts、aoko-front.ts。坐标一律是立绘原图像素（934×1873，与 aoko.ts 的 SRC_W/SRC_H 同一套）。
import { smooth, type FxState } from "./aoko-paint";

export type { FxState } from "./aoko-paint";

// 在 img0628-HD（2100×1260）上量的位置，按两眼中点和瞳距换算进立绘：镜头瞳距 196px、立绘 85px。
const SHOT_K = 85 / 196;
const shot = (x: number, y: number): [number, number] => [(x - 1153) * SHOT_K + 488.5, (y - 507) * SHOT_K + 186];
export const [RING_X, RING_Y] = shot(936, 860);
export const RING_R = 940 * SHOT_K;
export const RUNE_R = 740 * SHOT_K;
// 电弧贴图是 2400×1440 的整帧，与 2100×1260 的镜头同框，按镜头左上角整帧铺上。
export const [BOLT_X, BOLT_Y] = shot(0, 0);
export const BOLT_W = 2100 * SHOT_K;
export const BOLT_H = 1260 * SHOT_K;

export const ORB: [number, number] = [368, 318];
// 地面法阵：圆心在两脚之间；压扁比取平视偏高的机位，比 img0633 的近地机位厚；depth 是近大远小的程度（近端比圆心放大 1/(1-depth)）。
// 半径是 lyjw 要的大小：伸到卡片列背后的那半边被挡住也无妨（img0609 里法阵直径有人物身高的数倍，照比例画会出视口）。
// aoko-stage.ts 的相机由这组数反推（眼高、距离），改这里地面和相机一起变。
export const FLOOR = { x: 490, y: 1858, r: 1100, tilt: 0.21, depth: 0.22 };
// 砖地铺到法阵外圈半径的 EXTENT 倍，多出来的一圈是砖地的余光。
export const EXTENT = 1.6;

export const CYCLE = 20;
export const CHARGE = 13;
export const FIRE = 16;
const SETTLE = 18.5;

export function fxState(t: number): FxState {
  const c = t % CYCLE;
  const power = c < CHARGE ? 0 : c < FIRE ? ((c - CHARGE) / (FIRE - CHARGE)) ** 2 : 1 - smooth(FIRE, SETTLE, c);
  const flash = c >= FIRE ? Math.exp(-(c - FIRE) * 7) : 0;
  return { power, flash, t, still: false };
}

export const STILL: FxState = { power: 0.55, flash: 0, t: 0, still: true };

// 身后光环的胀缩：周期比她的呼吸（4.4 秒）慢一倍多、幅度只有 1.5%，只求「微微在动」，调大就抢人物的戏。
export const RING_SWELL_S = 9;
export const RING_SWELL = 0.015;

// 召唤时分层渐显：地面法阵先亮，身后光环随后，前景（手臂环、电弧、光球）最后，各自 0–1。
export type Reveal = { floor: number; ring: number; front: number };
export const SHOWN: Reveal = { floor: 1, ring: 1, front: 1 };
