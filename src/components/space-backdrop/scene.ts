import { aokoStanding, preloadAoko } from "./aoko";
import { konami, RELEASE_MS, summonCues } from "./aoko-summon";
import { clawdActor, type ClawdCast, type FloatTarget } from "./clawd-actor";
import { astronautCast } from "./casts";
import { CLAWD_PX, EDGE, columnRect } from "./layout";
import { spaceField } from "./space-field";
import { walkerCast } from "./walker";

// 背景整层出现是 lyjw 要的慢速渐显，有意长于 DESIGN.md「Motion」的常规时长。Clawd 和星空同时渐显：星空给 Clawd 让出的空洞随星空出现，Clawd 晚到就会先露出一块空白。
const FADE_MS = 2000;
// 换侧不让 Clawd 从卡片后面横穿过去：淡出、挪到另一侧留白的对应位置、再淡入。
const SWAP_OUT_MS = 240;
const SWAP_IN_MS = 480;
// 左侧留白窄于此就不放青子立绘：再窄人物只剩手掌大，看不清。
const AOKO_MIN_GUTTER = 180;
const FLIGHT_MS = 1600;
// 按出秘技后这一页一直挂着立绘：切主题会重挂整个场景，所以记在模块里；刷新后要重新按。
let unlocked = false;

type Side = "left" | "right";

type Slot = {
  make: () => ClawdCast;
  cast: ClawdCast;
  used: boolean;
  start: Side;
  side: Side;
  // 青子立绘占着左侧留白、两只都挤在右侧时，各自歇在右侧的这个高度（占视口高的比例），上下错开。
  sharedY: number;
  width: number;
  phase: number;
  actor: ReturnType<typeof clawdActor> | null;
  swapping: boolean;
  flying: boolean;
  swapTimer?: ReturnType<typeof setTimeout>;
};

// 每只 Clawd 独占一侧留白：指针进了哪侧，只有那侧的 Clawd 去追；对侧空着才换过去，所以两只不会同在一侧，也都不会被卡片挡住。
// 例外是青子立绘挂在左侧留白时：两只一起待在右侧，上下错开歇着，只让宇航员去追指针。立绘按出秘技才召唤，左侧那只先飞到右侧，立绘再分层渐显。
export function mountSpaceScene(host: HTMLElement) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeIn = (el: HTMLElement) => {
    if (!reducedMotion) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-in-out", fill: "backwards" });
  };
  const slot = (make: () => ClawdCast, side: Side, phase: number, sharedY: number): Slot => {
    const cast = make();
    return { make, cast, used: false, start: side, side, sharedY, phase, width: cast.w * CLAWD_PX, actor: null, swapping: false, flying: false };
  };
  const slots = [slot(astronautCast, "left", 0, 0.34), slot(walkerCast, "right", 37, 0.74)];
  let pointerCursor = false;
  const setCursor = (over: boolean) => {
    if (over === pointerCursor) return;
    pointerCursor = over;
    document.documentElement.style.cursor = over ? "pointer" : "";
  };
  let pointer: { x: number; y: number } | null = null;
  let column = columnRect();
  let headerBottom = 0;
  let aoko: ReturnType<typeof aokoStanding> | null = null;
  let summoning = false;
  let stopped = false;
  const parent = host.parentElement ?? document.body;
  const mountAoko = (summon: boolean) => aokoStanding(parent, { gutter: () => ({ left: 0, right: column.left }), reducedMotion, summon });

  const gutterCenter = (s: Side) => (s === "left" ? column.left / 2 : (column.right + innerWidth) / 2);
  const boundsX = (s: Slot): [number, number] => {
    const half = s.width / 2;
    const [lo, hi] = s.side === "left" ? [EDGE + half, column.left - EDGE - half] : [column.right + EDGE + half, innerWidth - EDGE - half];
    const center = gutterCenter(s.side);
    return lo < hi ? [lo / innerWidth, hi / innerWidth] : [center / innerWidth, center / innerWidth];
  };
  const swapTo = (s: Slot, next: Side) => {
    const current = s.actor;
    if (!current) return;
    const move = () => {
      const [lo, hi] = boundsX(s);
      const t = hi > lo ? (current.getRect().left + s.width / 2) / innerWidth : 0.5;
      s.side = next;
      const [nlo, nhi] = boundsX(s);
      const rel = hi > lo ? Math.max(0, Math.min(1, (t - lo) / (hi - lo))) : 0.5;
      current.place(nlo + (1 - rel) * (nhi - nlo));
    };
    if (reducedMotion) return move();
    s.swapping = true;
    const out = current.canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_OUT_MS, easing: "ease-in", fill: "forwards" });
    // 用定时器而不是 onfinish：页面不出帧时（后台标签）动画的完成事件不会派发，swapping 会一直卡住。
    s.swapTimer = setTimeout(() => {
      s.swapping = false;
      out.cancel();
      if (s.actor !== current) return;
      move();
      current.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_IN_MS, easing: "ease-out" });
    }, SWAP_OUT_MS);
  };
  const target = (s: Slot): FloatTarget | null => {
    if (!pointer || s.swapping || s.flying || summoning) return null;
    const inLeft = pointer.x < column.left - EDGE;
    const inRight = pointer.x > column.right + EDGE;
    if (!inLeft && !inRight) return null;
    const next: Side = inLeft ? "left" : "right";
    if (aoko && (next === "left" || s !== slots[0])) return null;
    if (next !== s.side) {
      if (!slots.some((o) => o !== s && o.actor && o.side === next)) swapTo(s, next);
      return null;
    }
    return { x: pointer.x / innerWidth, y: Math.max(0.12, Math.min(0.88, pointer.y / innerHeight)) };
  };

  const syncActors = () => {
    column = columnRect();
    headerBottom = document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0;
    const aokoWide = unlocked && column.left >= AOKO_MIN_GUTTER;
    if (aokoWide !== !!aoko) {
      // 立绘挂上或卸下时 Clawd 的站位规则跟着变，先都收起来，下面按新规则从默认侧重挂。
      for (const s of slots) {
        clearTimeout(s.swapTimer);
        s.swapping = false;
        s.actor?.stop();
        s.actor = null;
        s.side = s.start;
      }
      setCursor(false);
      if (aoko) {
        aoko.stop();
        aoko = null;
      } else {
        aoko = mountAoko(false);
        fadeIn(aoko.el);
      }
    }
    aoko?.layout();
    for (const s of slots) {
      // 两侧留白窄于此就不放这只 Clawd：他会被卡片挡住大半，还把卡片边上的点阵掏空。
      const wide = column.left >= s.width + 72;
      if (wide && !s.actor) {
        // 先挂上的那只可能已经换到这只的默认侧，挂载时让到对侧，保持一侧一只；立绘在左侧时两只都去右侧。
        if (aoko) s.side = "right";
        else if (slots.some((o) => o !== s && o.actor && o.side === s.side)) s.side = s.side === "left" ? "right" : "left";
        // cast 里的动作与粒子按 actor 自己的计时走，重建 actor 时一并换新的。
        if (s.used) s.cast = s.make();
        s.used = true;
        s.actor = clawdActor(host, {
          ...s.cast,
          phase: s.phase,
          home: () => ({ x: gutterCenter(s.side) / innerWidth, y: aoko ? s.sharedY : 0.62 }),
          targetRef: () => target(s),
          boundsX: () => boundsX(s),
          reducedMotion,
        });
        fadeIn(s.actor.canvas);
      } else if (!wide && s.actor) {
        s.actor.stop();
        s.actor = null;
        setCursor(false);
      }
    }
  };

  // 背景层不接指针事件，点 Clawd 靠在文档上按坐标命中；只认落在页面空白处的点击，和流星同一套判定。
  const onBackdrop = (target: EventTarget | null) =>
    target === document.body || target === document.documentElement || (target instanceof HTMLElement && target.tagName === "MAIN");
  const pokeable = (x: number, y: number) =>
    slots.find((s) => {
      if (!s.actor || !s.cast.poke) return false;
      const r = s.actor.getRect();
      return x >= r.left && x <= r.left + r.w && y >= r.top && y <= r.top + r.h;
    });
  let nearAoko = false;
  const onPointer = (e: PointerEvent) => {
    pointer = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
    const near = !!pointer && pointer.x < column.left - EDGE;
    if (near && !nearAoko) aoko?.notice();
    nearAoko = near;
    setCursor(!!pointer && onBackdrop(e.target) && !!pokeable(e.clientX, e.clientY));
  };
  const onClick = (e: MouseEvent) => {
    if (onBackdrop(e.target)) pokeable(e.clientX, e.clientY)?.cast.poke?.();
  };
  const onLeave = () => {
    pointer = null;
    setCursor(false);
  };
  const field = spaceField(host, {
    spacing: 9,
    reducedMotion,
    avoidRef: () => slots.flatMap((s) => (s.actor ? [s.actor.getRect()] : [])),
    topInset: () => headerBottom,
    clickHost: document,
    shouldShoot: (e) => onBackdrop(e.target) && !pokeable(e.clientX, e.clientY),
  });

  const aokoSpot = () => ({ x: column.left / 2, y: 0.42 * innerHeight });
  const cues = summonCues(host, parent, reducedMotion);
  const summon = async () => {
    unlocked = true;
    stopKonami();
    cues.burst(aokoSpot());
    if (column.left < AOKO_MIN_GUTTER || aoko) return;
    // 立绘马上挂上开始显形，左侧那只同时飞走，不等它飞到位。
    const flier = slots.find((s) => s.actor && s.side === "left");
    aoko = mountAoko(true);
    const actor = flier?.actor;
    if (!flier || !actor) return;
    summoning = true;
    flier.flying = true;
    if (!reducedMotion) await new Promise((r) => setTimeout(r, RELEASE_MS));
    if (flier.actor === actor && !stopped) {
      // 飞越卡片列时挪到卡片之上、顶栏之下的一层，不然大半程躲在卡片后面。
      const lift = document.createElement("div");
      lift.style.cssText = `position:fixed;inset:0;z-index:40;pointer-events:none;opacity:${getComputedStyle(host).opacity};`;
      document.body.appendChild(lift);
      lift.appendChild(actor.canvas);
      flier.side = "right";
      await actor.fly({ x: gutterCenter("right") / innerWidth, y: flier.sharedY }, FLIGHT_MS);
      if (flier.actor === actor && !stopped) host.appendChild(actor.canvas);
      lift.remove();
    }
    flier.flying = false;
    summoning = false;
  };
  let preloading = false;
  const stopKonami = unlocked
    ? () => undefined
    : konami(
        (count, total) => {
          if (!preloading) void Promise.allSettled(preloadAoko());
          preloading = true;
          cues.step(aokoSpot(), count, total);
        },
        () => cues.miss(),
        () => void summon(),
      );

  fadeIn(field.canvas);
  syncActors();
  addEventListener("resize", syncActors);
  addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("click", onClick);
  document.documentElement.addEventListener("pointerleave", onLeave);

  return () => {
    stopped = true;
    stopKonami();
    cues.stop();
    removeEventListener("resize", syncActors);
    removeEventListener("pointermove", onPointer);
    document.removeEventListener("click", onClick);
    setCursor(false);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    for (const s of slots) {
      clearTimeout(s.swapTimer);
      s.actor?.stop();
    }
    aoko?.stop();
    field.stop();
  };
}
