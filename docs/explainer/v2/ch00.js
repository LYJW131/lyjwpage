// 画面不读配乐事件表，独立预览和换拍复用时仍须正常渲染。
(() => {
  const { css } = G;
  const { E, prog, keys, lerp, text, FONT, line, polyline, fillRect, roundRect, clawd, bubble, spark, glyph, pathAt, trailOn, measure } = K;
  I18N.add({
    "ch00.title": ["这张卡片从哪来", "Where does this card come from?"],
    "ch00.clawd": ["带你拆开 lyjw.me 看看。", "Let me open up\nlyjw.me for you."],
    "ch00.q": ["这张卡片，是怎么知道的？", "How does this card know?"],
    "ch00.n1a": ["全片跟踪一封上报信封：", "We trace one report end to end:"],
    "ch00.n1b": ["Mac 上 Apple Music 换了一首歌。", "a song change on the Mac."],
    "ch00.n2a": ["上报器发 POST，Workers 记状态，", "Reporters post; Workers hold state;"],
    "ch00.n2b": ["Vercel 出首屏，浏览器收推送。", "Vercel renders; the browser listens."],
    "ch00.src": ["采集端", "Sources"],
    "ch00.srcSub": ["上报器 · 云端遥测", "reporters · cloud telemetry"],
    "ch00.hub": ["中枢", "Hub"],
    "ch00.scr": ["展示", "Screen"],
    "ch00.scrSub": ["Vercel · 浏览器", "Vercel · browser"],
    "ch00.ingress": ["上报入口", "Ingress"],
    "ch00.core": ["状态核心", "State core"],
    "ch00.collector": ["采集 Worker", "Collector"],
    "ch00.home": ["家里", "Home"],
    "ch00.tokyo": ["东京", "Tokyo"],
    "ch00.cloud": ["云端", "Cloud"],
    "ch00.recent": ["RECENTLY PLAYED", "RECENTLY PLAYED"],
    "ch00.apple": ["APPLE MUSIC", "APPLE MUSIC"],
    "ch00.np": ["NOW PLAYING", "NOW PLAYING"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  const BARS = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARS) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  // 共享画法可能在本章 init 未运行时使用，图层必须按名称从共用池获取。
  const lay = () => ({ x: G.layer("ink"), e: G.layer("emit", 0.5), d: G.layer("paper"), s: G.layer("stamp"), tp: G.layer("top") });

  const AT = {
    type0: 0.125, enter: 0.5,
    skip: 0.5, jump: 0.875, look: 1.1875, celebrate: 1.5,
    say: 0.95, cut: 2.0,
    push: 3.0, dot: 3.55, flip: 4.0, q: 4.25, shrink: 6.0,
    pull: 7.5, pulled: 8.3, pops: [8.5, 8.75, 9.0], rush: 9.5,
  };

  const TW = { x: 250, y: 120, w: 1420, h: 840, bar: 60 };
  const TX = TW.x + 52, L1 = TW.y + TW.bar + 80;
  const BOX = { x: TW.x + 52, y: L1 + 44, w: 1120, h: 330 };
  const CLAWD_Q = 11, CLAWD_X = BOX.x + 190, CLAWD_BASE = BOX.y + BOX.h - 32;
  const L2 = BOX.y + BOX.h + 96;
  const CMD = "claude";
  const POST_TERM = { bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4 };
  const SEED_TERM = 2.3, GRID_TERM = 0.55;
  const CAM_TERM = { x: 960, y: 540, zoom: 1, rot: 0 };

  function clawdFrame(b) {
    const C = window.Clawd, fr = C.FRAME_MS / 1000 / BARS;
    const segs = [["celebrate", AT.celebrate], ["look", AT.look], ["jump", AT.jump], ["skip", AT.skip]];
    for (const [name, t0] of segs) {
      if (b < t0) continue;
      const i = Math.floor((b - t0) / fr + 1e-6), s = C.SEQ[name];
      if (i < s.length) return s[i];
      if (name === "celebrate") break;
    }
    return b >= AT.skip ? { pose: "default", offset: 0, x: 0 } : null;
  }
  function termState(b) {
    const typed = b < AT.type0 ? 0 : Math.min(CMD.length, Math.floor((b - AT.type0) * 16 + 1e-6) + 1);
    const entered = b >= AT.enter;
    const on = b < 0.625 || (b * 4) % 1 < 0.5;
    return {
      typed, welcome: prog(b, AT.enter, AT.enter + 0.06), clawd: clawdFrame(b),
      say: prog(b, AT.say, AT.say + 0.12) * (1 - prog(b, 1.97, 2.0)), sayReveal: prog(b, AT.say, AT.say + 0.4),
      cursor: { line: entered ? 2 : 1, on },
      endcard: null, clear: 0,
    };
  }
  function terminal(L, st) {
    const { x, e, tp } = L;
    const bone = css("bone"), ash = css("ash");
    x.save(); x.fillStyle = css("ink2"); x.fillRect(TW.x, TW.y, TW.w, TW.h); x.restore();
    K.rect(x, TW.x, TW.y, TW.w, TW.h, 2.2, bone, 0.85);
    line(x, TW.x, TW.y + TW.bar, TW.x + TW.w, TW.y + TW.bar, 1.4, bone, 0.45);
    for (let i = 0; i < 3; i++) { x.save(); x.strokeStyle = ash; x.lineWidth = 1.8; x.beginPath(); x.arc(TW.x + 30 + i * 28, TW.y + TW.bar / 2, 8, 0, TAU); x.stroke(); x.restore(); }
    text(x, "zsh — ~/Developer/lyjwpage", TW.x + TW.w / 2, TW.y + TW.bar / 2 + 10, { font: FONT.mono(30, 500), color: ash, align: "center" });
    const keep = (y) => st.clear <= 0 || y < lerp(TW.y + TW.h, L1 + 24, E.io(st.clear));
    const pw = measure(x, "$ ", FONT.pixel(50));
    text(x, "$", TX, L1, { font: FONT.pixel(50), color: css("signalD") });
    const typed = st.clear > 0.98 ? "" : CMD.slice(0, st.typed);
    if (typed) text(x, typed, TX + pw, L1, { font: FONT.pixel(50), color: bone });
    if (st.welcome > 0 && keep(BOX.y + BOX.h)) {
      const a = st.welcome;
      K.rect(x, BOX.x, BOX.y, BOX.w, BOX.h, 2.6, css("signalD"), a);
      const tx = BOX.x + 650;
      text(x, "Claude Code", tx, BOX.y + 108, { font: FONT.pixel(50), color: bone, alpha: a });
      text(x, "Opus 5.5", tx, BOX.y + 178, { font: FONT.pixel(38), color: ash, alpha: a });
      text(x, "~/Developer/lyjwpage", tx, BOX.y + 236, { font: FONT.pixel(32), color: ash, alpha: a });
      const cf = st.clawd;
      if (cf) {
        const cx = CLAWD_X + (cf.x || 0) * 2 * CLAWD_Q;
        tp.save(); tp.beginPath(); tp.rect(BOX.x + 3, BOX.y + 3, BOX.w - 6, BOX.h - 6); tp.clip();
        clawd(tp, cx, CLAWD_BASE, CLAWD_Q, { pose: cf.pose, crouch: cf.offset || 0, alpha: a });
        tp.restore();
        if (cf.poof) for (const s of [-1, 1]) text(tp, cf.poof === "dot" ? "·" : "~", cx + s * 8 * CLAWD_Q, CLAWD_BASE - CLAWD_Q * 0.6, { font: FONT.mono(CLAWD_Q * 2.6, 600), color: ash, align: "center", texture: true, alpha: a });
      }
      if (st.say > 0) bubble(tp, tr("ch00.clawd"), CLAWD_X - 64, CLAWD_BASE - 146, { px: 36, k: st.say, reveal: st.sayReveal });
    }
    const ec = st.endcard;
    if (ec && ec.a > 0 && keep(L2 + 160)) {
      K.narration(x, ec.l1, TX, L2 + 50, { px: 110, color: bone, reveal: ec.reveal, alpha: ec.a, maxW: TW.w - 104 });
      text(x, ec.l2, TX + 4, L2 + 140, { font: FONT.cjk(46, 600), color: ash, alpha: ec.a * prog(ec.reveal, 0.5, 1), maxW: TW.w - 108 });
    } else if (st.cursor.line === 2 && st.welcome > 0 && keep(L2)) text(x, ">", TX, L2, { font: FONT.pixel(50), color: ash });
    if (st.cursor.on) {
      const onL2 = st.cursor.line === 2 && st.clear <= 0;
      const cx = onL2 ? TX + measure(x, "> ", FONT.pixel(50)) : TX + pw + measure(x, typed, FONT.pixel(50)) + 4;
      const cy = onL2 ? L2 : L1;
      fillRect(x, cx, cy - 42, 27, 50, css("signalD"));
    }
    if (st.clear > 0 && st.clear < 1) {
      const y = lerp(TW.y + TW.h, L1 + 24, E.io(st.clear));
      x.save(); x.fillStyle = css("ink2"); x.fillRect(TW.x + 2, y, TW.w - 4, TW.y + TW.h - y - 2); x.restore();
      line(x, TW.x + 2, y, TW.x + TW.w - 2, y, 1.6, css("signalD"), 0.8);
    }
  }
  // 首尾共用渲染函数、seed 和后期参数，才能逐帧无缝循环。
  function termFrame(f, st, cam = CAM_TERM, extra = null) {
    const { x: X, e: Em, d: D, tp: T } = lay();
    G.setCam(cam);
    G.fill(G.pass(K.PLATE.ink), { uGridA: GRID_TERM, uPlate: [-400, -300, 2320, 1380] });
    const x = X.begin(); X.cam(cam);
    const e = Em.begin(); Em.cam(cam);
    const d = D.begin(); D.cam(cam);
    const tp = T.begin(); T.cam(cam);
    terminal({ x, e, d, tp }, st);
    if (extra) extra({ x, e, d, tp });
    G.composite(X.upload(), { mode: G.MODE.ink, seed: SEED_TERM });
    G.composite(Em.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(D.upload(), { mode: G.MODE.paper });
    G.composite(T.upload(), { mode: G.MODE.normal });
    f.post = { ...POST_TERM, shake: [0, 0], flash: 0, fade: 0, blur: [0, 0], zoomBlur: 0 };
  }

  const PSC = 1.5;
  const WIN = { x: 2700, y: 814.5, w: 961, bar: 60 };
  const VIEW = 540;
  WIN.h = WIN.bar + VIEW * PSC;
  const PX = (u) => WIN.x + 20 + u * PSC, PY = (v) => WIN.y + WIN.bar + v * PSC;
  const CARDS = [
    { id: "contact", r: [0, 64, 304, 121] },
    { id: "timezone", r: [310, 64, 304, 121] },
    { id: "listening", r: [0, 192, 614, 238] },
    { id: "activity", r: [0, 437, 614, 152] },
  ];
  const LC = CARDS[2].r;
  const COVER = [LC[0] + 14, LC[1] + 31, 48];
  const COVER_C = [PX(COVER[0] + COVER[2] / 2), PY(COVER[1] + COVER[2] / 2)];
  const ML = COVER_C[1];
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI";

  function card(x, r, k, a, hot = 0) {
    if (a <= 0 || k <= 0) return;
    const [u, v, w, h] = r, px = PX(u), py = PY(v), W = w * PSC, H = h * PSC;
    x.save(); x.globalAlpha = a * 0.12 * prog(k, 0.7, 1); x.fillStyle = css("pink"); roundRect(x, px + 4.5, py + 4.5, W, H, 12); x.fill(); x.restore();
    x.save(); x.globalAlpha = a * prog(k, 0.7, 1); x.fillStyle = css("paper"); roundRect(x, px, py, W, H, 12); x.fill(); x.restore();
    const pts = [[px + W / 2, py], [px + W, py], [px + W, py + H], [px, py + H], [px, py], [px + W / 2, py]];
    polyline(x, pts, k, hot > 0.5 ? 3 : 2, hot > 0.5 ? css("signal") : css("pink"), a);
  }
  const bar = (x, u, v, w, h, a, c = css("pink")) => fillRect(x, PX(u), PY(v), w * PSC, h * PSC, c, a);
  function heroRow(x, flipK, a, hot) {
    const [cu, cv, cs] = COVER;
    const cy = PY(cv + cs / 2), s = flipK > 0 && flipK < 1 ? Math.max(0.03, Math.abs(Math.cos(flipK * Math.PI))) : 1;
    const title = flipK >= 0.5 ? NEW : OLD;
    x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy);
    x.save(); x.globalAlpha = a; x.strokeStyle = css("pink"); x.lineWidth = 2;
    roundRect(x, PX(cu), PY(cv), cs * PSC, cs * PSC, 6); x.stroke();
    for (let j = 1; j <= 4; j++) { x.globalAlpha = a * (0.6 - j * 0.1); x.beginPath(); x.arc(PX(cu + cs / 2), PY(cv + cs / 2), cs * PSC * 0.1 * j, 0, TAU); x.stroke(); }
    x.restore();
    const tx = PX(cu + cs + 12);
    text(x, tr("ch00.np"), tx, PY(cv + 11), { font: FONT.mono(20, 600), color: css("graphite"), alpha: a, tracking: 1.5 });
    text(x, title, tx, PY(cv + 32), { font: FONT.cjk(34, 600), color: hot ? css("signal") : css("pink"), alpha: a });
    text(x, ARTIST, tx, PY(cv + 46), { font: FONT.sans(22, 500), color: css("graphite"), alpha: a });
    x.restore();
    const y = PY(cv + cs + 10), x0 = PX(cu), x1 = PX(LC[2] - 14);
    line(x, x0, y, x1, y, 4, css("pink"), 0.18 * a);
    line(x, x0, y, lerp(x0, x1, flipK >= 0.5 ? 0.03 : 0.78), y, 4, css("signal"), a);
  }
  function home(L, o) {
    const { x } = L;
    const k = o.k ?? 1;
    const dim = 1 - 0.78 * (o.focus || 0);
    const wk = prog(k, 0, 0.18, E.out);
    const { x: wx, y: wy, w: ww, h: wh } = WIN;
    x.save(); x.globalAlpha = prog(k, 0.05, 0.3); x.fillStyle = css("paper"); x.fillRect(wx, wy, ww, wh); x.restore();
    polyline(x, [[wx, wy + wh], [wx, wy], [wx + ww, wy], [wx + ww, wy + wh]], wk, 2.6, css("pink"), dim);
    const ha = prog(k, 0.1, 0.3) * dim;
    line(x, wx, wy + WIN.bar, wx + ww, wy + WIN.bar, 1.6, css("pink"), ha);
    for (let i = 0; i < 3; i++) { x.save(); x.globalAlpha = ha; x.strokeStyle = css("pink"); x.lineWidth = 1.8; x.beginPath(); x.arc(wx + 26 + i * 22, wy + 30, 7, 0, TAU); x.stroke(); x.restore(); }
    x.save(); x.globalAlpha = ha; x.strokeStyle = css("pink"); x.lineWidth = 1.4; roundRect(x, wx + 330, wy + 12, 300, 36, 18); x.stroke(); x.restore();
    text(x, "lyjw.me", wx + 480, wy + 41, { font: FONT.mono(32, 500), color: css("graphite"), align: "center", alpha: ha });
    const hk = prog(k, 0.2, 0.4) * dim;
    bar(x, 0, 18, 70, 9, 0.75 * hk);
    x.save(); x.globalAlpha = hk; x.strokeStyle = css("pink"); x.lineWidth = 1.6; roundRect(x, PX(190), PY(8), 234 * PSC, 40 * PSC, 30); x.stroke(); x.restore();
    fillRect(x, PX(204), PY(17), 22 * PSC, 22 * PSC, css("pink"), 0.55 * hk);
    bar(x, 236, 24, 110, 8, 0.4 * hk);
    for (let i = 0; i < 2; i++) { x.save(); x.globalAlpha = hk; x.strokeStyle = css("pink"); x.lineWidth = 1.6; roundRect(x, PX(560 + i * 30 - 30), PY(14), 24 * PSC, 24 * PSC, 5); x.stroke(); x.restore(); }
    CARDS.forEach((c, i) => {
      const ck = prog(k, 0.3 + i * 0.1, 0.58 + i * 0.1, E.io);
      if (ck <= 0) return;
      const hero = c.id === "listening";
      const hot = hero ? o.hot || 0 : 0;
      const clip = c.id === "activity";
      if (clip) { x.save(); x.beginPath(); x.rect(wx, wy, ww, wh - 2); x.clip(); }
      card(x, c.r, ck, hero ? 1 : dim, hot);
      const ia = prog(ck, 0.6, 1) * (hero ? 1 : dim);
      const [u, v, w, h] = c.r;
      if (c.id === "contact") {
        x.save(); x.globalAlpha = ia; x.strokeStyle = css("pink"); x.lineWidth = 1.6; x.beginPath(); x.arc(PX(u + 30), PY(v + 30), 16 * PSC, 0, TAU); x.stroke(); x.restore();
        bar(x, u + 56, v + 20, 90, 8, 0.7 * ia); bar(x, u + 56, v + 34, 60, 6, 0.35 * ia);
        for (let r = 0; r < 4; r++) for (let q = 0; q < 26; q++) fillRect(x, PX(u + 14 + q * 10.6), PY(v + 64 + r * 12), 8 * PSC, 8 * PSC, css("pink"), ia * (0.08 + 0.3 * K.hash(q * 7 + r * 13)));
      } else if (c.id === "timezone") {
        for (let j = 0; j < 3; j++) { x.save(); x.globalAlpha = ia; x.strokeStyle = css("pink"); x.lineWidth = 1.6; x.beginPath(); x.arc(PX(u + 52 + j * 100), PY(v + 56), 26 * PSC, 0, TAU); x.stroke(); x.restore(); line(x, PX(u + 52 + j * 100), PY(v + 56), PX(u + 52 + j * 100 + 12), PY(v + 46), 2, css("pink"), ia); }
        for (let j = 0; j < 3; j++) bar(x, u + 32 + j * 100, v + 96, 40, 6, 0.35 * ia);
      } else if (c.id === "listening") {
        line(x, PX(u), PY(v + 21), PX(u + w), PY(v + 21), 1.4, css("pink"), 0.6 * ia);
        text(x, tr("ch00.recent"), PX(u + 10), PY(v + 14), { font: FONT.mono(14, 500), color: css("graphite"), alpha: ia, texture: true, tracking: 1 });
        text(x, tr("ch00.apple"), PX(u + w - 10), PY(v + 14), { font: FONT.mono(14, 500), color: css("graphite"), align: "right", alpha: ia, texture: true, tracking: 1 });
        heroRow(x, o.flip ?? 0, ia, hot > 0.5);
        for (let j = 0; j < 9; j++) {
          x.save(); x.globalAlpha = ia * 0.8; x.strokeStyle = css("pink"); x.lineWidth = 1.4; roundRect(x, PX(u + 14 + j * 66), PY(v + 120), 56 * PSC, 56 * PSC, 5); x.stroke(); x.restore();
          bar(x, u + 14 + j * 66, v + 184, 44, 5, 0.35 * ia); bar(x, u + 14 + j * 66, v + 194, 28, 4, 0.2 * ia);
        }
      } else if (c.id === "activity") {
        line(x, PX(u), PY(v + 21), PX(u + w), PY(v + 21), 1.4, css("pink"), 0.6 * ia);
        bar(x, u + 10, v + 8, 46, 6, 0.4 * ia);
        for (let j = 0; j < 3; j++) { x.save(); x.globalAlpha = ia; x.strokeStyle = css("pink"); x.lineWidth = 5; x.beginPath(); x.arc(PX(u + 70), PY(v + 90), (40 - j * 11) * PSC, -Math.PI / 2, -Math.PI / 2 + TAU * (0.55 + 0.15 * j)); x.stroke(); x.restore(); }
      }
      if (clip) x.restore();
    });
  }

  const OVER = [1920, 1080, 0.5, 0];
  const COLS = [
    { key: "ch00.src", sub: "ch00.srcSub", x0: 140, x1: 1180 },
    { key: "ch00.hub", sub: null, mono: "Cloudflare Workers", x0: 1380, x1: 2460 },
    { key: "ch00.scr", sub: "ch00.scrSub", x0: 2660, x1: 3700 },
  ];
  const COL_Y0 = 580, COL_Y1 = 1740;
  const PICS = [
    { i: 1, name: "iPhone", y: ML - 290 }, { i: 2, key: "ch00.home", y: ML - 145 }, { i: 0, name: "Mac", y: ML },
    { i: 3, name: "NAS", y: ML + 145 }, { i: 4, key: "ch00.tokyo", y: ML + 290 }, { i: 5, key: "ch00.cloud", y: ML + 435 },
  ];
  const PIC_X = 400, PIC_S = 2.3, FUNNEL = [1300, ML];
  const MAC = [PIC_X, ML];
  const BLK = {
    ingress: { x: 1420, y: ML - 70, w: 420, h: 140, key: "ch00.ingress", mono: "ingress" },
    core: { x: 2000, y: ML - 70, w: 420, h: 140, key: "ch00.core", mono: "api" },
    collector: { x: 2000, y: ML - 330, w: 420, h: 140, key: "ch00.collector", mono: "collector" },
  };
  const RAIL_Y = ML + 200, GLY = [["room", 1560], ["lag", 1800], ["d1", 2040], ["cred", 2280]], GLY_Y = ML + 330;
  const ROUTE = [[PIC_X + 240, ML], COVER_C];

  function pict(x, i, cx, cy, s, a, col) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(s, s);
    x.strokeStyle = col; x.fillStyle = css("paper"); x.lineWidth = 3.4 / s;
    const R = (rx, ry, w, h, r = 0) => { r ? roundRect(x, rx, ry, w, h, r) : (x.beginPath(), x.rect(rx, ry, w, h)); x.fill(); x.stroke(); };
    const Ln = (pts) => { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); };
    if (i === 0) { R(-26, -24, 52, 34); Ln([[-34, 14], [34, 14]]); }
    else if (i === 1) R(-14, -27, 28, 54, 7);
    else if (i === 2) { R(-36, -16, 34, 32, 6); x.beginPath(); x.arc(-19, 0, 5, 0, TAU); x.stroke(); R(6, -12, 30, 24); for (let j = 0; j < 3; j++) Ln([[13 + j * 8, -5], [13 + j * 8, 5]]); }
    else if (i === 3) { R(-22, -27, 44, 54); for (let j = 0; j < 3; j++) Ln([[-12 + j * 12, -18], [-12 + j * 12, 12]]); }
    else if (i === 4) { R(-37, -12, 22, 24); R(-11, -12, 22, 24); R(15, -12, 22, 24); }
    else { x.setLineDash([5, 4]); x.beginPath(); x.rect(-26, -20, 52, 40); x.stroke(); x.setLineDash([]); Ln([[-14, 0], [-6, -8], [2, 6], [10, -4]]); }
    x.restore();
  }
  function dial(x, cx, cy, r, a) {
    x.save(); x.globalAlpha = a; x.strokeStyle = css("pink"); x.lineWidth = 2.6; x.fillStyle = css("paper");
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - r * 0.7); x.lineTo(cx, cy); x.lineTo(cx + r * 0.5, cy + r * 0.28); x.stroke(); x.restore();
  }
  function block(x, B, a, hot) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 3;
    roundRect(x, B.x, B.y, B.w, B.h, 14); x.fill(); x.stroke(); x.restore();
    const dx = B.key === "ch00.collector" ? 96 : 32;
    if (B.key === "ch00.collector") dial(x, B.x + 52, B.y + B.h / 2, 30, a);
    text(x, tr(B.key), B.x + dx, B.y + 62, { font: FONT.cjk(60, 600), color: hot ? css("signal") : css("pink"), alpha: a, maxW: B.w - dx - 20 });
    text(x, B.mono, B.x + dx, B.y + 120, { font: FONT.mono(56, 500), color: css("graphite"), alpha: a });
  }
  function overview(L, b, o) {
    const { x, e } = L;
    const k = o.k;
    if (k <= 0) return;
    COLS.forEach((c, i) => {
      const ck = prog(k, i * 0.12, 0.45 + i * 0.12, E.io);
      if (ck <= 0) return;
      const pop = o.pop ? o.pop[i] : 0;
      const col = pop > 0.3 ? css("signal") : css("pink");
      polyline(x, [[c.x0, COL_Y0 + 170], [c.x0, COL_Y0], [c.x1, COL_Y0], [c.x1, COL_Y1], [c.x0, COL_Y1], [c.x0, COL_Y0 + 170]], ck, 2.6, css("pink"), 0.8);
      const ta = prog(ck, 0.5, 1);
      text(x, tr(c.key), c.x0 + 44, COL_Y0 + 100, { font: FONT.cjk(80, 600), color: col, alpha: ta, maxW: c.x1 - c.x0 - 88 });
      if (c.sub) text(x, tr(c.sub), c.x0 + 46, COL_Y0 + 168, { font: FONT.cjk(56, 600), color: css("graphite"), alpha: ta, maxW: c.x1 - c.x0 - 90 });
      else text(x, c.mono, c.x0 + 46, COL_Y0 + 168, { font: FONT.mono(56, 500), color: css("graphite"), alpha: ta, maxW: c.x1 - c.x0 - 90 });
      if (pop > 0.02) glow(e, c.x0 + 180, COL_Y0 + 76, 260, 0.45 * pop);
    });
    PICS.forEach((p, j) => {
      const pa = prog(k, 0.15 + j * 0.05, 0.3 + j * 0.05);
      if (pa <= 0) return;
      const mac = p.i === 0;
      pict(x, p.i, PIC_X, p.y, PIC_S * lerp(0.7, 1, E.outBack(pa)), pa, mac ? css("signal") : css("pink"));
      text(x, p.key ? tr(p.key) : p.name, PIC_X + 110, p.y + 20, { font: p.key ? FONT.cjk(56, 600) : FONT.mono(56, 500), color: mac ? css("signal") : css("pink"), alpha: pa });
      if (!mac) polyline(x, [[PIC_X + 330, p.y], FUNNEL], prog(k, 0.35 + j * 0.04, 0.6 + j * 0.04, E.io), 2, css("pink"), 0.5);
    });
    const ba = (t) => prog(k, t, t + 0.2, E.out);
    block(x, BLK.collector, ba(0.4), false);
    polyline(x, [[BLK.collector.x + 210, BLK.collector.y + BLK.collector.h], [BLK.core.x + 210, BLK.core.y]], prog(k, 0.5, 0.65), 2, css("pink"), 0.7);
    const rk = prog(k, 0.5, 0.8, E.io);
    if (rk > 0) {
      polyline(x, [[1440, RAIL_Y], [2420, RAIL_Y]], rk, 2.4, css("pink"), 0.8);
      line(x, BLK.ingress.x + 210, ML + 70, BLK.ingress.x + 210, lerp(ML + 70, RAIL_Y, rk), 2, css("pink"), 0.7);
      line(x, BLK.core.x + 210, ML + 70, BLK.core.x + 210, lerp(ML + 70, RAIL_Y, rk), 2, css("pink"), 0.7);
      GLY.forEach(([g, gx], j) => {
        const ga = prog(k, 0.6 + j * 0.06, 0.8 + j * 0.06);
        if (ga <= 0) return;
        line(x, gx, RAIL_Y, gx, GLY_Y - 60, 1.6, css("pink"), 0.6 * ga);
        glyph(x, g, gx, GLY_Y, css("pink"), 1.35 * lerp(0.6, 1, E.outBack(ga)));
      });
    }
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function route(L, b) {
    const { x, e } = L;
    if (b < AT.dot) return;
    const [p0, p1] = ROUTE, len = p1[0] - p0[0];
    const d = keys(b, [[AT.dot, len - 520], [AT.flip, len, E.out]]);
    const head = pathAt(ROUTE, d);
    polyline(x, ROUTE, d / len, 2.4, css("signal"));
    const size = lerp(0.9, 0.65, prog(b, AT.flip, AT.flip + 0.3));
    spark(e, x, head, b < AT.flip + 0.1 ? trailOn(ROUTE, d, 300) : null, { t: G.t, size, lw: 3 });
    // 纸面上相加的光只会把纸照白：橙点本身另画一个实心点
    x.save(); x.fillStyle = css("signal"); x.beginPath(); x.arc(head[0], head[1], 9, 0, TAU); x.fill(); x.restore();
    if (b >= AT.flip) glow(e, head[0], head[1], 150, 0.45 * impact(b, AT.flip, 0.25));
  }

  const WINV = [3180, 1249, 0.9, 0];
  const CARD_C = [PX(LC[0] + LC[2] / 2), PY(LC[1] + LC[3] / 2)];
  const ZC = 1.45, P_CARD = [1100, 610];
  const CARDV = [CARD_C[0] - (P_CARD[0] - 960) / ZC, CARD_C[1] - (P_CARD[1] - 540) / ZC, ZC, 0];
  const CAM_A = [[AT.cut, WINV], [AT.push, [3180, 1249, 0.93, 0], E.lin], [3.5, CARDV, E.io], [AT.pull, [CARDV[0], CARDV[1], ZC * 1.02, 0], E.lin]];
  const toScreen = (w, c) => [(w[0] - c[0]) * c[2] + 960, (w[1] - c[1]) * c[2] + 540];
  function anchored(k, W, p0, p1, z0, z1) {
    const z = Math.exp(lerp(Math.log(z0), Math.log(z1), k));
    const p = [lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)];
    return [W[0] - (p[0] - 960) / z, W[1] - (p[1] - 540) / z, z, 0];
  }
  const RUSH0 = [1920, 1080, 0.51, 0];
  function camPaper(b) {
    if (b < AT.pull) return keys(b, CAM_A);
    if (b < AT.pulled) {
      const c0 = keys(AT.pull, CAM_A);
      return anchored(E.io(prog(b, AT.pull, AT.pulled)), CARD_C, toScreen(CARD_C, c0), toScreen(CARD_C, OVER), c0[2], OVER[2]);
    }
    if (b < AT.rush) return keys(b, [[AT.pulled, OVER], [AT.rush, RUSH0, E.lin]]);
    return anchored(E.inExpo(prog(b, AT.rush, 10)), MAC, toScreen(MAC, RUSH0), [960, 540], RUSH0[2], 7);
  }

  function hud(x, b) {
    const qa = prog(b, AT.q, AT.q + 0.06) * (1 - prog(b, 9.35, 9.5));
    if (qa <= 0) return;
    x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0);
    const sk = prog(b, AT.shrink, AT.shrink + 0.3, E.io);
    const fk = prog(b, 7.55, 7.75);
    const sq = fk > 0 && fk < 1 ? Math.max(0.03, Math.abs(Math.cos(fk * Math.PI))) : 1;
    const px = lerp(110, 290, sk), py = lerp(300, 176, sk), size = lerp(100, 58, sk);
    x.save(); x.translate(0, py - size * 0.35); x.scale(1, sq); x.translate(0, -(py - size * 0.35));
    text(x, tr(fk >= 0.5 ? "ch00.title" : "ch00.q"), px, py, { font: FONT.cjk(size, 600), reveal: prog(b, AT.q, AT.q + 0.4), perChar: b < AT.q + 0.4, alpha: qa, maxW: lerp(1700, 1300, sk) });
    x.restore();
    const ha = sk * qa;
    if (ha > 0) {
      text(x, "00", 110, 196, { font: FONT.pixel(112), color: css("signal"), alpha: ha });
      text(x, "lyjw.me · /api/status/listening/now", 292, 226, { font: FONT.mono(28), color: css("graphite"), alpha: ha * prog(b, 6.15, 6.4) });
      line(x, 110, 262, 110 + 990 * prog(b, 6.1, 6.6, E.outExpo), 262, 1.4, css("pink"), ha);
    }
    K.narration(x, tr("ch00.n1a"), 110, 944, { reveal: prog(b, 6.1, 6.45), alpha: win(b, 6.05, 6.15, 7.35, 7.5), maxW: 1040 });
    K.narration(x, tr("ch00.n1b"), 110, 1024, { reveal: prog(b, 6.45, 6.95), alpha: win(b, 6.05, 6.15, 7.35, 7.5), maxW: 1040 });
    K.narration(x, tr("ch00.n2a"), 110, 944, { reveal: prog(b, 8.1, 8.4), alpha: win(b, 8.05, 8.15, 9.35, 9.5), maxW: 1040 });
    K.narration(x, tr("ch00.n2b"), 110, 1024, { reveal: prog(b, 8.4, 8.95), alpha: win(b, 8.05, 8.15, 9.35, 9.5), maxW: 1040 });
    const pa = win(b, 8.3, 8.5, 9.35, 9.5);
    if (pa > 0) text(x, "PLATE 00 · OVERVIEW", G.W - 60, 1024, { font: FONT.mono(30, 600), align: "right", alpha: pa });
    x.restore();
  }

  const POST_PAPER = { bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35 };
  const SEED_PAPER = 7.1;
  function paperFrame(f, b, o = {}) {
    const { x: X, e: Em, d: D, s: S, tp: T } = lay();
    const c = camPaper(b), c0 = camPaper(Math.max(o.b0 ?? AT.cut, b - 1 / 60 / BARS));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.02 * impact(b, AT.flip, 0.12)), rot: 0 };
    G.setCam(cam);
    G.fill(G.pass(K.PLATE.paper), { uGridA: prog(b, AT.cut + 0.05, AT.cut + 0.6), uPlate: [-600, 200, 4400, 2300] });
    const x = X.begin(); X.cam(cam);
    const e = Em.begin(); Em.cam(cam);
    const d = D.begin(); D.cam(cam);
    S.begin(); S.cam(cam);
    const tp = T.begin(); T.cam(cam);
    const Lr = { x, e, d, tp };
    const ov = prog(b, AT.pull + 0.05, AT.pulled + 0.05);
    overview(Lr, b, { k: ov, pop: AT.pops.map((t) => impact(b, t, 0.3)) });
    const focus = o.focus ?? (o.hud === false ? 0 : win(b, AT.q - 0.1, AT.q + 0.2, AT.pull, AT.pull + 0.4));
    home(Lr, { k: prog(b, AT.cut - 0.03, 2.75), flip: prog(b, AT.flip - 0.08, AT.flip + 0.08), hot: win(b, AT.flip, AT.flip + 0.05, 5.6, 6.0), focus });
    route(Lr, b);
    if (ov > 0) { block(x, BLK.ingress, prog(ov, 0.3, 0.5, E.out), true); block(x, BLK.core, prog(ov, 0.35, 0.55, E.out), true); }
    if (o.hud !== false) hud(x, b);
    if (o.extra) o.extra(Lr);
    G.composite(X.upload(), { mode: G.MODE.ink, seed: SEED_PAPER });
    G.composite(D.upload(), { mode: G.MODE.paper });
    G.composite(Em.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(S.upload(), { mode: G.MODE.stamp, seed: 3.3 });
    G.composite(T.upload(), { mode: G.MODE.normal });
    const zb = Math.log(c[2] / c0[2]);
    f.post = {
      ...POST_PAPER, shake: [0, 0],
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: Math.max(-0.2, Math.min(0.2, zb)),
      flash: impact(b, AT.flip, 0.1) * 0.06, flashCol: [1, 0.8, 0.6],
    };
  }

  function render(f) {
    const b = f.bar;
    if (b < AT.cut) termFrame(f, termState(b), { x: 960, y: 540, zoom: 1 + 0.018 * prog(b, 0.5, 2, E.lin), rot: 0 });
    else paperFrame(f, b);
  }

  window.CHAPTERS.push({
    id: "ch00", title: "ch.00", bars: 10,
    init() { G.pass(K.PLATE.ink); G.pass(K.PLATE.paper); lay(); },
    render,
    share: { termFrame, termState, terminal, paperFrame, AT, TW, L2 },
  });
})();
