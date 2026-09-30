// 配乐 v2：108 BPM，4/4，全片只有一首。按章拼装：每章一份乐谱写在 music/chNN.js（章内小节，写法见 CONVENTIONS.md「配乐」），
// Score.build(plan) 按 plan.js 的章节顺序和小节数把各章接成一张平铺的音符表 NOTES；还没写谱的章用一段轻 pad + 每拍一声滴答占位。
// 一种风格：温暖的极简电子。侧链呼吸的 pad、FM 铃和拨弦、圆润的次低音、干净的鼓组、一点磁带饱和、
// 种子噪声现生成冲激响应的短混响。全部在浏览器里合成：没有采样文件、不联网，噪声一律来自种子 PRNG；同一份乐谱两次渲染只差在浮点末位（远低于 16 位量化噪声）。
//
// 同一张 NOTES 既排进 OfflineAudioContext 出声，也导出 Score.events / Score.env 给画面用，所以声音和画面不可能对不上。
// 各章共用的词汇都在这个文件：和弦表 CHORD、鼓型记法、贝斯型 BASS、琶音型 ARP、信封主题 THEME、剧情音（各章 story 的 kind）。
// 章节要的新和弦写在自己乐谱的 chords 里，build() 并进 CHORD；新音色、新剧情音只能改这个文件。
// 信封主题（全片母题）：A4 D5 F5 E5——三步跳上去、再落一步回来；节奏是 3+3+2 个十六分，E5 落在第三拍、延长两拍。
(function () {
  "use strict";
  const BPM = 108, BEAT = 60 / BPM, BAR = BEAT * 4;
  const TAIL = 2, SAMPLE_RATE = 48000;
  // 母带：峰值拉到 -1 dBFS（这份配乐的峰值响度比约 13 dB，整体响度落在 -14 LUFS 左右）。
  // 想按响度走就把 TARGET_LUFS 设成数字（比如 -16），峰值会落在 -3 dBFS 上下，限幅器兜底
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

  // =====================================================================
  // 共享词汇（各章乐谱里按名字引用）
  // =====================================================================

  // 和弦：pad 的排法（中音区、开放排列，第一个音是根音）；次低音取根音，折到 G1–F#2
  const CHORD = {
    Dm9: ["D3", "A3", "C4", "E4", "F4"],
    Dmadd9: ["D3", "A3", "E4", "F4"],
    G6: ["G3", "B3", "D4", "E4"], // 多利亚的 IV：B 还原
    Fmaj7: ["F3", "A3", "C4", "E4"],
    C69: ["C3", "G3", "D4", "E4", "A4"],
    Bbmaj7: ["Bb2", "F3", "A3", "D4"],
    Bbmaj7s11: ["Bb2", "F3", "A3", "D4", "E4"], // 利底亚的 #11，黑屋子里那点神秘
    Gm9: ["G2", "F3", "Bb3", "D4", "A4"],
    A7sus4: ["A2", "E3", "G3", "D4"],
    A7: ["A2", "E3", "G3", "C#4"],
    Em7b5: ["E3", "G3", "Bb3", "D4"],
  };
  const rootOf = (name) => { let m = 24 + (midi(CHORD[name][0]) % 12); while (m < 31) m += 12; return m; };

  // 鼓型：16 格一小节（一格一个十六分），X 重、x 中、o 轻、. 空；数组表示段落里逐小节轮换，null 表示这一小节不打
  const VEL = { X: 1, x: 0.75, o: 0.45 };
  // 贝斯型：[拍位, 时值(拍), 离根音的半音, 力度]；"hold" 是每个和弦段一个长音（按和弦切）
  const BASS = {
    light: [[0, 1.75, 0, 0.8], [2.5, 1.25, 0, 0.7]],
    groove: [[0, 1.25, 0, 1], [1.5, 0.5, 0, 0.7], [2.25, 0.5, 12, 0.55], [3, 0.75, 7, 0.8]],
    slam: [[2, 0.75, 0, 0.9], [3, 0.75, 7, 0.8]], // 大章：前两拍全场收住
    half: [[0, 2, 0, 0.9]], // 让出后两拍给下坠
    offbeat: [[0.5, 0.4, 0, 0.95], [1.5, 0.4, 0, 0.8], [2.5, 0.4, 0, 0.95], [3.5, 0.4, 12, 0.6]], // 反拍贝斯，配每拍一下的底鼓
    reveal: [[0, 0.4, 0, 1], [0.5, 0.4, 0, 0.85], [1.5, 0.4, 0, 0.85], [2.5, 0.4, 0, 0.95], [3, 0.25, 12, 0.5], [3.5, 0.4, 7, 0.75]],
    end: [[0, 4, 0, 0.7]],
  };
  // 琶音型：[拍位, 取和弦音的序号]；332 就是主题的 3+3+2 节奏
  const ARP = {
    sparse: [[0, 0], [1.5, 2], [2.5, 1]],
    332: [[0, 0], [0.75, 1], [1.5, 2], [2, 3], [2.75, 2], [3.5, 1]],
    queue: [[0, 0], [0.75, 2], [1.5, 1], [2.5, 3], [3.25, 2]],
  };
  // 信封主题：[拍位, 时值, 音]
  const THEME = [[0, 0.75, "A4"], [0.75, 0.75, "D5"], [1.5, 0.5, "F5"], [2, 2, "E5"]];
  const withNotes = (names) => THEME.map(([b, d], i) => [b, d, names[i]]);
  // 旋律条目：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
  const phrase = (bar, notes, inst, v, theme = false) => notes.map(([b, d, n]) => [bar, b, d, n, inst, v, theme]);
  const KEY_PRE = 0.06; // 钥匙：插进去的沙沙声在拍前，转动那一下「咔」落在拍上
  const WHOOSH_LEN = { tube: 0.95, fork: 1.25, down: 2 * BEAT, whip: 0.62 }; // whip：甩镜头的风声，中点最响
  // 交给各章 score() 的工具
  const HELP = { THEME, withNotes, phrase, midi, CHORD, BASS, ARP, BAR, BEAT };

  // 还没写谱的章：一个 Dmadd9 的轻 pad，每拍一声钟摆滴答（小节头重一点），章作者对拍用
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
  // 章 id 当默认种子（章作者不用管；想换一种随机就在乐谱里写 seed）
  const seedOf = (id) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h | 0; };

  // =====================================================================
  // 拼装：plan（章节顺序和小节数）+ 各章乐谱 → 平铺的音符表（出声和事件共用）
  // =====================================================================
  function steps(p, i) {
    const s = Array.isArray(p) ? p[i % p.length] : p, out = [];
    if (!s) return out;
    for (let k = 0; k < 16; k++) if (VEL[s[k]]) out.push([k / 4, VEL[s[k]], k]);
    return out;
  }
  // 和弦里落在 lo..lo+span 的音，由低到高
  function arpTones(chord, lo, span = 15) {
    const pcs = new Set(CHORD[chord].map((n) => midi(n) % 12)), out = [];
    for (let m = lo; m <= lo + span; m++) if (pcs.has(m % 12)) out.push(m);
    return out;
  }

  let B = null; // build() 的结果：全片的音符表、段落、事件……
  function build(plan) {
    const reg = new Map();
    for (const p of window.SCORE_PARTS || []) {
      if (reg.has(p.id)) console.error(`配乐：${p.id} 注册了两次，用后一次`);
      reg.set(p.id, p);
    }
    // 只查整张章节表：?only= 只拼几章时，其余章的乐谱本来就不拼
    for (const id of reg.keys()) if (!(window.PLAN || plan).some((p) => p.id === id)) console.warn(`配乐：${id} 不在 plan.js 里，不会拼进去`);
    // 章节自带的和弦（part.chords，写法同 CHORD）并进和弦表：章节作者加和弦不用改这个文件。名字全片唯一，同名不同音报错、用先登记的
    for (const p of reg.values()) for (const [name, notes] of Object.entries(p.chords || {})) {
      if (!CHORD[name]) CHORD[name] = notes;
      else if (JSON.stringify(CHORD[name]) !== JSON.stringify(notes)) console.error(`配乐 ${p.id}：和弦 ${name} 已经有了、音不一样，换个名字`);
    }
    // 各章的乐谱展开成绝对小节
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
    // 和弦段：pad 按段发声，末段一直响到片尾（再在尾巴里放掉）
    const SEGMENTS = [];
    HARM.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([chord, beat]) => SEGMENTS.push({ bar, beat, t: at(bar, beat), chord })));
    SEGMENTS.forEach((s, i) => (s.end = i + 1 < SEGMENTS.length ? SEGMENTS[i + 1].t : DURATION));
    const SECTIONS = chapters.flatMap((c) => c.secs);
    const SEC_OF_BAR = [];
    SECTIONS.forEach((s) => { for (let b = s.from; b <= s.to; b++) SEC_OF_BAR[b] = s; });
    const sectionOf = (bar) => SEC_OF_BAR[clamp(bar, 0, BARS - 1)];

    // 展开。推入顺序（pad → 各章段落 → 各章旋律 → 各章剧情）和拆分前一样，排序后同一时刻的先后也就一样
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
    // 母线低通扫频（章节交接的下坠）：[开始关, 关到最低, 打开]，章内小节可以写到下一章去
    const SWEEPS = [];
    for (const c of chapters) for (const s of c.d.sweeps || []) SWEEPS.push({ t0: at(c.bar0 + s.at[0], s.at[1] || 0), t1: at(c.bar0 + s.down[0], s.down[1] || 0), t2: at(c.bar0 + s.up[0], s.up[1] || 0), f: s.f });

    // 侧链：每个底鼓、每记印章把 pad / 贝斯压下去再放回来，没有鼓的地方用看不见的「幽灵底鼓」让 pad 自己呼吸
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
      // 同一刻的重复（和声里同时落下的几个音）只留力度最大的那个
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

  // =====================================================================
  // 事件表与包络（画面用；和出声用的是同一张 NOTES）
  // =====================================================================
  const EVENT_KEYS = ["kick", "snare", "hat", "tick", "stamp", "whoosh", "lamp", "key", "bell", "accent", "clock"];
  const DIP_ATT = 0.008;
  function lastIdx(list, t, key = "t") { let lo = 0, hi = list.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][key] <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  // 1 = 全开，越小压得越深
  function duck(t) {
    let g = 1;
    for (let i = lastIdx(B.DIPS, t); i >= 0; i--) {
      const d = B.DIPS[i], x = t - d.t;
      if (x > 2) break;
      const s = x < DIP_ATT ? x / DIP_ATT : Math.exp(-(x - DIP_ATT) / d.tau);
      g *= 1 - d.depth * s;
    }
    return g;
  }
  const bassDuck = (t) => 1 - 0.65 * (1 - duck(t));

  // 各类打击的衰减时间常数（秒）
  const DECAY = { kick: 0.12, snare: 0.14, hat: 0.05, clock: 0.035, tick: 0.22, stamp: 0.3, lamp: 0.45, key: 0.12, bell: 0.6, accent: 0.5 };
  function padLevel(t) {
    const P = B.PADS, i = lastIdx(P, t);
    if (i < 0) return 0;
    const p = P[i], x = t - p.t, a = Math.min(1, x / 0.28);
    // 和上一段交叉淡化；最后一段在尾巴里放掉
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
      case "duck": return duck(t); // 侧链本身：1 全开，越小压得越深
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
  // =====================================================================
  // 音色：在 JS 里把每种打击、每个音高的波形算出来（按采样率缓存），再按乐谱摆放
  // =====================================================================
  const SAMPLE_BANKS = new Map();
  function samplesFor(sr) {
    if (SAMPLE_BANKS.has(sr)) return SAMPLE_BANKS.get(sr);
    const cache = new Map();
    const arr = (sec) => new Float32Array(Math.max(1, Math.round(sec * sr)));
    function norm(d, peak = 1) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; }
    // 双二阶滤波（RBJ）：lp / hp / bp（带通峰值 0 dB）
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
    // 截止频率随时间走的带通（TPT 状态变量滤波器），做呼啸、下坠、纸滑过去的扫频
    function sweepBp(d, fOf, q) {
      const k = 1 / q; let s1 = 0, s2 = 0;
      for (let i = 0; i < d.length; i++) {
        const g = Math.tan(Math.PI * clamp(fOf(i / sr), 20, sr * 0.45) / sr), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const v3 = d[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        d[i] = v1 * k;
      }
      return norm(d);
    }
    // 种子白噪声，可选滤一道，按峰值归一：下面各层的系数就是各层的峰值
    function nz(n, seed, type, f, q) { const r = mulberry32(seed), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; if (type) biquad(d, type, f, q); return norm(d); }
    // 一个衰减的正弦分音叠进 d（递推算正弦，快）
    function partial(d, f, amp, tau, ph) {
      if (f >= sr * 0.45) return;
      const w = TAU * f / sr, c2 = 2 * Math.cos(w), k = Math.exp(-1 / (tau * sr));
      let s1 = Math.sin(ph - w), s2 = Math.sin(ph - 2 * w), e = amp;
      for (let i = 0; i < d.length && e > 1e-5; i++) { const s = c2 * s1 - s2; s2 = s1; s1 = s; d[i] += s * e; e *= k; }
    }
    // 起音一点点斜坡、结尾 4 ms 淡出、峰值归一
    function finish(d, att = 0.0005) {
      const a = Math.max(1, Math.round(att * sr)), f = Math.min(d.length, Math.round(0.004 * sr));
      for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
      for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - i / f;
      return norm(d);
    }
    const get = (key, fn) => {
      if (!cache.has(key)) { const d = fn(), b = new AudioBuffer({ length: d.length, sampleRate: sr, numberOfChannels: 1 }); b.copyToChannel(d, 0); cache.set(key, b); }
      return cache.get(key);
    };

    // 底鼓：正弦扫频 + 一点点击声，轻微饱和；lub / dub 是心跳，boom 是落地和终和弦下面那一声
    const KICK = {
      tight: { f0: 160, f1: 47, pt: 0.03, dec: 0.23, att: 0.0008, click: 0.35, len: 0.55 },
      light: { f0: 140, f1: 50, pt: 0.028, dec: 0.15, att: 0.001, click: 0.2, len: 0.4 },
      lub: { f0: 100, f1: 44, pt: 0.05, dec: 0.2, att: 0.004, click: 0, len: 0.55 },
      dub: { f0: 118, f1: 50, pt: 0.04, dec: 0.13, att: 0.003, click: 0, len: 0.4 },
      boom: { f0: 78, f1: 37, pt: 0.16, dec: 0.85, att: 0.006, click: 0, len: 2.8 },
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
    // 军鼓。thud：橡皮章那种闷拍 + 纸面一拍；rim：账房里的轻拍，木头边加一点掌声尾巴
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
    // 打字机：字锤敲纸的「嗒」+ 纸面一点沙沙的余韵 + 字杆的金属余音 + 机身一点「咚」；四个变体轮着用
    const type = (v) => get("ty:" + v, () => {
      const d = arr(0.09), n = d.length, a = nz(n, 31 + v, "bp", 3300 + 350 * v, 1.4), air = nz(n, 35 + v, "hp", 6500);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.9 * a[i] * Math.exp(-t / 0.0045) + 0.22 * air[i] * Math.exp(-t / 0.018) + 0.3 * Math.sin(TAU * (2750 + 170 * v) * t) * Math.exp(-t / 0.011)
          + 0.16 * Math.sin(TAU * (4400 + 90 * v) * t) * Math.exp(-t / 0.007) + 0.35 * Math.sin(TAU * 160 * t) * Math.exp(-t / 0.012);
      }
      return finish(d, 0.0002);
    });
    // 翻账页：几下很快的纸面抖动 + 一口气
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
    // 钟摆：tick 高、tock 低，木头味
    const clock = (kind) => get("cl:" + kind, () => {
      const f = kind === "tick" ? 3100 : 2300, d = arr(0.05), n = d.length, a = nz(n, 51, "hp", 3000);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.6 * Math.sin(TAU * f * t) * Math.exp(-t / 0.005) + 0.4 * Math.sin(TAU * 0.37 * f * t) * Math.exp(-t / 0.009) + 0.4 * a[i] * Math.exp(-t / 0.0015);
      }
      return finish(d, 0.0002);
    });
    // 印章：低频闷响 + 木头一磕 + 纸面一拍 + 印泥的细碎声；big 再加桌上小东西跟着一震
    const stamp = (size) => get("st:" + size, () => {
      const big = size === "big", d = arr(big ? 1.1 : 0.7), n = d.length, r = mulberry32(big ? 61 : 62);
      const slap = nz(n, 63, "bp", 1300, 0.9), crk = nz(n, 64, "hp", 5000), rat = nz(n, 65, "bp", 3200, 1.5);
      const f0 = big ? 105 : 115, f1 = big ? 36 : 44, pt = big ? 0.07 : 0.05, dec = big ? 0.3 : 0.14;
      const rattle = big ? [0, 1, 2, 3, 4].map(() => 0.05 + r() * 0.2) : [];
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / pt)) / sr;
        let y = Math.sin(ph) * Math.exp(-t / dec)
          + 0.35 * (Math.sin(TAU * (big ? 185 : 230) * t) + 0.6 * Math.sin(TAU * (big ? 300 : 370) * t)) * Math.exp(-t / (big ? 0.05 : 0.035))
          + 0.8 * slap[i] * Math.exp(-t / (big ? 0.08 : 0.05))
          + (t > 0.012 ? 0.3 * crk[i] * Math.exp(-(t - 0.012) / 0.012) : 0);
        for (const tb of rattle) if (t >= tb) y += 0.16 * rat[i] * Math.exp(-(t - tb) / 0.012);
        d[i] = Math.tanh(1.3 * y);
      }
      return finish(d, 0.0005);
    });
    // 检查单打勾：打字机的「嗒」+ 行末小铃「叮」，带音高
    const ding = (m) => get("dg:" + m, () => {
      const f = hz(m), d = arr(1.1), n = d.length, a = nz(n, 71, "bp", 3400, 1.4);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.55 * a[i] * Math.exp(-t / 0.0045) + 0.25 * Math.sin(TAU * 160 * t) * Math.exp(-t / 0.012)
          + 0.7 * (Math.sin(TAU * f * t) * Math.exp(-t / 0.45) + 0.22 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.22)
            + 0.1 * Math.sin(TAU * 3.01 * f * t) * Math.exp(-t / 0.1) + 0.04 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t / 0.05));
      }
      return finish(d, 0.0003);
    });
    // 钥匙：插进去（拍前 KEY_PRE 秒）→ 转动「咔」（正落在拍上）→ 锁舌缩回的一声闷响
    const key = () => get("key", () => {
      const P = KEY_PRE, d = arr(0.45), n = d.length;
      const a = nz(n, 81, "bp", 5200, 2), b = nz(n, 82, "hp", 3000), c = nz(n, 83, "bp", 900, 1), e = nz(n, 84, "bp", 4200, 2);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let y = 0.4 * a[i] * Math.exp(-t / 0.012);
        if (t >= 0.028) y += 0.25 * e[i] * Math.exp(-(t - 0.028) / 0.006);
        if (t >= P) { const u = t - P; y += 0.5 * (Math.sin(TAU * 1900 * u) + 0.7 * Math.sin(TAU * 3100 * u)) * Math.exp(-u / 0.007) + 0.6 * b[i] * Math.exp(-u / 0.0025); }
        if (t >= P + 0.085) { const u = t - P - 0.085; y += 0.55 * Math.sin(TAU * 210 * u) * Math.exp(-u / 0.03) + 0.3 * c[i] * Math.exp(-u / 0.02); }
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 指示灯：玻璃味的 FM「叮」；late（D1 那盏）更软、更远
    const lamp = (m, late) => get("lp:" + m + ":" + (late ? 1 : 0), () => {
      const f = hz(m), d = arr(1.8), n = d.length, a = nz(n, 91, "hp", 6000);
      const I0 = late ? 1.1 : 2.4, dec = late ? 0.7 : 0.5;
      for (let i = 0; i < n; i++) {
        const t = i / sr, I = I0 * Math.exp(-t / 0.018) + 0.3;
        d[i] = Math.sin(TAU * f * t + I * Math.sin(TAU * 3.99 * f * t)) * Math.exp(-t / dec) + 0.15 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.15)
          + (late ? 0 : 0.2 * a[i] * Math.exp(-t / 0.001));
      }
      if (late) biquad(d, "lp", 3500);
      return finish(d, 0.0005);
    });
    // 拨弦：拨弦位置决定泛音分布，高次泛音衰减得更快；再叠一层微微走调的做合唱。dark 更闷，mute 是闷音短拨
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
    // FM 铃：1:1 的电钢琴身体（调制深度随时间收）+ 1:3.5 的金属「叮」+ 一点走调的高八度闪光；warm 是第 03 章那支
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
    // 气动管：阀门「噗」一下，气流带通从高往低扫（渐远），末尾胶囊到站的一声轻磕
    function tubeArr({ fc, L, dec, popF, popA, thunk, seed }) {
      const d = arr(L), n = d.length, air = sweepBp(nz(n, seed), (t) => fc * (0.5 + 1.1 * Math.exp(-t / 0.3)), 1.3), pop = nz(n, seed + 4, "bp", 700, 1);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (popF + 110 * Math.exp(-t / 0.02)) / sr;
        const e = t < 0.07 ? t / 0.07 : Math.exp(-(t - 0.07) / dec);
        let y = air[i] * e + popA * Math.sin(ph) * Math.exp(-t / 0.035) + 0.35 * pop[i] * Math.exp(-t / 0.01);
        if (t >= thunk) { const u = t - thunk; y += 0.22 * Math.sin(TAU * 140 * u) * Math.exp(-u / 0.03); }
        d[i] = y;
      }
      return finish(d, 0.001);
    }
    const TUBE_F = [2300, 1700, 1250, 2900];
    const whoosh = (k) => get("wh:" + k, () => tubeArr({ fc: TUBE_F[k], L: WHOOSH_LEN.tube, dec: 0.26, popF: 80, popA: 0.45, thunk: 0.72, seed: 111 + k }));
    // 分叉：更重、更长，两路各走一边
    const fork = (j) => get("fk:" + j, () => tubeArr({ fc: j ? 1500 : 950, L: WHOOSH_LEN.fork, dec: 0.4, popF: 60, popA: 0.7, thunk: 1.0, seed: 131 + j }));
    // 下坠：两拍里越吸越响，带通从 5.2 kHz 扫到 220 Hz，底下一条往下滑的正弦，正好收在 16:0
    const down = () => get("down", () => {
      const L = WHOOSH_LEN.down, d = arr(L + 0.01), n = d.length, air = sweepBp(nz(n, 121), (t) => 5200 * Math.pow(220 / 5200, Math.min(1, t / L)), 1.6);
      let ph = 0, ph2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, x = Math.min(1, t / L);
        ph += TAU * 880 * Math.pow(1 / 8, x) / sr;
        ph2 += TAU * 55 / sr;
        let y = air[i] * Math.pow(x, 2.2) + 0.3 * Math.sin(ph) * Math.pow(x, 1.5) + 0.35 * Math.sin(ph2) * Math.pow(x, 3);
        if (t > L - 0.012) y *= Math.max(0, (L - t) / 0.012);
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 出屋前吸一口气：一拍长，带通往上扫
    const swell = () => get("swell", () => {
      const L = BEAT, d = arr(L), n = d.length, air = sweepBp(nz(n, 141), (t) => 500 * Math.pow(8, Math.min(1, t / L)), 1.2);
      for (let i = 0; i < n; i++) { const t = i / sr, x = t / L; d[i] = air[i] * x * x * (t > L - 0.01 ? (L - t) / 0.01 : 1); }
      return finish(d, 0.001);
    });
    // 递出清单：纸在台面上滑过去（摩擦声慢慢起伏），最后轻轻一磕
    const slip = () => get("slip", () => {
      const d = arr(0.5), n = d.length, a = sweepBp(nz(n, 151), (t) => 1100 + 1300 * Math.min(1, t / 0.32), 0.9), tap = nz(n, 152, "bp", 1500, 1);
      const r = mulberry32(153), fl = new Float32Array(n);
      let s = 0;
      for (let i = 0; i < n; i++) { s += 0.004 * ((r() * 2 - 1) - s); fl[i] = s; }
      norm(fl);
      for (let i = 0; i < n; i++) {
        const t = i / sr, e = t < 0.03 ? t / 0.03 : t < 0.26 ? 1 : Math.max(0, 1 - (t - 0.26) / 0.06);
        let y = a[i] * e * (0.75 + 0.25 * fl[i]);
        if (t >= 0.33) { const u = t - 0.33; y += 0.6 * tap[i] * Math.exp(-u / 0.01) + 0.3 * Math.sin(TAU * 300 * u) * Math.exp(-u / 0.02); }
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 广播：主题四个音一起敲响的铃，随后电台那种一抖一抖的颤音和一缕往上飘的口哨噪声
    const broadcast = () => get("bc", () => {
      const L = 2.2, d = arr(L), n = d.length;
      for (const [nm, g] of [["A5", 1], ["D6", 0.8], ["F6", 0.7], ["E6", 0.6]]) { const b = bellArr(midi(nm), "bright"); for (let i = 0; i < n && i < b.length; i++) d[i] += g * b[i]; }
      const w = sweepBp(nz(n, 161), (t) => 1800 * Math.pow(3, Math.min(1, t / 1.2)), 7);
      for (let i = 0; i < n; i++) {
        const t = i / sr, trem = 0.7 + 0.3 * Math.cos(TAU * 6.5 * t), depth = Math.min(1, t / 0.3);
        const sw = t < 0.3 ? t / 0.3 : Math.exp(-(t - 0.3) / 0.6);
        d[i] = d[i] * (1 - 0.25 * depth * (1 - trem)) + 0.35 * w[i] * sw * trem;
      }
      return finish(d, 0.0015);
    });
    // 在线 / 离线翻转：一记亮的——两支高铃 + 一声脆的点击 + 往上一挑
    const flipHit = () => get("fh", () => {
      const L = 1.4, d = arr(L), n = d.length, a = nz(n, 171, "hp", 6000);
      for (const [nm, g] of [["G6", 1], ["D7", 0.7]]) { const b = bellArr(midi(nm), "bright"); for (let i = 0; i < n && i < b.length; i++) d[i] += g * b[i]; }
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (1200 + 1400 * Math.min(1, t / 0.04)) / sr;
        d[i] += 0.5 * a[i] * Math.exp(-t / 0.0015) + 0.25 * Math.sin(ph) * Math.exp(-t / 0.03);
      }
      return finish(d, 0.0003);
    });

    // ---- 各章专用的音色（新噪声种子从 300 往上取，不和上面的撞） ----
    // 玻璃读数灯（旋律乐器 glass）：第 01 章仪器的读数灯唱主题。和 lamp 同一族的玻璃 FM，身体换成 1:2 调制、尾巴更长，
    // 亮起时带一点灯丝的颤（5 Hz），长音撑得住
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
    // 低音马林巴（旋律乐器 marimba）：第 08 章地层里唱主题。琴键泛音调在 1 : 4 : 10 附近（马林巴的调法），高次的很快没了；
    // 共鸣管和琴键差一点点，慢慢拍；软槌落下一声闷的「噗」
    const marimba = (m) => get("mb:" + m, () => {
      const f = hz(m), tau = 0.9 * Math.pow(220 / f, 0.4), d = arr(Math.min(2.4, tau * 5)), n = d.length, r = mulberry32(1100 + m);
      for (const [k, amp, tk] of [[1, 1, tau], [1.003, 0.18, tau * 0.8], [3.93, 0.28, 0.1], [9.2, 0.08, 0.035]]) partial(d, f * k, amp, tk, r() * TAU);
      const th = nz(n, 1200 + m, "bp", 700, 0.7), pn = Math.min(n, Math.round(0.03 * sr));
      for (let i = 0; i < pn; i++) d[i] += 0.25 * th[i] * Math.exp(-i / sr / 0.005);
      return finish(d, 0.002);
    });
    // 电键（剧情音 morse）：第 05 章的电报，按下「嘟」一声、松开；起落 4 ms 的斜坡加两头各一下键的轻磕，是电键那点咔哒。len 秒
    const morse = (m, len) => get("ms:" + m + ":" + len, () => {
      const f = hz(m), d = arr(len + 0.06), n = d.length, c = nz(n, 301, "bp", 2600, 1.2);
      for (let i = 0; i < n; i++) {
        const t = i / sr, g = Math.min(1, t / 0.004) * (t < len ? 1 : Math.max(0, 1 - (t - len) / 0.012));
        d[i] = g * (Math.sin(TAU * f * t) + 0.12 * Math.sin(TAU * 2 * f * t) + 0.04 * Math.sin(TAU * 3 * f * t))
          + 0.3 * c[i] * Math.exp(-t / 0.002) + (t >= len ? 0.15 * c[i] * Math.exp(-(t - len) / 0.002) : 0);
      }
      return finish(d, 0.0005);
    });
    // 闸门弹开（剧情音 gate）：第 05 章旧轮询撞上时间戳闸门。金属闸杆被敲一下（自由杆的泛音比 1 : 2.76 : 5.40 : 8.93），
    // 立柱闷一声，信封被弹回去是一口往下扫的风
    const gate = () => get("gate", () => {
      const d = arr(0.7), n = d.length, r = mulberry32(311), click = nz(n, 312, "bp", 3200, 1.1);
      const air = sweepBp(nz(n, 313), (t) => 2600 * Math.pow(700 / 2600, Math.min(1, t / 0.4)), 1.4);
      for (const [k, amp, tk] of [[1, 0.8, 0.12], [2.76, 0.45, 0.07], [5.4, 0.25, 0.04], [8.93, 0.12, 0.025]]) partial(d, 560 * k, amp, tk, r() * TAU);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (70 + 50 * Math.exp(-t / 0.025)) / sr;
        d[i] = Math.tanh(1.5 * (d[i] + 1.3 * Math.sin(ph) * Math.exp(-t / 0.13) + 0.35 * click[i] * Math.exp(-t / 0.003)
          + (t > 0.04 ? 0.6 * air[i] * Math.sin(Math.PI * Math.min(1, (t - 0.04) / 0.5)) : 0))); // 和印章一样压一压峰，身子才厚
      }
      return finish(d, 0.0003);
    });
    // 熄灯（剧情音 off）：第 05 章在线点到点自己熄灭。和 lamp 同一种玻璃 FM，音高 0.45 秒里滑下一个八度，越滑越弱
    const off = (m) => get("off:" + m, () => {
      const f0 = hz(m), d = arr(1), n = d.length, a = nz(n, 321, "hp", 5000);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * f0 * Math.pow(0.5, Math.min(1, t / 0.45)) / sr;
        d[i] = Math.sin(ph + (1.4 * Math.exp(-t / 0.05) + 0.25) * Math.sin(3.99 * ph)) * Math.exp(-t / 0.3) + 0.15 * a[i] * Math.exp(-t / 0.0012);
      }
      return finish(d, 0.0005);
    });
    // 甩镜头（whoosh 的 tube: "whip"）：一口风从低扫到高再落回去，中点最响（镜头最快那一刻）；没有气动管的阀门和到站声
    const whip = () => get("whip", () => {
      const L = WHOOSH_LEN.whip, d = arr(L), n = d.length, low = nz(n, 332, "lp", 380);
      const air = sweepBp(nz(n, 331), (t) => 450 + 3200 * Math.pow(Math.sin(Math.PI * Math.min(1, t / L)), 1.5), 1.1);
      for (let i = 0; i < n; i++) d[i] = (air[i] + 0.35 * low[i]) * Math.pow(Math.sin(Math.PI * Math.min(1, i / sr / L)), 2);
      return finish(d, 0.001);
    });
    // 敲门（section 的 clockKind："knock" / "knockFar"）：指节叩木门，门板几个低的模态加指节一磕；far 是隔着地层听，高频闷掉
    const knock = (far) => get("kn:" + (far ? 1 : 0), () => {
      const d = arr(0.2), n = d.length, r = mulberry32(341), tap = nz(n, 342, "bp", 1900, 1.2);
      for (const [f, amp, tk] of [[185, 1, 0.045], [410, 0.55, 0.026], [760, 0.3, 0.014], [1240, 0.15, 0.008]]) partial(d, f, amp, tk, r() * TAU);
      for (let i = 0; i < n; i++) d[i] += (far ? 0.25 : 0.8) * tap[i] * Math.exp(-i / sr / 0.003);
      if (far) biquad(d, "lp", 650);
      return finish(d, 0.0003);
    });
    // 报到（剧情音 ping）：第 08 章 Worker 每 5 分钟往上发的一声。圆的低音起头往上挑三个半音（往外出去），叠一层高八度，小喇叭也听得见；
    // late 是沉到地层底下听：更短、更闷
    const ping = (m, late) => get("pg:" + m + ":" + (late ? 1 : 0), () => {
      const f = hz(m), d = arr(1.2), n = d.length;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * f * Math.pow(2, (-3 / 12) * Math.exp(-t / 0.035)) / sr;
        d[i] = (Math.sin(ph + (0.8 * Math.exp(-t / 0.08) + 0.1) * Math.sin(ph)) + 0.35 * Math.sin(2 * ph) * Math.exp(-t / 0.25))
          * Math.exp(-t / (late ? 0.35 : 0.45)) * Math.min(1, t / 0.003);
      }
      if (late) biquad(d, "lp", 900);
      return finish(d, 0.0005);
    });
    // 清屏（剧情音 clear）：第 10 章终端自下往上清掉。一口很轻的擦声从低往高扫，一行一下的细小咔哒也跟着往上走
    const clear = () => get("clr", () => {
      const d = arr(0.95), n = d.length, r = mulberry32(361), tick = nz(n, 363, "hp", 3000);
      const air = sweepBp(nz(n, 362), (t) => 350 * Math.pow(12, Math.min(1, t / 0.85)), 1.3);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = 0.7 * air[i] * Math.min(1, t / 0.04) * (t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.25)); }
      for (let k = 0; k < 16; k++) {
        const i0 = Math.round((0.02 + k * 0.05) * sr), f = 1800 + 160 * k, amp = 0.25 + 0.2 * r();
        for (let i = i0; i < n && i < i0 + Math.round(0.02 * sr); i++) { const u = (i - i0) / sr; d[i] += amp * Math.sin(TAU * f * u) * Math.exp(-u / 0.004) + 0.1 * tick[i] * Math.exp(-u / 0.001); }
      }
      return finish(d, 0.001);
    });
    // Clawd 跳一下（剧情音 hop）：第 10 章庆祝时举手那一帧，一声往上挑的小「啾」，底下带一点蹲下时扬起的土
    const hop = (m) => get("hop:" + m, () => {
      const f = hz(m), d = arr(0.35), n = d.length, dust = nz(n, 371, "lp", 1400);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * f * Math.pow(2, (-5 / 12) * Math.max(0, 1 - t / 0.045)) / sr;
        d[i] = (Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph)) * Math.exp(-t / 0.1) * Math.min(1, t / 0.003) + 0.12 * dust[i] * Math.exp(-t / 0.02);
      }
      return finish(d, 0.0005);
    });

    const bank = { kick, snare, type, flip, clock, stamp, ding, key, lamp, pluck, bell, whoosh, fork, down, swell, slip, broadcast, flipHit, glass, marimba, morse, gate, off, whip, knock, ping, clear, hop };
    SAMPLE_BANKS.set(sr, bank);
    return bank;
  }

  // 混响的冲激响应：种子噪声 × 指数衰减，两个声道各用一段（去相关），尾巴越往后越暗，开头撒几个早期反射
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
  // 磁带：in → ÷H → tanh 曲线 → ×H，等效 out = S·tanh(in/S)，|in| 到 H 之前都不会硬削
  function tapeCurve(S, H) {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = ((i / (n - 1)) * 2 - 1) * H; c[i] = (S * Math.tanh(x / S)) / H; }
    return c;
  }

  // =====================================================================
  // 排程：build() 拼好的音符表 B.NOTES → OfflineAudioContext
  // =====================================================================
  const CAT = { pad: "pad", bass: "bass", kick: "drums", snare: "drums", hat: "drums", clock: "drums", mel: "mel" }; // 其余剧情音都算 fx
  function schedule(ctx, opts) {
    const END = B.DURATION + TAIL, S = samplesFor(ctx.sampleRate);
    const solo = opts.solo ? new Set([].concat(opts.solo)) : null;
    const on = (n) => !solo || solo.has(CAT[n.kind] || "fx");
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // —— 母线：各组 → mix → 下坠扫频 → post → 磁带 → 高通 / 低通 → 输出（-1 dBFS 峰值归一和限幅在渲染完之后用 JS 做）。
    // 不用 DynamicsCompressor：它的起控 / 释放是按阈值切换的分支，末位浮点的差别会被放大，两次渲染对不齐 ——
    const mix = gain(), sweep = filt("lowpass", 20000, 0.9), post = gain(0.4); // post 的 0.4 是进磁带前的电平
    sweep.frequency.setValueAtTime(20000, 0);
    for (const s of B.SWEEPS) { // 章节交接的下坠（各章乐谱的 sweeps）
      sweep.frequency.setValueAtTime(20000, s.t0);
      sweep.frequency.exponentialRampToValueAtTime(s.f, s.t1);
      sweep.frequency.exponentialRampToValueAtTime(20000, s.t2);
    }
    mix.connect(sweep); sweep.connect(post);
    if (opts.stage === "pre") post.connect(ctx.destination); // 调试：看进磁带之前的电平
    else {
      const H = 2, tin = gain(1 / H), tape = ctx.createWaveShaper(), tout = gain(H), hp = filt("highpass", 28), lp = filt("lowpass", 15500, 0.5);
      tape.curve = tapeCurve(0.9, H); tape.oversample = "4x";
      post.connect(tin); tin.connect(tape); tape.connect(tout); tout.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
    }
    const bus = { drums: gain(), fx: gain(), mel: gain(), fxPost: gain(), melPost: gain() };
    for (const k of ["drums", "fx", "mel"]) bus[k].connect(mix);
    bus.fxPost.connect(post); bus.melPost.connect(post); // 不过母线扫频的：下坠本身、落地那一声、postBars 里的旋律
    // 侧链：用和 env('duck') 同一个函数算出来的曲线直接画在 pad / 贝斯的母线增益上
    const RATE = 1000, cn = Math.ceil(END * RATE) + 1, cPad = new Float32Array(cn), cBass = new Float32Array(cn);
    for (let i = 0; i < cn; i++) { const t = i / RATE; cPad[i] = duck(t); cBass[i] = bassDuck(t); }
    bus.pad = gain(); bus.pad.gain.setValueCurveAtTime(cPad, 0, (cn - 1) / RATE); bus.pad.connect(mix);
    bus.bass = gain(); bus.bass.gain.setValueCurveAtTime(cBass, 0, (cn - 1) / RATE); bus.bass.connect(mix);

    // 混响（短，种子噪声生成）和附点八分的乒乓延迟，回到 mix（所以下坠时也一起被吸走）
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 1.7, 2026);
    const verbRet = gain(0.5); verb.connect(verbRet); verbRet.connect(mix);
    const dIn = gain(), dL = ctx.createDelay(2), dR = ctx.createDelay(2), dFb = gain(0.36), dHp = filt("highpass", 280), dLp = filt("lowpass", 2600), merge = ctx.createChannelMerger(2), dRet = gain(0.3);
    dL.delayTime.value = dR.delayTime.value = BEAT * 0.75;
    dIn.connect(dHp); dHp.connect(dLp); dLp.connect(dL); dL.connect(dR); dR.connect(dFb); dFb.connect(dHp);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(dRet); dRet.connect(mix);
    const send = (node, to, amt) => { if (amt > 0) { const s = gain(amt); node.connect(s); s.connect(to); } };

    // 放一个采样：pre 秒的前置段排在拍前（钥匙插进去那一下），事件时间仍是拍点
    function play(buf, t, { g = 1, pan = 0, panTo = null, panDur = 0.5, to = bus.fx, verbAmt = 0, delayAmt = 0, pre = 0 } = {}) {
      const t0 = Math.max(0, t - pre), src = ctx.createBufferSource(), a = gain(g), p = ctx.createStereoPanner();
      src.buffer = buf;
      p.pan.setValueAtTime(clamp(pan, -1, 1), t0);
      if (panTo != null) p.pan.linearRampToValueAtTime(clamp(panTo, -1, 1), t + panDur);
      src.connect(a); a.connect(p); p.connect(to);
      send(p, verb, verbAmt); send(p, dIn, delayAmt);
      src.start(t0);
    }
    // pad：每个和弦音两支锯齿（±7 音分，左右分开），低通随段落；和弦之间交叉淡化，终和弦在尾巴里放掉
    function pad(n) {
      const names = CHORD[n.chord], lvl = 0.11 * n.level * Math.sqrt(4 / names.length), att = 0.28, rel = n.last ? 1.7 : 0.45;
      for (const name of names) for (const [det, pan] of [[-7, -0.5], [7, 0.5]]) {
        const o = ctx.createOscillator(), f = filt("lowpass", n.lp, 0.3), a = gain(0), p = ctx.createStereoPanner();
        o.type = "sawtooth"; o.frequency.value = hz(midi(name)); o.detune.value = det;
        f.frequency.setValueAtTime(n.lp * 0.55, n.t); f.frequency.linearRampToValueAtTime(n.lp, n.t + 0.8);
        a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(lvl, n.t + att);
        a.gain.setValueAtTime(lvl, n.end); a.gain.setTargetAtTime(0, n.end, rel / 4);
        p.pan.value = pan;
        o.connect(f); f.connect(a); a.connect(p); p.connect(bus.pad); send(p, verb, n.verb);
        o.start(n.t); o.stop(n.end + rel * 1.6);
      }
    }
    // 次低音：正弦 + 一点二次谐波（小喇叭也听得见），起音从高 35 音分落下来，圆一点
    function bass(n) {
      const f = hz(n.m), vol = 0.36 * n.v, end = n.t + n.dur, a = gain(0), h = gain(0.2);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.frequency.value = f; o2.frequency.value = 2 * f;
      for (const x of [o, o2]) { x.detune.setValueAtTime(35, n.t); x.detune.setTargetAtTime(0, n.t, 0.012); }
      a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(vol, n.t + n.att);
      a.gain.setValueAtTime(vol, end); a.gain.setTargetAtTime(0, end, n.rel / 3);
      o.connect(a); o2.connect(h); h.connect(a); a.connect(bus.bass);
      for (const x of [o, o2]) { x.start(n.t); x.stop(end + n.rel * 3 + 0.02); }
    }
    const KICK_G = { tight: 0.9, light: 0.65, lub: 0.85, dub: 0.85, boom: 0.6 };
    const LAMP_PAN = [-0.4, 0, 0.4];
    // 这几件的电平按隔离渲染的 LUFS-M（400 ms 窗）对到同一位置上别的剧情音；knock 频谱偏低，同样响度下比 tick 听着轻，所以高约 3 dB。改音色要重新对
    const GLASS_G = 0.62, MARIMBA_G = 0.42, KNOCK_G = 0.092, WHIP_G = 0.75, MORSE_G = 0.21, GATE_G = 0.49, OFF_G = 0.19, PING_G = [0.84, 0.25], CLEAR_G = 0.13, HOP_G = 0.24;
    const TUBE_PAN = [-0.7, -0.25, 0.25, 0.7];

    for (const n of B.NOTES) {
      if (!on(n)) continue;
      const t = n.t;
      switch (n.kind) {
        case "pad": pad(n); break;
        case "bass": bass(n); break;
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
          else
            play(S.pluck(n.m, n.inst), t, { g: (n.theme ? 0.34 : 0.3) * n.v, pan: n.pan ?? 0, to, verbAmt: n.inst === "pluck" ? 0.22 : 0.28, delayAmt: n.theme ? 0.32 : n.inst === "pluckMute" ? 0.3 : 0.18 });
          break;
        }
        case "key": play(S.key(), t, { g: 0.85 * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.15, pre: KEY_PRE }); break;
        case "stamp": play(S.stamp(n.size), t, { g: n.size === "big" ? 1.35 : 0.72, verbAmt: n.size === "big" ? 0.3 : 0.2 }); break;
        case "tick": play(S.ding(n.m), t, { g: 0.62, pan: -0.35 + 0.14 * n.i, verbAmt: 0.2, delayAmt: 0.12 }); break;
        case "lamp": play(S.lamp(n.m, n.late), t, { g: n.late ? 0.17 : 0.65, pan: n.late ? 0.55 : LAMP_PAN[n.i], verbAmt: n.late ? 0.6 : 0.35, delayAmt: 0.2 }); break;
        case "whoosh":
          if (n.tube === "fork") { play(S.fork(0), t, { g: 0.6, panTo: -0.8, panDur: 0.6, verbAmt: 0.25 }); play(S.fork(1), t, { g: 0.6, panTo: 0.8, panDur: 0.6, verbAmt: 0.25 }); }
          else if (n.tube === "down") play(S.down(), t, { g: 0.7, to: bus.fxPost, verbAmt: 0.2 });
          else if (n.tube === "whip") play(S.whip(), t, { g: WHIP_G * (n.v ?? 1), pan: n.pan ?? 0.5, panTo: n.panTo ?? -0.5, panDur: WHOOSH_LEN.whip, verbAmt: 0.2 });
          else play(S.whoosh(n.tube), t, { g: 0.75, panTo: TUBE_PAN[n.tube], panDur: 0.6, verbAmt: 0.25 });
          break;
        case "accent":
          if (n.what === "arrive") play(S.kick("boom"), t, { g: 0.45, to: bus.fxPost });
          else if (n.what === "slip") play(S.slip(), t, { g: 0.7, pan: 0.2, verbAmt: 0.15 });
          else if (n.what === "broadcast") play(S.broadcast(), t, { g: 0.36, verbAmt: 0.45, delayAmt: 0.3 });
          else if (n.what === "flip") play(S.flipHit(), t, { g: 0.8, verbAmt: 0.4, delayAmt: 0.25 });
          break;
        case "swell": play(S.swell(), t, { g: 0.2, verbAmt: 0.3 }); break;
        case "boom": play(S.kick("boom"), t, { g: 0.45 }); break;
        case "morse": play(S.morse(n.m, Math.round((n.len ?? 0.35) * BEAT * 1000) / 1000), t, { g: MORSE_G * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.12, delayAmt: 0.1 }); break;
        case "gate": play(S.gate(), t, { g: GATE_G, pan: n.pan ?? 0.1, verbAmt: 0.22 }); break;
        case "off": play(S.off(n.m), t, { g: OFF_G, pan: n.pan ?? 0.3, verbAmt: 0.5, delayAmt: 0.2 }); break;
        case "ping": play(S.ping(n.m, n.late), t, { g: n.late ? PING_G[1] : PING_G[0], pan: n.pan ?? 0, verbAmt: n.late ? 0.5 : 0.25, delayAmt: 0.12 }); break;
        case "clear": play(S.clear(), t, { g: CLEAR_G, verbAmt: 0.3 }); break;
        case "hop": play(S.hop(n.m), t, { g: HOP_G * (n.v ?? 1), pan: n.pan ?? 0, verbAmt: 0.25, delayAmt: 0.15 }); break;
      }
    }
  }

  // =====================================================================
  // 母带：渲染完在 JS 里做——峰值归一到 -1 dBFS（或按 BS.1770 响度拉到目标 + 前视限幅），尾巴淡出
  // =====================================================================
  // K 计权：高架（+4 dB @ 1.68 kHz）+ RLB 高通（38 Hz），系数按采样率现算
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
  // 整体响度（LUFS）：400 ms 块、75% 重叠，-70 绝对门限 + -10 LU 相对门限
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
  // 前视限幅：先求每个样本「不过线需要的增益」，取前视窗口里的最小值，再用同长度滑动平均抹成斜坡（保证峰值处不超），释放 80 ms
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
      if (j >= la) mn[j - la] = val(q[h]); // mn[i] = need 在 [i, i+la] 里的最小值
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
      // 峰值归一到 -1 dBFS；限幅器此时不动作，只是保险
      let pk = 0;
      for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      out = limit(L, R, sr, pk > 0 ? ceil / pk : 1, ceil);
    } else {
      // 按响度：两遍，第一遍按原始响度定增益；限幅会吃掉一点响度，第二遍按限幅后的实测补回
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

  // 渲染整段混音（含尾巴）。先 Score.build(plan)。opts.sampleRate；调试用：opts.solo = ["pad"|"bass"|"drums"|"mel"|"fx"] 只出这几组，
  // opts.raw 跳过母带处理，opts.stage = "pre" 在磁带之前取出来
  async function render(opts = {}) {
    if (!B) throw new Error("先调 Score.build(plan)");
    const sr = opts.sampleRate || SAMPLE_RATE;
    const ctx = new OfflineAudioContext(2, Math.ceil((B.DURATION + TAIL) * sr), sr);
    schedule(ctx, opts);
    const buf = await ctx.startRendering();
    return opts.raw || opts.solo || opts.stage ? buf : master(buf);
  }

  // build(plan) 之后才有：bars、duration、events、notes、sections、chords、chapters
  window.Score = {
    BPM, BAR, BEAT, tail: TAIL, sampleRate: SAMPLE_RATE,
    build, render, env, at, loudness,
    theme: THEME.map(([beat, dur, note]) => ({ beat, dur, note })),
  };
})();
