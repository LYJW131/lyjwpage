// 混一种风格：node mixstyle.mjs <music.wav> <音效目录 含 sfx.wav duck.wav> <音效增益> <输出前缀> [配乐目标响度 LUFS=-17]
// 先把配乐校到同一响度（音效音量是按这个响度调的），再乘让位曲线、叠音效、限幅，输出 wav + mp3
import { spawnSync } from "node:child_process";
const [music, dir, g = "1", out, target = "-17"] = process.argv.slice(2);
const lufs = (file) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? +m[1] : NaN;
};
const I0 = lufs(music), gain = (+target - I0).toFixed(2);
const fc = `[0:a]volume=${gain}dB[mu];[mu][1:a]amultiply[m];[2:a]volume=${g}[s];[m][s]amix=inputs=2:normalize=0:duration=first,volume=2.6dB[x];[x]alimiter=limit=0.94:attack=3:release=60:level=disabled[y]`;
let r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", music, "-i", `${dir}/duck.wav`, "-i", `${dir}/sfx.wav`, "-filter_complex", fc, "-map", "[y]", "-c:a", "pcm_s16le", `${out}.wav`], { encoding: "utf8" });
if (r.status) { console.error(r.stderr); process.exit(1); }
r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", `${out}.wav`, "-c:a", "libmp3lame", "-b:a", "192k", `${out}.mp3`], { encoding: "utf8" });
if (r.status) { console.error(r.stderr); process.exit(1); }
const pk = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", `${out}.wav`, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const peak = [...pk.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop();
console.log(`${out}: 配乐 ${I0} LUFS → 增益 ${gain} dB；成品 ${lufs(out + ".wav")} LUFS，峰值 ${peak ? peak[1] : "?"} dBFS`);
