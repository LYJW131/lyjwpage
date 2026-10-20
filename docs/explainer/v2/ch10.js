// 第 10 章「一首歌的旅程」：终章。接住第 09 章那根墨线，十种画风的字块拼出标题；信封驮着 Clawd 一站一站走，
// 每站换成讲过这一站的那一章的画风（画法在 ch10-relay.js、ch10-relay2.js）；翻面那一拍炸成十格分屏（ch10-split.js），
// 收拢后十只 Clawd 谢幕（ch10-bow.js），最后落回第 00 章第一帧。
(() => {
  const { E, prog, clamp, lerp, hash } = K;
  const F10 = window.FIN10, { PAL, CLAWD, chip, rgba } = F10;
  I18N.add({
    "ch10.t0": ["10", "10"], "ch10.t1": ["终", "F"], "ch10.t2": ["章", "I"], "ch10.t3": ["一", "N"], "ch10.t4": ["首", "A"],
    "ch10.t5": ["歌", "L"], "ch10.t6": ["的", "E"], "ch10.t7": ["旅", "ONE"], "ch10.t8": ["程", "SONG'S"], "ch10.t9": ["！", "JOURNEY"],
    "ch10.sub": ["mac · appleMusic → Now Playing", "mac · appleMusic → Now Playing"],
    "ch10.n1": ["Mac 只寄出变了的 appleMusic。", "The Mac mails only appleMusic."],
    "ch10.n2": ["入口验过 JWT，分进实时那根管。", "The JWT checks out: off to realtime."],
    "ch10.n3": ["StateHub 串行落账，交回效果单。", "StateHub commits, returns effects."],
    "ch10.n4": ["换歌不重印首屏，交给推送。", "A song change: no reprint, push it."],
    "ch10.n5": ["推送沿 /ws 到站，写进 SWR。", "The push rides /ws into SWR."],
    "ch10.n6": ["卡片当场翻面。", "And the card flips, right there."],
    "ch10.s1.note": ["没变的模块不寄", "Unchanged modules stay home"],
    "ch10.s2.rt": ["实时", "Realtime"], "ch10.s2.lag": ["可滞后", "Lag-tolerant"], "ch10.s2.d1": ["归档", "Archive"], "ch10.s2.cred": ["凭据", "Credentials"],
    "ch10.s2.pass": ["放行", "PASS"],
    "ch10.s3.ledger": ["StateHub 账本", "StateHub ledger"],
    "ch10.s3.slip": ["要做的事 · IngestEffect", "To do · IngestEffect"],
    "ch10.s3.effect": ["listening → 广播 listening-now", "listening → push listening-now"],
    "ch10.s4.mast": ["首屏日报", "The First Screen"], "ch10.s4.ed": ["实时版", "Live edition"],
    "ch10.s4.cap": ["图：本报记者 Clawd", "Photo: our reporter, Clawd"],
    "ch10.s4.note": ["换歌：标签不失效", "New song: the tag stays put"],
  });
  const tr = (k) => I18N.tr(k);
  const BAR = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BAR) / hl) * Math.LN2));
  const ch = (id) => ((window.CHAPTERS || []).find((c) => c.id === id) || {}).share;

  // 拍位（小节）：music/ch10.js 抄的是同一张表，两边一起改。
  const AT = {
    chip0: 0.125, chipStep: 0.0625, sub: 0.75, env: [1.0, 1.4], pull: [1.5, 1.875], whip1: [1.875, 2.125],
    st: [2, 5, 7.5, 9.5, 11.125, 12.75],
    whip2: [4.75, 5.125], dive: [7.125, 7.5], iris: [7.5, 7.75], spin: [9.25, 9.625], cut: [11.0, 11.375], ink: [12.5, 12.875],
    flip: 14.0, open: [14.0, 14.42], tutti: 15.0, close: [16.5, 17.0], drop: 17.0,
  };
  const SLOW = 0.08; // 分屏中间那格把第 00 章翻面之后慢放；5.25 起那一章出大字，17.0 时须停在它之前。
  const b00 = (b) => 5 + (b - AT.flip);
  const POST0 = { bloom: 0, threshold: 1.2, halation: 0, grain: 0, vignette: 0, ca: 0 };

  let L, LT;
  const off = { c: null, x: null };
  // 缩小、旋转的那几帧整页先画在一张全尺寸的画布上再贴：字号检查按画的那一刻量，转着飞进来的报纸不算要读的字。
  function offscreen() {
    if (!off.c) { off.c = document.createElement("canvas"); off.x = off.c.getContext("2d"); }
    if (off.c.width !== G.PW || off.c.height !== G.PH) { off.c.width = G.PW; off.c.height = G.PH; }
    off.x.setTransform(1, 0, 0, 1, 0, 0); off.x.clearRect(0, 0, G.PW, G.PH); off.x.setTransform(G.S, 0, 0, G.S, 0, 0);
    off.x.globalAlpha = 1; off.x.globalCompositeOperation = "source-over";
    return off.x;
  }
  const station = (i, x, b, o) => F10.STATIONS[i](x, b - AT.st[i], o);
  const clipPoly = (x, pts) => { x.beginPath(); pts.forEach(([a, c], i) => (i ? x.lineTo(a, c) : x.moveTo(a, c))); x.closePath(); x.clip(); };

  // ---------- 开场：接住第 09 章的墨线 ----------
  const OPEN = { bg: "#F5F3EE", ink: "#121212", home: 760 };
  function titleChips(x, b, shake) {
    const rows = I18N.lang === "en" ? [[0, 7, 150, 162], [7, 10, 110, 342]] : [[0, 3, 150, 162], [3, 10, 110, 342]];
    for (const [i0, i1, px, cy] of rows) {
      const ws = [];
      for (let i = i0; i < i1; i++) ws.push(chip(x, i, tr(`ch10.t${i}`), 0, 0, px, { measure: true }));
      const gap = 16, total = ws.reduce((s, w) => s + w, 0) + gap * (ws.length - 1);
      let cx = 960 - total / 2;
      ws.forEach((w, j) => {
        const i = i0 + j, t0 = AT.chip0 + i * AT.chipStep, k = prog(b, t0, t0 + 0.22);
        if (k <= 0) { cx += w + gap; return; }
        const y = lerp(cy - 760, cy, E.outBack(k)), rot = lerp((hash(i + 3) - 0.5) * 0.9, (hash(i + 7) - 0.5) * 0.06, E.out(k));
        const sx = shake * Math.sin(G.frame * 1.9 + i * 2.1) * 3, sy = shake * Math.cos(G.frame * 2.3 + i) * 2;
        chip(x, i, tr(`ch10.t${i}`), cx + w / 2 + sx, y + sy, px, { rot, alpha: clamp(k * 3) });
        cx += w + gap;
      });
    }
  }
  function openFrame(x, b) {
    x.fillStyle = OPEN.bg; x.fillRect(-2400, -600, 6720, 2280);
    const pull = E.out(prog(b, AT.pull[0], AT.pull[1])), rel = b - AT.pull[1];
    let vx = OPEN.home, vy = 540;
    if (b >= AT.pull[0] && rel < 0) { vx -= 230 * pull; vy += 120 * pull; }
    if (rel >= 0) { vx = OPEN.home - 230; vy = 540 + 120 * Math.cos(rel * BAR * 26) * Math.exp(-rel * BAR * 9); }
    if (b < AT.pull[0]) { x.fillStyle = OPEN.ink; x.fillRect(-2400, 538.5, 6720, 3); }
    else { x.strokeStyle = OPEN.ink; x.lineWidth = 3; x.lineJoin = "round"; x.beginPath(); x.moveTo(-2400, 540); x.lineTo(vx, vy); x.lineTo(4320, 540); x.stroke(); }
    titleChips(x, b, pull * (rel < 0 ? 1 : 0));
    K.text(x, tr("ch10.sub"), 960, 736, { font: K.FONT.mono(34, 500), color: "#5A5A5A", align: "center", alpha: prog(b, AT.sub, AT.sub + 0.2) });
    // 信封骑在线上进来；蓄力时被往后拉成 V，放开就射出去。
    const ek = prog(b, AT.env[0], AT.env[1], E.out);
    if (ek <= 0) return;
    let ex = lerp(-220, OPEN.home, ek), ey = 540, rot = 0;
    if (b >= AT.pull[0]) { ex = vx; ey = vy; rot = Math.atan2(540 - vy, 1920 - vx) * 0.5; }
    const fly = prog(b, AT.pull[1], AT.pull[1] + 0.2, E.in);
    if (fly > 0) { ex = lerp(OPEN.home - 230, 2700, fly); ey = lerp(540 + 120, 470, fly); rot = -0.06; }
    x.save(); x.translate(ex, ey - 37); x.rotate(rot); x.scale(1 + 0.25 * fly, 1 - 0.12 * fly);
    const h = F10.envelope(x, 110, "#FFFFFF", OPEN.ink, 4);
    K.clawd(x, 0, -h / 2 + 2, 4.5, { pose: fly > 0 ? "arms-up" : pull > 0.3 ? "default" : b < AT.env[1] ? "look-right" : "default", crouch: pull > 0.3 && fly <= 0 ? 1 : 0, body: "#D77757" });
    x.restore();
  }

  // ---------- 画风接力：开场与六站之间的转场 ----------
  const ORANGE = "rgb(236,128,72)";
  function whipBand(x, sx) {
    const s2 = ch("ch02");
    if (s2 && s2.whipBand) { s2.whipBand(x, sx); return; }
    F10.poly(x, [[sx, 1180], [sx + 420, -100], [sx + 1420, -100], [sx + 1000, 1180]], rgba(PAL.cRed));
  }
  // 两次甩镜头时画面整体往左平移的量（逻辑像素），relay 照它摆，运动模糊照它算。
  function pan(b) {
    if (b >= AT.whip1[0] && b < AT.whip1[1]) return 1920 * E.ioExpo(prog(b, AT.whip1[0], AT.whip1[1]));
    if (b >= AT.whip2[0] && b < AT.whip2[1]) return 3640 * E.ioExpo(prog(b, AT.whip2[0], AT.whip2[1]));
    return;
  }
  function relay(x, b) {
    const [w0, w1] = AT.whip1, [v0, v1] = AT.whip2;
    if (b < w0) { openFrame(x, b); return; }
    if (b < w1) {
      const p = pan(b);
      x.save(); x.translate(-p, 0); openFrame(x, b); x.restore();
      x.save(); x.translate(1920 - p, 0); station(0, x, b); x.restore();
      return;
    }
    if (b < v0) { station(0, x, b); return; }
    if (b < v1) {
      const p = pan(b), sx = 2020 - p;
      x.fillStyle = rgba(PAL.cPaper); x.fillRect(0, 0, 1920, 1080);
      x.save(); clipPoly(x, [[-100, -100], [sx + 420, -100], [sx, 1180], [-100, 1180]]); x.translate(-p, 0); station(0, x, b); x.restore();
      whipBand(x, sx);
      x.save(); clipPoly(x, [[sx + 1600, -100], [2100, -100], [2100, 1180], [sx + 1180, 1180]]); x.translate(3640 - p, 0); station(1, x, b); x.restore();
      return;
    }
    if (b < AT.dive[0]) { station(1, x, b); return; }
    if (b < AT.iris[0]) {
      const k = prog(b, AT.dive[0], AT.dive[1]), z = lerp(1, 36, E.inExpo(k)), c = F10.along(F10.LAMP, [960, 540], E.io(k));
      x.save(); x.translate(...c); x.scale(z, z); x.translate(-F10.LAMP[0], -F10.LAMP[1]); station(1, x, b, { hud: false }); x.restore();
      // 推近时场景从旁白和验票单底下划过（旁白没有底卡，验票单会挡住门楣上的字）：一推就先淡掉，不被推出画。
      F10.s2hud(x, b - AT.st[1], { nar: 1 - prog(k, 0.04, 0.25), card: 1 - prog(k, 0.04, 0.25) });
      x.fillStyle = ORANGE; x.globalAlpha = prog(k, 0.55, 0.95); x.fillRect(0, 0, 1920, 1080); x.globalAlpha = 1;
      return;
    }
    if (b < AT.iris[1]) {
      const r = lerp(0, 1160, E.out(prog(b, AT.iris[0], AT.iris[1])));
      x.fillStyle = ORANGE; x.fillRect(0, 0, 1920, 1080);
      x.save(); x.beginPath(); x.arc(960, 540, r, 0, Math.PI * 2); x.clip(); station(2, x, b); x.restore();
      x.strokeStyle = rgba(PAL.tInk); x.lineWidth = 26; x.beginPath(); x.arc(960, 540, r + 13, 0, Math.PI * 2); x.stroke();
      return;
    }
    if (b < AT.spin[0]) { station(2, x, b); return; }
    if (b < AT.spin[1]) {
      station(2, x, b);
      const k = prog(b, AT.spin[0], AT.spin[1] - 0.075), k2 = prog(b, AT.spin[1] - 0.075, AT.spin[1]);
      const s = k2 > 0 ? lerp(0.62, 1, E.io(k2)) : lerp(0.04, 0.62, E.out(k)), rot = (1 - E.out(k)) * 3 * Math.PI * 2;
      const o = offscreen(); station(3, o, b);
      x.save(); x.translate(960, 540); x.rotate(rot); x.scale(s, s);
      x.fillStyle = "rgba(24,21,18,0.35)"; x.fillRect(-960 + 18, -540 + 24, 1920, 1080);
      x.drawImage(off.c, -960, -540, 1920, 1080); x.restore();
      return;
    }
    if (b < AT.cut[0]) { station(3, x, b); return; }
    if (b < AT.cut[1]) {
      station(3, x, b);
      const e = lerp(2140, -420, E.io(prog(b, AT.cut[0], AT.cut[1])));
      const edge = (dx, seed) => { const pts = []; for (let y = -60; y <= 1140; y += 60) pts.push([e + dx + (y - 540) * 0.12 + (hash(seed + y) - 0.5) * 22, y]); return pts; };
      const strip = (dx0, dx1, seed, col) => { x.fillStyle = col; x.beginPath(); const a = edge(dx0, seed), c = edge(dx1, seed + 50).reverse(); [...a, ...c].forEach(([p, q], i) => (i ? x.lineTo(p, q) : x.moveTo(p, q))); x.closePath(); x.fill(); };
      strip(0, 110, 3, rgba(PAL.sRed)); strip(90, 200, 9, rgba(PAL.sMustard)); strip(180, 3000, 17, rgba(PAL.sShade, 0.4));
      x.save(); const a = edge(200, 23); clipPoly(x, [...a, [3200, 1140], [3200, -60]]); station(4, x, b); x.restore();
      return;
    }
    station(4, x, b);
    return;
  }
  // 第 05 站的剪纸从四边往里被晒图的蓝墨吃掉：先洇一圈蓝边，再把里面挖空，露出底下第 00 章的主页图纸。
  function inkEat(x, b) {
    const k = prog(b, AT.ink[0], AT.ink[1]);
    if (k <= 0) return;
    const blobs = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) {
      const cx = -60 + i * 255 + (hash(i * 7 + j) - 0.5) * 120, cy = -40 + j * 230 + (hash(i + j * 13) - 0.5) * 110;
      const d = Math.min(cx, 1920 - cx, cy, 1080 - cy) / 540;
      blobs.push([cx, cy, clamp(k * 1.7 - d * 0.9) * (220 + 120 * hash(i * 3 + j * 5))]);
    }
    x.fillStyle = rgba(PAL.bpDeep, 0.9);
    for (const [cx, cy, r] of blobs) if (r > 0) { x.beginPath(); x.arc(cx, cy, r * 1.12 + 10, 0, Math.PI * 2); x.fill(); }
    x.globalCompositeOperation = "destination-out";
    for (const [cx, cy, r] of blobs) if (r > 0) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
    x.globalCompositeOperation = "source-over";
  }

  // ---------- 00 蓝图主页：借第 00 章的 paperFrame，旁白垫一块蓝底注释框 ----------
  const F00 = (px) => `500 ${px}px "Barlow Semi Condensed ch00", "Noto Sans SC ch00", sans-serif`;
  function narExtra(b, a) {
    return (Lr) => {
      if (a <= 0) return;
      const x = Lr.x; x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); x.globalAlpha = a;
      x.fillStyle = rgba(PAL.bpBlue, 0.95); x.fillRect(80, 936, 1100, 108);
      x.strokeStyle = rgba(PAL.bpWhite); x.lineWidth = 2; x.strokeRect(80, 936, 1100, 108);
      x.strokeStyle = rgba(PAL.bpDim); x.lineWidth = 1; x.strokeRect(88, 944, 1084, 92);
      x.restore();
      const d = Lr.d; d.save(); d.setTransform(G.S, 0, 0, G.S, 0, 0);
      K.text(d, tr("ch10.n6"), 112, 1010, { font: F00(60), color: "#FFFFFF", reveal: prog(b, AT.st[5] + 0.125, AT.st[5] + 0.55), dim: 0.16, perChar: true, alpha: a, maxW: 1040, narration: true });
      d.restore();
    };
  }
  // 翻面一过就淡掉：中间那格开始往格子里缩时会从下面裁掉旁白。
  const narA = (b) => prog(b, AT.st[5] + 0.05, AT.st[5] + 0.15) * (1 - prog(b, AT.flip + 0.02, AT.flip + 0.1));

  // ---------- 高潮：十格分屏 ----------
  const STYLE = [["晒图", "Blueprint"], ["等距小岛", "Isometric island"], ["构成主义海报", "Constructivist poster"], ["橡皮管卡通", "Rubber hose"], ["报纸", "Newspaper"],
    ["剪纸片头", "Paper cutout"], ["水墨", "Ink wash"], ["红白机", "8-bit"], ["彩铅", "Colored pencil"], ["地铁线路图", "Metro map"]];
  I18N.add(Object.fromEntries(STYLE.map((s, i) => [`ch10.style.${i}`, s])));
  const ACCENT = ["#1A4474", "#F3A595", "#CA2A22", "#18150F", "#1E1C1A", "#E5A82E", "#B83626", "#0058F8", "#B2A1D8", "#EE352E"];
  function cellK(i, b) {
    if (b < AT.close[0]) return E.outBack(prog(b, AT.open[0] + 0.06 + i * 0.035, AT.open[0] + 0.42 + i * 0.035));
    return 1 - E.in(prog(b, AT.close[0] + (9 - i) * 0.025, AT.close[0] + 0.28 + (9 - i) * 0.025));
  }
  function cellRect(i, k) {
    const [sx, sy, sw, sh] = F10.split.SLOTS[i], s = lerp(0.18, 1, k);
    const cx = lerp(960, sx + sw / 2, k), cy = lerp(540, sy + sh / 2, k);
    return [cx - (sw * s) / 2, cy - (sh * s) / 2, sw * s, sh * s];
  }
  const mix4 = (a, c, k) => a.map((v, i) => lerp(v, c[i], k));
  // 格子比 16:9 窄：整幅画面等比缩进格子上部（不裁，别章的字不被截），下面剩的那条墨底放格号和画风名。
  // 贴图绕自己的中心转，所以中心要跟着格子的转角从格心挪开。
  function cellImg(r, rot) {
    const ih = r[2] * 9 / 16, oy = (ih - r[3]) / 2, c = Math.cos(rot), s = Math.sin(rot);
    const cx = r[0] + r[2] / 2 - oy * s, cy = r[1] + r[3] / 2 + oy * c;
    return [cx - r[2] / 2, cy - ih / 2, r[2], ih];
  }
  function splitFrame(f, b) {
    const Sp = F10.split, S0 = ch("ch00"), secs = (b - AT.flip) * BAR;
    const ks = Sp.CELLS.map((_, i) => cellK(i, b));
    ks.forEach((k, i) => { if (k > 0.01) Sp.updateCell(i, secs, BAR); });
    const m = b < AT.close[0] ? E.io(prog(b, AT.open[0], AT.open[1])) : 1 - E.io(prog(b, AT.close[0] + 0.22, AT.close[1]));
    const a = narA(b);
    if (S0) Sp.updateCenter((fc) => S0.paperFrame(fc, 5 + (b - AT.flip) * SLOW, { hud: false, cameo: true, extra: a > 0 ? narExtra(b, a) : undefined }));
    G.setCam({ x: 960, y: 540, zoom: 1, rot: 0 });
    G.clear([0.006, 0.006, 0.006]);
    const x = L.begin();
    x.fillStyle = "#121212"; x.fillRect(0, 0, 1920, 1080);
    x.save(); x.translate(960, 540); x.rotate(b * 0.35);
    ACCENT.forEach((c, i) => { x.fillStyle = c; x.globalAlpha = 0.55; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 1400, (i / 10) * Math.PI * 2, ((i + 0.5) / 10) * Math.PI * 2); x.closePath(); x.fill(); });
    x.restore();
    ks.forEach((k, i) => { if (k <= 0.01) return; const r = cellRect(i, k); x.save(); x.translate(r[0] + r[2] / 2, r[1] + r[3] / 2); x.rotate((1 - k) * (i % 2 ? 0.4 : -0.4)); x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(-r[2] / 2 + 10, -r[3] / 2 + 12, r[2], r[3]); x.restore(); });
    G.composite(L.upload(), { mode: G.MODE.normal });
    const RT = Sp.rt();
    ks.forEach((k, i) => { if (k > 0.01) { const rot = (1 - k) * (i % 2 ? 0.4 : -0.4); Sp.draw(RT.cells[i], cellImg(cellRect(i, k), rot), [0, 0, 1, 1], rot, clamp(k * 4)); } });
    if (S0) Sp.draw(RT.center, mix4([0, 0, 1920, 1080], Sp.CENTER, m), mix4([0, 0, 1, 1], Sp.CENTER_SRC, m), 0, 1);
    const t = LT.begin();
    ks.forEach((k, i) => {
      const fa = prog(k, 0.88, 1);
      if (fa <= 0) return;
      const r = cellRect(i, k), lab = `${String(i).padStart(2, "0")} ${tr(`ch10.style.${i}`)}`, font = K.FONT.cjk(28, 600);
      t.save(); t.translate(r[0] + r[2] / 2, r[1] + r[3] / 2); t.rotate((1 - k) * (i % 2 ? 0.4 : -0.4)); t.globalAlpha = fa;
      const ih = r[2] * 9 / 16, bh = r[3] - ih;
      t.fillStyle = "#121212"; t.fillRect(-r[2] / 2, r[3] / 2 - bh, r[2], bh);
      t.fillStyle = ACCENT[i]; t.fillRect(-r[2] / 2, r[3] / 2 - bh, 8, bh);
      t.strokeStyle = "#FFFFFF"; t.lineWidth = 3; t.strokeRect(-r[2] / 2, -r[3] / 2, r[2], r[3]);
      K.text(t, lab, -r[2] / 2 + 24, r[3] / 2 - bh / 2 + 10, { font, color: "#FFFFFF", alpha: fa });
      t.restore();
    });
    if (m > 0.98) { const [cx, cy, cw, chh] = Sp.CENTER; t.strokeStyle = "#FFFFFF"; t.lineWidth = 3; t.strokeRect(cx, cy, cw, chh); }
    G.composite(LT.upload(), { mode: G.MODE.normal });
    const hit = impact(b, AT.flip, 0.12), sh = hit * 7;
    f.post = { ...ch("ch00").cut.post, shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh], flash: hit * 0.25, flashCol: [1, 0.92, 0.8], blur: [0, 0], zoomBlur: 0 };
  }

  // ---------- 调度 ----------
  function render(f) {
    const b = f.bar, S0 = ch("ch00");
    if (b >= AT.drop && F10.bow) { F10.bow(f, b, { L, BAR, b00: 5 + (AT.drop - AT.flip) * SLOW }); return; }
    if (b >= AT.flip) { splitFrame(f, b); return; }
    if (b >= AT.ink[0] && S0) {
      S0.paperFrame(f, b00(b), { hud: false, cameo: true, b0: b00(AT.ink[0]), extra: narExtra(b, narA(b)) });
      // 第 00 章推镜头的运动模糊也会糊掉贴在屏幕上的旁白：旁白在场时按它的透明度压掉模糊。
      const keep = 1 - narA(b);
      f.post = { ...f.post, blur: (f.post.blur || [0, 0]).map((v) => v * keep), zoomBlur: (f.post.zoomBlur || 0) * keep };
      if (b < AT.ink[1]) { G.setCam({ x: 960, y: 540, zoom: 1, rot: 0 }); const x = L.begin(); station(4, x, b); inkEat(x, b); G.composite(L.upload(), { mode: G.MODE.normal }); }
      return;
    }
    G.setCam({ x: 960, y: 540, zoom: 1, rot: 0 });
    G.clear([0.913, 0.896, 0.855]);
    const x = L.begin();
    relay(x, b);
    const p = pan(b), p0 = pan(b - 1 / 60 / f.BAR);
    G.composite(L.upload(), { mode: G.MODE.normal });
    const jolt = Math.max(impact(b, AT.whip1[0] + 0.04, 0.1), impact(b, AT.iris[0], 0.1) * 0.6, impact(b, AT.spin[1], 0.1)) * 5;
    f.post = { ...POST0, blur: [-(p - p0), 0], shake: [Math.sin(f.frame * 1.7) * jolt, Math.cos(f.frame * 2.3) * jolt], flash: impact(b, AT.spin[1], 0.08) * 0.08 };
  }

  window.CHAPTERS.push({
    id: "ch10", title: "ch.10", bars: 22,
    async init() {
      L = G.layer("fin"); LT = G.layer("finTop");
      await F10.split.initCells();
      const loads = [];
      for (let i = 0; i < 10; i++) loads.push(document.fonts.load(F10.FACE[i](40), tr(`ch10.t${i}`) + "图纸"));
      for (const f of [F10.NF.s1(40), F10.NF.jp(40), F10.NF.s2(40), F10.NF.s2big(40), F10.NF.s3(40), F10.NF.s4(40), F10.NF.s4(40, 600), F10.NF.s5(40), F10.NF.s5b(40), F10.NF.s5b(40, 800), F00(40)])
        loads.push(document.fonts.load(f, "夜に駆けるアイドル图纸 Ag"));
      await Promise.all(loads);
    },
    render,
  });
})();
