// 第 09 章「发布」的配乐，16 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 0:0 从第 08 章的 A7sus4 硬切进纸面，低低一声落地；打字机敲 `git push origin main`，1:0 回车、纸滑出去（推上 GitHub）。
// 1:2 分叉声：几条流水线从 HEAD 散开；2:0 起每条闸门一个十六分：放行的一声「叮」（往上爬），没改到的一声闷拨弦。
// 详图 A 检查单、B Worker、C 上报器：每一步一声叮，发布成功一声灯；B 里 wrangler deploy 和 C 里推 GHCR 是气动管，
// C 的 ssh 是钥匙（受限的部署密钥），公证在排队时钟摆走、公证完一记印章。
// 10:0 Vercel 生产部署成功：落地一声 + 灯；10:2 刷新 ESA 一记印章、10:3 预热是气动管，11:0 / 11:1 两个域名各一声叮；
// 12:0 GitHub Actions 的钥匙去敲上报入口；13:0 推送房间广播 version，第二支铃唱信封主题、拨弦低八度跟着；
// 14:0 前台页面弹出 UPDATE 卡（翻面一记），14:2 后台标签页自己刷新（纸滑）。
// 15 拉远看整张图、回到主轴，15:3 吸一口气，收在 A9sus4 交给第 10 章（它 0:0 落回 Dm9）。
// 调性：D 多利亚。本章的和弦（名字全片唯一）：Dsus2 开场的空五度、Dm69 多利亚的主和弦、G9 多利亚的 IV、Fmaj9 / Cadd9 关系大调那一侧、
// Bbadd9 ♭VI、A7b9 进主题前的属和弦、Ebmaj7s11 结尾的那不勒斯（♭II），A9sus4 交给下一章。
// 剧情落点和 ../ch09.js 顶部的时间表 AT 是同一组小节：改一边先对另一边，再对 SCRIPT.md。
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
    // 2:0 起八条闸门一个十六分一条（从上到下：Hub、上报器镜像、CodeQL、CI、Vercel、api、ingress、collector）；
    // ingress、collector 这次没改到，闷拨弦
    const GATES = ["A5", "C6", "D6", "E6", "F6", "A6", null, null];
    const gates = GATES.flatMap((n, i) => (n
      ? [{ bar: 2, beat: i * 0.25, kind: "tick", m: midi(n), i: i % 3 }]
      : []));
    const skipped = [[2, 1.5], [2, 1.75], [6, 1], [6, 3]].map(([bar, beat]) => [bar, beat, 0.5, "D3", "pluckMute", 0.55, false]);
    return {
      harm: [
        "Dsus2", [["Dsus2", 0], ["Am7", 2]], "Dm69", "G9",
        "Fmaj9", "Cadd9", "Dm69", "Bbadd9",
        "G9", [["Fmaj9", 0], ["A9sus4", 2]], "Dm69", "Cadd9",
        [["Bbadd9", 0], ["A7b9", 2]], "Dm69", [["G9", 0], ["Fmaj9", 2]], [["Ebmaj7s11", 0], ["A9sus4", 2]],
      ],
      sections: [
        { from: 0, to: 0, id: "release-type", name: "硬切纸面：只有 pad 和打字机，敲出 git push origin main", energy: 0.25,
          hat: "....xxxxxxxxxx..", hatKind: "type", hatVol: 0.8, ghost: [2, 0.12, 0.3], pad: 0.8, lp: 1700, padVerb: 0.34 },
        { from: 1, to: 1, id: "release-enter", name: "回车，推上 GitHub；1:2 几条流水线从 HEAD 散开", energy: 0.4,
          kick: "X.......x.......", kickKind: "light", duck: 0.4, hat: "X.......o.o.o.o.", hatKind: "type", hatVol: 0.9,
          bass: "light", pad: 0.8, lp: 2200, padVerb: 0.32 },
        { from: 2, to: 3, id: "release-fanout", name: "闸门一条一声，律动进来：几条流水线同时在跑", energy: 0.68,
          kick: "X...X...X...X...", kickKind: "light", duck: 0.45, hat: "..x...x...x...x.", hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.34 }, pad: 0.75, lp: 2800, padVerb: 0.28 },
        { from: 4, to: 5, id: "release-checks", name: "详图 A 检查单：CI 四项、CodeQL 两项，一项一声叮", energy: 0.74,
          kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
          hat: "o.x.oox.o.x.oox.", hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.36 }, pad: 0.72, lp: 3000, padVerb: 0.26 },
        { from: 6, to: 7, id: "release-workers", name: "详图 B Worker：api 构建、发布；ingress、collector 这次不跑", energy: 0.7,
          kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
          hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "queue", lo: 62, inst: "pluckDark", v: 0.4 }, pad: 0.75, lp: 2600, padVerb: 0.3 },
        { from: 8, to: 9, id: "release-reporters", name: "详图 C 上报器：镜像推 GHCR、钥匙换容器；Hub 排队公证（钟摆走）", energy: 0.72,
          kick: "X...X...X...X...", kickKind: "light", duck: 0.45, snare: [null, "....o.......o..."], snareKind: "rim",
          hat: "o.x.o.x.o.x.o.x.", hatKind: "type", hatVol: 0.8, clock: [null, "......xoxoxo...."], clockVol: 1,
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.32 }, pad: 0.75, lp: 2800, padVerb: 0.3 },
        { from: 10, to: 11, id: "release-landing", name: "落地：Vercel 生产部署成功，刷新 ESA、等两个域名", energy: 0.8,
          kick: "X.......X.......", duck: 0.5, hat: "..x...x...x...x.", hatKind: "flip",
          bass: "reveal", arp: { p: "sparse", lo: 69, inst: "bell", v: 0.3 }, pad: 0.85, lp: 3200, padVerb: 0.34 },
        { from: 12, to: 12, id: "release-notify", name: "GitHub Actions 的钥匙敲上报入口，接着交给推送房间", energy: 0.74,
          kick: "X...X...X...X.x.", duck: 0.45, hat: "..x...x...x...x.", hatKind: "flip",
          bass: "light", pad: 0.8, lp: 2800, padVerb: 0.32 },
        { from: 13, to: 14, id: "release-version", name: "广播 version：第二支铃唱主题；前台弹卡、后台自己刷新", energy: 0.86,
          kick: "X.......X.x.....", duck: 0.5, snare: ["....x.......x...", "....x.......x.ox"], snareKind: "thud",
          hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "queue", lo: 69, inst: "bell", v: 0.26 }, pad: 0.72, lp: 3400, padVerb: 0.3 },
        { from: 15, to: 15, id: "release-end", name: "拉远看整张图，回到主轴；15:3 吸一口气，交给第 10 章", energy: 0.45,
          kick: "X...............", duck: 0.45, bass: "hold", pad: 0.9, lp: 2200, padVerb: 0.45 },
      ],
      // 旋律：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
      melody: [
        [0, 0, 8, "A4", "bell", 0.3, false], [0, 0, 8, "E5", "bell2", 0.2, false], // 硬切落地：空五度垫着
        ...skipped,
        // 13:0 广播 version：第二支铃唱主题（高八度），拨弦低八度跟着
        ...phrase(13, withNotes(["A5", "D6", "F6", "E6"]), "bell2", 1.2, true),
        ...phrase(13, THEME, "pluck", 0.5),
        ...phrase(14, withNotes(["F5", "E5", "D5", "C5"]), "pluck", 0.42), // UPDATE 卡弹出后，往下答一句
      ],
      story: [
        { bar: 0, beat: 0, kind: "boom" }, // 硬切到纸面
        { bar: 1, beat: 0, kind: "accent", what: "slip" }, // 回车：提交推上 GitHub
        { bar: 1, beat: 2, kind: "whoosh", tube: "fork" }, // 几条流水线从 HEAD 散开
        ...gates,
        // 详图 A：CI 四项（每拍一项）、CodeQL 两项（后半拍）；5:0 CI 通过、5:1 CodeQL 扫完
        ...[[4, 0, "A5"], [4, 1, "C6"], [4, 2, "D6"], [4, 3, "E6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "tick", m: midi(n), i })),
        ...[[4, 1.5, "G5"], [4, 3.5, "A5"]].map(([bar, beat, n]) => ({ bar, beat, kind: "tick", m: midi(n), i: 2 })),
        { bar: 5, beat: 0, kind: "lamp", m: midi("F6"), i: 0 }, { bar: 5, beat: 1, kind: "lamp", m: midi("D6"), i: 2 },
        // 详图 B：api 的 typecheck、wrangler deploy（气动管），7:0 上线
        { bar: 6, beat: 0, kind: "tick", m: midi("D6"), i: 1 }, { bar: 6, beat: 2, kind: "whoosh", tube: 1 },
        { bar: 7, beat: 0, kind: "lamp", m: midi("A5"), i: 1 },
        // 详图 C：镜像 build → 推 GHCR（气动管）→ ssh（钥匙）→ 容器跑起来；9:0 misaka-jp 上线
        { bar: 8, beat: 0, kind: "tick", m: midi("A5"), i: 0 }, { bar: 8, beat: 1, kind: "whoosh", tube: 2 },
        { bar: 8, beat: 2, kind: "key", v: 0.8, pan: 0.25 }, { bar: 8, beat: 3, kind: "tick", m: midi("E6"), i: 2 },
        { bar: 9, beat: 0, kind: "lamp", m: midi("D6"), i: 0 },
        // Hub：9:1 Developer ID 签名，公证排队（钟摆），9:2.5 公证完一记印章，9:3 发 Release
        { bar: 9, beat: 1, kind: "tick", m: midi("C6"), i: 1 }, { bar: 9, beat: 2.5, kind: "stamp", size: "mid" },
        { bar: 9, beat: 3, kind: "lamp", m: midi("F6"), i: 2 },
        // 落地：10:0 生产部署成功，10:1 deployment_status，10:2 刷新 ESA，10:3 预热，11:0 / 11:1 两个域名答出新版，11:2 第二项勾上
        { bar: 10, beat: 0, kind: "accent", what: "arrive" }, { bar: 10, beat: 0, kind: "lamp", m: midi("A5"), i: 1 },
        { bar: 10, beat: 1, kind: "tick", m: midi("C6"), i: 0 }, { bar: 10, beat: 2, kind: "stamp", size: "mid" },
        { bar: 10, beat: 3, kind: "whoosh", tube: 3 },
        { bar: 11, beat: 0, kind: "tick", m: midi("D6"), i: 0 }, { bar: 11, beat: 1, kind: "tick", m: midi("E6"), i: 2 },
        { bar: 11, beat: 2, kind: "tick", m: midi("F6"), i: 1 },
        // 12:0 GitHub Actions 的钥匙；12:2 上报入口放行，12:3 吸一口气进广播
        { bar: 12, beat: 0, kind: "key", pan: 0.2 }, { bar: 12, beat: 2, kind: "tick", m: midi("A5"), i: 1 },
        { bar: 12, beat: 3, kind: "swell" },
        { bar: 13, beat: 0, kind: "accent", what: "broadcast" }, // 推送房间广播 version
        { bar: 14, beat: 0, kind: "accent", what: "flip" }, // 前台：UPDATE 卡纵向弹出
        { bar: 14, beat: 2, kind: "accent", what: "slip" }, // 后台标签页自己刷新
        { bar: 15, beat: 0, kind: "whoosh", tube: 0 }, // 拉远看整张图
        { bar: 15, beat: 3, kind: "swell" }, // 回到主轴，交给第 10 章
      ],
    };
  },
});
