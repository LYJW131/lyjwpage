import { decodeFrames, frameCanvases } from "@/components/space-backdrop/sprite";

import config from "./clawd-perch.json";
import kite from "./clawd-kite.json";
import { clawdPatrol } from "./patrol";
import { riftLines } from "./rift";
import { CENTER, FEET, fitStage, loadAnim, onLoaded, reducedMotion, stageBox } from "./stage";

import type { AnimationItem } from "lottie-web";
import type { Footprint } from "./stage";

type Act = { anim: AnimationItem; stage: HTMLElement; fp: Footprint };

const BODY = config.bodyPx;
const ease = (u: number) => 1 - Math.pow(1 - u, 3);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const back = (u: number) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
const between = ([base, spread]: number[]) => base + spread * Math.random();

// 风筝精灵：底部 40% 是 Clawd，按它的实宽定放大倍数；上面 30% 有像素的帧是风筝在天上，取最长的一段连续帧当循环。
const KITE_FRAMES = decodeFrames(kite);
const KITE_BODY = (() => {
  let x0 = kite.w;
  let x1 = 0;
  const f = KITE_FRAMES[0];
  for (let y = Math.floor(kite.h * 0.6); y < kite.h; y++)
    for (let x = 0; x < kite.w; x++)
      if (f[y * kite.w + x] !== 255) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
  return { center: (x0 + x1 + 1) / 2 / kite.w, cells: Math.max(1, x1 - x0 + 1) };
})();
const KITE_LOOP = (() => {
  const aloft = KITE_FRAMES.map((f) => f.slice(0, Math.floor(kite.h * 0.3) * kite.w).some((c) => c !== 255));
  // 候选从空开始：原版拿整段当初值，严格比长度永远换不掉，结果整段放出收回循环重播、收线时直接消失。
  let best: [number, number] | null = null;
  let run: [number, number] | null = null;
  aloft.forEach((up, i) => {
    if (!up) return void (run = null);
    if (run) run[1] = i;
    else run = [i, i];
    if (!best || run[1] - run[0] > best[1] - best[0]) best = [...run];
  });
  return best ?? ([0, KITE_FRAMES.length - 1] as [number, number]);
})();

export function clawdPerch(band: HTMLElement) {
  const reduced = reducedMotion();
  const probe = stageBox(BODY);
  const stageW = parseInt(probe.style.width, 10);
  const stageH = parseInt(probe.style.height, 10);
  const padL = Math.round(0.269 * stageW) - 8;
  const padR = Math.round(0.298 * stageW) - 8;
  if (band.clientWidth + padL + padR < stageW) return null;

  const rift = riftLines(band);
  const box = document.createElement("div");
  box.className = "clawd-perch";
  box.style.cssText = `position:absolute;left:${-padL}px;right:${-padR}px;bottom:0;height:${stageH}px;pointer-events:none;z-index:2;overflow:visible;`;
  band.appendChild(box);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;overflow:visible;";
  box.appendChild(host);

  const patrol = clawdPatrol(host, BODY, { startRight: true, dir0: -1 });
  host.style.overflow = "visible";
  let killed = false;
  const mirrored = () => patrol.facing() < 0;

  const waveStage = stageBox(BODY);
  waveStage.style.visibility = "hidden";
  host.appendChild(waveStage);
  let waveAnim: AnimationItem | null = null;
  let waveFp: Footprint = { cx: CENTER, feet: FEET, w: stageW, h: stageH };
  let waving = false;
  if (!reduced)
    void loadAnim(waveStage, "clawd-waving.json").then((anim) => {
      if (killed) return anim.destroy();
      onLoaded(anim, () => {
        try {
          waveFp = fitStage(waveStage, anim, BODY);
        } catch {
          /* 量不出身体就用默认站位。 */
        }
        waveAnim = anim;
      });
      anim.addEventListener("complete", () => setTimeout(endWave, config.wave.afterMs));
    });

  let acting = false;
  let kiting = false;
  let opening = true;
  const near = (e: MouseEvent) => {
    const r = host.getBoundingClientRect();
    return (
      Math.abs(e.clientX - (r.left + patrol.bodyX())) < config.wave.reach * BODY &&
      e.clientY > r.top + config.wave.top * stageH &&
      e.clientY < r.bottom + 8
    );
  };
  const endWave = () => {
    if (!waving) return;
    waving = false;
    patrol.resume();
    waveStage.style.visibility = "hidden";
    waveAnim?.goToAndStop(0, true);
  };
  let leaveTimer = 0;
  const onMouse = (e: MouseEvent) => {
    if (waving) {
      if (!near(e)) {
        clearTimeout(leaveTimer);
        leaveTimer = window.setTimeout(endWave, config.wave.driftMs);
      }
      return;
    }
    if (document.hidden || !waveAnim || reduced || acting || kiting || opening || !near(e)) return;
    waving = true;
    patrol.pin(waveStage, waveFp, mirrored());
    waveStage.style.visibility = "";
    patrol.pause();
    waveAnim.playSegments(
      [
        [0, 16],
        [16, 0],
      ],
      true,
    );
  };
  addEventListener("mousemove", onMouse, { passive: true });
  const onLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(endWave, config.wave.leaveMs);
  };
  document.documentElement.addEventListener("mouseleave", onLeave);

  const cell = BODY / KITE_BODY.cells;
  const kiteCanvas = document.createElement("canvas");
  kiteCanvas.width = Math.round(kite.w * cell);
  kiteCanvas.height = Math.round(kite.h * cell);
  kiteCanvas.style.cssText = `position:absolute;bottom:0;width:${kiteCanvas.width}px;height:${kiteCanvas.height}px;pointer-events:none;visibility:hidden;image-rendering:pixelated;`;
  host.appendChild(kiteCanvas);
  const kiteCtx = kiteCanvas.getContext("2d")!;
  kiteCtx.imageSmoothingEnabled = false;
  const kiteFrame = frameCanvases(kite);
  const drawKite = (i: number) => {
    kiteCtx.clearRect(0, 0, kiteCanvas.width, kiteCanvas.height);
    kiteCtx.drawImage(kiteFrame(i), 0, 0, kiteCanvas.width, kiteCanvas.height);
  };
  const placeKite = () => {
    kiteCanvas.style.left = `${Math.max(0, Math.round(patrol.bodyX() - KITE_BODY.center * kiteCanvas.width))}px`;
    kiteCanvas.style.bottom = `${Math.round(stageH * (1 - FEET))}px`;
  };
  let kiteFlown = false;
  let reelIn = false;
  let kiteRaf = 0;
  kiteCanvas.addEventListener("click", () => {
    reelIn = true;
  });

  const cache = new Map<string, Act>();
  const recent: string[] = [];
  const loadAct = (file: string) =>
    new Promise<Act | null>((resolve) => {
      const hit = cache.get(file);
      if (hit) return resolve(hit);
      const stage = stageBox(BODY);
      stage.style.visibility = "hidden";
      host.appendChild(stage);
      void loadAnim(stage, `acts/${file}`).then((anim) => {
        if (killed) {
          anim.destroy();
          return resolve(null);
        }
        onLoaded(anim, () => {
          anim.goToAndStop(0, true);
          let fp: Footprint = { cx: CENTER, feet: FEET, w: stageW, h: stageH };
          // 手里拿道具的动画量出来的宽度不是身体宽，只在宽度和走路时差不多时才信量出的中心和脚底。
          const canvas = stage.querySelector("canvas");
          if (canvas) {
            const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
            let x0 = canvas.width;
            let x1 = 0;
            let y1 = 0;
            for (let y = 0; y < canvas.height; y += 2)
              for (let x = 0; x < canvas.width; x += 2)
                if (data[(y * canvas.width + x) * 4 + 3] > 10) {
                  if (x < x0) x0 = x;
                  if (x > x1) x1 = x;
                  if (y > y1) y1 = y;
                }
            if (Math.abs((x1 - x0) / canvas.width - 0.433) < 0.03)
              fp = { ...fp, cx: (x0 + x1) / 2 / canvas.width, feet: y1 / canvas.height };
          }
          const act = { anim, stage, fp };
          if (cache.size > config.acts.cache) {
            const [oldest, old] = cache.entries().next().value!;
            old.anim.destroy();
            old.stage.remove();
            cache.delete(oldest);
          }
          cache.set(file, act);
          resolve(act);
        });
      });
    });

  const pickAct = () => {
    const pool = config.acts.list.filter(([f]) => !recent.includes(f as string)) as [string, number][];
    let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
    for (const [f, w] of pool) if ((r -= w) <= 0) return f;
    return pool[0][0];
  };
  const playAct = async () => {
    if (waving || kiting || acting || opening || reduced) return;
    const file = pickAct();
    const act = await loadAct(file);
    if (!act || waving || kiting || acting || opening || killed) return;
    acting = true;
    recent.push(file);
    if (recent.length > config.acts.recent) recent.shift();
    patrol.pin(act.stage, act.fp, mirrored());
    patrol.pause();
    act.stage.style.visibility = "";
    act.anim.goToAndStop(0, true);
    const total = act.anim.totalFrames;
    const hold = (config.acts.holds as Record<string, { at: number; ms: number }>)[file];
    const finish = () => {
      act.anim.removeEventListener("complete", finish);
      act.stage.style.visibility = "hidden";
      acting = false;
      patrol.resume();
    };
    if (hold) {
      const at = Math.round(total * hold.at);
      const pauseThere = () => {
        act.anim.removeEventListener("complete", pauseThere);
        setTimeout(() => {
          if (!acting) return;
          act.anim.addEventListener("complete", finish);
          act.anim.playSegments([at, total], true);
        }, hold.ms);
      };
      act.anim.addEventListener("complete", pauseThere);
      act.anim.playSegments([0, at], true);
    } else {
      act.anim.addEventListener("complete", finish);
      act.anim.playSegments([0, total], true);
    }
  };

  const flyKite = () => {
    if (kiteFlown || waving || kiting || acting || opening || reduced) return;
    kiteFlown = true;
    kiting = true;
    reelIn = false;
    placeKite();
    patrol.pause();
    kiteCanvas.style.visibility = "";
    kiteCanvas.style.pointerEvents = "auto";
    kiteCanvas.style.cursor = "pointer";
    const t0 = performance.now();
    const flyFor = between(config.kite.flyMs);
    const [loopA, loopB] = KITE_LOOP;
    const n = KITE_FRAMES.length;
    let outroAt: number | null = null;
    const step = (now: number) => {
      if (!kiting) return;
      if (outroAt === null && (reelIn || now - t0 > flyFor)) outroAt = now;
      if (outroAt !== null) {
        const f = loopB + 1 + Math.max(0, Math.floor(((now - outroAt) / 1000) * kite.fps));
        if (f >= n) {
          kiting = false;
          kiteCanvas.style.visibility = "hidden";
          kiteCanvas.style.pointerEvents = "none";
          patrol.resume();
          return;
        }
        drawKite(f);
      } else {
        // rAF 给的时间戳是这一帧开始的时刻，可能早于 flyKite 里记的 t0，差值要夹到 0 以上，否则帧号是负的、取帧越界。
        const f = Math.max(0, Math.floor(((now - t0) / 1000) * kite.fps));
        drawKite(f <= loopB ? f : loopA + ((f - loopA) % (loopB - loopA + 1)));
      }
      kiteRaf = requestAnimationFrame(step);
    };
    kiteRaf = requestAnimationFrame(step);
  };

  const onHidden = () => {
    if (!document.hidden || reduced) return;
    waving = false;
    waveStage.style.visibility = "hidden";
    waveAnim?.goToAndStop(0, true);
    kiting = false;
    kiteCanvas.style.visibility = "hidden";
    kiteCanvas.style.pointerEvents = "none";
    acting = false;
    cache.forEach((a) => {
      a.stage.style.visibility = "hidden";
      a.anim.stop();
    });
    if (!opening) patrol.resume();
  };
  document.addEventListener("visibilitychange", onHidden);

  const timers: number[] = [];
  if (!reduced) {
    timers.push(window.setInterval(() => !document.hidden && Math.random() < config.acts.chance && void playAct(), config.acts.everyMs));
    timers.push(window.setInterval(() => !document.hidden && Math.random() < config.kite.chance && flyKite(), config.kite.everyMs));
    // 几块舞台各自异步切换显隐，偶尔会叠出两只；每 300ms 只留当前该露面的那块。
    timers.push(
      window.setInterval(() => {
        if (opening) return;
        const actStages = [...cache.values()].map((a) => a.stage);
        const owner = waving
          ? waveStage
          : kiting
            ? kiteCanvas
            : acting
              ? actStages.find((s) => s.style.visibility !== "hidden")
              : null;
        const all = [waveStage, kiteCanvas, patrol.walkStage, patrol.lookStage, ...actStages];
        if (owner) {
          for (const s of all) if (s !== owner && s.style.visibility !== "hidden") s.style.visibility = "hidden";
          return;
        }
        const shown = all.filter((s) => s.style.visibility !== "hidden");
        if (shown.length < 2) return;
        for (const s of all) if (s !== patrol.walkStage && s !== patrol.lookStage) s.style.visibility = "hidden";
        if (patrol.walkStage.style.visibility !== "hidden") patrol.lookStage.style.visibility = "hidden";
      }, 300),
    );
  }

  let entryRaf = 0;
  const openNow = () => {
    rift.set({ amp: 1, half: band.clientWidth * 2, fall: 1, over: 0, cx: band.clientWidth / 2 });
    host.style.clipPath = "";
    host.style.transform = "";
    opening = false;
  };
  const enter = async () => {
    patrol.pause();
    const cx = () => patrol.bodyX() - padL;
    if (reduced) {
      openNow();
      if (Math.random() < 0.5) {
        kiting = true;
        placeKite();
        drawKite(KITE_LOOP[0] + ((KITE_LOOP[1] - KITE_LOOP[0]) >> 1));
        kiteCanvas.style.visibility = "";
      } else {
        const act = await loadAct(Math.random() < 0.5 ? "Clawd-Laptop.json" : "Clawd-Desktop.json");
        if (!act) return;
        acting = true;
        patrol.pin(act.stage, act.fp, mirrored());
        act.anim.goToAndStop(Math.round(0.55 * act.anim.totalFrames), true);
        act.stage.style.visibility = "";
      }
      return;
    }
    const { knockMs, pryMs, unzipMs, lensHalf, falloff, crouch, push, land } = config.pry;
    const jump = loadAct("Clawd-Jumping.json");
    const t0 = performance.now();
    rift.set({ cx: cx(), half: 4, fall: 10, amp: 0, over: 0 });
    let jumpAct: Act | null = null;
    void jump.then((a) => (jumpAct = a));
    let pryAt = 0;
    let unzipAt = 0;
    const sink = () => {
      const lift = band.clientHeight - 0.5 - rift.bottomY(cx());
      host.style.transform = lift ? `translateY(${-lift}px)` : "";
      // clip-path 跟着元素一起位移，换算时把上移的那段加回来。
      host.style.clipPath = rift.clip(-padL, band.clientHeight - stageH - lift);
    };
    const frame = (now: number) => {
      if (killed) return;
      const t = Math.max(0, now - t0);
      if (!pryAt) {
        const u = Math.min(1, t / knockMs);
        const thump = (a: number, b: number, h: number) => (u > a && u < b ? h * Math.sin((Math.PI * (u - a)) / (b - a)) : 0);
        rift.set({ amp: thump(0, 0.35, 0.1) + thump(0.5, 0.9, 0.16), half: 4 + 6 * u });
        // 跳跃动画还没下好就多顶几下，最多等三秒，下不来就直接拉开。
        if (u === 1 && (jumpAct || t > 3000)) pryAt = now;
      } else if (!unzipAt) {
        const u = Math.min(1, (now - pryAt) / pryMs);
        const act = jumpAct as Act | null;
        if (act) {
          if (act.stage.style.visibility === "hidden") {
            patrol.pin(act.stage, act.fp, mirrored());
            act.stage.style.visibility = "";
          }
          act.anim.goToAndStop(u < 0.4 ? crouch : push, true);
        }
        rift.set({ amp: Math.min(1.08, back(u)), half: 10 + (lensHalf - 10) * ease(u), fall: 10 + (falloff - 10) * u, over: u < 0.4 ? 0 : 5 });
        sink();
        if (u === 1) {
          unzipAt = now;
          if (act) {
            const done = () => {
              act.anim.removeEventListener("complete", done);
              act.stage.style.visibility = "hidden";
              opening = false;
              patrol.resume();
            };
            act.anim.addEventListener("complete", done);
            act.anim.playSegments([land, act.anim.totalFrames], true);
          } else {
            opening = false;
            patrol.resume();
          }
        }
      } else {
        const u = Math.min(1, (now - unzipAt) / unzipMs);
        const span = Math.max(band.clientWidth - cx(), cx()) + falloff;
        rift.set({ amp: 1, half: lensHalf + (span - lensHalf) * easeInOut(u), over: 5 * (1 - ease(u)) });
        sink();
        if (u === 1) {
          openNow();
          return;
        }
      }
      entryRaf = requestAnimationFrame(frame);
    };
    entryRaf = requestAnimationFrame(frame);
  };
  void enter();

  return {
    stop() {
      killed = true;
      cancelAnimationFrame(entryRaf);
      cancelAnimationFrame(kiteRaf);
      timers.forEach(clearInterval);
      clearTimeout(leaveTimer);
      removeEventListener("mousemove", onMouse);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onHidden);
      waveAnim?.destroy();
      cache.forEach((a) => a.anim.destroy());
      patrol.stop();
      box.remove();
      rift.remove();
    },
  };
}
