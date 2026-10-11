import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const started = performance.now();
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
const browserVersion = b.version();
const p = await b.newPage();
await p.goto(`file://${dir}/index.html?export`);
await p.evaluate(() => window.__ready);
const ready = performance.now();
console.log("Score page ready; rendering full audio");
const result = await p.evaluate(async () => {
  const started = performance.now();
  const buf = await window.Score.render();
  const synthesized = performance.now();
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
  const b64 = btoa(s);
  return { b64, durationSeconds: n / sr, sampleRate: sr, channels: ch, synthesisMs: synthesized - started, wavEncodingMs: performance.now() - synthesized };
});
const transferred = performance.now();
await b.close();
const wav = path.join(dir, ".score.wav");
fs.writeFileSync(wav, Buffer.from(result.b64, "base64"));
const encodingStarted = performance.now();
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "160k", path.join(dir, "score.mp3")]);
fs.rmSync(wav);
const finished = performance.now();
const metrics = {
  commit: process.env.GITHUB_SHA || null,
  runner: process.env.RUNNER_NAME || null,
  nodeVersion: process.version,
  browserVersion,
  ffmpegVersion: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0],
  durationSeconds: result.durationSeconds,
  sampleRate: result.sampleRate,
  channels: result.channels,
  bytes: fs.statSync(path.join(dir, "score.mp3")).size,
  seconds: {
    browserSetup: (ready - started) / 1000,
    synthesis: result.synthesisMs / 1000,
    wavEncoding: result.wavEncodingMs / 1000,
    transfer: Math.max(0, transferred - ready - result.synthesisMs - result.wavEncodingMs) / 1000,
    wavWriteAndBrowserClose: (encodingStarted - transferred) / 1000,
    mp3Encoding: (finished - encodingStarted) / 1000,
    total: (finished - started) / 1000,
  },
};
if (process.env.SCORE_METRICS_PATH) fs.writeFileSync(process.env.SCORE_METRICS_PATH, JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
