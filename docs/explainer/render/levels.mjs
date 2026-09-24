// 逐类音效的「压过配乐多少分贝」：node levels.mjs <music.wav> <dir>
// 每个 cue：音效轨在 [t, t+0.12] 的峰值 vs 让位后配乐在 [t-0.25, t+0.25] 的 RMS
import fs from "node:fs";
function readWav(p) {
  const b = fs.readFileSync(p);
  let o = 12, fmt, data;
  while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "fmt ") fmt = o + 8; if (id === "data") { data = [o + 8, sz]; break; } o += 8 + sz; }
  const ch = b.readUInt16LE(fmt + 2), sr = b.readUInt32LE(fmt + 4);
  const n = data[1] / 2 / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(data[0] + (i * ch + c) * 2); x[i] = s / ch / 32768; }
  return { sr, x };
}
const [musicP, dir] = process.argv.slice(2);
const M = readWav(musicP), S = readWav(dir + "/sfx.wav"), D = readWav(dir + "/duck.wav");
const cues = JSON.parse(fs.readFileSync(dir + "/cues.json", "utf8"));
const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const by = {};
for (const c of cues) {
  const i0 = Math.floor(c.t * S.sr), i1 = Math.floor((c.t + 0.12) * S.sr);
  let pk = 0; for (let i = i0; i < i1 && i < S.x.length; i++) pk = Math.max(pk, Math.abs(S.x[i]));
  const j0 = Math.max(0, Math.floor((c.t - 0.25) * M.sr)), j1 = Math.min(M.x.length, Math.floor((c.t + 0.25) * M.sr));
  let e = 0; for (let j = j0; j < j1; j++) { const v = M.x[j] * D.x[j]; e += v * v; }
  const rms = Math.sqrt(e / Math.max(1, j1 - j0));
  (by[c.type] ||= []).push(db(pk) - db(rms));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const [k, v] of Object.entries(by).sort((a, b) => med(a[1]) - med(b[1]))) console.log(k.padEnd(14), "n=" + String(v.length).padEnd(4), "median SFX peak − music RMS:", med(v).toFixed(1), "dB");
