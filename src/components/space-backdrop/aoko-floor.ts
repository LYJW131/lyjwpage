import { SCENE, circle, smooth, tone } from "./aoko-paint";

// 脚下的地面法阵就是 img0609（俯视）里那面：外圈 img0640（符文带、星形弦线、印章环）套内盘 img1627（旋刃、中心四枚印章、粗亮边），
// 底下是被法阵照成紫色的砖地。投到地面时按 img0633（平视远景）那样近大远小。
const TEX = 1280;
// 纹理半边长 = 法阵外圈半径 × EXTENT，多出来的一圈是砖地的余光。
const EXTENT = 1.6;
const R = TEX / 2 / EXTENT;
// img0640 圈内 0.43 R 以内是空的，img0609 里内盘的粗亮边正好贴着这一圈。
const INNER_R = 0.43 * R;

export function floorTextures(outer: HTMLImageElement, inner: HTMLImageElement) {
  const bricks = document.createElement("canvas");
  bricks.width = bricks.height = TEX;
  const b = bricks.getContext("2d")!;
  const lit = b.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
  // 四成半径内保持亮，往外按 smoothstep 落到零，到边上斜率也归零；线性收尾在透视压扁的远端会显出一道硬边。
  for (let i = 0; i <= 16; i++) lit.addColorStop(i / 16, tone(SCENE.brick, 0.85 * (1 - smooth(0.4, 1, i / 16))));
  b.fillStyle = lit;
  b.fillRect(0, 0, TEX, TEX);
  b.globalCompositeOperation = "destination-out";
  b.fillStyle = tone(SCENE.brick, 0.6);
  const row = R * 0.09;
  for (let y = 0, i = 0; y < TEX; y += row, i++) {
    b.fillRect(0, y, TEX, 4);
    for (let x = (i % 2) * row; x < TEX; x += row * 2.1) b.fillRect(x, y, 3, row);
  }

  const tex = document.createElement("canvas");
  tex.width = tex.height = TEX;
  const c = tex.getContext("2d")!;
  c.translate(TEX / 2, TEX / 2);
  const pool = c.createRadialGradient(0, 0, 0, 0, 0, R);
  pool.addColorStop(0, tone(SCENE.deep, 0.22));
  pool.addColorStop(1, tone(SCENE.deep, 0.08));
  c.fillStyle = pool;
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = "lighter";
  circle(c, outer, R);
  return { bricks, tex, inner };
}

export type FloorSpot = { x: number; y: number; r: number; tilt: number; depth: number };

// 法阵先在纹理平面里转好、叠在不转的砖地上，再一条条按深度投到地面。条带互相覆盖用 source-over，
// 所以地面必须是背景画布清空后画的第一样东西：叠加（lighter）模式下条带接缝会多出一排亮线。
export function floorPainter() {
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = TEX;
  const s = scratch.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  return (ctx: CanvasRenderingContext2D, { bricks, tex, inner }: ReturnType<typeof floorTextures>, spin: number, alpha: number, spot: FloorSpot) => {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = "source-over";
    s.globalAlpha = 1;
    s.clearRect(0, 0, TEX, TEX);
    s.drawImage(bricks, 0, 0);
    // 法阵盖在砖上而不是叠加：叠加时砖缝会从亮线里透出来，压扁后成了一道道横纹。
    s.globalAlpha = alpha;
    s.translate(TEX / 2, TEX / 2);
    s.rotate(spin);
    s.drawImage(tex, -TEX / 2, -TEX / 2);
    s.rotate(-2.6 * spin);
    circle(s, inner, INNER_R);

    // 透视按条带拼，每条按自己的深度横向缩放。条带取设备像素的整行、一行一条：条宽一变圆弧两端就是一级台阶，
    // 行高再小就看不出；条带也不能互相盖住，砖地是半透明的，盖住的那一线会叠两遍，整片地面出现细横纹。
    const { x, y, r, tilt, depth } = spot;
    const reach = r * EXTENT;
    const k = (reach * tilt) / depth;
    const m = ctx.getTransform();
    const rowAt = (v: number) => m.d * (y + k * (1 / (1 - depth * v) - 1)) + m.f;
    const vAt = (row: number) => Math.max(-1, Math.min(1, (1 - 1 / (((row - m.f) / m.d - y) / k + 1)) / depth));
    const cx = m.a * x + m.e;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingQuality = "high";
    for (let row = Math.floor(rowAt(-1)); row < Math.ceil(rowAt(1)); row++) {
      const v0 = vAt(row);
      const v1 = vAt(row + 1);
      if (v1 <= v0) continue;
      const half = (m.a * reach) / (1 - (depth * (v0 + v1)) / 2);
      ctx.drawImage(scratch, 0, ((v0 + 1) / 2) * TEX, TEX, ((v1 - v0) / 2) * TEX, cx - half, row, 2 * half, 1);
    }
    ctx.restore();
  };
}
