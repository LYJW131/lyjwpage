// 终章画风接力的前两站：01 等距小岛、02 构成主义海报，以及各站共用的画法。每站一个 (x, u, o) 画法，
// x 是屏幕坐标的画布（1920 × 1080），u 是进站后的小节数，可以为负（转场时下一站提前露面）；o.nar 乘旁白的透明度。
// 每站自己铺满底色（铺得比画面大，甩镜头平移时不露边），不读别的时间；转场、调度都在 ch10.js。
(() => {
  const { E, prog, clamp, lerp, hash, FONT } = K;
  const F10 = window.FIN10, { PAL, CLAWD, rgba } = F10;
  const tr = (k) => I18N.tr(k);
  const EN = () => I18N.lang === "en";
  const TAU = Math.PI * 2;
  const MONO = (px, w = 600) => FONT.mono(px, w);
  // 旁白与标注照各章自己的字（ch01.js#SANS、ch02.js#LABEL、ch03.js#SERIF、ch04.js 的 SERIF、ch05.js#NARR）。
  const NF = {
    s1: (px, w = 600) => `${w} ${px}px "Fredoka ch01", "ZCOOL KuaiLe ch01", "Zen Maru Gothic ch01", sans-serif`,
    jp: (px) => `700 ${px}px "Zen Maru Gothic ch01", sans-serif`,
    s2: (px) => (EN() ? `600 ${px}px "Big Shoulders ch02", Geist, sans-serif` : `700 ${px}px "Noto Sans SC ch02", "PingFang SC", sans-serif`),
    s2big: (px) => (EN() ? `900 ${px}px "Big Shoulders ch02", Geist, sans-serif` : `900 ${px}px "Noto Sans SC ch02", "PingFang SC", sans-serif`),
    s3: (px) => `700 ${px}px "Noto Serif SC ch03", "Noto Serif SC", serif`,
    s4: (px, w = 900) => `${w} ${px}px "Noto Serif SC", "Songti SC", serif`,
    s5: (px) => (EN() ? `500 ${px}px Jost, sans-serif` : `700 ${px}px "Noto Sans SC ch05", "PingFang SC", sans-serif`),
    s5b: (px, w = 600) => `${w} ${px}px Jost, "Noto Sans SC ch05", sans-serif`,
  };
  const T = (x, str, px, py, font, color, o = {}) => K.text(x, str, px, py, { font, color, ...o });
  function nar(x, key, px, py, font, color, u, u0, o = {}) {
    const a = (o.nar ?? 1) * prog(u, u0 - 0.05, u0 + 0.05);
    if (a <= 0) return;
    K.text(x, tr(key), px, py, { font, color, reveal: prog(u, u0, u0 + 0.5), dim: 0.14, perChar: true, alpha: a, maxW: o.maxW ?? 1000, align: o.align, narration: true });
  }
  const bg = (x, c) => { x.fillStyle = c; x.fillRect(-2400, -600, 6720, 2280); };
  function poly(x, pts, fill, stroke, lw = 3) {
    x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath();
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw; x.lineJoin = "round"; x.stroke(); }
  }
  function rr(x, rx, ry, w, h, r, fill, stroke, lw = 3) {
    K.roundRect(x, rx, ry, w, h, r);
    if (fill) { x.fillStyle = fill; x.fill(); }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw; x.stroke(); }
  }
  // 信封：中心在 (0, 0)、宽 w、高 0.64w，盖口朝上；骑手的脚底在信封上沿。
  function envelope(x, w, fill, ink, lw, flap = ink) {
    const h = w * 0.64;
    x.fillStyle = fill; x.fillRect(-w / 2, -h / 2, w, h);
    x.strokeStyle = ink; x.lineWidth = lw; x.lineJoin = "round"; x.strokeRect(-w / 2, -h / 2, w, h);
    x.strokeStyle = flap; x.beginPath(); x.moveTo(-w / 2, -h / 2); x.lineTo(0, h * 0.1); x.lineTo(w / 2, -h / 2); x.stroke();
    return h;
  }
  // 骑信封：先画信封，再把那一站画风的 Clawd 放在上沿，跟着信封一起转。
  function ride(x, style, cx, cy, w, rot, q, env, o = {}) {
    x.save(); x.translate(cx, cy); x.rotate(rot);
    const h = env ? env(x, w) : 0;
    if (q) CLAWD[style](x, o.dx ?? 0, -h / 2 + (o.lift ?? 0), q, { pose: o.pose, crouch: o.crouch, flip: o.flip });
    x.restore();
  }
  const along = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const arc = (a, b, k, h) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k) - 4 * h * k * (1 - k)];
  function check(x, cx, cy, s, color, k, lw) {
    if (k <= 0) return;
    const pts = [[cx - s * 0.5, cy], [cx - s * 0.12, cy + s * 0.38], [cx + s * 0.55, cy - s * 0.45]];
    const L1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), L2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]), d = k * (L1 + L2);
    x.save(); x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(...pts[0]);
    if (d <= L1) x.lineTo(...along(pts[0], pts[1], d / L1)); else { x.lineTo(...pts[1]); x.lineTo(...along(pts[1], pts[2], (d - L1) / L2)); }
    x.stroke(); x.restore();
  }

  // ---------- 01 等距小岛：Mac 寄出 appleMusic ----------
  const ISO = { ox: 620, oy: 520 };
  const iso = (X, Y, Z = 0, dz = 0) => [ISO.ox + (X - Y) * 0.866, ISO.oy + (X + Y) * 0.5 - Z - dz];
  const RAIL = { a: [720, 556], b: [2080, 892] };
  const RAIL_ROT = Math.atan2(RAIL.b[1] - RAIL.a[1], RAIL.b[0] - RAIL.a[0]);
  const MODS = ["desktop", "timezone", "appleMusic", "chargingDevices"];
  const env1 = (x, w) => envelope(x, w, PAL.isoPlate, PAL.isoInk, 4, PAL.isoInk2);
  function cloud(x, cx, cy, s, a) {
    x.save(); x.globalAlpha = a; x.fillStyle = "#FFFFFF";
    for (const [dx, dy, r] of [[-60, 8, 34], [-18, -14, 46], [34, -2, 40], [74, 12, 28]]) { x.beginPath(); x.arc(cx + dx * s, cy + dy * s, r * s, 0, TAU); x.fill(); }
    x.fillRect(cx - 60 * s, cy + 8 * s, 134 * s, 32 * s);
    x.restore();
  }
  function s1(x, u, o = {}) {
    const g = x.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, PAL.isoSky0); g.addColorStop(0.55, PAL.isoSky1); g.addColorStop(1, PAL.isoSky2);
    x.fillStyle = g; x.fillRect(-2400, -600, 6720, 2280);
    cloud(x, 150 + u * 18, 120, 0.8, 0.75); cloud(x, 1040 - u * 12, 90, 0.65, 0.6); cloud(x, 1720 + u * 10, 600, 0.9, 0.55);
    const dz = 6 * Math.sin(u * Math.PI);
    const I = (X, Y, Z = 0) => iso(X, Y, Z, dz);
    const R = 160, LIP = 36;
    poly(x, [I(-R, R, -LIP), I(R, R, -LIP), I(R, -R, -LIP), [ISO.ox + 30, ISO.oy + 330 - dz]], "#C8B8E6", PAL.isoInk2, 3);
    poly(x, [I(-R, R, 0), I(R, R, 0), I(R, R, -LIP), I(-R, R, -LIP)], PAL.isoLip, PAL.isoInk2, 3);
    poly(x, [I(R, R, 0), I(R, -R, 0), I(R, -R, -LIP), I(R, R, -LIP)], "#8FC4A0", PAL.isoInk2, 3);
    poly(x, [I(-R, -R), I(R, -R), I(R, R), I(-R, R)], PAL.isoGrass, PAL.isoInk2, 3);
    x.strokeStyle = "#B9DEC4"; x.lineWidth = 2; x.beginPath();
    for (let k = -R + 64; k < R; k += 64) { x.moveTo(...I(k, -R)); x.lineTo(...I(k, R)); x.moveTo(...I(-R, k)); x.lineTo(...I(R, k)); }
    x.stroke();
    for (const [X, Y, s] of [[110, -110, 1], [-120, -40, 0.8]]) {
      const [tx, ty] = I(X, Y);
      x.fillStyle = PAL.isoShade; x.fillRect(tx - 5 * s, ty - 26 * s, 10 * s, 26 * s);
      poly(x, [[tx - 30 * s, ty - 22 * s], [tx, ty - 96 * s], [tx + 30 * s, ty - 22 * s]], "#9ED3AE", PAL.isoInk2, 3);
    }
    // 笔记本：底座在小岛上，屏幕立在后沿。
    const LX = -40, B = (X, Y, Z) => I(X + LX, Y, Z);
    poly(x, [B(-60, 40, 0), B(60, 40, 0), B(60, 40, 8), B(-60, 40, 8)], PAL.isoLilac, PAL.isoInk, 3);
    poly(x, [B(60, -40, 0), B(60, 40, 0), B(60, 40, 8), B(60, -40, 8)], "#BBA8E0", PAL.isoInk, 3);
    poly(x, [B(-60, -40, 8), B(60, -40, 8), B(60, 40, 8), B(-60, 40, 8)], "#FFF5E8", PAL.isoInk, 3);
    poly(x, [B(-60, -40, 8), B(60, -40, 8), B(60, -40, 104), B(-60, -40, 104)], PAL.isoInk, PAL.isoInk, 3);
    const glow = 0.55 + 0.45 * prog(u, 0.45, 0.55) * (1 - prog(u, 0.6, 0.9));
    poly(x, [B(-50, -40, 18), B(50, -40, 18), B(50, -40, 94), B(-50, -40, 94)], `rgba(243,165,149,${glow})`);
    const [nx, ny] = B(4, -40, 56);
    x.fillStyle = PAL.isoPlate; x.beginPath(); x.ellipse(nx - 8, ny + 12, 9, 7, -0.4, 0, TAU); x.fill(); x.fillRect(nx - 1, ny - 22, 4, 34);
    // 歌名牌：0.25 翻成新歌（数据，照原样不翻译）。
    const top = B(0, -40, 104), fk = prog(u, 0.15, 0.35), sy = Math.max(0.04, Math.abs(Math.cos(fk * Math.PI)));
    x.save(); x.setLineDash([8, 8]); x.strokeStyle = PAL.isoInk2; x.lineWidth = 3; x.beginPath(); x.moveTo(top[0], top[1] - 4); x.lineTo(560, 276); x.stroke(); x.restore();
    x.save(); x.translate(560, 215); x.scale(1, sy); x.translate(-560, -215);
    rr(x, 368, 164, 400, 112, 26, PAL.isoLilac); rr(x, 360, 156, 400, 112, 26, PAL.isoPlate, PAL.isoInk, 3);
    T(x, "NOW PLAYING", 560, 196, NF.s1(28, 600), PAL.isoInk2, { align: "center", tracking: 3 });
    T(x, fk < 0.5 ? "夜に駆ける" : "アイドル", 560, 250, NF.jp(46), PAL.isoInk, { align: "center" });
    x.restore();
    // 信封：0.5 从屏幕里弹出来，落到导轨起点；1.05 起沿导轨越走越快。
    const out = prog(u, 0.5, 0.75), go = prog(u, 1.05, 2.95), d = 0.5 * go * go + 0.38 * go;
    let ep = null, er = RAIL_ROT;
    if (u >= 0.5 && u < 0.75) { ep = arc([top[0], top[1] - 30], [RAIL.a[0], RAIL.a[1] - 40], E.out(out), 120); er = lerp(-TAU, RAIL_ROT, E.out(out)); }
    else if (u >= 0.75) ep = along([RAIL.a[0], RAIL.a[1] - 40], [RAIL.b[0], RAIL.b[1] - 40], d);
    // 导轨：紫色的两根轨，等距地斜着出画。
    x.save(); x.strokeStyle = PAL.isoShade; x.lineCap = "round";
    const nrm = [-Math.sin(RAIL_ROT), Math.cos(RAIL_ROT)];
    x.lineWidth = 6; x.beginPath();
    for (const s of [-14, 14]) { x.moveTo(RAIL.a[0] + nrm[0] * s, RAIL.a[1] + nrm[1] * s); x.lineTo(RAIL.b[0] + nrm[0] * s, RAIL.b[1] + nrm[1] * s); }
    x.stroke(); x.lineWidth = 4; x.globalAlpha = 0.55; x.beginPath();
    for (let k = 0; k < 1; k += 0.035) { const p = along(RAIL.a, RAIL.b, k); x.moveTo(p[0] - nrm[0] * 22, p[1] - nrm[1] * 22); x.lineTo(p[0] + nrm[0] * 22, p[1] + nrm[1] * 22); }
    x.stroke(); x.restore();
    // Clawd 站在小岛前沿，0.82 跳上信封。
    const hopK = prog(u, 0.82, 1.02), home = I(110, 110);
    if (ep) ride(x, 1, ep[0], ep[1], 150, er, u >= 1.02 ? 6 : 0, env1);
    if (u < 1.02) {
      const p = hopK > 0 ? arc(home, [ep ? ep[0] : RAIL.a[0], (ep ? ep[1] : RAIL.a[1]) - 48], E.io(hopK), 90) : home;
      CLAWD[1](x, p[0], p[1], 6, { pose: hopK > 0 ? "arms-up" : u > 0.5 && u < 0.8 ? "look-right" : "default" });
    }
    const la = prog(u, 0.8, 0.95) * (1 - prog(u, 2.4, 2.7));
    if (ep && u >= 0.75 && la > 0) {
      x.save(); x.globalAlpha = la; rr(x, ep[0] - 86, ep[1] + 58, 200, 48, 14, PAL.isoPlate, PAL.isoInk, 2.5); x.restore();
      T(x, "appleMusic", ep[0] + 14, ep[1] + 92, MONO(28), PAL.isoInk, { alpha: la, align: "center" });
    }
    // 信封卡：只有 appleMusic 这一格亮。
    const ck = prog(u, 0.3, 0.5, E.outBack);
    if (ck > 0) {
      x.save(); x.globalAlpha = clamp(ck * 1.5); x.translate(1548, 290); x.scale(lerp(0.85, 1, ck), lerp(0.85, 1, ck)); x.translate(-1548, -290);
      rr(x, 1250, 120, 616, 360, 28, PAL.isoLilac); rr(x, 1240, 110, 616, 360, 28, PAL.isoPlate, PAL.isoInk, 3);
      T(x, "POST /api/ingest/mac", 1270, 168, MONO(30), PAL.isoInk, { alpha: clamp(ck * 1.5) });
      const lit = prog(u, 0.6, 0.7);
      MODS.forEach((m, i) => {
        const cx = 1262 + (i % 2) * 296, cy = 196 + Math.floor(i / 2) * 86, on = m === "appleMusic";
        const a = on ? 1 : lerp(1, 0.4, lit);
        rr(x, cx, cy, 280, 66, 18, on ? (lit > 0 ? "#F3A595" : PAL.isoPlate) : PAL.isoPlate, PAL.isoInk, on ? 3 + 2 * lit : 3);
        if (!on && lit > 0) { x.save(); x.globalAlpha = 0.5 * lit; x.strokeStyle = PAL.isoInk2; x.lineWidth = 3; x.setLineDash([10, 8]); K.roundRect(x, cx + 6, cy + 6, 268, 54, 14); x.stroke(); x.restore(); }
        T(x, m, cx + 140, cy + 43, MONO(28), PAL.isoInk, { align: "center", alpha: a * clamp(ck * 1.5) });
      });
      T(x, tr("ch10.s1.note"), 1270, 438, NF.s1(30), PAL.isoInk2, { alpha: prog(u, 0.9, 1.05) });
      T(x, "…", 1826, 438, MONO(30), PAL.isoInk2, { align: "right", alpha: clamp(ck * 1.5) });
      x.restore();
    }
    rr(x, 88, 892, 1090, 128, 30, PAL.isoLilac); rr(x, 80, 884, 1090, 128, 30, PAL.isoPlate, PAL.isoInk, 3);
    nar(x, "ch10.n1", 122, 970, NF.s1(60), PAL.isoInk, u, 0.25, { ...o, maxW: 1010 });
  }

  // ---------- 02 构成主义：入口验 JWT，分进实时那根管 ----------
  const BELT = (X) => 800 - 0.344 * X, BROT = Math.atan(-0.344);
  const GEAR = [1180, 394], LAMP = [1780, 188];
  const PIPES = [["ch10.s2.lag", 520], ["ch10.s2.d1", 640], ["ch10.s2.cred", 760]];
  const env2 = (x, w) => {
    const h = envelope(x, w, "rgb(246,241,230)", rgba(PAL.cInk), 4);
    x.fillStyle = rgba(PAL.cRed); x.fillRect(-w / 2, h / 2 - 12, w, 12);
    return h;
  };
  function s2(x, u, o = {}) {
    const INK = rgba(PAL.cInk), RED = rgba(PAL.cRed), PAPER = rgba(PAL.cPaper), CARD = "rgb(246,241,230)";
    bg(x, PAPER);
    poly(x, [[1500, -80], [2400, -80], [2400, 560]], RED);
    x.fillStyle = INK; x.fillRect(-2400, 1046, 6720, 40);
    // 传送带：-19° 的一条墨带，滚轮和箭头跟着走。
    const nrm = [Math.sin(-BROT), Math.cos(-BROT)];
    const bp = (X, s = 0) => [X + nrm[0] * s, BELT(X) + nrm[1] * s];
    poly(x, [bp(-300, -16), bp(1180, -16), bp(1180, 16), bp(-300, 16)], INK);
    const shift = (u * 4 * 110) % 110;
    x.fillStyle = PAPER;
    for (let X = -300 + shift; X < 1100; X += 110) { const [ax, ay] = bp(X, 0); x.save(); x.translate(ax, ay); x.rotate(BROT); poly(x, [[-14, -8], [8, 0], [-14, 8]], PAPER); x.restore(); }
    for (let X = -260; X < 1180; X += 120) {
      const [cx, cy] = bp(X, 34), a = u * 9;
      x.fillStyle = INK; x.beginPath(); x.arc(cx, cy, 16, 0, TAU); x.fill();
      x.strokeStyle = PAPER; x.lineWidth = 3; x.beginPath(); x.moveTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12); x.lineTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); x.stroke();
    }
    // 分拣：实时那根顺着带子去灯，另三根拐下去出画。
    x.lineCap = "butt"; x.lineJoin = "miter";
    for (const [, y] of PIPES) {
      x.strokeStyle = INK; x.lineWidth = 30; x.beginPath(); x.moveTo(...GEAR); x.lineTo(1340, y); x.lineTo(2300, y); x.stroke();
      x.strokeStyle = PAPER; x.lineWidth = 14; x.stroke();
    }
    x.strokeStyle = INK; x.lineWidth = 36; x.beginPath(); x.moveTo(...GEAR); x.lineTo(...LAMP); x.stroke();
    const lit = prog(u, 1.98, 2.0);
    x.strokeStyle = lit > 0 ? "rgb(255,196,120)" : RED; x.lineWidth = 16; x.stroke();
    PIPES.forEach(([k, y]) => { const w = K.measure(x, tr(k), NF.s2(32)) + 28; x.fillStyle = CARD; x.fillRect(1440, y - 74, w, 50); x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(1440, y - 74, w, 50); T(x, tr(k), 1454, y - 37, NF.s2(32), INK); });
    const rw = K.measure(x, tr("ch10.s2.rt"), NF.s2big(36)) + 28;
    x.fillStyle = RED; x.fillRect(1440, 334, rw, 50); T(x, tr("ch10.s2.rt"), 1454, 372, NF.s2big(36), PAPER);
    T(x, "CORE.commitIngest", 1440, 428, MONO(30), INK);
    // 齿轮：十个齿；信封到了猛转一下。
    const ga = u * 1.2 + 6 * E.io(prog(u, 1.3, 1.45));
    x.save(); x.translate(...GEAR); x.rotate(ga); x.fillStyle = INK; x.beginPath();
    for (let i = 0; i < 20; i++) { const r = i % 2 ? 76 : 96, a0 = (i / 20) * TAU, a1 = ((i + 1) / 20) * TAU; x.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); x.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); }
    x.closePath(); x.fill(); x.fillStyle = PAPER; x.beginPath(); x.arc(0, 0, 40, 0, TAU); x.fill(); x.fillStyle = RED; x.beginPath(); x.arc(0, 0, 16, 0, TAU); x.fill();
    x.restore();
    // 灯：信封撞进去就亮。
    if (lit > 0) {
      x.save(); x.translate(...LAMP); x.fillStyle = "rgba(255,214,150,0.5)";
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + u; poly(x, [[0, 0], [Math.cos(a - 0.08) * 260 * lit, Math.sin(a - 0.08) * 260 * lit], [Math.cos(a + 0.08) * 260 * lit, Math.sin(a + 0.08) * 260 * lit]], "rgba(255,214,150,0.5)"); }
      x.restore();
    }
    x.fillStyle = INK; x.beginPath(); x.arc(...LAMP, 64, 0, TAU); x.fill();
    x.fillStyle = lit > 0 ? "rgb(255,236,200)" : RED; x.beginPath(); x.arc(...LAMP, 46, 0, TAU); x.fill();
    // 入口：两根墨柱、红门楣，验过就抬杆。
    const gy = BELT(560);
    x.fillStyle = INK; x.fillRect(505, gy - 200, 24, 236); x.fillRect(591, gy - 230, 24, 266);
    x.fillStyle = RED; x.fillRect(486, gy - 266, 148, 48);
    T(x, "ingress", 560, gy - 230, `900 32px "Big Shoulders ch02", Geist, sans-serif`, PAPER, { align: "center" });
    const lift = E.outBack(prog(u, 0.95, 1.08));
    x.save(); x.translate(529, gy - 20); x.rotate(BROT - lift * 1.25); x.fillStyle = RED; x.fillRect(0, -7, 70, 14); x.fillStyle = INK; x.fillRect(20, -7, 14, 14); x.fillRect(48, -7, 14, 14); x.restore();
    // 信封：带子上走到门口等验，进门、过齿轮，沿实时那根管冲进灯。
    let p, rot = BROT, spin = 0;
    if (u < 1.0) p = bp(lerp(-160, 440, E.out(prog(u, 0.05, 0.45))), -64);
    else if (u < 1.42) { p = bp(lerp(440, 1150, E.io(prog(u, 1.0, 1.3))), -64); spin = TAU * E.io(prog(u, 1.3, 1.42)); }
    else { const k = E.in(prog(u, 1.42, 2.0)); p = along([GEAR[0] + nrm[0] * -48, GEAR[1] + nrm[1] * -48], [LAMP[0] + nrm[0] * -48, LAMP[1] + nrm[1] * -48], k); }
    if (u < 2.0) ride(x, 2, p[0], p[1], 130, rot + spin, 6, env2);
    if (o.hud !== false) s2hud(x, u, o);
  }
  // 验票单和旁白按屏幕坐标画：冲进灯那一段镜头往灯上推，场景另画，这两样留在原处等橙色盖上，不被推出画。
  function s2hud(x, u, o = {}) {
    const INK = rgba(PAL.cInk), RED = rgba(PAL.cRed), PAPER = rgba(PAL.cPaper), CARD = "rgb(246,241,230)";
    // 验 JWT：四项挨个打勾，最后盖「放行」。单子的下沿要高过 ingress 门楣的上沿（y 341）：冲进灯时场景只往下推，单子在屏幕上不动，压不到门楣上的字。
    const fa = o.card ?? 1;
    if (fa > 0) {
      x.save(); x.globalAlpha = fa;
      x.fillStyle = CARD; x.fillRect(60, 60, 440, 280); x.strokeStyle = INK; x.lineWidth = 6; x.strokeRect(60, 60, 440, 280);
      x.fillStyle = INK; x.fillRect(60, 60, 440, 62);
      T(x, "Cf-Access-Jwt-Assertion", 82, 102, MONO(28), PAPER, { alpha: fa });
      ["RS256", "aud", "iss", "exp"].forEach((s, i) => {
        const y = 162 + i * 50;
        x.strokeStyle = INK; x.lineWidth = 4; x.strokeRect(86, y - 30, 36, 36);
        check(x, 104, y - 12, 34, RED, prog(u, 0.33 + i * 0.125, 0.4 + i * 0.125), 7);
        T(x, s, 146, y, MONO(34), INK, { alpha: fa });
      });
      const sk = prog(u, 0.85, 0.95);
      if (sk > 0) {
        x.save(); x.translate(390, 270); x.rotate(-0.2); const s = lerp(1.8, 1, E.outExpo(sk)); x.scale(s, s); x.globalAlpha = fa * clamp(sk * 3);
        x.strokeStyle = RED; x.lineWidth = 6; x.strokeRect(-70, -36, 140, 72);
        T(x, tr("ch10.s2.pass"), 0, 16, NF.s2big(44), RED, { align: "center", alpha: fa * clamp(sk * 3) });
        x.restore();
      }
      x.restore();
    }
    x.save(); x.globalAlpha = o.nar ?? 1; x.fillStyle = RED; x.fillRect(80, 932, 16, 80); x.restore();
    nar(x, "ch10.n2", 116, 994, NF.s2(62), INK, u, 0.25, { ...o, maxW: 1060 });
  }

  Object.assign(F10, { NF, T, nar, bg, poly, rr, envelope, ride, along, arc, check, MONO, LAMP, s2hud, STATIONS: [s1, s2] });
})();
