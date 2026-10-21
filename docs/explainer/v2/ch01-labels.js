// 第 01 章的字、牌子和标注：全部画在屏幕坐标的 2D 层上，压在立体模型上面；挂在模型上的锚点经 W.proj 从 3D 投影过来，字号就是屏幕 px。
(() => {
  const NS = window.CH01;
  if (!NS) return;
  const { E, prog, lerp, text, measure, pathAt, mulberry32, hash } = K;
  const { P, tone, rgba, impact, win, SANS, SONG, MONO, AT, STOP, live, tr, plate, glow } = NS;
  const TAU = Math.PI * 2, rr = K.roundRect;
  const pr = (X, Y, Z = 0) => NS.W.proj(X, Y, Z);
  const L = () => NS.W.L;
  const SIG = () => NS.SIG;

  // 一行字垫一块牌子；(px, py) 是字的基线起点，o.px 是屏幕字号
  function tag(x, str, px, py, a, o = {}) {
    if (a <= 0) return 0;
    const fs = o.px ?? 30, f = (o.font || SANS)(fs, o.w ?? 600);
    const tw = Math.min(measure(x, str, f), o.maxW ?? 1e9), pad = 15;
    const x0 = o.align === "center" ? px - tw / 2 : o.align === "right" ? px - tw : px;
    plate(x, x0 - pad, py - fs * 0.95 - pad * 0.5, tw + pad * 2, fs * 1.28 + pad, a, o);
    text(x, str, px, py, { font: f, color: o.color || P.ink, align: o.align, alpha: a, maxW: o.maxW });
    return tw;
  }
  NS.tag = tag;
  function lead(x, pts, a, color = P.ink2) {
    if (a <= 0) return;
    x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = 2.2; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke();
    x.fillStyle = color; x.beginPath(); x.arc(pts[0][0], pts[0][1], 5, 0, TAU); x.fill(); x.globalAlpha = 1;
  }
  function dash(x, pts, color, lw, a, d = [10, 9], off = 0) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.setLineDash(d); x.lineDashOffset = off;
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function dot(x, px, py, r, color, a) { if (a <= 0) return; x.globalAlpha = a; x.fillStyle = color; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill(); x.globalAlpha = 1; }
  // 地面上的一圈（世界里的水平圆）投到屏幕上
  function ring(x, X, Y, Z, r, color, lw, a) {
    if (a <= 0) return;
    x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = lw; x.beginPath();
    for (let i = 0; i <= 48; i++) { const t = (i / 48) * TAU, [u, v] = pr(X + r * Math.cos(t), Y + r * Math.sin(t), Z); if (i) x.lineTo(u, v); else x.moveTo(u, v); }
    x.stroke(); x.globalAlpha = 1;
  }
  function nar(x, ka, kb, t0, t1, b) {
    const a = win(b, t0, t0 + 0.12, t1 - 0.14, t1);
    if (a <= 0) return;
    const px = 110, y1 = 930, y2 = y1 + 80, f = SANS(60, 600), maxW = 1120;
    const w = Math.min(maxW, Math.max(measure(x, tr(ka), f), measure(x, tr(kb), f)));
    plate(x, px - 36, y1 - 78, w + 72, 196, a);
    text(x, tr(ka), px, y1, { font: f, color: P.ink, reveal: prog(b, t0 + 0.05, t0 + 0.6), dim: 0.16, perChar: true, alpha: a, maxW, narration: true });
    text(x, tr(kb), px, y2, { font: f, color: P.ink, reveal: prog(b, t0 + 0.6, t0 + 1.15), dim: 0.16, perChar: true, alpha: a, maxW, narration: true });
  }
  const squash = (k) => (k > 0 && k < 1 ? Math.max(0.02, Math.abs(Math.cos(k * Math.PI))) : 1);
  function withSquash(x, cy, s, draw) { x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy); draw(); x.restore(); }

  function openLabels(x, b) {
    const st = STOP.S0, a = win(b, 0, 0.02, st.t1 - 0.12, st.t1);
    if (a <= 0) return;
    const { TOWER } = L();
    // 拉取的虚线从钟楼顶伸向左上角画外（第三方接口在岛外），从标题上方过去，不压字
    const [tx, ty] = pr(TOWER.x + TOWER.w / 2, TOWER.y + TOWER.d / 2, 50 + TOWER.h + 120);
    for (let j = 0; j < 3; j++) {
      const t0 = 0.85 + j * 0.42, k = prog(b, t0, t0 + 0.5), far = [-40 + j * 70, 8 + j * 26];
      dash(x, [[tx, ty], far], P.ink2, 3, a * 0.6 * prog(b, 0.75, 0.95), [12, 12]);
      if (k > 0 && k < 1) { const u = k < 0.5 ? k * 2 : 2 - 2 * k; dot(x, lerp(tx, far[0], u), lerp(ty, far[1], u), 9, P.ink, a); }
    }
    const la = a * prog(b, 0.75, 0.9);
    const [rx, ry] = pr(1500, 900, 300);
    tag(x, tr("ch01.push"), rx + 200, ry - 120, la, { px: 32 });
    tag(x, tr("ch01.pull"), tx + 70, ty + 12, la, { px: 32 });
    const ta = prog(b, AT.title, AT.title + 0.1, E.out) * a;
    if (ta > 0) {
      // 左上角放不下（ch01.js#titleRight）就整块挪到右下角、右对齐，不缩字号
      const tf = SANS(96, 600), left = NS.titleR > 0, al = left ? "left" : "right";
      const [qx, qy] = left ? [110, 196] : [1750, 930];
      x.save(); x.translate(qx, qy); const sc = lerp(0.85, 1, E.outBack(prog(b, AT.title, AT.title + 0.14))); x.scale(sc, sc);
      text(x, tr("ch01.title"), 0, 0, { font: tf, color: P.ink, alpha: ta, align: al });
      text(x, NS.titleSub, left ? 4 : -4, 64, { font: MONO(30), color: P.ink2, alpha: ta, align: al });
      x.restore();
    }
  }

  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI";
  const MODS = ["desktop", "appleMusic", "chargingDevices", "…"];
  const POSTER = [140, 84, 222, 148];
  function ghostEnv(x, X, Y, Z, s, a) {
    if (a <= 0) return;
    const w = 40 * s, d = 28 * s, h = 7 * s, F = (u, v) => pr(X - w / 2 + u, Y - d / 2 + v, Z + h);
    x.save(); x.globalAlpha = a; x.strokeStyle = P.ink2; x.lineWidth = 1.6; x.lineJoin = "round";
    x.beginPath(); [[0, 0], [w, 0], [w, d], [0, d]].forEach(([u, v], i) => (i ? x.lineTo(...F(u, v)) : x.moveTo(...F(u, v)))); x.closePath();
    x.moveTo(...F(0, 0)); x.lineTo(...F(w / 2, d * 0.55)); x.lineTo(...F(w, 0)); x.stroke(); x.restore();
  }
  function macLabels(x, e, b) {
    const st = STOP.MAC, a = live(st, b);
    if (a <= 0) return;
    const { LAP, ROOM } = L();
    const [sx, sy] = pr(LAP.x + 54, LAP.y, LAP.z + 84);
    // 歌卡右沿离信封详图（X0）至少 24 px，引线仍从笔记本竖直上去
    const X0 = 1060, Y0 = 150, W = 810, H = 560;
    const cw = 420, ch = 132, cx0 = Math.min(sx - cw / 2 - 40, X0 - 24 - cw), cy0 = sy - ch - 70;
    lead(x, [[sx, sy - 6], [sx, cy0 + ch]], a);
    plate(x, cx0, cy0, cw, ch, a);
    text(x, "Apple Music", cx0 + 26, cy0 + 44, { font: MONO(28), color: P.ink2, alpha: a });
    text(x, ARTIST, cx0 + cw - 24, cy0 + 44, { font: SANS(28, 500), color: P.ink2, align: "right", alpha: a });
    const k = prog(b, AT.flip - 0.05, AT.flip + 0.05);
    withSquash(x, cy0 + 94, squash(k), () => {
      text(x, b < AT.flip ? OLD : NEW, cx0 + 26, cy0 + 108, { font: SONG(44), color: b >= AT.flip ? SIG() : P.ink, alpha: a });
    });
    const [hx, hy] = pr(ROOM.x0, ROOM.y0 + ROOM.d, 12);
    tag(x, tr("ch01.f1"), hx - 40, hy + 120, a * prog(b, st.t0 + 0.05, st.t0 + 0.2), { px: 30 });
    // 信封详图
    const ca = a * prog(b, AT.card, AT.card + 0.1, E.out);
    if (ca > 0) {
      plate(x, X0, Y0, W, H, ca);
      text(x, tr("ch01.env"), X0 + 34, Y0 + 58, { font: SANS(38, 600), color: P.ink, alpha: ca });
      text(x, "POST /api/ingest/mac", X0 + W - 30, Y0 + 56, { font: MONO(28), color: P.ink2, align: "right", alpha: ca });
      const Ls = ["{", '  "version": 4,', '  "presence": "online",', '  "heartbeatAt": 1790640000000,', '  "activeModules": [ … ],', '  "modules": {'];
      Ls.forEach((str, i) => text(x, str, X0 + 34, Y0 + 112 + i * 44, { font: MONO(28), color: P.ink, alpha: ca, reveal: prog(b, AT.card + i * 0.04, AT.card + 0.05 + i * 0.04) }));
      let cx = X0 + 64;
      const cy = Y0 + 398, lk = prog(b, AT.lit, AT.lit + 0.06);
      MODS.forEach((m, i) => {
        const f = MONO(28), w = measure(x, m, f) + 30, hot = i === 1 && lk > 0, ma = ca * prog(b, AT.card + 0.26 + i * 0.03, AT.card + 0.3 + i * 0.03);
        x.save(); x.globalAlpha = ma;
        rr(x, cx, cy - 34, w, 50, 12);
        if (hot) { x.fillStyle = rgba(SIG(), 0.18 + 0.1 * impact(b, AT.lit, 0.3)); x.fill(); x.strokeStyle = SIG(); x.lineWidth = 3; x.stroke(); }
        else { x.setLineDash([7, 6]); x.strokeStyle = P.ink2; x.lineWidth = 2.2; x.stroke(); }
        x.restore();
        text(x, m, cx + 15, cy, { font: f, color: hot ? SIG() : P.ink2, alpha: ma });
        cx += w + 14;
      });
      text(x, "  }", X0 + 34, Y0 + 462, { font: MONO(28), color: P.ink, alpha: ca * prog(b, AT.card + 0.38, AT.card + 0.42) });
      text(x, "}", X0 + 34, Y0 + 506, { font: MONO(28), color: P.ink, alpha: ca * prog(b, AT.card + 0.4, AT.card + 0.44) });
      tag(x, tr("ch01.unsent"), X0 + W - 30, Y0 + H + 62, ca * prog(b, AT.lit + 0.06, AT.lit + 0.16), { px: 30, align: "right", color: P.ink2 });
    }
    // 空信封 = 心跳：「90 s」贴在虚线信封左边，牌子上沿离 Apple Music 卡片的影子留 16 px。
    // 说明那行放在卡片左边（牌子右沿离卡片 16 px），牌子连影子的下沿高过墙上画框的上沿 12 px。
    const ba = a * win(b, AT.breath, AT.breath + 0.06, st.t1 - 0.2, st.t1 - 0.1);
    if (ba > 0) {
      const [gx, gy] = pr(LAP.x + 54, LAP.y + 30, 196), cardB = cy0 + ch;
      const frameTop = pr(ROOM.x0 + 14, ROOM.y0 + POSTER[0], 12 + POSTER[3])[1];
      tag(x, "90 s", gx - 76, Math.max(gy + 4, cardB + 6 + 16 + 36), ba, { px: 30, font: MONO, color: P.ink, align: "right" });
      tag(x, tr("ch01.empty"), cx0 - 16 - 15, Math.min(cardB - 8, frameTop - (12 + 6 + 17.4)), ba, { px: 30, color: P.ink2, align: "right" });
    }
    const bk = win(b, AT.breath, AT.breath + 0.05, AT.breath + 0.6, AT.breath + 0.7);
    if (bk > 0) {
      const k = prog(b, AT.breath, AT.breath + 0.55);
      ghostEnv(x, LAP.x + 54, LAP.y + 30, 186, 1.1 + 0.18 * Math.sin(k * Math.PI), bk);
      ring(x, LAP.x + 54, LAP.y + 30, 186, 30 + 50 * k, P.ink2, 2, bk * (1 - k));
    }
  }

  function gateLabels(x, e, b) {
    const st = STOP.GATE, a = live(st, b);
    if (a <= 0) return;
    const { JEV, EXITS } = L();
    const wt = a * win(b, AT.wt + 0.05, AT.wt + 0.15, AT.list, AT.list + 0.1);
    if (wt > 0) { const [px, py] = pr(...NS.tilePath(b)); tag(x, tr("ch01.wt"), px + 40, py - 50, wt, { px: 30, color: P.ink2 }); }
    const la = a * prog(b, AT.list - 0.15, AT.list - 0.05);
    const [gx, gy] = pr(650, 1121, 120);
    lead(x, [[gx, gy], [gx, gy - 70]], la);
    tag(x, tr("ch01.lists"), gx, gy - 158, la, { px: 30, align: "center", color: P.ink2 });
    const t1 = tr("ch01.never"), t2 = tr("ch01.trusted"), f = SANS(30), w1 = measure(x, t1, f), w2 = measure(x, t2, f), gap = 48;
    const l1 = gx - (w1 + w2 + gap) / 2, l2 = l1 + w1 + gap;
    tag(x, t1, l1, gy - 92, la, { px: 30, line: P.ink2, lw: 2.2 });
    tag(x, t2, l2, gy - 92, la, { px: 30, line: P.ink2, lw: 2.2 });
    const ja = a * prog(b, AT.jev - 0.1, AT.jev);
    const [jx, jy] = pr(JEV.x + JEV.w / 2, JEV.y, JEV.h + 40);
    if (ja > 0) {
      // Jev 卡片和名单标签在同一高度：英文标签更长，卡片的牌子左沿至少离第二枚标签的牌子 28 px，不够就整块往右挪
      const fj = SANS(40), fm = MONO(28), wj = measure(x, "Jev", fj), wm = measure(x, "TypeSafe System One", fm);
      const lx = Math.max(jx - 40, l2 + w2 + 15 + 28 + 16), ly = jy - 60;
      plate(x, lx - 16, ly - 46, wj + wm + 54, 64, ja);
      text(x, "Jev", lx, ly, { font: fj, color: P.ink, alpha: ja });
      text(x, "TypeSafe System One", lx + wj + 22, ly - 3, { font: fm, color: P.ink2, alpha: ja });
    }
    const [ix, iy] = pr(JEV.x + JEV.w, JEV.y + JEV.d, 10);
    tag(x, tr("ch01.illus"), ix + 24, iy + 64, a * prog(b, AT.judged, AT.judged + 0.08), { px: 28, color: P.ink2 });
    if (b >= AT.judged) {
      const [fx, fy] = pr(JEV.x + JEV.w / 2, JEV.y + JEV.d / 2, JEV.h + 30);
      glow(e, fx, fy, 90, 0.5 * impact(b, AT.judged, 0.2));
    }
    [["ch01.pass", AT.cleared], ["ch01.lock", AT.lock], ["ch01.owner", AT.owner]].forEach(([k, t], i) => {
      const [ex, ey] = pr(EXITS[i][0] + 64, EXITS[i][1] + 22, 40);
      const ka = a * prog(b, t, t + 0.06);
      lead(x, [[ex, ey], [ex + 60, ey]], ka, i === 0 ? SIG() : P.ink2);
      tag(x, tr(k), ex + 78, ey + 11, ka, { px: 30, color: i === 0 ? SIG() : P.ink });
      if (i === 0 && b >= t) glow(e, ex - 40, ey, 80, 0.5 * impact(b, t, 0.2));
    });
  }

  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const ICON_KEY = hex64(101), KEY_SHORT = `${ICON_KEY.slice(0, 8)}…${ICON_KEY.slice(-4)}.png`;
  function imgLabels(x, e, b) {
    const st = STOP.IMG, a = live(st, b);
    if (a <= 0) return;
    const { VAULT, NAS } = L();
    const [ix, iy] = pr(...NS.iconAt(b));
    tag(x, tr("ch01.icon"), ix + 56, iy + 10, a * win(b, AT.icon, AT.icon + 0.08, AT.hash - 0.04, AT.hash + 0.02), { px: 30, color: P.ink2 });
    const ha = a * prog(b, AT.hash, AT.hash + 0.06);
    const [hx, hy] = pr(1120, 1150, 260);
    if (ha > 0) {
      tag(x, tr("ch01.byContent"), hx - 230, hy - 72, ha, { px: 30, color: P.ink2 });
      tag(x, KEY_SHORT, hx - 230, hy - 8, ha, { px: 28, font: MONO, color: SIG() });
    }
    const [vx, vy] = pr(VAULT.x + VAULT.w / 2, VAULT.y + VAULT.d / 2, VAULT.h + 12);
    tag(x, "R2", vx, vy - 26, a, { px: 36, font: MONO, align: "center", w: 600 });
    tag(x, tr("ch01.sameKey"), vx + 120, vy - 120, a * prog(b, AT.shut, AT.shut + 0.08), { px: 30 });
    const oa = a * prog(b, AT.shut + 0.1, AT.shut + 0.2);
    if (oa > 0) {
      const X0 = 1250, Y0 = 800;
      plate(x, X0, Y0, 620, 132, oa);
      text(x, tr("ch01.onlyKey"), X0 + 28, Y0 + 50, { font: SANS(30), color: P.ink, alpha: oa });
      text(x, `"iconObjectKey": "${ICON_KEY.slice(0, 6)}…png"`, X0 + 28, Y0 + 100, { font: MONO(28), color: SIG(), alpha: oa });
    }
    const [nx, ny] = pr(NAS.x + NAS.w, NAS.y + NAS.d / 2, NAS.h + 40);
    tag(x, tr("ch01.nas"), nx - 120, ny - 150, a * prog(b, AT.poster - 0.2, AT.poster - 0.1), { px: 30, color: P.ink2 });
    const num = (n, str, px, py, t) => {
      const na = a * prog(b, t, t + 0.06);
      if (na <= 0) return;
      dot(x, px, py - 11, 20, SIG(), na);
      text(x, String(n), px, py, { font: SANS(28, 600), color: P.plate, align: "center", alpha: na });
      tag(x, tr(str), px + 36, py, na, { px: 30 });
    };
    num(1, "ch01.poster", nx - 100, ny - 84, AT.poster);
    num(2, "ch01.watching", nx - 100, ny - 20, AT.emby);
  }

  const OUT_ICONS = ["rings", "workouts", "steps"];
  function iconGlyph(x, kind, cx, cy, a) {
    x.globalAlpha = a; x.strokeStyle = SIG(); x.fillStyle = SIG(); x.lineWidth = 4; x.lineCap = "round";
    if (kind === "rings") for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(cx, cy, 16 - i * 5.5, -Math.PI / 2, -Math.PI / 2 + TAU * (0.85 - i * 0.18)); x.stroke(); }
    else if (kind === "workouts") { x.beginPath(); x.arc(cx, cy + 2, 14, 0, TAU); x.stroke(); x.beginPath(); x.moveTo(cx, cy + 2); x.lineTo(cx, cy - 7); x.moveTo(cx - 5, cy - 16); x.lineTo(cx + 5, cy - 16); x.stroke(); }
    else for (let i = 0; i < 5; i++) { const h = [10, 18, 14, 24, 16][i]; x.fillRect(cx - 17 + i * 7.4, cy + 14 - h, 4.6, h); }
    x.globalAlpha = 1;
  }
  function phoneLabels(x, e, b) {
    const st = STOP.PHONE, a = live(st, b);
    if (a <= 0) return;
    const { PHN } = L();
    const wk = prog(b, AT.wake, AT.wake + 0.5);
    if (wk > 0 && wk < 1) ring(x, PHN.x + PHN.w / 2, PHN.y + PHN.d / 2, 2, 110 + 240 * wk, SIG(), 3, a * (1 - wk));
    const [px, py] = pr(PHN.x + PHN.w, PHN.y, PHN.z + PHN.h);
    tag(x, tr("ch01.f2"), px - 520, py - 70, a * prog(b, AT.wake - 0.1, AT.wake), { px: 30 });
    const [ox, oy] = pr(PHN.x + PHN.w, PHN.y + PHN.d, PHN.z + 230);
    OUT_ICONS.forEach((kind, i) => {
      const t = AT.outs[i], k = prog(b, t, t + 0.12, E.out), ka = a * k * (1 - prog(b, AT.send, AT.send + 0.12));
      if (ka <= 0) return;
      const tx = ox + lerp(30, 150, k), ty = oy + i * 92 - 40;
      plate(x, tx - 16, ty - 42, 64, 64, ka);
      iconGlyph(x, kind, tx + 16, ty - 10, ka);
      tag(x, tr("ch01." + kind), tx + 72, ty, ka, { px: 30 });
    });
  }

  // 三样凭据分开画，不能混：Home Assistant 的钥匙只开 /homepod，容器自己的钥匙只开 /playstation；PSN 登录态不是钥匙，留在 n100 上，只拿来问 Sony。
  // PS5 和 Home Assistant 之间没有线：站点不显示 PS 电源（FACTS §1）
  function keyGlyph(x, cx, cy, color, a, ang = 0) {
    x.save(); x.translate(cx, cy); x.rotate(ang); x.globalAlpha = a; x.strokeStyle = P.ink; x.fillStyle = color; x.lineWidth = 2.6;
    x.beginPath(); x.arc(-16, 0, 11, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.rect(-6, -3.5, 34, 7); x.fill(); x.stroke();
    x.beginPath(); x.rect(18, 3, 5, 8); x.rect(10, 3, 5, 6); x.fill(); x.stroke();
    x.fillStyle = P.plate; x.beginPath(); x.arc(-16, 0, 4, 0, TAU); x.fill(); x.restore();
  }
  function homeLabels(x, e, b) {
    const st = STOP.HOME, a = live(st, b);
    if (a <= 0) return;
    const { HA3, CT3, POD3 } = L();
    const rows = [
      { from: HA3, name: "Home Assistant", ep: "/api/ingest/homepod", what: "ch01.hpWhat", t: AT.haKey, col: P.butter },
      { from: CT3, name: "playstation-reporter", ep: "/api/ingest/playstation", what: "ch01.psWhat", t: AT.psKey, col: SIG() },
    ];
    const na = a * prog(b, AT.homepod, AT.homepod + 0.1);
    for (let i = 0; i < 3; i++) {
      const k = ((b - AT.homepod) * 1.1 + i / 3) % 1, [nx, ny] = pr(POD3[0], POD3[1], POD3[2] + 8 + k * 120);
      if (b >= AT.homepod) text(x, "♪", nx + (i - 1) * 26, ny, { font: SANS(30), color: P.ink2, alpha: na * Math.sin(k * Math.PI), texture: true });
    }
    const [hx, hy] = pr(...POD3);
    tag(x, "HomePod", hx - 60, hy + 70, a, { px: 28, font: MONO, align: "right" });
    // 钥匙从各自的设备飞进各自那一行第二行右端的槽。先出的 Home Assistant 在下、后出的 playstation 摞在上面（和东京那几个容器一样往上摞）：
    // 下面那块只到第一行字那么宽，停在墙上 Home Assistant 小盒的左边；上面那块的引线从 n100 绕过小盒的右上方进牌子，两根引线不交叉
    rows.forEach((r, i) => {
      const ka = a * prog(b, r.t[0], r.t[0] + 0.08);
      if (ka <= 0) return;
      const lx = 110, ly = 272 - i * 132;
      const w = Math.max(measure(x, `${r.name} → ${r.ep}`, MONO(28)), measure(x, tr(r.what), SANS(30)) + 120) + 40;
      const [ax, ay] = pr(...r.from), slot = [lx + w - 76, ly + 8];
      lead(x, [[ax, ay], [lx + w - 40, ly - 14]], ka, tone(r.col, 0.3));
      plate(x, lx - 20, ly - 72, w, 112, ka);
      text(x, `${r.name} → ${r.ep}`, lx, ly - 28, { font: MONO(28), color: P.ink, alpha: ka });
      text(x, tr(r.what), lx, ly + 18, { font: SANS(30), color: P.ink2, alpha: ka });
      const k = prog(b, r.t[0], r.t[1], E.io);
      keyGlyph(x, lerp(ax, slot[0], k), lerp(ay, slot[1], k) - Math.sin(k * Math.PI) * 80, r.col, ka, -0.3 * k);
      if (b >= r.t[1]) glow(e, slot[0], slot[1], 70, 0.45 * impact(b, r.t[1], 0.2));
    });
    const [cx, cy] = pr(...CT3);
    tag(x, "n100", cx + 60, cy + 74, a, { px: 28, font: MONO });
    const pa = a * prog(b, AT.psn[0] - 0.1, AT.psn[0]);
    const [sx, sy] = pr(CT3[0], CT3[1], 330);
    dash(x, [[cx, cy - 20], [sx, sy + 18]], P.ink2, 2.4, pa * 0.7, [6, 8]);
    tag(x, "PSN · Sony", sx, sy, pa, { px: 28, font: MONO, align: "center" });
    const pk = prog(b, AT.psn[0], AT.psn[1]);
    if (pk > 0 && pk < 1) { const u = pk < 0.5 ? pk * 2 : 2 - pk * 2; dot(x, lerp(cx, sx, u), lerp(cy - 20, sy + 18, u), 7, P.ink, a); }
    tag(x, tr("ch01.psnLogin"), sx, sy - 64, pa, { px: 28, color: P.ink2, align: "center" });
  }

  const CONTS = [[P.coral, "server-reporter", "/api/ingest/server", "ch01.srv"], [P.butter, "agents-reporter", "/api/ingest/agents", "ch01.agents"], [P.sky, "discord-reporter", "/api/ingest/quest", "ch01.quest"]];
  function tokyoLabels(x, e, b) {
    const st = STOP.TOKYO, a = live(st, b);
    if (a <= 0) return;
    const { TOKYO } = L();
    const [tx, ty] = pr(2250, -440, TOKYO.z + 220);
    tag(x, tr("ch01.tokyo"), tx - 40, ty - 50, a, { px: 30 });
    text(x, "misaka-jp", tx - 40, ty + 14, { font: MONO(28), color: P.ink2, alpha: a });
    CONTS.forEach(([col, name, ep, key], i) => {
      const t = AT.boxes[i], ka = a * prog(b, t, t + 0.08);
      if (ka <= 0) return;
      const [ax, ay] = pr(2150, -324, TOKYO.z + 12 + i * 58 + 30);
      const lx = 110, ly = 520 - i * 150;
      lead(x, [[ax, ay], [lx + 760, ay], [lx + 760, ly - 14]], ka, tone(col, 0.3));
      plate(x, lx - 20, ly - 72, 760, 112, ka);
      text(x, `${name} → ${ep}`, lx, ly - 28, { font: MONO(28), color: P.ink, alpha: ka });
      text(x, tr(key), lx, ly + 18, { font: SANS(30), color: P.ink2, alpha: ka });
      keyGlyph(x, lx + 700, ly - 36, col, ka, -0.3);
      if (b >= t) { const [gx, gy] = pr(2255, -362, TOKYO.z + 40 + i * 58); glow(e, gx, gy, 110, 0.4 * impact(b, t, 0.25)); }
    });
  }

  function codeLabels(x, e, b) {
    const st = STOP.CODE, a = live(st, b);
    if (a <= 0) return;
    const { RAIL, HUB } = L();
    // 三条来源线各从自己的牌子出发（Mac 牌子的右沿、Claude Code 那摞牌子的下沿、Cursor 牌子的左沿），汇到中间的塔顶；牌子的竖直中线在基线上方 9 px
    const m0 = pr(RAIL[0][0] + 160, RAIL[0][1] - 160, 54), mx = m0[0] - 60, my = m0[1] - 54, f = SANS(30, 600);
    const cur = 1880 - measure(x, tr("ch01.srcCursor"), f);
    const f0 = [[mx + measure(x, tr("ch01.srcMac"), f) + 15, my - 9], pr(HUB[0] - 30, HUB[1] + 30, 60)];
    const f1 = [[1214, 264], pr(HUB[0], HUB[1], 120)];
    const f2 = [[cur - 15, 715], pr(HUB[0] + 30, HUB[1] - 30, 100)];
    [f0, f1, f2].forEach((pts) => dash(x, pts, P.ink2, 2.6, a * 0.6, [10, 9], -b * 40));
    tag(x, tr("ch01.cc"), 1190, 120, a, { px: 30 });
    tag(x, "OTLP → /api/ingest/agents/otlp", 1190, 184, a, { px: 28, font: MONO, color: P.ink2 });
    tag(x, tr("ch01.extra"), 1190, 246, a, { px: 28, color: P.ink2 });
    tag(x, tr("ch01.srcMac"), mx, my, a, { px: 30 });
    tag(x, tr("ch01.srcCursor"), 1880, 724, a, { px: 30, align: "right" });
    [f0, f1, f2].forEach((pts, i) => {
      const k = prog(b, AT.raw[i], AT.merge, E.io);
      if (k <= 0 || k >= 1) return;
      const Ln = pts.slice(1).reduce((u, p, j) => u + Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]), 0);
      const [px, py] = pathAt(pts, k * Ln);
      plate(x, px - 22, py - 16, 44, 32, a, { line: SIG(), lw: 2.4 });
      x.fillStyle = P.ink2; x.globalAlpha = a;
      for (let j = 0; j < 3; j++) x.fillRect(px - 12, py - 8 + j * 7, 24 - j * 6, 2.6);
      x.globalAlpha = 1;
    });
    const [hx, hy] = pr(HUB[0], HUB[1], 120);
    if (b >= AT.merge) glow(e, hx, hy, 120, 0.6 * impact(b, AT.merge, 0.3));
    tag(x, tr("ch01.merge"), hx - 70, hy + 10, a * prog(b, AT.merge, AT.merge + 0.06), { px: 30, color: SIG(), align: "right" });
    const pa = a * prog(b, AT.pulse, AT.pulse + 0.1, E.out);
    if (pa > 0) {
      const X0 = 1220, Y0 = 320, W = 640;
      plate(x, X0, Y0, W, 200, pa);
      text(x, tr("ch01.cu"), X0 + 28, Y0 + 48, { font: SANS(32), color: P.ink, alpha: pa });
      text(x, "Pulse · Last 24 hours", X0 + W - 28, Y0 + 46, { font: MONO(28), color: P.ink2, align: "right", alpha: pa });
      [["Coding", 0], ["Tokens", 1]].forEach(([name, hot], i) => {
        const y = Y0 + 104 + i * 60, lx = X0 + 170, lw = W - 200;
        text(x, name, X0 + 28, y + 10, { font: SANS(28, 500), color: hot ? SIG() : P.ink, alpha: pa });
        x.globalAlpha = pa * 0.5; x.fillStyle = P.steel; x.fillRect(lx, y - 12, lw, 24); x.globalAlpha = pa;
        if (hot) {
          x.fillStyle = rgba(SIG(), 0.3); x.beginPath(); x.moveTo(lx, y + 12);
          for (let j = 0; j <= 48; j++) x.lineTo(lx + (lw * j) / 48, y + 12 - (0.25 + 0.75 * hash(j * 3.1)) * 22 * prog(b, AT.pulse + j * 0.004, AT.pulse + 0.1 + j * 0.004));
          x.lineTo(lx + lw, y + 12); x.fill();
        } else {
          x.fillStyle = tone(P.lilac, 0.2);
          for (let j = 0; j < 5; j++) { const u = hash(i * 31 + j * 7), w = 0.03 + 0.08 * hash(i * 11 + j); x.fillRect(lx + lw * u * 0.9, y - 12, lw * w, 24); }
        }
        x.globalAlpha = 1;
      });
      tag(x, tr("ch01.tokRate"), X0 + 28, Y0 + 264, pa, { px: 28, color: SIG() });
      tag(x, tr("ch01.sum"), X0 + 28, Y0 + 326, pa, { px: 28 });
    }
  }

  // 云端岛上的天线一直在发信号
  function antenna(x, b) {
    if (b < STOP.TOKYO.t1 || b > STOP.CODE.t1) return;
    const k = (b * 2) % 1, z = L().CLOUD.z;
    ring(x, 1003, 113, z + 116, 14 + 40 * k, SIG(), 2, (1 - k) * 0.6 * live(STOP.CODE, b));
  }

  const NAR = [
    ["n1", 0.6, 2.15], ["n2", 2.8, 4.9], ["n3", 5.55, 7.65], ["n4", 8.3, 10.4], ["n5", 11.05, 12.9], ["n6", 13.55, 15.4],
    ["n7", 16.05, 17.9], ["n8", 18.55, 20.65], ["n9", 21.3, 23.65], ["n10", 24.05, 25.97], ["n11", 26.05, 27.62],
  ];
  NS.narrations = (x, b) => NAR.forEach(([k, t0, t1]) => nar(x, `ch01.${k}a`, `ch01.${k}b`, t0, t1, b));
  NS.ui = { pr, L, SIG, tag, lead, dash, dot, ring, squash, withSquash };
  NS.labels = (x, e, b) => {
    openLabels(x, b);
    macLabels(x, e, b);
    gateLabels(x, e, b);
    imgLabels(x, e, b);
    phoneLabels(x, e, b);
    homeLabels(x, e, b);
    tokyoLabels(x, e, b);
    antenna(x, b);
    codeLabels(x, e, b);
    NS.clockLabels(x, e, b);
    NS.inferStation(x, e, b);
    NS.narrations(x, b);
  };
})();
