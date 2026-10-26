import { SCENE, circle, hash, tone } from "./aoko-paint";

// 脚下的地面法阵照 img0609（俯视）的结构画：内盘八片宽刃、中心四枚印章、盘边的菱形符块，外面一条偏心的粗亮月牙带、
// 带大印章的细亮环、符文带；底下是被法阵照成紫色的砖地。投到地面时按 img0633（平视远景）那样近大远小。
const TEX = 1024;
// 纹理半边长 = 法阵外圈半径 × EXTENT，多出来的一圈是砖地的余光。
const EXTENT = 1.3;
const R = TEX / 2 / EXTENT;
// 透视按条带拼：每条按自己的深度缩放；条数少了近处会看出阶梯。
const STRIPS = 56;

type Glyph = (ctx: CanvasRenderingContext2D) => void;
// 印章与符块里的大字形，只求和 img0609 里那几笔的走势像：钩、弯、折。
const GLYPHS: Glyph[] = [
  (c) => {
    c.moveTo(-0.5, -0.3);
    c.quadraticCurveTo(0.6, -0.7, 0.4, 0);
    c.quadraticCurveTo(0.2, 0.6, -0.4, 0.5);
  },
  (c) => {
    c.moveTo(-0.45, -0.5);
    c.lineTo(-0.2, 0.45);
    c.moveTo(0.1, -0.45);
    c.quadraticCurveTo(0.55, 0, 0.25, 0.5);
  },
  (c) => {
    c.moveTo(0.4, -0.5);
    c.quadraticCurveTo(-0.6, -0.2, -0.1, 0.1);
    c.quadraticCurveTo(0.5, 0.4, -0.45, 0.5);
  },
];

function ring(ctx: CanvasRenderingContext2D, r: number, width: number) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

function seal(ctx: CanvasRenderingContext2D, r: number, glyph: number) {
  ring(ctx, r, 3);
  ring(ctx, r * 0.8, 2);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    ctx.fillRect(Math.cos(a) * r * 0.9 - 2, Math.sin(a) * r * 0.9 - 2, 3 + hash(i + glyph) * 4, 3);
  }
  ctx.save();
  ctx.scale(r * 0.75, r * 0.75);
  ctx.lineWidth = 0.14;
  ctx.lineCap = "round";
  ctx.beginPath();
  GLYPHS[glyph % GLYPHS.length](ctx);
  ctx.stroke();
  ctx.restore();
}

export function floorTextures(runes: HTMLImageElement) {
  const bricks = document.createElement("canvas");
  bricks.width = bricks.height = TEX;
  const b = bricks.getContext("2d")!;
  const lit = b.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
  lit.addColorStop(0, tone(SCENE.brick, 0.85));
  lit.addColorStop(0.6, tone(SCENE.brick, 0.55));
  lit.addColorStop(1, tone(SCENE.brick, 0));
  b.fillStyle = lit;
  b.fillRect(0, 0, TEX, TEX);
  b.globalCompositeOperation = "destination-out";
  b.fillStyle = tone(SCENE.brick, 0.6);
  const row = R * 0.075;
  for (let y = 0, i = 0; y < TEX; y += row, i++) {
    b.fillRect(0, y, TEX, 2);
    for (let x = (i % 2) * row; x < TEX; x += row * 2.1) b.fillRect(x, y, 2, row);
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
  circle(c, runes, R * 0.97);

  c.strokeStyle = c.fillStyle = tone(SCENE.ice, 0.9);
  c.shadowColor = tone(SCENE.deep, 1);
  c.shadowBlur = 16;
  ring(c, R, 3);
  ring(c, R * 0.74, 5);
  ring(c, R * 0.5, 3);
  // 外圈的八芒星弦线（{8/3} 星形）。
  c.lineWidth = 2;
  c.globalAlpha = 0.5;
  c.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = ((i * 3) / 8) * Math.PI * 2 + 0.2;
    c[i ? "lineTo" : "moveTo"](Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98);
  }
  c.stroke();
  c.globalAlpha = 1;

  // 偏心的粗亮月牙带：左下最粗、右上收细，两圆错开圆心做出来。
  c.beginPath();
  c.arc(-R * 0.015, R * 0.02, R * 0.665, 0, Math.PI * 2);
  c.arc(R * 0.022, -R * 0.014, R * 0.585, 0, Math.PI * 2, true);
  c.fill();

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    c.beginPath();
    c.arc(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 5, 0, Math.PI * 2);
    c.fill();
  }
  c.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
    c.lineTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
    c.stroke();
  }
  // img0609 的八片刃：内端尖、最宽处在六成半径附近、外端越过内盘边一点收尖。
  c.shadowBlur = 22;
  for (let i = 0; i < 8; i++) {
    c.save();
    c.rotate((i / 8) * Math.PI * 2);
    c.beginPath();
    c.moveTo(R * 0.05, 0);
    c.lineTo(R * 0.37, R * 0.085);
    c.lineTo(R * 0.57, 0);
    c.lineTo(R * 0.37, -R * 0.085);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.shadowBlur = 10;
  [0.5, 2.1, 3.7, 5.3].forEach((a, i) => {
    c.save();
    c.translate(Math.cos(a) * R * 0.16, Math.sin(a) * R * 0.16);
    seal(c, R * 0.075, i);
    c.restore();
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(Math.cos(a + 0.9) * R * 0.12, Math.sin(a + 0.9) * R * 0.12, Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1);
    c.stroke();
  });
  [2.8, 4.4, 5.95].forEach((a, i) => {
    c.save();
    c.translate(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
    c.rotate(a + Math.PI / 4);
    c.strokeRect(-R * 0.04, -R * 0.04, R * 0.08, R * 0.08);
    c.strokeRect(-R * 0.03, -R * 0.03, R * 0.06, R * 0.06);
    c.rotate(-Math.PI / 4);
    c.scale(R * 0.03, R * 0.03);
    c.lineWidth = 0.15;
    c.beginPath();
    GLYPHS[i % GLYPHS.length](c);
    c.stroke();
    c.restore();
  });
  c.save();
  c.translate(R * 0.74, 0);
  seal(c, R * 0.11, 0);
  c.restore();
  return { bricks, tex };
}

export type FloorSpot = { x: number; y: number; r: number; tilt: number; depth: number };

// 法阵先在纹理平面里转好、叠在不转的砖地上，再一条条按深度投到地面。条带互相覆盖用 source-over，
// 所以地面必须是背景画布清空后画的第一样东西：叠加（lighter）模式下条带接缝会多出一排亮线。
export function floorPainter() {
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = TEX;
  const s = scratch.getContext("2d")!;
  return (ctx: CanvasRenderingContext2D, { bricks, tex }: ReturnType<typeof floorTextures>, spin: number, alpha: number, spot: FloorSpot) => {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = "source-over";
    s.globalAlpha = 1;
    s.clearRect(0, 0, TEX, TEX);
    s.drawImage(bricks, 0, 0);
    s.globalCompositeOperation = "lighter";
    s.globalAlpha = alpha;
    s.translate(TEX / 2, TEX / 2);
    s.rotate(spin);
    s.drawImage(tex, -TEX / 2, -TEX / 2);

    const { x, y, r, tilt, depth } = spot;
    const reach = r * EXTENT;
    const scaleAt = (v: number) => 1 / (1 - depth * v);
    const yAt = (v: number) => y + ((reach * tilt) / depth) * (scaleAt(v) - 1);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < STRIPS; i++) {
      const v0 = -1 + (2 * i) / STRIPS;
      const v1 = v0 + 2 / STRIPS;
      const half = reach * scaleAt((v0 + v1) / 2);
      const top = yAt(v0);
      ctx.drawImage(scratch, 0, (i * TEX) / STRIPS, TEX, TEX / STRIPS, x - half, top, 2 * half, yAt(v1) - top + 1);
    }
    ctx.restore();
  };
}
