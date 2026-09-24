// 按时间顺序拼联系表：node sheet.mjs <帧目录> <输出.png> [列数=4] [宽=480]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [dir, out, colsArg = "4", wArg = "480"] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /^f_[\d_]+\.png$/.test(f))
  .map((f) => ({ f, t: +f.slice(2, -4).replace("_", ".") })).sort((a, b) => a.t - b.t);
const tmp = fs.mkdtempSync(dir + "/.sheet-");
files.forEach((x, i) => fs.symlinkSync(`${dir}/${x.f}`, `${tmp}/${String(i).padStart(3, "0")}.png`));
const cols = +colsArg, rows = Math.ceil(files.length / cols);
execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", `${tmp}/%03d.png`, "-vf",
  `drawtext=text='%{eif\\:n\\:d}':x=8:y=8:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6,scale=${wArg}:-1,tile=${cols}x${rows}:padding=4`, "-frames:v", "1", out]);
fs.rmSync(tmp, { recursive: true });
console.log(files.map((x, i) => `${i}:${x.t}`).join("  "));
