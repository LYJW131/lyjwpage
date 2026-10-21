(() => {
  const { E, prog, keys, clamp, lerp, text, measure, hash } = K;
  I18N.add({
    "ch03.chapter": ["第 03 章", "CHAPTER 03"],
    "ch03.title": ["一间屋子的账房", "A One-Room Ledger Office"],
    "ch03.only": ["全站只有这一个实例", "one instance for the whole site"],
    "ch03.n1a": ["StateHub 是唯一的状态 DO，", "StateHub is the single state DO;"],
    "ch03.n1b": ["实时层全在它的 SQLite 里。", "all realtime state sits in SQLite."],
    "ch03.n2a": ["经 Service Binding 调 StateCore，", "Ingress calls StateCore via binding;"],
    "ch03.n2b": ["再串进 StateHub，逐封落账。", "StateHub commits them one by one."],
    "ch03.n3a": ["StateHub 自己不发网络请求，", "StateHub makes no network calls;"],
    "ch03.n3b": ["只交回一张效果单：要做的事。", "it hands back a list of effects."],
    "ch03.n4a": ["StateCore 用 waitUntil 照单办，", "StateCore runs them in waitUntil:"],
    "ch03.n4b": ["网络请求不占 StateHub 的时间。", "network I/O never blocks StateHub."],
    "ch03.n5a": ["心跳只续存活、记 pulse 观测，", "A heartbeat logs liveness and pulse;"],
    "ch03.n5b": ["平常效果单是空的，下游什么都不做。", "normally its effect list is empty."],
    "ch03.n6a": ["只有上线、下线才广播 presence，", "Presence is pushed only on flips,"],
    "ch03.n6b": ["并通知 site Worker 让首屏标签过期。", "and the site Worker expires tags."],
    "ch03.n7a": ["只有实时层在 DO 里，变了就推送；", "Only the realtime DO pushes changes;"],
    "ch03.n7b": ["其余在 KV 和 D1，不推送，按需读取。", "KV and D1 just wait to be read."],
    "ch03.ingress": ["上报入口", "Ingress"],
    "ch03.core": ["RPC 入口 · 照单去办", "RPC entry · runs the list"],
    "ch03.queue": ["一条队，逐封落账", "one queue, one at a time"],
    "ch03.ledger": ["StateHub 账本", "StateHub ledger"],
    "ch03.hb": ["存活 + pulse 观测", "liveness + pulse"],
    "ch03.flip": ["在线 → 离线", "online → offline"],
    "ch03.noCalls": ["本屋不打电话", "No calls from this room"],
    "ch03.fx": ["要做的事", "To do"],
    "ch03.fxEmpty": ["（空）", "(empty)"],
    "ch03.fxListen": ["广播 listening-now", "push listening-now"],
    "ch03.fxListenSub": ["用落账前补好的封面和链接", "cover & link filled before commit"],
    "ch03.fxNoTags": ["换歌不失效；开始或停止放歌才有", "none: only start or stop invalidates"],
    "ch03.fxNone": ["不推送 · 不失效首屏", "no push · no invalidation"],
    "ch03.fxPresence": ["广播 presence", "push presence"],
    "ch03.fxTags": ["失效页头、在听、充电头", "expire header, listening, charger"],
    "ch03.fxTagsSub": ["→ site Worker，5 秒超时", "→ site Worker, 5 s timeout"],
    "ch03.meanwhile": ["与此同时，门外……", "Meanwhile, outside…"],
    "ch03.receipt": ["回执 → 入口", "Receipt → ingress"],
    "ch03.parallel": ["和广播同时出发", "leaves alongside the push"],
    "ch03.r202": ["写完 LAG（和凭据）才回 202", "LAG (and creds) written, then 202"],
    "ch03.tower": ["另一个单例 DO", "another single-instance DO"],
    "ch03.pages": ["所有开着的页面", "Every open page"],
    "ch03.still": ["账房照常落账", "The ledger keeps committing"],
    "ch03.clawd": ["记一笔就好，\n别吵醒大家。", "Just jot it down,\ndon't wake anyone."],
    "ch03.stores": ["四个库", "Four stores"],
    "ch03.lg.rt": ["实时", "Realtime"],
    "ch03.lg.rtP": ["会推送", "pushes"],
    "ch03.lg.rtW": ["StateHub（DO，SQLite）", "StateHub (DO, SQLite)"],
    "ch03.lg.lag": ["可滞后", "Lag-tolerant"],
    "ch03.lg.lagP": ["不推送", "no push"],
    "ch03.lg.lagW": ["KV LAG + updatedAt", "KV LAG + updatedAt"],
    "ch03.lg.d1": ["历史", "History"],
    "ch03.lg.d1P": ["长期保存", "long-term"],
    "ch03.lg.cred": ["凭据", "Credentials"],
    "ch03.lg.credP": ["不公开", "private"],
    "ch03.pulse7a": ["pulse 时间线在屋里只放 7 天，", "The pulse timeline stays 7 days,"],
    "ch03.pulse7b": ["每 5 分钟归档进 D1", "archived to D1 every 5 min"],
    "ch03.mast": ["lyjw.me 日报", "The lyjw.me Daily"],
    "ch03.extra": ["号外", "EXTRA!"],
    "ch03.page3": ["第 03 版", "PAGE 3"],
    "ch03.head1": ["StateHub 只记账，", "StateHub Keeps the Books,"],
    "ch03.head2": ["StateCore 去跑腿", "StateCore Runs the Errands"],
    "ch03.seeP4": ["详见第 04 版", "Continued on page 4"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let BARs = 20 / 9;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const pop = (b, t0, d = 0.14) => (b < t0 ? 0 : E.outBack(prog(b, t0, t0 + d)));
  const life = (b, t0, t1, d = 0.14) => (b < t0 || b > t1 ? 0 : Math.min(pop(b, t0, d), E.out(1 - prog(b, t1 - 0.1, t1))));
  // 橡皮管动画的律动：每拍落下（sqz 在拍上为 1），拍与拍之间弹起（bnc 在半拍为 1）。
  const bnc = (b, ph = 0) => Math.abs(Math.sin(Math.PI * (b * 4 + ph)));
  const sqz = (b, ph = 0) => Math.pow(1 - bnc(b, ph), 4);
  const arcK = (k) => Math.sin(Math.PI * clamp(k));
  const blinkAt = (b, s) => { const p = (((b * 0.9 + s * 0.618) % 2.6) + 2.6) % 2.6; return p < 0.05 ? 1 - Math.abs(p - 0.025) / 0.025 : 0; };

  // 微微泛黄的黑白片：五级灰加一笔手工上色的橙（灯光、主角帽带、心、烛火、Clawd）。
  const C = {
    film: [238, 232, 216], paper2: [247, 243, 232], light: [207, 200, 185], mid: [152, 145, 133], dark: [90, 84, 76],
    ink: [24, 21, 18], card: [12, 11, 10], cream: [244, 238, 224], tint: [215, 119, 87],
  };
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const lin = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const EN = () => I18N.lang === "en";
  const SERIF = (px, w = 700) => `${w} ${px}px "Noto Serif SC ch03", "Noto Serif SC", serif`;
  // Ch03 Marquee 是 Limelight 的子集：OFL 保留了 Limelight 这个名字，切过的字体改了名。
  const SHOW = (px) => (EN() ? `${Math.round(px * 0.8)}px "Ch03 Marquee", "Noto Serif SC ch03", serif` : `${px}px "ZCOOL XiaoWei", "Noto Serif SC ch03", serif`);
  const DECO = (px) => `${px}px "Ch03 Marquee", "Noto Serif SC ch03", serif`;
  const MONO = (px, w = 500) => `${w} ${px}px "Geist Mono", ui-monospace, monospace`;

  // 时间表（小节）：music/ch03.js 抄了同一张表给音效和剧情音落拍，改一边另一边跟上。
  const AT = {
    irisOut: 1.75, irisIn: 2.0,
    hop: 8.0, hero: 8.5, slip: 9.0, fly: 10.5, landed: 10.75, mean: 11.0, outside: 12.0,
    ding: 12.0, stamp: 12.25, ok202: 13.35, switch1: 12.75, rings1: 13.0, agents: 13.5,
    hb: 15.5, empty: 16.0, toss: 16.75, clawd: 16.3, pres: 18.5, slip2: 18.75, fly2: 19.05, wake: 19.25,
    switch2: 19.5, rings2: 19.6, phone: 19.75, hang: 20.75,
    lagUp: 21.5, d1Up: 22.0, credUp: 22.5, foot: 23.25, spin: 24.25, bam: 25.0, dive: 25.6, end: 25.97,
  };
  const NARR = [["n1", 2.6, 5.0], ["n2", 5.15, 8.0], ["n3", 8.8, 10.95], ["n4", 12.25, 15.2], ["n5", 15.5, 18.25], ["n6", 18.5, 21.2], ["n7", 21.5, 24.25]];

  const GROUND = 900, FRONT = 1250, GAP = 128, KDOOR = -100;
  const BOOK = [1480, 714], LAMP = [1418, 566], HEAD = [880, 642];
  const COTS = [[170, 13.15, 19.8], [300, 13.3, 19.95], [430, 13.45, 20.1], [560, 13.6, 20.25]];
  const Lz = Math.log;
  const L0 = [LAMP[0], LAMP[1] + 290 / 1.4, Lz(1.4)];
  const A = [1400, 640, 0], H1 = [1300, 683, Lz(1.2)], B1 = [500, 640, 0], A2 = [1300, 660, Lz(1.08)], B2 = [560, 620, 0], C3 = [1950, 500, Lz(0.6)];
  const nudge = (v, dx, dz) => [v[0] + dx, v[1], v[2] + dz];
  // 卡片挡着的那一小节里换机位：11.45–11.5 镜头从账房跳到门外，画面上看不到这一跳。
  const CAM = [
    [0, L0], [2.3, L0, E.lin], [2.85, A, E.io], [7.7, nudge(A, 6, 0.02), E.lin], [8.0, H1, E.io],
    [11.45, nudge(H1, 6, 0.02), E.lin], [11.5, B1, E.lin], [14.75, nudge(B1, 6, 0.015), E.lin], [15.0, A2, E.io],
    [19.3, nudge(A2, -6, 0.02), E.lin], [19.5, B2, E.io], [21.0, nudge(B2, 4, 0.015), E.lin], [21.4, C3, E.io], [24.25, nudge(C3, 8, 0.02), E.lin],
  ];
  const camAt = (b) => { const c = keys(b, CAM); return [c[0], c[1], Math.exp(c[2])]; };

  const Q = [
    { t: 5.0, src: "mac", what: "desktop", hat: "bowler" },
    { t: 5.5, src: "homepod", what: "nowPlaying", hat: "cap" },
    { t: 6.0, src: "emby", what: "watching", hat: "top" },
    { t: 6.5, src: "mac", what: "chargingDevices", hat: "bowler" },
    { t: 7.0, src: "playstation", what: "playing", hat: "beanie" },
    { t: 7.5, src: "iphone", what: "activity", hat: "cap" },
    { t: AT.hero, src: "mac", what: "appleMusic", hat: "hero", hero: true },
  ];
  const SOLO = [
    { t: AT.agents, from: 11.0, src: "agents", hat: "hard" },
    { t: AT.hb, from: 13.8, src: "mac", hat: "none", heart: true },
    { t: AT.pres, from: 16.6, src: "mac", hat: "night", candle: true },
  ];
  const COMMITS = [...Q.map((q) => q.t), ...SOLO.map((q) => q.t)];

  const P = () => new Path2D();
  function rr(p, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
    return p;
  }
  function out(x, p, fill, lw = 5) {
    if (fill) { x.fillStyle = Array.isArray(fill) ? rgba(fill) : fill; x.fill(p); }
    if (lw > 0) { x.lineWidth = lw; x.strokeStyle = rgba(C.ink); x.lineJoin = "round"; x.lineCap = "round"; x.stroke(p); }
  }
  // 几块拼成一个外形时先粗描再填色，只留外轮廓。
  function blob(x, paths, fill, lw = 5) {
    x.lineWidth = lw * 2; x.strokeStyle = rgba(C.ink); x.lineJoin = "round";
    for (const p of paths) x.stroke(p);
    x.fillStyle = rgba(fill);
    for (const p of paths) x.fill(p);
  }
  function hose(x, a, c, e, w = 6, col = C.ink) {
    x.beginPath(); x.moveTo(a[0], a[1]); x.quadraticCurveTo(c[0], c[1], e[0], e[1]);
    x.lineWidth = w; x.lineCap = "round"; x.strokeStyle = rgba(col); x.stroke();
  }
  function seg(x, x1, y1, x2, y2, w = 3, col = C.ink, a = 1) {
    x.save(); x.globalAlpha *= a; x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2);
    x.lineWidth = w; x.lineCap = "round"; x.strokeStyle = rgba(col); x.stroke(); x.restore();
  }
  function pieEye(x, cx, cy, w, h, o = {}) {
    const bl = o.blink ?? 0, lx = o.look ?? 0;
    x.save(); x.translate(cx, cy);
    if (bl > 0.7) {
      x.beginPath(); x.moveTo(-w * 0.6, 0); x.quadraticCurveTo(0, h * 0.28, w * 0.6, 0);
      x.lineWidth = Math.max(2, w * 0.24); x.lineCap = "round"; x.strokeStyle = rgba(C.ink); x.stroke();
      x.restore(); return;
    }
    const hh = h * (1 - bl), ox = lx * w * 0.14;
    x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(ox, 0, w / 2, hh / 2, 0, 0, TAU); x.fill();
    const r = Math.min(w, hh) * 0.42, px = ox + w * 0.06, py = -hh * 0.14;
    x.fillStyle = rgba(C.paper2); x.beginPath(); x.moveTo(px, py); x.arc(px, py, r, -2.6, -1.1); x.closePath(); x.fill();
    x.restore();
  }
  function glove(x, gx, gy, s = 1, ang = 0) {
    x.save(); x.translate(gx, gy); x.rotate(ang); x.scale(s, s);
    const parts = [P(), P(), P(), P(), P(), P()];
    parts[0].ellipse(0, 0, 13, 12, 0, 0, TAU);
    parts[1].ellipse(-8, -12, 5, 8, -0.15, 0, TAU);
    parts[2].ellipse(0, -15, 5, 8.5, 0, 0, TAU);
    parts[3].ellipse(8, -12, 5, 8, 0.15, 0, TAU);
    parts[4].ellipse(-14, -1, 5, 7, -0.9, 0, TAU);
    rr(parts[5], -11, 9, 22, 9, 4);
    blob(x, parts, C.paper2, 3.5);
    x.lineWidth = 1.6; x.strokeStyle = rgba(C.ink, 0.8); x.lineCap = "round";
    for (const dx of [-4, 0, 4]) { x.beginPath(); x.moveTo(dx, -1); x.lineTo(dx, 5); x.stroke(); }
    x.beginPath(); x.moveTo(-10, 12.5); x.lineTo(10, 12.5); x.stroke();
    x.restore();
  }
  const aim = (from, to) => Math.atan2(to[0] - from[0], -(to[1] - from[1]));
  function arm(x, sh, ctl, hand, w = 5, s = 0.62) { hose(x, sh, ctl, hand, w); glove(x, hand[0], hand[1], s, aim(ctl, hand)); }
  function shoe(x, sx, sy, dir = 1, s = 1, tilt = 0) {
    x.save(); x.translate(sx, sy); x.scale(dir * s, s); x.rotate(tilt);
    x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(7, -7, 16, 8.5, 0, 0, TAU); x.fill();
    x.fillStyle = rgba(C.paper2, 0.85); x.beginPath(); x.ellipse(12, -10.5, 4.5, 2, -0.25, 0, TAU); x.fill();
    x.restore();
  }
  function heartShape(x, cx, cy, r) {
    const p = P();
    p.moveTo(cx, cy + r * 0.9);
    p.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.7, cy - r * 1.3, cx, cy - r * 0.45);
    p.bezierCurveTo(cx + r * 0.7, cy - r * 1.3, cx + r * 1.6, cy - r * 0.2, cx, cy + r * 0.9);
    p.closePath();
    out(x, p, C.tint, 3);
  }
  function zee(x, cx, cy, s, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.beginPath(); x.moveTo(cx - s, cy - s); x.lineTo(cx + s, cy - s); x.lineTo(cx - s, cy + s); x.lineTo(cx + s, cy + s);
    x.lineWidth = Math.max(2, s * 0.32); x.strokeStyle = rgba(C.ink); x.lineJoin = "round"; x.lineCap = "round"; x.stroke(); x.restore();
  }
  function glowDot(g, cx, cy, r, a) {
    if (a <= 0.003) return;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(255,200,150,${a})`); gr.addColorStop(0.3, `rgba(235,135,90,${0.5 * a})`); gr.addColorStop(1, "rgba(230,110,70,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  }
  function puff(x, cx, cy, r, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a;
    const ps = [[0, 0, 1], [-0.7, 0.25, 0.7], [0.7, 0.2, 0.72], [0, -0.55, 0.62]].map(([dx, dy, k]) => { const p = P(); p.arc(cx + dx * r, cy + dy * r, r * k, 0, TAU); return p; });
    blob(x, ps, C.paper2, 2.5);
    x.restore();
  }

  function hat(x, kind, b, seed) {
    if (!kind || kind === "none") return;
    x.save(); x.rotate(0.07 * Math.sin(Math.PI * (b * 4 + seed)));
    if (kind === "bowler") {
      const d = P(); d.moveTo(-25, -3); d.bezierCurveTo(-27, -44, 27, -44, 25, -3); d.closePath(); out(x, d, C.ink, 3);
      const br = P(); br.ellipse(0, -2, 40, 6.5, 0, 0, TAU); out(x, br, C.ink, 3);
      seg(x, -14, -24, -7, -32, 2.5, C.mid, 0.8);
    } else if (kind === "cap") {
      const d = P(); d.moveTo(-30, -2); d.bezierCurveTo(-30, -26, 10, -30, 28, -10); d.lineTo(30, -2); d.closePath(); out(x, d, C.mid, 4);
      const v = P(); v.ellipse(30, -3, 18, 5, 0.1, 0, TAU); out(x, v, C.dark, 4);
      x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(-4, -24, 3.5, 0, TAU); x.fill();
    } else if (kind === "top" || kind === "hero") {
      const cr = P(); cr.moveTo(-21, -4); cr.lineTo(-24, -58); cr.quadraticCurveTo(0, -63, 24, -58); cr.lineTo(21, -4); cr.closePath(); out(x, cr, C.ink, 3);
      x.fillStyle = rgba(kind === "hero" ? C.tint : C.dark);
      x.beginPath(); x.moveTo(-21.5, -10); x.lineTo(-22.4, -22); x.lineTo(22.4, -22); x.lineTo(21.5, -10); x.closePath(); x.fill();
      const br = P(); br.ellipse(0, -3, 40, 6.5, 0, 0, TAU); out(x, br, C.ink, 3);
    } else if (kind === "beanie") {
      const d = P(); d.moveTo(-28, -2); d.bezierCurveTo(-28, -36, 28, -36, 28, -2); d.closePath(); out(x, d, C.dark, 4);
      for (const dx of [-14, 0, 14]) seg(x, dx, -4, dx * 0.8, -26, 2, C.mid);
      seg(x, 0, -28, 0, -40, 3);
      const w = Math.abs(24 * Math.cos(b * TAU * 2.5)) + 2, bl = P(); bl.ellipse(0, -41, w, 4.5, 0, 0, TAU); out(x, bl, C.light, 2.5);
      x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(0, -41, 3, 0, TAU); x.fill();
    } else if (kind === "hard") {
      const d = P(); d.moveTo(-30, -4); d.bezierCurveTo(-30, -40, 30, -40, 30, -4); d.closePath(); out(x, d, C.light, 4);
      seg(x, 0, -6, 0, -31, 4);
      const br = P(); br.ellipse(0, -3, 38, 6, 0, 0, TAU); out(x, br, C.light, 4);
    } else if (kind === "night") {
      const d = P(); d.moveTo(-28, -2); d.bezierCurveTo(-30, -40, 10, -54, 44, -22); d.quadraticCurveTo(14, -30, 28, -2); d.closePath();
      x.fillStyle = rgba(C.light); x.fill(d);
      x.save(); x.clip(d); x.fillStyle = rgba(C.mid);
      for (let i = -2; i < 5; i++) { x.beginPath(); x.moveTo(-30 + i * 16, 0); x.lineTo(-22 + i * 16, 0); x.lineTo(-2 + i * 16, -60); x.lineTo(-10 + i * 16, -60); x.closePath(); x.fill(); }
      x.restore();
      x.lineWidth = 4; x.strokeStyle = rgba(C.ink); x.lineJoin = "round"; x.stroke(d);
      const pm = P(); pm.arc(46, -20, 7, 0, TAU); out(x, pm, C.paper2, 3);
    }
    x.restore();
  }

  // fy 是鞋底落地的高度。
  function envToon(x, g, cx, fy, o) {
    const s = o.sc ?? 1;
    if (s <= 0.01) return;
    const W = 116, H = 80, LEG = 22, sq = o.sq ?? 0, st = o.step ?? 0, walk = o.walk ?? 0, tuck = o.tuck ?? 0, seed = o.seed ?? 0, b = o.b ?? 0;
    x.save(); x.translate(cx, fy - (o.lift ?? 0)); x.rotate(o.rot ?? 0); x.scale(s, s);
    for (const sd of [-1, 1]) {
      const hip = [sd * 22, -LEG - 2], ph = st + (sd > 0 ? Math.PI : 0);
      const ft = [sd * 25 + walk * 11 * Math.sin(ph), -walk * Math.max(0, 9 * Math.cos(ph)) - tuck * 12];
      hose(x, hip, [hip[0] + sd * 9, (hip[1] + ft[1]) / 2], ft, 6);
      shoe(x, ft[0], ft[1], sd, 0.85, tuck * 0.4 * sd);
    }
    x.save(); x.translate(0, -LEG); x.scale(1 + 0.05 * sq, 1 - 0.08 * sq);
    const up = o.armsUp ?? 0, hands = [];
    for (const sd of [-1, 1]) {
      const sw = walk * Math.sin(st + (sd > 0 ? 0 : Math.PI));
      const sh = [sd * (W / 2 - 4), -H * 0.45];
      const hand = o.candle && sd > 0 ? [W / 2 + 18, -H * 0.62] : [sd * (W / 2 + 16 + 4 * up), lerp(-H * 0.16 + 7 * sw, -H - 16, up)];
      const ctl = [sd * (W / 2 + 14), lerp(-H * 0.42 + 6, -H * 0.6, up)];
      hose(x, sh, ctl, hand, 5);
      hands.push([hand, ctl]);
    }
    const body = rr(P(), -W / 2, -H, W, H, 9);
    out(x, body, C.paper2, 5.5);
    x.lineWidth = 3; x.strokeStyle = rgba(C.dark); x.lineJoin = "round";
    x.beginPath(); x.moveTo(-W / 2 + 7, -H + 6); x.lineTo(0, -H * 0.5); x.lineTo(W / 2 - 7, -H + 6); x.stroke();
    const bl = o.closed ? 1 : blinkAt(b, seed);
    pieEye(x, -17, -H * 0.31, 13, 19, { blink: bl, look: o.look ?? 0.5 });
    pieEye(x, 17, -H * 0.31, 13, 19, { blink: bl, look: o.look ?? 0.5 });
    if (o.yawn) { x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(0, -H * 0.1, 7, 9 * o.yawn + 1, 0, 0, TAU); x.fill(); }
    else { x.beginPath(); x.moveTo(-11, -H * 0.13); x.quadraticCurveTo(0, -H * 0.13 + 9, 11, -H * 0.13); x.lineWidth = 3; x.strokeStyle = rgba(C.ink); x.stroke(); }
    if (o.heart) heartShape(x, 0, -H * 0.76, 10 * (1 + 0.35 * sqz(b)));
    hands.forEach(([hand, ctl]) => glove(x, hand[0], hand[1], 0.62, aim(ctl, hand)));
    if (o.candle) {
      const [hx, hy] = hands[1][0];
      out(x, rr(P(), hx - 5, hy - 34, 10, 26, 2), C.paper2, 3);
      const fl = 1 + 0.15 * Math.sin(b * 37);
      x.fillStyle = rgba(C.tint); x.beginPath(); x.ellipse(hx, hy - 42, 4.5, 8 * fl, 0, 0, TAU); x.fill();
    }
    x.save(); x.translate(0, -H); hat(x, o.hat, b, seed); x.restore();
    x.restore();
    x.restore();
    if (g && o.hero) glowDot(g, cx + 30 * s, fy - (o.lift ?? 0) - (LEG + H + 40) * s, 60 * s, 0.55 + 0.25 * sqz(b));
    if (g && o.candle) glowDot(g, cx + (W / 2 + 18) * s, fy - (LEG + H * 0.62 + 42) * s, 70 * s, 0.6);
  }

  function sky(x, b, vx0, vx1) {
    const clouds = [[-180, 170, 1], [760, 130, 0.8], [1700, 95, 0.9], [2650, 160, 1.1], [3500, 110, 0.9]];
    for (const [cx0, cy, s] of clouds) {
      const cx = cx0 + 10 * b, bob = 3 * Math.sin(Math.PI * b * 2 + cx0);
      if (cx + 120 * s < vx0 || cx - 120 * s > vx1) continue;
      const ps = [[-50, 10, 30], [-18, -12, 38], [22, -6, 34], [52, 12, 26], [0, 16, 30]].map(([dx, dy, r]) => { const p = P(); p.arc(cx + dx * s, cy + dy * s + bob, r * s * (1 + 0.03 * sqz(b)), 0, TAU); return p; });
      blob(x, ps, C.paper2, 4);
    }
    const far = P(); far.moveTo(1600, GROUND); far.quadraticCurveTo(2100, 640, 2700, 760); far.quadraticCurveTo(3300, 600, 4400, GROUND); far.closePath();
    out(x, far, C.light, 3);
  }
  function hill(x) {
    const p = P(); p.moveTo(-320, GROUND); p.bezierCurveTo(-200, 600, 0, 522, 140, 522); p.lineTo(600, 522); p.bezierCurveTo(760, 522, 860, 640, 940, GROUND); p.closePath();
    out(x, p, C.light, 4);
  }
  function cottage(x, cx, by, b, f1, f2, i) {
    out(x, rr(P(), cx - 42, by - 62, 84, 62, 4), C.paper2, 4);
    const roof = P(); roof.moveTo(cx - 54, by - 58); roof.lineTo(cx, by - 104 - 3 * sqz(b, i * 0.25)); roof.lineTo(cx + 54, by - 58); roof.closePath(); out(x, roof, C.dark, 4);
    out(x, rr(P(), cx + 14, by - 26, 18, 26, 3), C.mid, 3);
    const wx = cx - 30, wy = by - 50, ww = 36, wh = 28;
    out(x, rr(P(), wx, wy, ww, wh, 3), C.ink, 3);
    const k1 = prog(b, f1, f1 + 0.12), k2 = prog(b, f2, f2 + 0.12);
    const stage = k2 >= 0.5 ? 2 : k1 >= 0.5 ? 1 : 0, fk = k2 > 0 && k2 < 1 ? k2 : k1 > 0 && k1 < 1 ? k1 : 1;
    const sx = Math.abs(Math.cos(Math.PI * fk));
    x.save(); x.translate(wx + ww / 2, wy + wh / 2); x.scale(Math.max(0.04, sx), 1);
    x.fillStyle = rgba(stage === 2 ? C.dark : C.paper2); x.fillRect(-14, -10, 28, 20);
    if (stage === 2) { x.fillStyle = rgba(C.paper2); x.beginPath(); x.arc(0, 0, 7, 0, TAU); x.fill(); x.fillStyle = rgba(C.dark); x.beginPath(); x.arc(3, -2, 6, 0, TAU); x.fill(); }
    else {
      x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(-3, 5, 4, 3, -0.4, 0, TAU); x.fill(); seg(x, 0.5, 4, 0.5, -7, 2);
      if (stage === 1) { x.fillStyle = rgba(C.tint); x.fillRect(5, -8, 6, 6); }
    }
    x.restore();
  }
  function tower(x, g, b) {
    const bx = 40, top = 340;
    seg(x, bx - 70, GROUND, bx - 14, top, 6); seg(x, bx + 70, GROUND, bx + 14, top, 6);
    for (let i = 0; i < 7; i++) {
      const y0 = GROUND - i * 80, y1 = y0 - 80, w0 = 70 - (56 * (GROUND - y0)) / (GROUND - top), w1 = 70 - (56 * (GROUND - y1)) / (GROUND - top);
      seg(x, bx - w0, y0, bx + w1, y1, 3); seg(x, bx + w0, y0, bx - w1, y1, 3); seg(x, bx - w1, y1, bx + w1, y1, 3);
    }
    const on = Math.max(win(b, AT.rings1 - 0.02, AT.rings1 + 0.05, 14.2, 14.6), win(b, AT.rings2 - 0.02, AT.rings2 + 0.05, 20.7, 21.0));
    const cy = top - 26 - 4 * sqz(b);
    out(x, (() => { const p = P(); p.arc(bx, cy, 26, 0, TAU); return p; })(), on > 0.5 ? C.paper2 : C.light, 5);
    pieEye(x, bx - 9, cy - 3, 8, 13, { blink: blinkAt(b, 7) });
    pieEye(x, bx + 9, cy - 3, 8, 13, { blink: blinkAt(b, 7) });
    if (on > 0.3) { x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(bx, cy + 12, 6, 4 + 3 * sqz(b), 0, 0, TAU); x.fill(); }
    seg(x, bx, cy - 26, bx, cy - 64, 4);
    x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(bx, cy - 66, 5, 0, TAU); x.fill();
    glowDot(g, bx, cy, 120, 0.9 * on);
    for (const t0 of [AT.rings1, AT.rings1 + 0.15, AT.rings1 + 0.3, AT.rings2, AT.rings2 + 0.15, AT.rings2 + 0.3]) {
      const k = prog(b, t0, t0 + 0.95);
      if (k <= 0 || k >= 1) continue;
      const r = 40 + 980 * E.out(k), a = 1 - k;
      for (const [ctx, w, col] of [[g, 14, `rgba(235,140,95,${0.55 * a})`], [x, 4, rgba(C.tint, 0.9 * a)]]) {
        ctx.beginPath(); ctx.arc(bx, cy, r, Math.PI * 1.02, Math.PI * 1.98); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
      }
    }
  }
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  function kiosk(x, b) {
    const x0 = -340, x1 = -100, y0 = 620;
    out(x, rr(P(), x0, y0, x1 - x0, GROUND - y0 + 6, 8), C.paper2, 6);
    const aw = P(); aw.moveTo(x0 - 20, y0 + 4); aw.lineTo(x0 + 10, y0 - 44); aw.lineTo(x1 - 10, y0 - 44); aw.lineTo(x1 + 20, y0 + 4); aw.closePath(); out(x, aw, C.dark, 5);
    for (let i = 0; i < 6; i++) { const sx = x0 - 20 + i * 56; const sc = P(); sc.arc(sx + 28, y0 + 4, 28, 0, Math.PI); out(x, sc, i % 2 ? C.light : C.mid, 4); }
    const wy = 712 - 6 * sqz(b, 0.5);
    out(x, (() => { const p = P(); p.arc(-220, wy, 42, 0, TAU); return p; })(), C.dark, 5);
    for (const dx of [-20, 0, 20]) seg(x, -220 + dx, wy - 38, -220 + dx, wy + 38, 3, C.light);
    out(x, rr(P(), x1 - 34, 770, 34, GROUND - 770, 3), C.ink, 4);
    const sk = win(b, AT.ok202 - 0.12, AT.ok202, AT.ok202 + 0.1, AT.ok202 + 0.25);
    if (sk > 0) { const sy = lerp(640, 690, sk); seg(x, -220, wy - 20, -220, sy, 6); out(x, rr(P(), -250, sy, 60, 20, 3), C.ink, 3); }
  }

  const HX0 = 1060, HX1 = 1900, HY0 = 360, PEAK = [1480, 150];
  function houseBack(x, b) {
    const bl = 5 * sqz(b);
    const p = P(); p.moveTo(HX0, HY0); p.quadraticCurveTo(HX0 - bl, 630, HX0, GROUND); p.lineTo(HX1, GROUND); p.quadraticCurveTo(HX1 + bl, 630, HX1, HY0); p.closePath();
    x.fillStyle = rgba(C.light); x.fill(p);
    x.save(); x.clip(p);
    x.fillStyle = rgba(C.mid, 0.4);
    for (let yy = 392, r = 0; yy < 770; yy += 42, r++) for (let xx = HX0 + 34 + (r % 2) * 21; xx < HX1; xx += 42) { x.beginPath(); x.moveTo(xx, yy - 5); x.lineTo(xx + 5, yy); x.lineTo(xx, yy + 5); x.lineTo(xx - 5, yy); x.closePath(); x.fill(); }
    x.fillStyle = rgba(C.mid); x.fillRect(HX0, 776, HX1 - HX0, GROUND - 776);
    for (let xx = HX0 + 60; xx < HX1; xx += 90) seg(x, xx, 790, xx, GROUND - 10, 2, C.dark, 0.6);
    x.restore();
    seg(x, HX0, 776, HX1, 776, 4);
    out(x, rr(P(), 1712, 470, 96, 110, 6), C.paper2, 5);
    out(x, rr(P(), 1724, 482, 72, 86, 4), C.light, 2.5);
    x.save(); x.translate(1760, 548); x.scale(0.34, 0.34); x.fillStyle = rgba(C.paper2); x.strokeStyle = rgba(C.ink); x.lineWidth = 8;
    const fr = rr(P(), -58, -80, 116, 80, 8); x.fill(fr); x.stroke(fr); pieEye(x, -17, -28, 13, 19); pieEye(x, 17, -28, 13, 19);
    x.beginPath(); x.moveTo(-11, -12); x.quadraticCurveTo(0, -2, 11, -12); x.lineWidth = 4; x.stroke();
    x.fillStyle = rgba(C.ink); x.beginPath(); x.moveTo(-30, -84); x.lineTo(-20, -112); x.lineTo(-6, -92); x.lineTo(0, -116); x.lineTo(6, -92); x.lineTo(20, -112); x.lineTo(30, -84); x.closePath(); x.fill();
    x.restore();
    const mh = P(); mh.moveTo(1812, GROUND); mh.lineTo(1812, GROUND - 20); mh.arc(1835, GROUND - 20, 23, Math.PI, 0); mh.lineTo(1858, GROUND); mh.closePath(); out(x, mh, C.ink, 3);
    const mb = blinkAt(b, 3.3) > 0.3 || ((b * 4) % 8) > 7.6;
    if (!mb) for (const dx of [-7, 7]) { x.fillStyle = rgba(C.paper2); x.beginPath(); x.ellipse(1835 + dx, GROUND - 22, 3.2, 4.5, 0, 0, TAU); x.fill(); }
    if (b > 8.6 && b < 11.2) {
      out(x, rr(P(), 1120, 452, 120, 92, 6), C.paper2, 5);
      x.save(); x.translate(1180, 500);
      const ph = P(); ph.moveTo(-12, 30); ph.lineTo(12, 30); ph.lineTo(5, 22); ph.lineTo(4, -12); ph.lineTo(-4, -12); ph.lineTo(-5, 22); ph.closePath(); out(x, ph, C.dark, 3);
      out(x, rr(P(), -10, -26, 20, 14, 5), C.dark, 3);
      out(x, rr(P(), 14, -16, 8, 26, 4), C.dark, 3);
      const wg = 3 * Math.sin(b * TAU * 2) * prog(b, 9.6, 9.7) * (1 - prog(b, 10.2, 10.3));
      seg(x, -30 + wg, -32, 30 + wg, 32, 7, C.tint); seg(x, 30 + wg, -32, -30 + wg, 32, 7, C.tint);
      x.restore();
    }
    for (const px of [1115, 1205]) {
      out(x, rr(P(), px - 5, 828, 10, GROUND - 828, 3), C.dark, 3);
      out(x, (() => { const p = P(); p.arc(px, 824, 9, 0, TAU); return p; })(), C.light, 3);
      out(x, rr(P(), px - 14, GROUND - 8, 28, 8, 3), C.dark, 3);
    }
    hose(x, [1115, 834], [1160, 870 + 4 * sqz(b)], [1205, 834], 6, C.dark);
    const bk = P(); bk.moveTo(1672, GROUND - 58); bk.lineTo(1728, GROUND - 58); bk.lineTo(1720, GROUND); bk.lineTo(1680, GROUND); bk.closePath(); out(x, bk, C.light, 4);
    for (const dx of [-14, 0, 14]) seg(x, 1700 + dx, GROUND - 52, 1700 + dx * 0.85, GROUND - 6, 2, C.dark);
  }
  function houseShell(x, b) {
    const bl = 5 * sqz(b), lift = 3 * sqz(b);
    const lw = P(); lw.moveTo(HX0 - 4, HY0); lw.quadraticCurveTo(HX0 - 4 - bl, 525, HX0 - 4, 690); lw.lineTo(HX0 + 30, 690); lw.quadraticCurveTo(HX0 + 30 - bl, 525, HX0 + 30, HY0); lw.closePath(); out(x, lw, C.mid, 5);
    out(x, rr(P(), HX0 - 12, 682, 50, 14, 3), C.dark, 4);
    const dp = P(); dp.moveTo(HX0 - 4, 696); dp.lineTo(HX0 - 40, 704); dp.lineTo(HX0 - 40, GROUND - 4); dp.lineTo(HX0 - 4, GROUND); dp.closePath(); out(x, dp, C.dark, 4);
    const rw = P(); rw.moveTo(HX1 - 30, HY0); rw.quadraticCurveTo(HX1 - 30 + bl, 630, HX1 - 30, GROUND); rw.lineTo(HX1 + 4, GROUND); rw.quadraticCurveTo(HX1 + 4 + bl, 630, HX1 + 4, HY0); rw.closePath(); out(x, rw, C.mid, 5);
    for (const [wx, w] of [[HX0 - 4, 34], [HX1 - 30, 34]]) for (let yy = HY0 + 30; yy < (wx < 1500 ? 680 : 890); yy += 36) seg(x, wx + 4, yy, wx + w - 4, yy, 2, C.dark, 0.7);
    const ch = rr(P(), 1215, 196 - lift, 60, 120, 3); out(x, ch, C.mid, 5);
    out(x, rr(P(), 1206, 184 - lift, 78, 18, 3), C.dark, 4);
    const roof = P(); roof.moveTo(HX0 - 40, HY0 + 6); roof.lineTo(PEAK[0], PEAK[1] - lift); roof.lineTo(HX1 + 40, HY0 + 6); roof.lineTo(HX1 + 10, HY0 + 26); roof.lineTo(PEAK[0], PEAK[1] + 30 - lift); roof.lineTo(HX0 - 10, HY0 + 26); roof.closePath();
    out(x, roof, C.dark, 6);
    for (let i = 1; i < 6; i++) { const k = i / 6; seg(x, lerp(HX0 - 30, PEAK[0], k), lerp(HY0 + 12, PEAK[1] + 8 - lift, k), lerp(HX1 + 30, PEAK[0], k), lerp(HY0 + 12, PEAK[1] + 8 - lift, k), 2, C.mid, 0.6); }
    const gab = P(); gab.moveTo(HX0 + 20, HY0); gab.lineTo(PEAK[0], PEAK[1] + 40 - lift); gab.lineTo(HX1 - 20, HY0); gab.closePath(); out(x, gab, C.light, 3);
    seg(x, HX0 - 40, GROUND, HX1 + 40, GROUND, 6);
    for (const tc of COMMITS) {
      const k = prog(b, tc + 0.05, tc + 0.85);
      if (k <= 0 || k >= 1) continue;
      puff(x, 1245 + 26 * Math.sin(k * 5), 176 - lift - 190 * k, 12 + 26 * k, 1 - k);
    }
  }
  function desk(x, b) {
    for (const [lx, ph] of [[1335, 0], [1605, 1]]) {
      const tap = sqz(b, ph * 1) * (ph ? 1 : 0.6);
      hose(x, [lx, 816], [lx + (ph ? 10 : -10), 860], [lx, GROUND - 6], 8);
      shoe(x, lx, GROUND, ph ? 1 : -1, 1.05, -0.3 * tap);
    }
    out(x, rr(P(), 1318, 734, 304, 88, 6), C.dark, 5);
    for (const dy of [748, 784]) { out(x, rr(P(), 1338, dy, 120, 28, 3), C.mid, 3); out(x, rr(P(), 1482, dy, 120, 28, 3), C.mid, 3); }
    for (const [kx, ky] of [[1398, 762], [1542, 762], [1398, 798], [1542, 798]]) { x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(kx, ky, 4, 0, TAU); x.fill(); }
    out(x, rr(P(), 1296, 716, 348, 20, 5), C.mid, 5);
  }
  // cx, cy 是灯罩中心，baseY 是底座落在哪。
  function lampToon(x, g, cx, cy, s, baseY, o = {}) {
    const lit = o.lit ?? 1, wink = o.wink ?? 0, bob = (o.bob ?? 1) * 4 * s * sqz(o.b ?? 0);
    const by = baseY - 12 * s;
    hose(x, [cx, by], [cx - 40 * s, (cy + by) / 2 + 20 * s], [cx, cy + 26 * s + bob], 10 * s);
    out(x, (() => { const p = P(); p.ellipse(cx, baseY - 8 * s, 48 * s, 13 * s, 0, 0, TAU); return p; })(), C.ink, 3 * s);
    glowDot(g, cx, cy + 46 * s + bob, 160 * s, 0.85 * lit);
    if (lit > 0) {
      const cone = g.createLinearGradient(0, cy + 40 * s, 0, baseY);
      cone.addColorStop(0, `rgba(240,160,110,${0.32 * lit})`); cone.addColorStop(1, "rgba(240,160,110,0)");
      g.fillStyle = cone; g.beginPath(); g.moveTo(cx - 52 * s, cy + 36 * s + bob); g.lineTo(cx + 52 * s, cy + 36 * s + bob); g.lineTo(cx + 150 * s, baseY); g.lineTo(cx - 150 * s, baseY); g.closePath(); g.fill();
    }
    const bulb = P(); bulb.arc(cx, cy + 40 * s + bob, 15 * s, 0, TAU); out(x, bulb, lit > 0.2 ? C.paper2 : C.light, 4 * s);
    const sh = P(); sh.moveTo(cx - 74 * s, cy + 32 * s + bob); sh.bezierCurveTo(cx - 70 * s, cy - 58 * s + bob, cx + 70 * s, cy - 58 * s + bob, cx + 74 * s, cy + 32 * s + bob);
    sh.quadraticCurveTo(cx, cy + 46 * s + bob, cx - 74 * s, cy + 32 * s + bob); sh.closePath();
    out(x, sh, C.paper2, 6 * s);
    seg(x, cx - 70 * s, cy + 22 * s + bob, cx + 70 * s, cy + 22 * s + bob, 5 * s, C.dark);
    pieEye(x, cx - 22 * s, cy - 6 * s + bob, 16 * s, 26 * s, { blink: o.blinkL ?? 0, look: o.look ?? 0 });
    pieEye(x, cx + 22 * s, cy - 6 * s + bob, 16 * s, 26 * s, { blink: Math.max(wink, o.blinkR ?? 0), look: o.look ?? 0 });
  }
  function ledgerToon(x, b) {
    const [sx, sy] = BOOK;
    out(x, (() => { const p = P(); p.moveTo(sx - 98, sy + 4); p.lineTo(sx + 98, sy + 4); p.lineTo(sx + 94, sy - 8); p.lineTo(sx - 94, sy - 8); p.closePath(); return p; })(), C.ink, 3);
    for (const sd of [-1, 1]) {
      const pg = P(); pg.moveTo(sx, sy); pg.quadraticCurveTo(sx + sd * 44, sy - 24, sx + sd * 90, sy - 16); pg.lineTo(sx + sd * 90, sy - 2); pg.quadraticCurveTo(sx + sd * 44, sy - 10, sx, sy + 2); pg.closePath();
      out(x, pg, C.paper2, 3.5);
    }
    const done = COMMITS.filter((t) => b >= t).length;
    for (let i = 0; i < Math.min(5, done); i++) seg(x, sx + 18 + i * 3, sy - 15 - i * 0 + i * 2, sx + 70, sy - 13 + i * 2, 1.5, C.dark, 0.7);
    for (const tc of COMMITS) {
      const k = prog(b, tc, tc + 0.18);
      if (k <= 0 || k >= 1) continue;
      const tip = [sx + 90 * Math.cos(Math.PI * k), sy - 16 - 48 * Math.sin(Math.PI * k)];
      const pg = P(); pg.moveTo(sx, sy); pg.quadraticCurveTo((sx + tip[0]) / 2, Math.min(sy, tip[1]) - 14, tip[0], tip[1]); pg.lineTo(tip[0], tip[1] + 12); pg.quadraticCurveTo((sx + tip[0]) / 2, Math.min(sy, tip[1]) - 2, sx, sy + 2); pg.closePath();
      out(x, pg, C.paper2, 3);
    }
    let wr = 0;
    for (const tc of COMMITS) wr = Math.max(wr, win(b, tc + 0.02, tc + 0.06, tc + 0.32, tc + 0.4));
    const gx = sx + 46 + wr * 14 * Math.sin(b * TAU * 9), gy = sy - 46 - 6 * bnc(b) + wr * 14;
    const q = P(); q.moveTo(gx + 2, gy + 14); q.quadraticCurveTo(gx + 30, gy - 30, gx + 46, gy - 74); q.quadraticCurveTo(gx + 20, gy - 46, gx + 2, gy + 14); q.closePath();
    out(x, q, C.paper2, 3);
    seg(x, gx + 4, gy + 10, gx + 36, gy - 54, 1.5, C.dark);
    glove(x, gx, gy, 0.62, 0.5);
    out(x, rr(P(), 1584, sy - 26, 26, 20, 5), C.ink, 2);
  }

  function porterArms(b) {
    const L = [818, 726], R = [942, 726];
    let Lc = null, Rc = null;
    const usher = Math.max(win(b, 4.6, 4.75, 7.45, 7.6), win(b, AT.agents - 1.05, AT.agents - 0.95, AT.agents - 0.72, AT.agents - 0.62));
    if (usher > 0) {
      const w = Math.sin(b * TAU * 2);
      if (b < 10) { R[0] = lerp(R[0], 1040 + 8 * w, usher); R[1] = lerp(R[1], 704 + 10 * w, usher); Rc = [990, 650]; }
      else { L[0] = lerp(L[0], 760 + 8 * w, usher); L[1] = lerp(L[1], 770 + 8 * w, usher); Lc = [790, 700]; }
    }
    const bell = Math.max(win(b, AT.ding - 0.1, AT.ding, AT.ding, AT.ding + 0.12));
    if (bell > 0) { L[0] = lerp(L[0], 805, bell); L[1] = lerp(L[1], 706 - 40 * (1 - bell), bell); }
    const stp = win(b, AT.stamp - 0.18, AT.stamp - 0.12, AT.stamp + 0.08, AT.stamp + 0.18);
    if (stp > 0) { const dn = prog(b, AT.stamp - 0.06, AT.stamp) * (1 - prog(b, AT.stamp + 0.04, AT.stamp + 0.1)); R[0] = lerp(R[0], 905, stp); R[1] = lerp(R[1], lerp(650, 714, dn), stp); }
    for (const sw of [AT.switch1, AT.switch2]) {
      const k = win(b, sw - 0.12, sw - 0.04, sw + 0.1, sw + 0.2);
      if (k > 0) { const dn = prog(b, sw - 0.04, sw); R[0] = lerp(R[0], 905, k); R[1] = lerp(R[1], lerp(800, 840, dn), k); Rc = [1000, 760]; }
    }
    const ph = win(b, AT.phone - 0.08, AT.phone, AT.hang - 0.05, AT.hang + 0.05);
    if (ph > 0) { L[0] = lerp(L[0], 838, ph); L[1] = lerp(L[1], 642, ph); Lc = [800, 700]; R[0] = lerp(R[0], 958, ph); R[1] = lerp(R[1], 700, ph); }
    return { L, R, Lc, Rc, stp, ph };
  }
  function booth(x, b) {
    out(x, rr(P(), 760, 560, 240, GROUND - 560 + 4, 10), C.light, 6);
    const wnd = rr(P(), 785, 590, 190, 150, 8);
    out(x, wnd, C.dark, 5);
    const sleep = win(b, 14.85, 15.05, AT.wake - 0.02, AT.wake + 0.02);
    const jolt = arcK(prog(b, AT.wake, AT.wake + 0.2));
    const dy = -3 * bnc(b) + 28 * sleep - 26 * jolt, tilt = 0.32 * sleep;
    x.save(); x.clip(wnd);
    x.save(); x.translate(HEAD[0], HEAD[1] + dy * 0.4);
    out(x, rr(P(), -46, 46, 92, 90, 14), C.ink, 4);
    for (const by of [64, 86, 108]) { x.fillStyle = rgba(C.paper2); x.beginPath(); x.arc(-14, by, 4, 0, TAU); x.arc(14, by, 4, 0, TAU); x.fill(); }
    const bow = P(); bow.moveTo(0, 50); bow.lineTo(-16, 40); bow.lineTo(-16, 60); bow.closePath(); bow.moveTo(0, 50); bow.lineTo(16, 40); bow.lineTo(16, 60); bow.closePath(); out(x, bow, C.paper2, 3);
    x.restore();
    x.save(); x.translate(HEAD[0], HEAD[1] + dy); x.rotate(tilt);
    out(x, (() => { const p = P(); p.ellipse(0, 0, 40, 44, 0, 0, TAU); return p; })(), C.paper2, 5);
    const eyesClosed = sleep > 0.5 && jolt < 0.1;
    const bl = eyesClosed ? 1 : blinkAt(b, 1.7);
    pieEye(x, -15, -14, jolt > 0.1 ? 15 : 12, jolt > 0.1 ? 25 : 20, { blink: bl, look: -0.2 });
    pieEye(x, 15, -14, jolt > 0.1 ? 15 : 12, jolt > 0.1 ? 25 : 20, { blink: bl, look: -0.2 });
    x.fillStyle = rgba(C.ink); x.beginPath(); x.ellipse(0, 8, 11, 8, 0, 0, TAU); x.fill();
    if (eyesClosed) { x.beginPath(); x.ellipse(2, 26, 5, 3 + 2 * Math.sin(b * TAU), 0, 0, TAU); x.fill(); }
    else { x.beginPath(); x.moveTo(-18, 22); x.quadraticCurveTo(0, 38, 18, 22); x.lineWidth = 4; x.strokeStyle = rgba(C.ink); x.stroke(); }
    seg(x, -34, -24, -26, 18, 2, C.dark); seg(x, 34, -24, 26, 18, 2, C.dark);
    x.restore();
    x.restore();
    const hatUp = 90 * arcK(prog(b, AT.wake, AT.wake + 0.32));
    x.save(); x.translate(HEAD[0] + 6, HEAD[1] + dy - 44 - hatUp); x.rotate(-0.16 + tilt + 2.2 * arcK(prog(b, AT.wake, AT.wake + 0.32)));
    out(x, rr(P(), -28, -26, 56, 30, 5), C.ink, 3);
    x.fillStyle = rgba(C.paper2); x.fillRect(-28, -6, 56, 6);
    x.fillStyle = rgba(C.paper2); x.beginPath(); x.arc(0, -30, 5, 0, TAU); x.fill();
    x.restore();
    for (let i = 0; i < 3; i++) {
      const k = ((b * 1.6 + i / 3) % 1 + 1) % 1;
      zee(x, HEAD[0] + 40 + 50 * k + 10 * Math.sin(k * 6), HEAD[1] - 30 - 90 * k, 8 + 10 * k, sleep * (1 - jolt) * Math.sin(Math.PI * k));
    }
    if (jolt > 0.05) {
      x.save(); x.globalAlpha *= jolt; x.fillStyle = rgba(C.ink);
      x.beginPath(); x.moveTo(HEAD[0] + 56, HEAD[1] - 92); x.lineTo(HEAD[0] + 72, HEAD[1] - 92); x.lineTo(HEAD[0] + 66, HEAD[1] - 48); x.lineTo(HEAD[0] + 62, HEAD[1] - 48); x.closePath(); x.fill();
      x.beginPath(); x.arc(HEAD[0] + 64, HEAD[1] - 38, 5, 0, TAU); x.fill(); x.restore();
    }
    out(x, rr(P(), 768, 736, 224, 18, 4), C.mid, 5);
    const ring = impact(b, AT.ding, 0.08) + impact(b, AT.wake, 0.08);
    x.save(); x.translate(805, 736); x.rotate(0.12 * Math.sin(b * 90) * ring);
    out(x, (() => { const p = P(); p.moveTo(-17, 0); p.bezierCurveTo(-17, -24, 17, -24, 17, 0); p.closePath(); return p; })(), C.light, 3.5);
    x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(0, -21, 3.5, 0, TAU); x.fill();
    x.restore();
    const arms = porterArms(b);
    const stampAt = arms.stp > 0 ? [arms.R[0], arms.R[1] + 12] : [842, 724];
    out(x, rr(P(), stampAt[0] - 11, stampAt[1] - 4, 22, 14, 3), C.dark, 3);
    out(x, rr(P(), stampAt[0] - 4, stampAt[1] - 24, 8, 22, 3), C.mid, 3);
    const wt = [930, 718];
    out(x, (() => { const p = P(); p.arc(wt[0], wt[1], 15, 0, TAU); return p; })(), C.paper2, 3.5);
    const tick = b >= AT.phone + 0.1 && b < AT.hang ? (b - AT.phone - 0.1) * BARs / 5 : 0;
    seg(x, wt[0], wt[1], wt[0] + 10 * Math.sin(TAU * tick), wt[1] - 10 * Math.cos(TAU * tick), 2.5);
    out(x, rr(P(), wt[0] - 4, wt[1] - 22, 8, 6, 2), C.ink, 2);
    const ph = [962, 736];
    out(x, (() => { const p = P(); p.ellipse(ph[0], ph[1] - 3, 16, 5, 0, 0, TAU); return p; })(), C.ink, 2);
    seg(x, ph[0], ph[1] - 4, ph[0], ph[1] - 58, 6);
    out(x, (() => { const p = P(); p.moveTo(ph[0] - 11, ph[1] - 74); p.lineTo(ph[0] + 11, ph[1] - 74); p.lineTo(ph[0] + 5, ph[1] - 58); p.lineTo(ph[0] - 5, ph[1] - 58); p.closePath(); return p; })(), C.dark, 3);
    const rec = arms.ph > 0.5 ? [arms.L[0] - 6, arms.L[1] - 4] : [ph[0] + 14, ph[1] - 50];
    out(x, rr(P(), rec[0] - 5, rec[1] - 18, 10, 36, 4), C.dark, 3);
    hose(x, [ph[0], ph[1] - 8], [lerp(ph[0], rec[0], 0.5), Math.max(ph[1], rec[1]) + 20], [rec[0], rec[1] + 16], 2, C.ink);
    const slipOn = (b >= AT.landed && b < 14.6) || (b >= AT.wake && b < 21.0);
    if (slipOn) {
      x.save(); x.translate(888, 734); x.rotate(-0.12);
      out(x, rr(P(), -18, -30, 36, 30, 2), C.paper2, 3);
      for (let i = 0; i < 3; i++) seg(x, -12, -22 + i * 7, 10, -22 + i * 7, 1.5, C.mid);
      if (b >= AT.stamp + 0.02 || b >= AT.switch2) { x.strokeStyle = rgba(C.tint, 0.9); x.lineWidth = 2.5; x.strokeRect(-14, -18, 26, 12); }
      x.restore();
    }
    out(x, rr(P(), 850, 806, 60, 48, 5), C.dark, 4);
    let lever = -0.9;
    for (const sw of [AT.switch1, AT.switch2]) lever = Math.max(lever, lerp(-0.9, 0.9, prog(b, sw - 0.04, sw)) * (1 - prog(b, sw + 1.6, sw + 1.9)));
    x.save(); x.translate(880, 840); x.rotate(lever); seg(x, 0, 0, 0, -36, 5); out(x, rr(P(), -12, -44, 24, 10, 4), C.light, 3); x.restore();
    const aw = P(); aw.moveTo(744, 572); aw.lineTo(770, 520); aw.lineTo(990, 520); aw.lineTo(1016, 572); aw.closePath(); out(x, aw, C.mid, 5);
    for (let i = 0; i < 6; i++) { const sc = P(); sc.arc(766 + i * 45, 572, 22.5, 0, Math.PI); out(x, sc, i % 2 ? C.light : C.dark, 4); }
    arm(x, [842, 700], arms.Lc || [808, 716], arms.L, 6, 0.7);
    arm(x, [918, 700], arms.Rc || [952, 716], arms.R, 6, 0.7);
  }

  // 橙色故意错开一点，像手工上色的胶片。
  function clawdToon(x, cx, bottom, q, o = {}) {
    const { body, eyes } = window.Clawd.cells(o.pose || "default", 0);
    const core = body.filter(([a, c]) => c < 4 && a >= 3 && a <= 15), legs = body.filter(([, c]) => c >= 4);
    const minX = Math.min(...core.map((c) => c[0])), maxX = Math.max(...core.map((c) => c[0])) + 1;
    const minY = Math.min(...core.map((c) => c[1])), maxY = Math.max(...core.map((c) => c[1])) + 1;
    const legH = 2.4 * q, top = maxY * 2 * q, sq = o.sq ?? 0;
    x.save(); x.translate(cx - 9 * q, bottom - legH - top);
    for (const [a] of legs) {
      const lx = (a + 0.5) * q, ph = (o.step ?? 0) + a * 1.3, walk = o.walk ?? 0;
      const foot = [lx + walk * 4 * Math.sin(ph), top + legH - walk * Math.max(0, 5 * Math.cos(ph))];
      hose(x, [lx, top - 2], [lx + (a < 9 ? -3 : 3), top + legH / 2], foot, Math.max(4, q * 0.55));
      shoe(x, foot[0], foot[1], a < 9 ? -1 : 1, q / 15);
    }
    x.save(); x.translate(0, top); x.scale(1 + 0.04 * sq, 1 - 0.06 * sq); x.translate(0, -top);
    const bp = rr(P(), minX * q, minY * 2 * q, (maxX - minX) * q, (maxY - minY) * 2 * q, q * 0.9);
    x.save(); x.translate(q * 0.22, -q * 0.14); x.fillStyle = rgba(C.tint); x.fill(bp); x.restore();
    x.lineWidth = Math.max(4, q * 0.6); x.strokeStyle = rgba(C.ink); x.lineJoin = "round"; x.stroke(bp);
    for (const [a, c] of eyes) pieEye(x, (a + 0.5) * q, (c + 0.5) * 2 * q, q * 1.5, q * 2.5, { blink: o.blink ?? 0, look: o.look ?? 0 });
    const vis = rr(P(), (minX - 0.3) * q, minY * 2 * q + 0.2 * q, (maxX - minX + 0.6) * q, 1.0 * q, 0.4 * q);
    out(x, vis, C.mid, Math.max(3, q * 0.4));
    x.fillStyle = rgba(C.ink, 0.28); x.fillRect(minX * q, minY * 2 * q + 1.2 * q, (maxX - minX) * q, 0.8 * q);
    x.restore();
    const shY = 5 * q;
    const hands = o.hands || [[-2.5, 1.5], [2.5, 1.5]];
    for (const [i, sd] of [[0, -1], [1, 1]]) {
      const sh = [sd < 0 ? minX * q : maxX * q, shY], h = [sh[0] + hands[i][0] * q, sh[1] + hands[i][1] * q];
      arm(x, sh, [lerp(sh[0], h[0], 0.5) + sd * q, Math.max(sh[1], h[1]) + q], h, Math.max(4, q * 0.55), q / 13);
    }
    x.restore();
  }

  function stores(x, b) {
    const rise = (t0, h) => (1 - E.outBack(prog(b, t0, t0 + 0.3))) * (h + 60);
    x.save(); x.beginPath(); x.rect(1900, -2000, 4000, GROUND + 2000); x.clip();
    const dl = rise(AT.lagUp, 340);
    if (b >= AT.lagUp) {
      x.save(); x.translate(0, dl);
      out(x, rr(P(), 2000, 560, 380, 340, 8), C.mid, 6);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const cx = 2022 + c * 89, cy = 582 + r * 78;
        out(x, rr(P(), cx, cy, 78, 66, 4), C.paper2, 3);
        x.save(); x.translate(cx + 22, cy + 24); out(x, (() => { const p = P(); p.arc(0, 0, 10, 0, TAU); return p; })(), C.light, 2);
        const a = (r * 4 + c) * 0.7 + b * 0.6; seg(x, 0, 0, 7 * Math.sin(a), -7 * Math.cos(a), 1.5); x.restore();
        for (let i = 0; i < 2; i++) seg(x, cx + 40, cy + 18 + i * 10, cx + 68, cy + 18 + i * 10, 2, C.mid);
        seg(x, cx + 10, cy + 50, cx + 68, cy + 50, 2, C.dark, 0.6);
      }
      x.restore();
    }
    const dd = rise(AT.d1Up, 430);
    if (b >= AT.d1Up) {
      x.save(); x.translate(0, dd);
      for (let u = 0; u < 7; u++) {
        const ux = 2780 + u * 230;
        out(x, rr(P(), ux, 470, 220, 430, 4), C.dark, 6);
        for (let s = 0; s < 4; s++) {
          const sy = 490 + s * 102;
          for (let k = 0; k < 4; k++) { const bx = ux + 14 + k * 50; out(x, rr(P(), bx, sy + 18, 42, 64, 3), (k + s + u) % 3 ? C.paper2 : C.light, 3); seg(x, bx + 10, sy + 40, bx + 32, sy + 40, 3, C.dark); }
          seg(x, ux + 6, sy + 84, ux + 214, sy + 84, 4);
        }
      }
      x.restore();
    }
    const dc = rise(AT.credUp, 260);
    if (b >= AT.credUp) {
      x.save(); x.translate(0, dc);
      for (const [fx, sd] of [[2510, -1], [2660, 1]]) shoe(x, fx, GROUND, sd, 1.1, -0.2 * sqz(b, sd > 0 ? 0.5 : 0));
      out(x, rr(P(), 2470, 660, 230, 228, 12), C.dark, 6);
      out(x, rr(P(), 2490, 680, 190, 188, 8), C.mid, 4);
      const dial = P(); dial.arc(2585, 760, 34, 0, TAU); out(x, dial, C.light, 4);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; seg(x, 2585 + 26 * Math.cos(a), 760 + 26 * Math.sin(a), 2585 + 31 * Math.cos(a), 760 + 31 * Math.sin(a), 2); }
      const da = b * 2.2; seg(x, 2585, 760, 2585 + 20 * Math.cos(da), 760 + 20 * Math.sin(da), 4);
      out(x, rr(P(), 2630, 820, 34, 12, 4), C.light, 3);
      for (const [rx, ry] of [[2486, 676], [2684, 676], [2486, 872], [2684, 872]]) { x.fillStyle = rgba(C.ink); x.beginPath(); x.arc(rx, ry, 4, 0, TAU); x.fill(); }
      x.restore();
    }
    x.restore();
    for (const [t0, x0, x1] of [[AT.lagUp, 2000, 2380], [AT.d1Up, 2780, 3500], [AT.credUp, 2470, 2700]]) {
      const k = prog(b, t0 + 0.28, t0 + 0.7);
      if (k <= 0 || k >= 1) continue;
      for (let i = 0; i < 5; i++) puff(x, lerp(x0, x1, i / 4), GROUND - 10 - 30 * k, 14 + 20 * k, (1 - k) * 0.9);
    }
  }

  const hopPath = (k, from, to, h) => [lerp(from[0], to[0], k), lerp(from[1], to[1], k) - h * arcK(k)];
  function envAt(q, b, j) {
    const hero = !!q.hero, h0 = hero ? AT.hop : q.t - 0.25;
    if (b >= q.t + 0.14) return null;
    let x, y = GROUND, lift = 0, sc = 1, rot = 0, walk = 0, step = 0, tuck = 0, up = 0;
    if (b < h0) {
      if (q.from != null) {
        if (b < q.from) return null;
        const k = prog(b, q.from, h0);
        x = lerp(KDOOR, FRONT, k); walk = 1; step = x / 22; lift = 8 * bnc(b);
      } else {
        let slot = j;
        for (let i = 0; i < j; i++) {
          const a = prog(b, Q[i].t - 0.25, Q[i].t - 0.05);
          slot -= E.io(a);
          lift += 18 * arcK(a);
        }
        x = FRONT - slot * GAP;
        step = x / 22;
        if (lift > 0.5) tuck = lift / 18;
      }
    } else if (b < q.t) {
      const k = prog(b, h0, q.t);
      const p = hopPath(hero ? E.io(k) : k, [FRONT, GROUND], [BOOK[0], BOOK[1] - 4], hero ? 260 : 120);
      x = p[0]; y = p[1]; sc = lerp(1, 0.6, k); tuck = 1; up = hero ? 1 : 0.6;
      if (hero) rot = TAU * E.io(prog(k, 0.15, 0.85));
    } else {
      const k = prog(b, q.t, q.t + 0.14);
      x = BOOK[0]; y = BOOK[1] - 4 + 10 * k; sc = 0.6 * (1 - k); tuck = 1;
    }
    return { x, y, lift, sc, rot, walk, step, tuck, up };
  }
  function queue(x, g, b, vx0, vx1) {
    const all = [...Q.map((q, j) => [q, j]), ...SOLO.map((q, j) => [q, 100 + j])];
    for (const [q, j] of all) {
      const s = envAt(q, b, j < 100 ? j : 0);
      if (!s || s.x < vx0 - 100 || s.x > vx1 + 100) continue;
      const night = q.hat === "night";
      envToon(x, g, s.x, s.y, {
        b, sc: s.sc, lift: s.lift, rot: s.rot, walk: s.walk * (night ? 0.6 : 1), step: s.step, tuck: s.tuck, armsUp: s.up,
        sq: s.walk ? 0 : sqz(b, j * 0.13) * (1 - s.tuck), hat: q.hat, seed: j * 1.37 + 0.4, hero: q.hero, heart: q.heart, candle: q.candle,
        closed: night && blinkAt(b * 3, 2) > 0.2, yawn: night ? arcK(prog(b, 17.6, 17.9)) : 0,
      });
    }
  }

  function slipToon(x, cx, cy, s, rot, o = {}) {
    x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
    if (o.plane) {
      const p = P(); p.moveTo(-34, 0); p.lineTo(34, -6); p.lineTo(-20, 14); p.closePath(); out(x, p, C.paper2, 3);
      seg(x, -34, 0, 10, 4, 2, C.dark);
    } else if (o.ball) {
      const p = P(); p.arc(0, 0, 16, 0, TAU); out(x, p, C.paper2, 3);
      seg(x, -8, -6, 6, 4, 2, C.mid); seg(x, -4, 8, 9, -7, 2, C.mid);
    } else {
      const p = P(); p.moveTo(-26, -34); p.lineTo(26, -34); p.lineTo(26, 30); p.quadraticCurveTo(0, 38, -26, 30); p.closePath(); out(x, p, C.paper2, 3.5);
      for (let i = 0; i < (o.empty ? 0 : 3); i++) seg(x, -16, -20 + i * 14, 16, -20 + i * 14, 2.5, C.mid);
      if (o.face) { pieEye(x, -9, o.empty ? -10 : 18, 7, 11, { blink: o.blink ?? 0 }); pieEye(x, 9, o.empty ? -10 : 18, 7, 11, { blink: o.blink ?? 0 }); }
      if (o.empty) { x.beginPath(); x.moveTo(-9, 14); x.quadraticCurveTo(0, 6, 9, 14); x.lineWidth = 2.5; x.strokeStyle = rgba(C.ink); x.stroke(); }
    }
    x.restore();
  }
  function slips(x, b) {
    const above = [BOOK[0], BOOK[1] - 70], counter = [892, 712];
    if (b >= AT.slip && b < AT.landed) {
      const k = pop(b, AT.slip, 0.2), f = prog(b, AT.fly, AT.landed);
      if (f <= 0) slipToon(x, above[0], above[1] - 10 * bnc(b), k, 0.06 * Math.sin(b * TAU), { face: true });
      else { const p = hopPath(E.io(f), above, counter, 240); slipToon(x, p[0], p[1], 1, -0.3 + 0.3 * f, { plane: true }); }
    }
    if (b >= AT.empty && b < AT.toss + 0.25) {
      const k = pop(b, AT.empty, 0.2), f = prog(b, AT.toss, AT.toss + 0.2);
      if (f <= 0) slipToon(x, above[0], above[1] + 16 * prog(b, AT.empty + 0.2, AT.toss), k, -0.25 * prog(b, AT.empty + 0.2, AT.toss), { face: true, empty: true, blink: 0 });
      else { const p = hopPath(f, above, [1700, GROUND - 40], 160); slipToon(x, p[0], p[1], 1 - 0.3 * f, f * 8, { ball: true }); }
    }
    if (b >= AT.slip2 && b < AT.wake) {
      const k = pop(b, AT.slip2, 0.2), f = prog(b, AT.fly2, AT.wake - 0.05);
      if (f <= 0) slipToon(x, above[0], above[1] - 10 * bnc(b), k, 0, { face: true });
      else { const p = hopPath(E.io(f), above, [805, 700], 220); slipToon(x, p[0], p[1], 1, -0.3 + 0.3 * f, { plane: true }); }
    }
  }
  function tube(x, g, b) {
    const y = 812, x0 = KDOOR, x1 = 760;
    for (let px = x0 + 60; px < x1; px += 230) out(x, rr(P(), px - 5, y, 10, GROUND - y, 2), C.dark, 3);
    const k = prog(b, AT.stamp, AT.stamp + 0.35);
    const bx = lerp(x1, x0, E.io(k)), on = k > 0 && k < 1;
    const p = P(); p.moveTo(x0, y - 11); p.lineTo(x1, y - 11); p.lineTo(x1, y + 11); p.lineTo(x0, y + 11); p.closePath();
    if (on) { p.moveTo(bx + 30, y); p.ellipse(bx, y, 30, 19, 0, 0, TAU); }
    blob(x, [p], C.light, 3.5);
    if (on) out(x, rr(P(), bx - 16, y - 9, 32, 18, 6), C.paper2, 2.5);
    for (const [t0, t1] of [[AT.switch1, AT.rings1], [AT.switch2, AT.rings2]]) {
      const k2 = prog(b, t0, t1);
      if (k2 <= 0 || k2 >= 1) continue;
      for (let i = 0; i < 4; i++) { const kk = clamp(k2 - i * 0.06); const px = lerp(880, 40, kk); glowDot(g, px, 906, 30, 0.8); }
    }
    seg(x, 880, 850, 880, 906, 3); seg(x, 880, 906, 40, 906, 3);
  }

  // 字都画在 top 层、按屏幕像素排：颗粒、划痕、闪烁都在它下面，挂在场景上的牌子随镜头走但字号不变。
  function deco(t, x0, y0, w, h, o = {}) {
    t.fillStyle = rgba(o.bg ?? C.card); t.fillRect(x0, y0, w, h);
    t.strokeStyle = rgba(C.cream, 0.92); t.lineWidth = o.lw ?? 2.5; t.strokeRect(x0 + 5, y0 + 5, w - 10, h - 10);
    t.lineWidth = 1; t.strokeStyle = rgba(C.cream, 0.6); t.strokeRect(x0 + 10, y0 + 10, w - 20, h - 20);
    t.fillStyle = rgba(C.cream);
    for (const [cx, cy] of [[x0 + 5, y0 + 5], [x0 + w - 5, y0 + 5], [x0 + 5, y0 + h - 5], [x0 + w - 5, y0 + h - 5]]) {
      t.beginPath(); t.moveTo(cx, cy - 6); t.lineTo(cx + 6, cy); t.lineTo(cx, cy + 6); t.lineTo(cx - 6, cy); t.closePath(); t.fill();
    }
    if (o.fans) for (const sd of [-1, 1]) {
      const cx = sd < 0 ? x0 + 22 : x0 + w - 22, cy = y0 + h / 2;
      for (let i = -2; i <= 2; i++) { const a = (sd < 0 ? 0 : Math.PI) + i * 0.32; seg(t, cx, cy, cx + 30 * Math.cos(a), cy + 30 * Math.sin(a), 1.5, C.cream, 0.7); }
    }
  }
  const pxOf = (font) => parseFloat(/([\d.]+)px/.exec(font)[1]);
  function plate(t, sx, sy, rows, k, o = {}) {
    if (k <= 0.001) return;
    const pad = o.pad ?? 18;
    for (const r of rows) { r.px = pxOf(r.font); r.w = measure(t, r.s, r.font); }
    const w = Math.max(o.minW ?? 0, ...rows.map((r) => r.w)) + pad * 2;
    const h = rows.reduce((s, r) => s + r.px * 1.42, 0) + pad * 2 - 8;
    const x0 = -w * (o.ax ?? 0.5), y0 = -h * (o.ay ?? 1);
    t.save(); t.translate(sx, sy); t.scale(k, k);
    const al = clamp(k * 2.5) * (o.alpha ?? 1);
    t.globalAlpha = al;
    deco(t, x0, y0, w, h);
    let y = y0 + pad - 4;
    for (const r of rows) {
      const ag = r.align ?? "center", tx = ag === "left" ? x0 + pad : ag === "right" ? x0 + w - pad : x0 + w / 2;
      text(t, r.s, tx, y + r.px * 1.1, { font: r.font, color: rgba(r.col ?? C.cream), align: ag, alpha: al * (r.a ?? 1) });
      y += r.px * 1.42;
    }
    t.restore();
  }
  function fxPlate(t, sx, sy, kind, k) {
    if (k <= 0.001) return;
    const w = 640, rows = [];
    const L = (kind2, main, sub, dim) => rows.push({ kind: kind2, main, sub, dim });
    if (kind === "hero") { L("event", "—", null, true); L("listening", tr("ch03.fxListen"), tr("ch03.fxListenSub")); L("tags", tr("ch03.fxNoTags"), null, true); }
    if (kind === "presence") { L("event", tr("ch03.fxPresence")); L("listening", "—", null, true); L("tags", tr("ch03.fxTags"), tr("ch03.fxTagsSub")); }
    const h = kind === "empty" ? 236 : 124 + rows.reduce((s, r) => s + 50 + (r.main !== "—" ? 44 : 0) + (r.sub ? 40 : 0), 0);
    t.save(); t.translate(sx, sy); t.scale(k, k);
    const al = clamp(k * 2.5);
    t.globalAlpha = al;
    deco(t, 0, 0, w, h);
    text(t, tr("ch03.fx"), 28, 62, { font: SERIF(38), color: rgba(C.cream), alpha: al });
    text(t, "IngestEffect", w - 28, 60, { font: MONO(28), color: rgba(C.cream, 0.75), align: "right", alpha: al });
    seg(t, 24, 84, w - 24, 84, 1.5, C.cream, 0.5 * al);
    if (kind === "empty") {
      text(t, tr("ch03.fxEmpty"), w / 2, 160, { font: SERIF(56), color: rgba(C.cream), align: "center", alpha: al });
      text(t, tr("ch03.fxNone"), w / 2, 208, { font: SERIF(30), color: rgba(C.cream, 0.8), align: "center", alpha: al });
    } else {
      let y = 96;
      for (const r of rows) {
        y += 40;
        text(t, r.kind, 30, y, { font: MONO(28), color: rgba(C.cream, 0.7), alpha: al });
        if (r.main === "—") { text(t, "—", 230, y, { font: MONO(28), color: rgba(C.cream, 0.45), alpha: al }); y += 10; continue; }
        y += 44;
        text(t, r.main, 54, y, { font: SERIF(30), color: rgba(C.cream, r.dim ? 0.62 : 1), alpha: al });
        if (r.sub) { y += 40; text(t, r.sub, 54, y, { font: SERIF(28), color: rgba(C.cream, 0.7), alpha: al }); }
        y += 10;
      }
    }
    t.restore();
  }
  function ledgerPlate(t, sx, sy, b, k) {
    if (k <= 0.001) return;
    const rows = Q.filter((q) => !q.hero), w = 450, h = 96 + rows.length * 46 + 14;
    t.save(); t.translate(sx, sy); t.scale(k, k);
    const al = clamp(k * 2.5);
    t.globalAlpha = al;
    deco(t, -w / 2, 0, w, h);
    text(t, tr("ch03.ledger"), -w / 2 + 26, 58, { font: SERIF(34), color: rgba(C.cream), alpha: al });
    text(t, "SQLite", w / 2 - 26, 56, { font: MONO(28), color: rgba(C.cream, 0.75), align: "right", alpha: al });
    seg(t, -w / 2 + 22, 78, w / 2 - 22, 78, 1.5, C.cream, 0.5 * al);
    rows.forEach((q, i) => {
      const kk = pop(b, q.t, 0.12);
      if (kk <= 0) return;
      const y = 120 + i * 46;
      text(t, `${q.src} · ${q.what}`, -w / 2 + 28, y, { font: MONO(28), color: rgba(C.cream), alpha: al * clamp(kk) });
      t.save(); t.globalAlpha = al * clamp(kk); t.beginPath(); t.moveTo(w / 2 - 54, y - 10); t.lineTo(w / 2 - 44, y); t.lineTo(w / 2 - 26, y - 22);
      t.lineWidth = 4; t.lineCap = "round"; t.lineJoin = "round"; t.strokeStyle = rgba(C.tint); t.stroke(); t.restore();
    });
    t.restore();
  }
  function storesTable(t, b) {
    const k = life(b, 21.6, 24.25, 0.16);
    if (k <= 0.001) return;
    const w = 920, x0 = 1920 - 36 - w, y0 = 30, rowsN = [["room", "rt", "rtP", "lg.rtW", 21.68], ["lag", "lag", "lagP", "lg.lagW", 21.8], ["d1", "d1", "d1P", null, 22.3], ["cred", "cred", "credP", null, 22.8]];
    const h = 84 + rowsN.length * 64 + 16;
    t.save(); t.translate(x0, y0); t.scale(k, k);
    const al = clamp(k * 2.5);
    t.globalAlpha = al;
    deco(t, 0, 0, w, h);
    text(t, tr("ch03.stores"), 30, 58, { font: SERIF(38), color: rgba(C.cream), alpha: al });
    seg(t, 24, 80, w - 24, 80, 1.5, C.cream, 0.5 * al);
    rowsN.forEach(([g, name, push, where, t0], i) => {
      const kk = clamp(pop(b, t0, 0.12));
      if (kk <= 0) return;
      const y = 84 + i * 64 + 44;
      K.glyph(t, g, 70, y - 12, rgba(C.cream), 0.36, al * kk);
      text(t, tr(`ch03.lg.${name}`), 116, y, { font: SERIF(32), color: rgba(C.cream), alpha: al * kk });
      text(t, tr(`ch03.lg.${push}`), 350, y, { font: SERIF(28), color: rgba(C.cream, 0.72), alpha: al * kk });
      const wh = where ? tr(`ch03.${where}`) : g === "d1" ? "D1 · lyjwpage-history" : "KV CREDENTIALS";
      text(t, wh, 524, y, { font: where === "lg.rtW" ? SERIF(28) : MONO(28), color: rgba(C.cream), alpha: al * kk, maxW: w - 24 - 524 });
    });
    t.restore();
  }
  function balloon(t, str, bx, by, ax, ay, k) {
    if (k <= 0.001) return;
    const lines = str.split("\n"), f = SERIF(34), w = Math.max(...lines.map((l) => measure(t, l, f))) + 52, h = lines.length * 48 + 34;
    t.save(); t.globalAlpha = clamp(k * 2.5);
    const s = lerp(0.85, 1, clamp(k));
    t.translate(bx, by); t.scale(s, s); t.translate(-bx, -by);
    t.fillStyle = rgba(C.card); t.beginPath(); t.moveTo(bx + 30, by + h); t.lineTo(ax, ay); t.lineTo(bx + 72, by + h); t.closePath(); t.fill();
    deco(t, bx, by, w, h);
    lines.forEach((l, i) => text(t, l, bx + 26, by + 58 + i * 48, { font: f, color: rgba(C.cream), alpha: clamp(k * 2.5) }));
    t.restore();
  }

  function labels(t, b, scr) {
    const P2 = (wx, wy, rows, k, o) => { const [sx, sy] = scr(wx, wy); plate(t, sx, sy, rows, k, o); };
    const ra = (lo, hi) => (b >= lo && b <= hi);
    const hubK = Math.max(life(b, 2.95, 7.8), life(b, 21.45, 24.25));
    P2(1480, 334, [{ s: "StateHub", font: DECO(40) }, { s: 'idFromName("global")', font: MONO(28) }, { s: tr("ch03.only"), font: SERIF(28) }], hubK);
    P2(1612, 650, [{ s: "SQLite", font: DECO(34) }], life(b, 3.55, 7.8));
    const coreK = Math.max(life(b, 5.3, 7.8), life(b, 12.05, 14.65), life(b, 19.55, 21.05));
    P2(880, 512, [{ s: "StateCore", font: DECO(36) }, { s: tr("ch03.core"), font: SERIF(28) }], coreK);
    P2(466, 700, [{ s: `${tr("ch03.ingress")} → StateCore`, font: SERIF(30) }, { s: "Service Binding", font: MONO(28) }], life(b, 5.6, 7.8), { ax: 0 });
    P2(1130, 675, [{ s: "ingestTail", font: MONO(30) }, { s: tr("ch03.queue"), font: SERIF(28) }], life(b, 5.9, 7.8));
    if (ra(4.8, 7.9)) { const [sx, sy] = scr(2100, 236); ledgerPlate(t, sx, sy, b, life(b, 4.85, 7.8)); }
    P2(1480, 632, [{ s: "mac · appleMusic", font: MONO(30) }], life(b, AT.hero, AT.slip - 0.05));
    if (ra(9.05, 10.5)) fxPlate(t, 1240, 64, "hero", life(b, 9.1, 10.45));
    P2(1180, 552, [{ s: tr("ch03.noCalls"), font: SERIF(32) }], life(b, 9.6, 10.9), { ay: 0 });
    P2(-160, 540, [{ s: tr("ch03.ingress"), font: SERIF(32) }], Math.max(life(b, 12.05, 14.65), life(b, 19.55, 21.05)));
    P2(-160, 602, [{ s: tr("ch03.r202"), font: SERIF(28) }], life(b, AT.ok202, 14.65), { ay: 0 });
    P2(40, 236, [{ s: "LivePushRoom", font: DECO(34) }, { s: tr("ch03.tower"), font: SERIF(28) }], Math.max(life(b, 12.4, 14.65), life(b, 19.55, 21.05)));
    P2(365, 404, [{ s: tr("ch03.pages"), font: SERIF(30) }], Math.max(life(b, 13.2, 14.65), life(b, 19.8, 21.05)));
    P2(330, 790, [{ s: tr("ch03.receipt"), font: SERIF(30) }, { s: tr("ch03.parallel"), font: SERIF(28), a: 0.75 }], life(b, AT.stamp + 0.05, 14.65));
    P2(1060, 694, [{ s: "ctx.waitUntil", font: MONO(30) }], life(b, AT.stamp, 14.4));
    P2(1300, 330, [{ s: tr("ch03.still"), font: SERIF(30) }], life(b, AT.agents, 14.65), { ax: 1 });
    P2(1480, 632, [{ s: tr("ch03.hb"), font: SERIF(30) }], life(b, AT.hb, AT.empty - 0.05));
    if (ra(AT.empty, 16.8)) fxPlate(t, 1240, 64, "empty", life(b, AT.empty + 0.05, 16.75));
    P2(1500, 632, [{ s: "mac · presence", font: MONO(28) }, { s: tr("ch03.flip"), font: SERIF(30) }], life(b, AT.pres, AT.slip2 + 0.3), { ax: 1 });
    if (ra(AT.slip2, 19.45)) fxPlate(t, 1240, 64, "presence", life(b, AT.slip2 + 0.05, 19.4));
    P2(-110, 330, [{ s: "presence", font: MONO(30) }], life(b, AT.rings2, 21.05));
    P2(1090, 300, [{ s: tr("ch03.fxTags"), font: SERIF(30) }, { s: tr("ch03.fxTagsSub"), font: SERIF(28), a: 0.8 }], life(b, AT.phone + 0.15, 21.05));
    P2(2190, 530, [{ s: "KV LAG", font: MONO(30) }], life(b, AT.lagUp + 0.25, 24.25));
    P2(3140, 440, [{ s: "D1 · lyjwpage-history", font: MONO(30) }], life(b, AT.d1Up + 0.25, 24.25));
    P2(2585, 628, [{ s: "KV CREDENTIALS", font: MONO(30) }], life(b, AT.credUp + 0.25, 24.25));
    storesTable(t, b);
    const fk = life(b, AT.foot, 24.25);
    if (fk > 0) plate(t, 36, 30, [{ s: tr("ch03.pulse7a"), font: SERIF(30) }, { s: tr("ch03.pulse7b"), font: SERIF(30) }], fk, { ax: 0, ay: 0 });
    if (ra(16.7, 18.0)) { const [ax, ay] = scr(1640, 640); balloon(t, tr("ch03.clawd"), ax + 40, ay - 250, ax + 6, ay - 40, life(b, 16.8, 17.95)); }
  }
  function footArc(x, b) {
    const k = prog(b, AT.foot, AT.foot + 0.3);
    if (k <= 0) return;
    const a = [1880, 560], c = [2400, 250], e = [2900, 470];
    x.save(); x.setLineDash([16, 14]); x.lineDashOffset = -b * 60;
    x.beginPath(); x.moveTo(a[0], a[1]);
    const n = 24;
    for (let i = 1; i <= n * k; i++) { const u = i / n; x.lineTo((1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * c[0] + u * u * e[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c[1] + u * u * e[1]); }
    x.lineWidth = 5; x.strokeStyle = rgba(C.ink); x.stroke(); x.restore();
    if (k >= 1) for (let i = 0; i < 2; i++) {
      const u = (((b - AT.foot) * 1.2 + i * 0.5) % 1 + 1) % 1, px = (1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * c[0] + u * u * e[0], py = (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c[1] + u * u * e[1];
      out(x, rr(P(), px - 22, py - 30 - 6 * bnc(b), 44, 30, 3), C.paper2, 3.5);
    }
  }

  function narration(t, b) {
    for (const [k, a, z] of NARR) {
      if (b < a || b > z) continue;
      const kk = Math.min(prog(b, a, a + 0.14, E.out), 1 - prog(b, z - 0.14, z, E.in));
      if (kk <= 0) continue;
      const w = 1320, h = 214, x0 = 300, y0 = 834;
      t.save(); t.globalAlpha = kk; t.translate(960, y0 + h / 2); t.scale(1, lerp(0.5, 1, kk)); t.translate(-960, -(y0 + h / 2));
      deco(t, x0, y0, w, h, { fans: true });
      t.restore();
      const r = prog(b, a + 0.08, a + 0.62);
      ["a", "b"].forEach((sfx, i) => text(t, tr(`ch03.${k}${sfx}`), 960, y0 + 93 + i * 80, {
        font: SERIF(60), color: rgba(C.cream), align: "center", reveal: clamp(r * 2 - i), perChar: true, dim: 0.12, maxW: 1200, alpha: kk, narration: true,
      }));
    }
  }

  // 整屏字卡（片头、「与此同时」）：底和框画在 bg 层，字在 top 层；字卡在时胶片效果整个关掉（filmK）。
  function bigFrame(x, k, b) {
    if (k <= 0) return;
    const L = 2 * (1920 - 112 + 1080 - 112);
    x.save(); x.strokeStyle = rgba(C.cream); x.lineWidth = 6; x.setLineDash([L * k, L]); x.strokeRect(56, 56, 1808, 968); x.restore();
    x.save(); x.strokeStyle = rgba(C.cream, 0.7); x.lineWidth = 2; x.setLineDash([L * k, L]); x.strokeRect(78, 78, 1764, 924); x.restore();
    const kc = prog(k, 0.6, 1);
    for (const [cx, cy, a0] of [[78, 78, 0], [1842, 78, Math.PI / 2], [1842, 1002, Math.PI], [78, 1002, -Math.PI / 2]]) {
      for (let i = 0; i < 5; i++) { const a = a0 + (i + 0.5) * (Math.PI / 10); seg(x, cx, cy, cx + 70 * kc * Math.cos(a), cy + 70 * kc * Math.sin(a), 2.5, C.cream, 0.9); }
      x.save(); x.strokeStyle = rgba(C.cream); x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, 40 * kc, a0, a0 + Math.PI / 2); x.stroke(); x.restore();
    }
    for (const [cx, cy] of [[960, 67], [960, 1013], [67, 540], [1853, 540]]) {
      x.save(); x.fillStyle = rgba(C.cream); x.globalAlpha = kc; x.translate(cx, cy); x.rotate(Math.PI / 4); x.fillRect(-9, -9, 18, 18); x.restore();
    }
  }
  const SIDE_GAP = 40;
  function sideRules(x, t, str, font, maxW, y, o) {
    const half = Math.min(measure(t, str, font), maxW) / 2;
    for (const sd of [-1, 1]) for (let i = 0; i < o.n; i++) {
      const x0 = half + SIDE_GAP + i * (o.len + 6);
      seg(x, 960 + sd * x0, y, 960 + sd * (x0 + o.len), y, o.lw, C.cream, o.a);
    }
  }
  function titleCard(x, g, t, b, wv) {
    x.save(); x.setTransform(G.S, 0, 0, G.S, G.S * wv[0], G.S * wv[1]);
    x.fillStyle = rgba(C.card); x.fillRect(-20, -20, 1960, 1120);
    bigFrame(x, prog(b, 0.25, 0.6, E.io), b);
    g.save(); g.setTransform(G.S * 0.5, 0, 0, G.S * 0.5, 0, 0);
    const lit = prog(b, 0, 0.25) * (1 - 0.15 * hash(Math.floor(b * BARs * 24)));
    lampToon(x, g, 960, 250, 1, 404, { lit, wink: arcK(prog(b, 1.45, 1.6)), b, look: 0 });
    g.restore();
    const chFont = EN() ? DECO(42) : SERIF(42);
    sideRules(x, t, tr("ch03.chapter"), chFont, Infinity, 438, { n: 1, len: 140, lw: 2, a: prog(b, 0.5, 0.7) });
    x.restore();
    text(t, tr("ch03.chapter"), 960, 452, { font: chFont, color: rgba(C.cream), align: "center", alpha: prog(b, 0.5, 0.65) });
    text(t, tr("ch03.title"), 960, 626, { font: SHOW(136), color: rgba(C.cream), align: "center", reveal: prog(b, 0.6, 1.1), perChar: true, rise: 18, maxW: 1560 });
    text(t, "workers/core · StateCore → StateHub", 960, 736, { font: MONO(34), color: rgba(C.cream, 0.82), align: "center", alpha: prog(b, 1.0, 1.3) });
  }
  function meanwhileCard(x, t, b, wv) {
    const str = tr("ch03.meanwhile"), font = SHOW(104);
    x.save(); x.setTransform(G.S, 0, 0, G.S, G.S * wv[0], G.S * wv[1]);
    x.fillStyle = rgba(C.card); x.fillRect(-20, -20, 1960, 1120);
    bigFrame(x, 1, b);
    sideRules(x, t, str, font, 1500, 556, { n: 3, len: 20, lw: 3, a: 0.8 });
    x.restore();
    text(t, str, 960, 590, { font, color: rgba(C.cream), align: "center", reveal: prog(b, 11.04, 11.35), perChar: true, maxW: 1500 });
  }

  // 颗粒、灰尘、毛发、划痕、闪烁和片门晃动按每秒 24 格换一次，和画面帧率无关。
  let grainTile = null, hotspot = null;
  function makeFilm() {
    const n = 512, c = document.createElement("canvas"); c.width = c.height = n;
    const cx = c.getContext("2d"), im = cx.createImageData(n, n), r = K.mulberry32(303);
    for (let i = 0; i < n * n; i++) { const v = r() * 2 - 1, a = Math.pow(Math.abs(v), 2.2); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v > 0 ? 255 : 0; im.data[i * 4 + 3] = Math.round(a * 70); }
    cx.putImageData(im, 0, 0);
    grainTile = c;
    const h = document.createElement("canvas"); h.width = 480; h.height = 270;
    const hx = h.getContext("2d"), gr = hx.createRadialGradient(240, 135, 60, 240, 135, 300);
    gr.addColorStop(0, "rgba(30,24,16,0)"); gr.addColorStop(1, "rgba(30,24,16,0.5)");
    hx.fillStyle = gr; hx.fillRect(0, 0, 480, 270);
    hotspot = h;
  }
  function filmK(b) {
    if (b < AT.irisIn || (b >= AT.mean && b < AT.outside)) return 0;
    return 1 - prog(b, AT.dive + 0.05, AT.dive + 0.3);
  }
  function filmFx(fl, b, fi, k) {
    if (k <= 0 || !grainTile) return;
    fl.save();
    fl.globalAlpha = 0.45 * k;
    fl.drawImage(hotspot, 0, 0, 1920, 1080);
    fl.globalAlpha = 0.75 * k;
    const ox = Math.floor(hash(fi * 1.31) * 512), oy = Math.floor(hash(fi * 2.17 + 3) * 512);
    for (let y = -oy; y < 1080; y += 512) for (let xx = -ox; xx < 1920; xx += 512) fl.drawImage(grainTile, xx, y);
    fl.globalAlpha = 1;
    const fk = 0.03 + 0.05 * hash(fi * 0.77 + 11);
    fl.fillStyle = `rgba(28,22,14,${(fk * k).toFixed(3)})`; fl.fillRect(0, 0, 1920, 1080);
    if (hash(fi * 0.53 + 2) > 0.93) { fl.fillStyle = `rgba(255,250,235,${(0.04 * k).toFixed(3)})`; fl.fillRect(0, 0, 1920, 1080); }
    const ns = 2 + Math.floor(hash(fi * 0.91) * 5);
    for (let i = 0; i < ns; i++) {
      const sx = hash(fi * 3.1 + i * 17.3) * 1920, sy = hash(fi * 5.7 + i * 29.1) * 1080, r = 1.2 + 3.6 * Math.pow(hash(fi * 7.3 + i * 3.3), 2);
      fl.fillStyle = hash(fi + i * 0.7) > 0.4 ? `rgba(20,16,12,${0.55 * k})` : `rgba(255,252,240,${0.5 * k})`;
      fl.beginPath(); fl.ellipse(sx, sy, r, r * (0.6 + 0.6 * hash(i + fi * 0.1)), hash(fi * 0.3 + i) * 3, 0, TAU); fl.fill();
    }
    const occ = Math.floor(fi / 97);
    if (fi % 97 < 9) {
      const hx = 80 + hash(occ * 4.1) * 380 + (hash(occ * 2.3) > 0.5 ? 1300 : 0), hy = 120 + hash(occ * 6.7) * 760;
      fl.beginPath(); fl.moveTo(hx, hy);
      fl.bezierCurveTo(hx + 30, hy - 40 + 20 * hash(occ), hx + 70, hy + 30, hx + 40 + 80 * hash(occ * 9.9), hy + 90);
      fl.lineWidth = 1.6; fl.strokeStyle = `rgba(20,16,12,${0.6 * k})`; fl.stroke();
    }
    const sc = Math.floor(fi / 34);
    if (hash(sc * 3.7) < 0.55) {
      const sx = 160 + hash(sc * 5.3) * 1600 + 6 * Math.sin(fi * 0.6), y0 = hash(fi * 1.7) * 300, y1 = 700 + hash(fi * 2.9) * 380;
      fl.fillStyle = `rgba(255,252,240,${(0.22 + 0.12 * hash(fi)) * k})`; fl.fillRect(sx, y0, 1.4, y1 - y0);
    }
    fl.restore();
  }
  // 换片提示的「烟头」：片尾前约 8 秒和 1 秒各闪一下右上角的圆点，放映员凭它换盘。
  function cueMark(t, b, fi) {
    for (const at of [22.4, 25.55]) {
      const f0 = Math.floor(at * BARs * 24);
      if (fi < f0 || fi >= f0 + 4) continue;
      t.save(); t.fillStyle = "rgba(250,246,236,0.9)"; t.beginPath(); t.arc(1832, 104, 26, 0, TAU); t.fill();
      t.lineWidth = 3; t.strokeStyle = "rgba(40,30,20,0.85)"; t.stroke(); t.restore();
    }
  }
  function iris(t, b, lampScr) {
    let r = null, c = null;
    if (b >= AT.irisOut && b < AT.irisIn) { r = lerp(1350, 0, E.in(prog(b, AT.irisOut, AT.irisIn))); c = [960, 250]; }
    else if (b >= AT.irisIn && b < AT.irisIn + 0.45) { r = lerp(0, 1500, E.in(prog(b, AT.irisIn, AT.irisIn + 0.45))); c = lampScr; }
    if (r == null) return;
    t.save(); t.fillStyle = "#000"; t.beginPath(); t.rect(-40, -40, 2000, 1160); t.arc(c[0], c[1], Math.max(0.01, r), 0, TAU, true); t.fill("evenodd");
    t.lineWidth = 4; t.strokeStyle = "rgba(60,50,40,0.9)"; t.beginPath(); t.arc(c[0], c[1], Math.max(0.01, r), 0, TAU); t.stroke(); t.restore();
  }

  // 号外最后冲进空白的照片框：框里填 G.css("paper")，放大到满屏就是第 04 章的首帧。
  const NP = { w: 1600, h: 980, box: [0, -10, 740, 430] };
  const QF = [NP.box[0] + NP.box[2] / 2, NP.box[1] + NP.box[3] / 2];
  function sunburst(x, b, wv) {
    const k = prog(b, AT.spin, AT.spin + 0.2);
    if (k <= 0) return;
    x.save(); x.setTransform(G.S, 0, 0, G.S, G.S * wv[0], G.S * wv[1]); x.globalAlpha = k;
    x.fillStyle = rgba(C.light); x.fillRect(-20, -20, 1960, 1120);
    x.translate(960, 540); x.rotate(b * 0.6);
    x.fillStyle = rgba(C.paper2);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; x.beginPath(); x.moveTo(0, 0); x.lineTo(1500 * Math.cos(a), 1500 * Math.sin(a)); x.lineTo(1500 * Math.cos(a + TAU / 36), 1500 * Math.sin(a + TAU / 36)); x.closePath(); x.fill(); }
    x.restore();
  }
  const npZoom = (b) => Math.exp(Math.log(12) * E.inExpo(prog(b, AT.dive, AT.end)));
  function newspaper(t, b) {
    if (b < AT.spin) return;
    const kS = prog(b, AT.spin, AT.bam), kD = prog(b, AT.dive, AT.end);
    const s = (0.03 + 0.97 * kS * kS) * (1 + 0.05 * impact(b, AT.bam, 0.06)), rot = Math.pow(1 - kS, 1.2) * 3 * TAU;
    const Z = npZoom(b), o = [QF[0] * E.io(kD), QF[1] * E.io(kD)];
    t.save(); t.translate(960, 540); t.rotate(-rot); t.scale(s * Z, s * Z); t.translate(-o[0], -o[1]);
    const { w, h } = NP;
    t.fillStyle = "rgba(0,0,0,0.35)"; t.fillRect(-w / 2 + 14, -h / 2 + 18, w, h);
    t.fillStyle = rgba(C.film); t.fillRect(-w / 2, -h / 2, w, h);
    t.strokeStyle = rgba(C.mid); t.lineWidth = 2; t.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
    t.fillStyle = rgba(C.card); t.fillRect(-w / 2 + 40, -h / 2 + 34, 200, 128);
    text(t, tr("ch03.extra"), -w / 2 + 140, -h / 2 + 124, { font: EN() ? DECO(46) : SHOW(76), color: rgba(C.cream), align: "center", maxW: 180 });
    text(t, tr("ch03.page3"), w / 2 - 140, -h / 2 + 108, { font: SERIF(30), color: rgba(C.ink), align: "center" });
    text(t, tr("ch03.mast"), 0, -h / 2 + 138, { font: SERIF(104), color: rgba(C.ink), align: "center", maxW: 1040 });
    for (const [yy, lw] of [[-h / 2 + 176, 5], [-h / 2 + 188, 2]]) { t.fillStyle = rgba(C.ink); t.fillRect(-w / 2 + 40, yy, w - 80, lw); }
    text(t, tr("ch03.head1"), 0, -h / 2 + 300, { font: SERIF(84), color: rgba(C.ink), align: "center", maxW: 1500 });
    text(t, tr("ch03.head2"), 0, -h / 2 + 400, { font: SERIF(84), color: rgba(C.ink), align: "center", maxW: 1500 });
    t.fillStyle = rgba(C.ink); t.fillRect(-w / 2 + 40, -h / 2 + 432, w - 80, 2);
    for (let col = 0; col < 2; col++) for (let i = 0; i < 17; i++) {
      const lx = -w / 2 + 50 + col * 380, ly = -h / 2 + 470 + i * 26, lw2 = (i % 6 === 5 ? 0.55 : 1) * 330 * (0.85 + 0.15 * hash(i * 3 + col));
      t.fillStyle = rgba(C.mid, 0.75); t.fillRect(lx, ly, lw2, 9);
    }
    const [bx, by, bw, bh] = NP.box;
    t.fillStyle = rgba(C.ink); t.fillRect(bx - 8, by - 8, bw + 16, bh + 16);
    t.fillStyle = G.css("paper"); t.fillRect(bx, by, bw, bh);
    text(t, tr("ch03.seeP4"), bx + bw / 2, by + bh + 42, { font: SERIF(30), color: rgba(C.ink), align: "center" });
    t.restore();
  }

  function world(x, g, b, cam) {
    const vx0 = cam.x - 960 / cam.zoom - 60, vx1 = cam.x + 960 / cam.zoom + 60;
    sky(x, b, vx0, vx1);
    if (vx0 < 960) { hill(x); for (const [cx, f1, f2] of COTS) cottage(x, cx, 522, b, f1, f2, cx / 130); }
    x.fillStyle = rgba(C.light); x.fillRect(-1700, GROUND, 6600, 800);
    seg(x, -1700, GROUND, 4900, GROUND, 5);
    for (let i = 0; i < 70; i++) { const gx = -1600 + i * 93 + 40 * hash(i), gy = GROUND + 30 + 260 * hash(i * 1.7); if (gx < vx0 || gx > vx1) continue; seg(x, gx - 8, gy, gx, gy - 12, 2.5, C.mid); seg(x, gx, gy - 12, gx + 6, gy, 2.5, C.mid); }
    if (vx0 < 300) tower(x, g, b);
    if (vx0 < -60) kiosk(x, b);
    if (vx1 > HX0 - 60) {
      houseBack(x, b);
      const cw = clamp(prog(b, AT.clawd, AT.clawd + 0.2, E.outBack)) * (1 - prog(b, 17.95, 18.1));
      if (cw > 0) clawdToon(x, 1640, 742 + 120 * (1 - cw), 9, { sq: sqz(b), look: -0.4, blink: blinkAt(b, 5), hands: b < 16.8 ? [[-2.5, -3.5 * cw], [2.5, -3.5 * cw]] : [[-2.5, 1.5], [-6.0, -0.6]] });
      desk(x, b);
      const wink = Math.max(arcK(prog(b, 4.45, 4.6)), arcK(prog(b, 9.7, 9.85)), arcK(prog(b, 17.1, 17.25)));
      lampToon(x, g, LAMP[0], LAMP[1], 1 / 1.4, 718, { lit: 1, wink, b, look: 0.4 });
      ledgerToon(x, b);
      houseShell(x, b);
      for (const tc of COMMITS) glowDot(g, BOOK[0], BOOK[1] - 20, 140, 0.7 * impact(b, tc, 0.12) * (tc === AT.hero ? 1.6 : 1));
    }
    if (vx0 < 1060 && vx1 > 700) booth(x, b);
    if (vx0 < 900) tube(x, g, b);
    if (b > 21.2) { stores(x, b); footArc(x, b); }
    queue(x, g, b, vx0, vx1);
    slips(x, b);
    if (b >= AT.phone + 0.1 && b < 21.0) {
      for (let i = 0; i < 3; i++) {
        const k = prog(b, AT.phone + 0.15 + i * 0.12, AT.phone + 0.75 + i * 0.12);
        if (k <= 0 || k >= 1) continue;
        const ty = lerp(660, -260, E.in(k));
        x.save(); x.translate(962 + 12, ty); x.rotate(0.2 * Math.sin(b * 20 + i));
        out(x, (() => { const p = P(); p.moveTo(0, 0); p.lineTo(46, 0); p.lineTo(56, 14); p.lineTo(46, 28); p.lineTo(0, 28); p.closePath(); return p; })(), C.paper2, 3);
        out(x, (() => { const p = P(); p.arc(44, 14, 4, 0, TAU); return p; })(), C.light, 2);
        for (let j = 0; j < 2; j++) seg(x, 8, 9 + j * 10, 32 - j * 8, 9 + j * 10, 2.5, C.mid);
        x.restore();
      }
    }
  }

  let pic, glow, film, top;
  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
    const hitS = Math.max(impact(b, AT.hero, 0.1) * 0.6, impact(b, AT.lagUp + 0.3, 0.1) * 0.5, impact(b, AT.d1Up + 0.3, 0.1) * 0.5, impact(b, AT.credUp + 0.3, 0.1) * 0.6, impact(b, AT.bam, 0.12));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.01 * hitS), rot: 0 };
    const fi = Math.floor(f.lt * 24), fxK = filmK(b);
    const wv = [fxK * (1.1 * Math.sin(fi * 0.71) + 0.7 * (hash(fi * 0.37) - 0.5)), fxK * (0.9 * Math.sin(fi * 0.43 + 1.3) + 0.8 * (hash(fi * 0.91 + 5) - 0.5))];
    const camW = { ...cam, sx: wv[0], sy: wv[1] };
    G.setCam(cam);
    G.clear(lin(C.film));
    const x = pic.begin(); pic.cam(camW);
    const g = glow.begin(); glow.cam(camW);
    const fl = film.begin();
    const t = top.begin();
    const scr = (wx, wy) => [960 + cam.zoom * (wx - cam.x), 540 + cam.zoom * (wy - cam.y)];
    const card = b < AT.irisIn || (b >= AT.mean && b < AT.outside);
    const covered = b >= AT.spin + 0.2;
    if (!card && !covered) world(x, g, b, cam);
    if (b < AT.irisIn) titleCard(x, g, t, b, wv);
    if (b >= AT.mean && b < AT.outside) meanwhileCard(x, t, b, wv);
    sunburst(x, b, wv);
    filmFx(fl, b, fi, fxK);
    if (!card && b < AT.spin + 0.5) labels(t, b, scr);
    narration(t, b);
    newspaper(t, b);
    iris(t, b, scr(LAMP[0], LAMP[1]));
    cueMark(t, b, fi);
    G.composite(pic.upload(), { mode: G.MODE.normal });
    G.composite(glow.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(film.upload(), { mode: G.MODE.normal });
    G.composite(top.upload(), { mode: G.MODE.normal });
    // 末帧的后期参数和第 04 章首帧一样；颗粒只在字都冲出画面之后才加。
    const kEnd = prog(b, 25.75, AT.end, E.io), kGr = prog(b, 25.935, AT.end);
    const sh = hitS * 6;
    const Zb = Math.log(npZoom(b) / npZoom(b - 1 / 60 / f.BAR));
    f.post = {
      bloom: lerp(0.5, 0.7, kEnd), threshold: lerp(0.95, 0.9, kEnd), halation: lerp(0, 0.28, kEnd), grain: lerp(0, 0.05, kGr), vignette: 0.42, ca: lerp(0, 0.4, kEnd),
      fade: 1 - prog(b, 0, 0.25),
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur: card || b >= AT.spin ? [0, 0] : [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]],
      zoomBlur: card ? 0 : b >= AT.spin ? clamp(Zb, -0.2, 0.2) : clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
    };
  }

  window.CHAPTERS.push({
    id: "ch03", title: "ch.03", bars: 26,
    async init() {
      pic = G.layer("bg"); glow = G.layer("emit", 0.5); film = G.layer("paper"); top = G.layer("top");
      await Promise.all([
        document.fonts.load(SERIF(40), "账房 Ag"), document.fonts.load('40px "ZCOOL XiaoWei"', "账房"), document.fonts.load('40px "Ch03 Marquee"', "Ag"),
        document.fonts.load(MONO(30), "Ag"),
      ]);
      if (!grainTile) makeFilm();
    },
    render,
  });
})();
