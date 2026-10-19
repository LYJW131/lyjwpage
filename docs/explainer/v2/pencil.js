// 彩铅画法，照 anidoodle 的 colouredPencil（docs/references.md「讲解动画」）：底色上一个主斜向的短排线，
// 浅深两色叠层、形体边缘颜色加厚、暗部换方向交叉排线、最后描一圈断续的深色轮廓。
// 排线做成按种子生成的图块（CanvasPattern），每帧只是用它填形状：同一形状每帧笔触不变，不会抖。
(() => {
  const { E, clamp, lerp, mulberry32 } = K;
  const TILE = 384, ANG = -0.52, X2 = 0.62, TAU = Math.PI * 2;

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const toLin = (c) => c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });

  // 取色自 Alex 片子里的关键帧：屋里的淡紫墙、木地板、Clawd、夜空、奶油色卡片。
  const PAL = {
    paper: "#f7f0df", wall: "#b2a1d8", wallD: "#9b88c2", floor: "#d9ab7a", wood: "#b9805a", woodD: "#8a5a3e",
    clawd: "#d48165", eye: "#3a2620", night: "#2f2c62", moon: "#f2dc8e", gold: "#e8b84a", teal: "#6ca59d",
    red: "#d7574a", sticky: "#f0d56c", sky: "#9fc3dc", line: "#3e2a2c", ink: "#3b2f4a", soft: "#6e5f80", cream: "#fbf5e6",
  };
  const DARK = hex("#2a2040"), WHITE = hex("#ffffff");

  const tiles = new Map();
  const scratch = document.createElement("canvas").getContext("2d");
  function seedOf(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

  // 一笔：起笔快压下去，收笔拖一段长尖（anidoodle colouredPencilKit 的 profile）。
  function strokeShape(c, x0, y0, len, w, ang, bow) {
    const n = 7, ca = Math.cos(ang), sa = Math.sin(ang), L = [], R = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = (t - 0.5) * len, v = bow * 4 * t * (1 - t);
      const h = (w / 2) * Math.max(0.22, Math.pow(clamp(t / 0.16), 0.6) * Math.pow(clamp((1 - t) / 0.42), 0.75));
      const px = x0 + u * ca - v * sa, py = y0 + u * sa + v * ca;
      L.push([px - sa * h, py + ca * h]); R.push([px + sa * h, py - ca * h]);
    }
    c.beginPath(); c.moveTo(L[0][0], L[0][1]);
    for (const p of L) c.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
    c.closePath(); c.fill();
  }

  // 排线图块：在底色之上用浅深两色铺斜线，四边回绕，铺满后是无缝的一张纸面。
  function hatchTile(color, o = {}) {
    const { ang = ANG, dens = 1, w = 5.5, len = 46, lite = 0.3, dark = 0.26, a0 = 0.3, a1 = 0.62, seed = 1, darkShare = 0.5, jit = 0.1 } = o;
    const key = `h|${color}|${ang}|${dens}|${w}|${len}|${lite}|${dark}|${a0}|${a1}|${seed}|${darkShare}`;
    if (tiles.has(key)) return tiles.get(key);
    const cv = document.createElement("canvas");
    cv.width = cv.height = TILE;
    const c = cv.getContext("2d"), r = mulberry32(seedOf(key)), base = hex(color);
    const L = mix(base, WHITE, lite), D = mix(base, DARK, dark);
    const n = Math.round(380 * dens * (60 / len) * (5 / w) * 0.55 * (TILE / 256) ** 2);
    for (let i = 0; i < n; i++) {
      const x = r() * TILE, y = r() * TILE, l = len * (0.55 + r() * 0.9), sw = w * (0.7 + r() * 0.55), an = ang + (r() - 0.5) * 2 * jit, bow = (r() - 0.5) * 2.2;
      const col = r() < darkShare ? mix(D, base, r() * 0.35) : mix(L, base, r() * 0.35);
      c.fillStyle = rgba(col, a0 + r() * (a1 - a0));
      const ext = l / 2 + sw;
      for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) {
        const px = x + ox, py = y + oy;
        if (px < -ext || px > TILE + ext || py < -ext || py > TILE + ext) continue;
        strokeShape(c, px, py, l, sw, an, bow);
      }
    }
    const pat = scratch.createPattern(cv, "repeat");
    tiles.set(key, pat);
    return pat;
  }
  // 写字用的铅：实色上打出纸的齿孔，字边带一点颗粒。
  function leadTile(color) {
    const key = `l|${color}`;
    if (tiles.has(key)) return tiles.get(key);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const c = cv.getContext("2d"), r = mulberry32(seedOf(key)), base = hex(color);
    c.fillStyle = rgba(base); c.fillRect(0, 0, 128, 128);
    c.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(0,0,0,${0.18 + r() * 0.4})`; c.beginPath(); c.arc(r() * 128, r() * 128, 0.5 + r() * 0.9, 0, TAU); c.fill(); }
    c.globalCompositeOperation = "source-over";
    for (let i = 0; i < 40; i++) { c.fillStyle = rgba(mix(base, WHITE, 0.25), 0.25); strokeShape(c, r() * 128, r() * 128, 20 + r() * 20, 1.4, ANG, 0); }
    const pat = scratch.createPattern(cv, "repeat");
    tiles.set(key, pat);
    return pat;
  }
  const lead = (name) => leadTile(PAL[name] || name);

  // 形状：路径加上多边形顶点（轮廓按顶点描）。
  function polyShape(pts) {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return { path: p, pts, corners: pts.length <= 8 };
  }
  const rect = (x, y, w, h) => polyShape([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  function rrect(x, y, w, h, r) {
    const pts = [], q = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    for (const [cx, cy, a0] of q) for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return { ...polyShape(pts), corners: false };
  }
  function ellipse(cx, cy, rx, ry = rx, n = 28) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return { ...polyShape(pts), corners: false };
  }

  // 断续的轮廓：一串互相搭接的短笔，每笔偏一点；方角处出头，像先画的构造线。
  function contour(x, pts, o = {}) {
    const { color = PAL.line, w = 4, alpha = 0.9, seed = 7, closed = true, seg = 90, over = 5, corners = closed && pts.length <= 8 } = o;
    if (alpha <= 0 || pts.length < 2) return;
    const r = mulberry32(seed >>> 0), ring = closed ? [...pts, pts[0]] : pts;
    x.save(); x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = color;
    if (corners) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const e0 = over * (0.4 + r()), e1 = over * (0.4 + r()), off = (r() - 0.5) * 1.6, bow = (r() - 0.5) * Math.min(5, l * 0.02);
        const nx = -uy, ny = ux;
        x.globalAlpha = alpha * (0.8 + r() * 0.2); x.lineWidth = w * (0.85 + r() * 0.3);
        x.beginPath(); x.moveTo(ax - ux * e0 + nx * off, ay - uy * e0 + ny * off);
        x.quadraticCurveTo((ax + bx) / 2 + nx * (off + bow), (ay + by) / 2 + ny * (off + bow), bx + ux * e1 + nx * off, by + uy * e1 + ny * off); x.stroke();
      }
    } else {
      const dense = [];
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      }
      let i = 0;
      while (i < dense.length - 1) {
        let j = i, acc = 0, want = seg * (0.6 + r() * 0.8);
        while (j < dense.length - 1 && acc < want) { acc += Math.hypot(dense[j + 1][0] - dense[j][0], dense[j + 1][1] - dense[j][1]); j++; }
        const off = (r() - 0.5) * 1.6;
        x.globalAlpha = alpha * (0.78 + r() * 0.22); x.lineWidth = w * (0.85 + r() * 0.3);
        x.beginPath();
        for (let k = Math.max(0, i - 1); k <= j; k++) { const [px, py] = dense[k]; k === Math.max(0, i - 1) ? x.moveTo(px + off, py + off) : x.lineTo(px + off, py + off); }
        x.stroke();
        i = j;
      }
    }
    x.restore();
  }

  // 填一个形状：投影 → 底色 → 排线 → 边缘加厚 → 暗部交叉排线 → 轮廓。
  function fill(x, shp, color, o = {}) {
    const { alpha = 1, edge = 9, shade = null, shadow = null, line = PAL.line, lw = 4, seed = 3, tile = {}, hatch = 1, flat = false } = o;
    if (alpha <= 0) return;
    const base = hex(color);
    x.save();
    x.globalAlpha = alpha;
    if (shadow) {
      x.save(); x.translate(shadow[0], shadow[1]); x.globalAlpha = alpha * (shadow[2] ?? 0.32);
      x.fillStyle = hatchTile(PAL.wallD, { dark: 0.45, lite: 0, darkShare: 1, a0: 0.5, a1: 0.9, dens: 1.2 }); x.fill(shp.path); x.restore();
    }
    x.fillStyle = rgba(mix(base, WHITE, 0.08)); x.fill(shp.path);
    if (!flat && hatch > 0) {
      x.globalAlpha = alpha * hatch;
      x.fillStyle = hatchTile(color, tile); x.fill(shp.path);
      x.globalAlpha = alpha;
    }
    if (edge > 0) {
      x.save(); x.clip(shp.path); x.globalAlpha = alpha * 0.6; x.lineWidth = edge * 2; x.lineJoin = "round";
      x.strokeStyle = hatchTile(color, { ...tile, dark: 0.34, darkShare: 0.9, a0: 0.45, a1: 0.85, dens: 1.4, seed: 9 }); x.stroke(shp.path); x.restore();
    }
    if (shade) {
      x.save(); x.clip(shp.path);
      const lit = new Path2D(); lit.rect(-1e5, -1e5, 2e5, 2e5);
      lit.addPath(shp.path, new DOMMatrix().translate(shade[0], shade[1]));
      x.clip(lit, "evenodd");
      x.globalAlpha = alpha * (shade[2] ?? 0.75);
      x.fillStyle = hatchTile(color, { ang: X2, dark: 0.42, darkShare: 1, a0: 0.4, a1: 0.8, dens: 1.1, seed: 5, w: 4.5 }); x.fill(shp.path); x.restore();
    }
    x.restore();
    if (line) contour(x, shp.pts, { color: line, w: lw, alpha: alpha * 0.92, seed, corners: shp.corners });
  }

  // 铅笔线：一道主笔加一道细的偏笔；k 是画出来的进度，返回笔尖。
  function pline(x, pts, k = 1, w = 4, color = PAL.line, alpha = 1, seed = 1) {
    if (k <= 0 || pts.length < 2 || alpha <= 0) return null;
    const head = K.polyline(x, pts, k, w, color, alpha * 0.9);
    const r = mulberry32(seed), off = [(r() - 0.5) * 2.4, 1 + r() * 1.2];
    K.polyline(x, pts.map(([a, b]) => [a + off[0], b + off[1]]), k, w * 0.45, color, alpha * 0.45);
    return head;
  }
  const seg = (x, x1, y1, x2, y2, w, color, alpha, seed) => pline(x, [[x1, y1], [x2, y2]], 1, w, color, alpha, seed);

  // 一圈暖黄的光晕：底下渐变、上面一层黄色排线，像灯旁故意留出来的亮纸。
  function halo(x, cx, cy, rad, a) {
    if (a <= 0.004) return;
    x.save();
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,236,170,${0.85 * a})`); g.addColorStop(0.45, `rgba(246,214,128,${0.45 * a})`); g.addColorStop(1, "rgba(246,214,128,0)");
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, TAU); x.fill();
    x.globalAlpha = 0.5 * a; x.fillStyle = hatchTile(PAL.moon, { lite: 0.35, dark: 0.08, a0: 0.25, a1: 0.5 });
    x.beginPath(); x.arc(cx, cy, rad * 0.7, 0, TAU); x.fill();
    x.restore();
  }

  const FONT = {
    hand: (px) => `${px}px "LXGW Marker Gothic", "PingFang SC", "Noto Sans SC", sans-serif`,
  };
  function text(x, str, px, py, o = {}) {
    const { size = 40, color = PAL.ink, mono = false, weight = 500 } = o;
    return K.text(x, str, px, py, { ...o, font: o.font || (mono ? K.FONT.mono(size, weight) : FONT.hand(size)), color: lead(color) });
  }

  // 纸片：投影、奶油色、两条胶带；sy 是弹出时的纵向缩放。
  function note(x, px, py, w, h, o = {}) {
    const { alpha = 1, sy = 1, color = PAL.paper, tape = true, rot = 0, seed = 11, pin = false } = o;
    if (alpha <= 0) return;
    x.save(); x.translate(px, py); if (rot) { x.translate(w / 2, h / 2); x.rotate(rot); x.translate(-w / 2, -h / 2); }
    x.scale(1, Math.max(0.001, sy));
    fill(x, rect(0, 0, w, h), color, { alpha, edge: 8, shadow: [10, 14, 0.4], seed, lw: 3.4, tile: { lite: 0.5, dark: 0.12, darkShare: 0.4, a0: 0.3, a1: 0.65, w: 3.4, len: 70, dens: 1.1 } });
    if (tape) for (const [tx, tr] of [[w * 0.12, -0.18], [w * 0.88, 0.16]]) {
      x.save(); x.translate(tx, 0); x.rotate(tr);
      x.globalAlpha = alpha * 0.55; x.fillStyle = "rgba(240,226,170,1)"; x.fillRect(-34, -13, 68, 26);
      x.globalAlpha = alpha * 0.35; x.fillStyle = hatchTile("#e9d8a0", { a0: 0.3, a1: 0.6 }); x.fillRect(-34, -13, 68, 26); x.restore();
    }
    if (pin) { fill(x, ellipse(w / 2, 14, 11), PAL.red, { alpha, edge: 3, lw: 2, seed: seed + 1, shadow: [4, 6, 0.4] }); }
    x.restore();
  }

  function checkbox(x, bx, by, on, o = {}) {
    const { size = 34, alpha = 1, color = PAL.red, seed = 21 } = o;
    contour(x, [[bx, by], [bx + size, by], [bx + size, by + size], [bx, by + size]], { w: 2.4, alpha: alpha * 0.85, seed });
    if (on > 0) pline(x, [[bx + size * 0.15, by + size * 0.5], [bx + size * 0.42, by + size * 0.82], [bx + size * 1.05, by - size * 0.12]], on, size * 0.16, color, alpha, seed + 3);
  }
  function tick(x, cx, cy, s, k, alpha = 1, color = PAL.red) {
    pline(x, [[cx - 0.5 * s, cy], [cx - 0.12 * s, cy + 0.38 * s], [cx + 0.6 * s, cy - 0.5 * s]], k, s * 0.17, color, alpha, 31);
  }
  function coin(x, cx, cy, r, color = PAL.gold, alpha = 1, seed = 41) {
    fill(x, ellipse(cx, cy, r), color, { alpha, edge: Math.max(2, r * 0.25), lw: Math.max(1.6, r * 0.18), seed, shade: [-r * 0.25, -r * 0.3, 0.6], tile: { w: Math.max(2, r * 0.3), len: r * 1.6 } });
    x.save(); x.globalAlpha = alpha * 0.8; x.fillStyle = "rgba(255,250,230,0.9)";
    x.beginPath(); x.ellipse(cx - r * 0.35, cy - r * 0.38, r * 0.18, r * 0.12, -0.6, 0, TAU); x.fill(); x.restore();
  }

  // Clawd 照 ../clawd.js 的格子画：形状一样，换成彩铅。一格宽 q、高 2q；轮廓只描身体和空格的交界。
  function clawd(x, fr, cx, bottom, q, o = {}) {
    const { alpha = 1, flip = false, color = PAL.clawd, shadow = true } = o;
    const f = fr || { pose: "default", offset: 0 };
    if (alpha <= 0) return cx;
    const px = cx + (f.x || 0) * 2 * q * (flip ? -1 : 1);
    const { body: B, eyes: EY } = window.Clawd.cells(f.pose, f.offset || 0);
    const W = 18 * q, H = 12 * q, on = new Set(B.map(([a, b]) => a + "," + b));
    x.save(); x.globalAlpha = alpha;
    if (shadow && !o.air) {
      x.save(); x.globalAlpha = alpha * 0.3; x.fillStyle = hatchTile(PAL.wallD, { dark: 0.5, lite: 0, darkShare: 1, a0: 0.5, a1: 0.9, w: Math.max(2, q * 0.7), len: q * 6 });
      x.beginPath(); x.ellipse(px, bottom + q * 0.4, W * 0.46, q * 1.1, 0, 0, TAU); x.fill(); x.restore();
    }
    x.translate(px - W / 2, bottom - H);
    if (flip) { x.translate(W, 0); x.scale(-1, 1); }
    const path = new Path2D();
    for (const [a, b] of B) path.rect(a * q - 0.3, b * 2 * q - 0.3, q + 0.6, 2 * q + 0.6);
    const s = q / 8;
    const sc = (pat) => { pat.setTransform(new DOMMatrix().scale(s, s)); return pat; };
    x.fillStyle = rgba(mix(hex(color), WHITE, 0.06)); x.fill(path);
    x.fillStyle = sc(hatchTile(color, { seed: 61 })); x.fill(path);
    x.save(); x.clip(path);
    x.globalAlpha = alpha * 0.7; x.fillStyle = sc(hatchTile(color, { ang: X2, dark: 0.42, darkShare: 1, a0: 0.4, a1: 0.8, dens: 1.1, seed: 5, w: 4.5 }));
    x.fillRect(0, H * 0.62, W, H);
    x.restore();
    const edges = [];
    for (const [a, b] of B) {
      if (!on.has(a + "," + (b - 1))) edges.push([a, b, a + 1, b]);
      if (!on.has(a + "," + (b + 1))) edges.push([a, b + 1, a + 1, b + 1]);
      if (!on.has(a - 1 + "," + b)) edges.push([a, b, a, b + 1]);
      if (!on.has(a + 1 + "," + b)) edges.push([a + 1, b, a + 1, b + 1]);
    }
    const merged = mergeEdges(edges);
    x.lineCap = "round";
    const lc = hex("#5a3428");
    for (const [a0, b0, a1, b1] of merged) {
      const r = mulberry32(seedOf(`${a0},${b0},${a1},${b1}`)), o1 = (r() - 0.5) * 0.12 * q;
      x.strokeStyle = rgba(lc, 0.9); x.lineWidth = Math.max(1.4, q * (0.5 + r() * 0.12));
      x.beginPath(); x.moveTo(a0 * q + o1, b0 * 2 * q + o1); x.lineTo(a1 * q - o1, b1 * 2 * q + o1); x.stroke();
    }
    if (EY.length) {
      const cols = [...new Set(EY.map(([a]) => a))].sort((m, n) => m - n), groups = [];
      for (const a of cols) { const g = groups[groups.length - 1]; if (g && a === g[g.length - 1] + 1) g.push(a); else groups.push([a]); }
      for (const g of groups) {
        const rows = EY.filter(([a]) => g.includes(a)).map(([, b]) => b);
        const ex = g[0] * q, ew = g.length * q, ey = Math.min(...rows) * 2 * q, eh = (Math.max(...rows) + 1 - Math.min(...rows)) * 2 * q;
        if (o.sleep) {
          x.strokeStyle = PAL.eye; x.lineWidth = Math.max(1.2, q * 0.45);
          x.beginPath(); x.moveTo(ex - 0.1 * q, ey + eh * 0.62); x.lineTo(ex + ew + 0.1 * q, ey + eh * 0.62); x.stroke();
          continue;
        }
        x.fillStyle = PAL.eye; K.roundRect(x, ex + 0.08 * q, ey + 0.1 * q, ew - 0.16 * q, eh - 0.2 * q, Math.min(ew, eh) * 0.3); x.fill();
        x.fillStyle = "rgba(255,248,236,0.9)"; x.beginPath(); x.arc(ex + ew * 0.32, ey + eh * 0.28, Math.max(0.6, q * 0.22), 0, TAU); x.fill();
      }
    }
    x.restore();
    return px;
  }
  function mergeEdges(edges) {
    const hz = new Map(), vt = new Map();
    for (const [a0, b0, a1, b1] of edges) {
      if (b0 === b1) { if (!hz.has(b0)) hz.set(b0, []); hz.get(b0).push(a0); }
      else { if (!vt.has(a0)) vt.set(a0, []); vt.get(a0).push(b0); }
    }
    const out = [];
    for (const [b, xs] of hz) { xs.sort((m, n) => m - n); let s = xs[0], p = xs[0]; for (let i = 1; i <= xs.length; i++) { if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; } out.push([s, b, p + 1, b]); s = p = xs[i]; } }
    for (const [a, ys] of vt) { ys.sort((m, n) => m - n); let s = ys[0], p = ys[0]; for (let i = 1; i <= ys.length; i++) { if (i < ys.length && ys[i] === p + 1) { p = ys[i]; continue; } out.push([a, s, a, p + 1]); s = p = ys[i]; } }
    return out;
  }

  // 道具：形状照 K.clawdProp 的格子坐标，换成彩铅色。
  function prop(x, kind, cx, bottom, q, o = {}) {
    const { alpha = 1, crouch = 0, flip = false } = o;
    if (alpha <= 0) return null;
    if (kind === "headset") return K.clawdProp(x, kind, cx, bottom, q, { alpha, crouch, flip, color: lead(PAL.ink) });
    if (kind === "magnifier") {
      const ox = cx - 9 * q, oy = bottom - 12 * q + crouch * 4 * q, X = (u) => (flip ? ox + (18 - u) * q : ox + u * q), Y = (v) => oy + v * q;
      const lx = X(19.6), ly = Y(2.2), r = 2.2 * q;
      seg(x, X(17.2), Y(5), X(18.4), Y(3.8), 0.9 * q, PAL.woodD, alpha, 3);
      fill(x, ellipse(lx, ly, r), PAL.sky, { alpha: alpha * 0.85, edge: q * 0.5, lw: Math.max(1.4, 0.45 * q), seed: 77, tile: { w: q * 0.5, len: q * 3 } });
      x.save(); x.globalAlpha = alpha * 0.9; x.strokeStyle = PAL.gold; x.lineWidth = 0.55 * q; x.beginPath(); x.arc(lx, ly, r, 0, TAU); x.stroke(); x.restore();
      return { x: lx, y: ly, r };
    }
    if (kind === "sign") {
      const ox = cx - 9 * q, oy = bottom - 12 * q + crouch * 4 * q, X = (u) => (flip ? ox + (18 - u) * q : ox + u * q), Y = (v) => oy + v * q;
      const w = (o.w ?? 16) * q, h = (o.h ?? 6) * q;
      seg(x, X(9), Y(0.5), X(9), Y(-2.5), 0.7 * q, PAL.woodD, alpha, 5);
      const bx = X(9) - w / 2, by = Y(-2.5) - h;
      fill(x, rect(bx, by, w, h), PAL.paper, { alpha, edge: q * 0.6, lw: Math.max(1.6, q * 0.32), seed: 91, shadow: [q * 0.8, q * 1.2, 0.35], tile: { lite: 0.25, dark: 0.08, a0: 0.18, a1: 0.42 } });
      return { x: bx, y: by, w, h };
    }
    return K.clawdProp(x, kind, cx, bottom, q, { alpha, crouch, flip, color: lead(PAL.ink) });
  }

  function bubble(x, str, bx, by, o = {}) {
    const { size = 36, k = 1, tail = "left", reveal = 1, alpha = 1 } = o;
    if (k <= 0) return;
    x.save();
    x.font = FONT.hand(size);
    const lines = str.split("\n"), tw = Math.max(...lines.map((l) => x.measureText(l).width));
    const pad = size * 0.6, lh = size * 1.3, bw = tw + pad * 2, bh = lh * lines.length + pad * 1.1;
    const s = lerp(0.6, 1, E.outBack(clamp(k * 1.6)));
    x.translate(bx, by); x.scale(s, s); if (tail === "right") x.translate(-bw, 0);
    const a = clamp(k * 4) * alpha;
    fill(x, polyShape(tail === "left" ? [[0, -bh], [bw, -bh], [bw, 0], [48, 0], [8, 28], [22, 0], [0, 0]] : [[0, -bh], [bw, -bh], [bw, 0], [bw - 22, 0], [bw - 8, 28], [bw - 48, 0], [0, 0]]), PAL.cream, { alpha: a, edge: 6, lw: 3, seed: 101, shadow: [8, 10, 0.3], tile: { lite: 0.25, dark: 0.06, a0: 0.15, a1: 0.35 } });
    const total = [...str.replace(/\n/g, "")].length;
    let shown = Math.floor(reveal * total + 1e-6);
    lines.forEach((l, i) => {
      const cs = [...l], part = cs.slice(0, Math.max(0, shown)).join("");
      shown -= cs.length;
      if (part) text(x, part, pad, -bh + pad * 0.55 + lh * (i + 0.8), { size, alpha: a, texture: true });
    });
    x.restore();
  }

  window.P = { PAL, hex, mix, rgba, toLin, hatchTile, lead, polyShape, rect, rrect, ellipse, contour, fill, line: pline, seg, halo, FONT, text, note, checkbox, tick, coin, clawd, prop, bubble, ANG, X2 };
})();
