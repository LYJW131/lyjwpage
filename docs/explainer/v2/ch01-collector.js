// 第 01 章采集 Worker 的两站：钟楼的 cron 时序卡，和没人上报的播放（Apple 最近播放的拉取与开播推断）。和 ch01-labels.js 一样画在屏幕坐标的 2D 层上。
(() => {
  const NS = window.CH01;
  if (!NS || !NS.ui) return;
  const { E, prog, clamp, lerp, text, measure, pathAt } = K;
  const { P, tone, rgba, impact, win, SANS, SONG, MONO, AT, STOP, live, tr, plate, glow, PLAYS, FREEZE, minuteAt7 } = NS;
  const { pr, L, SIG, tag, dash, dot, ring, squash, withSquash } = NS.ui;
  const TAU = Math.PI * 2, rr = K.roundRect;

  // 调度表须与 workers/collector/src/registry.ts#JOBS 一致。apple-recent 每分钟登记，任务里再按
  // apple-recent.ts#appleRecentDue 分闲 / 活跃两档；这里让它在 APPLE_CHANGED 那一分钟看到列表变了。
  const JOBS = [
    ["apple-recent", 1, 0], ["provider-status", 1, 0], ["pagespeed", 60, 7], ["github-chart", 10, 1], ["github-repo", 30, 2],
    ["site-deployments", 1, 0], ["site-analytics", 15, 3], ["cloudflare-deployments", 2, 0], ["cloudflare-metrics", 15, 4],
    ["uptime-probe", 1, 0], ["site-health", 5, 4], ["digest", 15, 5], ["avatar-watch", 5, 1],
  ];
  const MINUTES = 12;
  const APPLE_IDLE = 5, APPLE_HOLD = 10, APPLE_CHANGED = 5;
  const due = (j, m) => (JOBS[j][0] === "apple-recent"
    ? (m >= APPLE_CHANGED && m < APPLE_CHANGED + APPLE_HOLD) || m % APPLE_IDLE === 0
    : m % JOBS[j][1] === JOBS[j][2]);
  function clockLabels(x, e, b) {
    const st = STOP.CLOCK, { TOWER } = L();
    const m0 = Math.floor((b - AT.dial) * 4 + 1e-9);
    if (b >= AT.dial && m0 <= MINUTES) {
      const k = (b - AT.dial) * 4 - m0;
      ring(x, TOWER.x + TOWER.w / 2, TOWER.y + TOWER.d / 2, 50 + TOWER.h, 90 + k * 140, SIG(), 3, (1 - k) * 0.7 * live(st, b));
    }
    const a = live(st, b);
    if (a <= 0) return;
    const X0 = 1000, Y0 = 60, W = 870, RH = 40, top = Y0 + 150;
    plate(x, X0, Y0, W, 210 + JOBS.length * 40, a);
    text(x, tr("ch01.f7"), X0 + 28, Y0 + 52, { font: SANS(32), color: P.ink, alpha: a, maxW: W - 150 });
    text(x, tr("ch01.chart"), X0 + 28, Y0 + 98, { font: SANS(28, 500), color: P.ink2, alpha: a });
    const mNow = clamp((b - AT.dial) * 4, 0, MINUTES + 0.999);
    text(x, `:${String(Math.min(MINUTES, Math.floor(mNow))).padStart(2, "0")}`, X0 + W - 28, Y0 + 52, { font: MONO(32, 600), color: SIG(), align: "right", alpha: a });
    const gx = X0 + 410, cw = (W - 430) / MINUTES;
    JOBS.forEach(([name], j) => {
      const y = top + j * RH;
      text(x, name, X0 + 28, y + 10, { font: MONO(28), color: P.ink2, alpha: a });
      for (let m = 0; m < MINUTES; m++) {
        const cx = gx + m * cw + cw / 2, hit = due(j, m), done = b >= AT.dial + m / 4;
        if (hit && done) dot(x, cx, y, 9, SIG(), a);
        else dot(x, cx, y, hit ? 7 : 4, hit ? rgba(SIG(), 0.25) : P.steel, a);
      }
    });
    if (b >= AT.dial && mNow < MINUTES) { const cx = gx + Math.floor(mNow) * cw; x.globalAlpha = a * 0.16; x.fillStyle = SIG(); x.fillRect(cx, top - RH / 2, cw, JOBS.length * RH); x.globalAlpha = 1; }
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(X0 + 28, top + (JOBS.length - 0.3) * RH, W - 56, 2); x.globalAlpha = 1;
    text(x, tr("ch01.noGate"), X0 + 28, top + (JOBS.length + 0.75) * RH, { font: SANS(28, 500), color: P.ink2, alpha: a, maxW: W - 56 });
  }

  // 列表变过之后每拍里每 POLL_EVERY 分钟拉一次。推断照 shared/pulse-listening.ts#inferredPlays：
  // 窗口先减去上榜滞后 LAG，后一首的窗口再减去前一首的时长，和前一首的窗口求交，交集中点是开播、半宽是理想误差。
  // PLAYS 的 start 是真正开播的分钟，seen 是第一次看到它的那次拉取；start + LAG 要落在 seen 前一格里，
  // 两次看到新歌才踩在 24:1、25:2 两拍上（配乐的纸滑），所以第一首的时长要在 4.75–5.25 分钟之间。
  const minuteBar = (m) => AT.dial + m / 4;
  const AL = { p: [560, 150], w: 520, h: 380 };
  const IS = { p: [1110, 150], w: 760, h: 380 };
  const PG = { p: [1110, 552], w: 760, h: 186 };
  const POLL_EVERY = 0.25, LAG = 5.5 / 60;
  const ARTIST7 = "Aimer";
  const RECENT0 = ["カタオモイ", "蝶々結び", "Brave Shine", "春はゆく"];
  const W1 = [PLAYS[0].seen - POLL_EVERY - LAG, PLAYS[0].seen - LAG];
  const W2 = [PLAYS[1].seen - POLL_EVERY - LAG, PLAYS[1].seen - LAG];
  const W2B = [W2[0] - PLAYS[0].len, W2[1] - PLAYS[0].len];
  const CROSS = [Math.max(W1[0], W2B[0]), Math.min(W1[1], W2B[1])];
  const EST = (CROSS[0] + CROSS[1]) / 2;
  const MARGIN_S = Math.ceil(((CROSS[1] - CROSS[0]) / 2) * 60);
  const T7 = { seen1: minuteBar(PLAYS[0].seen), seen2: minuteBar(PLAYS[1].seen), shift: 25.75, cross: 26.0, chain: 26.1, page: 26.5, out: 27.7 };
  const mx = (m) => lerp(IS.p[0] + 150, IS.p[0] + IS.w - 30, (m - 11) / 11);
  const ROW = [IS.p[1] + 170, IS.p[1] + 262], AXIS_Y = IS.p[1] + 322;
  function bracket7(x, m0, m1, y, a, hot, dashed = false) {
    if (a <= 0) return;
    const x0 = mx(m0), x1 = mx(m1), h = 36, serif = Math.min(9, (x1 - x0) / 3), col = hot ? SIG() : P.ink2;
    x.globalAlpha = (hot ? 0.22 : 0.08) * a; x.fillStyle = SIG(); x.fillRect(x0, y - h / 2, x1 - x0, h);
    x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = 2.4; x.save(); if (dashed) x.setLineDash([5, 4]);
    x.beginPath(); x.moveTo(x0 + serif, y - h / 2); x.lineTo(x0, y - h / 2); x.lineTo(x0, y + h / 2); x.lineTo(x0 + serif, y + h / 2);
    x.moveTo(x1 - serif, y - h / 2); x.lineTo(x1, y - h / 2); x.lineTo(x1, y + h / 2); x.lineTo(x1 - serif, y + h / 2); x.stroke(); x.restore(); x.globalAlpha = 1;
  }
  // 游标竖线会扫过这几行注：垫一块牌子色的底，线从字后面过去而不是穿字
  function note7(x, str, lx, ly, color, a, k, maxW) {
    if (a <= 0 || k <= 0) return;
    const w = Math.min(measure(x, str, SANS(28)), maxW ?? Infinity);
    x.globalAlpha = a * k; x.fillStyle = P.plate; x.fillRect(lx - 8, ly - 30, w + 16, 40); x.globalAlpha = 1;
    text(x, str, lx, ly, { font: SANS(28), color, alpha: a * k, maxW });
  }
  function inferStation(x, e, b) {
    const st = STOP.INFER, a = live(st, b, 0.1, 0.08);
    if (a <= 0) return;
    const { PH7 } = L();
    const [px, py] = pr(PH7[0] + 26, PH7[1] + 10, PH7[2] + 272);
    tag(x, tr("ch01.elsewhere1"), px - 160, py - 160, a, { px: 30 });
    tag(x, tr("ch01.noRep"), px - 160, py - 98, a, { px: 28, color: P.ink2 });
    const mb = minuteAt7(b), idx = PLAYS.reduce((n, p, i) => (mb >= p.start ? i : n), -1);
    if (idx >= 0) {
      const p = PLAYS[idx], fk = prog(b, minuteBar(p.start) - 0.04, minuteBar(p.start) + 0.04);
      const cx0 = px - 160, cy0 = py + 330;
      plate(x, cx0 - 16, cy0 - 50, 330, 120, a);
      withSquash(x, cy0 + 10, squash(fk), () => {
        text(x, p.title, cx0 + 4, cy0, { font: SONG(36), color: SIG(), alpha: a });
        text(x, ARTIST7, cx0 + 4, cy0 + 44, { font: SANS(28, 500), color: P.ink2, alpha: a });
      });
    }
    // 拉取：采集 Worker 的虚线从右边进来
    const POLL = [[1990, 96], [AL.p[0] + AL.w / 2, 96], [AL.p[0] + AL.w / 2, AL.p[1] - 8]];
    const k = prog(b, st.t0, st.t0 + 0.15, E.out), pa = a * (1 - prog(b, T7.out, T7.out + 0.1));
    dash(x, POLL, P.ink2, 2.4, pa * 0.7 * k, [10, 9]);
    text(x, tr("ch01.col"), 1880, 70, { font: SANS(28), color: P.ink, align: "right", alpha: pa * k });
    text(x, tr("ch01.active"), AL.p[0] + AL.w / 2 + 24, 70, { font: SANS(28), color: P.ink2, alpha: pa * k, maxW: 600 });
    const Ln = POLL.slice(1).reduce((u, p, j) => u + Math.hypot(p[0] - POLL[j][0], p[1] - POLL[j][1]), 0);
    for (let q = 12 / POLL_EVERY; q <= FREEZE / POLL_EVERY; q++) {
      const m = q * POLL_EVERY, tick = Number.isInteger(m), t = minuteBar(m), pk = prog(b, t - 0.14, t);
      if (pk > 0 && pk < 1) { const [qx, qy] = pathAt(POLL, pk * Ln); dot(x, qx, qy, tick ? 7 : 4.5, P.ink, pa); }
      if (tick && b >= t) glow(e, POLL[2][0], POLL[2][1], 50, 0.35 * impact(b, t, 0.08) * pa);
    }
    appleList(x, e, b, a * prog(b, st.t0 - 0.05, st.t0 + 0.08, E.out));
    inferSheet(x, e, b, a * prog(b, st.t0 + 0.15, st.t0 + 0.28, E.out));
    pageSheet(x, e, b, a * prog(b, T7.page, T7.page + 0.08, E.out));
  }
  function appleList(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = AL.p;
    plate(x, X0, Y0, AL.w, AL.h, a);
    text(x, tr("ch01.apple"), X0 + 30, Y0 + 54, { font: SANS(32), color: P.ink, alpha: a, maxW: AL.w - 60 });
    text(x, "/v1/me/recent/played/tracks", X0 + 30, Y0 + 94, { font: MONO(28), color: P.ink2, alpha: a, maxW: AL.w - 60 });
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(X0 + 26, Y0 + 114, AL.w - 52, 2); x.globalAlpha = 1;
    const v = b >= T7.seen2 ? 2 : b >= T7.seen1 ? 1 : 0, tSeen = v === 2 ? T7.seen2 : T7.seen1;
    const list = [...PLAYS.slice(0, v).map((p) => p.title).reverse(), ...RECENT0];
    const sk = v ? prog(b, tSeen, tSeen + 0.12, E.out) : 1, hk = v ? 1 - prog(b, tSeen + 0.2, tSeen + 1.1) : 0;
    const RH = 56, y0 = Y0 + 162;
    x.save(); x.beginPath(); x.rect(X0 + 6, Y0 + 120, AL.w - 12, 3 * RH + 4); x.clip();
    list.slice(0, 4).forEach((title, i) => {
      const y = y0 + (i - (1 - sk)) * RH, hot = v > 0 && i === 0;
      if (hot && hk > 0) { x.globalAlpha = 0.16 * hk * a; x.fillStyle = SIG(); x.fillRect(X0 + 16, y - 38, AL.w - 32, RH - 6); x.globalAlpha = 1; }
      text(x, String(i + 1), X0 + 34, y, { font: MONO(28), color: P.ink2, alpha: a });
      text(x, title, X0 + 80, y, { font: SONG(32), color: hot && hk > 0.3 ? SIG() : P.ink, alpha: a });
      text(x, ARTIST7, X0 + AL.w - 30, y, { font: SANS(28, 500), color: P.ink2, align: "right", alpha: a });
    });
    x.restore();
    if (v > 0) glow(e, X0 + 140, y0 - 12, 100, 0.4 * impact(b, tSeen, 0.25) * a);
    text(x, tr("ch01.newTop"), X0 + 24, Y0 + AL.h - 22, { font: SANS(28), color: P.ink2, alpha: a * prog(b, T7.seen1 + 0.1, T7.seen1 + 0.25), maxW: AL.w - 46 });
  }
  function inferSheet(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = IS.p;
    plate(x, X0, Y0, IS.w, IS.h, a);
    text(x, tr("ch01.infer"), X0 + 30, Y0 + 54, { font: SANS(32), color: P.ink, alpha: a });
    text(x, "inferredPlays", X0 + IS.w - 30, Y0 + 52, { font: MONO(28), color: P.ink2, align: "right", alpha: a });
    const mb = minuteAt7(b);
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(mx(11), AXIS_Y - 1, mx(22) - mx(11), 2);
    for (let m = 11; m <= 22; m++) x.fillRect(mx(m) - 1, AXIS_Y - 6, 2, 12);
    x.globalAlpha = 1;
    for (let m = 12; m <= 21; m += 3) text(x, `:${m}`, mx(m), AXIS_Y + 38, { font: MONO(28), color: P.ink2, align: "center", alpha: a });
    for (let q = 12 / POLL_EVERY; q * POLL_EVERY <= mb; q++) { const m = q * POLL_EVERY; dot(x, mx(m), AXIS_Y, Number.isInteger(m) ? 5 : 3, SIG(), a); }
    if (mb >= 11 && b < T7.out) { x.globalAlpha = 0.45 * a; x.fillStyle = P.ink2; x.fillRect(mx(mb) - 0.6, Y0 + 100, 1.2, AXIS_Y - Y0 - 100); x.globalAlpha = 1; }
    PLAYS.forEach((p, i) => text(x, p.title, X0 + 30, ROW[i] + 11, { font: SONG(30), color: P.ink, alpha: a * prog(b, minuteBar(p.seen), minuteBar(p.seen) + 0.1) }));
    const crossK = prog(b, T7.cross, T7.cross + 0.08);
    note7(x, tr("ch01.win"), mx(W1[0]) - 6, ROW[0] - 32, SIG(), a, win(b, T7.seen1 + 0.05, T7.seen1 + 0.2, T7.shift - 0.1, T7.shift));
    const sk = prog(b, T7.shift, T7.cross, E.io);
    const m0 = lerp(W2[0], W2B[0], sk), m1 = lerp(W2[1], W2B[1], sk), y = lerp(ROW[1], ROW[0], sk);
    if (b >= T7.shift) {
      const str = tr("ch01.shift"), sw = measure(x, str, SANS(28));
      // 英文那行比中文长一倍：跟着括号右端走会冲出牌子右边，所以不越过右内沿
      note7(x, str, Math.min(mx(m1) + 14, X0 + IS.w - 30 - sw), y - 26, P.ink2, a, win(b, T7.shift, T7.shift + 0.08, T7.cross - 0.06, T7.cross));
    }
    bracket7(x, W1[0], W1[1], ROW[0], a * prog(b, T7.seen1, T7.seen1 + 0.08, E.out), crossK < 0.5);
    bracket7(x, W2[0], W2[1], ROW[1], a * prog(b, T7.seen2, T7.seen2 + 0.08, E.out), b < T7.shift);
    if (b >= T7.shift) bracket7(x, m0, m1, y, a, crossK < 0.5, true);
    if (crossK > 0) {
      const x0 = mx(CROSS[0]), x1 = mx(CROSS[1]);
      x.globalAlpha = 0.9 * a * crossK; x.fillStyle = SIG(); x.fillRect(x0, ROW[0] - 24, Math.max(4, x1 - x0), 48); x.globalAlpha = 1;
      glow(e, (x0 + x1) / 2, ROW[0], 70, 0.6 * impact(b, T7.cross, 0.3) * a);
      // 游标此时定格在 FREEZE，英文这行的右端离它很近：起点贴近括号；垫一块牌子色的底，字再长时线从字后面过去
      const lx = mx(W1[1]) + 40;
      note7(x, tr("ch01.cross"), lx, ROW[0] - 32, SIG(), a, prog(b, T7.cross + 0.05, T7.cross + 0.2), X0 + IS.w - 30 - lx);
    }
    const ck = prog(b, T7.chain, T7.chain + 0.3, E.out);
    if (ck > 0) {
      const s0 = EST, e0 = EST + PLAYS[0].len, e1 = e0 + PLAYS[1].len, g = s0 + (e1 - s0) * ck;
      x.globalAlpha = 0.85 * a; x.fillStyle = SIG(); x.fillRect(mx(s0), ROW[0] - 7, mx(Math.min(g, e0)) - mx(s0), 14);
      if (g > e0) { x.fillRect(mx(e0), ROW[1] - 7, mx(g) - mx(e0), 14); x.save(); x.setLineDash([4, 4]); x.strokeStyle = SIG(); x.lineWidth = 1.6; x.beginPath(); x.moveTo(mx(e0), ROW[0] + 8); x.lineTo(mx(e0), ROW[1] - 8); x.stroke(); x.restore(); }
      x.globalAlpha = 1;
      text(x, tr("ch01.chain"), mx(W2[0]) - 22, ROW[1] + 11, { font: SANS(28), color: P.ink2, align: "right", alpha: a * prog(b, T7.chain + 0.2, T7.chain + 0.35) });
    }
  }
  function pageSheet(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = PG.p;
    plate(x, X0, Y0, PG.w, PG.h, a);
    text(x, tr("ch01.page"), X0 + 30, Y0 + 44, { font: SANS(28), color: P.ink2, alpha: a });
    const cx0 = X0 + 30, cy0 = Y0 + 66;
    x.globalAlpha = a; x.fillStyle = P.lilac; rr(x, cx0, cy0, 88, 88, 12); x.fill();
    x.strokeStyle = P.plate; x.lineWidth = 2; for (let j = 1; j <= 3; j++) { x.beginPath(); x.arc(cx0 + 44, cy0 + 44, 10 * j, 0, TAU); x.stroke(); }
    x.globalAlpha = 1;
    text(x, "LIKELY PLAYING", cx0 + 108, cy0 + 28, { font: MONO(28, 600), color: SIG(), alpha: a });
    text(x, PLAYS[1].title, cx0 + 108, cy0 + 78, { font: SONG(34), color: P.ink, alpha: a });
    x.save(); x.globalAlpha = a; x.strokeStyle = P.ink2; x.lineWidth = 1.8; x.setLineDash([6, 4]); rr(x, cx0 + 260, cy0 + 48, 88, 42, 8); x.stroke(); x.restore();
    text(x, `±${MARGIN_S}s`, cx0 + 304, cy0 + 78, { font: MONO(28), color: P.ink2, align: "center", alpha: a });
    glow(e, cx0 + 200, cy0 + 20, 100, 0.35 * impact(b, T7.page, 0.3) * a);
    const lx = X0 + 400, lw = 330, ly = Y0 + 96;
    text(x, "Listening", lx, Y0 + 84, { font: SANS(28, 500), color: P.ink, alpha: a });
    x.globalAlpha = a * 0.5; x.fillStyle = P.steel; x.fillRect(lx, ly, lw, 22); x.globalAlpha = a; x.fillStyle = tone(P.lilac, 0.15); x.fillRect(lx + lw * 0.04, ly, lw * 0.2, 22); x.globalAlpha = 1;
    const hatch = (x0, y0, w, h, k) => {
      if (k <= 0) return;
      x.save(); x.beginPath(); x.rect(x0, y0, w * k, h); x.clip(); x.globalAlpha = a; x.strokeStyle = SIG(); x.lineWidth = 2;
      x.beginPath(); for (let u = x0 - h; u < x0 + w; u += 9) { x.moveTo(u, y0 + h); x.lineTo(u + h, y0); } x.stroke(); x.restore();
      x.globalAlpha = a; x.fillStyle = SIG(); x.fillRect(x0, y0, 1.6, h); x.globalAlpha = 1;
    };
    hatch(lx + lw * 0.5, ly, lw * 0.24, 22, prog(b, T7.page + 0.05, T7.page + 0.2));
    hatch(lx + lw * 0.745, ly, lw * 0.195, 22, prog(b, T7.page + 0.15, T7.page + 0.3));
    hatch(lx, Y0 + 138, 28, 16, 1);
    text(x, "Elsewhere (est.)", lx + 40, Y0 + 156, { font: SANS(28, 500), color: P.ink2, alpha: a });
  }

  NS.clockLabels = clockLabels;
  NS.inferStation = inferStation;
})();
