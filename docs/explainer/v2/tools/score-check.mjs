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
  const result = await page.evaluate(async ({ full, workers }) => {
    window.Score.build(full ? window.PLAN : [window.PLAN[0], window.PLAN[0], window.PLAN[0]]);
    const reference = await window.Score.render({ raw: true, workers });
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
    const errorDb = 10 * Math.log10(Math.max(errorEnergy, Number.MIN_VALUE) / signalEnergy);
    if (!(peak > 0 && maxError < 0.001 && errorDb < -70)) throw new Error(`Audio differs: peak=${peak}, maxError=${maxError}, errorDb=${errorDb}`);
    return { durationSeconds: parallel.length / parallel.sampleRate, sampleRate: parallel.sampleRate, channels: parallel.numberOfChannels, workers, maxError, errorDb, peak, finite: true };
  }, { full: process.argv.includes("--full"), workers });
  const report = { ...result, browserVersion: browser.version(), elapsedSeconds: (performance.now() - started) / 1000 };
  if (process.env.SCORE_CHECK_REPORT) fs.writeFileSync(process.env.SCORE_CHECK_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
