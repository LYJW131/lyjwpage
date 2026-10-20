(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch07",
  tone: { bell: "bright", pluckPan: 0, snareVerb: 0.1 },
  score: ({ THEME, midi, CHORD }) => {
    // 拍位（小节）与 ch07.js 的 AT、NAR、INPUTS 同一张表，两边一起改。
    const AT = {
      crt: 0.03, pop: 0.3, logo: 0.5, menu: 0.75, pick: 1.25,
      type1: [2.0, 2.45], send1: 2.5, notice: 2.7, cur: 2.85, claude: 3.1, chose: 3.35,
      dest: 3.45, rows: [3.5, 3.75, 4.0, 4.25], ts: 4.4, opts: 4.5, accept: 5.0, close: 5.125, enter: [5.3, 5.55], door1: 5.6,
      who: 6.3, human: 6.6, tick: 6.65, lift: [6.75, 6.95], pass: 6.95, quota: [7.25, 7.5, 7.75],
      blk: 8.0, cont: 8.45, clear: 8.65,
      scroll: 9.5, bang: 9.75, mag: [10.0, 10.4], ledger: [10.25, 10.3, 10.45], grab: [10.5, 10.75],
      point: 12.5, full: 12.75, down: [13.0, 13.1, 13.25, 13.32], door: 13.25, hop: 13.32, hand: 13.5, never: 13.75,
      winA: 14.625, pre: [14.75, 15.0], run: [15.25, 15.6], back: [15.75, 16.1], game: 16.25, err: 16.5, winAoff: 16.875,
      mon: 17.0, same: 17.25, mcp: 17.75, bots: [18.0, 18.2], tools: [18.25, 18.5],
      seal: 20.5, type2: [21.45, 21.85], send2: 21.9,
      clefD: 22.1, worth: 22.25, portal: 22.5, arch: 22.75, plan: 23.0, opts2: [23.125, 23.25, 23.375], cur2: 23.75, sel2: 24.0,
      gh: 24.0625, okGh: 24.25, item: 24.3, poof: 24.625,
      branch: 25.125, c1: 25.5, pr: 25.75, act: 26.0, ro: 26.25, pub: 26.625, check: 26.875, c2: 27.0, rev: 27.25, owner: 27.625,
      despawn: 28.75, shrink: 29.3, hole: 29.35, eyes: 29.55, mosaic: 29.55,
    };
    const NAR = [2.75, 6.25, 9.5, 12.25, 14.75, 17.0, 19.5, 22.15];
    const N9 = [25.25, 27.625];

    const harm = [
      "Dm9", "Bbmaj7", "Dm9", "G6", "Bbmaj7", [["A7sus4", 0], ["A7", 2]],
      "Dm9", "G6", [["Em7b5", 0], ["A7", 2]], "Fmaj7", "C69", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", "Bbmaj7", [["Em7b5", 0], ["A7", 2]], "Dm9", "G6", "Bbmaj7", [["A7sus4", 0], ["A7", 2]],
      "Bbmaj7s11", "Dm9", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", "Bbmaj7", [["C69", 0], ["A7sus4", 2]],
      "Dm9", "G6", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]], "A7sus4",
    ];
    const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const nm = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    const chordAt = (bar, beat) => { const h = harm[bar]; if (typeof h === "string") return h; let c = h[0][0]; for (const [n, b] of h) if (beat >= b - 1e-9) c = n; return c; };
    const pcs = (name) => CHORD[name].map((n) => midi(n) % 12);
    const rootAt = (bar, beat) => { const r = pcs(chordAt(bar, beat))[0]; return 36 + ((r - 36) % 12 + 12) % 12; };

    // 429 那一下整队停住，「继续？」之后鼓先滚回来；最后一小节第 3 拍空着吸一口气，交给第 08 章 0:0 的 boom。
    const QUIET = [[8.0, 8.75], [29.75, 30]];
    const quiet = (o) => QUIET.some(([a, b]) => o >= a - 1e-9 && o < b - 1e-9);
    const melody = [], story = [];
    const put = (o, dur, m, inst, v, theme = false, loud = false) => { if (loud || !quiet(o)) melody.push([Math.floor(o + 1e-9), (o - Math.floor(o + 1e-9)) * 4, dur, typeof m === "number" ? nm(m) : m, inst, v, theme]); };
    const ev = (o, e) => story.push({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, ...e });
    const fx = (o, spec, v = 1, pan = 0, echo = 0) => ev(o, { kind: "chipFx", fx: spec, v, pan, echo });

    // 鼓：一小节 16 格，x 重 o 轻；k 底鼓、s 军鼓、h 闭镲、O 开镲、t 嗵鼓、c 吊镲。
    const DRUM = { k: "kick", s: "snare", h: "hat", O: "open", t: "tom", c: "crash" };
    const PAN = { kick: 0, snare: 0.05, hat: 0.25, open: 0.25, tom: -0.15, crash: 0.1 };
    function drums(bar, pats, from = 0, to = 16) {
      for (const [key, pat] of Object.entries(pats)) for (let k = from; k < to; k++) {
        const ch = pat[k % pat.length], o = bar + k / 16;
        if (ch === "." || quiet(o)) continue;
        ev(o, { kind: "chipDrum", drum: DRUM[key], v: ch === "x" ? 1 : 0.55, pan: PAN[DRUM[key]] });
      }
    }
    // 三角波低音：[拍, 拍长, 音程]，音程以和弦根音为准。
    const BASSLINE = {
      town: [[0, 0.45, 0], [0.5, 0.45, 12], [1, 0.45, 7], [1.5, 0.45, 12], [2, 0.45, 0], [2.5, 0.45, 12], [3, 0.45, 7], [3.5, 0.45, 12]],
      march: [[0, 0.9, 0], [1, 0.45, 7], [1.5, 0.45, 7], [2, 0.9, 0], [3, 0.45, 7], [3.5, 0.45, 10]],
      walk: [[0, 0.9, 0], [1, 0.9, 7], [2, 0.9, 12], [3, 0.9, 7]],
      drive: [[0, 0.4, 0], [0.5, 0.4, 0], [1, 0.4, 12], [1.5, 0.4, 0], [2, 0.4, 0], [2.5, 0.4, 7], [3, 0.4, 12], [3.5, 0.4, 10]],
      hold: [[0, 3.9, 0]],
    };
    function bass(bar, style, v = 1, from = 0, to = 4) {
      for (const [b, d, iv] of BASSLINE[style]) if (b >= from - 1e-9 && b < to - 1e-9) put(bar + b / 4, d, rootAt(bar, b) + iv, "chipTri", v);
    }
    // 1/8 占空比的琶音：每个 16 分音符走一个和弦音，上去再下来。
    function arp(bar, lo, v, from = 0, to = 4, span = 14, step = 0.25) {
      for (let b = from; b < to - 1e-9; b += step) {
        const set = new Set(pcs(chordAt(bar, b))), T = [];
        for (let m = lo; m <= lo + span; m++) if (set.has(m % 12)) T.push(m);
        const cyc = [...T, ...T.slice(1, -1).reverse()], i = Math.round(b / step);
        put(bar + b / 4, step * 0.9, cyc[i % cyc.length], "chipArp", v * (i % 4 === 0 ? 1 : 0.8));
      }
    }
    const line = (bar, notes, inst = "chipPulse", v = 0.8) => { let b = 0; for (const [n, d] of notes) { if (n) put(bar + b / 4, d * 0.92, n, inst, v); b += d; } };
    const typing = (t0, len) => { for (let o = t0; o < t0 + len - 1e-9; o += 1 / 16) fx(o, `p8,0.022,${Math.round((o * 16) % 2) ? 91 : 95}`, 0.22, 0.2); };

    // 0 · 标题：显像管开机、Clawd 跳出来、标题一声铃、菜单两声、选中「开始冒险」。
    fx(AT.crt, "n,0.03,9000,9000,d;p8,0.32,36,72,u;p4,0.12,84,84,d", 0.8);
    fx(AT.pop, "p4,0.13,60,74,d", 0.7, 0.3);
    [74, 77, 81, 84, 88].forEach((m, i) => put(AT.logo + i / 16, 0.3, m, "chipArp", 0.9));
    put(AT.logo, 2, "D2", "chipTri", 0.8);
    fx(AT.menu, "p2,0.035,84;r,0.02;p2,0.05,88", 0.5);
    line(1, [["F5", 0.5], ["D5", 0.5], ["A4", 0.5], ["Bb4", 1.5], ["A4", 0.5], ["F4", 0.5]], "chipPulse", 0.75);
    bass(1, "walk", 0.8);
    fx(AT.pick, "p4,0.05,79;p4,0.05,84;p4,0.12,91,91,d", 0.7);

    // 1 · 神殿门口：慢的城镇曲，琶音和三角波撑着，点接受之前只有提示音。
    for (let bar = 2; bar <= 5; bar++) { bass(bar, "town", 0.75); arp(bar, 62, 0.45); drums(bar, { k: "x.......x.......", h: "..o...o...o...o." }); }
    line(2, [["A4", 1], ["C5", 0.5], ["D5", 0.5], ["E5", 1], ["D5", 1]]);
    line(3, [["B4", 1], ["D5", 0.5], ["E5", 0.5], ["G5", 1.5], ["E5", 0.5]]);
    line(4, [["F5", 1], ["D5", 0.5], ["A4", 0.5], ["Bb4", 1], ["C5", 1]]);
    line(5, [["D5", 1], ["E5", 1], ["C#5", 2]]);
    typing(AT.type1[0], AT.type1[1] - AT.type1[0]);
    fx(AT.send1, "p4,0.08,72,91,f", 0.6);
    fx(AT.notice, "p8,0.04,72;p8,0.05,79", 0.55);
    for (const o of [AT.cur, AT.claude]) fx(o, "p4,0.03,84", 0.45, 0.3);
    fx(AT.chose, "p4,0.04,79;p4,0.07,86", 0.6, 0.3);
    fx(AT.dest, "p8,0.04,76;p8,0.05,81", 0.45);
    for (const o of AT.rows) fx(o, "p8,0.03,91", 0.35, -0.2);
    fx(AT.ts, "p4,0.05,83;p4,0.22,88,88,d", 0.55, 0.4);
    fx(AT.opts, "p8,0.04,79", 0.4);
    fx(AT.accept, "p4,0.05,74;p4,0.05,79;p4,0.05,83;p4,0.16,86,86,d", 0.7);
    fx(AT.close, "p8,0.04,79;p8,0.05,72", 0.5);
    for (let i = 0; i < 3; i++) fx(AT.enter[0] + i * ((AT.enter[1] - AT.enter[0]) / 3), "t,0.05,50,44,d", 0.6, -0.1);
    fx(AT.door1, "n,0.16,2200,500,d;t,0.12,40,34,d", 0.6);

    // 2 · 城门：进行曲。闸门升起是一段低噪声加一下落地；额度三声金币一声比一声高；429 一出整队停住。
    for (let bar = 6; bar <= 8; bar++) { bass(bar, "march", 0.85); drums(bar, { k: "x.......x.......", s: "....x.......x...", h: "x.o.x.o.x.o.x.o." }); }
    bass(9, "march", 0.85, 0, 1); drums(9, { k: "x...", h: "x.o." }, 0, 4);
    line(6, [["D5", 0.75], ["D5", 0.25], ["F5", 0.5], ["A5", 0.5], ["G5", 1], ["F5", 1]]);
    line(7, [["E5", 0.75], ["E5", 0.25], ["G5", 0.5], ["B5", 0.5], ["A5", 2]]);
    fx(AT.who, "p2,0.04,76;p2,0.06,81", 0.5, 0.3);
    fx(AT.tick, "p4,0.05,83;p4,0.2,88,88,d", 0.55, -0.3);
    fx(AT.lift[0], "n,0.46,260,160,f", 0.5);
    fx(AT.lift[1], "t,0.14,38,28,d;n,0.1,800,300,d", 0.85);
    ev(AT.lift[1], { kind: "chipDrum", drum: "crash", v: 0.6 });
    AT.quota.forEach((o, i) => fx(o, `p4,0.05,${83 + i * 3};p4,0.2,${88 + i * 3},${88 + i * 3},d`, 0.55, 0.35));
    fx(AT.blk, "p2,0.05,64;p2,0.05,52;p2,0.05,60;p2,0.24,48,40,d", 0.85);
    [["G4", 8.125], ["F4", 8.25], ["E4", 8.375], ["C#4", 8.5]].forEach(([n, o], i) => put(o, i === 3 ? 0.9 : 0.45, n, "chipPulse", 0.7, false, true));
    fx(AT.cont, "p4,0.04,72", 0.45);
    fx(AT.clear, "p4,0.04,79;p4,0.09,84", 0.55);
    for (let k = 12; k < 16; k++) ev(8 + k / 16, { kind: "chipDrum", drum: "tom", v: 0.5 + 0.12 * (k - 12), pan: -0.3 + 0.2 * (k - 12) });

    // 3a · 旅店柜台：小店的曲子，跳跃的低音；鉴定师的放大镜一串闪音，捡起名字一声「拿到了」。
    bass(9, "walk", 0.8, 1, 4); arp(9, 65, 0.4, 1, 4); drums(9, { k: "x.......x.......", h: "..x...x...x...x." }, 4, 16);
    for (let bar = 10; bar <= 11; bar++) { bass(bar, "walk", 0.8); arp(bar, 65, 0.4); drums(bar, { k: "x.......x.......", s: "........o.......", h: "..x...x...x...x." }); }
    line(9, [[null, 1], ["C5", 0.5], ["F5", 0.5], ["A5", 1], ["G5", 1]]);
    line(10, [["E5", 0.5], ["G5", 0.5], ["A5", 0.5], ["G5", 0.5], ["E5", 1], ["D5", 1]]);
    line(11, [["D5", 0.5], ["F5", 0.5], ["A5", 1], ["G5", 1], ["E5", 1]]);
    fx(AT.scroll, "n,0.22,2500,7000,d", 0.45);
    fx(AT.bang, "p2,0.05,88;r,0.025;p2,0.09,88", 0.6);
    fx(AT.mag[0], [79, 83, 86, 91, 95, 91, 86, 83, 79, 83, 86, 91].map((m) => `p8,0.05,${m}`).join(";"), 0.3, 0.2, 0.25);
    fx(AT.ledger[0], "p8,0.04,72;p8,0.05,79", 0.45, -0.3);
    for (const o of AT.ledger.slice(1)) fx(o, "p8,0.03,88", 0.35, -0.3);
    fx(AT.grab[0], "p4,0.16,72,84,f", 0.45, 0.3);
    fx(AT.grab[1], "p4,0.05,84;p4,0.05,88;p4,0.14,91,91,d", 0.65, 0.3);

    // 3b · 三层客栈：满员一声蜂鸣，下楼一串往下的音，进门、递信，「绝不往上」碰一下壁。
    for (let bar = 12; bar <= 13; bar++) { bass(bar, "town", 0.8); arp(bar, 62, 0.4); drums(bar, { k: "x.......x.......", h: "..o...o...o...o." }); }
    bass(14, "town", 0.8, 0, 2); arp(14, 62, 0.4, 0, 2); drums(14, { k: "x.......", h: "..o...o." }, 0, 8);
    line(12, [["A4", 1], ["D5", 1], ["F5", 1], ["A5", 1]]);
    line(13, [[null, 2], ["F5", 0.5], ["D5", 0.5], ["Bb4", 1]]);
    fx(AT.point, "p4,0.03,84", 0.45, -0.4);
    fx(AT.full, "p2,0.09,46;r,0.035;p2,0.16,46", 0.75, 0.4);
    fx(AT.down[1], [84, 81, 79, 76, 74, 72, 69].map((m) => `p4,0.034,${m}`).join(";"), 0.5, 0.3);
    fx(AT.door, "n,0.08,1500,600,d", 0.5);
    fx(AT.hop, "p4,0.1,64,76,d", 0.55);
    fx(AT.hand, "p4,0.04,79;p4,0.09,86", 0.55);
    fx(AT.never, "p2,0.06,50;p2,0.11,45,45,d", 0.6, 0.4);

    // 4 · 街上：最热闹的一段，跑腿的脚步是一串噪声，镜头往右走带一阵风，机器人哔哔两声。
    bass(14, "drive", 0.85, 2, 4); drums(14, { k: "x...", s: "....", h: "xxxx" }, 8, 16);
    for (let bar = 15; bar <= 18; bar++) { bass(bar, "drive", 0.85); arp(bar, 69, 0.38); drums(bar, { k: "x.....x.x.......", s: "....x.......x...", h: "x.xxx.xxx.xxx.xx" }); }
    line(15, [["D5", 0.5], ["A4", 0.5], ["D5", 0.5], ["E5", 0.5], ["F5", 1], ["E5", 0.5], ["D5", 0.5]]);
    line(16, [["B4", 0.5], ["D5", 0.5], ["G5", 1], ["E5", 0.5], ["D5", 0.5], ["B4", 1]]);
    line(17, [["F5", 0.5], ["D5", 0.5], ["Bb4", 0.5], ["D5", 0.5], ["A5", 1.5], ["G5", 0.5]]);
    line(18, [["G5", 1], ["D5", 1], ["C#5", 1], ["E5", 1]]);
    fx(AT.winA, "p8,0.04,72;p8,0.05,79", 0.5);
    for (const o of [...AT.pre, AT.game, AT.err]) fx(o, "p8,0.03,88", 0.35);
    for (const [a, b] of [AT.run, AT.back]) for (let o = a; o < b; o += 1 / 16) fx(o, "n,0.025,9000,9000,d", 0.3, 0.2);
    fx(AT.winAoff, "p8,0.04,79;p8,0.05,72", 0.45);
    fx(AT.mon, "n,0.4,700,4000,u", 0.35);
    for (const o of [AT.same, AT.mcp]) fx(o, "p8,0.04,72;p8,0.05,79", 0.5);
    fx(AT.bots[0], "p8,0.04,96;p8,0.04,91;p8,0.05,96", 0.4, 0.5);
    fx(AT.bots[1], "p8,0.04,91;p8,0.05,98", 0.4, 0.55);
    for (const o of AT.tools) fx(o, "p8,0.03,88", 0.35, 0.4);

    // 5 · 对话卡：鼓收掉，信封主题由方波主奏唱一遍（19:2 起，20:0 落在 E5）；盖章是存档的那段上行。
    bass(19, "walk", 0.75, 1, 4); arp(19, 65, 0.32, 1, 4); drums(19, { h: "..o...o...o...o." }, 4, 16);
    for (const [n, o] of [["F4", 19.5], ["A4", 19.6875], ["D5", 19.875]]) put(o, 0.6, n, "chipPulse", 0.45);
    for (const [b, d, n] of THEME) put(19.5 + b / 4, d * 0.95, n, "chipLead", 1, true, true);
    for (let bar = 20; bar <= 21; bar++) { bass(bar, "walk", 0.75); arp(bar, 65, 0.32); drums(bar, { k: "x.......x.......", h: "..o...o...o...o." }); }
    fx(AT.seal, "p4,0.06,74;p4,0.06,78;p4,0.06,81;p4,0.06,86;p4,0.26,90,90,d", 0.7, 0, 0.2);
    ev(AT.seal, { kind: "chipDrum", drum: "crash", v: 0.7 });
    line(21, [["D5", 1], ["F5", 0.5], ["E5", 0.5], ["D5", 2]], "chipPulse", 0.6);
    typing(AT.type2[0], AT.type2[1] - AT.type2[0]);
    fx(AT.send2, "p4,0.08,72,91,f", 0.6);

    // 6 · 先知的塔：琶音带回声，传送门一阵上行扫频；拿到 GitHub 授权是「获得道具」的四音，用完一声噗。
    for (let bar = 22; bar <= 24; bar++) { bass(bar, "hold", 0.7); arp(bar, 69, 0.42); drums(bar, { k: "x...............", h: "........o......." }); }
    line(22, [["A5", 2], ["G5", 1], ["F5", 1]], "chipPulse", 0.7);
    line(23, [["F5", 1.5], ["E5", 0.5], ["D5", 2]], "chipPulse", 0.7);
    line(24, [["E5", 1]], "chipPulse", 0.7);
    fx(AT.clefD, "p8,0.04,72;p8,0.05,79", 0.45);
    fx(AT.worth, "p2,0.04,76;p2,0.06,81", 0.5, -0.3);
    fx(AT.portal, "p8,0.45,55,96,u;n,0.3,600,5000,u", 0.45, 0.3, 0.25);
    fx(AT.plan, "p8,0.04,72;p8,0.05,79", 0.5);
    for (const o of AT.opts2) fx(o, "p8,0.03,88", 0.35);
    fx(AT.cur2, "p4,0.03,84", 0.45);
    for (const o of [AT.sel2, AT.okGh]) fx(o, "p4,0.04,79;p4,0.07,86", 0.6);
    fx(AT.gh, "p8,0.04,76;p8,0.05,81", 0.45);
    [["G5", 0], ["A5", 1 / 16], ["C6", 2 / 16], ["E6", 3 / 16]].forEach(([n, o], i) => put(AT.item + o, i === 3 ? 1.6 : 0.24, n, "chipLead", 0.9));
    fx(AT.poof, "n,0.16,4000,700,d", 0.5, -0.4);

    // 7 · 大厅里开工：明亮的进行，每盏新灯一枚金币，派发一阵风，锁一下咔哒，回传的包一串上行。
    for (let bar = 25; bar <= 27; bar++) { bass(bar, "drive", 0.85); arp(bar, 69, 0.36); drums(bar, { k: "x.......x.x.....", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." }); }
    bass(28, "drive", 0.85, 0, 3); arp(28, 69, 0.36, 0, 3); drums(28, { k: "x.......", s: "....x...", h: "x.x.x.x." }, 0, 8);
    drums(28, { t: "x.x.x.x." }, 8, 12);
    line(25, [["D5", 0.5], ["F5", 0.5], ["A5", 0.5], ["D6", 0.5], ["C6", 1], ["A5", 1]]);
    line(26, [["B5", 0.5], ["A5", 0.5], ["G5", 0.5], ["E5", 0.5], ["D5", 1], ["E5", 1]]);
    line(27, [["F5", 0.5], ["A5", 0.5], ["D6", 1], ["C6", 0.5], ["A5", 0.5], ["F5", 1]]);
    line(28, [["G5", 1], ["A5", 1], ["D6", 1]]);
    fx(AT.branch, "p4,0.3,60,84,f", 0.4, -0.3);
    for (const o of [AT.c1, AT.c2, AT.check]) fx(o, "p4,0.05,83;p4,0.22,88,88,d", 0.55, -0.2);
    fx(AT.pr, "p2,0.05,79;p2,0.1,84", 0.5, 0.3);
    fx(AT.act, "n,0.22,900,6000,u", 0.4, 0.2);
    fx(AT.ro, "p8,0.03,60;n,0.03,5000,5000,d", 0.55, 0.2);
    fx(AT.pub, "p8,0.24,72,96,f", 0.35, 0.3);
    fx(AT.rev, "p4,0.1,64,76,d", 0.5, 0.5);
    fx(AT.owner, "p4,0.06,76;p4,0.13,81,79,f", 0.5, -0.2);

    // 8 · 收尾：闪两下消失，缩小的「变小」下行，钻进鼠洞；第 3 拍空着，留给第 08 章那一声 boom。
    fx(AT.despawn, "p8,0.02,96;r,0.02;p8,0.02,96;r,0.02;p8,0.02,96", 0.4);
    put(29, 2.9, "A1", "chipTri", 0.75);
    [81, 79, 74, 69, 67, 62].forEach((m, i) => put(29 + i / 8, 0.45, m, "chipArp", 0.5 - i * 0.05));
    fx(AT.shrink, [76, 71, 76, 71, 67, 64].map((m) => `p2,0.045,${m}`).join(";"), 0.55);
    fx(AT.hole, "n,0.1,6000,2500,d", 0.4, 0.3);
    fx(AT.eyes, "p8,0.02,100", 0.3, 0.3);
    ev(29.75, { kind: "swell" });

    for (const o of NAR) typing(o, 0.5);
    for (const o of N9) typing(o, 0.3);

    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "chip-title", name: "标题：显像管开机，标题一声铃，菜单选「开始冒险」", energy: 0.3, pad: 0, lp: 1200, padVerb: 0 },
        { from: 2, to: 5, id: "chip-consent", name: "神殿门口：慢的城镇曲，隐私说明一行一行亮，5:0 点接受", energy: 0.4, pad: 0, lp: 1200, padVerb: 0 },
        { from: 6, to: 8, id: "chip-gate", name: "城门进行曲：验人、闸门升起、额度三声金币；8:0 的 429 整队停住", energy: 0.6, pad: 0, lp: 1200, padVerb: 0 },
        { from: 9, to: 11, id: "chip-inn", name: "旅店柜台：Clef 与 Clairic 同时开工，10:3 捡到名字", energy: 0.55, pad: 0, lp: 1200, padVerb: 0 },
        { from: 12, to: 14, id: "chip-floors", name: "三层客栈：12:3 神那层满员，往下一层到先知", energy: 0.55, pad: 0, lp: 1200, padVerb: 0 },
        { from: 15, to: 18, id: "chip-street", name: "街上：预取、档案馆、浏览器、/mcp，全章最热闹的一段", energy: 0.75, pad: 0, lp: 1200, padVerb: 0 },
        { from: 19, to: 21, id: "chip-chat", name: "对话卡：19:2 方波唱信封主题，20:2 盖章存档", energy: 0.45, pad: 0, lp: 1200, padVerb: 0 },
        { from: 22, to: 24, id: "chip-tower", name: "先知的塔：传送门、计划卡，24:1 获得道具", energy: 0.5, pad: 0, lp: 1200, padVerb: 0 },
        { from: 25, to: 28, id: "chip-build", name: "大厅里开工：分支、灯、草稿 PR、回传", energy: 0.7, pad: 0, lp: 1200, padVerb: 0 },
        { from: 29, to: 29, id: "chip-end", name: "缩小钻进鼠洞，收在 A7sus4，第 3 拍吸一口气", energy: 0.3, pad: 0, lp: 1200, padVerb: 0 },
      ],
      melody,
      story,
    };
  },
});
