(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch01",
  score: ({ THEME, phrase, midi }) => {
    // 时刻（小节）与 ch01.js 的 AT、STOP 是同一张表：甩镜头、换歌、信封入槽、Jev 判定、哈希进 R2、iPhone 唤醒、
    // 家里两把钥匙、东京三只容器、三处用量合并、钟楼一拍一分钟、两次看到新歌、结尾 Clawd 骑火花出画。
    // lo-fi hip hop：后半拍推迟 SW 拍的松摇摆，底鼓、边击、沙沙的踩镲；Rhodes 电钢铺和弦，暖的合成器贝斯，
    // 每小节一段唱片底噪，偶尔一串风铃；信封主题由柔的三角波主奏在第 3 小节换歌时唱一次。pad 只垫薄薄一层。
    const N_BARS = 29;
    const harm = [
      "Dmadd9", "Bbmaj7", "Gm9", "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]], "Dm9",
      "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]], "Dm9", "Fmaj7", "C69", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]],
      "Dm9", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]], "Dm9", "Bbmaj7", "Gm9", "C69", "Fmaj7",
      "Dm9", "Bbmaj7", "Gm9", [["Bbmaj7", 0], ["C69", 2]], "A7sus4",
    ];
    const segsOf = (bar) => (typeof harm[bar] === "string" ? [[harm[bar], 0, 4]] : harm[bar].map(([c, b], i, a) => [c, b, (a[i + 1] ? a[i + 1][1] : 4) - b]));
    const chordAt = (bar, beat) => segsOf(bar).reduce((c, [n, b]) => (beat >= b - 1e-9 ? n : c), segsOf(bar)[0][0]);
    const name = (m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][m % 12] + (Math.floor(m / 12) - 1);
    const R = (n) => { let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
    const SW = 0.08;
    const sw = (b) => { const f = Math.round(b * 4) % 4; return b + (f === 2 ? SW : f % 2 ? SW / 2 : 0); };
    const melody = [], story = [];

    // 鼓：16 格字符串（写法同 score.js），边击比拍子晚一点，每一下再抖几毫秒
    const VEL = { X: 1, x: 0.72, o: 0.42 };
    const hit = (bar, beat, what, v = 1, extra = {}) => story.push({ bar, beat, kind: "lofi", what, v, ...extra });
    const GROOVE = {
      A: { kick: "X......x..x.....", stick: "....X.......X...", hat: "x.o.x.o.x.o.x.o." },
      A2: { kick: "X......x..x...o.", stick: "....X.......X..o", hat: "x.o.x.oox.o.x.o." },
      F: { kick: "X......x..x.....", stick: "....X.......X.oo", hat: "x.o.x.o.x.o.x...", open: "..............x." },
      T: { kick: "X......x..x.....", stick: "....X.......X...", hat: "x.o.x...x.o.x...", open: "......x.......x." },
      B: { kick: "X.........x.....", stick: "........X.......", hat: "x...x...x...x..." },
      B2: { kick: "X.........x...o.", stick: "........X......o", hat: "x...x.o.x...x.o." },
    };
    function drums(bar, g) {
      for (const what of ["kick", "stick", "hat", "open"]) {
        const pat = g[what] || "";
        for (let k = 0; k < pat.length; k++) {
          const v = VEL[pat[k]], seed = bar * 64 + k * 4 + what.length;
          if (!v) continue;
          hit(bar, k ? sw(k / 4) + (what === "stick" ? 0.015 : 0) + (R(seed) - 0.5) * 0.02 : 0, what, v * (0.9 + 0.2 * R(seed + 7)));
        }
      }
    }
    // 21–23 小节（钟楼的任务表盘）不走 lo-fi 鼓和贝斯，换成 field-dial 段的轻底鼓、每拍滴答、反拍贝斯和 queue 琶音
    const DRUMS = ["", "B", "A", "A", "F", "A", "", "A", "A2", "A", "F", "A", "A2", "A", "A2", "F", "T", "T", "F", "T", "A2", "", "", "", "B", "B2", "A", "F", ""];
    DRUMS.forEach((g, bar) => g && drums(bar, GROOVE[g]));
    drums(0, { kick: "X...............", open: "X...............", hat: "....o...o...o.o." });
    drums(6, { kick: "X.......X.x.....", stick: "........X...X...", hat: "..........o.x.o." });
    drums(28, { kick: "X..............." });
    // Jev 在判断：十六分的钟摆从 5:3.5 走到 6:2 判定之前
    for (let k = 0; k < 10; k++) story.push({ bar: k < 2 ? 5 : 6, beat: k < 2 ? 3.5 + k * 0.25 : (k - 2) * 0.25, kind: "clock", type: k % 2 ? "tock" : "tick", v: 0.55 + 0.03 * k, vol: 1.1 });
    for (let bar = 0; bar < harm.length; bar++) hit(bar, 0, "crackle", 1, { i: bar % 4 });
    [[0, 1.5, 0], [13, 0, 1], [21, 0.5, 2]].forEach(([bar, beat, i]) => hit(bar, beat, "chime", 1, { i }));

    // 电钢：四音的无根音排法，按就近换排法；自下而上每个音晚 ROLL 拍，像手指慢慢压下去
    const VOX = {
      Dmadd9: [["F3", "A3", "D4", "E4"], ["A3", "D4", "E4", "F4"]],
      Dm9: [["F3", "A3", "C4", "E4"], ["C4", "E4", "F4", "A4"]],
      Bbmaj7: [["F3", "A3", "C4", "D4"], ["A3", "C4", "D4", "F4"]],
      Gm9: [["F3", "A3", "Bb3", "D4"], ["Bb3", "D4", "F4", "A4"]],
      A7sus4: [["G3", "A3", "D4", "E4"], ["D4", "E4", "G4", "A4"]],
      A7: [["G3", "C#4", "E4", "A4"], ["C#4", "E4", "G4", "A4"]],
      Fmaj7: [["E3", "A3", "C4", "G4"], ["A3", "C4", "E4", "G4"]],
      C69: [["E3", "A3", "D4", "G4"], ["A3", "D4", "E4", "G4"]],
    };
    let last = VOX.Dmadd9[0].map(midi);
    const voicing = (c) => {
      let best = null, cost = Infinity;
      for (const v of VOX[c]) { const m = v.map(midi), d = m.reduce((s, x, i) => s + Math.abs(x - last[i]), 0); if (d < cost) { cost = d; best = m; } }
      return (last = best);
    };
    const ROLL = 0.025;
    const rhodes = (bar, beat, dur, v) => voicing(chordAt(bar, beat)).forEach((m, i) =>
      melody.push([bar, beat + i * ROLL, dur - i * ROLL, name(m), "lofiRhodes", v * (0.92 + 0.12 * R(bar * 40 + i + Math.round(beat * 8))), false]));
    const COMP = {
      a: [[0, 2.3], [sw(2.5), 1.3]],
      b: [[0, 1.6], [sw(1.75), 0.55], [sw(2.5), 1.35]],
      c: [[0, 3.6]],
      d: [[0, 2.2], [sw(3.5), 0.45]],
      s: [[0, 1.8], [2, 1.8]],
      e: [[0, 3.4]],
    };
    const RH = ["c", "a", "b", "c", "a", "b", "s", "a", "b", "d", "s", "a", "b", "a", "d", "s", "b", "a", "s", "a", "b", "c", "c", "c", "c", "c", "b", "s", "e"];
    const RHV = (bar) => (bar === 3 ? 0.55 : bar >= 21 && bar <= 23 ? 0.45 : bar >= 24 && bar <= 25 ? 0.62 : 0.75);
    RH.forEach((p, bar) => COMP[p].forEach(([beat, dur], i) => rhodes(bar, beat, dur, RHV(bar) * (bar === 19 && i === 0 ? 1.2 : i ? 0.85 : 1))));

    // 贝斯：根音落在底鼓上，偶尔带五度、八度
    const ROOT = { Dmadd9: 38, Dm9: 38, Bbmaj7: 34, Gm9: 31, A7sus4: 33, A7: 33, Fmaj7: 41, C69: 36 };
    const BPAT = {
      A: [[0, 1.4, 0, 1], [sw(1.75), 0.4, 0, 0.55], [sw(2.5), 1.2, 0, 0.85]],
      B: [[0, 2.7, 0, 1], [3, 0.8, 7, 0.7]],
      D: [[0, 1.4, 0, 1], [sw(1.75), 0.35, 12, 0.5], [sw(2.5), 0.9, 0, 0.8], [sw(3.5), 0.4, 7, 0.6]],
      H: [[0, 3.5, 0, 0.95]],
      s: [[0, 1.2, 0, 1], [sw(1.5), 0.4, 0, 0.6], [2, 1.2, 0, 0.95], [sw(3.5), 0.4, 0, 0.6]],
    };
    const BP = ["H", "A", "A", "B", "A", "D", "s", "A", "A", "D", "s", "A", "D", "A", "A", "s", "D", "A", "s", "D", "A", "", "", "", "B", "B", "A", "s", "H"];
    BP.forEach((p, bar) => p && BPAT[p].forEach(([beat, dur, iv, v]) => melody.push([bar, beat, dur, name(ROOT[chordAt(bar, beat)] + iv), "lofiBass", v, false])));

    melody.push(...phrase(3, THEME, "lofiLead", 1, true));
    const lead = (v, list) => list.forEach(([bar, beat, dur, n]) => melody.push([bar, beat, dur, n, "lofiLead", v, false]));
    lead(0.5, [[13, sw(1.5), 0.45, "G5"], [13, 2, 0.45, "A5"], [13, sw(2.5), 1.3, "E5"]]);
    lead(0.6, [[19, sw(1.5), 0.45, "A5"], [19, 2, 0.45, "C6"], [19, sw(2.5), 1.2, "A5"], [19, sw(3.5), 0.45, "G5"], [20, 0, 1.4, "F5"], [20, sw(1.75), 0.45, "D5"], [20, sw(2.5), 1.1, "E5"]]);
    lead(0.55, [[26, sw(2.5), 0.45, "D5"], [26, 3, 0.45, "F5"], [26, sw(3.5), 1.6, "A5"], [27, sw(1.5), 0.45, "G5"], [27, 2, 1.6, "E5"]]);
    // iPhone 三行、东京三只容器一个个亮：电钢高音区单音
    [[11, 1, "A5"], [11, 2, "C6"], [11, 3, "E6"], [16, 0, "D6"], [16, 1, "F6"], [16, 2, "A6"]].forEach(([bar, beat, n]) => melody.push([bar, beat, 0.9, n, "lofiRhodes", 1.4, false]));

    const ev = (o, kind, extra = {}) => { const bar = Math.floor(o + 1e-9); story.push({ bar, beat: (o - bar) * 4, kind, ...extra }); };
    // 甩镜头：起甩那一刻起一口风，按画面滑动的方向扫过去（镜头往右，画面往左滑）
    [[2.2, -1], [4.95, 1], [7.7, 1], [10.45, 1], [12.95, -1], [15.45, 1], [17.95, -1], [20.7, -0.4], [23.7, -1], [27.7, 0.2]]
      .forEach(([o, d]) => ev(o, "whoosh", { tube: "whip", v: 0.55, pan: 0.45 * d, panTo: -0.45 * d }));
    ev(3.5, "lamp", { m: midi("A5"), i: 1, late: true });
    ev(4.575, "lamp", { m: midi("D6"), i: 2, late: true });
    ev(6.5, "lamp", { m: midi("A5"), i: 0 });
    ev(7.0, "tick", { m: midi("E6"), i: 3 });
    ev(11.0, "tick", { m: midi("A5"), i: 0 });
    ev(13.85, "key", { pan: -0.2 });
    ev(14.65, "key", { v: 0.85, pan: 0.25 });
    [["A5", 18.5], ["D6", 18.625], ["E6", 18.75]].forEach(([n, o], i) => ev(o, "tick", { m: midi(n), i }));
    ev(18.75, "swell");
    ev(19.0, "lamp", { m: midi("D6"), i: 1 });
    ev(24.25, "accent", { what: "slip" });
    ev(25.5, "accent", { what: "slip" });
    ev(25.75, "tick", { m: midi("D6"), i: 1 });
    ev(26.0, "lamp", { m: midi("A5"), i: 0 });
    ev(26.5, "accent", { what: "flip" });
    ev(28.0, "lamp", { m: midi("D6"), i: 1 });
    ev(28.08, "hop", { m: midi("A5"), v: 0.7, pan: 0.15 });
    ev(28.25, "whoosh", { tube: 3 });
    ev(28.66, "hop", { m: midi("E6"), pan: 0.1 });
    ev(28.75, "swell");
    // 最后 0.25 小节往右甩进第 02 章（ch01.js#WHIP）：一口风的中点落在剪切点上，画面往左滑
    ev(N_BARS - 0.62 / ((60 / 108) * 4) / 2, "whoosh", { tube: "whip", v: 1, pan: 0.45, panTo: -0.45 });

    const SFX = [
      [3.0, "pop", 0.35, 0], [3.12, "paper", 0.3, -0.1, 1.15], [3.55, "paper", 0.5, 0.2], [4.0, "land", 0.35, 0.2],
      [5.3, "pop", 0.3, -0.2], [5.62, "click", 0.35, -0.1], [5.69, "click", 0.3, 0.1, 1.1], [6.75, "pop", 0.45, -0.3], [6.875, "click", 0.5, 0, 0.9],
      [8.05, "pop", 0.3, -0.2], [8.3, "zip", 0.3, 0], [8.5, "paper", 0.4, 0.1, 1.1], [8.75, "knock", 0.35, 0.1],
      [9.05, "paper", 0.35, -0.2, 0.95], [9.6, "knock", 0.3, 0.1], [9.75, "paper", 0.45, 0.3],
      [12.25, "paper", 0.45, 0.3], [14.0, "pop", 0.3, 0.2],
    ];
    const sec = (from, to, id, name, energy, o = {}) => ({ from, to, id, name, energy, pad: 0.35, lp: 1400, padVerb: 0.32, ...o });
    return {
      harm,
      sections: [
        sec(0, 1, "field-title", "晒图上的笔记本上色、拉出到转台上的小岛：0:0 底鼓、开镲、贝斯、电钢一起落，接住第 00 章的上行琶音，唱片底噪起，0:1.5 一串风铃；第 1 小节半速律动", 0.3, { pad: 0.45, lp: 1300, padVerb: 0.4 }),
        sec(2, 4, "field-mac", "Mac：律动进来；3:0 换歌，三角波主奏唱信封主题；信封滑进停靠位，空信封呼吸一次", 0.5),
        sec(5, 7, "field-jev", "窗口标题：5:3.5 起十六分的钟摆（Jev 在判断），6:2 判定那一下边击和灯；放行、锁定，7:0 问 lyjw 一声叮", 0.55),
        sec(8, 10, "field-r2", "图片按内容哈希进 R2：抽屉开合两次，海报先传、再报在看什么", 0.6),
        sec(11, 12, "field-iphone", "iPhone：11:0 HealthKit 唤醒一声，三行出来时电钢高音一行一个，信封寄出", 0.6),
        sec(13, 15, "field-home", "家里：屋顶掀开时一串风铃，HomePod 放出三个音；两把钥匙各落进各的槽", 0.65),
        sec(16, 17, "field-tokyo", "东京一台主机：三只容器一拍亮一只，电钢高音跟着；开镲进来", 0.75),
        sec(18, 20, "field-usage", "编码用量：三处原始数各一声，18:3 吸气、19:0 合并落灯；主奏接一句", 0.75),
        sec(21, 23, "field-dial", "钟楼的任务表盘：一拍一分钟，钟摆每拍一响、到期的指针跟着弹；轻底鼓、反拍贝斯、queue 琶音，电钢只铺长和弦；21:0.5 风铃（风向标）", 0.55,
          { kick: "X.......X.......", kickKind: "light", duck: 0.45, clock: "X...x...x...x...", clockVol: 1.3,
            bass: "offbeat", bassVol: 1.1, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.36 }, pad: 0.4, lp: 2000 }),
        sec(24, 27, "field-inferred", "没人上报的播放：钟摆接着每拍一响到 25:3；24:1、25:2 新歌排到最前（纸滑），25:3 减去前一首，26:0 两格求交，26:2 翻出 Likely Playing", 0.55,
          { clock: ["X...x...x...x...", "X...x...x...x...", null, null], clockVol: 1.3 }),
        sec(28, 28, "field-launch", "甩回停靠点：28:0 灯亮，Clawd 落下（28:0.32）、28:2.64 跳上火花骑出画面，28:3 起镜头往右甩、一口风跨过剪切点；停在 A7sus4，交给第 02 章 0:0 的 D 小调", 0.35, { pad: 0.5, lp: 1500, padVerb: 0.45 }),
      ],
      melody,
      story,
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
