// 终章画风接力的第三到五站：03 橡皮管卡通、04 报纸、05 剪纸。画法的约定同 ch10-relay.js（屏幕坐标、u 可以为负、自己铺满底色）。
(() => {
  const { E, prog, clamp, lerp, hash } = K;
  const F10 = window.FIN10, { PAL, CLAWD, rgba, NF, T, nar, bg, poly, rr, envelope, ride, along, arc, check, MONO, jag } = F10;
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;

  // ---------- 03 橡皮管卡通：StateHub 串行落账，交回效果单 ----------
  const SLIP = { cx: 1390, cy: 300, w: 540, h: 196 };
  const PLANE = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], PLANE2 = [[-0.55, -0.1], [0.62, 0.02], [-0.55, 0.32], [-0.3, 0.06]];
  const env3 = (x, w) => envelope(x, w, rgba(PAL.tCream), rgba(PAL.tInk), 6);
  function s3(x, u, o = {}) {
    const INK = rgba(PAL.tInk), CREAM = rgba(PAL.tCream);
    bg(x, rgba(PAL.tFilm));
    // 放映机的闪烁和暗角只落在底上，字都画在它们之后。
    x.fillStyle = `rgba(24,21,18,${0.05 * hash(Math.floor(u * 2.222 * 12) + 3)})`; x.fillRect(-2400, -600, 6720, 2280);
    const vg = x.createRadialGradient(960, 520, 380, 960, 520, 1150);
    vg.addColorStop(0, "rgba(24,21,18,0)"); vg.addColorStop(1, "rgba(24,21,18,0.5)");
    x.fillStyle = vg; x.fillRect(-2400, -600, 6720, 2280);
    x.fillStyle = rgba(PAL.tMid); x.fillRect(40, 700, 1840, 44); x.strokeStyle = INK; x.lineWidth = 6; x.strokeRect(40, 700, 1840, 44);
    x.fillStyle = rgba(PAL.tDark); x.fillRect(40, 744, 1840, 400);
    // 台灯：橡皮管的胳膊跟着拍子晃，光圈罩着账本。
    const sw = Math.sin(u * Math.PI * 2) * 0.05, head = [470 + sw * 200, 300];
    poly(x, [[head[0] + 20, head[1] + 30], [1190, 690], [600, 700]], "rgba(255,246,220,0.42)");
    x.strokeStyle = INK; x.lineWidth = 16; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(250, 690); x.quadraticCurveTo(250 + sw * 300, 420, head[0], head[1]); x.stroke();
    x.fillStyle = INK; x.beginPath(); x.ellipse(250, 696, 92, 22, 0, 0, TAU); x.fill();
    x.save(); x.translate(...head); x.rotate(0.55 + sw); poly(x, [[-50, -10], [50, -10], [80, 70], [-80, 70]], rgba(PAL.tLight), INK, 7); x.restore();
    // 账本：左页抬头 StateHub，右页落一行账。
    poly(x, [[612, 498], [884, 524], [884, 700], [600, 690]], CREAM, INK, 6);
    poly(x, [[884, 524], [1156, 498], [1168, 690], [884, 700]], CREAM, INK, 6);
    x.strokeStyle = rgba(PAL.tMid); x.lineWidth = 2; x.beginPath();
    for (let i = 0; i < 4; i++) { x.moveTo(640, 580 + i * 26); x.lineTo(860, 588 + i * 26); }
    x.stroke();
    const wk = prog(u, 0.36, 0.56);
    T(x, "mac · appleMusic", 902, 590, NF.s3(28), INK, { reveal: wk, perChar: true, alpha: wk > 0 ? 1 : 0 });
    check(x, 1120, 630, 36, rgba(PAL.cRed), prog(u, 0.56, 0.64), 6);
    // 账本的名牌钉在桌子前沿：信封、Clawd 和效果单都从账本上方进出，挂在上面会被它们压住。
    rr(x, 720, 762, 330, 52, 10, CREAM, INK, 4); T(x, tr("ch10.s3.ledger"), 885, 800, NF.s3(30), INK, { align: "center", maxW: 300 });
    // 信封带着 Clawd 从光圈里冲出来，塞进账本；Clawd 先跳到桌上。
    const ek = prog(u, 0.0, 0.32), desk = [1250, 700];
    if (ek < 1) {
      const p = arc([-120, 220], [884, 600], E.io(ek), 160), s = lerp(1, 0.35, prog(ek, 0.7, 1));
      x.save(); x.translate(...p); x.scale(s, s); x.translate(-p[0], -p[1]);
      ride(x, 3, p[0], p[1], 140, lerp(-0.5, 0.2, ek), u < 0.22 ? 7 : 0, env3);
      x.restore();
    }
    // 效果单：长着眼睛的纸条从账本里蹦出来，1.25 折成纸飞机，Clawd 骑上去飞走。
    const up = prog(u, 0.6, 0.85, E.outBack), fold = prog(u, 1.22, 1.38, E.io), fly = prog(u, 1.48, 1.98, E.in);
    if (up > 0) {
      const c = fly > 0 ? arc([SLIP.cx, SLIP.cy], [2300, -180], fly, 260) : along([884, 600], [SLIP.cx, SLIP.cy], up);
      const wob = Math.sin(u * TAU * 1.5) * 0.04 * (1 - fold) + fly * -0.4;
      const sc = lerp(0.3, 1, clamp(up)) * lerp(1, 0.55, fold);
      x.save(); x.translate(...c); x.rotate(wob); x.scale(sc, sc);
      const pts = PLANE.map((p, i) => [lerp(p[0], PLANE2[i][0], fold) * SLIP.w, lerp(p[1], PLANE2[i][1], fold) * SLIP.h * (fold > 0 ? lerp(1, 1.6, fold) : 1)]);
      poly(x, pts, CREAM, INK, 7);
      const ta = clamp(up * 2) * (1 - prog(u, 1.16, 1.24));
      if (fold < 1) for (const ex of [-90, 90]) {
        const blink = Math.abs(u - 1.0) < 0.03 ? 0.15 : 1, ey = -SLIP.h / 2 - 2;
        x.fillStyle = CREAM; x.beginPath(); x.ellipse(ex, ey - 8, 44, 54 * blink, 0, 0, TAU); x.fill(); x.strokeStyle = INK; x.lineWidth = 7; x.stroke();
        x.fillStyle = INK; x.beginPath(); x.ellipse(ex + 10, ey - 2, 20, 28 * blink, 0, 0, TAU); x.fill();
        x.fillStyle = CREAM; x.beginPath(); x.moveTo(ex + 14, ey - 10); x.arc(ex + 14, ey - 10, 10 * blink, -1.9, -0.9); x.closePath(); x.fill();
      }
      if (ta > 0) {
        T(x, tr("ch10.s3.slip"), -SLIP.w / 2 + 30, -18, NF.s3(32), INK, { alpha: ta, maxW: SLIP.w - 60 });
        T(x, tr("ch10.s3.effect"), -SLIP.w / 2 + 30, 50, NF.s3(30), INK, { alpha: ta, maxW: SLIP.w - 60 });
      }
      if (u >= 1.46) CLAWD[3](x, -20, pts[0][1] + 10, 7 / sc * 0.9, { pose: "arms-up" });
      x.restore();
    }
    if (u >= 0.22 && u < 1.46) {
      const hk = prog(u, 1.3, 1.46), land = prog(u, 0.22, 0.34);
      let p = arc([830, 560], desk, E.out(land), 140);
      if (hk > 0) p = arc(desk, [SLIP.cx - 40, SLIP.cy - 100], E.io(hk), 160);
      CLAWD[3](x, p[0], p[1], 7, { pose: hk > 0 || land < 1 ? "arms-up" : u > 0.6 && u < 1.1 ? "look-right" : "default" });
    }
    // 默片字幕卡：旁白放在纯色卡上，底下干净。
    const ca = o.nar ?? 1;
    x.save(); x.globalAlpha = ca;
    x.fillStyle = rgba(PAL.tCard); x.fillRect(370, 832, 1180, 184);
    x.strokeStyle = CREAM; x.lineWidth = 4; x.strokeRect(386, 848, 1148, 152); x.lineWidth = 1.5; x.strokeRect(396, 858, 1128, 132);
    x.restore();
    nar(x, "ch10.n3", 960, 946, NF.s3(60), CREAM, u, 0.3, { ...o, maxW: 1060, align: "center" });
  }

  // ---------- 04 报纸：换歌不重印，交给推送 ----------
  // 旁白就是头条；网点只铺在照片框里，图注和正文都在框外的白纸上。
  const PHOTO = [1020, 404, 790, 440], PLATE = [110, 420, 560, 230];
  function s4(x, u, o = {}) {
    const INK = rgba(PAL.nInk), PAPER = rgba(PAL.nPaper), GRAY = "rgba(30,28,26,0.28)";
    bg(x, PAPER);
    x.fillStyle = INK; x.fillRect(80, 44, 1760, 5); x.fillRect(80, 54, 1760, 1.5);
    T(x, tr("ch10.s4.mast"), 960, 168, NF.s4(108), INK, { align: "center", maxW: 1500 });
    x.fillRect(80, 194, 1760, 1.5); x.fillRect(80, 200, 1760, 5);
    T(x, "lyjw.me", 84, 244, NF.s4(30, 600), INK);
    T(x, tr("ch10.s4.ed"), 960, 244, NF.s4(30, 600), INK, { align: "center" });
    T(x, "A10", 1836, 244, NF.s4(30, 600), INK, { align: "right" });
    x.fillRect(80, 262, 1760, 1.5);
    nar(x, "ch10.n4", 104, 346, NF.s4(74), INK, u, 0.12, { ...o, maxW: 1720 });
    x.fillRect(80, 378, 1760, 3);
    // 照片：网点底上一只网点 Clawd；它跳出去以后框里只剩网点底。
    const [px, py, pw, ph] = PHOTO;
    x.save(); x.beginPath(); x.rect(px, py, pw, ph); x.clip();
    x.fillStyle = "rgb(214,207,190)"; x.fillRect(px, py, pw, ph);
    x.fillStyle = "rgba(30,28,26,0.32)";
    for (let yy = py + 6; yy < py + ph; yy += 12) for (let xx = px + 6 + ((yy / 12) % 2) * 6; xx < px + pw; xx += 12) {
      const k = 0.35 + 0.65 * ((yy - py) / ph); x.beginPath(); x.arc(xx, yy, 3.6 * k, 0, TAU); x.fill();
    }
    const jump = prog(u, 0.86, 1.06), home = [px + pw / 2, py + ph - 52];
    if (u < 0.86) CLAWD[4](x, home[0], home[1], 16, { pose: u > 0.6 ? "look-right" : "default" });
    x.restore();
    x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(px, py, pw, ph);
    T(x, tr("ch10.s4.cap"), px, py + ph + 44, NF.s4(32, 600), INK);
    // 印版：一块铅版挂着 Cache-Tag，换歌这一下标签不剪。
    const [lx, ly, lw, lh] = PLATE;
    x.fillStyle = "rgb(62,60,56)"; x.fillRect(lx + 8, ly + 10, lw, lh); x.fillStyle = "rgb(92,89,84)"; x.fillRect(lx, ly, lw, lh);
    x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(lx, ly, lw, lh);
    x.fillStyle = "rgb(120,116,108)"; x.fillRect(lx + 24, ly + 24, lw - 48, lh - 48);
    T(x, "NOW PLAYING", lx + 44, ly + 82, NF.s4(34), "rgb(232,226,212)", { tracking: 2 });
    T(x, "アイドル", lx + 44, ly + 160, NF.s4(64), "rgb(244,238,224)");
    const sway = Math.sin(u * TAU) * 0.06, ax = lx + lw - 60, ay = ly + lh;
    x.save(); x.translate(ax, ay); x.rotate(sway);
    x.strokeStyle = INK; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 0); x.lineTo(-60, 56); x.stroke();
    rr(x, -330, 56, 380, 60, 8, "rgb(250,246,236)", INK, 3);
    x.fillStyle = INK; x.beginPath(); x.arc(-310, 86, 6, 0, TAU); x.fill();
    T(x, "page:listening-now", -290, 97, MONO(30), INK);
    x.restore();
    T(x, tr("ch10.s4.note"), lx, 834, NF.s4(42), INK, { alpha: prog(u, 0.4, 0.55), maxW: 860 });
    x.fillStyle = GRAY;
    for (let i = 0; i < 3; i++) x.fillRect(lx, 880 + i * 30, 840 - i * 160, 12);
    // 火花：从印版旁边冲出版面；Clawd 从照片里跳出来骑上去。
    const sk = prog(u, 0.72, 0.84), go = prog(u, 1.06, 1.5, E.in);
    if (sk > 0) {
      const head = go > 0 ? along([880, 540], [2260, 470], go) : arc([lx + lw / 2, ly + lh / 2], [880, 540], E.out(sk), 60);
      x.save(); x.globalAlpha = 0.85;
      const g = x.createRadialGradient(head[0], head[1], 0, head[0], head[1], 70);
      g.addColorStop(0, "rgba(255,240,214,1)"); g.addColorStop(0.25, "rgba(242,150,96,0.9)"); g.addColorStop(1, "rgba(230,110,70,0)");
      x.fillStyle = g; x.beginPath(); x.arc(head[0], head[1], 70, 0, TAU); x.fill(); x.restore();
      if (u >= 1.06) CLAWD[4](x, head[0], head[1] - 18, 9, { pose: "arms-up" });
    }
    if (jump > 0 && u < 1.06) { const p = arc(home, [880, 522], E.io(jump), 80); CLAWD[4](x, p[0], p[1], lerp(16, 9, jump), { pose: "arms-up" }); }
  }

  // ---------- 05 剪纸：推送沿电报线到浏览器，写进 SWR ----------
  const WIRE = [[560, 262], [720, 430], [980, 430], [1180, 470]];
  const SAG = [70, 34, 26];
  function wireAt(k) {
    const n = WIRE.length - 1, i = Math.min(n - 1, Math.floor(k * n)), t = k * n - i;
    const [a, b] = [WIRE[i], WIRE[i + 1]];
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t) + 4 * SAG[i] * t * (1 - t)];
  }
  function s5(x, u, o = {}) {
    const INK = rgba(PAL.sInk), RED = rgba(PAL.sRed), MUS = rgba(PAL.sMustard), CARD = rgba(PAL.sCard), SHADE = rgba(PAL.sShade, 0.3);
    bg(x, rgba(PAL.sGround));
    x.fillStyle = MUS; x.beginPath(); x.arc(1720, 150, 120, 0, TAU); x.fill();
    x.fillStyle = SHADE; x.fill(jag(960, 752, 4400, 76, 7, 5));
    x.fillStyle = RED; x.fill(jag(960, 740, 4400, 70, 5, 5));
    for (const px of [720, 980]) { x.fillStyle = INK; x.fill(jag(px, 580, 22, 320, px, 2)); x.fill(jag(px, 436, 120, 16, px + 1, 2)); }
    // 推送房间：墨色剪纸块，/ws 是它的门。
    x.fillStyle = SHADE; x.fill(jag(318, 188, 540, 228, 21, 4));
    x.fillStyle = INK; x.fill(jag(310, 180, 540, 228, 21, 4));
    T(x, "LivePushRoom", 74, 172, NF.s5b(52, 600), CARD);
    T(x, "/ws", 74, 244, MONO(36), MUS);
    // 电报线：几段垂下来的线，三角脉冲沿线跑。
    x.strokeStyle = INK; x.lineWidth = 4; x.beginPath();
    for (let k = 0; k <= 1.0001; k += 0.01) { const p = wireAt(k); k ? x.lineTo(...p) : x.moveTo(...p); }
    x.stroke();
    // 脉冲骑手：戴耳机的剪纸 Clawd 站在红三角上；到站（线头就在窗口左沿）往窗口后面一跳，再从柜顶探头。
    // 跳的那一段画在窗口底下：画在上面会压住「SWR」和地址栏。
    const run = prog(u, 0.18, 0.76, E.io), drop = prog(u, 0.76, 0.9);
    const rider = () => {
      let p = wireAt(run), rot = 0;
      if (drop > 0) p = arc(wireAt(1), [1520, 500], E.in(drop), 60);
      else { const q = wireAt(Math.min(1, run + 0.01)); rot = Math.atan2(q[1] - p[1], q[0] - p[0]); }
      x.save(); x.translate(...p); x.rotate(rot); x.scale(lerp(1, 0.5, drop), lerp(1, 0.5, drop));
      x.fillStyle = SHADE; x.beginPath(); x.moveTo(-36, 4); x.lineTo(36, 4); x.lineTo(4, -54); x.closePath(); x.fill();
      x.fillStyle = RED; x.beginPath(); x.moveTo(-40, 0); x.lineTo(32, 0); x.lineTo(0, -58); x.closePath(); x.fill();
      CLAWD[5](x, 0, -54, 5, { pose: drop > 0 ? "arms-up" : "default" });
      x.restore();
    };
    if (u < 0.9 && drop > 0) rider();
    // 浏览器：卡纸窗口、芥末黄的 SWR 柜。
    x.fillStyle = SHADE; x.fill(jag(1540, 588, 700, 560, 33, 4));
    x.fillStyle = CARD; x.fill(jag(1530, 578, 700, 560, 33, 4));
    x.fillStyle = INK; x.fill(jag(1530, 326, 700, 56, 35, 2));
    [RED, MUS, CARD].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(1214 + i * 32, 326, 10, 0, TAU); x.fill(); });
    T(x, "lyjw.me", 1320, 336, MONO(28), CARD);
    x.fillStyle = MUS; x.fill(jag(1530, 500, 640, 230, 41, 3));
    T(x, "SWR", 1232, 438, NF.s5b(40, 800), INK);
    x.fillStyle = SHADE; x.fillRect(1236, 470, 588, 96);
    x.fillStyle = CARD; x.fill(jag(1526, 514, 588, 92, 43, 2));
    x.fillStyle = INK; x.fillRect(1500, 552, 52, 10);
    T(x, "/api/status/listening/now", 1248, 528, MONO(28), INK);
    const ty = prog(u, 0.92, 1.3);
    T(x, "mutate(path, data, {revalidate:false})", 1210, 690, MONO(28), INK, { reveal: ty, perChar: true, alpha: ty > 0 ? 1 : 0 });
    x.fillStyle = INK; x.fillRect(1210, 708, 640 * clamp(ty * 1.2), 3);
    if (u < 0.76) rider();
    if (u >= 0.9) {
      const pk = prog(u, 1.3, 1.45, E.outBack);
      CLAWD[5](x, 1780, 470, 5, { pose: pk > 0 ? "arms-up" : "look-left", alpha: prog(u, 0.9, 0.98) });
    }
    x.fillStyle = CARD; x.fill(jag(605, 980, 1070, 120, 51, 4));
    nar(x, "ch10.n5", 100, 1002, NF.s5(60), INK, u, 0.25, { ...o, maxW: 1000 });
  }

  F10.STATIONS.push(s3, s4, s5);
  Object.assign(F10, { wireAt });
})();
