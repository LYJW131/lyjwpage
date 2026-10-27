import { back } from "./aoko-back";
import { ART, FX_ASSET, loadImage, type AokoOptions } from "./aoko-entry";
import { faceDirector, STILL_FACE } from "./aoko-face";
import { figure, PAD, SRC_H, SRC_W } from "./aoko-figure";
import { cannonSince, palmLight } from "./aoko-cannon";
import { front, muzzle } from "./aoko-front";
import { fxState, SHOWN, STILL, type FxState } from "./aoko-fx";
import { dispose } from "./aoko-gl";
import { smooth } from "./aoko-paint";
import type { HandPose } from "./aoko-rings";
import { stage } from "./aoko-stage";

const MAX_WIDTH = 320;
const EDGE = 12;
const FX_OVERHANG = 360;
const FRAME_MS = 1000 / 30;
// 眨眼时序取 Live2D CubismEyeBlink 的默认值（闭 0.1s、停 0.05s、睁 0.15s）并按实测「闭比睁快约四成」微调；间隔随机，免得像钟摆。
const BLINK_CLOSE = 0.09;
const BLINK_HOLD = 0.04;
const BLINK_OPEN = 0.17;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;
const BLINK_GAP: [number, number] = [2.5, 6.5];
const DOUBLE_BLINK_CHANCE = 0.2;
// 召唤时分层显现的总时长（秒）：地面法阵 → 人物从脚下往上显形 → 身后光环 → 手臂环与电弧。
// 人物不做半透明淡入而是逐像素显形（显出来的地方就是不透明的），光环等人物整个显完才亮，所以身后的法阵始终被她挡住。
const REVEAL_S = 3.6;
// 前景泛光的底强度（五级相加，所以要小），蓄力、发射时往上加。
const BLOOM = 0.05;

function lidAt(dt: number) {
  if (dt < 0 || dt >= BLINK_TOTAL) return 0;
  if (dt < BLINK_CLOSE) return (dt / BLINK_CLOSE) ** 2;
  if (dt < BLINK_CLOSE + BLINK_HOLD) return 1;
  return (1 - (dt - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN) ** 2;
}

// 手层在手掌一带（wg=1）的位移，须与 aoko-figure.ts 着色器里的 dh 同步：平移 d，再以掌心为中心放大 zoom。
function handPose(t: number): HandPose {
  const a = 5 * Math.sin(t * 0.8 + 0.4);
  const b = 2 * Math.sin(t * 1.9);
  return { dx: -0.5 * a + 0.4 * b, dy: -a - 0.3 * b, zoom: 1 / (1 - 0.014 * (0.5 + 0.5 * Math.sin(t * 2.4 - 0.8))) };
}

// 闲置时也带一层蓝紫重打光：人站在亮着的法阵里，对照 img0611（原色）与 img0612（被法阵照亮）。
const glowOf = ({ power, flash }: FxState) => 0.32 + 0.55 * power + 0.25 * flash;

const FX = { band: "band", runes: "runes", ring: "ring", octa: "octa", bolt: "bolt", boltFine: "bolt-fine", floorOuter: "floor-outer", floorInner: "floor-inner" } as const;
const loadAll = <K extends string>(srcs: Record<K, string>) =>
  Promise.all(Object.values<string>(srcs).map(loadImage)).then((imgs) => Object.fromEntries(Object.keys(srcs).map((k, i) => [k, imgs[i]])) as Record<K, HTMLImageElement>);

export function aokoStanding(root: HTMLElement, { gutter, reducedMotion = false, summon = false }: AokoOptions) {
  // 一张画布画整个场景：地面、身后光环、立绘、手臂环、电弧都在同一个 three 场景里按次序合成。
  let canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;top:0;";
  root.appendChild(canvas);
  const gl = stage(canvas);

  const faces = faceDirector();
  let stopped = false;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  const gap = () => BLINK_GAP[0] + Math.random() * (BLINK_GAP[1] - BLINK_GAP[0]);
  let blinkAt = 1.5 + Math.random() * 2;
  // 贴图都到了才开始计时，不然头几段渐显落在空画布上。
  let revealAt: number | null = null;
  let scene: { fig: ReturnType<typeof figure>; bk: ReturnType<typeof back> | null; fr: ReturnType<typeof front> | null } | null = null;
  let flat: (() => void) | null = null;

  const draw = (t: number, closed = 0) => {
    if (flat) return flat();
    if (!scene || !gl) return;
    const state = reducedMotion ? STILL : fxState(t);
    const p = revealAt === null ? 1 : (t - revealAt) / REVEAL_S;
    const show = revealAt === null ? SHOWN : { floor: smooth(0, 0.25, p), ring: smooth(0.55, 0.85, p), front: summon && !reducedMotion ? smooth(0.7, 1, p) : 1 };
    const pose = handPose(t);
    const lamp = [...muzzle(pose), palmLight(cannonSince(state)) * show.front];
    scene.fig.update(t, closed, reducedMotion ? STILL_FACE : faces.face(t), glowOf(state), state.flash, smooth(0.12, 0.55, p), lamp);
    scene.bk?.update(state, show);
    scene.fr?.update(state, pose, show.front);
    gl.render(BLOOM * (1 + state.power + 2 * state.flash));
    if (p >= 1) revealAt = null;
  };
  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    // 后台标签回来时 t 会跳很远，直接从现在重新排，不补眨错过的那些。
    if (t > blinkAt + BLINK_TOTAL) {
      const late = t - blinkAt > BLINK_TOTAL + 1;
      blinkAt = late ? t + gap() : blinkAt + BLINK_TOTAL + (Math.random() < DOUBLE_BLINK_CHANCE ? 0.12 : gap());
    }
    const closed = lidAt(t - blinkAt);
    // 眨眼只有约 0.3 秒，这段按刷新率逐帧画，30fps 限帧下眼皮只剩两三帧会显得跳。
    if (!closed && now - last < FRAME_MS) return;
    last = now;
    draw(t, closed);
  };

  let figureRect = { x: 0, y: 0, scale: 1 };
  const layout = () => {
    const { left, right } = gutter();
    const width = Math.min(MAX_WIDTH, right - left - 2 * EDGE, (innerHeight - 48) * (SRC_W / SRC_H));
    const scale = width / SRC_W;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const x = (left + right - width) / 2;
    const bottom = Math.max(8, (innerHeight - SRC_H * scale) * 0.18);
    const oy = innerHeight - bottom - SRC_H * scale;
    figureRect = { x, y: oy, scale };
    // 立绘（含四周 PAD）在页面上的框，截图脚本按它裁。
    root.dataset.figure = [x - PAD * scale, oy - PAD * scale, (SRC_W + 2 * PAD) * scale, (SRC_H + 2 * PAD) * scale].map((n) => n.toFixed(2)).join(",");
    // 画布朝卡片列那侧多铺 FX_OVERHANG：地面法阵伸进卡片背后的那半边在画布这一侧的边缘渐隐，卡片间隙里不露硬边。
    const fxLeft = left > 0 ? Math.max(0, left - FX_OVERHANG) : 0;
    const fxRight = left > 0 ? right : Math.min(innerWidth, right + FX_OVERHANG);
    canvas.style.left = `${fxLeft}px`;
    canvas.style.width = `${fxRight - fxLeft}px`;
    canvas.style.height = `${innerHeight}px`;
    canvas.style.maskImage = `linear-gradient(to ${left > 0 ? "right" : "left"},transparent,#000 120px)`;
    if (flat) {
      canvas.width = Math.round((fxRight - fxLeft) * dpr);
      canvas.height = Math.round(innerHeight * dpr);
    }
    gl?.layout({ left: fxLeft, ox: x, oy, scale, dpr }, fxRight - fxLeft, innerHeight);
    scene?.fig.setScale(scale);
    draw(reducedMotion ? 0 : (performance.now() - t0) / 1000);
  };
  layout();

  // 没有 WebGL2、或着色器编译失败时，退回 2D 画一张静止的原图。
  // 画布已经绑过 WebGL 上下文的再要 2D 上下文只会拿到 null，所以换一张新画布。
  const fallback = (art: HTMLImageElement) => {
    scene = null;
    const next = document.createElement("canvas");
    next.style.cssText = canvas.style.cssText;
    canvas.replaceWith(next);
    canvas = next;
    const ctx = canvas.getContext("2d");
    flat = () => {
      const { x, y, scale } = figureRect;
      const k = canvas.width / parseFloat(canvas.style.width);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(art, (x - parseFloat(canvas.style.left)) * k, y * k, SRC_W * scale * k, SRC_H * scale * k);
    };
    layout();
  };

  // 立绘那几张缺一张就不挂；特效贴图缺一张只是不画特效，法线图缺了手就按朝前的法线打光，立绘照常挂。
  const fxSrcs = Object.fromEntries(Object.entries(FX).map(([k, v]) => [k, FX_ASSET(v)])) as Record<keyof typeof FX, string>;
  void Promise.all([
    loadAll({ art: ART.src, rig: ART.rig, faces: ART.faces, arm: ART.arm, fill: ART.fill }),
    loadImage(ART.normal).catch(() => null),
    loadAll(fxSrcs).catch(() => null),
  ]).then(
    ([art, normal, fx]) => {
      if (stopped) return;
      if (!gl) return fallback(art.art);
      try {
        const fig = figure({ ...art, normal });
        scene = { fig, bk: fx && back(fx, gl.anisotropy), fr: fx && front({ ...fx, arm: art.arm }, gl.anisotropy) };
        if (scene.bk) gl.root.add(scene.bk.group);
        gl.root.add(fig.shadow, fig.mesh);
        if (scene.fr) gl.fore.add(scene.fr.group);
        gl.warm();
        if (summon && !reducedMotion) revealAt = (performance.now() - t0) / 1000;
        layout();
      } catch {
        return fallback(art.art);
      }
      if (gl.failed()) return fallback(art.art);
      if (!reducedMotion) raf = requestAnimationFrame(frame);
    },
    () => undefined,
  );

  return {
    layout,
    notice: () => faces.notice((performance.now() - t0) / 1000),
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      if (gl) {
        dispose(gl.root);
        dispose(gl.fore);
        gl.dispose();
      }
      canvas.remove();
    },
  };
}
