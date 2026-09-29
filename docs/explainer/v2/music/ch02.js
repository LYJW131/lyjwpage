// 第 02 章「门禁与分拣」的配乐，16 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 纸面、公文：打字机当踩镲，印章当军鼓，钥匙、打勾、气动管、指示灯是剧情音；落在属音上，被最后那根管子吸进第 03 章。
// 调性：D 多利亚（i – IV – i – III – VII），400 那一下借 ♭VI。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch02",
  seed: 108, // 琶音和打字声的力度抖动用这颗种子（和拆分前整片那条随机序列的开头一致）
  tone: { bell: "bright", pluckPan: 0, snareVerb: 0.12 },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    // 每小节的和弦；数组表示小节内换和弦：[和弦, 起拍]
    harm: [
      "Dm9", "G6", "Dm9", "Fmaj7", "C69", "Dm9", "Fmaj7", "C69",
      "Bbmaj7", "Dm9", "G6", "Bbmaj7", "C69", "Dm9", "Fmaj7", [["A7sus4", 0], ["A7", 2]],
    ],
    sections: [
      { from: 0, to: 1, id: "gate-intro", name: "门前：pad 和零星的打字声，拨弦唱出信封主题", energy: 0.2,
        hat: ["..o...o...o...o.", "..o...o...o.oooo"], hatKind: "type", hatVol: 0.7, ghost: [1, 0.2, 0.16],
        pad: 0.9, lp: 2400, padVerb: 0.3 },
      { from: 2, to: 4, id: "gate-doors", name: "钥匙与门：轻底鼓进来", energy: 0.4,
        kick: "X.......x.......", kickKind: "light", duck: 0.4,
        hat: "o.x.o.x.o.x.o.x.", hatKind: "type", hatVol: 0.8,
        bass: "light", arp: { p: "sparse", lo: 69, inst: "pluck", v: 0.5 }, pad: 0.8, lp: 2600, padVerb: 0.28 },
      { from: 5, to: 7, id: "gate-checklist", name: "检查单：六声打勾，律动搭起来", energy: 0.6,
        kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
        hat: "o.x.oox.o.x.oox.", hatKind: "type",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.4 }, pad: 0.75, lp: 2800, padVerb: 0.25 },
      { from: 8, to: 8, id: "gate-400", name: "400 大章：全场一顿，第三拍再接上", energy: 0.55,
        kick: "........X.x.....", duck: 0.5, snare: "............x...", snareKind: "thud",
        hat: "........o.x.oox.", hatKind: "type", bass: "slam", pad: 0.75, lp: 2400, padVerb: 0.3 },
      { from: 9, to: 12, id: "gate-sorting", name: "分拣台：四根气动管，律动全开", energy: 0.85,
        kick: ["X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x...x."], duck: 0.5,
        snare: ["....X.......X...", "....X.......X...", "....X.......X...", "....X.......X.ox"], snareKind: "thud",
        hat: "ooxoooxoooxoooxo", hatKind: "type",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.55 }, pad: 0.7, lp: 3200, padVerb: 0.22 },
      { from: 13, to: 14, id: "gate-lamps", name: "三盏灯：鼓让开，灯音拼出主题", energy: 0.6,
        kick: "X.......X.......", duck: 0.4, snare: "............x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "type", hatVol: 0.8, bass: "light", pad: 0.85, lp: 2800, padVerb: 0.3 },
      { from: 15, to: 15, id: "gate-202", name: "202 大章，然后被吸进实时那根管子", energy: 0.5,
        bass: "half", pad: 0.85, lp: 2600, padVerb: 0.35 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      ...phrase(0, THEME, "pluck", 1.3, true), // 0:0 拨弦唱主题，前奏只有 pad 垫着
      ...phrase(1, withNotes(["D5", "B4", "A4", "G4"]), "pluck", 0.55), // 同一节奏往下答一句（G6 上的 B 还原）
    ],
    // 剧情落点：画面里每一个「此刻发生」的动作
    story: [
      { bar: 2, beat: 0, kind: "key", pan: -0.2 }, // mac 那扇门开了
      { bar: 3, beat: 2, kind: "stamp", size: "mid" }, // 403：Emby 的钥匙开错了门
      { bar: 4, beat: 0, kind: "key", pan: -0.2 }, { bar: 4, beat: 0.5, kind: "key", v: 0.85, pan: 0.3 }, // Home Assistant 的钥匙开 /homepod，playstation 的钥匙开 /playstation
      // 检查单六项，一项一声「叮」，音高顺着和弦往上爬（A C D E G A，D 多利亚的五声）
      ...[[5, 0, "A5"], [5, 2, "C6"], [6, 0, "D6"], [6, 2, "E6"], [7, 0, "G6"], [7, 2, "A6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "tick", m: midi(n), i })),
      { bar: 8, beat: 0, kind: "stamp", size: "big" }, // 400 大章
      // 四根气动管：实时、可滞后、归档、凭据
      { bar: 9, beat: 0, kind: "whoosh", tube: 0 }, { bar: 9, beat: 2, kind: "whoosh", tube: 1 },
      { bar: 10, beat: 0, kind: "whoosh", tube: 2 }, { bar: 10, beat: 2, kind: "whoosh", tube: 3 },
      { bar: 11, beat: 0, kind: "whoosh", tube: "fork" }, // 服务器的信封一分为二
      // 202 等三盏灯：灯音就是主题的前三个音；D1 那盏晚半拍、在远处，唱主题的最后一个音
      { bar: 13, beat: 0, kind: "lamp", m: midi("A5"), i: 0 }, { bar: 13, beat: 2, kind: "lamp", m: midi("D6"), i: 1 }, { bar: 14, beat: 0, kind: "lamp", m: midi("F6"), i: 2 },
      { bar: 14, beat: 3, kind: "lamp", m: midi("E6"), i: 3, late: true },
      { bar: 15, beat: 0, kind: "stamp", size: "big" }, // 202 大章
      { bar: 15, beat: 2, kind: "whoosh", tube: "down" }, // 被吸进实时那根管子，落点在下一章 0:0
    ],
    // 全片母线的低通扫频：15:2 起往下关，下一章 0:0 最闷（380 Hz），0:1 打开（小节可以写到下一章去）
    sweeps: [{ at: [15, 2], down: [16, 0], up: [16, 1], f: 380 }],
  }),
});
