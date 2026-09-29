// 把 score.js 渲成 score.mp3（播放器优先读它，省掉浏览器里十几秒的现合成）：node score-mp3.mjs
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
await p.goto(`file://${dir}/index.html?export`);
await p.evaluate(() => window.__ready);
const b64 = await p.evaluate(async () => {
  const buf = await window.Score.render();
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  const bytes = new Uint8Array(dv.buffer);
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await b.close();
const wav = path.join(dir, ".score.wav");
fs.writeFileSync(wav, Buffer.from(b64, "base64"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "160k", path.join(dir, "score.mp3")]);
fs.rmSync(wav);
console.log("score.mp3", fs.statSync(path.join(dir, "score.mp3")).size);
