(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch09",
  tone: { bell: "bright", pluckPan: 0, snareVerb: 0.12 },
  chords: {
    Dsus2: ["D3", "A3", "D4", "E4"],
    Am7: ["A2", "E3", "G3", "C4"],
    Ebmaj7s11: ["Eb3", "Bb3", "D4", "F4", "A4"],
    A9sus4: ["A2", "E3", "G3", "B3", "D4"],
  },
  // 整章的声音都在 score.js 以 metro 开头的那一块（鼓机、方波贝斯、音序器、弦乐机、主奏、报站铃、翻牌、哨子），所以 pad 关掉，melody 也不用。
  score: ({ THEME, midi, CHORD }) => {
    // 拍位（小节）与 ch09.js 顶部的 AT 是同一张表，两边一起改。
    const AT = {
      board: [0.25, 0.875], diff: 0.625, head: 1.0, cap: 1.5, whistle: 2.0, gate0: 2.25, gateStep: 0.0625, depart: 3.0,
      term: { collector: 4.5, ingress: 4.75, core: 5.25, ci: 5.5, codeql: 6.5 },
      contract: 6.0, sched: 6.75, whip: 7.625,
      land: 8.0, xfer: 8.25, me: 8.5, hop1: 8.625, dep: 8.75, purge: 9.25, esa: 9.75, com: 10.0, hop2: 10.125, notify: 10.25, pan: 10.75,
      ing: 11.25, core: 11.5, room: 11.75, theme: 12.0, ask: 12.5, card: 13.0, reload: 13.5,
      full: 14.25, plate: 14.75, dive: 16.0,
    };
    const harm = [
      "Dsus2", [["Dsus2", 0], ["Am7", 2]], "Dm9", "Dm9",
      "Bbmaj7", "C69", "Dm9", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", "Bbmaj7", "Fmaj7", [["C69", 0], ["A7sus4", 2]],
      "Dm9", "Bbmaj7", [["Gm9", 0], ["Fmaj7", 2]], "Dm9", [["Ebmaj7s11", 0], ["A9sus4", 2]],
    ];
    const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const nm = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    const segs = [];
    harm.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([c, beat]) => segs.push({ c, o: bar + beat / 4 })));
    const chordAt = (o) => { let c = segs[0].c; for (const s of segs) if (o >= s.o - 1e-9) c = s.c; return c; };
    const pcs = (name) => CHORD[name].map((n) => midi(n) % 12);
    const rootAt = (o) => 36 + (((pcs(chordAt(o))[0] - 36) % 12) + 12) % 12;
    const rnd = (() => { let a = 909; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();

    const story = [];
    const ev = (o, e) => story.push({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, ...e });
    const M = (o, what, e = {}) => ev(o, { kind: "metro", what, ...e });
    const chime = (o, n, v = 1, pan) => M(o, "chime", { m: midi(n), v, ...(pan == null ? {} : { pan }) });

    // 弦乐机：同一个和弦连着就一直按住，换和弦才重按；根音交给贝斯，弦乐只拉上面几个音。最后一个和弦只拉一拍多，留出 16:3 那口气。
    const runs = [];
    for (const s of segs) { const last = runs[runs.length - 1]; if (last && last.c === s.c) continue; if (last) last.end = s.o; runs.push({ c: s.c, o: s.o }); }
    runs[runs.length - 1].end = 16.8125;
    for (const r of runs) for (const n of CHORD[r.c].slice(1)) M(r.o, "str", { m: midi(n), len: (r.end - r.o) * 4, v: r.o < 2 ? 0.8 : 1 });

    // 鼓机：一小节 16 格，X 重 x 中 o 轻；k 底鼓、s 军鼓、h 闭镲、O 开镲、c 轨缝（成对的一声高一声低，就是车轮压过接缝）。
    const KIT = { k: "kick", s: "snare", h: "hat", O: "open", c: "clack" };
    const VEL = { X: 1, x: 0.75, o: 0.45 };
    const GROOVE = { k: "X...X...X...X...", s: "....X.......X...", h: "o.x.o.x.o.x.o.x.", c: "......xo......xo" };
    const LIFT = { ...GROOVE, h: "o.x.o.O.o.x.o.O." };
    function drums(bar, pats, from = 0, to = 16) {
      for (const [key, pat] of Object.entries(pats)) for (let k = from; k < to; k++) {
        const v = VEL[pat[k]];
        if (!v) continue;
        const what = KIT[key];
        M(bar + k / 16, what, { v: v * (what === "hat" ? 0.85 + 0.3 * rnd() : 1), ...(what === "clack" ? { i: k % 2 } : {}) });
      }
    }
    // 方波贝斯：八分音符，根音为主，跳八度和五度。
    const MOTO = [[0, 0], [0.5, 0], [1, 12], [1.5, 0], [2, 0], [2.5, 7], [3, 12], [3.5, 7]];
    function bass(bar, v = 1, from = 0, to = 4) {
      for (const [b, iv] of MOTO) if (b >= from - 1e-9 && b < to - 1e-9) M(bar + b / 4, "bass", { m: rootAt(bar + b / 4) + iv, len: 0.42, v: v * (b % 1 ? 0.8 : 1) });
    }
    // 十六分的音序器：和弦音一个一个往上走再下来，拍头重一点。
    function seq(bar, v, from = 0, to = 4, lo = 62) {
      for (let b = from; b < to - 1e-9; b += 0.25) {
        const set = new Set(pcs(chordAt(bar + b / 4))), T = [];
        for (let m = lo; m <= lo + 14; m++) if (set.has(m % 12)) T.push(m);
        const cyc = [...T, ...T.slice(1, -1).reverse()], i = Math.round(b * 4);
        M(bar + b / 4, "seq", { m: cyc[i % cyc.length], len: 0.22, v: v * (i % 4 === 0 ? 1 : 0.72) });
      }
    }

    // 0–2 · 发车牌：0:0 一声低「咚」连着底鼓和贝斯，翻牌一格一声；1:0 HEAD 跳一下，1:2 几条线从 HEAD 长出来，2:0 列车员吹哨。
    ev(0, { kind: "boom" });
    // 接住第 08 章最后一小节往上爬的过门：底鼓、贝斯的 D 和一记开镲跟 boom 同时落下。
    M(0, "kick"); M(0, "bass", { m: rootAt(0), len: 3.75, v: 0.85 }); M(0, "open", { v: 0.9 });
    for (let j = 0; j < 10; j++) M(AT.board[0] + j / 16, "flap", { i: j % 3, v: 0.55 + 0.04 * (j % 2) });
    M(AT.diff, "flap", { i: 2, v: 0.45 });
    ev(AT.head, { kind: "hop", m: midi("D6"), pan: 0.3 });
    chime(AT.head + 0.0625, "A5", 0.45, 0.3);
    seq(1, 0.5, 2, 4);
    ev(AT.cap, { kind: "whoosh", tube: "fork" });
    M(AT.whistle, "whistle");
    drums(2, { h: "o.o.o.o.o.o.o.o." });
    seq(2, 0.65);
    bass(2, 0.7, 2, 4);
    // 闸口从上往下一条一声：放行的铃一声比一声高，没改到的三条是一声闷响。
    const GATES = [null, null, "A5", "C6", "D6", "E6", "G6", "A6", null];
    GATES.forEach((n, i) => (n ? chime(AT.gate0 + i * AT.gateStep, n, 0.55, -0.4 + i * 0.1) : M(AT.gate0 + i * AT.gateStep, "clack", { i: 1, v: 0.55, pan: -0.4 + i * 0.1 })));

    // 3–7 · 发车：四拍底鼓、方波贝斯、十六分音序器、成对的轨缝声，motorik 一直往前走；终点站一站一声铃（collector、ingress、core、CI、CodeQL）。
    chime(AT.depart, "E6", 0.5); chime(AT.depart + 0.125, "C6", 0.45);
    for (let bar = 3; bar <= 7; bar++) { drums(bar, bar === 7 ? { ...GROOVE, s: "....X.......X.xx" } : GROOVE); bass(bar); seq(bar, bar < 5 ? 0.8 : 0.9); }
    [["collector", "A5"], ["ingress", "C6"], ["core", "D6"], ["ci", "E6"], ["codeql", "A6"]].forEach(([k, n]) => chime(AT.term[k], n, 0.85));
    M(AT.contract, "flap", { i: 1, v: 0.5 });
    M(AT.sched, "flap", { i: 0, v: 0.35 });
    ev(AT.whip, { kind: "whoosh", tube: "whip", v: 0.8 });

    // 8–11 · 落地：源站亮灯，换乘 check_run；两块显示屏翻到 cf92f7c，拿放大镜的 Clawd 各跳一下；刷新 ESA 盖一记章，预热的车开过去。
    ev(AT.land, { kind: "accent", what: "arrive" });
    chime(AT.land, "D6", 0.8);
    for (let bar = 8; bar <= 10; bar++) { drums(bar, bar === 9 ? LIFT : GROOVE); bass(bar); seq(bar, 0.85); }
    chime(AT.xfer, "A5", 0.6); chime(AT.xfer + 0.0625, "D6", 0.55);
    M(AT.me, "flap", { i: 0, v: 0.6 });
    ev(AT.hop1, { kind: "hop", m: midi("G5"), v: 0.8, pan: 0.4 });
    chime(AT.dep, "F6", 0.45, 0.3);
    ev(AT.purge, { kind: "stamp", size: "mid" });
    chime(AT.esa, "E6", 0.5, 0.2);
    M(AT.com, "flap", { i: 1, v: 0.6 });
    ev(AT.hop2, { kind: "hop", m: midi("C6"), v: 0.8, pan: 0.5 });
    chime(AT.notify, "A6", 0.45, 0.3);
    ev(AT.pan, { kind: "whoosh", tube: "whip", v: 0.5, pan: -0.3, panTo: 0.5 });

    // 11–13 · 通知：钥匙开上报入口，摆渡车经 StateCore 到推送房间；11:3 报站的两音铃，12:0 广播 version，主奏带着滑音唱信封主题，13 小节往下答一句。
    drums(11, { ...GROOVE, s: "....X..........." }); bass(11); seq(11, 0.8);
    ev(AT.ing, { kind: "key", pan: 0.1 });
    M(AT.core, "clack", { i: 0, v: 0.7 }); M(AT.core + 0.0625, "clack", { i: 1, v: 0.6 });
    chime(AT.room, "D6", 0.7); chime(AT.room + 0.125, "A5", 0.65);
    for (let bar = 12; bar <= 13; bar++) { drums(bar, { k: GROOVE.k, h: GROOVE.h, c: GROOVE.c }); bass(bar, 0.85); seq(bar, 0.55); }
    let prev = midi(THEME[0][2]);
    for (const [b, d, n] of THEME) { M(AT.theme + b / 4, "lead", { m: midi(n), from: prev, len: d * 0.95, v: 1 }); prev = midi(n); }
    for (const [b, d, n] of [[0, 0.75, "F5"], [0.75, 0.75, "E5"], [1.5, 0.5, "D5"], [2, 1.75, "C5"]]) { M(13 + b / 4, "lead", { m: midi(n), from: prev, len: d * 0.95, v: 0.7 }); prev = midi(n); }
    chime(AT.ask, "A6", 0.3, 0.4); chime(AT.ask + 0.0625, "A6", 0.25, 0.5);
    M(AT.card, "flap", { i: 2, v: 0.55 });
    M(AT.reload, "flap", { i: 0, v: 0.45 }); chime(AT.reload + 0.125, "D6", 0.35, 0.5);

    // 14–16 · 整张线路图：鼓退到只剩拍头，音序器轻轻走；14:3 整张图落定，报站铃两声；16:0 落回 1 号线，16:2 停在 A9sus4，16:3 吸一口气交给第 10 章。
    ev(AT.full, { kind: "whoosh", tube: 0 });
    M(14, "kick"); M(14.5, "kick", { v: 0.6 }); drums(14, { h: "o...o...o...o..." });
    bass(14, 0.6, 0, 2); seq(14, 0.45);
    chime(AT.plate, "A5", 0.4, -0.2); chime(AT.plate + 0.125, "D6", 0.35, 0.2);
    drums(15, { k: "X.......X.......", h: "o...o...o...o...", c: "..............xo" }); bass(15, 0.5); seq(15, 0.4);
    M(16, "kick", { v: 0.8 }); seq(16, 0.35, 0, 2);
    ev(AT.dive, { kind: "whoosh", tube: 1 });
    ev(16.75, { kind: "swell" });

    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "metro-board", name: "接住第 08 章描出来的线：0:0 boom、底鼓、贝斯一起落；翻牌敲出 PR #308 → main，弦乐机垫着；1:0 HEAD 跳一下", energy: 0.3, pad: 0, lp: 1800, padVerb: 0 },
        { from: 2, to: 2, id: "metro-gates", name: "2:0 列车员吹哨，几条线散开，闸口一条一声", energy: 0.45, pad: 0, lp: 1800, padVerb: 0 },
        { from: 3, to: 7, id: "metro-motorik", name: "3:0 发车：四拍底鼓、方波贝斯、十六分音序器、轨缝声；终点站一站一声铃，7:2.5 甩去源站", energy: 0.75, pad: 0, lp: 1800, padVerb: 0 },
        { from: 8, to: 11, id: "metro-landing", name: "落地：换乘 check_run，两块显示屏翻到 cf92f7c，刷新 ESA；11:1 钥匙开上报入口", energy: 0.8, pad: 0, lp: 1800, padVerb: 0 },
        { from: 12, to: 13, id: "metro-broadcast", name: "推送房间广播 version，主奏唱信封主题；前台弹卡、后台自己刷新", energy: 0.7, pad: 0, lp: 1800, padVerb: 0 },
        { from: 14, to: 16, id: "metro-plate", name: "拉远看整张线路图，停一小节多；16:0 落回 1 号线，16:3 吸一口气，交给第 10 章", energy: 0.4, pad: 0, lp: 1800, padVerb: 0 },
      ],
      melody: [],
      story,
    };
  },
});
