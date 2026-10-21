// 终章画风接力的前两站：01 立体微缩小岛、02 构成主义海报，以及各站共用的画法。每站一个 (x, u, o) 画法，
// x 是屏幕坐标的画布（1920 × 1080），u 是进站后的小节数，可以为负（转场时下一站提前露面）；o.nar 乘旁白的透明度。
// 每站自己铺满底色（铺得比画面大，甩镜头平移时不露边），不读别的时间；转场、调度都在 ch10.js。
// 01 站例外：底是 s1world 先画进 G.scene 的立体画面，s1 不铺底，只画字和牌子。
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

  // ---------- 01 立体微缩小岛：借第 01 章的 three.js 世界（window.CH01.W），Mac 寄出 appleMusic ----------
  // ch10.js 在画 2D 层之前调 s1world；s1 挂在模型上的锚点按同一个机位（view1）投影。
  // ox 是整站在屏幕上的横向位移（甩镜头）：立体画面靠镜头横移挪过去，屏幕上固定的牌子靠平移挪过去，两边用同一个 ox。
  const BAR1 = (60 / 108) * 4, D2R = Math.PI / 180, FOV = 26, FOCAL = 540 / Math.tan((FOV / 2) * D2R);
  const camR = (az) => [Math.cos(az * D2R), -Math.sin(az * D2R)];
  const camU = (v) => { const a = v.az * D2R, e = v.el * D2R; return [-Math.sin(e) * Math.sin(a), -Math.sin(e) * Math.cos(a), Math.cos(e)]; };
  const camF = (v) => { const a = v.az * D2R, e = v.el * D2R; return [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), -Math.sin(e)]; };
  // 让世界点 Pw 落在屏幕 (sx, sy)，按落点那一层的深度算（同 ch01.js#aim）
  function aim(Pw, sx, sy, v) {
    const r = camR(v.az), u = camU(v), k = v.d / FOCAL, a = (sx - 960) * k, c = (540 - sy) * k;
    return { ...v, at: [Pw[0] - r[0] * a - u[0] * c, Pw[1] - r[1] * a - u[1] * c, Pw[2] - u[2] * c] };
  }
  const truck = (v, px) => { const r = camR(v.az), k = (px * v.d) / FOCAL; return { ...v, at: [v.at[0] + r[0] * k, v.at[1] + r[1] * k, v.at[2]] }; };
  // 和 three 的透视相机同一套投影（视角 FOV、16:9、zoom 1）：2D 层的锚点不靠 s1world 先调过 W.view
  function proj1(v, P) {
    const f = camF(v), r = [...camR(v.az), 0], u = camU(v), C = [0, 1, 2].map((i) => v.at[i] - f[i] * v.d);
    const q = [P[0] - C[0], P[1] - C[1], P[2] - C[2]], z = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
    return [960 + (FOCAL * (q[0] * r[0] + q[1] * r[1])) / z, 540 - (FOCAL * (q[0] * u[0] + q[1] * u[1] + q[2] * u[2])) / z];
  }
  // 模型坐标照 ch01-models.js 的 L（PARK3 是导轨上的停靠点，导轨沿世界 (1, −1) 方向、顶面高 RAIL_Z）
  const M1 = () => window.CH01 && window.CH01.W && window.CH01.W.ready ? window.CH01.W : null;
  const L1 = () => (window.CH01 && window.CH01.models ? window.CH01.models.L : null);
  // 机位：方位 51° 时导轨在屏幕上几乎水平、往右略低；停靠点落在屏幕 park 处。Clawd 一格 qPx 屏幕 px，信封放大 env 倍
  const ST1 = { park: [720, 620], az: 51, el: 33, d: 1350, aper: 18, stand: 130, ride: 700, env: 1.8, qPx: 6.6 };
  const RAIL_DIR = [Math.SQRT1_2, -Math.SQRT1_2], RAIL_YAW = Math.PI / 4;
  const onRail = (L, s, z) => [L.PARK3[0] + RAIL_DIR[0] * s, L.PARK3[1] + RAIL_DIR[1] * s, z];
  // 停住时慢推 1.5%、右移 10 px（同第 01 章的 hold）
  function view1(u, ox) {
    const L = L1(), k = prog(u, 0, 2.75);
    const v0 = aim(L.PARK3, ST1.park[0], ST1.park[1], { az: ST1.az, el: ST1.el, d: ST1.d, aper: ST1.aper, fov: FOV, zoom: 1 });
    return truck({ ...v0, d: v0.d / (1 + 0.015 * k) }, 10 * k - ox);
  }
  const spring = (u, t0, A) => { const t = (u - t0) * BAR1; return t < 0 ? 0 : A * Math.exp(-t / 0.09) * Math.cos(t * 30); };
  // 信封：0.5 从笔记本的屏幕里转着弹出来，0.75 落到停靠点；1.05 起沿导轨越走越快
  function env1At(u, L) {
    if (u < 0.5) return null;
    const z0 = L.RAIL_Z + 1;
    if (u < 0.75) {
      const k = E.out(prog(u, 0.5, 0.75)), a = L.lidPoint(L.LID.w / 2, L.LID.h / 2, 10), c = onRail(L, 0, z0);
      return { p: [lerp(a[0], c[0], k), lerp(a[1], c[1], k), lerp(a[2], z0, k) + 440 * k * (1 - k)], s: lerp(0.45, ST1.env, E.out(clamp(k * 1.5))), yaw: RAIL_YAW - TAU * (1 - k) };
    }
    const go = prog(u, 1.05, 2.95), d = (ST1.ride * (0.5 * go * go + 0.38 * go)) / 0.88;
    return { p: onRail(L, d, z0 + K.hop(u, 0.75, 0.81, 10) - 3 * spring(u, 1.02, 1)), s: ST1.env, yaw: RAIL_YAW };
  }
  // Clawd（第 01 章的体素 Clawd）站在停靠点右边的导轨上，0.82 跳上信封，蹲着骑走；正面一直朝镜头
  function clawd1At(u, L, env) {
    const q = (ST1.qPx * ST1.d) / FOCAL, st = onRail(L, ST1.stand, L.RAIL_Z), top = env ? env.p[2] + 7.7 * env.s : 0;
    const frameAt = (t0) => Math.floor(((u - t0) * BAR1 * 1000) / window.Clawd.FRAME_MS + 1e-6);
    let fr, pos = st, squash = 0;
    if (u < 0.82 || !env) fr = { pose: u >= 0.5 && u < 0.78 ? "look-left" : "default", offset: 0 };
    else if (u < 1.02) {
      const k = prog(u, 0.82, 1.02), i = frameAt(0.82);
      fr = i < 2 ? window.Clawd.SEQ.jump[i] : { pose: "arms-up", offset: 0 };
      pos = [lerp(st[0], env.p[0], E.io(k)), lerp(st[1], env.p[1], E.io(k)), lerp(st[2], top, E.io(k)) + K.hop(u, 0.82, 1.02, 46)];
      squash = -0.12 * Math.sin(k * Math.PI);
    } else {
      const i = frameAt(1.02);
      fr = i < 2 ? window.Clawd.SEQ.land[i] : { pose: "default", offset: 1 };
      pos = [env.p[0], env.p[1], top]; squash = spring(u, 1.02, 0.16);
    }
    return { fr, q, pos, yaw: ST1.az * D2R, squash };
  }
  function s1world(u, ox) {
    const W = M1();
    if (!W) return false;
    const L = W.L, v = view1(u, ox), bp = 2.75 + u;
    W.view(v);
    // 借第 01 章的时间只为让笔记本屏幕在 0.25 翻面（ch01.js 的 AT.flip 是 3.0）；它的 4.0–5.0 里只有传送带在动，超出就折回 4.0，传送带的相位不跳
    W.pose(bp < 5 ? bp : 4 + ((bp - 4) % 1), {
      vaneYaw: 0.7 + 0.12 * Math.sin(u * 2.1),
      actors: (_, h) => { const e = env1At(u, L); if (e) h.envAt(e.p[0], e.p[1], e.p[2], e.s, e.yaw); h.clawdPose(clawd1At(u, L, e)); },
    });
    W.draw({ aper: v.aper, focus: v.d });
    return true;
  }

  // 字和牌子照第 01 章（ch01.js#plate、ch01-labels.js 的 tag、macLabels）：奶油色圆角牌，压一块淡紫的影子，不描边
  const P1 = { ink: PAL.miniInk, ink2: PAL.miniInk2, plate: PAL.miniPlate, shade: PAL.miniShade };
  const MONO1 = (px) => FONT.mono(px, 500);
  function plate1(x, rx, ry, w, h, a) {
    if (a <= 0) return;
    x.save();
    x.globalAlpha = a * 0.2; x.fillStyle = P1.shade; K.roundRect(x, rx + 5, ry + 6, w, h, 14); x.fill();
    x.globalAlpha = a; x.fillStyle = P1.plate; K.roundRect(x, rx, ry, w, h, 14); x.fill();
    x.restore();
  }
  function tag1(x, str, px, py, a, font, color) {
    if (a <= 0) return;
    const tw = K.measure(x, str, font), fs = parseFloat(/(\d+(\.\d+)?)px/.exec(font)[1]);
    plate1(x, px - tw / 2 - 15, py - fs * 0.95 - 7.5, tw + 30, fs * 1.28 + 15, a);
    T(x, str, px, py, font, color, { align: "center", alpha: a });
  }
  const MODS = ["desktop", "timezone", "appleMusic", "chargingDevices"];
  const sig = () => G.css("signal");
  function s1(x, u, o = {}) {
    const ox = o.ox ?? 0, L = L1();
    // 没有立体画面（three.js 没载入）时只铺第 01 章的天色，牌子照画
    if (!M1()) {
      const g = x.createLinearGradient(0, 0, 0, 1080);
      g.addColorStop(0, PAL.miniSky0); g.addColorStop(0.58, PAL.miniSky1); g.addColorStop(1, PAL.miniSky2);
      x.fillStyle = g; x.fillRect(-2400, -600, 6720, 2280);
    }
    if (L) s1anchored(x, u, L, view1(u, ox));
    s1screen(x, u, o, ox);
  }
  function s1anchored(x, u, L, v) {
    const pr = (X, Y, Z) => proj1(v, [X, Y, Z]), env = env1At(u, L);
    // 笔记本屏幕上那一下亮：信封从这里弹出来
    const scr = pr(...L.lidPoint(L.LID.w / 2, L.LID.h / 2, 4)), ga = prog(u, 0.42, 0.5) * (1 - prog(u, 0.56, 0.8));
    if (ga > 0) {
      const gr = x.createRadialGradient(scr[0], scr[1], 0, scr[0], scr[1], 130);
      gr.addColorStop(0, `rgba(255,214,180,${0.75 * ga})`); gr.addColorStop(0.5, `rgba(240,150,110,${0.25 * ga})`); gr.addColorStop(1, "rgba(240,140,100,0)");
      x.fillStyle = gr; x.beginPath(); x.arc(scr[0], scr[1], 130, 0, TAU); x.fill();
    }
    // 歌名牌：挂在笔记本上方，0.2–0.3 翻成新歌（歌名、歌手是数据，照原样不翻译）
    const [sx, sy] = pr(L.LAP.x + 54, L.LAP.y, L.LAP.z + 84), cw = 420, chh = 132, cx0 = sx - cw / 2 - 40, cy0 = sy - chh - 70;
    x.save(); x.globalAlpha = 1; x.strokeStyle = P1.ink2; x.lineWidth = 2.2; x.lineCap = "round"; x.beginPath(); x.moveTo(sx, sy - 6); x.lineTo(sx, cy0 + chh); x.stroke();
    x.fillStyle = P1.ink2; x.beginPath(); x.arc(sx, sy - 6, 5, 0, TAU); x.fill(); x.restore();
    plate1(x, cx0, cy0, cw, chh, 1);
    T(x, "Apple Music", cx0 + 26, cy0 + 44, MONO1(28), P1.ink2);
    T(x, "YOASOBI", cx0 + cw - 24, cy0 + 44, NF.s1(28, 500), P1.ink2, { align: "right" });
    const fk = prog(u, 0.2, 0.3), sq = fk > 0 && fk < 1 ? Math.max(0.02, Math.abs(Math.cos(fk * Math.PI))) : 1;
    x.save(); x.translate(0, cy0 + 94); x.scale(1, sq); x.translate(0, -(cy0 + 94));
    T(x, fk < 0.5 ? "夜に駆ける" : "アイドル", cx0 + 26, cy0 + 108, NF.jp(44), fk < 0.5 ? P1.ink : sig());
    x.restore();
    // 跟着信封的模块名
    const la = prog(u, 0.8, 0.95) * (1 - prog(u, 2.4, 2.7));
    if (env && u >= 0.75 && la > 0) { const pe = pr(env.p[0], env.p[1], env.p[2]); tag1(x, "appleMusic", pe[0], pe[1] + 78, la, MONO1(28), P1.ink); }
  }
  function s1screen(x, u, o, ox) {
    x.save(); x.translate(ox, 0);
    // 信封卡：只有 appleMusic 这一格亮，别的变成虚线
    const ck = prog(u, 0.3, 0.5, E.outBack);
    if (ck > 0) {
      const ca = clamp(ck * 1.5), s = lerp(0.85, 1, ck), lit = prog(u, 0.6, 0.7);
      x.save(); x.translate(1548, 290); x.scale(s, s); x.translate(-1548, -290);
      plate1(x, 1240, 110, 616, 360, ca);
      T(x, "POST /api/ingest/mac", 1270, 166, MONO1(30), P1.ink, { alpha: ca });
      MODS.forEach((m, i) => {
        const cx = 1262 + (i % 2) * 296, cy = 196 + Math.floor(i / 2) * 86, on = m === "appleMusic";
        x.save(); x.globalAlpha = ca; K.roundRect(x, cx, cy, 280, 66, 14);
        if (on && lit > 0) { x.fillStyle = G.css("signal", 0.18 * lit); x.fill(); x.strokeStyle = sig(); x.lineWidth = 3; x.stroke(); }
        else { x.globalAlpha = ca * (on ? 1 : lerp(1, 0.7, lit)); if (!on && lit > 0) x.setLineDash([7, 6]); x.strokeStyle = P1.ink2; x.lineWidth = 2.2; x.stroke(); }
        x.restore();
        T(x, m, cx + 140, cy + 43, MONO1(28), on && lit > 0 ? sig() : on ? P1.ink : P1.ink2, { align: "center", alpha: ca * (on ? 1 : lerp(1, 0.55, lit)) });
      });
      T(x, tr("ch10.s1.note"), 1270, 436, NF.s1(30), P1.ink2, { alpha: ca * prog(u, 0.9, 1.05) });
      T(x, "…", 1826, 436, MONO1(30), P1.ink2, { align: "right", alpha: ca });
      x.restore();
    }
    const nw = Math.min(1010, K.measure(x, tr("ch10.n1"), NF.s1(60))), na = (o.nar ?? 1) * prog(u, 0.2, 0.3);
    plate1(x, 74, 890, nw + 72, 116, na);
    nar(x, "ch10.n1", 110, 968, NF.s1(60), P1.ink, u, 0.25, { ...o, maxW: 1010 });
    x.restore();
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

  Object.assign(F10, { NF, T, nar, bg, poly, rr, envelope, ride, along, arc, check, MONO, LAMP, s2hud, s1world, STATIONS: [s1, s2] });
})();
