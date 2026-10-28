import palette from "./aoko-fx.json";

// 场景配色取自参考帧（img0609 法阵高光、img0663 光丝、img0602 散景、最终预告掌心光团的 pale），是画里的颜色而不是界面色，和 Clawd 的精灵调色板一样放在旁边的 JSON 里。
export const { scene: SCENE, bokeh: BOKEH } = palette;
export const tone = (hex: string, a: number) => hex + (256 + Math.round(Math.max(0, Math.min(1, a)) * 255)).toString(16).slice(1);

// 法阵外圈半径 = 贴图半边长 × RIM，须与 character-art 仓库 scripts/fx/aoko-fx-assets.ts 的 RIM 同步。
export const RIM = 0.98;

export function circle(ctx: CanvasRenderingContext2D, img: CanvasImageSource, r: number) {
  const half = r / RIM;
  ctx.drawImage(img, -half, -half, 2 * half, 2 * half);
}

export const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export type FxState = { power: number; flash: number; t: number; still: boolean };
