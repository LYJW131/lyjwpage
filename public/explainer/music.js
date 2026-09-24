// 配乐：100 BPM，四种风格（芯片 / 钢琴 / Lo-fi / 拨弦）共用同一份乐谱和和弦，全部用 Web Audio 合成，
// 离线渲染成 WAV 再混音。编曲按章节登记（window.PLAN），换章的第一拍落一记镲，和像素转场对齐。
(function () {
  const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;
  const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const midi = (name) => { const m = name.match(/^([A-G]#?)(-?\d)$/); return 12 * (+m[2] + 1) + NOTE[m[1]]; };
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const CH = {
    Fmaj7: ["F3", "A3", "C4", "E4"], G6: ["G3", "B3", "D4", "E4"], Em7: ["E3", "G3", "B3", "D4"],
    Am7: ["A3", "C4", "E4", "G4"], Dm7: ["D3", "F3", "A3", "C4"], G7sus4: ["G3", "C4", "D4", "F4"],
    G7: ["G3", "B3", "D4", "F4"], Cmaj7: ["C3", "E3", "G3", "B3"], G: ["G3", "B3", "D4", "G4"],
    A7: ["A3", "C#4", "E4", "G4"], Cmaj9: ["C3", "E3", "G3", "B3", "D4"],
  };
  const ROOT = { Fmaj7: "F2", G6: "G2", Em7: "E2", Am7: "A2", Dm7: "D2", G7sus4: "G2", G7: "G2", Cmaj7: "C2", G: "G2", A7: "A2", Cmaj9: "C2" };

  // 四小节乐句：[和弦, 旋律]；旋律条目 [拍位, 时值, 音]
  const P = {
    A1: [["Fmaj7", [[0, 1, "E5"], [1, 1, "G5"], [2, 1, "A5"], [3, .5, "G5"], [3.5, .5, "E5"]]],
      ["G6", [[0, 2, "D5"], [2, .5, "B4"], [2.5, .5, "C5"], [3, 1, "D5"]]],
      ["Em7", [[0, 1.5, "E5"], [1.5, 1, "D5"], [2.5, .5, "B4"], [3, 1, "G4"]]],
      ["Am7", [[0, 2.5, "A4"], [3, .5, "C5"], [3.5, .5, "D5"]]]],
    A2: [["Fmaj7", [[0, 1, "E5"], [1, 1, "G5"], [2, 1, "A5"], [3, 1, "C6"]]],
      ["G6", [[0, 1.5, "B5"], [1.5, .5, "A5"], [2, 1, "G5"], [3, .5, "E5"], [3.5, .5, "D5"]]],
      ["Em7", [[0, 1, "E5"], [1, 1, "G5"], [2, 1.5, "D5"], [3.5, .5, "B4"]]],
      ["Am7", [[0, 1, "C5"], [1, 2.5, "A4"], [3.5, .5, "E5"]]]],
    B1: [["Dm7", [[0, .5, "F5"], [.5, .5, "E5"], [1, 1, "D5"], [2, .5, "A4"], [2.5, .5, "C5"], [3, .5, "D5"], [3.5, .5, "F5"]]],
      ["Em7", [[0, 1, "G5"], [1, 1, "E5"], [2, .5, "B4"], [2.5, .5, "D5"], [3, .5, "E5"], [3.5, .5, "G5"]]],
      ["Fmaj7", [[0, 1, "A5"], [1, .5, "G5"], [1.5, .5, "A5"], [2, 1, "C6"], [3, 1, "A5"]]],
      ["G7sus4/G7", [[0, 2, "G5"], [2, .5, "F5"], [2.5, .5, "D5"], [3, 1, "B4"]]]],
    B2: [["Dm7", [[0, 1, "A5"], [1, 1, "F5"], [2, 1, "D5"], [3, .5, "C5"], [3.5, .5, "D5"]]],
      ["G7", [[0, 1.5, "F5"], [1.5, .5, "E5"], [2, 1, "D5"], [3, 1, "B4"]]]],
    C1: [["Am7", [[0, 1.5, "E5"], [1.5, .5, "D5"], [2, 1, "C5"], [3, 1, "E5"]]],
      ["Fmaj7", [[0, 1.5, "A5"], [1.5, .5, "G5"], [2, 1, "F5"], [3, .5, "E5"], [3.5, .5, "F5"]]],
      ["Cmaj7", [[0, 1, "G5"], [1, 1, "E5"], [2, 1, "C5"], [3, 1, "D5"]]],
      ["G", [[0, 2.5, "B4"], [3, .5, "C5"], [3.5, .5, "D5"]]]],
    C2: [["Am7", [[0, 1, "A5"], [1, 1, "G5"], [2, 1, "E5"], [3, .5, "D5"], [3.5, .5, "E5"]]],
      ["Fmaj7", [[0, 2, "C6"], [2, 1, "A5"], [3, 1, "G5"]]],
      ["Cmaj7", [[0, 1, "E5"], [1, .5, "D5"], [1.5, .5, "E5"], [2, 1, "G5"], [3, 1, "B5"]]],
      ["G", [[0, 3, "D6"], [3.5, .5, "B5"]]]],
    // 律动段：不放主旋律，只留铃声对位，给信息量大的画面让位
    D1: [["Dm7", [[0, 2, "F5"], [2, 2, "A5"]]], ["G7", [[0, 2, "G5"], [2, 2, "F5"]]],
      ["Cmaj7", [[0, 4, "E5"]]], ["A7", [[0, 2, "E5"], [2, 2, "C#5"]]]],
    OUT: [["Cmaj9", [[0, 1, "E5"], [1, 1, "G5"], [2, 1, "B5"], [3, 1, "D6"]]], ["Cmaj9", [[0, 4, "C6"]]]],
    INTRO: [["Fmaj7", []], ["G6", []]],
  };

  // 乐句 + 编配 → 逐小节描述
  function ph(name, o = {}) {
    return P[name].map(([chord, mel], i) => ({ chord, mel, name, i, last: i === P[name].length - 1, ...o }));
  }
  // 章节编曲表：和 scenes.js 里的章节一一对应（小节数必须一致）
  const PLAN = [
    { name: "序章", bars: [...ph("INTRO", { drums: "none", arp: "8", lead: "off", fadeArp: true }), ...ph("A1", { drums: "light" }), ...ph("A2", { drums: "mid" }), ...ph("B2", { drums: "full", fill: true })] },
    { name: "采集端", bars: [...ph("A1", { drums: "light", lead: "soft" }), ...ph("C1", { drums: "mid" }), ...ph("A2", { drums: "mid" }), ...ph("B1", { drums: "full" }), ...ph("B2", { drums: "half", lead: "soft" }), ...ph("B2", { drums: "full", fill: true })] },
    { name: "状态中枢", bars: [...ph("D1", { drums: "light", arp: "16", lead: "bell" }), ...ph("D1", { drums: "mid", arp: "16", lead: "bell" }), ...ph("A1", { drums: "mid" }), ...ph("C2", { drums: "full" }), ...ph("B1", { drums: "full", fill: true })] },
    { name: "首屏缓存", bars: [...ph("A2", { drums: "half", lead: "soft" }), ...ph("C1", { drums: "half" }), ...ph("B1", { drums: "mid" }), ...ph("B2", { drums: "full", fill: true })] },
    { name: "实时推送", bars: [...ph("A1", { drums: "full", arp: "16" }), ...ph("A2", { drums: "full" }), ...ph("C2", { drums: "full" }), ...ph("B1", { drums: "full", fill: true })] },
    { name: "大陆访问", key: 2, bars: [...ph("A1", { drums: "mid" }), ...ph("A2", { drums: "mid", fill: true })] },
    { name: "图片链路", key: 2, bars: [...ph("B1", { drums: "light", lead: "soft" }), ...ph("C1", { drums: "mid", fill: true })] },
    { name: "自适应调频", key: 2, bars: [...ph("D1", { drums: "mid", arp: "16", lead: "bell" }), ...ph("A2", { drums: "full" }), ...ph("B2", { drums: "full", fill: true })] },
    { name: "站点自检", key: 2, bars: [...ph("C2", { drums: "mid", arp: "16" }), ...ph("B1", { drums: "full", fill: true })] },
    { name: "回顾", key: 2, bars: [...ph("A1", { drums: "full" }), ...ph("A2", { drums: "full" }), ...ph("B1", { drums: "full", fill: true }), ...ph("OUT", { drums: "none", outro: true })] },
  ];
  const BARS = [];
  PLAN.forEach((c, ci) => c.bars.forEach((b, i) => BARS.push({ ...b, key: c.key || 0, chapterStart: i === 0 && ci > 0, ci })));
  const DURATION = BARS.length * BAR + 1.2;

  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pulseWave(ctx, duty) {
    const N = 48, real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);
  }
  function noiseBuffer(ctx, seconds, seed) {
    const rnd = mulberry32(seed), len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    return buf;
  }
  function impulse(ctx, seconds, decay, seed) {
    const rnd = mulberry32(seed), len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }

  // from/to：只排这段时间里的音符（页面内播放时分段调度，导出时一次排完）
  function build(ctx, dest, t0, from = 0, to = Infinity) {
    const at = (bar, beat = 0) => t0 + bar * BAR + beat * BEAT;
    const inWin = (bar) => { const s = bar * BAR; return s + BAR > from - 2 && s < to; };

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.9, t0 + 0.4);
    master.gain.setValueAtTime(0.9, t0 + DURATION - 2.2);
    master.gain.linearRampToValueAtTime(0, t0 + DURATION);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 38; hp.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    master.connect(hp); hp.connect(comp); comp.connect(dest);

    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.4, 3.2, 7);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.28; verb.connect(verbOut); verbOut.connect(master);
    const delay = ctx.createDelay(2); delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2400;
    const dOut = ctx.createGain(); dOut.gain.value = 0.22;
    delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(dOut); dOut.connect(master);

    const pulse25 = pulseWave(ctx, 0.25), pulse125 = pulseWave(ctx, 0.125);
    const noise = noiseBuffer(ctx, 1.5, 42);

    function voice({ wave, freq, start, dur, vol, attack = 0.008, release = 0.08, lp = 3000, pan = 0, sendVerb = 0, sendDelay = 0, vibrato = 0, detune = 0 }) {
      const osc = ctx.createOscillator();
      if (typeof wave === "string") osc.type = wave; else osc.setPeriodicWave(wave);
      osc.frequency.value = freq; osc.detune.value = detune;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; f.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + attack);
      g.gain.setValueAtTime(vol, Math.max(start + attack, start + dur - 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur + release);
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      osc.connect(f); f.connect(g); g.connect(p); p.connect(master);
      if (sendVerb) { const s = ctx.createGain(); s.gain.value = sendVerb; p.connect(s); s.connect(verb); }
      if (sendDelay) { const s = ctx.createGain(); s.gain.value = sendDelay; p.connect(s); s.connect(delay); }
      if (vibrato) {
        const lfo = ctx.createOscillator(); lfo.frequency.value = 5.4;
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0, start); lg.gain.linearRampToValueAtTime(0, start + 0.22); lg.gain.linearRampToValueAtTime(vibrato, start + 0.5);
        lfo.connect(lg); lg.connect(osc.detune); lfo.start(start); lfo.stop(start + dur + release + 0.05);
      }
      osc.start(start); osc.stop(start + dur + release + 0.05);
    }
    function kick(t, vol = 0.45) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
    }
    function snare(t, vol = 0.2) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      n.connect(bp); bp.connect(g); g.connect(master);
      const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(verb);
      n.start(t, 0.1); n.stop(t + 0.18);
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 185;
      const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.6, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.09);
    }
    function hat(t, vol = 0.05, len = 0.035, off = 0) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const p = ctx.createStereoPanner(); p.pan.value = 0.25;
      n.connect(f); f.connect(g); g.connect(p); p.connect(master);
      n.start(t, 0.3 + off); n.stop(t + len + 0.02);
    }
    function crash(t, vol = 0.07) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 4500;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      n.connect(f); f.connect(g); g.connect(master);
      const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(verb);
      n.start(t, 0); n.stop(t + 1.45);
    }

    BARS.forEach((B, bar) => {
      if (!inWin(bar)) return;
      const k = B.key;
      const split = B.chord.includes("/");
      const [c1, c2] = split ? B.chord.split("/") : [B.chord, B.chord];
      const chordAt = (beat) => CH[beat < 2 ? c1 : c2];
      const lastBar = bar === BARS.length - 1;

      // 铺底
      const halves = split ? [[c1, 0, 2], [c2, 2, 2]] : [[c1, 0, lastBar ? 5.5 : 4]];
      for (const [name, b0, len] of halves) for (const n of CH[name]) for (const dt of [-7, 7]) {
        voice({ wave: "sawtooth", freq: hz(midi(n) + k), start: at(bar, b0), dur: len * BEAT - 0.05, vol: B.drums === "none" && !B.outro ? 0.018 : 0.022,
          attack: 0.35, release: 0.7, lp: B.outro ? 1400 : 1000, pan: dt < 0 ? -0.3 : 0.3, sendVerb: 0.6, detune: dt });
      }
      // 琶音
      const arp = B.arp || "8";
      if (arp !== "off" && !(B.outro && B.last)) {
        const step = arp === "16" ? 0.25 : 0.5;
        const order = arp === "16" ? [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2] : [0, 1, 2, 3, 2, 1, 2, 3];
        for (let i = 0; i < order.length; i++) {
          const beat = i * step;
          if (B.outro && beat >= 2) break;
          const tones = chordAt(beat).map((n) => midi(n) + 12 + k);
          const fadeIn = B.fadeArp ? 0.35 + 0.65 * ((bar * 8 + i) / 16) : 1;
          voice({ wave: pulse125, freq: hz(tones[order[i] % tones.length]), start: at(bar, beat), dur: arp === "16" ? 0.1 : 0.16,
            vol: (arp === "16" ? 0.024 : 0.03) * fadeIn, attack: 0.004, release: 0.1, lp: 2300, pan: i % 2 ? 0.35 : -0.35, sendDelay: 0.45, sendVerb: 0.2 });
        }
      }
      // 贝斯
      if (B.drums !== "none" || B.outro) {
        const root = midi(ROOT[c2 === c1 ? c1 : "G7"]) + k;
        const pat = B.outro ? (B.last ? [] : [[0, 3.8, 0]]) : B.drums === "half" ? [[0, 2.4, 0], [2.5, 1.2, 7]] : [[0, 1.4, 0], [1.5, 0.45, 0], [2.5, 0.9, 7], [3.5, 0.45, 12]];
        for (const [b, len, iv] of pat) voice({ wave: "triangle", freq: hz(root + iv), start: at(bar, b), dur: len * BEAT, vol: 0.15, attack: 0.006, release: 0.06, lp: 900 });
      }
      // 鼓
      const d = B.drums;
      if (B.chapterStart) crash(at(bar, 0));
      if (d === "light" || d === "mid" || d === "full") {
        kick(at(bar, 0)); kick(at(bar, 2), 0.4);
        if (d === "full") kick(at(bar, 2.5), 0.28);
        if (d !== "light") { snare(at(bar, 1), d === "full" ? 0.2 : 0.13); snare(at(bar, 3), d === "full" ? 0.2 : 0.13); }
        const step = d === "full" ? 0.25 : 0.5;
        for (let b = 0; b < 4; b += step) hat(at(bar, b), (d === "full" ? 0.042 : 0.05) * (b % 1 === 0.5 ? 1 : 0.6), 0.03, (b * 7) % 1);
      } else if (d === "half") {
        kick(at(bar, 0)); kick(at(bar, 1.5), 0.3); snare(at(bar, 2), 0.16);
        for (let b = 0; b < 4; b += 0.5) hat(at(bar, b), 0.04 * (b % 1 === 0.5 ? 1 : 0.6), 0.03, (b * 7) % 1);
      } else if (bar === 1) {
        for (let i = 0; i < 8; i++) hat(at(bar, i * 0.5), 0.02 + 0.004 * i, 0.03, i * 0.01);
      }
      if (B.fill && B.last) { snare(at(bar, 3.5), 0.14); snare(at(bar, 3.75), 0.17); }
      if (B.outro && B.i === 0) kick(at(bar, 0), 0.45);

      // 主旋律
      const lead = B.lead || "pulse";
      if (lead !== "off") for (const [b, len, n] of B.mel) {
        const f = hz(midi(n) + k);
        if (lead === "bell") {
          voice({ wave: "sine", freq: f, start: at(bar, b), dur: Math.min(len * BEAT, 0.5), vol: 0.07, attack: 0.004, release: 0.9, lp: 5000, sendDelay: 0.5, sendVerb: 0.45 });
          voice({ wave: "sine", freq: f * 2, start: at(bar, b), dur: 0.08, vol: 0.02, attack: 0.002, release: 0.3, lp: 8000, sendVerb: 0.3 });
        } else {
          voice({ wave: pulse25, freq: f, start: at(bar, b), dur: len * BEAT - 0.03, vol: lead === "soft" ? 0.055 : 0.075,
            attack: 0.01, release: lastBar ? 1.4 : 0.1, lp: lead === "soft" ? 2400 : 3200, sendDelay: 0.35, sendVerb: 0.3, vibrato: 14 });
        }
      }
    });
  }

  // =====================================================================
  // 其他配乐风格：钢琴 / Lo-fi / 拨弦。和声、旋律、段落跟芯片版完全一样，只换编配和音色。
  // 音色不在渲染时用振荡器现拼：先用 JS 把每个音高的波形算好（采样），再按乐谱摆放——更像，也更快。
  // =====================================================================
  const TAU = Math.PI * 2;
  const clamp1 = (x, a, b) => Math.min(b, Math.max(a, x));
  // 一个衰减的正弦泛音叠加进 d：两段指数衰减（先快后慢），正弦用递推算
  function partial(d, sr, f, amp, tA, tB, mixB, ph0) {
    if (f >= sr * 0.45) return;
    const w = TAU * f / sr, c = 2 * Math.cos(w);
    let s1 = Math.sin(ph0 - w), s2 = Math.sin(ph0 - 2 * w);
    const kA = Math.exp(-1 / (tA * sr)), kB = Math.exp(-1 / (tB * sr));
    let eA = amp * (1 - mixB), eB = amp * mixB;
    for (let i = 0; i < d.length; i++) {
      const s = c * s1 - s2; s2 = s1; s1 = s;
      d[i] += s * (eA + eB);
      eA *= kA; eB *= kB;
      if (eA + eB < 1e-6) break;
    }
  }
  function attackRamp(d, sr, sec) { const n = Math.max(1, Math.floor(sec * sr)); for (let i = 0; i < n && i < d.length; i++) d[i] *= i / n; }
  function normalize(chs, peak = 0.9) {
    let m = 0;
    for (const d of chs) for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  }
  function toBuffer(sr, chs) {
    // 采样末尾 12 ms 淡出：播放时不提前收尾的那些（鼓、钟琴）不会在结尾硬切出一个台阶
    const f = Math.min(chs[0].length, Math.floor(0.012 * sr));
    for (const d of chs) for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - i / f;
    const b = new AudioBuffer({ numberOfChannels: chs.length, length: chs[0].length, sampleRate: sr });
    chs.forEach((d, i) => b.copyToChannel(d, i));
    return b;
  }
  // 双二阶滤波（RBJ），给噪声类采样塑形
  function biquad(d, sr, type, f, q = 0.707) {
    const w = TAU * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
    return d;
  }
  function softClip(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }
  const SAMPLES = new Map();
  const sample = (key, make) => { if (!SAMPLES.has(key)) SAMPLES.set(key, make()); return SAMPLES.get(key); };
  const VL = [0.35, 0.55, 0.78];
  const vlOf = (v) => (v < 0.45 ? 0 : v < 0.66 ? 1 : 2);

  // 钢琴：弦的非谐和泛音、击弦点造成的缺失泛音、先快后慢两段衰减、两根弦的微差拍、一点锤击声
  function pianoSample(sr, m, vl) {
    return sample(`pno:${m}:${vl}`, () => {
      const f0 = hz(m), vel = VL[vl];
      const len = Math.floor(sr * clamp1(2.4 + 3.4 * Math.pow(262 / f0, 0.6), 1.8, 6.5));
      const L = new Float32Array(len), R = new Float32Array(len);
      const B = 0.00032 * Math.pow(f0 / 262, 0.5), beta = 1 / 7.3, tilt = 0.34 - 0.24 * vel;
      const tA = 0.5 * Math.pow(262 / f0, 0.35), tB = 3.8 * Math.pow(262 / f0, 0.55);
      const rnd = mulberry32(m * 131 + vl);
      const nMax = Math.min(20, Math.floor(14000 / f0));
      for (let n = 1; n <= nMax; n++) {
        const fn = n * f0 * Math.sqrt(1 + B * n * n);
        const a = (Math.abs(Math.sin(n * Math.PI * beta)) + 0.08) / Math.pow(n, 1.2) * Math.exp(-(n - 1) * tilt);
        const k = 1 + 0.42 * (n - 1);
        partial(L, sr, fn * (1 - 0.0004), a, tA / k, tB / k, 0.3, rnd() * TAU);
        partial(R, sr, fn * (1 + 0.0004), a, tA / k, tB / k, 0.3, rnd() * TAU);
      }
      const hn = Math.floor(0.012 * sr), nz = new Float32Array(hn);
      for (let i = 0; i < hn; i++) nz[i] = (rnd() * 2 - 1) * Math.exp(-i / (0.003 * sr));
      biquad(nz, sr, "lp", 1800 + 2600 * vel);
      for (let i = 0; i < hn; i++) { L[i] += nz[i] * 0.25 * vel; R[i] += nz[i] * 0.25 * vel; }
      attackRamp(L, sr, 0.002); attackRamp(R, sr, 0.002);
      normalize([L, R], 0.9);
      return toBuffer(sr, [L, R]);
    });
  }
  // 电钢琴（Rhodes 味）：FM，调制深度随时间收，起音带一点金属的「叮」
  function rhodesSample(sr, m, vl) {
    return sample(`rh:${m}:${vl}`, () => {
      const f = hz(m), vel = VL[vl];
      const len = Math.floor(sr * clamp1(1.8 + 1.6 * Math.pow(262 / f, 0.5), 1.4, 4));
      const d = new Float32Array(len);
      const I0 = 0.7 + 2.0 * vel, tau = 1.4 * Math.pow(262 / f, 0.35);
      for (let i = 0; i < len; i++) {
        const t = i / sr, I = I0 * Math.exp(-t / 0.25) + 0.3;
        const env = Math.exp(-t / tau) * Math.min(1, t / 0.003);
        d[i] = Math.sin(TAU * f * t + I * Math.sin(TAU * f * t)) * env + 0.16 * vel * Math.sin(TAU * f * 13.9 * t) * Math.exp(-t / 0.03);
      }
      normalize([d], 0.9);
      return toBuffer(sr, [d]);
    });
  }
  // 拨弦：拨弦位置决定泛音分布，高次泛音衰减得更快（尤克里里 / 拨奏低音）
  function pluckSample(sr, m, vl, kind = "uke") {
    return sample(`pl:${kind}:${m}:${vl}`, () => {
      const f0 = hz(m), vel = VL[vl], bass = kind === "bass";
      const cfg = bass ? { pos: 0.28, t0: 0.9, nMax: 10, ex: 1.9 } : { pos: 0.17, t0: 0.85, nMax: 18, ex: 1.55 - 0.35 * vel };
      const len = Math.floor(sr * clamp1(cfg.t0 * 3.2, 0.8, 3));
      const d = new Float32Array(len), rnd = mulberry32(m * 17 + vl + (bass ? 999 : 0));
      const tt = cfg.t0 * Math.pow(262 / f0, 0.25);
      for (let n = 1; n <= cfg.nMax; n++) {
        const a = (Math.abs(Math.sin(n * Math.PI * cfg.pos)) + 0.05) / Math.pow(n, cfg.ex), tn = tt / (1 + 0.55 * (n - 1));
        partial(d, sr, n * f0 * (1 + 0.00004 * n * n), a, tn, tn, 0, rnd() * TAU);
      }
      const pn = Math.floor(0.004 * sr), nz = new Float32Array(pn);
      for (let i = 0; i < pn; i++) nz[i] = (rnd() * 2 - 1) * (1 - i / pn);
      biquad(nz, sr, "bp", bass ? 900 : 2800, 0.8);
      for (let i = 0; i < pn; i++) d[i] += nz[i] * 0.3;
      attackRamp(d, sr, 0.0008);
      normalize([d], 0.9);
      return toBuffer(sr, [d]);
    });
  }
  // 钟琴：自由振动的金属条，泛音不成整数倍
  function glockSample(sr, m) {
    return sample(`gl:${m}`, () => {
      const f0 = hz(m), s = Math.pow(1047 / f0, 0.25), d = new Float32Array(Math.floor(sr * 2.4));
      [[1, 1, 1.8], [2.76, 0.38, 0.55], [5.40, 0.16, 0.22], [8.93, 0.07, 0.1]].forEach(([r, a, t]) => partial(d, sr, f0 * r, a, t * s, t * s, 0, 0));
      attackRamp(d, sr, 0.0005);
      normalize([d], 0.9);
      return toBuffer(sr, [d]);
    });
  }
  // Lo-fi 贝斯：正弦加一点二次谐波，轻微饱和
  function subBassSample(sr, m) {
    return sample(`sb:${m}`, () => {
      const f = hz(m), d = new Float32Array(Math.floor(sr * 1.6));
      for (let i = 0; i < d.length; i++) { const t = i / sr, y = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t); d[i] = Math.tanh(1.4 * y) * Math.exp(-t / 0.9) * Math.min(1, t / 0.004); }
      normalize([d], 0.9);
      return toBuffer(sr, [d]);
    });
  }
  // 打击乐和底噪
  function drumSample(sr, kind) {
    return sample(`dr:${kind}`, () => {
      const rnd = mulberry32(kind.length * 7919 + kind.charCodeAt(0) * 31);
      const mk = (sec) => new Float32Array(Math.floor(sec * sr));
      let d;
      if (kind === "kick") {
        d = mk(0.45); let ph = 0;
        for (let i = 0; i < d.length; i++) { const t = i / sr, f = 42 + 80 * Math.exp(-t / 0.045); ph += TAU * f / sr; d[i] = Math.sin(ph) * Math.exp(-t / 0.28) * Math.min(1, t / 0.001); }
        for (let i = 0; i < 90; i++) d[i] += (rnd() * 2 - 1) * 0.3 * (1 - i / 90);
      } else if (kind === "snare") {
        d = mk(0.35); const nz = mk(0.35);
        for (let i = 0; i < nz.length; i++) nz[i] = (rnd() * 2 - 1) * Math.exp(-i / (0.09 * sr));
        biquad(nz, sr, "bp", 1900, 0.6); biquad(nz, sr, "lp", 5200);
        for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = nz[i] * 1.4 + 0.5 * Math.sin(TAU * 185 * t) * Math.exp(-t / 0.06); }
      } else if (kind === "hat" || kind === "ohat") {
        d = mk(kind === "hat" ? 0.08 : 0.35);
        for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / ((kind === "hat" ? 0.022 : 0.12) * sr));
        biquad(d, sr, "hp", 7200, 0.7);
      } else if (kind === "shaker") {
        d = mk(0.12);
        for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (rnd() * 2 - 1) * Math.min(1, t / 0.018) * Math.exp(-Math.max(0, t - 0.018) / 0.035); }
        biquad(d, sr, "bp", 6500, 0.9);
      } else if (kind === "block") {
        d = mk(0.12);
        for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (0.8 * Math.sin(TAU * 880 * t) + 0.35 * Math.sin(TAU * 2350 * t) * Math.exp(-t / 0.012)) * Math.exp(-t / 0.035); }
      } else if (kind === "clap") {
        d = mk(0.3); const nz = mk(0.3);
        for (let i = 0; i < nz.length; i++) nz[i] = rnd() * 2 - 1;
        biquad(nz, sr, "bp", 1300, 0.9);
        for (let i = 0; i < d.length; i++) { const t = i / sr, b = [0, 0.009, 0.018].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) / 0.006) : 0), 0); d[i] = nz[i] * (b * 0.6 + (t > 0.018 ? 0.5 * Math.exp(-t / 0.08) : 0)); }
      } else if (kind === "crash") {
        d = mk(2.2);
        for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / (0.7 * sr));
        biquad(d, sr, "hp", 3800, 0.6); biquad(d, sr, "lp", 9000, 0.6);
      } else { // crackle：黑胶底噪，稀疏的爆点加很轻的沙沙声，5 秒一循环
        d = mk(5);
        for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * 0.05;
        biquad(d, sr, "bp", 3000, 0.4);
        for (let k = 0; k < 90; k++) { const at = Math.floor(rnd() * (d.length - 40)), a = 0.3 + rnd() * 0.7; for (let j = 0; j < 30; j++) d[at + j] += a * (rnd() * 2 - 1) * Math.exp(-j / 6); }
      }
      normalize([d], 0.9);
      return toBuffer(sr, [d]);
    });
  }

  // 公共：总线（整体淡入淡出 → 可选饱和 / 低通 → 高通 → 压缩）和「放一个采样」
  function masterChain(ctx, dest, t0, { sat = 0, lp = 0, thr = -16, ratio = 2.5, level = 0.9 } = {}) {
    const m = ctx.createGain();
    m.gain.setValueAtTime(0.0001, t0); m.gain.exponentialRampToValueAtTime(level, t0 + 0.4);
    m.gain.setValueAtTime(level, t0 + DURATION - 2.2); m.gain.linearRampToValueAtTime(0, t0 + DURATION);
    let node = m;
    if (sat) { const ws = ctx.createWaveShaper(); ws.curve = softClip(sat); ws.oversample = "2x"; node.connect(ws); node = ws; }
    if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; f.Q.value = 0.5; node.connect(f); node = f; }
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 32; hp.Q.value = 0.7; node.connect(hp);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = thr; comp.knee.value = 10; comp.ratio.value = ratio; comp.attack.value = 0.015; comp.release.value = 0.3;
    hp.connect(comp); comp.connect(dest);
    return m;
  }
  function reverbBus(ctx, master, sec, decay, seed, wet) {
    const v = ctx.createConvolver(); v.buffer = impulse(ctx, sec, decay, seed);
    const g = ctx.createGain(); g.gain.value = wet; v.connect(g); g.connect(master);
    return v;
  }
  function player(ctx, master, verb, sendDefault) {
    return (buf, t, { gain = 0.5, pan = 0, send = sendDefault, stopAt = null, release = 0.3, bus = master } = {}) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.start(t);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t);
      if (stopAt != null && stopAt < t + buf.duration) { g.gain.setValueAtTime(gain, stopAt); g.gain.setTargetAtTime(0.0001, stopAt, release / 4); src.stop(stopAt + release * 1.6); }
      const p = ctx.createStereoPanner(); p.pan.value = clamp1(pan, -1, 1);
      src.connect(g); g.connect(p); p.connect(bus);
      if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(verb); }
    };
  }
  function barInfo(B) {
    const split = B.chord.includes("/");
    const [c1, c2] = split ? B.chord.split("/") : [B.chord, B.chord];
    return { halves: split ? [[c1, 0, 2], [c2, 2, 2]] : [[c1, 0, 4]] };
  }
  const tonesOf = (name, k) => CH[name].map((n) => midi(n) + k);
  const rootOf = (name, k) => midi(ROOT[name]) + k;
  const beatOf = (b0, b, halves) => halves[halves.length > 1 && b >= 2 ? 1 : 0][0];

  // ---------- 钢琴：左手分解和弦、右手旋律，换和弦时换踏板 ----------
  function buildPiano(ctx, dest, t0) {
    const sr = ctx.sampleRate;
    const master = masterChain(ctx, dest, t0, { thr: -18, ratio: 2.2 });
    const verb = reverbBus(ctx, master, 3.2, 2.6, 21, 0.34);
    const play = player(ctx, master, verb, 0.22);
    const P = (m, t, v, o = {}) => play(pianoSample(sr, m, vlOf(v)), t, { gain: v * 0.62, pan: (m - 64) / 80, ...o });
    BARS.forEach((B, bar) => {
      const k = B.key, at = (b) => t0 + bar * BAR + b * BEAT, d = B.drums, lastBar = bar === BARS.length - 1;
      const { halves } = barInfo(B);
      for (const [name, b0, len] of halves) {
        const T = tonesOf(name, k), r = rootOf(name, k);
        const stop = lastBar ? null : at(b0 + len) + 0.06; // 换和弦时换一下踏板
        const third = T[1] < r + 12 ? T[1] + 12 : T[1];
        if (B.chapterStart && b0 === 0) P(r - 12, at(0), 0.5, { stopAt: stop, send: 0.3 });
        if (d === "none" || B.outro) {
          [r, ...T].forEach((m, i) => P(m, at(b0) + i * 0.045, i ? 0.36 : 0.42, { stopAt: stop }));
        } else if (d === "light") {
          [[0, r], [1, r + 7], [2, third], [3, r + 7]].forEach(([b, m]) => { if (b < len) P(m, at(b0 + b), b ? 0.33 : 0.4, { stopAt: stop }); });
        } else if (d === "half") {
          [0, 2].forEach((b) => { if (b < len) { P(r, at(b0 + b), 0.4, { stopAt: stop }); T.slice(0, 3).forEach((m, i) => P(m, at(b0 + b) + 0.02 * (i + 1), 0.3, { stopAt: stop })); } });
        } else {
          const fig = [r, r + 7, r + 12, third, r + 19, third, r + 12, r + 7];
          for (let i = 0; i < len * 2; i++) P(fig[i % 8], at(b0 + i * 0.5), (i % 2 ? 0.28 : 0.36) + (d === "full" ? 0.04 : 0), { stopAt: stop });
        }
      }
      const lead = B.lead || "pulse";
      if (lead !== "off") for (const [b, len, n] of B.mel) {
        let m = midi(n) + k;
        const v = lead === "soft" ? 0.44 : lead === "bell" ? 0.36 : 0.56;
        if (lead === "bell") m += 12;
        P(m, at(b), v, { stopAt: lastBar ? null : at(b + len) + 0.28, send: 0.28 });
        if (d === "full" && len >= 1 && lead !== "bell") {
          const T = tonesOf(beatOf(0, b, halves), k);
          const under = [...T.map((x) => x + 12), ...T.map((x) => x + 24)].filter((x) => x < m - 2 && x > m - 10).pop();
          if (under) P(under, at(b), v * 0.5, { stopAt: at(b + len) + 0.2 });
        }
      }
      if (B.fill && B.last) { const T = tonesOf(halves[halves.length - 1][0], k); T.forEach((m, i) => P(m + 12, at(3.5) + i * 0.075, 0.3 + i * 0.04, { stopAt: at(4) + 0.3 })); }
    });
  }

  // ---------- Lo-fi：电钢琴和弦、下沉贝斯、慵懒的鼓（八分反拍往后拖），全程黑胶底噪 ----------
  function buildLofi(ctx, dest, t0) {
    const sr = ctx.sampleRate;
    const master = masterChain(ctx, dest, t0, { sat: 1.6, lp: 5200, thr: -17, ratio: 3, level: 0.42 });
    const verb = reverbBus(ctx, master, 1.4, 3.0, 33, 0.2);
    const play = player(ctx, master, verb, 0.12);
    const rbus = ctx.createGain(), rpan = ctx.createStereoPanner();
    rbus.connect(rpan); rpan.connect(master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.2;
    const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(rpan.pan); lfo.start(t0); lfo.stop(t0 + DURATION);
    const rs = ctx.createGain(); rs.gain.value = 0.18; rbus.connect(rs); rs.connect(verb);
    const cr = ctx.createBufferSource(); cr.buffer = drumSample(sr, "crackle"); cr.loop = true;
    const cg = ctx.createGain(); cg.gain.value = 0.05; cr.connect(cg); cg.connect(master); cr.start(t0); cr.stop(t0 + DURATION);
    const sw = (b) => (Math.abs((b % 1) - 0.5) < 1e-6 ? b + 0.08 : b);
    const RH = (m, t, v, o = {}) => play(rhodesSample(sr, m, vlOf(v)), t, { gain: v * 0.55, bus: rbus, send: 0, ...o });
    const DR = (kind, t, g, o = {}) => play(drumSample(sr, kind), t, { gain: g, send: 0.08, ...o });
    const BS = (m, t, v, o = {}) => play(subBassSample(sr, m), t, { gain: v, send: 0, ...o });
    BARS.forEach((B, bar) => {
      const k = B.key, at = (b) => t0 + bar * BAR + b * BEAT, d = B.drums, lastBar = bar === BARS.length - 1;
      const { halves } = barInfo(B);
      if (B.chapterStart) DR("crash", at(0), 0.2, { send: 0.3 });
      for (const [name, b0, len] of halves) {
        const T = tonesOf(name, k), r = rootOf(name, k);
        const voic = [T[1], T[2], T[3], T[0] + 14 <= 76 ? T[0] + 14 : T[0] + 2];
        const comp = d === "none" || B.outro ? [[0, len]] : d === "light" || d === "half" ? [[0, 1.5], [2.5, 1]] : [[0, 0.9], [1.5, 0.9], [3, 0.9]];
        for (const [b, L] of comp) if (b < len) voic.forEach((m, i) => RH(m, at(sw(b0 + b)) + i * 0.012, b ? 0.4 : 0.48, { stopAt: lastBar ? null : at(b0 + b + L) + 0.05, release: 0.35 }));
        if (d !== "none" || B.outro) {
          const bp = B.outro ? [[0, len, 0]] : [[0, 1.3, 0], [2, 0.4, 12], [2.5, 0.9, 0]];
          for (const [b, L, iv] of bp) if (b < len) BS(r + iv, at(sw(b0 + b)), 0.55, { stopAt: lastBar ? null : at(b0 + b + L) + 0.02, release: 0.08 });
        }
      }
      if (d === "light") { DR("kick", at(0), 0.55); DR("kick", at(2.5), 0.45); for (let b = 0; b < 4; b += 0.5) DR("hat", at(sw(b)), b % 1 ? 0.12 : 0.08); }
      else if (d === "half") { DR("kick", at(0), 0.6); DR("kick", at(1.75), 0.4); DR("snare", at(2), 0.34); for (let b = 0; b < 4; b += 0.5) DR("hat", at(sw(b)), b % 1 ? 0.12 : 0.08); }
      else if (d === "mid" || d === "full") {
        DR("kick", at(0), 0.62); DR("kick", at(1.75), 0.42); DR("kick", at(2.5), 0.52);
        DR("snare", at(1), 0.38); DR("snare", at(3), 0.38);
        for (let b = 0; b < 4; b += 0.5) DR("hat", at(sw(b)), (b % 1 ? 0.14 : 0.09) * (d === "full" ? 1.1 : 1));
        if (d === "full") { DR("ohat", at(sw(3.5)), 0.08); DR("snare", at(2.75), 0.1); }
      }
      if (B.fill && B.last) { DR("snare", at(3.5), 0.2); DR("snare", at(3.75), 0.26); }
      const lead = B.lead || "pulse";
      if (lead !== "off") for (const [b, len, n] of B.mel) {
        const m = midi(n) + k;
        if (lead === "bell") play(glockSample(sr, m + 12), at(sw(b)), { gain: 0.16, send: 0.3 });
        else RH(m, at(sw(b)), lead === "soft" ? 0.42 : 0.52, { stopAt: lastBar ? null : at(b + len) + 0.15, release: 0.3 });
      }
    });
  }

  // ---------- 拨弦：尤克里里扫弦、拨奏低音、钟琴唱旋律，沙锤和木鱼打拍 ----------
  function buildPluck(ctx, dest, t0) {
    const sr = ctx.sampleRate;
    const master = masterChain(ctx, dest, t0, { thr: -17, ratio: 2.5, level: 0.6 });
    const verb = reverbBus(ctx, master, 1.8, 3.0, 44, 0.26);
    const play = player(ctx, master, verb, 0.18);
    const UK = (m, t, v, o = {}) => play(pluckSample(sr, m, vlOf(v), "uke"), t, { gain: v * 0.5, ...o });
    const PB = (m, t, v, o = {}) => play(pluckSample(sr, m, vlOf(v), "bass"), t, { gain: v * 0.9, send: 0.05, ...o });
    const GL = (m, t, v, o = {}) => play(glockSample(sr, m), t, { gain: v * 0.42, send: 0.3, ...o });
    const DR = (kind, t, g, o = {}) => play(drumSample(sr, kind), t, { gain: g, send: 0.1, ...o });
    const ukeV = (T) => [...new Set(T.map((m) => { while (m < 60) m += 12; while (m > 71) m -= 12; return m; }))].sort((a, b) => a - b);
    const strum = (V, t, dir, v, stopAt) => {
      const seq = dir > 0 ? V : [...V].reverse().slice(0, 3);
      seq.forEach((m, i) => UK(m, t + i * 0.011, v * (dir > 0 ? 1 : 0.7), { stopAt, pan: (m - 65) / 30 }));
    };
    BARS.forEach((B, bar) => {
      const k = B.key, at = (b) => t0 + bar * BAR + b * BEAT, d = B.drums, lastBar = bar === BARS.length - 1;
      const { halves } = barInfo(B);
      if (B.chapterStart) {
        DR("crash", at(0), 0.28, { send: 0.3 });
        const T = tonesOf(halves[0][0], k);
        [T[0] + 24, T[1] + 24, T[2] + 24, T[3] + 24].forEach((m, i) => GL(m, at(0) - 0.2 + i * 0.05, 0.8));
      }
      for (const [name, b0, len] of halves) {
        const T = tonesOf(name, k), r = rootOf(name, k), V = ukeV(T);
        const pat = d === "none" || B.outro ? [[0, 1]] : d === "light" ? [[0, 1], [1, 1], [2, 1], [3, 1]] : [[0, 1], [1, 1], [1.5, -1], [2.5, -1], [3, 1], [3.5, -1]];
        const times = pat.filter(([b]) => b < len);
        times.forEach(([b, dir], i) => {
          const next = times[i + 1] ? at(b0 + times[i + 1][0]) : at(b0 + len);
          strum(V, at(b0 + b), dir, (b % 1 === 0 ? 0.5 : 0.36) + (b === 0 ? 0.08 : 0), lastBar ? null : next + 0.03);
        });
        if (d !== "none" || B.outro) {
          const bp = B.outro ? [[0, 0]] : d === "full" ? [[0, 0], [2, 0], [3, 7]] : [[0, 0], [2, 0]];
          for (const [b, iv] of bp) if (b < len) PB(r + iv, at(b0 + b), 0.5, { stopAt: lastBar ? null : at(b0 + Math.min(len, b + 1.8)) });
        }
      }
      if (d === "mid" || d === "full") {
        for (let b = 0; b < 4; b += 0.5) DR("shaker", at(b), b % 1 ? 0.2 : 0.13, { pan: 0.3 });
        DR("block", at(1), 0.22, { pan: -0.25 }); DR("block", at(3), 0.22, { pan: -0.25 });
        if (d === "full") { DR("kick", at(0), 0.4); DR("kick", at(2), 0.32); DR("clap", at(1), 0.14); DR("clap", at(3), 0.14); }
      } else if (d === "half" || d === "light") { DR("kick", at(0), 0.28); for (let b = 0; b < 4; b += 1) DR("shaker", at(b + 0.5), 0.14, { pan: 0.3 }); }
      if (B.fill && B.last) { DR("block", at(3.5), 0.2); DR("block", at(3.75), 0.25); }
      const lead = B.lead || "pulse";
      if (lead !== "off") for (const [b, len, n] of B.mel) {
        const m = midi(n) + k;
        GL(m + 12, at(b), lead === "soft" ? 0.45 : lead === "bell" ? 0.5 : 0.6);
        if (lead !== "soft" && d === "full") UK(m, at(b), 0.26, { stopAt: at(b + len) + 0.1 });
      }
    });
  }

  const STYLES = { chip: build, piano: buildPiano, lofi: buildLofi, pluck: buildPluck };
  async function renderBuffer(sampleRate = 44100, style = "chip", seconds = DURATION) {
    const ctx = new OfflineAudioContext(2, Math.ceil(Math.min(seconds, DURATION) * sampleRate), sampleRate);
    (STYLES[style] || build)(ctx, ctx.destination, 0);
    return ctx.startRendering();
  }
  function toWavBase64(buf) {
    const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); w(8, "WAVE"); w(12, "fmt ");
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true);
    data.setUint16(34, 16, true); w(36, "data"); data.setUint32(40, len * ch * 2, true);
    const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
    const bytes = new Uint8Array(data.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // ---------- 音效：跟着画面时间轴落点，音高取当下和弦里的音 ----------
  function chordAt(t) {
    const bar = Math.max(0, Math.min(BARS.length - 1, Math.floor(t / BAR)));
    const B = BARS[bar], beat = (t - bar * BAR) / BEAT;
    const [c1, c2] = B.chord.includes("/") ? B.chord.split("/") : [B.chord, B.chord];
    return CH[beat < 2 ? c1 : c2].map((n) => midi(n) + B.key);
  }
  // 取和弦里第 i 个音，抬到 lo..lo+12 这个八度区间
  function chordTone(t, i, lo = 72) {
    const tones = chordAt(t);
    let n = tones[((i % tones.length) + tones.length) % tones.length];
    while (n < lo) n += 12;
    while (n >= lo + 12) n -= 12;
    return n;
  }

  // palette：chip 用方波脉冲波，soft 换成三角波（配钢琴、Lo-fi、拨弦时不刺耳）
  function buildSfx(ctx, dest, cues, palette = "chip") {
    const out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 1.4, 3.5, 11);
    const vOut = ctx.createGain(); vOut.gain.value = 0.22; verb.connect(vOut); vOut.connect(out);
    const echo = ctx.createDelay(1); echo.delayTime.value = BEAT * 0.5;
    const efb = ctx.createGain(); efb.gain.value = 0.25; const eOut = ctx.createGain(); eOut.gain.value = 0.18;
    echo.connect(efb); efb.connect(echo); echo.connect(eOut); eOut.connect(out);
    const noise = noiseBuffer(ctx, 2, 99);
    const pulse25 = pulseWave(ctx, 0.25);
    const rnd = mulberry32(2026);

    // 各类音效的响度档位（按 levels.mjs 实测「音效峰值 − 让位后配乐 RMS」调出来的倍数）：
    // 重音比配乐高约 10 dB，常规动作高 4–7 dB，细碎的（打字、蹦跳、笔迹）和配乐齐平
    const GAIN = {
      talk: 4.3, hop: 4.8, step: 6, draw: 3.3, mark: 3.3, pop: 3.8, tag: 2.3, tick: 2.4, send: 3.3, arrive: 3.8, bubble: 3.4, poof: 2.3,
      swoosh: 2.5, whoosh: 3.5, wipe: 4, riser: 2.5, clock: 3.5, leap: 4.5, land: 1.3, key: 1, station: 1.5, coin: 2.8, sparkle: 3,
      ok: 2.6, err: 1.8, zap: 2, click: 2.2, up: 1.7, down: 3.5, flip: 5, thump: 0.85, heartbeat: 0.9, alarm: 3, scan: 1.8, hash: 4,
      stamp: 0.9, chime: 1, fanfare: 1, "fx-confetti": 1.25, "fx-spark": 0.8, "fx-dust": 1, "fx-stars": 3.2, "fx-rings": 4,
      "emote-!": 4.5, "emote-?": 4, "emote-note": 2.3, "emote-drop": 2, "emote-z": 6, "emote-heart": 2.2, "emote-spark": 1.8, "emote-ok": 2, "emote-no": 1.2,
    };
    let G = 1;
    function tone(t, f, dur, { wave = "triangle", vol = 0.05, a = 0.004, r = 0.06, lp = 5000, pan = 0, to = 0, send = 0.1, echoSend = 0 } = {}) {
      if (palette === "soft" && (wave === pulse25 || wave === "square")) { wave = "triangle"; lp = Math.min(lp, 4200); }
      const o = ctx.createOscillator();
      if (typeof wave === "string") o.type = wave; else o.setPeriodicWave(wave);
      o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp;
      const g = ctx.createGain();
      vol *= G;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a);
      g.gain.setValueAtTime(vol, t + Math.max(a, dur - 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      o.connect(fl); fl.connect(g); g.connect(p); p.connect(out);
      if (send) { const sg = ctx.createGain(); sg.gain.value = send; p.connect(sg); sg.connect(verb); }
      if (echoSend) { const sg = ctx.createGain(); sg.gain.value = echoSend; p.connect(sg); sg.connect(echo); }
      o.start(t); o.stop(t + dur + r + 0.05);
    }
    function hiss(t, dur, { vol = 0.05, type = "bandpass", f = 2000, f2 = 0, q = 0.8, pan = 0, a = 0.003, send = 0, am = 0 } = {}) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = ctx.createGain();
      vol *= G;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      let src = fl;
      if (am) { // 颤音：笔尖刮纸、闹铃那种一抖一抖
        const lfo = ctx.createOscillator(); lfo.frequency.value = am; const lg = ctx.createGain(); lg.gain.value = 0.5;
        const vca = ctx.createGain(); vca.gain.value = 0.5; lfo.connect(lg); lg.connect(vca.gain); fl.connect(vca); src = vca;
        lfo.start(t); lfo.stop(t + dur + 0.02);
      }
      n.connect(fl); src.connect(g); g.connect(p); p.connect(out);
      if (send) { const sg = ctx.createGain(); sg.gain.value = send; p.connect(sg); sg.connect(verb); }
      n.start(t, rnd() * 1.5); n.stop(t + dur + 0.02);
    }
    function thump(t, vol = 0.3, f0 = 120, f1 = 45, len = 0.16) {
      tone(t, f0, len, { wave: "sine", vol, to: f1, a: 0.002, r: 0.08, send: 0 });
    }

    for (const c of cues) {
      G = GAIN[c.type] ?? 1;
      const t = c.t, T = (i, lo) => hz(chordTone(t, i, lo));
      const pan = c.x != null ? Math.max(-0.75, Math.min(0.75, (c.x - 960) / 960 * 0.75)) : 0;
      const n = c.n || 0;
      switch (c.type) {
        case "talk": // Clawd 的「对白」：短促的方波，取和弦音
          tone(t, T(Math.floor(rnd() * 4), 76), 0.04, { wave: pulse25, vol: 0.02, lp: 2400, pan: (rnd() - 0.5) * 0.2, send: 0.04 }); break;
        case "bubble":
          tone(t, T(0, 72), 0.07, { vol: 0.05, to: T(2, 72), send: 0.12 }); break;
        case "hop":
          tone(t, 330 * (n % 2 ? 1.12 : 1), 0.09, { wave: "square", vol: 0.02, to: 700 * (n % 2 ? 1.12 : 1), lp: 2200 }); break;
        case "step":
          hiss(t, 0.035, { vol: 0.06, type: "lowpass", f: 900 }); break;
        case "leap":
          tone(t, 260, 0.32, { wave: "square", vol: 0.024, to: 1300, lp: 2400, send: 0.1 }); break;
        case "land":
          hiss(t, 0.16, { vol: 0.14, type: "lowpass", f: 520 }); thump(t, 0.2, 120, 55, 0.1); break;
        case "poof":
          hiss(t, 0.07, { vol: 0.04, f: 1600, q: 1.2 }); break;
        case "wipe":
          hiss(t, 0.84, { vol: 0.08, f: 400, f2: 5200, q: 1.1, a: 0.35, send: 0.2 }); break;
        // ---- 画面事件（自动分析得来）----
        case "pop": // 卡片弹出：和弦音往上走
          tone(t, T(n, 72), 0.06, { vol: 0.05, to: T(n + 1, 72) * 1.01, send: 0.12, pan }); break;
        case "tag":
          tone(t, T(n + 2, 79), 0.035, { vol: 0.03, send: 0.08, pan }); break;
        case "tick": // 主页里的小卡片依次亮起
          hiss(t, 0.02, { vol: 0.04, type: "highpass", f: 4500, pan }); tone(t, T(n, 84), 0.02, { vol: 0.012, pan, send: 0.05 }); break;
        case "draw": case "mark": // 笔尖划过
          hiss(t, 0.22, { vol: 0.022, f: 3200, q: 2.5, pan, am: 38 }); break;
        case "key":
          hiss(t, 0.018, { vol: 0.06, type: "highpass", f: 3200 }); tone(t, 1900 + rnd() * 300, 0.008, { wave: "square", vol: 0.014, lp: 6000, send: 0 }); break;
        case "send":
          tone(t, T(0, 79), 0.06, { wave: pulse25, vol: 0.026, to: T(1, 79), lp: 3000, echoSend: 0.4, pan }); hiss(t, 0.16, { vol: 0.02, f: 900, f2: 2600, pan }); break;
        case "arrive":
          tone(t, T(2, 79), 0.05, { vol: 0.035, to: T(0, 79), send: 0.1, pan }); break;
        case "stamp": // 印章：闷响 + 纸面一拍
          thump(t, 0.42, 110, 42, 0.18); hiss(t, 0.09, { vol: 0.16, f: 1300, q: 0.9, pan }); hiss(t + 0.02, 0.05, { vol: 0.05, type: "highpass", f: 5000, pan }); break;
        case "ok":
          tone(t, T(0, 79), 0.08, { vol: 0.05, send: 0.2 }); tone(t + 0.09, T(1, 79), 0.16, { vol: 0.05, send: 0.25, echoSend: 0.3 }); break;
        case "err":
          tone(t, 196, 0.08, { wave: "square", vol: 0.035, lp: 1400 }); tone(t + 0.1, 165, 0.14, { wave: "square", vol: 0.035, lp: 1200 }); break;
        case "sparkle":
          for (let k = 0; k < 4; k++) tone(t + k * 0.05, T(k, 84), 0.05, { vol: 0.032, send: 0.3, echoSend: 0.35 }); break;
        case "swoosh":
          hiss(t, 0.32, { vol: 0.05, f: 700, f2: 2600, q: 1.0, a: 0.12 }); break;
        case "whoosh":
          hiss(t, 0.55, { vol: 0.07, f: 350, f2: 3200, q: 0.9, a: 0.2, send: 0.15, pan }); break;
        case "riser": // 起势：c.dur 秒内从低往高扫，落点在 t + dur
          hiss(t, c.dur || 1.2, { vol: 0.07, f: 300, f2: 6000, q: 1.4, a: (c.dur || 1.2) * 0.9, send: 0.25 }); break;
        case "thump":
          thump(t, 0.2, 80, 55, 0.09); thump(t + 0.16, 0.14, 72, 50, 0.09); break;
        case "heartbeat": // 心跳：扑通扑通
          thump(t, 0.22, 90, 50, 0.08); thump(t + 0.17, 0.15, 80, 48, 0.08); break;
        case "zap":
          tone(t, 300, 0.12, { wave: pulse25, vol: 0.025, to: 2200, lp: 3000, echoSend: 0.3 }); break;
        case "down":
          tone(t, T(2, 76), 0.2, { vol: 0.045, to: T(0, 64), send: 0.15 }); break;
        case "up":
          tone(t, T(0, 64), 0.2, { vol: 0.045, to: T(2, 76), send: 0.15 }); break;
        case "station":
          tone(t, T(n, 76), 0.12, { vol: 0.055, send: 0.2, echoSend: 0.25, pan }); tone(t, T(n, 76) * 2, 0.05, { wave: "sine", vol: 0.018, pan }); break;
        case "chime":
          tone(t, T(0, 84), 0.3, { wave: "sine", vol: 0.06, send: 0.35 }); tone(t + 0.08, T(2, 84), 0.4, { wave: "sine", vol: 0.05, send: 0.4, echoSend: 0.3 }); break;
        case "coin": // 成功：两个音一跳
          tone(t, T(1, 84), 0.07, { wave: pulse25, vol: 0.035, lp: 4000, send: 0.1 }); tone(t + 0.07, T(1, 84) * 1.335, 0.28, { wave: pulse25, vol: 0.035, lp: 4000, send: 0.25, echoSend: 0.2 }); break;
        case "fanfare":
          for (let k = 0; k < 4; k++) tone(t + k * 0.09, T(k, 72), 0.12, { wave: pulse25, vol: 0.035, lp: 3200, send: 0.2 });
          for (let k = 0; k < 3; k++) tone(t + 0.4, T(k, 72), 0.6, { vol: 0.03, send: 0.3 });
          break;
        case "clock":
          hiss(t, 0.012, { vol: 0.025, type: "highpass", f: 6000 }); break;
        case "alarm": // 闹钟：两个高音快速交替，一抖一抖
          for (let k = 0; k < 8; k++) tone(t + k * 0.07, k % 2 ? 1760 : 2093, 0.05, { wave: "square", vol: 0.012, lp: 5000, send: 0.05 }); break;
        case "click": // 小锁扣上
          hiss(t, 0.012, { vol: 0.08, type: "highpass", f: 3000 }); hiss(t + 0.045, 0.02, { vol: 0.06, type: "bandpass", f: 1800, q: 3 }); break;
        case "scan": // 扫描光条
          tone(t, 500, c.dur || 0.8, { wave: "sine", vol: 0.025, to: 1400, send: 0.2, echoSend: 0.2 }); hiss(t, c.dur || 0.8, { vol: 0.015, f: 2400, q: 6, am: 14 }); break;
        case "flip": // 翻牌
          for (let k = 0; k < 6; k++) hiss(t + k * 0.045, 0.018, { vol: 0.05 - k * 0.005, type: "bandpass", f: 2600, q: 2 }); break;
        case "hash": // 乱码滚动
          for (let k = 0; k < 10; k++) tone(t + k * 0.05, 1200 + rnd() * 1400, 0.012, { wave: "square", vol: 0.008, lp: 6000, send: 0 }); break;
        // ---- 表情 ----
        case "emote-!":
          tone(t, T(0, 79), 0.05, { wave: "square", vol: 0.03, lp: 3000, to: T(2, 79) * 2, send: 0.12 }); break;
        case "emote-?":
          tone(t, T(0, 72), 0.12, { vol: 0.04, to: T(2, 76), send: 0.1 }); tone(t + 0.14, T(1, 76), 0.12, { vol: 0.04, to: T(3, 79), send: 0.15 }); break;
        case "emote-heart": case "emote-spark":
          for (let k = 0; k < 3; k++) tone(t + k * 0.06, T(k + 1, 84), 0.05, { wave: "sine", vol: 0.03, send: 0.3, echoSend: 0.3 }); break;
        case "emote-note":
          tone(t, T(n, 79), 0.12, { wave: "sine", vol: 0.035, send: 0.25, echoSend: 0.3 }); break;
        case "emote-drop":
          tone(t, 1100, 0.12, { wave: "sine", vol: 0.035, to: 380, send: 0.1 }); break;
        case "emote-z": // 打呼：低通噪声一吸一呼
          hiss(t, 0.5, { vol: 0.02, type: "lowpass", f: 500, f2: 900, a: 0.3 }); break;
        case "emote-ok":
          tone(t, T(0, 79), 0.07, { vol: 0.045, send: 0.2 }); tone(t + 0.08, T(2, 79), 0.14, { vol: 0.045, send: 0.25 }); break;
        case "emote-no":
          tone(t, 220, 0.09, { wave: "square", vol: 0.03, lp: 1400 }); break;
        // ---- 粒子 ----
        case "fx-confetti": // 礼花：一声啪 + 一串亮晶晶
          hiss(t, 0.09, { vol: 0.2, f: 1500, q: 0.7, pan }); thump(t, 0.16, 160, 60, 0.06);
          for (let k = 0; k < 12; k++) tone(t + 0.05 + k * 0.045 + rnd() * 0.02, T(Math.floor(rnd() * 4), 84 + (k % 2) * 12), 0.035, { wave: "sine", vol: 0.018, send: 0.35, pan: (rnd() - 0.5) * 1.2 });
          break;
        case "fx-dust":
          hiss(t, 0.14, { vol: 0.08, type: "lowpass", f: 700, pan }); break;
        case "fx-spark": // 碰撞：一声脆响（低频闷响交给印章，两个不叠）
          tone(t, 2637, 0.25, { wave: "sine", vol: 0.03, send: 0.3, pan }); tone(t, 3520 * 1.01, 0.18, { wave: "sine", vol: 0.02, send: 0.3, pan });
          hiss(t, 0.05, { vol: 0.1, type: "highpass", f: 3500, pan }); break;
        case "fx-stars":
          for (let k = 0; k < 4; k++) tone(t + 0.05 + k * 0.08, T(k, 91), 0.05, { wave: "sine", vol: 0.02, send: 0.35, echoSend: 0.3, pan }); break;
        case "fx-rings": // 广播：一圈圈往外
          for (let k = 0; k < 3; k++) tone(t + k * 0.2, T(k, 76), 0.18, { wave: "sine", vol: 0.04 - k * 0.008, send: 0.35, echoSend: 0.25, pan }); break;
      }
    }
  }
  async function renderSfx(cues, sampleRate = 44100, palette = "chip") {
    const ctx = new OfflineAudioContext(2, Math.ceil(DURATION * sampleRate), sampleRate);
    buildSfx(ctx, ctx.destination, cues, palette);
    return ctx.startRendering();
  }
  // 配乐增益曲线：旁白期间压低一点；dips 是「重音前收住」——t 之前 pre 秒压到 depth，t 时回来
  function duckBuffer(bubbles, dips = [], sampleRate = 44100, depth = 0.72, ramp = 0.25) {
    const len = Math.ceil(DURATION * sampleRate);
    const ctx = new OfflineAudioContext(2, len, sampleRate);
    const buf = ctx.createBuffer(2, len, sampleRate);
    const g = new Float32Array(len).fill(1);
    for (const b of bubbles) {
      const i0 = Math.max(0, Math.floor((b.a - ramp) * sampleRate)), i1 = Math.min(len, Math.ceil((b.b + ramp) * sampleRate));
      for (let i = i0; i < i1; i++) {
        const t = i / sampleRate;
        const k = Math.min(1, (t - (b.a - ramp)) / ramp, ((b.b + ramp) - t) / ramp);
        g[i] = Math.min(g[i], 1 - (1 - depth) * Math.max(0, k));
      }
    }
    for (const d of dips) {
      const fall = 0.09, a = d.t - d.pre, z = d.t + d.hold, e = z + d.post;
      const i0 = Math.max(0, Math.floor((a - fall) * sampleRate)), i1 = Math.min(len, Math.ceil(e * sampleRate));
      for (let i = i0; i < i1; i++) {
        const t = i / sampleRate;
        const k = t < a ? (t - (a - fall)) / fall : t < z ? 1 : 1 - (t - z) / d.post;
        g[i] = Math.min(g[i], 1 - (1 - d.depth) * Math.max(0, Math.min(1, k)));
      }
    }
    buf.copyToChannel(g, 0); buf.copyToChannel(g, 1);
    return buf;
  }

  window.Music = { BPM, BEAT, BAR, DURATION, PLAN: PLAN.map((c) => ({ name: c.name, bars: c.bars.length })), STYLES: Object.keys(STYLES), renderBuffer, toWavBase64, renderSfx, duckBuffer, chordAt };
})();
