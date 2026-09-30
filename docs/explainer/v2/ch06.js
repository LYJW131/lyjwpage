(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, stamp, spark, roundRect, pathAt, pathLen, trailOn, mulberry32 } = K;
  I18N.add({
    "ch06.title": ["两条线路", "Two lines"],
    "ch06.origin": ["源站", "origin"],
    "ch06.esa": ["阿里云 ESA", "Alibaba Cloud ESA"],
    "ch06.visitors": ["访客", "visitors"],
    "ch06.mainland": ["大陆访客", "mainland visitors"],
    "ch06.images": ["图片", "images"],
    "ch06.n1a": ["ESA 可能回一份旧 HTML，", "ESA may serve a stale shell;"],
    "ch06.n1b": ["数据在挂载后直连 Worker 取新。", "live data comes from the Worker."],
    "ch06.stale": ["过期先给旧页，后台回源", "Expired: old page first, refetch later"],
    "ch06.card": ["借书卡", "Library card"],
    "ch06.poster": ["Emby 海报", "Emby poster"],
    "ch06.callno": ["索书号", "Call number"],
    "ch06.changed": ["内容变了 → 新名字", "New content → new name"],
    "ch06.noPurge": ["不用刷新", "never purged"],
    "ch06.apple": ["（在听的封面来自 Apple 目录，不走这条路）", "(Now-playing covers come from Apple's catalog, not /img.)"],
    "ch06.rewrite": ["边缘 rewrite", "edge rewrite"],
    "ch06.esaImg": ["ESA 缓存同一路径", "ESA caches the same path"],
    "ch06.n2a": ["文件名就是内容的 sha256：", "Files are named by SHA-256,"],
    "ch06.n2b": ["地址即版本，缓存一年也不会错。", "so caching them for a year is safe."],
  });
  const tr = (k) => I18N.tr(k);
  let plate, ink, emit, paper, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const ME_Y = 540, CN_Y = 840, LW = 14;
  const O = [400, ME_Y];
  const ESA = [1400, CN_Y], L = [2400, ME_Y], C = [2400, CN_Y];
  const R2 = [1000, 250], SPUR_X = 1000;
  const ME_PATH = [O, L], CN_PATH = [O, [700, CN_Y], C];
  const CLK = [1620, 1040], CLK_R = 80;
  const CARD = { x: 1580, y: -10, w: 900, h: 450 };

  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const KEY_OLD = hex64(606), KEY_NEW = hex64(6060);
  const callNo = (k) => `/img/${k.slice(0, 10)}…${k.slice(-6)}.webp`;
  const chipNo = (k) => `/img/${k.slice(0, 8)}….webp`;

  const START = [1400, ME_Y, 1, 0];
  const OVER = [1230, 560, 0.7, 0];
  const ESAV = [1500, 900, 1, 0], IMGV = [1500, 560, 0.85, 0];
  const END = [6400, 690, 0.85, 0];
  const CAM = [
    [0, START],
    [0.12, START],
    [0.95, OVER, E.io],
    [1.3, [1232, 561, 0.705, 0], E.lin],
    [1.55, ESAV, E.io],
    [3.85, [1506, 902, 1.02, 0], E.lin],
    [4.1, IMGV, E.io],
    [6.85, [1508, 562, 0.866, 0], E.lin],
    [9.0, END, E.io],
  ];
  const camAt = (b) => keys(b, CAM);

  function station(x, cx, cy, a, o = {}) {
    if (a <= 0) return;
    const r = o.r ?? 18;
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("paper"); x.strokeStyle = o.hot ? css("signal") : css("pink"); x.lineWidth = o.lw ?? 6;
    x.beginPath(); x.arc(cx, cy, r * lerp(0.6, 1, E.outBack(clamp(a))), 0, Math.PI * 2); x.fill(); x.stroke();
    x.restore();
  }
  function pageIcon(x, cx, cy, col, a, s = 1) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(s, s);
    x.fillStyle = css("paper"); x.strokeStyle = col; x.lineWidth = 3;
    x.beginPath(); x.moveTo(-22, -30); x.lineTo(10, -30); x.lineTo(22, -18); x.lineTo(22, 30); x.lineTo(-22, 30); x.closePath(); x.fill(); x.stroke();
    for (let j = 0; j < 3; j++) { x.beginPath(); x.moveTo(-12, -12 + j * 12); x.lineTo(12 - (j === 2 ? 10 : 0), -12 + j * 12); x.stroke(); }
    x.restore();
  }
  function chip(x, label, cx, cy, hot, alpha, px = 32) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.font = FONT.mono(px, 500);
    const w = x.measureText(label).width + px * 1.2, h = px * 1.66;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 2.4;
    roundRect(x, cx - w / 2, cy - h / 2, w, h, h / 2); x.fill(); x.stroke();
    x.restore();
    text(x, label, cx, cy + px * 0.36, { font: FONT.mono(px, 500), color: hot ? css("signal") : css("pink"), align: "center", alpha });
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill(); e.restore();
  }
  function nar(x, key, px, py, r, a, size, maxW) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: size, maxW, reveal: r, alpha: a, dim: 0.12 });
  }

  function title(x, b) {
    const a = prog(b, 0.3, 0.7) * (1 - prog(b, 1.32, 1.46));
    if (a <= 0) return;
    text(x, "06", -100, 170, { font: FONT.pixel(180), color: css("signal"), alpha: a });
    text(x, tr("ch06.title"), 200, 150, { font: FONT.cjk(94, 600), reveal: prog(b, 0.35, 0.9), alpha: a, maxW: 700 });
    text(x, "lyjw.me · lyjw131.com", 204, 222, { font: FONT.mono(46), color: css("graphite"), reveal: prog(b, 0.5, 1.0), alpha: a });
    line(x, -100, 262, lerp(-100, 900, prog(b, 0.4, 1.0, E.outExpo)), 262, 2.4, css("pink"), a);
    const la = prog(b, 0.65, 0.9) * (1 - prog(b, 1.32, 1.46));
    line(x, -100, 340, -10, 340, LW, css("pink"), la);
    text(x, "lyjw.me", 14, 356, { font: FONT.mono(46, 500), alpha: la });
    line(x, -100, 420, -10, 420, LW, css("signal"), la);
    text(x, "lyjw131.com", 14, 436, { font: FONT.mono(46, 500), color: css("signal"), alpha: la });
  }

  function lines(x, b) {
    const cam = camAt(b);
    const reach = b < 7.0 ? L[0] : lerp(L[0], cam[0] + 960 / cam[2] + 250, prog(b, 7.0, 7.5, E.out));
    const lw = lerp(4, LW, prog(b, 0.05, 0.5, E.io));
    line(x, O[0], ME_Y, reach, ME_Y, lw, css("pink"));
    const ck = prog(b, 0.3, 0.9, E.io);
    polyline(x, CN_PATH, ck, LW, css("signal"));
    if (reach > C[0]) line(x, C[0], CN_Y, reach, CN_Y, LW, css("signal"));
    polyline(x, [[SPUR_X, ME_Y], [SPUR_X, R2[1] + 20]], prog(b, 0.6, 0.85), 6, css("pink"));
  }

  function stations(x, b) {
    station(x, O[0], O[1], prog(b, 0.35, 0.5), { r: 30, lw: 7 });
    station(x, ESA[0], ESA[1], prog(b, 0.6, 0.72));
    station(x, L[0], L[1], prog(b, 0.5, 0.62));
    station(x, C[0], C[1], prog(b, 0.8, 0.92));
    station(x, R2[0], R2[1], prog(b, 0.72, 0.84), { r: 16, lw: 5 });
    const la = (t0) => prog(b, t0, t0 + 0.15);
    text(x, "Vercel", O[0] - 50, O[1] + 16, { font: FONT.mono(46, 600), align: "right", alpha: la(0.45) });
    text(x, tr("ch06.origin"), O[0] - 50, O[1] + 66, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.5) });
    text(x, tr("ch06.esa"), ESA[0] - 34, ESA[1] - 34, { font: FONT.mono(46, 600), align: "right", alpha: la(0.66), maxW: 560 });
    text(x, "lyjw.me", L[0] - 40, L[1] + 72, { font: FONT.mono(46, 600), align: "right", alpha: la(0.56) });
    text(x, tr("ch06.visitors"), L[0] - 40, L[1] + 120, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.6) });
    text(x, "lyjw131.com", C[0] - 40, C[1] + 72, { font: FONT.mono(46, 600), color: css("signal"), align: "right", alpha: la(0.86) });
    text(x, tr("ch06.mainland"), C[0] - 40, C[1] + 120, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.9) });
    text(x, "R2", R2[0] + 36, R2[1] + 16, { font: FONT.mono(46, 600), alpha: la(0.78) });
    text(x, tr("ch06.images"), R2[0] + 104, R2[1] + 16, { font: FONT.cjk(40, 600), color: css("graphite"), alpha: la(0.82) });
  }

  function esaBeat(x, e, b) {
    const a = win(b, 1.55, 1.7, 3.85, 4.0);
    if (a <= 0) return;
    const [cx, cy] = CLK;
    line(x, cx, CN_Y + LW / 2, cx, cy - CLK_R, 2, css("pink"), a);
    const fillK = b < 3.5 ? prog(b, 1.75, 2.5) : 0;
    const expired = b >= 2.5 && b < 3.5;
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("paper"); x.strokeStyle = expired ? css("signal") : css("pink"); x.lineWidth = 4;
    x.beginPath(); x.arc(cx, cy, CLK_R, 0, Math.PI * 2); x.fill(); x.stroke();
    for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + (i / 10) * Math.PI * 2; line(x, cx + Math.cos(an) * (CLK_R - 14), cy + Math.sin(an) * (CLK_R - 14), cx + Math.cos(an) * (CLK_R - 4), cy + Math.sin(an) * (CLK_R - 4), i % 5 ? 2 : 4, css("pink")); }
    if (fillK > 0) { x.globalAlpha = a * 0.28; x.fillStyle = css("signal"); x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, CLK_R - 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fillK); x.closePath(); x.fill(); }
    x.globalAlpha = a;
    const hand = -Math.PI / 2 + Math.PI * 2 * fillK;
    line(x, cx, cy, cx + Math.cos(hand) * (CLK_R - 20), cy + Math.sin(hand) * (CLK_R - 20), 4, expired ? css("signal") : css("pink"), a);
    x.restore();
    if (expired) glow(e, cx, cy, 170, 0.35 * impact(b, 2.5, 0.25));
    text(x, "max-age=300", cx + 110, cy + 44, { font: FONT.mono(30), color: css("graphite"), alpha: a * prog(b, 1.65, 1.8) });
    text(x, "stale-while-revalidate=86400", cx + 110, cy + 88, { font: FONT.mono(30), color: css("graphite"), alpha: a * prog(b, 1.7, 1.85) });
    text(x, tr("ch06.stale"), cx + 110, cy - 14, { font: FONT.cjk(38, 600), color: css("signal"), reveal: prog(b, 2.5, 2.95), alpha: a, maxW: 720 });
    const fresh = b >= 3.5;
    pageIcon(x, ESA[0], ESA[1] + 90, fresh ? css("signal") : css("pink"), a * (b > 2.95 && b < 3.45 ? 0.35 : 1));
    if (b >= 2.5 && b < 3.0) {
      const k = prog(b, 2.5, 2.9, E.io);
      pageIcon(x, lerp(ESA[0] + 60, C[0] - 90, k), CN_Y - 60, css("graphite"), a * (1 - prog(k, 0.85, 1)), 0.8);
      const back = [ESA, [700, CN_Y], O];
      const d = prog(b, 2.5, 2.9, E.in) * pathLen(back);
      x.save(); x.setLineDash([12, 10]);
      polyline(x, back, prog(b, 2.5, 2.9, E.in), 4, css("pink"), a);
      x.restore();
      spark(e, null, pathAt(back, d), null, { t: G.t, size: 0.55 });
    }
    if (b >= 2.95 && b < 3.5) {
      const k = prog(b, 2.95, 3.45, E.io), fwd = [[O[0] + 60, O[1] + 90], [760, CN_Y + 62], [ESA[0], CN_Y + 62], [ESA[0], CN_Y + 90]];
      pageIcon(x, ...pathAt(fwd, k * pathLen(fwd)), css("signal"), a, 0.8);
    }
  }

  function imgBeat(x, d, s, e, b) {
    const a = win(b, 4.1, 4.25, 6.85, 7.0);
    if (a <= 0) return;
    const { x: px, y: py, w, h } = CARD;
    const pop = E.outBack(prog(b, 4.1, 4.28));
    d.save(); d.globalAlpha = a; d.translate(px + w / 2, py + h / 2); d.scale(lerp(0.8, 1, pop), lerp(0.8, 1, pop)); d.translate(-px - w / 2, -py - h / 2);
    d.shadowColor = "rgba(0,0,0,0.3)"; d.shadowBlur = 18; d.shadowOffsetY = 8;
    d.fillStyle = css("paper"); d.fillRect(px, py, w, h);
    d.shadowColor = "transparent";
    d.strokeStyle = css("pink"); d.lineWidth = 2.4; d.strokeRect(px, py, w, h);
    d.strokeStyle = css("signal"); d.lineWidth = 1.2; d.globalAlpha = a * 0.5;
    for (let j = 0; j < 4; j++) { d.beginPath(); d.moveTo(px + 24, py + 226 + j * 70); d.lineTo(px + w - 24, py + 226 + j * 70); d.stroke(); }
    d.restore();
    text(d, tr("ch06.card"), px + 36, py + 66, { font: FONT.cjk(46, 600), alpha: a });
    text(d, tr("ch06.poster"), px + w - 36, py + 64, { font: FONT.cjk(38, 600), color: css("graphite"), align: "right", alpha: a });
    line(d, px + 28, py + 92, px + w - 28, py + 92, 2, css("pink"), a);
    text(d, tr("ch06.callno"), px + 36, py + 148, { font: FONT.cjk(36, 600), color: css("graphite"), alpha: a });
    text(d, callNo(KEY_OLD), px + 36, py + 206, { font: FONT.mono(38, 500), alpha: a, reveal: prog(b, 4.2, 4.7), perChar: true });
    const nk = prog(b, 5.5, 5.62);
    if (nk > 0) {
      text(d, tr("ch06.changed"), px + 36, py + 290, { font: FONT.cjk(36, 600), color: css("graphite"), alpha: a * nk });
      text(d, callNo(KEY_NEW), px + 36, py + 346, { font: FONT.mono(38, 500), color: css("signal"), alpha: a, reveal: prog(b, 5.55, 6.0), perChar: true });
    }
    text(d, "max-age=31536000, immutable", px + 36, py + h - 34, { font: FONT.mono(34), color: css("graphite"), alpha: a * prog(b, 4.6, 4.75) });
    stamp(s, "immutable", px + w - 128, py + 250, { k: prog(b, 6.0, 6.12), px: 50, rot: -0.12, sub: tr("ch06.noPurge"), subPx: 36, alpha: a });
    text(d, tr("ch06.apple"), px - 20, 1012, { font: FONT.cjk(34, 600), color: css("graphite"), reveal: prog(b, 6.15, 6.6), alpha: a, maxW: 1000 });
    const lab = chipNo(KEY_OLD);
    const kA = prog(b, 4.75, 5.12, E.io), kUp = prog(b, 5.12, 5.3, E.in);
    if (kA > 0 && kA < 1) chip(d, lab, lerp(L[0], SPUR_X + 200, kA), ME_Y - 50, false, 1);
    if (kA >= 1 && kUp < 1) spark(e, d, [SPUR_X, lerp(ME_Y, R2[1] + 24, kUp)], [[SPUR_X, ME_Y], [SPUR_X, lerp(ME_Y, R2[1] + 24, kUp)]], { t: G.t, size: 0.6, lw: 3 });
    const kB = prog(b, 4.875, 5.3, E.io);
    if (kB > 0) {
      chip(d, lab, lerp(C[0] - 150, ESA[0] + 210, kB), CN_Y - 50, true, a);
    }
    const ra = prog(b, 5.0, 5.2) * a;
    text(d, tr("ch06.rewrite"), SPUR_X - 28, 470, { font: FONT.cjk(36, 600), align: "right", alpha: ra });
    text(d, "/img/*", SPUR_X - 28, 420, { font: FONT.mono(36, 500), color: css("graphite"), align: "right", alpha: ra });
    if (kUp >= 1) glow(e, R2[0], R2[1], 110, 0.5 * impact(b, 5.3, 0.3));
    text(d, tr("ch06.esaImg"), ESA[0] + 210, CN_Y + 72, { font: FONT.cjk(36, 600), color: css("signal"), align: "center", alpha: prog(b, 5.25, 5.45) * a, maxW: 560 });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = impact(b, 6.0);
    cam.zoom *= 1 + 0.015 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: [-600, -300, 9000, 2400] });

    const x = ink.begin(); ink.cam(cam);
    const d = paper.begin(); paper.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const tp = top.begin(); top.cam(cam);

    title(x, b);
    lines(x, b);
    stations(x, b);
    esaBeat(x, e, b);
    imgBeat(x, d, s, e, b);

    nar(d, "ch06.n1a", 650, 1290, prog(b, 1.6, 2.1), win(b, 1.6, 1.7, 3.8, 3.95), 60, 1040);
    nar(d, "ch06.n1b", 650, 1375, prog(b, 2.1, 2.75), win(b, 1.6, 1.7, 3.8, 3.95), 60, 1040);
    nar(d, "ch06.n2a", 460, 1030, prog(b, 4.15, 4.7), win(b, 4.15, 4.25, 6.8, 6.95), 71, 1224);
    nar(d, "ch06.n2b", 460, 1115, prog(b, 4.7, 5.6), win(b, 4.15, 4.25, 6.8, 6.95), 71, 1224);

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 8.3 });
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 1.7 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 6;
    f.post = {
      bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch06", title: "ch.06", bars: 9,
    init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); paper = G.layer("paper"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
