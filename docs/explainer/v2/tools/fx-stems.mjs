import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { scoreInputs } from "../../../../scripts/explainer-score.mjs";

const HELP = `用法：node docs/explainer/v2/tools/fx-stems.mjs <输出目录> [--shots-only]

把剧情音导出成 WAV，给 earshot 这类听音工具读（做法见 lyjwpage-explainer「改剧情音」）：
  shots/<序号>-<kind>-<变体>.wav  每种剧情音单独渲一下（带片中的混响、延迟送量，3 秒），shots/index.json 记参数和出现次数
  cues.json                       整片每个剧情音的时刻和参数，可当 earshot timeline 的 --cues
  full.wav / fx.wav / music.wav   整片、只有剧情音、只有配乐（16 bit），三份用同一个增益：整片峰值对到 −1 dBFS，和母带一样，不做尾部淡出
  --shots-only  只导单发和 cues.json，不渲整片`;

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 2);
}
const out = path.resolve(args.find((a) => !a.startsWith("-")) || "");
const shotsOnly = args.includes("--shots-only");
if (!args.find((a) => !a.startsWith("-")) || args.some((a) => a.startsWith("-") && a !== "--shots-only")) {
  console.error(HELP);
  process.exit(2);
}
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(out, "shots"), { recursive: true });

function wav(file, pcm, channels, bits) {
  const h = Buffer.alloc(44), bytes = bits / 8;
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(bits === 32 ? 3 : 1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(48000, 24);
  h.writeUInt32LE(48000 * channels * bytes, 28); h.writeUInt16LE(channels * bytes, 32); h.writeUInt16LE(bits, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

// 乐谱里属于配乐的 kind（score.js#CAT 之外的都进 fx 总线）
const MUSIC = ["pad", "bass", "kick", "snare", "hat", "clock", "mel", "ghost"];
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.error(e); process.exitCode = 1; });
  await page.goto("about:blank");
  const sources = scoreInputs(dir).filter((n) => !n.startsWith("tools/")).map((name) => ({ name, source: fs.readFileSync(path.join(dir, name), "utf8") }));
  await page.evaluate((files) => { for (const { name, source } of files) (0, eval)(`${source}\n//# sourceURL=${name}`); window.Score.build(window.PLAN); }, sources);
  const plain = (n) => Object.fromEntries(Object.entries(n).filter(([k, v]) => !["bar", "beat"].includes(k) && typeof v !== "object"));
  const cues = await page.evaluate((M) => window.Score.notes.filter((n) => !M.includes(n.kind)).map((n) => n), MUSIC);
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(cues.map(plain), null, 1));

  const shots = await page.evaluate((M) => {
    const sig = (n) => JSON.stringify(Object.fromEntries(Object.entries(n).filter(([k, v]) => !["t", "bar", "beat", "pan", "panTo", "i"].includes(k) && typeof v !== "object").sort()));
    const seen = new Map();
    for (const n of window.Score.notes) if (!M.includes(n.kind)) {
      const s = sig(n);
      if (!seen.has(s)) seen.set(s, { n, count: 0, first: n.t });
      seen.get(s).count++;
    }
    window.__shots = [...seen.values()];
    return window.__shots.map(({ n, count, first }) => ({ sig: JSON.parse(sig(n)), count, first }));
  }, MUSIC);
  const index = [];
  for (let i = 0; i < shots.length; i++) {
    const b64 = await page.evaluate(async (i) => {
      const { n } = window.__shots[i], score = { NOTES: [{ ...n, t: 0.1 }], SWEEPS: [], DIPS: [], DURATION: 3 };
      const buf = await window.Score.render({ raw: true, batchSeconds: 0, frames: 48000 * 3 }, score);
      const a = new Float32Array(buf.length * 2), L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let j = 0; j < buf.length; j++) { a[2 * j] = L[j]; a[2 * j + 1] = R[j]; }
      let s = "";
      const u = new Uint8Array(a.buffer);
      for (let j = 0; j < u.length; j += 32768) s += String.fromCharCode.apply(null, u.subarray(j, j + 32768));
      return btoa(s);
    }, i);
    const { sig } = shots[i], variant = sig.what ?? sig.tube ?? sig.size ?? sig.m ?? "";
    const file = `${String(i).padStart(2, "0")}-${sig.kind}-${variant}${sig.late ? "-late" : ""}${sig.take != null ? `-t${sig.take}` : ""}.wav`.replace(/[^\w.-]/g, "");
    wav(path.join(out, "shots", file), Buffer.from(b64, "base64"), 2, 32);
    index.push({ file, kind: sig.kind, ...shots[i] });
  }
  fs.writeFileSync(path.join(out, "shots", "index.json"), JSON.stringify(index, null, 1));
  console.log(`${index.length} 种剧情音、${cues.length} 个剧情音时刻 → ${out}`);

  if (!shotsOnly) {
    const gain = await page.evaluate(async () => {
      const peak = (b) => { let m = 0; for (let c = 0; c < 2; c++) for (const v of b.getChannelData(c)) m = Math.max(m, Math.abs(v)); return m; };
      const full = await window.Score.renderParallel({ workers: 4, raw: true });
      window.__gain = Math.pow(10, -1 / 20) / peak(full);
      window.__stems = { full, fx: await window.Score.renderParallel({ workers: 4, solo: ["fx"] }), music: await window.Score.renderParallel({ workers: 4, solo: ["pad", "bass", "drums", "mel"] }) };
      return window.__gain;
    });
    const CHUNK = 4800000;
    for (const k of ["full", "fx", "music"]) {
      const n = await page.evaluate((k) => window.__stems[k].length, k), parts = [];
      for (let s = 0; s < n; s += CHUNK) {
        parts.push(Buffer.from(await page.evaluate(({ k, s, CHUNK }) => {
          const b = window.__stems[k], e = Math.min(b.length, s + CHUNK), L = b.getChannelData(0), R = b.getChannelData(1), a = new Int16Array((e - s) * 2), g = window.__gain;
          for (let i = s; i < e; i++) for (const [c, d] of [[0, L], [1, R]]) { const v = Math.max(-1, Math.min(1, d[i] * g)); a[(i - s) * 2 + c] = v < 0 ? v * 32768 : v * 32767; }
          let str = "";
          const u = new Uint8Array(a.buffer);
          for (let i = 0; i < u.length; i += 32768) str += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
          return btoa(str);
        }, { k, s, CHUNK }), "base64"));
      }
      wav(path.join(out, `${k}.wav`), Buffer.concat(parts), 2, 16);
    }
    console.log(`整片、剧情音、配乐三份 WAV，增益 ${gain.toFixed(4)}`);
  }
} finally {
  await browser.close();
}
