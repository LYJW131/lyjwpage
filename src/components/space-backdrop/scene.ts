import { clawdAstronaut, type FloatTarget } from "./clawd-astronaut";
import { spaceField } from "./space-field";

const CLAWD_PX = 2.7;
const CLAWD_WIDTH = 40 * CLAWD_PX;
// 两侧留白窄于此就不放 Clawd：他会被卡片挡住大半，还把卡片边上的点阵掏空。
const MIN_GUTTER = CLAWD_WIDTH + 72;
const EDGE = 12;
// 背景整层出现是 lyjw 要的慢速渐显，有意长于 DESIGN.md「Motion」的常规时长。Clawd 和星空同时渐显：星空给 Clawd 让出的空洞随星空出现，Clawd 晚到就会先露出一块空白。
const FADE_MS = 2000;

type Side = "left" | "right";

function columnRect(): { left: number; right: number } {
  const column = document.querySelector(".max-w-5xl");
  const rect = column?.getBoundingClientRect();
  return rect && rect.width ? { left: rect.left, right: rect.right } : { left: innerWidth / 2, right: innerWidth / 2 };
}

export function mountSpaceScene(host: HTMLElement) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeIn = (el: HTMLElement) => {
    if (!reducedMotion) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-in-out", fill: "backwards" });
  };
  let side: Side = "left";
  let pointer: { x: number; y: number } | null = null;
  let column = columnRect();
  let actor: ReturnType<typeof clawdAstronaut> | null = null;

  const gutterCenter = (s: Side) => (s === "left" ? column.left / 2 : (column.right + innerWidth) / 2);
  const home = (): FloatTarget => ({ x: gutterCenter(side) / innerWidth, y: 0.62 });
  const boundsX = (): [number, number] => {
    const [lo, hi] = side === "left" ? [EDGE + CLAWD_WIDTH / 2, column.left - EDGE - CLAWD_WIDTH / 2] : [column.right + EDGE + CLAWD_WIDTH / 2, innerWidth - EDGE - CLAWD_WIDTH / 2];
    const center = gutterCenter(side);
    return lo < hi ? [lo / innerWidth, hi / innerWidth] : [center / innerWidth, center / innerWidth];
  };
  const target = (): FloatTarget | null => {
    if (!pointer) return null;
    const inLeft = pointer.x < column.left - EDGE;
    const inRight = pointer.x > column.right + EDGE;
    if (!inLeft && !inRight) return null;
    side = inLeft ? "left" : "right";
    return { x: pointer.x / innerWidth, y: Math.max(0.12, Math.min(0.88, pointer.y / innerHeight)) };
  };

  const syncActor = () => {
    column = columnRect();
    const wide = column.left >= MIN_GUTTER;
    if (wide && !actor) {
      actor = clawdAstronaut(host, { px: CLAWD_PX, home, targetRef: target, boundsX, reducedMotion });
      fadeIn(actor.canvas);
    } else if (!wide && actor) {
      actor.stop();
      actor = null;
    }
  };

  const onPointer = (e: PointerEvent) => {
    pointer = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
  };
  const onLeave = () => {
    pointer = null;
  };
  const field = spaceField(host, {
    spacing: 9,
    reducedMotion,
    avoidRef: () => actor?.getRect() ?? null,
    clickHost: document,
    shouldShoot: (e) => e.target === document.body || e.target === document.documentElement || (e.target instanceof HTMLElement && e.target.tagName === "MAIN"),
  });

  fadeIn(field.canvas);
  syncActor();
  addEventListener("resize", syncActor);
  addEventListener("pointermove", onPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);

  return () => {
    removeEventListener("resize", syncActor);
    removeEventListener("pointermove", onPointer);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    actor?.stop();
    field.stop();
  };
}
