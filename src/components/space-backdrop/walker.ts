import walk from "./clawd-walk.json";
import { CLAWD_PX } from "./layout";
import { rockFx } from "./rock-fx";
import { frameCanvases } from "./sprite";

import type { ClawdCast } from "./clawd-actor";

// clawd-walk.json 的帧序（录屏一轮从正面站姿起排）：下标对应的姿势见下；踱步一轮从 1 播到最后一帧。
const F = {
  front: 0,
  frontUp: 14,
  squint: 17,
  rightStand: 4,
  rightUp: 3,
  rightStep: 2,
  leftStand: 20,
  leftUp: 19,
  leftStep: 18,
} as const;
const WALK_FRAMES = walk.deltas.length + 1;
const HOP_H = 12;
const HEADROOM = HOP_H + 2;
const PACE_REACH = 4;

// 陨石按 2×2 像素一格画，和踱步精灵的块面粗细一致；光从左上来，右下压暗。颜色和闪光、Z 的颜色跟精灵一起放在 clawd-walk.json：闪光取宇航员精灵里星星的黄，Z 取头盔的灰。
const ROCK = [
  "...hhhhhhhhh....",
  ".hhbbbbbbbbbhh..",
  "hbbbsdbbbbbbbbs.",
  "hbbbddbbbbbsdbss",
  ".bbbbbbbbbbddssd",
  "..ssbbbbbbsssdd.",
  "....sssbbssddd..",
  "......sddd......",
];
const ROCK_COLORS: Record<string, string> = walk.rock;
const ROCK_W = ROCK[0].length * 2;
// 脚踩进陨石顶面一行，看着是站稳的；精灵在陨石上水平居中。
const ROCK_Y = walk.h - 2;
const WALKER_X = (ROCK_W - walk.w) / 2;

type Pose = { index: number; lift: number; dip: number; dx: number; cue?: "burst" | "snore" };
type ActKind = "idle" | "walk" | "hop" | "look" | "pace" | "doze";

const pose = (index: number, o: Partial<Pose> = {}): Pose => ({ index, lift: 0, dip: 0, dx: 0, ...o });
const hold = (p: Pose, ticks: number) => Array.from({ length: ticks }, () => p);

// 每个动作是一串按拍（walk.fps）排好的姿势，播完回到正面站姿。
const ACTS: Record<Exclude<ActKind, "idle">, Pose[]> = {
  walk: Array.from({ length: WALK_FRAMES - 1 }, (_, i) => pose(i + 1)),
  hop: [
    ...hold(pose(F.front, { lift: -1 }), 2),
    ...Array.from({ length: 10 }, (_, a) => {
      const u = (a + 0.5) / 10;
      return pose(Math.abs(u - 0.5) < 0.15 ? F.squint : F.frontUp, { lift: Math.round(4 * HOP_H * u * (1 - u)) });
    }),
    pose(F.front, { lift: -1, dip: 1, cue: "burst" }),
    pose(F.front, { lift: -1, dip: 1 }),
    pose(F.front),
  ],
  look: [
    ...hold(pose(F.leftStand), 8),
    ...hold(pose(F.front), 3),
    ...hold(pose(F.rightStand), 8),
    pose(F.rightUp),
    ...hold(pose(F.rightStand), 3),
    ...hold(pose(F.front), 2),
  ],
  pace: (() => {
    const out: Pose[] = [];
    const go = (from: number, to: number) => {
      const dir = Math.sign(to - from);
      const [stand, step] = dir > 0 ? [F.leftStand, F.leftStep] : [F.rightStand, F.rightStep];
      for (let dx = from; dx !== to; dx += dir) out.push(pose(stand, { dx }), pose(step, { dx: dx + dir }));
      out.push(pose(stand, { dx: to }));
    };
    go(0, PACE_REACH);
    out.push(...hold(pose(F.front, { dx: PACE_REACH }), 3));
    go(PACE_REACH, -PACE_REACH);
    out.push(...hold(pose(F.front, { dx: -PACE_REACH }), 3));
    go(-PACE_REACH, 0);
    return out;
  })(),
  doze: Array.from({ length: 72 }, (_, k) => pose(F.squint, { lift: k % 24 < 12 ? 0 : -1, cue: k % 24 === 4 ? "snore" : undefined })),
};
// 歇完随机挑下一个动作；跳和打盹显眼，少出一些。
const WEIGHTS: [Exclude<ActKind, "idle">, number][] = [
  ["walk", 3],
  ["look", 2.5],
  ["pace", 2],
  ["hop", 1.5],
  ["doze", 1],
];
const IDLE_S: [number, number] = [1.8, 3.2];

type Act = { kind: ActKind; start: number; end: number; tick: number };

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function pick(): Exclude<ActKind, "idle"> {
  let roll = Math.random() * WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  for (const [kind, w] of WEIGHTS) if ((roll -= w) < 0) return kind;
  return "walk";
}

function startAct(kind: ActKind, start: number): Act {
  const end = start + (kind === "idle" ? between(...IDLE_S) : ACTS[kind].length / walk.fps);
  return { kind, start, end, tick: -1 };
}

function rockCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = ROCK_W;
  c.height = ROCK.length * 2;
  const ctx = c.getContext("2d")!;
  ROCK.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (!ROCK_COLORS[ch]) return;
      ctx.fillStyle = ROCK_COLORS[ch];
      ctx.fillRect(2 * x, 2 * y, 2, 2);
    }),
  );
  return c;
}

export function walkerCast(): ClawdCast {
  const walker = frameCanvases(walk);
  const rock = rockCanvas();
  const w = ROCK_W;
  const rockTop = HEADROOM + ROCK_Y;
  const h = rockTop + ROCK.length * 2 + 1;
  const local = (cells: number, size: number) => (cells - size / 2) * CLAWD_PX;
  const fx = rockFx(
    {
      px: CLAWD_PX,
      topY: local(rockTop, h),
      centerY: local(rockTop + ROCK.length, h),
      bottomY: local(rockTop + 2 * ROCK.length, h),
      halfW: (ROCK_W / 2) * CLAWD_PX,
      headX: local(WALKER_X + walk.w - 4, w),
      headY: local(HEADROOM + 2, h),
    },
    { light: ROCK_COLORS.h, base: ROCK_COLORS.b, shade: ROCK_COLORS.s, sparkle: walk.sparkle, snore: walk.snore },
  );
  const cache = new Map<string, HTMLCanvasElement>();
  const compose = ({ index, lift, dip, dx }: Pose) => {
    const key = `${index},${lift},${dip},${dx}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(rock, 0, rockTop + dip);
    ctx.drawImage(walker(index), WALKER_X + dx, HEADROOM - lift);
    cache.set(key, c);
    return c;
  };
  let act = startAct("idle", 0);
  let poked = false;
  return {
    w,
    h,
    fx,
    // 点一下就地起跳；正在半空里的那次跳不打断。
    poke: () => {
      if (act.kind !== "hop") poked = true;
    },
    frame: (t) => {
      if (poked) {
        poked = false;
        act = startAct("hop", t);
      }
      // 标签页在后台停了很久再回来时不补播错过的动作，从当下重新开始歇。
      if (t - act.end > 10) act = startAct("idle", t);
      while (t >= act.end) act = startAct(act.kind === "idle" ? pick() : "idle", act.end);
      if (act.kind === "idle") return compose(pose(F.front));
      const seq = ACTS[act.kind];
      const tick = Math.min(seq.length - 1, Math.floor((t - act.start) * walk.fps));
      const p = seq[tick];
      if (tick !== act.tick) {
        act.tick = tick;
        if (p.cue === "burst") fx.burst();
        if (p.cue === "snore") fx.snore(p.dx * CLAWD_PX);
      }
      return compose(p);
    },
  };
}
