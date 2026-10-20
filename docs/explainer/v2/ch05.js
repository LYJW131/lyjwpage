(() => {
  const { E, prog, keys, clamp, lerp, hash } = K;
  I18N.add({
    "ch05.title": ["电报线", "The live wire"],
    "ch05.n1a": ["head 里的内联脚本先连 /ws，", "A <head> script opens /ws early;"],
    "ch05.n1b": ["不等 hydrate，消息先排进队列。", "messages queue until hydration."],
    "ch05.n2a": ["连接还开着就直接接管，不再握手；", "Hydration adopts the same socket;"],
    "ch05.n2b": ["队列按到达顺序重放。", "the queue replays in arrival order."],
    "ch05.n3a": ["推送自带数据，直接写进 SWR，", "The push carries the data itself;"],
    "ch05.n3b": ["不再回源，卡片当场翻面。", "SWR updates with no refetch."],
    "ch05.n4a": ["闸门比的是数据自带的时间戳，", "The gate compares timestamps,"],
    "ch05.n4b": ["不是到达顺序：旧的盖不掉新的。", "not arrival order, so stale loses."],
    "ch05.n5a": ["进度按观测时刻在本地外推，", "Progress is extrapolated locally,"],
    "ch05.n5b": ["整首歌都不用再发消息。", "so playback costs no messages."],
    "ch05.n6a": ["源站只给原始时间戳，", "The origin sends only timestamps;"],
    "ch05.n6b": ["在不在线，由浏览器按截止时刻判。", "the browser decides online/offline."],
    "ch05.n7a": ["切后台只发一条 hidden，", "Backgrounding sends one “hidden”;"],
    "ch05.n7b": ["可见人数变了，房间才广播 online。", "online is broadcast only on change."],
    "ch05.n8a": ["可滞后卡不按定时器轮询，", "Lag cards don't poll on a timer;"],
    "ch05.n8b": ["按上次写入加节奏，算准再取。", "they fetch when a write is due."],
    "ch05.n9a": ["推送连着时，这几张卡", "While the push is live, these cards"],
    "ch05.n9b": ["最多每 5 分钟才轮询一次。", "poll at most once every 5 minutes."],
    "ch05.origin": ["源站", "Origin"],
    "ch05.browser": ["浏览器", "Browser"],
    "ch05.same": ["同一条连接，不重新握手", "Same socket, no new handshake"],
    "ch05.order": ["按到达顺序重放", "Replayed in arrival order"],
    "ch05.gate": ["比数据自带的时间戳", "Compares the data's own timestamps"],
    "ch05.newer": ["新", "newer"],
    "ch05.older": ["旧", "older"],
    "ch05.quiet": ["线上没有消息", "Nothing on the wire"],
    "ch05.onlyPlaying": ["只在播放时往前走", "Advances only while playing"],
    "ch05.macClock": ["observedAt：Mac 的钟", "observedAt: the Mac's clock"],
    "ch05.browserClock": ["now：浏览器的钟", "now: the browser's clock"],
    "ch05.lyrics": ["歌词（占位）", "Lyrics (placeholder)"],
    "ch05.firstFrame": ["首帧：源站给的 servedAt", "First frame: the origin's servedAt"],
    "ch05.afterMount": ["挂载后：访客自己的钟", "After mount: the visitor's own clock"],
    "ch05.deadline": ["截止", "Deadline"],
    "ch05.silent": ["源站什么也没说", "The origin says nothing"],
    "ch05.census": ["数人头", "Head count"],
    "ch05.conn": ["开着的连接，含后台", "Open sockets, incl. background"],
    "ch05.onl": ["正在看的标签页", "Tabs being viewed"],
    "ch05.tab": ["切到别的标签页", "Switched to another tab"],
    "ch05.stay": ["连接不断", "The socket stays open"],
    "ch05.eta": ["预期到货表", "Expected arrivals"],
    "ch05.cad1": ["每 60 秒", "every 60 s"],
    "ch05.cad2": ["每 10 分钟", "every 10 min"],
    "ch05.cad3": ["每 1 小时", "every 1 h"],
    "ch05.backoff": ["过了 due 还没更新：从 15 秒起退避，封顶 min(节奏, 5 分钟)", "Past due, no update: back off from 15 s, capped at min(cadence, 5 min)"],
    "ch05.net": ["兜底轮询", "Safety-net polling"],
    "ch05.others": ["其余卡照旧按自己的间隔", "Other cards keep their own interval"],
    "ch05.five": ["≥ 5 分钟", "≥ 5 min"],
  });
  const tr = (k) => I18N.tr(k);
  const en = () => I18N.lang === "en";
  const TAU = Math.PI * 2;
  let bg, top, BARs = (60 / 108) * 4;

  // 剪纸海报的四色：米白纸、墨黑、朱红、芥末黄；Clawd 用它自己的橙，在线人数用 live 绿（全片只在这里和第 06 章出现）。
  const GROUND = [241, 236, 224], INK = [24, 21, 18], RED = [208, 66, 38], MUSTARD = [229, 168, 46], MUSTARD_D = [203, 141, 33];
  const CLAWD = [215, 119, 87], CARD = [251, 248, 240], SHADE = [70, 48, 24];
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const toLin = (c) => c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  const GROUND_LIN = toLin(GROUND);
  // 收尾时纸色挪到第 06 章的宣纸色（须与 ch06.js 的 PAPER 同步），切过去底色不跳。
  const PAPER06 = [238, 230, 211];

  const HEI = '"Noto Sans SC ch05", "PingFang SC", "Noto Sans SC", sans-serif';
  const JOST = "Jost, Geist, sans-serif";
  const DISPLAY = (px) => (en() ? `800 ${px}px ${JOST}` : `${px}px "ZCOOL QingKe HuangYou", ${HEI}`);
  const LABEL = (px) => (en() ? `600 ${px}px ${JOST}` : `700 ${px}px ${HEI}`);
  const NARR = (px) => (en() ? `500 ${px}px ${JOST}` : `700 ${px}px ${HEI}`);
  const UI = (px, w = 600) => `${w} ${px}px ${JOST}`;
  const SONG = (px) => `700 ${px}px ${HEI}`;
  const MONO = (px, w = 600) => K.FONT.mono(px, w);
  const disp = (s) => (en() ? s.toUpperCase() : s);

  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const pop = (b, at, d = 0.12) => E.outBack(prog(b, at, at + d));

  // 时刻（小节），和 music/ch05.js 的 story、sfx 是同一张表。
  const AT = {
    open: { bar: 0.625, golden: [0.75, 0.875], title: 1.0, sub: 1.25, wink: 1.6 },
    a: { cursor: 2.15, plug: 2.5, hop: [2.25, 2.5, 2.75], tele: [3.0, 3.5, 4.0], end: 4.6 },
    b: { arm: 5.0, grip: [5.2, 5.45], look: 5.25, replay: [5.75, 6.25, 6.75] },
    c: { arcs: 7.75, hero: 8.0, open: 8.5, file: 8.875, flip: 9.0 },
    d: { crawl: [10.75, 12.0], hit: 12.0 },
    e: { lyrics: 13.75, snaps: [13.25, 13.75, 14.25, 14.75, 15.25] },
    f: { hand: 16.25, tick: [16.5, 17.5], off: 17.5 },
    g: { tab: 19.5, bcast: 20.0 },
    h1: { rows: [21.5, 22.0, 22.5], retry: 22.625 },
    h2: { push: 23.75, chips: 24.0, stamp: 24.5 },
    out: { pops: [26.25, 26.375, 26.5, 26.625], snips: [26.75, 27.0, 27.25, 27.5], exit: 27.85 },
  };
  // [键, 第一行起, 第二行起, 收]：每对旁白在镜头甩走之前收完。
  const NAR = [
    ["n1", 2.25, 3.0, 4.85], ["n2", 5.1, 5.7, 7.25], ["n3", 8.1, 8.7, 10.25], ["n4", 10.65, 11.25, 12.75], ["n5", 13.15, 13.75, 15.25],
    ["n6", 15.65, 16.25, 18.25], ["n7", 18.65, 19.25, 20.75], ["n8", 21.15, 21.75, 23.5], ["n9", 23.9, 24.4, 25.75],
  ];

  // 一整条横着的街：每个机位占一屏宽，镜头在 y 150、缩放 1 时，世界 y 0 的电报线在屏幕 y 390。
  // 场景里按「本机位的屏幕坐标」画：world = (FX + lx, ly − 390)。
  const FX = { open: 0, ab: 1920, c: 3840, d: 5760, e: 7680, f: 9600, g: 11520, h1: 13440, h2: 15360, out: 17280 };
  const WY = 390, WIRE_H = 14, PLUG = 520, PLUG_X = FX.ab + PLUG;
  // 机位的东西在镜头甩过来之前就摆好，甩的时候能看见落点。
  const on = (b, start) => (b >= start - 0.3 ? 1 : 0);

  // ---- 剪纸 ----
  // 手剪的边：沿边隔一段取一点、按种子抖开；同一张纸每帧抖法一样，边不闪。
  function cutPath(pts, seed, jit = 2.2, step = 44) {
    const p = new Path2D();
    let k = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
      for (let j = 0; j < n; j++) {
        const t = j / n, s = j === 0 ? 0.35 : 1;
        const px = lerp(ax, bx, t) + s * (hash(seed * 13.7 + k * 1.31) - 0.5) * 2 * jit, py = lerp(ay, by, t) + s * (hash(seed * 7.3 + k * 2.17 + 5) - 0.5) * 2 * jit;
        if (k === 0) p.moveTo(px, py); else p.lineTo(px, py);
        k++;
      }
    }
    p.closePath();
    return p;
  }
  const cutRect = (x0, y0, w, h, seed, jit) => cutPath([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], seed, jit);
  function disc(cx, cy, r, seed, jit = 2.2) {
    const n = Math.max(14, Math.round((TAU * r) / 30)), p = new Path2D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, rr = r + (hash(seed * 5.1 + i * 1.7) - 0.5) * 2 * jit;
      if (i) p.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else p.moveTo(cx + rr, cy);
    }
    p.closePath();
    return p;
  }
  function paper(x, path, col, o = {}) {
    const a = o.a ?? 1;
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a;
    if ((o.sh ?? 0.18) > 0) { x.save(); x.translate(o.dx ?? 4, o.dy ?? 6); x.fillStyle = rgba(SHADE, o.sh ?? 0.18); x.fill(path); x.restore(); }
    x.fillStyle = rgba(col); x.fill(path);
    x.restore();
  }
  // K.text 的 alpha 是绝对值、会盖掉外层 globalAlpha；这里乘上外层的，组里淡入淡出时字跟着走。
  function T(x, str, px, py, o = {}) {
    return K.text(x, str, px, py, { ...o, font: o.font || LABEL(30), color: o.css || rgba(o.col || INK), alpha: (o.alpha ?? 1) * x.globalAlpha });
  }
  const tri = (x, pts, col, o = {}) => paper(x, cutPath(pts, o.seed ?? 3, o.jit ?? 1.2, 30), col, o);
  function group(x, a, fn) { if (a <= 0) return; x.save(); x.globalAlpha *= a; fn(); x.restore(); }

  // Clawd：橙色一张剪纸，眼睛是两块墨；wink 合上右眼。
  function clawd(x, cx, feet, q, o = {}) {
    const { body, eyes } = window.Clawd.cells(o.pose || "default", o.offset || 0);
    x.save(); x.globalAlpha *= o.a ?? 1; x.translate(cx - 9 * q, feet - 10 * q);
    if (o.flip) { x.translate(18 * q, 0); x.scale(-1, 1); }
    const p = new Path2D();
    for (const [a, b2] of body) p.rect(a * q - 0.3, b2 * 2 * q - 0.3, q + 0.6, 2 * q + 0.6);
    x.save(); x.translate(q * 0.22, q * 0.32); x.fillStyle = rgba(SHADE, 0.2); x.fill(p); x.restore();
    x.fillStyle = rgba(CLAWD); x.fill(p);
    x.fillStyle = rgba(o.eye || INK);
    const wink = o.wink || 0;
    for (const [a, b2] of eyes) {
      if (wink > 0 && a >= 9) { const h = 2 * q * (1 - 0.8 * wink); x.fillRect(a * q - 0.3, b2 * 2 * q + (2 * q - h) - 0.3, q + 0.6, h + 0.6); }
      else x.fillRect(a * q - 0.3, b2 * 2 * q - 0.3, q + 0.6, 2 * q + 0.6);
    }
    x.restore();
    if (o.headset) headset(x, cx, feet - 10 * q + (o.offset || 0) * 2 * q, q, o.flip, o.a ?? 1);
  }
  function headset(x, cx, top, q, flip, a) {
    const X = (u) => (flip ? cx + 9 * q - u * q : cx - 9 * q + u * q), Y = (v) => top + v * q;
    x.save(); x.globalAlpha *= a; x.lineCap = "butt";
    x.strokeStyle = rgba(INK); x.lineWidth = 0.75 * q;
    x.beginPath(); x.moveTo(X(2.8), Y(1.6)); x.bezierCurveTo(X(2.8), Y(-3), X(16.2), Y(-3), X(16.2), Y(1.6)); x.stroke();
    x.fillStyle = rgba(INK);
    x.fillRect(Math.min(X(1.7), X(3.5)), Y(0.6), 1.8 * q, 3.2 * q);
    x.fillRect(Math.min(X(15.5), X(17.3)), Y(0.6), 1.8 * q, 3.2 * q);
    x.lineWidth = 0.45 * q;
    x.beginPath(); x.moveTo(X(16.4), Y(3.6)); x.quadraticCurveTo(X(16.2), Y(6.4), X(12.8), Y(6.4)); x.stroke();
    x.fillStyle = rgba(RED); x.beginPath(); x.arc(X(12.4), Y(6.4), 0.75 * q, 0, TAU); x.fill();
    x.restore();
  }

  // 信封：一张红纸做信封身，深一点的三角做封舌；打开时封舌翻上去，里面抽出一张白条。
  function envelope(x, cx, cy, w, col, o = {}) {
    const h = w * 0.62, open = o.open ?? 0, a = o.a ?? 1;
    if (a <= 0) return;
    const dark = col.map((v, i) => Math.round(v * 0.72 + INK[i] * 0.28));
    x.save(); x.translate(cx, cy); x.rotate(o.rot || 0); x.scale(o.s ?? 1, o.s ?? 1); x.globalAlpha *= a;
    if (open > 0) tri(x, [[-w / 2, -h / 2], [0, -h / 2 - h * 0.62 * E.out(open)], [w / 2, -h / 2]], dark, { sh: 0, seed: 7 });
    if (o.slip > 0) {
      const sw = w * 0.84, sh = h * 0.86, rise = h * 0.75 * E.out(o.slip);
      paper(x, cutRect(-sw / 2, -h / 2 - rise, sw, sh, 9, 1.2), CARD, { sh: 0.12 });
      if (o.label) T(x, o.label, 0, -h / 2 - rise + 46, { font: MONO(28), align: "center", alpha: prog(o.slip, 0.4, 0.8) });
    }
    paper(x, cutRect(-w / 2, -h / 2, w, h, o.seed ?? 5, 1.6), col);
    if (open < 0.02) tri(x, [[-w / 2 + 3, -h / 2 + 2], [0, h * 0.1], [w / 2 - 3, -h / 2 + 2]], dark, { sh: 0, seed: 8 });
    else tri(x, [[-w / 2 + 3, h / 2 - 2], [0, -h * 0.02], [w / 2 - 3, h / 2 - 2]], dark, { sh: 0, seed: 6, a: 0.55 });
    x.restore();
  }
  function slip(x, cx, cy, w, h, label, o = {}) {
    const a = o.a ?? 1;
    if (a <= 0) return;
    x.save(); x.translate(cx, cy); x.rotate(o.rot || 0); x.scale(o.s ?? 1, o.s ?? 1); x.globalAlpha *= a;
    paper(x, cutRect(-w / 2, -h / 2, w, h, o.seed ?? 4, 1.4), o.col || INK);
    if (label) T(x, label, 0, 10, { font: MONO(o.px || 28), align: "center", col: o.txt || CARD });
    x.restore();
  }
  function clock(x, cx, cy, r, o = {}) {
    group(x, o.a ?? 1, () => {
      const face = o.face || CARD, ink = o.ink || INK;
      paper(x, disc(cx, cy, r + r * 0.12, o.seed ?? 12, 1.6), o.rim || INK);
      paper(x, disc(cx, cy, r, (o.seed ?? 12) + 3, 1.2), face, { sh: 0 });
      if (o.wedge) { x.fillStyle = rgba(RED); x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r * 0.94, o.wedge[0] - Math.PI / 2, o.wedge[1] - Math.PI / 2); x.closePath(); x.fill(); }
      x.fillStyle = rgba(ink);
      for (let i = 0; i < 12; i++) { x.save(); x.translate(cx, cy); x.rotate((i / 12) * TAU); x.fillRect(-r * 0.03, -r * 0.92, r * 0.06, r * (i % 3 ? 0.1 : 0.18)); x.restore(); }
      for (const [ang, len, wd] of [[o.h ?? 0, 0.5, 0.09], [o.m ?? 0, 0.78, 0.06]]) { x.save(); x.translate(cx, cy); x.rotate(ang); x.fillRect((-r * wd) / 2, -r * len, r * wd, r * (len + 0.12)); x.restore(); }
      x.beginPath(); x.arc(cx, cy, r * 0.08, 0, TAU); x.fill();
    });
  }
  function pill(x, cx, cy, str, font, col, txt, a = 1) {
    group(x, a, () => {
      const w = K.measure(x, str, font) + 32, h = 46;
      paper(x, cutRect(cx - w / 2, cy - h / 2, w, h, 61 + str.length, 1), col);
      T(x, str, cx, cy + 10, { font, align: "center", col: txt });
    });
  }

  // ---- 电报线 ----
  // 线从 <script> 那一格的插头往右一直伸出去；脉冲是贴在线上的三角：往下 = 发给浏览器，往上 = 浏览器发出去。
  function wire(x, b, v, pulses) {
    const head = PLUG_X + 26000 * E.outExpo(prog(b, AT.a.plug, AT.a.plug + 0.25));
    const x0 = Math.max(PLUG_X, v.x0 - 80), x1 = Math.min(head, v.x1 + 80);
    if (x1 <= x0 + 1) return;
    const jit = lerp(1.5, 0.5, prog(b, 27.3, 27.9)), topE = [], botE = [];
    for (let gx = Math.floor(x0 / 48) * 48; ; gx += 48) {
      const px = clamp(gx, x0, x1);
      topE.push([px, -WIRE_H / 2 + (hash(gx * 0.0173 + 3.1) - 0.5) * 2 * jit]);
      botE.push([px, WIRE_H / 2 + (hash(gx * 0.0191 + 7.7) - 0.5) * 2 * jit]);
      if (gx >= x1) break;
    }
    const p = new Path2D();
    topE.forEach(([u, w], i) => (i ? p.lineTo(u, w) : p.moveTo(u, w)));
    for (let i = botE.length - 1; i >= 0; i--) p.lineTo(botE[i][0], botE[i][1]);
    p.closePath();
    for (const q of pulses) {
      if (q.h <= 0.5 || q.x < x0 - q.w || q.x > x1 + q.w) continue;
      const s = q.dir, y0 = s * (WIRE_H / 2 - 2), w = q.w / 2;
      p.moveTo(q.x - w, y0); p.lineTo(q.x + (hash(q.x * 0.01) - 0.5) * 3, y0 + s * q.h); p.lineTo(q.x + w, y0); p.closePath();
    }
    paper(x, p, INK, { sh: 0.18 * (1 - prog(b, 27.4, 27.85)), dx: 3, dy: 5 });
  }

  // ---- 机位 0：片头 ----
  const OPEN = { cx: 600, feet: 690, q: 20 };
  function openFront(x, b) {
    paper(x, disc(600, 470, 300, 11), MUSTARD, { sh: 0.1 });
    paper(x, cutRect(330, OPEN.feet, 560, 14, 21, 1.2), INK);
    const wink = b < AT.open.wink ? 0 : 1 - Math.abs(prog(b, AT.open.wink, AT.open.wink + 0.14) * 2 - 1);
    clawd(x, OPEN.cx, OPEN.feet, OPEN.q, { headset: true, wink });
    const kb = E.outExpo(prog(b, AT.open.bar, AT.open.bar + 0.14));
    if (kb > 0) paper(x, cutRect(905, -60 - (1 - kb) * 900, 46, 880, 31, 1.8), RED);
    const k1 = E.outExpo(prog(b, AT.open.golden[0], AT.open.golden[0] + 0.12)), k2 = E.outExpo(prog(b, AT.open.golden[1], AT.open.golden[1] + 0.12));
    if (k1 > 0) paper(x, cutRect(985 + (1 - k1) * 1100, 604, 780, 26, 33, 1.4), INK);
    if (k2 > 0) paper(x, cutRect(985 + (1 - k2) * 1100, 738, 440, 16, 35, 1.2), INK);
    const k3 = pop(b, AT.open.golden[1], 0.14);
    if (k3 > 0) {
      x.save(); x.translate(0, (1 - k3) * -520);
      paper(x, cutRect(1560, 150, 200, 180, 37, 2), RED);
      T(x, "05", 1660, 296, { font: UI(150, 800), align: "center", col: CARD });
      x.restore();
    }
    if (b >= AT.open.title) {
      if (en()) T(x, disp(tr("ch05.title")), 985, 560, { font: DISPLAY(124), maxW: 880, reveal: prog(b, AT.open.title, AT.open.title + 0.2), perChar: true, rise: 36 });
      else T(x, tr("ch05.title"), 980, 562, { font: DISPLAY(200), reveal: prog(b, AT.open.title, AT.open.title + 0.18), perChar: true, rise: 40 });
    }
    if (b >= AT.open.sub) T(x, "wss://…/ws", 990, 700, { font: MONO(44), reveal: prog(b, AT.open.sub, AT.open.sub + 0.2), perChar: true });
  }

  // ---- 机位 A/B：页面解析、早开的线、托盘、接管与重放 ----
  const TAPE = (() => { let xx = 304; return [["<head>", 125], ["<script>", 158], ["</head>", 142], ["<body>", 125], ["<main>", 125], ["…", 50], ["</body>", 142]].map(([s, w]) => { const o = { s, x: xx, w }; xx += w + 12; return o; }); })();
  const TAPE_END = TAPE[TAPE.length - 1].x + TAPE[TAPE.length - 1].w;
  const SLOTS = [750, 960, 1170], TELE = ["online", "desktop", "playing-now"], ARM = 1400;
  const TILES = [{ y: 520, name: "Online now" }, { y: 620, name: "desktop" }, { y: 720, name: "playing-now" }];
  const CURSOR = [[AT.a.cursor, 304], [AT.a.plug, PLUG, E.io], [AT.a.plug + 0.1, PLUG], [AT.a.end, TAPE_END, E.lin]];
  const cursorX = (b) => keys(b, CURSOR);
  function parsedAt(cx) {
    let lo = AT.a.cursor, hi = AT.a.end;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (cursorX(m) >= cx) hi = m; else lo = m; }
    return hi;
  }
  const TAPE_T = TAPE.map((t) => parsedAt(t.x + t.w / 2));
  function teleState(b, i) {
    const t = AT.a.tele[i], r = AT.b.replay[i];
    if (b < t || b >= r) return null;
    if (b < r - 0.25) {
      const k = prog(b, t, t + 0.12), bounce = 8 * Math.sin(Math.PI * prog(b, t + 0.12, t + 0.2));
      return { x: SLOTS[i], y: lerp(WY + 30, 612, E.in(k)) - bounce, rot: (hash(i + 3) - 0.5) * 0.4 * (1 - k) + (hash(i + 9) - 0.5) * 0.06, s: 1 };
    }
    const k = E.io(prog(b, r - 0.25, r)), x0 = SLOTS[i], y0 = 612, x1 = 1710, y1 = TILES[i].y + 40, mx = (x0 + x1) / 2, u = 1 - k;
    return { x: u * u * x0 + 2 * u * k * mx + k * k * x1, y: u * u * y0 + 2 * u * k * 470 + k * k * y1, rot: (hash(i + 9) - 0.5) * 0.06 * u, s: lerp(1, 0.55, k), fly: true };
  }
  function clawdAB(x, b) {
    const [h0, h1, h2] = AT.a.hop;
    if (b < h0) return;
    const cx = keys(b, [[h0, -120], [h1, 115, E.lin], [h2, 350, E.lin]]);
    const lift = K.hop(b, h0, h1, 60) + K.hop(b, h1, h2, 60);
    let pose = lift > 4 ? "arms-up" : "default", offset = 0;
    for (const t of [h1, h2]) if (b >= t && b < t + 0.04) offset = 1;
    for (const t of AT.a.tele) if (b >= t && b < t + 0.05) offset = 1;
    const fr = K.clawdSeq("look", b, AT.b.look, BARs);
    if (fr) pose = fr.pose;
    clawd(x, cx, 600 - lift, 8, { headset: true, pose, offset });
  }
  function abPulses(b, out) {
    AT.a.tele.forEach((t, i) => {
      const k = prog(b, t - 0.3, t);
      if (k > 0 && b < t + 0.06) out.push({ x: FX.ab + lerp(2000, SLOTS[i], k), w: 64, h: 44 * (1 - prog(b, t, t + 0.06)), dir: 1 });
    });
  }
  function abBack(x, b) {
    // 页面：一条 HTML 纸带，光标走过一格才贴实一格；<script> 那格是红的，接上线。
    for (let i = 0; i < TAPE.length; i++) {
      const t = TAPE[i], done = b >= AT.a.cursor && b >= TAPE_T[i], k = done ? prog(b, TAPE_T[i], TAPE_T[i] + 0.06) : 0;
      const col = t.s === "<script>" && done ? RED : INK, sy = 1 + 0.18 * (done ? 1 - k : 0), cx = t.x + t.w / 2;
      x.save(); x.translate(cx, 721); x.scale(1, sy); x.translate(-cx, -721);
      paper(x, cutRect(t.x, 690, t.w, 62, 50 + i, 1.4), col, { a: done ? 1 : 0.22, sh: done ? 0.18 : 0 });
      x.restore();
      if (done) T(x, t.s, cx, 731, { font: MONO(30), align: "center", col: CARD, alpha: k });
    }
    const ca = b >= AT.a.cursor ? prog(b, AT.a.cursor, AT.a.cursor + 0.06) * (1 - prog(b, AT.a.end + 0.05, AT.a.end + 0.2)) : 0;
    const cx = cursorX(b);
    if (ca > 0) tri(x, [[cx - 16, 656], [cx + 16, 656], [cx, 680]], RED, { a: ca, seed: 71 });
    const kc = E.outExpo(prog(b, AT.a.plug, AT.a.plug + 0.1));
    if (kc > 0) { const y = lerp(690, WY + 6, kc); paper(x, cutRect(PLUG - 8, y, 16, 690 - y, 81, 1), INK); }
    if (b < AT.b.arm) group(x, 0.7 * prog(b, AT.a.cursor, AT.a.cursor + 0.2), () => {
      x.strokeStyle = rgba(RED); x.lineWidth = 3; x.setLineDash([12, 10]); x.strokeRect(ARM - 32, 470, 64, 640); x.setLineDash([]);
    });
    T(x, "hydrate", ARM - 50, 822, { font: MONO(28), align: "right", col: RED, alpha: prog(b, AT.a.cursor, AT.a.cursor + 0.2) });
    group(x, prog(b, AT.a.plug, AT.a.plug + 0.15), () => {
      paper(x, cutRect(250, 600, 220, 16, 91, 1.2), MUSTARD);
      paper(x, cutRect(452, 586, 70, 14, 93, 1), INK);
    });
  }
  function abFront(x, b) {
    for (let i = 0; i < 3; i++) { const s = teleState(b, i); if (s && !s.fly) slip(x, s.x, s.y, 196, 46, TELE[i], { rot: s.rot, seed: 100 + i }); }
    group(x, prog(b, AT.a.plug, AT.a.plug + 0.15), () => {
      paper(x, cutRect(640, 628, 660, 40, 95, 1.4), MUSTARD);
      T(x, "queue", 656, 657, { font: MONO(28) });
    });
    const kp = pop(b, AT.a.plug, 0.1);
    if (kp > 0) { x.save(); x.translate(PLUG, WY); x.scale(kp, kp); paper(x, cutRect(-22, -30, 44, 60, 83, 1.2), RED); x.restore(); }
    const ks = E.outExpo(prog(b, AT.a.plug, AT.a.plug + 0.12));
    if (ks > 0) {
      x.save(); x.translate((1 - ks) * -1300, 0);
      paper(x, cutRect(380, 236, 820, 60, 85, 1.6), INK);
      T(x, 'new WebSocket("wss://…/ws?visible=1")', 400, 277, { font: MONO(34), col: CARD, maxW: 780 });
      paper(x, cutRect(PLUG - 4, 296, 8, WY - 330, 87, 0.6), INK, { sh: 0 });
      x.restore();
    }
    clawdAB(x, b);
    // 接管：一只红色的剪纸手臂从底下伸上来，攥住同一根线。
    const ka = E.outBack(prog(b, AT.b.arm - 0.05, AT.b.arm + 0.08));
    if (ka > 0) {
      const top0 = lerp(1200, 470, ka), g = E.io(prog(b, ...AT.b.grip));
      const palmY = lerp(top0 + 10, WY + 40, prog(b, AT.b.grip[0], AT.b.grip[0] + 0.12));
      paper(x, cutPath([[ARM - 36, 1120], [ARM + 36, 1120], [ARM + 32, palmY + 30], [ARM - 32, palmY + 30]], 121, 2.4, 40), RED);
      paper(x, cutPath([[ARM - 48, palmY + 46], [ARM + 50, palmY + 46], [ARM + 54, palmY - 18], [ARM - 50, palmY - 18]], 123, 2, 30), RED);
      x.save(); x.strokeStyle = rgba(RED); x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = 22;
      for (let i = 0; i < 4; i++) {
        const kx = ARM - 36 + i * 24, ky = palmY - 14, up = [kx + (i - 1.5) * 6, ky - 70 + Math.abs(i - 1.5) * 8], curl = [kx - 26, WY - 6];
        const mid = [lerp(kx + (i - 1.5) * 3, kx + 4, g), lerp(ky - 36, WY - 28, g)], tip = [lerp(up[0], curl[0], g), lerp(up[1], curl[1], g)];
        x.beginPath(); x.moveTo(kx, ky); x.lineTo(mid[0], mid[1]); x.lineTo(tip[0], tip[1]); x.stroke();
      }
      x.lineWidth = 24; x.beginPath(); x.moveTo(ARM + 44, palmY + 20); x.lineTo(lerp(ARM + 78, ARM + 56, g), lerp(palmY - 30, WY + 4, g)); x.stroke();
      x.restore();
      T(x, "useLiveEvents", ARM + 70, 470, { font: MONO(30), alpha: prog(b, AT.b.grip[1], AT.b.grip[1] + 0.1) });
      T(x, tr("ch05.same"), ARM - 56, 344, { font: LABEL(30), align: "right", maxW: 560, alpha: prog(b, AT.b.grip[1] + 0.05, AT.b.grip[1] + 0.15) });
    }
    // 计数格：重放的电报按到达顺序落上去，左上角编号。
    for (let i = 0; i < 3; i++) {
      const t = TILES[i], k = E.outExpo(prog(b, AT.b.arm + 0.3 + i * 0.06, AT.b.arm + 0.45 + i * 0.06));
      if (k <= 0) continue;
      const lit = b >= AT.b.replay[i];
      x.save(); x.translate((1 - k) * 500, 0);
      paper(x, cutRect(1540, t.y, 340, 80, 130 + i, 1.4), INK);
      T(x, t.name, 1566, t.y + 51, { font: i === 0 ? UI(30) : MONO(30), col: CARD, alpha: lit ? 1 : 0.4 });
      if (lit) {
        const kl = pop(b, AT.b.replay[i], 0.1);
        group(x, clamp(kl), () => {
          if (i === 0) T(x, "3", 1850, t.y + 60, { font: UI(52, 800), align: "right", css: G.css("live") });
          else if (i === 1) { x.strokeStyle = rgba(CARD); x.lineWidth = 4; x.strokeRect(1800, t.y + 24, 50, 34); x.fillStyle = rgba(CARD); x.fillRect(1800, t.y + 24, 50, 8); }
          else tri(x, [[1812, t.y + 22], [1848, t.y + 40], [1812, t.y + 58]], CARD, { sh: 0, seed: 141 });
        });
        x.save(); x.translate(1540, t.y); x.scale(kl, kl);
        paper(x, disc(0, 0, 24, 150 + i, 1.2), RED);
        T(x, String(i + 1), 0, 11, { font: UI(30, 800), align: "center", col: CARD });
        x.restore();
      }
      x.restore();
    }
    for (let i = 0; i < 3; i++) { const s = teleState(b, i); if (s && s.fly) slip(x, s.x, s.y, 196, 46, TELE[i], { rot: s.rot, s: s.s, seed: 100 + i }); }
    T(x, tr("ch05.order"), 1540, 862, { font: LABEL(30), maxW: 360, alpha: prog(b, AT.b.replay[0], AT.b.replay[0] + 0.12) });
  }

  // ---- 机位 C：主角到站，写进 SWR，卡片翻面 ----
  const H = AT.c.hero;
  function cPulses(b, out) { if (b >= H - 0.02 && b < H + 0.2) out.push({ x: FX.c + 960, w: 190, h: 140 * (1 - prog(b, H + 0.04, H + 0.2)), dir: 1 }); }
  function cBack(x, b) {
    group(x, on(b, 7.5), () => {
      paper(x, cutRect(800, 90, 320, 210, 201, 2), INK);
      T(x, "LivePushRoom", 960, 205, { font: MONO(30), align: "center", col: CARD });
      paper(x, cutRect(954, 296, 12, WY - 300, 203, 0.6), INK, { sh: 0 });
      paper(x, cutRect(1250, 470, 550, 230, 205, 2), MUSTARD);
      const bump = 10 * Math.sin(Math.PI * prog(b, AT.c.file, AT.c.file + 0.1));
      paper(x, cutRect(1280, 520 + bump, 490, 160, 207, 1.6), MUSTARD_D, { sh: 0.12 });
      paper(x, cutRect(1305, 552 + bump, 440, 50, 209, 1), INK, { sh: 0 });
      T(x, "/api/status/listening/now", 1525, 587 + bump, { font: MONO(28), align: "center", col: CARD });
      x.fillStyle = rgba(INK); x.beginPath(); x.arc(1525, 645 + bump, 11, 0, TAU); x.fill();
      T(x, "SWR", 1252, 452, { font: MONO(34, 700) });
      T(x, tr("ch05.origin"), 70, 350, { font: LABEL(30) });
      T(x, tr("ch05.browser"), 70, 462, { font: LABEL(30) });
      tri(x, [[42, 352], [58, 352], [50, 334]], INK, { sh: 0, seed: 211 });
      tri(x, [[42, 436], [58, 436], [50, 454]], INK, { sh: 0, seed: 213 });
    });
  }
  function cFront(x, b) {
    if (!on(b, 7.5)) return;
    // 广播：房间底下一圈圈红弧往线上扩。
    for (let i = 0; i < 3; i++) {
      const k = prog(b, AT.c.arcs + i * 0.07, AT.c.arcs + i * 0.07 + 0.22);
      if (k <= 0 || k >= 1) continue;
      group(x, 1 - k, () => { x.strokeStyle = rgba(RED); x.lineWidth = 12; x.lineCap = "butt"; x.beginPath(); x.arc(960, 300, 40 + 120 * k, 0.18 * Math.PI, 0.82 * Math.PI); x.stroke(); });
    }
    if (b >= H - 0.15) {
      const y = b < H ? lerp(300, WY, E.in(prog(b, H - 0.15, H))) : lerp(WY, 600, E.outBack(prog(b, H, H + 0.14)));
      const s = b < H ? lerp(0.45, 1, prog(b, H - 0.15, H)) : 1;
      const open = prog(b, AT.c.open - 0.125, AT.c.open), sl = prog(b, AT.c.open, AT.c.open + 0.15), gone = prog(b, AT.c.file - 0.175, AT.c.file);
      envelope(x, 960, y, 250, RED, { open, s, slip: gone > 0 ? 0 : sl, label: "listening-now", a: 1 - prog(b, AT.c.flip, AT.c.flip + 0.2), rot: b < H ? 0 : 0.04 * Math.sin((b - H) * 9) * (1 - prog(b, H, H + 0.3)) });
      if (gone > 0 && gone < 1) {
        const k = E.io(gone);
        x.save(); x.translate(lerp(960, 1525, k), lerp(473, 560, k)); x.scale(lerp(1, 0.6, k), lerp(1, 0.6, k));
        paper(x, cutRect(-105, -66, 210, 133, 9, 1.2), CARD, { sh: 0.12 });
        T(x, "listening-now", 0, -20, { font: MONO(28), align: "center", maxW: 196 });
        x.restore();
      }
    }
    T(x, "mutate(path, data, {revalidate:false})", 1200, 768, { font: MONO(28), reveal: prog(b, AT.c.file, AT.c.file + 0.25), perChar: true });
    // Now Playing 卡：纵向压扁再弹开，夜に駆ける → アイドル。
    const F0 = AT.c.flip, s = b < F0 || b >= F0 + 0.15 ? 1 : Math.abs(Math.cos(Math.PI * prog(b, F0, F0 + 0.15))), after = b >= F0 + 0.075;
    x.save(); x.translate(490, 635); x.scale(1, Math.max(0.02, s)); x.translate(-490, -635);
    paper(x, cutRect(220, 470, 540, 330, 221, 2), INK);
    T(x, "Now Playing", 250, 518, { font: UI(30), col: CARD });
    paper(x, disc(320, 640, 62, 223), MUSTARD, { sh: 0 });
    x.strokeStyle = rgba(INK, 0.55); x.lineWidth = 3; x.beginPath(); x.arc(320, 640, 46, 0, TAU); x.stroke();
    paper(x, disc(320, 640, 18, 225, 0.8), RED, { sh: 0 });
    T(x, after ? "アイドル" : "夜に駆ける", 410, 646, { font: SONG(52), col: CARD });
    T(x, "YOASOBI", 410, 696, { font: UI(32, 500), col: CARD, alpha: 0.75 });
    x.fillStyle = rgba(CARD, 0.3); x.fillRect(250, 752, 480, 6);
    x.fillStyle = rgba(CARD); x.fillRect(250, 752, 480 * (after ? 0.08 : 0.72), 6);
    x.restore();
  }

  // ---- 机位 D：慢回来的旧轮询撞上闸门 ----
  function dBack(x, b) {
    group(x, on(b, 10.5), () => {
      paper(x, cutRect(690, 110, 680, 80, 301, 1.8), INK);
      T(x, "GET /api/status/listening/now", 1030, 162, { font: MONO(32), align: "center", col: CARD });
      x.strokeStyle = rgba(INK); x.lineWidth = 6; x.setLineDash([16, 12]);
      x.beginPath(); x.moveTo(1000, 192); x.lineTo(1000, 552); x.stroke(); x.setLineDash([]);
    });
  }
  function dFront(x, b) {
    if (!on(b, 10.5)) return;
    paper(x, cutRect(760, 640, 480, 160, 311, 1.8), INK);
    T(x, "アイドル", 790, 704, { font: SONG(40), col: CARD });
    T(x, "receivedAt", 790, 768, { font: MONO(28), col: CARD });
    clock(x, 1100, 752, 26, { h: 0.3 * TAU, m: 0.72 * TAU, rim: CARD, face: INK, ink: CARD, seed: 313 });
    pill(x, 1180, 640, tr("ch05.newer"), LABEL(28), RED, CARD);
    // 闸杆：红白斜纹，横在新卡上面
    const dip = 0.035 * impact(b, AT.d.hit, 0.12);
    x.save(); x.translate(1270, 570); x.rotate(dip); x.translate(-1270, -570);
    const boom = cutRect(760, 555, 500, 30, 321, 1.4);
    paper(x, boom, CARD);
    x.save(); x.clip(boom); x.fillStyle = rgba(RED);
    for (let sx = 740; sx < 1280; sx += 70) { x.beginPath(); x.moveTo(sx, 590); x.lineTo(sx + 36, 590); x.lineTo(sx + 66, 550); x.lineTo(sx + 30, 550); x.closePath(); x.fill(); }
    x.restore(); x.restore();
    paper(x, cutRect(1250, 545, 40, 255, 323, 1.4), INK);
    paper(x, cutRect(1290, 548, 50, 44, 325, 1), INK);
    paper(x, cutRect(1300, 612, 236, 48, 327, 1.2), INK);
    T(x, "guardPolled", 1418, 645, { font: MONO(30), align: "center", col: CARD });
    T(x, tr("ch05.gate"), 1300, 712, { font: LABEL(30), maxW: 590 });
    // 旧的：一步一步爬下来，12:0 撞上闸杆弹开
    const [c0, c1] = AT.d.crawl;
    if (b < c0 - 0.1) return;
    const k = prog(b, c0, c1), u = k * 5, n = Math.min(4, Math.floor(u)), st = (n + E.io(clamp(u - n))) / 5, hb = prog(b, AT.d.hit, AT.d.hit + 0.22);
    let cy = lerp(262, 493, st), rot = 0, cx = 1000 + 5 * Math.sin(b * 31) * (1 - k);
    if (b >= AT.d.hit) { cy = 493 - 64 * Math.sin(Math.PI * Math.min(1, hb * 1.1)) * (1 - 0.3 * hb) - 40 * E.out(hb); rot = 0.14 * E.out(hb); cx = 1000 + 30 * E.out(hb); }
    const a = prog(b, c0 - 0.1, c0) * (b >= AT.d.hit ? 1 - 0.35 * hb : 1);
    x.save(); x.translate(cx, cy); x.rotate(rot);
    group(x, a, () => {
      const p = cutRect(-160, -62, 320, 124, 331, 1.6);
      paper(x, p, CARD);
      x.strokeStyle = rgba(INK); x.lineWidth = 3; x.stroke(p);
      T(x, "夜に駆ける", -136, -8, { font: SONG(40) });
      T(x, "receivedAt", -136, 44, { font: MONO(28) });
      clock(x, 112, 30, 24, { h: 0.25 * TAU, m: 0.02 * TAU, seed: 333 });
      pill(x, 112, -62, tr("ch05.older"), LABEL(28), INK, CARD);
    });
    const kx = pop(b, AT.d.hit, 0.1);
    if (kx > 0) {
      x.scale(lerp(1.6, 1, kx), lerp(1.6, 1, kx));
      for (const sg of [-1, 1]) { x.save(); x.rotate(sg * 0.62); paper(x, cutRect(-150, -16, 300, 32, 341 + sg, 1.6), RED); x.restore(); }
    }
    x.restore();
  }

  // ---- 机位 E：线上没消息，进度在本地外推 ----
  const LYR = [[440, 690, 120], [574, 690, 80], [668, 690, 150], [832, 690, 100], [440, 735, 140], [594, 735, 70], [678, 735, 160]];
  // 响指的手：从右下角伸进来；每个响指拍上中指弹进掌心、拇指往上一顶，捏合处迸三道红光。
  function snapHand(x, b) {
    const k = E.outBack(prog(b, 13.05, 13.25));
    if (k <= 0) return;
    let s = 0;
    for (const t of AT.e.snaps) if (b >= t && b < t + 0.12) s = Math.max(s, 1 - prog(b, t + 0.05, t + 0.12));
    x.save(); x.translate(1800 + (1 - k) * 320, 1000 + (1 - k) * 260); x.rotate(-0.28); x.scale(0.88, 0.88);
    x.fillStyle = rgba(INK); x.strokeStyle = rgba(INK); x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = 30;
    x.fill(cutPath([[-58, 0], [58, 0], [74, 440], [-74, 440]], 401, 2, 40));
    x.fill(cutPath([[-66, 12], [60, 18], [70, -96], [-50, -112]], 403, 2, 30));
    for (const [cx, cy, r] of [[28, -110, 24], [56, -90, 21]]) { x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); }
    x.beginPath(); x.moveTo(22, -108); x.lineTo(30, -200); x.lineTo(26, -258); x.stroke();
    const tip = [lerp(-112, -124, s), lerp(-150, -176, s)];
    x.beginPath(); x.moveTo(-52, -40); x.lineTo(-100, -100); x.lineTo(tip[0], tip[1]); x.stroke();
    x.beginPath(); x.moveTo(-10, -108); x.lineTo(lerp(-44, -18, s), lerp(-184, -150, s)); x.lineTo(lerp(-98, -26, s), lerp(-166, -72, s)); x.stroke();
    if (s > 0.25) for (let i = 0; i < 3; i++) {
      const ang = -2.75 + i * 0.5, r0 = 30, r1 = 30 + 64 * s, cx = -112, cy = -184;
      tri(x, [[cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0], [cx + Math.cos(ang + 0.13) * r1, cy + Math.sin(ang + 0.13) * r1], [cx + Math.cos(ang - 0.13) * r1, cy + Math.sin(ang - 0.13) * r1]], RED, { sh: 0, seed: 411 + i });
    }
    x.restore();
  }
  function eFront(x, b) {
    if (!on(b, 13.0)) return;
    T(x, disp(tr("ch05.quiet")), 170, 300, { font: DISPLAY(en() ? 60 : 76), maxW: 1000, reveal: prog(b, 13.05, 13.3), perChar: true });
    paper(x, cutRect(160, 420, 790, 56, 421, 1.6), INK);
    T(x, "positionMs + (now − observedAt)", 182, 460, { font: MONO(36), col: CARD });
    const cw = K.measure(x, "0", MONO(36));
    x.fillStyle = rgba(RED); x.fillRect(182 + 14 * cw, 468, 3 * cw, 5);
    x.fillStyle = rgba(MUSTARD); x.fillRect(182 + 20 * cw, 468, 10 * cw, 5);
    tri(x, [[980, 428], [980, 462], [1008, 445]], INK, { sh: 0, seed: 423 });
    T(x, tr("ch05.onlyPlaying"), 1020, 456, { font: LABEL(30), maxW: 400 });
    paper(x, cutRect(160, 500, 1080, 350, 425, 2), INK);
    paper(x, disc(300, 650, 104, 427), MUSTARD, { sh: 0 });
    x.strokeStyle = rgba(INK, 0.45); x.lineWidth = 3;
    for (const r of [84, 66]) { x.beginPath(); x.arc(300, 650, r, 0, TAU); x.stroke(); }
    paper(x, disc(300, 650, 32, 429, 0.8), RED, { sh: 0 });
    x.fillStyle = rgba(CARD); x.save(); x.translate(300, 650); x.rotate((b - 13) * TAU * 0.5); x.fillRect(-4, -30, 8, 14); x.restore();
    x.beginPath(); x.arc(300, 650, 6, 0, TAU); x.fill();
    T(x, "アイドル", 440, 604, { font: SONG(64), col: CARD });
    T(x, "YOASOBI", 440, 650, { font: UI(32, 500), col: CARD, alpha: 0.75 });
    T(x, tr("ch05.lyrics"), 1210, 604, { font: LABEL(28), align: "right", col: CARD, alpha: 0.7 });
    LYR.forEach(([lx, ly, lw], i) => {
      const t = AT.e.lyrics + i * 0.25, lit = b >= t, cur = lit && b < t + 0.25;
      paper(x, cutRect(lx, ly - 14, lw, 22, 431 + i, 1), cur ? MUSTARD : CARD, { sh: 0, a: lit ? 1 : 0.22 });
    });
    const pk = 0.32 + 0.3 * prog(b, 13.0, 15.5);
    x.fillStyle = rgba(CARD, 0.3); x.fillRect(440, 800, 740, 8);
    x.fillStyle = rgba(MUSTARD); x.fillRect(440, 800, 740 * pk, 8);
    x.fillStyle = rgba(CARD); x.beginPath(); x.arc(440 + 740 * pk, 804, 12, 0, TAU); x.fill();
    clock(x, 1470, 200, 96, { rim: MUSTARD, h: 0.31 * TAU, m: 0.66 * TAU, seed: 441 });
    T(x, tr("ch05.macClock"), 1470, 350, { font: LABEL(28), align: "center", maxW: 520 });
    const tick = Math.floor(clamp((b - 13.0) * 4, 0, 10));
    clock(x, 1470, 640, 96, { rim: RED, h: 0.62 * TAU, m: (0.1 + tick / 60) * TAU, seed: 443 });
    T(x, tr("ch05.browserClock"), 1470, 790, { font: LABEL(28), align: "center", maxW: 520 });
    snapHand(x, b);
  }

  // ---- 机位 F：首帧用源站的钟，挂载后用访客的钟，走到截止就自己翻成离线 ----
  function fFront(x, b) {
    if (!on(b, 15.5)) return;
    clock(x, 420, 200, 100, { face: INK, ink: CARD, rim: INK, h: 0.08 * TAU, m: 0.58 * TAU, seed: 501 });
    T(x, tr("ch05.firstFrame"), 560, 212, { font: LABEL(30), maxW: 560 });
    const hk = prog(b, AT.f.hand, AT.f.hand + 0.2);
    if (hk > 0) {
      x.save(); x.strokeStyle = rgba(RED); x.lineWidth = 6; x.setLineDash([14, 10]);
      x.beginPath(); x.moveTo(420, 318); x.lineTo(420, lerp(318, 512, hk)); x.stroke(); x.restore();
      if (hk >= 1) tri(x, [[404, 506], [436, 506], [420, 530]], RED, { sh: 0, seed: 503 });
    }
    const [t0] = AT.f.tick, steps = b < t0 ? 0 : Math.min(5, Math.floor((b - t0) * 4 + 1e-6) + 1);
    const dead = 0.45 * TAU, va = prog(b, AT.f.hand + 0.1, AT.f.hand + 0.25);
    clock(x, 420, 640, 100, { a: va, h: 0.12 * TAU, m: dead - (5 - steps) * 0.07 * TAU, wedge: [dead, dead + 0.2 * TAU], seed: 505 });
    group(x, va, () => {
      T(x, tr("ch05.afterMount"), 560, 600, { font: LABEL(30), maxW: 520 });
      T(x, tr("ch05.deadline"), 560, 690, { font: LABEL(30), col: RED });
      T(x, "lastSeenAt + heartbeatWindowMs", 560, 736, { font: MONO(28), maxW: 540 });
    });
    // Mac 卡：在线点掉下去，换成 Offline；源站这边一声不吭。
    paper(x, cutRect(1140, 470, 660, 290, 511, 2), INK);
    T(x, "Mac", 1180, 548, { font: UI(48, 800), col: CARD });
    const off = b >= AT.f.off, fk = prog(b, AT.f.off, AT.f.off + 0.45);
    T(x, off ? "Offline" : "Online", 1240, 662, { font: UI(40), col: CARD, alpha: off ? 0.6 : 1 });
    T(x, "lastSeenAt", 1180, 726, { font: MONO(28), col: CARD, alpha: 0.7 });
    const dy = off ? 520 * fk * fk - 40 * Math.sin(Math.PI * Math.min(1, fk * 3)) : 0;
    paper(x, disc(1206 - (off ? 50 * fk : 0), 648 + dy, 18, 513, 1), RED);
    group(x, prog(b, AT.f.off + 0.05, AT.f.off + 0.2), () => {
      paper(x, cutPath([[1180, 110], [1430, 110], [1430, 230], [1250, 230], [1215, 268], [1222, 230], [1180, 230]], 521, 1.8, 36), INK);
      T(x, "……", 1305, 190, { font: UI(56, 800), align: "center", col: CARD });
      T(x, tr("ch05.silent"), 1460, 186, { font: LABEL(30), maxW: 420 });
    });
  }

  // ---- 机位 G：同一根线数两种人 ----
  const WINS = [380, 860, 1340], ROOM_X = 280;
  const arriveAt = (wx) => AT.g.bcast + 0.08 + (Math.abs(wx - ROOM_X) / 1100) * 0.18;
  function gPulses(b, out) {
    const T0 = AT.g.tab;
    if (b >= T0 && b < T0 + 0.4) out.push({ x: FX.g + lerp(860, ROOM_X, E.io(prog(b, T0, T0 + 0.35))), w: 56, h: 40 * (1 - prog(b, T0 + 0.33, T0 + 0.4)), dir: -1 });
    if (b >= AT.g.bcast && b < AT.g.bcast + 0.4) for (const wx of WINS) {
      const k = prog(b, AT.g.bcast, arriveAt(wx));
      if (k < 1) out.push({ x: FX.g + lerp(ROOM_X, wx, k), w: 50, h: 36, dir: 1 });
    }
  }
  function gBack(x, b) {
    group(x, on(b, 18.5), () => {
      paper(x, cutRect(120, 110, 320, 200, 601, 1.8), INK);
      T(x, "LivePushRoom", ROOM_X, 220, { font: MONO(28), align: "center", col: CARD });
      paper(x, cutRect(ROOM_X - 6, 306, 12, WY - 312, 603, 0.6), INK, { sh: 0 });
      for (const wx of WINS) paper(x, cutRect(wx - 5, WY, 10, 132, 605 + wx, 0.6), INK, { sh: 0 });
    });
  }
  function gFront(x, b) {
    if (!on(b, 18.5)) return;
    const B0 = AT.g.bcast, T0 = AT.g.tab, tabK = E.outExpo(prog(b, T0 - 0.05, T0 + 0.06));
    paper(x, cutRect(980, 40, 860, 312, 611, 2), MUSTARD);
    T(x, disp(tr("ch05.census")), 1012, 124, { font: DISPLAY(en() ? 52 : 70), maxW: 560 });
    T(x, "/count", 1810, 98, { font: MONO(28), align: "right" });
    [[0, "connections", "ch05.conn", "03", false], [1, "online", "ch05.onl", b >= B0 ? "02" : "03", true]].forEach(([r, key, label, val, live]) => {
      const y = 200 + r * 82;
      T(x, key, 1012, y, { font: MONO(30, 700) });
      T(x, tr(label), 1012, y + 34, { font: LABEL(28), alpha: 0.8, maxW: 560 });
      paper(x, cutRect(1640, y - 46, 160, 74, 621 + r, 1.2), INK, { sh: 0 });
      const kk = live && b >= B0 ? pop(b, B0, 0.1) : 1;
      x.save(); x.translate(1720, y - 9); x.scale(kk, kk);
      T(x, val, 0, 22, { font: UI(56, 800), align: "center", ...(live ? { css: G.css("live") } : { col: CARD }) });
      x.restore();
    });
    WINS.forEach((wx, i) => {
      const x0 = wx - 190;
      paper(x, cutRect(x0, 520, 380, 250, 631 + i, 1.8), CARD);
      x.strokeStyle = rgba(INK); x.lineWidth = 4; x.strokeRect(x0 + 2, 522, 376, 246);
      x.fillStyle = rgba(INK); x.fillRect(x0, 520, 380, 36);
      x.fillStyle = rgba(CARD); for (let d = 0; d < 3; d++) { x.beginPath(); x.arc(x0 + 22 + d * 22, 538, 6, 0, TAU); x.fill(); }
      x.fillStyle = rgba(INK, 0.16); x.fillRect(x0 + 24, 576, 210, 16); x.fillRect(x0 + 24, 604, 300, 12); x.fillRect(x0 + 24, 626, 250, 12);
      x.fillStyle = rgba(INK); x.fillRect(x0, 716, 380, 54);
      if (i === 1 && tabK > 0) {
        paper(x, cutRect(x0 + 6 + (1 - tabK) * 368, 560, 368 * tabK, 152, 641, 1.2), MUSTARD, { sh: 0 });
        if (tabK > 0.9) T(x, tr("ch05.tab"), wx, 646, { font: LABEL(28), align: "center", maxW: 340, alpha: prog(tabK, 0.9, 1) });
      }
      const arrive = arriveAt(wx), kk = b >= arrive ? pop(b, arrive, 0.08) : 1;
      T(x, "Online now", x0 + 20, 753, { font: UI(28), col: CARD });
      x.save(); x.translate(x0 + 352, 744); x.scale(kk, kk);
      T(x, b >= arrive ? "2" : "3", 0, 12, { font: UI(36, 800), align: "right", css: G.css("live") });
      x.restore();
    });
    // hidden：中间那扇窗往上发一下，沿线跑回房间
    if (b >= T0 && b < T0 + 0.4) slip(x, lerp(860, ROOM_X, E.io(prog(b, T0, T0 + 0.35))), WY - 72, 130, 44, "hidden", { col: RED, a: 1 - prog(b, T0 + 0.33, T0 + 0.4), seed: 651 });
    T(x, tr("ch05.stay"), 884, 486, { font: LABEL(28), maxW: 420, alpha: prog(b, T0 + 0.05, T0 + 0.15) });
  }

  // ---- 机位 H1：可滞后卡的到期表 ----
  const ROWS = [["server", "ch05.cad1"], ["github-chart", "ch05.cad2"], ["activity", "ch05.cad3"]];
  function h1Front(x, b) {
    if (!on(b, 21.0)) return;
    T(x, disp(tr("ch05.eta")), 120, 210, { font: DISPLAY(en() ? 56 : 72), maxW: 600, reveal: prog(b, 21.05, 21.3), perChar: true });
    T(x, "nextLagDelay", 124, 280, { font: MONO(30) });
    paper(x, cutRect(760, 160, 1040, 62, 701, 1.6), INK);
    T(x, "due = updatedAt + cadenceMs + LAG_GRACE_MS", 782, 203, { font: MONO(32), col: CARD, maxW: 1000 });
    T(x, "LAG_GRACE_MS = 15 s", 782, 280, { font: MONO(30) });
    group(x, prog(b, AT.h1.rows[0], AT.h1.rows[0] + 0.15), () => {
      T(x, "updatedAt", 780, 438, { font: MONO(28), align: "center" });
      T(x, "+ cadenceMs", 1080, 438, { font: MONO(28), align: "center" });
      T(x, "+ 15 s", 1470, 438, { font: MONO(28), align: "center" });
      T(x, "due", 1560, 438, { font: MONO(28, 700), align: "center", col: RED });
    });
    ROWS.forEach(([name, cad], i) => {
      const t = AT.h1.rows[i], k = E.outExpo(prog(b, t, t + 0.14));
      if (k <= 0) return;
      const y = 462 + i * 112, ty = y + 45, p = cutRect(120, y, 1680, 90, 711 + i, 1.6);
      x.save(); x.translate((1 - k) * 900, 0);
      paper(x, p, CARD);
      x.strokeStyle = rgba(INK); x.lineWidth = 3; x.stroke(p);
      T(x, name, 146, y + 56, { font: MONO(30, 700) });
      T(x, tr(cad), 400, y + 56, { font: LABEL(30), maxW: 300 });
      x.fillStyle = rgba(INK); x.fillRect(760, ty - 3, 1000, 6);
      paper(x, cutRect(762, ty - 20, 36, 40, 721 + i, 1), INK, { sh: 0 });
      x.fillStyle = rgba(CARD); x.fillRect(1368, ty - 16, 28, 32);
      x.strokeStyle = rgba(INK); x.lineWidth = 5; x.strokeRect(1366, ty - 18, 32, 36);
      tri(x, [[1540, ty - 26], [1580, ty - 26], [1560, ty + 4]], RED, { sh: 0, seed: 731 + i });
      // 退避：重试的间隔一次比一次长，时刻落在十六分音符上，和配乐的边击对齐。
      if (i === 2) [[1604, 0], [1632, 0.0625], [1676, 0.1875], [1740, 0.375]].forEach(([rx, dt], j) => {
        const kk = prog(b, AT.h1.retry + dt, AT.h1.retry + dt + 0.05);
        if (kk > 0) paper(x, cutRect(rx - 4, ty - 22 * kk, 8, 44 * kk, 741 + j, 0.5), RED, { sh: 0 });
      });
      x.restore();
    });
    T(x, tr("ch05.backoff"), 124, 836, { font: LABEL(28), maxW: 1660, reveal: prog(b, AT.h1.retry, AT.h1.retry + 0.3), perChar: true });
  }

  // ---- 机位 H2：推送连着时的兜底轮询 ----
  const CHIPS = ["listening", "watching", "watching-now", "playing", "playing-now", "trophies"];
  function h2Pulses(b, out) { const P = AT.h2.push; if (b >= P - 0.2 && b < P + 0.25) out.push({ x: FX.h2 + lerp(2000, -100, prog(b, P - 0.2, P + 0.25)), w: 70, h: 48, dir: 1 }); }
  function h2Front(x, b) {
    if (!on(b, 23.75)) return;
    T(x, "/ws", 1700, 350, { font: MONO(30) });
    paper(x, cutRect(120, 440, 1020, 410, 801, 2), MUSTARD);
    T(x, disp(tr("ch05.net")), 152, 522, { font: DISPLAY(en() ? 52 : 64), maxW: 900 });
    T(x, "max(cardMs, PUSH_SAFETY_NET_MS)", 154, 584, { font: MONO(32) });
    CHIPS.forEach((c, i) => {
      const k = pop(b, AT.h2.chips + i * 0.0625, 0.1);
      if (k <= 0) return;
      x.save(); x.translate(290 + (i % 3) * 300, 660 + Math.floor(i / 3) * 70); x.scale(k, k); pill(x, 0, 0, c, MONO(28), INK, CARD); x.restore();
    });
    T(x, tr("ch05.others"), 154, 818, { font: LABEL(28), maxW: 950, alpha: prog(b, AT.h2.chips + 0.4, AT.h2.chips + 0.55) });
    const ks = prog(b, AT.h2.stamp - 0.04, AT.h2.stamp + 0.08);
    if (ks > 0) {
      const s = lerp(2.2, 1, E.outExpo(ks)), pts = [];
      for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, r = i % 2 ? 150 : 176; pts.push([Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.82]); }
      x.save(); x.translate(1470, 640); x.rotate(-0.12); x.scale(s, s);
      group(x, clamp(ks * 3), () => {
        paper(x, cutPath(pts, 811, 2, 60), RED);
        T(x, tr("ch05.five"), 0, 30, { font: en() ? UI(84, 800) : DISPLAY(88), align: "center", col: CARD, maxW: 300 });
      });
      x.restore();
    }
  }

  // ---- 收尾：Clawd 骑着剪刀把线上的脉冲一个个剪掉，线拉平 ----
  // 剪的那一下，脉冲落在刀刃上离转轴 CUT 远的地方。
  const ECHO = [[17700, 1], [18000, 1], [18250, -1], [18550, 1]], CUT = 150;
  const scissorsX = (b) => { const S = AT.out.snips; return keys(b, [[26.45, 16800], [S[0], ECHO[0][0] - CUT, E.out], [S[1], ECHO[1][0] - CUT], [S[2], ECHO[2][0] - CUT], [S[3], ECHO[3][0] - CUT], [AT.out.exit, 21400, E.in]]); };
  function outPulses(b, out) {
    ECHO.forEach(([px, dir], i) => { const k = pop(b, AT.out.pops[i], 0.1); if (k > 0 && b < AT.out.snips[i]) out.push({ x: px, w: 76, h: 58 * k, dir }); });
  }
  function scissors(x, sx, sy, open) {
    for (const s of [-1, 1]) {
      x.save(); x.translate(sx, sy); x.rotate(s * open * 0.42);
      paper(x, cutPath([[0, -11], [270, s * 2 - 3], [270, s * 2 + 3], [0, 11]], 911 + s, 1, 40), INK);
      paper(x, cutPath([[0, -12], [-100, -20], [-100, 20], [0, 12]], 913 + s, 1, 30), INK);
      x.lineWidth = 16; x.strokeStyle = rgba(RED); x.beginPath(); x.ellipse(-152, s * 8, 56, 34, 0, 0, TAU); x.stroke();
      x.restore();
    }
    x.fillStyle = rgba(CARD); x.beginPath(); x.arc(sx, sy, 9, 0, TAU); x.fill();
  }
  function outFront(x, b) {
    if (b < 25.7) return;
    const S = AT.out.snips;
    ECHO.forEach(([px, dir], i) => {
      if (b < S[i]) return;
      const dt = (b - S[i]) * BARs;
      if (dt > 2.5) return;
      x.save(); x.translate(px + 40 * dt, dir > 0 ? 30 + 900 * dt * dt : -30 - 260 * dt + 900 * dt * dt); x.rotate(dir * 2.2 * dt);
      tri(x, [[-38, -dir * 22], [38, -dir * 22], [0, dir * 36]], INK, { seed: 901 + i });
      x.restore();
    });
    if (b < 26.45 || b > AT.out.exit + 0.05) return;
    const sx = scissorsX(b);
    let open = 0.55, snap = false;
    for (const t of S) { const d = b - t; if (d > -0.12 && d < 0.1) { open = Math.min(open, d < 0 ? 0.55 * (-d / 0.12) : 0.55 * (d / 0.1)); if (d >= 0 && d < 0.06) snap = true; } }
    const idx = S.findIndex((t) => b < t + 0.12), sy = ECHO[idx < 0 ? 3 : idx][1] > 0 ? WIRE_H / 2 : -WIRE_H / 2;
    scissors(x, sx, sy, open);
    clawd(x, sx - 34, Math.min(sy, 0) - WIRE_H / 2 - 4, 8, { headset: true, pose: snap ? "arms-up" : "default" });
  }

  // ---- 开场：片头海报是一张剪纸，从右边滑进来盖住第 04 章的报纸 ----
  // u 是相对本章 0:0 的小节，第 04 章末尾传负值（经 share.wipe）。朱红、芥末黄两条先走一步，米白纸面压在最上面；
  // 纸面的左沿在 u = −0.2 前已出左缘，所以剪切点两边都是同一张纸、同一个位置，只是 outExpo 接着减速。
  const WIPE = { u0: -0.5, u1: 0.5, off: 2400, margin: 400, lead: [0.07, 0.035], tilt: 0.15 };
  const sheetOff = (u, lead = 0) => WIPE.off * (1 - E.outExpo(prog(u + lead, WIPE.u0, WIPE.u1)));
  function sheetEdge(u, lead, seed) {
    const e = sheetOff(u, lead) - WIPE.margin, d = 540 * WIPE.tilt;
    return cutPath([[e - d, -60], [2200, -60], [2200, 1140], [e + d, 1140]], seed, 3, 60);
  }
  function wipe(x, u) {
    if (u < WIPE.u0 - WIPE.lead[0] || u >= 0) return;
    paper(x, sheetEdge(u, WIPE.lead[0], 71), RED, { sh: 0.22, dx: -10, dy: 6 });
    paper(x, sheetEdge(u, WIPE.lead[1], 73), MUSTARD, { sh: 0.22, dx: -10, dy: 6 });
    paper(x, sheetEdge(u, 0, 75), GROUND, { sh: 0.26, dx: -12, dy: 6 });
    x.save(); x.clip(sheetEdge(u, 0, 75));
    x.translate(sheetOff(u), 0); openFront(x, u);
    x.restore();
  }

  // ---- 镜头 ----
  const LZ = Math.log;
  const CAM = [
    [1.25, [960, 150, 0]],
    [1.75, [970, 150, LZ(1.012)], E.lin],
    [2.0, [2880, 150, 0], E.io],
    [7.25, [2925, 158, LZ(1.035)], E.lin],
    [7.5, [4800, 150, 0], E.io],
    [10.25, [4812, 150, LZ(1.02)], E.lin],
    [10.5, [6720, 150, 0], E.io],
    [12.75, [6730, 150, LZ(1.02)], E.lin],
    [13.0, [8640, 150, 0], E.io],
    [15.25, [8650, 150, LZ(1.02)], E.lin],
    [15.5, [10560, 150, 0], E.io],
    [18.25, [10570, 150, LZ(1.02)], E.lin],
    [18.5, [12480, 150, 0], E.io],
    [20.75, [12490, 150, LZ(1.02)], E.lin],
    [21.0, [14400, 150, 0], E.io],
    [23.5, [14412, 150, LZ(1.022)], E.lin],
    [23.75, [16320, 150, 0], E.io],
    [25.75, [16330, 150, LZ(1.02)], E.lin],
    [26.0, [17950, 30, LZ(0.92)], E.io],
    [27.4, [18450, 20, LZ(0.97)], E.lin],
    // 末帧：缩放 1、线在屏幕 y 540、左右都出画，接第 06 章心电图的基线。
    [27.92, [19600, 0, 0], E.io],
  ];
  function camAt(b) {
    if (b < 1.25) return [960 - sheetOff(b), 150, 1, 0];
    const c = keys(b, CAM);
    return [c[0], c[1], Math.exp(c[2]), 0];
  }
  function viewOf(cam) {
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot), xs = [], ys = [];
    for (const [sx, sy] of [[0, 0], [1920, 0], [0, 1080], [1920, 1080]]) {
      const dx = (sx - 960) / cam.zoom, dy = (sy - 540) / cam.zoom;
      xs.push(cam.x + c * dx + s * dy); ys.push(cam.y - s * dx + c * dy);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  const SCENES = [
    { fx: FX.open, front: openFront },
    { fx: FX.ab, back: abBack, front: abFront, pulses: abPulses },
    { fx: FX.c, back: cBack, front: cFront, pulses: cPulses },
    { fx: FX.d, back: dBack, front: dFront },
    { fx: FX.e, front: eFront },
    { fx: FX.f, front: fFront },
    { fx: FX.g, back: gBack, front: gFront, pulses: gPulses },
    { fx: FX.h1, front: h1Front },
    { fx: FX.h2, front: h2Front, pulses: h2Pulses },
    { fx: FX.out, front: outFront, pulses: outPulses, world: true, w: 4200 },
  ];
  function drawScene(x, sc, fn, b) {
    if (!fn) return;
    x.save(); if (!sc.world) x.translate(sc.fx, -WY);
    fn(x, b);
    x.restore();
  }

  function narration(x, b) {
    for (const [key, s, s2, end] of NAR) {
      const a = win(b, s - 0.02, s + 0.1, end - 0.15, end);
      if (a <= 0) continue;
      K.text(x, tr(`ch05.${key}a`), 110, 944, { font: NARR(60), color: rgba(INK), reveal: prog(b, s, s + 0.6), dim: 0.14, perChar: true, alpha: a, maxW: 1040, narration: true });
      K.text(x, tr(`ch05.${key}b`), 110, 1024, { font: NARR(60), color: rgba(INK), reveal: prog(b, s2, s2 + 0.75), dim: 0.14, perChar: true, alpha: a, maxW: 1040, narration: true });
    }
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
    const hitS = Math.max(impact(b, AT.b.arm, 0.1) * 0.5, impact(b, AT.c.hero, 0.12) * 0.8, impact(b, AT.d.hit, 0.1) * 0.9, impact(b, AT.h2.stamp, 0.1), ...AT.out.snips.map((t) => impact(b, t, 0.06) * 0.3));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.012 * hitS), rot: c[3] };
    G.setCam(cam);
    const kp = prog(b, 26.1, 27.6);
    G.clear(kp > 0 ? toLin(GROUND.map((v, i) => lerp(v, PAPER06[i], kp))) : GROUND_LIN);
    const x = bg.begin(); bg.cam(cam);
    const v = viewOf(cam), live = SCENES.filter((sc) => sc.fx + (sc.w || 2200) > v.x0 && sc.fx - 300 < v.x1), pulses = [];
    for (const sc of live) { drawScene(x, sc, sc.back, b); if (sc.pulses) sc.pulses(b, pulses); }
    wire(x, b, v, pulses);
    for (const sc of live) drawScene(x, sc, sc.front, b);
    const tp = top.begin();
    narration(tp, b);
    G.composite(bg.upload(), { mode: G.MODE.normal });
    G.composite(top.upload(), { mode: G.MODE.normal });
    // 开场和收尾没有字，才给一点胶片颗粒：开场接第 04 章末帧的颗粒和暗角，收尾接第 06 章首帧的。
    const sh = hitS * 5, k0 = prog(b, 0, 0.9), k1 = prog(b, 26.05, 26.5);
    f.post = {
      bloom: 0, threshold: 1.2, halation: 0, ca: 0,
      grain: lerp(lerp(0.035, 0, k0), 0.035, k1), vignette: lerp(lerp(0.22, 0.12, k0), 0.24, k1),
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
    };
  }

  window.CHAPTERS.push({
    id: "ch05", title: "ch.05", bars: 28,
    share: { wipe },
    async init() {
      bg = G.layer("bg"); top = G.layer("top");
      await Promise.all([
        document.fonts.load('200px "ZCOOL QingKe HuangYou"', "电报线数人头"),
        document.fonts.load('700 40px "Noto Sans SC ch05"', "电报线アイドル"),
        ...[500, 600, 800].map((w) => document.fonts.load(`${w} 40px Jost`, "Ag05")),
      ]);
    },
    render,
  });
})();
