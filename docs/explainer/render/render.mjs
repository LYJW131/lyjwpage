// 导出：node render.mjs audio <index.html> <out.wav> [风格 chip|piano|lofi|pluck] [只渲前几秒]
//       node render.mjs sfx <index.html> <输出目录> [音色 chip|soft]   （音效轨 sfx.wav + 配乐增益曲线 duck.wav + cues.json）
//       node render.mjs video <index.html> <music.wav> <out.mp4> [fps] [from] [to]
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";

const [mode, html, a, b, fpsArg = "30", fromArg, toArg] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.type(), m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + html + "?export");
await page.evaluate(() => window.__ready);

if (mode === "sfx") {
  const t0 = Date.now();
  fs.mkdirSync(a, { recursive: true });
  const cues = await page.evaluate(() => window.__cues());
  fs.writeFileSync(a + "/cues.json", JSON.stringify(cues));
  console.log("cues", cues.length, "analyze", ((Date.now() - t0) / 1000).toFixed(1) + "s");
  const r = await page.evaluate((pal) => window.__renderSfx(pal), b || "chip");
  fs.writeFileSync(a + "/sfx.wav", Buffer.from(r.sfx, "base64"));
  fs.writeFileSync(a + "/duck.wav", Buffer.from(r.duck, "base64"));
  const counts = {};
  for (const c of cues) counts[c.type] = (counts[c.type] || 0) + 1;
  console.log(JSON.stringify(counts));
  console.log("sfx done", ((Date.now() - t0) / 1000).toFixed(1) + "s");
} else if (mode === "audio") {
  const t0 = Date.now();
  const wav = await page.evaluate(([st, sec]) => window.__renderWav(st, sec), [b || "chip", fpsArg === "30" ? undefined : +fpsArg]);
  fs.writeFileSync(a, Buffer.from(wav, "base64"));
  console.log("wav", a, ((Date.now() - t0) / 1000).toFixed(1) + "s");
} else {
  const fps = +fpsArg;
  const dur = await page.evaluate(() => window.__duration);
  const from = fromArg ? +fromArg : 0, to = toArg ? Math.min(+toArg, dur) : dur;
  const N0 = Math.round(from * fps), N1 = Math.round(to * fps);
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-ss", String(from), "-t", String(to - from), "-i", a,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-tune", "animation",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", b,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((r) => ff.on("close", r));
  const t0 = Date.now();
  for (let i = N0; i < N1; i++) {
    await page.evaluate((t) => window.__seek(t), i / fps);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((i - N0) % 600 === 0) console.log(`frame ${i - N0}/${N1 - N0} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  const code = await done;
  const warn = await page.evaluate(() => window.__warn());
  if (warn.length) console.log("WARN:\n  " + warn.join("\n  "));
  console.log("ffmpeg exit", code, "total", ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
await browser.close();
