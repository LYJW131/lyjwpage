(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch05",
  chords: { jazzBb7: ["Bb2", "Ab3", "D4", "F4"], jazzA7b9: ["A2", "G3", "C#4", "Bb4"] },
  score: ({ THEME, phrase, midi }) => {
    // 时刻（小节）与 ch05.js 的分镜是同一张表：甩镜头、托盘进电报、接管与重放、主角到站与翻面、闸门、本地外推、截止、数人头、到期表、5 分钟兜底、剪线。
    // 冷爵士：两遍 12 小节小调布鲁斯，低音提琴 walking，刷子转叮叮镲；底下不垫合成器 pad，和声全靠颤音琴。
    const SW = 2 / 3;
    const BLUES = ["Dm9", "Gm9", "Dm9", "Dm9", "Gm9", "Gm9", "Dm9", "Dm9", "jazzBb7", "jazzA7b9", "Dm9", [["Em7b5", 0], ["jazzA7b9", 2]]];
    const harm = ["Dm9", [["Dm9", 0], ["jazzA7b9", 2]], ...BLUES, ...BLUES, "Dm9", "A7sus4"];
    const chordAt = (bar, beat) => {
      const h = harm[Math.min(bar, harm.length - 1)];
      if (typeof h === "string") return h;
      let c = h[0][0];
      for (const [n, b] of h) if (beat >= b - 1e-9) c = n;
      return c;
    };
    const segsOf = (bar) => typeof harm[bar] === "string" ? [[harm[bar], 0, 4]] : harm[bar].map(([c, b], i, a) => [c, b, (a[i + 1] ? a[i + 1][1] : 4) - b]);

    const ROOT = { Dm9: 38, Gm9: 43, jazzBb7: 34, jazzA7b9: 33, Em7b5: 40, A7sus4: 33 };
    const DOM = new Set(["jazzBb7", "jazzA7b9", "A7sus4"]);
    const LINE = { m: [[0, 3, 7], [0, 7, 10], [0, 2, 3], [12, 10, 7], [0, -2, -5]], d: [[0, 4, 7], [12, 10, 7], [0, 7, 10], [0, 2, 4]] };
    const LO = 28, HI = 50;
    const near = (pc, prev) => {
      let best = null;
      for (let m = LO; m <= HI; m++) if ((m - pc) % 12 === 0 && (best == null || Math.abs(m - prev) < Math.abs(best - prev))) best = m;
      return best;
    };
    const fit = (m) => { while (m < LO) m += 12; while (m > HI) m -= 12; return m; };
    const melody = [];
    const name = (m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][m % 12] + (Math.floor(m / 12) - 1);
    let prev = 38, li = 0;
    const bassNote = (bar, beat, m, dur, v) => { melody.push([bar, beat, dur, name(m), "jazzBass", v, false]); prev = m; };
    function walk(bar) {
      for (const [c, b0, len] of segsOf(bar)) {
        const root = near(ROOT[c] % 12, prev), next = b0 + len >= 4 ? chordAt(bar + 1, 0) : chordAt(bar, b0 + len);
        const target = near(ROOT[next] % 12, root), pats = DOM.has(c) ? LINE.d : LINE.m, pat = pats[li++ % pats.length];
        for (let k = 0; k < len; k++) {
          let m;
          if (k === len - 1 && k > 0) {
            m = target + (prev < target ? -1 : 1);
            if (m === prev || m < LO || m > HI) m = target + (prev < target ? 1 : -1);
          } else m = fit(root + pat[k]);
          bassNote(bar, b0 + k, m, k === len - 1 ? 0.85 : 0.92, k === 0 ? 0.95 : 0.82);
        }
      }
    }
    function two(bar, pickup) {
      const segs = segsOf(bar);
      if (segs.length === 1) {
        const root = near(ROOT[segs[0][0]] % 12, prev);
        bassNote(bar, 0, root, 1.85, 0.95);
        bassNote(bar, 2, fit(root + 7), pickup ? 1.3 : 1.85, 0.8);
      } else for (const [c, b0] of segs) bassNote(bar, b0, near(ROOT[c] % 12, prev), 1.85, 0.9);
      if (pickup) { const t = near(ROOT[chordAt(bar + 1, 0)] % 12, prev); bassNote(bar, 3 + SW, t + (prev < t ? -1 : 1), 0.3, 0.6); }
    }
    bassNote(0, 0, 38, 2.85, 0.9);
    bassNote(0, 3, 33, 0.9, 0.8);
    for (let bar = 1; bar <= 11; bar++) walk(bar);
    bassNote(12, 0, near(2, prev), 0.45, 1);
    [13, 14, 15, 16, 17].forEach((bar) => two(bar, bar === 14 || bar === 16));
    for (let bar = 18; bar <= 26; bar++) walk(bar);
    bassNote(27, 0, 33, 3.6, 0.9);

    const VOX = {
      Dm9: [["C4", "E4", "F4", "A4"], ["A3", "C4", "E4", "F4"], ["F4", "A4", "C5", "E5"]],
      Gm9: [["Bb3", "D4", "F4", "A4"], ["F4", "A4", "Bb4", "D5"]],
      jazzBb7: [["Ab3", "C4", "D4", "G4"], ["D4", "G4", "Ab4", "C5"]],
      jazzA7b9: [["G3", "Bb3", "C#4", "F4"], ["C#4", "F4", "G4", "Bb4"]],
      Em7b5: [["G3", "Bb3", "D4", "E4"], ["D4", "E4", "G4", "Bb4"]],
      A7sus4: [["E4", "G4", "A4", "D5"]],
    };
    let last = VOX.Dm9[0].map(midi);
    const voicing = (c) => {
      let best = null, cost = Infinity;
      for (const v of VOX[c]) { const m = v.map(midi), d = m.reduce((s, x, i) => s + Math.abs(x - last[i]), 0); if (d < cost) { cost = d; best = v; } }
      last = best.map(midi);
      return best;
    };
    const vibes = (bar, beat, dur, v, c = beat > 3.4 ? chordAt(bar + 1, 0) : chordAt(bar, beat)) => { for (const n of voicing(c)) melody.push([bar, beat, dur, n, "jazzVibes", v, false]); };
    const COMP = [[[0, 1.4], [1 + SW, 0.6]], [[1, 0.5], [2 + SW, 1.2]], [[0, 0.8], [2, 0.5], [3 + SW, 0.9]], [[1 + SW, 0.7], [3, 0.6]]];
    const comp = (bar, i, v = 0.42) => { for (const [b, d] of COMP[i % COMP.length]) vibes(bar, b, d, v); };
    vibes(0, 0, 4, 0.5);
    vibes(1, 0, 2, 0.5); vibes(1, 2, 1.6, 0.45);
    for (let bar = 2; bar <= 7; bar++) comp(bar, bar);
    vibes(8, 0, 3.5, 0.32);
    vibes(10, 0, 0.5, 0.36); vibes(10, 2 + SW, 1.2, 0.34);
    comp(11, 3, 0.38);
    vibes(12, 0, 0.45, 0.45);
    for (const bar of [13, 14, 15, 16, 17]) vibes(bar, 0, 1.8, 0.3);
    vibes(18, 2 + SW, 1.2, 0.4);
    for (let bar = 19; bar <= 23; bar++) comp(bar, bar);
    comp(25, 2);
    vibes(27, 0, 4, 0.55);

    const STAB = { Dm9: ["F4", "A4", "C5", "E5"], Gm9: ["F4", "A4", "Bb4", "D5"], jazzBb7: ["Ab4", "C5", "D5", "G5"], jazzA7b9: ["G4", "Bb4", "C#5", "F5"], A7sus4: ["D4", "E4", "G4", "A4"] };
    const stab = (bar, beat, v = 0.9, len = 0.3, c = beat > 3.4 ? chordAt(bar + 1, 0) : chordAt(bar, beat)) => { for (const n of STAB[c]) melody.push([bar, beat, len, n, "jazzStab", v, false]); };
    stab(1, 3 + SW); stab(5, 0); stab(7, 2); stab(10, 0, 0.7); stab(12, 0, 0.85, 0.45);
    stab(21, 2, 0.75); stab(22, 0, 0.8); stab(22, 2, 0.85);
    for (const n of ["D4", "F4", "A4", "C5", "E5"]) melody.push([24, 2, 0.6, n, "jazzStab", 1.1, false]);
    stab(26, 0, 0.9); stab(27, 0, 0.45, 1.2);

    const notes = (inst, v, list) => list.forEach(([bar, beat, dur, n]) => melody.push([bar, beat, dur, n, inst, v, false]));
    melody.push(...phrase(8, THEME, "jazzHarmon", 1, true));
    notes("jazzHarmon", 0.75, [[9, 2, 0.55, "F5"], [9, 2 + SW, 0.3, "E5"], [9, 3, 0.9, "D5"], [10, SW, 0.3, "D5"], [10, 1, 0.55, "C5"], [10, 1 + SW, 0.3, "Bb4"], [10, 2, 1.4, "C5"], [11, 0, 1.8, "C#5"]]);
    notes("jazzVibes", 0.7, [[5, 3, 0.9, "D5"], [6, 1, 0.9, "E5"], [6, 3, 0.9, "F5"]]);
    notes("jazzVibes", 0.5, [[9, 0, 0.25, "D5"], [9, 0.25, 0.25, "F5"], [9, 0.5, 0.25, "A5"], [9, 0.75, 0.25, "C6"], [9, 1, 1, "E6"]]);
    notes("jazzVibes", 0.6, [[13, 3, 0.9, "C#5"], [14, 0, 0.9, "D5"], [14, 1, 0.9, "F5"], [14, 2, 0.9, "E5"], [14, 3, 0.9, "D5"], [15, 0, 0.9, "D5"], [15, 1, 1.4, "Bb4"]]);
    notes("jazzVibes", 0.6, [[20, 0, 0.6, "A5"], [20, SW, 1.3, "F5"]]);
    notes("jazzVibes", 0.5, ["D5", "E5", "F5", "A5", "C6", "D6"].map((n, i) => [24, i * 0.25, 0.5, n]));

    const story = [];
    const hit = (bar, beat, what, v = 1, extra = {}) => story.push({ bar, beat, kind: "jazz", what, v, ...extra });
    // 不用刷子 sweep：连着几拍的摩擦声刺耳，拍上改成轻的叮叮镲。
    const brush = (bar, { from = 0, v = 1, taps = true } = {}) => {
      for (let b = from; b < 4; b++) {
        if (b % 2 === 0) hit(bar, b, "ride", 0.55 * v, { i: (bar * 2 + b) % 3 });
        if (b % 2) { if (taps) hit(bar, b, "tap", v); hit(bar, b, "chick", 0.8 * v); }
        hit(bar, b, "kick", 0.3 * v);
      }
    };
    const ride = (bar, { from = 0, v = 1, drop = null } = {}) => {
      for (const [b, a] of [[0, 1], [1, 0.9], [1 + SW, 0.6], [2, 0.95], [3, 0.9], [3 + SW, 0.6]]) if (b >= from) hit(bar, b, "ride", v * a, { i: (bar * 6 + Math.round(b * 3)) % 3 });
      for (const b of [1, 3]) if (b >= from) hit(bar, b, "chick", 0.9 * v);
      for (let b = Math.ceil(from); b < 4; b++) hit(bar, b, "kick", 0.25 * v);
      if (drop != null) hit(bar, drop, "tap", 0.55 * v);
    };
    // 0:0 接住第 04 章最后一小节往上那串拨弦：叮叮镲一记、底鼓、一下刷子点。
    brush(0, { v: 0.6 });
    hit(0, 0, "ride", 1, { i: 1 }); hit(0, 0, "kick", 0.85); hit(0, 0, "tap", 0.7);
    for (let bar = 1; bar <= 4; bar++) brush(bar, { v: 0.9 });
    for (const b of [1, 3]) hit(1, b, "snap", 0.9, { pan: b === 1 ? -0.25 : 0.25 });
    for (let bar = 5; bar <= 11; bar++) ride(bar, { drop: bar % 2 ? 3 + SW : null });
    hit(12, 0, "kick", 0.9); hit(12, 0, "tap", 0.8);
    const lightRide = (bar, v, kick) => {
      for (const b of [0, 2]) { hit(bar, b, "ride", v, { i: (bar * 2 + b) % 3 }); if (kick) hit(bar, b, "kick", 0.3 * v); }
      for (const b of [1, 3]) hit(bar, b, "chick", 0.8 * v);
    };
    for (const bar of [13, 14, 15]) lightRide(bar, 0.6, true);
    for (const [bar, b] of [[13, 1], [13, 3], [14, 1], [14, 3], [15, 1]]) hit(bar, b, "snap", 0.85, { pan: b === 1 ? -0.25 : 0.25 });
    lightRide(16, 0.45, false); lightRide(17, 0.35, false);
    for (const [bar, b] of [[16, 2], [16, 3], [17, 0], [17, 1], [17, 2]]) hit(bar, b, "rim", 0.9, { pan: 0.15 });
    ride(18, { v: 0.8 });
    for (let bar = 19; bar <= 25; bar++) ride(bar, { drop: bar === 25 ? null : bar % 2 ? 2 + SW : null });
    hit(19, 3 + SW, "bongo", 0.8); hit(20, 0, "bongo", 1, { hi: true });
    [[22, 2.5], [22, 2.75], [22, 3.25], [23, 0]].forEach(([bar, b], i) => hit(bar, b, "rim", 0.75 + 0.05 * i, { pan: 0.3 }));
    hit(24, 2, "kick", 0.9);
    for (const [b, v] of [[2, 0.6], [2 + SW, 0.5], [3, 0.75], [3 + SW, 0.9]]) hit(25, b, "tap", v);
    hit(25, 3 + SW, "kick", 0.7);
    hit(26, 0, "kick", 0.9); hit(26, 0, "ride", 1, { i: 1 });
    [1, 1.5, 2, 2.5].forEach((b, i) => hit(26, b, "bongo", 0.85, { hi: i % 2 === 0 }));
    [[26, 3], [27, 0], [27, 1], [27, 2]].forEach(([bar, b], i) => hit(bar, b, "snip", 0.9, { pan: -0.2 + 0.15 * i }));
    for (const b of [0, 2]) hit(27, b, "ride", 0.4, { i: b % 3 });
    // 27:3 过门：刷子点两下、底鼓带一下，颤音琴按 A7sus4 往上一串，落到第 06 章 0:0。
    for (const [b, v] of [[3, 0.55], [3 + SW, 0.75]]) hit(27, b, "tap", v);
    hit(27, 3 + SW, "kick", 0.6);
    ["E4", "G4", "A4", "D5", "E5", "G5"].forEach((n, i) => melody.push([27, 3 + i / 6, 0.3, n, "jazzVibes", 0.45 + i * 0.04, false]));
    story.push(
      ...[[3, 0], [3, 2], [4, 0]].map(([bar, beat], i) => ({ bar, beat, kind: "morse", m: midi("E5"), v: 0.7, pan: -0.3 + 0.3 * i })),
      { bar: 12, beat: 0, kind: "gate" },
      { bar: 17, beat: 2, kind: "off", m: midi("D5") },
      { bar: 19, beat: 2, kind: "morse", m: midi("A5"), len: 0.25, v: 0.8, pan: 0.2 },
      { bar: 27, beat: 3, kind: "swell" },
    );

    const SFX = [
      [0.625, "paper", 0.5, -0.3], [0.75, "paper", 0.45, 0.2, 1.1], [0.875, "paper", 0.45, 0.3, 0.95],
      ...[1.875, 7.375, 10.375, 12.875, 15.375, 18.375, 20.875, 23.625, 25.875].map((o, i) => [o, "whoosh", 0.7, i % 2 ? -0.3 : 0.3]),
      [2.5, "plug", 0.7, -0.3],
      ...[3.0, 3.5, 4.0].map((o, i) => [o, "pop", 0.35, -0.1 + 0.15 * i, 1 + 0.08 * i]),
      [5.0, "paper", 0.55, 0.3], [5.4, "land", 0.45, -0.2],
      ...[5.75, 6.25, 6.75].map((o, i) => [o, "pop", 0.4, 0.2 + 0.1 * i, 1.1 + 0.06 * i]),
      [8.0, "land", 0.6, 0], [8.5, "paper", 0.55, 0.1], [8.875, "click", 0.55, 0.3], [9.0, "paper", 0.6, -0.2, 0.9],
      [17.5, "pop", 0.4, 0.3, 0.8], [19.5, "click", 0.6, 0],
      [24.5, "stamp", 0.95, 0.2],
    ];
    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "wire-title", name: "片头：剪纸海报从右边滑进来盖住第 04 章的报纸，色块一片片滑进来，标题落下，响指", energy: 0.4 },
        { from: 2, to: 4, id: "wire-early", name: "head 里的脚本先连上线，电报一封封进托盘：刷子、walking bass", energy: 0.5 },
        { from: 5, to: 6, id: "wire-adopt", name: "hydrate 接管同一根线，三封按到达顺序重放：叮叮镲进来，颤音琴三声", energy: 0.6 },
        { from: 7, to: 9, id: "wire-hero", name: "主角到站：Harmon 弱音小号唱信封主题，卡片翻面", energy: 0.8 },
        { from: 10, to: 12, id: "wire-gate", name: "旧的轮询结果爬回来，撞上闸门：12:0 全队停一拍", energy: 0.55 },
        { from: 13, to: 15, id: "wire-quiet", name: "线上没有消息，进度在本地外推：二拍子、响指，颤音琴唱占位歌词", energy: 0.35 },
        { from: 16, to: 17, id: "wire-clocks", name: "源站的钟交给访客的钟，走到截止：边击一拍一下，红点掉下", energy: 0.3 },
        { from: 18, to: 20, id: "wire-census", name: "数人头：一扇窗切后台，可见人数 3→2", energy: 0.6 },
        { from: 21, to: 25, id: "wire-eta", name: "到期表一行一记铜管，退避的重试是越拉越开的边击；推送连着时 5 分钟兜底，盖章", energy: 0.75 },
        { from: 26, to: 27, id: "wire-snip", name: "剪刀剪掉线上的脉冲，线拉平，停在 A7sus4 交给第 06 章", energy: 0.35 },
      ].map((s) => ({ ...s, pad: 0, lp: 1200, padVerb: 0 })),
      melody,
      story,
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
