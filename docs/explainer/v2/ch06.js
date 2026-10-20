// 画面只从这里取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
// 这一章画成宣纸上的水墨：心电图是一笔横贯的墨线，地层是墨分五色的淡墨层，Clef 打完的窗盖一枚朱印。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, glyph, pathAt, pathLen, mulberry32, hash } = K;
  I18N.add({
    "ch06.title": ["心电图与地层", "Heartbeat and strata"],
    "ch06.knock": ["敲门", "knock"],
    "ch06.knockSub": ["采集 Worker · 每分钟一次", "collector · every minute"],
    "ch06.knockOnly": ["只说明 site Worker 还在出页面", "only proves the site Worker serves"],
    "ch06.checkin": ["报到", "check-in"],
    "ch06.checkinSub": ["每 5 分钟一次", "every 5 minutes"],
    "ch06.cron": ["cron", "cron"],
    "ch06.n1a": ["探测每分钟从采集 Worker 打进来，", "The collector probes in every minute;"],
    "ch06.n1b": ["cron 每轮跑完，自己记一笔心跳。", "the Worker's cron logs its own beat."],
    "ch06.foot": ["报到只证明 cron 跑完了。", "A check-in only proves the cron ran."],
    "ch06.collector": ["采集 Worker", "Collector"],
    "ch06.every5": ["每 5 分钟", "every 5 minutes"],
    "ch06.n2a": ["汇总这两行的是采集 Worker，", "The collector sums up both rows;"],
    "ch06.n2b": ["页面只读可滞后层，不碰 D1。", "pages only read the lag layer."],
    "ch06.archive": ["每 5 分钟压进一薄片", "a thin slice every 5 minutes"],
    "ch06.keep": ["长期保存", "kept long-term"],
    "ch06.older": ["越往左越早，一直留着", "older to the left, kept long-term"],
    "ch06.sources": ["Mac · 云端 · Cursor", "Mac · cloud · Cursor"],
    "ch06.n3a": ["cron 每 5 分钟按水位写进 D1，", "Rows past the watermark go to D1;"],
    "ch06.n3b": ["各路独立，一路坏了不挡别路。", "a failed stream blocks no other."],
    "ch06.jevNote": ["打分（示意）", "scores (illustrative)"],
    "ch06.jevKeep": ["打分只在屋里放 7 天，不进 D1", "scores stay 7 days in the room, not in D1"],
    "ch06.window": ["一窗 = 三个 5 分钟桶", "one window = three 5-min buckets"],
    "ch06.skip": ["不问 Clef，直接最低档", "no Clef: lowest level"],
    "ch06.n4a": ["窗关上两分钟后才交给 Clef，", "Two minutes after a window closes,"],
    "ch06.n4b": ["输入是前台应用、agent 与 token。", "Clef weighs apps, agents and tokens."],
    "ch06.clawd": ["线上出错时，\n我先去 Workers Issues 查证据。", "When something breaks,\nI check Workers Issues first."],
    "ch06.seal": ["墨", "ink"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let page, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const AT = { fetch: 5.0, back: 5.25, lit: 5.5, sink: 6.0, hero: 7.0, coding: 8.0, zero: 8.25, sweep0: 8.5, sweepStep: 0.125, clawd: 10.25, rise: 11.0 };
  const CHECKS = [], KNOCKS = [];
  for (let k = 0; k <= 50; k += 5) CHECKS.push(k);
  for (let k = 0; k <= 50; k++) KNOCKS.push(k + 0.5);

  // ch07 收尾、ch08 与 ch09 的提交落点和 ch10 的回顾几何须与此处一致，章节接缝才能对齐。
  const Y0 = 540;
  const NOW_X = 1350;
  const V = 200;
  const UP = [[-98, 0], [0, -220], [34, 46], [62, 0]];
  const DOWN = [[-16, 0], [0, 104], [14, -22], [30, 0]];
  const LEDGER = { x: 1210, y: 120, w: 280, h: 170 };
  const SITE = { x: 1110, y: 700, w: 200, h: 124 };
  const API = { x: 1400, y: 700, w: 270, h: 124 };
  const KNOCK_PATH = [[NOW_X, LEDGER.y + LEDGER.h], [NOW_X, Y0], [SITE.x + SITE.w / 2, SITE.y]];
  const CHECK_PATH = [[API.x + 60, API.y], [NOW_X, Y0], [NOW_X, LEDGER.y + LEDGER.h]];
  const COL = [1830, 250], COL_R = 62;
  const LAGG = [1840, 470];
  const CARD = { x: 2080, y: 150, w: 780, h: 400 };
  const UPTIME_CELLS = 30;
  const LANES = ["Coding", "Tokens", "Listening", "Watching", "Gaming", "Charging", "Activity"];
  const ST_TOP = 900, LANE_H = 72, ST_X0 = -2200, SC = 10;
  const laneY = (i) => ST_TOP + i * LANE_H;
  const ST_BOT = laneY(LANES.length);
  const SCORER = { x: 1000, y: 812, w: 300, h: 56 };

  // 首帧接 ch05 末帧那条屏幕 y 540 的直线：它就是心电图的基线，报到尖峰在屏幕 x 1100 处立起来。
  const Z0 = 1.5;
  const FIRST = [NOW_X + (960 - 1100) / Z0, Y0, Z0, 0];
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

  // ---- 纸、墨、朱砂 ----
  // PAPER 须与 ch05.js 的 PAPER06 同步：第 05 章收尾把纸色挪到这里，切过来底色不跳。
  const INK = [30, 26, 22], PAPER = [238, 230, 211], VERM = [184, 54, 38], SILK = [196, 203, 194], WOOD = [74, 52, 38], MALACHITE = [74, 128, 100];
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const ink = (a = 1) => rgba(INK, a), verm = (a = 1) => rgba(VERM, a);
  const BRUSH = (px) => (I18N.lang === "en" ? `600 ${px}px "Noto Serif SC", Georgia, serif` : `${px}px "Ma Shan Zheng", "Noto Serif SC", serif`);
  const SERIF = (px, w = 600) => `${w} ${px}px "Noto Serif SC", "Songti SC", serif`;
  const MONO = (px, w = 500) => FONT.mono(px, w);
  let paperPat = null;
  // 宣纸：底色上撒长纤维和几团浅深不匀的纸筋，按种子生成，四边回绕。
  function paperTile() {
    if (paperPat) return paperPat;
    const N = 640, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const c = cv.getContext("2d"), r = mulberry32(606);
    for (let i = 0; i < 36; i++) {
      const x = r() * N, y = r() * N, rad = 50 + r() * 160, g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, r() < 0.5 ? "rgba(150,120,80,0.035)" : "rgba(255,252,240,0.05)"); g.addColorStop(1, "rgba(0,0,0,0)");
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { c.fillStyle = g; c.save(); c.translate(ox, oy); c.fillRect(x - rad, y - rad, rad * 2, rad * 2); c.restore(); }
    }
    c.lineCap = "round";
    for (let i = 0; i < 520; i++) {
      const x = r() * N, y = r() * N, a = r() * TAU, l = 10 + r() * 60, bend = (r() - 0.5) * 0.8;
      c.strokeStyle = r() < 0.7 ? `rgba(120,100,70,${0.05 + r() * 0.08})` : `rgba(255,255,248,${0.12 + r() * 0.12})`;
      c.lineWidth = 0.4 + r() * 0.7;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + bend) * l * 0.5, y + Math.sin(a + bend) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(90,75,55,${0.03 + r() * 0.07})`; c.fillRect(r() * N, r() * N, 0.8 + r(), 0.8 + r()); }
    paperPat = c.createPattern(cv, "repeat");
    return paperPat;
  }

  // 一笔：按点列铺一条有粗细的墨带。横笔重、竖笔轻（笔锋提起来），起收笔收尖，末段带飞白。
  // phase 让粗细的起伏跟着纸走：心电图整条往左卷，起伏要跟着波形一起走，不能停在屏幕上。
  function brush(x, pts, w, o = {}) {
    const n = pts.length;
    if (n < 2) return;
    const lens = [0];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[n - 1] || 1, ph = o.phase || 0, seed = o.seed || 0;
    const L = [], R = [], half = [];
    for (let i = 0; i < n; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const t = lens[i] / total;
      const taper = Math.min(1, o.tin === 0 ? 1 : t / (o.tin ?? 0.06), o.tout === 0 ? 1 : (1 - t) / (o.tout ?? 0.12));
      const press = o.even ? 1 : 0.42 + 0.58 * Math.abs(dx);
      const wob = 1 + 0.16 * Math.sin((pts[i][0] + ph) * 0.021 + seed) + 0.08 * Math.sin((pts[i][0] + ph) * 0.073 + seed * 3);
      const hw = (w / 2) * Math.max(0.18, taper) * press * wob;
      half.push([dx, dy, hw]);
      L.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]); R.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
    }
    x.save(); x.globalAlpha *= o.alpha ?? 1; x.fillStyle = o.color || ink(0.92);
    x.beginPath(); L.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v)));
    for (let i = n - 1; i >= 0; i--) x.lineTo(R[i][0], R[i][1]);
    x.closePath(); x.fill();
    if (o.dry !== false) {
      // 飞白：几缕纸色细丝顺着笔走，按纸上的位置断续，墨越干（越靠收笔）越多。
      x.strokeStyle = rgba(PAPER, 0.8); x.lineCap = "round";
      for (const [s, k] of [[-0.45, 0.62], [0.18, 0.7], [0.5, 0.55]]) {
        x.lineWidth = Math.max(0.6, w * 0.07);
        x.beginPath();
        let on = false;
        for (let i = 1; i < n; i++) {
          const t = lens[i] / total, u = pts[i][0] + ph;
          const dryK = (o.dryFrom ?? 0.55) < t ? 1 : 0.25;
          const keep = hash(Math.floor(u / 17) + s * 131 + seed * 7) < (1 - k) * dryK + (o.dryAll ? 0.3 : 0);
          const [dx, dy, hw] = half[i], px = pts[i][0] + dy * hw * s * 2, py = pts[i][1] - dx * hw * s * 2;
          if (keep) { if (!on) { x.moveTo(px, py); on = true; } else x.lineTo(px, py); } else on = false;
        }
        x.stroke();
      }
    }
    x.restore();
  }
  const seg2 = (x0, y0, x1, y1, steps = 8) => Array.from({ length: steps + 1 }, (_, i) => [lerp(x0, x1, i / steps), lerp(y0, y1, i / steps)]);
  // 淡墨：低透明度铺一层，再沿边描一道稍深的水痕，边是按种子抖过的。
  function roughRect(x0, y0, w, h, seed, j = 3) {
    const p = new Path2D(), pts = [], step = 40;
    const side = (ax, ay, bx, by, s) => { const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / step)); for (let i = 0; i < n; i++) { const t = i / n; pts.push([lerp(ax, bx, t) + (hash(seed + s * 50 + i) - 0.5) * j, lerp(ay, by, t) + (hash(seed + s * 50 + i + 17) - 0.5) * j]); } };
    side(x0, y0, x0 + w, y0, 1); side(x0 + w, y0, x0 + w, y0 + h, 2); side(x0 + w, y0 + h, x0, y0 + h, 3); side(x0, y0 + h, x0, y0, 4);
    pts.forEach(([u, v], i) => (i ? p.lineTo(u, v) : p.moveTo(u, v))); p.closePath();
    return p;
  }
  function wash(x, path, a, o = {}) {
    if (a <= 0) return;
    const col = o.rgb || INK;
    x.save(); x.globalAlpha *= a;
    x.fillStyle = rgba(col, o.fill ?? 0.1); x.fill(path);
    if (o.edge !== 0) { x.strokeStyle = rgba(col, o.edge ?? 0.28); x.lineWidth = o.lw || 2.4; x.lineJoin = "round"; x.stroke(path); }
    x.restore();
  }
  // 方框画成四笔：每笔稍出头，像毛笔勾的框，底下一层淡墨。
  function frame(x, bx, by, w, h, a, seed, o = {}) {
    if (a <= 0) return;
    if (o.fill !== 0) wash(x, roughRect(bx, by, w, h, seed, 2), a, { fill: o.fill ?? 0.07, edge: 0 });
    const lw = o.lw || 5;
    brush(x, seg2(bx - 6, by, bx + w + 8, by + 1), lw, { alpha: a, seed, tin: 0.04, tout: 0.1 });
    brush(x, seg2(bx + w, by - 4, bx + w - 1, by + h + 6), lw * 1.2, { alpha: a, seed: seed + 1, tin: 0.05, tout: 0.14, even: true });
    brush(x, seg2(bx + w + 6, by + h, bx - 4, by + h - 1), lw, { alpha: a, seed: seed + 2, tin: 0.04, tout: 0.1 });
    brush(x, seg2(bx, by + h + 4, bx + 1, by - 6), lw * 1.2, { alpha: a, seed: seed + 3, tin: 0.05, tout: 0.14, even: true });
  }
  // 圆相：一笔画圆，留一个口，起笔重、收笔干。
  function enso(x, cx, cy, r, a, seed, w = 9) {
    if (a <= 0) return;
    const pts = [], a0 = -1.9 + seed * 0.3, span = TAU * 0.9;
    for (let i = 0; i <= 48; i++) { const t = a0 + span * (i / 48), rr = r * (1 + 0.025 * Math.sin(i * 0.7 + seed)); pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]); }
    brush(x, pts, w, { alpha: a, seed, even: true, tin: 0.03, tout: 0.3, dryFrom: 0.5 });
  }
  function seal(x, cx, cy, s, str, a, o = {}) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.translate(cx, cy); x.rotate(o.rot ?? -0.04);
    x.fillStyle = verm(0.92); x.fill(roughRect(-s / 2, -s / 2, s, s, 77 + s, s * 0.04));
    if (str) text(x, str, 0, s * 0.3, { font: o.font || SERIF(s * 0.62, 900), color: rgba(PAPER), align: "center", texture: o.texture });
    x.restore();
  }
  function inkDot(x, px, py, r, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a;
    const g = x.createRadialGradient(px, py, 0, px, py, r * 3.2);
    g.addColorStop(0, verm(0.32)); g.addColorStop(1, verm(0));
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r * 3.2, 0, TAU); x.fill();
    x.fillStyle = verm(0.95); x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    x.restore();
  }
  function dashPath(x, pts, a, color = ink(0.75), dash = [10, 9], w = 2) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash); x.lineJoin = "round"; x.lineCap = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function dot(x, pts, k, a, r = 6) {
    if (k <= 0 || k >= 1 || a <= 0) return;
    const [px, py] = pathAt(pts, k * pathLen(pts));
    inkDot(x, px, py, r, a);
  }
  // 羽化的一块宣纸：中间实、四边按线性渐变淡出、四角用径向渐变接上。
  function feather(x, x0, y0, x1, y1, g, a) {
    if (a <= 0) return;
    const c1 = rgba(PAPER), c0 = rgba(PAPER, 0);
    x.save(); x.globalAlpha = a;
    x.fillStyle = c1; x.fillRect(x0, y0, x1 - x0, y1 - y0);
    const edge = (gx0, gy0, gx1, gy1, rx, ry, rw, rh) => {
      const gr = x.createLinearGradient(gx0, gy0, gx1, gy1); gr.addColorStop(0, c1); gr.addColorStop(1, c0);
      x.fillStyle = gr; x.fillRect(rx, ry, rw, rh);
    };
    edge(x0, 0, x0 - g, 0, x0 - g, y0, g, y1 - y0);
    edge(x1, 0, x1 + g, 0, x1, y0, g, y1 - y0);
    edge(0, y0, 0, y0 - g, x0, y0 - g, x1 - x0, g);
    edge(0, y1, 0, y1 + g, x0, y1, x1 - x0, g);
    for (const [cx, cy, sx, sy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, g); gr.addColorStop(0, c1); gr.addColorStop(1, c0);
      x.fillStyle = gr; x.fillRect(sx < 0 ? cx - g : cx, sy < 0 ? cy - g : cy, g, g);
    }
    x.restore();
  }
  function nar(x, key, px, py, r, a, size = 60, maxW = 1040) {
    if (a <= 0) return;
    // 旁白压在地层和线框上时看不清：字后面先铺一块边缘渐淡的宣纸。
    const f = BRUSH(size), lines = tr(key).split("\n"), lh = size * 1.35;
    const w = Math.min(maxW, Math.max(...lines.map((l) => K.measure(x, l, f))));
    feather(x, px - 24, py - size * 1.05, px + w + 24, py + (lines.length - 1) * lh + size * 0.45, 40, a * 0.96);
    text(x, tr(key), px, py, { font: f, color: ink(0.95), reveal: r, dim: 0.12, perChar: true, alpha: a, maxW, narration: true });
  }
  function T(x, str, px, py, o = {}) {
    const { size = 30, mono = false, w = 600, sub = false } = o;
    return text(x, str, px, py, { ...o, font: o.font || (mono ? MONO(size, o.w || 500) : SERIF(size, w >= 800 ? 900 : 600)), color: o.color || ink(sub ? 0.62 : 0.92) });
  }
  function dial(x, cx, cy, r, minute, a, hot = 0, seed = 1) {
    if (a <= 0) return;
    wash(x, new Path2D(`M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx + r - 0.01} ${cy}`), a, { fill: 0.06, edge: 0 });
    enso(x, cx, cy, r, a, seed, Math.max(4, r * 0.16));
    for (let i = 0; i < 12; i += 3) {
      const an = (i / 12) * TAU - Math.PI / 2;
      brush(x, seg2(cx + Math.cos(an) * (r - r * 0.3), cy + Math.sin(an) * (r - r * 0.3), cx + Math.cos(an) * (r - r * 0.14), cy + Math.sin(an) * (r - r * 0.14), 3), Math.max(2.4, r * 0.06), { alpha: a * 0.7, dry: false, even: true });
    }
    const an = (minute / 60) * TAU - Math.PI / 2;
    brush(x, seg2(cx, cy, cx + Math.cos(an) * r * 0.72, cy + Math.sin(an) * r * 0.72, 6), Math.max(3, r * 0.1), { alpha: a, color: hot > 0.05 ? verm(0.95) : ink(0.92), dry: false, even: true, tin: 0, tout: 0.5 });
    x.save(); x.globalAlpha = a; x.fillStyle = ink(0.95); x.beginPath(); x.arc(cx, cy, Math.max(3, r * 0.08), 0, TAU); x.fill(); x.restore();
  }

  function shapeY(shape, dx) {
    if (dx <= shape[0][0] || dx >= shape[shape.length - 1][0]) return 0;
    for (let i = 1; i < shape.length; i++) if (dx <= shape[i][0]) {
      const [x0, y0] = shape[i - 1], [x1, y1] = shape[i];
      return lerp(y0, y1, (dx - x0) / (x1 - x0));
    }
    return 0;
  }
  function events(phi) {
    const ev = [];
    for (const t of CHECKS) ev.push({ t, x: NOW_X - (phi - t) * V, s: UP, up: true });
    for (const t of KNOCKS) ev.push({ t, x: NOW_X - (phi - t) * V, s: DOWN, up: false });
    return ev.filter((v) => v.x + v.s[0][0] < NOW_X && v.x + v.s[v.s.length - 1][0] > -3000);
  }
  const traceY = (ev, u) => ev.reduce((y, v) => y + shapeY(v.s, u - v.x), Y0);
  // 墨线要量粗细，平直段也要有点才能起伏：每 24 px 补一个点。
  function tracePts(phi, x0) {
    const ev = events(phi), xs = [x0, NOW_X];
    for (let u = Math.ceil(x0 / 24) * 24; u < NOW_X; u += 24) xs.push(u);
    for (const v of ev) for (const [dx] of v.s) { const u = v.x + dx; if (u > x0 && u < NOW_X) xs.push(u); }
    xs.sort((a, c) => a - c);
    return { ev, pts: xs.map((u) => [u, traceY(ev, u)]) };
  }

  // 远山：基线上方两道淡墨山影，只在第一幕的空白里，给那条墨线一个「地平线」。
  const HILLS = [[0.07, 420, 120, 3], [0.12, 470, 70, 9]].map(([al, base, amp, s]) => {
    const pts = [];
    for (let u = -400; u <= 1180; u += 20) pts.push([u, Y0 - 6 - (Y0 - 6 - (base - amp * (0.5 + 0.5 * Math.sin(u * 0.006 + s)) * (0.55 + 0.45 * Math.sin(u * 0.017 + s * 2)))) * (1 - E.io(clamp((u - 820) / 360)))]);
    return { al, pts };
  });
  function hills(x, a) {
    if (a <= 0) return;
    for (const { al, pts } of HILLS) {
      const p = new Path2D(); p.moveTo(-400, Y0 - 6); pts.forEach(([u, v]) => p.lineTo(u, Math.min(v, Y0 - 6))); p.lineTo(1180, Y0 - 6); p.closePath();
      x.save(); x.globalAlpha = a;
      const g = x.createLinearGradient(0, 300, 0, Y0);
      g.addColorStop(0, ink(al * 1.4)); g.addColorStop(1, ink(al * 0.15));
      x.fillStyle = g; x.fill(p); x.restore();
    }
  }

  function ecg(x, b, cam, labA, dimK = 1) {
    const phi = b * 4;
    const left = Math.min(NOW_X - 40, cam.x - 960 / cam.zoom - 60);
    const { ev, pts } = tracePts(phi, left);
    const lw = Math.max(9, 7 / cam.zoom);
    brush(x, pts, lw, { alpha: 0.95 * dimK, phase: phi * V, tin: 0, tout: 0.02, dryFrom: 0.97 });
    const py = traceY(ev, NOW_X);
    inkDot(x, NOW_X, py, 7, dimK);
    for (const v of ev) if (phi >= v.t && phi - v.t < 1.2) {
      const k = Math.exp(-(phi - v.t) * 3.2);
      if (v.up) inkDot(x, v.x, Y0 - 220 * 0.98, 6, k * dimK * 0.9);
    }
    for (const v of ev) if (v.up && v.t > 0 && v.t <= 15 && phi >= v.t) {
      // 标签右端离开 health_buckets 卡的左沿之后再亮，免得压在卡角上；英文比中文宽，按实测宽度算。
      const str = tr("ch06.checkin"), f = SERIF(30, 600), hw = K.measure(x, str, f) / 2;
      const a = labA * prog(LEDGER.x - (v.x + hw), 10, 90) * (v.x > 90 ? 1 : 0);
      T(x, str, v.x, Y0 - 230, { font: f, align: "center", alpha: a });
    }
    return py;
  }

  function ledgerBox(x, phi, a) {
    if (a <= 0) return;
    const { x: bx, y: by, w, h } = LEDGER;
    frame(x, bx, by, w, h, a, 11);
    T(x, "health_buckets", bx + 22, by + 46, { mono: true, size: 28, w: 600, alpha: a, maxW: w - 44 });
    [["lyjw.me", KNOCKS], ["Core", CHECKS]].forEach(([name, list], r) => {
      const y = by + 94 + r * 46;
      T(x, name, bx + 22, y + 9, { mono: true, size: 28, sub: true, alpha: a });
      const seen = list.filter((t) => t <= phi);
      const n = seen.length;
      // 最多 8 条：再多一条就贴上左边的「lyjw.me」。
      for (let j = 0; j < Math.min(n, 8); j++) {
        const t = seen[n - 1 - j];
        const tx0 = bx + w - 26 - j * 13;
        const k = prog(phi, t, t + 0.15);
        brush(x, seg2(tx0, y - 13, tx0 + 1, y + 11, 3), 7, { alpha: a * (0.35 + 0.6 * k) * (1 - j / 10), seed: t, even: true, dry: false, tin: 0.2, tout: 0.4 });
      }
    });
  }
  function siteBoxes(x, phi, a) {
    if (a <= 0) return;
    frame(x, SITE.x, SITE.y, SITE.w, SITE.h, a, 21);
    T(x, "lyjw.me", SITE.x + 20, SITE.y + 48, { mono: true, size: 32, w: 600, alpha: a });
    T(x, "site Worker", SITE.x + 20, SITE.y + 96, { mono: true, size: 28, sub: true, alpha: a, maxW: SITE.w - 40 });
    frame(x, API.x, API.y, API.w, API.h, a, 31);
    T(x, "workers/core", API.x + 20, API.y + 48, { mono: true, size: 32, w: 600, alpha: a });
    T(x, tr("ch06.cron"), API.x + 20, API.y + 96, { size: 28, sub: true, alpha: a });
    dial(x, API.x + API.w - 40, API.y + 84, 20, phi % 60, a, 0, 3);
  }
  function signalLabels(x, a, footA) {
    if (a <= 0) return;
    T(x, "↓ " + tr("ch06.knock"), NOW_X + 24, 372, { size: 36, w: 700, alpha: a });
    T(x, "GET /api/version", NOW_X + 24, 414, { mono: true, size: 28, alpha: a });
    T(x, tr("ch06.knockSub"), NOW_X + 24, 454, { size: 28, sub: true, alpha: a, maxW: 1900 - NOW_X - 24 });
    T(x, tr("ch06.knockOnly"), NOW_X + 24, 494, { size: 28, sub: true, alpha: a, maxW: 1900 - NOW_X - 24 });
    T(x, "↑ " + tr("ch06.checkin") + (footA > 0.02 ? " *" : ""), API.x + API.w + 18, API.y + 40, { size: 36, w: 700, alpha: a });
    T(x, tr("ch06.checkinSub"), API.x + API.w + 18, API.y + 80, { size: 28, sub: true, alpha: a, maxW: 1900 - API.x - API.w - 18 });
    if (footA > 0) T(x, "* " + tr("ch06.foot"), SITE.x, 880, { size: 36, color: verm(0.95), alpha: footA, maxW: 760 });
  }
  function signalPaths(x, phi, a) {
    if (a <= 0) return;
    dashPath(x, KNOCK_PATH, 0.3 * a);
    dashPath(x, [CHECK_PATH[0], CHECK_PATH[1]], 0.3 * a);
    for (const t of KNOCKS) if (phi > t - 0.3 && phi < t + 0.3) dot(x, KNOCK_PATH, (phi - (t - 0.3)) / 0.6, a, 5);
    for (const t of CHECKS) if (phi > t - 0.35 && phi < t + 0.35) dot(x, CHECK_PATH, (phi - (t - 0.35)) / 0.7, a, 7);
  }

  const toCard = [[LAGG[0] + 70, LAGG[1]], [CARD.x - 40, LAGG[1]]];
  const toLedger = [[COL[0] - COL_R, COL[1]], [LEDGER.x + LEDGER.w + 8, COL[1]]];
  function collector(x, b, a) {
    if (a <= 0) return;
    const phi = b * 4;
    const hot = impact(b, AT.fetch, 0.15);
    dial(x, COL[0], COL[1], COL_R, phi % 60, a, hot, 5);
    T(x, tr("ch06.collector"), COL[0], COL[1] + COL_R + 46, { size: 30, w: 700, align: "center", alpha: a });
    T(x, tr("ch06.every5"), COL[0], COL[1] + COL_R + 84, { size: 28, sub: true, align: "center", alpha: a });
    glyph(x, "lag", LAGG[0], LAGG[1], ink(0.85), 0.8, a);
    T(x, "KV LAG", LAGG[0], LAGG[1] + 60, { mono: true, size: 28, sub: true, align: "center", alpha: a });
    dashPath(x, toLedger, 0.35 * a);
    dashPath(x, [[COL[0], COL[1] + COL_R + 98], [LAGG[0], LAGG[1] - 36]], 0.35 * a);
    dashPath(x, toCard, 0.35 * a);
    const kGo = prog(b, AT.fetch, AT.fetch + 0.22, E.io), kBack = prog(b, AT.back, AT.back + 0.25, E.io);
    if (b >= AT.fetch && b < AT.back + 0.3) {
      const k = b < AT.back ? kGo : 1 - kBack;
      const px = lerp(toLedger[0][0] - 60, toLedger[1][0] + 60, k);
      inkDot(x, px, COL[1], 9, a);
      T(x, "SELECT", px, COL[1] - 32, { mono: true, size: 28, w: 600, color: verm(0.95), align: "center", alpha: a });
    }
    const dk = prog(b, AT.back + 0.25, AT.lit, E.io);
    if (dk > 0 && dk < 1) dot(x, [[COL[0], COL[1] + COL_R + 98], [LAGG[0], LAGG[1] - 36], [LAGG[0] + 70, LAGG[1]], [CARD.x - 40, LAGG[1]]], dk, a, 7);
  }
  // LYJWPAGE 卡裱成一幅立轴：绫边、上下两根轴杆，画心里是这张卡。
  function card(d, b, a) {
    if (a <= 0) return;
    const { x: cx, y: cy, w, h } = CARD;
    d.save(); d.globalAlpha = a;
    d.shadowColor = "rgba(40,30,20,0.25)"; d.shadowBlur = 24; d.shadowOffsetY = 8;
    d.fillStyle = rgba(SILK); d.fillRect(cx - 34, cy - 40, w + 68, h + 80);
    d.shadowColor = "transparent";
    d.fillStyle = paperTile(); d.globalAlpha = a * 0.6; d.fillRect(cx - 34, cy - 40, w + 68, h + 80); d.globalAlpha = a;
    d.fillStyle = rgba(PAPER); d.fillRect(cx, cy, w, h);
    d.fillStyle = paperTile(); d.fillRect(cx, cy, w, h);
    for (const yy of [cy - 52, cy + h + 40]) { d.fillStyle = rgba(WOOD); d.fillRect(cx - 50, yy, w + 100, 14); d.fillStyle = rgba(WOOD, 0.6); d.fillRect(cx - 62, yy - 2, 14, 18); d.fillRect(cx + w + 48, yy - 2, 14, 18); }
    d.restore();
    T(d, "LYJWPAGE", cx + 36, cy + 58, { mono: true, size: 32, w: 700, alpha: a });
    T(d, "/api/status/health", cx + w - 36, cy + 56, { mono: true, size: 28, sub: true, align: "right", alpha: a });
    brush(d, seg2(cx + 30, cy + 80, cx + w - 30, cy + 80, 12), 3.2, { alpha: a * 0.7, seed: 9 });
    const lit = prog(b, AT.lit, AT.lit + 0.1, E.outBack);
    const cw = (w - 72 - (UPTIME_CELLS - 1) * 4) / UPTIME_CELLS;
    ["lyjw.me", "Core"].forEach((name, r) => {
      const topY = cy + 124 + r * 136;
      T(d, name, cx + 36, topY, { size: 32, w: 700, alpha: a });
      T(d, "Operational", cx + w - 36, topY - 2, { size: 28, sub: true, align: "right", alpha: a });
      for (let i = 0; i < UPTIME_CELLS; i++) {
        const x0 = cx + 36 + i * (cw + 4), y0 = topY + 18;
        const today = i === UPTIME_CELLS - 1;
        const rk = prog(b, 4.1 + i * 0.012 + r * 0.05, 4.25 + i * 0.012 + r * 0.05);
        if (!today) { wash(d, roughRect(x0, y0, cw, 40, i + r * 40, 1.5), a * rk, { fill: 0.2, edge: 0.3, lw: 1.2 }); continue; }
        wash(d, roughRect(x0, y0, cw, 40, 99 + r, 1.5), a * rk, { fill: 0.04, edge: 0.7, lw: 1.8 });
        if (lit > 0) {
          const s = lerp(1.25, 1, clamp(lit));
          d.save(); d.translate(x0 + cw / 2, y0 + 20); d.scale(s, s);
          d.globalAlpha = a * clamp(lit * 1.5); d.fillStyle = rgba(MALACHITE); d.fillRect(-cw / 2, -20, cw, 40);
          d.restore();
        }
      }
      T(d, "30 days ago", cx + 36, topY + 98, { mono: true, size: 28, sub: true, alpha: a });
      T(d, "Today", cx + w - 36, topY + 98, { mono: true, size: 28, sub: true, align: "right", alpha: a });
    });
    seal(d, cx + w + 4, cy + h + 4, 40, tr("ch06.seal"), a * 0.9, { font: BRUSH(I18N.lang === "en" ? 17 : 26), texture: true, rot: 0.06 });
  }

  const R = mulberry32(8080);
  const WIN0 = 1;
  const CODING = [];
  for (let k = -16; k <= 3; k++) {
    const from = 15 * k + WIN0;
    const zero = k === -5 || k === -1 || k === -9 || k === -12;
    const level = zero ? 0 : 1 + Math.floor(R() * 4);
    const band = [];
    if (!zero) for (let m = 0; m < 15;) { const len = 2 + Math.floor(R() * 5), v = R() < 0.25 ? 0 : 1 + Math.floor(R() * 3); band.push([from + m, from + Math.min(15, m + len), v]); m += len; }
    CODING.push({ from, level, band, zero, prob: 0.35 + 0.55 * R() });
  }
  const TOKENS = [];
  for (const w of CODING) for (let j = 0; j < 3; j++) TOKENS.push([w.from + j * 5, w.zero ? [0, 0, 0] : [R() * 0.6, R() * 0.35, R() * 0.25]]);
  const LISTEN = [];
  for (let t = -240; t < -130;) { const len = 3 + R() * 1.5; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  for (let t = -6; t < 22;) { const len = 3 + R() * 1.4; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  LISTEN.push([22, 60, true]);
  const WATCH = [[-128, -84]];
  const GAME = [[-78, -40, 1], [-40, -32, 0.5]];
  const WORKOUT = [-62, -44];
  const STEPS = [];
  for (let t = -300; t < 60; t += 5) STEPS.push([t, t >= WORKOUT[0] && t < WORKOUT[1] ? 0.7 + 0.3 * R() : R() < 0.55 ? R() * 0.35 : 0]);
  const tx = (phi, t) => NOW_X - (phi - t) * SC;
  const ORDER = CODING.filter((w) => !w.zero && w.from + 15 + 2 <= AT.sweep0 * 4 && tx(AT.sweep0 * 4, w.from + 15) > 250);

  // 墨分五色：七条道按焦、浓、重、淡、清轮着铺，每层上沿是一道湿边。
  const LANE_TONE = [0.17, 0.08, 0.13, 0.05, 0.11, 0.06, 0.09];
  const LANE_PATHS = LANES.map((_, i) => {
    const y = laneY(i), p = new Path2D();
    p.moveTo(ST_X0, y + LANE_H);
    for (let u = ST_X0; u <= NOW_X; u += 30) p.lineTo(u, y + 3 * Math.sin(u * 0.011 + i * 1.7) + 2 * Math.sin(u * 0.043 + i));
    p.lineTo(NOW_X, y + LANE_H); p.closePath();
    return p;
  });
  function strata(x, b, a, focus) {
    if (a <= 0) return;
    const phi = b * 4;
    LANES.forEach((_, i) => wash(x, LANE_PATHS[i], a, { fill: LANE_TONE[i], edge: 0.22, lw: 2 }));
    const clipL = ST_X0, clipR = NOW_X;
    const dab = (i, t0, t1, h, alpha, rgb = INK) => {
      const x0 = Math.max(clipL, tx(phi, t0)), x1 = Math.min(clipR, tx(phi, t1));
      if (x1 <= x0 || alpha <= 0) return;
      const y = laneY(i) + LANE_H - 12 - h;
      x.save(); x.globalAlpha = alpha; x.fillStyle = rgba(rgb, 0.85); x.beginPath(); x.roundRect(x0, y, x1 - x0, h, Math.min(4, h / 2)); x.fill();
      x.fillStyle = rgba(rgb, 1); x.fillRect(x0, y, x1 - x0, Math.min(3, h)); x.restore();
    };
    const dimOf = (i) => a * (i <= 1 ? 1 : 1 - focus);
    for (const w of CODING) for (const [t0, t1, v] of w.band) if (v && t1 <= phi) dab(0, t0, Math.min(t1, phi), 12, dimOf(0) * [0, 0.3, 0.55, 0.85][v]);
    for (const [t0, [m, c, u]] of TOKENS) {
      if (t0 + 5 > phi) continue;
      const x0 = tx(phi, t0) + 3, x1 = tx(phi, t0 + 5) - 3;
      if (x1 < clipL || x0 > clipR) continue;
      let y = laneY(1) + LANE_H - 8;
      [[m, 0.85], [c, 0.55], [u, 0.3]].forEach(([v, al]) => { const hh = v * 52; x.save(); x.globalAlpha = dimOf(1) * al; x.fillStyle = ink(0.85); x.fillRect(x0, y - hh, x1 - x0, hh); x.restore(); y -= hh; });
    }
    for (const [t0, t1, hero] of LISTEN) {
      if (t0 > phi) continue;
      if (hero) {
        const k = impact(b, AT.hero, 0.35);
        dab(2, t0, Math.min(t1, phi), 30, dimOf(2) * (0.75 + 0.25 * k), VERM);
        if (k > 0.02) inkDot(x, (tx(phi, t0) + NOW_X) / 2, laneY(2) + LANE_H - 27, 12, k * a * 0.8);
      } else dab(2, t0, Math.min(t1, phi) - 0.25, 22, dimOf(2) * 0.6);
    }
    for (const [t0, t1] of WATCH) dab(3, t0, t1, 22, dimOf(3) * 0.6);
    for (const [t0, t1, v] of GAME) dab(4, t0, t1, v > 0.9 ? 22 : 10, dimOf(4) * 0.6);
    {
      const pts = [];
      for (let t = -300; t <= phi; t += 2) {
        const u = t < -96 || t > 16 ? 0.04 : t < -88 ? 0.04 + (t + 96) / 8 * 0.96 : 0.04 + 0.96 * Math.exp(-(t + 88) / 34);
        pts.push([tx(phi, t), laneY(5) + LANE_H - 10 - u * 44]);
      }
      brush(x, pts.filter(([u]) => u >= clipL && u <= clipR), 4, { alpha: dimOf(5) * 0.85, phase: phi * SC, tin: 0, tout: 0.02, dry: false, even: true });
    }
    for (const [t0, v] of STEPS) if (v > 0 && t0 + 5 <= phi) dab(6, t0 + 0.4, t0 + 4.6, v * 44, dimOf(6) * 0.6);
    {
      const x0 = tx(phi, WORKOUT[0]), x1 = tx(phi, WORKOUT[1]);
      if (x1 > clipL && x0 < clipR) {
        const al = dimOf(6) * 0.85;
        brush(x, seg2(x0, laneY(6) + 10, x1, laneY(6) + 10, 6), 3, { alpha: al, dry: false, even: true });
        brush(x, seg2(x0, laneY(6) + 3, x0, laneY(6) + 17, 2), 3, { alpha: al, dry: false, even: true });
        brush(x, seg2(x1, laneY(6) + 3, x1, laneY(6) + 17, 2), 3, { alpha: al, dry: false, even: true });
      }
    }
    brush(x, seg2(NOW_X, ST_TOP - 6, NOW_X + 1, ST_BOT + 8, 14), 6, { alpha: 0.8 * a, even: true, seed: 4 });
    const fk = phi - Math.floor(phi / 5) * 5;
    const flash = Math.exp(-fk * 6);
    x.save(); x.globalAlpha = 0.5 * flash * a; x.fillStyle = verm(0.8); x.fill(roughRect(NOW_X - SC - 4, ST_TOP, SC + 4, ST_BOT - ST_TOP, 5, 3)); x.restore();
    const drop = [[API.x + 40, API.y + API.h], [API.x + 40, ST_TOP - 20], [NOW_X - 4, ST_TOP - 20], [NOW_X - 4, ST_TOP]];
    const da = a * (1 - focus);
    dashPath(x, drop, 0.3 * da);
    const dk = (phi + 0.55) % 5;
    if (dk < 0.55) dot(x, drop, dk / 0.55, da, 5);
  }
  function laneLabels(x, cam, a, ta, focus) {
    if (a <= 0) return;
    const z = cam.zoom, wx = (sx) => cam.x + (sx - 960) / z;
    x.save(); x.globalAlpha = a; x.fillStyle = rgba(PAPER); x.fillRect(wx(0), ST_TOP - 70, wx(290) - wx(0), ST_BOT - ST_TOP + 90);
    x.fillStyle = paperTile(); x.fillRect(wx(0), ST_TOP - 70, wx(290) - wx(0), ST_BOT - ST_TOP + 90); x.restore();
    brush(x, seg2(wx(290), ST_TOP - 70, wx(290), ST_BOT + 20, 12), 5 / z, { alpha: 0.8 * a, even: true, seed: 6 });
    T(x, "Pulse", wx(40), ST_TOP - 22, { mono: true, size: 34 / z, w: 600, alpha: ta });
    LANES.forEach((name, i) => {
      const hot = i <= 1 ? 1 : 1 - focus;
      T(x, name, wx(40), laneY(i) + LANE_H / 2 + 11 / z, { mono: true, size: 32 / z, sub: !(i <= 1 && focus > 0.5), alpha: ta * hot });
    });
  }
  function strataNotes(x, b, a) {
    if (a <= 0) return;
    glyph(x, "d1", NOW_X + 170, 1060, ink(0.85), 1, a);
    T(x, "D1", NOW_X + 90, 1150, { mono: true, size: 38, w: 600, alpha: a });
    T(x, "lyjwpage-history", NOW_X + 90, 1196, { mono: true, size: 34, sub: true, alpha: a });
    T(x, tr("ch06.keep"), NOW_X + 90, 1252, { size: 40, w: 700, color: verm(0.95), alpha: a });
    T(x, tr("ch06.archive"), NOW_X - 50, ST_TOP - 32, { size: 34, align: "right", alpha: a, maxW: 640 });
    T(x, "← " + tr("ch06.older"), 20, ST_BOT + 66, { size: 36, sub: true, alpha: a, maxW: 1000 });
  }

  function coding(x, b, a, cam) {
    if (a <= 0) return;
    const phi = b * 4;
    const y0 = laneY(0);
    const done = CODING.filter((w) => w.from + 15 + 2 <= phi && tx(phi, w.from + 15) > 250);
    // Clef 框和 lyjw.me 卡片在世界坐标里叠在一起，镜头拉远、卡片淡入之前就得收掉。
    const sa = a * (1 - prog(b, 9.75, 9.9));
    frame(x, SCORER.x, SCORER.y, SCORER.w, SCORER.h, sa, 41, { lw: 3.6, fill: 0.12 });
    T(x, "Clef", SCORER.x + 16, SCORER.y + 38, { mono: true, size: 28, w: 600, alpha: sa });
    T(x, tr("ch06.jevNote"), SCORER.x + 90, SCORER.y + 36, { size: 21, sub: true, alpha: sa, maxW: SCORER.w - 100 });
    T(x, tr("ch06.jevKeep"), SCORER.x, SCORER.y - 16, { size: 21, sub: true, alpha: sa, maxW: 540 });
    for (const w of CODING) {
      const x0 = tx(phi, w.from), x1 = tx(phi, w.from + 15);
      if (x1 < 200 || x0 > NOW_X) continue;
      const closed = w.from + 15 + 2 <= phi;
      x.save(); x.globalAlpha = a; x.strokeStyle = ink(closed ? 0.7 : 0.45); x.lineWidth = 2; if (!closed) x.setLineDash([7, 7]);
      x.strokeRect(x0 + 2, y0 + 3, Math.min(x1, NOW_X) - x0 - 4, LANE_H - 6); x.restore();
      for (let j = 1; j < 3; j++) { const u = tx(phi, w.from + j * 5); if (u < NOW_X) brush(x, seg2(u, y0 + LANE_H - 18, u, y0 + LANE_H - 4, 2), 2.4, { alpha: 0.7 * a, dry: false, even: true }); }
      if (!closed) continue;
      let k = 0, t0 = 0;
      if (w.zero) k = prog(b, AT.zero, AT.zero + 0.1);
      else {
        t0 = AT.sweep0 + ORDER.indexOf(w) * AT.sweepStep;
        k = prog(b, t0 + 0.06, t0 + 0.12, E.out);
        const ask = win(b, t0 - 0.02, t0, t0 + 0.1, t0 + 0.16);
        if (ask > 0) dashPath(x, [[SCORER.x + SCORER.w / 2, SCORER.y + SCORER.h], [(x0 + x1) / 2, y0 - 4]], 0.9 * ask, verm(0.9), [6, 6], 2.4);
      }
      if (k <= 0) continue;
      const hh = w.zero ? 0 : 8 + w.level * 10;
      const yb = y0 + LANE_H - 20, lx0 = x0 + 12, lw = x1 - x0 - 24;
      const fresh = w.zero ? 0 : impact(b, t0 + 0.08, 0.25);
      if (!w.zero) { x.save(); x.globalAlpha = 0.14 * a; x.fillStyle = ink(1); x.fillRect(lx0, yb - hh * k, lw, hh * k); x.restore(); }
      brush(x, seg2(lx0, yb - hh * k, lx0 + lw, yb - hh * k, 4), 5, { alpha: a * (w.zero ? 0.7 : 0.92), color: fresh > 0.05 ? verm(0.95) : ink(0.92), seed: w.from, dry: false });
      // 打完分的窗在右上角盖一枚小朱印，盖下去那一下稍大。
      if (!w.zero) seal(x, x1 - 16, y0 + 18, 16 * (1 + 0.5 * fresh), null, a * k * 0.9);
      if (w.zero) T(x, "0", (x0 + x1) / 2, y0 + 34, { mono: true, size: 24, w: 600, sub: true, align: "center", alpha: a * k });
    }
    const zw = done.filter((w) => w.zero).pop();
    if (zw) {
      const za = prog(b, AT.zero, AT.zero + 0.15) * a;
      const cx = (tx(phi, zw.from) + tx(phi, zw.from + 15)) / 2;
      K.leader(x, cx, y0 + 4, tr("ch06.skip"), -30, -56, { font: SERIF(22, 600), color: ink(0.9), alpha: za, dot: 4 });
    }
    const lx = cam.x + (310 - 960) / cam.zoom;
    T(x, tr("ch06.sources"), lx, laneY(2) + 30, { size: 21, w: 700, alpha: a });
    const wn = tr("ch06.window"), wf = SERIF(21, 600);
    x.save(); x.globalAlpha = a; x.fillStyle = rgba(PAPER); x.fillRect(lx - 8, ST_TOP - 42, K.measure(x, wn, wf) + 16, 34); x.restore();
    T(x, wn, lx, ST_TOP - 16, { font: wf, sub: true, alpha: a });
  }

  // 题签：朱文方印「06」，旁边一行毛笔字的章名。
  function title(x, b) {
    const a = prog(b, 0.45, 0.95, E.out) * (1 - prog(b, 3.8, 4.0));
    if (a <= 0) return;
    seal(x, 166, 170, 104, "06", a * prog(b, 0.45, 0.6), { font: MONO(56, 700), rot: -0.05 });
    text(x, tr("ch06.title"), 260, 196, { font: BRUSH(78), color: ink(0.95), reveal: prog(b, 0.5, 1.0), perChar: true, alpha: a });
    T(x, "collector · workers/core · D1", 264, 248, { mono: true, size: 28, sub: true, reveal: prog(b, 0.6, 1.1), alpha: a });
    brush(x, seg2(110, 270, 110 + 640 * prog(b, 0.55, 1.2, E.outExpo), 271, 16), 4, { alpha: 0.7 * a, seed: 2 });
  }

  // Clawd 画成没骨：橙色一笔铺身体，边上积一道深色水痕，眼睛点墨。
  function clawdInk(x, cx, bottom, q, pose) {
    const { body, eyes } = window.Clawd.cells(pose, 0);
    x.save(); x.translate(cx - 9 * q, bottom - 12 * q);
    const p = new Path2D();
    for (const [a, b2] of body) p.rect(a * q - 0.5, b2 * 2 * q - 0.5, q + 1, 2 * q + 1);
    x.save(); x.translate(q * 0.22, q * 0.3); x.fillStyle = "rgba(150,62,38,0.35)"; x.fill(p); x.restore();
    x.fillStyle = "rgba(215,119,87,0.92)"; x.fill(p);
    x.fillStyle = ink(0.95);
    for (const [a, b2] of eyes) x.fillRect(a * q - 0.5, b2 * 2 * q - 0.5, q + 1, 2 * q + 1);
    x.restore();
  }
  // 气泡换成一张便笺：纸条、毛笔框、一根细线指向 Clawd。
  function slip(x, str, bx, by, k, reveal, ax, ay) {
    if (k <= 0) return;
    const lines = str.split("\n"), size = 36, f = BRUSH(size), lh = size * 1.35;
    const w = Math.max(...lines.map((l) => K.measure(x, l, f))) + 56, h = lines.length * lh + 34;
    x.save(); x.globalAlpha *= clamp(k * 2); x.translate(bx, by); x.scale(lerp(0.85, 1, E.outBack(clamp(k))), lerp(0.85, 1, E.outBack(clamp(k))));
    x.shadowColor = "rgba(40,30,20,0.25)"; x.shadowBlur = 16; x.shadowOffsetY = 5;
    x.fillStyle = rgba(PAPER); x.fillRect(-w, -h, w, h); x.shadowColor = "transparent";
    x.fillStyle = paperTile(); x.fillRect(-w, -h, w, h);
    x.restore();
    x.save(); x.globalAlpha *= clamp(k * 2);
    frame(x, bx - w, by - h, w, h, 1, 51, { lw: 3.4, fill: 0 });
    brush(x, seg2(bx - 30, by + 2, ax, ay, 6), 3, { even: true, dry: false, tin: 0.2, tout: 0.6 });
    lines.forEach((l, i) => text(x, l, bx - w + 28, by - h + 22 + size + i * lh, { font: f, color: ink(0.95), reveal: clamp(reveal * lines.length - i), perChar: true }));
    x.restore();
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, phi = b * 4;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.lit, 0.12), impact(b, 0, 0.1) * 0.6);
    cam.zoom *= 1 + 0.012 * hitS;
    G.setCam(cam);
    G.clear([0.85, 0.79, 0.65]);

    const x = page.begin(); page.cam(cam);
    const tp = top.begin(); top.cam(cam);
    x.save(); x.fillStyle = rgba(PAPER); x.fillRect(-3200, -1200, 7200, 4200); x.fillStyle = paperTile(); x.fillRect(-3200, -1200, 7200, 4200); x.restore();

    const outA = 1 - prog(b, 11.35, 11.85);
    const labA = prog(b, 0.55, 0.95) * outA * (1 - win(b, 7.85, 8.05, 9.9, 10.1));
    hills(x, prog(b, 0.4, 1.2) * (1 - prog(b, 3.7, 4.0)));
    title(x, b);
    ecg(x, b, cam, labA * (1 - prog(b, 3.9, 4.0)), 1 - 0.65 * win(b, 6.0, 6.4, 10.6, 11.3));
    ledgerBox(x, phi, labA);
    siteBoxes(x, phi, labA);
    signalPaths(x, phi, labA);
    // 上一幕的标签淡完，KV LAG 这一幕才进：「只说明 site Worker 还在出页面」那行（英文更长）伸到了 KV LAG 图标底下。
    signalLabels(x, win(b, 0.6, 0.95, 3.76, 3.88), win(b, 2.5, 2.7, 3.76, 3.88));
    const bA = win(b, 3.88, 4.1, 5.95, 6.2);
    collector(x, b, bA);
    card(x, b, bA);
    const sA = prog(b, 5.9, 6.2) * (1 - prog(b, 11.2, 11.7));
    const focus = win(b, 7.9, 8.1, 9.9, 10.1);
    strata(x, b, sA, focus);
    strataNotes(x, b, win(b, 6.1, 6.4, 7.85, 8.0));
    // 等上一幕的 lyjw.me、core 方框淡完再进：Clef 框和它们在世界坐标里叠在一起。
    coding(x, b, win(b, 8.05, 8.2, 9.9, 10.05), cam);
    // 字要先于垫底淡出：垫底一变透明，下面的条就露出来，字还在就压在条上。
    laneLabels(x, cam, sA * (1 - prog(b, 9.95, 10.15)), sA * (1 - prog(b, 9.82, 9.94)), focus);
    nar(x, "ch06.n1a", 110, 944, prog(b, 1.0, 1.6), win(b, 1.0, 1.1, 3.8, 3.95));
    nar(x, "ch06.n1b", 110, 1024, prog(b, 1.6, 2.4), win(b, 1.0, 1.1, 3.8, 3.95));
    const at = (sx, sy, c) => [c[0] + (sx - 960) / c[2], c[1] + (sy - 540) / c[2]];
    { const [nx, ny] = at(110, 944, B), [, ny2] = at(110, 1024, B);
      nar(x, "ch06.n2a", nx, ny, prog(b, 4.1, 4.6), win(b, 4.05, 4.15, 5.85, 5.98));
      nar(x, "ch06.n2b", nx, ny2, prog(b, 4.6, 5.3), win(b, 4.05, 4.15, 5.85, 5.98)); }
    { const s = 1 / C[2], [nx, ny] = at(110, 944, C), [, ny2] = at(110, 1024, C);
      nar(x, "ch06.n3a", nx, ny, prog(b, 6.35, 6.9), win(b, 6.3, 6.4, 7.85, 7.98), 60 * s, 1040 * s);
      nar(x, "ch06.n3b", nx, ny2, prog(b, 6.9, 7.5), win(b, 6.3, 6.4, 7.85, 7.98), 60 * s, 1040 * s); }
    { const s = 1 / D[2], [nx, ny] = at(110, 944, D), [, ny2] = at(110, 1024, D);
      nar(x, "ch06.n4a", nx, ny, prog(b, 8.1, 8.6), win(b, 8.05, 8.15, 9.85, 9.98), 60 * s, 1040 * s);
      nar(x, "ch06.n4b", nx, ny2, prog(b, 8.6, 9.2), win(b, 8.05, 8.15, 9.85, 9.98), 60 * s, 1040 * s); }
    const cIn = prog(b, AT.clawd - 0.2, AT.clawd), cOut = prog(b, 11.45, 11.7);
    if (cIn > 0 && cOut < 1) {
      const rise = E.outBack(cIn) * (1 - E.in(cOut));
      const cx = 760, base = ST_TOP + 4;
      tp.save(); tp.beginPath(); tp.rect(cx - 200, base - 260, 400, 260); tp.clip();
      clawdInk(tp, cx, base + (1 - rise) * 90, 6, cIn < 1 ? "arms-up" : "default");
      tp.restore();
      const sk = prog(b, AT.clawd + 0.1, AT.clawd + 0.25) * (1 - prog(b, 11.35, 11.45));
      slip(tp, tr("ch06.clawd"), cx - 70, base - 110, sk, prog(b, AT.clawd + 0.15, 10.9), cx - 30, base - 60);
    }

    G.composite(page.upload(), { mode: G.MODE.normal });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 5;
    f.post = {
      bloom: 0, threshold: 1.2, halation: 0, grain: 0.035, vignette: 0.24, ca: 0,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch06", title: "ch.06", bars: 12,
    async init() {
      page = G.layer("bg"); top = G.layer("top");
      await Promise.all([document.fonts.load(BRUSH(60), "心电图"), document.fonts.load(SERIF(30, 600), "报到"), document.fonts.load(SERIF(30, 900), "墨")]);
    },
    render,
  });
})();
