// 画面只从这里取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
// 这一章画成 Vignelli、Beck 式的地铁线路图：线只走横、竖、45°，转角同一个半径；站是黑圈白点，换乘站是胶囊或白色连桥。
// 线按平台分组配色：GitHub Actions 一组冷色在主轴上方，Workers Builds 一组暖色在下方；这次没改到监视路径的线灰掉，写「本次不停站」。
(() => {
  const { E, prog, clamp, lerp, text, measure, hash } = K;
  const SHA_OLD = "a451a72", SHA_NEW = "cf92f7c";
  // 页面焊进的是上一次 site 部署的提交：7d35661 之后到 a451a72 只改了文档与记忆，site 没有重建（FACTS §10）。
  const SHA_PAGE = "7d35661";
  I18N.add({
    "ch09.title": ["发布", "Release"],
    "ch09.dep": ["发车", "Departures"],
    "ch09.diff": ["这次改到的路径", "Paths this merge touched"],
    "ch09.here": ["您在这里", "You are here"],
    "ch09.lastStop": ["上次 site 停靠", "last site stop"],
    "ch09.n1a": ["合进 main，几条流水线同时发车；", "A merge to main fans out at once;"],
    "ch09.n1b": ["设了监视路径的，没改到就不跑。", "watch paths decide who sits out."],
    "ch09.n2a": ["Workers Builds 并行，不保证先后；", "Builds run in parallel, unordered;"],
    "ch09.n2b": ["所以 Worker 之间的契约只加不改。", "so Worker contracts only ever grow."],
    "ch09.n3a": ["部署成功才刷新 ESA 首页；", "ESA is purged only after the deploy;"],
    "ch09.n3b": ["先等两个域名换好，再通知页面。", "pages hear once both domains switch."],
    "ch09.n4a": ["页面收到 version，自己去问版本：", "Pages hear “version” and re-check:"],
    "ch09.n4b": ["前台弹出提示，后台的旧页自己刷新。", "visible: a prompt; hidden: a reload."],
    "ch09.every": ["每次推到 main", "every push to main"],
    "ch09.jsts": ["改到 JS/TS", "JS/TS changed"],
    "ch09.skip": ["没改到", "untouched"],
    "ch09.noStop": ["本次不停站", "Not stopping this time"],
    "ch09.t.hub": ["Hub 发布", "Hub release"],
    "ch09.t.img": ["上报器镜像", "Reporter images"],
    "ch09.t.purge": ["刷新与通知", "Purge & notify"],
    "ch09.sched": ["另有定时班次：每天两次", "also runs twice daily"],
    "ch09.contract": ["契约只加不改", "Contracts only grow"],
    "ch09.callee": ["被调用方先上线", "callees go live first"],
    "ch09.xfer": ["换乘 · check_run", "Transfer · check_run"],
    "ch09.origin": ["源站 · Production", "Origin · Production"],
    "ch09.j.dep": ["等 lyjw.me 换版", "wait for lyjw.me"],
    "ch09.j.purge1": ["刷新 ESA 首页", "purge ESA home"],
    "ch09.j.purge2": ["再请求一次预热", "then warm it up"],
    "ch09.j.notify": ["等两个域名，再通知", "wait for both, then notify"],
    "ch09.retry": ["失败重试，最长 10 分钟", "retries for up to 10 min"],
    "ch09.esa": ["阿里云 ESA", "Alibaba Cloud ESA"],
    "ch09.cache": ["首页缓存", "cached home page"],
    "ch09.ingress": ["上报入口", "Ingress Worker"],
    "ch09.room": ["推送房间", "Push room"],
    "ch09.bare": ["不带数据", "no payload"],
    "ch09.fg": ["前台", "Foreground"],
    "ch09.bg": ["后台标签页", "Hidden tab"],
    "ch09.reload": ["自己刷新", "reloads itself"],
    "ch09.foot1": ["收不到通知也没关系：", "No push? Pages still ask"],
    "ch09.foot2": ["每 30 分钟、切回前台时各问一次", "every 30 min and on refocus."],
    "ch09.legend": ["图例", "Legend"],
    "ch09.l.station": ["车站", "Station"],
    "ch09.l.xfer": ["换乘站", "Interchange"],
    "ch09.l.term": ["终点站亮灯：这一项成功", "Lit terminal: that job succeeded"],
    "ch09.l.skip": ["本次不停站：没改到监视路径", "Not stopping: no watched path changed"],
    "ch09.l.push": ["推送：上报入口 → 推送房间", "Push: ingress → push room"],
    "ch09.l.film": ["本片也坐 1 号线：docs/explainer/v2/*", "This film rides line 1 too: docs/explainer/v2/*"],
  });
  const tr = (k) => I18N.tr(k);
  const L = (s) => (s.startsWith("ch09.") ? tr(s) : s);
  const TAU = Math.PI * 2;
  let page;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  const SANS = (px, w = 700) => `${w} ${px.toFixed(1)}px "Inter ch09", "Noto Sans SC ch09", sans-serif`;
  const MONO = (px, w = 500) => `${w} ${px.toFixed(1)}px "Geist Mono", "Noto Sans SC ch09", monospace`;
  const C = {
    bg: "#F5F3EE", ink: "#121212", ink2: "#5A5852", rule: "#D9D6CE", gray: "#B6B4AE", grayT: "#8E8C86", white: "#FFFFFF",
    led: "#FFB000", board: "#161616", here: "#D52B1E", clawd: "#D77757", cap: "#1F2D5A", paddle: "#00933C", purge: "#8E3FA8", push: "#6D6E71",
  };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b2, k) => { if (k <= 0) return a; if (k >= 1) return b2; const p = rgb(a), q = rgb(b2); return `rgb(${p.map((v, i) => Math.round(lerp(v, q[i], k))).join(",")})`; };

  // 拍位和 music/ch09.js 的 AT 是同一张表；终点站亮灯的先后照 cf92f7c 上这几项检查的真实完成顺序，只有 site 放在落地那一拍（FACTS §10）。
  const AT = {
    type: 0.125, board: [0.25, 0.875], diff: 0.625, head: 1.0, push: [1.0625, 1.4375], cap: [1.5, 1.9375],
    clawd: 1.25, paddle: 1.75, whistle: 2.0, draw: [2.0, 2.625], gate0: 2.25, gateStep: 0.0625, depart: 3.0,
    term: { collector: 4.5, ingress: 4.75, core: 5.25, ci: 5.5, codeql: 6.5 },
    contract: 6.0, sched: 6.75, whip: [7.625, 8.0],
    land: 8.0, xfer: 8.25, me: 8.5, hop1: 8.625, dep: 8.75, purge: 9.25, warm: 9.45, esa: 9.75, com: 10.0, hop2: 10.125, notify: 10.25, leave: 10.625,
    ing: 11.25, core: 11.5, room: 11.75, ring: 12.0, ask: 12.5, card: 13.0, reload: 13.5, foot: 13.25,
    full: [14.25, 14.75], dive: [16.0, 16.75], fade: [16.0, 16.4], thin: [16.15, 16.7],
  };
  const NAR = { n1: 3.0, n2: 5.65, n3: 8.15, n4: 11.35 };
  const NAR_OUT = { n1: 5.55, n2: 7.55, n3: 10.7, n4: 14.2 };

  // ch08.js 的末帧照抄这里的 Y0、HEAD、COMMITS，两章接缝才能对齐。
  const Y0 = 540;
  const HEAD = [1350, Y0];
  const COMMITS = [1250, 1050, 850, 650, 450, 250, 50];
  // main 的第一父链（GitHub 读回），从 HEAD 往前数。
  const SHAS = [SHA_OLD, "a6323be", "325b131", SHA_PAGE, "f3abe2b", "fcab866", "cc48db2"];
  const LW = 16, RAD = 40, PITCH = 26, GAP = 130, BR = 44;
  const X = { bullet: 1960, gate: 2200, work: 2850, deploy: 3450, term: 4000 };
  const ORIGIN = [4900, Y0], PY = 240, ME = [5600, Y0], ESA = [6100, 840], COM = [6600, 840];
  const PST = { dep: 5600, purge: 6100, notify: 6600 };
  const ING = [7800, Y0], CORE = [8500, Y0], ROOM = [9100, Y0];
  const TERM_R = 20, ING_W = 48, ROOM_R = 44, CAR = 48;
  const PB = [5050, PY], SB = [7920, Y0];
  const WFG = { x: 9500, y: 150, w: 800, h: 370 }, WBG = { x: 9500, y: 640, w: 800, h: 350 };

  const LINES = [
    { id: "hub", k: -4, color: "#00838F", b: "H", name: "ch09.t.hub", skip: true },
    { id: "img", k: -3, color: "#5C6BC0", b: "R", name: "ch09.t.img", skip: true },
    { id: "codeql", k: -2, color: "#0098D4", b: "Q", name: "CodeQL", gate: "ch09.jsts", work: "analyze" },
    { id: "ci", k: -1, color: "#0039A6", b: "C", name: "CI", gate: "ch09.every", work: "check" },
    { id: "site", k: 0, color: "#EE352E", b: "1", name: "site", gate: "shared/*", work: "pnpm build", deploy: "wrangler deploy" },
    { id: "core", k: 1, color: "#FF6319", b: "2", name: "core", gate: "shared/*", work: "typecheck", deploy: "wrangler deploy" },
    { id: "ingress", k: 2, color: "#FCCC0A", b: "3", name: "ingress", gate: "shared/*", work: "typecheck", deploy: "wrangler deploy", dark: true },
    { id: "collector", k: 3, color: "#996633", b: "4", name: "collector", gate: "workers/collector/*", work: "typecheck", deploy: "wrangler deploy" },
    { id: "ai", k: 4, color: "#E37BA8", b: "5", name: "ai", skip: true },
  ];
  const SITE = LINES[4];
  // 各条到站的小节；车在站上停半拍再走（keyframes 的默认停站）。
  const SCHED = {
    codeql: { gate: 3.25, work: 4.5, term: AT.term.codeql },
    ci: { gate: 3.25, work: 4.25, term: AT.term.ci },
    site: { gate: 3.25, work: 4.0, deploy: 5.25 },
    core: { gate: 3.25, work: 3.875, deploy: 4.5, term: AT.term.core },
    ingress: { gate: 3.25, work: 3.75, deploy: 4.25, term: AT.term.ingress },
    collector: { gate: 3.25, work: 3.625, deploy: 4.0, term: AT.term.collector },
  };

  // 折线按同一半径倒圆角后采成密点，按弧长取位置；车和逐段画出都用它。
  function roundPath(pts, r = RAD) {
    const out = [pts[0].slice()];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
      const u = [(bx - ax) / l1, (by - ay) / l1], v = [(cx - bx) / l2, (cy - by) / l2];
      const cr = u[0] * v[1] - u[1] * v[0], th = Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1));
      if (Math.abs(cr) < 1e-6) { out.push([bx, by]); continue; }
      const t = r * Math.tan(th / 2), s = Math.sign(cr);
      const p1 = [bx - u[0] * t, by - u[1] * t], ox = p1[0] - u[1] * s * r, oy = p1[1] + u[0] * s * r;
      const a0 = Math.atan2(p1[1] - oy, p1[0] - ox), n = Math.max(3, Math.ceil((th * r) / 5));
      for (let j = 0; j <= n; j++) { const a = a0 + s * th * (j / n); out.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]); }
    }
    out.push(pts[pts.length - 1].slice());
    const cum = [0];
    for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    const end = pts[pts.length - 1][0];
    return { pts: out, cum, len: cum[cum.length - 1], dx: (px) => cum[cum.length - 1] - (end - px) };
  }
  function ptAt(P, d) {
    const { pts, cum } = P;
    d = clamp(d, 0, P.len);
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const a = cum[i - 1], k = (d - a) / (cum[i] - a || 1), p = pts[i - 1], q = pts[i];
    return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), Math.atan2(q[1] - p[1], q[0] - p[0])];
  }
  function strokeRange(x, P, d0, d1, w, color, alpha = 1, dash = null) {
    if (alpha <= 0 || d1 <= d0) return;
    const { pts, cum } = P;
    x.save(); x.globalAlpha *= alpha; x.strokeStyle = color; x.lineWidth = w; x.lineCap = "butt"; x.lineJoin = "round";
    if (dash) x.setLineDash(dash);
    x.beginPath();
    let started = false;
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] < d0) continue;
      const a = cum[i - 1], c2 = cum[i], p = pts[i - 1], q = pts[i];
      if (!started) { const k = (Math.max(d0, a) - a) / (c2 - a || 1); x.moveTo(lerp(p[0], q[0], k), lerp(p[1], q[1], k)); started = true; }
      if (c2 >= d1) { const k = (d1 - a) / (c2 - a || 1); x.lineTo(lerp(p[0], q[0], k), lerp(p[1], q[1], k)); break; }
      x.lineTo(q[0], q[1]);
    }
    x.stroke(); x.restore();
  }
  function keyframes(depart, stops, d0 = 0) {
    const out = [[depart, d0]];
    stops.forEach(([t, d, e = E.io, dw = 0.125], i) => { out.push([t, d, e]); if (dw && i < stops.length - 1) out.push([t + dw, d, E.lin]); });
    return out;
  }
  function posAt(kf, b) {
    if (b <= kf[0][0]) return kf[0][1];
    for (let i = 1; i < kf.length; i++) if (b <= kf[i][0]) { const [t0, d0] = kf[i - 1], [t1, d1, e = E.io] = kf[i]; return lerp(d0, d1, e(clamp((b - t0) / (t1 - t0 || 1e-9)))); }
    return kf[kf.length - 1][1];
  }

  // 列车在线路标右边 10 px 处出现，停在终点站圈前 10 px：车身不从标底下穿过，也不压站圈和站圈右边的站名。
  const startAfter = (bx) => bx + BR + 10 + CAR;
  const stopBefore = (cx, r) => cx - r - 10 - CAR;
  for (const ln of LINES) {
    const k = ln.k, a = Math.abs(k), yb = Y0 + PITCH * k, yt = Y0 + GAP * k;
    const pts = [[HEAD[0], yb]];
    // 平行的一束往外分：外圈先拐，内圈的拐点往后错 PITCH·(√2 − 1)，斜段之间的垂直间距才和平行段一样。
    if (k) { const xs = 1420 + (4 - a) * PITCH * (Math.SQRT2 - 1); pts.push([xs, yb], [xs + Math.abs(yt - yb), yt]); }
    pts.push([ln.id === "site" ? ME[0] : X.term, yt]);
    ln.y = yt; ln.P = roundPath(pts);
    ln.tg = AT.gate0 + LINES.indexOf(ln) * AT.gateStep;
    const s = SCHED[ln.id];
    if (!s) continue;
    const stops = [[s.gate, ln.P.dx(X.gate)], [s.work, ln.P.dx(X.work)]];
    if (s.deploy) stops.push([s.deploy, ln.P.dx(X.deploy)]);
    if (ln === SITE) stops.push([7.75, ln.P.dx(4600), E.in, 0], [AT.land, ln.P.dx(ORIGIN[0]), E.out], [8.45, ln.P.dx(stopBefore(ME[0], TERM_R))]);
    else stops.push([s.term, ln.P.dx(stopBefore(X.term, TERM_R))]);
    ln.kf = keyframes(AT.depart, stops, ln.P.dx(startAfter(X.bullet)));
  }
  const MAIN = roundPath([[-3200, Y0], [HEAD[0], Y0]]);
  const BRANCH = roundPath([[ORIGIN[0], Y0], [5000, Y0], [5300, 840], [COM[0], 840]]);
  const PLINE = roundPath([[ORIGIN[0], PY], [7300, PY], [7600, Y0], [ING[0], Y0]]);
  const SLINE = roundPath([[ING[0], Y0], [ROOM[0], Y0]]);
  // P 线从源站水平出发，三站都在第一段上，离起点的弧长就是横坐标之差。
  const onP = (px) => px - ORIGIN[0];
  const TP = keyframes(8.3, [[8.7, onP(PST.dep), E.io, 0.25], [AT.purge, onP(PST.purge), E.io, 0.7], [AT.notify, onP(PST.notify), E.io, 0.375], [AT.ing, PLINE.dx(stopBefore(ING[0], ING_W))]], onP(startAfter(PB[0])));
  const TW = keyframes(AT.warm, [[AT.esa, BRANCH.dx(ESA[0]), E.io, 0.0625], [AT.com, BRANCH.dx(stopBefore(COM[0], TERM_R))]]);
  const TS = keyframes(11.3125, [[AT.core, CORE[0] - ING[0], E.io, 0.0625], [AT.room, SLINE.dx(stopBefore(ROOM[0], ROOM_R))]], startAfter(SB[0]) - ING[0]);

  const CAM0 = [960, 540, 1];
  const CB = [2880, 660, 0.59];
  const CC = [6050, 580, 0.58];
  const CD = [8800, 575, 0.62];
  const FULL = [5150, 1975, 0.175];
  // 末帧接 ch10.js 首帧：别的都退掉，只剩 1 号线收成屏幕 y 540 一条整宽 3 px 墨线。
  const FIN = [4250, Y0, 1];
  const drift = (c, dx = 30, k = 1.015) => [c[0] + dx, c[1] + 2, c[2] * k];
  const CAM = [
    [0, CAM0], [AT.draw[0], drift(CAM0, 12, 1.012), E.lin], [AT.draw[1], CB, E.io], [AT.whip[0], drift(CB, 40), E.lin],
    [AT.whip[1], CC, E.io], [10.75, drift(CC, 40), E.lin], [11.25, CD, E.io], [AT.full[0], drift(CD, 40), E.lin],
    [AT.full[1], FULL, E.io], [AT.dive[0], drift(FULL, 20, 1.02), E.lin], [AT.dive[1], FIN, E.io], [17, FIN, E.lin],
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

  function T(x, str, px, py, size, o = {}) {
    return text(x, str, px, py, { ...o, font: o.mono ? MONO(size, o.w || 500) : SANS(size, o.w || 700), color: o.color || C.ink });
  }
  function rrect(x, rx, ry, rw, rh, r) { K.roundRect(x, rx, ry, rw, rh, Math.min(r, rw / 2, rh / 2)); }
  function dot(x, cx, cy, r, lit, color, a = 1, ring = C.ink) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a;
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fillStyle = ring; x.fill();
    x.beginPath(); x.arc(cx, cy, r * 0.6, 0, TAU); x.fillStyle = mix(C.white, color, lit); x.fill();
    x.restore();
  }
  function pulse(x, cx, cy, b, t0, color, r0 = 18, a = 1) {
    const k = prog(b, t0, t0 + 0.3);
    if (k <= 0 || k >= 1 || a <= 0) return;
    x.save(); x.globalAlpha *= a * (1 - k); x.strokeStyle = color; x.lineWidth = 5;
    // 只往外扩 14：再大就扫到站名底边。
    x.beginPath(); x.arc(cx, cy, lerp(r0, r0 + 14, E.out(k)), 0, TAU); x.stroke(); x.restore();
  }
  function bullet(x, cx, cy, r, ch, color, dark, a = 1, size = r * 1.08) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fillStyle = color; x.fill(); x.restore();
    T(x, ch, cx, cy + size * 0.36, size, { color: dark ? C.ink : C.white, align: "center", alpha: a });
  }
  function tick(x, cx, cy, s, color, a = 1, lw = s * 0.22) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); x.moveTo(cx - 0.5 * s, cy); x.lineTo(cx - 0.12 * s, cy + 0.38 * s); x.lineTo(cx + 0.55 * s, cy - 0.45 * s); x.stroke(); x.restore();
  }
  function trainAt(x, P, d, color, a = 1) {
    if (a <= 0) return;
    const [px, py, an] = ptAt(P, d);
    x.save(); x.globalAlpha *= a; x.translate(px, py); x.rotate(an);
    rrect(x, -CAR, -16, 2 * CAR, 32, 16); x.fillStyle = C.white; x.fill(); x.lineWidth = 5; x.strokeStyle = C.ink; x.stroke();
    x.fillStyle = color; rrect(x, 18, -9, 16, 18, 4); x.fill();
    x.restore();
  }
  function blackSign(x, rx, ry, rw, rh, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.fillStyle = C.ink; x.fillRect(rx, ry, rw, rh);
    // 纽约地铁的站牌：黑底上沿下面压一道细白线。
    x.fillStyle = C.white; x.fillRect(rx + 14, ry + 12, rw - 28, 3); x.restore();
  }

  function nar(x, ka, kb, cam, t0, t1, b) {
    const a = win(b, t0, t0 + 0.12, t1 - 0.12, t1);
    if (a <= 0) return;
    const s = 1 / cam[2], px = cam[0] + (110 - 960) * s, y1 = cam[1] + (944 - 540) * s, y2 = cam[1] + (1024 - 540) * s;
    const f = SANS(60 * s, 700), maxW = 1160 * s;
    const w = Math.min(maxW, Math.max(measure(x, tr(ka), f), measure(x, tr(kb), f)));
    blackSign(x, px - 34 * s, y1 - 92 * s, w + 68 * s, 214 * s, a);
    text(x, tr(ka), px, y1, { font: f, color: C.white, reveal: prog(b, t0 + 0.05, t0 + 0.75), dim: 0.18, perChar: true, alpha: a, maxW, narration: true });
    text(x, tr(kb), px, y2, { font: f, color: C.white, reveal: prog(b, t0 + 0.75, t0 + 1.5), dim: 0.18, perChar: true, alpha: a, maxW, narration: true });
  }

  // 翻牌：每格上下两片，先乱翻几下再落定；落定前的字只当纹理。
  const FLAPS = "0123456789ABCDEFHKMNPRSTVWXYZ#:.";
  function flapRow(x, str, x0, y0, cw, chh, t0, step, b, a) {
    [...str].forEach((c, i) => {
      const cx = x0 + i * (cw + 4);
      x.save(); x.globalAlpha *= a;
      x.fillStyle = "#2C2C2C"; x.fillRect(cx, y0, cw, chh / 2);
      x.fillStyle = "#202020"; x.fillRect(cx, y0 + chh / 2, cw, chh / 2);
      x.fillStyle = C.board; x.fillRect(cx, y0 + chh / 2 - 1.5, cw, 3);
      x.restore();
      const ts = t0 + i * step;
      if (c === " " || b < ts - 0.2) return;
      const done = b >= ts, ch = done ? c : FLAPS[Math.floor(hash(i * 13 + Math.floor(b * 64)) * FLAPS.length)];
      T(x, ch, cx + cw / 2, y0 + chh * 0.74, chh * 0.72, { mono: true, w: 600, color: C.led, align: "center", alpha: a, texture: !done });
    });
  }
  function led(x, bx, by, w, h, from, to, tf, b, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.fillStyle = C.board; rrect(x, bx, by, w, h, 10); x.fill();
    x.beginPath(); x.rect(bx + 6, by + 6, w - 12, h - 12); x.clip();
    const k = prog(b, tf, tf + 0.14, E.io), size = h * 0.6, ty = by + h * 0.72;
    if (k < 1) T(x, from, bx + w / 2, ty - k * h, size, { mono: true, w: 600, color: C.led, align: "center", alpha: a * (1 - k) });
    if (k > 0) T(x, to, bx + w / 2, ty + (1 - k) * h, size, { mono: true, w: 600, color: C.led, align: "center", alpha: a * k });
    x.restore();
  }

  function clawdAt(x, cx, bottom, q, pose, a = 1, flip = false) {
    K.clawd(x, cx, bottom, q, { pose, body: C.clawd, eye: C.ink, alpha: a, flip });
  }
  function conductor(x, b, a) {
    if (a <= 0) return;
    const q = 8, cx = 1130, rise = E.outBack(prog(b, AT.clawd, AT.clawd + 0.2)), base = 800 + (1 - rise) * 40;
    const up = b >= AT.paddle, pose = up ? "arms-up" : b > AT.clawd + 0.5 ? "look-right" : "default";
    const aa = a * clamp(rise * 1.5);
    clawdAt(x, cx, base, q, pose, aa);
    const top = base - 12 * q;
    x.save(); x.globalAlpha *= aa;
    x.fillStyle = C.cap; rrect(x, cx - 6 * q, top - 2.6 * q, 11 * q, 2.8 * q, 0.8 * q); x.fill();
    x.fillStyle = C.ink; x.fillRect(cx + 1 * q, top - 0.3 * q, 6.5 * q, 0.9 * q);
    x.fillStyle = C.led; x.fillRect(cx - 0.6 * q, top - 2.0 * q, 1.4 * q, 1.2 * q);
    if (up) {
      const lift = E.outBack(prog(b, AT.paddle, AT.paddle + 0.15)), hx = cx + 8.6 * q, hy = top + 1.6 * q, ex = hx + 1.6 * q, ey = hy - 6 * q * lift;
      x.strokeStyle = C.ink; x.lineWidth = 0.7 * q; x.lineCap = "round";
      x.beginPath(); x.moveTo(hx, hy); x.lineTo(ex, ey); x.stroke();
      x.beginPath(); x.arc(ex, ey - 2.4 * q, 2.6 * q, 0, TAU); x.fillStyle = C.white; x.fill(); x.lineWidth = 0.5 * q; x.stroke();
      x.beginPath(); x.arc(ex, ey - 2.4 * q, 1.5 * q, 0, TAU); x.fillStyle = C.paddle; x.fill();
    }
    const w = prog(b, AT.whistle, AT.whistle + 0.4);
    if (w > 0 && w < 1) {
      x.strokeStyle = C.ink; x.lineWidth = 0.5 * q; x.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const k = clamp(w * 1.6 - i * 0.25), r = (2 + i * 1.6 + 2 * k) * q;
        if (k <= 0) continue;
        x.globalAlpha = aa * (1 - w);
        x.beginPath(); x.arc(cx - 7.5 * q, top + 5 * q, r, Math.PI * 0.8, Math.PI * 1.2); x.stroke();
      }
    }
    x.restore();
  }

  function departure(x, b, sa) {
    if (sa <= 0) return;
    const ta = sa * prog(b, 0.25, 0.45);
    if (ta > 0) {
      blackSign(x, 60, 70, 1280, 112, ta);
      T(x, tr("ch09.title"), 96, 150, 66, { color: C.white, alpha: ta, reveal: prog(b, 0.3, 0.6), perChar: true });
      LINES.forEach((ln, i) => {
        const g = prog(b, ln.tg, ln.tg + 0.1) * (ln.skip ? 1 : 0);
        bullet(x, 910 + i * 50, 126, 22, ln.b, mix(ln.color, C.gray, g), ln.dark && !g, ta * prog(b, 0.4 + i * 0.03, 0.55 + i * 0.03), 28);
      });
      T(x, "main → GitHub Actions · Workers Builds", 96, 226, 30, { mono: true, color: C.ink2, alpha: ta, reveal: prog(b, 0.45, 0.8) });
    }
    const ba = sa * prog(b, 0.2, 0.3);
    if (ba > 0) {
      x.save(); x.globalAlpha *= ba; x.fillStyle = C.board; rrect(x, 60, 262, 840, 184, 10); x.fill(); x.restore();
      T(x, tr("ch09.dep"), 88, 302, 30, { color: C.white, alpha: ba });
      flapRow(x, `18:52 PR #308 → main`, 82, 318, 36, 64, AT.board[0], (AT.board[1] - AT.board[0]) / 20, b, ba);
      T(x, `${SHA_OLD}..${SHA_NEW}  main -> main`, 88, 424, 28, { mono: true, color: C.white, alpha: ba, reveal: prog(b, AT.push[0], AT.push[1]) });
    }
    const da = sa * prog(b, AT.diff, AT.diff + 0.15);
    if (da > 0) {
      const slide = (1 - E.out(prog(b, AT.diff, AT.diff + 0.2))) * 30;
      x.save(); x.globalAlpha *= da; x.translate(0, slide);
      x.fillStyle = C.white; x.fillRect(60, 700, 840, 236); x.lineWidth = 4; x.strokeStyle = C.ink; x.strokeRect(60, 700, 840, 236);
      x.fillStyle = C.ink; x.fillRect(60, 700, 840, 58);
      x.restore();
      T(x, tr("ch09.diff"), 88, 740 + slide, 30, { color: C.white, alpha: da });
      ["shared/site-deployments-types.ts", "workers/collector/…", "workers/core/README.md"].forEach((p, i) =>
        T(x, p, 88, 806 + i * 46 + slide, 28, { mono: true, alpha: da, reveal: prog(b, AT.diff + 0.1 + i * 0.08, AT.diff + 0.25 + i * 0.08) }));
    }
  }
  function headMarks(x, b, a) {
    const ha = a * win(b, AT.head, AT.head + 0.1, 1.45, 1.6);
    if (ha <= 0) return;
    x.save(); x.globalAlpha *= ha; x.strokeStyle = C.here; x.lineWidth = 6;
    x.beginPath(); x.arc(HEAD[0], HEAD[1], 30 + 10 * impact(b, AT.head, 0.12), 0, TAU); x.stroke(); x.restore();
    T(x, tr("ch09.here"), 1392, 614, 32, { color: C.here, alpha: ha });
    T(x, SHA_NEW, 1384, 496, 44, { mono: true, w: 600, alpha: ha });
  }

  function lineColor(ln, b) { return ln.skip ? mix(ln.color, C.gray, prog(b, ln.tg, ln.tg + 0.1)) : ln.color; }
  function lines(x, b, ra) {
    strokeRange(x, MAIN, 0, MAIN.len, LW, C.ink, ra);
    const stub = 70 * prog(b, AT.cap[0], AT.cap[1], E.out);
    for (const ln of [...LINES].sort((p, q) => Number(!p.skip) - Number(!q.skip))) {
      if (ln === SITE) continue;
      const d1 = Math.max(stub, lerp(70, ln.P.len, E.out(prog(b, AT.draw[0] + (4 - Math.abs(ln.k)) * 0.02, AT.draw[1]))) * (b >= AT.draw[0] ? 1 : 0));
      if (ln.skip) {
        const g = prog(b, ln.tg, ln.tg + 0.1);
        strokeRange(x, ln.P, 0, d1, LW, ln.color, ra * (1 - g));
        strokeRange(x, ln.P, 0, d1, LW * 0.75, C.gray, ra * g, [22, 14]);
      } else strokeRange(x, ln.P, 0, d1, LW, ln.color, ra);
    }
    const thin = prog(b, AT.thin[0], AT.thin[1], E.io);
    const sd = Math.max(stub, lerp(70, SITE.P.len, E.out(prog(b, AT.draw[0] + 0.08, AT.draw[1]))) * (b >= AT.draw[0] ? 1 : 0));
    strokeRange(x, BRANCH, 0, BRANCH.len * prog(b, 2.3, AT.draw[1] + 0.1), LW, SITE.color, ra);
    strokeRange(x, SITE.P, 0, sd, lerp(LW, 3, thin), mix(SITE.color, C.ink, thin), 1);
    strokeRange(x, PLINE, 0, PLINE.len * E.out(prog(b, AT.xfer, AT.xfer + 0.35)), LW, C.purge, ra);
    strokeRange(x, SLINE, 0, SLINE.len * E.out(prog(b, AT.ing, AT.ing + 0.2)), LW, C.push, ra);
    // 站外换乘画成虚线：P 线上的三站各连到它们要等、要刷新的那一站。
    const ta = ra * prog(b, AT.xfer + 0.15, AT.xfer + 0.35);
    if (ta > 0) {
      x.save(); x.globalAlpha *= ta; x.strokeStyle = C.purge; x.lineWidth = 5; x.setLineDash([12, 12]);
      for (const [sx, ty] of [[PST.dep, ME[1]], [PST.purge, ESA[1]], [PST.notify, COM[1]]]) { x.beginPath(); x.moveTo(sx, PY + 20); x.lineTo(sx, ty - 22); x.stroke(); }
      x.restore();
    }
  }

  function headCapsule(x, b, ra) {
    const k = prog(b, AT.cap[0], AT.cap[1], E.io), pop = 1 + 0.35 * impact(b, AT.head, 0.12);
    const r = lerp(15, 22, k) * (k > 0 ? 1 : pop), h = 2 * 4 * PITCH * k;
    x.save(); x.globalAlpha *= ra;
    rrect(x, HEAD[0] - r, HEAD[1] - h / 2 - r, 2 * r, h + 2 * r, r); x.fillStyle = C.ink; x.fill();
    const ri = r - 6;
    rrect(x, HEAD[0] - ri, HEAD[1] - h / 2 - ri, 2 * ri, h + 2 * ri, ri); x.fillStyle = C.white; x.fill();
    x.restore();
  }
  function commitStations(x, b, ra, aA) {
    COMMITS.forEach((cx, i) => {
      dot(x, cx, Y0, 15, 0, C.white, ra);
      const t0 = AT.type + (COMMITS.length - 1 - i) * 0.0625, la = aA * prog(b, t0, t0 + 0.1);
      if (la <= 0) return;
      const lx = Math.max(cx, 24 + measure(x, SHAS[i], MONO(28)) / 2);
      T(x, SHAS[i], lx, 598, 28, { mono: true, color: C.ink2, align: "center", alpha: la });
      if (SHAS[i] === SHA_PAGE) T(x, tr("ch09.lastStop"), cx, 634, 28, { w: 500, color: C.ink2, align: "center", alpha: la });
    });
  }

  function lineStations(x, b, ra, ba) {
    const show = prog(b, 2.3, 2.55), ts = prog(b, 2.45, 2.6), la = ba * show;
    T(x, "GitHub Actions", X.bullet - BR, Y0 + GAP * -4 - 100, 48, { mono: true, color: C.ink2, alpha: la });
    T(x, "Workers Builds", X.bullet - BR, Y0 + GAP * 4 + 90, 48, { mono: true, color: C.ink2, alpha: la });
    for (const ln of LINES) {
      const y = ln.y, col = lineColor(ln, b), g = ln.skip ? prog(b, ln.tg, ln.tg + 0.1) : 0;
      const gs = prog(b, ln.tg, ln.tg + 0.08), ga = ba * gs;
      if (ln.skip) {
        dot(x, X.gate, y, 15, 0, C.gray, ra * prog(b, 2.2, 2.35), mix(C.ink, C.gray, g));
        x.save(); x.globalAlpha *= ra * gs; x.fillStyle = C.grayT; x.fillRect(X.gate - 9, y - 2.5, 18, 5); x.restore();
        T(x, tr("ch09.skip"), X.gate - 14, y - 34, 50, { color: C.grayT, alpha: ga, reveal: prog(b, ln.tg, ln.tg + 0.12) });
        T(x, tr("ch09.noStop"), X.work - 14, y - 34, 50, { color: C.grayT, alpha: ga, reveal: prog(b, ln.tg + 0.04, ln.tg + 0.2) });
        dot(x, X.term, y, TERM_R, 0, C.gray, ra * ts, mix(C.ink, C.gray, g));
        T(x, L(ln.name), X.term + 40, y + 18, 52, { color: mix(C.ink, C.grayT, g), alpha: ba * ts });
        continue;
      }
      const s = SCHED[ln.id];
      dot(x, X.gate, y, 15, prog(b, ln.tg, ln.tg + 0.06), col, ra * prog(b, 2.2, 2.35));
      pulse(x, X.gate, y, b, ln.tg, col, 18, ra);
      T(x, L(ln.gate), X.gate - 14, y - 34, ln.gate.startsWith("ch09.") ? 50 : 48, { mono: !ln.gate.startsWith("ch09."), alpha: ga, reveal: prog(b, ln.tg, ln.tg + 0.12) });
      for (const [key, px] of [["work", X.work], ["deploy", X.deploy]]) {
        if (!ln[key]) continue;
        dot(x, px, y, 15, prog(b, s[key], s[key] + 0.06), col, ra * show);
        pulse(x, px, y, b, s[key], col, 18, ra);
        T(x, ln[key], px - 14, y - 34, 48, { mono: true, alpha: la });
      }
      if (ln === SITE) continue;
      dot(x, X.term, y, TERM_R, prog(b, s.term, s.term + 0.06), col, ra * ts);
      pulse(x, X.term, y, b, s.term, col, 22, ra);
      x.save(); x.globalAlpha *= ra * ts; x.fillStyle = C.ink; x.fillRect(X.term + TERM_R, y - 22, 7, 44); x.restore();
      const nw = T(x, L(ln.name), X.term + 40, y + 18, 52, { alpha: ba * ts });
      tick(x, X.term + 40 + nw + 30, y + 2, 34, C.ink, ba * prog(b, s.term, s.term + 0.08));
    }
    // CodeQL 另有定时触发（codeql.yml 的 schedule），画成线路图上的一行小注。
    const q = LINES[2], na = ba * prog(b, AT.sched, AT.sched + 0.15);
    if (na > 0) {
      x.save(); x.globalAlpha *= na; x.strokeStyle = C.ink2; x.lineWidth = 4;
      x.beginPath(); x.arc(3168, q.y - 50, 16, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(3168, q.y - 50); x.lineTo(3168, q.y - 60); x.moveTo(3168, q.y - 50); x.lineTo(3176, q.y - 46); x.stroke(); x.restore();
      T(x, tr("ch09.sched"), 3200, q.y - 34, 48, { w: 500, color: C.ink2, alpha: na, reveal: prog(b, AT.sched, AT.sched + 0.25) });
    }
  }
  function contract(x, b, ra) {
    const a = ra * prog(b, AT.contract, AT.contract + 0.12);
    if (a <= 0) return;
    const bx = 3730, by = 1130, bw = 660, bh = 300, slide = (1 - E.out(prog(b, AT.contract, AT.contract + 0.2))) * 40;
    x.save(); x.globalAlpha *= a; x.translate(0, slide);
    x.fillStyle = C.white; x.fillRect(bx, by, bw, bh); x.lineWidth = 4; x.strokeStyle = C.ink; x.strokeRect(bx, by, bw, bh);
    x.fillStyle = C.ink; x.fillRect(bx, by, bw, 68); x.restore();
    T(x, tr("ch09.contract"), bx + 26, by + 50 + slide, 48, { color: C.white, alpha: a });
    T(x, "shared/state-core.ts", bx + 26, by + 132 + slide, 48, { mono: true, alpha: a });
    T(x, "shared/collector.ts", bx + 26, by + 192 + slide, 48, { mono: true, alpha: a });
    T(x, tr("ch09.callee"), bx + 26, by + 264 + slide, 48, { w: 500, color: C.ink2, alpha: a });
  }

  function landing(x, b, ra, ca) {
    const sa = ra * prog(b, AT.whip[0], AT.whip[0] + 0.2), pa = prog(b, AT.xfer, AT.xfer + 0.15);
    // 源站是 1 号线和 P 线的换乘站，画成伦敦图上那种白色连桥。
    if (pa > 0) {
      x.save(); x.globalAlpha *= sa * pa;
      x.fillStyle = C.ink; x.fillRect(ORIGIN[0] - 16, PY, 32, Y0 - PY);
      x.fillStyle = C.white; x.fillRect(ORIGIN[0] - 10, PY, 20, Y0 - PY);
      x.restore();
    }
    dot(x, ORIGIN[0], Y0, 24, prog(b, AT.land, AT.land + 0.06), SITE.color, sa);
    pulse(x, ORIGIN[0], Y0, b, AT.land, SITE.color, 26, ra);
    dot(x, ORIGIN[0], PY, 24, prog(b, AT.xfer, AT.xfer + 0.1), C.purge, sa * pa);
    T(x, "site Worker", ORIGIN[0] + 52, 404, 52, { alpha: sa });
    T(x, tr("ch09.origin"), ORIGIN[0] + 52, 462, 50, { w: 500, color: C.ink2, alpha: sa });
    const xa = ra * pa;
    if (xa > 0) {
      blackSign(x, 4660, 30, 720, 150, xa);
      T(x, tr("ch09.xfer"), 4690, 98, 50, { color: C.white, alpha: xa });
      T(x, "Workers Builds: site", 4690, 156, 50, { mono: true, color: C.white, alpha: xa });
      tick(x, 5336, 140, 30, C.white, xa);
    }
    // 两个终点站，各挂一块显示屏：答出来的版本。
    dot(x, ME[0], Y0, TERM_R, prog(b, 8.45, 8.5), SITE.color, sa);
    pulse(x, ME[0], Y0, b, 8.45, SITE.color, 22, ra);
    x.save(); x.globalAlpha *= sa; x.fillStyle = C.ink; x.fillRect(ME[0] + TERM_R, Y0 - 22, 7, 44); x.restore();
    T(x, "lyjw.me", ME[0] + 44, Y0 + 20, 56, { alpha: sa });
    led(x, ME[0] + 44, 396, 270, 88, SHA_PAGE, SHA_NEW, AT.me, b, sa);
    dot(x, ESA[0], ESA[1], 18, prog(b, AT.esa, AT.esa + 0.06), SITE.color, sa);
    pulse(x, ESA[0], ESA[1], b, AT.esa, SITE.color, 20, ra);
    T(x, tr("ch09.esa"), ESA[0] - 40, ESA[1] + 82, 52, { alpha: sa });
    dot(x, COM[0], COM[1], TERM_R, prog(b, AT.com - 0.05, AT.com), SITE.color, sa);
    pulse(x, COM[0], COM[1], b, AT.com, SITE.color, 22, ra);
    x.save(); x.globalAlpha *= sa; x.fillStyle = C.ink; x.fillRect(COM[0] + TERM_R, COM[1] - 22, 7, 44); x.restore();
    T(x, "lyjw131.com", COM[0] + 44, COM[1] + 20, 56, { alpha: sa });
    led(x, COM[0] + 44, 696, 270, 88, SHA_PAGE, SHA_NEW, AT.com, b, sa);
    // ESA 手上的首页缓存：刷新时打叉，预热的车到了换成新的一份。
    const px = 5800, py = 650, fresh = prog(b, AT.esa, AT.esa + 0.1), cross = win(b, AT.purge, AT.purge + 0.06, AT.esa - 0.05, AT.esa);
    T(x, tr("ch09.cache"), px - 24, py + 92, 50, { w: 500, color: C.ink2, align: "right", alpha: sa });
    x.save(); x.globalAlpha *= sa;
    x.fillStyle = C.white; x.fillRect(px, py, 140, 150); x.lineWidth = 5; x.strokeStyle = C.ink; x.strokeRect(px, py, 140, 150);
    for (let i = 0; i < 4; i++) { x.fillStyle = mix(C.gray, C.ink, fresh); x.fillRect(px + 20, py + 26 + i * 30, i === 0 ? 100 : 80 - i * 8, 12); }
    if (cross > 0) {
      x.globalAlpha *= cross; x.strokeStyle = C.ink; x.lineWidth = 12; x.lineCap = "butt";
      x.beginPath(); x.moveTo(px - 16, py - 16); x.lineTo(px + 156, py + 166); x.moveTo(px + 156, py - 16); x.lineTo(px - 16, py + 166); x.stroke();
    }
    x.restore();
    tick(x, px + 112, py + 126, 40, C.ink, sa * fresh);
    // P 线：GitHub Actions 的 purge-esa，三站就是工作流里的三个 job。
    const st = [
      [PST.dep, "deployment", AT.dep, ["ch09.j.dep"]],
      [PST.purge, "purge", AT.purge, ["ch09.j.purge1", "ch09.j.purge2"]],
      [PST.notify, "notify", AT.notify, ["ch09.j.notify", "POST /api/internal/site-deployed", "ch09.retry"]],
    ];
    const la = ca * prog(b, AT.xfer + 0.15, AT.xfer + 0.35);
    for (const [sx, job, t0, rows] of st) {
      dot(x, sx, PY, 15, prog(b, t0, t0 + 0.06), C.purge, ra * pa);
      pulse(x, sx, PY, b, t0, C.purge, 18, ra);
      // 三个 job 名顶端对齐成一行，像时刻表的表头；说明照执行顺序往下排。
      T(x, job, sx - 14, PY - 202, 50, { mono: true, w: 600, alpha: la });
      rows.forEach((k, i) => T(x, L(k), sx - 14, PY - 146 + i * 56, 50, k.startsWith("ch09.") ? { w: 500, color: C.ink2, alpha: la } : { mono: true, alpha: la }));
    }
  }
  // 拿放大镜的 Clawd 就是合并后跑的 deploy-check：两个域名先后答出新版本，它各跳一下（FACTS §11）。
  function verifier(x, b, ra) {
    const a = ra * win(b, AT.xfer, AT.xfer + 0.15, 10.5, 10.62);
    if (a <= 0) return;
    const q = 7, cx = 6350, right = b >= 9.9, hy = K.hop(b, AT.hop1, AT.hop1 + 0.2, 34) + K.hop(b, AT.hop2, AT.hop2 + 0.2, 34);
    const base = 690 - hy + (1 - E.outBack(prog(b, AT.xfer, AT.xfer + 0.2))) * 30;
    const pose = hy > 4 ? "arms-up" : right ? "look-right" : "look-left";
    clawdAt(x, cx, base, q, pose, a, !right);
    K.clawdProp(x, "magnifier", cx, base, q, { color: C.ink, alpha: a, flip: !right });
  }

  function notify(x, b, ra) {
    const sa = ra * prog(b, AT.xfer + 0.3, AT.xfer + 0.5);
    x.save(); x.globalAlpha *= sa;
    rrect(x, ING[0] - ING_W, ING[1] - 23, 2 * ING_W, 46, 23); x.fillStyle = C.ink; x.fill();
    rrect(x, ING[0] - ING_W + 6, ING[1] - 17, 2 * ING_W - 12, 34, 17); x.fillStyle = mix(C.white, C.purge, prog(b, AT.ing, AT.ing + 0.06) * 0.35); x.fill();
    x.restore();
    pulse(x, ING[0], ING[1], b, AT.ing, C.purge, 30, ra);
    T(x, tr("ch09.ingress"), ING[0] - 40, 398, 52, { alpha: sa });
    x.save(); x.globalAlpha *= sa; x.lineWidth = 4; x.strokeStyle = C.ink; rrect(x, ING[0] - 48, 420, 712, 60, 10); x.stroke(); x.restore();
    T(x, "internal:site-deployed", ING[0] - 34, 464, 48, { mono: true, alpha: sa });
    tick(x, ING[0] + 630, 448, 30, C.ink, ra * prog(b, AT.ing, AT.ing + 0.08));
    T(x, "Service Binding", 7990, 612, 48, { mono: true, color: C.ink2, alpha: ra * prog(b, AT.ing, AT.ing + 0.2) });
    dot(x, CORE[0], CORE[1], 18, prog(b, AT.core, AT.core + 0.06), C.push, sa);
    pulse(x, CORE[0], CORE[1], b, AT.core, C.push, 20, ra);
    T(x, "StateCore", CORE[0] - 14, 410, 52, { alpha: sa });
    T(x, "broadcastVersion()", CORE[0] - 14, 470, 48, { mono: true, alpha: sa });
    x.save(); x.globalAlpha *= sa;
    x.beginPath(); x.arc(ROOM[0], ROOM[1], ROOM_R, 0, TAU); x.fillStyle = C.ink; x.fill();
    x.beginPath(); x.arc(ROOM[0], ROOM[1], ROOM_R - 7, 0, TAU); x.fillStyle = C.white; x.fill();
    x.fillStyle = C.ink; x.fillRect(ROOM[0] - 20, ROOM[1] - 9, 11, 18);
    x.beginPath(); x.moveTo(ROOM[0] - 9, ROOM[1] - 9); x.lineTo(ROOM[0] + 12, ROOM[1] - 22); x.lineTo(ROOM[0] + 12, ROOM[1] + 22); x.lineTo(ROOM[0] - 9, ROOM[1] + 9); x.closePath(); x.fill();
    x.restore();
    T(x, tr("ch09.room"), ROOM[0] - 14, 400, 52, { alpha: sa });
    T(x, "LivePushRoom", ROOM[0] - 14, 460, 48, { mono: true, alpha: sa });
    // 喇叭的声波只在 ±0.55 弧度、半径 120 以内：上面是房间的名字，下面是 version 牌。
    for (let i = 0; i < 3; i++) {
      const k = prog(b, AT.ring + i * 0.08, AT.ring + 0.45 + i * 0.08);
      if (k <= 0 || k >= 1) continue;
      x.save(); x.globalAlpha *= ra * (1 - k); x.strokeStyle = C.ink; x.lineWidth = 7; x.lineCap = "round";
      x.beginPath(); x.arc(ROOM[0], ROOM[1], lerp(58, 120, E.out(k)), -0.55, 0.55); x.stroke(); x.restore();
    }
    const va = ra * prog(b, AT.ring, AT.ring + 0.1);
    if (va > 0) {
      x.save(); x.globalAlpha *= va; x.fillStyle = C.ink; rrect(x, ROOM[0] - 60, 604, 252, 68, 34); x.fill(); x.restore();
      T(x, "version", ROOM[0] + 66, 652, 50, { mono: true, w: 600, color: C.white, align: "center", alpha: va });
      T(x, tr("ch09.bare"), ROOM[0] - 54, 732, 48, { w: 500, color: C.ink2, alpha: va });
    }
    browser(x, b, WFG, "lyjw.me", false, ra);
    browser(x, b, WBG, "lyjw131.com", true, ra);
    const fa = ra * prog(b, AT.foot, AT.foot + 0.15);
    T(x, tr("ch09.foot1"), WBG.x, 1052, 48, { w: 500, color: C.ink2, alpha: fa, reveal: prog(b, AT.foot, AT.foot + 0.3) });
    T(x, tr("ch09.foot2"), WBG.x, 1110, 48, { w: 500, color: C.ink2, alpha: fa, reveal: prog(b, AT.foot + 0.25, AT.foot + 0.6) });
  }
  function browser(x, b, w, host, hidden, ra) {
    const a = ra * prog(b, AT.xfer + 0.3, AT.xfer + 0.5);
    if (a <= 0) return;
    const frame = hidden ? C.ink2 : C.ink, top = w.y + 64;
    const la = T(x, tr(hidden ? "ch09.bg" : "ch09.fg"), w.x, w.y - 24, 48, { alpha: a });
    x.save(); x.globalAlpha *= a;
    rrect(x, w.x, w.y, w.w, w.h, 18); x.fillStyle = C.white; x.fill();
    x.save(); x.clip();
    x.fillStyle = hidden ? "#E2E0D9" : "#ECEAE4"; x.fillRect(w.x, w.y, w.w, 64);
    for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(w.x + 32 + i * 28, w.y + 32, 9, 0, TAU); x.fillStyle = C.gray; x.fill(); }
    const card = hidden ? 0 : 200 * E.out(prog(b, AT.card, AT.card + 0.25));
    const wipe = hidden ? prog(b, AT.reload, AT.reload + 0.3, E.io) : 0;
    for (let i = 0; i < 5; i++) {
      const yy = top + 24 + card + i * 52;
      const fresh = hidden && yy < top + wipe * (w.h - 64);
      x.fillStyle = fresh ? "#CFCCC4" : "#E4E1DA";
      x.fillRect(w.x + 26, yy, (i % 2 ? 0.55 : 0.82) * (w.w - 52), 30);
    }
    if (wipe > 0 && wipe < 1) { x.fillStyle = C.ink; x.fillRect(w.x, top + wipe * (w.h - 64) - 3, w.w, 6); }
    x.restore();
    rrect(x, w.x, w.y, w.w, w.h, 18); x.lineWidth = 5; x.strokeStyle = frame; x.stroke();
    x.restore();
    T(x, host, w.x + 120, w.y + 46, 48, { mono: true, color: hidden ? C.ink2 : C.ink, alpha: a });
    // 窗框往外闪只扩 16：再大就碰到窗口上方的标签。
    const pv = ra * prog(b, AT.ring + 0.15, AT.ring + 0.22);
    if (pv > 0) {
      const pw = 225, px = w.x + w.w - 18 - pw;
      x.save(); x.globalAlpha *= pv; x.fillStyle = C.ink; rrect(x, px, w.y + 6, pw, 52, 26); x.fill(); x.restore();
      T(x, "version", px + pw / 2, w.y + 48, 46, { mono: true, w: 600, color: C.white, align: "center", alpha: pv });
      const k = prog(b, AT.ring + 0.15, AT.ring + 0.45);
      if (k > 0 && k < 1) {
        const g = lerp(4, 16, E.out(k));
        x.save(); x.globalAlpha *= ra * (1 - k); x.strokeStyle = frame; x.lineWidth = 6;
        rrect(x, w.x - g, w.y - g, w.w + 2 * g, w.h + 2 * g, 18 + g); x.stroke(); x.restore();
      }
    }
    const qa = ra * prog(b, AT.ask, AT.ask + 0.1);
    if (qa > 0) {
      x.save(); x.globalAlpha *= qa; x.fillStyle = C.white; x.fillRect(w.x + 8, w.y + w.h - 70, w.w - 16, 62); x.restore();
      T(x, `GET /api/version → ${SHA_NEW}`, w.x + 24, w.y + w.h - 24, 48, { mono: true, alpha: qa, reveal: prog(b, AT.ask, AT.ask + 0.2) });
    }
    if (hidden) {
      const ra2 = ra * prog(b, AT.reload, AT.reload + 0.1);
      if (ra2 > 0) {
        const cx = w.x + la + 54, cy = w.y - 40, sp = prog(b, AT.reload, AT.reload + 0.5) * TAU;
        x.save(); x.globalAlpha *= ra2; x.strokeStyle = C.ink; x.lineWidth = 5; x.lineCap = "round";
        x.beginPath(); x.arc(cx, cy, 15, sp, sp + 4.9); x.stroke();
        const ex = cx + 15 * Math.cos(sp + 4.9), ey = cy + 15 * Math.sin(sp + 4.9);
        x.beginPath(); x.moveTo(ex - 8, ey - 2); x.lineTo(ex, ey); x.lineTo(ex + 2, ey - 9); x.stroke(); x.restore();
        T(x, tr("ch09.reload"), cx + 32, w.y - 24, 48, { alpha: ra2 });
      }
      return;
    }
    const k = prog(b, AT.card, AT.card + 0.25, E.out);
    if (k <= 0) return;
    const cy = top + 10, ch = 190 * k;
    x.save(); x.globalAlpha *= ra; x.beginPath(); x.rect(w.x + 14, cy, w.w - 28, ch); x.clip();
    x.fillStyle = C.white; x.fillRect(w.x + 14, cy, w.w - 28, 190); x.lineWidth = 4; x.strokeStyle = C.ink; x.strokeRect(w.x + 16, cy + 2, w.w - 32, 186);
    x.fillStyle = "#EFEDE7"; x.fillRect(w.x + 18, cy + 4, w.w - 36, 52);
    x.restore();
    if (k < 0.6) return;
    const ca = ra * prog(b, AT.card + 0.15, AT.card + 0.25);
    T(x, "UPDATE", w.x + 34, cy + 44, 46, { mono: true, w: 600, alpha: ca });
    T(x, "DISMISS ×", w.x + w.w - 34, cy + 44, 46, { mono: true, color: C.ink2, align: "right", alpha: ca });
    x.save(); x.globalAlpha *= ca; x.beginPath(); x.arc(w.x + 44, cy + 98, 8, 0, TAU); x.fillStyle = C.gray; x.fill(); x.restore();
    T(x, "New version", w.x + 64, cy + 114, 48, { w: 500, alpha: ca });
    x.save(); x.globalAlpha *= ca; x.fillStyle = "#EFEDE7"; x.fillRect(w.x + 30, cy + 132, 486, 50); x.restore();
    T(x, `${SHA_PAGE} → ${SHA_NEW}`, w.x + 42, cy + 170, 46, { mono: true, alpha: ca });
    x.save(); x.globalAlpha *= ca; x.fillStyle = C.ink; rrect(x, w.x + w.w - 228, cy + 128, 196, 56, 8); x.fill(); x.restore();
    T(x, "Reload", w.x + w.w - 130, cy + 170, 46, { w: 600, color: C.white, align: "center", alpha: ca });
  }

  // 车停到终点站前就淡掉，让出终点站那盏灯。
  function trains(x, b, ra) {
    const run = (P, kf, color) => {
      const t0 = kf[0][0], t1 = kf[kf.length - 1][0];
      if (b >= t0) trainAt(x, P, posAt(kf, b), color, ra * prog(b, t0, t0 + 0.06) * (1 - prog(b, t1, t1 + 0.1)));
    };
    for (const ln of LINES) if (ln.kf) run(ln.P, ln.kf, ln.color);
    run(PLINE, TP, C.purge);
    run(BRANCH, TW, SITE.color);
    run(SLINE, TS, C.push);
  }
  function lineBullets(x, b, ra) {
    for (const ln of LINES) {
      const g = ln.skip ? prog(b, ln.tg, ln.tg + 0.1) : 0;
      bullet(x, X.bullet, ln.y, BR, ln.b, lineColor(ln, b), ln.dark && !g, ra * prog(b, 2.15, 2.35));
    }
    bullet(x, PB[0], PB[1], BR, "P", C.purge, false, ra * prog(b, AT.xfer, AT.xfer + 0.15));
    bullet(x, SB[0], SB[1], BR, "S", C.push, false, ra * prog(b, AT.ing, AT.ing + 0.2));
  }

  function legend(x, b, ra) {
    const a = ra * prog(b, AT.full[0] + 0.15, AT.full[1]);
    if (a <= 0) return;
    blackSign(x, 0, 1650, 4400, 480, a);
    T(x, tr("ch09.title"), 120, 2010, 300, { color: C.white, alpha: a });
    T(x, "main → GitHub Actions · Workers Builds", 0, 2420, 170, { mono: true, color: C.ink2, alpha: a });
    const sym = [
      ["ch09.l.station", (cy, al) => dot(x, 200, cy, 70, 0, C.white, al)],
      ["ch09.l.xfer", (cy, al) => { x.save(); x.globalAlpha *= al; rrect(x, 80, cy - 70, 240, 140, 70); x.fillStyle = C.ink; x.fill(); rrect(x, 102, cy - 48, 196, 96, 48); x.fillStyle = C.white; x.fill(); x.restore(); }],
      ["ch09.l.term", (cy, al) => { dot(x, 160, cy, 80, 1, SITE.color, al); x.save(); x.globalAlpha *= al; x.fillStyle = C.ink; x.fillRect(250, cy - 90, 34, 180); x.restore(); }],
      ["ch09.l.skip", (cy, al) => { x.save(); x.globalAlpha *= al; x.strokeStyle = C.gray; x.lineWidth = 60; x.setLineDash([90, 56]); x.beginPath(); x.moveTo(0, cy); x.lineTo(400, cy); x.stroke(); x.restore(); }],
      ["ch09.l.push", (cy, al) => bullet(x, 200, cy, 110, "S", C.push, false, al, 170)],
    ];
    const row = (i) => a * prog(b, AT.full[1] - 0.2 + i * 0.05, AT.full[1] - 0.05 + i * 0.05);
    sym.forEach(([k, draw], i) => {
      const base = 2740 + i * 280, al = row(i);
      if (al <= 0) return;
      draw(base - 58, al);
      T(x, tr(k), 520, base, 170, { w: 500, alpha: al });
    });
    T(x, tr("ch09.legend"), 5000, 1860, 190, { alpha: a });
    const cols = [["GitHub Actions", 5000, [LINES[3], LINES[2], { b: "P", color: C.purge, name: "ch09.t.purge" }, LINES[1], LINES[0]]], ["Workers Builds", 7700, LINES.slice(4)]];
    for (const [head, cx, list] of cols) {
      T(x, head, cx, 2160, 170, { mono: true, color: C.ink2, alpha: a });
      list.forEach((ln, i) => {
        const base = 2440 + i * 260, ra2 = row(i);
        bullet(x, cx + 110, base - 58, 110, ln.b, ln.skip ? C.gray : ln.color, ln.dark && !ln.skip, ra2, 170);
        T(x, L(ln.name), cx + 270, base, 170, { w: ln.skip ? 500 : 700, color: ln.skip ? C.grayT : C.ink, alpha: ra2 });
      });
    }
    T(x, tr("ch09.l.film"), 5000, 3880, 170, { w: 500, color: C.ink2, alpha: row(6) });
    T(x, "PLATE 09 · RELEASE", 10150, 4120, 170, { mono: true, color: C.ink2, align: "right", alpha: row(7) });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
    const hitS = Math.max(impact(b, AT.land, 0.12), impact(b, 0, 0.1) * 0.5);
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.01 * hitS), rot: 0 };
    G.setCam(cam);
    G.clear([0.913, 0.896, 0.855]);
    const x = page.begin();
    x.fillStyle = C.bg; x.fillRect(0, 0, G.W, G.H);
    page.cam(cam);

    const ra = 1 - prog(b, AT.fade[0], AT.fade[1]);
    // 各段的字只在自己的机位和最后的整张图里出现，免得半截字露在下一个机位的边上。
    const inE = prog(b, AT.full[0] + 0.1, AT.full[1]);
    const sa = ra * clamp(1 - prog(b, 2.0, 2.3) + inE);
    const ba = ra * clamp(1 - prog(b, AT.whip[0], AT.whip[0] + 0.25) + inE);
    const ca = ra * clamp(1 - prog(b, 10.75, 11.0) + inE);
    lines(x, b, ra);
    headCapsule(x, b, ra);
    commitStations(x, b, ra, sa);
    lineStations(x, b, ra, ba);
    landing(x, b, ra, ca);
    notify(x, b, ra);
    trains(x, b, ra);
    lineBullets(x, b, ra);
    departure(x, b, sa);
    headMarks(x, b, ra);
    contract(x, b, ra * clamp(1 - prog(b, 7.5, 7.7) + inE));
    conductor(x, b, ra * (1 - prog(b, 2.6, 2.8)));
    verifier(x, b, ra);
    legend(x, b, ra);
    nar(x, "ch09.n1a", "ch09.n1b", CB, NAR.n1, NAR_OUT.n1, b);
    nar(x, "ch09.n2a", "ch09.n2b", CB, NAR.n2, NAR_OUT.n2, b);
    nar(x, "ch09.n3a", "ch09.n3b", CC, NAR.n3, NAR_OUT.n3, b);
    nar(x, "ch09.n4a", "ch09.n4b", CD, NAR.n4, NAR_OUT.n4, b);

    G.composite(page.upload(), { mode: G.MODE.normal });
    const sh = hitS * 4;
    f.post = {
      bloom: 0, threshold: 1.2, halation: 0, grain: 0, vignette: 0, ca: 0,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]],
      zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
    };
  }

  window.CHAPTERS.push({
    id: "ch09", title: "ch.09", bars: 17,
    async init() {
      page = G.layer("bg");
      await Promise.all([
        document.fonts.load(`700 40px "Noto Sans SC ch09"`, "发布"), document.fonts.load(`500 40px "Noto Sans SC ch09"`, "发布"),
        document.fonts.load(`700 40px "Inter ch09"`, "Release"), document.fonts.load(`500 40px "Inter ch09"`, "Release"),
      ]);
    },
    render,
  });
})();
