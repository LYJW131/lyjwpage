import { FACE_ATLAS } from "./aoko-face";

// 默认页面只带这个文件：贴图预取与懒挂载。three 和立绘渲染在 ./aoko 里，按下秘技第一个键才动态加载。
export const FX_ASSET = (name: string) => `/mascots/aoko-fx-${name}.webp`;
export const FX_NAMES = ["band", "runes", "ring", "octa", "bolt", "bolt-fine", "floor-outer", "floor-inner", "floor-inner-fill"] as const;
export const ART = {
  src: "/mascots/aoko.webp",
  // 绑定图 RGB 分别是头发、裙摆、头部的权重（0 不动，1 摆幅最大），与立绘同框；离线生成，换立绘要一起重出。
  rig: "/mascots/aoko-rig.png",
  faces: FACE_ATLAS,
  // 伸出的手、光球和握腕的右手单独一层，FILL 是同一块里 Codex 补出的手背后内容；NORMAL 是这层手的法线（scripts/aoko-hand-normals.py）。
  arm: "/mascots/aoko-arm.webp",
  fill: "/mascots/aoko-fill.webp",
  normal: "/mascots/aoko-arm-normal.webp",
} as const;

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

const renderer = () => import("./aoko");
export const preloadAoko = () => [...Object.values(ART).map(loadImage), ...FX_NAMES.map((name) => loadImage(FX_ASSET(name))), renderer()];

export type AokoOptions = {
  gutter: () => { left: number; right: number };
  reducedMotion?: boolean;
  summon?: boolean;
};

// 外壳同步建好（场景要马上拿 el 做渐显），渲染模块到了再往里挂画布。
export function mountAoko(parent: HTMLElement, options: AokoOptions) {
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  // 在星空层（opacity-70）之外挂载，立绘不跟着点阵一起变暗。
  root.style.cssText = "position:fixed;inset:0;z-index:-10;pointer-events:none;";
  parent.appendChild(root);
  let stopped = false;
  let inner: ReturnType<Awaited<ReturnType<typeof renderer>>["aokoStanding"]> | null = null;
  renderer().then(
    ({ aokoStanding }) => {
      if (!stopped) inner = aokoStanding(root, options);
    },
    () => undefined,
  );
  return {
    el: root,
    layout: () => inner?.layout(),
    notice: () => inner?.notice(),
    stop() {
      stopped = true;
      inner?.stop();
      root.remove();
    },
  };
}
