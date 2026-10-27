import { CHARGE, CYCLE, FIRE } from "./aoko-fx";

// 表情图集：FACE_COLS × FACE_ROWS 格，每格覆盖原图 FACE_BOX（x, y, 边长）这块正方形，alpha 是羽化遮罩，只盖眉眼和嘴。
// 原图本身是喊叫脸，不占格；第 0 格是配它的挤眼闭眼，第 7、14 格分别是平静与害羞的闭眼。各格由 Codex 对着原图脸部改表情、以游戏立绘为表情参考生成，离线对齐后拼成。
export const FACE_ATLAS = "/mascots/aoko-faces.webp";
export const FACE_BOX = [360, 52, 256];
export const FACE_COLS = 4;
export const FACE_ROWS = 4;

// tile 是睁眼时叠的格（-1 = 原图），shut 是眨眼时眼皮合向的格（-1 = 不眨：已经闭着、只睁一只，或眼形和两张闭眼图差太多）。
const FACES = {
  shout: { tile: -1, shut: 0 },
  focus: { tile: 1, shut: 0 },
  calm: { tile: 2, shut: 7 },
  grin: { tile: 3, shut: 7 },
  smile: { tile: 4, shut: -1 },
  wink: { tile: 5, shut: -1 },
  surprised: { tile: 6, shut: -1 },
  yawn: { tile: 8, shut: -1 },
  annoyed: { tile: 9, shut: 7 },
  smug: { tile: 10, shut: -1 },
  strain: { tile: 11, shut: -1 },
  glance: { tile: 12, shut: 7 },
  shy: { tile: 13, shut: 14 },
};
type FaceName = keyof typeof FACES;

// 闲置时以平静为底，隔一阵换成别的表情再回来。
const IDLE: [FaceName, number][] = [
  ["grin", 2],
  ["smile", 2],
  ["smug", 2],
  ["glance", 2],
  ["annoyed", 1],
  ["wink", 1],
  ["surprised", 1],
  ["yawn", 1],
  ["shy", 1],
];
const CALM_HOLD: [number, number] = [2.5, 5];
const IDLE_HOLD: [number, number] = [1.8, 3.5];
// 换表情是两格交叉淡化；时长约一次眨眼，短到看不出叠影，又不会一帧硬切。
const SWAP_S = 0.16;
// 蓄力：先收起表情盯住，后半段咬牙；释放后喊叫留到光芒落下。
const FOCUS_LEAD = 0.4;
const STRAIN_AT = 14.6;
const SHOUT_HOLD = 1.8;
// 鼠标进到她这侧留白时先一愣，再换成得意。
const NOTICE: [FaceName, number][] = [
  ["surprised", 0.7],
  ["smug", 2.4],
];

export type Face = { from: number; to: number; mix: number; shut: number };
export const STILL_FACE: Face = { from: -1, to: -1, mix: 0, shut: 0 };

function beat(t: number): FaceName | null {
  const c = t % CYCLE;
  if (c >= CHARGE - FOCUS_LEAD && c < STRAIN_AT) return "focus";
  if (c >= STRAIN_AT && c < FIRE) return "strain";
  if (c >= FIRE && c < FIRE + SHOUT_HOLD) return "shout";
  return null;
}

const span = ([a, b]: [number, number], random: () => number) => a + random() * (b - a);

export function faceDirector(random = Math.random) {
  const pick = (not: FaceName): FaceName => {
    const pool = IDLE.filter(([n]) => n !== not);
    let r = random() * pool.reduce((s, [, w]) => s + w, 0);
    for (const [n, w] of pool) if ((r -= w) < 0) return n;
    return pool[0][0];
  };
  let prev: FaceName = "calm";
  let current: FaceName = "calm";
  let last: FaceName = "calm";
  let since = -SWAP_S;
  let until = span(CALM_HOLD, random);
  let queue: [FaceName, number][] = [];
  const go = (next: FaceName, t: number, hold: number) => {
    until = t + hold;
    if (next === current) return;
    prev = current;
    current = next;
    since = t;
  };
  const face = (t: number): Face => {
    const forced = beat(t);
    if (forced) {
      queue = [];
      go(forced, t, 0);
    } else if (t >= until || current === "focus" || current === "strain" || current === "shout") {
      const next = queue.shift();
      if (next) go(next[0], t, next[1]);
      else if (current === "calm") go((last = pick(last)), t, span(IDLE_HOLD, random));
      else go("calm", t, span(CALM_HOLD, random));
    }
    const k = Math.min(1, Math.max(0, (t - since) / SWAP_S));
    return { from: FACES[prev].tile, to: FACES[current].tile, mix: k, shut: k < 1 ? -1 : FACES[current].shut };
  };
  const notice = (t: number) => {
    if (beat(t) || queue.length || current === "smug") return;
    queue = [...NOTICE];
    until = t;
  };
  return { face, notice };
}
