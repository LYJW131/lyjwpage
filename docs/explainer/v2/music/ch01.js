// 第 01 章「野外观测站」的配乐，31 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 暗底专利图，镜头沿一长条图纸横移，一件仪器一个机位：翻图纸的「沙」当踩镲，打字机敲出信封；
// 信封主题交给仪器的读数灯（旋律乐器 glass，本章专用的玻璃 FM）来唱；每次甩镜头一口风（whoosh 的 tube: "whip"），甩回 Mac 那一下最响。
// 每到一个图号落一声「叮」（A C D E G A 往上爬）；编码用量那段三处各亮一盏灯、合并时补上第四个音，拼出主题；表盘那段钟摆每拍滴答。
// 调性：D 多利亚 / D 小调，收在 A7sus4 上交给第 02 章的 Dm9：那边 0:0 拨弦唱主题，这边最后一小节收住给它让路。
// 剧情落点和 ../ch01.js 顶部的时间表 AT、机位表 STOPS 是同一组小节：改一边先对另一边，再对 SCRIPT.md。
// 甩镜头 0.25 小节（x.75 → 下一小节 0:0），最快在 x:3.5；风声 0.62 秒、中点最响，所以从 x:2.95 起。甩回 Mac 那一下 29.7 → 30:0，从 29:2.85 起
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch01",
  tone: { bell: "bright", pluckPan: 0.2, snareVerb: 0.16 },
  score: ({ THEME, withNotes, phrase, midi }) => ({
    harm: [
      "Dmadd9", "Bbmaj7", "Gm9", "Dm9", "G6", "Fmaj7", "C69",
      "Bbmaj7", "Dm9", "Fmaj7", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", [["G6", 0], ["Fmaj7", 2]],
      "C69", "Bbmaj7", "Dm9", [["G6", 0], ["C69", 2]],
      "Bbmaj7", "Dm9",
      "Fmaj7", "C69", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", [["G6", 0], ["C69", 2]],
      "Bbmaj7", "Dm9", [["G6", 0], ["C69", 2]],
      "Gm9", "Dm9", [["Bbmaj7", 0], ["C69", 2]],
      "A7sus4",
    ],
    sections: [
      { from: 0, to: 1, id: "field-title", name: "硬切进暗底：一声低「咚」，pad 和翻图纸声，标题和图纸索引", energy: 0.3,
        ghost: [2, 0.15, 0.3], hat: ["......x.......x.", "..x...x...x.x.x."], hatKind: "flip", hatVol: 0.7,
        bass: "hold", pad: 0.9, lp: 1500, padVerb: 0.4 },
      { from: 2, to: 6, id: "field-mac", name: "FIG. 1 Mac：打字机敲出信封的格式；3:0 换歌、读数灯唱主题；空信封呼吸一次；切应用两下、量满 400 ms", energy: 0.5,
        kick: "X.......x.......", kickKind: "light", duck: 0.4,
        hat: ["o.x.oox.o.x.oox.", "..x...x...x...x.", "..x...x...x...x.", "X...X.x...x.o.x.", "..x...x...x...x."], hatKind: "type", hatVol: 0.85,
        bass: "light", arp: { p: "sparse", lo: 57, inst: "pluckDark", v: 0.4 }, pad: 0.85, lp: 1900, padVerb: 0.34 },
      { from: 7, to: 10, id: "field-jev", name: "FIG. 1A / 1B：问题横条同时走（十六分的钟摆），8:0 概率条一起出来；9:0 起图标压成哈希、落进 R2", energy: 0.62,
        kick: "X.......X.x.....", duck: 0.5, snare: [null, "....x.......x...", "....x.......x...", "....x.......x..."], snareKind: "rim",
        hat: ["..x...x...x...x.", "..x...x...x.oxox", "....oxoxo...x...", "..x...x...x...x."], hatKind: "type", hatVol: 0.8,
        clock: ["xoooxoooxoooxooo", null, null, null], clockVol: 0.8,
        bass: "groove", arp: { p: "332", lo: 57, inst: "pluckDark", v: 0.42 }, pad: 0.8, lp: 2200, padVerb: 0.3 },
      { from: 11, to: 12, id: "field-iphone", name: "FIG. 2 iPhone：律动进来，翻图纸当踩镲", energy: 0.72,
        kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.4 }, pad: 0.78, lp: 2600, padVerb: 0.28 },
      { from: 13, to: 16, id: "field-home", name: "FIG. 3 家里：14:0、16:0 两把钥匙，15:0 主机开机，15:1 第一探有回音", energy: 0.8,
        kick: ["X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x...x."], duck: 0.5,
        snare: "....x.......x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.45 }, pad: 0.75, lp: 2800, padVerb: 0.28 },
      { from: 17, to: 23, id: "field-stations", name: "FIG. 4–6：NAS、东京的机柜、云端的一小段遥测，律动全开", energy: 0.85,
        kick: ["X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x...x.", "X.......X.x.....", "X.......X.x...x."], duck: 0.5,
        snare: "....x.......x...", snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip",
        bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.45 }, pad: 0.75, lp: 2800, padVerb: 0.28 },
      { from: 24, to: 26, id: "field-merge", name: "编码用量：三处各亮一盏灯，合并那一下补上第四个音", energy: 0.7,
        kick: "X.......X.......", duck: 0.45, snare: ["............x...", "....x.......x...", "....x.......x..."], snareKind: "thud",
        hat: "..x...x...x...x.", hatKind: "flip", hatVol: 0.8,
        bass: "light", pad: 0.8, lp: 2400, padVerb: 0.32 },
      { from: 27, to: 29, id: "field-dial", name: "FIG. 7 表盘：一拍当一分钟，钟摆每拍滴答，到期的指针跟着弹", energy: 0.75,
        kick: "X.......X.......", kickKind: "light", duck: 0.45,
        clock: "X...x...x...x...", clockVol: 1.1,
        bass: "offbeat", bassVol: 1.1, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.36 }, pad: 0.75, lp: 2000, padVerb: 0.32 },
      { from: 30, to: 30, id: "field-launch", name: "甩回 Mac：那封信亮起、飞出画面；收在 A7sus4 上，给第 02 章 0:0 的主题让路", energy: 0.35,
        kick: "X...............", kickKind: "light", duck: 0.4, bass: "hold", pad: 0.9, lp: 1800, padVerb: 0.45 },
    ],
    // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
    melody: [
      // 3:0 换歌：读数灯唱信封主题（A4 D5 F5 E5），E5 落在 3:2，白卡上 appleMusic 那格同一拍亮
      ...phrase(3, THEME, "glass", 1, true),
      ...phrase(3, withNotes(["A3", "D4", "F4", "E4"]), "pluckDark", 0.4), // 低八度闷拨弦垫一层
      ...phrase(4, withNotes(["C5", "D5", "A4", "G4"]), "pluckDark", 0.42), // 往下答一句（G6 上的 C 是挂留）
    ],
    // 剧情落点：画面里每一个「此刻发生」的动作
    story: [
      { bar: 0, beat: 0, kind: "accent", what: "arrive" }, // 硬切进暗底：一声低「咚」
      // 往右甩到下一件仪器：风从右往左扫，比别的剧情音轻
      ...[1, 6, 10, 12, 16, 18, 21, 23, 26].map((bar) => ({ bar, beat: 2.95, kind: "whoosh", tube: "whip", v: 0.7, pan: 0.45, panTo: -0.45 })),
      { bar: 29, beat: 2.85, kind: "whoosh", tube: "whip", pan: -0.5, panTo: 0.6 }, // 一路甩回 Mac：镜头往左，风从左往右
      { bar: 3, beat: 3, kind: "accent", what: "slip" }, // 信封从 Hub 出来，停到笔记本旁边
      { bar: 4, beat: 1, kind: "swell" }, // 空信封吸一口气
      { bar: 4, beat: 2, kind: "lamp", m: midi("D5"), i: 2, late: true }, // 呼出去：远处很轻的一声
      { bar: 5, beat: 3, kind: "tick", m: midi("A5"), i: 0 }, // 量满 400 ms，落定
      { bar: 8, beat: 0, kind: "accent", what: "flip" }, // 概率条同一刻一起出来
      { bar: 8, beat: 1, kind: "accent", what: "slip" }, // 放行的标题滑进信封
      { bar: 8, beat: 2, kind: "tick", m: midi("E6"), i: 3 }, // 拿不准的弹给主人
      { bar: 9, beat: 3, kind: "key", pan: 0.3 }, // R2 的抽屉关上（同一刻信封里写上对象键）
      // 一站一声「叮」，顺着 D 小调五声往上爬
      ...[[11, "A5"], [13, "C6"], [17, "D6"], [19, "E6"], [22, "G6"], [27, "A6"]].map(([bar, n], i) => ({ bar, beat: 0, kind: "tick", m: midi(n), i: i % 5 })),
      { bar: 11, beat: 1, kind: "lamp", m: midi("A5"), i: 0, late: true }, // HealthKit 把手机叫醒
      { bar: 14, beat: 0, kind: "key", pan: -0.2 }, // Home Assistant 的钥匙开 /homepod
      { bar: 15, beat: 0, kind: "accent", what: "flip" }, // PS5 开机，灯条亮
      { bar: 15, beat: 1, kind: "lamp", m: midi("G5"), i: 2, late: true }, // 第一探有回音；档位牌翻面、问 PSN 都不另配声
      { bar: 16, beat: 0, kind: "key", v: 0.85, pan: 0.35 }, // 容器自己的钥匙开 /playstation
      { bar: 17, beat: 2, kind: "whoosh", tube: 2 }, // 海报先传 R2
      { bar: 18, beat: 0, kind: "accent", what: "slip" }, // 在看什么，信封寄出去
      // 东京那台主机上的三个容器依次亮起：远处的灯
      { bar: 19, beat: 1, kind: "lamp", m: midi("A5"), i: 0, late: true }, { bar: 19, beat: 3, kind: "lamp", m: midi("C6"), i: 1, late: true },
      { bar: 20, beat: 1, kind: "lamp", m: midi("D6"), i: 2, late: true },
      // 编码用量：Mac、云端、Cursor 各亮一盏灯（A5 D6 F6），25:0 合并补上 E6，拼出主题
      { bar: 24, beat: 2, kind: "lamp", m: midi("A5"), i: 0 }, { bar: 24, beat: 2.5, kind: "lamp", m: midi("D6"), i: 1 }, { bar: 24, beat: 3, kind: "lamp", m: midi("F6"), i: 2 },
      { bar: 25, beat: 0, kind: "lamp", m: midi("E6"), i: 1 },
      { bar: 30, beat: 0, kind: "lamp", m: midi("D6"), i: 1 }, // 那封信亮起
      { bar: 30, beat: 1, kind: "whoosh", tube: 3 }, // 往右飞出画面
      { bar: 30, beat: 3, kind: "swell" }, // 吸一口气，交给第 02 章
    ],
  }),
});
