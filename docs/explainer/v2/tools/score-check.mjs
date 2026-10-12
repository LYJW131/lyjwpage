import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { scoreInputs } from "../../../../scripts/explainer-score.mjs";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workers = Number(process.env.SCORE_WORKERS || Math.min(16, availableParallelism()));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
try {
  const page = await browser.newPage();
  const sources = scoreInputs(dir).filter((name) => !name.startsWith("tools/")).map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
  await page.evaluate((files) => { for (const source of files) (0, eval)(source); }, sources);
  const started = performance.now();
  const result = await page.evaluate(async ({ full, workers, browserFallback }) => {
    const score = window.Score.build(full ? window.PLAN : [window.PLAN[0], window.PLAN[0], window.PLAN[0]]);
    if (browserFallback) {
      const Original = window.AudioBuffer;
      let largeVoiceBuffers = 0;
      window.AudioBuffer = new Proxy(Original, { construct(target, args) {
        if (args[0].length >= Math.ceil((score.duration + window.Score.tail) * window.Score.sampleRate)) largeVoiceBuffers++;
        return Reflect.construct(target, args);
      } });
      let buffer;
      try { buffer = await window.Score.render(); } finally { window.AudioBuffer = Original; }
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) for (const value of buffer.getChannelData(c)) {
        if (!Number.isFinite(value)) throw new Error("Invalid fallback audio sample");
        peak = Math.max(peak, Math.abs(value));
      }
      if (largeVoiceBuffers !== 0 || !(peak > 0 && peak < 0.892)) throw new Error(`Invalid fallback audio: largeVoiceBuffers=${largeVoiceBuffers}, peak=${peak}`);
      return { mode: "browser-fallback", durationSeconds: buffer.length / buffer.sampleRate, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, largeVoiceBuffers, peak, finite: true };
    }
    const reference = await window.Score.render({ raw: true, workers, precomputeVoices: true });
    const parallel = await window.Score.renderParallel({ raw: true, workers });
    if (reference.length !== parallel.length) throw new Error("Audio duration differs");
    let maxError = 0, errorEnergy = 0, signalEnergy = 0, peak = 0;
    for (let c = 0; c < reference.numberOfChannels; c++) {
      const a = reference.getChannelData(c), b = parallel.getChannelData(c);
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error(`Invalid sample: channel ${c}, frame ${i}`);
        const error = a[i] - b[i];
        maxError = Math.max(maxError, Math.abs(error)); errorEnergy += error * error; signalEnergy += a[i] * a[i]; peak = Math.max(peak, Math.abs(b[i]));
      }
    }
    const pad = score.notes.find((note) => note.kind === "pad" && note.level > 0 && note.end - note.t > 1);
    const offset = (pad.t + pad.end) / 2;
    const slice = await window.Score.render({ raw: true, solo: "pad", offset, frames: Math.round(0.25 * parallel.sampleRate) });
    let sliceEnergy = 0;
    for (const value of slice.getChannelData(0)) {
      if (!Number.isFinite(value)) throw new Error("Invalid offset audio sample");
      sliceEnergy += value * value;
    }
    const offsetPadRms = Math.sqrt(sliceEnergy / slice.length);
    if (!(offsetPadRms > 0.00001)) throw new Error("Sustained pad is silent at render offset");
    const errorDb = 10 * Math.log10(Math.max(errorEnergy, Number.MIN_VALUE) / signalEnergy);
    if (!(peak > 0 && maxError < 0.001 && errorDb < -70)) throw new Error(`Audio differs: peak=${peak}, maxError=${maxError}, errorDb=${errorDb}`);
    return { durationSeconds: parallel.length / parallel.sampleRate, sampleRate: parallel.sampleRate, channels: parallel.numberOfChannels, workers, maxError, errorDb, peak, offsetPadRms, finite: true };
  }, { full: process.argv.includes("--full"), workers, browserFallback: process.argv.includes("--browser-fallback") });
  const report = { ...result, browserVersion: browser.version(), elapsedSeconds: (performance.now() - started) / 1000 };
  if (process.env.SCORE_CHECK_REPORT) fs.writeFileSync(process.env.SCORE_CHECK_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
