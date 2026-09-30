(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch06",
  tone: { bell: "bright", pluckPan: 0.35, snareVerb: 0.2 },
  chords: {
    Em9: ["E3", "B3", "D4", "F#4", "G4"],
    A6: ["A3", "C#4", "E4", "F#4"],
    Gmaj7: ["G3", "B3", "D4", "F#4"],
    D69: ["D3", "A3", "E4", "F#4", "B4"],
    Bm7: ["B2", "F#3", "A3", "D4"],
  },
  score: ({ withNotes, phrase, midi }) => ({
    harm: [
      "Em9", "A6", "Gmaj7", "D69", "Em9", "A6", [["Bm7", 0], ["D69", 2]],
      "Gmaj7", [["D69", 0], ["A7sus4", 2]],
    ],
    sections: [
      { from: 0, to: 0, id: "lines-open", name: "硬切纸面、转调：一条线变成地铁图，声场铺开", energy: 0.4,
        ghost: [1, 0.2, 0.22], bass: "hold", arp: { p: "sparse", lo: 64, inst: "bell", v: 0.32 }, pad: 1, lp: 2600, padVerb: 0.5 },
      { from: 1, to: 3, id: "lines-esa", name: "ESA 站：5 分钟的钟每拍走一格，过期先给旧页、后台回源", energy: 0.5,
        kick: "X.......x.......", duck: 0.45, hat: "..x...x...x...x.", hatKind: "flip",
        clock: "o...o...o...o...", clockVol: 0.8, bass: "light", arp: { p: "sparse", lo: 64, inst: "pluck", v: 0.45 }, pad: 0.85, lp: 2400, padVerb: 0.42 },
      { from: 4, to: 6, id: "lines-img", name: "借书卡：打字机敲出索书号，同一个路径在两条线上各走各的", energy: 0.62,
        kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "rim",
        hat: "o.x.o.x.o.x.o.x.", hatKind: "type", hatVol: 0.8,
        bass: "groove", arp: { p: "332", lo: 64, inst: "pluck", v: 0.42 }, pad: 0.75, lp: 2800, padVerb: 0.38 },
      { from: 7, to: 8, id: "lines-extend", name: "两条线往右延伸、镜头横移，收在 A7sus4 上交给第 07 章", energy: 0.45,
        kick: ["X.......X.......", "X..............."], duck: 0.45, bass: "hold",
        arp: { p: "sparse", lo: 64, inst: "bell", v: 0.3 }, pad: 0.9, lp: 2400, padVerb: 0.45 },
    ],
    melody: [
      [0, 0, 4, "E5", "bell", 0.7, false], [0, 0, 4, "B5", "bell2", 0.45, false],
      ...phrase(7, withNotes(["F#5", "E5", "D5", "B4"]), "pluck", 0.4),
    ],
    story: [
      { bar: 0, beat: 0, kind: "boom" },
      { bar: 2, beat: 2, kind: "tick", m: midi("E6"), i: 2 },
      { bar: 3, beat: 2, kind: "accent", what: "slip" },
      { bar: 4, beat: 3, kind: "whoosh", tube: 0 }, { bar: 4, beat: 3.5, kind: "whoosh", tube: 3 },
      { bar: 6, beat: 0, kind: "stamp", size: "mid" },
    ],
  }),
});
