// 配乐 v2（样章）：108 BPM，4/4，正好 32 小节 = 第 02 章「门禁与分拣」16 小节 + 第 03 章「一间屋子的账房」16 小节。
// 一种风格：温暖的极简电子。侧链呼吸的 pad、FM 铃和拨弦、圆润的次低音、干净的鼓组、一点磁带饱和、
// 种子噪声现生成冲激响应的短混响。全部在浏览器里合成：没有采样文件、不联网，噪声一律来自种子 PRNG，同一份乐谱每次渲染逐位相同。
//
// 乐谱是数据：和弦表（HARM）+ 段落表（SECTIONS：鼓型、贝斯型、琶音型、混音参数）+ 旋律（MELODY）+ 剧情落点（STORY）。
// expand() 把它们展开成一张平铺的音符表 NOTES；同一张表既排进 OfflineAudioContext 出声，也导出 Score.events / Score.env
// 给画面用，所以声音和画面不可能对不上。
//
// 调性：D 多利亚 / D 小调（第 02 章用多利亚的 G6 和 C6/9，第 03 章换成小调的 B♭ 和 Gm9，更暗）。
// 信封主题（全片母题）：A4 D5 F5 E5——三步跳上去、再落一步回来；节奏是 3+3+2 个十六分，E5 落在第三拍、延长两拍。
(function () {
  "use strict";
  const BPM = 108, BEAT = 60 / BPM, BAR = BEAT * 4, BARS = 32;
  const DURATION = BARS * BAR, TAIL = 2, SAMPLE_RATE = 48000;
  // 母带：峰值拉到 -1 dBFS（这份配乐的峰值响度比约 13 dB，整体响度落在 -14 LUFS 左右）。
  // 想按响度走就把 TARGET_LUFS 设成数字（比如 -16），峰值会落在 -3 dBFS 上下，限幅器兜底
  const CEIL_DB = -1, TARGET_LUFS = null;
  const at = (bar, beat = 0) => bar * BAR + beat * BEAT;
  const TAU = Math.PI * 2;
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (s) => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0); };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // =====================================================================
  // 乐谱（数据）
  // =====================================================================

  // 和弦：pad 的排法（中音区、开放排列，第一个音是根音）；次低音取根音，折到 G1–F#2
  const CHORD = {
    Dm9: ["D3", "A3", "C4", "E4", "F4"],
    Dmadd9: ["D3", "A3", "E4", "F4"],
    G6: ["G3", "B3", "D4", "E4"], // 多利亚的 IV：B 还原
    Fmaj7: ["F3", "A3", "C4", "E4"],
    C69: ["C3", "G3", "D4", "E4", "A4"],
    Bbmaj7: ["Bb2", "F3", "A3", "D4"],
    Bbmaj7s11: ["Bb2", "F3", "A3", "D4", "E4"], // 利底亚的 #11，黑屋子里那点神秘
    Gm9: ["G2", "F3", "Bb3", "D4", "A4"],
    A7sus4: ["A2", "E3", "G3", "D4"],
    A7: ["A2", "E3", "G3", "C#4"],
    Em7b5: ["E3", "G3", "Bb3", "D4"],
  };
  const rootOf = (name) => { let m = 24 + (midi(CHORD[name][0]) % 12); while (m < 31) m += 12; return m; };

  // 每小节的和弦；数组表示小节内换和弦：[和弦, 起拍]
  const HARM = [
    // 02 门禁与分拣：i – IV – i – III – VII（多利亚），400 那一下借 ♭VI，最后落在属音上被吸进 03
    "Dm9", "G6", "Dm9", "Fmaj7", "C69", "Dm9", "Fmaj7", "C69",
    "Bbmaj7", "Dm9", "G6", "Bbmaj7", "C69", "Dm9", "Fmaj7", [["A7sus4", 0], ["A7", 2]],
    // 03 一间屋子的账房：i – ♭VI – iv – V，更暗；心跳段转一下 ii°7 – V，出屋时完整回到 i
    "Dmadd9", "Bbmaj7s11", "Dm9", "Bbmaj7", "Gm9", [["A7sus4", 0], ["A7", 2]], "Dm9", "Bbmaj7",
    "Gm9", "Dmadd9", "Bbmaj7s11", [["Em7b5", 0], ["A7", 2]], "Dm9", "Bbmaj7", [["Gm9", 0], ["A7sus4", 2]], "Dm9",
  ];
  function chordAt(bar, beat) {
    const h = HARM[clamp(bar, 0, BARS - 1)];
    if (typeof h === "string") return h;
    let c = h[0][0];
    for (const [n, b] of h) if (beat >= b - 1e-9) c = n;
    return c;
  }
  // 和弦段：pad 按段发声，末段一直响到第 32 小节结束（再在尾巴里放掉）
  const SEGMENTS = [];
  HARM.forEach((h, bar) => (typeof h === "string" ? [[h, 0]] : h).forEach(([chord, beat]) => SEGMENTS.push({ bar, beat, t: at(bar, beat), chord })));
  SEGMENTS.forEach((s, i) => (s.end = i + 1 < SEGMENTS.length ? SEGMENTS[i + 1].t : DURATION));

  // 鼓型：16 格一小节（一格一个十六分），X 重、x 中、o 轻、. 空；数组表示段落里逐小节轮换，null 表示这一小节不打
  const VEL = { X: 1, x: 0.75, o: 0.45 };
  // 贝斯型：[拍位, 时值(拍), 离根音的半音, 力度]
  const BASS = {
    light: [[0, 1.75, 0, 0.8], [2.5, 1.25, 0, 0.7]],
    groove: [[0, 1.25, 0, 1], [1.5, 0.5, 0, 0.7], [2.25, 0.5, 12, 0.55], [3, 0.75, 7, 0.8]],
    slam: [[2, 0.75, 0, 0.9], [3, 0.75, 7, 0.8]], // 400 大章：前两拍全场收住
    half: [[0, 2, 0, 0.9]], // 202 之后让出来给下坠
    offbeat: [[0.5, 0.4, 0, 0.95], [1.5, 0.4, 0, 0.8], [2.5, 0.4, 0, 0.95], [3.5, 0.4, 12, 0.6]], // 反拍贝斯，配每拍一下的底鼓
    reveal: [[0, 0.4, 0, 1], [0.5, 0.4, 0, 0.85], [1.5, 0.4, 0, 0.85], [2.5, 0.4, 0, 0.95], [3, 0.25, 12, 0.5], [3.5, 0.4, 7, 0.75]],
    end: [[0, 4, 0, 0.7]],
    // hold：每个和弦段一个长音（expand 里按和弦切）
  };
  // 琶音型：[拍位, 取和弦音的序号]；332 就是主题的 3+3+2 节奏
  const ARP = {
    sparse: [[0, 0], [1.5, 2], [2.5, 1]],
    332: [[0, 0], [0.75, 1], [1.5, 2], [2, 3], [2.75, 2], [3.5, 1]],
    queue: [[0, 0], [0.75, 2], [1.5, 1], [2.5, 3], [3.25, 2]],
  };

  // 段落：鼓型、贝斯、琶音、pad 电平与亮度、侧链深度、画面用的「能量」
  const SECTIONS = [
    // —— 02 门禁与分拣：纸面、公文。打字机当踩镲，印章当军鼓，气动管和指示灯是剧情音 ——
    { from: 0, to: 1, ch: 2, id: "gate-intro", name: "门前：pad 和零星的打字声，拨弦唱出信封主题", energy: 0.2,
      hat: ["..o...o...o...o.", "..o...o...o.oooo"], hatKind: "type", hatVol: 0.7, ghost: [1, 0.2, 0.16],
      pad: 0.9, lp: 2400, padVerb: 0.3 },
    { from: 2, to: 4, ch: 2, id: "gate-doors", name: "钥匙与门：轻底鼓进来", energy: 0.4,
      kick: "X.......x.......", kickKind: "light", duck: 0.4,
      hat: "o.x.o.x.o.x.o.x.", hatKind: "type", hatVol: 0.8,
      bass: "light", arp: { p: "sparse", lo: 69, inst: "pluck", v: 0.5 }, pad: 0.8, lp: 2600, padVerb: 0.28 },
    { from: 5, to: 7, ch: 2, id: "gate-checklist", name: "检查单：六声打勾，律动搭起来", energy: 0.6,
      kick: "X.......X.x.....", duck: 0.5, snare: "....x.......x...", snareKind: "thud",
      hat: "o.x.oox.o.x.oox.", hatKind: "type",
      bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.4 }, pad: 0.75, lp: 2800, padVerb: 0.25 },
    { from: 8, to: 8, ch: 2, id: "gate-400", name: "400 大章：全场一顿，第三拍再接上", energy: 0.55,
      kick: "........X.x.....", duck: 0.5, snare: "............x...", snareKind: "thud",
      hat: "........o.x.oox.", hatKind: "type", bass: "slam", pad: 0.75, lp: 2400, padVerb: 0.3 },
    { from: 9, to: 12, ch: 2, id: "gate-sorting", name: "分拣台：四根气动管，律动全开", energy: 0.85,
      kick: ["X.......X.x.....", "X.......X.x.....", "X.......X.x.....", "X.......X.x...x."], duck: 0.5,
      snare: ["....X.......X...", "....X.......X...", "....X.......X...", "....X.......X.ox"], snareKind: "thud",
      hat: "ooxoooxoooxoooxo", hatKind: "type",
      bass: "groove", arp: { p: "332", lo: 69, inst: "pluck", v: 0.55 }, pad: 0.7, lp: 3200, padVerb: 0.22 },
    { from: 13, to: 14, ch: 2, id: "gate-lamps", name: "三盏灯：鼓让开，灯音拼出主题", energy: 0.6,
      kick: "X.......X.......", duck: 0.4, snare: "............x...", snareKind: "thud",
      hat: "..x...x...x...x.", hatKind: "type", hatVol: 0.8, bass: "light", pad: 0.85, lp: 2800, padVerb: 0.3 },
    { from: 15, to: 15, ch: 2, id: "gate-202", name: "202 大章，然后被吸进实时那根管子", energy: 0.5,
      bass: "half", pad: 0.85, lp: 2600, padVerb: 0.35 },
    // —— 03 一间屋子的账房：暗、深、有点神秘但暖。十六分的钟摆就是那条队列 ——
    { from: 16, to: 17, ch: 3, id: "room-dark", name: "黑暗里飞向唯一的一间屋子：只有 pad、次低音和 FM 铃", energy: 0.25,
      ghost: [2, 0.15, 0.3], bass: "hold", pad: 1, lp: 800, padVerb: 0.45 },
    { from: 18, to: 21, ch: 3, id: "room-queue", name: "屋里只有一条队：每拍一个信封往前挪", energy: 0.6,
      kick: "X...X...X...X...", duck: 0.55, snare: [null, null, "....o.......o...", "....o.......o..."], snareKind: "rim",
      hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
      bass: "offbeat", bassVol: 1.25, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.5 }, pad: 0.75, lp: 1000, padVerb: 0.35 },
    { from: 22, to: 24, ch: 3, id: "room-slip", name: "递出清单：广播和 202 同时发生", energy: 0.7,
      kick: "X...X...X...X...", duck: 0.55, snare: "....x.......x...", snareKind: "rim",
      hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
      bass: "offbeat", bassVol: 1.25, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.55 }, pad: 0.75, lp: 1100, padVerb: 0.35 },
    { from: 25, to: 27, ch: 3, id: "room-heartbeat", name: "心跳信封：半速，底鼓变成扑通扑通，记一笔、谁也不惊动", energy: 0.35,
      kick: "X.o.....X.o.....", kickKind: "heart", duck: 0.4,
      hat: "..............o.", hatKind: "flip", clock: ["o.o.o.o.o.o.o.o.", "o.o.o.o.o.o.o.o.", "o.o.o.o.o.o.oooo"], clockVol: 0.7,
      bass: "hold", pad: 0.85, lp: 850, padVerb: 0.4 },
    { from: 28, to: 30, ch: 3, id: "room-reveal", name: "镜头退出屋子：律动全开，主题带和声完整唱一遍", energy: 1,
      kick: "X...X...X...X...", duck: 0.5, snare: ["....X.......X...", "....X.......X...", "....X.......X.oo"], snareKind: "thud",
      hat: "..x...x...x...x.", hatKind: "flip", clock: "xoooxoooxoooxooo",
      bass: "reveal", bassVol: 1.2, arp: { p: "queue", lo: 57, inst: "pluckDark", v: 0.35 }, pad: 0.8, lp: 2200, padVerb: 0.35 },
    { from: 31, to: 31, ch: 3, id: "room-end", name: "落在 Dm9 上，一直响进尾巴", energy: 0.6,
      kick: "X...............", duck: 0.5, bass: "end", pad: 1, lp: 1400, padVerb: 0.45 },
  ];
  const SEC_OF_BAR = [];
  SECTIONS.forEach((s) => { for (let b = s.from; b <= s.to; b++) SEC_OF_BAR[b] = s; });
  const sectionOf = (bar) => SEC_OF_BAR[clamp(bar, 0, BARS - 1)];

  // 信封主题：[拍位, 时值, 音]
  const THEME = [[0, 0.75, "A4"], [0.75, 0.75, "D5"], [1.5, 0.5, "F5"], [2, 2, "E5"]];
  const withNotes = (names) => THEME.map(([b, d], i) => [b, d, names[i]]);
  // 旋律条目：[小节, 拍位, 时值(拍), 音, 乐器, 力度, 是否主题]
  const phrase = (bar, notes, inst, v, theme = false) => notes.map(([b, d, n]) => [bar, b, d, n, inst, v, theme]);
  const MELODY = [
    ...phrase(0, THEME, "pluck", 1.3, true), // 0:0 拨弦唱主题，前奏只有 pad 垫着
    ...phrase(1, withNotes(["D5", "B4", "A4", "G4"]), "pluck", 0.55), // 同一节奏往下答一句（G6 上的 B 还原）
    ...phrase(16, THEME, "bell", 1.2, true), // 03 开场：FM 铃唱主题
    ...phrase(17, withNotes(["F5", "E5", "D5", "A4"]), "bell", 0.6), // 反着答：E5 在 B♭ 上是 #11
    // 心跳段：闷音拨弦偷偷走几步
    ...[[25, 0.5, "D4"], [25, 1.5, "F4"], [25, 2.75, "E4"], [25, 3.5, "C4"],
      [26, 0.5, "D4"], [26, 1.5, "F4"], [26, 2.75, "E4"], [26, 3.5, "A3"],
      [27, 1, "E4"], [27, 1.5, "G4"], [27, 2.5, "C#5"], [27, 3, "E5"], [27, 3.5, "G5"]].map(([bar, b, n]) => [bar, b, 0.25, n, "pluckMute", 0.5, false]),
    // 出屋：主题完整三句（原位、上三度模进、再上一句落到属音），铃唱旋律、第二支铃唱三度 / 六度和声、拨弦低八度跟着
    ...phrase(28, THEME, "bell", 1.15, true), ...phrase(28, withNotes(["F4", "A4", "D5", "C5"]), "bell2", 0.5), ...phrase(28, withNotes(["A3", "D4", "F4", "E4"]), "pluck", 0.4),
    ...phrase(29, withNotes(["C5", "F5", "A5", "G5"]), "bell", 1.1, true), ...phrase(29, withNotes(["A4", "D5", "F5", "D5"]), "bell2", 0.5), ...phrase(29, withNotes(["C4", "F4", "A4", "G4"]), "pluck", 0.4),
    ...phrase(30, withNotes(["D5", "G5", "Bb5", "A5"]), "bell", 1.1, true), ...phrase(30, withNotes(["Bb4", "D5", "G5", "E5"]), "bell2", 0.5), ...phrase(30, withNotes(["D4", "G4", "Bb4", "A4"]), "pluck", 0.4),
    // 31:0 终和弦：铃敲 D5 / A5 / E6，和 pad 的 Dm9 一起响进尾巴
    [31, 0, 4, "D5", "bell", 0.9, true], [31, 0, 4, "A5", "bell2", 0.55, false], [31, 0, 4, "E6", "bell2", 0.35, false],
  ];

  // 剧情落点：画面里每一个「此刻发生」的动作，拍位就是 brief 给的格子
  const STORY = [
    { bar: 2, beat: 0, kind: "key" }, // mac 那扇门开了
    { bar: 3, beat: 2, kind: "stamp", size: "mid" }, // 403：Emby 的钥匙开错了门
    { bar: 4, beat: 0, kind: "key" }, { bar: 4, beat: 0.5, kind: "key", v: 0.85 }, // Home Assistant 的钥匙连开两扇
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
    { bar: 15, beat: 2, kind: "whoosh", tube: "down" }, // 被吸进实时那根管子，落点在 16:0
    { bar: 16, beat: 0, kind: "accent", what: "arrive" }, // 落进黑暗：一声很低的「咚」
    { bar: 22, beat: 0, kind: "accent", what: "slip" }, // 窗口递出一张清单
    { bar: 22, beat: 2, kind: "accent", what: "broadcast" }, { bar: 22, beat: 2, kind: "stamp", size: "mid" }, // 广播和 202 并行：同一刻
    { bar: 27, beat: 0, kind: "accent", what: "flip" }, // 在线 / 离线翻转
    { bar: 27, beat: 3, kind: "swell" }, // 出屋前吸一口气（只是质感，不进事件表）
    { bar: 31, beat: 0, kind: "boom" }, // 终和弦底下垫一声低的
  ];
  const KEY_PRE = 0.06; // 钥匙：插进去的沙沙声在拍前，转动那一下「咔」落在拍上
  const WHOOSH_LEN = { tube: 0.95, fork: 1.25, down: 2 * BEAT };

  // =====================================================================
  // 展开：乐谱 → 平铺的音符表（出声和事件共用）
  // =====================================================================
  function steps(p, i) {
    const s = Array.isArray(p) ? p[i % p.length] : p, out = [];
    if (!s) return out;
    for (let k = 0; k < 16; k++) if (VEL[s[k]]) out.push([k / 4, VEL[s[k]], k]);
    return out;
  }
  // 和弦里落在 lo..lo+span 的音，由低到高
  function arpTones(chord, lo, span = 15) {
    const pcs = new Set(CHORD[chord].map((n) => midi(n) % 12)), out = [];
    for (let m = lo; m <= lo + span; m++) if (pcs.has(m % 12)) out.push(m);
    return out;
  }
  function expand() {
    const N = [], rnd = mulberry32(108);
    for (const s of SEGMENTS) { const sec = sectionOf(s.bar); N.push({ kind: "pad", t: s.t, end: s.end, chord: s.chord, level: sec.pad, lp: sec.lp, verb: sec.padVerb, last: s.end >= DURATION - 1e-9 }); }
    for (const sec of SECTIONS) for (let bar = sec.from; bar <= sec.to; bar++) {
      const i = bar - sec.from, ch = sec.ch;
      for (const [b, v] of steps(sec.kick, i)) {
        const type = sec.kickKind === "heart" ? (v === 1 ? "lub" : "dub") : sec.kickKind || "tight";
        N.push({ kind: "kick", t: at(bar, b), v: sec.kickKind === "heart" ? (v === 1 ? 1 : 0.65) : v, type, duck: sec.duck });
      }
      for (const [b, v] of steps(sec.snare, i)) N.push({ kind: "snare", t: at(bar, b), v, type: sec.snareKind, ch });
      for (const [b, v] of steps(sec.hat, i)) N.push({ kind: "hat", t: at(bar, b), v: v * (0.88 + 0.24 * rnd()), type: sec.hatKind, variant: Math.floor(rnd() * 4), vol: sec.hatVol ?? 1 });
      for (const [b, v, k] of steps(sec.clock, i)) N.push({ kind: "clock", t: at(bar, b), v, type: k % 2 ? "tock" : "tick", vol: sec.clockVol ?? 1 });
      if (sec.ghost) for (let b = 0; b < 4; b += sec.ghost[0]) N.push({ kind: "ghost", t: at(bar, b), depth: sec.ghost[1], tau: sec.ghost[2] });
      if (sec.bass) {
        const pat = sec.bass === "hold" ? SEGMENTS.filter((s) => s.bar === bar).map((s) => [s.beat, (s.end - s.t) / BEAT, 0, 0.6]) : BASS[sec.bass];
        for (const [b, len, iv, v] of pat) N.push({ kind: "bass", t: at(bar, b), dur: len * BEAT, m: rootOf(chordAt(bar, b)) + iv, v: v * (sec.bassVol ?? 1), att: sec.bass === "hold" ? 0.03 : 0.007, rel: sec.bass === "end" ? 1.6 : 0.05 });
      }
      if (sec.arp) for (const [b, idx] of ARP[sec.arp.p]) {
        const T = arpTones(chordAt(bar, b), sec.arp.lo);
        N.push({ kind: "mel", t: at(bar, b), dur: 0.5 * BEAT, m: T[idx % T.length], inst: sec.arp.inst, v: sec.arp.v * (0.9 + 0.2 * rnd()), pan: Math.round(b * 4) % 2 ? 0.3 : -0.3, arp: true });
      }
    }
    for (const [bar, b, d, n, inst, v, theme] of MELODY) N.push({ kind: "mel", t: at(bar, b), dur: d * BEAT, m: midi(n), inst, v, theme, bar });
    for (const s of STORY) N.push({ ...s, t: at(s.bar, s.beat) });
    return N.sort((a, b) => a.t - b.t);
  }
  const NOTES = expand();

  // =====================================================================
  // 事件表与包络（画面用；和出声用的是同一张 NOTES）
  // =====================================================================
  // 侧链：每个底鼓、每记印章把 pad / 贝斯压下去再放回来，前奏和黑屋子里没有鼓，就用看不见的「幽灵底鼓」让 pad 自己呼吸
  const DIPS = [];
  for (const n of NOTES) {
    if (n.kind === "kick") DIPS.push({ t: n.t, depth: n.duck * n.v, tau: n.type === "lub" ? 0.2 : 0.12 });
    else if (n.kind === "ghost") DIPS.push({ t: n.t, depth: n.depth, tau: n.tau });
    else if (n.kind === "stamp") DIPS.push({ t: n.t, depth: n.size === "big" ? 0.8 : 0.45, tau: n.size === "big" ? 0.35 : 0.2 });
    else if (n.kind === "boom" || (n.kind === "accent" && n.what === "arrive")) DIPS.push({ t: n.t, depth: 0.45, tau: 0.45 });
  }
  DIPS.sort((a, b) => a.t - b.t);
  const DIP_ATT = 0.008;
  function lastIdx(list, t, key = "t") { let lo = 0, hi = list.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][key] <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  // 1 = 全开，越小压得越深
  function duck(t) {
    let g = 1;
    for (let i = lastIdx(DIPS, t); i >= 0; i--) {
      const d = DIPS[i], x = t - d.t;
      if (x > 2) break;
      const s = x < DIP_ATT ? x / DIP_ATT : Math.exp(-(x - DIP_ATT) / d.tau);
      g *= 1 - d.depth * s;
    }
    return g;
  }
  const bassDuck = (t) => 1 - 0.65 * (1 - duck(t));

  const EVENT_KEYS = ["kick", "snare", "hat", "tick", "stamp", "whoosh", "lamp", "key", "bell", "accent", "clock"];
  const HITS = Object.fromEntries(EVENT_KEYS.map((k) => [k, []]));
  for (const n of NOTES) {
    const k = n.kind;
    if (k === "mel") { if (n.theme) HITS.bell.push({ t: n.t, v: n.v }); }
    else if (k === "stamp") HITS.stamp.push({ t: n.t, v: n.size === "big" ? 1 : 0.7 });
    else if (k === "lamp") HITS.lamp.push({ t: n.t, v: n.late ? 0.45 : 1 });
    else if (k === "accent") HITS.accent.push({ t: n.t, v: { arrive: 0.7, slip: 0.6, broadcast: 1, flip: 1 }[n.what] });
    else if (k === "whoosh") HITS.whoosh.push({ t: n.t, v: 1, type: typeof n.tube === "number" ? "tube" : n.tube });
    else if (HITS[k]) HITS[k].push({ t: n.t, v: clamp(n.v ?? 1, 0, 1) });
  }
  for (const k of EVENT_KEYS) {
    // 同一刻的重复（和声里同时落下的几个音）只留力度最大的那个
    const L = HITS[k].sort((a, b) => a.t - b.t), out = [];
    for (const h of L) { const p = out[out.length - 1]; if (p && Math.abs(p.t - h.t) < 1e-9) { if (h.v > p.v) out[out.length - 1] = h; } else out.push(h); }
    HITS[k] = out;
  }
  const events = Object.fromEntries(EVENT_KEYS.map((k) => [k, HITS[k].map((h) => h.t)]));

  // 各类打击的衰减时间常数（秒）
  const DECAY = { kick: 0.12, snare: 0.14, hat: 0.05, clock: 0.035, tick: 0.22, stamp: 0.3, lamp: 0.45, key: 0.12, bell: 0.6, accent: 0.5 };
  const PADS = NOTES.filter((n) => n.kind === "pad"), BASSES = NOTES.filter((n) => n.kind === "bass");
  const RISERS = NOTES.filter((n) => (n.kind === "whoosh" && n.tube === "down") || n.kind === "swell").map((n) => ({ t: n.t, len: n.kind === "swell" ? BEAT : WHOOSH_LEN.down }));
  function padLevel(t) {
    const i = lastIdx(PADS, t);
    if (i < 0) return 0;
    const p = PADS[i], x = t - p.t, a = Math.min(1, x / 0.28);
    // 和上一段交叉淡化；最后一段在尾巴里放掉
    const prev = i > 0 ? PADS[i - 1].level * Math.exp(-x / 0.11) : 0;
    const tail = t > DURATION ? Math.exp(-(t - DURATION) / 0.42) : 1;
    return clamp(Math.max(p.level * a, prev) * tail, 0, 1);
  }
  function env(name, t) {
    if (DECAY[name]) {
      const L = HITS[name], i = lastIdx(L, t);
      return i < 0 ? 0 : clamp(L[i].v * Math.exp(-(t - L[i].t) / DECAY[name]), 0, 1);
    }
    switch (name) {
      case "duck": return duck(t); // 侧链本身：1 全开，越小压得越深
      case "pad": return padLevel(t) * duck(t);
      case "bass": {
        const i = lastIdx(BASSES, t);
        if (i < 0) return 0;
        const b = BASSES[i], x = t - b.t, rel = b.rel / 3;
        const e = x < b.att ? x / b.att : x < b.dur ? 1 : Math.exp(-(x - b.dur) / rel);
        return clamp(b.v * e * bassDuck(t), 0, 1);
      }
      case "whoosh": {
        let m = 0;
        for (const w of HITS.whoosh) {
          const len = WHOOSH_LEN[w.type], x = t - w.t;
          if (x < 0 || x > len) continue;
          const e = w.type === "down" ? Math.pow(x / len, 2.2) : x < 0.07 ? x / 0.07 : Math.exp(-(x - 0.07) / (w.type === "fork" ? 0.4 : 0.26));
          m = Math.max(m, e);
        }
        return m;
      }
      case "riser": { for (const r of RISERS) if (t >= r.t && t < r.t + r.len) return (t - r.t) / r.len; return 0; }
      case "energy": {
        const bar = Math.floor(clamp(t, 0, DURATION - 1e-6) / BAR), s = sectionOf(bar), x = t - at(s.from);
        if (s.from > 0 && x < 0.4) { const p = sectionOf(s.from - 1).energy; return p + (s.energy - p) * (x / 0.4); }
        return t > DURATION ? s.energy * Math.exp(-(t - DURATION) / 0.6) : s.energy;
      }
      case "beat": { if (t < 0 || t >= DURATION) return 0; const x = (t / BEAT) % 1; return Math.exp(-(x * BEAT) / 0.15); }
      case "bar": { if (t < 0 || t >= DURATION) return 0; const x = (t / BAR) % 1; return Math.exp(-(x * BAR) / 0.4); }
    }
    return 0;
  }

  // =====================================================================
  // 音色：在 JS 里把每种打击、每个音高的波形算出来（按采样率缓存），再按乐谱摆放
  // =====================================================================
  const SAMPLE_BANKS = new Map();
  function samplesFor(sr) {
    if (SAMPLE_BANKS.has(sr)) return SAMPLE_BANKS.get(sr);
    const cache = new Map();
    const arr = (sec) => new Float32Array(Math.max(1, Math.round(sec * sr)));
    function norm(d, peak = 1) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; return d; }
    // 双二阶滤波（RBJ）：lp / hp / bp（带通峰值 0 dB）
    function biquad(d, type, f, q = 0.707) {
      const w = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      let b0, b1, b2;
      if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
      else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) { const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
      return d;
    }
    // 截止频率随时间走的带通（TPT 状态变量滤波器），做呼啸、下坠、纸滑过去的扫频
    function sweepBp(d, fOf, q) {
      const k = 1 / q; let s1 = 0, s2 = 0;
      for (let i = 0; i < d.length; i++) {
        const g = Math.tan(Math.PI * clamp(fOf(i / sr), 20, sr * 0.45) / sr), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const v3 = d[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        d[i] = v1 * k;
      }
      return norm(d);
    }
    // 种子白噪声，可选滤一道，按峰值归一：下面各层的系数就是各层的峰值
    function nz(n, seed, type, f, q) { const r = mulberry32(seed), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1; if (type) biquad(d, type, f, q); return norm(d); }
    // 一个衰减的正弦分音叠进 d（递推算正弦，快）
    function partial(d, f, amp, tau, ph) {
      if (f >= sr * 0.45) return;
      const w = TAU * f / sr, c2 = 2 * Math.cos(w), k = Math.exp(-1 / (tau * sr));
      let s1 = Math.sin(ph - w), s2 = Math.sin(ph - 2 * w), e = amp;
      for (let i = 0; i < d.length && e > 1e-5; i++) { const s = c2 * s1 - s2; s2 = s1; s1 = s; d[i] += s * e; e *= k; }
    }
    // 起音一点点斜坡、结尾 4 ms 淡出、峰值归一
    function finish(d, att = 0.0005) {
      const a = Math.max(1, Math.round(att * sr)), f = Math.min(d.length, Math.round(0.004 * sr));
      for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
      for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - i / f;
      return norm(d);
    }
    const get = (key, fn) => {
      if (!cache.has(key)) { const d = fn(), b = new AudioBuffer({ length: d.length, sampleRate: sr, numberOfChannels: 1 }); b.copyToChannel(d, 0); cache.set(key, b); }
      return cache.get(key);
    };

    // 底鼓：正弦扫频 + 一点点击声，轻微饱和；lub / dub 是心跳，boom 是落地和终和弦下面那一声
    const KICK = {
      tight: { f0: 160, f1: 47, pt: 0.03, dec: 0.23, att: 0.0008, click: 0.35, len: 0.55 },
      light: { f0: 140, f1: 50, pt: 0.028, dec: 0.15, att: 0.001, click: 0.2, len: 0.4 },
      lub: { f0: 100, f1: 44, pt: 0.05, dec: 0.2, att: 0.004, click: 0, len: 0.55 },
      dub: { f0: 118, f1: 50, pt: 0.04, dec: 0.13, att: 0.003, click: 0, len: 0.4 },
      boom: { f0: 78, f1: 37, pt: 0.16, dec: 0.85, att: 0.006, click: 0, len: 2.8 },
    };
    const kick = (kind) => get("k:" + kind, () => {
      const c = KICK[kind], d = arr(c.len), cl = nz(d.length, 11, "hp", 2500);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += TAU * (c.f1 + (c.f0 - c.f1) * Math.exp(-t / c.pt)) / sr;
        const a = Math.exp(-t / c.dec) * Math.min(1, t / c.att);
        d[i] = Math.tanh(1.5 * Math.sin(ph) * a) / Math.tanh(1.5) + c.click * cl[i] * Math.exp(-t / 0.0025);
      }
      return finish(d, 0.0002);
    });
    // 军鼓。thud：橡皮章那种闷拍 + 纸面一拍；rim：账房里的轻拍，木头边加一点掌声尾巴
    const snare = (kind) => get("sn:" + kind, () => {
      const d = arr(0.35), n = d.length;
      if (kind === "thud") {
        const a = nz(n, 21, "bp", 2100, 0.8), b = nz(n, 22, "bp", 480, 2), c = nz(n, 23, "hp", 4500);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          ph += TAU * (150 + 70 * Math.exp(-t / 0.018)) / sr;
          d[i] = 0.7 * Math.sin(ph) * Math.exp(-t / 0.045) + 0.75 * a[i] * Math.exp(-t / 0.032) + 0.45 * b[i] * Math.exp(-t / 0.05) + 0.4 * c[i] * Math.exp(-t / 0.004);
        }
      } else {
        const a = nz(n, 24, "bp", 2600, 1), b = nz(n, 25, "bp", 1100, 0.7);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          d[i] = 0.5 * Math.sin(TAU * 340 * t) * Math.exp(-t / 0.022) + 0.3 * Math.sin(TAU * 525 * t) * Math.exp(-t / 0.016) + 0.6 * a[i] * Math.exp(-t / 0.028) + 0.35 * b[i] * Math.exp(-t / 0.07);
        }
      }
      return finish(d, 0.0003);
    });
    // 打字机：字锤敲纸的「嗒」+ 纸面一点沙沙的余韵 + 字杆的金属余音 + 机身一点「咚」；四个变体轮着用
    const type = (v) => get("ty:" + v, () => {
      const d = arr(0.09), n = d.length, a = nz(n, 31 + v, "bp", 3300 + 350 * v, 1.4), air = nz(n, 35 + v, "hp", 6500);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.9 * a[i] * Math.exp(-t / 0.0045) + 0.22 * air[i] * Math.exp(-t / 0.018) + 0.3 * Math.sin(TAU * (2750 + 170 * v) * t) * Math.exp(-t / 0.011)
          + 0.16 * Math.sin(TAU * (4400 + 90 * v) * t) * Math.exp(-t / 0.007) + 0.35 * Math.sin(TAU * 160 * t) * Math.exp(-t / 0.012);
      }
      return finish(d, 0.0002);
    });
    // 翻账页：几下很快的纸面抖动 + 一口气
    const flip = (v) => get("fl:" + v, () => {
      const d = arr(0.16), n = d.length, a = nz(n, 41 + v, "bp", 1700 + 250 * v, 0.6);
      const bursts = [[0, 1], [0.016 + 0.002 * v, 0.7], [0.031, 0.5], [0.047, 0.3]];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.15));
        for (const [tb, ab] of bursts) if (t >= tb) e += ab * Math.exp(-(t - tb) / 0.007);
        d[i] = a[i] * e;
      }
      biquad(d, "lp", 5000);
      return finish(d, 0.001);
    });
    // 钟摆：tick 高、tock 低，木头味
    const clock = (kind) => get("cl:" + kind, () => {
      const f = kind === "tick" ? 3100 : 2300, d = arr(0.05), n = d.length, a = nz(n, 51, "hp", 3000);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.6 * Math.sin(TAU * f * t) * Math.exp(-t / 0.005) + 0.4 * Math.sin(TAU * 0.37 * f * t) * Math.exp(-t / 0.009) + 0.4 * a[i] * Math.exp(-t / 0.0015);
      }
      return finish(d, 0.0002);
    });
    // 印章：低频闷响 + 木头一磕 + 纸面一拍 + 印泥的细碎声；big 再加桌上小东西跟着一震
    const stamp = (size) => get("st:" + size, () => {
      const big = size === "big", d = arr(big ? 1.1 : 0.7), n = d.length, r = mulberry32(big ? 61 : 62);
      const slap = nz(n, 63, "bp", 1300, 0.9), crk = nz(n, 64, "hp", 5000), rat = nz(n, 65, "bp", 3200, 1.5);
      const f0 = big ? 105 : 115, f1 = big ? 36 : 44, pt = big ? 0.07 : 0.05, dec = big ? 0.3 : 0.14;
      const rattle = big ? [0, 1, 2, 3, 4].map(() => 0.05 + r() * 0.2) : [];
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / pt)) / sr;
        let y = Math.sin(ph) * Math.exp(-t / dec)
          + 0.35 * (Math.sin(TAU * (big ? 185 : 230) * t) + 0.6 * Math.sin(TAU * (big ? 300 : 370) * t)) * Math.exp(-t / (big ? 0.05 : 0.035))
          + 0.8 * slap[i] * Math.exp(-t / (big ? 0.08 : 0.05))
          + (t > 0.012 ? 0.3 * crk[i] * Math.exp(-(t - 0.012) / 0.012) : 0);
        for (const tb of rattle) if (t >= tb) y += 0.16 * rat[i] * Math.exp(-(t - tb) / 0.012);
        d[i] = Math.tanh(1.3 * y);
      }
      return finish(d, 0.0005);
    });
    // 检查单打勾：打字机的「嗒」+ 行末小铃「叮」，带音高
    const ding = (m) => get("dg:" + m, () => {
      const f = hz(m), d = arr(1.1), n = d.length, a = nz(n, 71, "bp", 3400, 1.4);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = 0.55 * a[i] * Math.exp(-t / 0.0045) + 0.25 * Math.sin(TAU * 160 * t) * Math.exp(-t / 0.012)
          + 0.7 * (Math.sin(TAU * f * t) * Math.exp(-t / 0.45) + 0.22 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.22)
            + 0.1 * Math.sin(TAU * 3.01 * f * t) * Math.exp(-t / 0.1) + 0.04 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t / 0.05));
      }
      return finish(d, 0.0003);
    });
    // 钥匙：插进去（拍前 KEY_PRE 秒）→ 转动「咔」（正落在拍上）→ 锁舌缩回的一声闷响
    const key = () => get("key", () => {
      const P = KEY_PRE, d = arr(0.45), n = d.length;
      const a = nz(n, 81, "bp", 5200, 2), b = nz(n, 82, "hp", 3000), c = nz(n, 83, "bp", 900, 1), e = nz(n, 84, "bp", 4200, 2);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let y = 0.4 * a[i] * Math.exp(-t / 0.012);
        if (t >= 0.028) y += 0.25 * e[i] * Math.exp(-(t - 0.028) / 0.006);
        if (t >= P) { const u = t - P; y += 0.5 * (Math.sin(TAU * 1900 * u) + 0.7 * Math.sin(TAU * 3100 * u)) * Math.exp(-u / 0.007) + 0.6 * b[i] * Math.exp(-u / 0.0025); }
        if (t >= P + 0.085) { const u = t - P - 0.085; y += 0.55 * Math.sin(TAU * 210 * u) * Math.exp(-u / 0.03) + 0.3 * c[i] * Math.exp(-u / 0.02); }
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 指示灯：玻璃味的 FM「叮」；late（D1 那盏）更软、更远
    const lamp = (m, late) => get("lp:" + m + ":" + (late ? 1 : 0), () => {
      const f = hz(m), d = arr(1.8), n = d.length, a = nz(n, 91, "hp", 6000);
      const I0 = late ? 1.1 : 2.4, dec = late ? 0.7 : 0.5;
      for (let i = 0; i < n; i++) {
        const t = i / sr, I = I0 * Math.exp(-t / 0.018) + 0.3;
        d[i] = Math.sin(TAU * f * t + I * Math.sin(TAU * 3.99 * f * t)) * Math.exp(-t / dec) + 0.15 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.15)
          + (late ? 0 : 0.2 * a[i] * Math.exp(-t / 0.001));
      }
      if (late) biquad(d, "lp", 3500);
      return finish(d, 0.0005);
    });
    // 拨弦：拨弦位置决定泛音分布，高次泛音衰减得更快；再叠一层微微走调的做合唱。dark 更闷，mute 是闷音短拨
    const PLUCK = {
      pluck: { pos: 0.18, t0: 0.55, ex: 1.3, fmax: 11000, len: 1.6, nz: 0.22, nf: 3000 },
      pluckDark: { pos: 0.24, t0: 0.6, ex: 1.8, fmax: 5000, len: 1.6, nz: 0.1, nf: 1600 },
      pluckMute: { pos: 0.2, t0: 0.14, ex: 1.6, fmax: 6000, len: 0.6, nz: 0.18, nf: 2200 },
    };
    const pluck = (m, kind) => get("pl:" + kind + ":" + m, () => {
      const c = PLUCK[kind], f0 = hz(m), d = arr(c.len), n = d.length, r = mulberry32(m * 17 + 5);
      const tt = c.t0 * Math.pow(262 / f0, 0.3);
      for (let k = 1; k * f0 < c.fmax; k++) {
        const amp = (Math.abs(Math.sin(k * Math.PI * c.pos)) + 0.04) / Math.pow(k, c.ex), tau = tt / (1 + 0.5 * (k - 1));
        partial(d, f0 * k, amp, tau, r() * TAU);
        partial(d, f0 * k * 1.0035, amp * 0.3, tau, r() * TAU);
      }
      const a = nz(n, 101 + m, "bp", c.nf, 0.8), pn = Math.round(0.006 * sr);
      for (let i = 0; i < pn; i++) d[i] += c.nz * a[i] * (1 - i / pn);
      return finish(d, 0.0008);
    });
    // FM 铃：1:1 的电钢琴身体（调制深度随时间收）+ 1:3.5 的金属「叮」+ 一点走调的高八度闪光；warm 是第 03 章那支
    function bellArr(m, tone) {
      const f = hz(m), len = clamp(2.4 * Math.pow(523 / f, 0.4), 1.2, 4), d = arr(len), n = d.length;
      const warm = tone === "warm", I1 = warm ? 0.9 : 1.5, tine = warm ? 0.22 : 0.38, tb = len / 4.5;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = TAU * f * t;
        d[i] = Math.sin(w + (I1 * Math.exp(-t / 0.35) + 0.12) * Math.sin(w)) * Math.exp(-t / tb)
          + tine * Math.sin(w + 1.8 * Math.exp(-t / 0.05) * Math.sin(3.5 * w)) * Math.exp(-t / 0.35)
          + 0.05 * Math.sin(2.005 * w) * Math.exp(-t / (tb * 0.6));
      }
      return finish(d, 0.0015);
    }
    const bell = (m, tone) => get("bl:" + tone + ":" + m, () => bellArr(m, tone));
    // 气动管：阀门「噗」一下，气流带通从高往低扫（渐远），末尾胶囊到站的一声轻磕
    function tubeArr({ fc, L, dec, popF, popA, thunk, seed }) {
      const d = arr(L), n = d.length, air = sweepBp(nz(n, seed), (t) => fc * (0.5 + 1.1 * Math.exp(-t / 0.3)), 1.3), pop = nz(n, seed + 4, "bp", 700, 1);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (popF + 110 * Math.exp(-t / 0.02)) / sr;
        const e = t < 0.07 ? t / 0.07 : Math.exp(-(t - 0.07) / dec);
        let y = air[i] * e + popA * Math.sin(ph) * Math.exp(-t / 0.035) + 0.35 * pop[i] * Math.exp(-t / 0.01);
        if (t >= thunk) { const u = t - thunk; y += 0.22 * Math.sin(TAU * 140 * u) * Math.exp(-u / 0.03); }
        d[i] = y;
      }
      return finish(d, 0.001);
    }
    const TUBE_F = [2300, 1700, 1250, 2900];
    const whoosh = (k) => get("wh:" + k, () => tubeArr({ fc: TUBE_F[k], L: WHOOSH_LEN.tube, dec: 0.26, popF: 80, popA: 0.45, thunk: 0.72, seed: 111 + k }));
    // 分叉：更重、更长，两路各走一边
    const fork = (j) => get("fk:" + j, () => tubeArr({ fc: j ? 1500 : 950, L: WHOOSH_LEN.fork, dec: 0.4, popF: 60, popA: 0.7, thunk: 1.0, seed: 131 + j }));
    // 下坠：两拍里越吸越响，带通从 5.2 kHz 扫到 220 Hz，底下一条往下滑的正弦，正好收在 16:0
    const down = () => get("down", () => {
      const L = WHOOSH_LEN.down, d = arr(L + 0.01), n = d.length, air = sweepBp(nz(n, 121), (t) => 5200 * Math.pow(220 / 5200, Math.min(1, t / L)), 1.6);
      let ph = 0, ph2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, x = Math.min(1, t / L);
        ph += TAU * 880 * Math.pow(1 / 8, x) / sr;
        ph2 += TAU * 55 / sr;
        let y = air[i] * Math.pow(x, 2.2) + 0.3 * Math.sin(ph) * Math.pow(x, 1.5) + 0.35 * Math.sin(ph2) * Math.pow(x, 3);
        if (t > L - 0.012) y *= Math.max(0, (L - t) / 0.012);
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 出屋前吸一口气：一拍长，带通往上扫
    const swell = () => get("swell", () => {
      const L = BEAT, d = arr(L), n = d.length, air = sweepBp(nz(n, 141), (t) => 500 * Math.pow(8, Math.min(1, t / L)), 1.2);
      for (let i = 0; i < n; i++) { const t = i / sr, x = t / L; d[i] = air[i] * x * x * (t > L - 0.01 ? (L - t) / 0.01 : 1); }
      return finish(d, 0.001);
    });
    // 递出清单：纸在台面上滑过去（摩擦声慢慢起伏），最后轻轻一磕
    const slip = () => get("slip", () => {
      const d = arr(0.5), n = d.length, a = sweepBp(nz(n, 151), (t) => 1100 + 1300 * Math.min(1, t / 0.32), 0.9), tap = nz(n, 152, "bp", 1500, 1);
      const r = mulberry32(153), fl = new Float32Array(n);
      let s = 0;
      for (let i = 0; i < n; i++) { s += 0.004 * ((r() * 2 - 1) - s); fl[i] = s; }
      norm(fl);
      for (let i = 0; i < n; i++) {
        const t = i / sr, e = t < 0.03 ? t / 0.03 : t < 0.26 ? 1 : Math.max(0, 1 - (t - 0.26) / 0.06);
        let y = a[i] * e * (0.75 + 0.25 * fl[i]);
        if (t >= 0.33) { const u = t - 0.33; y += 0.6 * tap[i] * Math.exp(-u / 0.01) + 0.3 * Math.sin(TAU * 300 * u) * Math.exp(-u / 0.02); }
        d[i] = y;
      }
      return finish(d, 0.001);
    });
    // 广播：主题四个音一起敲响的铃，随后电台那种一抖一抖的颤音和一缕往上飘的口哨噪声
    const broadcast = () => get("bc", () => {
      const L = 2.2, d = arr(L), n = d.length;
      for (const [nm, g] of [["A5", 1], ["D6", 0.8], ["F6", 0.7], ["E6", 0.6]]) { const b = bellArr(midi(nm), "bright"); for (let i = 0; i < n && i < b.length; i++) d[i] += g * b[i]; }
      const w = sweepBp(nz(n, 161), (t) => 1800 * Math.pow(3, Math.min(1, t / 1.2)), 7);
      for (let i = 0; i < n; i++) {
        const t = i / sr, trem = 0.7 + 0.3 * Math.cos(TAU * 6.5 * t), depth = Math.min(1, t / 0.3);
        const sw = t < 0.3 ? t / 0.3 : Math.exp(-(t - 0.3) / 0.6);
        d[i] = d[i] * (1 - 0.25 * depth * (1 - trem)) + 0.35 * w[i] * sw * trem;
      }
      return finish(d, 0.0015);
    });
    // 在线 / 离线翻转：一记亮的——两支高铃 + 一声脆的点击 + 往上一挑
    const flipHit = () => get("fh", () => {
      const L = 1.4, d = arr(L), n = d.length, a = nz(n, 171, "hp", 6000);
      for (const [nm, g] of [["G6", 1], ["D7", 0.7]]) { const b = bellArr(midi(nm), "bright"); for (let i = 0; i < n && i < b.length; i++) d[i] += g * b[i]; }
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += TAU * (1200 + 1400 * Math.min(1, t / 0.04)) / sr;
        d[i] += 0.5 * a[i] * Math.exp(-t / 0.0015) + 0.25 * Math.sin(ph) * Math.exp(-t / 0.03);
      }
      return finish(d, 0.0003);
    });

    const bank = { kick, snare, type, flip, clock, stamp, ding, key, lamp, pluck, bell, whoosh, fork, down, swell, slip, broadcast, flipHit };
    SAMPLE_BANKS.set(sr, bank);
    return bank;
  }

  // 混响的冲激响应：种子噪声 × 指数衰减，两个声道各用一段（去相关），尾巴越往后越暗，开头撒几个早期反射
  function impulse(ctx, sec, seed) {
    const sr = ctx.sampleRate, n = Math.floor(sec * sr), pre = Math.floor(0.011 * sr), b = ctx.createBuffer(2, n + pre, sr);
    for (let c = 0; c < 2; c++) {
      const r = mulberry32(seed + c * 7), d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = 0.85 - 0.7 * Math.min(1, t / sec);
        lp += k * ((r() * 2 - 1) - lp);
        d[pre + i] = lp * Math.exp(-t / (sec / 6.9));
      }
      for (let j = 0; j < 7; j++) d[pre + Math.floor((0.004 + r() * 0.04) * sr)] += (r() * 2 - 1) * 0.6;
    }
    return b;
  }
  // 磁带：in → ÷H → tanh 曲线 → ×H，等效 out = S·tanh(in/S)，|in| 到 H 之前都不会硬削
  function tapeCurve(S, H) {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = ((i / (n - 1)) * 2 - 1) * H; c[i] = (S * Math.tanh(x / S)) / H; }
    return c;
  }

  // =====================================================================
  // 排程：NOTES → OfflineAudioContext
  // =====================================================================
  const CAT = { pad: "pad", bass: "bass", kick: "drums", snare: "drums", hat: "drums", clock: "drums", mel: "mel" }; // 其余剧情音都算 fx
  function schedule(ctx, opts) {
    const END = DURATION + TAIL, S = samplesFor(ctx.sampleRate);
    const solo = opts.solo ? new Set([].concat(opts.solo)) : null;
    const on = (n) => !solo || solo.has(CAT[n.kind] || "fx");
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // —— 母线：各组 → mix → 下坠扫频 → post → 磁带 → 高通 / 低通 → 输出（-1 dBFS 峰值归一和限幅在渲染完之后用 JS 做）。
    // 不用 DynamicsCompressor：它的起控 / 释放是按阈值切换的分支，末位浮点的差别会被放大，两次渲染对不齐 ——
    const mix = gain(), sweep = filt("lowpass", 20000, 0.9), post = gain(0.4); // post 的 0.4 是进磁带前的电平
    sweep.frequency.setValueAtTime(20000, 0);
    sweep.frequency.setValueAtTime(20000, at(15, 2));
    sweep.frequency.exponentialRampToValueAtTime(380, at(16));
    sweep.frequency.exponentialRampToValueAtTime(20000, at(16, 1));
    mix.connect(sweep); sweep.connect(post);
    if (opts.stage === "pre") post.connect(ctx.destination); // 调试：看进磁带之前的电平
    else {
      const H = 2, tin = gain(1 / H), tape = ctx.createWaveShaper(), tout = gain(H), hp = filt("highpass", 28), lp = filt("lowpass", 15500, 0.5);
      tape.curve = tapeCurve(0.9, H); tape.oversample = "4x";
      post.connect(tin); tin.connect(tape); tape.connect(tout); tout.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
    }
    const bus = { drums: gain(), fx: gain(), mel: gain(), fxPost: gain(), melPost: gain() };
    for (const k of ["drums", "fx", "mel"]) bus[k].connect(mix);
    bus.fxPost.connect(post); bus.melPost.connect(post); // 不过下坠扫频的：下坠本身、16:0 的落地和铃
    // 侧链：用和 env('duck') 同一个函数算出来的曲线直接画在 pad / 贝斯的母线增益上
    const RATE = 1000, cn = Math.ceil(END * RATE) + 1, cPad = new Float32Array(cn), cBass = new Float32Array(cn);
    for (let i = 0; i < cn; i++) { const t = i / RATE; cPad[i] = duck(t); cBass[i] = bassDuck(t); }
    bus.pad = gain(); bus.pad.gain.setValueCurveAtTime(cPad, 0, (cn - 1) / RATE); bus.pad.connect(mix);
    bus.bass = gain(); bus.bass.gain.setValueCurveAtTime(cBass, 0, (cn - 1) / RATE); bus.bass.connect(mix);

    // 混响（短，种子噪声生成）和附点八分的乒乓延迟，回到 mix（所以下坠时也一起被吸走）
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 1.7, 2026);
    const verbRet = gain(0.5); verb.connect(verbRet); verbRet.connect(mix);
    const dIn = gain(), dL = ctx.createDelay(2), dR = ctx.createDelay(2), dFb = gain(0.36), dHp = filt("highpass", 280), dLp = filt("lowpass", 2600), merge = ctx.createChannelMerger(2), dRet = gain(0.3);
    dL.delayTime.value = dR.delayTime.value = BEAT * 0.75;
    dIn.connect(dHp); dHp.connect(dLp); dLp.connect(dL); dL.connect(dR); dR.connect(dFb); dFb.connect(dHp);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(dRet); dRet.connect(mix);
    const send = (node, to, amt) => { if (amt > 0) { const s = gain(amt); node.connect(s); s.connect(to); } };

    // 放一个采样：pre 秒的前置段排在拍前（钥匙插进去那一下），事件时间仍是拍点
    function play(buf, t, { g = 1, pan = 0, panTo = null, panDur = 0.5, to = bus.fx, verbAmt = 0, delayAmt = 0, pre = 0 } = {}) {
      const t0 = Math.max(0, t - pre), src = ctx.createBufferSource(), a = gain(g), p = ctx.createStereoPanner();
      src.buffer = buf;
      p.pan.setValueAtTime(clamp(pan, -1, 1), t0);
      if (panTo != null) p.pan.linearRampToValueAtTime(clamp(panTo, -1, 1), t + panDur);
      src.connect(a); a.connect(p); p.connect(to);
      send(p, verb, verbAmt); send(p, dIn, delayAmt);
      src.start(t0);
    }
    // pad：每个和弦音两支锯齿（±7 音分，左右分开），低通随段落；和弦之间交叉淡化，终和弦在尾巴里放掉
    function pad(n) {
      const names = CHORD[n.chord], lvl = 0.11 * n.level * Math.sqrt(4 / names.length), att = 0.28, rel = n.last ? 1.7 : 0.45;
      for (const name of names) for (const [det, pan] of [[-7, -0.5], [7, 0.5]]) {
        const o = ctx.createOscillator(), f = filt("lowpass", n.lp, 0.3), a = gain(0), p = ctx.createStereoPanner();
        o.type = "sawtooth"; o.frequency.value = hz(midi(name)); o.detune.value = det;
        f.frequency.setValueAtTime(n.lp * 0.55, n.t); f.frequency.linearRampToValueAtTime(n.lp, n.t + 0.8);
        a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(lvl, n.t + att);
        a.gain.setValueAtTime(lvl, n.end); a.gain.setTargetAtTime(0, n.end, rel / 4);
        p.pan.value = pan;
        o.connect(f); f.connect(a); a.connect(p); p.connect(bus.pad); send(p, verb, n.verb);
        o.start(n.t); o.stop(n.end + rel * 1.6);
      }
    }
    // 次低音：正弦 + 一点二次谐波（小喇叭也听得见），起音从高 35 音分落下来，圆一点
    function bass(n) {
      const f = hz(n.m), vol = 0.36 * n.v, end = n.t + n.dur, a = gain(0), h = gain(0.2);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      o.frequency.value = f; o2.frequency.value = 2 * f;
      for (const x of [o, o2]) { x.detune.setValueAtTime(35, n.t); x.detune.setTargetAtTime(0, n.t, 0.012); }
      a.gain.setValueAtTime(0, n.t); a.gain.linearRampToValueAtTime(vol, n.t + n.att);
      a.gain.setValueAtTime(vol, end); a.gain.setTargetAtTime(0, end, n.rel / 3);
      o.connect(a); o2.connect(h); h.connect(a); a.connect(bus.bass);
      for (const x of [o, o2]) { x.start(n.t); x.stop(end + n.rel * 3 + 0.02); }
    }
    const KICK_G = { tight: 0.9, light: 0.65, lub: 0.85, dub: 0.85, boom: 0.6 };
    const LAMP_PAN = [-0.4, 0, 0.4];
    const TUBE_PAN = [-0.7, -0.25, 0.25, 0.7];

    for (const n of NOTES) {
      if (!on(n)) continue;
      const t = n.t;
      switch (n.kind) {
        case "pad": pad(n); break;
        case "bass": bass(n); break;
        case "kick": play(S.kick(n.type), t, { g: KICK_G[n.type] * n.v, to: bus.drums }); break;
        case "snare": play(S.snare(n.type), t, { g: (n.type === "thud" ? 0.34 : 0.3) * n.v, pan: 0.05, to: bus.drums, verbAmt: n.ch === 3 ? 0.22 : 0.12 }); break;
        case "hat":
          if (n.type === "type") play(S.type(n.variant), t, { g: 0.26 * n.v * n.vol, pan: 0.12 + 0.08 * n.variant, to: bus.drums, verbAmt: 0.05 });
          else play(S.flip(n.variant % 3), t, { g: 0.24 * n.v * n.vol, pan: -0.25, to: bus.drums, verbAmt: 0.15 });
          break;
        case "clock": play(S.clock(n.type), t, { g: 0.11 * n.v * n.vol, pan: n.type === "tick" ? 0.35 : -0.35, to: bus.drums, verbAmt: 0.08 }); break;
        case "mel": {
          const ch3 = t >= at(16) - 1e-9, to = t >= at(16) - 1e-9 && t < at(17) - 1e-9 ? bus.melPost : bus.mel;
          if (n.inst === "bell" || n.inst === "bell2")
            play(S.bell(n.m, ch3 ? "warm" : "bright"), t, { g: 0.36 * n.v, pan: n.inst === "bell" ? 0.1 : -0.25, to, verbAmt: 0.4, delayAmt: n.inst === "bell" ? 0.26 : 0.15 });
          else
            play(S.pluck(n.m, n.inst), t, { g: (n.theme ? 0.34 : 0.3) * n.v, pan: n.pan ?? (n.inst === "pluck" && ch3 ? 0.25 : 0), to, verbAmt: n.inst === "pluck" ? 0.22 : 0.28, delayAmt: n.theme ? 0.32 : n.inst === "pluckMute" ? 0.3 : 0.18 });
          break;
        }
        case "key": play(S.key(), t, { g: 0.85 * (n.v ?? 1), pan: t > at(4) ? 0.3 : -0.2, verbAmt: 0.15, pre: KEY_PRE }); break;
        case "stamp": play(S.stamp(n.size), t, { g: n.size === "big" ? 1.35 : 0.72, verbAmt: n.size === "big" ? 0.3 : 0.2 }); break;
        case "tick": play(S.ding(n.m), t, { g: 0.62, pan: -0.35 + 0.14 * n.i, verbAmt: 0.2, delayAmt: 0.12 }); break;
        case "lamp": play(S.lamp(n.m, n.late), t, { g: n.late ? 0.17 : 0.65, pan: n.late ? 0.55 : LAMP_PAN[n.i], verbAmt: n.late ? 0.6 : 0.35, delayAmt: 0.2 }); break;
        case "whoosh":
          if (n.tube === "fork") { play(S.fork(0), t, { g: 0.6, panTo: -0.8, panDur: 0.6, verbAmt: 0.25 }); play(S.fork(1), t, { g: 0.6, panTo: 0.8, panDur: 0.6, verbAmt: 0.25 }); }
          else if (n.tube === "down") play(S.down(), t, { g: 0.7, to: bus.fxPost, verbAmt: 0.2 });
          else play(S.whoosh(n.tube), t, { g: 0.75, panTo: TUBE_PAN[n.tube], panDur: 0.6, verbAmt: 0.25 });
          break;
        case "accent":
          if (n.what === "arrive") play(S.kick("boom"), t, { g: 0.45, to: bus.fxPost });
          else if (n.what === "slip") play(S.slip(), t, { g: 0.7, pan: 0.2, verbAmt: 0.15 });
          else if (n.what === "broadcast") play(S.broadcast(), t, { g: 0.36, verbAmt: 0.45, delayAmt: 0.3 });
          else if (n.what === "flip") play(S.flipHit(), t, { g: 0.8, verbAmt: 0.4, delayAmt: 0.25 });
          break;
        case "swell": play(S.swell(), t, { g: 0.2, verbAmt: 0.3 }); break;
        case "boom": play(S.kick("boom"), t, { g: 0.45 }); break;
      }
    }
  }

  // =====================================================================
  // 母带：渲染完在 JS 里做——峰值归一到 -1 dBFS（或按 BS.1770 响度拉到目标 + 前视限幅），尾巴淡出
  // =====================================================================
  // K 计权：高架（+4 dB @ 1.68 kHz）+ RLB 高通（38 Hz），系数按采样率现算
  function kWeighted(x, sr) {
    let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196, a0 = 1 + K / Q + K * K;
    const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const s1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
    const s2 = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    const y = Float64Array.from(x);
    for (const [b0, b1, b2, a1, a2] of [s1, s2]) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
    }
    return y;
  }
  // 整体响度（LUFS）：400 ms 块、75% 重叠，-70 绝对门限 + -10 LU 相对门限
  function loudness(L, R, sr) {
    const a = kWeighted(L, sr), b = kWeighted(R, sr), n = a.length, cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + a[i] * a[i] + b[i] * b[i];
    const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), z = [];
    for (let s = 0; s + blk <= n; s += hop) z.push((cum[s + blk] - cum[s]) / blk);
    const lk = (v) => -0.691 + 10 * Math.log10(Math.max(v, 1e-12)), mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const g1 = z.filter((v) => lk(v) > -70);
    if (!g1.length) return -70;
    const rel = lk(mean(g1)) - 10, g2 = g1.filter((v) => lk(v) > rel);
    return lk(mean(g2));
  }
  // 前视限幅：先求每个样本「不过线需要的增益」，取前视窗口里的最小值，再用同长度滑动平均抹成斜坡（保证峰值处不超），释放 80 ms
  function limit(L, R, sr, g, ceil) {
    const n = L.length, la = Math.round(0.005 * sr), rel = 1 - Math.exp(-1 / (0.08 * sr));
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g; need[i] = p > ceil ? ceil / p : 1; }
    const val = (k) => (k < n ? need[k] : 1), q = new Int32Array(n + la), mn = new Float32Array(n);
    let h = 0, tl = 0;
    for (let j = 0; j < n + la; j++) {
      const v = val(j);
      while (tl > h && val(q[tl - 1]) >= v) tl--;
      q[tl++] = j;
      while (q[h] < j - la) h++;
      if (j >= la) mn[j - la] = val(q[h]); // mn[i] = need 在 [i, i+la] 里的最小值
    }
    const oL = new Float32Array(n), oR = new Float32Array(n);
    // mn 在 [i-la, i] 上的平均（开头之前按 1 补）：每个 k 的窗口 [k, k+la] 都盖住 i，所以平均值 ≤ need[i]，峰值处一定不过线
    let sum = la + 1, gOut = 1;
    for (let i = 0; i < n; i++) {
      sum += mn[i] - (i > la ? mn[i - la - 1] : 1);
      const s = sum / (la + 1);
      gOut = s < gOut ? s : gOut + (s - gOut) * rel;
      const k = g * gOut;
      oL[i] = clamp(L[i] * k, -ceil, ceil); oR[i] = clamp(R[i] * k, -ceil, ceil);
    }
    return [oL, oR];
  }
  function master(buf) {
    const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(1), ceil = Math.pow(10, CEIL_DB / 20);
    let out;
    if (TARGET_LUFS == null) {
      // 峰值归一到 -1 dBFS；限幅器此时不动作，只是保险
      let pk = 0;
      for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      out = limit(L, R, sr, pk > 0 ? ceil / pk : 1, ceil);
    } else {
      // 按响度：两遍，第一遍按原始响度定增益；限幅会吃掉一点响度，第二遍按限幅后的实测补回
      let g = Math.pow(10, (TARGET_LUFS - loudness(L, R, sr)) / 20);
      out = limit(L, R, sr, g, ceil);
      g *= Math.pow(10, (TARGET_LUFS - loudness(out[0], out[1], sr)) / 20);
      out = limit(L, R, sr, g, ceil);
    }
    const f = Math.round(0.25 * sr);
    for (const d of out) for (let i = 0; i < f; i++) d[d.length - f + i] *= 1 - (i + 1) / f;
    buf.copyToChannel(out[0], 0); buf.copyToChannel(out[1], 1);
    return buf;
  }

  // 渲染整段混音（含尾巴）。opts.sampleRate；调试用：opts.solo = ["pad"|"bass"|"drums"|"mel"|"fx"] 只出这几组，
  // opts.raw 跳过母带处理，opts.stage = "pre" 在磁带之前取出来
  async function render(opts = {}) {
    const sr = opts.sampleRate || SAMPLE_RATE;
    const ctx = new OfflineAudioContext(2, Math.ceil((DURATION + TAIL) * sr), sr);
    schedule(ctx, opts);
    const buf = await ctx.startRendering();
    return opts.raw || opts.solo || opts.stage ? buf : master(buf);
  }

  window.Score = {
    BPM, BAR, BEAT, bars: BARS, duration: DURATION, tail: TAIL, sampleRate: SAMPLE_RATE,
    render, events, env, at,
    // 以下是额外提供的乐谱信息，画面可以不用
    sections: SECTIONS.map((s) => ({ id: s.id, name: s.name, chapter: s.ch, from: s.from, to: s.to, t0: at(s.from), t1: at(s.to + 1), energy: s.energy })),
    chords: SEGMENTS.map((s) => ({ t: s.t, end: s.end, name: s.chord })),
    theme: THEME.map(([beat, dur, note]) => ({ beat, dur, note })),
    loudness,
  };
})();
