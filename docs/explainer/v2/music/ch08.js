(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch08",
  tone: { bell: "warm", pluckPan: -0.2, snareVerb: 0.16 },
  chords: {
    Dm11: ["D3", "A3", "C4", "F4", "G4"],
    Bbmaj9: ["Bb2", "F3", "A3", "C4", "D4"],
  },
  score: ({ withNotes, phrase, midi }) => {
    const checks = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45].map((phi) => ({
      bar: Math.floor(phi / 4), beat: phi % 4, kind: "ping", m: midi("D3"), late: phi >= 24 && phi < 40,
    }));
    return {
      harm: [
        "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]],
        "Fmaj7", "C69",
        "Dm11", "Bbmaj9", "Gm9", [["Em7b5", 0], ["A7", 2]],
        "Dm9", [["Bbmaj7", 0], ["A7sus4", 2]],
      ],
      sections: [
        { from: 0, to: 3, id: "ecg-line", name: "心电图：心跳每拍一下，敲门在后半拍，报到每 5 拍一声低音", energy: 0.55,
          kick: "Xx..Xx..Xx..Xx..", kickKind: "heart", duck: 0.4, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 1,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.32 },
        { from: 4, to: 5, id: "ecg-results", name: "结果取回来：5:0 令牌出门，5:2 今天那一格亮", energy: 0.5,
          kick: "Xx......Xx......", kickKind: "heart", duck: 0.35, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 0.8,
          bass: "half", arp: { p: "sparse", lo: 69, inst: "bell2", v: 0.28 }, pad: 0.85, lp: 2600, padVerb: 0.34 },
        { from: 6, to: 7, id: "strata-sink", name: "沉进地层：敲门变闷，每拍压进一片；7:0 这首歌亮一下，低音马林巴唱主题", energy: 0.32,
          kick: "X.......X.......", kickKind: "heart", duck: 0.35, clock: "..o...o...o...o.", clockKind: "knockFar", clockVol: 0.5,
          hat: "x...x...x...x...", hatKind: "flip", hatVol: 0.5, bass: "hold", bassVol: 0.85, pad: 1, lp: 950, padVerb: 0.5 },
        { from: 8, to: 9, id: "strata-coding", name: "Coding 一窗一窗交给 Jev：全零的一声闷拨弦，打分的一声小铃", energy: 0.4,
          kick: "X.......X.......", kickKind: "heart", duck: 0.35, clock: "..o...o...o...o.", clockKind: "knockFar", clockVol: 0.5,
          hat: "x...x...x...x...", hatKind: "flip", hatVol: 0.45, bass: "hold", bassVol: 0.8, pad: 0.9, lp: 1300, padVerb: 0.45 },
        { from: 10, to: 10, id: "strata-clawd", name: "Clawd 冒出来说收尾那句", energy: 0.42,
          kick: "Xx......Xx......", kickKind: "heart", duck: 0.35, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 0.75,
          bass: "light", pad: 0.85, lp: 1800, padVerb: 0.38 },
        { from: 11, to: 11, id: "strata-rise", name: "升回地面：心跳回到每拍，收在 A7sus4 交给第 09 章", energy: 0.5,
          kick: "Xx..Xx..Xx..Xx..", kickKind: "heart", duck: 0.4, clock: "..x...x...x...x.", clockKind: "knock", clockVol: 0.9,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.34 },
      ],
      melody: [
        ...phrase(7, withNotes(["A3", "D4", "F4", "E4"]), "marimba", 1, true),
        ...phrase(7, withNotes(["D3", "F3", "A3", "G3"]), "pluckDark", 0.35),
        [8, 1, 1.5, "D3", "pluckMute", 0.5, false],
      ],
      story: [
        ...checks,
        { bar: 5, beat: 0, kind: "key", v: 0.7, pan: 0.3 },
        { bar: 5, beat: 2, kind: "lamp", m: midi("A5"), i: 2 },
        ...["G5", "A5", "Bb5", "D6", "E6", "G6"].map((n, i) => ({ bar: 8 + Math.floor((2 + i * 0.5) / 4), beat: (2 + i * 0.5) % 4, kind: "tick", m: midi(n), i: i % 3 })),
        { bar: 10, beat: 1, kind: "accent", what: "flip" },
        { bar: 11, beat: 3, kind: "swell" },
      ],
    };
  },
});
