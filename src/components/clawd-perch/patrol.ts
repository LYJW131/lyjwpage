import config from "./clawd-perch.json";
import {
  CENTER,
  FEET,
  buildGazeMap,
  clampDip,
  fitStage,
  gazeFrame,
  loadAnim,
  onLoaded,
  reducedMotion,
  stageBox,
} from "./stage";

import type { AnimationItem } from "lottie-web";
import type { Footprint, GazeMap } from "./stage";

const { speed, edgeMin, walkMs, lookMs, resumeMs, noticePx, noticeDelayMs, noticeLeaveMs } = config.patrol;
// clawd-walking.json：0–4 帧起步，8–24 帧是一步一步走的循环；clawd-looking.json 的帧是眼睛看向各个方向；Clawd-Turning.json 15→22 帧是向左转身到向右，倒放就是反过来。
const START = [0, 4];
const STRIDE = [8, 24];
const TURN = [15, 22];

export type Patrol = ReturnType<typeof clawdPatrol>;

export function clawdPatrol(host: HTMLElement, bodyPx: number, { startRight = true, dir0 = -1 } = {}) {
  const reduced = reducedMotion();
  const walkStage = stageBox(bodyPx);
  const stageW = parseInt(walkStage.style.width, 10);
  const stageH = parseInt(walkStage.style.height, 10);
  walkStage.style.willChange = "transform";
  host.appendChild(walkStage);

  let walkAnim: AnimationItem | null = null;
  let stopped = false;
  let paused = false;
  let walking = false;
  let striding = false;
  let dir = dir0;
  let x = startRight ? Math.max(0, host.clientWidth - stageW) : 0;
  walkStage.style.left = `${x}px`;

  const face = () => {
    walkStage.style.transform = dir < 0 ? "scaleX(-1)" : "none";
  };
  const bodyX = () => x + (dir < 0 ? 1 - CENTER : CENTER) * stageW;
  // 换到别的动画时，按那段动画量出的身体中心和脚底摆舞台，脚踩回走路舞台的同一点。
  const pin = (stage: HTMLElement, fp: Footprint, mirror: boolean) => {
    stage.style.transform = mirror ? "scaleX(-1)" : "none";
    stage.style.left = `${Math.round(bodyX() - (mirror ? 1 - fp.cx : fp.cx) * fp.w)}px`;
    stage.style.bottom = `${clampDip(Math.round(stageH * (1 - FEET) - fp.h * (1 - fp.feet)))}px`;
  };

  const lookStage = stageBox(bodyPx);
  lookStage.style.visibility = "hidden";
  host.appendChild(lookStage);
  let lookAnim: AnimationItem | null = null;
  let gaze: GazeMap | null = null;
  let lookFp: Footprint = { cx: CENTER, feet: FEET, w: stageW, h: stageH };

  const turnStage = stageBox(bodyPx);
  turnStage.style.visibility = "hidden";
  host.appendChild(turnStage);
  let turnAnim: AnimationItem | null = null;
  let turnFp: Footprint | null = null;
  let turning = false;
  let turnDone: (() => void) | null = null;

  const startWalk = () => {
    walking = true;
    striding = false;
    hideLook();
    face();
    if (walkAnim) {
      walkAnim.loop = false;
      walkAnim.playSegments(START as [number, number], true);
    }
  };
  const stopWalk = (look = true) => {
    walking = false;
    striding = false;
    if (walkAnim) {
      walkAnim.stop();
      walkAnim.goToAndStop(0, true);
    }
    if (look && lookAnim && gaze && !reduced) {
      pin(lookStage, lookFp, false);
      lookStage.style.visibility = "";
      walkStage.style.visibility = "hidden";
      lookAnim.goToAndStop(0, true);
    }
  };
  const hideLook = () => {
    lookAnim?.stop();
    lookStage.style.visibility = "hidden";
    walkStage.style.visibility = "";
  };

  void loadAnim(lookStage, "clawd-looking.json").then((anim) => {
    if (stopped) return anim.destroy();
    lookAnim = anim;
    onLoaded(anim, () => {
      try {
        gaze = buildGazeMap(lookStage, anim);
        const w = Math.round(bodyPx / gaze.fracW);
        lookFp = { cx: gaze.cx, feet: gaze.feet, w, h: Math.round(w * (stageH / stageW)) };
        lookStage.style.width = `${lookFp.w}px`;
        lookStage.style.height = `${lookFp.h}px`;
        anim.resize();
      } catch {
        gaze = null;
      }
      anim.goToAndStop(0, true);
    });
  });

  void loadAnim(turnStage, "acts/Clawd-Turning.json").then((anim) => {
    if (stopped) return anim.destroy();
    turnAnim = anim;
    onLoaded(anim, () => {
      try {
        turnFp = fitStage(turnStage, anim, bodyPx, TURN[0]);
      } catch {
        turnFp = null;
      }
    });
  });

  let gazePending = false;
  let lastMouse: MouseEvent | null = null;
  const aim = () => {
    if (gazePending || !lastMouse) return;
    gazePending = true;
    requestAnimationFrame(() => {
      gazePending = false;
      if (!gaze || !lookAnim || !lastMouse || walking || lookStage.style.visibility === "hidden") return;
      const r = lookStage.getBoundingClientRect();
      lookAnim.goToAndStop(gazeFrame(gaze, lastMouse.clientX - (r.left + r.width / 2), lastMouse.clientY - (r.top + 0.45 * r.height)), true);
    });
  };
  // 原版只在踱步间隙的张望里跟光标，光标凑过来时它多半在走、看不出来；光标在身边待上 noticeDelayMs 它才注意到、停下盯着看，离开一会儿再接着走。
  let noticing = false;
  let near = false;
  let noticeTimer = 0;
  const engage = () => {
    if (stopped || paused || !near) return;
    noticing = true;
    if (turning) return;
    if (walking || lookStage.style.visibility === "hidden") {
      stopWalk();
      aim();
    }
    nextAt = Infinity;
  };
  const notice = (e: MouseEvent) => {
    if (stopped || paused || reduced || !gaze) return;
    const r = host.getBoundingClientRect();
    near = Math.hypot(e.clientX - (r.left + bodyX()), e.clientY - (r.bottom - 0.25 * stageH)) < noticePx;
    if (near) {
      if (noticing) engage();
      else if (!noticeTimer)
        noticeTimer = window.setTimeout(() => {
          noticeTimer = 0;
          engage();
        }, noticeDelayMs);
    } else {
      clearTimeout(noticeTimer);
      noticeTimer = 0;
      if (!noticing) return;
      noticing = false;
      nextAt = performance.now() + noticeLeaveMs;
    }
  };

  const onMouse = (e: MouseEvent) => {
    lastMouse = e;
    notice(e);
    if (stopped || walking || !gaze || !lookAnim || lookStage.style.visibility === "hidden") return;
    aim();
  };
  addEventListener("mousemove", onMouse, { passive: true });

  const turnAround = (next: number) => {
    if (!turnAnim || !turnFp || reduced || turning) {
      dir = next;
      face();
      return;
    }
    turning = true;
    walking = false;
    striding = false;
    walkAnim?.stop();
    walkAnim?.goToAndStop(0, true);
    pin(turnStage, turnFp, false);
    turnStage.style.visibility = "";
    walkStage.style.visibility = "hidden";
    const anim = turnAnim;
    const done = () => {
      anim.removeEventListener("complete", done);
      turnDone = null;
      turnStage.style.visibility = "hidden";
      if (stopped || !turning) return;
      walkStage.style.visibility = "";
      turning = false;
      dir = next;
      startWalk();
    };
    turnDone = done;
    anim.addEventListener("complete", done);
    anim.playSegments((dir > 0 ? TURN : [TURN[1], TURN[0]]) as [number, number], true);
  };

  void loadAnim(walkStage, "clawd-walking.json", true).then((anim) => {
    if (stopped) return anim.destroy();
    walkAnim = anim;
    onLoaded(anim, () => {
      if (paused) return anim.goToAndStop(0, true);
      if (reduced || host.clientWidth - stageW < edgeMin) stopWalk();
      else startWalk();
    });
    anim.addEventListener("complete", () => {
      if (!walking) return;
      striding = true;
      anim.playSegments(STRIDE as [number, number], true);
    });
    let lastFrame = -1;
    anim.addEventListener("enterFrame", () => {
      if (!walking || !striding || stopped) return;
      const frame = Math.floor(anim.currentFrame);
      if (frame === lastFrame) return;
      lastFrame = frame;
      const max = Math.max(0, host.clientWidth - stageW);
      let bounce = 0;
      x += (speed / 12) * dir;
      if (x <= 0) {
        x = 0;
        bounce = 1;
      } else if (x >= max) {
        x = max;
        bounce = -1;
      }
      walkStage.style.left = `${x}px`;
      if (bounce) turnAround(bounce);
    });
  });

  const between = ([base, spread]: number[]) => base + spread * Math.random();
  let nextAt = performance.now() + between(walkMs);
  let raf = 0;
  const tick = (now: number) => {
    if (stopped) return;
    if (!reduced && now >= nextAt && !turning) {
      if (walking) {
        stopWalk();
        nextAt = now + between(lookMs);
      } else if (host.clientWidth - stageW >= edgeMin) {
        startWalk();
        nextAt = now + between(walkMs);
      } else nextAt = now + 1600;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    stageW,
    stageH,
    walkStage,
    lookStage,
    bodyX,
    pin,
    facing: () => dir,
    getX: () => x,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(noticeTimer);
      removeEventListener("mousemove", onMouse);
      walkAnim?.destroy();
      lookAnim?.destroy();
      turnAnim?.destroy();
      walkStage.remove();
      lookStage.remove();
      turnStage.remove();
    },
    pause() {
      paused = true;
      if (walking) stopWalk(false);
      hideLook();
      turning = false;
      // 转身被打断时 complete 不会触发，回调要手动摘掉，否则下次转身时旧回调把方向改回去。
      if (turnDone) turnAnim?.removeEventListener("complete", turnDone);
      turnDone = null;
      turnAnim?.stop();
      turnStage.style.visibility = "hidden";
      nextAt = Infinity;
      walkStage.style.visibility = "hidden";
      lookStage.style.visibility = "hidden";
    },
    resume() {
      paused = false;
      noticing = false;
      walkStage.style.visibility = "";
      nextAt = performance.now() + resumeMs;
    },
  };
}
