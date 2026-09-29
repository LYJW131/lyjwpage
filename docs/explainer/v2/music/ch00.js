// 第 00 章「这张卡片从哪来」的配乐，10 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 0–2 暗底终端：只有 pad 和打字声（`claude` 六个字落在 0:0.5 起的六个十六分上，0:2 回车重一下），Clawd 入场不配声。
// 2:0 硬切纸面：低低一声落地，信封主题第一次出场——拨弦唱、高八度的铃轻轻叠一层；翻纸声当踩镲。
// 4:0 火花落到卡上、歌名翻面，一记翻转。7:2 往回拉，8–9 律动进来；总览图三栏在 8:2、8:3、9:0 各亮一下（灯音 A5 D6 F6）。
// 9:2 冲进采集端：下坠两拍，母线低通在第 01 章 0:0 关到最闷、0:1 打开；最后一小节没有旋律，给第 01 章 0:0 那声低「咚」让路。
// 调性：D 小调（i – ♭VI – III – VII – i），收在 A7sus4，第 01 章从 Dmadd9 接。
// 剧情落点和 ../ch00.js 顶部的时间表 AT 是同一组小节：改一边先对另一边，再对 SCRIPT.md。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch00",
  tone: { bell: "bright", pluckPan: 0.1, snareVerb: 0.12 },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    harm: [
      "Dmadd9", "Dmadd9", "Dm9", "Bbmaj7", "Fmaj7",
      "C69", "Dm9", [["Bbmaj7", 0], ["C69", 2]], "Gm9", "A7sus4",
    ],
    sections: [
      { from: 0, to: 1, id: "open-term", name: "暗底终端：只有 pad 和打字声（六个字加一下回车）", energy: 0.15,
        hat: ["..xxxxxxX.......", null], hatKind: "type", hatVol: 0.95, ghost: [2, 0.1, 0.3], pad: 0.75, lp: 1300, padVerb: 0.42 },
      { from: 2, to: 3, id: "open-home", name: "硬切纸面：主页线框画出来，主题第一次出场；镜头推到正在听那张卡", energy: 0.35,
        kick: [null, "X.......x......."], kickKind: "light", duck: 0.35,
        hat: ["......x.......x.", "..x...x...x...x."], hatKind: "flip", hatVol: 0.8,
        bass: "light", arp: { p: "sparse", lo: 69, inst: "pluck", v: 0.34 }, pad: 0.85, lp: 2200, padVerb: 0.34 },
      { from: 4, to: 5, id: "open-flip", name: "火花落到卡上、歌名翻面；大字问题", energy: 0.45,
        kick: "X.......x.......", kickKind: "light", duck: 0.4, hat: "..x...x...x...x.", hatKind: "flip", hatVol: 0.85,
        bass: "light", arp: { p: "sparse", lo: 69, inst: "bell", v: 0.3 }, pad: 0.85, lp: 2400, padVerb: 0.34 },
      { from: 6, to: 7, id: "open-follow", name: "问题收到左上，旁白：跟着一封信走一遍；7:2 往回拉", energy: 0.55,
        kick: ["X.......X.......", "X.......X...x.x."], kickKind: "light", duck: 0.45, snare: [null, "............x..."], snareKind: "thud",
        hat: ["..x...x...x...x.", "o.x.o.x.o.x.oox."], hatKind: "type", hatVol: 0.8,
        bass: "light", arp: { p: "332", lo: 69, inst: "pluck", v: 0.36 }, pad: 0.8, lp: 2600, padVerb: 0.3 },
      { from: 8, to: 8, id: "open-overview", name: "总览图：律动全开，三栏各亮一下", energy: 0.8,
        kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
        hat: "o.x.oox.o.x.oox.", hatKind: "type",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.42 }, pad: 0.75, lp: 3000, padVerb: 0.26 },
      { from: 9, to: 9, id: "open-rush", name: "冲进采集端：前两拍接着走，后两拍收住，只剩下坠", energy: 0.5,
        kick: "X...............", duck: 0.5, snare: "....x...........", snareKind: "thud",
        hat: "o.x.oox.........", hatKind: "type", bass: "half", pad: 0.8, lp: 2600, padVerb: 0.3 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      ...phrase(2, THEME, "pluck", 1.25, true), // 2:0 主题第一次出场
      ...phrase(2, withNotes(["A5", "D6", "F6", "E6"]), "bell", 0.42), // 高八度的铃轻轻叠一层
      ...phrase(3, withNotes(["D5", "C5", "A4", "F4"]), "pluck", 0.5), // 同一节奏往下答一句（B♭maj7 上的 C 是九音）
      [5, 0, 2, "E5", "bell", 0.36, false], [5, 2, 2, "G5", "bell", 0.3, false], // 大字问题底下，两声铃悬着
    ],
    story: [
      { bar: 2, beat: 0, kind: "boom" }, // 硬切纸面，低低一声落地
      { bar: 3, beat: 3, kind: "swell" }, // 火花顺着线进来，吸一口气
      { bar: 4, beat: 0, kind: "accent", what: "flip" }, // 落到卡上、歌名翻面
      { bar: 7, beat: 2, kind: "whoosh", tube: 1 }, // 顺着那根线往回拉
      // 总览图三栏：采集端、中枢、展示各亮一下（主题的前三个音，第四个留给第 01 章）
      { bar: 8, beat: 2, kind: "lamp", m: midi("A5"), i: 0 }, { bar: 8, beat: 3, kind: "lamp", m: midi("D6"), i: 1 }, { bar: 9, beat: 0, kind: "lamp", m: midi("F6"), i: 2 },
      { bar: 9, beat: 2, kind: "whoosh", tube: "down" }, // 冲进采集端，落点在第 01 章 0:0
    ],
    // 母线低通：9:2 起往下关，第 01 章 0:0 最闷，0:1 打开（那声低「咚」走 fxPost，不受影响）
    sweeps: [{ at: [9, 2], down: [10, 0], up: [10, 1], f: 380 }],
  }),
});
