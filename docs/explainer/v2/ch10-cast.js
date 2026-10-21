// 终章的「全部画风」：十种画风的 Clawd 和十种画风的字块（标题、谢幕都用），按第 00–09 章的调色与字体各画一份。
// 只放画法，不读时间；ch10.js 与 ch10-relay.js 经 window.FIN10 取用，所以这个文件在 index.html 里排在它们前面。
(() => {
  const { clamp, lerp, hash, FONT } = K;
  const TAU = Math.PI * 2;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (c, a = 1) => (typeof c === "string" ? (a >= 1 ? c : `rgba(${hex(c).join(",")},${a})`) : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  const EN = () => I18N.lang === "en";

  // 各章的底色与墨色，取值抄各章文件（ch00 BLUE/DEEP/WHITE、ch01 P、ch02 PAPER/INK/RED、ch03 C、ch05 GROUND/MUSTARD、ch06 PAPER/VERM、ch07 C、pencil.js PAL、ch09 C）。
  const PAL = {
    bpBlue: [26, 68, 116], bpDeep: [17, 51, 92], bpWhite: [236, 243, 250], bpPale: [168, 196, 228], bpDim: [112, 148, 194],
    miniSky0: "#C6CFF2", miniSky1: "#F0D3E3", miniSky2: "#FCE7D6", miniInk: "#44315A", miniInk2: "#7D6A92", miniPlate: "#FFF9F2", miniLilac: "#D6C6F2", miniShade: "#674C89", miniCoral: "#F3A595",
    cPaper: [236, 229, 214], cInk: [26, 24, 22], cRed: [202, 42, 34], cGray: [104, 99, 92],
    tFilm: [238, 232, 216], tLight: [207, 200, 185], tMid: [152, 145, 133], tDark: [90, 84, 76], tInk: [24, 21, 18], tCard: [12, 11, 10], tCream: [244, 238, 224],
    nPaper: [233, 227, 211], nInk: [30, 28, 26],
    sGround: [241, 236, 224], sInk: [24, 21, 18], sRed: [208, 66, 38], sMustard: [229, 168, 46], sShade: [70, 48, 24], sCard: [251, 248, 240],
    wPaper: [238, 230, 211], wInk: [30, 26, 22], wVerm: [184, 54, 38],
    pxBlack: "#000000", pxWhite: "#fcfcfc", pxNavy: "#000058", pxBlue: "#0058f8", pxSky: "#3cbcfc",
    pcWall: "#b2a1d8", pcSticky: "#f0d56c", pcLine: "#3e2a2c", pcCream: "#fbf5e6",
    mBg: "#F5F3EE", mInk: "#121212", mRed: "#EE352E", mOrange: "#FF6319", mYellow: "#FCCC0A", mBlue: "#0039A6", mGreen: "#00933C",
    clawd: [215, 119, 87],
  };

  // 十种字：中文、英文各一份。05 的 ZCOOL QingKe HuangYou、06 的马善政只管汉字，拉丁字母落到后面的字体。
  const FACE = [
    (px) => (EN() ? `500 ${px}px "Barlow Semi Condensed ch00", sans-serif` : `500 ${px}px "Noto Sans SC ch00", sans-serif`),
    (px) => (EN() ? `700 ${px}px "Fredoka ch01", sans-serif` : `${px}px "ZCOOL KuaiLe ch01", sans-serif`),
    (px) => (EN() ? `900 ${px}px "Big Shoulders ch02", sans-serif` : `900 ${px}px "Noto Sans SC ch02", sans-serif`),
    (px) => (EN() ? `${Math.round(px * 0.82)}px "Ch03 Marquee", serif` : `${px}px "ZCOOL XiaoWei", serif`),
    (px) => `900 ${px}px "Noto Serif SC", serif`,
    (px) => (EN() ? `800 ${px}px Jost, sans-serif` : `${px}px "ZCOOL QingKe HuangYou", sans-serif`),
    (px) => (EN() ? `900 ${px}px "Noto Serif SC", serif` : `${px}px "Ma Shan Zheng", "Noto Serif SC", serif`),
    (px) => FONT.cjk(px, 700),
    (px) => `${px}px "LXGW Marker Gothic", sans-serif`,
    (px) => (EN() ? `700 ${px}px "Inter ch09", sans-serif` : `700 ${px}px "Noto Sans SC ch09", sans-serif`),
  ];

  // ---------- Clawd 的格子 ----------
  const CELLS = new Map();
  function cellsOf(pose = "default", crouch = 0) {
    const k = pose + crouch;
    if (!CELLS.has(k)) {
      const { body, eyes } = window.Clawd.cells(pose, crouch);
      CELLS.set(k, { body, eyes, on: new Set(body.map(([u, v]) => u * 16 + v)) });
    }
    return CELLS.get(k);
  }
  function silhouette(cs, X0, Y0, q, grow = 0.4) {
    const p = new Path2D();
    for (const [u, v] of cs.body) p.rect(X0 + u * q - grow / 2, Y0 + v * 2 * q - grow / 2, q + grow, 2 * q + grow);
    return p;
  }
  function outline(x, cs, X0, Y0, q) {
    x.beginPath();
    for (const [u, v] of cs.body) {
      const L = X0 + u * q, T = Y0 + v * 2 * q, R = L + q, B = T + 2 * q;
      if (!cs.on.has(u * 16 + v - 1)) { x.moveTo(L, T); x.lineTo(R, T); }
      if (!cs.on.has(u * 16 + v + 1)) { x.moveTo(L, B); x.lineTo(R, B); }
      if (!cs.on.has((u - 1) * 16 + v)) { x.moveTo(L, T); x.lineTo(L, B); }
      if (!cs.on.has((u + 1) * 16 + v)) { x.moveTo(R, T); x.lineTo(R, B); }
    }
    x.stroke();
  }
  // 两只眼各是一组相邻的格子，返回包住每只眼的矩形。
  function eyeBoxes(cs, X0, Y0, q) {
    const cols = [...new Set(cs.eyes.map(([u]) => u))].sort((a, b) => a - b), groups = [];
    for (const u of cols) { const g = groups[groups.length - 1]; if (g && u === g[g.length - 1] + 1) g.push(u); else groups.push([u]); }
    return groups.map((g) => {
      const rows = cs.eyes.filter(([u]) => g.includes(u)).map(([, v]) => v);
      return { x: X0 + g[0] * q, y: Y0 + Math.min(...rows) * 2 * q, w: g.length * q, h: (Math.max(...rows) + 1 - Math.min(...rows)) * 2 * q };
    });
  }
  const fillEyes = (x, cs, X0, Y0, q, color) => { x.fillStyle = color; for (const [u, v] of cs.eyes) x.fillRect(X0 + u * q, Y0 + v * 2 * q, q + 0.3, 2 * q + 0.3); };

  // 每种画风一个画法：(x, cx, bottom, q, o) → 以脚底中点为锚，宽 18q、高 12q；o.pose、o.crouch、o.flip、o.alpha、o.seed、o.prop。
  function frameOf(x, cx, bottom, q, o, fn) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const cs = cellsOf(o.pose, o.crouch || 0);
    x.save(); x.globalAlpha *= a;
    x.translate(cx, bottom);
    if (o.rot) x.rotate(o.rot);
    if (o.sx || o.sy) x.scale(o.sx ?? 1, o.sy ?? 1);
    if (o.flip) x.scale(-1, 1);
    fn(cs, -9 * q, -12 * q);
    x.restore();
  }
  const CLAWD = [
    // 00 晒图零件：深蓝实心、45° 剖面线、白线框、眼睛留白（同 ch00.js#clawdPart）。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const p = silhouette(cs, X0, Y0, q, 0);
      x.fillStyle = rgba(PAL.bpDeep); x.fill(p);
      x.save(); x.clip(p); x.strokeStyle = rgba(PAL.bpPale); x.lineWidth = Math.max(1, 0.14 * q); x.beginPath();
      for (let s = -12 * q; s < 18 * q; s += 1.15 * q) { x.moveTo(X0 + s, Y0 + 12 * q); x.lineTo(X0 + s + 12 * q, Y0); }
      x.stroke(); x.restore();
      fillEyes(x, cs, X0, Y0, q, rgba(PAL.bpWhite));
      x.strokeStyle = rgba(PAL.bpWhite); x.lineWidth = Math.max(1.4, 0.24 * q); x.lineCap = "square"; outline(x, cs, X0, Y0, q);
    }),
    // 01 立体微缩：第 01 章的体素 Clawd（ch01-world.js#clawdPose）正对镜头、略往下看，露出正面和顶面，正面上亮下暗，脚下一团淡紫的软影。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      x.fillStyle = "rgba(103,76,137,0.22)"; x.beginPath(); x.ellipse(0.6 * q, 0.2 * q, 9.6 * q, 1.5 * q, 0, 0, TAU); x.fill();
      const t = 1.4 * q;
      x.fillStyle = "#F4AE92";
      for (const [u, v] of cs.body) if (!cs.on.has(u * 16 + v - 1)) x.fillRect(X0 + u * q - 0.3, Y0 + v * 2 * q - t, q + 0.6, t + 0.6);
      const g = x.createLinearGradient(0, Y0, 0, Y0 + 12 * q);
      g.addColorStop(0, "#E9805F"); g.addColorStop(1, "#C45B40");
      x.fillStyle = g; x.fill(silhouette(cs, X0, Y0, q, 0.5));
      x.strokeStyle = "rgba(110,44,30,0.16)"; x.lineWidth = Math.max(1, q * 0.1); x.beginPath();
      for (const [u, v] of cs.body) if (cs.on.has((u + 1) * 16 + v)) { x.moveTo(X0 + (u + 1) * q, Y0 + v * 2 * q); x.lineTo(X0 + (u + 1) * q, Y0 + (v + 1) * 2 * q); }
      x.stroke();
      fillEyes(x, cs, X0, Y0, q, "#1E1424");
    }),
    // 02 海报剪纸：橙纸压在错开的墨影上。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      x.fillStyle = rgba(PAL.cInk); x.fill(silhouette(cs, X0 + q * 0.55, Y0 + q * 0.55, q));
      x.fillStyle = rgba(PAL.clawd); x.fill(silhouette(cs, X0, Y0, q));
      fillEyes(x, cs, X0, Y0, q, rgba(PAL.cInk));
    }),
    // 03 橡皮管卡通：粗墨边、饼眼（黑眼珠切一角白）。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const p = silhouette(cs, X0, Y0, q);
      x.strokeStyle = rgba(PAL.tInk); x.lineWidth = q * 0.9; x.lineJoin = "round"; x.stroke(p);
      x.fillStyle = rgba(PAL.clawd); x.fill(p);
      x.fillStyle = "rgba(255,240,220,0.35)"; x.fillRect(X0 + 3 * q, Y0 + 0.4 * q, 6 * q, 0.8 * q);
      for (const e of eyeBoxes(cs, X0, Y0, q)) {
        const ex = e.x + e.w / 2, ey = e.y + e.h / 2, rx = e.w * 0.62, ry = e.h * 0.55;
        x.fillStyle = rgba(PAL.tInk); x.beginPath(); x.ellipse(ex, ey, rx, ry, 0, 0, TAU); x.fill();
        x.fillStyle = rgba(PAL.tCream); x.beginPath(); x.moveTo(ex + rx * 0.1, ey - ry * 0.15); x.arc(ex + rx * 0.1, ey - ry * 0.15, ry * 0.5, -1.9, -0.9); x.closePath(); x.fill();
      }
    }),
    // 04 网点套印：浅橙铺底，橙网点按明暗变大小，墨网点错开一点（套印不准）。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const p = silhouette(cs, X0, Y0, q), pitch = Math.max(2.5, q * 0.55);
      x.save(); x.clip(p);
      x.fillStyle = "rgba(215,119,87,0.32)"; x.fillRect(X0 - q, Y0 - q, 20 * q, 14 * q);
      for (let yy = Y0; yy < Y0 + 12 * q; yy += pitch) for (let xx = X0 + ((yy / pitch) % 2) * pitch * 0.5; xx < X0 + 18 * q; xx += pitch) {
        const k = 0.55 + 0.45 * ((yy - Y0) / (12 * q));
        x.fillStyle = "#D2694A"; x.beginPath(); x.arc(xx, yy, pitch * 0.46 * k, 0, TAU); x.fill();
      }
      x.restore();
      x.save(); x.translate(q * 0.18, q * 0.12); fillEyes(x, cs, X0, Y0, q, rgba(PAL.nInk, 0.92)); x.restore();
    }),
    // 05 剪纸片头：手剪的抖边、硬投影，戴耳机（报务员）。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      x.save(); x.translate(q * 0.45, q * 0.6); x.fillStyle = rgba(PAL.sShade, 0.32); x.fill(silhouette(cs, X0, Y0, q)); x.restore();
      x.fillStyle = rgba(PAL.clawd); x.fill(silhouette(cs, X0, Y0, q, 0.8));
      x.strokeStyle = rgba(PAL.sGround, 0.5); x.lineWidth = q * 0.12; x.setLineDash([q * 0.5, q * 0.7]); outline(x, cs, X0, Y0, q); x.setLineDash([]);
      fillEyes(x, cs, X0, Y0, q, rgba(PAL.sInk));
      if (o.prop !== false) K.clawdProp(x, "headset", 0, 0, q, { color: rgba(PAL.sInk), crouch: o.crouch || 0 });
    }),
    // 06 水墨没骨：橙色水晕开的软边，眼睛两点浓墨。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const p = silhouette(cs, X0, Y0, q, 0.6);
      x.save(); x.shadowColor = "rgba(215,119,87,0.75)"; x.shadowBlur = q * 1.4 * G.S;
      x.fillStyle = "rgba(220,128,92,0.55)"; x.fill(p); x.restore();
      x.fillStyle = "rgba(205,104,72,0.7)"; x.fill(p);
      x.save(); x.clip(p); const g = x.createLinearGradient(0, Y0, 0, Y0 + 12 * q); g.addColorStop(0, "rgba(255,226,200,0.25)"); g.addColorStop(1, "rgba(150,60,40,0.35)"); x.fillStyle = g; x.fillRect(X0, Y0, 18 * q, 12 * q); x.restore();
      for (const e of eyeBoxes(cs, X0, Y0, q)) { x.fillStyle = rgba(PAL.wInk, 0.92); x.beginPath(); x.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w * 0.55, e.h * 0.42, 0, 0, TAU); x.fill(); }
    }),
    // 07 红白机像素：一格拆成上下两个方像素，黑描边一像素，底下一排暗、顶上一排亮。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const P = (u, v, c) => { x.fillStyle = c; x.fillRect(X0 + u * q, Y0 + v * q, q + 0.3, q + 0.3); };
      const px = new Set();
      for (const [u, v] of cs.body) { px.add(u * 64 + 2 * v); px.add(u * 64 + 2 * v + 1); }
      const has = (u, w) => px.has(u * 64 + w);
      for (const k of px) { const u = Math.floor(k / 64), w = k % 64; for (const [du, dw] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has(u + du, w + dw)) P(u + du, w + dw, PAL.pxBlack); }
      for (const k of px) { const u = Math.floor(k / 64), w = k % 64; P(u, w, !has(u, w - 1) ? "#F8B090" : !has(u, w + 1) ? "#A84828" : "#D77757"); }
      for (const [u, v] of cs.eyes) { P(u, 2 * v, PAL.pxBlack); P(u, 2 * v + 1, PAL.pxBlack); }
    }),
    // 08 彩铅：直接用 pencil.js 的排线 Clawd。
    (x, cx, bottom, q, o = {}) => {
      const a = o.alpha ?? 1;
      if (a <= 0) return;
      x.save(); x.translate(cx, bottom); if (o.rot) x.rotate(o.rot); if (o.sx || o.sy) x.scale(o.sx ?? 1, o.sy ?? 1);
      window.P.clawd(x, { pose: o.pose || "default", offset: o.crouch || 0 }, 0, 0, q, { alpha: a * x.globalAlpha, flip: o.flip, shadow: false });
      x.restore();
    },
    // 09 地铁线路图：一枚圆形线路标，白色剪影压在圆里。
    (x, cx, bottom, q, o = {}) => frameOf(x, cx, bottom, q, o, (cs, X0, Y0) => {
      const R = 10.6 * q;
      x.fillStyle = "#D77757"; x.beginPath(); x.arc(0, -6 * q, R, 0, TAU); x.fill();
      x.strokeStyle = PAL.mInk; x.lineWidth = q * 0.5; x.stroke();
      x.save(); x.translate(0, -6 * q); x.scale(0.78, 0.78); x.translate(0, 6 * q);
      x.fillStyle = "#FFFFFF"; x.fill(silhouette(cs, X0, Y0, q));
      fillEyes(x, cs, X0, Y0, q, "#D77757");
      x.restore();
    }),
  ];

  // ---------- 字块 ----------
  // 07 的像素字：先在小画布上画，再按最近邻放大；只给大标题这种展示字用（字号 ≥ 100，放大后笔画仍清楚）。
  const pxCanvas = document.createElement("canvas"), pxCtx = pxCanvas.getContext("2d", { willReadFrequently: true });
  function pixelText(x, str, cx, cy, px, color) {
    const s = 7, f = FACE[7](Math.round(px / s));
    pxCtx.font = f;
    const w = Math.ceil(pxCtx.measureText(str).width) + 4, h = Math.ceil(px / s * 1.4) + 4;
    pxCanvas.width = w; pxCanvas.height = h;
    pxCtx.font = f; pxCtx.fillStyle = color; pxCtx.textBaseline = "middle"; pxCtx.textAlign = "center";
    pxCtx.fillText(str, w / 2, h / 2 + 1);
    const img = pxCtx.getImageData(0, 0, w, h), D = img.data;
    for (let i = 3; i < D.length; i += 4) D[i] = D[i] > 110 ? 255 : 0;
    pxCtx.putImageData(img, 0, 0);
    x.save(); x.imageSmoothingEnabled = false; x.drawImage(pxCanvas, cx - (w * s) / 2, cy - (h * s) / 2, w * s, h * s); x.restore();
    return w * s;
  }
  function jag(cx, cy, w, h, seed, j) {
    const p = new Path2D(), pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    let k = 0;
    pts.forEach(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % 4], n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 26));
      for (let m = 0; m < n; m++) {
        const t = m / n, px = cx + lerp(ax, bx, t) + (hash(seed * 3.1 + k) - 0.5) * 2 * j, py = cy + lerp(ay, by, t) + (hash(seed * 5.7 + k + 9) - 0.5) * 2 * j;
        k++ ? p.lineTo(px, py) : p.moveTo(px, py);
      }
    });
    p.closePath();
    return p;
  }
  // 一个字块：style 0–9 是第 00–09 章的画法；返回块宽，o.measure 为真时只量不画。
  function chip(x, style, str, cx, cy, px, o = {}) {
    const a = o.alpha ?? 1, f = FACE[style](px);
    const tw = style === 7 ? K.measure(x, str, FACE[7](px)) : K.measure(x, str, f);
    const padX = px * (style === 9 ? 0.32 : 0.26), w = Math.max(tw + padX * 2, px * 1.12), h = px * 1.28;
    if (o.measure || a <= 0) return w;
    const T = (col, extra = {}) => K.text(x, str, cx, cy + px * 0.36, { font: f, color: col, align: "center", alpha: a, ...extra });
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.rotate(o.rot || 0); x.scale(o.s ?? 1, o.s ?? 1); x.translate(-cx, -cy);
    const L = cx - w / 2, Tp = cy - h / 2;
    if (style === 0) {
      x.fillStyle = rgba(PAL.bpBlue); x.fillRect(L, Tp, w, h);
      x.strokeStyle = rgba(PAL.bpWhite); x.lineWidth = 3; x.strokeRect(L, Tp, w, h);
      x.strokeStyle = rgba(PAL.bpDim); x.lineWidth = 1.4; x.strokeRect(L + 8, Tp + 8, w - 16, h - 16);
      T(rgba(PAL.bpWhite));
    } else if (style === 1) {
      x.fillStyle = rgba(PAL.miniShade, 0.2); K.roundRect(x, L + px * 0.05, Tp + px * 0.2, w, h, px * 0.22); x.fill();
      x.fillStyle = PAL.miniLilac; K.roundRect(x, L, Tp + px * 0.09, w, h, px * 0.22); x.fill();
      x.fillStyle = PAL.miniPlate; K.roundRect(x, L, Tp, w, h, px * 0.22); x.fill();
      T(PAL.miniInk);
    } else if (style === 2) {
      x.fillStyle = rgba(PAL.cInk); x.fillRect(L + px * 0.1, Tp + px * 0.1, w, h);
      x.fillStyle = rgba(PAL.cRed); x.fillRect(L, Tp, w, h);
      T(rgba(PAL.cPaper));
    } else if (style === 3) {
      x.fillStyle = rgba(PAL.tCard); x.fillRect(L, Tp, w, h);
      x.strokeStyle = rgba(PAL.tCream); x.lineWidth = 3; x.strokeRect(L + 7, Tp + 7, w - 14, h - 14);
      x.lineWidth = 1.2; x.strokeRect(L + 14, Tp + 14, w - 28, h - 28);
      T(rgba(PAL.tCream));
    } else if (style === 4) {
      x.save(); x.beginPath(); x.rect(L + px * 0.12, Tp + px * 0.12, w, h); x.clip();
      x.fillStyle = rgba(PAL.nInk, 0.75);
      for (let yy = Tp; yy < Tp + h + px * 0.2; yy += 7) for (let xx = L + (yy % 14 ? 3.5 : 0); xx < L + w + px * 0.2; xx += 7) { x.beginPath(); x.arc(xx, yy, 2.2, 0, TAU); x.fill(); }
      x.restore();
      x.fillStyle = rgba(PAL.nPaper); x.fillRect(L, Tp, w, h);
      x.strokeStyle = rgba(PAL.nInk); x.lineWidth = 2.4; x.strokeRect(L, Tp, w, h);
      T(rgba(PAL.nInk));
    } else if (style === 5) {
      x.fillStyle = rgba(PAL.sShade, 0.3); x.fill(jag(cx + px * 0.08, cy + px * 0.1, w, h, 11 + str.length, 3));
      x.fillStyle = rgba(PAL.sMustard); x.fill(jag(cx, cy, w, h, 11 + str.length, 3));
      T(rgba(PAL.sInk));
    } else if (style === 6) {
      x.fillStyle = rgba(PAL.wVerm, 0.94); x.fill(jag(cx, cy, w, h, 31, px * 0.035));
      T(rgba(PAL.wPaper));
    } else if (style === 7) {
      x.fillStyle = PAL.pxBlack; x.fillRect(L, Tp, w, h);
      x.fillStyle = PAL.pxWhite; x.fillRect(L + 6, Tp + 6, w - 12, h - 12);
      x.fillStyle = PAL.pxNavy; x.fillRect(L + 12, Tp + 12, w - 24, h - 24);
      pixelText(x, str, cx, cy, px, PAL.pxWhite);
    } else if (style === 8) {
      x.fillStyle = "rgba(60,40,50,0.18)"; x.fillRect(L + 8, Tp + 10, w, h);
      x.fillStyle = PAL.pcSticky; x.fillRect(L, Tp, w, h);
      x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(L, Tp, w, h * 0.16);
      T(PAL.pcLine);
    } else {
      x.fillStyle = PAL.mRed; K.roundRect(x, L, Tp, w, h, h / 2); x.fill();
      T("#FFFFFF");
    }
    x.restore();
    return w;
  }

  window.FIN10 = { PAL, FACE, CLAWD, chip, rgba, hex, cellsOf, silhouette, eyeBoxes, jag };
})();
