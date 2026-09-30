(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, envelope, stamp, clawd, bubble, spark,
    roundRect, glyph, sheet, checkbox, leader, pathAt, pathLen, mulberry32 } = K;
  I18N.add({
    "ch03.title": ["一间屋子的账房", "A one-room ledger office"],
    "ch03.idNote": ["全站只有这一个实例", "one instance for the whole site"],
    "ch03.n1a": ["StateHub 是唯一的状态 DO，", "StateHub is the single state DO;"],
    "ch03.n1b": ["实时层全在它的 SQLite 里。", "all realtime state sits in SQLite."],
    "ch03.feed.ingress": ["上报入口", "Ingress"],
    "ch03.n2a": ["经 Service Binding 调 StateCore，", "Ingress calls StateCore via binding;"],
    "ch03.n2b": ["再串进 StateHub，逐封落账。", "StateHub commits them one by one."],
    "ch03.ledger": ["StateHub 账本", "StateHub ledger"],
    "ch03.hbTag": ["mac · 心跳", "mac · heartbeat"],
    "ch03.hbRow": ["存活 + pulse 观测", "liveness + pulse"],
    "ch03.flipRow": ["在线 → 离线", "online → offline"],
    "ch03.n3a": ["StateHub 自己不发网络请求，", "StateHub makes no network calls;"],
    "ch03.n3b": ["只交回一张效果单：要做的事。", "it hands back a list of effects."],
    "ch03.slip": ["要做的事", "To do"],
    "ch03.fx.empty": ["（空）", "(empty)"],
    "ch03.fx.listen": ["广播 listening-now", "push listening-now"],
    "ch03.fx.listenSub": ["先查 Apple 目录补封面和链接", "after an Apple catalog lookup"],
    "ch03.fx.noTags": ["换歌不失效；开始或停止放歌才有", "none: only start or stop invalidates"],
    "ch03.fx.noPush": ["不推送", "no push"],
    "ch03.fx.noTags2": ["不失效首屏", "no invalidation"],
    "ch03.fx.presence": ["广播 presence", "push presence"],
    "ch03.fx.flipTags": ["失效页头、在听、充电头", "header, listening, charger"],
    "ch03.fx.flipTagsSub": ["→ Vercel，5 秒超时", "→ Vercel, 5 s timeout"],
    "ch03.coreNote": ["RPC 入口 · 照单去办", "RPC entry · runs it"],
    "ch03.pushNote": ["另一个单例 DO", "another single-instance DO"],
    "ch03.pages": ["所有开着的页面", "Every open page"],
    "ch03.back": ["回执 → 入口", "Receipt → ingress"],
    "ch03.backNote1": ["入口接着写 LAG 和凭据，", "Ingress then writes LAG and credentials,"],
    "ch03.backNote2": ["都写完才盖 202", "and only then stamps 202"],
    "ch03.parallel": ["并行", "parallel"],
    "ch03.n4a": ["StateCore 用 waitUntil 照单办，", "StateCore runs them in waitUntil:"],
    "ch03.n4b": ["网络请求不占 StateHub 的时间。", "network I/O never blocks StateHub."],
    "ch03.n5a": ["心跳只续存活、记 pulse 观测，", "A heartbeat logs liveness and pulse;"],
    "ch03.n5b": ["效果单为空，下游什么都不做。", "its effect list stays empty."],
    "ch03.clawd": ["记一笔就好，\n别吵醒大家。", "Just jot it down,\ndon't wake anyone."],
    "ch03.n6a": ["只有上线、下线才广播 presence，", "Presence is pushed only on flips,"],
    "ch03.n6b": ["并通知 Vercel 让首屏标签过期。", "and Vercel is asked to expire tags."],
    "ch03.n7a": ["只有实时层放在 DO 里，变了就推送；", "Only the realtime layer lives in a DO and pushes;"],
    "ch03.n7b": ["其余几层在 KV 和 D1，不推送、按需读取。", "the rest sit in KV and D1 and wait to be read."],
    "ch03.legend": ["四个库", "Four stores"],
    "ch03.lg.rt": ["实时", "Realtime"],
    "ch03.lg.rtP": ["会推送", "pushes"],
    "ch03.lg.rtW": ["StateHub（DO，SQLite）", "StateHub (DO, SQLite)"],
    "ch03.lg.lag": ["可滞后", "Lag-tolerant"],
    "ch03.lg.lagP": ["不推送", "no push"],
    "ch03.lg.lagW": ["KV LAG · 带 updatedAt", "KV LAG · with updatedAt"],
    "ch03.lg.d1": ["历史", "History"],
    "ch03.lg.d1P": ["长期保存", "kept long-term"],
    "ch03.lg.d1W": ["D1 · lyjwpage-history", "D1 · lyjwpage-history"],
    "ch03.lg.cred": ["凭据", "Credentials"],
    "ch03.lg.credP": ["不公开", "never public"],
    "ch03.lg.credW": ["KV CREDENTIALS", "KV CREDENTIALS"],
    "ch03.pulse7a": ["pulse 时间线在屋里只放 7 天，", "The pulse timeline stays 7 days in the room,"],
    "ch03.pulse7b": ["每分钟归档进 D1", "archived to D1 every minute"],
  });
  const tr = (k) => I18N.tr(k);
  let plate, plan, emit, docs, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const A = [960, 540, 1, 0], B = [1880, 540, 1, 0], C = [1618, 951, 0.66, 0];
  const CAM = [
    [0, [952, 546, 1.035, 0]],
    [2.0, A, E.out],
    [6.0, [966, 538, 1.012, 0], E.lin],
    [6.26, B, E.io],
    [7.95, [1894, 546, 1.02, 0], E.lin],
    [8.2, A, E.io],
    [11.74, [958, 542, 1.016, 0], E.lin],
    [12.02, C, E.io],
    [15.5, [1628.5, 957.1, 0.674, 0], E.lin],
    // 章末关键帧必须提前落定：边界帧属于下一章，否则会在模糊和纸纹未对齐时切走。
    [15.72, [2497, 1325, 1.1, 0], E.io],
    [15.97, [2497, 1325, 12, 0], E.inExpo],
  ];
  const PLATE_RECT = [-800, -400, 3400, 2000];

  const R = { x0: 520, y0: 330, x1: 1080, y1: 830, t: 24 };
  const DOOR = { y0: 540, y1: 640 };
  const SLOT = { y0: 566, y1: 594 };
  const DESK = { x: 700, y: 480, w: 260, h: 120 };
  const BOOK = [830, 540], LAMP = [930, 506], TRAY = [930, 570];
  const LANE_Y = 590, MERGE = [250, LANE_Y], FRONT = [490, LANE_Y];
  const FEED = [[-900, 400], [110, 400], MERGE];
  const PRE = [...FEED, FRONT];
  const PATH = [...PRE, [R.x0 + R.t + 40, LANE_Y], [BOOK[0] - 90, BOOK[1] + 20], BOOK];
  const FRONT_D = pathLen(PRE), BOOK_D = pathLen(PATH);
  const GAP = 78;
  const LED = { x: 1180, y: 70, w: 690, h: 400, rows: 5, lh: 48 };
  const SLP = { x: 1180, y: 500, w: 690, h: 360 };
  const BOOTH = { x: 1150, y: 500, w: 160, h: 160 };
  const MAST = [1740, 780];
  const PAGES = [300, 450, 600, 750].map((y) => [2560, y]);
  const SLIPB = { x: 1560, y: 80, w: 720, h: 360 };
  const RECEIPT = [[1150, 520], [1110, 300], [-500, 300]];
  const LAGW = { x: 285, y: 960, w: 460, h: 330 }, DRAWER = { x: 820, y: 1060, w: 300, h: 230 }, SHELF = { x: 1260, y: 960, w: 1440, h: 330 };
  const GROUND = 1290;
  const TABLE = { x: 2012, y: 224, w: 970, h: 1166 };

  const Q = [
    ["mac", "desktop"], ["homepod", "nowPlaying"], ["emby", "watching"], ["mac", "chargingDevices"],
    ["playstation", "playing"], ["mac", "coding"], ["agents", "coding"], ["iphone", "activity"],
    ["mac", "desktop"], ["homepod", "nowPlaying"], ["mac", "chargingDevices"], ["emby", "watching"],
  ].map(([src, what], i) => ({ t: 2 + i * 0.25, src, what }));
  Q.push({ t: 5.0, src: "mac", what: "appleMusic", hero: true });
  Q.push({ t: 8.25, src: "playstation", what: "playing" }, { t: 8.5, src: "emby", what: "watching" });
  Q.push({ t: 9.0, src: "mac", whatKey: "ch03.hbRow", heart: true, dim: true });
  Q.push({ t: 10.5, src: "mac", whatKey: "ch03.flipRow", flip: true });
  for (const [src, what] of [["homepod", "nowPlaying"], ["mac", "desktop"], ["agents", "coding"], ["playstation", "playing"], ["mac", "chargingDevices"], ["iphone", "activity"], ["emby", "watching"], ["mac", "desktop"]]) Q.push({ t: Infinity, src, what });
  const HERO = Q.findIndex((q) => q.hero), HB = Q.findIndex((q) => q.heart), FLIP = Q.findIndex((q) => q.flip);

  const moved = (b) => Q.reduce((s, q) => s + E.io(prog(b, q.t - 0.2, q.t)), 0);
  const arrive = (b) => (1 - E.out(prog(b, 0.15, 1.9))) * 11;
  function queuePos(q) {
    if (q >= 0) return pathAt(PATH, FRONT_D - q * GAP);
    return pathAt(PATH, FRONT_D + -q * (BOOK_D - FRONT_D));
  }

  function wallRects() {
    const { x0, y0, x1, y1, t } = R;
    return [
      [x0, y0, x1 - x0, t], [x0, y1 - t, x1 - x0, t],
      [x0, y0, t, DOOR.y0 - y0], [x0, DOOR.y1, t, y1 - DOOR.y1],
      [x1 - t, y0, t, SLOT.y0 - y0], [x1 - t, SLOT.y1, t, y1 - SLOT.y1],
    ];
  }
  function roomPlan(x, k, hatchA, o = {}) {
    const bone = css("bone");
    const { x0, y0, x1, y1, t } = R;
    polyline(x, [[x0, DOOR.y0], [x0, y0], [x1, y0], [x1, SLOT.y0]], k, 2.6, bone);
    polyline(x, [[x1, SLOT.y1], [x1, y1], [x0, y1], [x0, DOOR.y1]], k, 2.6, bone);
    polyline(x, [[x0 + t, DOOR.y0], [x0 + t, y0 + t], [x1 - t, y0 + t], [x1 - t, SLOT.y0]], k, 1.6, bone);
    polyline(x, [[x1 - t, SLOT.y1], [x1 - t, y1 - t], [x0 + t, y1 - t], [x0 + t, DOOR.y1]], k, 1.6, bone);
    if (k >= 1) {
      for (const [ax, ay, bx] of [[x0, DOOR.y0, x0 + t], [x0, DOOR.y1, x0 + t], [x1 - t, SLOT.y0, x1], [x1 - t, SLOT.y1, x1]]) line(x, ax, ay, bx, ay, 1.6, bone);
    }
    if (hatchA > 0) {
      x.save(); x.beginPath();
      for (const [rx, ry, rw, rh] of wallRects()) x.rect(rx, ry, rw, rh);
      x.clip(); x.globalAlpha = 0.55 * hatchA; x.strokeStyle = bone; x.lineWidth = 1.1; x.beginPath();
      for (let s = x0 + y0 - 20; s < x1 + y1 + 20; s += 11) { x.moveTo(s - y0, y0); x.lineTo(s - y1, y1); }
      x.stroke(); x.restore();
    }
    const fk = prog(k, 0.55, 1);
    if (fk <= 0) return;
    x.save(); x.globalAlpha = fk; x.strokeStyle = bone;
    x.lineWidth = 2.4; x.beginPath(); x.moveTo(x0 + t, DOOR.y1); x.lineTo(x0 + t + 100, DOOR.y1); x.stroke();
    x.setLineDash([5, 6]); x.lineWidth = 1.2; x.beginPath(); x.arc(x0 + t, DOOR.y1, 100, -Math.PI / 2, 0); x.stroke();
    x.restore();
    x.save(); x.globalAlpha = fk;
    x.fillStyle = css("ink2"); x.fillRect(DESK.x, DESK.y, DESK.w, DESK.h);
    x.strokeStyle = bone; x.lineWidth = 2.2; x.strokeRect(DESK.x, DESK.y, DESK.w, DESK.h);
    x.lineWidth = 1.8; roundRect(x, 800, 432, 60, 40, 6); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.moveTo(804, 428); x.lineTo(856, 428); x.stroke();
    x.lineWidth = 1.8; x.fillStyle = css("paper"); x.globalAlpha = fk * 0.92;
    x.fillRect(772, 512, 116, 60); x.globalAlpha = fk;
    x.strokeStyle = css("pink"); x.strokeRect(772, 512, 116, 60); line(x, 830, 512, 830, 572, 1.4, css("pink"));
    for (let j = 0; j < 4; j++) { line(x, 780, 524 + j * 12, 822, 524 + j * 12, 1, css("pink"), 0.5); line(x, 838, 524 + j * 12, 880, 524 + j * 12, 1, css("pink"), 0.5); }
    x.strokeStyle = bone; x.lineWidth = 1.8;
    x.beginPath(); x.arc(LAMP[0], LAMP[1], 11, 0, Math.PI * 2); x.stroke();
    line(x, LAMP[0] - 16, LAMP[1], LAMP[0] + 16, LAMP[1], 1.2, bone); line(x, LAMP[0], LAMP[1] - 16, LAMP[0], LAMP[1] + 16, 1.2, bone);
    x.strokeRect(TRAY[0] - 22, TRAY[1] - 14, 44, 28);
    x.restore();
    if (o.ticks) {
      const p = o.ticks;
      if (p > 0.02) fillRect(x, 838, 524 + 3 * 12 - 3, 42, 6, css("signalD"), p);
    }
  }

  function lanes(x, k, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(k, 0, 0.4);
    const [, p1, p2] = FEED;
    polyline(x, [[-40, p1[1]], p1, p2, FRONT], k, 1.4, bone, 0.55);
    const mx = lerp(p1[0], p2[0], 0.55), my = lerp(p1[1], p2[1], 0.55), d = Math.sign(p2[1] - p1[1]);
    if (k >= 1) polyline(x, [[mx - 14, my - 2 * d], [mx + 2, my + 12 * d - 2 * d], [mx + 12, my - 8 * d]], 1, 1.6, bone, 0.7);
    const la = a * (1 - prog(b, 11.6, 11.85));
    text(x, tr("ch03.feed.ingress"), 44, 356, { font: FONT.cjk(30, 600), color: ash, alpha: la });
    text(x, "Service Binding", 250, 446, { font: FONT.mono(28, 500), color: ash, alpha: la });
    text(x, "→ StateCore", 250, 484, { font: FONT.mono(28, 500), color: ash, alpha: la });
    const posts = [280, 360, 440, 510];
    for (const y of [546, 634]) {
      polyline(x, [[posts[0], y], [posts[posts.length - 1], y]], k, 1.2, bone, 0.45);
      posts.forEach((px, j) => { if (k > j / posts.length) { x.save(); x.globalAlpha = 0.7; x.fillStyle = bone; x.beginPath(); x.arc(px, y, 4.5, 0, Math.PI * 2); x.fill(); x.restore(); } });
    }
    text(x, "ingestTail", R.x0 + R.t + 22, R.y1 - R.t - 26, { font: FONT.mono(28, 500), color: ash, alpha: prog(b, 2.3, 2.7) * la });
  }

  function heart(x, cx, cy, s, color, alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(cx, cy + s * 0.35);
    x.bezierCurveTo(cx - s, cy - s * 0.35, cx - s * 0.45, cy - s, cx, cy - s * 0.45);
    x.bezierCurveTo(cx + s * 0.45, cy - s, cx + s, cy - s * 0.35, cx, cy + s * 0.35);
    x.fill(); x.restore();
  }

  function queue(x, e, b, f) {
    const mv = moved(b), arr = arrive(b);
    for (let i = Q.length - 1; i >= 0; i--) {
      const qq = Q[i];
      const q = i - mv + arr;
      if (q <= -1 || b >= qq.t) continue;
      const [px, py] = queuePos(q);
      if (px < -80) continue;
      const near = b > qq.t - 0.5;
      const hot = qq.hero || (qq.flip && near);
      const col = hot ? css("signalD") : css("bone");
      const w = 58;
      const beat = qq.heart && b > 8.8 ? f.env("kick") : 0;
      envelope(x, px, py, w * (1 + 0.12 * beat), col, { lw: 2.2, fill: css("ink2"), alpha: clamp((px + 80) / 120) });
      if (qq.heart) heart(x, px, py + 4, 9 * (1 + 0.25 * beat), css("signalD"));
      if (qq.hero && e) spark(e, null, [px, py - 6], null, { t: G.t, size: 0.75 });
      const lab = qq.hero ? "mac · appleMusic" : qq.heart ? tr("ch03.hbTag") : qq.flip ? "mac · presence" : null;
      if (lab && near) text(x, lab, px, py - 58, { font: FONT.mono(28, 500), color: hot ? css("signalD") : css("ash"), align: "center", alpha: prog(b, qq.t - 0.5, qq.t - 0.4) * (1 - prog(q, -0.55, -0.85)) });
    }
  }

  function ledgerCard(x, b, a) {
    if (a <= 0) return;
    const { x: px, y: py, w, h, rows, lh } = LED;
    sheet(x, px, py, w, h, { alpha: a });
    text(x, tr("ch03.ledger"), px + 32, py + 58, { font: FONT.cjk(38, 600), alpha: a });
    text(x, "SQLite", px + w - 32, py + 56, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: a });
    text(x, "entries · fields · samples · metadata", px + 32, py + 102, { font: FONT.mono(28), color: css("graphite"), alpha: a, maxW: w - 64 });
    line(x, px + 28, py + 124, px + w - 28, py + 124, 1.4, css("pink"), a);
    const done = Q.filter((q) => b >= q.t);
    const n = done.length, last = done[n - 1];
    const scrollK = last ? E.outExpo(clamp((b - last.t) / 0.12)) : 1;
    x.save(); x.beginPath(); x.rect(px, py + 132, w, rows * lh + 6); x.clip();
    for (let i = Math.max(0, n - rows - 1); i < n; i++) {
      const c = done[i];
      const slot = i - Math.max(0, n - rows) + (n > rows ? 1 - scrollK : 0);
      const y = py + 174 + slot * lh;
      const k = clamp((b - c.t) / 0.1);
      const col = c.hero || c.flip ? css("signal") : c.dim ? css("graphite") : css("pink");
      text(x, String(i + 1).padStart(2, "0"), px + 32, y, { font: FONT.mono(28), color: css("graphite"), alpha: a * k });
      text(x, c.src, px + 92, y, { font: FONT.mono(30, 500), color: col, alpha: a * k });
      const what = c.whatKey ? tr(c.whatKey) : c.what;
      if (c.heart) heart(x, px + 328, y - 10, 12, css("signal"), a * k);
      text(x, what, px + (c.heart ? 350 : 316), y, { font: c.whatKey ? FONT.cjk(30, 600) : FONT.mono(30, 500), color: col, alpha: a, reveal: k, perChar: true, maxW: w - (c.heart ? 350 : 316) - 80 });
      polyline(x, [[px + w - 62, y - 12], [px + w - 52, y - 2], [px + w - 34, y - 24]], clamp((b - c.t - 0.04) / 0.08), 4, css("signal"), a);
      line(x, px + 28, y + 16, px + w - 28, y + 16, 1, css("pink"), 0.16 * a);
    }
    x.restore();
  }

  function slipCard(x, box, rows, a, o = {}) {
    if (a <= 0) return;
    const { x: px, y: py, w, h } = box;
    sheet(x, px, py, w, h, { alpha: a, rot: o.rot || 0 });
    x.save(); x.translate(px, py); x.rotate(o.rot || 0); x.translate(-px, -py);
    text(x, tr("ch03.slip"), px + 32, py + 58, { font: FONT.cjk(38, 600), alpha: a });
    if (o.empty) text(x, tr("ch03.fx.empty"), px + 32 + K.measure(x, tr("ch03.slip"), FONT.cjk(38, 600)) + 14, py + 58, { font: FONT.cjk(38, 600), color: css("graphite"), alpha: a });
    text(x, "IngestEffect", px + w - 32, py + 56, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: a });
    line(x, px + 28, py + 78, px + w - 28, py + 78, 1.4, css("pink"), a);
    ["event", "listening", "tags"].forEach((kind, i) => {
      const r = rows[kind] || {};
      const y = py + 132 + i * 84;
      const on = r.s != null;
      const wk = r.write ?? 1;
      text(x, kind, px + 32, y, { font: FONT.mono(30, 500), color: on ? css("pink") : css("graphite"), alpha: a });
      text(x, on ? r.s : "—", px + 222, y, { font: FONT.cjk(30, 600), color: on ? css("pink") : css("graphite"), alpha: a, reveal: on ? wk : 1, perChar: on, maxW: w - 222 - 96 });
      if (r.sub) text(x, r.sub, px + 222, y + 36, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: a * (on ? prog(wk, 0.6, 1) : 1), maxW: w - 222 - 40 });
      if (on) checkbox(x, px + w - 76, y - 30, r.tick ?? 0, { alpha: a });
      line(x, px + 28, y + 50, px + w - 28, y + 50, 1, css("pink"), 0.16 * a);
    });
    x.restore();
  }
  const heroRows = (write, tick) => ({
    listening: { s: tr("ch03.fx.listen"), sub: tr("ch03.fx.listenSub"), write, tick },
    tags: { sub: tr("ch03.fx.noTags") },
  });
  const flipRows = (write, t1, t2) => ({
    event: { s: tr("ch03.fx.presence"), write, tick: t1 },
    tags: { s: tr("ch03.fx.flipTags"), sub: tr("ch03.fx.flipTagsSub"), write, tick: t2 },
  });

  function callout(x, cx, cy, r, tx, ty, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = 0.75 * a; x.strokeStyle = css("bone"); x.lineWidth = 1.4; x.setLineDash([6, 6]);
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    const ang = Math.atan2(ty - cy, tx - cx);
    x.beginPath(); x.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); x.lineTo(tx, ty); x.stroke();
    x.restore();
  }

  function tinySlip(x, px, py, a, tickK = 0) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(px, py);
    x.fillStyle = css("paper"); x.fillRect(-18, -12, 36, 24);
    x.strokeStyle = css("pink"); x.lineWidth = 1.4; x.strokeRect(-18, -12, 36, 24);
    for (let j = 0; j < 3; j++) line(x, -12, -5 + j * 6, 8, -5 + j * 6, 1, css("pink"), 0.6);
    x.restore();
    if (tickK > 0) polyline(x, [[px + 6, py], [px + 10, py + 5], [px + 18, py - 7]], tickK, 2.4, css("signal"), a);
  }

  function booth(x, a) {
    if (a <= 0) return;
    const bone = css("bone");
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink2"); x.fillRect(BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h);
    x.strokeStyle = bone; x.lineWidth = 2.4; x.strokeRect(BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h);
    x.lineWidth = 1.4; x.strokeRect(BOOTH.x + 14, BOOTH.y + 14, BOOTH.w - 28, BOOTH.h - 28);
    x.fillStyle = css("ink"); x.fillRect(BOOTH.x - 3, SLOT.y0 - 4, 6, SLOT.y1 - SLOT.y0 + 8);
    line(x, R.x1, SLOT.y0 - 4, BOOTH.x, SLOT.y0 - 4, 1.2, bone, 0.6); line(x, R.x1, SLOT.y1 + 4, BOOTH.x, SLOT.y1 + 4, 1.2, bone, 0.6);
    x.restore();
  }
  function mast(x, a, pulse = 0) {
    if (a <= 0) return;
    const bone = css("bone"), [mx, my] = MAST;
    x.save(); x.globalAlpha = a; x.strokeStyle = bone; x.lineWidth = 2.2;
    x.fillStyle = css("ink2"); x.beginPath(); x.arc(mx, my, 18, 0, Math.PI * 2); x.fill(); x.stroke();
    line(x, mx - 12, my - 12, mx + 12, my + 12, 1.6, bone); line(x, mx - 12, my + 12, mx + 12, my - 12, 1.6, bone);
    if (pulse > 0.02) for (let j = 1; j <= 3; j++) { x.globalAlpha = a * pulse * (1 - j * 0.22); x.strokeStyle = css("signalD"); x.beginPath(); x.arc(mx, my, 18 + j * 12, -0.6, 0.6); x.stroke(); x.beginPath(); x.arc(mx, my, 18 + j * 12, Math.PI - 0.6, Math.PI + 0.6); x.stroke(); }
    x.restore();
  }
  function page(x, px, py, lit, a) {
    if (a <= 0) return;
    const col = lit > 0.5 ? css("signalD") : css("bone");
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink2"); x.fillRect(px, py, 170, 100);
    x.strokeStyle = col; x.lineWidth = 2; x.strokeRect(px, py, 170, 100);
    line(x, px, py + 18, px + 170, py + 18, 1.2, col, 0.8);
    for (let j = 0; j < 3; j++) { x.beginPath(); x.arc(px + 12 + j * 11, py + 9, 3, 0, Math.PI * 2); x.stroke(); }
    const flipS = lit > 0 && lit < 1 ? Math.abs(Math.cos(lit * Math.PI)) : 1;
    x.translate(px + 85, py + 60); x.scale(1, flipS);
    x.strokeStyle = col; x.lineWidth = 1.6; x.strokeRect(-60, -24, 120, 48);
    if (lit >= 0.5) { x.fillStyle = css("signalD"); x.globalAlpha = a * 0.9; x.fillRect(-48, -10, 70, 6); x.fillRect(-48, 4, 44, 6); }
    else { x.fillStyle = css("bone"); x.globalAlpha = a * 0.45; x.fillRect(-48, -10, 60, 6); x.fillRect(-48, 4, 36, 6); }
    x.restore();
    if (lit >= 0.5) text(x, "listening-now", px + 85, py + 128, { font: FONT.mono(28, 500), color: css("signalD"), align: "center", alpha: a * prog(lit, 0.5, 0.8) });
  }
  function rings(e, x, t0, now, maxR = 1500) {
    const s = (now - t0) * BARs;
    if (s < 0) return -1;
    for (let j = 0; j < 3; j++) {
      const R = (s - j * 0.16) * 950;
      if (R <= 0 || R > maxR) continue;
      const fade = Math.pow(1 - R / maxR, 1.5);
      e.save(); e.globalAlpha = 0.5 * fade; e.strokeStyle = "rgba(240,150,105,1)"; e.lineWidth = 5 - j * 1.2;
      e.beginPath(); e.arc(MAST[0], MAST[1], R, 0, Math.PI * 2); e.stroke(); e.restore();
      x.save(); x.globalAlpha = 0.4 * fade; x.strokeStyle = css("signalD"); x.lineWidth = 1.4;
      x.beginPath(); x.arc(MAST[0], MAST[1], R, 0, Math.PI * 2); x.stroke(); x.restore();
    }
    return s * 950;
  }
  function arrowPath(x, pts, k, color, alpha = 1) {
    if (k <= 0) return;
    x.save(); x.setLineDash([10, 8]);
    const head = polyline(x, pts, k, 2, color, alpha);
    x.restore();
    if (!head) return;
    const L = pathLen(pts), prev = pathAt(pts, Math.max(0, k * L - 12));
    const ang = Math.atan2(head[1] - prev[1], head[0] - prev[0]);
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(head[0] + Math.cos(ang) * 6, head[1] + Math.sin(ang) * 6);
    x.lineTo(head[0] + Math.cos(ang + 2.6) * 16, head[1] + Math.sin(ang + 2.6) * 16);
    x.lineTo(head[0] + Math.cos(ang - 2.6) * 16, head[1] + Math.sin(ang - 2.6) * 16);
    x.fill(); x.restore();
  }

  function rise(x, k, box, draw) {
    if (k <= 0) return;
    x.save(); x.beginPath(); x.rect(box.x - 40, box.y - 400, box.w + 80, GROUND - (box.y - 400)); x.clip();
    x.translate(0, (1 - k) * (box.h + 30)); draw(); x.restore();
  }
  function lagWall(x) {
    const bone = css("bone"), { x: wx, y: wy, w, h } = LAGW, cols = 5, rows = 4, cw = w / cols, ch = h / rows;
    x.save(); x.strokeStyle = bone; x.lineWidth = 2.4; x.strokeRect(wx, wy, w, h);
    const r = mulberry32(31);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const cx = wx + i * cw, cy = wy + j * ch;
      x.lineWidth = 1.4; x.strokeRect(cx + 8, cy + 8, cw - 16, ch - 16);
      x.fillStyle = css("ink2"); x.fillRect(cx + 14, cy + 14, 52, 18); x.strokeRect(cx + 14, cy + 14, 52, 18);
      text(x, `${String(Math.floor(r() * 24)).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`, cx + 18, cy + 29, { font: FONT.mono(14, 500), color: css("ash"), texture: true });
    }
    x.restore();
  }
  function drawer(x) {
    const bone = css("bone"), { x: dx, y: dy, w, h } = DRAWER;
    x.save(); x.strokeStyle = bone; x.lineWidth = 2.4; x.strokeRect(dx, dy, w, h);
    x.lineWidth = 1.6; x.strokeRect(dx + 14, dy + 14, w - 28, h / 2 - 20); x.strokeRect(dx + 14, dy + h / 2 + 6, w - 28, h / 2 - 20);
    line(x, dx + w / 2 - 40, dy + h / 2 + 50, dx + w / 2 + 40, dy + h / 2 + 50, 4, bone);
    x.lineWidth = 2.2; x.beginPath(); x.arc(dx + w / 2, dy + 56, 14, 0, Math.PI * 2); x.stroke();
    line(x, dx + w / 2, dy + 56, dx + w / 2, dy + 64, 3, bone);
    x.restore();
  }
  function shelves(x) {
    const bone = css("bone"), { x: sx, y: sy, w, h } = SHELF;
    const r = mulberry32(17);
    x.save(); x.strokeStyle = bone;
    const g = x.createLinearGradient(sx, 0, sx + w, 0);
    g.addColorStop(0, bone); g.addColorStop(0.55, bone); g.addColorStop(1, "rgba(0,0,0,0)");
    x.strokeStyle = g; x.fillStyle = g;
    for (let lvl = 0; lvl < 3; lvl++) {
      const by = sy + (lvl + 1) * (h / 3);
      x.lineWidth = 3; x.beginPath(); x.moveTo(sx, by); x.lineTo(sx + w, by); x.stroke();
      let bx = sx + 6;
      x.lineWidth = 1.3;
      while (bx < sx + w - 20) {
        const bw = 14 + Math.floor(r() * 16), bh = h / 3 - 18 - Math.floor(r() * 26);
        x.strokeRect(bx, by - bh, bw, bh);
        bx += bw + 3 + (r() < 0.12 ? 18 : 0);
      }
    }
    for (let j = 0; j <= 6; j++) { const ux = sx + j * 240; x.lineWidth = 2; x.beginPath(); x.moveTo(ux, sy); x.lineTo(ux, sy + h); x.stroke(); }
    x.restore();
  }
  function tableCard(x, b, a) {
    if (a <= 0) return;
    const { x: px, y: py, w, h } = TABLE;
    sheet(x, px, py, w, h, { alpha: a, shadow: 40 });
    text(x, tr("ch03.legend"), px + 50, py + 96, { font: FONT.cjk(58, 600), alpha: a });
    line(x, px + 44, py + 132, px + w - 44, py + 132, 2, css("pink"), a);
    [["rt", "room"], ["lag", "lag"], ["d1", "d1"], ["cred", "cred"]].forEach(([k, g], i) => {
      const y = py + 250 + i * 230, rk = prog(b, 13.75 + i * 0.25, 13.9 + i * 0.25);
      const hot = k === "rt";
      if (rk > 0) glyph(x, g, px + 120, y + 4, hot ? css("signal") : css("pink"), 0.9 * rk);
      text(x, tr(`ch03.lg.${k}`), px + 230, y, { font: FONT.cjk(52, 600), color: hot ? css("signal") : css("pink"), alpha: a * rk });
      text(x, tr(`ch03.lg.${k}P`), px + w - 50, y, { font: FONT.cjk(46, 600), color: css("graphite"), align: "right", alpha: a * rk });
      text(x, tr(`ch03.lg.${k}W`), px + 230, y + 64, { font: FONT.mono(44, 500), color: css("graphite"), alpha: a * rk, maxW: w - 230 - 50 });
      if (i < 3) line(x, px + 44, y + 126, px + w - 44, y + 126, 1.2, css("pink"), 0.2 * a * rk);
    });
  }

  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill(); e.restore();
  }

  function nar(x, key, px, py, r, a = 1, size = 60, maxW = 1040) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: size, maxW, color: css("bone"), reveal: r, alpha: a });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, 6.5, 0.12), impact(b, 11.0, 0.1));
    cam.zoom *= 1 + 0.018 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: PLATE_RECT });

    const x = plan.begin(); plan.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const d = docs.begin(); docs.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const tp = top.begin(); top.cam(cam);
    const bone = css("bone"), ash = css("ash");
    const inA = b < 6.3 || (b > 7.9 && b < 12.1);
    const inB = b > 5.9 && b < 8.3;
    const inC = b > 11.7;

    const titleA = prog(b, 0.15, 0.8, E.out) * (1 - prog(b, 11.6, 11.9)) * (1 - win(b, 5.95, 6.12, 7.98, 8.2));
    if (titleA > 0) {
      text(x, "03", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: titleA });
      text(x, tr("ch03.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.25, 0.9), alpha: titleA });
      text(x, "workers/api · StateCore → StateHub", 292, 226, { font: FONT.mono(28), color: ash, reveal: prog(b, 0.4, 1.1), alpha: titleA });
      line(x, 110, 262, 110 + 990 * prog(b, 0.3, 1.2, E.outExpo), 262, 1.4, bone, 0.6 * titleA);
    }

    const drawK = prog(b, 0.25, 1.1, E.io);
    const commitFlash = Math.max(0, ...Q.filter((q) => q.t < 99).map((q) => impact(b, q.t, 0.1)));
    lanes(x, prog(b, 0.35, 1.3, E.io), b);
    roomPlan(x, drawK, prog(b, 0.7, 1.2), { ticks: commitFlash });
    if (b > 0.3) queue(x, e, b, f);
    const lampA = keys(b, [[0, 0.85], [0.6, 0.38, E.out]]) + 0.3 * commitFlash + (b > 8.8 && b < 12 ? 0.25 * f.env("kick") : 0);
    glow(e, LAMP[0], LAMP[1], lerp(170, 80, prog(b, 0, 0.6, E.out)), lampA * (1 - prog(b, 11.8, 12.2) * 0.5));
    if (commitFlash > 0.05) glow(e, 858, 560, 60, 0.35 * commitFlash);

    const idA = win(b, 0.95, 1.2, 1.85, 2.05);
    if (idA > 0) {
      leader(x, R.x1, R.y0, 'StateHub · idFromName("global")', 110, -150, { font: FONT.mono(30, 500), alpha: idA });
      text(x, tr("ch03.idNote"), R.x1 + 122, R.y0 - 108, { font: FONT.cjk(30, 600), color: ash, alpha: idA });
    }

    nar(x, "ch03.n1a", 110, 944, prog(b, 0.6, 1.05), win(b, 0.6, 0.7, 1.95, 2.15));
    nar(x, "ch03.n1b", 110, 1024, prog(b, 1.05, 1.5), win(b, 0.6, 0.7, 1.95, 2.15));
    nar(x, "ch03.n2a", 110, 944, prog(b, 2.2, 2.8), win(b, 2.2, 2.3, 4.8, 5.0));
    nar(x, "ch03.n2b", 110, 1024, prog(b, 2.8, 3.4), win(b, 2.2, 2.3, 4.8, 5.0));
    nar(x, "ch03.n3a", 110, 944, prog(b, 5.0, 5.28), win(b, 5.0, 5.1, 5.9, 6.04));
    nar(x, "ch03.n3b", 110, 1024, prog(b, 5.28, 5.6), win(b, 5.0, 5.1, 5.9, 6.04));
    nar(x, "ch03.n4a", 1060, 944, prog(b, 6.3, 6.7), win(b, 6.3, 6.4, 7.85, 8.0));
    nar(x, "ch03.n4b", 1060, 1024, prog(b, 6.7, 7.2), win(b, 6.3, 6.4, 7.85, 8.0));
    nar(x, "ch03.n5a", 110, 944, prog(b, 9.0, 9.4), win(b, 9.0, 9.1, 10.35, 10.5));
    nar(x, "ch03.n5b", 110, 1024, prog(b, 9.4, 9.9), win(b, 9.0, 9.1, 10.35, 10.5));
    nar(x, "ch03.n6a", 110, 944, prog(b, 10.55, 10.85), win(b, 10.55, 10.65, 11.6, 11.75));
    nar(x, "ch03.n6b", 110, 1024, prog(b, 10.85, 11.2), win(b, 10.55, 10.65, 11.6, 11.75));
    if (inC) {
      const na = prog(b, 12.2, 12.3);
      nar(x, "ch03.n7a", 330, 1542, prog(b, 12.3, 12.9), na, 91, 2600);
      nar(x, "ch03.n7b", 330, 1666, prog(b, 12.9, 13.5), na, 91, 2600);
    }

    const ledA = win(b, 2.0, 2.2, 5.8, 5.98) + win(b, 8.15, 8.35, 11.6, 11.8);
    if (ledA > 0) {
      ledgerCard(d, b, ledA);
      callout(x, BOOK[0], BOOK[1], 66, LED.x, LED.y + 250, ledA);
    }
    const heroA = win(b, 5.05, 5.2, 5.8, 5.98);
    if (heroA > 0) {
      slipCard(d, SLP, heroRows(prog(b, 5.12, 5.4), 0), heroA * E.outBack(prog(b, 5.05, 5.2)));
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, heroA);
    }
    const hbA = win(b, 9.05, 9.2, 10.35, 10.5);
    if (hbA > 0) {
      slipCard(d, SLP, { event: { sub: tr("ch03.fx.noPush") }, tags: { sub: tr("ch03.fx.noTags2") } }, hbA, { empty: true });
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, hbA);
    }
    const flA = win(b, 10.55, 10.7, 11.6, 11.8);
    if (flA > 0) {
      slipCard(d, SLP, flipRows(prog(b, 10.6, 10.9), prog(b, 11.0, 11.08), prog(b, 11.06, 11.14)), flA);
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, flA);
    }
    if (b >= 5.1 && b < 8.2) {
      const k1 = prog(b, 5.8, 6.0, E.in), k2 = prog(b, 6.0, 6.24, E.out);
      const p = k2 > 0 ? [lerp(R.x1 - 10, BOOTH.x + 70, k2), lerp(580, 580, k2)] : [lerp(TRAY[0], R.x1 - 10, k1), lerp(TRAY[1], 580, k1)];
      tinySlip(d, p[0], p[1], prog(b, 5.1, 5.2) * (1 - prog(b, 7.95, 8.1)), prog(b, 6.5, 6.6));
    }
    if (b >= 9.05 && b < 10.45) tinySlip(d, TRAY[0], TRAY[1], hbA);
    if (b >= 10.6 && b < 11.3) {
      const k1 = prog(b, 10.8, 11.0, E.in);
      tinySlip(d, lerp(TRAY[0], R.x1 + 40, k1), lerp(TRAY[1], 580, k1), prog(b, 10.6, 10.7) * (1 - prog(b, 11.0, 11.1)));
    }

    const outA = Math.max(win(b, 6.0, 6.14, 7.95, 8.15), prog(b, 11.8, 12.1));
    booth(x, outA);
    const ringAt = b >= 10.95 ? 11.0 : b >= 6.45 ? 6.5 : null;
    const pulse = ringAt != null ? Math.exp(-(b - ringAt) * BARs * 1.8) : 0;
    mast(x, Math.max(outA, ringAt === 11.0 ? 1 : 0) * (inC || inB ? 1 : 0), pulse);
    if (ringAt != null && b < (ringAt === 6.5 ? 8.2 : 12.2)) {
      const RR = rings(e, x, ringAt, b, ringAt === 6.5 ? 1500 : 1900);
      if (ringAt === 6.5) PAGES.forEach(([px, py], i) => {
        const dist = Math.hypot(px + 85 - MAST[0], py + 50 - MAST[1]);
        const lit = clamp((RR - dist) / 260);
        page(x, px, py, lit, win(b, 6.05, 6.2, 7.95, 8.15));
        if (lit > 0 && lit < 1) glow(e, px + 85, py + 50, 140, 0.4 * (1 - lit));
      });
    } else if (inB) PAGES.forEach(([px, py]) => page(x, px, py, 0, win(b, 6.05, 6.2, 7.95, 8.15)));
    if (inB) {
      const bA = win(b, 6.0, 6.2, 7.9, 8.1);
      text(x, "StateCore", BOOTH.x + BOOTH.w / 2, BOOTH.y + BOOTH.h + 46, { font: FONT.mono(30, 500), color: bone, align: "center", alpha: bA });
      text(x, tr("ch03.coreNote"), BOOTH.x + BOOTH.w / 2, BOOTH.y + BOOTH.h + 88, { font: FONT.cjk(30, 600), color: ash, align: "center", alpha: bA });
      text(x, "LivePushRoom", MAST[0] + 44, MAST[1] + 10, { font: FONT.mono(30, 500), color: bone, alpha: bA });
      text(x, tr("ch03.pushNote"), MAST[0] + 44, MAST[1] + 52, { font: FONT.cjk(28, 600), color: ash, alpha: bA });
      text(x, tr("ch03.pages"), PAGES[0][0], PAGES[0][1] - 26, { font: FONT.cjk(30, 600), color: bone, alpha: bA });
      slipCard(d, SLIPB, heroRows(1, prog(b, 6.5, 6.6)), win(b, 6.08, 6.24, 7.9, 8.1));
      if (b > 6.0) callout(x, BOOTH.x + 70, 580, 36, SLIPB.x + 30, SLIPB.y + SLIPB.h, win(b, 6.05, 6.2, 7.9, 8.1));
      stamp(s, "waitUntil", SLIPB.x + SLIPB.w - 170, SLIPB.y + 118, { k: prog(b, 6.5, 6.62), px: 54, rot: -0.08, alpha: 1 - prog(b, 7.9, 8.1) });
      const fa = 1 - prog(b, 7.9, 8.1);
      arrowPath(x, [[BOOTH.x + BOOTH.w, 600], [MAST[0] - 30, MAST[1] - 16]], prog(b, 6.5, 6.7, E.out), css("signalD"), fa);
      arrowPath(x, [[BOOTH.x + 20, BOOTH.y], RECEIPT[1], [940, 300]], prog(b, 6.5, 7.1, E.io), css("signalD"), fa);
      const rk = prog(b, 6.5, 7.6, E.io);
      if (rk > 0 && rk < 1) {
        const [rx, ry] = pathAt(RECEIPT, rk * pathLen(RECEIPT));
        sheet(d, rx - 100, ry - 34, 200, 64, { alpha: 1, shadow: 18 });
        text(d, "ok · data", rx, ry + 10, { font: FONT.mono(30, 600), align: "center" });
      }
      const la = win(b, 6.6, 6.8, 7.9, 8.1), na = win(b, 6.9, 7.1, 7.9, 8.1);
      text(x, tr("ch03.back"), 1000, 164, { font: FONT.cjk(34, 600), color: css("signalD"), alpha: la });
      text(x, tr("ch03.backNote1"), 1000, 212, { font: FONT.cjk(28, 600), color: ash, alpha: na });
      text(x, tr("ch03.backNote2"), 1000, 252, { font: FONT.cjk(28, 600), color: ash, alpha: na });
      const pa = win(b, 6.52, 6.7, 7.7, 7.95);
      if (pa > 0) text(x, "‖ " + tr("ch03.parallel") + " ‖", 1346, 578, { font: FONT.cjk(38, 600), color: css("signalD"), alpha: pa });
    }

    const cin = prog(b, 9.35, 9.6), cout = prog(b, 10.2, 10.4);
    if (cin > 0 && cout < 1) {
      const hop = Math.sin(cin * Math.PI) * 50 * (1 - cin) + Math.sin(cout * Math.PI) * 50;
      clawd(tp, 1000, 470 - hop, 6, { pose: cin < 1 || cout > 0 ? "arms-up" : "default" });
      bubble(tp, tr("ch03.clawd"), 960, 404 - hop * 0.3, { px: 32, k: prog(b, 9.6, 9.75) * (1 - prog(b, 10.1, 10.2)), reveal: prog(b, 9.6, 10.0), tail: "right" });
    }

    if (inC) {
      const gA = prog(b, 11.9, 12.1);
      line(x, 250, GROUND, TABLE.x, GROUND, 1.6, bone, 0.6 * gA);
      rise(x, prog(b, 12.0, 12.35, E.outBack), LAGW, () => lagWall(x));
      rise(x, prog(b, 12.25, 12.6, E.outBack), DRAWER, () => drawer(x));
      rise(x, prog(b, 12.5, 12.85, E.outBack), SHELF, () => shelves(x));
      const lab = (k1, k2, lx, t0) => {
        const a = prog(b, t0, t0 + 0.2);
        text(x, tr(k1), lx, GROUND + 72, { font: FONT.cjk(46, 600), color: bone, alpha: a });
        text(x, k2, lx, GROUND + 130, { font: FONT.mono(44, 500), color: ash, alpha: a });
      };
      lab("ch03.lg.lag", "KV LAG", LAGW.x, 12.4);
      lab("ch03.lg.cred", "KV CREDENTIALS", DRAWER.x, 12.65);
      lab("ch03.lg.d1", "D1 · lyjwpage-history", SHELF.x, 12.9);
      const ra = prog(b, 12.1, 12.3);
      text(x, tr("ch03.lg.rt") + " · StateHub", R.x0, R.y0 - 40, { font: FONT.cjk(46, 600), color: css("signalD"), alpha: ra });
      text(x, "LivePushRoom", MAST[0] - 44, MAST[1] + 14, { font: FONT.mono(44, 500), color: bone, align: "right", alpha: ra });
      text(x, "StateCore", BOOTH.x + BOOTH.w / 2, BOOTH.y - 30, { font: FONT.mono(44, 500), color: bone, align: "center", alpha: ra });
      const fa = prog(b, 14.6, 14.9);
      if (fa > 0) {
        polyline(x, [[R.x0 + 330, R.y1 + 4], [R.x0 + 330, 942], [SHELF.x + 120, 942], [SHELF.x + 120, SHELF.y - 8]], prog(b, 14.6, 15.0, E.io), 1.8, css("signalD"), 0.9);
        text(x, tr("ch03.pulse7a"), R.x0 + 360, 876, { font: FONT.cjk(42, 600), color: css("signalD"), alpha: fa });
        text(x, tr("ch03.pulse7b"), R.x0 + 360, 926, { font: FONT.cjk(42, 600), color: css("signalD"), alpha: fa });
      }
      tableCard(d, b, prog(b, 13.5, 13.75, E.out));
      const pk = prog(b, 15.0, 15.3, E.out) * (1 - prog(b, 15.45, 15.6));
      if (pk > 0) {
        x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0);
        rect(x, 24, 24, G.W - 48, G.H - 48, 2.4, bone, 0.8 * pk);
        text(x, "PLATE 03 · STATE CORE", G.W - 60, 884, { font: FONT.mono(30, 600), color: bone, align: "right", alpha: pk });
        x.restore();
      }
    }

    G.composite(plan.upload(), { mode: G.MODE.ink, seed: 5.3 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.6 });
    G.composite(docs.upload(), { mode: G.MODE.paper });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 2.9 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 7;
    f.post = {
      bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      fade: 1 - prog(b, 0, 0.25),
      flash: impact(b, 6.5, 0.1) * 0.05 + impact(b, 11.0, 0.1) * 0.05, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch03", title: "ch.03", bars: 16,
    init() { plate = G.pass(K.PLATE.ink); plan = G.layer("ink"); emit = G.layer("emit", 0.5); docs = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
