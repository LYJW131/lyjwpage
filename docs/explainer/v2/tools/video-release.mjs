import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { launch, openFilm } from "./browser.mjs";
import { SCORE_PATH_PREFIX, scoreObjectKey, VIDEO_CODECS, VIDEO_LANGS, videoHash, videoObjectKey } from "../../../../scripts/explainer-score.mjs";

const HELP = `用法：node docs/explainer/v2/tools/video-release.mjs [--lang zh|en] [--jobs 3] [--work 目录] [--no-upload] [--dry-run] [--until 秒]

出 /explainer 的成片视频（中英各一版，AV1 与 HEVC 各一份）并传到 R2 的 lyjw-homepage 桶，页面经同源 /img/<键> 取：
  1. 按源码算四个对象键（scripts/explainer-score.mjs#videoObjectKey），HEAD 线上 /img/<键>，已经在的不重做、不覆盖；
  2. 取线上配乐 /img/<配乐键>，在页面里叠上音效，导出整条音轨（WAV），就是页面放的那一条；
  3. 本机 Chrome 逐帧渲 1920×1080、24 fps 的 PNG，每 10 秒一段边渲边喂给 ffmpeg，存成近无损的中间片；
  4. 编 AV1（libsvtav1，配 Opus 160k）和 HEVC（libx265，没有就 hevc_videotoolbox；配 AAC 192k）两份；
  5. 用已登录的 wrangler 上传，读回 HEAD 核对 200 与大小；最后打印每份的码率、大小和时长。
中断后重跑接着做：渲好的段、编好的文件、导出的音轨都留在工作目录（默认 docs/explainer/v2/video/，不进仓库），
目录按源码哈希分开，片子改了就是新目录；旧目录用不上了可以删。

  --lang zh|en  只出一种语言；默认中英都出
  --jobs N      同时渲几段（每段一个页面），默认 3
  --work 目录   工作目录
  --no-upload   只渲和编，不上传
  --dry-run     只打印四个键和线上状态
  --until 秒    试片：只出前这么多秒，放在工作目录的 <哈希>-trial-<秒>s/，不上传

要：本机 Chrome；装好的 render 依赖（pnpm --dir docs/explainer/render install --ignore-workspace）；
带 libsvtav1、libx264、libx265、libopus 的 ffmpeg（Homebrew 的就带：brew install ffmpeg）；上传还要 pnpm exec wrangler login。
配乐要先在 R2 上：改了乐谱的提交合进 main 后由 .github/workflows/explainer-score.yml 渲染上传，等它跑完再出视频。`;

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      help: { type: "boolean" }, lang: { type: "string" }, jobs: { type: "string", default: "3" }, work: { type: "string" },
      "no-upload": { type: "boolean" }, "dry-run": { type: "boolean" }, until: { type: "string" },
    },
    strict: true,
  }));
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(2);
}
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SRC, "../../..");
const ORIGIN = "https://lyjw.me";
const BUCKET = "lyjw-homepage";
const FPS = 24, SEG = 10 * FPS;
// wrangler r2 object put 一次最多传 300 MiB（wrangler 的 MAX_UPLOAD_SIZE_BYTES）：下面的码率按整片约 553 秒定在它以内，片子明显变长要跟着降
const MAX_BYTES = 300 * 1024 * 1024;
const COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const TO_709 = "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p";
const MEZZ = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "6", "-pix_fmt", "yuv420p", "-g", String(SEG)];
const GOP = ["-g", String(4 * FPS)];
// AV1 配 Opus（放得了 AV1 的浏览器都认 MP4 里的 Opus，Safari 认不出时 watch.js 按 codecs 退到 HEVC），HEVC 配 AAC-LC（老 Safari 也能放）
const OPUS = ["-c:a", "libopus", "-b:a", "160k", "-ac", "2", "-ar", "48000"];
const AAC = (encoder) => ["-c:a", encoder, "-b:a", "192k", "-ac", "2", "-ar", "48000"];
// 码率和档次级别须与 v2/watch.js#TYPES 的 codecs 同步
const AV1 = ["-c:v", "libsvtav1", "-preset", "5", "-b:v", "3600k", "-pix_fmt", "yuv420p10le", "-svtav1-params", "tune=0", ...GOP];
const HEVC_KBPS = 3900;
const X265 = (pass, stats) => ["-c:v", "libx265", "-preset", "medium", "-b:v", `${HEVC_KBPS}k`, "-pix_fmt", "yuv420p", "-profile:v", "main", "-tag:v", "hvc1", "-x265-params", `pass=${pass}:stats=${stats}:level-idc=40:log-level=error`, ...GOP];
const VIDEOTOOLBOX = ["-c:v", "hevc_videotoolbox", "-b:v", `${HEVC_KBPS}k`, "-profile:v", "main", "-tag:v", "hvc1", ...GOP];

const langs = args.lang === undefined ? VIDEO_LANGS : [args.lang];
if (!langs.every((l) => VIDEO_LANGS.includes(l))) {
  console.error(`--lang 只认 ${VIDEO_LANGS.join(" / ")}`);
  process.exit(2);
}
const jobs = +args.jobs, until = args.until === undefined ? null : +args.until;
if (!(Number.isInteger(jobs) && jobs >= 1 && jobs <= 8) || (until !== null && !(until > 0))) {
  console.error("--jobs 取 1–8 的整数，--until 取正的秒数");
  process.exit(2);
}
const upload = !args["no-upload"] && until === null;

const run = (cmd, argv, o = {}) => spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 << 20, ...o });
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function head(url) {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
    return { status: r.status, size: +(r.headers.get("content-length") ?? NaN) };
  } catch (e) {
    return { status: 0, size: NaN, error: String(e) };
  }
}

const hash = videoHash(SRC);
const targets = langs.flatMap((lang) => VIDEO_CODECS.map((codec) => {
  const key = videoObjectKey(lang, codec, SRC, hash);
  return { lang, codec, key, url: `${ORIGIN}${SCORE_PATH_PREFIX}/${key}` };
}));
await Promise.all(targets.map(async (t) => (t.online = await head(t.url))));
for (const t of targets) console.log(`${t.lang} ${t.codec.padEnd(4)} ${t.key}  线上 ${t.online.status || t.online.error}`);
if (args["dry-run"]) process.exit(0);
// 只有明确 404 才算没有：查不清时（断网、5xx）不出也不传，免得把已经在的对象覆盖掉（边缘缓存着旧字节，Range 会拼错）
const unsure = upload ? targets.filter((t) => ![200, 404].includes(t.online.status)) : [];
if (unsure.length) {
  console.error(`查不清线上有没有 ${unsure.map((t) => `${t.lang} ${t.codec}`).join("、")}，网络好了再重跑`);
  process.exit(1);
}
const todo = upload ? targets.filter((t) => t.online.status === 404) : targets;
if (!todo.length) {
  console.log("四份都已经在 R2 上，不用出。");
  process.exit(0);
}

const encoders = run("ffmpeg", ["-hide_banner", "-encoders"]).stdout || "";
const has = (name) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(encoders);
const hevc = has("libx265") ? "libx265" : has("hevc_videotoolbox") ? "hevc_videotoolbox" : null;
const aac = has("aac_at") ? "aac_at" : "aac";
const lack = ["libx264", "libsvtav1", "libopus"].filter((e) => !has(e)).concat(hevc ? [] : ["libx265"]);
if (!encoders || lack.length) {
  console.error(`ffmpeg ${encoders ? `缺编码器 ${lack.join("、")}` : "没装"}：Homebrew 的 ffmpeg 自带这几个，brew install ffmpeg（装过就 brew upgrade ffmpeg）`);
  process.exit(1);
}
if (hevc !== "libx265") console.warn("没有 libx265，HEVC 改用 hevc_videotoolbox：同码率下画质差一些");
if (upload) {
  const who = run("pnpm", ["exec", "wrangler", "whoami"], { cwd: REPO });
  if (who.status !== 0 || /not authenticated/i.test(who.stdout + who.stderr)) {
    console.error("wrangler 没登录：先在仓库根目录跑 pnpm exec wrangler login（只要浏览器里点一下授权），再重跑这条命令");
    process.exit(1);
  }
}

const work = path.resolve(args.work ?? path.join(SRC, "video"));
const dir = path.join(work, until === null ? hash.slice(0, 16) : `${hash.slice(0, 16)}-trial-${until}s`);
fs.mkdirSync(dir, { recursive: true });

const scoreKey = scoreObjectKey(SRC);
let scoreFile = path.join(dir, scoreKey);
if (!fs.existsSync(scoreFile)) {
  const r = await fetch(`${ORIGIN}${SCORE_PATH_PREFIX}/${scoreKey}`, { signal: AbortSignal.timeout(120_000) }).catch((e) => ({ ok: false, status: String(e) }));
  if (r.ok) {
    fs.writeFileSync(`${scoreFile}.part`, Buffer.from(await r.arrayBuffer()));
    fs.renameSync(`${scoreFile}.part`, scoreFile);
  } else if (until !== null && fs.existsSync(path.join(SRC, "score.mp3"))) {
    scoreFile = path.join(SRC, "score.mp3");
    console.warn(`配乐 ${scoreKey} 不在线上，试片先用本地的 v2/score.mp3（可能是旧的）`);
  } else {
    console.error(`配乐 ${scoreKey} 还不在线上（${r.status}）：乐谱改了的提交合进 main 后 explainer-score.yml 会渲染上传，等它跑完再来`);
    process.exit(1);
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mp3": "audio/mpeg", ".woff2": "font/woff2" };
const ROOT = path.dirname(SRC);
let sink = null;
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "POST" && p === "/__pcm" && sink) {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => { sink(Buffer.concat(parts)); res.writeHead(204).end(); });
    return;
  }
  // 页面在没有 __assets 时取 v2/score.mp3：这里换成刚取到的线上那份，不用本地可能过期的
  const f = p === "/v2/score.mp3" ? scoreFile : path.join(ROOT, p);
  if (req.method !== "GET" || !(f === scoreFile || (f.startsWith(ROOT + path.sep) && !f.startsWith(work + path.sep))) || !fs.statSync(f, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();

function wavHeader(frames, sr) {
  const h = Buffer.alloc(44), bytes = frames * 8;
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write("data", 36); h.writeUInt32LE(bytes, 40);
  return h;
}

async function exportAudio(wav) {
  if (fs.existsSync(wav)) return;
  const t0 = Date.now(), { page, errors } = await openFilm(browser, { lang: "zh", scale: 0.25, base });
  const info = await page.evaluate(async () => {
    await window.__loadAudio("score");
    const b = window.__audio();
    return { source: window.__audioSource, frames: b.length, sr: b.sampleRate, channels: b.numberOfChannels };
  });
  if (info.source !== "score" || info.channels !== 2) throw new Error(`页面没用上取来的配乐（${JSON.stringify(info)}）`);
  const fd = fs.openSync(`${wav}.part`, "w");
  fs.writeSync(fd, wavHeader(info.frames, info.sr));
  sink = (chunk) => fs.writeSync(fd, chunk);
  for (let i = 0; i < info.frames; i += info.sr * 10) {
    await page.evaluate(async ({ i, n }) => {
      const b = window.__audio(), L = b.getChannelData(0), R = b.getChannelData(1), out = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { out[2 * k] = L[i + k]; out[2 * k + 1] = R[i + k]; }
      const r = await fetch("/__pcm", { method: "POST", body: out });
      if (!r.ok) throw new Error(`传音轨失败 ${r.status}`);
    }, { i, n: Math.min(info.sr * 10, info.frames - i) });
  }
  sink = null;
  fs.closeSync(fd);
  if (errors.length) throw new Error(`导出音轨时页面报错：\n${errors.join("\n")}`);
  await page.context().close();
  fs.renameSync(`${wav}.part`, wav);
  console.log(`音轨 ${(info.frames / info.sr).toFixed(2)} 秒（配乐 ${scoreKey} 加音效），用了 ${Math.round((Date.now() - t0) / 1000)} 秒`);
}

async function renderFrames(lang, total) {
  const out = path.join(dir, lang), segs = Math.ceil(total / SEG);
  fs.mkdirSync(out, { recursive: true });
  const file = (k) => path.join(out, `seg-${String(k).padStart(4, "0")}.mp4`);
  const pending = Array.from({ length: segs }, (_, k) => k).filter((k) => !fs.existsSync(file(k)));
  let next = 0, done = segs - pending.length, frames = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, pending.length) }, async () => {
    const { page, errors } = await openFilm(browser, { lang, scale: 1, base });
    const cdp = await page.context().newCDPSession(page);
    // 页面载入后画的头一帧会和之后再画同一时刻差几个色阶：先空画一次（同 frames.mjs）
    await page.evaluate(() => window.__seek(0));
    while (next < pending.length) {
      const k = pending[next++], from = k * SEG, to = Math.min(total, from + SEG), part = `${file(k)}.part`;
      const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "png", "-framerate", String(FPS), "-i", "pipe:0", "-vf", TO_709, ...MEZZ, ...COLOR, "-f", "mp4", part], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      ff.stderr.on("data", (c) => (stderr += c));
      const exit = new Promise((resolve) => ff.once("close", resolve));
      for (let f = from; f < to; f++) {
        await page.evaluate((s) => window.__seek(s), f / FPS);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
        if (!ff.stdin.write(Buffer.from(data, "base64"))) await Promise.race([once(ff.stdin, "drain"), exit]);
        frames++;
      }
      ff.stdin.end();
      const code = await exit;
      if (code !== 0) throw new Error(`${lang} 第 ${k} 段编中间片失败：${stderr}`);
      if (errors.length) throw new Error(`${lang} 渲帧时页面报错：\n${errors.join("\n")}`);
      fs.renameSync(part, file(k));
      done++;
      const secs = (Date.now() - t0) / 1000, fps = frames / secs, left = (total - done * SEG) / fps;
      console.log(`${lang} ${done}/${segs} 段 · ${fps.toFixed(1)} 帧/秒 · 还要约 ${Math.max(0, Math.ceil(left / 60))} 分钟`);
    }
    await page.context().close();
  }));
  fs.writeFileSync(path.join(out, "list.txt"), `ffconcat version 1.0\n${Array.from({ length: segs }, (_, k) => `file '${path.basename(file(k))}'`).join("\n")}\n`);
  return path.join(out, "list.txt");
}

function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,width,height,bit_rate,nb_frames", "-of", "json", file]);
  return JSON.parse(r.stdout);
}

function encode(t, list, wav, total, out) {
  if (fs.existsSync(out)) return;
  const part = `${out}.part`, secs = total / FPS;
  const audioSecs = until ?? +probe(wav).format.duration;
  const input = ["-f", "concat", "-safe", "0", "-i", list, "-i", wav, "-map", "0:v:0", "-map", "1:a:0"];
  // 配乐比画面长一截（片尾余音）：最后一帧定格到音轨结束。长度用 -t 定死，x265 两遍的帧数才对得上
  const vf = ["-vf", `tpad=stop_mode=clone:stop_duration=${Math.max(0, audioSecs - secs + 1).toFixed(3)}`, "-t", audioSecs.toFixed(3)];
  const tail = [...(t.codec === "av1" ? OPUS : AAC(aac)), ...COLOR, "-movflags", "+faststart", "-f", "mp4", part];
  const t0 = Date.now(), go = (argv) => {
    const r = run("ffmpeg", ["-v", "error", "-stats", "-y", ...argv], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`${t.lang} ${t.codec} 编码失败`);
  };
  console.log(`编 ${t.lang} ${t.codec}…`);
  if (t.codec === "av1") go([...input, ...vf, ...AV1, ...tail]);
  else if (hevc === "libx265") {
    const stats = path.join(dir, `${t.lang}.x265.log`);
    go(["-f", "concat", "-safe", "0", "-i", list, ...vf, ...X265(1, stats), "-an", "-f", "null", "-"]);
    go([...input, ...vf, ...X265(2, stats), ...tail]);
  } else go([...input, ...vf, ...VIDEOTOOLBOX, ...tail]);
  fs.renameSync(part, out);
  console.log(`${t.lang} ${t.codec} 编好，用了 ${Math.round((Date.now() - t0) / 60000)} 分钟`);
}

const rows = [];
try {
  const film = await (async () => {
    const { page } = await openFilm(browser, { scale: 0.25, base });
    const d = await page.evaluate(() => window.__duration);
    await page.context().close();
    return d;
  })();
  const total = Math.ceil((until === null ? film : Math.min(until, film)) * FPS);
  const lists = {};
  for (const lang of langs) if (todo.some((t) => t.lang === lang)) lists[lang] = await renderFrames(lang, total);
  const wav = path.join(dir, "audio.wav");
  await exportAudio(wav);
  for (const [lang, list] of Object.entries(lists)) {
    for (const t of todo.filter((t) => t.lang === lang)) {
      t.file = path.join(dir, until === null ? t.key : `${lang}.${t.codec}.mp4`);
      encode(t, list, wav, total, t.file);
    }
  }
  for (const t of todo) {
    const p = probe(t.file), v = p.streams.find((s) => s.codec_type === "video"), size = +p.format.size;
    const row = { 版本: `${t.lang} ${t.codec}`, 编码: `${v.codec_name}/${v.codec_tag_string} ${v.profile} L${v.level} ${v.pix_fmt}`, 时长: `${(+p.format.duration).toFixed(2)} 秒`, 大小: mb(size), 码率: `${(+p.format.bit_rate / 1e6).toFixed(2)} Mbps`, 线上: "" };
    rows.push(row);
    if (!upload) { row.线上 = "没传"; continue; }
    if (size > MAX_BYTES) throw new Error(`${t.key} 有 ${mb(size)}，超过 wrangler 一次能传的 300 MiB：调低 ${t.codec === "av1" ? "AV1" : "HEVC_KBPS"} 的码率再出`);
    const marker = `${t.file}.uploaded`;
    if (!fs.existsSync(marker)) {
      const now = await head(t.url);
      if (now.status !== 404) {
        row.线上 = now.status === 200 ? "200，别处已经传过，没覆盖" : `查不清（${now.status || now.error}），没传`;
        continue;
      }
      const r = run("pnpm", ["exec", "wrangler", "r2", "object", "put", `${BUCKET}/${t.key}`, `--file=${t.file}`, "--remote", "--content-type=video/mp4", "--cache-control=public, max-age=31536000, immutable"], { cwd: REPO, stdio: "inherit" });
      if (r.status !== 0) throw new Error(`上传 ${t.key} 失败`);
      fs.writeFileSync(marker, new Date().toISOString());
    }
    const back = await head(t.url);
    row.线上 = back.status === 200 && back.size === size ? "200，大小一致" : `读回 ${back.status || back.error}${back.status === 200 ? `，大小 ${back.size} ≠ ${size}` : ""}`;
    if (back.status === 404) row.线上 += "（站点的 /img 认不认视频键？看 src/lib/site-policy.ts#IMAGE_OBJECT_PATH 部署了没有）";
  }
} finally {
  await browser.close();
  server.close();
}
console.table(rows);
if (rows.some((r) => upload && !r.线上.startsWith("200"))) process.exit(1);
