// 第 03 章 · 一间屋子的账房（状态核心 StateCore + StateHub，FACTS §3）。16 小节，暗底平面图 + 白卡详图，全是 2D。
// 一张暗底图纸，三个机位，镜头只在强拍上甩（第 02 章的做法）：
//   A 屋里（0–6、8.2–11.75）：左边两路汇成一队，中间一间屋子的平面图（门洞、一张桌、一把椅子、一盏灯、右墙一道缝），
//     右栏两张白卡详图：账本（一封一行）和「要做的事」（event / listening / tags 三行：DO 只交回这三种，ingest-effects.ts:25-28）
//   B 门外（6–8）：纸条从墙缝递到 StateCore 岗亭；6:2 盖「waitUntil」章，同一拍天线荡开橙色环、回执飞回入口
//   C 拉远（12–16）：可滞后墙、凭据抽屉、D1 档案架从地平线升起，右边「四个库」对照表
// 配乐锚点（score.js，章内 小节:拍）：0:0 落地、2–5 每拍一封、6:0 递出、6:2 广播 + 印章、9–11 心跳半速、
// 11:0 在线翻转、11:3 吸气、12:0 拉远、15:0 终和弦。改时间先对这张表，score.js 不用动。
// 时间一律写章节内的小节（b），5.5 即第 5 小节第 2 拍。坐标是世界坐标（机位 A 时和屏幕一一对应）。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, envelope, stamp, clawd, bubble, spark,
    roundRect, glyph, sheet, checkbox, leader, pathAt, pathLen, mulberry32 } = K;
  const tr = (k) => I18N.tr(k);
  let plate, plan, emit, docs, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出

  // ---------- 机位：[小节, [x, y, zoom, rot], 进入这一段的缓动] ----------
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
    [16.0, [1630, 958, 0.676, 0], E.lin],
  ];
  const PLATE_RECT = [-800, -400, 3400, 2000];

  // ---------- 布局（世界坐标） ----------
  const R = { x0: 520, y0: 330, x1: 1080, y1: 830, t: 24 }; // 屋子外墙
  const DOOR = { y0: 540, y1: 640 }; // 左墙门洞
  const SLOT = { y0: 566, y1: 594 }; // 右墙墙缝：「要做的事」从这里递出去
  const DESK = { x: 700, y: 480, w: 260, h: 120 };
  const BOOK = [830, 540], LAMP = [930, 506], TRAY = [930, 570];
  const LANE_Y = 590, MERGE = [250, LANE_Y], FRONT = [490, LANE_Y];
  const FEED = { ingress: [[-900, 400], [110, 400], MERGE], collector: [[-900, 780], [110, 780], MERGE] };
  const PATHS = {}, FRONT_D = {}, BOOK_D = {};
  for (const via in FEED) {
    const pre = [...FEED[via], FRONT];
    PATHS[via] = [...pre, [R.x0 + R.t + 40, LANE_Y], [BOOK[0] - 90, BOOK[1] + 20], BOOK];
    FRONT_D[via] = pathLen(pre);
    BOOK_D[via] = pathLen(PATHS[via]);
  }
  const GAP = 78; // 队里相邻两封的间距
  const LED = { x: 1180, y: 70, w: 690, h: 400, rows: 5, lh: 48 }; // 右栏：账本详图
  const SLP = { x: 1180, y: 500, w: 690, h: 360 }; // 右栏：「要做的事」详图
  const BOOTH = { x: 1150, y: 500, w: 160, h: 160 }; // 门外 StateCore 岗亭
  const MAST = [1740, 780]; // LivePushRoom 的天线
  const PAGES = [330, 470, 610, 750].map((y) => [2560, y]); // 所有开着的页面
  const SLIPB = { x: 1560, y: 80, w: 720, h: 360 }; // 门外那张「要做的事」详图
  const RECEIPT = [[1150, 520], [1110, 300], [-500, 300]];
  // C：另外三个库和对照表
  const LAGW = { x: 285, y: 960, w: 460, h: 330 }, DRAWER = { x: 820, y: 1060, w: 300, h: 230 }, SHELF = { x: 1260, y: 960, w: 1440, h: 330 };
  const GROUND = 1290;
  const TABLE = { x: 2012, y: 224, w: 970, h: 1166 };

  // ---------- 进屋的顺序：t = 落账的小节；采集 Worker 那一路只送 PlayStation（PSN），其余走上报入口 ----------
  const Q = [
    ["mac", "desktop"], ["homepod", "nowPlaying"], ["emby", "watching"], ["mac", "chargingDevices"],
    ["playstation", "playing"], ["mac", "vibeCodingNow"], ["agents", "cursor"], ["iphone", "activity"],
    ["mac", "desktop"], ["homepod", "nowPlaying"], ["mac", "chargingDevices"], ["emby", "watching"],
  ].map(([src, what], i) => ({ t: 2 + i * 0.25, src, what }));
  Q.push({ t: 5.0, src: "mac", what: "appleMusic", hero: true }); // 这一封就是片子跟着的那封：换歌
  Q.push({ t: 8.25, src: "playstation", what: "playing" }, { t: 8.5, src: "emby", what: "watching" });
  Q.push({ t: 9.0, src: "mac", whatKey: "ch03.hbRow", heart: true, dim: true }); // 纯心跳
  Q.push({ t: 10.5, src: "mac", whatKey: "ch03.flipRow", flip: true }); // 在线 → 离线
  for (const [src, what] of [["homepod", "nowPlaying"], ["mac", "desktop"], ["agents", "cursor"], ["playstation", "playing"], ["mac", "chargingDevices"], ["iphone", "activity"], ["emby", "watching"], ["mac", "desktop"]]) Q.push({ t: Infinity, src, what });
  Q.forEach((q) => (q.via = q.src === "playstation" ? "collector" : "ingress"));
  const HERO = Q.findIndex((q) => q.hero), HB = Q.findIndex((q) => q.heart), FLIP = Q.findIndex((q) => q.flip);

  // 队伍往前挪了几格（每封落账前 0.2 小节开始挪）；开场时整队从左边走进画面
  const moved = (b) => Q.reduce((s, q) => s + E.io(prog(b, q.t - 0.2, q.t)), 0);
  const arrive = (b) => (1 - E.out(prog(b, 0.15, 1.9))) * 11;
  function queuePos(i, q) {
    const via = Q[i].via, pts = PATHS[via];
    if (q >= 0) return pathAt(pts, FRONT_D[via] - q * GAP);
    return pathAt(pts, FRONT_D[via] + -q * (BOOK_D[via] - FRONT_D[via]));
  }

  // ---------- 画：屋子的平面图 ----------
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
    // 墙：外沿、内沿各一笔，按进度画出来；门洞和墙缝两边封口
    polyline(x, [[x0, DOOR.y0], [x0, y0], [x1, y0], [x1, SLOT.y0]], k, 2.6, bone);
    polyline(x, [[x1, SLOT.y1], [x1, y1], [x0, y1], [x0, DOOR.y1]], k, 2.6, bone);
    polyline(x, [[x0 + t, DOOR.y0], [x0 + t, y0 + t], [x1 - t, y0 + t], [x1 - t, SLOT.y0]], k, 1.6, bone);
    polyline(x, [[x1 - t, SLOT.y1], [x1 - t, y1 - t], [x0 + t, y1 - t], [x0 + t, DOOR.y1]], k, 1.6, bone);
    if (k >= 1) {
      for (const [ax, ay, bx] of [[x0, DOOR.y0, x0 + t], [x0, DOOR.y1, x0 + t], [x1 - t, SLOT.y0, x1], [x1 - t, SLOT.y1, x1]]) line(x, ax, ay, bx, ay, 1.6, bone);
    }
    // 墙体剖切：斜线
    if (hatchA > 0) {
      x.save(); x.beginPath();
      for (const [rx, ry, rw, rh] of wallRects()) x.rect(rx, ry, rw, rh);
      x.clip(); x.globalAlpha = 0.55 * hatchA; x.strokeStyle = bone; x.lineWidth = 1.1; x.beginPath();
      for (let s = x0 + y0 - 20; s < x1 + y1 + 20; s += 11) { x.moveTo(s - y0, y0); x.lineTo(s - y1, y1); }
      x.stroke(); x.restore();
    }
    const fk = prog(k, 0.55, 1);
    if (fk <= 0) return;
    // 门：门扇开到 90°，四分之一圆弧是它扫过的地方（平面图的画法）
    x.save(); x.globalAlpha = fk; x.strokeStyle = bone;
    x.lineWidth = 2.4; x.beginPath(); x.moveTo(x0 + t, DOOR.y1); x.lineTo(x0 + t + 100, DOOR.y1); x.stroke();
    x.setLineDash([5, 6]); x.lineWidth = 1.2; x.beginPath(); x.arc(x0 + t, DOOR.y1, 100, -Math.PI / 2, 0); x.stroke();
    x.restore();
    // 桌、椅、账本、灯、放纸条的小托盘
    x.save(); x.globalAlpha = fk;
    x.fillStyle = css("ink2"); x.fillRect(DESK.x, DESK.y, DESK.w, DESK.h);
    x.strokeStyle = bone; x.lineWidth = 2.2; x.strokeRect(DESK.x, DESK.y, DESK.w, DESK.h);
    // 一把椅子：同一时刻只有一个人在记
    x.lineWidth = 1.8; roundRect(x, 800, 432, 60, 40, 6); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.moveTo(804, 428); x.lineTo(856, 428); x.stroke();
    // 摊开的账本
    x.lineWidth = 1.8; x.fillStyle = css("paper"); x.globalAlpha = fk * 0.92;
    x.fillRect(772, 512, 116, 60); x.globalAlpha = fk;
    x.strokeStyle = css("pink"); x.strokeRect(772, 512, 116, 60); line(x, 830, 512, 830, 572, 1.4, css("pink"));
    for (let j = 0; j < 4; j++) { line(x, 780, 524 + j * 12, 822, 524 + j * 12, 1, css("pink"), 0.5); line(x, 838, 524 + j * 12, 880, 524 + j * 12, 1, css("pink"), 0.5); }
    x.strokeStyle = bone; x.lineWidth = 1.8;
    x.beginPath(); x.arc(LAMP[0], LAMP[1], 11, 0, Math.PI * 2); x.stroke();
    line(x, LAMP[0] - 16, LAMP[1], LAMP[0] + 16, LAMP[1], 1.2, bone); line(x, LAMP[0], LAMP[1] - 16, LAMP[0], LAMP[1] + 16, 1.2, bone);
    x.strokeRect(TRAY[0] - 22, TRAY[1] - 14, 44, 28);
    x.restore();
    if (o.ticks) { // 账本上刚写的那一行闪一下
      const p = o.ticks;
      if (p > 0.02) fillRect(x, 838, 524 + 3 * 12 - 3, 42, 6, css("signalD"), p);
    }
  }

  // 两路进口和一段排队栏杆
  function lanes(x, k, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(k, 0, 0.4);
    for (const via of ["ingress", "collector"]) {
      const [, p1, p2] = FEED[via];
      polyline(x, [[-40, p1[1]], p1, p2, FRONT], k, 1.4, bone, 0.55);
      // 箭头：在斜线中段
      const mx = lerp(p1[0], p2[0], 0.55), my = lerp(p1[1], p2[1], 0.55), d = Math.sign(p2[1] - p1[1]);
      if (k >= 1) polyline(x, [[mx - 14, my - 2 * d], [mx + 2, my + 12 * d - 2 * d], [mx + 12, my - 8 * d]], 1, 1.6, bone, 0.7);
    }
    const la = a * (1 - prog(b, 11.6, 11.85)); // 拉远时这两个字会被画面左边切掉，先收起来
    text(x, tr("ch03.feed.ingress"), 44, 356, { font: FONT.cjk(30, 600), color: ash, alpha: la });
    text(x, tr("ch03.feed.collector"), 44, 836, { font: FONT.cjk(30, 600), color: ash, alpha: la });
    // 栏杆：两排立柱拉绳，只有一条队
    const posts = [280, 360, 440, 510];
    for (const y of [546, 634]) {
      polyline(x, [[posts[0], y], [posts[posts.length - 1], y]], k, 1.2, bone, 0.45);
      posts.forEach((px, j) => { if (k > j / posts.length) { x.save(); x.globalAlpha = 0.7; x.fillStyle = bone; x.beginPath(); x.arc(px, y, 4.5, 0, Math.PI * 2); x.fill(); x.restore(); } });
    }
    // 这条队在代码里就是 StateHub 的一条 Promise 链：前一封提交完，下一封才开始
    text(x, "state-hub.ts · ingestTail", R.x0 + R.t + 22, R.y1 - R.t - 26, { font: FONT.mono(28, 500), color: ash, alpha: prog(b, 2.3, 2.7) * la });
  }

  function heart(x, cx, cy, s, color, alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(cx, cy + s * 0.35);
    x.bezierCurveTo(cx - s, cy - s * 0.35, cx - s * 0.45, cy - s, cx, cy - s * 0.45);
    x.bezierCurveTo(cx + s * 0.45, cy - s, cx + s, cy - s * 0.35, cx, cy + s * 0.35);
    x.fill(); x.restore();
  }

  // 队里的信封：还没落账的，按前面还剩几封排；正在进门的沿路走到账本上，落账那一刻消失
  function queue(x, e, b, f) {
    const mv = moved(b), arr = arrive(b);
    for (let i = Q.length - 1; i >= 0; i--) {
      const qq = Q[i];
      const q = i - mv + arr;
      if (q <= -1 || b >= qq.t) continue;
      const [px, py] = queuePos(i, q);
      if (px < -80) continue;
      // 翻转那封排队时和别的信封一样，轮到它的前半小节才亮
      const near = b > qq.t - 0.5;
      const hot = qq.hero || (qq.flip && near);
      const col = hot ? css("signalD") : css("bone");
      const w = 58;
      // 心跳那封跟着底鼓一下一下跳
      const beat = qq.heart && b > 8.8 ? f.env("kick") : 0;
      envelope(x, px, py, w * (1 + 0.12 * beat), col, { lw: 2.2, fill: css("ink2"), alpha: clamp((px + 80) / 120) });
      if (qq.heart) heart(x, px, py + 4, 9 * (1 + 0.25 * beat), css("signalD"));
      if (qq.hero && e) spark(e, null, [px, py - 6], null, { t: G.t, size: 0.75 });
      // 标签：主角、心跳、翻转三封在轮到它们的前半小节才标出来，跟着信封进门，快到账本时收起
      const lab = qq.hero ? "mac · appleMusic" : qq.heart ? tr("ch03.hbTag") : qq.flip ? "mac · presence" : null;
      if (lab && near) text(x, lab, px, py - 58, { font: FONT.mono(28, 500), color: hot ? css("signalD") : css("ash"), align: "center", alpha: prog(b, qq.t - 0.5, qq.t - 0.4) * (1 - prog(q, -0.55, -0.85)) });
    }
  }

  // ---------- 右栏白卡：账本、「要做的事」 ----------
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
      text(x, String(i + 1).padStart(2, "0"), px + 32, y, { font: FONT.mono(26), color: css("graphite"), alpha: a * k });
      text(x, c.src, px + 92, y, { font: FONT.mono(30, 500), color: col, alpha: a * k });
      const what = c.whatKey ? tr(c.whatKey) : c.what;
      if (c.heart) heart(x, px + 328, y - 10, 12, css("signal"), a * k);
      text(x, what, px + (c.heart ? 350 : 316), y, { font: c.whatKey ? FONT.cjk(30, 600) : FONT.mono(30, 500), color: col, alpha: a, reveal: k, perChar: true, maxW: w - (c.heart ? 350 : 316) - 80 });
      polyline(x, [[px + w - 62, y - 12], [px + w - 52, y - 2], [px + w - 34, y - 24]], clamp((b - c.t - 0.04) / 0.08), 4, css("signal"), a);
      line(x, px + 28, y + 16, px + w - 28, y + 16, 1, css("pink"), 0.16 * a);
    }
    x.restore();
  }

  // 「要做的事」：固定三行（event / listening / tags），写上的行有字，打勾 = 门外照办了
  function slipCard(x, box, rows, a, o = {}) {
    if (a <= 0) return;
    const { x: px, y: py, w, h } = box;
    sheet(x, px, py, w, h, { alpha: a, rot: o.rot || 0 });
    x.save(); x.translate(px, py); x.rotate(o.rot || 0); x.translate(-px, -py);
    text(x, tr("ch03.slip"), px + 32, py + 58, { font: FONT.cjk(38, 600), alpha: a });
    if (o.empty) text(x, tr("ch03.fx.empty"), px + 32 + K.measure(x, tr("ch03.slip"), FONT.cjk(38, 600)) + 14, py + 58, { font: FONT.cjk(38, 600), color: css("graphite"), alpha: a });
    text(x, "ingest-effects.ts", px + w - 32, py + 56, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: a });
    line(x, px + 28, py + 78, px + w - 28, py + 78, 1.4, css("pink"), a);
    ["event", "listening", "tags"].forEach((kind, i) => {
      const r = rows[kind] || {};
      const y = py + 132 + i * 84;
      const on = r.s != null;
      const wk = r.write ?? 1; // 这一行写出来的进度
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
    tags: { s: tr("ch03.fx.tags3"), sub: tr("ch03.fx.tags3Sub"), write, tick: t2 },
  });

  // 引出详图的虚线圈和虚线
  function callout(x, cx, cy, r, tx, ty, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = 0.75 * a; x.strokeStyle = css("bone"); x.lineWidth = 1.4; x.setLineDash([6, 6]);
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    const ang = Math.atan2(ty - cy, tx - cx);
    x.beginPath(); x.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); x.lineTo(tx, ty); x.stroke();
    x.restore();
  }

  // 手边的小纸条（平面图里的实物）：桌上托盘 → 墙缝 → 门外岗亭
  function tinySlip(x, px, py, a, tickK = 0) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(px, py);
    x.fillStyle = css("paper"); x.fillRect(-18, -12, 36, 24);
    x.strokeStyle = css("pink"); x.lineWidth = 1.4; x.strokeRect(-18, -12, 36, 24);
    for (let j = 0; j < 3; j++) line(x, -12, -5 + j * 6, 8, -5 + j * 6, 1, css("pink"), 0.6);
    x.restore();
    if (tickK > 0) polyline(x, [[px + 6, py], [px + 10, py + 5], [px + 18, py - 7]], tickK, 2.4, css("signal"), a);
  }

  // ---------- 门外：岗亭、天线、页面、回执 ----------
  function booth(x, a) {
    if (a <= 0) return;
    const bone = css("bone");
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink2"); x.fillRect(BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h);
    x.strokeStyle = bone; x.lineWidth = 2.4; x.strokeRect(BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h);
    x.lineWidth = 1.4; x.strokeRect(BOOTH.x + 14, BOOTH.y + 14, BOOTH.w - 28, BOOTH.h - 28);
    // 对着墙缝的窗口（柜台）
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
    // 发射时三道短弧
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
    // 卡片：收到推送时翻一下（压扁再弹开，2D）
    const flipS = lit > 0 && lit < 1 ? Math.abs(Math.cos(lit * Math.PI)) : 1;
    x.translate(px + 85, py + 60); x.scale(1, flipS);
    x.strokeStyle = col; x.lineWidth = 1.6; x.strokeRect(-60, -24, 120, 48);
    if (lit >= 0.5) { x.fillStyle = css("signalD"); x.globalAlpha = a * 0.9; x.fillRect(-48, -10, 70, 6); x.fillRect(-48, 4, 44, 6); }
    else { x.fillStyle = css("bone"); x.globalAlpha = a * 0.45; x.fillRect(-48, -10, 60, 6); x.fillRect(-48, 4, 36, 6); }
    x.restore();
    if (lit >= 0.5) text(x, "listening-now", px + 85, py + 124, { font: FONT.mono(22, 500), color: css("signalD"), align: "center", alpha: a * prog(lit, 0.5, 0.8) });
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
  // 带箭头的虚线（画到 k）：门外那两条同时出发的路
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

  // ---------- C：另外三个库，从地平线升起（平移 + 裁到地面以上） ----------
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
      // 时间签
      x.fillStyle = css("ink2"); x.fillRect(cx + 14, cy + 14, 52, 18); x.strokeRect(cx + 14, cy + 14, 52, 18);
      text(x, `${String(Math.floor(r() * 24)).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`, cx + 18, cy + 29, { font: FONT.mono(14, 500), color: css("ash") });
    }
    x.restore();
  }
  function drawer(x) {
    const bone = css("bone"), { x: dx, y: dy, w, h } = DRAWER;
    x.save(); x.strokeStyle = bone; x.lineWidth = 2.4; x.strokeRect(dx, dy, w, h);
    x.lineWidth = 1.6; x.strokeRect(dx + 14, dy + 14, w - 28, h / 2 - 20); x.strokeRect(dx + 14, dy + h / 2 + 6, w - 28, h / 2 - 20);
    line(x, dx + w / 2 - 40, dy + h / 2 + 50, dx + w / 2 + 40, dy + h / 2 + 50, 4, bone);
    // 上面那格带锁
    x.lineWidth = 2.2; x.beginPath(); x.arc(dx + w / 2, dy + 56, 14, 0, Math.PI * 2); x.stroke();
    line(x, dx + w / 2, dy + 56, dx + w / 2, dy + 64, 3, bone);
    x.restore();
  }
  function shelves(x) {
    const bone = css("bone"), { x: sx, y: sy, w, h } = SHELF;
    const r = mulberry32(17);
    x.save(); x.strokeStyle = bone;
    // 往右越来越淡：望不到头
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

  // 旁白：大字，逐字亮起；排在画面里，不是字幕
  function nar(x, key, px, py, r, a = 1, size = 60, maxW = 1040) {
    if (a <= 0) return;
    text(x, tr(key), px, py, { maxW, font: FONT.cjk(size, 600), color: css("bone"), reveal: r, dim: 0.14, perChar: true, alpha: a });
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

    // ---- 标题（机位 A 一直在，拉远时淡出） ----
    // 机位 B 时标题的尾巴会从画面左边露出来，先收起来
    const titleA = prog(b, 0.15, 0.8, E.out) * (1 - prog(b, 11.6, 11.9)) * (1 - win(b, 5.95, 6.12, 7.98, 8.2));
    if (titleA > 0) {
      text(x, "03", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: titleA });
      text(x, tr("ch03.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.25, 0.9), alpha: titleA });
      text(x, "workers/api · StateCore → StateHub", 292, 226, { font: FONT.mono(28), color: ash, reveal: prog(b, 0.4, 1.1), alpha: titleA });
      line(x, 110, 262, 110 + 990 * prog(b, 0.3, 1.2, E.outExpo), 262, 1.4, bone, 0.6 * titleA);
    }

    // ---- 平面图：屋子、两路进口、队伍 ----
    const drawK = prog(b, 0.25, 1.1, E.io);
    const commitFlash = Math.max(0, ...Q.filter((q) => q.t < 99).map((q) => impact(b, q.t, 0.1)));
    lanes(x, prog(b, 0.35, 1.3, E.io), b);
    roomPlan(x, drawK, prog(b, 0.7, 1.2), { ticks: commitFlash });
    if (b > 0.3) queue(x, e, b, f);
    // 灯：开场先在黑里亮起来（接第 02 章冲进去的那盏灯），每落一笔账亮一下；心跳段跟着扑通
    const lampA = keys(b, [[0, 0.85], [0.6, 0.38, E.out]]) + 0.3 * commitFlash + (b > 8.8 && b < 12 ? 0.25 * f.env("kick") : 0);
    glow(e, LAMP[0], LAMP[1], lerp(170, 80, prog(b, 0, 0.6, E.out)), lampA * (1 - prog(b, 11.8, 12.2) * 0.5));
    if (commitFlash > 0.05) glow(e, 858, 560, 60, 0.35 * commitFlash);

    // ---- StateHub 只有一个：开场的标注 ----
    const idA = win(b, 0.95, 1.2, 1.85, 2.05);
    if (idA > 0) {
      leader(x, R.x1, R.y0, 'StateHub · idFromName("global")', 110, -150, { font: FONT.mono(30, 500), alpha: idA });
      text(x, tr("ch03.idNote"), R.x1 + 122, R.y0 - 108, { font: FONT.cjk(30, 600), color: ash, alpha: idA });
    }

    // ---- 旁白（A 机位左下；B 机位门外左下；C 拉远后放大排在左下） ----
    nar(x, "ch03.n1a", 110, 944, prog(b, 0.6, 1.2), win(b, 0.6, 0.7, 1.95, 2.15));
    nar(x, "ch03.n1b", 110, 1024, prog(b, 1.2, 1.7), win(b, 0.6, 0.7, 1.95, 2.15));
    nar(x, "ch03.n2a", 110, 944, prog(b, 2.2, 2.8), win(b, 2.2, 2.3, 4.8, 5.0));
    nar(x, "ch03.n2b", 110, 1024, prog(b, 2.8, 3.4), win(b, 2.2, 2.3, 4.8, 5.0));
    nar(x, "ch03.n3a", 110, 944, prog(b, 5.0, 5.4), win(b, 5.0, 5.1, 5.88, 6.04));
    nar(x, "ch03.n3b", 110, 1024, prog(b, 5.4, 5.85), win(b, 5.0, 5.1, 5.88, 6.04));
    nar(x, "ch03.n4a", 1060, 944, prog(b, 6.3, 6.7), win(b, 6.3, 6.4, 7.85, 8.0));
    nar(x, "ch03.n4b", 1060, 1024, prog(b, 6.7, 7.2), win(b, 6.3, 6.4, 7.85, 8.0));
    nar(x, "ch03.n5a", 110, 944, prog(b, 9.0, 9.4), win(b, 9.0, 9.1, 10.35, 10.5));
    nar(x, "ch03.n5b", 110, 1024, prog(b, 9.4, 9.9), win(b, 9.0, 9.1, 10.35, 10.5));
    nar(x, "ch03.n6a", 110, 944, prog(b, 10.55, 10.9), win(b, 10.55, 10.65, 11.6, 11.75));
    nar(x, "ch03.n6b", 110, 1024, prog(b, 10.9, 11.4), win(b, 10.55, 10.65, 11.6, 11.75));
    if (inC) {
      const na = prog(b, 12.2, 12.3);
      nar(x, "ch03.n7a", 330, 1542, prog(b, 12.3, 12.9), na, 91, 2600);
      nar(x, "ch03.n7b", 330, 1666, prog(b, 12.9, 13.5), na, 91, 2600);
    }

    // ---- 右栏详图：账本（2–6、8.2–11.75）、「要做的事」 ----
    const ledA = win(b, 2.0, 2.2, 5.8, 5.98) + win(b, 8.15, 8.35, 11.6, 11.8);
    if (ledA > 0) {
      ledgerCard(d, b, ledA);
      callout(x, BOOK[0], BOOK[1], 66, LED.x, LED.y + 250, ledA);
    }
    // 换歌那封：5:0 落账，写出 listening 一行（查 Apple 目录后广播），tags 这次空着
    const heroA = win(b, 5.05, 5.2, 5.8, 5.98);
    if (heroA > 0) {
      slipCard(d, SLP, heroRows(prog(b, 5.12, 5.4), 0), heroA * E.outBack(prog(b, 5.05, 5.2)));
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, heroA);
    }
    // 纯心跳：什么也不用做
    const hbA = win(b, 9.05, 9.2, 10.35, 10.5);
    if (hbA > 0) {
      slipCard(d, SLP, { event: { sub: tr("ch03.fx.noPush") }, tags: { sub: tr("ch03.fx.noTags2") } }, hbA, { empty: true });
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, hbA);
    }
    // 在线翻转：presence 和 3 个标签，11:0 照办
    const flA = win(b, 10.55, 10.7, 11.6, 11.8);
    if (flA > 0) {
      slipCard(d, SLP, flipRows(prog(b, 10.6, 10.9), prog(b, 11.0, 11.08), prog(b, 11.06, 11.14)), flA);
      callout(x, TRAY[0], TRAY[1], 40, SLP.x, SLP.y + 120, flA);
    }
    // 小纸条：换歌那张 5:3 起从托盘滑到墙缝、6:0 递出去，跟着镜头到岗亭；翻转那张 10:3 起递出去
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

    // ---- 门外（B，拉远时也在）：岗亭、天线、页面、回执 ----
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
      // 门外那张「要做的事」：6:2 打勾，盖 waitUntil 章（在后台照办，回执不等它）
      slipCard(d, SLIPB, heroRows(1, prog(b, 6.5, 6.6)), win(b, 6.08, 6.24, 7.9, 8.1));
      if (b > 6.0) callout(x, BOOTH.x + 70, 580, 36, SLIPB.x + 30, SLIPB.y + SLIPB.h, win(b, 6.05, 6.2, 7.9, 8.1));
      stamp(s, "waitUntil", SLIPB.x + SLIPB.w - 170, SLIPB.y + 118, { k: prog(b, 6.5, 6.62), px: 54, rot: -0.08, alpha: 1 - prog(b, 7.9, 8.1) });
      // 同一拍出发的两条路：广播（岗亭 → 天线）、回执（岗亭 → 入口）
      const fa = 1 - prog(b, 7.9, 8.1);
      arrowPath(x, [[BOOTH.x + BOOTH.w, 600], [MAST[0] - 30, MAST[1] - 16]], prog(b, 6.5, 6.7, E.out), css("signalD"), fa);
      arrowPath(x, [[BOOTH.x + 20, BOOTH.y], RECEIPT[1], [940, 300]], prog(b, 6.5, 7.1, E.io), css("signalD"), fa);
      // 回执：同一拍飞回入口
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
      // 「并行」夹在两条路之间：上面是引出详图的虚线，下面是去天线的广播
      const pa = win(b, 6.52, 6.7, 7.7, 7.95);
      if (pa > 0) text(x, "‖ " + tr("ch03.parallel") + " ‖", 1346, 578, { font: FONT.cjk(38, 600), color: css("signalD"), alpha: pa });
    }

    // ---- Clawd：心跳那一段在桌角冒出来 ----
    const cin = prog(b, 9.35, 9.6), cout = prog(b, 10.2, 10.4);
    if (cin > 0 && cout < 1) {
      const hop = Math.sin(cin * Math.PI) * 50 * (1 - cin) + Math.sin(cout * Math.PI) * 50;
      clawd(tp, 1000, 470 - hop, 6, { pose: cin < 1 || cout > 0 ? "arms-up" : "default" });
      bubble(tp, tr("ch03.clawd"), 960, 404 - hop * 0.3, { px: 32, k: prog(b, 9.6, 9.75) * (1 - prog(b, 10.1, 10.2)), reveal: prog(b, 9.6, 10.0), tail: "right" });
    }

    // ---- C：拉远，另外三个库升起来 ----
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
      // 脚注：pulse 时间线在屋里只放 7 天，每分钟归档进 D1（api 的分钟 cron）
      const fa = prog(b, 14.6, 14.9);
      if (fa > 0) {
        polyline(x, [[R.x0 + 330, R.y1 + 4], [R.x0 + 330, 942], [SHELF.x + 120, 942], [SHELF.x + 120, SHELF.y - 8]], prog(b, 14.6, 15.0, E.io), 1.8, css("signalD"), 0.9);
        text(x, tr("ch03.pulse7a"), R.x0 + 360, 876, { font: FONT.cjk(42, 600), color: css("signalD"), alpha: fa });
        text(x, tr("ch03.pulse7b"), R.x0 + 360, 926, { font: FONT.cjk(42, 600), color: css("signalD"), alpha: fa });
      }
      tableCard(d, b, prog(b, 13.5, 13.75, E.out));
      // 15:0 图版外框：贴着画面四边（按屏幕坐标画，镜头还在慢慢推也不会切掉）
      const pk = prog(b, 15.0, 15.3, E.out);
      if (pk > 0) {
        x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0);
        rect(x, 24, 24, G.W - 48, G.H - 48, 2.4, bone, 0.8 * pk);
        // 放在对照表下面：左下角是旁白（英文那行很长），别撞上
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
      fade: Math.max(1 - prog(b, 0, 0.25), prog(b, 15.88, 16.0)),
      flash: impact(b, 6.5, 0.1) * 0.05 + impact(b, 11.0, 0.1) * 0.05, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch03", title: "ch.03", bars: 16,
    // 图层按名字从共用池里取（见 engine.js 的 G.layer）：线稿用 ink、白卡用 paper
    init() { plate = G.pass(K.PLATE.ink); plan = G.layer("ink"); emit = G.layer("emit", 0.5); docs = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
