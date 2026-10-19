(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch08",
  tone: { bell: "warm", pluckPan: 0.15, snareVerb: 0.14 },
  score: ({ THEME, withNotes, phrase }) => {
    // 画面里每个动作配一个现成的音效文件（sfx/），时刻按画面原来的 20 小节写，经 SLOW 换算到播放的小节。
    // SLOW 须与 ch08.js 的同名表一致。
    const SLOW = [[3.0, 4.5], [5.0, 7.0], [7.75, 10.25], [11.0, 13.0]];
    const played = (o) => { let n = 0, p = 0; for (const [a, b] of SLOW) { if (o <= a) return n + o - p; n += a - p; if (o <= b) return n + (o - a) * 1.5; n += (b - a) * 1.5; p = b; } return n + o - p; };
    // 渐强类音效（和插头、碰杯这种最响一下在后面的）提前起，让最响的那一下落在卡点上；秒数是 earshot 量的各文件峰值时刻，换音效文件要重量
    const LEAD = { whoosh: 0.068, plug: 0.278, tube: 0.478, glass: 0.315, valve: 0.826, zip: 0.128 };
    const SFX = [
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => [0.125 + i * 0.0625, "pop", 0.55, -0.6 + i * 0.16, 0.85 + i * 0.09]),
      [0.5, "land", 0.56, 0.45], [1.0, "whoosh", 1.07, 0.2], [1.5, "land", 0.48, 0.3], [1.6, "paper", 0.7, -0.2],
      [2.0, "plug", 1.08, 0.2], [2.25, "tube", 0.39, -0.3], [2.45, "whoosh", 0.62, 0.3], [2.75, "plug", 0.6, -0.2],
      [3.05, "pop", 0.6, 0.1, 1.0], [3.25, "pop", 0.6, -0.1, 1.2], [3.5, "type", 0.7], [3.72, "tbell", 0.25, 0.2], [3.75, "paper", 0.5, 0.3],
      ...[0, 1, 2, 3].map((i) => [4.0 + i * 0.25, "ding", 0.2, 0.25, 1 + i * 0.12]),
      [4.85, "whoosh", 0.71, 0, 0.9],
      [5.0, "paper", 0.6, 0.2], [5.125, "ding", 0.2, -0.2, 1.3],
      ...[0, 1, 2, 3, 4, 5].map((i) => [5.25 + i * 0.25, "paper", 0.6, i % 2 ? 0.35 : 0.15, 0.9 + (i % 3) * 0.08]),
      [6.75, "type", 0.6, -0.2], [7.0, "type", 0.6, -0.2], [7.2, "whoosh", 0.71, -0.3],
      [7.5, "zip", 0.48, -0.2], [7.75, "land", 0.4, -0.2],
      ...[0, 1, 2, 3].map((i) => [8.0 + i * 0.25, "glass", 0.63, -0.4 + i * 0.12, 1 + i * 0.1]),
      [9.0, "printer", 0.6, 0.2], [9.5, "stamp", 0.99, 0.1], [9.75, "keys", 0.95, -0.3], [10.25, "ding", 0.22, 0, 1.2],
      [10.5, "whoosh", 0.8, -0.3, 1.1], [10.65, "whoosh", 0.62, 0.2],
      [11.25, "valve", 0.38, -0.4], [11.75, "stamp", 0.99], [12.0, "type", 0.6, -0.1], [12.5, "stamp", 1.12],
      [12.75, "valve", 0.38, 0], [13.25, "ding", 0.22, 0.3], [13.44, "tube", 0.28, 0.1], [13.5, "valve", 0.38, 0.4], [13.75, "whoosh", 0.8, 0, 0.85],
      [14.0, "plug", 0.72, -0.1], [14.25, "plug", 0.72, 0.05, 1.1], [14.5, "plug", 0.84, 0.2, 0.9],
      [14.75, "paper", 0.5, 0.1], [15.25, "ding", 0.2, -0.1, 1.3], [15.5, "plug", 0.6, 0.2], [15.75, "pop", 0.6, 0.3, 1.3], [15.85, "whoosh", 0.71, 0],
      ...[16.125, 16.375, 16.625, 16.75, 16.875, 17.375, 17.5].map((o, i) => [o, "click", 0.87, -0.6 + i * 0.2, 0.9 + i * 0.05]),
      [16.75, "alarm", 0.25, 0.4],
      [18.5, "knock", 0.91, 0.4], [19.25, "whoosh", 0.8, 0.4, 1.1],
    ];
    return {
      harm: [
        "Dm9", "Bbmaj7", [["Gm9", 0], ["C69", 2]],
        "Dm9", "Fmaj7", [["Gm9", 0], ["C69", 2]],
        "Bbmaj7", "Gm9", [["C69", 0], ["A7sus4", 2]],
        "Dmadd9", "Bbmaj7s11",
        "Fmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]],
        "Dm9", "Bbmaj7", "Gm9", [["Bbmaj7", 0], ["A7sus4", 2]],
        "Dm9", [["Gm9", 0], ["C69", 2]],
        "Fmaj7", "Bbmaj7", "Gm9", [["Bbmaj7", 0], ["A7sus4", 2]],
      ],
      sections: [
        { from: 0, to: 0, id: "after-open", name: "硬切暗底：历史上的提交冒出小 Clawd，向导跳上 HEAD 说一句", energy: 0.3,
          hat: "........x...x...", hatKind: "flip", hatVol: 0.7, ghost: [2, 0.12, 0.3], pad: 0.85, lp: 1800, padVerb: 0.36 },
        { from: 1, to: 2, id: "after-board", name: "项目聊天：协调的 Claude 落到看板旁，lyjw 的一句话滑进来，插上 #308", energy: 0.45,
          kick: "X.......x.......", kickKind: "light", duck: 0.4, hat: "......x.......x.", hatKind: "flip", hatVol: 0.75,
          bass: "light", arp: { p: "sparse", lo: 69, inst: "bell2", v: 0.26 }, pad: 0.82, lp: 2100, padVerb: 0.34 },
        { from: 3, to: 5, id: "after-thread", name: "一件事一个线程：开分支，第一个提交，本地门禁一项一声叮", energy: 0.64,
          kick: "X...X...X...X...", kickKind: "light", duck: 0.45, hat: "..x...x...x...x.", hatKind: "type",
          bass: "offbeat", arp: { p: "332", lo: 69, inst: "pluck", v: 0.34 }, pad: 0.75, lp: 2600, padVerb: 0.3 },
        { from: 6, to: 8, id: "after-reviews", name: "开 PR：机器评审一张张滑进来，改了的叮，回理由的往下落", energy: 0.72,
          kick: "X.......X.x.....", duck: 0.5, snare: "....o.......o...", snareKind: "rim", hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "queue", lo: 62, inst: "pluckDark", v: 0.38 }, pad: 0.75, lp: 2600, padVerb: 0.3 },
        { from: 9, to: 10, id: "after-verify", name: "Haiku 拿着放大镜落下来，按提交跑四项检查", energy: 0.68,
          kick: "X...X...X...X...", kickKind: "light", duck: 0.45, hat: "o.x.o.x.o.x.o.x.", hatKind: "type", hatVol: 0.8,
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.32 }, pad: 0.75, lp: 2800, padVerb: 0.3 },
        { from: 11, to: 13, id: "after-receipt", name: "回执：盖上 unit-test-verified，敲 check 命令，exact 亮灯，Haiku 跳走", energy: 0.66,
          kick: "X.......X.......", kickKind: "light", duck: 0.45, hat: "..x...x...x...x.", hatKind: "type",
          clock: [null, "......xoxoxo...."], clockVol: 0.9,
          bass: "light", arp: { p: "sparse", lo: 69, inst: "bell", v: 0.28 }, pad: 0.8, lp: 2600, padVerb: 0.32 },
        { from: 14, to: 17, id: "after-gates", name: "三档闸门：判定员盖 FAIL、补提交、PASS；lyjw 点头，三道闸都开", energy: 0.78,
          kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud", hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "queue", lo: 69, inst: "bell", v: 0.24 }, pad: 0.72, lp: 3200, padVerb: 0.3 },
        { from: 18, to: 19, id: "after-merge", name: "合并：三条线依次落回 main，拇指琴唱主题；协作者一行亮起，首页提交卡上跳出 Clawd", energy: 0.86,
          kick: "X.......X.x.....", duck: 0.5, snare: ["....x.......x...", "....x.......x.ox"], snareKind: "thud",
          hat: "..x...x...x...x.", hatKind: "flip",
          bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.3 }, pad: 0.72, lp: 3400, padVerb: 0.3 },
        { from: 20, to: 21, id: "after-night", name: "夜班：游标走过时间轴，定时任务的 Clawd 一只只跳起来", energy: 0.5,
          kick: "X.......x.......", kickKind: "light", duck: 0.4, hat: "......x.......x.", hatKind: "flip", hatVol: 0.7,
          bass: "light", arp: { p: "sparse", lo: 69, inst: "kalimba", v: 0.5 }, pad: 0.85, lp: 2200, padVerb: 0.38 },
        { from: 22, to: 23, id: "after-end", name: "落回 main 线，举牌等 lyjw 验收，跳出画面；吸一口气，交给第 09 章的 boom", energy: 0.38,
          kick: "X...............", duck: 0.4, bass: "hold", pad: 0.9, lp: 2000, padVerb: 0.45 },
      ],
      melody: [
        ...phrase(18, THEME, "kalimba", 1, true),
        ...phrase(18, THEME.map(([b, d, n]) => [b, d, n.replace(/\d/, (o) => String(+o - 1))]), "pluck", 0.36),
        ...phrase(19, withNotes(["F5", "E5", "D5", "C5"]), "kalimba", 0.7),
      ],
      story: [
        { bar: 0, beat: 0, kind: "boom" },
        { bar: 23, beat: 3, kind: "swell" },
      ],
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => { const n = played(o); return { bar: Math.floor(n + 1e-9), beat: (n - Math.floor(n + 1e-9)) * 4, name, v, pan, rate, lead: (LEAD[name] || 0) / rate }; }),
    };
  },
});
