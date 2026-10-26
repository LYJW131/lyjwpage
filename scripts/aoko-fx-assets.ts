#!/usr/bin/env node
// 从《魔法使之夜》解包的演出图层里导出立绘特效与召唤秘技用的贴图到 public/mascots/aoko-fx-*.webp。
// 图层不在仓库里（TYPE-MOON 素材），用法：
//   node scripts/aoko-fx-assets.ts <演出用图层目录> --weights <RealESRGAN_x4plus_anime_6B.pth>
// 目录里要有 imgNNNN-HD.png 这批放大版。需要 ImageMagick 7（magick）和 uv；标了 sr 的图层先经 scripts/aoko-fx-sr.py 超分 4 倍再缩到目标边长。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// 法阵贴图裁成以圆心为中心、边长 2R/RIM 的正方形：src/components/space-backdrop/aoko-paint.ts 按「外圈半径 = 半边长 × RIM」摆放，须与那边的 RIM 同步。
const RIM = 0.98;
const SR_SCALE = 4;

type Circle = { src: string; out: string; cx: number; cy: number; r: number; size: number; sr?: boolean };

// 圆心与外径 R 是在 HD 图上逐像素量的（外径 = 非透明像素包围盒半宽）。
const CIRCLES: Circle[] = [
  { src: "img0642", out: "band", cx: 441.5, cy: 442.5, r: 430, size: 560 },
  { src: "img0659", out: "runes", cx: 429, cy: 429.5, r: 416.5, size: 640 },
  { src: "img0638", out: "ring", cx: 489.5, cy: 489.5, r: 476, size: 512 },
  { src: "img0641", out: "octa", cx: 456.5, cy: 457.5, r: 443, size: 256 },
  // img0609 地面法阵的两层：外圈（符文带、星形弦线、印章环）与内盘（旋刃、中心四枚印章、粗亮边）。边长按 aoko-floor.ts 里法阵纹理的像素数取；
  // 外圈的 HD 只有 976px，比 2 倍屏上投到地面的大小还小，所以超分。
  { src: "img0640", out: "floor-outer", cx: 487, cy: 489.5, r: 482, size: 1600, sr: true },
  { src: "img1627", out: "floor-inner", cx: 1372.5, cy: 1372.5, r: 1348.5, size: 720 },
];

// 电弧是 img0627–0630 那组镜头的整帧图层（2400×1440，与 2100×1260 的镜头同框），保留整帧，aoko-fx.ts 按镜头取景换算位置。
const BOLTS = [
  { src: "img0614", out: "bolt" },
  { src: "img0615", out: "bolt-fine" },
];
const BOLT_SIZE = "800x480!";

// 召唤秘技（aoko-summon.ts）每个键各用一张：按原比例缩进透明正方形。
const CUES = [
  { src: "img1525", out: "glint", size: 512 },
  { src: "img1045", out: "star", size: 640 },
  { src: "img1622", out: "compass", size: 768 },
  { src: "img0632", out: "seal-ring", size: 768 },
  { src: "img1502", out: "vortex", size: 768 },
  { src: "img1623", out: "seal-star", size: 768 },
  { src: "img1504", out: "blades", size: 768 },
  { src: "img0962", out: "spikes", size: 768 },
  { src: "img1797", out: "shatter", size: 768 },
  { src: "img0927", out: "tendrils", size: 768 },
  { src: "img1822", out: "rift", size: 512 },
  { src: "img1094", out: "blast", size: 1024 },
  { src: "img0456", out: "burst", size: 1024 },
  { src: "img1046", out: "flare", size: 1024 },
];
// 铺满整屏的整帧：别的演出里从画面边缘劈进来的六道闪电（2493×1500），以及 img0662 的横扫电弧、img0663 的电柱与悬浮法环。
const FRAMES = [
  ...["img2349", "img2350", "img2351", "img2352", "img2353", "img2354"].map((src, i) => ({ src, out: `strike-${i + 1}` })),
  { src: "img0662", out: "swoop" },
  { src: "img0663", out: "storm" },
];
const FRAME_WIDTH = 1600;

function args() {
  try {
    const { positionals, values } = parseArgs({ strict: true, allowPositionals: true, options: { weights: { type: "string" } } });
    if (positionals.length === 1 && existsSync(positionals[0]) && values.weights && existsSync(values.weights)) return { dir: positionals[0], weights: values.weights };
  } catch {}
  console.error("用法：node scripts/aoko-fx-assets.ts <演出用图层目录> --weights <RealESRGAN_x4plus_anime_6B.pth>");
  process.exit(2);
}
const { dir, weights } = args();
const outDir = join(import.meta.dirname, "..", "public", "mascots");
const work = mkdtempSync(join(tmpdir(), "aoko-fx-"));
// alpha 用有损的 50：光晕的 alpha 很平滑，压到 50 看不出差别；80 往上 libwebp 几乎按无损存，体积翻倍。
const webp = ["-define", "webp:alpha-quality=50", "-define", "webp:alpha-filter=best", "-define", "webp:method=6", "-quality", "72"];
const hd = (src: string) => join(dir, `${src}-HD.png`);
const out = (name: string) => join(outDir, `aoko-fx-${name}.webp`);

function upscaled(src: string) {
  const file = join(work, `${src}-x${SR_SCALE}.png`);
  execFileSync("uv", ["run", "-q", "--with", "torch", "--with", "spandrel", "--with", "pillow", "--with", "numpy", "python", "-I", join(import.meta.dirname, "aoko-fx-sr.py"), weights, hd(src), file], { stdio: ["ignore", "ignore", "inherit"] });
  return file;
}

try {
  for (const c of CIRCLES) {
    const k = c.sr ? SR_SCALE : 1;
    const half = (c.r / RIM) * k;
    const box = `${Math.round(2 * half)}x${Math.round(2 * half)}+${Math.round(c.cx * k - half)}+${Math.round(c.cy * k - half)}`;
    execFileSync("magick", [c.sr ? upscaled(c.src) : hd(c.src), "-background", "none", "-gravity", "NorthWest", "-extent", box, "+repage", "-filter", "Lanczos", "-resize", `${c.size}x${c.size}!`, ...webp, out(c.out)]);
  }
  for (const b of BOLTS) execFileSync("magick", [hd(b.src), "-resize", BOLT_SIZE, ...webp, out(b.out)]);
  for (const c of CUES) {
    const box = `${c.size}x${c.size}`;
    execFileSync("magick", [hd(c.src), "-filter", "Lanczos", "-resize", box, "-background", "none", "-gravity", "center", "-extent", box, ...webp, out(c.out)]);
  }
  for (const f of FRAMES) execFileSync("magick", [hd(f.src), "-filter", "Lanczos", "-resize", `${FRAME_WIDTH}x`, ...webp, out(f.out)]);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`写到 ${outDir}`);
