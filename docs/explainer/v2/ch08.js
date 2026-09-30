// 第 08 章 · 心电图与地层（站点自检、pulse 归档与 Coding 打分，FACTS §3「api 的分钟 cron」「Pulse 事实时间线」、§8）。12 小节，暗底 + 白卡，全是 2D。
// 一拍 = 一分钟（接第 07 章）。一张暗底图纸：地面是一条心电图横线，线上是外面（Sentry），线下是站点（lyjw.me、workers/api），再往下是地层（D1）。
// 心电图是往左卷的监护仪：笔尖固定在 NOW_X，右边还没发生。尖峰朝信号走的方向：
//   Sentry 每分钟来敲门（HEAD /api/version，从上往下进来，尖朝下，落在每拍的后半拍）；
//   Worker 每 5 分钟去报到（分钟 cron 整 5 分钟那一轮，从下往上出去，尖朝上，落在拍上）。
// 机位（章内小节）：
//   0–1 接第 07 章：首帧是报到尖峰的尖，在屏幕 (1100, 300)，它左边那条斜边和第 07 章服务器那台的摆杆同一个角度；往后拉出整条心电图
//   1–4 心电图：两种方向相反的信号；2.5 起冷面脚注「报到只证明 cron 跑完了」
//   4–6 往右：采集 Worker 5:0 拿令牌去 Sentry 查，LYJWPAGE 卡两行各 30 天一格，5:2 今天那一格亮（live 绿，全片第二次也是最后一次）。
//     令牌上只标 GET：代码只证得了「只发 GET」，权限范围未核，不写「只读」（FACTS §8）
//   6–8 下沉进地层：一层一层是 Pulse 卡上那几条道，分钟 cron 每拍往地层右沿压进一薄片；7:0 在听那一层里，这首歌亮一下
//   8–10 推近 Coding 那一层：一窗一窗交给 Jev（强度条是示意），全零的窗不问 Jev、直接落最低档；Tokens 那层是三个来源的 5 分钟桶。
//     打分只留在 StateHub、不归档，画在地层里会被看成进了 D1，所以 Jev 那一格上方注「不进 D1」（FACTS §3「api 的分钟 cron」）
//   10–12 Clawd 在地层边冒出来说收尾那句；镜头升回地面，最后一帧只剩心电图，交给第 09 章
// 配乐锚点在 AT（章内小节），music/ch08.js 按同一组小节落拍；报到、敲门的拍位是 CHECKS / KNOCKS。改时间先对这两处和 SCRIPT.md。
// 画面只从这里取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, rect, clawd, bubble, roundRect, glyph, sheet, pathAt, pathLen, mulberry32 } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch08.title": ["心电图与地层", "Heartbeat and strata"],
    "ch08.knock": ["敲门", "knock"],
    "ch08.knockSub": ["每分钟一次", "every minute"],
    "ch08.knockOnly": ["只说明 Vercel 还在出页面", "proves only that Vercel serves pages"],
    "ch08.checkin": ["报到", "check-in"],
    "ch08.checkinSub": ["每 5 分钟一次", "every 5 minutes"],
    "ch08.cron": ["分钟 cron", "minute cron"],
    "ch08.n1a": ["外部探测从 Sentry 打进来，", "Sentry probes in from outside;"],
    "ch08.n1b": ["cron 从 Worker 里主动报出去。", "the Worker's cron reports out."],
    "ch08.foot": ["报到只证明 cron 跑完了。", "A check-in only proves the cron ran."],
    "ch08.collector": ["采集 Worker", "Collector"],
    "ch08.every5": ["每 5 分钟", "every 5 minutes"],
    "ch08.n2a": ["查 Sentry 的是采集 Worker，", "The collector queries Sentry;"],
    "ch08.n2b": ["页面只读可滞后层，不碰 Sentry。", "pages only read the lag layer."],
    "ch08.archive": ["每分钟压进一薄片", "a thin slice every minute"],
    "ch08.keep": ["长期保存", "kept long-term"],
    "ch08.older": ["越往左越早，一直留着", "older to the left, kept long-term"],
    "ch08.sources": ["Mac · 云端 · Cursor", "Mac · cloud · Cursor"],
    "ch08.n3a": ["分钟 cron 按水位把新行写进 D1，", "Rows past the watermark go to D1;"],
    "ch08.n3b": ["各路独立，一路坏了不挡别路。", "a failed stream blocks no other."],
    "ch08.jevNote": ["打分（示意）", "scores (illustrative)"],
    "ch08.jevKeep": ["打分只在屋里放 7 天，不进 D1", "scores stay 7 days in the room, not in D1"],
    "ch08.window": ["一窗 = 三个 5 分钟桶", "one window = three 5-min buckets"],
    "ch08.skip": ["不问 Jev，直接最低档", "no Jev: lowest level"],
    "ch08.open": ["还没满", "not closed yet"],
    "ch08.n4a": ["窗关上两分钟后才交给 Jev，", "Two minutes after a window closes,"],
    "ch08.n4b": ["输入是前台应用、agent 与 token。", "Jev weighs apps, agents and tokens."],
    "ch08.clawd": ["线上出错时，\n我先去 Sentry 查证据。", "When something breaks,\nI check Sentry first."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, paper, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出

  // ---------- 时间表（章内小节）：画面和 music/ch08.js 共用 ----------
  const AT = { fetch: 5.0, back: 5.25, lit: 5.5, sink: 6.0, hero: 7.0, coding: 8.0, zero: 8.25, sweep0: 8.5, sweepStep: 0.125, clawd: 10.25, rise: 11.0 };
  // 拍位（一拍 = 一分钟）：报到在整 5 分钟那一拍上，敲门在每拍的后半拍（Sentry 的探测和 cron 不对齐）
  const CHECKS = [], KNOCKS = [];
  for (let k = 0; k <= 50; k += 5) CHECKS.push(k);
  for (let k = 0; k <= 50; k++) KNOCKS.push(k + 0.5);

  // ---------- 布局（世界坐标；机位 A 时和屏幕一一对应） ----------
  // 心电图这组几何（Y0、NOW_X、V、UP、DOWN、CHECKS / KNOCKS 的拍位）另有两处跟着它：ch09.js 的 HEAD、COMMITS 落在本章最后一帧的笔尖
  // 和敲门尖峰的横坐标上（第 09 章 0:0 要和本章最后一帧对上）；ch10.js 第 08 格照抄了一份（回顾时画同一条心电图）。改这里要同步改那两边
  const Y0 = 540; // 心电图基线 = 地面
  const NOW_X = 1350; // 笔尖（此刻）；心电图和地层都是往左越早
  const V = 200; // 心电图：一拍走多少世界 px
  // 报到尖峰：左边那条斜边和第 07 章摆杆一样斜（摆幅 0.42 弧度，tan ≈ 0.446）
  const UP = [[-98, 0], [0, -220], [34, 46], [62, 0]];
  const DOWN = [[-16, 0], [0, 104], [14, -22], [30, 0]];
  const SENTRY = { x: 1210, y: 120, w: 280, h: 170 };
  const SITE = { x: 1110, y: 700, w: 200, h: 110 }; // lyjw.me（Vercel）
  const API = { x: 1400, y: 700, w: 250, h: 110 }; // workers/api 的分钟 cron
  const KNOCK_PATH = [[NOW_X, SENTRY.y + SENTRY.h], [NOW_X, Y0], [SITE.x + SITE.w / 2, SITE.y]];
  const CHECK_PATH = [[API.x + 60, API.y], [NOW_X, Y0], [NOW_X, SENTRY.y + SENTRY.h]];
  // B：采集 Worker、可滞后层、LYJWPAGE 卡
  const COL = [1830, 250], COL_R = 62;
  const LAGG = [1840, 470];
  const CARD = { x: 2080, y: 150, w: 780, h: 400 };
  const UPTIME_CELLS = 30; // 和站点 src/lib/sentry-status.ts 的 UPTIME_DAYS 一样，画的是写章时的值
  // 地层：Pulse 卡的七条道（src/components/live/pulse-card.tsx 的 LANES，顺序照抄）；时间往左，一分钟 SC 世界 px
  const LANES = ["Coding", "Tokens", "Listening", "Watching", "Gaming", "Charging", "Activity"];
  const ST_TOP = 900, LANE_H = 72, ST_X0 = -2200, SC = 10;
  const laneY = (i) => ST_TOP + i * LANE_H;
  const ST_BOT = laneY(LANES.length);
  const JEV = { x: 1000, y: 812, w: 300, h: 56 };

  // ---------- 机位：[小节, [x, y, zoom, rot], 进入这一段的缓动] ----------
  // 首帧：报到尖峰的尖（NOW_X, Y0 − 220）落在屏幕 (1100, 300)，缩放和第 07 章最后一帧一样
  const Z0 = 2.4;
  const FIRST = [NOW_X + (960 - 1100) / Z0, Y0 - 220 + (540 - 300) / Z0, Z0, 0];
  const A = [960, 540, 1, 0], B = [1960, 480, 1, 0], C = [700, 1180, 0.85, 0], D = [900, 1000, 1.45, 0], CL = [880, 790, 1.1, 0];
  const CAM = [
    [0, FIRST],
    [0.95, A, E.io],
    [3.76, [966, 540, 1.012, 0], E.lin],
    [4.0, B, E.io],
    [5.76, [1968, 482, 1.012, 0], E.lin],
    [6.34, C, E.io],
    [7.76, [706, 1184, 0.862, 0], E.lin],
    [8.0, D, E.io],
    [9.76, [906, 1000, 1.47, 0], E.lin],
    [10.0, CL, E.io],
    [AT.rise, [886, 786, 1.115, 0], E.lin],
    [12.0, A, E.io],
  ];
  const PLATE_RECT = [-2400, -300, 3400, 1900];

  // ---------- 小件 ----------
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function box(x, bx, by, w, h, a, o = {}) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = o.color || css("bone"); x.lineWidth = o.lw ?? 2.2;
    roundRect(x, bx, by, w, h, o.r ?? 8); x.fill(); x.stroke(); x.restore();
  }
  function dashPath(x, pts, a, color = css("bone"), dash = [6, 7], w = 1.4) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash); x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  // 沿路走的一个小点：k 0..1
  function dot(x, e, pts, k, a, r = 6) {
    if (k <= 0 || k >= 1 || a <= 0) return;
    const [px, py] = pathAt(pts, k * pathLen(pts));
    x.save(); x.globalAlpha = a; x.fillStyle = css("signalD"); x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill(); x.restore();
    glow(e, px, py, 28, 0.55 * a);
  }
  function nar(x, key, px, py, r, a, size = 60, maxW = 1040) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: size, maxW, color: css("bone"), reveal: r, alpha: a });
  }
  // 一个小钟面：12 格（每格 5 分钟），指针一拍走一格的五分之一
  function dial(x, cx, cy, r, minute, a, hot = 0) {
    if (a <= 0) return;
    const bone = css("bone");
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    x.strokeStyle = bone; x.lineWidth = 2.4; x.stroke(); x.restore();
    for (let i = 0; i < 12; i++) {
      const an = (i / 12) * TAU - Math.PI / 2;
      line(x, cx + Math.cos(an) * (r - 14), cy + Math.sin(an) * (r - 14), cx + Math.cos(an) * (r - 5), cy + Math.sin(an) * (r - 5), i % 3 ? 1.4 : 2.6, bone, a * (i % 3 ? 0.5 : 0.9));
    }
    const an = (minute / 60) * TAU - Math.PI / 2;
    line(x, cx, cy, cx + Math.cos(an) * r * 0.74, cy + Math.sin(an) * r * 0.74, 3.2, hot > 0.05 ? css("signalD") : bone, a);
    x.save(); x.globalAlpha = a; x.fillStyle = bone; x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill(); x.restore();
  }
  // 令牌：一张小卡片（和第 01、02 章的钥匙卡一个样子），上面标 GET
  function keycard(x, cx, cy, a) {
    if (a <= 0) return;
    const w = 96, h = 44, col = css("signalD");
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = col; x.lineWidth = 2.2;
    roundRect(x, cx - w / 2, cy - h / 2, w, h, 7); x.fill(); x.stroke();
    x.lineWidth = 1.4; x.strokeRect(cx - w / 2 + 10, cy - 8, 18, 14);
    for (let j = 0; j < 2; j++) { x.beginPath(); x.moveTo(cx - 6, cy - 6 + j * 12); x.lineTo(cx + 34 - j * 12, cy - 6 + j * 12); x.stroke(); }
    x.restore();
  }

  // ---------- 心电图 ----------
  function shapeY(shape, dx) {
    if (dx <= shape[0][0] || dx >= shape[shape.length - 1][0]) return 0;
    for (let i = 1; i < shape.length; i++) if (dx <= shape[i][0]) {
      const [x0, y0] = shape[i - 1], [x1, y1] = shape[i];
      return lerp(y0, y1, (dx - x0) / (x1 - x0));
    }
    return 0;
  }
  // 此刻（phi 拍）屏幕上的迹线：只画已经开始的尖峰；章首之前是一条平线
  function events(phi) {
    const ev = [];
    for (const t of CHECKS) ev.push({ t, x: NOW_X - (phi - t) * V, s: UP, up: true });
    for (const t of KNOCKS) ev.push({ t, x: NOW_X - (phi - t) * V, s: DOWN, up: false });
    return ev.filter((v) => v.x + v.s[0][0] < NOW_X && v.x + v.s[v.s.length - 1][0] > -3000);
  }
  const traceY = (ev, u) => ev.reduce((y, v) => y + shapeY(v.s, u - v.x), Y0);
  function tracePts(phi, x0) {
    const ev = events(phi), xs = [x0, NOW_X];
    for (const v of ev) for (const [dx] of v.s) { const u = v.x + dx; if (u > x0 && u < NOW_X) xs.push(u); }
    xs.sort((a, c) => a - c);
    return { ev, pts: xs.map((u) => [u, traceY(ev, u)]) };
  }
  function strokePts(x, pts, lw, color, alpha = 1) {
    if (pts.length < 2 || alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function ecg(x, e, b, cam, labA, dimK = 1) {
    const phi = b * 4;
    const left = Math.min(NOW_X - 40, cam.x - 960 / cam.zoom - 60);
    const { ev, pts } = tracePts(phi, left);
    const lw = Math.max(2.4, 1.6 / cam.zoom);
    strokePts(x, pts, lw, css("bone"), 0.9 * dimK);
    // 笔尖身后一小段是刚写上的：橙色，往左褪（监护仪的余辉）
    const tail = pts.filter(([u]) => u > NOW_X - 150);
    for (let i = 1; i < tail.length; i++) {
      const k = (tail[i][0] - (NOW_X - 150)) / 150;
      strokePts(x, [tail[i - 1], tail[i]], lw * 1.2, css("signalD"), k * dimK);
    }
    strokePts(e, tail, lw * 3, "rgb(240,150,105)", 0.35 * dimK);
    const py = traceY(ev, NOW_X);
    // 光晕按镜头缩放收一点：首帧放大 2.4 倍时别糊成一大团
    const gz = 1 / Math.sqrt(Math.max(1, cam.zoom));
    glow(e, NOW_X, py, 38 * gz, 0.95 * dimK);
    x.save(); x.fillStyle = css("ember"); x.beginPath(); x.arc(NOW_X, py, 5, 0, TAU); x.fill(); x.restore();
    // 到笔尖那一下亮一下
    for (const v of ev) if (phi >= v.t && phi - v.t < 1.2) {
      const k = Math.exp(-(phi - v.t) * 3.2);
      glow(e, v.x, Y0 + (v.up ? -220 : 104) * 0.9, (v.up ? 110 : 60) * gz, (v.up ? 0.8 : 0.45) * k * dimK);
    }
    // 报到的尖上挂一个小标签（跟着尖峰往左走），头两次才挂
    for (const v of ev) if (v.up && v.t > 0 && v.t <= 15 && phi >= v.t) {
      const a = labA * prog(NOW_X - v.x, 120, 200) * (v.x > 90 ? 1 : 0);
      text(x, tr("ch08.checkin"), v.x, Y0 - 236, { font: FONT.cjk(30, 600), color: css("bone"), align: "center", alpha: a });
    }
    return py;
  }

  // ---------- A：线上是 Sentry，线下是 lyjw.me 和 workers/api ----------
  function sentryBox(x, phi, a) {
    if (a <= 0) return;
    const { x: bx, y: by, w, h } = SENTRY;
    box(x, bx, by, w, h, a);
    text(x, "Sentry", bx + 22, by + 44, { font: FONT.mono(34, 600), color: css("bone"), alpha: a });
    // 两行记录：lyjw.me 记敲门，API 记报到；新的一格从右边进来
    [["lyjw.me", KNOCKS], ["API", CHECKS]].forEach(([name, list], r) => {
      const y = by + 92 + r * 46;
      text(x, name, bx + 22, y + 9, { font: FONT.mono(28, 500), color: css("ash"), alpha: a });
      const seen = list.filter((t) => t <= phi);
      const n = seen.length;
      for (let j = 0; j < Math.min(n, 9); j++) {
        const t = seen[n - 1 - j];
        const tx = bx + w - 26 - j * 13;
        const k = prog(phi, t, t + 0.15);
        fillRect(x, tx - 4, y - 12, 8, 22, css("bone"), a * (0.35 + 0.6 * k) * (1 - j / 10));
      }
    });
  }
  function siteBoxes(x, phi, a) {
    if (a <= 0) return;
    box(x, SITE.x, SITE.y, SITE.w, SITE.h, a);
    text(x, "lyjw.me", SITE.x + 20, SITE.y + 46, { font: FONT.mono(32, 600), color: css("bone"), alpha: a });
    text(x, "Vercel", SITE.x + 20, SITE.y + 88, { font: FONT.mono(28, 500), color: css("ash"), alpha: a });
    box(x, API.x, API.y, API.w, API.h, a);
    text(x, "workers/api", API.x + 20, API.y + 46, { font: FONT.mono(32, 600), color: css("bone"), alpha: a });
    text(x, tr("ch08.cron"), API.x + 20, API.y + 88, { font: FONT.cjk(28, 600), color: css("ash"), alpha: a });
    // cron 每分钟跑一轮：小钟一拍走一格
    dial(x, API.x + API.w - 40, API.y + 70, 22, phi % 60, a, 0);
  }
  function signalLabels(x, a, footA) {
    if (a <= 0) return;
    const bone = css("bone"), ash = css("ash");
    text(x, "↓ " + tr("ch08.knock"), NOW_X + 24, 372, { font: FONT.cjk(34, 600), color: bone, alpha: a });
    text(x, "HEAD /api/version", NOW_X + 24, 414, { font: FONT.mono(28, 500), color: bone, alpha: a });
    text(x, tr("ch08.knockSub"), NOW_X + 24, 454, { font: FONT.cjk(28, 600), color: ash, alpha: a, maxW: 1900 - NOW_X - 24 });
    text(x, tr("ch08.knockOnly"), NOW_X + 24, 494, { font: FONT.cjk(28, 600), color: ash, alpha: a, maxW: 1900 - NOW_X - 24 });
    text(x, "↑ " + tr("ch08.checkin") + (footA > 0.02 ? " *" : ""), API.x + API.w + 18, API.y + 40, { font: FONT.cjk(34, 600), color: bone, alpha: a });
    text(x, tr("ch08.checkinSub"), API.x + API.w + 18, API.y + 80, { font: FONT.cjk(28, 600), color: ash, alpha: a, maxW: 1900 - API.x - API.w - 18 });
    if (footA > 0) text(x, "* " + tr("ch08.foot"), 1130, 880, { font: FONT.cjk(36, 600), color: css("signalD"), alpha: footA, maxW: 760 });
  }
  function signalPaths(x, e, phi, a) {
    if (a <= 0) return;
    dashPath(x, KNOCK_PATH, 0.35 * a);
    dashPath(x, [CHECK_PATH[0], CHECK_PATH[1]], 0.35 * a);
    // 敲门：从 Sentry 下来，过笔尖（尖朝下），进 lyjw.me；报到：从 cron 上去，过笔尖（尖朝上），到 Sentry
    for (const t of KNOCKS) if (phi > t - 0.3 && phi < t + 0.3) dot(x, e, KNOCK_PATH, (phi - (t - 0.3)) / 0.6, a, 5);
    for (const t of CHECKS) if (phi > t - 0.35 && phi < t + 0.35) dot(x, e, CHECK_PATH, (phi - (t - 0.35)) / 0.7, a, 7);
  }

  // ---------- B：采集 Worker 取回结果，LYJWPAGE 卡 ----------
  const lagPath = [[COL[0], COL[1] + COL_R], [LAGG[0], LAGG[1] - 40]];
  const toCard = [[LAGG[0] + 70, LAGG[1]], [CARD.x - 10, LAGG[1]]];
  const toSentry = [[COL[0] - COL_R, COL[1]], [SENTRY.x + SENTRY.w + 8, COL[1]]];
  function collector(x, e, b, a) {
    if (a <= 0) return;
    const phi = b * 4;
    const hot = impact(b, AT.fetch, 0.15);
    dial(x, COL[0], COL[1], COL_R, phi % 60, a, hot);
    text(x, tr("ch08.collector"), COL[0], COL[1] + COL_R + 44, { font: FONT.cjk(30, 600), color: css("bone"), align: "center", alpha: a });
    text(x, tr("ch08.every5"), COL[0], COL[1] + COL_R + 82, { font: FONT.cjk(28, 600), color: css("ash"), align: "center", alpha: a });
    glyph(x, "lag", LAGG[0], LAGG[1], css("bone"), 0.8);
    text(x, "KV LAG", LAGG[0], LAGG[1] + 58, { font: FONT.mono(28, 500), color: css("ash"), align: "center", alpha: a });
    dashPath(x, toSentry, 0.4 * a);
    dashPath(x, [[COL[0], COL[1] + COL_R + 96], [LAGG[0], LAGG[1] - 36]], 0.4 * a);
    dashPath(x, toCard, 0.4 * a);
    // 5:0 令牌出门到 Sentry，5:1 结果回来，写进可滞后层，5:2 卡上今天那一格亮
    const kGo = prog(b, AT.fetch, AT.fetch + 0.22, E.io), kBack = prog(b, AT.back, AT.back + 0.25, E.io);
    if (b >= AT.fetch && b < AT.back + 0.3) {
      const k = b < AT.back ? kGo : 1 - kBack;
      const px = lerp(toSentry[0][0] - 60, toSentry[1][0] + 60, k);
      keycard(x, px, COL[1], a);
      text(x, "GET", px, COL[1] - 36, { font: FONT.mono(28, 600), color: css("signalD"), align: "center", alpha: a });
    }
    const dk = prog(b, AT.back + 0.25, AT.lit, E.io);
    if (dk > 0 && dk < 1) dot(x, e, [[COL[0], COL[1] + COL_R + 96], [LAGG[0], LAGG[1] - 36], [LAGG[0] + 70, LAGG[1]], [CARD.x - 10, LAGG[1]]], dk, a, 7);
  }
  function card(d, b, a) {
    if (a <= 0) return;
    const { x: cx, y: cy, w, h } = CARD;
    sheet(d, cx, cy, w, h, { alpha: a });
    text(d, "LYJWPAGE", cx + 36, cy + 56, { font: FONT.mono(32, 700), alpha: a });
    text(d, "/api/status/sentry", cx + w - 36, cy + 54, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: a });
    line(d, cx + 30, cy + 78, cx + w - 30, cy + 78, 1.4, css("pink"), a);
    const lit = prog(b, AT.lit, AT.lit + 0.1, E.outBack);
    const cw = (w - 72 - (UPTIME_CELLS - 1) * 4) / UPTIME_CELLS;
    ["lyjw.me", "API"].forEach((name, r) => {
      const top = cy + 122 + r * 136;
      text(d, name, cx + 36, top, { font: FONT.sans(32, 600), alpha: a });
      text(d, "Operational", cx + w - 36, top - 2, { font: FONT.sans(28, 500), color: css("graphite"), align: "right", alpha: a });
      for (let i = 0; i < UPTIME_CELLS; i++) {
        const x0 = cx + 36 + i * (cw + 4), y0 = top + 18;
        const today = i === UPTIME_CELLS - 1;
        const rk = prog(b, 4.1 + i * 0.012 + r * 0.05, 4.25 + i * 0.012 + r * 0.05); // 格子一格一格排出来
        if (!today) { fillRect(d, x0, y0, cw, 40, css("pink"), 0.26 * a * rk); continue; }
        rect(d, x0, y0, cw, 40, 1.6, css("pink"), a * rk);
        if (lit > 0) {
          const s = lerp(1.25, 1, clamp(lit));
          d.save(); d.translate(x0 + cw / 2, y0 + 20); d.scale(s, s);
          fillRect(d, -cw / 2, -20, cw, 40, css("liveL"), a * clamp(lit * 1.5));
          d.restore();
        }
      }
      text(d, "30 days ago", cx + 36, top + 96, { font: FONT.mono(28, 500), color: css("graphite"), alpha: a });
      text(d, "Today", cx + w - 36, top + 96, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: a });
      line(d, cx + 250, top + 86, cx + w - 150, top + 86, 1, css("pink"), 0.3 * a);
    });
  }

  // ---------- 地层 ----------
  // 示意的原始事实，按分钟（t = 章内拍；负数是章首之前）排；同一个种子，每帧都一样
  const R = mulberry32(8080);
  const WIN0 = 1; // Coding 窗的相位：窗从 t = 15k + WIN0 开始
  const CODING = []; // [{ from, level, band: [[from, to, v]], zero }]
  for (let k = -16; k <= 3; k++) {
    const from = 15 * k + WIN0;
    const zero = k === -5 || k === -1 || k === -9 || k === -12;
    const level = zero ? 0 : 1 + Math.floor(R() * 4);
    const band = [];
    if (!zero) for (let m = 0; m < 15;) { const len = 2 + Math.floor(R() * 5), v = R() < 0.25 ? 0 : 1 + Math.floor(R() * 3); band.push([from + m, from + Math.min(15, m + len), v]); m += len; }
    CODING.push({ from, level, band, zero, prob: 0.35 + 0.55 * R() });
  }
  const TOKENS = []; // 5 分钟桶：[from, [mac, cloud, cursor]]
  for (const w of CODING) for (let j = 0; j < 3; j++) TOKENS.push([w.from + j * 5, w.zero ? [0, 0, 0] : [R() * 0.6, R() * 0.35, R() * 0.25]]);
  const LISTEN = []; // [from, to, hero]
  for (let t = -240; t < -130;) { const len = 3 + R() * 1.5; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  for (let t = -6; t < 22;) { const len = 3 + R() * 1.4; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  LISTEN.push([22, 60, true]); // 在放的这一首：开着的区间，一直画到此刻
  const WATCH = [[-128, -84]];
  const GAME = [[-78, -40, 1], [-40, -32, 0.5]];
  const WORKOUT = [-62, -44];
  const STEPS = [];
  for (let t = -300; t < 60; t += 5) STEPS.push([t, t >= WORKOUT[0] && t < WORKOUT[1] ? 0.7 + 0.3 * R() : R() < 0.55 ? R() * 0.35 : 0]);
  const tx = (phi, t) => NOW_X - (phi - t) * SC;
  const ORDER = CODING.filter((w) => !w.zero && w.from + 15 + 2 <= AT.sweep0 * 4 && tx(AT.sweep0 * 4, w.from + 15) > 250);

  function strata(x, e, d, b, a, focus) {
    if (a <= 0) return;
    const phi = b * 4;
    const bone = css("bone"), ash = css("ash");
    // 七层底色：墨色深浅交替
    LANES.forEach((name, i) => {
      const y = laneY(i);
      x.save(); x.globalAlpha = a * (i % 2 ? 0.55 : 0.85); x.fillStyle = css("ink2"); x.fillRect(ST_X0, y, NOW_X - ST_X0, LANE_H); x.restore();
      line(x, ST_X0, y, NOW_X, y, 1.2, bone, 0.28 * a);
    });
    line(x, ST_X0, ST_BOT, NOW_X, ST_BOT, 1.2, bone, 0.28 * a);
    // 各层的原始事实（示意）
    const clipL = ST_X0, clipR = NOW_X;
    const seg = (i, t0, t1, h, alpha, color = bone) => {
      const x0 = Math.max(clipL, tx(phi, t0)), x1 = Math.min(clipR, tx(phi, t1));
      if (x1 <= x0) return;
      fillRect(x, x0, laneY(i) + LANE_H - 12 - h, x1 - x0, h, color, alpha);
    };
    const dimOf = (i) => a * (i <= 1 ? 1 : 1 - focus);
    // Coding：三色带画成三档浓淡（前台 coding 应用 / agent 在跑 / 两者同时），不照搬站点的颜色
    for (const w of CODING) for (const [t0, t1, v] of w.band) if (v && t1 <= phi) seg(0, t0, Math.min(t1, phi), 12, dimOf(0) * [0, 0.3, 0.55, 0.85][v]);
    // Tokens：三个来源的桶叠起来（Mac、云端、Cursor 三档浓淡），只在桶关上之后画
    for (const [t0, [m, c, u]] of TOKENS) {
      if (t0 + 5 > phi) continue;
      const x0 = tx(phi, t0) + 3, x1 = tx(phi, t0 + 5) - 3;
      if (x1 < clipL || x0 > clipR) continue;
      let y = laneY(1) + LANE_H - 8;
      [[m, 0.85], [c, 0.55], [u, 0.3]].forEach(([v, al]) => { const hh = v * 52; fillRect(x, x0, y - hh, x1 - x0, hh, bone, dimOf(1) * al); y -= hh; });
    }
    // Listening：一首一首的区间；在放的那一首是开着的区间，7:0 亮一下
    for (const [t0, t1, hero] of LISTEN) {
      if (t0 > phi) continue;
      if (hero) {
        const k = impact(b, AT.hero, 0.35);
        seg(2, t0, Math.min(t1, phi), 30, dimOf(2) * (0.7 + 0.3 * k), css("signalD"));
        if (k > 0.02) glow(e, (tx(phi, t0) + NOW_X) / 2, laneY(2) + LANE_H - 27, 90, 0.7 * k * a);
      } else seg(2, t0, Math.min(t1, phi) - 0.25, 22, dimOf(2) * 0.6);
    }
    for (const [t0, t1] of WATCH) seg(3, t0, t1, 22, dimOf(3) * 0.6);
    for (const [t0, t1, v] of GAME) seg(4, t0, t1, v > 0.9 ? 22 : 10, dimOf(4) * 0.6);
    // Charging：实测瓦数，一条折线
    {
      const pts = [];
      for (let t = -300; t <= phi; t += 2) {
        const u = t < -96 || t > 16 ? 0.04 : t < -88 ? 0.04 + (t + 96) / 8 * 0.96 : 0.04 + 0.96 * Math.exp(-(t + 88) / 34);
        pts.push([tx(phi, t), laneY(5) + LANE_H - 10 - u * 44]);
      }
      strokePts(x, pts.filter(([u]) => u >= clipL && u <= clipR), 2.4, bone, dimOf(5) * 0.8);
    }
    // Activity：五分钟步数桶 + 一段训练
    for (const [t0, v] of STEPS) if (v > 0 && t0 + 5 <= phi) seg(6, t0 + 0.4, t0 + 4.6, v * 44, dimOf(6) * 0.6);
    {
      const x0 = tx(phi, WORKOUT[0]), x1 = tx(phi, WORKOUT[1]);
      if (x1 > clipL && x0 < clipR) { line(x, x0, laneY(6) + 10, x1, laneY(6) + 10, 2, bone, dimOf(6) * 0.8); line(x, x0, laneY(6) + 4, x0, laneY(6) + 16, 2, bone, dimOf(6) * 0.8); line(x, x1, laneY(6) + 4, x1, laneY(6) + 16, 2, bone, dimOf(6) * 0.8); }
    }
    // 右沿：此刻。分钟 cron 每拍压进一薄片（从 workers/api 掉下来，压进各层）
    line(x, NOW_X, ST_TOP, NOW_X, ST_BOT, 2, bone, 0.6 * a);
    const lastBeat = Math.floor(phi), fk = phi - lastBeat;
    const flash = Math.exp(-fk * 6);
    fillRect(x, NOW_X - SC, ST_TOP, SC, ST_BOT - ST_TOP, css("signalD"), 0.55 * flash * a);
    glow(e, NOW_X - 4, (ST_TOP + ST_BOT) / 2, 70, 0.25 * flash * a);
    const drop = [[API.x + 40, API.y + API.h], [API.x + 40, ST_TOP - 20], [NOW_X - 4, ST_TOP - 20], [NOW_X - 4, ST_TOP]];
    const da = a * (1 - focus);
    dashPath(x, drop, 0.35 * da);
    const dk = (phi + 0.55) % 1;
    if (dk < 0.55) dot(x, e, drop, dk / 0.55, da, 5);
  }
  // 道名一栏贴着画面左边（跟着镜头算，屏幕上一直是 32 px），底下垫一块墨色挡住地层
  function laneLabels(x, cam, a, focus) {
    if (a <= 0) return;
    const z = cam.zoom, wx = (sx) => cam.x + (sx - 960) / z;
    x.save(); x.globalAlpha = 0.92 * a; x.fillStyle = css("ink"); x.fillRect(wx(0), ST_TOP - 70, wx(290) - wx(0), ST_BOT - ST_TOP + 90); x.restore();
    line(x, wx(290), ST_TOP - 70, wx(290), ST_BOT + 20, 1.4 / z, css("bone"), 0.5 * a);
    text(x, "Pulse", wx(40), ST_TOP - 22, { font: FONT.mono(34 / z, 600), color: css("bone"), alpha: a });
    LANES.forEach((name, i) => {
      const hot = i <= 1 ? 1 : 1 - focus;
      text(x, name, wx(40), laneY(i) + LANE_H / 2 + 11 / z, { font: FONT.mono(32 / z, 500), color: i <= 1 && focus > 0.5 ? css("bone") : css("ash"), alpha: a * hot });
    });
  }
  // 右边的注：D1 档案架、每分钟一片、长期保存
  function strataNotes(x, b, a) {
    if (a <= 0) return;
    const bone = css("bone"), ash = css("ash");
    glyph(x, "d1", NOW_X + 170, 1060, bone, 1);
    text(x, "D1", NOW_X + 90, 1150, { font: FONT.mono(38, 600), color: bone, alpha: a });
    text(x, "lyjwpage-history", NOW_X + 90, 1196, { font: FONT.mono(34, 500), color: ash, alpha: a });
    text(x, tr("ch08.keep"), NOW_X + 90, 1250, { font: FONT.cjk(38, 600), color: css("signalD"), alpha: a });
    // 放在右沿左边、地层顶上：右边那一截要留给 D1 的注，画面右边也放不下英文
    text(x, tr("ch08.archive"), NOW_X - 50, ST_TOP - 32, { font: FONT.cjk(34, 600), color: bone, align: "right", alpha: a, maxW: 640 });
    text(x, "← " + tr("ch08.older"), 20, ST_BOT + 64, { font: FONT.cjk(36, 600), color: ash, alpha: a, maxW: 1000 });
  }

  // ---------- 8–10 Coding 那一层交给 Jev ----------
  // 一窗一窗地打（按时间往右扫）；全零的窗 8:1 先落到最低档，不问 Jev
  function coding(x, e, d, b, a, cam) {
    if (a <= 0) return;
    const phi = b * 4;
    const bone = css("bone"), ash = css("ash");
    const y0 = laneY(0), y1 = laneY(1);
    const done = CODING.filter((w) => w.from + 15 + 2 <= phi && tx(phi, w.from + 15) > 250);
    // Jev 那一格
    box(x, JEV.x, JEV.y, JEV.w, JEV.h, a);
    text(x, "Jev", JEV.x + 16, JEV.y + 38, { font: FONT.mono(28, 600), color: bone, alpha: a });
    text(x, tr("ch08.jevNote"), JEV.x + 70, JEV.y + 36, { font: FONT.cjk(21, 600), color: ash, alpha: a, maxW: JEV.w - 80 });
    // 右边到画面边只剩约 560 世界 px（机位 D）；英文按这个宽度排
    text(x, tr("ch08.jevKeep"), JEV.x, JEV.y - 16, { font: FONT.cjk(21, 600), color: ash, alpha: a, maxW: 540 });
    for (const w of CODING) {
      const x0 = tx(phi, w.from), x1 = tx(phi, w.from + 15);
      if (x1 < 200 || x0 > NOW_X) continue;
      const closed = w.from + 15 + 2 <= phi;
      // 窗格：整窗一格，里面两道细刻线分出三个 5 分钟桶
      x.save(); x.globalAlpha = a; x.strokeStyle = bone; x.lineWidth = 1.6; if (!closed) x.setLineDash([6, 6]);
      x.strokeRect(x0 + 2, y0 + 3, Math.min(x1, NOW_X) - x0 - 4, LANE_H - 6); x.restore();
      for (let j = 1; j < 3; j++) { const u = tx(phi, w.from + j * 5); if (u < NOW_X) line(x, u, y0 + LANE_H - 16, u, y0 + LANE_H - 4, 1.2, bone, 0.6 * a); }
      if (!closed) { text(x, tr("ch08.open"), (x0 + NOW_X) / 2, y0 + 40, { font: FONT.cjk(21, 600), color: ash, align: "center", alpha: a * (x0 < NOW_X - 90 ? 1 : 0), maxW: Math.max(60, NOW_X - x0 - 10) }); continue; }
      // 结果：打出来的档位画成窗里的一根横条（高低是强度，示意）
      let k = 0;
      if (w.zero) k = prog(b, AT.zero, AT.zero + 0.1);
      else {
        const idx = ORDER.indexOf(w);
        const t0 = AT.sweep0 + idx * AT.sweepStep;
        k = prog(b, t0 + 0.06, t0 + 0.12, E.out);
        const ask = win(b, t0 - 0.02, t0, t0 + 0.1, t0 + 0.16);
        if (ask > 0) {
          const cx = (x0 + x1) / 2;
          dashPath(x, [[JEV.x + JEV.w / 2, JEV.y + JEV.h], [cx, y0 - 4]], 0.9 * ask, css("signalD"), [5, 5], 2);
          glow(e, cx, y0 + 10, 60, 0.5 * ask);
        }
      }
      if (k <= 0) continue;
      const hh = w.zero ? 0 : 8 + w.level * 10;
      const yb = y0 + LANE_H - 20, lx0 = x0 + 12, lw = x1 - x0 - 24;
      const fresh = w.zero ? 0 : impact(b, AT.sweep0 + ORDER.indexOf(w) * AT.sweepStep + 0.08, 0.25);
      if (!w.zero) fillRect(x, lx0, yb - hh * k, lw, hh * k, bone, 0.16 * a);
      fillRect(x, lx0, yb - hh * k - 2, lw, 4, fresh > 0.05 ? css("signalD") : bone, a * (w.zero ? 0.7 : 0.9));
      if (fresh > 0.05) glow(e, (x0 + x1) / 2, yb - hh * k, 50, 0.5 * fresh * a);
      if (w.zero) text(x, "0", (x0 + x1) / 2, y0 + 34, { font: FONT.mono(24, 600), color: ash, align: "center", alpha: a * k });
    }
    // 「不问 Jev」：指着最右边那个全零的窗
    const zw = done.filter((w) => w.zero).pop();
    if (zw) {
      const za = prog(b, AT.zero, AT.zero + 0.15) * a;
      const cx = (tx(phi, zw.from) + tx(phi, zw.from + 15)) / 2;
      K.leader(x, cx, y0 + 4, tr("ch08.skip"), -30, -56, { font: FONT.cjk(22, 600), color: bone, alpha: za, dot: 4 });
    }
    // 两条注贴着道名那一栏：Tokens 是三个来源的桶；一窗是三个 5 分钟桶
    const lx = cam.x + (310 - 960) / cam.zoom;
    text(x, tr("ch08.sources"), lx, laneY(2) + 30, { font: FONT.cjk(21, 600), color: bone, alpha: a });
    // Jev 给左边几窗打分时，虚线会穿过这行注：字底下垫一块墨色，线从字后面过
    const wn = tr("ch08.window"), wf = FONT.cjk(21, 600);
    fillRect(x, lx - 8, ST_TOP - 42, K.measure(x, wn, wf) + 16, 34, css("ink"), a);
    text(x, wn, lx, ST_TOP - 16, { font: wf, color: ash, alpha: a });
  }

  function title(x, b) {
    const a = prog(b, 0.45, 0.95, E.out) * (1 - prog(b, 3.8, 4.0));
    if (a <= 0) return;
    const bone = css("bone");
    text(x, "08", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: a });
    text(x, tr("ch08.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.5, 1.0), alpha: a });
    text(x, "Sentry · workers/api · D1", 292, 226, { font: FONT.mono(28), color: css("ash"), reveal: prog(b, 0.6, 1.1), alpha: a });
    line(x, 110, 262, 110 + 900 * prog(b, 0.55, 1.2, E.outExpo), 262, 1.4, bone, 0.6 * a);
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, phi = b * 4;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.lit, 0.12), impact(b, 0, 0.1) * 0.6);
    cam.zoom *= 1 + 0.012 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: prog(b, 0.1, 0.8), uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const d = paper.begin(); paper.cam(cam);
    const tp = top.begin(); top.cam(cam);

    // 首帧只有那一根尖峰；往后拉开时其余的东西才淡进来。升回地面时收掉，最后一帧只剩心电图
    const outA = 1 - prog(b, 11.35, 11.85);
    const labA = prog(b, 0.55, 0.95) * outA * (1 - win(b, 7.85, 8.05, 9.9, 10.1));
    title(x, b);
    ecg(x, e, b, cam, labA * (1 - prog(b, 3.9, 4.0)), 1 - 0.65 * win(b, 6.0, 6.4, 10.6, 11.3));
    sentryBox(x, phi, labA);
    siteBoxes(x, phi, labA);
    signalPaths(x, e, phi, labA);
    signalLabels(x, win(b, 0.6, 0.95, 3.85, 4.0), win(b, 2.5, 2.7, 3.85, 4.0));
    // B：4–6，采集 Worker、可滞后层和白卡；离开时收起来
    const bA = win(b, 3.85, 4.1, 5.95, 6.2);
    collector(x, e, b, bA);
    card(d, b, bA);
    // 地层：往下沉时出现，升回地面时退掉
    const sA = prog(b, 5.9, 6.2) * (1 - prog(b, 11.2, 11.7));
    const focus = win(b, 7.9, 8.1, 9.9, 10.1);
    strata(x, e, d, b, sA, focus);
    strataNotes(x, b, win(b, 6.1, 6.4, 7.85, 8.0));
    coding(x, e, d, b, win(b, 7.95, 8.15, 9.9, 10.05), cam);
    laneLabels(x, cam, sA * (1 - prog(b, 9.95, 10.15)), focus);
    // 旁白
    nar(x, "ch08.n1a", 110, 944, prog(b, 1.0, 1.6), win(b, 1.0, 1.1, 3.8, 3.95));
    nar(x, "ch08.n1b", 110, 1024, prog(b, 1.6, 2.4), win(b, 1.0, 1.1, 3.8, 3.95));
    // B 机位的左下角：世界坐标跟着镜头算
    const at = (sx, sy, c) => [c[0] + (sx - 960) / c[2], c[1] + (sy - 540) / c[2]];
    { const [nx, ny] = at(110, 944, B), [, ny2] = at(110, 1024, B);
      nar(x, "ch08.n2a", nx, ny, prog(b, 4.1, 4.6), win(b, 4.05, 4.15, 5.85, 5.98));
      nar(x, "ch08.n2b", nx, ny2, prog(b, 4.6, 5.3), win(b, 4.05, 4.15, 5.85, 5.98)); }
    { const s = 1 / C[2], [nx, ny] = at(110, 944, C), [, ny2] = at(110, 1024, C);
      nar(x, "ch08.n3a", nx, ny, prog(b, 6.35, 6.9), win(b, 6.3, 6.4, 7.85, 7.98), 60 * s, 1040 * s);
      nar(x, "ch08.n3b", nx, ny2, prog(b, 6.9, 7.5), win(b, 6.3, 6.4, 7.85, 7.98), 60 * s, 1040 * s); }
    { const s = 1 / D[2], [nx, ny] = at(110, 944, D), [, ny2] = at(110, 1024, D);
      nar(x, "ch08.n4a", nx, ny, prog(b, 8.1, 8.6), win(b, 8.05, 8.15, 9.85, 9.98), 60 * s, 1040 * s);
      nar(x, "ch08.n4b", nx, ny2, prog(b, 8.6, 9.2), win(b, 8.05, 8.15, 9.85, 9.98), 60 * s, 1040 * s); }
    // Clawd：在地层边（右沿上面）冒出来，说完缩回去；镜头往上升
    const cIn = prog(b, AT.clawd - 0.2, AT.clawd), cOut = prog(b, 11.45, 11.7);
    if (cIn > 0 && cOut < 1) {
      const rise = E.outBack(cIn) * (1 - E.in(cOut));
      const cx = 760, base = ST_TOP + 4;
      tp.save(); tp.beginPath(); tp.rect(cx - 200, base - 260, 400, 260); tp.clip();
      clawd(tp, cx, base + (1 - rise) * 90, 6, { pose: cIn < 1 ? "arms-up" : "default" });
      tp.restore();
      bubble(tp, tr("ch08.clawd"), cx - 70, base - 110, { px: 34, k: prog(b, AT.clawd + 0.1, AT.clawd + 0.25) * (1 - prog(b, 11.35, 11.45)), reveal: prog(b, AT.clawd + 0.15, 10.9), tail: "right" });
    }

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 6.7 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.5 });
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 6;
    f.post = {
      bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch08", title: "ch.08", bars: 12,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); top = G.layer("top"); },
    render,
  });
})();
