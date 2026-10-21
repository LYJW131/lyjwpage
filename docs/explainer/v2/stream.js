(() => {
  // 边放边合：先合播放头那一小段就出声，后面按时间顺序一段一段在后台合。每段从起点前 Score.warmup 秒开始渲，
  // 让混响、延迟和没放完的音符先走一遍，段与段接上时和整片一次渲的差不出来；拖到还没合的地方就先合那里。
  const FIRST_SECONDS = 4, BLOCK_SECONDS = 30;
  // 只在配乐 mp3 取不到时用（本地预览、乐谱刚改还没传上）：tools/score-mp3.mjs 量过的整片峰值归一增益，乐谱改了会偏一点，只是整体略响或略轻，段与段之间不跳
  const GAIN_GUESS = 1.3;

  // score-mp3.mjs 把母带增益写在 ID3v2 的 TXXX:master_gain 里
  function tagGain(b) {
    if (!b || b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
    const syncsafe = (i) => ((b[i] & 127) << 21) | ((b[i + 1] & 127) << 14) | ((b[i + 2] & 127) << 7) | (b[i + 3] & 127);
    const v4 = b[3] === 4, end = Math.min(b.length, 10 + syncsafe(6)), text = new TextDecoder();
    for (let i = 10; i + 10 <= end;) {
      const id = text.decode(b.subarray(i, i + 4)), n = v4 ? syncsafe(i + 4) : (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7];
      if (!/^[A-Z0-9]{4}$/.test(id) || n <= 0) break;
      if (id === "TXXX" && (b[i + 10] === 0 || b[i + 10] === 3)) {
        const [desc, value] = text.decode(b.subarray(i + 11, Math.min(end, i + 10 + n))).split("\0");
        const g = parseFloat(value);
        if (desc === "master_gain" && g > 0 && Number.isFinite(g)) return g;
      }
      i += 10 + n;
    }
    return null;
  }

  async function headerOf(url) {
    try {
      const r = await fetch(url, { headers: { Range: "bytes=0-4095" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok || !r.body) return null;
      const reader = r.body.getReader(), parts = [];
      let n = 0;
      while (n < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
      }
      reader.cancel().catch(() => {});
      const out = new Uint8Array(n);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    } catch {
      return null;
    }
  }

  // add(from, buf) 交出整片第 from 帧起的一段（已做母带、叠好音效）；first() 在盖住播放头的那段交出后调：两条泳道谁先合完不一定，中途还可能拖动，先好的那段不一定在播放头
  async function play({ url, header, total, sr, now, add, first, sfx }) {
    const Sc = window.Score, align = Sc.renderAlignment(sr), warm = Math.ceil(Sc.warmup * sr / align) * align;
    const [gain, bank] = await Promise.all([(async () => tagGain(header || await headerOf(url)) ?? GAIN_GUESS)(), sfx.load()]);
    const before = Math.ceil(sfx.margin[0] * sr), after = Math.ceil(sfx.margin[1] * sr);
    const taken = []; // 已合好或正在合的 [from, to)，按 from 排
    const owner = (f) => taken.find((s) => f >= s.from && f < s.to);
    const added = [];
    function nextJob() {
      const head = Math.min(total - 1, Math.max(0, Math.floor(now() * sr / align) * align));
      for (const start of [head, 0]) {
        let f = start;
        for (let s = owner(f); s; s = owner(f)) f = s.to;
        if (f >= total) continue;
        const room = Math.min(total, ...taken.filter((s) => s.from > f).map((s) => s.from));
        const len = (f - head < sr ? FIRST_SECONDS : BLOCK_SECONDS) * sr;
        const to = Math.min(room, f + Math.ceil(len / align) * align);
        return { from: f, to };
      }
      return null;
    }
    async function work(job) {
      const start = Math.max(0, job.from - warm), stop = Math.min(total, job.to + after);
      const raw = await Sc.render({ offset: start / sr, frames: stop - start, raw: true, precomputeVoices: false });
      const lo = Math.max(start, job.from - before), L = raw.getChannelData(0).slice(lo - start), R = raw.getChannelData(1).slice(lo - start);
      Sc.masterRange(L, R, lo, total, sr, gain);
      sfx.mix(bank, L, R, lo, total);
      const buf = new AudioBuffer({ length: job.to - job.from, sampleRate: sr, numberOfChannels: 2 });
      buf.copyToChannel(L.subarray(job.from - lo, job.to - lo), 0);
      buf.copyToChannel(R.subarray(job.from - lo, job.to - lo), 1);
      add(job.from, buf);
      added.push(job);
      const at = Math.min(total - 1, Math.max(0, Math.floor(now() * sr)));
      if (added.some((s) => at >= s.from && at < s.to)) first();
    }
    const lanes = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    await Promise.all(Array.from({ length: lanes }, async () => {
      for (let job = nextJob(); job; job = nextJob()) {
        taken.push(job);
        taken.sort((a, b) => a.from - b.from);
        await work(job);
      }
    }));
  }

  window.Stream = { play, tagGain };
})();
