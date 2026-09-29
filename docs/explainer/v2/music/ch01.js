// 第 01 章「野外观测站」的配乐，20 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 暗底专利图，镜头沿一长条图纸横移：翻图纸的「沙」当踩镲，打字机敲出信封；信封主题交给仪器的读数灯（玻璃味的 FM「叮」）来唱。
// 每到一个图号落一声「叮」（A C D E G A 往上爬）；编码用量那段三处各亮一盏灯、合并时补上第四个音，拼出主题；表盘那段钟摆每拍滴答。
// 调性：D 多利亚 / D 小调，收在 A7sus4 上交给第 02 章的 Dm9：那边 0:0 拨弦唱主题，这边最后一小节收住给它让路。
// 剧情落点和 ../ch01.js 顶部的时间表 AT 是同一组小节：改一边先对另一边，再对 SCRIPT.md。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch01",
  tone: { bell: "bright", pluckPan: 0.2, snareVerb: 0.16 },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    harm: [
      "Dmadd9", "Bbmaj7", "Dm9", "G6", "Fmaj7", "C69", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", [["G6", 0], ["Fmaj7", 2]], "C69", "Bbmaj7", "Dm9", [["G6", 0], ["C69", 2]],
      "Bbmaj7", "Dm9", "Gm9", "Dm9", [["Bbmaj7", 0], ["C69", 2]], "A7sus4",
    ],
    sections: [
      { from: 0, to: 1, id: "field-title", name: "硬切进暗底：一声低「咚」，pad 和翻图纸声，标题和图纸索引", energy: 0.3,
        ghost: [2, 0.15, 0.3], hat: ["......x.......x.", "..x...x...x.x.x."], hatKind: "flip", hatVol: 0.7,
        bass: "hold", pad: 0.9, lp: 1500, padVerb: 0.4 },
      { from: 2, to: 4, id: "field-mac", name: "FIG. 1 Mac：读数灯唱主题、打字机敲出信封；空信封呼吸一次；切应用两下、量满 400 ms", energy: 0.5,
        kick: "X.......x.......", kickKind: "light", duck: 0.4,
        hat: ["o.x.oox.o.x.oox.", "..x...x...x...x.", "X...X.x...x.o.x."], hatKind: "type", hatVol: 0.85,
        bass: "light", arp: { p: "sparse", lo: 57, inst: "pluckDark", v: 0.4 }, pad: 0.85, lp: 1900, padVerb: 0.34 },
      { from: 5, to: 7, id: "field-jev", name: "FIG. 1A / 1B：问题横条同时走（十六分的钟摆），6:0 概率条一起出来；图标压成哈希、落进 R2", energy: 0.62,
        kick: "X.......X.x.....", duck: 0.5, snare: [null, "....x.......x...", "....x.......x..."], snareKind: "rim",
        hat: ["..x...x...x...x.", "..x...x...x.oxox", "o.x.o.......x..."], hatKind: "type", hatVol: 0.8,
        clock: ["xoooxoooxoooxooo", null, null], clockVol: 0.8,
        bass: "groove", arp: { p: "332", lo: 57, inst: "pluckDark", v: 0.42 }, pad: 0.8, lp: 2200, padVerb: 0.3 },
      { from: 8, to: 13, id: "field-stations", name: "FIG. 2–6：一站一声「叮」，翻图纸当踩镲，律动全开", energy: 0.85,
        kick: ["X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x...x."], duck: 0.5,
        snare: "....x.......x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.45 }, pad: 0.75, lp: 2800, padVerb: 0.28 },
      { from: 14, to: 15, id: "field-merge", name: "编码用量：三处各亮一盏灯，合并那一下补上第四个音", energy: 0.7,
        kick: "X.......X.......", duck: 0.45, snare: ["............x...", "....x.......x..."], snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", hatVol: 0.8,
        bass: "light", pad: 0.8, lp: 2400, padVerb: 0.32 },
      { from: 16, to: 18, id: "field-dial", name: "FIG. 7 表盘：一拍当一分钟，钟摆每拍滴答，到期的指针跟着弹", energy: 0.75,
        kick: "X.......X.......", kickKind: "light", duck: 0.45,
        clock: "X...x...x...x...", clockVol: 1.1,
        bass: "offbeat", bassVol: 1.1, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.36 }, pad: 0.75, lp: 2000, padVerb: 0.32 },
      { from: 19, to: 19, id: "field-launch", name: "甩回 Mac：那封信亮起、飞出画面；收在 A7sus4 上，给第 02 章 0:0 的主题让路", energy: 0.35,
        kick: "X...............", kickKind: "light", duck: 0.4, bass: "hold", pad: 0.9, lp: 1800, padVerb: 0.45 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]。主题本身由 story 里的读数灯唱（见下）
    melody: [
      ...phrase(2, withNotes(["A3", "D4", "F4", "E4"]), "pluckDark", 0.4), // 读数灯唱主题时，低八度闷拨弦垫一层
      ...phrase(3, withNotes(["C5", "D5", "A4", "G4"]), "pluckDark", 0.42), // 往下答一句（G6 上的 C 是挂留）
    ],
    // 剧情落点：画面里每一个「此刻发生」的动作
    story: [
      { bar: 0, beat: 0, kind: "accent", what: "arrive" }, // 硬切进暗底：一声低「咚」
      // 2:0 换歌：读数灯唱信封主题（A4 D5 F5 E5），E5 落在 2:2，白卡上 appleMusic 那格同一拍亮
      ...THEME.map(([beat, , n]) => ({ bar: 2, beat, kind: "lamp", m: midi(n), i: 1 })),
      { bar: 2, beat: 3, kind: "accent", what: "slip" }, // 信封从 Hub 出来，停到笔记本旁边
      { bar: 3, beat: 0, kind: "swell" }, // 空信封吸一口气
      { bar: 3, beat: 1, kind: "lamp", m: midi("D5"), i: 2, late: true }, // 呼出去：远处很轻的一声
      { bar: 4, beat: 3, kind: "tick", m: midi("A5"), i: 0 }, // 量满 400 ms，落定
      { bar: 6, beat: 0, kind: "accent", what: "flip" }, // 概率条同一刻一起出来
      { bar: 6, beat: 1, kind: "accent", what: "slip" }, // 放行的标题滑进信封
      { bar: 6, beat: 2, kind: "tick", m: midi("E6"), i: 3 }, // 拿不准的弹给主人
      { bar: 7, beat: 1, kind: "key", pan: 0.3 }, // R2 的抽屉关上（同一刻信封里写上文件名）
      // 一站一声「叮」，顺着 D 小调五声往上爬
      ...[[8, 0, "A5"], [9, 2, "C6"], [11, 0, "D6"], [12, 0, "E6"], [13, 2, "G6"], [16, 0, "A6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "tick", m: midi(n), i: i % 5 })),
      { bar: 8, beat: 2, kind: "lamp", m: midi("A5"), i: 0, late: true }, // HealthKit 把手机叫醒
      { bar: 10, beat: 0, kind: "accent", what: "flip" }, // PS5 开机，灯条亮
      { bar: 10, beat: 1, kind: "lamp", m: midi("G5"), i: 2, late: true }, // n100 上的容器放出第一个 UDP 探测点：远处一声；半拍后档位牌翻到快档、问一轮 PSN，都不另配声（这一小节已有翻面和两声钥匙）
      { bar: 10, beat: 2, kind: "key", pan: -0.2 }, // Home Assistant 的钥匙开 /homepod
      { bar: 10, beat: 3, kind: "key", v: 0.85, pan: 0.35 }, // 容器自己的钥匙开 /playstation
      { bar: 11, beat: 1, kind: "whoosh", tube: 2 }, // 海报先传 R2
      { bar: 11, beat: 2, kind: "accent", what: "slip" }, // 在看什么，信封寄出去
      // 编码用量：Mac、云端、Cursor 各亮一盏灯（A5 D6 F6），15:0 合并补上 E6，拼出主题
      { bar: 14, beat: 2, kind: "lamp", m: midi("A5"), i: 0 }, { bar: 14, beat: 2.5, kind: "lamp", m: midi("D6"), i: 1 }, { bar: 14, beat: 3, kind: "lamp", m: midi("F6"), i: 2 },
      { bar: 15, beat: 0, kind: "lamp", m: midi("E6"), i: 1 },
      { bar: 18, beat: 3, kind: "whoosh", tube: 0 }, // 甩回 Mac
      { bar: 19, beat: 0, kind: "lamp", m: midi("D6"), i: 1 }, // 那封信亮起
      { bar: 19, beat: 1, kind: "whoosh", tube: 3 }, // 往右飞出画面
      { bar: 19, beat: 3, kind: "swell" }, // 吸一口气，交给第 02 章
    ],
  }),
});
