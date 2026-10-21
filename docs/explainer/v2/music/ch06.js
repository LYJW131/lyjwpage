(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch06",
  tone: { bell: "warm", pluckPan: -0.2, snareVerb: 0.16 },
  chords: {
    Dm11: ["D3", "A3", "C4", "F4", "G4"],
    Bbmaj9: ["Bb2", "F3", "A3", "C4", "D4"],
  },
  score: ({ withNotes, phrase, midi }) => {
    const checks = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((phi) => ({
      bar: Math.floor(phi / 4), beat: phi % 4, kind: "ping", m: midi("D3"), late: phi >= 24 && phi < 52,
    }));
    // 时刻（小节）与 ch06.js 的 title、card、coding、slip 同步：盖「06」印、卷轴展开、Coding 带子刷出来、便笺落下。
    const SFX = [
      [0.45, "stamp", 0.8, -0.4], [0.55, "paper", 0.45, -0.3, 0.9],
      [3.9, "paper", 0.6, 0.4, 0.8], [3.92, "whoosh", 0.3, 0.4, 0.8], [4.1, "stamp", 0.5, 0.6, 1.25],
      [11.5, "paper", 0.5, -0.3, 1.3], [11.5, "whoosh", 0.22, 0.3, 1.25],
      [13.35, "paper", 0.5, -0.2, 1.1],
    ];
    return {
      harm: [
        "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]],
        "Fmaj7", "C69",
        "Dm11", "Bbmaj9", "Gm9", "Dm11", "Bbmaj9",
        "Gm9", [["Em7b5", 0], ["A7", 2]],
        "Dm9", "Gm9", [["Bbmaj7", 0], ["A7sus4", 2]],
      ],
      sections: [
        { from: 0, to: 3, id: "ecg-line", name: "心电图：心跳每拍一下，敲门在后半拍，报到每 5 拍一声低音", energy: 0.55,
          kick: "Xx..Xx..Xx..Xx..", kickKind: "heart", duck: 0.4, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 1,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.32 },
        { from: 4, to: 5, id: "ecg-results", name: "结果取回来：5:0 令牌出门，5:2 今天那一格亮", energy: 0.5,
          kick: "Xx......Xx......", kickKind: "heart", duck: 0.35, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 0.8,
          bass: "half", arp: { p: "sparse", lo: 69, inst: "bell2", v: 0.28 }, pad: 0.85, lp: 2600, padVerb: 0.34 },
        { from: 6, to: 10, id: "strata-sink", name: "沉进地层：敲门变闷，报到那一拍压进一片；7:0 这首歌亮一下，低音马林巴唱主题；9:0 推近右沿", energy: 0.32,
          kick: "X.......X.......", kickKind: "heart", duck: 0.35, clock: "..o...o...o...o.", clockKind: "knockFar", clockVol: 0.5,
          hat: ["....x...........", "........x.......", "............x...", null, "x..............."], hatKind: "flip", hatVol: 0.5, bass: "hold", bassVol: 0.85, pad: 1, lp: 950, padVerb: 0.5 },
        { from: 11, to: 12, id: "strata-coding", name: "Coding 那一层：11:1 原始观测亮一下，11:2 三色带现场刷出来，12:0 图例三声，12:1 起两个时长各一声高音", energy: 0.4,
          kick: "X.......X.......", kickKind: "heart", duck: 0.35, clock: "..o...o...o...o.", clockKind: "knockFar", clockVol: 0.5,
          hat: ["....x...........", "........x......."], hatKind: "flip", hatVol: 0.45, bass: "hold", bassVol: 0.8, pad: 0.9, lp: 1300, padVerb: 0.45 },
        { from: 13, to: 14, id: "strata-clawd", name: "Clawd 冒出来说收尾那句", energy: 0.42,
          kick: "Xx......Xx......", kickKind: "heart", duck: 0.35, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 0.75,
          bass: "light", pad: 0.85, lp: 1800, padVerb: 0.38 },
        { from: 15, to: 15, id: "strata-rise", name: "升回地面：心跳跳两下就停，15:2 起拉平成一声长「嘀」（D5），收在 A7sus4，16:0 交给第 07 章同音的方波", energy: 0.5,
          kick: "Xx..xo..........", kickKind: "heart", duck: 0.4, clock: "..x...x.........", clockKind: "knock", clockVol: 0.9,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.34 },
      ],
      melody: [
        ...phrase(7, withNotes(["A3", "D4", "F4", "E4"]), "marimba", 1, true),
        ...phrase(7, withNotes(["D3", "F3", "A3", "G3"]), "pluckDark", 0.35),
      ],
      story: [
        ...checks,
        { bar: 5, beat: 0, kind: "key", v: 0.7, pan: 0.3 },
        { bar: 5, beat: 2, kind: "lamp", m: midi("A5"), i: 2 },
        { bar: 11, beat: 1, kind: "key", v: 0.4, pan: -0.3 },
        ...["G5", "A5", "Bb5"].map((n, i) => ({ bar: 12, beat: i * 0.25, kind: "tick", m: midi(n), i })),
        { bar: 12, beat: 1, kind: "lamp", m: midi("D6"), i: 1 },
        { bar: 12, beat: 1.5, kind: "lamp", m: midi("A6"), i: 2 },
        { bar: 13, beat: 1, kind: "accent", what: "flip" },
        // 心电图拉平那一声长「嘀」，长度以拍计，正好收在第 07 章 0:0（music/ch07.js 开头同音的方波接住）；音高 D5 须与那边同步。
        { bar: 15, beat: 2, kind: "jCflat", m: midi("D5"), len: 2 },
        { bar: 15, beat: 3, kind: "swell" },
      ],
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
