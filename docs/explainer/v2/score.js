(function () {
  "use strict";
  const BPM = 108, BEAT = 60 / BPM, BAR = BEAT * 4;
  const TAIL = 2, SAMPLE_RATE = 48000;
  const RENDER_BATCH_SECONDS = 1, RENDER_WARMUP_SECONDS = 20, RENDER_QUANTUM_FRAMES = 128, DUCK_RATE = 1000;
  const CEIL_DB = -1, TARGET_LUFS = null;
  const at = (bar, beat = 0) => bar * BAR + beat * BEAT;
  const TAU = Math.PI * 2;
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (s) => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0); };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }


  const CHORD = {
    Dm9: ["D3", "A3", "C4", "E4", "F4"],
    Dmadd9: ["D3", "A3", "E4", "F4"],
    G6: ["G3", "B3", "D4", "E4"],
    Fmaj7: ["F3", "A3", "C4", "E4"],
    C69: ["C3", "G3", "D4", "E4", "A4"],
    Bbmaj7: ["Bb2", "F3", "A3", "D4"],
    Bbmaj7s11: ["Bb2", "F3", "A3", "D4", "E4"],
    Gm9: ["G2", "F3", "Bb3", "D4", "A4"],
    A7sus4: ["A2", "E3", "G3", "D4"],
    A7: ["A2", "E3", "G3", "C#4"],
    Em7b5: ["E3", "G3", "Bb3", "D4"],
  };
  const rootOf = (name) => { let m = 24 + (midi(CHORD[name][0]) % 12); while (m < 31) m += 12; return m; };

  const VEL = { X: 1, x: 0.75, o: 0.45 };
  const BASS = {
    light: [[0, 1.75, 0, 0.8], [2.5, 1.25, 0, 0.7]],
    groove: [[0, 1.25, 0, 1], [1.5, 0.5, 0, 0.7], [2.25, 0.5, 12, 0.55], [3, 0.75, 7, 0.8]],
    slam: [[2, 0.75, 0, 0.9], [3, 0.75, 7, 0.8]],
    half: [[0, 2, 0, 0.9]],
    offbeat: [[0.5, 0.4, 0, 0.95], [1.5, 0.4, 0, 0.8], [2.5, 0.4, 0, 0.95], [3.5, 0.4, 12, 0.6]],
    reveal: [[0, 0.4, 0, 1], [0.5, 0.4, 0, 0.85], [1.5, 0.4, 0, 0.85], [2.5, 0.4, 0, 0.95], [3, 0.25, 12, 0.5], [3.5, 0.4, 7, 0.75]],
    end: [[0, 4, 0, 0.7]],
  };
  const ARP = {
    sparse: [[0, 0], [1.5, 2], [2.5, 1]],
    332: [[0, 0], [0.75, 1], [1.5, 2], [2, 3], [2.75, 2], [3.5, 1]],
    queue: [[0, 0], [0.75, 2], [1.5, 1], [2.5, 3], [3.25, 2]],
  };
  const THEME = [[0, 0.75, "A4"], [0.75, 0.75, "D5"], [1.5, 0.5, "F5"], [2, 2, "E5"]];
  const withNotes = (names) => THEME.map(([b, d], i) => [b, d, names[i]]);
  const phrase = (bar, notes, inst, v, theme = false) => notes.map(([b, d, n]) => [bar, b, d, n, inst, v, theme]);
  const KEY_PRE = 0.016;
  const WHOOSH_LEN = { tube: 0.95, fork: 1.25, down: 2 * BEAT, whip: 0.62 };
  const HELP = { THEME, withNotes, phrase, midi, CHORD, BASS, ARP, BAR, BEAT };

  function placeholderPart(p) {
    return {
      id: p.id, placeholder: true, seed: 1,
      score: () => ({
        harm: Array(p.bars).fill("Dmadd9"),
        sections: [{ from: 0, to: p.bars - 1, id: `${p.id}-todo`, name: "占位：这一章还没写谱", energy: 0.2,
          clock: "x...o...o...o...", clockVol: 0.9, ghost: [4, 0.1, 0.3], pad: 0.35, lp: 1200, padVerb: 0.3 }],
      }),
    };
  }
  const seedOf = (id) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h | 0; };

  function steps(p, i) {
    const s = Array.isArray(p) ? p[i % p.length] : p, out = [];
    if (!s) return out;
    for (let k = 0; k < 16; k++) if (VEL[s[k]]) out.push([k / 4, VEL[s[k]], k]);
    return out;
  }
  function arpTones(chord, lo, span = 15) {
    const pcs = new Set(CHORD[chord].map((n) => midi(n) % 12)), out = [];
    for (let m = lo; m <= lo + span; m++) if (pcs.has(m % 12)) out.push(m);
    return out;
  }

  let B = null;
  function build(plan) {
    const reg = new Map();
    for (const p of window.SCORE_PARTS || []) {
      if (reg.has(p.id)) console.error(`配乐：${p.id} 注册了两次，用后一次`);
      reg.set(p.id, p);
    }
    // 只查整张章节表：?only= 只拼几章时，其余章的乐谱本来就不拼
    for (const id of reg.keys()) if (!(window.PLAN || plan).some((p) => p.id === id)) console.warn(`配乐：${id} 不在 plan.js 里，不会拼进去`);
    for (const p of reg.values()) for (const [name, notes] of Object.entries(p.chords || {})) {
      if (!CHORD[name]) CHORD[name] = notes;
      else if (JSON.stringify(CHORD[name]) !== JSON.stringify(notes)) console.error(`配乐 ${p.id}：和弦 ${name} 已经有了、音不一样，换个名字`);
    }
    const chapters = [];
    let bar0 = 0;
    for (const pl of plan) {
      const part = reg.get(pl.id) || placeholderPart(pl);
      const d = part.score(HELP);
      const tone = { bell: "bright", pluckPan: 0, snareVerb: 0.12, ...(part.tone || {}) };
      if (d.harm.length !== pl.bars) console.error(`配乐 ${pl.id}：harm 写了 ${d.harm.length} 小节，plan.js 是 ${pl.bars}`);
      const secs = (d.sections || []).map((s) => ({ ...s, from: bar0 + s.from, to: bar0 + s.to, tone }));
      // 段落要盖满这一章的每一小节；漏掉的小节补一段安静的，免得 pad 找不到段落
      for (let b = 0; b < pl.bars; b++) if (!secs.some((s) => bar0 + b >= s.from && bar0 + b <= s.to)) {
        console.error(`配乐 ${pl.id}：第 ${b} 小节没有段落，先补一段安静的`);
        secs.push({ id: `${pl.id}-gap-${b}`, name: "补的空段", from: bar0 + b, to: bar0 + b, energy: 0.2, pad: 0.4, lp: 1200, padVerb: 0.3, tone });
      }
      chapters.push({ id: pl.id, bars: pl.bars, bar0, part, d, tone, secs, placeholder: !!part.placeholder });
      bar0 += pl.bars;
    }
    const BARS = bar0, DURATION = BARS * BAR;
    const HARM = chapters.flatMap((c) => c.d.harm.slice(0, c.bars).concat(Array(Math.max(0, c.bars - c.d.harm.length)).fill(c.d.harm[c.d.harm.length - 1] || "Dmadd9")));
    const chordAt = (bar, beat) => {
      const h = HARM[clamp(bar, 0, BARS - 1)];
      if (typeof h === "string") return h;
      let c = h[0][0];
      for (const [n, b] of h) if (beat >= b - 1e-9) c = n;
      return c;
    };
    const SEGMENTS = [];
    HARM.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([chord, beat]) => SEGMENTS.push({ bar, beat, t: at(bar, beat), chord })));
    SEGMENTS.forEach((s, i) => (s.end = i + 1 < SEGMENTS.length ? SEGMENTS[i + 1].t : DURATION));
    const SECTIONS = chapters.flatMap((c) => c.secs);
    const SEC_OF_BAR = [];
    SECTIONS.forEach((s) => { for (let b = s.from; b <= s.to; b++) SEC_OF_BAR[b] = s; });
    const sectionOf = (bar) => SEC_OF_BAR[clamp(bar, 0, BARS - 1)];

    const N = [];
    for (const s of SEGMENTS) { const sec = sectionOf(s.bar); N.push({ kind: "pad", t: s.t, end: s.end, chord: s.chord, level: sec.pad, lp: sec.lp, verb: sec.padVerb, last: s.end >= DURATION - 1e-9 }); }
    const inPost = (c, t) => !!c.part.postBars && t >= at(c.bar0 + c.part.postBars[0]) - 1e-9 && t < at(c.bar0 + c.part.postBars[1]) - 1e-9;
    for (const c of chapters) {
      const rnd = mulberry32(c.part.seed ?? seedOf(c.id));
      for (const sec of c.secs) for (let bar = sec.from; bar <= sec.to; bar++) {
        const i = bar - sec.from;
        for (const [b, v] of steps(sec.kick, i)) {
          const type = sec.kickKind === "heart" ? (v === 1 ? "lub" : "dub") : sec.kickKind || "tight";
          N.push({ kind: "kick", t: at(bar, b), v: sec.kickKind === "heart" ? (v === 1 ? 1 : 0.65) : v, type, duck: sec.duck });
        }
        for (const [b, v] of steps(sec.snare, i)) N.push({ kind: "snare", t: at(bar, b), v, type: sec.snareKind, verb: c.tone.snareVerb });
        for (const [b, v] of steps(sec.hat, i)) N.push({ kind: "hat", t: at(bar, b), v: v * (0.88 + 0.24 * rnd()), type: sec.hatKind, variant: Math.floor(rnd() * 4), vol: sec.hatVol ?? 1 });
        for (const [b, v, k] of steps(sec.clock, i)) N.push({ kind: "clock", t: at(bar, b), v, type: sec.clockKind || (k % 2 ? "tock" : "tick"), vol: sec.clockVol ?? 1 });
        if (sec.ghost) for (let b = 0; b < 4; b += sec.ghost[0]) N.push({ kind: "ghost", t: at(bar, b), depth: sec.ghost[1], tau: sec.ghost[2] });
        if (sec.bass) {
          const pat = sec.bass === "hold" ? SEGMENTS.filter((s) => s.bar === bar).map((s) => [s.beat, (s.end - s.t) / BEAT, 0, 0.6]) : BASS[sec.bass];
          for (const [b, len, iv, v] of pat) N.push({ kind: "bass", t: at(bar, b), dur: len * BEAT, m: rootOf(chordAt(bar, b)) + iv, v: v * (sec.bassVol ?? 1), att: sec.bass === "hold" ? 0.03 : 0.007, rel: sec.bass === "end" ? 1.6 : 0.05 });
        }
        if (sec.arp) for (const [b, idx] of ARP[sec.arp.p]) {
          const T = arpTones(chordAt(bar, b), sec.arp.lo), t = at(bar, b);
          N.push({ kind: "mel", t, dur: 0.5 * BEAT, m: T[idx % T.length], inst: sec.arp.inst, v: sec.arp.v * (0.9 + 0.2 * rnd()), pan: Math.round(b * 4) % 2 ? 0.3 : -0.3, arp: true, tone: c.tone.bell, post: inPost(c, t) });
        }
      }
    }
    for (const c of chapters) for (const [bar, b, d, n, inst, v, theme] of c.d.melody || []) {
      const t = at(c.bar0 + bar, b);
      N.push({ kind: "mel", t, dur: d * BEAT, m: midi(n), inst, v, theme, bar: c.bar0 + bar, tone: c.tone.bell, pan: inst === "pluck" ? c.tone.pluckPan : 0, post: inPost(c, t) });
    }
    for (const c of chapters) for (const s of c.d.story || []) N.push({ ...s, bar: c.bar0 + s.bar, t: at(c.bar0 + s.bar, s.beat) });
    N.sort((a, b) => a.t - b.t);
    // 反复出现的动作从几种取法里轮换，不连着用同一个采样
    const TAKES = { key: 4, hop: 3, accent: 3 }, taken = {};
    for (const n of N) if (TAKES[n.kind] && (n.kind !== "accent" || n.what === "slip")) n.take = (taken[n.kind] = (taken[n.kind] ?? -1) + 1) % TAKES[n.kind];
    const SWEEPS = [];
    for (const c of chapters) for (const s of c.d.sweeps || []) SWEEPS.push({ t0: at(c.bar0 + s.at[0], s.at[1] || 0), t1: at(c.bar0 + s.down[0], s.down[1] || 0), t2: at(c.bar0 + s.up[0], s.up[1] || 0), f: s.f });

    const DIPS = [];
    for (const n of N) {
      if (n.kind === "kick") DIPS.push({ t: n.t, depth: n.duck * n.v, tau: n.type === "lub" ? 0.2 : 0.12 });
      else if (n.kind === "ghost") DIPS.push({ t: n.t, depth: n.depth, tau: n.tau });
      else if (n.kind === "stamp") DIPS.push({ t: n.t, depth: n.size === "big" ? 0.8 : 0.45, tau: n.size === "big" ? 0.35 : 0.2 });
      else if (n.kind === "gate") DIPS.push({ t: n.t, depth: 0.45, tau: 0.2 });
      else if (n.kind === "boom" || (n.kind === "accent" && n.what === "arrive")) DIPS.push({ t: n.t, depth: 0.45, tau: 0.45 });
    }
    DIPS.sort((a, b) => a.t - b.t);
    const HITS = Object.fromEntries(EVENT_KEYS.map((k) => [k, []]));
    for (const n of N) {
      const k = n.kind;
      if (k === "mel") { if (n.theme) HITS.bell.push({ t: n.t, v: n.v }); }
      else if (k === "stamp") HITS.stamp.push({ t: n.t, v: n.size === "big" ? 1 : 0.7 });
      else if (k === "lamp") HITS.lamp.push({ t: n.t, v: n.late ? 0.45 : 1 });
      else if (k === "accent") HITS.accent.push({ t: n.t, v: { arrive: 0.7, slip: 0.6, broadcast: 1, flip: 1 }[n.what] ?? 0.8 });
      else if (k === "whoosh") HITS.whoosh.push({ t: n.t, v: 1, type: typeof n.tube === "number" ? "tube" : n.tube });
      else if (HITS[k]) HITS[k].push({ t: n.t, v: clamp(n.v ?? 1, 0, 1) });
    }
    for (const k of EVENT_KEYS) {
      const L = HITS[k].sort((a, b) => a.t - b.t), out = [];
      for (const h of L) { const p = out[out.length - 1]; if (p && Math.abs(p.t - h.t) < 1e-9) { if (h.v > p.v) out[out.length - 1] = h; } else out.push(h); }
      HITS[k] = out;
    }
    const events = Object.fromEntries(EVENT_KEYS.map((k) => [k, HITS[k].map((h) => h.t)]));
    B = {
      BARS, DURATION, NOTES: N, DIPS, HITS, events, SECTIONS, SEGMENTS, sectionOf, SWEEPS,
      PADS: N.filter((n) => n.kind === "pad"), BASSES: N.filter((n) => n.kind === "bass"),
      RISERS: N.filter((n) => (n.kind === "whoosh" && n.tube === "down") || n.kind === "swell").map((n) => ({ t: n.t, len: n.kind === "swell" ? BEAT : WHOOSH_LEN.down })),
    };
    Object.assign(window.Score, {
      bars: BARS, duration: DURATION, events, notes: N,
      sections: SECTIONS.map((s) => ({ id: s.id, name: s.name, chapter: chapters.find((c) => s.from >= c.bar0 && s.from < c.bar0 + c.bars).id, from: s.from, to: s.to, t0: at(s.from), t1: at(s.to + 1), energy: s.energy })),
      chords: SEGMENTS.map((s) => ({ t: s.t, end: s.end, name: s.chord })),
      chapters: chapters.map((c) => ({ id: c.id, bar0: c.bar0, bars: c.bars, t0: at(c.bar0), placeholder: c.placeholder })),
    });
    return window.Score;
  }

  const EVENT_KEYS = ["kick", "snare", "hat", "tick", "stamp", "whoosh", "lamp", "key", "bell", "accent", "clock"];
  const DIP_ATT = 0.008;
  function lastIdx(list, t, key = "t") { let lo = 0, hi = list.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][key] <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  function duck(t, dips = B.DIPS) {
    let g = 1;
    for (let i = lastIdx(dips, t); i >= 0; i--) {
      const d = dips[i], x = t - d.t;
      if (x > 2) break;
      const s = x < DIP_ATT ? x / DIP_ATT : Math.exp(-(x - DIP_ATT) / d.tau);
      g *= 1 - d.depth * s;
    }
    return g;
  }
  const bassDuck = (t) => 1 - 0.65 * (1 - duck(t));

  const DECAY = { kick: 0.12, snare: 0.14, hat: 0.05, clock: 0.035, tick: 0.22, stamp: 0.3, lamp: 0.45, key: 0.12, bell: 0.6, accent: 0.5 };
  function padLevel(t) {
    const P = B.PADS, i = lastIdx(P, t);
    if (i < 0) return 0;
    const p = P[i], x = t - p.t, a = Math.min(1, x / 0.28);
    const prev = i > 0 ? P[i - 1].level * Math.exp(-x / 0.11) : 0;
    const tail = t > B.DURATION ? Math.exp(-(t - B.DURATION) / 0.42) : 1;
    return clamp(Math.max(p.level * a, prev) * tail, 0, 1);
  }
  function env(name, t) {
    if (!B) return 0;
    if (DECAY[name]) {
      const L = B.HITS[name], i = lastIdx(L, t);
      return i < 0 ? 0 : clamp(L[i].v * Math.exp(-(t - L[i].t) / DECAY[name]), 0, 1);
    }
    const DURATION = B.DURATION;
    switch (name) {
      case "duck": return duck(t);
      case "pad": return padLevel(t) * duck(t);
      case "bass": {
        const i = lastIdx(B.BASSES, t);
        if (i < 0) return 0;
        const b = B.BASSES[i], x = t - b.t, rel = b.rel / 3;
        const e = x < b.att ? x / b.att : x < b.dur ? 1 : Math.exp(-(x - b.dur) / rel);
        return clamp(b.v * e * bassDuck(t), 0, 1);
      }
      case "whoosh": {
        let m = 0;
        for (const w of B.HITS.whoosh) {
          const len = WHOOSH_LEN[w.type], x = t - w.t;
          if (x < 0 || x > len) continue;
          const e = w.type === "down" ? Math.pow(x / len, 2.2) : w.type === "whip" ? Math.pow(Math.sin(Math.PI * x / len), 2) : x < 0.07 ? x / 0.07 : Math.exp(-(x - 0.07) / (w.type === "fork" ? 0.4 : 0.26));
          m = Math.max(m, e);
        }
        return m;
      }
      case "riser": { for (const r of B.RISERS) if (t >= r.t && t < r.t + r.len) return (t - r.t) / r.len; return 0; }
      case "energy": {
        const bar = Math.floor(clamp(t, 0, DURATION - 1e-6) / BAR), s = B.sectionOf(bar), x = t - at(s.from);
        if (s.from > 0 && x < 0.4) { const p = B.sectionOf(s.from - 1).energy; return p + (s.energy - p) * (x / 0.4); }
        return t > DURATION ? s.energy * Math.exp(-(t - DURATION) / 0.6) : s.energy;
      }
      case "beat": { if (t < 0 || t >= DURATION) return 0; const x = (t / BEAT) % 1; return Math.exp(-(x * BEAT) / 0.15); }
      case "bar": { if (t < 0 || t >= DURATION) return 0; const x = (t / BAR) % 1; return Math.exp(-(x * BAR) / 0.4); }
    }
    return 0;
  }
  const SAMPLE_BANKS = new Map();
  function samplesFor(sr) {
    if (SAMPLE_BANKS.has(sr)) return SAMPLE_BANKS.get(sr);
    const cache = new Map();
    const arr = (sec) => new Float32Array(Math.max(1, Math.round(sec * sr)));
    function norm(d, peak = 1) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; }
    function biquad(d, type, f, q = 0.707) {
      const w = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      let b0, b1, b2;
      if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
      else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) { const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
      return d;
    }
    function nz(n, seed, type, f, q) { const r = mulberry32(seed), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; if (type) biquad(d, type, f, q); return norm(d); }
    function partial(d, f, amp, tau, ph) {
      if (f >= sr * 0.45) return;
      const w = TAU * f / sr, c2 = 2 * Math.cos(w), k = Math.exp(-1 / (tau * sr));
      let s1 = Math.sin(ph - w), s2 = Math.sin(ph - 2 * w), e = amp;
      for (let i = 0; i < d.length && e > 1e-5; i++) { const s = c2 * s1 - s2; s2 = s1; s1 = s; d[i] += s * e; e *= k; }
    }
    function finish(d, att = 0.0005) {
      const a = Math.max(1, Math.round(att * sr)), f = Math.min(d.length, Math.round(0.004 * sr));
      for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
      for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - i / f;
      return norm(d);
    }
    const get = (key, fn) => {
      if (!cache.has(key)) { const d = fn(); if (d.some((v) => !Number.isFinite(v))) throw new Error(`Invalid sample bank: ${key}`); const b = new AudioBuffer({ length: d.length, sampleRate: sr, numberOfChannels: 1 }); b.copyToChannel(d, 0); cache.set(key, b); }
      return cache.get(key);
    };

    const KICK = {
      tight: { f0: 160, f1: 47, pt: 0.03, dec: 0.23, att: 0.0008, click: 0.35, len: 0.55 },
      light: { f0: 140, f1: 50, pt: 0.028, dec: 0.15, att: 0.001, click: 0.2, len: 0.4 },
      lub: { f0: 100, f1: 44, pt: 0.05, dec: 0.2, att: 0.004, click: 0, len: 0.55 },
      dub: { f0: 118, f1: 50, pt: 0.04, dec: 0.13, att: 0.003, click: 0, len: 0.4 },
    };
    const kick = (kind) => get("k:" + kind, () => {
      const c = KICK[kind], d = arr(c.len), cl = nz(d.length, 11, "hp", 2500);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += TAU * (c.f1 + (c.f0 - c.f1) * Math.exp(-t / c.pt)) / sr;
        const a = Math.exp(-t / c.dec) * Math.min(1, t / c.att);
        d[i] = Math.tanh(1.5 * Math.sin(ph) * a) / Math.tanh(1.5) + c.click * cl[i] * Math.exp(-t / 0.0025);
      }
      return finish(d, 0.0002);
    });
    const snare = (kind) => get("sn:" + kind, () => {
      const d = arr(0.35), n = d.length;
      if (kind === "thud") {
        const a = nz(n, 21, "bp", 2100, 0.8), b = nz(n, 22, "bp", 480, 2), c = nz(n, 23, "hp", 4500);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          ph += TAU * (150 + 70 * Math.exp(-t / 0.018)) / sr;
          d[i] = 0.7 * Math.sin(ph) * Math.exp(-t / 0.045) + 0.75 * a[i] * Math.exp(-t / 0.032) + 0.45 * b[i] * Math.exp(-t / 0.05) + 0.4 * c[i] * Math.exp(-t / 0.004);
        }
      } else {
        const a = nz(n, 24, "bp", 2600, 1), b = nz(n, 25, "bp", 1100, 0.7);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          d[i] = 0.5 * Math.sin(TAU * 340 * t) * Math.exp(-t / 0.022) + 0.3 * Math.sin(TAU * 525 * t) * Math.exp(-t / 0.016) + 0.6 * a[i] * Math.exp(-t / 0.028) + 0.35 * b[i] * Math.exp(-t / 0.07);
        }
      }
      return finish(d, 0.0003);
    });
    const flip = (v) => get("fl:" + v, () => {
      const d = arr(0.16), n = d.length, a = nz(n, 41 + v, "bp", 1700 + 250 * v, 0.6);
      const bursts = [[0, 1], [0.016 + 0.002 * v, 0.7], [0.031, 0.5], [0.047, 0.3]];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.15));
        for (const [tb, ab] of bursts) if (t >= tb) e += ab * Math.exp(-(t - tb) / 0.007);
        d[i] = a[i] * e;
      }
      biquad(d, "lp", 5000);
      return finish(d, 0.001);
    });
    const clock = (kind) => get("cl:" + kind, () => {
      const f = kind === "tick" ? 3100 : 2300, d = arr(0.05), n = d.length, a = nz(n, 51, "hp", 3000);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.6 * Math.sin(TAU * f * t) * Math.exp(-t / 0.005) + 0.4 * Math.sin(TAU * 0.37 * f * t) * Math.exp(-t / 0.009) + 0.4 * a[i] * Math.exp(-t / 0.0015);
      }
      return finish(d, 0.0002);
    });
    const PLUCK = {
      pluck: { pos: 0.18, t0: 0.55, ex: 1.3, fmax: 11000, len: 1.6, nz: 0.22, nf: 3000 },
      pluckDark: { pos: 0.24, t0: 0.6, ex: 1.8, fmax: 5000, len: 1.6, nz: 0.1, nf: 1600 },
      pluckMute: { pos: 0.2, t0: 0.14, ex: 1.6, fmax: 6000, len: 0.6, nz: 0.18, nf: 2200 },
    };
    const pluck = (m, kind) => get("pl:" + kind + ":" + m, () => {
      const c = PLUCK[kind], f0 = hz(m), d = arr(c.len), n = d.length, r = mulberry32(m * 17 + 5);
      const tt = c.t0 * Math.pow(262 / f0, 0.3);
      for (let k = 1; k * f0 < c.fmax; k++) {
        const amp = (Math.abs(Math.sin(k * Math.PI * c.pos)) + 0.04) / Math.pow(k, c.ex), tau = tt / (1 + 0.5 * (k - 1));
        partial(d, f0 * k, amp, tau, r() * TAU);
        partial(d, f0 * k * 1.0035, amp * 0.3, tau, r() * TAU);
      }
      const a = nz(n, 101 + m, "bp", c.nf, 0.8), pn = Math.round(0.006 * sr);
      for (let i = 0; i < pn; i++) d[i] += c.nz * a[i] * (1 - i / pn);
      return finish(d, 0.0008);
    });
    function bellArr(m, tone) {
      const f = hz(m), len = clamp(2.4 * Math.pow(523 / f, 0.4), 1.2, 4), d = arr(len), n = d.length;
      const warm = tone === "warm", I1 = warm ? 0.9 : 1.5, tine = warm ? 0.22 : 0.38, tb = len / 4.5;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = TAU * f * t;
        d[i] = Math.sin(w + (I1 * Math.exp(-t / 0.35) + 0.12) * Math.sin(w)) * Math.exp(-t / tb)
          + tine * Math.sin(w + 1.8 * Math.exp(-t / 0.05) * Math.sin(3.5 * w)) * Math.exp(-t / 0.35)
          + 0.05 * Math.sin(2.005 * w) * Math.exp(-t / (tb * 0.6));
      }
      return finish(d, 0.0015);
    }
    const bell = (m, tone) => get("bl:" + tone + ":" + m, () => bellArr(m, tone));
    const glass = (m) => get("gl:" + m, () => {
      const f = hz(m), len = clamp(2.2 * Math.pow(523 / f, 0.3), 1.2, 3), d = arr(len), n = d.length, a = nz(n, 1000 + m, "hp", 6500);
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = TAU * f * t;
        const body = Math.sin(w + (0.9 * Math.exp(-t / 0.25) + 0.15) * Math.sin(2 * w)) * Math.exp(-t / (len / 3.2)) * (1 + 0.05 * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.2));
        d[i] = body + 0.4 * Math.sin(w + 1.6 * Math.exp(-t / 0.03) * Math.sin(3.99 * w)) * Math.exp(-t / 0.12)
          + 0.1 * Math.sin(2.76 * w) * Math.exp(-t / 0.15) + 0.12 * a[i] * Math.exp(-t / 0.001);
      }
      return finish(d, 0.001);
    });
    const marimba = (m) => get("mb:" + m, () => {
      const f = hz(m), tau = 0.9 * Math.pow(220 / f, 0.4), d = arr(Math.min(2.4, tau * 5)), n = d.length, r = mulberry32(1100 + m);
      for (const [k, amp, tk] of [[1, 1, tau], [1.003, 0.18, tau * 0.8], [3.93, 0.28, 0.1], [9.2, 0.08, 0.035]]) partial(d, f * k, amp, tk, r() * TAU);
      const th = nz(n, 1200 + m, "bp", 700, 0.7), pn = Math.min(n, Math.round(0.03 * sr));
      for (let i = 0; i < pn; i++) d[i] += 0.25 * th[i] * Math.exp(-i / sr / 0.005);
      return finish(d, 0.002);
    });
    const kalimba = (m) => get("kb:" + m, () => {
      const f = hz(m), tau = 0.7 * Math.pow(440 / f, 0.35), d = arr(Math.min(2, tau * 4)), n = d.length, r = mulberry32(1300 + m);
      for (const [k, amp, tk] of [[1, 1, tau], [2.003, 0.05, tau * 0.4], [6.27, 0.2, 0.06], [17.55, 0.05, 0.012]]) partial(d, f * k, amp, tk, r() * TAU);
      const th = nz(n, 1310 + m, "bp", 2400, 0.9), pn = Math.min(n, Math.round(0.012 * sr));
      for (let i = 0; i < pn; i++) d[i] += 0.18 * th[i] * Math.exp(-i / sr / 0.002);
      return finish(d, 0.0015);
    });
    const knock = (far) => get("kn:" + (far ? 1 : 0), () => {
      const d = arr(0.2), n = d.length, r = mulberry32(341), tap = nz(n, 342, "bp", 1900, 1.2);
      for (const [f, amp, tk] of [[185, 1, 0.045], [410, 0.55, 0.026], [760, 0.3, 0.014], [1240, 0.15, 0.008]]) partial(d, f, amp, tk, r() * TAU);
      for (let i = 0; i < n; i++) d[i] += (far ? 0.25 : 0.8) * tap[i] * Math.exp(-i / sr / 0.003);
      if (far) biquad(d, "lp", 650);
      return finish(d, 0.0003);
    });
    if (!window.ScoreFx) throw new Error("剧情音没有载入：sfx.js 要在 score.js 之前");
    const fx = window.ScoreFx({ sr, get, hz, midi, mulberry32, biquad, keyPre: KEY_PRE, len: { ...WHOOSH_LEN, swell: BEAT } });
    const bank = { kick, snare, flip, clock, pluck, bell, glass, marimba, kalimba, knock, ...fx };
    SAMPLE_BANKS.set(sr, bank);
    return bank;
  }

  function impulse(ctx, sec, seed) {
    const sr = ctx.sampleRate, n = Math.floor(sec * sr), pre = Math.floor(0.011 * sr), b = ctx.createBuffer(2, n + pre, sr);
    for (let c = 0; c < 2; c++) {
      const r = mulberry32(seed + c * 7), d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = 0.85 - 0.7 * Math.min(1, t / sec);
        lp += k * ((r() * 2 - 1) - lp);
        d[pre + i] = lp * Math.exp(-t / (sec / 6.9));
      }
      for (let j = 0; j < 7; j++) d[pre + Math.floor((0.004 + r() * 0.04) * sr)] += (r() * 2 - 1) * 0.6;
    }
    return b;
  }
  function tapeCurve(S, H) {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = ((i / (n - 1)) * 2 - 1) * H; c[i] = (S * Math.tanh(x / S)) / H; }
    return c;
  }

  // 声部采样的自动化初值固定，所有并行段共享同一份干声与 duck，效果器仍连续预热。
  const VOICE_BANK = new Map(), PREPARED_VOICES = new WeakMap();
  const voiceFrames = (n, sr) => n.kind === "pad" ? Math.round(n.end * sr) - Math.round(n.t * sr) : Math.round(n.dur * sr);
  const voiceKey = (n, sr, name, det) => JSON.stringify(n.kind === "pad" ? [sr, n.kind, name, det, n.lp, voiceFrames(n, sr), n.last] : [sr, n.kind, n.m, voiceFrames(n, sr), n.att, n.rel]);
  async function prepareVoices(sr, workers, score) {
    let rates = PREPARED_VOICES.get(score);
    if (!rates) { rates = new Map(); PREPARED_VOICES.set(score, rates); }
    if (rates.has(sr)) return rates.get(sr);
    const jobs = new Map();
    for (const n of score.NOTES) {
      if (n.kind === "pad") for (const name of CHORD[n.chord]) for (const det of [-7, 7]) jobs.set(voiceKey(n, sr, name, det), { n, name, det });
      else if (n.kind === "bass") jobs.set(voiceKey(n, sr), { n });
    }
    const missing = [...jobs].filter(([key]) => !VOICE_BANK.has(key));
    let next = 0;
    const preparing = Promise.all(Array.from({ length: Math.min(workers, missing.length) }, async () => {
      while (next < missing.length) {
        const [key, { n, name, det }] = missing[next++], duration = voiceFrames(n, sr) / sr;
        const rel = n.kind === "pad" ? n.last ? 1.7 : 0.45 : n.rel;
        const tail = n.kind === "pad" ? rel * 1.6 : rel * 3 + 0.02;
        const pre = sr, frames = Math.ceil((duration + tail) * sr), ctx = new OfflineAudioContext(1, pre + frames, sr);
        const gain = ctx.createGain(); gain.gain.value = 0;
        gain.gain.setValueAtTime(0, 1); gain.gain.linearRampToValueAtTime(1, 1 + (n.kind === "pad" ? 0.28 : n.att));
        gain.gain.setValueAtTime(1, 1 + duration); gain.gain.setTargetAtTime(0, 1 + duration, rel / (n.kind === "pad" ? 4 : 3));
        gain.connect(ctx.destination);
        if (n.kind === "pad") {
          const oscillator = ctx.createOscillator(), filter = ctx.createBiquadFilter();
          oscillator.type = "sawtooth"; oscillator.frequency.value = hz(midi(name)); oscillator.detune.value = det;
          filter.type = "lowpass"; filter.Q.value = 0.3; filter.frequency.value = n.lp;
          filter.frequency.setValueAtTime(n.lp * 0.55, 1); filter.frequency.linearRampToValueAtTime(n.lp, 1.8);
          oscillator.connect(filter); filter.connect(gain); oscillator.start(1); oscillator.stop(1 + duration + tail);
        } else {
          const fundamental = ctx.createOscillator(), harmonic = ctx.createOscillator(), overtone = ctx.createGain();
          fundamental.frequency.value = hz(n.m); harmonic.frequency.value = 2 * hz(n.m); overtone.gain.value = 0.2;
          fundamental.connect(gain); harmonic.connect(overtone); overtone.connect(gain);
          for (const oscillator of [fundamental, harmonic]) {
            oscillator.detune.setValueAtTime(35, 1); oscillator.detune.setTargetAtTime(0, 1, 0.012);
            oscillator.start(1); oscillator.stop(1 + duration + tail);
          }
        }
        const rendered = await ctx.startRendering(), buffer = new AudioBuffer({ length: frames, sampleRate: sr, numberOfChannels: 1 });
        buffer.copyToChannel(rendered.getChannelData(0).subarray(pre), 0);
        VOICE_BANK.set(key, buffer);
      }
    })).then(() => {
      const length = Math.ceil((score.DURATION + TAIL) * sr), points = new Float32Array(Math.ceil(length / sr * DUCK_RATE) + 1), control = new Float32Array(length);
      for (let i = 0; i < points.length; i++) points[i] = duck(i / DUCK_RATE, score.DIPS);
      for (let i = 0; i < length; i++) { const x = i * DUCK_RATE / sr, k = Math.floor(x); control[i] = points[k] + (points[k + 1] - points[k]) * (x - k); }
      const pad = new AudioBuffer({ length, sampleRate: sr, numberOfChannels: 2 }), bass = new AudioBuffer({ length, sampleRate: sr, numberOfChannels: 1 }), verb = new AudioBuffer({ length, sampleRate: sr, numberOfChannels: 2 });
      const pL = pad.getChannelData(0), pR = pad.getChannelData(1), b = bass.getChannelData(0), vL = verb.getChannelData(0), vR = verb.getChannelData(1);
      for (const n of score.NOTES) {
        const from = Math.round(n.t * sr);
        if (n.kind === "pad") {
          const names = CHORD[n.chord], level = Math.fround(0.11 * n.level * Math.sqrt(4 / names.length));
          for (const name of names) for (const [det, pan] of [[-7, -0.5], [7, 0.5]]) {
            const data = VOICE_BANK.get(voiceKey(n, sr, name, det)).getChannelData(0), end = Math.min(data.length, length - from);
            const left = Math.fround(Math.cos((pan + 1) * Math.PI / 4)), right = Math.fround(Math.sin((pan + 1) * Math.PI / 4));
            for (let i = 0; i < end; i++) {
              const k = from + i, value = Math.fround(data[i] * level), l = Math.fround(value * left), r = Math.fround(value * right);
              pL[k] += l * control[k]; pR[k] += r * control[k]; vL[k] += l * n.verb; vR[k] += r * n.verb;
            }
          }
        } else if (n.kind === "bass") {
          const data = VOICE_BANK.get(voiceKey(n, sr)).getChannelData(0), end = Math.min(data.length, length - from), level = Math.fround(0.36 * n.v);
          for (let i = 0; i < end; i++) { const k = from + i; b[k] += data[i] * level * (0.35 + 0.65 * control[k]); }
        }
      }
      return { pad, bass, verb };
    });
    rates.set(sr, preparing);
    return preparing;
  }

  const CAT = { pad: "pad", bass: "bass", kick: "drums", snare: "drums", hat: "drums", clock: "drums", mel: "mel" };
  function schedule(ctx, opts, voices, score) {
    const offset = opts.offset || 0, END = ctx.length / ctx.sampleRate, S = samplesFor(ctx.sampleRate);
    const solo = opts.solo ? new Set([].concat(opts.solo)) : null;
    const on = (n) => !solo || solo.has(CAT[n.kind] || "fx");
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // DynamicsCompressor 的阈值分支会放大浮点误差，破坏重复渲染的一致性。
    const mix = gain(), sweep = filt("lowpass", 20000, 0.9), post = gain(0.4);
    sweep.frequency.setValueAtTime(20000, 0);
    for (const s of score.SWEEPS) {
      if (s.t2 <= offset) continue;
      if (s.t0 >= offset) sweep.frequency.setValueAtTime(20000, s.t0 - offset);
      else {
        const f = offset < s.t1 ? 20000 * Math.pow(s.f / 20000, (offset - s.t0) / (s.t1 - s.t0)) : s.f * Math.pow(20000 / s.f, (offset - s.t1) / (s.t2 - s.t1));
        sweep.frequency.setValueAtTime(f, 0);
      }
      if (s.t1 > offset) sweep.frequency.exponentialRampToValueAtTime(s.f, s.t1 - offset);
      sweep.frequency.exponentialRampToValueAtTime(20000, s.t2 - offset);
    }
    mix.connect(sweep); sweep.connect(post);
    if (opts.stage === "pre") post.connect(ctx.destination);
    else {
      const H = 2, tin = gain(1 / H), tape = ctx.createWaveShaper(), tout = gain(H), hp = filt("highpass", 28), lp = filt("lowpass", 15500, 0.5);
      tape.curve = tapeCurve(0.9, H); tape.oversample = "4x";
      post.connect(tin); tin.connect(tape); tape.connect(tout); tout.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
    }
    const bus = { drums: gain(), fx: gain(), mel: gain(), fxPost: gain(), melPost: gain() };
    for (const k of ["drums", "fx", "mel"]) bus[k].connect(mix);
    bus.fxPost.connect(post); bus.melPost.connect(post);
    bus.pad = gain(); bus.pad.connect(mix);
    bus.bass = gain(); bus.bass.connect(mix);

    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 1.7, 2026);
    const verbRet = gain(0.5); verb.connect(verbRet); verbRet.connect(mix);
    const dIn = gain(), dL = ctx.createDelay(2), dR = ctx.createDelay(2), dFb = gain(0.36), dHp = filt("highpass", 280), dLp = filt("lowpass", 2600), merge = ctx.createChannelMerger(2), dRet = gain(0.3);
    dL.delayTime.value = dR.delayTime.value = BEAT * 0.75;
    dIn.connect(dHp); dHp.connect(dLp); dLp.connect(dL); dL.connect(dR); dR.connect(dFb); dFb.connect(dHp);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(dRet); dRet.connect(mix);
    for (const node of [mix, sweep, post, ...Object.values(bus), verb, verbRet, dIn, dL, dR, dFb, dHp, dLp, dRet]) {
      node.channelCount = 2; node.channelCountMode = "explicit";
    }
    const source = (buffer, to) => {
      const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(to);
      node.start(0, (Math.round(offset * ctx.sampleRate) + 1e-6) / ctx.sampleRate);
    };
    if (voices && (!solo || solo.has("pad"))) { source(voices.pad, bus.pad); source(voices.verb, verb); }
    if (voices && (!solo || solo.has("bass"))) source(voices.bass, bus.bass);
    const retired = [];
    // 双精度的减法可能把整帧移到前一帧；统一量化并留极小余量，避免并行段的音色相位错一帧。
    const localTime = (t) => (Math.round(t * ctx.sampleRate) - Math.round(offset * ctx.sampleRate) + 1e-6) / ctx.sampleRate;
    const notes = score.NOTES.filter((n) => n.t >= offset && n.t < offset + END).map((n) => ({ ...n, t: localTime(n.t), ...(n.end == null ? {} : { end: localTime(n.end) }), ...(n.dur == null ? {} : { dur: Math.round(n.dur * ctx.sampleRate) / ctx.sampleRate }) }));
    const retire = (end, nodes) => retired.push({ end: end + 1, nodes: nodes.filter(Boolean) });
    const send = (node, to, amt) => { if (amt > 0) { const s = gain(amt); node.connect(s); s.connect(to); return s; } };

    function play(buf, t, { g = 1, pan = 0, panTo = null, panDur = 0.5, to = bus.fx, verbAmt = 0, delayAmt = 0, pre = 0 } = {}) {
      const t0 = Math.max(0, t - pre), src = ctx.createBufferSource(), a = gain(g), p = pan == null ? a : ctx.createStereoPanner();
      if (!buf) throw new Error("Missing voice sample");
      src.buffer = buf;
      if (p !== a) {
        p.pan.setValueAtTime(clamp(pan, -1, 1), t0);
        if (panTo != null) p.pan.linearRampToValueAtTime(clamp(panTo, -1, 1), t + panDur);
        a.connect(p);
      }
      src.connect(a); p.connect(to);
      const sends = [send(p, verb, verbAmt), send(p, dIn, delayAmt)];
      src.start(t0);
      retire(t0 + buf.duration, [src, a, p, ...sends]);
    }
    function pad(n) {
      const names = CHORD[n.chord], lvl = 0.11 * n.level * Math.sqrt(4 / names.length), att = 0.28, rel = n.last ? 1.7 : 0.45;
      for (const name of names) for (const [det, pan] of [[-7, -0.5], [7, 0.5]]) {
        const o = ctx.createOscillator(), f = filt("lowpass", n.lp, 0.3), a = gain(0), p = ctx.createStereoPanner();
        o.type = "sawtooth"; o.frequency.value = hz(midi(name)); o.detune.value = det;
        f.frequency.setValueAtTime(n.lp * 0.55, n.t); f.frequency.linearRampToValueAtTime(n.lp, n.t + 0.8);
        a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(lvl, n.t + att);
        a.gain.setValueAtTime(lvl, n.end); a.gain.setTargetAtTime(0, n.end, rel / 4);
        p.pan.value = pan;
        o.connect(f); f.connect(a); a.connect(p); p.connect(bus.pad); const sending = send(p, verb, n.verb);
        const end = n.end + rel * 1.6;
        o.start(n.t); o.stop(end); retire(end, [o, f, a, p, sending]);
      }
    }
    function bass(n) {
      const f = hz(n.m), vol = 0.36 * n.v, end = n.t + n.dur, a = gain(0), h = gain(0.2);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.frequency.value = f; o2.frequency.value = 2 * f;
      for (const x of [o, o2]) { x.detune.setValueAtTime(35, n.t); x.detune.setTargetAtTime(0, n.t, 0.012); }
      a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(vol, n.t + n.att);
      a.gain.setValueAtTime(vol, end); a.gain.setTargetAtTime(0, end, n.rel / 3);
      o.connect(a); o2.connect(h); h.connect(a); a.connect(bus.bass);
      const stopped = end + n.rel * 3 + 0.02;
      for (const x of [o, o2]) { x.start(n.t); x.stop(stopped); }
      retire(stopped, [o, o2, a, h]);
    }
    const KICK_G = { tight: 0.9, light: 0.65, lub: 0.85, dub: 0.85 };
    const LAMP_PAN = [-0.4, 0, 0.4];
    // 这几件的电平按隔离渲染的 LUFS-M（400 ms 窗）对到同一位置上别的剧情音；拇指琴对到马林巴弹同一段主题；knock 频谱偏低，同样响度下比 tick 听着轻，所以高约 3 dB。改音色要重新对
    // sfx.js 的剧情音每件都按 LUFS-M 对到它替换掉的旧音色；大印章和 arrive / boom 的大鼓另压了 1–2 dB：整片母带按峰值归一，峰值就落在它们身上，再响整片都跟着变小
    const GLASS_G = 0.62, MARIMBA_G = 0.42, KALIMBA_G = 0.42, KNOCK_G = 0.092, WHIP_G = 1.18, MORSE_G = 0.21, GATE_G = 1.17, OFF_G = 0.269, PING_G = [0.588, 0.175], CLEAR_G = 0.268, HOP_G = 0.609;
    const TUBE_PAN = [-0.7, -0.25, 0.25, 0.7], TUBE_G = [1.11, 0.99, 0.795, 1.22];

    let next = 0, controlAt = 0;
    return (until = Infinity) => {
      if (!voices) while (controlAt < Math.min(until, END)) {
        const end = Math.min(controlAt + RENDER_BATCH_SECONDS, END), points = Math.ceil((end - controlAt) * DUCK_RATE) + 1;
        const cPad = new Float32Array(points), cBass = new Float32Array(points);
        for (let i = 0; i < points; i++) {
          const value = duck(offset + controlAt + i / (points - 1) * (end - controlAt), score.DIPS);
          cPad[i] = value; cBass[i] = 0.35 + 0.65 * value;
        }
        bus.pad.gain.setValueCurveAtTime(cPad, controlAt, end - controlAt);
        bus.bass.gain.setValueCurveAtTime(cBass, controlAt, end - controlAt);
        controlAt = end;
      }
      for (let i = retired.length - 1; i >= 0; i--) if (retired[i].end <= ctx.currentTime) {
        for (const node of retired[i].nodes) node.disconnect();
        retired.splice(i, 1);
      }
      while (next < notes.length && notes[next].t <= until) {
        const index = next++, n = notes[index];
        if (!on(n)) continue;
        const t = n.t;
        switch (n.kind) {
          case "pad": if (!voices) pad(n); break;
          case "bass": if (!voices) bass(n); break;
          case "kick": play(S.kick(n.type), t, { g: KICK_G[n.type] * n.v, to: bus.drums }); break;
          case "snare": play(S.snare(n.type), t, { g: (n.type === "thud" ? 0.34 : 0.3) * n.v, pan: 0.05, to: bus.drums, verbAmt: n.verb ?? 0.12 }); break;
          case "hat":
            if (n.type === "type") play(S.type(n.variant), t, { g: 0.26 * n.v * n.vol, pan: 0.12 + 0.08 * n.variant, to: bus.drums, verbAmt: 0.05 });
            else play(S.flip(n.variant % 3), t, { g: 0.24 * n.v * n.vol, pan: -0.25, to: bus.drums, verbAmt: 0.15 });
            break;
          case "clock":
            if (n.type === "knock" || n.type === "knockFar") play(S.knock(n.type === "knockFar"), t, { g: KNOCK_G * n.v * n.vol, pan: 0.2, to: bus.drums, verbAmt: n.type === "knockFar" ? 0.25 : 0.1 });
            else play(S.clock(n.type), t, { g: 0.11 * n.v * n.vol, pan: n.type === "tick" ? 0.35 : -0.35, to: bus.drums, verbAmt: 0.08 });
            break;
          case "mel": {
            const to = n.post ? bus.melPost : bus.mel;
            if (n.inst === "bell" || n.inst === "bell2")
              play(S.bell(n.m, n.tone || "bright"), t, { g: 0.36 * n.v, pan: n.inst === "bell" ? 0.1 : -0.25, to, verbAmt: 0.4, delayAmt: n.inst === "bell" ? 0.26 : 0.15 });
            else if (n.inst === "glass") play(S.glass(n.m), t, { g: GLASS_G * n.v, pan: 0, to, verbAmt: 0.35, delayAmt: 0.22 });
            else if (n.inst === "marimba") play(S.marimba(n.m), t, { g: MARIMBA_G * n.v, pan: -0.1, to, verbAmt: 0.3, delayAmt: 0.12 });
            else if (n.inst === "kalimba") play(S.kalimba(n.m), t, { g: KALIMBA_G * n.v, pan: n.arp ? n.pan : 0.1, to, verbAmt: 0.3, delayAmt: 0.18 });
            else
              play(S.pluck(n.m, n.inst), t, { g: (n.theme ? 0.34 : 0.3) * n.v, pan: n.pan ?? 0, to, verbAmt: n.inst === "pluck" ? 0.22 : 0.28, delayAmt: n.theme ? 0.32 : n.inst === "pluckMute" ? 0.3 : 0.18 });
            break;
          }
          case "key": play(S.key(n.take), t, { g: 1.27 * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.05, pre: KEY_PRE }); break;
          case "stamp": play(S.stamp(n.size), t, { g: n.size === "big" ? 1.25 : 1.04, verbAmt: n.size === "big" ? 0.18 : 0.1 }); break;
          case "tick": play(S.ding(n.m), t, { g: 0.444, pan: -0.35 + 0.14 * n.i, verbAmt: 0.2, delayAmt: 0.06 }); break;
          case "lamp": play(S.lamp(n.m, n.late), t, { g: n.late ? 0.17 : 0.65, pan: n.late ? 0.55 : LAMP_PAN[n.i], verbAmt: n.late ? 0.45 : 0.28, delayAmt: 0.12 }); break;
          case "whoosh":
            if (n.tube === "fork") { play(S.fork(0), t, { g: 0.838, panTo: -0.8, panDur: 0.6, verbAmt: 0.15 }); play(S.fork(1), t, { g: 0.838, panTo: 0.8, panDur: 0.6, verbAmt: 0.15 }); }
            else if (n.tube === "down") play(S.down(), t, { g: 0.923, to: bus.fxPost, verbAmt: 0.2 });
            else if (n.tube === "whip") play(S.whip(), t, { g: WHIP_G * (n.v ?? 1), pan: n.pan ?? 0.5, panTo: n.panTo ?? -0.5, panDur: WHOOSH_LEN.whip, verbAmt: 0.12 });
            else play(S.whoosh(n.tube), t, { g: TUBE_G[n.tube], panTo: TUBE_PAN[n.tube], panDur: 0.6, verbAmt: 0.15 });
            break;
          case "accent":
            if (n.what === "arrive") play(S.boom(), t, { g: 0.85, to: bus.fxPost });
            else if (n.what === "slip") play(S.slip(n.take), t, { g: 0.977, pan: 0.2, verbAmt: 0.06 });
            else if (n.what === "broadcast") play(S.broadcast(), t, { g: 0.235, verbAmt: 0.4, delayAmt: 0.2 });
            else if (n.what === "flip") play(S.flipHit(), t, { g: 0.586, verbAmt: 0.3, delayAmt: 0.15 });
            break;
          case "swell": play(S.swell(), t, { g: 0.214, verbAmt: 0.3 }); break;
          case "boom": play(S.boom(), t, { g: 0.85 }); break;
          case "morse": play(S.morse(n.m, Math.round((n.len ?? 0.35) * BEAT * 1000) / 1000), t, { g: MORSE_G * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.08 }); break;
          case "gate": play(S.gate(), t, { g: GATE_G, pan: n.pan ?? 0.1, verbAmt: 0.12 }); break;
          case "off": play(S.off(n.m), t, { g: OFF_G, pan: n.pan ?? 0.3, verbAmt: 0.3, delayAmt: 0.1 }); break;
          case "ping": play(S.ping(n.m, n.late), t, { g: n.late ? PING_G[1] : PING_G[0], pan: n.pan ?? 0, verbAmt: n.late ? 0.4 : 0.2, delayAmt: 0.06 }); break;
          case "clear": play(S.clear(), t, { g: CLEAR_G, verbAmt: 0.08 }); break;
          case "hop": play(S.hop(n.m, n.take), t, { g: HOP_G * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.08 }); break;
        }
      }
    };
  }

  function kWeighted(x, sr) {
    let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196, a0 = 1 + K / Q + K * K;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const s1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
    const s2 = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    const y = Float64Array.from(x);
    for (const [b0, b1, b2, a1, a2] of [s1, s2]) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
    }
    return y;
  }
  function loudness(L, R, sr) {
    const a = kWeighted(L, sr), b = kWeighted(R, sr), n = a.length, cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + a[i] * a[i] + b[i] * b[i];
    const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), z = [];
    for (let s = 0; s + blk <= n; s += hop) z.push((cum[s + blk] - cum[s]) / blk);
    const lk = (v) => -0.691 + 10 * Math.log10(Math.max(v, 1e-12)), mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const g1 = z.filter((v) => lk(v) > -70);
    if (!g1.length) return -70;
    const rel = lk(mean(g1)) - 10, g2 = g1.filter((v) => lk(v) > rel);
    return lk(mean(g2));
  }
  function limit(L, R, sr, g, ceil) {
    const n = L.length, la = Math.round(0.005 * sr), rel = 1 - Math.exp(-1 / (0.08 * sr));
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g; need[i] = p > ceil ? ceil / p : 1; }
    const val = (k) => (k < n ? need[k] : 1), q = new Int32Array(n + la), mn = new Float32Array(n);
    let h = 0, tl = 0;
    for (let j = 0; j < n + la; j++) {
      const v = val(j);
      while (tl > h && val(q[tl - 1]) >= v) tl--;
      q[tl++] = j;
      while (q[h] < j - la) h++;
      if (j >= la) mn[j - la] = val(q[h]);
    }
    const oL = new Float32Array(n), oR = new Float32Array(n);
    // mn 在 [i-la, i] 上的平均（开头之前按 1 补）：每个 k 的窗口 [k, k+la] 都盖住 i，所以平均值 ≤ need[i]，峰值处一定不过线
    let sum = la + 1, gOut = 1;
    for (let i = 0; i < n; i++) {
      sum += mn[i] - (i > la ? mn[i - la - 1] : 1);
      const s = sum / (la + 1);
      gOut = s < gOut ? s : gOut + (s - gOut) * rel;
      const k = g * gOut;
      oL[i] = clamp(L[i] * k, -ceil, ceil); oR[i] = clamp(R[i] * k, -ceil, ceil);
    }
    return [oL, oR];
  }
  function master(buf) {
    const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(1), ceil = Math.pow(10, CEIL_DB / 20);
    let out;
    if (TARGET_LUFS == null) {
      let pk = 0;
      for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      // 峰值归一已保证不超过上限，无需分配整片的 lookahead 限幅工作数组。
      const gain = pk > 0 ? ceil / pk : 1;
      for (const channel of [L, R]) for (let i = 0; i < channel.length; i++) channel[i] = clamp(channel[i] * gain, -ceil, ceil);
      out = [L, R];
    } else {
      let g = Math.pow(10, (TARGET_LUFS - loudness(L, R, sr)) / 20);
      out = limit(L, R, sr, g, ceil);
      g *= Math.pow(10, (TARGET_LUFS - loudness(out[0], out[1], sr)) / 20);
      out = limit(L, R, sr, g, ceil);
    }
    const f = Math.round(0.25 * sr);
    for (const d of out) for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - (i + 1) / f;
    buf.copyToChannel(out[0], 0); buf.copyToChannel(out[1], 1);
    return buf;
  }

  async function render(opts = {}, score = B) {
    if (!score) throw new Error("先调 Score.build(plan)");
    const sr = opts.sampleRate || SAMPLE_RATE;
    const workers = opts.workers ?? 4;
    if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error("workers must be an integer from 1 to 16");
    const voices = (opts.precomputeVoices || opts.offset) ? await prepareVoices(sr, workers, score) : null;
    const ctx = new OfflineAudioContext(2, opts.frames ?? Math.ceil((score.DURATION + TAIL) * sr), sr);
    const enqueue = schedule(ctx, opts, voices, score), batchSeconds = opts.batchSeconds ?? RENDER_BATCH_SECONDS;
    if (batchSeconds > 0) {
      enqueue(batchSeconds + KEY_PRE);
      const resumptions = [];
      for (let t = batchSeconds; t < ctx.length / sr; t += batchSeconds) {
        resumptions.push(ctx.suspend(t).then(() => {
          enqueue(t + batchSeconds + KEY_PRE);
          return ctx.resume();
        }));
      }
      const rendered = ctx.startRendering();
      const [buf] = await Promise.all([rendered, ...resumptions]);
      return opts.raw || opts.solo || opts.stage ? buf : master(buf);
    }
    enqueue();
    const buf = await ctx.startRendering();
    return opts.raw || opts.solo || opts.stage ? buf : master(buf);
  }

  async function renderParallel(opts = {}) {
    const score = B;
    if (!score) throw new Error("先调 Score.build(plan)");
    const sr = opts.sampleRate || SAMPLE_RATE, length = Math.ceil((score.DURATION + TAIL) * sr), workers = opts.workers ?? 8;
    if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error("workers must be an integer from 1 to 16");
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const controlFrames = sr / gcd(sr, DUCK_RATE), alignment = RENDER_QUANTUM_FRAMES * controlFrames / gcd(RENDER_QUANTUM_FRAMES, controlFrames);
    await prepareVoices(sr, workers, score);
    const out = new AudioBuffer({ length, sampleRate: sr, numberOfChannels: 2 });
    // 预热包含音符尾音、混响与反馈延迟；丢弃预热区，整片拼好后只做一次母带。
    await Promise.all(Array.from({ length: workers }, async (_, i) => {
      const from = Math.floor(length * i / workers / alignment) * alignment;
      const to = i + 1 === workers ? length : Math.floor(length * (i + 1) / workers / alignment) * alignment;
      const start = Math.max(0, from - Math.ceil(RENDER_WARMUP_SECONDS * sr / alignment) * alignment);
      const buf = await render({ ...opts, precomputeVoices: true, raw: true, offset: start / sr, frames: to - start }, score);
      for (let c = 0; c < 2; c++) out.copyToChannel(buf.getChannelData(c).subarray(from - start, to - start), c, from);
    }));
    return opts.raw || opts.solo || opts.stage ? out : master(out);
  }

  window.Score = {
    BPM, BAR, BEAT, tail: TAIL, sampleRate: SAMPLE_RATE,
    build, render, renderParallel, env, at, loudness,
    theme: THEME.map(([beat, dur, note]) => ({ beat, dur, note })),
  };
})();
