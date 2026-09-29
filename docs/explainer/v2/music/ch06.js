// 第 06 章「两条线路」的配乐，14 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 硬切到纸面地铁图的同时转调：从 D 小调升一个全音到 E 多利亚（C# 还原），声场铺开（pad 混响更大、拨弦左右分得更开）。
// ESA 的钟每拍一下；借书卡那段打字机敲索书号；发版接力六站各一声灯，主题从第 ⑤ 站起唱、在第 ⑥ 站唱完（E 多利亚：B4 E5 G5 F#5）。
// 收在 A7sus4（A D E G 在 E 多利亚里都有，又是 D 小调的属和弦），第 07 章回到 D 从这里接。
// 本章的和弦（名字全片唯一）：Em9 A6 Gmaj7 D69 Bm7 是 E 多利亚的 i IV ♭III ♭VII v，Cmaj9 是借来的 ♭VI，接力前抬一下。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch06",
  tone: { bell: "bright", pluckPan: 0.35, snareVerb: 0.2 },
  chords: {
    Em9: ["E3", "B3", "D4", "F#4", "G4"],
    A6: ["A3", "C#4", "E4", "F#4"],
    Gmaj7: ["G3", "B3", "D4", "F#4"],
    D69: ["D3", "A3", "E4", "F#4", "B4"],
    Bm7: ["B2", "F#3", "A3", "D4"],
    Cmaj9: ["C3", "G3", "B3", "D4", "E4"],
  },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    harm: [
      "Em9", "A6", "Gmaj7", "D69", "Em9", "A6", [["Bm7", 0], ["D69", 2]],
      [["Cmaj9", 0], ["D69", 2]], "Em9", "Gmaj7", "A6", "Em9", "Gmaj7", [["D69", 0], ["A7sus4", 2]],
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
      { from: 7, to: 7, id: "lines-relay-in", name: "拉远看整张图：接力线铺开", energy: 0.7,
        kick: "X...X...X...X...", duck: 0.5, hat: "..x...x...x...x.", hatKind: "flip",
        bass: "light", arp: { p: "queue", lo: 64, inst: "bell", v: 0.34 }, pad: 0.8, lp: 3000, padVerb: 0.4 },
      { from: 8, to: 11, id: "lines-relay", name: "发版接力：六站一站一声，主题在第 ⑥ 站唱完", energy: 0.9,
        kick: "X...X...X...X...", duck: 0.5, snare: ["....x.......x...", "....x.......x...", "....x.......x...", "....x.......x.ox"], snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip",
        bass: "groove", arp: { p: "queue", lo: 64, inst: "bell", v: 0.3 }, pad: 0.75, lp: 3400, padVerb: 0.36 },
      { from: 12, to: 13, id: "lines-extend", name: "UPDATE 卡弹出；两条线往右延伸，收在 A7sus4 上交给第 07 章", energy: 0.45,
        kick: ["X.......X.......", "X..............."], duck: 0.45, bass: "hold",
        arp: { p: "sparse", lo: 64, inst: "bell", v: 0.3 }, pad: 0.9, lp: 2400, padVerb: 0.45 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      [0, 0, 4, "E5", "bell", 0.7, false], [0, 0, 4, "B5", "bell2", 0.45, false], // 转调落地：空五度铺开
      // 主题从第 ⑤ 站（10:2）起唱，最后一个音落在第 ⑥ 站（11:0）；第二支铃在下面三度跟着
      ...phrase(10, THEME.map(([bt, dur], i) => [bt + 2, dur, ["B4", "E5", "G5", "F#5"][i]]), "bell", 1.2, true),
      ...phrase(10, THEME.map(([bt, dur], i) => [bt + 2, dur, ["G4", "B4", "E5", "D5"][i]]), "bell2", 0.5),
      ...phrase(12, withNotes(["F#5", "E5", "D5", "B4"]), "pluck", 0.4), // UPDATE 卡弹出后，往下答一句
    ],
    story: [
      { bar: 0, beat: 0, kind: "boom" }, // 硬切到纸面，低低一声落地
      { bar: 2, beat: 2, kind: "tick", m: midi("E6"), i: 2 }, // ESA 的钟走完 300 秒
      { bar: 3, beat: 2, kind: "accent", what: "slip" }, // 新的一份页回到 ESA
      { bar: 4, beat: 3, kind: "whoosh", tube: 0 }, { bar: 4, beat: 3.5, kind: "whoosh", tube: 3 }, // 同一个图片路径在两条线上路
      { bar: 6, beat: 0, kind: "stamp", size: "mid" }, // immutable · 不用刷新
      // 发版接力：一站一声灯（E 多利亚往上走），第 ③ 站是两个域名先后打勾
      ...[[8, 0, "E5"], [8, 2, "G5"], [9, 0, "A5"], [9, 2, "B5"], [10, 0, "D6"], [10, 2, "E6"], [11, 0, "F#6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "lamp", m: midi(n), i: i % 3 })),
      { bar: 12, beat: 0, kind: "accent", what: "flip" }, // UPDATE 卡纵向弹出
    ],
  }),
});
