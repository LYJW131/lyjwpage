#!/usr/bin/env node
// 从《魔法使之夜》解包的演出图层里导出立绘特效与召唤秘技用的贴图到 public/mascots/aoko-fx-*.webp。
// 图层不在仓库里（TYPE-MOON 素材），用法：
//   node scripts/aoko-fx-assets.ts <演出用图层目录>
// 目录里要有 imgNNNN-HD.png 这批放大版。需要 ImageMagick 7（magick）。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// 法阵贴图裁成以圆心为中心、边长 2R/RIM 的正方形：aoko-fx.ts 按「外圈半径 = 半边长 × RIM」摆放，须与那边的 RIM 同步。
const RIM = 0.98;

type Circle = { src: string; out: string; cx: number; cy: number; r: number; size: number };

// 圆心与外径 R 是在 HD 图上逐像素量的（外径 = 非透明像素包围盒半宽）。
const CIRCLES: Circle[] = [
  { src: "img0642", out: "band", cx: 441.5, cy: 442.5, r: 430, size: 560 },
  { src: "img0659", out: "runes", cx: 429, cy: 429.5, r: 416.5, size: 640 },
  { src: "img0638", out: "ring", cx: 489.5, cy: 489.5, r: 476, size: 512 },
  { src: "img0641", out: "octa", cx: 456.5, cy: 457.5, r: 443, size: 256 },
];

// 电弧是 img0627–0630 那组镜头的整帧图层（2400×1440，与 2100×1260 的镜头同框），保留整帧，aoko-fx.ts 按镜头取景换算位置。
const BOLTS = [
  { src: "img0614", out: "bolt" },
  { src: "img0615", out: "bolt-fine" },
];
const BOLT_SIZE = "800x480!";

// 召唤秘技（aoko-summon.ts）用的：法印与星芒按原比例缩进透明正方形；闪电是别的演出里从画面边缘劈进来的整帧（2493×1500），保留整帧。
const SEALS = [
  { src: "img1623", out: "seal-star", size: 512 },
  { src: "img1627", out: "seal-wheel", size: 512 },
  { src: "img0456", out: "burst", size: 512 },
  { src: "img1046", out: "flare", size: 640 },
];
const STRIKES = ["img2349", "img2350", "img2351", "img2352", "img2353", "img2354"];
const STRIKE_SIZE = "1280x770!";

function sourceDir() {
  try {
    const { positionals } = parseArgs({ strict: true, allowPositionals: true, options: {} });
    if (positionals.length === 1 && existsSync(positionals[0])) return positionals[0];
  } catch {}
  console.error("用法：node scripts/aoko-fx-assets.ts <图层目录>");
  process.exit(2);
}
const dir = sourceDir();
const outDir = join(import.meta.dirname, "..", "public", "mascots");
const webp = ["-define", "webp:alpha-quality=80", "-define", "webp:method=6", "-quality", "72"];

for (const c of CIRCLES) {
  const half = c.r / RIM;
  const box = `${Math.round(2 * half)}x${Math.round(2 * half)}+${Math.round(c.cx - half)}+${Math.round(c.cy - half)}`;
  execFileSync("magick", [join(dir, `${c.src}-HD.png`), "-background", "none", "-gravity", "NorthWest", "-extent", box, "+repage", "-resize", `${c.size}x${c.size}!`, ...webp, join(outDir, `aoko-fx-${c.out}.webp`)]);
}
for (const b of BOLTS) {
  execFileSync("magick", [join(dir, `${b.src}-HD.png`), "-resize", BOLT_SIZE, ...webp, join(outDir, `aoko-fx-${b.out}.webp`)]);
}
for (const s of SEALS) {
  const box = `${s.size}x${s.size}`;
  execFileSync("magick", [join(dir, `${s.src}-HD.png`), "-resize", box, "-background", "none", "-gravity", "center", "-extent", box, ...webp, join(outDir, `aoko-fx-${s.out}.webp`)]);
}
STRIKES.forEach((src, i) => {
  execFileSync("magick", [join(dir, `${src}-HD.png`), "-resize", STRIKE_SIZE, ...webp, join(outDir, `aoko-fx-strike-${i + 1}.webp`)]);
});
console.log(`写到 ${outDir}`);
