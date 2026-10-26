import { FX_ASSET, loadImage } from "./aoko-fx";
import { SCENE, hash, tone } from "./aoko-paint";

// 青子立绘默认不挂，按出科乐美秘技才召唤；B、A 不分大小写。
const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Enter"];
// 停手这么久没按下一个键，推近的镜头退回去。
const IDLE_MS = 2500;
// 最后一键的闪光里镜头退回原位的时长；宇航员等它退完再起飞，不然换到置顶层时会跳一下大小。
export const RELEASE_MS = 400;
// 贴图都是游戏里的演出图层（scripts/aoko-fx-assets.ts 导出）。全屏闪电是另一段演出里从画面边缘劈进来的六张整帧，
// swoop 是横扫的电弧、storm 是电柱与悬浮法环，都铺满整屏画。
const STRIKES = Array.from({ length: 6 }, (_, i) => `strike-${i + 1}`);
// 每个键一张不同的图层，立在立绘要出现的位置：从小光点、星芒到整面法阵、碎晶、能量触须，越往后越大越烈。
// spin 是淡出时转过的角度，from / to 是出现与淡出时相对最终大小的缩放。
const CUES = [
  { sprite: "glint", spin: 0, from: 0.3, to: 1.3 },
  { sprite: "star", spin: 20, from: 0.2, to: 1.4 },
  { sprite: "compass", spin: 45, from: 0.6, to: 1.05 },
  { sprite: "seal-ring", spin: 60, from: 0.5, to: 1.1 },
  { sprite: "vortex", spin: -200, from: 0.4, to: 1.2 },
  { sprite: "seal-star", spin: 90, from: 0.5, to: 1.1 },
  { sprite: "crystals", spin: 15, from: 0.6, to: 1.7 },
  { sprite: "spikes", spin: 0, from: 0.4, to: 1.25 },
  { sprite: "shatter", spin: 25, from: 0.3, to: 1.6 },
  { sprite: "tendrils", spin: 40, from: 0.3, to: 1.5 },
];
type Cue = (typeof CUES)[number];
const WHEEL: Cue = { sprite: "floor-inner", spin: -120, from: 0.5, to: 1.15 };
const FINALE: Cue[] = [
  { sprite: "blast", spin: 0, from: 0.4, to: 1.6 },
  { sprite: "burst", spin: 30, from: 0.3, to: 1.5 },
  { sprite: "flare", spin: 45, from: 0.2, to: 1.8 },
];
const RIFT: Cue = { sprite: "rift", spin: 0, from: 0.2, to: 1.3 };

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// onStep 收到已按对的键数（1 到 SEQUENCE.length − 1），按错一键退到「已按的结尾里最长那段序列开头」，所以连按三次上仍停在第二步。
export function konami(onStep: (count: number, total: number) => void, onMiss: () => void, onDone: () => void) {
  let typed: string[] = [];
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
    const had = typed.length;
    typed = [...typed, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-SEQUENCE.length);
    let n = typed.length;
    while (n > 0 && typed.slice(-n).some((key, i) => key !== SEQUENCE[i])) n--;
    typed = typed.slice(typed.length - n);
    if (n === SEQUENCE.length) {
      typed = [];
      onDone();
    } else if (n > 0) onStep(n, SEQUENCE.length);
    else if (had > 0) onMiss();
  };
  addEventListener("keydown", onKey);
  return () => removeEventListener("keydown", onKey);
}

type Spot = { x: number; y: number };
type Strike = { img: HTMLImageElement; flipX: boolean; flipY: boolean; start: number; ms: number; peak: number; seed: number };

// 盖在整页之上的闪电层：只在有闪电或白闪时挂上、逐帧画，画完就摘掉，不留一张整屏画布一直参与合成。
function storm() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:60;pointer-events:none;mix-blend-mode:plus-lighter;";
  const ctx = canvas.getContext("2d")!;
  const images = new Map<string, HTMLImageElement>();
  for (const name of [...STRIKES, "swoop", "storm"]) void loadImage(FX_ASSET(name)).then((img) => images.set(name, img), () => undefined);
  let strikes: Strike[] = [];
  let white = { start: 0, ms: 1, peak: 0 };
  let raf = 0;
  const frame = (now: number) => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth;
    const H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    strikes = strikes.filter((s) => now - s.start < s.ms);
    for (const s of strikes) {
      const p = (now - s.start) / s.ms;
      if (p < 0) continue;
      // 劈下来一下打满再抖着暗下去；抖动只在六成到满亮之间，不整片明灭（大面积快速明灭对光敏感的人不友好）。
      ctx.globalAlpha = s.peak * Math.min(1, p * 10) * (1 - p) ** 1.5 * (0.6 + 0.4 * hash(Math.floor(now / 70) + s.seed));
      const scale = Math.max(W / s.img.naturalWidth, H / s.img.naturalHeight);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(s.flipX ? -scale : scale, s.flipY ? -scale : scale);
      ctx.drawImage(s.img, -s.img.naturalWidth / 2, -s.img.naturalHeight / 2);
      ctx.restore();
    }
    const w = (now - white.start) / white.ms;
    if (w < 1) {
      ctx.globalAlpha = white.peak * (1 - w) ** 2;
      ctx.fillStyle = tone(SCENE.white, 1);
      ctx.fillRect(0, 0, W, H);
    }
    raf = strikes.length || w < 1 ? requestAnimationFrame(frame) : 0;
    if (!raf) canvas.remove();
  };
  const kick = () => {
    if (!canvas.isConnected) document.body.appendChild(canvas);
    if (!raf) raf = requestAnimationFrame(frame);
  };
  return {
    strike(count: number, peak: number, ms: number, names = STRIKES) {
      const pool = names.flatMap((name) => images.get(name) ?? []);
      const start = performance.now();
      for (let i = 0; i < count && pool.length; i++) {
        const [img] = pool.splice(Math.floor(Math.random() * pool.length), 1);
        strikes.push({ img, flipX: Math.random() < 0.5, flipY: Math.random() < 0.3, start: start + i * 60, ms, peak, seed: Math.random() * 100 });
      }
      kick();
    },
    flash(peak: number, ms: number) {
      white = { start: performance.now(), ms, peak };
      kick();
    },
    stop() {
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}

// 每按对一键：镜头朝立绘要出现的地方推近一点（背景层放大），那里亮起这个键的图层、背景提亮，整页劈过闪电；越往后推得越近、闪电越多越亮。
// B、A 两键另在背景里撕开几道空间裂缝，A 键再加一道横扫电弧。最后一键六道闪电与电柱齐下、整页白闪一次，立绘那里炸开能量爆、冲击星芒和八芒星闪。
// 减少动效时只留图层的淡入淡出，不推镜头、不闪。
export function summonCues(host: HTMLElement, parent: HTMLElement, reducedMotion: boolean) {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;z-index:-10;pointer-events:none;";
  parent.appendChild(layer);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let sky: ReturnType<typeof storm> | null = null;
  const lightning = () => {
    if (!sky) {
      sky = storm();
      for (const { sprite } of [...CUES, WHEEL, ...FINALE, RIFT]) void loadImage(FX_ASSET(sprite)).catch(() => undefined);
    }
    return sky;
  };

  const zoom = (scale: number, ms: number, at?: Spot) => {
    if (reducedMotion) return;
    if (at) host.style.transformOrigin = `${at.x}px ${at.y}px`;
    host.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    host.style.transform = scale === 1 ? "" : `scale(${scale})`;
  };
  const flare = (k: number, ms: number) => {
    if (reducedMotion) return;
    host.animate([{ filter: "brightness(1)" }, { filter: `brightness(${1 + k})`, offset: 0.2 }, { filter: "brightness(1)" }], { duration: ms, easing: "ease-out" });
  };
  const show = (at: Spot, k: number, { sprite, spin, from, to }: Cue) => {
    const size = 160 + 360 * k;
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:${at.x - size / 2}px;top:${at.y - size / 2}px;width:${size}px;height:${size}px;background:center/contain no-repeat url(${FX_ASSET(sprite)});mix-blend-mode:plus-lighter;filter:drop-shadow(0 0 ${6 + 18 * k}px ${tone(SCENE.sky, 0.9)});`;
    layer.appendChild(el);
    const peak = Math.min(1, 0.5 + 0.5 * k);
    const ms = 600 + 700 * k;
    el.animate(
      reducedMotion
        ? [{ opacity: 0 }, { opacity: peak, offset: 0.3 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: `scale(${from}) rotate(0deg)` },
            { opacity: peak, transform: `scale(${(from + 2 * to) / 3}) rotate(${spin * 0.4}deg)`, offset: 0.3 },
            { opacity: 0, transform: `scale(${to}) rotate(${spin}deg)` },
          ],
      { duration: ms, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    );
    // 用定时器而不是 onfinish 收尾：后台标签不出帧时完成事件不派发。
    const timer = setTimeout(() => {
      timers.delete(timer);
      el.remove();
    }, ms + 50);
    timers.add(timer);
  };
  const release = (ms: number) => {
    clearTimeout(idle);
    zoom(1, ms);
  };

  return {
    step(at: Spot, count: number, total: number) {
      const k = count / total;
      const storm = lightning();
      clearTimeout(idle);
      idle = setTimeout(() => release(900), IDLE_MS);
      zoom(1 + 0.08 * k ** 1.3, 420, at);
      flare(0.15 + 0.6 * k, 380 + 400 * k);
      show(at, k, CUES[Math.min(count, CUES.length) - 1]);
      if (count === CUES.length) show(at, k * 1.1, WHEEL);
      if (count >= CUES.length - 1) {
        for (let i = 0; i < count - CUES.length + 3; i++) show({ x: innerWidth * (0.1 + 0.8 * Math.random()), y: innerHeight * (0.15 + 0.7 * Math.random()) }, 0.3 + 0.3 * Math.random(), RIFT);
      }
      if (reducedMotion) return;
      storm.strike(k < 0.4 ? 1 : k < 0.75 ? 2 : 3, 0.3 + 0.7 * k, 320 + 320 * k);
      if (count === CUES.length) storm.strike(1, 0.9, 700, ["swoop"]);
    },
    miss: () => release(900),
    burst(at: Spot) {
      const storm = lightning();
      release(RELEASE_MS);
      flare(1.4, 1100);
      FINALE.forEach((cue, i) => show(at, 1.3 - 0.1 * i, cue));
      if (reducedMotion) return;
      storm.strike(STRIKES.length, 1, 1000);
      storm.strike(1, 1, 1300, ["storm"]);
      storm.flash(0.75, 900);
    },
    stop() {
      clearTimeout(idle);
      for (const timer of timers) clearTimeout(timer);
      host.style.transform = host.style.transition = host.style.transformOrigin = "";
      layer.remove();
      sky?.stop();
    },
  };
}
