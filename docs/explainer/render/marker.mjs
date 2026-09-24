// 章节首拍的「提示音」有多突出：章节首拍前后 0.6 s 的高频（>2.5 kHz）能量，对比上一小节首拍
import { spawnSync } from "node:child_process";
const [wav] = process.argv.slice(2);
const T = [28.8, 72.0, 120.0, 153.6, 192.0, 211.2, 230.4, 254.4];
const e = (t0) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t0 - 0.25), "-t", "0.6", "-i", wav, "-af", "highpass=f=2500,astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"], { encoding: "utf8" });
  const m = [...r.stdout.matchAll(/RMS_level=(-?[\d.]+)/g)].pop();
  return m ? +m[1] : NaN;
};
console.log(wav.split("/").slice(-2).join("/"), T.map((t) => `${t}:${(e(t) - e(t - 2.4)).toFixed(1)}dB`).join("  "));
