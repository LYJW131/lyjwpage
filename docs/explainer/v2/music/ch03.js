(window.SCORE_PARTS = window.SCORE_PARTS || []).push({
  id: "ch03",
  // 第 0 小节绕开母线扫频（上一章结尾把低通关到 380 Hz、0:1 才打开）：旋律靠 postBars，剧情音各自标 post
  postBars: [0, 1],
  chords: {
    toonDm6: ["D3", "A3", "B3", "F4"], toonBb7: ["Bb2", "Ab3", "D4", "F4"], toonGm6: ["G2", "D3", "E3", "Bb3"],
    toonE7: ["E2", "D3", "G#3", "B3"], toonD7: ["D3", "C4", "F#4", "A4"], toonEdim7: ["E3", "G3", "Bb3", "C#4"],
  },
  score: ({ THEME, phrase, midi }) => {
    // 时刻（小节）与 ch03.js 的 AT 是同一张表：落账、效果单、服务铃、盖章、拉闸、广播、电话、三个库升起、号外。
    const AT = {
      irisOut: 1.75, irisIn: 2.0,
      hop: 8.0, hero: 8.5, slip: 9.0, fly: 10.5, landed: 10.75, mean: 11.0, outside: 12.0,
      ding: 12.0, stamp: 12.25, ok202: 13.35, switch1: 12.75, rings1: 13.0, agents: 13.5,
      hb: 15.5, empty: 16.0, toss: 16.75, clawd: 16.3, pres: 18.5, slip2: 18.75, fly2: 19.05, wake: 19.25,
      switch2: 19.5, rings2: 19.6, phone: 19.75, hang: 20.75,
      lagUp: 21.5, d1Up: 22.0, credUp: 22.5, foot: 23.25, spin: 24.25, bam: 25.0, dive: 25.6, end: 25.97,
    };
    const COMMITS = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5];
    const Dm = "toonDm6", Bb = "toonBb7", Gm = "toonGm6", E7 = "toonE7", D7 = "toonD7", Ed = "toonEdim7", A7 = "A7";
    const harm = [
      Dm, [[Bb, 0], [A7, 2]], Dm, [[Bb, 0], [A7, 2]], Dm, Gm, Dm, [[Bb, 0], [A7, 2]],
      Dm, Gm, [[E7, 0], [A7, 2]], [[Ed, 0], [A7, 2]], D7, Gm, [[E7, 0], [A7, 2]],
      Dm, [[Gm, 0], [A7, 3]], Dm, [[Bb, 0], [A7, 2]], Dm, [[E7, 0], [A7, 2]],
      Dm, Gm, [[Bb, 0], [A7, 2]], Dm, [[Bb, 0], [A7, 2]],
    ];
    // 每个和弦：大号的根音与五音、班卓扫的四个音、钢琴反拍的和弦
    const V = {
      [Dm]: { tuba: ["D2", "A2"], banjo: ["D4", "F4", "A4", "B4"], piano: ["F4", "A4", "B4", "D5"] },
      [Bb]: { tuba: ["Bb1", "F2"], banjo: ["D4", "F4", "Ab4", "Bb4"], piano: ["F4", "Ab4", "Bb4", "D5"] },
      [Gm]: { tuba: ["G2", "D2"], banjo: ["D4", "E4", "G4", "Bb4"], piano: ["E4", "G4", "Bb4", "D5"] },
      [A7]: { tuba: ["A2", "E2"], banjo: ["C#4", "E4", "G4", "A4"], piano: ["E4", "G4", "A4", "C#5"] },
      [E7]: { tuba: ["E2", "B1"], banjo: ["D4", "E4", "G#4", "B4"], piano: ["D4", "G#4", "B4", "E5"] },
      [D7]: { tuba: ["D2", "A2"], banjo: ["D4", "F#4", "A4", "C5"], piano: ["F#4", "A4", "C5", "D5"] },
      [Ed]: { tuba: ["E2", "Bb1"], banjo: ["C#4", "E4", "G4", "Bb4"], piano: ["E4", "G4", "Bb4", "C#5"] },
    };
    const chordAt = (bar, beat) => { const h = harm[bar]; if (typeof h === "string") return h; let c = h[0][0]; for (const [n, b] of h) if (beat >= b) c = n; return c; };
    const at = (o) => { const bar = Math.floor(o + 1e-9); return [bar, Math.round((o - bar) * 4 * 1000) / 1000]; };
    const mel = [], story = [];
    const N = (bar, beat, dur, n, inst, v, theme = false) => mel.push([bar, beat, dur, n, inst, v, theme]);
    const T = (bar, beat, what, o = {}) => story.push({ bar, beat, kind: "toon", what, ...o });
    const line = (bar, inst, v, notes) => notes.forEach(([b, d, n]) => N(bar, b, d, n, inst, v));
    const whistle = (bar, beat, from, to, len, v) => T(bar, beat, "whistle", { from: midi(from), to: midi(to), len, v });
    // 两拍子：大号落 1、3 拍（换和弦那拍落新根音，否则 3 拍落五音），班卓四拍都扫、2、4 拍重，钢琴只在 2、4 拍补和弦；
    // 大鼓 1、3 拍，back 是 2、4 拍的小鼓或捂镲。from / to 截一段拍子，v 整体乘。
    function band(bar, o = {}) {
      const v = o.v ?? 1;
      for (let b = o.from ?? 0; b < (o.to ?? 4); b++) {
        const name = chordAt(bar, b), c = V[name], turn = b > 0 && name !== chordAt(bar, b - 1);
        if (o.tuba !== false && (b % 2 === 0 || turn)) N(bar, b, 0.85, c.tuba[b === 0 || turn ? 0 : 1], "toonTuba", v * (b ? 0.85 : 1));
        if (o.banjo !== false) c.banjo.forEach((n, i) => N(bar, b + i * 0.025, 0.3, n, "toonBanjo", v * (b % 2 ? 1 : 0.7) * (1 - i * 0.08)));
        if (o.piano !== false && b % 2) c.piano.forEach((n) => N(bar, b, 0.45, n, "toonPiano", v * 0.55));
        if (o.kick !== false && b % 2 === 0) T(bar, b, "kick", { v: v * (b ? 0.8 : 1) });
        if (o.back && b % 2) T(bar, b, o.back, { v: v * (o.backV ?? 1) });
      }
    }
    function hitAll(bar, b, name, v = 1, ti = 0) {
      const c = V[name];
      N(bar, b, 0.6, c.tuba[ti], "toonTuba", v);
      c.banjo.forEach((n, i) => N(bar, b + i * 0.02, 0.35, n, "toonBanjo", v * (1 - i * 0.08)));
      c.piano.forEach((n) => N(bar, b, 0.6, n, "toonPiano", v * 0.6));
      T(bar, b, "kick", { v }); T(bar, b, "choke", { v });
    }

    // 0–1 片头字卡：灯先亮（钢琴高音一下），乐队从第 3 拍轻轻进来，单簧管一串上行接住片名；灯眨眼一声铃，光圈收拢时滑哨往下滑
    line(0, "toonPiano", 0.4, [[0, 1.5, "D6"], [0.02, 1.5, "A5"], [0.04, 1.5, "F5"]]);
    band(0, { from: 2, v: 0.7, kick: false });
    T(0, 2, "kick", { v: 0.6, post: true });
    line(0, "toonClar", 0.55, [[3, 0.25, "A3"], [3.25, 0.25, "D4"], [3.5, 0.25, "F4"], [3.75, 0.25, "A4"]]);
    band(1, { to: 3, v: 0.75 });
    line(1, "toonClar", 0.7, [[0, 2, "D5"], [2, 0.9, "C#5"]]);
    whistle(1, 3, "A5", "D5", 1, 0.9);

    // 2–4 账房：两拍子起步，弱音小号叫一声，单簧管答一句
    T(2, 0, "block", { hi: true, v: 0.9 });
    for (const bar of [2, 3, 4]) band(bar, { back: "snare", backV: 0.5, v: 0.8 });
    line(2, "toonWah", 0.75, [[1, 0.5, "F4"], [1.5, 0.5, "G4"], [2, 1.5, "A4"]]);
    line(3, "toonWah", 0.75, [[0, 0.5, "G4"], [0.5, 0.5, "F4"], [1, 1, "D4"], [2, 1.5, "C#4"]]);
    line(4, "toonClar", 0.6, [[0.5, 0.5, "A4"], [1, 0.5, "B4"], [1.5, 0.5, "D5"], [2, 1, "A5"], [3, 0.5, "F5"], [3.5, 0.5, "D5"]]);

    // 5–7 逐封落账：木鱼踩八分音符，信封起跳一声短滑哨，每落一笔钢琴往上数一个音；单簧管在低音区垫长音，最后一拍滚奏
    for (const bar of [5, 6, 7]) {
      band(bar, { back: "snare", backV: 0.45, v: 0.8 });
      for (let i = 0; i < 8; i++) T(bar, i / 2, "block", { hi: i % 2 === 0, v: i % 2 ? 0.45 : 0.6 });
    }
    COMMITS.forEach((o, i) => {
      const [bar, b] = at(o), [hb, hbb] = at(o - 0.25);
      N(bar, b, 0.5, ["D5", "E5", "F5", "A5", "D6", "E6"][i], "toonPiano", 0.6);
      whistle(hb, hbb, "G5", "D6", 0.6, 0.5);
    });
    for (const [bar, notes] of [[5, [[0, 2, "D4"], [2, 2, "E4"]]], [6, [[0, 2, "F4"], [2, 2, "D4"]]], [7, [[0, 2, "D4"], [2, 1.5, "C#4"]]]]) line(bar, "toonClar", 0.3, notes);
    T(7, 3, "roll", { len: 1, v: 0.7 });

    // 8 停奏：第 1、3 拍全队一下，其余只剩单簧管唱主题；主角转着跳上账本（底下轻轻滚奏），第 3 拍落地
    hitAll(8, 0, Dm); hitAll(8, 2, Dm, 0.85, 1);
    mel.push(...phrase(8, THEME, "toonClar", 1, true));
    T(8, 0.25, "roll", { len: 1.75, v: 0.35 });
    N(8, 3.5, 0.5, "F#2", "toonTuba", 0.7);

    // 9–10 效果单弹出来：单簧管跟着蹦一下，小号摇头「不打电话」；纸飞机飞向门房，滑哨一路往上
    for (const bar of [9, 10]) band(bar, { back: "snare", backV: 0.4, v: 0.75 });
    line(9, "toonPiano", 0.48, [[0, 0.5, "G5"], [0, 0.5, "D6"]]);
    line(9, "toonClar", 0.5, [[0.5, 0.25, "D5"], [0.75, 0.25, "E5"], [1, 0.75, "G5"]]);
    line(9, "toonWah", 0.8, [[2.5, 0.4, "A4"], [3, 0.8, "E4"]]);
    line(10, "toonClar", 0.55, [[0, 0.5, "G#4"], [0.5, 0.5, "B4"], [1, 0.5, "D5"], [1.5, 0.5, "E5"]]);
    whistle(10, 2, "E5", "A5", 1, 0.8);

    // 11 字卡「与此同时」：一记重音，钢琴十六分颤音，军鼓滚奏，大号往上爬；第 4 拍滑哨冲到门外
    hitAll(11, 0, Ed, 0.9);
    line(11, "toonTuba", 0.75, [[1, 0.85, "G2"], [2, 0.85, "A2"], [3, 0.85, "E2"]]);
    for (let i = 2; i < 16; i++) {
      const b = i / 4, pair = i % 2 ? ["G4", "C#5"] : b < 2 ? ["E4", "Bb4"] : ["E4", "A4"];
      pair.forEach((n) => N(11, b, 0.25, n, "toonPiano", 0.32));
    }
    T(11, 0.25, "roll", { len: 3.5, v: 0.45 });
    whistle(11, 3, "C5", "C6", 1, 0.7);

    // 12–14 门外：乐队热起来（捂镲打 2、4 拍）；服务铃、盖章、拉闸之间单簧管跑一串，塔上三圈广播配三声「哇」，小屋的窗一扇扇翻
    for (const bar of [12, 13, 14]) band(bar, { back: "choke", backV: 0.7 });
    line(12, "toonClar", 0.6, [[1.5, 0.25, "A5"], [1.75, 0.25, "G5"], [2, 0.25, "F#5"], [2.25, 0.25, "E5"], [2.5, 0.5, "D5"]]);
    line(13, "toonWah", 0.9, [[0, 0.5, "Bb4"], [0.6, 0.5, "D5"], [1.2, 0.7, "E5"]]);
    line(13, "toonPiano", 0.55, [[0.6, 0.4, "G5"], [1.2, 0.4, "Bb5"], [1.8, 0.4, "D6"], [2.4, 0.4, "E6"]]);
    line(14, "toonClar", 0.6, [[0, 0.5, "B4"], [0.5, 0.5, "D5"], [1, 0.5, "E5"], [1.5, 0.5, "G#5"], [2, 1, "A5"], [3, 0.5, "G5"], [3.5, 0.5, "E5"]]);
    line(14, "toonWah", 0.7, [[0, 1.5, "E4"], [1.5, 0.5, "D4"], [2, 1.5, "C#4"]]);

    // 15 门房睡着：大号歇了，钢琴像八音盒，班卓只扫反拍；心跳信封走进来扑通一下，起跳、落账
    line(15, "toonPiano", 0.7, [[0, 0.9, "D6"], [1, 0.9, "A5"], [2, 0.9, "F5"], [3, 0.9, "A5"]]);
    for (const b of [1, 3]) V[Dm].banjo.forEach((n, i) => N(15, b + i * 0.03, 0.3, n, "toonBanjo", 0.6));
    T(15, 0, "kick", { v: 0.7 }); T(15, 0.3, "kick", { v: 0.45 });
    whistle(15, 1, "G5", "D6", 0.6, 0.4);

    // 16 空效果单：乐队全停，弱音小号「哇、哇、哇、哇——」，最后一声按 4.5 Hz 抖；纸团进废纸篓
    line(16, "toonWah", 1.1, [[0, 0.8, "E4"], [1, 0.8, "Eb4"], [2, 0.8, "D4"]]);
    N(16, 3, 2.5, "C#4", "toonWahLong", 1.1);

    // 17 Clawd 踮着脚：班卓拨断音，木鱼轻点，门房一吸一呼的鼾声（滑哨），睡帽信封打个哈欠（单簧管往下）
    line(17, "toonBanjo", 0.85, [[0, 0.2, "D4"], [0.5, 0.2, "A3"], [1, 0.2, "D4"], [1.5, 0.2, "F4"], [2, 0.2, "E4"], [2.5, 0.2, "F4"], [3, 0.2, "D4"], [3.5, 0.2, "A3"]]);
    for (let b = 0; b < 4; b++) T(17, b, "block", { v: 0.35 });
    whistle(17, 0, "D5", "A5", 1.25, 0.4); whistle(17, 1.25, "A5", "D5", 1, 0.32);
    line(17, "toonClar", 0.55, [[2.4, 0.5, "F4"], [2.9, 0.9, "D4"]]);

    // 18 再打一声鼾，乐队轻轻回来；presence 信封落账、效果单弹出，滚奏推到下一小节
    band(18, { v: 0.7, back: "snare", backV: 0.5 });
    whistle(18, 0, "D5", "A5", 1.25, 0.28); whistle(18, 1.25, "A5", "D5", 1, 0.22);
    T(18, 3, "roll", { len: 1.2, v: 0.4 });

    // 19 纸飞机撞响服务铃：门房一激灵（滑哨往上、木鱼一下），帽子飞起又落下（滑哨往下）；再拉一次闸，塔上广播两声「哇」
    hitAll(19, 0, Dm, 0.8);
    T(19, 1, "block", { hi: true, v: 1 }); T(19, 1, "kick", { v: 0.9 }); T(19, 1, "choke", { v: 0.9 });
    whistle(19, 1, "D5", "D6", 0.3, 0.8); whistle(19, 1.7, "D6", "G5", 0.6, 0.6);
    band(19, { from: 2, back: "choke", backV: 0.7, v: 0.85 });
    line(19, "toonWah", 0.85, [[2.4, 0.5, "D5"], [3, 0.5, "F5"]]);

    // 20 打电话：秒表一拍一下（木鱼高低交替），三张标签往上飞（三声滑哨），单簧管接到下一段
    band(20, { back: "choke", backV: 0.6, v: 0.8 });
    for (let b = 0; b < 4; b++) T(20, b, "block", { hi: b % 2 === 0, v: 0.4 });
    [[19, 3.6, "C5", "C6"], [20, 0.08, "E5", "E6"], [20, 0.56, "G5", "G6"]].forEach(([bar, b, f, t]) => whistle(bar, b, f, t, 0.5, 0.35));
    line(20, "toonClar", 0.55, [[1, 0.5, "B4"], [1.5, 0.5, "D5"], [2, 1, "C#5"], [3, 1, "E5"]]);

    // 21–23 三个库按拍升起（每座一声滑哨，落地是音效）：乐队齐奏，小号领、单簧管在最后一小节加花；归档的信封排着走时木鱼回来
    for (const bar of [21, 22, 23]) band(bar, { back: "choke", backV: 0.8 });
    for (const [o, f, t] of [[AT.lagUp, "D5", "A5"], [AT.d1Up, "A4", "F5"], [AT.credUp, "F5", "D6"]]) { const [bar, b] = at(o); whistle(bar, b, f, t, 1.2, 0.8); }
    line(21, "toonWah", 0.8, [[0, 1.5, "A4"], [1.5, 0.5, "B4"], [2, 0.5, "C5"], [2.5, 0.5, "B4"], [3, 1, "A4"]]);
    line(22, "toonWah", 0.8, [[0, 1, "Bb4"], [1, 0.5, "D5"], [1.5, 0.5, "E5"], [2, 1.5, "D5"]]);
    line(23, "toonWah", 0.8, [[0, 1, "D5"], [1, 0.5, "F5"], [1.5, 0.5, "Ab4"], [2, 0.5, "G4"], [2.5, 0.5, "E4"], [3, 1, "C#5"]]);
    line(23, "toonClar", 0.5, [[0, 0.5, "F5"], [0.5, 0.5, "D5"], [1, 0.5, "Bb4"], [1.5, 0.5, "D5"], [2, 0.5, "E5"], [2.5, 0.5, "G5"], [3, 1, "A5"]]);
    for (let i = 2; i < 10; i++) { const [bar, b] = at(23 + i / 8); T(bar, b, "block", { hi: i % 2 === 0, v: 0.4 }); }

    // 24–25 号外：全队一下，报纸转着飞进来时只剩滚奏、大号往上爬、单簧管尖声颤音；啪地停住是锅碗瓢盆，
    // 停住后轻轻滚奏、单簧管接着颤，垫到 A7 那一记，滑哨顺着冲进照片框的镜头往上滑；撞进框里那一下（捂镲、章、底鼓）写在第 04 章 0:0
    hitAll(24, 0, Dm); N(24, 0, 1, "D6", "toonClar", 0.6);
    T(24, 1, "roll", { len: 3, v: 0.6 });
    line(24, "toonTuba", 0.8, [[1, 0.85, "G2"], [2, 0.85, "G#2"], [3, 0.85, "A2"]]);
    for (let i = 4; i < 16; i++) N(24, i / 4, 0.25, i % 2 ? "Bb5" : "A5", "toonClar", 0.35);
    hitAll(25, 0, Bb); T(25, 0, "pans", { v: 1 });
    T(25, 1, "roll", { len: 1, v: 0.65 });
    for (let i = 4; i < 8; i++) N(25, i / 4, 0.25, i % 2 ? "Bb5" : "A5", "toonClar", 0.3);
    hitAll(25, 2, A7, 0.85);
    const [db, dbb] = at(AT.dive);
    whistle(db, dbb, "A4", "A5", Math.round((AT.end - AT.dive) * 4 * 100) / 100, 0.9);
    T(25, 2.5, "roll", { len: 1.5, v: 0.45 });
    line(25, "toonClar", 0.55, [[3, 0.25, "A4"], [3.25, 0.25, "C#5"], [3.5, 0.25, "E5"], [3.75, 0.25, "G5"]]);

    const SFX = [
      [0, "click", 0.4, 0.1], [1.5, "tbell", 0.2, 0.15], [4.5, "tbell", 0.14, 0.2],
      ...COMMITS.map((o, i) => [o, "stamp", 0.4, 0.2, 1 + 0.03 * i]), ...COMMITS.map((o) => [o + 0.02, "paper", 0.22, 0.2, 1.2]),
      [AT.hero, "stamp", 0.75, 0.15], [AT.hero, "land", 0.4, 0.15],
      [AT.slip, "pop", 0.5, 0.15], [9.75, "tbell", 0.12, 0],
      [AT.fly, "whoosh", 0.55, -0.2], [AT.landed, "land", 0.35, -0.35],
      [AT.ding, "ding", 0.75, 0.25], [AT.stamp, "stamp", 0.6, 0.35], [AT.stamp + 0.05, "tube", 0.45, -0.1],
      [AT.switch1, "plug", 0.55, 0.3], [AT.switch1 + 0.03, "zip", 0.3, 0],
      [AT.ok202, "stamp", 0.45, -0.6, 1.15], [AT.agents, "stamp", 0.25, 0.7, 0.9],
      [14.75, "whoosh", 0.55, 0.4],
      [AT.hb, "stamp", 0.3, 0.15],
      [AT.empty, "pop", 0.4, 0.15, 0.8], [AT.toss, "paper", 0.4, 0.2, 0.9], [AT.toss + 0.2, "knock", 0.3, 0.35], [17.15, "tbell", 0.1, 0.05],
      [AT.pres, "stamp", 0.45, 0.15], [AT.slip2, "pop", 0.45, 0.15],
      [AT.fly2, "whoosh", 0.55, -0.2], [AT.wake, "ding", 0.85, -0.45], [19.3, "whoosh", 0.45, -0.5, 1.1],
      [AT.switch2, "plug", 0.55, 0.25], [AT.switch2 + 0.02, "zip", 0.3, -0.1],
      [AT.phone, "click", 0.4, 0.3], [AT.hang, "click", 0.45, 0.3, 0.9],
      [21.0, "whoosh", 0.45, 0.4, 0.9],
      [AT.lagUp + 0.3, "land", 0.55, 0.15], [AT.d1Up + 0.3, "land", 0.65, 0.6, 0.85], [AT.credUp + 0.3, "land", 0.55, 0.3, 1.1],
      [AT.spin + 0.05, "printer", 0.4, 0],
      [AT.bam, "stamp", 1.0, 0], [AT.bam, "land", 0.6, 0],
    ];
    return {
      harm,
      sections: [
        { from: 0, to: 1, id: "toon-title", name: "片头字卡：灯亮，乐队轻起，光圈收在灯上", energy: 0.35 },
        { from: 2, to: 4, id: "toon-room", name: "账房：两拍子起步，弱音小号叫一声、单簧管答一句", energy: 0.55 },
        { from: 5, to: 7, id: "toon-queue", name: "一封一封落账：木鱼踩步子，每落一笔钢琴往上数一个音", energy: 0.65 },
        { from: 8, to: 8, id: "toon-hero", name: "停奏：主角信封转着跳上账本，单簧管唱主题", energy: 0.7 },
        { from: 9, to: 10, id: "toon-slip", name: "效果单弹出来：小号摇头「不打电话」，纸飞机飞向门房", energy: 0.55 },
        { from: 11, to: 11, id: "toon-meanwhile", name: "字卡「与此同时」：钢琴颤音、军鼓滚奏、大号往上爬", energy: 0.6 },
        { from: 12, to: 14, id: "toon-outside", name: "门外：服务铃、盖章、拉闸，塔上一圈圈广播，乐队热起来", energy: 0.9 },
        { from: 15, to: 17, id: "toon-lullaby", name: "门房睡着：八音盒、心跳、鼾声滑哨，空效果单一句哭腔小号，Clawd 踮脚", energy: 0.3 },
        { from: 18, to: 20, id: "toon-wake", name: "presence 落账：服务铃一响门房惊醒，再拉一次闸、打电话", energy: 0.8 },
        { from: 21, to: 23, id: "toon-stores", name: "三个库按拍升起：每座一声滑哨、一声落地，乐队齐奏", energy: 0.95 },
        { from: 24, to: 25, id: "toon-extra", name: "号外：报纸转着飞进来，锅碗瓢盆一声，A7 上滑哨冲进第 04 章", energy: 0.85 },
      ].map((s) => ({ pad: 0, lp: 1200, padVerb: 0, ...s })),
      melody: mel,
      story,
      sfx: SFX.map(([o, name, v = 1, pan = 0, rate = 1]) => ({ bar: Math.floor(o + 1e-9), beat: (o - Math.floor(o + 1e-9)) * 4, name, v, pan, rate })),
    };
  },
});
