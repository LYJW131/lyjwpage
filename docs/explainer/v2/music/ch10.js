(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch10",
  tone: { bell: "warm", pluckPan: 0, snareVerb: 0.14 },
  // 终章是十章的接力：每一站用讲过它的那一章的主奏和律动（都是 score.js 里现成的声音），信封主题像接力棒在乐器间传；
  // 翻面那一拍全体齐奏，谢幕收在 Dmadd9。鼓和贝斯都写在 story 里，sections 只管 pad。
  score: ({ THEME, midi, CHORD }) => {
    // 拍位（小节）与 ch10.js、ch10-bow.js 顶部的 AT 是同一张表，几处一起改。
    const AT = {
      chip0: 0.125, chipStep: 0.0625, env: 1.0, pull: [1.5, 1.875], whip1: 1.875,
      st: [2, 5, 7.5, 9.5, 11.125, 12.75], whip2: [4.75, 5.125], dive: 7.125, iris: 7.5, spin: [9.25, 9.625], cut: 11.0, ink: 12.5,
      flip: 14.0, tutti: 15.0, close: 16.5, drop: 17.0, pop: 17.5, popStep: 0.04, thanks: 18.0, bow1: 18.25, bowStep: 0.0625, bow2: 19.25, cheer: 19.75, leave: 20.25, lift: 20.5, still: 21.5,
    };
    const harm = [
      "Dm9", [["Gm9", 0], ["A7sus4", 2]], "Dmadd9", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", [["Bbmaj7", 0], ["A7", 2]], "Dm9", [["Gm9", 0], ["A7", 2]], "Dm9",
      [["Bbmaj7", 0], ["C69", 2]], "Dm9", [["Gm9", 0], ["A7sus4", 2]], [["Bbmaj7", 0], ["A7sus4", 2]],
      "Dm9", [["Bbmaj7", 0], ["C69", 2]], [["Gm9", 0], ["A7sus4", 2]],
      "Dmadd9", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]], "Dmadd9", "Dmadd9",
    ];
    const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const nm = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    const segs = [];
    harm.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([c, beat]) => segs.push({ c, o: bar + beat / 4 })));
    const chordAt = (o) => { let c = segs[0].c; for (const s of segs) if (o >= s.o - 1e-9) c = s.c; return c; };
    const pcs = (o) => CHORD[chordAt(o)].map((n) => midi(n) % 12);
    const rootAt = (o, lo = 36) => lo + (((pcs(o)[0] - lo) % 12) + 12) % 12;
    const tones = (o, lo = 62, n = 5) => { const p = pcs(o), out = []; for (let m = lo; out.length < n; m++) if (p.includes(m % 12)) out.push(m); return out; };

    const story = [], melody = [];
    const ev = (o, e) => story.push({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, ...e });
    const mel = (o, dur, n, inst, v, theme = false) => melody.push([Math.floor(o + 1e-9), (o - Math.floor(o + 1e-9)) * 4, dur, typeof n === "number" ? nm(n) : n, inst, v, theme]);
    const theme = (o, inst, v, shift = 0, notes = THEME) => notes.forEach(([b, d, n]) => mel(o + b / 4, d * 0.95, midi(n) + shift, inst, v, true));
    // 一小节 16 格的鼓谱：X 重 x 中 o 轻；map 把字母换成那一章鼓件的 story。
    const VEL = { X: 1, x: 0.75, o: 0.45 };
    function drums(bar, pats, map, from = 0, to = 16) {
      for (const [key, pat] of Object.entries(pats)) for (let k = from; k < to; k++) { const v = VEL[pat[k]]; if (v) ev(bar + k / 16, { ...map[key], v: v * (map[key].v ?? 1) }); }
    }
    const SFX = [];
    const sfx = (o, name, v = 1, pan = 0, rate = 1) => SFX.push([o, name, v, pan, rate]);

    // ---------- 0–2 · 开场：接住第 09 章的 motorik，十块字落下，蓄力，射出去 ----------
    ev(0, { kind: "boom" }); ev(0, { kind: "metro", what: "kick" }); ev(0, { kind: "metro", what: "open", v: 0.8 });
    ev(0, { kind: "metro", what: "bass", m: midi("D2"), len: 2 });
    for (const n of CHORD.Dm9.slice(1)) ev(0, { kind: "metro", what: "str", m: midi(n), len: 4, v: 0.7 });
    for (const n of CHORD.Gm9.slice(1)) ev(1, { kind: "metro", what: "str", m: midi(n), len: 2, v: 0.6 });
    // 每块字落地一声那一章的乐器，音高顺着 D 小调五声往上走。
    const CHIP = [["D5", "reich"], ["F5", "lofiRhodes"], ["G5", "marchTpt"], ["A5", "toonClar"], ["C6", "pluckDark"], ["D6", "jazzVibes"], ["E6", "ping"], ["F6", "chipLead"], ["A6", "kalimba"], ["D7", "metro"]];
    function voice(o, n, kind, v = 0.8, dur = 0.5) {
      if (kind === "reich") ev(o, { kind: "reich", what: "mb", m: midi(n), v });
      else if (kind === "ping") ev(o, { kind: "ping", m: midi(n) });
      else if (kind === "metro") ev(o, { kind: "metro", what: "chime", m: midi(n), v: v * 0.9 });
      else mel(o, dur, n, kind, v);
    }
    CHIP.forEach(([n, k], i) => voice(AT.chip0 + i * AT.chipStep + 0.0625, n, k, 0.75, 0.6));
    sfx(AT.chip0 + 4 * AT.chipStep + 0.0625, "type", 0.5, 0.2);
    drums(0, { k: "X.......X.......", h: "....o.......o..." }, { k: { kind: "metro", what: "kick", v: 0.7 }, h: { kind: "metro", what: "hat" } }, 4, 16);
    ev(AT.env, { kind: "whoosh", tube: 0 }); sfx(AT.env + 0.4, "land", 0.5, -0.2);
    ev(AT.pull[0], { kind: "swell" });
    ev(AT.pull[0], { kind: "march", what: "roll", len: 1.5, cres: true, v: 0.7 });
    ev(AT.pull[0], { kind: "toon", what: "whistle", from: midi("D5"), to: midi("A6"), len: 1.5, v: 0.6 });
    ev(AT.whip1, { kind: "whoosh", tube: "whip", pan: -0.4, panTo: 0.7 });
    ev(AT.whip1, { kind: "march", what: "cymbal", v: 0.6 });

    // ---------- 2–5 · 01 等距小岛：lo-fi，电钢垫底，lofiLead 唱主题 ----------
    const LOFI = { k: { kind: "lofi", what: "kick" }, s: { kind: "lofi", what: "stick" }, h: { kind: "lofi", what: "hat" } };
    for (let bar = 2; bar <= 4; bar++) {
      drums(bar, { k: "X.....x...X.....", s: "....X.......X...", h: "x.x.x.x.x.x.x.xo" }, LOFI, 0, bar === 4 ? 12 : 16);
      for (const o of [bar, bar + 0.625]) for (const m of tones(o, 57, 4)) mel(o, 1.3, m, "lofiRhodes", 0.55);
      mel(bar, 1.6, rootAt(bar), "lofiBass", 0.9); mel(bar + 0.5, 1.4, rootAt(bar + 0.5), "lofiBass", 0.8);
    }
    ev(2, { kind: "lofi", what: "crackle", i: 0 });
    ev(2.25, { kind: "lofi", what: "chime", i: 1 });
    theme(2.5, "lofiLead", 1);
    mel(3.5, 0.5, "D5", "lofiLead", 0.6); mel(3.625, 0.5, "F5", "lofiLead", 0.6); mel(3.75, 1.5, "A5", "lofiLead", 0.7);
    sfx(2.5, "pop", 0.55, -0.2); ev(2.75, { kind: "hop", m: midi("A5"), pan: -0.2 });
    ev(2.82, { kind: "hop", m: midi("D6"), pan: -0.1, v: 0.8 });
    ev(2.375, { kind: "tick", m: midi("A5"), i: 2 }); ev(2.6, { kind: "tick", m: midi("D6"), i: 3 });
    ev(4.75, { kind: "whoosh", tube: "whip", pan: 0.6, panTo: -0.7 });
    ev(4.75, { kind: "march", what: "flam", v: 0.8 });

    // ---------- 5–7.5 · 02 构成主义：工业进行曲，小号吹主题 ----------
    const MARCH = { d: { kind: "march", what: "drum" }, s: { kind: "march", what: "snare" }, f: { kind: "march", what: "flam" } };
    ev(5, { kind: "march", what: "cymbal" });
    for (let bar = 5; bar <= 6; bar++) {
      drums(bar, { d: "X...X...X...X...", s: "....x.......x.x.", f: bar === 6 ? "..............X." : "" }, MARCH);
      mel(bar, 0.9, rootAt(bar, 34), "marchTbn", 0.9); mel(bar + 0.5, 0.9, rootAt(bar + 0.5, 34), "marchTbn", 0.85);
      for (const o of [bar + 0.125, bar + 0.375, bar + 0.625, bar + 0.875]) for (const m of tones(o, 60, 3)) mel(o, 0.3, m, "marchPiano", 0.32);
    }
    drums(7, { d: "X.......", s: "....x..." }, MARCH, 0, 8);
    theme(5, "marchTpt", 1); theme(5, "marchHorn", 0.6, 0, [[0, 0.75, "D4"], [0.75, 0.75, "F4"], [1.5, 0.5, "A4"], [2, 2, "G4"]]);
    mel(6, 0.5, "A4", "marchTpt", 0.7); mel(6.125, 0.5, "D5", "marchTpt", 0.7); mel(6.25, 1, "C#5", "marchTpt", 0.7);
    [0, 1, 2, 3].forEach((i) => ev(5.375 + i * 0.125, { kind: "tick", m: midi(["A5", "C6", "D6", "F6"][i]), i }));
    ev(5.875, { kind: "stamp", size: "mid" });
    ev(5.9375, { kind: "march", what: "clank", i: 2 });
    ev(6.3125, { kind: "march", what: "anvil", m: midi("D6") });
    ev(6.4375, { kind: "whoosh", tube: 0 });
    ev(7, { kind: "lamp", m: midi("D6"), i: 1 }); ev(7, { kind: "march", what: "cymbal", v: 0.9 });
    ev(AT.dive, { kind: "swell" });

    // ---------- 7.5–9.25 · 03 橡皮管卡通：热爵士，大号 oom-pah，单簧管接主题 ----------
    ev(AT.iris, { kind: "toon", what: "pans" }); ev(AT.iris, { kind: "toon", what: "kick" });
    const TOON = { k: { kind: "toon", what: "kick" }, s: { kind: "toon", what: "snare" }, b: { kind: "toon", what: "block" } };
    drums(7, { k: "........X...X...", s: "............x...", b: "..........x...x." }, TOON, 8);
    drums(8, { k: "X...X...X...X...", s: "....x.......x...", b: "..x...x...x...x." }, TOON);
    drums(9, { k: "X...", s: "...." }, TOON, 0, 4);
    for (const o of [7.5, 8, 8.5, 9]) { mel(o, 0.9, rootAt(o, 34), "toonTuba", 0.9); mel(o + 0.25, 0.9, rootAt(o, 34) + 7, "toonTuba", 0.75); }
    for (const o of [7.625, 7.875, 8.125, 8.375, 8.625, 8.875, 9.125]) for (const m of tones(o, 60, 3)) mel(o, 0.25, m, "toonBanjo", 0.6);
    theme(7.5, "toonClar", 1);
    mel(8.5, 0.4, "F5", "toonWah", 0.7); mel(8.625, 0.4, "E5", "toonWah", 0.7); mel(8.75, 1, "D5", "toonWah", 0.7);
    ev(7.8125, { kind: "toon", what: "block", hi: true });
    sfx(7.875, "click", 0.5, 0.1); sfx(7.9375, "click", 0.45, 0.15, 1.1); sfx(8.0, "click", 0.45, 0.2, 1.2);
    ev(8.0625, { kind: "tick", m: midi("D6"), i: 3 });
    ev(8.125, { kind: "toon", what: "whistle", from: midi("A5"), to: midi("D7"), len: 0.75 });
    ev(8.5, { kind: "toon", what: "block", hi: true, v: 0.7 });
    sfx(8.75, "paper", 0.6, 0.2);
    ev(8.8125, { kind: "hop", m: midi("D6"), pan: 0.2 });
    ev(9.0, { kind: "whoosh", tube: 1 });

    // ---------- 9.25–11 · 04 报纸：头版转着飞进来，轮转机的律动，闷音拨弦唱主题 ----------
    sfx(9.25, "paper", 0.6, -0.2, 0.9); sfx(9.375, "paper", 0.55, 0.1); sfx(9.5, "paper", 0.55, 0.3, 1.1);
    ev(9.25, { kind: "whoosh", tube: 2 });
    ev(AT.spin[1], { kind: "stamp", size: "big" }); sfx(AT.spin[1], "printer", 0.5, 0.1);
    theme(9.5, "pluckDark", 1.2);
    for (let bar = 9.625; bar < 11; bar += 0.125) ev(bar, { kind: "clock", type: Math.round(bar * 8) % 2 ? "tock" : "tick", v: 0.6, vol: 0.6 });
    for (const o of [10, 10.5]) ev(o, { kind: "kick", type: "tight", v: 1, duck: 0.5 });
    for (const o of [10.25, 10.75]) ev(o, { kind: "snare", type: "thud", v: 0.8 });
    for (const o of [9.75, 10.125, 10.375, 10.625, 10.875]) ev(o, { kind: "hat", type: "flip", v: 0.8, variant: Math.round(o * 8) % 3, vol: 0.8 });
    mel(10, 1.8, rootAt(10, 38), "pluck", 0.5); mel(10.5, 1.8, rootAt(10.5, 38), "pluck", 0.5);
    sfx(9.6875, "type", 0.55, -0.3); sfx(9.875, "type", 0.55, -0.2); sfx(10.125, "tbell", 0.25, -0.2);
    ev(10.25, { kind: "accent", what: "broadcast" });
    ev(10.375, { kind: "hop", m: midi("A5"), pan: 0.3 });
    ev(10.5625, { kind: "whoosh", tube: 0 });

    // ---------- 11–12.5 · 05 剪纸：冷爵士，刷子和 walking bass，Harmon 弱音小号接主题 ----------
    ev(AT.cut, { kind: "jazz", what: "snip" }); sfx(AT.cut + 0.0625, "zip", 0.45, 0.4);
    const JAZZ = { r: { kind: "jazz", what: "ride" }, c: { kind: "jazz", what: "chick" }, k: { kind: "jazz", what: "kick" } };
    for (const bar of [11, 12]) {
      for (const [bt, v] of [[0, 1], [1, 0.8], [1 + 2 / 3, 0.5], [2, 1], [3, 0.8], [3 + 2 / 3, 0.5]]) if (bar + bt / 4 >= 11.125 && bar + bt / 4 < 12.5) ev(bar + bt / 4, { kind: "jazz", what: "ride", v });
      drums(bar, { c: "....x.......x...", k: "x.........o....." }, JAZZ, bar === 11 ? 2 : 0, bar === 12 ? 8 : 16);
    }
    [["D3", 11.25], ["F3", 11.5], ["A3", 11.75], ["Bb2", 12.0], ["A2", 12.25]].forEach(([n, o]) => mel(o, 0.95, n, "jazzBass", 0.9));
    theme(11.25, "jazzHarmon", 1);
    for (const o of [11.5, 12.0]) for (const m of tones(o, 62, 3)) mel(o, 0.8, m, "jazzVibes", 0.4);
    for (let i = 0; i < 4; i++) ev(11.3125 + i * 0.125, { kind: "morse", m: midi("E6"), v: 0.4, pan: -0.3 + i * 0.2, len: 0.2 });
    ev(11.875, { kind: "jazz", what: "rim" }); sfx(11.875, "pop", 0.5, 0.4);
    sfx(12.0625, "keys", 0.5, 0.3);
    ev(12.4375, { kind: "jazz", what: "bongo", hi: true });
    ev(AT.ink, { kind: "swell" }); ev(AT.ink, { kind: "jazz", what: "ride", i: 1, v: 0.6 });

    // ---------- 12.75–14 · 00 蓝图主页：简约派的马林巴，钢片琴唱主题，E5 落在翻面那一拍 ----------
    const CELL = [0, 2, 4, 1, 3, 2, 0, 4, 3, 1, 2, 4];
    for (let s = Math.round(12.75 * 16); s < 14 * 16; s++) ev(s / 16, { kind: "reich", what: "mb", m: tones(s / 16)[CELL[s % 12]], v: s % 4 ? 0.62 : 0.78 });
    const CLAP = "xxx.x.xx.xx.";
    for (let e = 0; e < 10; e++) if (CLAP[e % 12] === "x") ev(13 + e / 8, { kind: "reich", what: "clap", i: 0, v: 0.7 });
    for (const n of CHORD.Bbmaj7.slice(1)) ev(13, { kind: "reich", what: "breath", m: midi(n), len: 2.5, v: 0.8 });
    ev(13, { kind: "reich", what: "bass", m: midi("Bb1"), len: 2.5, depth: 0.35 });
    theme(13.5, "reichCelesta", 1.1);

    // ---------- 14–17 · 翻面炸开、十格分屏、全体齐奏、收拢 ----------
    ev(AT.flip, { kind: "accent", what: "flip" }); ev(AT.flip, { kind: "boom" });
    ev(AT.flip, { kind: "chipDrum", drum: "crash", v: 0.9 }); ev(AT.flip, { kind: "march", what: "cymbal" }); ev(AT.flip, { kind: "metro", what: "open" });
    for (let k = 0; k < 16; k++) { const T = tones(14 + k / 16, 74, 8); mel(14 + k / 16, 0.3, T[k % 8], "chipArp", 0.5 + 0.03 * k); }
    ev(14.5, { kind: "march", what: "roll", len: 2, cres: true });
    drums(14, { k: "X.......X.......", s: "............X.X." }, { k: { kind: "metro", what: "kick" }, s: { kind: "metro", what: "snare" } });
    // 全体齐奏：十章的主奏一起唱信封主题，第 16 小节再加一层三度。
    const TUTTI = [["lofiLead", 0.55, 0], ["marchTpt", 0.55, 0], ["toonClar", 0.5, 0], ["pluckDark", 0.6, -12], ["jazzHarmon", 0.5, 0], ["reichCelesta", 0.55, 12], ["chipLead", 0.4, 12], ["kalimba", 0.5, 0], ["bell", 0.5, 12]];
    for (const [inst, v, sh] of TUTTI) theme(AT.tutti, inst, v, sh);
    let prev = midi("A4");
    for (const [bt, d, n] of THEME) { ev(AT.tutti + bt / 4, { kind: "metro", what: "lead", m: midi(n), from: prev, len: d * 0.95, v: 0.8 }); prev = midi(n); }
    const THIRDS = [[0, 0.75, "C5"], [0.75, 0.75, "F5"], [1.5, 0.5, "A5"], [2, 1.5, "G5"]];
    for (const [inst, v, sh] of TUTTI.slice(0, 6)) { theme(16, inst, v * 0.9, sh, THEME.map(([b, d, n]) => [b, Math.min(d, 1.5), n])); theme(16, inst, v * 0.7, sh, THIRDS); }
    for (let bar = 15; bar <= 16; bar++) {
      drums(bar, { k: "X...X...X...X...", s: "....X.......X...", h: "o.x.o.x.o.x.o.x." }, { k: { kind: "metro", what: "kick" }, s: { kind: "march", what: "snare", v: 0.8 }, h: { kind: "metro", what: "hat" } }, 0, bar === 16 ? 8 : 16);
      for (const o of [bar, bar + 0.5]) { ev(o, { kind: "metro", what: "bass", m: rootAt(o, 38), len: 1.8 }); for (const m of tones(o, 57, 4)) mel(o, 1.8, m, "marchStr", 0.6); }
    }
    ev(15, { kind: "chipDrum", drum: "crash", v: 0.8 }); ev(16, { kind: "march", what: "cymbal", v: 0.8 });
    ev(16.5, { kind: "toon", what: "whistle", from: midi("D7"), to: midi("D5"), len: 1 });
    ev(16.5, { kind: "whoosh", tube: "down" });
    ev(16.75, { kind: "swell" });

    // ---------- 17–22 · 谢幕：Dmadd9；冒出来、鞠躬各一声自己那一章的乐器，一起鞠躬时全体一个和弦 ----------
    ev(AT.drop, { kind: "boom" }); ev(AT.drop, { kind: "march", what: "cymbal", v: 0.5 });
    for (let i = 0; i < 10; i++) sfx(AT.drop + i * 0.03, "whoosh", 0.18, -0.8 + i * 0.18, 1.2);
    const BOW = ["D5", "E5", "F5", "A5", "C6", "D6", "E6", "F6", "A6", "D7"];
    for (let i = 0; i < 10; i++) ev(Math.round((AT.pop + i * AT.popStep) * 64) / 64, { kind: "hop", m: midi(BOW[i]) - 12, v: 0.5, pan: -0.8 + i * 0.18 });
    for (const n of ["D5", "F5", "A5", "E6"]) mel(AT.thanks, 3, n, "bell2", 0.4);
    mel(AT.thanks, 3, "D6", "bell", 0.6);
    CHIP.forEach(([, k], i) => voice(AT.bow1 + i * AT.bowStep, BOW[i], k, 0.7, 0.8));
    for (const [inst, v] of [["marchTpt", 0.45], ["toonClar", 0.45], ["lofiRhodes", 0.5], ["jazzVibes", 0.5], ["kalimba", 0.5]]) for (const n of ["D5", "F5", "A5"]) mel(AT.bow2, 0.9, n, inst, v);
    ev(AT.bow2, { kind: "reich", what: "mb", m: midi("D5") }); ev(AT.bow2, { kind: "metro", what: "chime", m: midi("A6"), v: 0.6 });
    ev(AT.bow2 + 0.0625, { kind: "chipFx", fx: "p4,0.05,74;p4,0.05,81;p4,0.05,86;p4,0.14,93,93,d", v: 0.7, pan: 0.4 });
    ev(AT.cheer, { kind: "toon", what: "whistle", from: midi("D5"), to: midi("D6"), len: 0.5 });
    [0, 0.0625, 0.125].forEach((d, j) => ev(AT.cheer + d, { kind: "hop", m: midi(["A5", "D6", "F6"][j]), v: 0.6, pan: -0.4 + j * 0.4 }));
    ev(AT.leave, { kind: "toon", what: "whistle", from: midi("A6"), to: midi("A4"), len: 1 });
    sfx(AT.leave + 0.15, "land", 0.45, 0);
    ev(AT.lift, { kind: "clear" }); ev(AT.lift, { kind: "swell" });
    for (const n of CHORD.Dmadd9.slice(1)) ev(AT.lift, { kind: "reich", what: "breath", m: midi(n), len: 6, v: 0.7, depth: 0.4 });
    ev(AT.lift, { kind: "reich", what: "bass", m: midi("D2"), len: 6, depth: 0.3 });
    mel(21, 4, "D6", "reichCelesta", 0.5); mel(21.5, 2, "A5", "bell2", 0.3);

    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "fin-open", name: "0:0 接住第 09 章的 motorik：boom、底鼓、贝斯 D；十块字各落一声那一章的乐器；1.5 蓄力，1.875 甩出去", energy: 0.45, pad: 0, lp: 1800, padVerb: 0 },
        { from: 2, to: 4, id: "fin-iso", name: "01 等距小岛：lo-fi，lofiLead 2:2 唱主题；4:3 甩镜头", energy: 0.55, pad: 0.25, lp: 1600, padVerb: 0.3 },
        { from: 5, to: 6, id: "fin-march", name: "02 构成主义：进行曲，小号 5:0 吹主题；验 JWT 四声、盖章、抬杆、齿轮、冲进灯", energy: 0.7, pad: 0.2, lp: 2200, padVerb: 0.25 },
        { from: 7, to: 8, id: "fin-toon", name: "7:2 光圈张开，橡皮管卡通：大号、班卓、单簧管接主题；纸条折成纸飞机", energy: 0.7, pad: 0.15, lp: 2200, padVerb: 0.2 },
        { from: 9, to: 10, id: "fin-press", name: "9:1 头版转着飞进来，9:2.5 拍平；轮转机的钟摆，闷音拨弦唱主题，10:1 推送出发", energy: 0.6, pad: 0.25, lp: 1800, padVerb: 0.3 },
        { from: 11, to: 12, id: "fin-wire", name: "11:0 剪刀剪进剪纸：冷爵士，Harmon 11:1 唱主题，电码沿线跑；12:2 蓝墨吃进来", energy: 0.6, pad: 0.25, lp: 1800, padVerb: 0.3 },
        { from: 13, to: 13, id: "fin-plan", name: "00 蓝图主页：马林巴、拍手、钢片琴 13:2 唱主题，E5 落在 14:0 翻面", energy: 0.6, pad: 0.3, lp: 1800, padVerb: 0.35 },
        { from: 14, to: 16, id: "fin-tutti", name: "14:0 炸成十格：琶音和滚奏；15:0 全体齐奏主题，16:0 加三度；16:2 下坠，16:3 吸一口气", energy: 0.95, pad: 0.55, lp: 3200, padVerb: 0.35 },
        { from: 17, to: 20, id: "fin-bow", name: "谢幕：Dmadd9，幕布落下、Clawd 冒出来、挨个鞠躬各一声、一起鞠躬一个和弦、庆祝、跳下台", energy: 0.4, pad: 0.6, lp: 1600, padVerb: 0.45 },
        { from: 21, to: 21, id: "fin-tail", name: "幕布升起回到第 00 章的终端，长音放着，从同一个和弦接回第 00 章", energy: 0.15, pad: 0.45, lp: 1000, padVerb: 0.5 },
      ],
      melody,
      story,
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
