// 第 03 章「一间屋子的账房」的配乐，16 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 暗、深、有点神秘但暖。十六分的钟摆就是那条队列；心跳段半速；出屋时主题带和声完整唱一遍。
// 调性：D 小调（i – ♭VI – iv – V），心跳段转一下 ii°7 – V，出屋时完整回到 i。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch03",
  // 拆分前第 02、03 章共用一条随机序列；这颗种子 = 108 往后走 335 步（第 02 章用掉的数），所以拆开后逐拍一致
  seed: -605775865,
  tone: { bell: "warm", pluckPan: 0.25, snareVerb: 0.22 },
  // 第 0 小节的旋律绕开母线扫频（上一章结尾把低通关到 380 Hz、0:1 才打开），落地那声铃要干净
  postBars: [0, 1],
  score: ({ THEME, withNotes, phrase }) => ({
    harm: [
      "Dmadd9", "Bbmaj7s11", "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]], "Dm9", "Bbmaj7",
      "Gm9", "Dmadd9", "Bbmaj7s11", [["Em7b5", 0], ["A7", 2]], "Dm9", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]], "Dm9",
    ],
    sections: [
      { from: 0, to: 1, id: "room-dark", name: "黑暗里亮起唯一的一盏灯：只有 pad、次低音和 FM 铃", energy: 0.25,
        ghost: [2, 0.15, 0.3], bass: "hold", pad: 1, lp: 800, padVerb: 0.45 },
      { from: 2, to: 5, id: "room-queue", name: "屋里只有一条队：每拍一个信封往前挪", energy: 0.6,
        kick: "X...X...X...X...", duck: 0.55, snare: [null, null, "....o.......o...", "....o.......o..."], snareKind: "rim",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
        bass: "offbeat", bassVol: 1.25, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.5 }, pad: 0.75, lp: 1000, padVerb: 0.35 },
      { from: 6, to: 8, id: "room-slip", name: "递出清单：广播和回执同时出发", energy: 0.7,
        kick: "X...X...X...X...", duck: 0.55, snare: "....x.......x...", snareKind: "rim",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
        bass: "offbeat", bassVol: 1.25, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.55 }, pad: 0.75, lp: 1100, padVerb: 0.35 },
      { from: 9, to: 11, id: "room-heartbeat", name: "心跳信封：半速，底鼓变成扑通扑通，记一笔、谁也不惊动", energy: 0.35,
        kick: "X.o.....X.o.....", kickKind: "heart", duck: 0.4,
        hat: "..............o.", hatKind: "flip", clock: ["o.o.o.o.o.o.o.o.", "o.o.o.o.o.o.o.o.", "o.o.o.o.o.o.oooo"], clockVol: 0.7,
        bass: "hold", pad: 0.85, lp: 850, padVerb: 0.4 },
      { from: 12, to: 14, id: "room-reveal", name: "镜头拉远：律动全开，主题带和声完整唱一遍", energy: 1,
        kick: "X...X...X...X...", duck: 0.5, snare: ["....X.......X...", "....X.......X...", "....X.......X.oo"], snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
        bass: "reveal", bassVol: 1.2, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.35 }, pad: 0.8, lp: 2200, padVerb: 0.35 },
      { from: 15, to: 15, id: "room-end", name: "落在 Dm9 上，镜头推进白卡交给第 04 章", energy: 0.6,
        kick: "X...............", duck: 0.5, bass: "end", pad: 1, lp: 1400, padVerb: 0.45 },
    ],
    melody: [
      ...phrase(0, THEME, "bell", 1.2, true), // 开场：FM 铃唱主题
      ...phrase(1, withNotes(["F5", "E5", "D5", "A4"]), "bell", 0.6), // 反着答：E5 在 B♭ 上是 #11
      // 心跳段：闷音拨弦偷偷走几步
      ...[[9, 0.5, "D4"], [9, 1.5, "F4"], [9, 2.75, "E4"], [9, 3.5, "C4"],
        [10, 0.5, "D4"], [10, 1.5, "F4"], [10, 2.75, "E4"], [10, 3.5, "A3"],
        [11, 1, "E4"], [11, 1.5, "G4"], [11, 2.5, "C#5"], [11, 3, "E5"], [11, 3.5, "G5"]].map(([bar, b, n]) => [bar, b, 0.25, n, "pluckMute", 0.5, false]),
      // 拉远：主题完整三句（原位、上三度模进、再上一句落到属音），铃唱旋律、第二支铃唱三度 / 六度和声、拨弦低八度跟着
      ...phrase(12, THEME, "bell", 1.15, true), ...phrase(12, withNotes(["F4", "A4", "D5", "C5"]), "bell2", 0.5), ...phrase(12, withNotes(["A3", "D4", "F4", "E4"]), "pluck", 0.4),
      ...phrase(13, withNotes(["C5", "F5", "A5", "G5"]), "bell", 1.1, true), ...phrase(13, withNotes(["A4", "D5", "F5", "D5"]), "bell2", 0.5), ...phrase(13, withNotes(["C4", "F4", "A4", "G4"]), "pluck", 0.4),
      ...phrase(14, withNotes(["D5", "G5", "Bb5", "A5"]), "bell", 1.1, true), ...phrase(14, withNotes(["Bb4", "D5", "G5", "E5"]), "bell2", 0.5), ...phrase(14, withNotes(["D4", "G4", "Bb4", "A4"]), "pluck", 0.4),
      // 15:0 终和弦：铃敲 D5 / A5 / E6，和 pad 的 Dm9 一起响
      [15, 0, 4, "D5", "bell", 0.9, true], [15, 0, 4, "A5", "bell2", 0.55, false], [15, 0, 4, "E6", "bell2", 0.35, false],
    ],
    story: [
      { bar: 0, beat: 0, kind: "accent", what: "arrive" }, // 落进黑暗：一声很低的「咚」，桌灯亮起
      { bar: 6, beat: 0, kind: "accent", what: "slip" }, // 纸条从墙缝递出去
      { bar: 6, beat: 2, kind: "accent", what: "broadcast" }, { bar: 6, beat: 2, kind: "stamp", size: "mid" }, // waitUntil 章：广播和回执同一拍
      { bar: 11, beat: 0, kind: "accent", what: "flip" }, // 在线 / 离线翻转
      { bar: 11, beat: 3, kind: "swell" }, // 拉远前吸一口气
      { bar: 15, beat: 0, kind: "boom" }, // 终和弦底下垫一声低的
    ],
  }),
});
