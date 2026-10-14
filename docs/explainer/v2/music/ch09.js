(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch09",
  tone: { bell: "bright", pluckPan: 0.25, snareVerb: 0.14 },
  chords: {
    Dsus2: ["D3", "A3", "D4", "E4"],
    Dm69: ["D3", "A3", "B3", "E4", "F4"],
    G9: ["G2", "F3", "A3", "B3", "D4"],
    Fmaj9: ["F3", "A3", "C4", "E4", "G4"],
    Cadd9: ["C3", "G3", "D4", "E4"],
    Bbadd9: ["Bb2", "F3", "C4", "D4"],
    Am7: ["A2", "E3", "G3", "C4"],
    A7b9: ["A2", "E3", "G3", "Bb3", "C#4"],
    Ebmaj7s11: ["Eb3", "Bb3", "D4", "F4", "A4"],
    A9sus4: ["A2", "E3", "G3", "B3", "D4"],
  },
  score: ({ THEME, withNotes, phrase, midi }) => {
    // 按 ch09.js 的 TRACKS 顺序，一条轨道一个十六分；null 是这次没改到、不跑的那几条。
    const GATES = [null, null, "A5", "B5", "D6", "E6", "F6", "A6", null];
    const gates = GATES.flatMap((n, i) => (n ? [{ bar: 2, beat: i * 0.25, kind: "tick", m: midi(n), i: i % 3 }] : []));
    const skipped = GATES.flatMap((n, i) => (n ? [] : [[2, i * 0.25, 0.5, "D3", "pluckMute", 0.55, false]]));
    const lamps = [[0, "A5"], [0.5, "B5"], [1, "D6"], [1.5, "F6"], [2, "A6"]].map(([beat, n], i) => ({ bar: 3, beat, kind: "lamp", m: midi(n), i: i % 2 ? 1 : 2 }));
    const hops = [[4, 2.75, "A5", 0.55], [5, 0, "G5", 0.8], [5, 1, "C6", 0.8], [5, 2.25, "D6", 0.55]]
      .map(([bar, beat, n, v]) => ({ bar, beat, kind: "hop", m: midi(n), v, pan: 0.6 }));
    return {
      harm: [
        "Dsus2", [["Dsus2", 0], ["Am7", 2]], "Dm69", [["G9", 0], ["A9sus4", 2]],
        "Dm69", "Cadd9", [["Bbadd9", 0], ["A7b9", 2]], "Dm69", [["G9", 0], ["Fmaj9", 2]], [["Ebmaj7s11", 0], ["A9sus4", 2]],
      ],
      sections: [
        { from: 0, to: 0, id: "release-type", name: "硬切纸面：只有 pad 和打字机，一个字一声敲出 PR #308 → main", energy: 0.25,
          hat: "....xxxxxxxxxxx.", hatKind: "type", hatVol: 0.8, ghost: [2, 0.12, 0.3], pad: 0.8, lp: 1700, padVerb: 0.34 },
        { from: 1, to: 1, id: "release-merge", name: "合并提交落到 main，HEAD 跳一下；1:2 几条流水线从 HEAD 散开", energy: 0.4,
          kick: "X.......x.......", kickKind: "light", duck: 0.4, hat: "........o.o.o.o.", hatKind: "type", hatVol: 0.9,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.32 },
        { from: 2, to: 3, id: "release-fanout", name: "闸门一条一声，律动进来；3:0 起五盏灯从下往上亮，3:3 甩去落地", energy: 0.7,
          kick: "X...X...X...X...", kickKind: "light", duck: 0.45, hat: "..x...x...x...x.", hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.34 }, pad: 0.75, lp: 2800, padVerb: 0.28 },
        { from: 4, to: 5, id: "release-landing", name: "落地：site Worker 生产部署成功，刷新 ESA；拿放大镜的 Clawd 看两个域名答出新版", energy: 0.8,
          kick: "X.......X.......", duck: 0.5, hat: "..x...x...x...x.", hatKind: "flip",
          bass: "reveal", arp: { p: "sparse", lo: 69, inst: "bell", v: 0.3 }, pad: 0.85, lp: 3200, padVerb: 0.34 },
        { from: 6, to: 6, id: "release-notify", name: "GitHub Actions 的钥匙敲上报入口，接着交给推送房间", energy: 0.74,
          kick: "X...X...X...X.x.", duck: 0.45, hat: "..x...x...x...x.", hatKind: "flip",
          bass: "light", pad: 0.8, lp: 2800, padVerb: 0.32 },
        { from: 7, to: 8, id: "release-version", name: "广播 version：第二支铃唱主题；前台弹卡、后台自己刷新", energy: 0.86,
          kick: "X.......X.x.....", duck: 0.5, snare: ["....x.......x...", "....x.......x.ox"], snareKind: "thud",
          hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "queue", lo: 69, inst: "bell", v: 0.26 }, pad: 0.72, lp: 3400, padVerb: 0.3 },
        { from: 9, to: 9, id: "release-end", name: "拉远看整张图，回到主轴；9:3 吸一口气，交给第 10 章", energy: 0.45,
          kick: "X...............", duck: 0.45, bass: "hold", pad: 0.9, lp: 2200, padVerb: 0.45 },
      ],
      melody: [
        [0, 0, 8, "A4", "bell", 0.3, false], [0, 0, 8, "E5", "bell2", 0.2, false],
        ...skipped,
        ...phrase(7, withNotes(["A5", "D6", "F6", "E6"]), "bell2", 1.2, true),
        ...phrase(7, THEME, "pluck", 0.5),
        ...phrase(8, withNotes(["F5", "E5", "D5", "C5"]), "pluck", 0.42),
      ],
      story: [
        { bar: 0, beat: 0, kind: "boom" },
        { bar: 1, beat: 0, kind: "hop", m: midi("D6"), pan: 0.3 },
        { bar: 1, beat: 2, kind: "whoosh", tube: "fork" },
        ...gates,
        ...lamps,
        { bar: 3, beat: 2.95, kind: "whoosh", tube: "whip", v: 0.7 },
        { bar: 4, beat: 0, kind: "accent", what: "arrive" }, { bar: 4, beat: 0, kind: "lamp", m: midi("A5"), i: 1 },
        { bar: 4, beat: 1, kind: "tick", m: midi("C6"), i: 0 }, { bar: 4, beat: 2, kind: "stamp", size: "mid" },
        { bar: 4, beat: 3, kind: "whoosh", tube: 3 },
        { bar: 5, beat: 0, kind: "tick", m: midi("D6"), i: 0 }, { bar: 5, beat: 1, kind: "tick", m: midi("E6"), i: 2 },
        { bar: 5, beat: 2, kind: "tick", m: midi("F6"), i: 1 },
        ...hops,
        { bar: 6, beat: 0, kind: "key", pan: 0.2 }, { bar: 6, beat: 2, kind: "tick", m: midi("A5"), i: 1 },
        { bar: 6, beat: 3, kind: "swell" },
        { bar: 7, beat: 0, kind: "accent", what: "broadcast" },
        { bar: 8, beat: 0, kind: "accent", what: "flip" },
        { bar: 8, beat: 2, kind: "accent", what: "slip" },
        { bar: 9, beat: 0, kind: "whoosh", tube: 0 },
        { bar: 9, beat: 3, kind: "swell" },
      ],
    };
  },
});
