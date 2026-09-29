// 第 05 章「电报线」的配乐，18 小节，章内小节。写法见 ../CONVENTIONS.md「配乐」。
// 暗底示波器：踩镲用打字机的「嗒」当电键，轻重排成摩尔斯电码（o 是点、X 是划）；线上没有消息的那几小节（9–12）踩镲停下，只剩浏览器自己的钟在走。
// 主题换成闷音拨弦（像电键），最后那个长音拆成三下短点。调性：D 多利亚 / D 小调，收在 A7sus4 上交给第 06 章转调。
// 剧情落点和 ../ch05.js 顶部的时间表 AT 是同一组小节：改一边先对另一边，再对 SCRIPT.md。
(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch05",
  tone: { bell: "bright", pluckPan: -0.15, snareVerb: 0.14 },
  score: ({ THEME, withNotes, phrase, midi }) => {
    // 摩尔斯：一格一个十六分，字母内隔一格、字母间隔三格左右
    const M = {
      CQ: "X.o.X.o..X.X.o.X", // 呼叫：开场扫线
      WS: "o.X.X...o.o.o...",
      LI: "o.X.o.o...o.o...",
      VE: "o.o.o.X...o.....",
      OK: "X.X.X...X.o.X...", // 主角到站
      NO: "X.o...X.X.X.....", // 旧轮询被挡回
      ON: "X.X.X...X.o.....", // 在线人数
      ETA: "o...X...o.X.....", // 预期到货
      SK: "o.o.o.X.o.X.....", // 收报
    };
    // 主题：前三个音照旧，E5 那个长音拆成三下点（电键）
    const TAP = [[0, 0.75, "A4"], [0.75, 0.75, "D5"], [1.5, 0.5, "F5"], [2, 0.4, "E5"], [2.5, 0.4, "E5"], [3, 0.4, "E5"]];
    const up8 = TAP.map(([b, d, n]) => [b, d, n.replace(/\d$/, (o) => String(+o + 1))]);
    // 歌词占位逐字亮的节奏（和 ../ch05.js 的 LYR 一致）：两行各六块
    const LYR = [0, 0.5, 1, 1.5, 2, 3];
    return {
      harm: [
        "Dm9", "Dm9", "G6", "Fmaj7", [["C69", 0], ["A7sus4", 2]],
        "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]],
        "Dmadd9", "Bbmaj7s11", "Gm9", [["Em7b5", 0], ["A7", 2]],
        "Dm9", "G6", "Fmaj7", "C69", [["Gm9", 0], ["A7sus4", 2]],
      ],
      sections: [
        { from: 0, to: 0, id: "wire-sweep", name: "扫线：黑里一个亮点走过去，踩镲敲 CQ", energy: 0.2,
          hat: M.CQ, hatKind: "type", hatVol: 0.8, ghost: [2, 0.15, 0.3], bass: "hold", pad: 0.9, lp: 1500, padVerb: 0.38 },
        { from: 1, to: 4, id: "wire-parse", name: "页面解析、电报线接上、托盘、hydrate：轻底鼓，踩镲拼 WS LIVE", energy: 0.45,
          kick: "X.......X.......", kickKind: "light", duck: 0.4,
          hat: [M.WS, M.LI, M.VE, M.WS], hatKind: "type", hatVol: 0.85,
          bass: "light", arp: { p: "sparse", lo: 57, inst: "pluckDark", v: 0.4 }, pad: 0.8, lp: 2000, padVerb: 0.32 },
        { from: 5, to: 6, id: "wire-hero", name: "主角到站：主题（闷音拨弦）、翻面，律动搭起来", energy: 0.8,
          kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "rim",
          hat: [M.OK, M.WS], hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.4 }, pad: 0.75, lp: 2600, padVerb: 0.26 },
        { from: 7, to: 8, id: "wire-stale", name: "旧轮询慢慢爬回来，8:0 撞上闸门", energy: 0.55,
          kick: "X.......X.......", kickKind: "light", duck: 0.45, snare: [null, "............x..."], snareKind: "rim",
          hat: [M.NO, M.NO], hatKind: "type", hatVol: 0.8,
          bass: "light", pad: 0.8, lp: 2000, padVerb: 0.3 },
        { from: 9, to: 12, id: "wire-quiet", name: "线上没有消息：踩镲停下，只剩浏览器自己的钟", energy: 0.35,
          kick: "X...............", kickKind: "light", duck: 0.35, ghost: [2, 0.12, 0.3],
          clock: "x...o...x...o...", clockVol: 0.9,
          bass: "hold", pad: 0.9, lp: 1300, padVerb: 0.4 },
        { from: 13, to: 14, id: "wire-census", name: "同一根线数两种人：律动回来，踩镲敲 ON", energy: 0.6,
          kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "rim",
          hat: [M.ON, M.WS], hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 62, inst: "pluckDark", v: 0.38 }, pad: 0.8, lp: 2200, padVerb: 0.3 },
        { from: 15, to: 16, id: "wire-schedule", name: "预期到货表：一行一声叮，踩镲敲 ETA", energy: 0.75,
          kick: "X.......X.x.....", duck: 0.5, snare: ["....x.......x...", "....x.......x.oo"], snareKind: "rim",
          hat: [M.ETA, M.ETA], hatKind: "type",
          bass: "groove", arp: { p: "332", lo: 62, inst: "pluckDark", v: 0.42 }, pad: 0.75, lp: 2600, padVerb: 0.26 },
        { from: 17, to: 17, id: "wire-flat", name: "示波线拉平：踩镲敲 SK（收报），吸一口气交给第 06 章", energy: 0.4,
          kick: "X...............", kickKind: "light", duck: 0.4,
          hat: M.SK, hatKind: "type", hatVol: 0.75, bass: "hold", pad: 1, lp: 1800, padVerb: 0.4 },
      ],
      melody: [
        // 5:0 主角到站：闷音拨弦唱主题，高八度轻轻叠一层
        ...phrase(5, TAP, "pluckMute", 1.35, true),
        ...phrase(5, up8, "pluckMute", 0.45),
        // 6：FM 铃往下答一句（B♭ 上的 E 是 #11）
        ...phrase(6, withNotes(["D5", "F5", "E5", "C5"]), "bell", 0.5),
        // 9–10：歌词占位逐块亮，铃跟着轻轻唱（Dmadd9 → B♭maj7#11）
        ...LYR.map((b, i) => [9, b, 0.5, ["A4", "C5", "D5", "E5", "D5", "A4"][i], "bell", 0.34, false]),
        ...LYR.map((b, i) => [10, b, 0.5, ["F4", "A4", "D5", "E5", "D5", "C5"][i], "bell", 0.34, false]),
      ],
      story: [
        { bar: 0, beat: 0, kind: "accent", what: "arrive" }, // 硬切进暗底：一声低「咚」
        { bar: 2, beat: 0, kind: "lamp", m: midi("A5"), i: 1 }, // head 里的小脚本接上电报线
        { bar: 2, beat: 1, kind: "key", v: 0.7, pan: -0.3 }, // 三封电报进托盘：online、desktop、playing-now
        { bar: 2, beat: 3, kind: "key", v: 0.7, pan: 0 },
        { bar: 3, beat: 1, kind: "key", v: 0.7, pan: 0.3 },
        { bar: 3, beat: 1, kind: "swell" }, // 吸一口气，3:2 hydrate
        { bar: 3, beat: 2, kind: "accent", what: "slip" }, // useLiveEvents 接过这根线
        // 托盘里的按顺序重放：一封一声「叮」，往上爬
        ...[[3, 3, "A5"], [4, 0, "C6"], [4, 1, "D6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "tick", m: midi(n), i })),
        { bar: 5, beat: 2, kind: "accent", what: "flip" }, // 「正在听」翻面
        { bar: 8, beat: 0, kind: "stamp", size: "mid" }, // 旧轮询撞上时间戳闸门
        { bar: 12, beat: 0, kind: "lamp", m: midi("D5"), i: 0, late: true }, // 在线点到点自己熄灭：远处很轻的一声
        { bar: 13, beat: 2, kind: "key", v: 0.8, pan: 0.2 }, // 标签页切到后台，只发一声 hidden
        { bar: 14, beat: 0, kind: "tick", m: midi("E6"), i: 3 }, // 在线人数少一个
        // 预期到货表：三行、公式
        ...[[15, 1, "A5"], [15, 2, "C6"], [15, 3, "D6"], [16, 0, "F6"]].map(([bar, beat, n], i) => ({ bar, beat, kind: "tick", m: midi(n), i })),
        { bar: 16, beat: 2, kind: "stamp", size: "mid" }, // 「5 min」兜底章
        { bar: 17, beat: 3, kind: "swell" }, // 交给第 06 章
      ],
    };
  },
});
