(() => {
  function make() {
    const { css } = G;
    const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, dashed, stamp, spark, roundRect, checkbox, pathAt, pathLen, trailOn } = K;
    const SHA_OLD = "a451a72", SHA_NEW = "cf92f7c";
    // 页面焊进的是上一次 site 部署的提交：7d35661 之后到 a451a72 只改了文档与记忆，site 没有重建（FACTS §10）。
    const SHA_PAGE = "7d35661";
    I18N.add({
      "ch09.title": ["发布", "Release"],
      "ch09.diff": ["这次改到的路径", "Paths this merge touched"],
      "ch09.n1a": ["合进 main，几条流水线同时触发；", "A merge to main fans out at once;"],
      "ch09.n1b": ["设了监视路径的，没改到就不跑。", "watch paths decide who sits out."],
      "ch09.always": ["每次推到 main", "every push to main"],
      "ch09.skip": ["没改到", "untouched"],
      "ch09.t.hub": ["Hub 发布", "Hub release"],
      "ch09.t.img": ["上报器镜像", "Reporter images"],
      "ch09.m.esa": ["阿里云 ESA", "Alibaba Cloud ESA"],
      "ch09.m.card": ["GitHub Actions · 部署成功之后", "GitHub Actions · after a green deploy"],
      "ch09.m.r1": ["刷新 ESA 首页并预热", "Purge the ESA home page, then warm it"],
      "ch09.m.r2": [`等两个域名的 /api/version 都答出 ${SHA_NEW}`, `Wait until both domains serve ${SHA_NEW}`],
      "ch09.m.r2s": ["等不到就不通知，页面靠定时自查兜底", "Times out? No notice; pages poll on their own"],
      "ch09.m.r3": ["通知上报入口（ingress Worker）", "Notify the ingress Worker"],
      "ch09.m.retry": ["失败重试，最长 10 分钟", "retries for up to 10 min"],
      "ch09.n5a": ["部署成功才刷新 ESA 首页；", "ESA is purged only after the deploy;"],
      "ch09.n5b": ["先等两个域名换好，再通知页面。", "pages hear after both are polled."],
      "ch09.p.room": ["推送房间", "push room"],
      "ch09.p.bare": ["不带数据", "no payload"],
      "ch09.p.fg": ["前台", "Foreground"],
      "ch09.p.bg": ["后台标签页", "Hidden tab"],
      "ch09.p.reload": ["自己刷新", "reloads itself"],
      "ch09.p.foot1": ["收不到通知也没关系：", "No push? Pages still ask"],
      "ch09.p.foot2": ["每 30 分钟、切回前台时各问一次", "every 30 min and on refocus."],
      "ch09.n6a": ["页面收到 version，自己去问版本：", "Pages hear “version” and re-check:"],
      "ch09.n6b": ["前台弹出提示，后台的旧页自己刷新。", "visible: a prompt; hidden: a reload."],
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let plate, ink, paperL, emit, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
    const E2 = (t) => t * t;

    // 拍位和 music/ch09.js 是同一张表；run 里各条亮灯的先后照 cf92f7c 那几项检查的真实完成顺序。
    const AT = {
      type: 0.25, stroke: 0.0625, enter: 1.0, headHop: 0.125, pull: [1.45, 1.9], fan: [1.5, 1.95], gate0: 2.0, gateStep: 0.0625,
      run: {
        collector: { pips: [2.625, 2.8125], lamp: 3.0 },
        ingress: { pips: [2.625, 2.875], lamp: 3.125 },
        core: { pips: [2.625, 2.9375], lamp: 3.25 },
        ci: { pips: [2.375, 2.625, 2.875, 3.125], lamp: 3.375 },
        codeql: { pips: [2.625, 3.0625], lamp: 3.5 },
      },
      whip: 3.75,
      land: 4.0, status: 4.25, purge: 4.5, warm: [4.75, 4.95], r1: 4.9, dom: [5.0, 5.25], r2: 5.5,
      verify: { in: [4.6875, 4.8125], turn: 4.875, drop: [5.0, 5.125], hop: [5.25, 5.3125], out: [5.5625, 5.6875] },
      notify: 6.0, ingress: 6.5, core: 6.75, ring: 7.0, ask: 7.5, card: 8.0, reload: 8.5,
      full: [9.0, 9.3], dive: [9.5, 9.92], fade: [9.5, 9.85],
    };

    // ch08.js 的末帧照抄这里的 Y0、HEAD、COMMITS，两章接缝才能对齐。
    const Y0 = 540;
    const HEAD = [1350, Y0];
    const COMMITS = [1250, 1050, 850, 650, 450, 250, 50];

    const GATE_X = 1720, LAMP_X = 3000, BRACKET_X = 3110;
    const MX = 4000;
    const O = [MX + 400, Y0], ESA = [MX + 1400, 840], L = [MX + 2400, Y0], C = [MX + 2400, 840], BEND = [MX + 700, 840];
    const BUILD_X = 4060;
    const TRACKS = [
      { id: "hub", y: -90, name: "ch09.t.hub", gate: "", on: false },
      { id: "img", y: 60, name: "ch09.t.img", gate: "", on: false },
      { id: "codeql", y: 240, name: "CodeQL", gate: null, on: true, ...AT.run.codeql },
      { id: "ci", y: 390, name: "CI", gate: null, on: true, ...AT.run.ci },
      // site 的火花越走越快：甩镜头时领着镜头落到源站。
      { id: "site", y: Y0, name: "site Worker", gate: "shared/…", on: true, pips: [], lamp: AT.land, ease: E2 },
      { id: "core", y: 690, name: "core", gate: "shared/…", on: true, ...AT.run.core },
      { id: "ingress", y: 810, name: "ingress", gate: "shared/…", on: true, ...AT.run.ingress },
      { id: "collector", y: 930, name: "collector", gate: "workers/collector/…", on: true, ...AT.run.collector },
      { id: "ai", y: 1050, name: "ai", gate: "", on: false },
    ];
    function branchPts(y, x1) {
      const pts = [[HEAD[0], Y0], [1440, Y0]];
      if (y !== Y0) for (let i = 1; i <= 18; i++) {
        const t = i / 18, u = 1 - t;
        pts.push([u * u * u * 1440 + 3 * u * u * t * 1545 + 3 * u * t * t * 1545 + t * t * t * 1650, u * u * u * Y0 + 3 * u * u * t * Y0 + 3 * u * t * t * y + t * t * t * y]);
      }
      pts.push([x1, y]);
      return pts;
    }
    for (const [i, tk] of TRACKS.entries()) {
      tk.pts = branchPts(tk.y, tk.id === "site" ? O[0] - 30 : LAMP_X - 26);
      tk.len = pathLen(tk.pts);
      tk.dGate = pathLen(branchPts(tk.y, GATE_X));
      tk.tGate = AT.gate0 + i * AT.gateStep;
      const n = tk.pips ? tk.pips.length : 0;
      tk.pipX = Array.from({ length: n }, (_, j) => lerp(GATE_X + 260, LAMP_X - 200, n === 1 ? 0.5 : j / (n - 1)));
    }
    const dAtX = (tk, px) => tk.dGate + (px - GATE_X);

    const CARD = { x: MX + 950, y: -200, w: 1420, h: 500 };
    const CARD_ROW = (j) => CARD.y + 176 + j * 118;
    const ING = { x: MX + 2450, y: 70, w: 400, h: 100 }, CORE = { x: MX + 3250, y: 70, w: 400, h: 100 }, MAST = [MX + 4050, 120];
    const FG = { x: MX + 3700, y: 320, w: 800, h: 320 }, BG = { x: MX + 3700, y: 720, w: 800, h: 260 };

    const CAM0 = [960, 540, 1];
    const FAN = [2250, 540, 0.6];
    const MAP = [MX + 1230, 520, 0.7];
    const PGV = [MX + 3550, 560, 0.8];
    const FULL = [4250, 460, 0.21];
    // 末帧接 ch10.js 首帧：别的都退掉，只剩屏幕 y 540 一条整宽 3 px 墨线。
    const FIN = [MX + 1400, Y0, 1];
    const drift = (c, dx = 10, k = 1.015) => [c[0] + dx, c[1] + 2, c[2] * k];
    const CAM = [
      [0, CAM0], [AT.pull[0], drift(CAM0, 0), E.lin], [AT.pull[1], FAN, E.io], [AT.whip, drift(FAN, 10, 1.012), E.lin],
      [AT.land, MAP, E.io], [6.25, drift(MAP, 10, 1.01), E.lin],
      [6.5, PGV, E.io], [AT.full[0], drift(PGV, 10, 1.01), E.lin], [AT.full[1], FULL, E.io], [AT.dive[0], drift(FULL, 0, 1.012), E.lin],
      [AT.dive[1], FIN, E.io], [10, FIN, E.lin],
    ];
    function camAt(b) {
      if (b <= CAM[0][0]) return CAM[0][1].slice();
      for (let i = 1; i < CAM.length; i++) if (b <= CAM[i][0]) {
        const [t0, v0] = CAM[i - 1], [t1, v1, e = E.io] = CAM[i];
        const k = e(clamp((b - t0) / (t1 - t0)));
        return [lerp(v0[0], v1[0], k), lerp(v0[1], v1[1], k), Math.exp(lerp(Math.log(v0[2]), Math.log(v1[2]), k))];
      }
      return CAM[CAM.length - 1][1].slice();
    }
    const at = (c, sx, sy) => [c[0] + (sx - 960) / c[2], c[1] + (sy - 540) / c[2]];

    function glow(e, cx, cy, r, a) {
      if (a <= 0) return;
      const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
      e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
    }
    function tick(x, cx, cy, s, k, a = 1) {
      polyline(x, [[cx - 0.5 * s, cy], [cx - 0.12 * s, cy + 0.38 * s], [cx + 0.6 * s, cy - 0.5 * s]], k, s * 0.16, css("signal"), a);
    }
    function dot(x, cx, cy, r, fill, stroke, lw, a = 1) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = fill; x.strokeStyle = stroke; x.lineWidth = lw;
      x.beginPath(); x.arc(cx, cy, r, 0, TAU); if (fill) x.fill(); if (lw > 0) x.stroke(); x.restore();
    }
    function pip(x, cx, cy, r, on, a = 1) { dot(x, cx, cy, r, on > 0 ? css("signal") : css("paper"), on > 0 ? css("signal") : css("pink"), r * 0.32, a); }
    function lamp(x, e, cx, cy, r, on, a = 1) {
      if (a <= 0) return;
      dot(x, cx, cy, r, css("paper"), css("pink"), r * 0.13, a);
      if (on > 0) { dot(x, cx, cy, r * 0.78, css("signal"), null, 0, a * on); glow(e, cx, cy, r * 2.6, 0.5 * on * a); }
    }
    function gate(x, gx, gy, on, k, a, hot = false) {
      x.save(); x.globalAlpha = a; x.fillStyle = css("paper"); x.fillRect(gx - 22, gy - 22, 44, 44); x.restore();
      rect(x, gx - 22, gy - 22, 44, 44, 3, css("pink"), a);
      if (on) tick(x, gx, gy + 2, 34, k, a);
      else if (k > 0) line(x, gx - 13, gy, gx - 13 + 26 * k, gy, 4, hot ? css("signal") : css("graphite"), a);
    }
    function dashPts(x, pts, k, w, color, a = 1, dash = [10, 9]) {
      if (k <= 0 || a <= 0) return null;
      x.save(); x.setLineDash(dash); const head = polyline(x, pts, k, w, color, a); x.restore();
      return head;
    }
    function sparkAt(Ly, pts, d, size = 0.8, trail = 200, lw = 3) {
      const head = pathAt(pts, d);
      spark(Ly.e, Ly.x, head, trailOn(pts, d, trail, 16), { t: G.t, size, lw });
      dot(Ly.x, head[0], head[1], 6.5 * size, css("signal"), null, 0);
      return head;
    }
    function nar(x, key, c, row, r, a) {
      if (a <= 0) return;
      const [px, py] = at(c, 110, row ? 1024 : 944);
      K.narration(x, tr(key), px, py, { px: 60 / c[2], maxW: 1040 / c[2], reveal: r, alpha: a, dim: 0.12 });
    }
    function card(d, px, py, w, h, a, sy = 1) {
      if (a <= 0) return;
      d.save(); d.globalAlpha = a; d.translate(px, py); d.scale(1, Math.max(0.001, sy));
      d.shadowColor = "rgba(0,0,0,0.28)"; d.shadowBlur = 18; d.shadowOffsetY = 7;
      d.fillStyle = css("paper"); d.fillRect(0, 0, w, h);
      d.shadowColor = "transparent"; d.strokeStyle = css("pink"); d.lineWidth = 2.4; d.strokeRect(0, 0, w, h);
      d.restore();
    }
    const lbl = (k) => (k.startsWith("ch09.") ? tr(k) : k);
    const fontOf = (k, px, w = 600) => (k.startsWith("ch09.") ? FONT.cjk(px, w) : FONT.mono(px, w === 600 ? 500 : w));

    function history(x, e, b) {
      const inkC = css("pink");
      line(x, -150, Y0, HEAD[0], Y0, 3, inkC);
      for (const cx of COMMITS) dot(x, cx, Y0, 9, css("paper"), inkC, 2.6);
      const hit = impact(b, AT.enter, 0.2);
      dot(x, HEAD[0], Y0 - K.hop(b, AT.enter, AT.enter + AT.headHop, 36), 14, css("signal"), null, 0);
      if (hit > 0.02) { dot(x, HEAD[0], Y0, 14 + 30 * (1 - hit), null, css("signal"), 2.4, hit); glow(e, HEAD[0], Y0, 90, 0.6 * hit); }
    }
    const MERGE = "PR #308 → main";
    function typed(str, n) {
      let out = "", k = 0;
      for (const ch of str) {
        if (ch !== " ") { if (k >= n) break; k++; }
        out += ch;
      }
      return out;
    }
    function mergeLines(x, b, a) {
      if (a <= 0) return;
      const strokes = b < AT.type ? 0 : Math.floor((b - AT.type) / AT.stroke + 1e-6) + 1;
      text(x, typed(MERGE, strokes), 560, 420, { font: FONT.mono(44, 500), alpha: a * prog(b, 0.12, 0.2) });
      const ea = prog(b, AT.enter, AT.enter + 0.05) * a;
      text(x, `${SHA_OLD}..${SHA_NEW}  main -> main`, 560, 476, { font: FONT.mono(32), color: css("graphite"), alpha: ea });
      text(x, SHA_NEW, HEAD[0], Y0 + 64, { font: FONT.mono(30, 600), color: css("signal"), align: "center", alpha: ea });
    }
    const DIFF = ["shared/site-deployments-types.ts", "workers/collector/…", "workers/core/README.md"];
    function diffCard(d, b, a) {
      const k = prog(b, 0.35, 0.5, E.outBack);
      if (k <= 0 || a <= 0) return;
      const px = 180, py = 660, w = 1000, h = 292;
      card(d, px, py, w, h, a, k);
      if (k < 0.9) return;
      text(d, tr("ch09.diff"), px + 36, py + 64, { font: FONT.cjk(40, 600), alpha: a, maxW: w - 72 });
      line(d, px + 30, py + 90, px + w - 30, py + 90, 1.4, css("pink"), a);
      DIFF.forEach((s, j) => text(d, s, px + 36, py + 150 + j * 52, { font: FONT.mono(38, 500), alpha: a, reveal: prog(b, 0.45 + j * 0.06, 0.62 + j * 0.06) }));
    }
    function title(x, b, a) {
      const k = prog(b, 0.3, 0.75, E.out) * a;
      if (k <= 0) return;
      text(x, "09", 110, 196, { font: FONT.pixel(112), color: css("signal"), alpha: k });
      text(x, tr("ch09.title"), 290, 176, { font: FONT.cjk(58, 600), reveal: prog(b, 0.35, 0.8), alpha: k });
      text(x, "main → GitHub Actions · Workers Builds", 292, 226, { font: FONT.mono(28), color: css("graphite"), reveal: prog(b, 0.45, 1.0), alpha: k });
      line(x, 110, 262, 110 + 1000 * prog(b, 0.35, 1.0, E.outExpo), 262, 1.4, css("pink"), k);
    }

    function fan(Ly, b, a) {
      const { x, e } = Ly, inkC = css("pink"), gr = css("graphite");
      if (b < AT.fan[0] || a <= 0) return;
      for (const [i, tk] of TRACKS.entries()) {
        const kk = tk.id === "site" ? 1 : prog(b, AT.fan[0] + 0.03 * i, AT.fan[1] + 0.03 * i, E.io);
        if (kk <= 0) continue;
        const gk = prog(b, tk.tGate, tk.tGate + 0.05);
        if (!tk.on && gk > 0) {
          polyline(x, branchPts(tk.y, GATE_X - 22), 1, 4, inkC, a);
          dashed(x, GATE_X + 22, tk.y, LAMP_X - 26, tk.y, 3, gr, [10, 9], 0.8 * a);
        } else if (tk.id !== "site") polyline(x, tk.pts, kk, 4, inkC, a);
        if (kk < 0.55) continue;
        const la = prog(kk, 0.55, 1) * a;
        gate(x, GATE_X, tk.y, tk.on, gk, la);
        const nw = text(x, lbl(tk.name), GATE_X + 50, tk.y - 22, { font: fontOf(tk.name, 52, 600), alpha: la });
        if (gk > 0) {
          const why = tk.gate === null ? tr("ch09.always") : tk.on ? tk.gate : tr("ch09.skip");
          text(x, why, GATE_X + 50 + nw + 30, tk.y - 22, { font: tk.gate ? FONT.mono(48, 500) : FONT.cjk(48, 600), color: tk.on ? css("signal") : gr, alpha: la, reveal: prog(b, tk.tGate, tk.tGate + 0.25), maxW: LAMP_X - GATE_X - nw - 140 });
        }
        if (!tk.on) { if (gk > 0) dot(x, LAMP_X, tk.y, 24, css("paper"), gr, 2.4, 0.8 * la); continue; }
        const end = tk.id === "site" ? tk.len : dAtX(tk, LAMP_X - 26);
        const d = keys(b, [[tk.tGate, tk.dGate], ...tk.pips.map((pt, j) => [pt, dAtX(tk, tk.pipX[j]), E.io]), [tk.lamp, end, tk.ease || E.io]]);
        tk.pipX.forEach((px, j) => pip(x, px, tk.y, 11, prog(b, tk.pips[j], tk.pips[j] + 0.03), la));
        if (b >= tk.tGate) {
          polyline(x, tk.pts, d / tk.len, 4.4, css("signal"), a);
          if (b < tk.lamp) sparkAt(Ly, tk.pts, d);
        }
        if (tk.id !== "site") lamp(x, e, LAMP_X, tk.y, 26, prog(b, tk.lamp, tk.lamp + 0.05), la);
      }
      const ga = prog(b, AT.fan[1] - 0.1, AT.fan[1] + 0.15) * a;
      if (ga <= 0) return;
      const brace = (y0, y1) => { line(x, BRACKET_X, y0, BRACKET_X, y1, 2.2, inkC, ga); line(x, BRACKET_X - 16, y0, BRACKET_X, y0, 2.2, inkC, ga); line(x, BRACKET_X - 16, y1, BRACKET_X, y1, 2.2, inkC, ga); };
      brace(-140, 420); brace(660, 1080);
      text(x, "GitHub Actions", BRACKET_X - 16, -186, { font: FONT.mono(50, 600), alpha: ga });
      text(x, "Workers Builds", BRACKET_X - 16, 1160, { font: FONT.mono(50, 600), alpha: ga });
    }

    function station(x, cx, cy, a, o = {}) {
      dot(x, cx, cy, o.r ?? 18, css("paper"), o.hot ? css("signal") : css("pink"), o.lw ?? 6, a);
    }
    function pageIcon(x, cx, cy, col, a, s = 1) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(s, s);
      x.fillStyle = css("paper"); x.strokeStyle = col; x.lineWidth = 3;
      x.beginPath(); x.moveTo(-22, -30); x.lineTo(10, -30); x.lineTo(22, -18); x.lineTo(22, 30); x.lineTo(-22, 30); x.closePath(); x.fill(); x.stroke();
      for (let j = 0; j < 3; j++) { x.beginPath(); x.moveTo(-12, -12 + j * 12); x.lineTo(12 - (j === 2 ? 10 : 0), -12 + j * 12); x.stroke(); }
      x.restore();
    }
    const LW = 14;
    // 域名标签让开 Clawd 从 lyjw.me 线跳到 lyjw131.com 线的那一竖条（VX ± 9q，外加放大镜）。
    const DOMAIN_X = L[0] - 190;
    function axis(x, b, a, finK) {
      const inkC = css("pink");
      if (b >= AT.fan[0]) polyline(x, [[HEAD[0], Y0], [O[0], Y0]], prog(b, AT.fan[0], AT.fan[1], E.io), lerp(4, 3, finK), inkC);
      line(x, O[0], Y0, L[0], Y0, lerp(LW, 3, finK), inkC);
      line(x, L[0], Y0, FG.x, Y0, LW, inkC, a);
      polyline(x, [O, BEND, ESA, C, [BG.x, C[1]]], 1, LW, css("signal"), a);
    }
    function landing(Ly, b, a) {
      const { x, d, s, e } = Ly, inkC = css("pink"), gr = css("graphite");
      if (a <= 0) return;
      pip(x, BUILD_X, Y0, 13, prog(b, AT.land - 0.1, AT.land - 0.08), a);
      text(x, "pnpm build", BUILD_X, Y0 - 40, { font: FONT.mono(44, 500), align: "center", alpha: a });
      const oHot = prog(b, AT.land, AT.land + 0.05);
      station(x, O[0], O[1], a, { r: 30, lw: 7, hot: oHot > 0 });
      if (oHot > 0) { dot(x, O[0], O[1], 22, css("signal"), null, 0, oHot * a); glow(e, O[0], O[1], 150, 0.55 * oHot * (0.6 + 0.4 * impact(b, AT.land, 0.4)) * a); }
      text(x, "site Worker · Production", O[0] + 40, O[1] - 52, { font: FONT.mono(46, 600), alpha: a });
      station(x, ESA[0], ESA[1], a, { hot: b >= AT.purge && b < AT.warm[1] + 0.1 });
      station(x, L[0], L[1], a);
      station(x, C[0], C[1], a);
      text(x, tr("ch09.m.esa"), ESA[0] - 34, ESA[1] - 34, { font: FONT.mono(46, 600), align: "right", alpha: a, maxW: 560 });
      text(x, "lyjw.me", DOMAIN_X, L[1] + 72, { font: FONT.mono(46, 600), align: "right", alpha: a });
      text(x, "lyjw131.com", DOMAIN_X, C[1] + 72, { font: FONT.mono(46, 600), color: css("signal"), align: "right", alpha: a });
      const oldA = 1 - prog(b, AT.purge + 0.05, AT.purge + 0.2);
      pageIcon(x, ESA[0], ESA[1] + 96, inkC, a * oldA);
      if (b >= AT.purge && oldA > 0) {
        const k = prog(b, AT.purge, AT.purge + 0.08);
        line(x, ESA[0] - 28, ESA[1] + 66, ESA[0] - 28 + 56 * k, ESA[1] + 126, 4, css("signal"), a * oldA);
        line(x, ESA[0] + 28, ESA[1] + 66, ESA[0] + 28 - 56 * k, ESA[1] + 126, 4, css("signal"), a * oldA);
      }
      stamp(s, "purge", ESA[0] + 150, ESA[1] + 110, { k: prog(b, AT.purge, AT.purge + 0.12), px: 44, rot: -0.12, alpha: a });
      const wk = prog(b, AT.warm[0], AT.warm[1], E.io);
      if (wk > 0 && wk < 1) {
        const path = [[O[0] + 40, O[1] + 90], [BEND[0] + 30, BEND[1] + 96], [ESA[0], ESA[1] + 96]];
        pageIcon(x, ...pathAt(path, wk * pathLen(path)), css("signal"), a, 0.8);
      }
      if (wk >= 1) pageIcon(x, ESA[0], ESA[1] + 96, css("signal"), a);
      tick(x, L[0] + 66, L[1] - 14, 64, prog(b, AT.dom[0], AT.dom[0] + 0.1, E.out), a);
      tick(x, C[0] + 66, C[1] - 14, 64, prog(b, AT.dom[1], AT.dom[1] + 0.1, E.out), a);
      glow(e, L[0], L[1], 110, 0.45 * impact(b, AT.dom[0], 0.3) * a);
      glow(e, C[0], C[1], 110, 0.45 * impact(b, AT.dom[1], 0.3) * a);
      const sy = CARD.y + 250;
      dashPts(x, [[O[0], O[1] - 100], [O[0], sy], [CARD.x, sy]], prog(b, AT.status, AT.status + 0.2, E.io), 2.6, inkC, a);
      text(x, "check_run", O[0] + 24, sy - 20, { font: FONT.mono(42, 500), color: gr, alpha: a * prog(b, AT.status + 0.1, AT.status + 0.2), maxW: CARD.x - O[0] - 40 });
      const ca = prog(b, AT.status + 0.1, AT.status + 0.25, E.outBack);
      if (ca <= 0) return;
      card(d, CARD.x, CARD.y, CARD.w, CARD.h, a, ca);
      if (ca < 0.9) return;
      text(d, tr("ch09.m.card"), CARD.x + 40, CARD.y + 66, { font: FONT.cjk(44, 600), alpha: a, maxW: CARD.w - 80 });
      line(d, CARD.x + 30, CARD.y + 96, CARD.x + CARD.w - 30, CARD.y + 96, 1.4, inkC, a);
      const rows = [["ch09.m.r1", "PurgeCaches", AT.r1], ["ch09.m.r2", "ch09.m.r2s", AT.r2], ["ch09.m.r3", "POST /api/internal/site-deployed", AT.notify]];
      rows.forEach(([lab, sub, t], j) => {
        const y = CARD_ROW(j);
        checkbox(d, CARD.x + 40, y - 36, prog(b, t, t + 0.08), { size: 44, alpha: a });
        const lw = text(d, tr(lab), CARD.x + 106, y, { font: FONT.cjk(42, 600), alpha: a, maxW: CARD.w - 150 });
        text(d, lbl(sub), CARD.x + 106, y + 48, { font: fontOf(sub, 40), color: gr, alpha: a, maxW: CARD.w - 150 });
        if (j === 2) text(d, tr("ch09.m.retry"), CARD.x + CARD.w - 40, y, { font: FONT.cjk(40, 600), color: gr, align: "right", alpha: a, maxW: CARD.w - 190 - lw });
      });
    }

    const VQ = 6, VX = L[0] - 110, VY = [L[1] - LW / 2, C[1] - LW / 2];
    const V_PATH = [
      [0, L[0] + 320, VY[0]], [...AT.verify.in, VX, VY[0], 110], [...AT.verify.drop, VX, VY[1], 50],
      [...AT.verify.hop, VX, VY[1], 34], [...AT.verify.out, L[0] + 340, VY[1], 130],
    ];
    function walk(path, b) {
      let px = path[0][1], py = path[0][2], landT = -9;
      for (let i = 1; i < path.length; i++) {
        const [t0, t1, x1, y1, h] = path[i];
        if (b >= t1) { px = x1; py = y1; landT = t1; continue; }
        if (b > t0) {
          const k = E.io((b - t0) / (t1 - t0));
          return { x: lerp(px, x1, k), y: lerp(py, y1, k) - K.hop(b, t0, t1, h), air: true, landT };
        }
        break;
      }
      return { x: px, y: py, air: false, landT };
    }
    function verifier(Ly, b) {
      const { tp } = Ly;
      if (b < AT.verify.in[0] || b >= AT.verify.out[1]) return;
      const st = walk(V_PATH, b);
      const look = b >= AT.verify.hop[1] + 0.1 ? AT.verify.hop[1] + 0.1 : b >= AT.verify.turn && b < AT.verify.drop[0] ? AT.verify.turn : null;
      const fr = st.air ? { pose: "arms-up", offset: 0 } : (look !== null && K.clawdSeq("look", b, look, BARs)) || K.clawdSeq("land", b, st.landT, BARs) || { pose: "default", offset: 0 };
      const flip = b < AT.verify.turn, bottom = st.y + 2 * VQ;
      K.clawdFrame(tp, fr, st.x, bottom, VQ, { flip, poofColor: css("graphite") });
      K.clawdProp(tp, "magnifier", st.x, bottom, VQ, { color: css("pink"), crouch: fr.offset || 0, flip });
    }

    function mast(x, mx, my, a, hot = 0) {
      if (a <= 0) return;
      const inkC = css("pink");
      dot(x, mx, my, 22, css("paper"), inkC, 2.8, a);
      line(x, mx - 14, my - 14, mx + 14, my + 14, 2.2, inkC, a); line(x, mx - 14, my + 14, mx + 14, my - 14, 2.2, inkC, a);
      if (hot > 0.02) for (let j = 1; j <= 3; j++) {
        x.save(); x.globalAlpha = a * hot * (1 - j * 0.22); x.strokeStyle = css("signal"); x.lineWidth = 2.6;
        x.beginPath(); x.arc(mx, my, 22 + j * 13, -0.6, 0.6); x.stroke(); x.beginPath(); x.arc(mx, my, 22 + j * 13, Math.PI - 0.6, Math.PI + 0.6); x.stroke();
        x.restore();
      }
    }
    function box(x, B, label, on, a) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = css("paper"); x.strokeStyle = on > 0 ? css("signal") : css("pink"); x.lineWidth = 3;
      roundRect(x, B.x, B.y, B.w, B.h, 10); x.fill(); x.stroke(); x.restore();
      text(x, label, B.x + B.w / 2, B.y + B.h / 2 + 14, { font: FONT.mono(40, 600), color: on > 0 ? css("signal") : css("pink"), align: "center", alpha: a, maxW: B.w - 30 });
    }
    function browser(d, W, host, a, dim, fresh) {
      if (a <= 0) return;
      card(d, W.x, W.y, W.w, W.h, a);
      d.save(); d.globalAlpha = a * 0.08; d.fillStyle = css("pink"); d.fillRect(W.x, W.y, W.w, 56); d.restore();
      line(d, W.x, W.y + 56, W.x + W.w, W.y + 56, 1.6, css("pink"), a);
      for (let j = 0; j < 3; j++) dot(d, W.x + 30 + j * 28, W.y + 28, 8, css("paper"), css("pink"), 1.8, a);
      text(d, host, W.x + 128, W.y + 41, { font: FONT.mono(36, 600), alpha: a * (1 - 0.4 * dim) });
      const ix = W.x + 24, iy = W.y + 80, iw = W.w - 48, ih = W.h - 104;
      for (const [u, v, w, h] of [[0, 0, 0.62, 1], [0.66, 0, 0.34, 0.46], [0.66, 0.54, 0.34, 0.46]]) {
        const cy = iy + v * ih, isNew = fresh > 0 && cy < iy + ih * fresh;
        d.save(); d.globalAlpha = a * (1 - 0.45 * dim); d.strokeStyle = isNew ? css("signal") : css("pink"); d.lineWidth = 2;
        d.strokeRect(ix + u * iw, cy, w * iw - 10, h * ih - 10); d.restore();
      }
      if (fresh > 0 && fresh < 1) line(d, W.x + 10, iy + ih * fresh, W.x + W.w - 10, iy + ih * fresh, 3, css("signal"), a);
    }
    function updateCard(d, px, py, w, h, k, a) {
      if (k <= 0 || a <= 0) return;
      card(d, px, py, w, h, a, E.outBack(k));
      const ta = clamp((k - 0.5) * 2) * a;
      if (ta <= 0) return;
      text(d, "UPDATE", px + 24, py + 46, { font: FONT.mono(36, 600), color: css("graphite"), alpha: ta, tracking: 3 });
      text(d, "DISMISS ×", px + w - 24, py + 46, { font: FONT.mono(36, 500), color: css("graphite"), align: "right", alpha: ta });
      line(d, px, py + 66, px + w, py + 66, 1.4, css("pink"), ta * 0.6);
      dot(d, px + 36, py + 118, 10, css("signal"), null, 0, ta);
      text(d, "New version", px + 60, py + 134, { font: FONT.sans(44, 600), alpha: ta });
      text(d, `${SHA_PAGE} → ${SHA_NEW}`, px + 36, py + 196, { font: FONT.mono(38, 500), color: css("graphite"), alpha: ta });
      d.save(); d.globalAlpha = ta; d.fillStyle = css("pink"); roundRect(d, px + w - 210, py + 96, 180, 70, 10); d.fill(); d.restore();
      text(d, "Reload", px + w - 120, py + 144, { font: FONT.sans(38, 600), color: css("paper"), align: "center", alpha: ta });
    }
    const NOTIFY = [[CARD.x + CARD.w, CARD_ROW(2) - 12], [ING.x - 50, CARD_ROW(2) - 12], [ING.x - 50, ING.y + ING.h / 2], [ING.x, ING.y + ING.h / 2]];
    const BIND = [[ING.x + ING.w, ING.y + ING.h / 2], [CORE.x, CORE.y + CORE.h / 2]];
    const TO_MAST = [[CORE.x + CORE.w, CORE.y + CORE.h / 2], [MAST[0] - 24, MAST[1]]];
    function notify(Ly, b, a) {
      const { x, d, e } = Ly, gr = css("graphite");
      if (a <= 0) return;
      const nk = prog(b, AT.notify, AT.ingress - 0.05, E.io);
      polyline(x, NOTIFY, nk, 2.4, css("pink"), a);
      if (nk > 0 && nk < 1) sparkAt(Ly, NOTIFY, nk * pathLen(NOTIFY), 0.8, 220);
      const inA = prog(b, AT.ingress - 0.15, AT.ingress - 0.05) * a;
      box(x, ING, "ingress Worker", prog(b, AT.ingress, AT.ingress + 0.05), inA);
      text(x, "internal:site-deployed", ING.x + ING.w / 2, ING.y + ING.h + 50, { font: FONT.mono(36), color: gr, align: "center", alpha: inA });
      dashPts(x, BIND, 1, 2.6, css("pink"), inA);
      text(x, "Service Binding", (BIND[0][0] + BIND[1][0]) / 2, BIND[0][1] - 22, { font: FONT.mono(36, 500), color: gr, align: "center", alpha: inA, maxW: CORE.x - ING.x - ING.w - 20 });
      const bk = prog(b, AT.ingress, AT.core, E.io);
      if (bk > 0 && bk < 1) sparkAt(Ly, BIND, bk * pathLen(BIND), 0.8, 160);
      box(x, CORE, "StateCore", prog(b, AT.core, AT.core + 0.05), inA);
      text(x, "broadcastVersion()", CORE.x + CORE.w / 2, CORE.y + CORE.h + 50, { font: FONT.mono(36), color: gr, align: "center", alpha: inA });
      polyline(x, TO_MAST, 1, 2.4, css("pink"), inA);
      const mk = prog(b, AT.core, AT.ring, E.io);
      if (mk > 0 && mk < 1) sparkAt(Ly, TO_MAST, mk * pathLen(TO_MAST), 0.8, 140);
      mast(x, MAST[0], MAST[1], inA, Math.max(impact(b, AT.ring, 0.3), win(b, AT.ring, AT.ring + 0.05, AT.ring + 0.6, AT.ring + 0.9)));
      text(x, "LivePushRoom", MAST[0], MAST[1] + 78, { font: FONT.mono(38, 600), align: "center", alpha: inA });
      text(x, tr("ch09.p.room"), MAST[0], MAST[1] + 122, { font: FONT.cjk(36, 600), color: gr, align: "center", alpha: inA });
      const va = prog(b, AT.ring, AT.ring + 0.1) * a;
      text(x, "version", MAST[0] + 72, MAST[1] - 40, { font: FONT.mono(44, 600), color: css("signal"), alpha: va });
      text(x, tr("ch09.p.bare"), MAST[0] + 72, MAST[1] + 6, { font: FONT.cjk(36, 600), color: gr, alpha: va, maxW: 330 });
      if (b >= AT.ring && b < AT.ring + 1.2) {
        const sec = (b - AT.ring) * BARs;
        for (let j = 0; j < 3; j++) {
          const rr = (sec - j * 0.16) * 800;
          if (rr <= 30 || rr > 1100) continue;
          const fade = Math.pow(1 - rr / 1100, 1.4);
          e.save(); e.globalAlpha = 0.5 * fade * a; e.strokeStyle = "rgba(240,150,105,1)"; e.lineWidth = 8 - j * 2;
          e.beginPath(); e.arc(MAST[0], MAST[1], rr, 0, TAU); e.stroke(); e.restore();
          x.save(); x.globalAlpha = 0.45 * fade * a; x.strokeStyle = css("signal"); x.lineWidth = 2.4;
          x.beginPath(); x.arc(MAST[0], MAST[1], rr, 0, TAU); x.stroke(); x.restore();
        }
      }
      const wa = prog(b, AT.notify - 0.2, AT.notify) * a;
      const fresh = prog(b, AT.reload, AT.reload + 0.3, E.io);
      browser(d, FG, "lyjw.me", wa, 0, 0);
      browser(d, BG, "lyjw131.com", wa, 1 - fresh, fresh);
      text(x, tr("ch09.p.fg"), FG.x, FG.y - 20, { font: FONT.cjk(36, 600), alpha: wa });
      text(x, tr("ch09.p.bg"), BG.x, BG.y - 20, { font: FONT.cjk(36, 600), color: gr, alpha: wa });
      const qa = prog(b, AT.ask, AT.ask + 0.1) * a;
      const ask = `GET /api/version → ${SHA_NEW}`;
      text(x, ask, FG.x + FG.w, FG.y - 20, { font: FONT.mono(36, 500), color: css("signal"), align: "right", alpha: qa, maxW: FG.w - 140 });
      text(x, ask, BG.x + BG.w, BG.y - 20, { font: FONT.mono(36, 500), color: css("signal"), align: "right", alpha: qa * (1 - prog(b, AT.reload, AT.reload + 0.08)), maxW: BG.w - 260 });
      text(x, tr("ch09.p.reload"), BG.x + BG.w, BG.y - 20, { font: FONT.cjk(36, 600), color: css("signal"), align: "right", alpha: prog(b, AT.reload + 0.04, AT.reload + 0.12) * a });
      updateCard(d, FG.x + 20, FG.y + 72, FG.w - 40, 226, prog(b, AT.card, AT.card + 0.28), a);
      const fa = prog(b, AT.reload + 0.1, AT.reload + 0.3) * a;
      text(x, tr("ch09.p.foot1"), BG.x + BG.w, BG.y + BG.h + 62, { font: FONT.cjk(36, 600), color: gr, align: "right", alpha: fa, maxW: 780 });
      text(x, tr("ch09.p.foot2"), BG.x + BG.w, BG.y + BG.h + 110, { font: FONT.cjk(36, 600), color: gr, align: "right", alpha: fa, maxW: 780 });
    }

    const PLATE_RECT = [-600, -700, 9000, 1700];
    function plateFrame(x, b, a) {
      const k = prog(b, AT.full[0] + 0.1, AT.full[1] + 0.05, E.out) * a;
      if (k <= 0) return;
      rect(x, -200, -420, 8900, 1760, 5, css("pink"), k);
      text(x, "PLATE 09 · RELEASE", 8640, 1280, { font: FONT.mono(140, 600), align: "right", alpha: k });
    }

    function render(f) {
      BARs = f.BAR;
      const b = f.bar;
      const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
      const hitS = Math.max(impact(b, AT.enter, 0.12) * 0.6, impact(b, AT.land, 0.14), impact(b, AT.purge, 0.1) * 0.6, impact(b, AT.card, 0.12) * 0.6);
      const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.014 * hitS), rot: 0 };
      G.setCam(cam);
      G.fill(plate, { uGridA: prog(b, 0.05, 0.6), uPlate: PLATE_RECT });

      const x = ink.begin(); ink.cam(cam);
      const d = paperL.begin(); paperL.cam(cam);
      const e = emit.begin(); emit.cam(cam);
      const s = stampL.begin(); stampL.cam(cam);
      const tp = top.begin(); top.cam(cam);
      const Ly = { x, d, e, s, tp };

      const keep = 1 - prog(b, AT.fade[0], AT.fade[1]);
      const finK = prog(b, AT.dive[0], AT.dive[1], E.io);
      const openA = clamp(1 - prog(b, AT.pull[0], AT.pull[0] + 0.3) + prog(b, AT.full[0], AT.full[1])) * keep;
      title(x, b, openA);
      mergeLines(x, b, openA);
      diffCard(d, b, openA);
      axis(x, b, keep, finK);
      history(x, e, b);
      fan(Ly, b, keep);
      landing(Ly, b, keep);
      verifier(Ly, b);
      notify(Ly, b, keep);
      plateFrame(x, b, keep);

      nar(x, "ch09.n1a", FAN, 0, prog(b, 1.95, 2.45), win(b, 1.9, 2.0, 3.6, 3.7));
      nar(x, "ch09.n1b", FAN, 1, prog(b, 2.45, 3.0), win(b, 1.9, 2.0, 3.6, 3.7));
      nar(x, "ch09.n5a", MAP, 0, prog(b, 4.1, 4.6), win(b, 4.05, 4.15, 6.2, 6.3));
      nar(x, "ch09.n5b", MAP, 1, prog(b, 4.6, 5.4), win(b, 4.05, 4.15, 6.2, 6.3));
      nar(x, "ch09.n6a", PGV, 0, prog(b, 6.6, 7.2), win(b, 6.55, 6.65, 8.9, 9.0));
      nar(x, "ch09.n6b", PGV, 1, prog(b, 7.2, 8.1), win(b, 6.55, 6.65, 8.9, 9.0));

      G.composite(ink.upload(), { mode: G.MODE.ink, seed: 5.3 });
      G.composite(paperL.upload(), { mode: G.MODE.paper });
      G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
      G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 4.1 });
      G.composite(top.upload(), { mode: G.MODE.normal });

      const sh = hitS * 6;
      f.post = {
        bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
        shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
        blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
      };
    }
    function init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); paperL = G.layer("paper"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch09", title: "ch.09", bars: 10,
    init() { impl = impl || make(); impl.init(); },
    render(f) { impl.render(f); },
  });
})();
