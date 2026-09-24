// 两份 16-bit PCM wav 逐样本比较：整体与分段的差值 RMS
import fs from "node:fs";
const load = (p) => { const b = fs.readFileSync(p); let o = 12; while (b.toString("ascii", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4); const n = b.readUInt32LE(o + 4) / 2; return new Int16Array(b.buffer, b.byteOffset + o + 8, n); };
const [pa, pb] = process.argv.slice(2);
const a = load(pa), b = load(pb), sr = 44100, ch = 2;
const db = (s, n) => (10 * Math.log10(s / n / 32768 / 32768 + 1e-24)).toFixed(1);
let sa = 0, sd = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) { sa += a[i] * a[i]; const d = a[i] - b[i]; sd += d * d; }
console.log("len", a.length, b.length, "rms", db(sa, a.length), "diff", db(sd, a.length));
const rows = [];
for (let s = 0; s < 289; s += 1) { let x = 0, y = 0; for (let i = s * sr * ch; i < (s + 1) * sr * ch && i < a.length; i++) { x += a[i] * a[i]; const d = a[i] - b[i]; y += d * d; } rows.push([s, +db(x, sr * ch), +db(y, sr * ch)]); }
const worst = [...rows].sort((p, q) => (q[2] - q[1]) - (p[2] - p[1])).slice(0, 8);
console.log("worst seconds (t, music dB, diff dB):", JSON.stringify(worst));
console.log("first diff sample:", (() => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (i / ch / sr).toFixed(3) + "s"; return "none"; })());
