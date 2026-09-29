// 第 07 章「节拍器」的配乐，12 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 一拍 = 一分钟，三台节拍器各有一个声部：服务器 = 钟摆声（每拍一下，从头到尾不变）；PlayStation = 底鼓（主机醒着每拍，
// 6:0 进休息响完最后一下，10:0 醒来当拍回来）；编码账号限额 = 玻璃灯音（每 5 拍 → 10 拍 → 睡着 → 9:0 醒 → 11:2 又睡）。
// BPM 不变，换档靠整支配器的密度：全速 → 半速（限额慢一档，踩镲、琶音跟着减半，底鼓照旧）→ 很慢（只剩钟摆）→ 全速。
// 信封主题由节拍器的小铃（剧情音 tick）在 10:0 回到全速时唱。
// 底鼓和灯音的拍位就是 ../ch07.js 的 PS_SEGS / LIM_SEGS：改一边先对另一边，再对 SCRIPT.md。
// 调性：从第 06 章的 A7sus4 回到 D 小调（i – ♭VI – ♭VII – i），夜里落在 Dmadd9 / B♭maj7#11 上，9 小节 A7 等开机，10:0 回到 Dm9。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch07",
  tone: { bell: "bright", pluckPan: 0.2, snareVerb: 0.14 },
  score: ({ midi }) => ({
    harm: [
      "Dm9", "Bbmaj7", "C69", "Dm9",
      "Gm9", [["Bbmaj7", 0], ["A7sus4", 2]],
      "Dmadd9", "Bbmaj7s11", "Gm9",
      [["A7sus4", 0], ["A7", 2]], "Dm9", [["Bbmaj7", 0], ["A7sus4", 2]],
    ],
    sections: [
      { from: 0, to: 3, id: "metro-watched", name: "有人在看：三台都在走，PS 的底鼓每拍一下，限额的灯音每 5 拍一声", energy: 0.7,
        kick: "X...X...X...X...", kickKind: "light", duck: 0.45, snare: [null, "....o.......o...", "....o.......o...", "....o.......o.oo"], snareKind: "rim",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "x...x...x...x...", clockVol: 0.9,
        bass: "offbeat", arp: { p: "332", lo: 62, inst: "pluck", v: 0.4 }, pad: 0.8, lp: 2400, padVerb: 0.3 },
      { from: 4, to: 5, id: "metro-background", name: "页面都在后台：限额慢一档，灯音 10 拍一声；PS 看的是主机，底鼓照旧每拍，踩镲和琶音减半", energy: 0.5,
        kick: "X...X...X...X...", kickKind: "light", duck: 0.4, hat: "......x.......x.", hatKind: "flip", hatVol: 0.8,
        clock: "x...x...x...x...", clockVol: 0.9, bass: "half", arp: { p: "sparse", lo: 62, inst: "pluck", v: 0.36 }, pad: 0.85, lp: 1900, padVerb: 0.34 },
      { from: 6, to: 8, id: "metro-night", name: "入夜：6:0 主机进休息，PS 当拍响最后一下；之后只剩服务器的滴答", energy: 0.22,
        kick: ["X...............", null, null], kickKind: "light", duck: 0.35, ghost: [4, 0.1, 0.4],
        clock: "x...x...x...x...", clockVol: 1, bass: "hold", bassVol: 0.8, pad: 1, lp: 1000, padVerb: 0.45 },
      { from: 9, to: 9, id: "metro-morning", name: "早上有人来：限额醒了；PS 不看人数，主机没醒还在闲档，9:3 开机", energy: 0.45,
        clock: "x...x...x...x...", clockVol: 0.95, ghost: [2, 0.12, 0.3], bass: "light", pad: 0.9, lp: 1800, padVerb: 0.35 },
      { from: 10, to: 10, id: "metro-full", name: "10:0 发现包回 200，PS 当拍就响：回到全速，节拍器的小铃唱主题", energy: 0.85,
        kick: "X...X...X...X...", kickKind: "light", duck: 0.5, snare: "....x.......x...", snareKind: "rim",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "x...x...x...x...", clockVol: 0.9,
        bass: "groove", arp: { p: "332", lo: 62, inst: "pluck", v: 0.42 }, pad: 0.8, lp: 2600, padVerb: 0.28 },
      { from: 11, to: 11, id: "metro-footnote", name: "人数问不到当 0：限额 11:2 跑完那一轮又去睡；底鼓（PS）和钟摆照旧，12:0 交给第 08 章的心跳", energy: 0.4,
        kick: "X...X...X...X...", kickKind: "light", duck: 0.4, clock: "x...x...x...x...", clockVol: 1,
        bass: "hold", bassVol: 0.8, pad: 0.9, lp: 1500, padVerb: 0.4 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      ...[[1, 0, "F5"], [1, 1.5, "D5"], [2, 0, "E5"], [2, 1.5, "G5"]].map(([bar, b, n]) => [bar, b, 1.25, n, "pluck", 0.36, false]), // 有人在看：拨弦轻轻答两句
      [6, 0, 8, "A4", "bell", 0.34, false], [6, 0, 8, "E5", "bell2", 0.22, false], // 入夜：空五度垫着
    ],
    story: [
      // 限额的一轮（LIM_SEGS 的起点：1、6、11、16、26、36、41、46 拍）：玻璃灯音，音高顺着和弦
      ...[[0, 1, "A5"], [1, 2, "D6"], [2, 3, "E6"], [4, 0, "D6"], [6, 2, "A5"], [9, 0, "E6"], [10, 1, "F6"], [11, 2, "E6"]]
        .map(([bar, beat, n]) => ({ bar, beat, kind: "lamp", m: midi(n), i: 1 })),
      { bar: 7, beat: 3, kind: "lamp", m: midi("D5"), i: 1, late: true }, // 夜里醒一下看人数（0），又睡
      { bar: 9, beat: 3, kind: "key", v: 0.8, pan: 0.45 }, { bar: 9, beat: 3, kind: "swell" }, // 按下主机电源，吸一口气等 10:0 那一探
      // 10:0 回到全速：节拍器的小铃唱信封主题（高八度）
      ...[[0, "A5"], [0.75, "D6"], [1.5, "F6"], [2, "E6"]].map(([beat, n], i) => ({ bar: 10, beat, kind: "tick", m: midi(n), i })),
      { bar: 11, beat: 3, kind: "swell" }, // 冲进服务器那台，12:0 硬切第 08 章
    ],
  }),
});
