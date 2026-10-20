(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch00",
  tone: { bell: "bright", pluckPan: 0, snareVerb: 0.12 },
  // 整章的声音都在 score.js 以 reich 开头的那一块（硬槌马林巴、拍手、送气的长音、钢片琴），所以 pad 关掉；
  // melody 只放钢片琴唱的信封主题，打字声借段落里的 hat（type）。
  score: ({ THEME, midi, CHORD, BAR }) => {
    // 拍位（小节）抄 ch00.js 顶部的 AT，两边一起改。
    const AT = {
      enter: 0.5, celebrate: 1.5, cut: 2.75, land: 3.0, cIn: [4.72, 4.81], flip: 5.0, cOut: [6.5, 6.58],
      shrink: 7.0, pull: 8.5, pops: [9.5, 9.75, 10.0], rush: 11.5,
    };
    // Clawd 的 jump 序列第 2、8 帧举手（clawd.js 每帧 FRAME_MS = 60 ms），庆祝和翻面时的两下都落在这里。
    const arms = (o) => [2, 8].map((i) => o + (i * 0.06) / BAR);
    const harm = [
      "Dmadd9", "Dmadd9", "Dm9", "Bbmaj7",
      [["Fmaj7", 0], ["C69", 2]], "Dm9", "Bbmaj7", [["Gm9", 0], ["C69", 2]],
      "Dm9", "Bbmaj7", [["Gm9", 0], ["Fmaj7", 2]], "A7sus4",
    ];
    const segs = [];
    harm.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([c, beat]) => segs.push({ c, o: bar + beat / 4 })));
    segs.forEach((s, i) => (s.end = i + 1 < segs.length ? segs[i + 1].o : harm.length));
    const chordAt = (o) => { let c = segs[0].c; for (const s of segs) if (o >= s.o - 1e-9) c = s.c; return c; };
    const pcs = (name) => CHORD[name].map((n) => midi(n) % 12);
    const tones = (o, lo = 62) => { const set = new Set(pcs(chordAt(o))), T = []; for (let m = lo; T.length < 5; m++) if (set.has(m % 12)) T.push(m); return T; };
    const rootAt = (o) => 36 + (((pcs(chordAt(o))[0] - 36) % 12) + 12) % 12;
    const at = (o) => [Math.floor(o + 1e-9), (o - Math.floor(o + 1e-9)) * 4];

    const story = [];
    const ev = (o, e) => { const [bar, beat] = at(o); story.push({ bar, beat, ...e }); };
    const R = (o, what, e = {}) => ev(o, { kind: "reich", what, ...e });

    // 送气的长音：每个和弦一口气，上面几个音一起渐强渐弱、按八分音符一下一下送；3:0 起低音跟着根音也送，总装图那三小节气最足。
    // 每口气多拖半拍，压过换和弦那一下的空当；最后一口气只到 12:0。
    for (const s of segs) {
      const len = (s.end - s.o) * 4 + (s.end < harm.length ? 0.5 : 0), v = s.o < AT.land ? 0.9 : s.o >= 8 && s.o < 11 ? 1.3 : 1;
      for (const n of CHORD[s.c].slice(1)) R(s.o, "breath", { m: midi(n), len, v });
      if (s.o >= AT.land) R(s.o, "bass", { m: rootAt(s.o), len, depth: 0.35 });
    }

    // 马林巴：十二个十六分音符一轮（三拍），放进 4/4 里每小节的起点错开四格，拍头重一点；音取当下和弦从 D4 往上的五个音。
    const CELL = [0, 2, 4, 1, 3, 2, 0, 4, 3, 1, 2, 4];
    const pick = (o, s) => tones(o)[CELL[((s % 12) + 12) % 12]];
    function mb(what, from, to, { shift = 0, v = 0.75, only = null, oct = 0, pan } = {}) {
      for (let s = Math.round(from * 16); s < Math.round(to * 16); s++) {
        if (only && !only.includes(CELL[(((s + shift) % 12) + 12) % 12])) continue;
        R(s / 16, what, { m: pick(s / 16, s + shift) + oct, v: v * (s % 4 === 0 ? 1 : 0.82), ...(pan == null ? {} : { pan }) });
      }
    }
    // 第二台在 [w0, w1) 里比第一台快一点，多弹一个音，出来时正好抢前一格（Piano Phase 的做法）。
    function drift(w0, w1, shift, v) {
      const a = Math.round(w0 * 16), L = Math.round(w1 * 16) - a;
      for (let j = 0; j <= L; j++) { const o = w0 + (j * L) / (L + 1) / 16; R(o, "mb2", { m: pick(o, a + j + shift), v: v * 0.9 }); }
    }
    // 先只有一个音、再两个音，3:0 才铺满：拿音符一个一个填进休止（Drumming 的做法）。
    mb("mb", 1, 2, { v: 0.55, only: [0] });
    mb("mb", 2, AT.land, { v: 0.55, only: [0, 3] });
    mb("mb", AT.land, AT.pull, { v: 0.75 });
    mb("mb", AT.pull, AT.rush, { v: 0.9 });
    mb("mb2", 4, 5.5, { v: 0.5 });
    drift(5.5, 6.5, 0, 0.75);
    mb("mb2", 6.5, 7, { shift: 1, v: 0.75 });
    drift(7, 8, 1, 0.75);
    mb("mb2", 8, AT.pull, { shift: 2, v: 0.8 });
    mb("mb2", AT.pull, AT.rush, { shift: 2, v: 0.9 });
    // 9:0 起第三条高八度、错开半轮，三栏亮灯时织得最密。
    mb("mb", 9, AT.rush, { shift: 6, v: 0.5, oct: 12, pan: 0.05 });

    // 拍手：十二个八分音符一轮，3+1+2+2 拍一组；第一个人 8:2 起一直不变，第二个人 9:2 跟进，10:0、10:3 各往前错一拍（Clapping Music 的做法）。
    const CLAP = "xxx.x.xx.xx.";
    function claps(i, from, to, shift, v) {
      for (let e = Math.round((from - AT.pull) * 8); e < Math.round((to - AT.pull) * 8); e++) {
        const k = (e + shift) % 12;
        if (CLAP[k] === "x") R(AT.pull + e / 8, "clap", { i, v: v * (k === 0 ? 1 : 0.82) });
      }
    }
    claps(0, AT.pull, AT.rush, 0, 0.8);
    claps(1, AT.pops[0], AT.pops[2], 0, 0.75);
    claps(1, AT.pops[2], 10.75, 1, 0.75);
    claps(1, 10.75, AT.rush, 2, 0.75);

    // 0–2 · 终端：0:2 回车，欢迎框亮起，钢片琴两声；1:2 Clawd 庆祝，举手两下。
    R(AT.enter, "cel", { m: midi("D6"), v: 0.5 }); R(AT.enter + 1 / 16, "cel", { m: midi("A6"), v: 0.4 });
    arms(AT.celebrate).forEach((o, i) => ev(o, { kind: "hop", m: midi(["A5", "E6"][i]), v: 0.5, pan: -0.3 }));
    // 2:3 甩镜头去主页的图纸，3:0 落下：钢片琴 D6、低一个八度的马林巴 D3。
    ev(AT.cut, { kind: "whoosh", tube: "whip", v: 0.75 });
    R(AT.land, "cel", { m: midi("D6"), v: 0.45 }); R(AT.land, "mb2", { m: midi("D3"), v: 0.7 });
    // 5:0 翻面：马林巴三个音一起落、翻面的一声；Clawd 4:2.9 起跳两下进场，翻面时举手两下，6:2 跳两下离场。
    for (const n of ["D5", "F5", "A5"]) R(AT.flip, "mb", { m: midi(n), v: 0.6 });
    ev(AT.flip, { kind: "accent", what: "flip" });
    AT.cIn.forEach((o, i) => ev(o, { kind: "hop", m: midi(["A5", "D6"][i]), v: 0.7, pan: -0.5 }));
    arms(AT.flip).forEach((o, i) => ev(o, { kind: "hop", m: midi(["A5", "E6"][i]), pan: -0.5 }));
    AT.cOut.forEach((o, i) => ev(o, { kind: "hop", m: midi(["D6", "A5"][i]), v: 0.6, pan: -0.5 }));
    // 7:0 问题收进页眉，钢片琴往下两声；8:1 吸一口气，8:2 往回拉到总装图。
    R(AT.shrink, "cel", { m: midi("A5"), v: 0.4 }); R(AT.shrink + 1 / 8, "cel", { m: midi("E5"), v: 0.35 });
    ev(AT.pull - 0.25, { kind: "swell" });
    // 三栏各亮一下：钢片琴 A5、D6、F6。
    AT.pops.forEach((o, i) => R(o, "cel", { m: midi(["A5", "D6", "F6"][i]), v: 0.5 }));
    // 11:2 冲进采集端：马林巴和拍手收住，只剩送气的长音和下坠；母线扫频压到 12:0 最闷，第 01 章 0:1 放开。
    ev(AT.rush, { kind: "whoosh", tube: "down" });

    const quiet = { pad: 0, lp: 1800, padVerb: 0 };
    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "reich-term", name: "晒图上的终端：打字声和送气的长音；0:2 回车，钢片琴两声，欢迎框亮起；1:0 起马林巴只弹一个音", energy: 0.15,
          hat: ["..xxxxxxX.......", null], hatKind: "type", hatVol: 0.95, ...quiet },
        { from: 2, to: 2, id: "reich-say", name: "马林巴添到两个音；注卡收起，2:3 甩镜头", energy: 0.25, ...quiet },
        { from: 3, to: 4, id: "reich-sheet", name: "主页线框：马林巴十二音一轮铺满，低音也送气；4:0 第二台齐奏进来，4:2 钢片琴唱主题，E5 落在 5:0 翻面", energy: 0.45, ...quiet },
        { from: 5, to: 7, id: "reich-phase", name: "翻面、问题、收进页眉：第二台马林巴一点点抢到前面（5:2、7:0 起各抢一格）", energy: 0.55, ...quiet },
        { from: 8, to: 10, id: "reich-clap", name: "拉远到总装图：两个人拍手，第二个人一次错开一拍；三栏各亮一下", energy: 0.8, ...quiet },
        { from: 11, to: 11, id: "reich-rush", name: "冲进采集端：11:2 收住，只剩下坠；停在 A7sus4，交给第 01 章", energy: 0.5, ...quiet },
      ],
      melody: THEME.map(([b, d, n]) => [...at(4.5 + b / 4), d, n, "reichCelesta", 1, true]),
      story,
      sweeps: [{ at: [11, 2], down: [12, 0], up: [12, 1], f: 380 }],
    };
  },
});
