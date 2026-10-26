import { FX_ASSET, loadImage } from "./aoko-fx";
import { SCENE, hash, tone } from "./aoko-paint";

// 青子立绘默认不挂，按出科乐美秘技才召唤；B、A 不分大小写。
const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Enter"];
// 停手这么久没按下一个键，推近的镜头退回去。
const IDLE_MS = 2500;
// 最后一键的闪光里镜头退回原位的时长；宇航员等它退完再起飞，不然换到置顶层时会跳一下大小。
export const RELEASE_MS = 400;
// 全屏闪电取自另一段演出里从画面边缘劈进来的六张整帧；法印、冲击星芒与八芒星闪也都是游戏里的演出图层（scripts/aoko-fx-assets.ts 导出）。
const STRIKES = Array.from({ length: 6 }, (_, i) => FX_ASSET(`strike-${i + 1}`));
const SEALS = ["seal-star", "seal-wheel", "burst", "flare"];

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

// 盖在整页之上的闪电层：只在有闪电或白闪时逐帧画，画完就停。
function storm() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:60;pointer-events:none;mix-blend-mode:plus-lighter;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const images: HTMLImageElement[] = [];
  for (const src of STRIKES) void loadImage(src).then((img) => images.push(img), () => undefined);
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
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  return {
    strike(count: number, peak: number, ms: number) {
      const pool = [...images];
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

// 每按对一键：镜头朝立绘要出现的地方推近一点（背景层放大），那里闪一枚法印、背景提亮，整页劈过闪电；越往后推得越近、法印越大、闪电越多越亮。
// 最后一键六道闪电齐下、整页白闪一次，立绘那里炸开冲击星芒。减少动效时只留法印的淡入淡出，不推镜头、不闪。
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
      for (const name of SEALS) void loadImage(FX_ASSET(name)).catch(() => undefined);
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
  const ring = (at: Spot, k: number, sprite: string) => {
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
            { opacity: 0, transform: "scale(.5) rotate(0deg)" },
            { opacity: peak, transform: `scale(.9) rotate(${20 + 40 * k}deg)`, offset: 0.3 },
            { opacity: 0, transform: `scale(${1.1 + 0.3 * k}) rotate(${50 + 90 * k}deg)` },
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
      zoom(1 + 0.08 * k ** 1.3, 420, at);
      flare(0.15 + 0.6 * k, 380 + 400 * k);
      ring(at, k, k < 0.5 ? "seal-star" : "seal-wheel");
      if (!reducedMotion) storm.strike(k < 0.4 ? 1 : k < 0.75 ? 2 : 3, 0.3 + 0.7 * k, 320 + 320 * k);
      clearTimeout(idle);
      idle = setTimeout(() => release(900), IDLE_MS);
    },
    miss: () => release(900),
    burst(at: Spot) {
      const storm = lightning();
      release(RELEASE_MS);
      flare(1.4, 1100);
      ring(at, 1.3, "burst");
      ring(at, 1.1, "flare");
      if (reducedMotion) return;
      storm.strike(STRIKES.length, 1, 1000);
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
