import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { availableParallelism } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreInputs } from "../../../../scripts/explainer-score.mjs";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(dir, "score.mp3");
const workers = Number(process.env.SCORE_WORKERS || Math.min(16, availableParallelism()));
if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error("SCORE_WORKERS must be an integer from 1 to 16");
const endpoint = `/pcm/${randomUUID()}`;
let encoder;
const transfer = { next: 0, bytes: 0, stderr: "", hash: createHash("sha256"), started: 0, done: null };
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<!doctype html><title>Score render</title>");
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1"), part = Number(url.searchParams.get("part")), last = url.searchParams.get("last") === "1";
  if (req.method !== "POST" || url.pathname !== endpoint || part !== transfer.next || (part === 0) === Boolean(encoder)) {
    res.writeHead(404).end();
    return;
  }
  if (part === 0) {
    transfer.started = performance.now();
    encoder = spawn("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "160k", output], { stdio: ["pipe", "ignore", "pipe"] });
    encoder.stderr.on("data", (chunk) => { transfer.stderr = (transfer.stderr + chunk).slice(-8192); });
    transfer.done = new Promise((resolve, reject) => {
      encoder.once("error", reject);
      encoder.once("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${transfer.stderr}`)));
    });
    transfer.done.catch(() => {});
  }
  transfer.next++;
  try {
    for await (const chunk of req) {
      transfer.hash.update(chunk);
      transfer.bytes += chunk.length;
      if (!encoder.stdin.write(chunk)) await once(encoder.stdin, "drain");
    }
    if (!last) return void res.writeHead(204).end();
    encoder.stdin.end();
    await transfer.done;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ pcmSha256: transfer.hash.digest("hex"), pcmBytes: transfer.bytes, transferAndMp3EncodingSeconds: (performance.now() - transfer.started) / 1000 }));
  } catch (error) {
    encoder.kill();
    if (!res.destroyed) res.writeHead(500).end(String(error));
  }
});
const started = performance.now();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const sources = scoreInputs(dir).filter((name) => !name.startsWith("tools/")).map((name) => ({ name, source: fs.readFileSync(path.join(dir, name), "utf8") }));
  await page.evaluate((files) => {
    for (const { name, source } of files) (0, eval)(`${source}\n//# sourceURL=${name}`);
    window.Score.build(window.PLAN);
  }, sources);
  const ready = performance.now();
  console.log(`Score inputs ready; rendering with ${workers} workers`);
  const result = await page.evaluate(async ({ workers, endpoint }) => {
    const started = performance.now();
    const buf = await window.Score.renderParallel({ workers });
    const synthesized = performance.now();
    const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
    if (ch !== 2 || sr !== 48000) throw new Error("Expected 48 kHz stereo audio");
    const pcm = new DataView(new ArrayBuffer(n * ch * 2)), data = [buf.getChannelData(0), buf.getChannelData(1)];
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      if (!Number.isFinite(data[c][i])) throw new Error(`Invalid audio sample: channel ${c}, frame ${i}`);
      const v = Math.max(-1, Math.min(1, data[c][i]));
      pcm.setInt16((i * ch + c) * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    const encoded = performance.now();
    // 分块上传：Playwright 把请求体整块转成字符串，整片 PCM 一次 POST 会超过 V8 的字符串上限（ERR_STRING_TOO_LONG）。
    const CHUNK = 4 << 20, parts = Math.ceil(pcm.byteLength / CHUNK);
    let response;
    for (let part = 0; part < parts; part++) {
      const body = new Uint8Array(pcm.buffer, part * CHUNK, Math.min(CHUNK, pcm.byteLength - part * CHUNK));
      response = await fetch(`${endpoint}?part=${part}&last=${part + 1 === parts ? 1 : 0}`, { method: "POST", body });
      if (!response.ok) throw new Error(await response.text());
    }
    const encoding = await response.json();
    if (encoding.pcmBytes !== pcm.byteLength) throw new Error("Incomplete PCM transfer");
    return { durationSeconds: n / sr, sampleRate: sr, channels: ch, ...encoding, synthesisMs: synthesized - started, pcmEncodingMs: encoded - synthesized, transferAndMp3EncodingMs: performance.now() - encoded };
  }, { workers, endpoint });
  const finished = performance.now();
  const metrics = {
    commit: process.env.GITHUB_SHA || null,
    runner: process.env.RUNNER_NAME || null,
    nodeVersion: process.version,
    browserVersion: browser.version(),
    ffmpegVersion: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0],
    workers,
    durationSeconds: result.durationSeconds,
    sampleRate: result.sampleRate,
    channels: result.channels,
    pcmSha256: result.pcmSha256,
    bytes: fs.statSync(output).size,
    seconds: {
      browserSetup: (ready - started) / 1000,
      synthesis: result.synthesisMs / 1000,
      pcmEncoding: result.pcmEncodingMs / 1000,
      transferAndMp3Encoding: result.transferAndMp3EncodingMs / 1000,
      total: (finished - started) / 1000,
    },
  };
  if (process.env.SCORE_METRICS_PATH) fs.writeFileSync(process.env.SCORE_METRICS_PATH, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser?.close();
  if (encoder && encoder.exitCode === null) encoder.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
