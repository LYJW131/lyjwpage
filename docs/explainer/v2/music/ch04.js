// 第 04 章「活字印版」的配乐，12 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 印刷机的重拍：底鼓一、三拍重压，钟摆声当机器的咔嗒，翻纸声当出纸；三块重印各落一个重拍（印章），
// 计时环一个一声「叮」，回源碰壁那一下全场一顿（大章），最后闷拨弦唱信封主题、吸一口气交给第 05 章。
// 调性：接第 03 章的 D 小调（i – ♭VI – VII），重印那几小节走 i – ♭VI – iv – V，收在 A7sus4 上。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch04",
  tone: { bell: "bright", pluckPan: -0.2, snareVerb: 0.1 },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    harm: [
      "Dm9", "Dm9", "Bbmaj7", "C69", [["Gm9", 0], ["A7sus4", 2]], "Dm9",
      "Bbmaj7", [["Gm9", 0], ["A7", 2]], "Dm9", "Fmaj7", "Gm9", [["Dm9", 0], ["A7sus4", 3]],
    ],
    sections: [
      { from: 0, to: 0, id: "press-in", name: "印刷机的重拍进来：镜头从纸上往后拉，整页印版现出来", energy: 0.45,
        kick: "X.......X.......", duck: 0.5, hat: "......x.......x.", hatKind: "flip", hatVol: 0.8,
        clock: "o.o.o.o.o.o.o.o.", clockVol: 0.5, bass: "light", pad: 0.9, lp: 1600, padVerb: 0.35 },
      { from: 1, to: 2, id: "press-deliver", name: "出纸口：递给访客一张印好的页", energy: 0.55,
        kick: "X.......X.......", duck: 0.5, snare: "............x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "o.o.o.o.o.o.o.o.", clockVol: 0.55,
        bass: "light", arp: { p: "sparse", lo: 57, inst: "pluckDark", v: 0.5 }, pad: 0.8, lp: 2000, padVerb: 0.3 },
      { from: 3, to: 4, id: "press-rails", name: "顺着页面往下走：每块一根线接到自己的库", energy: 0.65,
        kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "x.o.x.o.x.o.x.o.", clockVol: 0.6,
        bass: "groove", arp: { p: "332", lo: 57, inst: "pluckDark", v: 0.42 }, pad: 0.75, lp: 2400, padVerb: 0.26 },
      { from: 5, to: 7, id: "press-recast", name: "三个标签失效：三块夹起、每块在一个重拍上重印；旧页照发，新页在后台印", energy: 0.85,
        kick: ["X...X...X...X...", "X...X...X...X...", "X...X...X...X.x."], duck: 0.55,
        snare: ["....x.......x...", "....x.......x...", "....x.......x.ox"], snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", clock: "x.o.x.o.x.o.x.o.", clockVol: 0.7,
        bass: "groove", arp: { p: "332", lo: 57, inst: "pluckDark", v: 0.5 }, pad: 0.7, lp: 2800, padVerb: 0.24 },
      { from: 8, to: 9, id: "press-timers", name: "没挂标签的几块：600 秒的计时环一个一个亮，只剩钟摆", energy: 0.5,
        kick: "X.......X.......", duck: 0.45, clock: "x.o.x.o.x.o.x.o.", clockVol: 1,
        bass: "light", pad: 0.85, lp: 1800, padVerb: 0.32 },
      { from: 10, to: 10, id: "press-503", name: "回源碰上 503：全场一顿，大章「沿用上一份」", energy: 0.55,
        kick: "........X.x.....", duck: 0.5, snare: "............x...", snareKind: "thud",
        clock: "........x.o.x.o.", clockVol: 0.7, bass: "slam", pad: 0.8, lp: 2000, padVerb: 0.3 },
      { from: 11, to: 11, id: "press-song", name: "换歌不重印：闷拨弦唱信封主题，吸一口气交给第 05 章", energy: 0.45,
        kick: "X...............", duck: 0.45, bass: "hold", pad: 0.9, lp: 1700, padVerb: 0.38 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      ...phrase(1, withNotes(["D5", "C5", "A4", "F4"]), "pluck", 0.42), // 出纸口：一句往下走的应答（不是主题）
      ...phrase(11, THEME, "pluckDark", 1.35, true), // 11:0 火花落到「在听」那块上：闷拨弦唱主题
      ...phrase(11, withNotes(["D4", "F4", "A4", "A4"]), "pluck", 0.35), // 低八度跟一层
    ],
    story: [
      { bar: 2, beat: 0, kind: "accent", what: "slip" }, // 一张印好的页递给访客
      { bar: 5, beat: 0, kind: "accent", what: "flip" }, // 接第 03 章那次在线 → 离线：三个标签飞进来
      { bar: 5, beat: 2, kind: "accent", what: "slip" }, // 旧页照发
      { bar: 6, beat: 0, kind: "stamp", size: "mid" }, { bar: 6, beat: 2, kind: "stamp", size: "mid" }, { bar: 7, beat: 0, kind: "stamp", size: "mid" }, // 三块重印
      { bar: 7, beat: 2, kind: "accent", what: "slip" }, // 新页印完、换上去
      // 计时环：一个一声「叮」，顺着 D 小调五声往上走
      ...["A5", "C6", "D6", "E6", "G6", "A6", "C7"].map((n, i) => ({ bar: 8, beat: i * 0.5, kind: "tick", m: midi(n), i })),
      { bar: 9, beat: 2, kind: "whoosh", tube: 2 }, // pulse 那块回源：顺着轨往下
      { bar: 10, beat: 0, kind: "stamp", size: "big" }, // 503 · 沿用上一份
      { bar: 11, beat: 3, kind: "swell" }, // 推进「在听」那块，吸一口气
    ],
  }),
});
