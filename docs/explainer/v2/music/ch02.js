(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch02",
  seed: 108,
  chords: {
    marchDm: ["D3", "A3", "D4", "F4"], marchA: ["A2", "E3", "A3", "C#4"], marchEb: ["Eb3", "Bb3", "Eb4", "G4"], marchGm: ["G2", "D3", "G3", "Bb3"],
    marchBb: ["Bb2", "F3", "Bb3", "D4"], marchC: ["C3", "G3", "C4", "E4"], marchF: ["F2", "C3", "F3", "A3"], marchD: ["D3", "A3", "D4", "F#4"],
  },
  score: ({ THEME, phrase, midi }) => {
    // 时刻（小节）与 ch02.js 的 AT 是同一张表：闸杆、钥匙、403、六道检查、<html> 掉进废料箱、齿轮、四根管子、穿墙、三盏灯、202、冲进灯里。
    const AT = {
      leap: 0.5, land: 1.125, arms: 0.75, keyMac: 1.95, doorMac: 2.0, shutMac: 3.0, keyEmby: 3.45, e403: 3.5, keyHa: 3.95, doorHa: 4.0, keyPs: 4.075, doorPs: 4.125, exit: 4.9,
      checks: [6.5, 7.0, 7.5, 8.0, 8.5], press: 9.0, html: 9.25, htmlGates: [9.5, 9.625, 9.75, 9.875], s400: 10.0, trap: 10.25, bin: 10.55,
      gear: 11.5, tokens: [12.0, 12.125, 12.25, 12.5, 12.75], serverIn: 13.3, server: 14.0, fork: 14.5, rtOut: 15.75,
      flange: 17.0, core: 17.25, hub: 17.5, commit: 17.75, reply: 18.0, slide: 21.4,
      lamps: [22.5, 23.0, 23.5], drop: 22.65, d1Start: 22.75, horn: 23.75, s202: 24.0, d1Done: 24.25, fail: 25.05, dive: 29.2,
    };
    // 甩镜头的那口风中点最响，对准每段镜头运动的中点（ch02.js 的 MOVES）。
    const MOVES = [[5.45, 6.05, 1], [10.75, 11.35, 1], [16.35, 16.95, 1], [21.95, 22.5, -1], [27.5, 28.4, 1]];
    const WHIP_BARS = 0.62 / ((60 / 108) * 4);
    const Dm = "marchDm", A = "marchA", Eb = "marchEb", Gm = "marchGm", Bb = "marchBb", C = "marchC", F = "marchF", D = "marchD";
    const harm = [
      [[Dm, 0], [A, 2]], Dm, Dm, [[Dm, 0], [Eb, 2]], [[Gm, 0], [A, 2]], Dm,
      Dm, Bb, Gm, A, [[Eb, 0], [A, 2]],
      Dm, Dm, Bb, Gm, [[C, 0], [A, 2]], Dm,
      Dm, F, Bb, Gm, [[Gm, 0], [A, 2]],
      Dm, [[F, 0], [A, 2]], D, Dm, Bb, [[Gm, 0], [A, 2]],
      Dm, [["A7sus4", 0], ["A7", 2]],
    ];
    // 每个和弦：低音铜管的根音与五音、钢琴的低八度、圆号三个音、小号三个音
    const V = {
      [Dm]: { lo: ["D2", "A1"], pno: ["D1", "D2"], hn: ["A3", "D4", "F4"], tp: ["D5", "F5", "A5"] },
      [A]: { lo: ["A1", "E2"], pno: ["A0", "A1"], hn: ["A3", "C#4", "E4"], tp: ["C#5", "E5", "A5"] },
      [Eb]: { lo: ["Eb2", "Bb1"], pno: ["Eb1", "Eb2"], hn: ["G3", "Bb3", "Eb4"], tp: ["Eb5", "G5", "Bb5"] },
      [Gm]: { lo: ["G1", "D2"], pno: ["G1", "G2"], hn: ["G3", "Bb3", "D4"], tp: ["D5", "G5", "Bb5"] },
      [Bb]: { lo: ["Bb1", "F2"], pno: ["Bb0", "Bb1"], hn: ["F3", "Bb3", "D4"], tp: ["D5", "F5", "Bb5"] },
      [C]: { lo: ["C2", "G1"], pno: ["C1", "C2"], hn: ["G3", "C4", "E4"], tp: ["C5", "E5", "G5"] },
      [F]: { lo: ["F1", "C2"], pno: ["F1", "F2"], hn: ["F3", "A3", "C4"], tp: ["C5", "F5", "A5"] },
      [D]: { lo: ["D2", "A1"], pno: ["D1", "D2"], hn: ["A3", "D4", "F#4"], tp: ["D5", "F#5", "A5"] },
      A7sus4: { lo: ["A1", "E2"], pno: ["A0", "A1"], hn: ["G3", "A3", "D4"], tp: ["D5", "E5", "G5"] },
      A7: { lo: ["A1", "E2"], pno: ["A0", "A1"], hn: ["G3", "C#4", "E4"], tp: ["C#5", "E5", "G5"] },
    };
    const chordAt = (bar, beat) => { const h = harm[bar]; if (typeof h === "string") return h; let c = h[0][0]; for (const [n, b] of h) if (beat >= b) c = n; return c; };
    const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    const nm = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
    const at = (o) => { const bar = Math.floor(o + 1e-9); return [bar, Math.round((o - bar) * 4 * 1000) / 1000]; };
    const mel = [], story = [];
    const N = (bar, beat, dur, n, inst, v, theme = false) => mel.push([bar, beat, dur, n, inst, v, theme]);
    const H = (bar, beat, what, o = {}) => story.push({ bar, beat, kind: "march", what, ...o });
    const Ho = (o, what, x = {}) => { const [bar, beat] = at(o); H(bar, beat, what, x); };
    const No = (o, dur, n, inst, v) => { const [bar, beat] = at(o); N(bar, beat, dur, n, inst, v); };
    const So = (o, kind, x = {}) => { const [bar, beat] = at(o); story.push({ bar, beat, kind, ...x }); };

    // 军鼓 16 格：X 带倚音的重音，x 中，o 轻
    const SN = { march: "X..ox.x.X..ox.xo", drive: "X.oxx.xoX.oxx.xx", tap: "x...o...x...o..." };
    function snare(bar, p, v, from = 0, to = 4) {
      for (let s = 0; s < 16; s++) {
        const ch = p[s], b = s / 4;
        if (ch === "." || b < from || b >= to) continue;
        H(bar, b, ch === "X" ? "flam" : "snare", { v: v * { X: 1, x: 0.7, o: 0.38 }[ch] });
      }
    }
    // 进行曲的底（oom-pah）：低音铜管踩附点，1、3 拍重、前面带一个十六分的弱音；钢琴在 1、3 拍砸低八度，圆号在 2、4 拍补和弦；
    // 每小节最后一个十六分是下一小节根音底下的半音，像机器换挡前那一下。from / to 截一段拍子，v 整体乘。
    function march(bar, o = {}) {
      const v = o.v ?? 1, from = o.from ?? 0, to = o.to ?? 4;
      for (const [s, w, len, vv] of [[0, 0, 0.45, 1], [3, 0, 0.2, 0.5], [4, 0, 0.35, 0.72], [8, 1, 0.45, 0.92], [11, 1, 0.2, 0.5], [12, 1, 0.35, 0.72]]) {
        const b = s / 4;
        if (b < from || b >= to) continue;
        const c = V[chordAt(bar, b)], turn = chordAt(bar, b) !== chordAt(bar, 0);
        if (o.lo !== false) N(bar, b, len, c.lo[turn ? 0 : w], "marchTbn", v * vv);
        if (o.pno !== false && (s === 0 || s === 8)) c.pno.forEach((n) => N(bar, b, 1.6, n, "marchPiano", v * (s ? 0.7 : 0.85)));
        if (o.hn !== false && (s === 4 || s === 12)) c.hn.forEach((n) => N(bar, b, 0.32, n, "marchHorn", v * 0.55));
        if (o.drum !== false && (s === 0 || s === 8)) H(bar, b, "drum", { v: v * (s ? 0.72 : 0.92) });
      }
      if (o.lead !== false && to >= 4 && bar + 1 < harm.length) N(bar, 3.75, 0.2, nm(midi(V[chordAt(bar + 1, 0)].lo[0]) - 1), "marchTbn", v * 0.6);
      if (o.snare) snare(bar, SN[o.snare], v * (o.snareV ?? 0.8), from, to);
    }
    // 铜管和弦：圆号、小号叠在同一个和弦上，加一记对镲（long 为假时捂住）；tutti 再加低音铜管两个八度、钢琴低八度和大鼓。
    // 各声部错开几毫秒进来，像真乐队那样不齐；起音全对齐时峰值叠得太高。
    function brass(o, chord, len, v = 1, x = {}) {
      const [bar, beat] = at(o), c = V[chord];
      c.hn.forEach((n, i) => N(bar, beat + 0.012 * (i + 1), len, n, "marchHorn", v * 0.8));
      if (x.tp !== false) c.tp.forEach((n, i) => N(bar, beat + 0.02 + 0.01 * i, len, n, "marchTpt", v * 0.45));
      H(bar, beat + 0.015, x.long ? "cymbal" : "choke", { v: v * 0.9 });
    }
    function tutti(o, chord, len, v = 1, x = {}) {
      const [bar, beat] = at(o), c = V[chord];
      brass(o, chord, len, v, x);
      N(bar, beat, len, c.lo[0], "marchTbn", v);
      N(bar, beat + 0.008, len, nm(midi(c.lo[0]) + 12), "marchTbn", v * 0.75);
      c.pno.forEach((n) => N(bar, beat, 2, n, "marchPiano", v * 0.7));
      H(bar, beat, "drum", { v: v * 0.7 });
    }
    const roll = (o0, o1, v, cres = true) => { const [bar, beat] = at(o0); H(bar, beat, "roll", { len: Math.round((o1 - o0) * 4 * 1000) / 1000, cres, v }); };

    // 0 从第 01 章的甩镜头里刹进来，军鼓一记重音接住：小号在军鼓滚奏上唱信封主题，第 3 拍 Clawd 起跳、全队落在 A 上；闸杆从第 3 拍起每个八分落一根，一根比一根高
    mel.push(...phrase(0, THEME, "marchTpt", 1, true));
    H(0, 0, "drum", { v: 0.85 }); H(0, 0, "flam", { v: 1 }); V[Dm].pno.forEach((n) => N(0, 0, 2, n, "marchPiano", 0.75));
    roll(0, 0.5, 0.6);
    tutti(AT.leap, A, 1.8, 0.62, { tp: false });
    So(AT.leap, "hop", { m: midi("A5"), v: 0.7, pan: -0.35 });
    for (let i = 0; i < 9; i++) Ho(AT.arms + i * 0.125, "clank", { i, v: 0.5 + 0.03 * i, pan: -0.7 + 0.17 * i });

    // 1 闸杆还在落：低音铜管轻轻起步，钢琴只在第 1 拍；Clawd 落地
    march(1, { v: 0.5, hn: false, drum: false });

    // 2–5 钥匙与门：进行曲走起来；mac 的钥匙拧开第一扇门，emby 的钥匙去开 /mac、拧不动：403 全队落在降 E 上（降 Ⅱ 级，刺耳）
    So(AT.keyMac, "key", { pan: -0.55 });
    march(2, { v: 0.8, snare: "march", snareV: 0.7 });
    march(3, { v: 0.8, to: 2, snare: "march", snareV: 0.7 });
    So(AT.keyEmby, "key", { v: 0.6, pan: -0.55 });
    tutti(AT.e403, Eb, 0.9, 0.95);
    H(3, 3, "snare", { v: 0.5 }); H(3, 3.5, "snare", { v: 0.6 });
    N(3, 3.75, 0.2, "F#1", "marchTbn", 0.55);
    So(AT.keyHa, "key", { pan: -0.2 }); So(AT.keyPs, "key", { v: 0.85, pan: 0.1 });
    march(4, { v: 0.8, snare: "march", snareV: 0.7 });
    So(AT.exit, "hop", { m: midi("D6"), v: 0.7, pan: 0.45 });
    march(5, { v: 0.75, to: 2, snare: "march", snareV: 0.65 });
    roll(5.5, 6.0, 0.55);

    // 6–10 检查单：每过一道闸一声铁砧，一声比一声高，第六道是压机；<html> 一路快过前四道（同样四个音，快一倍），第五道全队 400
    march(6, { v: 0.78, snare: "drive", snareV: 0.6 });
    march(7, { v: 0.78, snare: "drive", snareV: 0.6 });
    march(8, { v: 0.8, snare: "drive", snareV: 0.65 });
    const CHECK = ["D6", "F6", "G6", "A6", "C7"];
    AT.checks.forEach((o, i) => { Ho(o, "anvil", { m: midi(CHECK[i]), v: 0.8 + 0.04 * i }); Ho(o, "clank", { i: 2 + i, v: 0.28, pan: 0.3 }); });
    tutti(AT.press, A, 0.6, 0.7, { tp: false });
    Ho(AT.press, "anvil", { m: midi("D7"), v: 1 }); Ho(AT.press, "clank", { i: 1, v: 0.55 });
    march(9, { v: 0.7, from: 1, to: 2, hn: false, drum: false });
    H(9, 1, "snare", { v: 0.45 }); H(9, 1.5, "snare", { v: 0.5 });
    AT.htmlGates.forEach((o, i) => { Ho(o, "anvil", { m: midi(CHECK[i]), v: 0.6 }); Ho(o, "snare", { v: 0.45 + 0.06 * i }); });
    tutti(AT.s400, Eb, 0.8, 1);
    Ho(AT.trap, "clank", { i: 0, v: 0.7 });
    ["Eb2", "D2", "C#2", "C2"].forEach((n, i) => No(AT.trap + 0.0625 * i, 0.22, n, "marchTbn", 0.6 - 0.08 * i));
    march(10, { v: 0.6, from: 2, hn: false, drum: false, lead: false });
    roll(10.75, 11.0, 0.5);

    // 11–16 分拣机：齿轮咬住命令那一下全队落拍，圆号齐奏一支进行曲；令牌一块一块滑进管子（实时三块同一个音，可滞后、凭据各一个），
    // 服务器那封进来齿轮又转半圈，分叉两路气动管；阀门一开，火花进了实时那根管子
    march(11, { v: 0.85, snare: "march", snareV: 0.7 });
    Ho(AT.gear, "clank", { i: 1, v: 0.9 }); Ho(AT.gear, "cymbal", { v: 0.6 });
    N(11, 2, 0.8, "D3", "marchTbn", 0.6);
    march(12, { v: 0.85, snare: "drive", snareV: 0.6 });
    ["A6", "A6", "A6", "F6", "D6"].forEach((n, i) => Ho(AT.tokens[i], "anvil", { m: midi(n), v: 0.5, pan: i < 3 ? 0.35 : -0.35 }));
    march(13, { v: 0.85, snare: "march", snareV: 0.7 });
    march(14, { v: 0.85, snare: "march", snareV: 0.7 });
    Ho(AT.server, "clank", { i: 3, v: 0.75 });
    march(15, { v: 0.85, snare: "drive", snareV: 0.65 });
    march(16, { v: 0.8, to: 2, snare: "march", snareV: 0.6 });
    const TUNE = [
      [[0, 0.75, "D5"], [0.75, 0.25, "D5"], [1, 1, "A4"], [2, 0.75, "Bb4"], [2.75, 0.25, "A4"], [3, 1, "G4"]],
      [[0, 0.75, "F4"], [0.75, 0.25, "G4"], [1, 1, "A4"], [2, 2, "D4"]],
      [[0, 0.75, "D5"], [0.75, 0.25, "D5"], [1, 1, "Bb4"], [2, 0.75, "C5"], [2.75, 0.25, "Bb4"], [3, 1, "A4"]],
      [[0, 0.75, "G4"], [0.75, 0.25, "A4"], [1, 1, "Bb4"], [2, 2, "D5"]],
      [[0, 0.75, "E5"], [0.75, 0.25, "E5"], [1, 1, "G5"], [2, 0.75, "E5"], [2.75, 0.25, "C#5"], [3, 1, "A4"]],
      [[0, 2, "D5"]],
    ];
    TUNE.forEach((notes, i) => notes.forEach(([b, d, n]) => N(11 + i, b, d * 0.9, n, "marchHorn", 0.8)));
    roll(16.5, 17.0, 0.55);

    // 17 穿墙：停奏，一拍一下（法兰、StateCore、StateHub、提交），提交那一下亮一个小调和弦；18 回执顺着管子回来，进行曲接上
    Ho(AT.flange, "clank", { i: 2, v: 0.85 }); Ho(AT.flange, "drum", { v: 0.9 }); No(AT.flange, 0.45, "D2", "marchTbn", 0.9);
    Ho(AT.core, "anvil", { m: midi("A6"), v: 0.8 }); V[Dm].hn.forEach((n) => No(AT.core, 0.45, n, "marchHorn", 0.6));
    Ho(AT.hub, "drum", { v: 0.85 }); V[Dm].pno.forEach((n) => No(AT.hub, 1.2, n, "marchPiano", 0.9)); No(AT.hub, 0.45, "A1", "marchTbn", 0.85);
    tutti(AT.commit, Dm, 1.1, 0.8, { long: true });
    Ho(AT.commit, "anvil", { m: midi("D7"), v: 0.9 });
    march(18, { v: 0.75, snare: "march", snareV: 0.6 });

    // 19–21 只认绑定、不再验钥匙：进行曲收成大鼓和低音，震音弦乐垫着；回执顺着墙往下滑，低音一步一步往下走到第一盏灯
    march(19, { v: 0.55, hn: false, snare: "tap", snareV: 0.5 });
    march(20, { v: 0.55, hn: false, snare: "tap", snareV: 0.5 });
    march(21, { v: 0.55, hn: false, to: 2, snare: "tap", snareV: 0.5 });
    for (const [bar, notes] of [[19, ["F3", "Bb3", "D4"]], [20, ["G3", "Bb3", "D4"]], [21, ["G3", "Bb3", "D4"]]]) notes.forEach((n) => N(bar, 0, bar === 21 ? 2 : 4, n, "marchStr", 1));
    ["E3", "A3", "C#4"].forEach((n) => N(21, 2, 2, n, "marchStr", 1));
    [[21, 2, "A2"], [21, 3, "G2"], [22, 0, "F2"], [22, 1, "E2"]].forEach(([bar, b, n]) => N(bar, b, 0.8, n, "marchTbn", 0.75));
    roll(21.5, 22.5, 0.5);

    // 22–23 三盏灯一盏一个和弦（Dm、F、A），一盏比一盏亮；D1 那路虚线另起、不等；Clawd 举起喇叭，滚奏推到 202
    tutti(AT.lamps[0], Dm, 1.5, 0.7, { tp: false }); Ho(AT.lamps[0], "anvil", { m: midi("D6"), v: 0.8 });
    Ho(AT.d1Start, "clank", { i: 5, v: 0.3, pan: -0.5 });
    tutti(AT.lamps[1], F, 1.5, 0.78, { tp: false }); Ho(AT.lamps[1], "anvil", { m: midi("F6"), v: 0.85 });
    tutti(AT.lamps[2], A, 1, 0.86, { tp: false }); Ho(AT.lamps[2], "anvil", { m: midi("A6"), v: 0.9 });
    for (const o of [22.875, 23.125, 23.375, 23.625]) No(o, 0.2, "D2", "marchTbn", 0.45);
    ["D3", "A3"].forEach((n) => N(22, 2, 6, n, "marchStr", 0.9));
    roll(AT.horn, AT.s202, 0.75);

    // 24 202：全队落在 D 大调上，小号往上吹一句；D1 归档那一声晚一拍、远远的；25 起失败时怎么退，回到小调，进行曲接着走
    tutti(AT.s202, D, 1.5, 0.95, { long: true });
    N(24, 1.5, 0.5, "F#5", "marchTpt", 0.7); N(24, 2, 1.8, "A5", "marchTpt", 0.8);
    march(24, { v: 0.85, from: 2, snare: "drive", snareV: 0.7 });
    Ho(AT.d1Done, "anvil", { m: midi("D6"), v: 0.4, pan: -0.6 });
    V[Dm].hn.forEach((n) => N(25, 0, 0.9, n, "marchHorn", 0.6));
    march(25, { v: 0.72, snare: "march", snareV: 0.6 });
    march(26, { v: 0.72, snare: "march", snareV: 0.6 });
    march(27, { v: 0.72, to: 2, snare: "march", snareV: 0.6 });
    TUNE.slice(0, 2).forEach((notes, i) => notes.forEach(([b, d, n]) => N(25 + i, b, d * 0.9, n, "marchTpt", 0.45)));
    roll(27.5, 28.0, 0.6);

    // 28 拉远看整张海报：全队一小节，小号吹到 E；29 停在 A7sus4，冲进状态核心那盏灯，母线扫频往下关，第 03 章 0:0 最闷
    brass(28, Dm, 1, 1, { long: true });
    march(28, { v: 0.95, snare: "drive", snareV: 0.75 });
    [[0, 0.75, "D5"], [0.75, 0.25, "D5"], [1, 1, "A5"], [2, 0.5, "Bb5"], [2.5, 0.5, "A5"], [3, 0.5, "G5"], [3.5, 0.5, "E5"]].forEach(([b, d, n]) => N(28, b, d, n, "marchTpt", 0.75));
    tutti(29, "A7sus4", 1.8, 0.9);
    // 淡出黑时不掐断：滚奏推到 29:3.75 的一记对镲上，镲和低音的 A 拖过 30:0 自己衰减，接第 03 章从黑里淡入
    ["G3", "C#4", "E4"].forEach((n) => N(29, 2, 1.6, n, "marchHorn", 0.45)); N(29, 2, 3, "A1", "marchTbn", 0.5);
    roll(29.5, 29.9375, 0.45);
    H(29, 3.75, "cymbal", { v: 0.8 });
    story.push({ bar: 29, beat: 1.75, kind: "whoosh", tube: "down" });

    MOVES.forEach(([a, b, dir]) => So((a + b) / 2 - WHIP_BARS / 2, "whoosh", { tube: "whip", v: 0.6, pan: -0.5 * dir, panTo: 0.5 * dir }));

    const SFX = [
      // 火花带着 Clawd 从左缘冲进来。放在 0.03125 小节：score.js#SFX_LEAD 把它往前提的那一点不越过本章开头。
      [0.03125, "whoosh", 0.45, -0.55],
      [AT.land, "land", 0.3, 0.2],
      [AT.doorMac, "zip", 0.25, -0.65, 0.7], [AT.shutMac, "land", 0.28, -0.65, 1.2],
      [AT.e403, "stamp", 0.85, -0.6], [AT.e403, "land", 0.35, -0.6],
      [AT.doorHa, "zip", 0.25, -0.3, 0.7], [AT.doorPs, "zip", 0.25, -0.1, 0.75],
      [AT.press, "stamp", 0.55, 0.2, 0.85],
      [AT.s400, "stamp", 0.95, 0.3], [AT.s400, "land", 0.4, 0.3],
      [AT.bin - 0.05, "paper", 0.35, 0.4], [AT.bin, "knock", 0.3, 0.4],
      [AT.fork, "tube", 0.4, -0.45], [AT.fork + 0.02, "tube", 0.35, 0.45, 1.15],
      [AT.rtOut, "valve", 0.4, 0.25], [AT.rtOut, "tube", 0.45, 0.5, 0.9], [AT.reply, "tube", 0.4, -0.5, 1.1],
      ...AT.lamps.map((o, i) => [o, "click", 0.45, -0.2 + 0.2 * i]),
      [AT.drop, "land", 0.35, -0.3],
      [AT.s202, "stamp", 1.05, 0.15], [AT.s202, "land", 0.45, 0.15],
    ];
    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "march-gate", name: "甩进来、军鼓一记重音：小号在军鼓滚奏上唱信封主题，闸杆每个八分落一根、一根比一根高", energy: 0.5 },
        { from: 2, to: 5, id: "march-keys", name: "钥匙与门：低音铜管踩附点的进行曲，emby 的钥匙拧不动，403 全队落在降 E 上", energy: 0.6 },
        { from: 6, to: 10, id: "march-checks", name: "检查单：每过一道闸一声铁砧、一声比一声高，第六道是压机；<html> 快过四道，第五道全队 400", energy: 0.75 },
        { from: 11, to: 16, id: "march-sort", name: "分拣机：齿轮咬住命令，令牌滑进四根管子，服务器那封绕开状态核心，阀门一开火花进管", energy: 0.85 },
        { from: 17, to: 21, id: "march-wall", name: "穿墙：一拍一下的停奏（法兰、StateCore、StateHub、提交），回执原路回来；之后只剩大鼓、低音和震音弦乐", energy: 0.55 },
        { from: 22, to: 27, id: "march-lamps", name: "三盏灯一盏一个和弦，Clawd 举喇叭，202 全队落在 D 大调；失败时回到小调，进行曲接着走", energy: 0.8 },
        { from: 28, to: 29, id: "march-poster", name: "拉远看整张海报：全队一小节，A7sus4 上冲进状态核心那盏灯，滚奏推到一记对镲，镲和低音拖进第 03 章", energy: 0.7 },
      ].map((s) => ({ pad: 0, lp: 1200, padVerb: 0, ...s })),
      melody: mel,
      story,
      sweeps: [{ at: [29, 2], down: [30, 0], up: [30, 1], f: 380 }],
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
