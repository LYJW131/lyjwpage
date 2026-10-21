// 画面只从这里取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
// 这一章画成宣纸上的水墨：心电图是一笔横贯的墨线，地层是墨分五色的淡墨层，Coding 那条三色带读的时候现场刷出来。
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
    "ch06.raw": ["存的只是原始观测（示意）", "raw observations (illustrative)"],
    "ch06.bandHuman": ["前台是编码应用", "Coding app"],
    "ch06.bandAgent": ["有 agent 在跑", "Agent"],
    "ch06.bandBoth": ["两者同时", "Coding app + agent"],
    "ch06.illus": ["（示意）", "(illustrative)"],
    "ch06.n4a": ["Coding 那条带子不存，", "The Coding band isn't stored;"],
    "ch06.n4b": ["读的时候从原始观测现算。", "reads compute it from the raw facts."],
    "ch06.clawd": ["线上出错时，\n我先去 Workers Issues 查证据。", "When something breaks,\nI check Workers Issues first."],
    "ch06.seal": ["墨", "ink"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let page, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const AT = { fetch: 5.0, back: 5.25, lit: 5.5, sink: 6.0, hero: 7.0, edge: 9.0, coding: 11.0, raw: 11.25, band: 11.5, legend: 12.0, sum: 12.25, clawd: 13.25, rise: 15.0 };
  const CHECKS = [], KNOCKS = [];
  for (let k = 0; k <= 65; k += 5) CHECKS.push(k);
  for (let k = 0; k <= 65; k++) KNOCKS.push(k + 0.5);

  // ch07 收尾、ch08 与 ch09 的提交落点和 ch10 的回顾几何须与此处一致，章节接缝才能对齐。
  const Y0 = 540;
  const NOW_X = 1350;
  const V = 200;
  const UP = [[-98, 0], [0, -220], [34, 46], [62, 0]];
  const DOWN = [[-16, 0], [0, 104], [14, -22], [30, 0]];
  const LEDGER = { x: 1210, y: 120, w: 280, h: 170 };
  const SITE = { x: 1095, y: 700, w: 230, h: 124 };
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
  const LEG_X = 900, BAND_Y = 50, BAND_H = 14;

  // 首帧接 ch05 末帧那条屏幕 y 540 的直线：它就是心电图的基线，报到尖峰在屏幕 x 1100 处立起来。
  const Z0 = 1.5;
  const FIRST = [NOW_X + (960 - 1100) / Z0, Y0, Z0, 0];
  const A = [960, 540, 1, 0], B = [1960, 480, 1, 0], C = [700, 1180, 0.85, 0], C2 = [1108, 1250, 1.2, 0], D = [900, 1000, 1.45, 0], CL = [880, 790, 1.1, 0];
  const CAM = [
    [0, FIRST],
    [0.95, A, E.io],
    [3.76, [966, 540, 1.012, 0], E.lin],
    [4.0, B, E.io],
    [5.76, [1968, 482, 1.012, 0], E.lin],
    [6.34, C, E.io],
    [8.76, [708, 1184, 0.866, 0], E.lin],
    [AT.edge, C2, E.io],
    [10.76, [1113, 1252, 1.218, 0], E.lin],
    [AT.coding, D, E.io],
    [12.76, [906, 1000, 1.47, 0], E.lin],
    [13.0, CL, E.io],
    [AT.rise, [887, 785, 1.12, 0], E.lin],
    [16.0, A, E.io],
  ];

  // ---- 纸、墨、朱砂 ----
  // PAPER 须与 ch05.js 的 PAPER06 同步：第 05 章收尾把纸色挪到这里，切过来底色不跳。
  const INK = [30, 26, 22], PAPER = [238, 230, 211], VERM = [184, 54, 38], MIX = [107, 40, 30], SILK = [196, 203, 194], WOOD = [74, 52, 38], MALACHITE = [74, 128, 100];
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
  // AMP 是起伏的幅度，只在收尾那一小节里收到 0（心电图拉平成第 07 章首帧那道横线）。
  let AMP = 1;
  const traceY = (ev, u) => (AMP === 1 ? ev.reduce((y, v) => y + shapeY(v.s, u - v.x), Y0) : Y0 + AMP * ev.reduce((y, v) => y + shapeY(v.s, u - v.x), 0));
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
      if (v.up) inkDot(x, v.x, Y0 - 220 * 0.98 * AMP, 6, k * dimK * 0.9);
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
    T(x, "↑ " + tr("ch06.checkin") + (footA > 0.02 ? " *" : ""), API.x + API.w + 18, API.y + 40, { size: 36, w: 700, alpha: a, maxW: 1880 - API.x - API.w - 18 });
    T(x, tr("ch06.checkinSub"), API.x + API.w + 18, API.y + 80, { size: 28, sub: true, alpha: a, maxW: 1880 - API.x - API.w - 18 });
    // 右对齐、左端留在 n1 旁白垫底（最宽 1040 加羽化）的右边：英文旁白和脚注都长，左对齐会叠。
    if (footA > 0) T(x, "* " + tr("ch06.foot"), 1880, 880, { size: 36, color: verm(0.95), align: "right", alpha: footA, maxW: 620 });
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
    // 两处空取数让 TOKENS、LISTEN、STEPS 的示意数据和种子保持原样。
    if (!zero) R();
    // band 的值照 codingBand：0 没有，1 只有前台编码应用，2 只有 agent，3 两者同时。
    const band = [];
    if (!zero) for (let m = 0; m < 15;) { const len = 2 + Math.floor(R() * 5), v = R() < 0.25 ? 0 : 1 + Math.floor(R() * 3); band.push([from + m, from + Math.min(15, m + len), v]); m += len; }
    R();
    CODING.push({ from, band, zero });
  }
  const TOKENS = [];
  for (const w of CODING) for (let j = 0; j < 3; j++) TOKENS.push([w.from + j * 5, w.zero ? [0, 0, 0] : [R() * 0.6, R() * 0.35, R() * 0.25]]);
  const LISTEN = [];
  for (let t = -240; t < -130;) { const len = 3 + R() * 1.5; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  for (let t = -6; t < 22;) { const len = 3 + R() * 1.4; LISTEN.push([t, t + len, false]); t += len + 0.3; }
  LISTEN.push([22, 72, true]);
  const WATCH = [[-128, -84]];
  const GAME = [[-78, -40, 1], [-40, -32, 0.5]];
  const WORKOUT = [-62, -44];
  const STEPS = [];
  for (let t = -300; t < 70; t += 5) STEPS.push([t, t >= WORKOUT[0] && t < WORKOUT[1] ? 0.7 + 0.3 * R() : R() < 0.55 ? R() * 0.35 : 0]);
  const tx = (phi, t) => NOW_X - (phi - t) * SC;
  const BAND_RGB = [null, INK, VERM, MIX], BAND_A = [0, 0.42, 0.75, 0.9], BAND_KEYS = [null, "ch06.bandHuman", "ch06.bandAgent", "ch06.bandBoth"];
  const minutes = (phi, test) => CODING.reduce((n, w) => n + w.band.reduce((m, [t0, t1, v]) => m + (test(v) ? clamp(Math.min(t1, phi) - t0, 0, t1 - t0) : 0), 0), 0);
  const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  // driver 与 agent 按 shared/pulse-types.ts 的 codingDriverSeconds、codingAgentSeconds 的口径，从画上的示意数据数出来。
  const DRIVER = minutes(AT.sum * 4, (v) => v === 1 || v === 3), AGENT = minutes(AT.sum * 4, (v) => v === 2 || v === 3);

  // 墨分五色：七条道按焦、浓、重、淡、清轮着铺，每层上沿是一道湿边。
  const LANE_TONE = [0.17, 0.08, 0.13, 0.05, 0.11, 0.06, 0.09];
  const LANE_PATHS = LANES.map((_, i) => {
    const y = laneY(i), p = new Path2D();
    p.moveTo(ST_X0, y + LANE_H);
    for (let u = ST_X0; u <= NOW_X; u += 30) p.lineTo(u, y + 3 * Math.sin(u * 0.011 + i * 1.7) + 2 * Math.sin(u * 0.043 + i));
    p.lineTo(NOW_X, y + LANE_H); p.closePath();
    return p;
  });
  function strata(x, b, a, focus, seamA) {
    if (a <= 0) return;
    const phi = b * 4;
    LANES.forEach((_, i) => wash(x, LANE_PATHS[i], a, { fill: LANE_TONE[i], edge: 0.22, lw: 2 }));
    const clipL = ST_X0, clipR = NOW_X;
    for (let n = Math.floor(phi / 5); seamA > 0; n--) {
      const u = tx(phi, n * 5), al = seamA * a * (1 - (phi - n * 5) / 90);
      if (u < clipL || al <= 0) break;
      brush(x, seg2(u, ST_TOP + 4, u + 1, ST_BOT - 4, 6), 2.2, { alpha: al * 0.45, even: true, dry: false, seed: n, tin: 0.1, tout: 0.1 });
    }
    const dab = (i, t0, t1, h, alpha, rgb = INK) => {
      const x0 = Math.max(clipL, tx(phi, t0)), x1 = Math.min(clipR, tx(phi, t1));
      if (x1 <= x0 || alpha <= 0) return;
      const y = laneY(i) + LANE_H - 12 - h;
      x.save(); x.globalAlpha = alpha; x.fillStyle = rgba(rgb, 0.85); x.beginPath(); x.roundRect(x0, y, x1 - x0, h, Math.min(4, h / 2)); x.fill();
      x.fillStyle = rgba(rgb, 1); x.fillRect(x0, y, x1 - x0, Math.min(3, h)); x.restore();
    };
    const dimOf = (i) => a * (i <= 1 ? 1 : 1 - focus);
    x.save(); x.globalAlpha = dimOf(0);
    for (const w of CODING) for (const [t0, t1, v] of w.band) if (v) for (let m = t0; m < t1 && m + 1 <= phi; m++) {
      const u = tx(phi, m);
      if (u < clipL || u + SC > clipR) continue;
      if (v & 1) { x.fillStyle = rgba(INK, 0.5); x.fillRect(u + 2, laneY(0) + 14, SC - 4, 10); }
      if (v & 2) { x.fillStyle = rgba(VERM, 0.6); x.fillRect(u + 2, laneY(0) + 30, SC - 4, 10); }
    }
    x.restore();
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
  function strataNotes(x, b, a, cam) {
    if (a <= 0) return;
    glyph(x, "d1", NOW_X + 170, 1060, ink(0.85), 1, a);
    T(x, "D1", NOW_X + 90, 1150, { mono: true, size: 38, w: 600, alpha: a });
    T(x, "lyjwpage-history", NOW_X + 90, 1196, { mono: true, size: 34, sub: true, alpha: a });
    T(x, tr("ch06.keep"), NOW_X + 90, 1252, { size: 40, w: 700, color: verm(0.95), alpha: a });
    T(x, tr("ch06.archive"), NOW_X - 50, ST_TOP - 32, { size: 34, align: "right", alpha: a, maxW: 640 });
    // 推近右沿（C2）时这行会出左缘：钉在屏幕左边 40 px 以内、道底下。
    const z = cam.zoom, ox = Math.max(20, cam.x + (40 - 960) / z), oy = Math.min(ST_BOT + 66, cam.y + (800 - 540) / z);
    T(x, "← " + tr("ch06.older"), ox, oy, { size: 36, sub: true, alpha: a, maxW: 1000 });
  }

  function coding(x, b, a, cam) {
    if (a <= 0) return;
    const phi = b * 4, y0 = laneY(0);
    // 图例和时长与 lyjw.me、core 方框在世界坐标里叠在一起，方框淡回来之前就得收掉。
    const sa = a * (1 - prog(b, 12.75, 12.9));
    const left = cam.x + (290 - 960) / cam.zoom, now = Math.floor(phi);
    const front = lerp(left, NOW_X, prog(b, AT.band, AT.band + 0.4, E.io));
    x.save(); x.globalAlpha = a;
    for (const w of CODING) for (const [t0, t1, v] of w.band) {
      const x0 = Math.max(left, tx(phi, t0)), x1 = Math.min(front, tx(phi, Math.min(t1, now)));
      if (!v || x1 <= x0) continue;
      x.fillStyle = rgba(BAND_RGB[v], BAND_A[v]); x.fillRect(x0, y0 + BAND_Y, x1 - x0, BAND_H);
    }
    x.restore();
    inkDot(x, front, y0 + BAND_Y + BAND_H / 2, 6, a * win(b, AT.band, AT.band + 0.03, AT.band + 0.4, AT.band + 0.45));
    const lx = cam.x + (310 - 960) / cam.zoom, rl = tr("ch06.raw"), rf = SERIF(21, 600), rw = LEG_X - 24 - lx;
    const ra = sa * prog(b, AT.raw, AT.raw + 0.15);
    x.save(); x.globalAlpha = ra; x.fillStyle = rgba(PAPER); x.fillRect(lx - 8, ST_TOP - 42, Math.min(K.measure(x, rl, rf), rw) + 16, 34); x.restore();
    T(x, rl, lx, ST_TOP - 16, { font: rf, sub: true, alpha: ra, maxW: rw });
    [1, 2, 3].forEach((v, i) => {
      const t = AT.legend + i * 0.0625, la = sa * prog(b, t, t + 0.12), y = ST_TOP - 80 + i * 26;
      x.save(); x.globalAlpha = la; x.fillStyle = rgba(BAND_RGB[v], BAND_A[v]); x.fillRect(LEG_X, y - 15, 28, 14); x.restore();
      T(x, tr(BAND_KEYS[v]), LEG_X + 38, y, { size: 21, alpha: la, maxW: 1160 - LEG_X - 38 });
    });
    T(x, `driver ${hm(DRIVER)}`, NOW_X - 12, ST_TOP - 62, { mono: true, size: 22, w: 600, align: "right", alpha: sa * prog(b, AT.sum, AT.sum + 0.12) });
    T(x, `agent ${hm(AGENT)}`, NOW_X - 12, ST_TOP - 36, { mono: true, size: 22, w: 600, align: "right", alpha: sa * prog(b, AT.sum + 0.125, AT.sum + 0.245) });
    T(x, tr("ch06.illus"), NOW_X - 12, ST_TOP - 12, { size: 21, sub: true, align: "right", alpha: sa * prog(b, AT.sum + 0.125, AT.sum + 0.245) });
    T(x, tr("ch06.sources"), lx, laneY(2) + 30, { size: 21, w: 700, alpha: a });
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

  // 收尾接第 07 章首帧（ch07.js 的 sTitle 在 AT.crt 之前那一帧）：墨从四边往笔尖晕进来，把宣纸吞成纯黑；
  // 黑里那段心电图是白的，笔尖外那段也在黑里长出来，到 15.95 只剩屏幕 y 535–545 一道整宽白线和 (1340–1360, 530–550) 的橙色方点。
  // 白线、方点的位置、粗细和颜色（C_W、C_O 即 ch07.js 的 C.w、C.o）须与 ch07.js 的 sTitle 首帧同步。
  const NIGHT = [15.45, 15.95], C_W = "#fcfcfc", C_O = [215, 119, 87];
  // 墨晕：十几层淡墨一层比一层往里收、各自的边抖得不一样，最外一圈是纯黑。
  const NIGHT_LAYERS = [...Array.from({ length: 14 }, (_, i) => { const t = i / 13; return [lerp(0.6, 0.985, t), ink(0.03 + 0.14 * t * t), i + 1]; }), [1, "#000", 0]];
  function nightEdge(th, b, j) {
    const u = ((th / TAU) * 24 + 24) % 24, i = Math.floor(u), fr = u - i, sm = fr * fr * (3 - 2 * fr);
    const n = lerp(hash(i * 3.1 + 61 + j * 17), hash(((i + 1) % 24) * 3.1 + 61 + j * 17), sm);
    return 1 + 0.06 * Math.sin(3 * th + 1.3 + b * 1.5) + 0.045 * Math.sin(5 * th + 0.4 - b * 2.3 + j * 0.9) + 0.03 * Math.sin(9 * th + 2.1 + j * 1.7) + 0.08 * (n - 0.5);
  }
  function inkNight(x, b, cam) {
    const k = prog(b, NIGHT[0], NIGHT[1]);
    if (k <= 0) return;
    const z = cam.zoom, L = cam.x - 960 / z - 80, R = cam.x + 960 / z + 80, Tp = cam.y - 540 / z - 80, Bt = cam.y + 540 / z + 80;
    const r = 1600 * Math.pow(1 - k, 1.4);
    const night = (s, j = 0) => {
      const p = new Path2D();
      p.rect(L, Tp, R - L, Bt - Tp);
      if (r * s < 2) return p;
      for (let i = 0; i < 120; i++) {
        const th = (i / 120) * TAU, rr = r * s * nightEdge(th, b, j), px = NOW_X + Math.cos(th) * rr * 1.3, py = Y0 + Math.sin(th) * rr * 0.8;
        if (i) p.lineTo(px, py); else p.moveTo(px, py);
      }
      p.closePath();
      return p;
    };
    x.save();
    for (const [s, col, j] of NIGHT_LAYERS) { x.fillStyle = col; x.fill(night(s, j), "evenodd"); }
    x.clip(night(1), "evenodd");
    const { pts } = tracePts(b * 4, Math.min(NOW_X - 40, L));
    x.globalAlpha = prog(b, NIGHT[0] + 0.05, NIGHT[0] + 0.25);
    x.strokeStyle = C_W; x.lineWidth = 10 / z; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.lineTo(R, Y0); x.stroke();
    x.restore();
    const q = prog(b, 15.78, 15.94, E.io);
    if (q > 0) {
      const h = lerp(7, 10, q) / z, py = traceY(events(b * 4), NOW_X), col = VERM.map((v, i) => Math.round(lerp(v, C_O[i], q)));
      x.save(); x.fillStyle = rgba(col); x.beginPath(); x.roundRect(NOW_X - h, py - h, 2 * h, 2 * h, h * (1 - q)); x.fill(); x.restore();
    }
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, phi = b * 4;
    AMP = 1 - prog(b, 15.1, 15.5, E.io);
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.lit, 0.12), impact(b, 0, 0.1) * 0.6);
    cam.zoom *= 1 + 0.012 * hitS;
    G.setCam(cam);
    G.clear([0.85, 0.79, 0.65]);

    const x = page.begin(); page.cam(cam);
    const tp = top.begin(); top.cam(cam);
    x.save(); x.fillStyle = rgba(PAPER); x.fillRect(-3200, -1200, 7200, 4200); x.fillStyle = paperTile(); x.fillRect(-3200, -1200, 7200, 4200); x.restore();

    const outA = 1 - prog(b, 15.35, 15.85);
    // 推近右沿（C2）时这几个方框只剩下半截露在画顶，跟着 C2 一起收掉，一直收到 Coding 那一幕结束。
    const labA = prog(b, 0.55, 0.95) * outA * (1 - win(b, 8.76, 8.95, 12.9, 13.1));
    hills(x, prog(b, 0.4, 1.2) * (1 - prog(b, 3.7, 4.0)));
    title(x, b);
    ecg(x, b, cam, labA * (1 - prog(b, 3.9, 4.0)), 1 - 0.65 * win(b, 6.0, 6.4, 14.6, 15.3));
    ledgerBox(x, phi, labA);
    siteBoxes(x, phi, labA);
    signalPaths(x, phi, labA);
    // 上一幕的标签淡完，KV LAG 这一幕才进：「只说明 site Worker 还在出页面」那行（英文更长）伸到了 KV LAG 图标底下。
    signalLabels(x, win(b, 0.6, 0.95, 3.76, 3.88), win(b, 2.5, 2.7, 3.76, 3.88));
    const bA = win(b, 3.88, 4.1, 5.95, 6.2);
    collector(x, b, bA);
    card(x, b, bA);
    const sA = prog(b, 5.9, 6.2) * (1 - prog(b, 15.2, 15.7));
    const focus = win(b, 10.9, 11.1, 12.9, 13.1);
    strata(x, b, sA, focus, win(b, 6.2, 6.6, 10.75, 10.95));
    strataNotes(x, b, win(b, 6.1, 6.4, 10.85, 11.0), cam);
    // 等上一幕的 lyjw.me、core 方框淡完再进：图例和时长与它们在世界坐标里叠在一起。
    coding(x, b, win(b, 11.05, 11.2, 12.9, 13.05), cam);
    // 字要先于垫底淡出：垫底一变透明，下面的条就露出来，字还在就压在条上。
    laneLabels(x, cam, sA * (1 - prog(b, 12.95, 13.15)), sA * (1 - prog(b, 12.82, 12.94)), focus);
    nar(x, "ch06.n1a", 110, 944, prog(b, 1.0, 1.6), win(b, 1.0, 1.1, 3.8, 3.95));
    nar(x, "ch06.n1b", 110, 1024, prog(b, 1.6, 2.4), win(b, 1.0, 1.1, 3.8, 3.95));
    const at = (sx, sy, c) => [c[0] + (sx - 960) / c[2], c[1] + (sy - 540) / c[2]];
    { const [nx, ny] = at(110, 944, B), [, ny2] = at(110, 1024, B);
      nar(x, "ch06.n2a", nx, ny, prog(b, 4.1, 4.6), win(b, 4.05, 4.15, 5.85, 5.98));
      nar(x, "ch06.n2b", nx, ny2, prog(b, 4.6, 5.3), win(b, 4.05, 4.15, 5.85, 5.98)); }
    // n3 跨两个机位（全景 C、推近右沿 C2），钉在屏幕上，镜头推近时不跟着放大。
    { const cs = [cam.x, cam.y, cam.zoom], s = 1 / cs[2], [nx, ny] = at(110, 944, cs), [, ny2] = at(110, 1024, cs);
      nar(x, "ch06.n3a", nx, ny, prog(b, 6.4, 7.1), win(b, 6.3, 6.4, 10.65, 10.8), 60 * s, 1040 * s);
      nar(x, "ch06.n3b", nx, ny2, prog(b, 7.1, 7.9), win(b, 6.3, 6.4, 10.65, 10.8), 60 * s, 1040 * s); }
    { const s = 1 / D[2], [nx, ny] = at(110, 944, D), [, ny2] = at(110, 1024, D);
      nar(x, "ch06.n4a", nx, ny, prog(b, 11.1, 11.6), win(b, 11.05, 11.15, 12.85, 12.98), 60 * s, 1040 * s);
      nar(x, "ch06.n4b", nx, ny2, prog(b, 11.6, 12.2), win(b, 11.05, 11.15, 12.85, 12.98), 60 * s, 1040 * s); }
    const cIn = prog(b, AT.clawd - 0.2, AT.clawd), cOut = prog(b, 15.45, 15.7);
    if (cIn > 0 && cOut < 1) {
      const rise = E.outBack(cIn) * (1 - E.in(cOut));
      const cx = 760, base = ST_TOP + 4;
      tp.save(); tp.beginPath(); tp.rect(cx - 200, base - 260, 400, 260); tp.clip();
      clawdInk(tp, cx, base + (1 - rise) * 90, 6, cIn < 1 ? "arms-up" : "default");
      tp.restore();
      const sk = prog(b, AT.clawd + 0.1, AT.clawd + 0.25) * (1 - prog(b, 15.35, 15.45));
      slip(tp, tr("ch06.clawd"), cx - 70, base - 110, sk, prog(b, AT.clawd + 0.15, 14.1), cx - 30, base - 60);
    }

    inkNight(tp, b, cam);

    G.composite(page.upload(), { mode: G.MODE.normal });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 5, endK = prog(b, 15.5, 16);
    // 暗角、颗粒在收尾这半小节里收到第 07 章首帧的值（ch07.js render 里 endK 为 0 时的 vignette、grain）。
    f.post = {
      bloom: 0, threshold: 1.2, halation: 0, grain: lerp(0.035, 0, endK), vignette: lerp(0.24, 0.12, endK), ca: 0,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch06", title: "ch.06", bars: 16,
    async init() {
      page = G.layer("bg"); top = G.layer("top");
      await Promise.all([document.fonts.load(BRUSH(60), "心电图"), document.fonts.load(SERIF(30, 600), "报到"), document.fonts.load(SERIF(30, 900), "墨")]);
    },
    render,
  });
})();
