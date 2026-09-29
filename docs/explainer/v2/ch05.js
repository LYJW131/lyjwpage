// 第 05 章 · 电报线（浏览器这一侧：推送、防旧、按自己的钟、在线人数、取数节奏，FACTS §5）。18 小节，暗底示波器，全是 2D。
// 一整条横向的示波图：横轴是时间，只画先后、不标毫秒（机位之间的「≈」是省掉的一段）。
// 那条 signal 色的线就是这一页的 /ws 电报线：进来的电报是往下的脉冲、掉出一张小纸条；页面发出去的（hidden）是往上的脉冲。
// 六个机位，镜头在强拍上甩：
//   A 解析（0–5）：HTML 一格一格解析，head 里的小脚本 2:0 接上电报线，先到的三封进托盘；3:2 hydrate，useLiveEvents 接手、按顺序重放
//   B 到站（5–8.5）：listening-now 到站写进 SWR，5:2「正在听」翻面；8:0 慢回来的旧轮询撞上时间戳闸门
//   C 进度（8.5–10.5）：线上没消息，进度条按 positionMs + (now − observedAt) 自己走，歌词占位逐块亮
//   D 两只钟（10.5–12.5）：首帧用源站的 servedAt，挂载后换访客自己的钟；12:0 到点，卡片上的在线点自己熄灭
//   E 数人头（12.5–15）：同一根线数 connections 和 online；13:2 切到后台只发一声 hidden，线不断（live 绿只在这一段，只给人数）
//   F 到货表（15–17.3）：可滞后卡在 due = updatedAt + cadenceMs + LAG_GRACE_MS 才去取；推送连着时实时卡只留兜底
// 17.3 起拉远看整条示波线，17.72 起脉冲拉平成一条直线（最后一帧：屏幕 y = 540、全宽、signalD、4 px），18:0 硬切第 06 章的纸面地铁图。
// 线上面是源站那一边（推送房间、源站的钟），线下面是浏览器这一边。
// 配乐锚点（章内小节）是下面的 AT，music/ch05.js 的 story 按同一组小节落拍；改时间先对这两处和 SCRIPT.md。
// 画面只从 AT 取时间，不读配乐的音符表（score.js 加载失败时 f.hit / f.env 全是 0，这一章照样画得出来）。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, envelope, stamp, spark,
    roundRect, sheet, pathAt, pathLen } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch05.title": ["电报线", "The live wire"],
    "ch05.parse": ["HTML 逐格解析", "HTML, parsed cell by cell"],
    "ch05.tray": ["托盘", "Tray"],
    "ch05.takeover": ["接过这根线", "takes over the wire"],
    "ch05.replay": ["按顺序重放", "replayed in order"],
    "ch05.n1a": ["页面还在解析，电报线已经接上；", "The wire is up before parsing ends;"],
    "ch05.n1b": ["先到的电报放进托盘。", "early telegrams wait in a tray."],
    "ch05.n2a": ["页面活过来，", "Once the page comes alive,"],
    "ch05.n2b": ["托盘里的按顺序重放。", "the tray replays in order."],
    "ch05.swr": ["浏览器缓存", "browser cache"],
    "ch05.np": ["Now Playing", "Now Playing"], // 站点卡片上的原文
    "ch05.n3a": ["推送一到，写进缓存，", "A push lands in the cache"],
    "ch05.n3b": ["卡片当场翻面。", "and the card flips on the spot."],
    "ch05.poll": ["慢回来的轮询", "a late poll"],
    "ch05.gate": ["时间戳闸门", "timestamp gate"],
    "ch05.n4a": ["慢回来的旧数据，", "Late, older data"],
    "ch05.n4b": ["盖不掉新的。", "can't overwrite newer data."],
    "ch05.quiet": ["线上没有消息", "nothing on the wire"],
    "ch05.browserClock": ["浏览器的钟", "browser clock"],
    "ch05.macClock": ["Mac 的钟", "Mac clock"],
    "ch05.onlyPlaying": ["只在播放时往前走", "advances only while playing"],
    "ch05.lyrics": ["歌词（占位）", "lyrics (placeholder)"],
    "ch05.n5a": ["进度条自己往前走：", "The progress bar runs by itself,"],
    "ch05.n5b": ["浏览器按自己的钟算。", "on the browser's own clock."],
    "ch05.silent": ["源站什么也没说", "the origin says nothing"],
    "ch05.originClock": ["源站的钟", "Origin clock"],
    "ch05.firstOnly": ["只管首帧", "first frame only"],
    "ch05.visitorClock": ["访客浏览器的钟", "Visitor's browser clock"],
    "ch05.afterMount": ["挂载后接手", "takes over after mount"],
    "ch05.mount": ["挂载", "mount"],
    "ch05.due": ["截止", "due"],
    "ch05.dueAt": ["在线点的截止时间", "the dot's deadline"],
    "ch05.offline": ["Offline", "Offline"], // 站点卡片上的原文
    "ch05.n6a": ["在线点到时自己熄灭，", "The online dot goes out on time,"],
    "ch05.n6b": ["不用等源站开口。", "without waiting for the server."],
    "ch05.stillUp": ["只报一声 hidden，线不断", "one “hidden”, and the wire stays up"],
    "ch05.bg": ["切到后台", "sent to the background"],
    "ch05.onlineNow": ["Online now", "Online now"], // 站点页脚的原文
    "ch05.census": ["数人头", "Headcount"],
    "ch05.rowOpen": ["开着的页面（含后台）", "pages open, background too"],
    "ch05.rowWatch": ["正在看的页面", "pages being watched"],
    "ch05.n7a": ["同一根线数两种人：", "One wire counts two crowds:"],
    "ch05.n7b": ["开着的，和正在看的。", "pages open, and pages watched."],
    "ch05.table": ["预期到货表", "Expected deliveries"],
    "ch05.colCard": ["可滞后卡", "Lag-tolerant card"],
    "ch05.colFetch": ["去取", "fetch at"],
    "ch05.rServer": ["服务器", "Server"],
    "ch05.rChart": ["GitHub 贡献图", "GitHub chart"],
    "ch05.rRings": ["活动圆环", "Activity rings"],
    "ch05.backoff": ["过了 due 还没到：从 15 秒起退避，封顶 min(节奏, 5 分钟)", "Missed it? Retry from 15 s, backing off to min(cadence, 5 min)"],
    "ch05.pushUp": ["推送连着时", "While the push is up"],
    "ch05.pushNet": ["实时卡的轮询只留兜底", "realtime polls drop to a safety net"],
    "ch05.pushList1": ["在听列表 · 在看", "Listening list · Watching"],
    "ch05.pushList2": ["在玩 · 奖杯", "Playing · Trophies"],
    "ch05.n8a": ["可滞后的卡，", "Lag-tolerant cards fetch"],
    "ch05.n8b": ["算好下一次到货再去取。", "when the next delivery is due."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, paper, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出

  // ---------- 时间表（章内小节）：画面和 music/ch05.js 的 story 共用这一组 ----------
  const AT = {
    connect: 2.0, tele: [2.25, 2.75, 3.25], hydrate: 3.5, replay: [3.75, 4.0, 4.25],
    hero: 5.0, flip: 5.5, poll: 7.0, bounce: 8.0,
    mount: 10.75, deadline: 12.0,
    hidden: 13.5, count: 14.0,
    rows: [15.25, 15.5, 15.75], formula: 16.0, safety: 16.5,
    pull: 17.3, flat: 17.72,
  };
  // 歌词占位逐块亮的拍位（music/ch05.js 的 LYR 是同一组，按拍写）
  const LYR = [0, 0.5, 1, 1.5, 2, 3].map((beat) => beat / 4);

  // ---------- 横轴：光点（此刻）在世界 x 上的位置。每个机位一段，机位之间跳过「≈」 ----------
  const TY = 400; // 电报线的世界 y
  const ST = { A: 0, B: 2300, C: 4600, D: 6900, E: 9200, F: 11500 };
  const SEG = [[1, 5, 110, 1790], [5, 8.5, 2430, 4090], [8.5, 10.5, 4730, 6390], [10.5, 12.5, 7030, 8690], [12.5, 15, 9330, 10990], [15, 17.5, 11630, 13290]];
  const BREAKS = [2110, 4410, 6710, 9010, 11310];
  function beamX(b) {
    if (b < SEG[0][0]) return SEG[0][2];
    for (const [b0, b1, x0, x1] of SEG) if (b < b1) return lerp(x0, x1, (b - b0) / (b1 - b0));
    return SEG[SEG.length - 1][3];
  }
  const X_CONNECT = beamX(AT.connect);
  // 电报：amp > 0 往下（进来），< 0 往上（页面发出去的）
  const BLIPS = [
    { b: AT.tele[0], amp: 46, label: "online" },
    { b: AT.tele[1], amp: 46, label: "desktop" },
    { b: AT.tele[2], amp: 46, label: "playing-now" },
    { b: AT.hero, amp: 112, hero: true },
    { b: AT.hidden, amp: -74 },
  ].map((p) => ({ ...p, x: beamX(p.b) }));

  // ---------- 机位：[小节, [x, y, zoom, rot], 进入这一段的缓动] ----------
  const cam0 = (s) => [ST[s] + 960, 540, 1, 0];
  const push = (s, k = 1.012) => [ST[s] + 975, 540, k, 0];
  const OVER = [6750, TY, 0.14, 0]; // 拉远：整条示波线横贯全屏
  const CAM = [
    [0, [960, 552, 1.035, 0]],
    [1.0, cam0("A"), E.out],
    [4.78, push("A"), E.lin],
    [5.0, cam0("B"), E.io],
    [8.28, push("B"), E.lin],
    [8.5, cam0("C"), E.io],
    [10.28, push("C"), E.lin],
    [10.5, cam0("D"), E.io],
    [12.28, push("D"), E.lin],
    [12.5, cam0("E"), E.io],
    [14.78, push("E"), E.lin],
    [15.0, cam0("F"), E.io],
    [AT.pull, push("F"), E.lin],
    [17.55, OVER, E.io],
    [18.0, OVER, E.lin],
  ];
  const PLATE_RECT = [-240, -120, 13740, 1200];

  // ---------- 电报线：轴、脉冲、光点 ----------
  function pulse(dx, amp) {
    if (dx < -40 || dx > 120) return 0;
    const g = (c, w) => Math.exp(-(((dx - c) / w) ** 2));
    return amp * (g(0, 8) - 0.34 * g(24, 13) + 0.12 * g(52, 16));
  }
  // 到站那一下弹一弹再稳住；拉平时一起收成 0
  // 拉远时脉冲按屏幕放大一些，整条线上几次到站看得清，再一起拉平
  const ampOf = (p, b, flatK) => (b < p.b ? 0 : p.amp * E.spring(clamp((b - p.b) / 0.3)) * flatK * lerp(1, 3, prog(b, AT.pull, 17.55)));
  function traceY(u, b, flatK) {
    let y = TY;
    for (const p of BLIPS) { const a = ampOf(p, b, flatK); if (a) y += pulse(u - p.x, a); }
    return y;
  }
  function tracePts(x0, x1, b, flatK) {
    const xs = [x0, x1];
    for (const p of BLIPS) if (b >= p.b) for (let u = p.x - 40; u <= p.x + 120; u += 2) if (u > x0 && u < x1) xs.push(u);
    xs.sort((a, c) => a - c);
    return xs.map((u) => [u, traceY(u, b, flatK)]);
  }
  function strokePts(x, pts, lw, color, alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }

  function wire(x, e, b, f, zoom, cA) {
    const bone = css("bone");
    const flatK = 1 - prog(b, AT.flat, 17.9, E.io);
    const endK = prog(b, AT.pull, 17.55);
    const lw = lerp(2.4, 4, endK) / zoom; // 拉远时按屏幕线宽画，最后一帧是 4 px
    // 时间轴：0:0 整条亮一下再暗下去；拉平时退掉，只剩电报线
    const sweep = lerp(120, 2000, prog(b, 0, 0.85, E.io));
    const axA = (0.22 + 0.45 * impact(b, 0, 0.3)) * (1 - prog(b, 17.55, 17.8));
    if (axA > 0.01) {
      line(x, -200, TY, 13600, TY, 1.2 / Math.min(1, zoom), bone, axA);
      // 机位之间省掉的那段时间：两道斜杠
      const brA = 0.6 * clamp(axA / 0.22) * cA;
      for (const bx of BREAKS) for (const dx of [-7, 7]) line(x, bx + dx - 8, TY + 16, bx + dx + 8, TY - 16, 1.6 / Math.min(1, zoom), bone, brA);
    }
    // 开场扫线：一个亮点扫过去，身后留一段慢慢褪掉的余辉
    if (b < 1.0) {
      const hx = sweep, tail = 520;
      const grd = x.createLinearGradient(hx - tail, 0, hx, 0);
      grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, css("signalD"));
      x.save(); x.globalAlpha = 1 - prog(b, 0.8, 0.98); x.strokeStyle = grd; x.lineWidth = 2.4; x.beginPath(); x.moveTo(hx - tail, TY); x.lineTo(hx, TY); x.stroke(); x.restore();
      glow(e, hx, TY, 46, 0.9 * (1 - prog(b, 0.8, 0.98)));
    }
    if (b < AT.connect) return;
    // 电报线本身：接上那一刻起，画到光点（此刻）为止；拉平后往两头伸出画面
    const ext = prog(b, 17.8, 17.96, E.io);
    const x0 = lerp(X_CONNECT, -6000, ext), x1 = lerp(beamX(b), 19500, ext);
    const pts = tracePts(x0, x1, b, flatK);
    strokePts(e, pts, lw * 3.6, "rgb(240,150,105)", 0.28 + 0.12 * f.env("kick"));
    strokePts(x, pts, lw, css("signalD"), 0.95);
    // 电报到站的闪光
    for (const p of BLIPS) {
      const k = impact(b, p.b, 0.14);
      if (k > 0.02) glow(e, p.x, TY + p.amp * 0.85, p.hero ? 120 : 70, k * (p.hero ? 1 : 0.7));
    }
    // 光点：此刻。跟着踩镲（电键）轻轻一抖
    const hA = 1 - prog(b, AT.pull, 17.5);
    if (hA > 0) {
      const bx = beamX(b), by = traceY(bx, b, flatK) + f.hit("hat", 0.035) * 5;
      glow(e, bx, by, 34, 0.95 * hA);
      x.save(); x.globalAlpha = hA; x.fillStyle = css("ember"); x.beginPath(); x.arc(bx, by, 4.5, 0, TAU); x.fill(); x.restore();
    }
  }

  // ---------- 小件 ----------
  // 电报纸条（白卡，画在 paper 层）：Mono 写事件名
  function slip(d, cx, cy, label, a = 1) {
    if (a <= 0) return;
    const w = Math.max(124, K.measure(d, label, FONT.mono(30, 500)) + 40), h = 52;
    sheet(d, cx - w / 2, cy - h / 2, w, h, { alpha: a, shadow: 12 });
    text(d, label, cx, cy + 11, { font: FONT.mono(30, 500), color: css("pink"), align: "center", alpha: a });
  }
  function nar(x, key, px, py, r, a = 1) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: 60, maxW: 1040, color: css("bone"), reveal: r, alpha: a });
  }
  function arrowHead(x, tx, ty, ang, color, alpha = 1, s = 14) {
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
    x.lineTo(tx + Math.cos(ang + 2.6) * s, ty + Math.sin(ang + 2.6) * s);
    x.lineTo(tx + Math.cos(ang - 2.6) * s, ty + Math.sin(ang - 2.6) * s);
    x.fill(); x.restore();
  }
  function dashLine(x, x1, y1, x2, y2, w, color, alpha, dash = [8, 7]) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash);
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }
  // 封面占位：Apple 目录给的封面在片中不画真图，一块带同心圆的方片
  function cover(x, px, py, s, a) {
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink"); x.fillRect(px, py, s, s);
    x.strokeStyle = css("bone"); x.lineWidth = 1.6; x.strokeRect(px, py, s, s);
    for (let j = 1; j <= 4; j++) { x.globalAlpha = a * (0.55 - j * 0.1); x.beginPath(); x.arc(px + s * 0.5, py + s * 0.52, s * 0.11 * j, 0, TAU); x.stroke(); }
    x.restore();
  }

  // 推送房间 LivePushRoom：和第 03 章同一根天线（圆里一个叉，发射时左右各三道短弧）。
  // 小屋符号是四个库里的「实时 · StateHub」，不能拿来画推送房间
  function mast(x, mx, my, a, pulse = 0) {
    if (a <= 0) return;
    const bone = css("bone");
    x.save(); x.globalAlpha = a; x.strokeStyle = bone; x.lineWidth = 2.2;
    x.fillStyle = css("ink2"); x.beginPath(); x.arc(mx, my, 18, 0, TAU); x.fill(); x.stroke(); x.restore();
    line(x, mx - 12, my - 12, mx + 12, my + 12, 1.6, bone, a); line(x, mx - 12, my + 12, mx + 12, my - 12, 1.6, bone, a);
    if (pulse > 0.02) for (let j = 1; j <= 3; j++) {
      x.save(); x.globalAlpha = a * pulse * (1 - j * 0.22); x.strokeStyle = css("signalD"); x.lineWidth = 2.2;
      x.beginPath(); x.arc(mx, my, 18 + j * 12, -0.6, 0.6); x.stroke(); x.beginPath(); x.arc(mx, my, 18 + j * 12, Math.PI - 0.6, Math.PI + 0.6); x.stroke();
      x.restore();
    }
  }
  const burst = (b, at) => (b < at ? 0 : Math.exp(-(b - at) * BARs * 1.8));

  // ========== A 解析 ==========
  const CELLS = [["<html>", 110, 235], ["<head>", 241, 366], ["<script>", 372, 530], ["</head>", 536, 678], ["<body>", 684, 809], ["<main>", 815, 940], ["…", 946, 1000], ["</html>", 1006, 1148]];
  const STRIP = { y: 694, h: 72 };
  const TRAY = { x: 730, y: 522, w: 250, h: 60 };
  const trayAt = (i) => [TRAY.x + TRAY.w / 2 + i * 8, TRAY.y + TRAY.h - 26 - i * 12];
  const LIVE_BOX = { x: 1250, y: 494, w: 470, h: 92 };
  const boxSlot = (i) => [1576 + i * 50, LIVE_BOX.y + LIVE_BOX.h / 2];
  const HYD_X = beamX(AT.hydrate);
  function stationA(x, d, e, b, cA) {
    const bone = css("bone"), ash = css("ash");
    // 标题
    const titleA = prog(b, 0.15, 0.7, E.out) * cA;
    text(x, "05", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: titleA });
    text(x, tr("ch05.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.3, 0.9), alpha: titleA });
    text(x, "wss://…/ws", 292, 226, { font: FONT.mono(28), color: ash, reveal: prog(b, 0.45, 1.0), alpha: titleA });
    line(x, 110, 262, 110 + 990 * prog(b, 0.35, 1.2, E.outExpo), 262, 1.4, bone, 0.6 * titleA);

    // HTML 一长条：光点走过一格，这一格才算解析完（一格一格亮）
    const sk = prog(b, 0.55, 1.05, E.io);
    text(x, tr("ch05.parse"), 110, 680, { font: FONT.cjk(28, 600), color: ash, alpha: sk * cA });
    const bx = beamX(b), alive = impact(b, AT.hydrate, 0.2);
    CELLS.forEach(([tag, x0, x1], i) => {
      const a = prog(sk, i / CELLS.length, (i + 1) / CELLS.length) * cA;
      if (a <= 0) return;
      const done = b >= 1 && bx >= x1 - 2;
      const hot = i === 2 && b >= AT.connect;
      const col = hot ? css("signalD") : bone;
      x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(x0, STRIP.y, x1 - x0, STRIP.h); x.restore();
      K.rect(x, x0, STRIP.y, x1 - x0, STRIP.h, hot ? 2.4 : 1.6, col, a * (done ? 0.95 : 0.35));
      text(x, tag, (x0 + x1) / 2, STRIP.y + 46, { font: FONT.mono(30, 500), color: done ? col : ash, align: "center", alpha: a * (done ? 1 : 0.5) });
      if (done && alive > 0.02) fillRect(x, x0, STRIP.y, x1 - x0, STRIP.h, bone, 0.12 * alive * a);
    });
    // 此刻：一根竖的发丝线把光点和解析位置连起来
    const nowA = win(b, 1.0, 1.15, 3.5, 3.7) * cA;
    if (nowA > 0) {
      line(x, bx, TY + 14, bx, STRIP.y + STRIP.h + 14, 1.2, bone, 0.18 * nowA);
      polyline(x, [[bx - 9, STRIP.y + STRIP.h + 24], [bx, STRIP.y + STRIP.h + 12], [bx + 9, STRIP.y + STRIP.h + 24]], 1, 2, css("signalD"), nowA);
    }
    // <script> 那一格跑完就接上电报线
    const plug = prog(b, 1.86, AT.connect, E.out);
    if (plug > 0) {
      line(x, X_CONNECT, STRIP.y, X_CONNECT, lerp(STRIP.y, TY, plug), 2.2, css("signalD"), cA);
      text(x, 'new WebSocket("…/ws?visible=1")', X_CONNECT + 18, TY - 42, { font: FONT.mono(28, 500), color: css("signalD"), reveal: prog(b, AT.connect, 2.4), alpha: cA });
    }

    // 托盘（EarlyLiveSocket.queue）
    const tA = prog(b, 1.9, 2.15) * cA;
    if (tA > 0) {
      polyline(x, [[TRAY.x, TRAY.y], [TRAY.x, TRAY.y + TRAY.h], [TRAY.x + TRAY.w, TRAY.y + TRAY.h], [TRAY.x + TRAY.w, TRAY.y]], 1, 2.2, bone, tA);
      const lw = K.measure(x, tr("ch05.tray"), FONT.cjk(28, 600));
      text(x, tr("ch05.tray"), TRAY.x, TRAY.y + TRAY.h + 40, { font: FONT.cjk(28, 600), color: ash, alpha: tA });
      text(x, "· queue", TRAY.x + lw + 10, TRAY.y + TRAY.h + 40, { font: FONT.mono(28, 500), color: ash, alpha: tA });
    }
    // 三封电报：从脉冲尖上掉进托盘；hydrate 之后按到达顺序一封一封飞进 useLiveEvents
    BLIPS.slice(0, 3).forEach((p, i) => {
      if (b < p.b) return;
      const [tx, ty] = trayAt(i), [sx, sy] = boxSlot(i);
      const r0 = AT.replay[i] - 0.18, r1 = AT.replay[i];
      if (b < r0) {
        const k = prog(b, p.b, p.b + 0.2, E.io);
        const px = lerp(p.x, tx, k), py = lerp(TY + p.amp + 18, ty, k) - Math.sin(k * Math.PI) * 16;
        slip(d, px, py, p.label, prog(b, p.b, p.b + 0.04) * cA);
      } else if (b < r1 + 0.02) {
        const k = prog(b, r0, r1, E.io);
        const px = lerp(tx, sx, k), py = lerp(ty, sy, k) - Math.sin(k * Math.PI) * 70;
        slip(d, px, py, p.label, (1 - prog(k, 0.85, 1)) * cA);
      }
    });
    // hydrate：一道竖刻线；useLiveEvents 接手
    const hk = prog(b, 3.38, 3.55, E.out);
    if (hk > 0) {
      dashLine(x, HYD_X, 300, HYD_X, lerp(300, 790, hk), 1.8, bone, 0.85 * cA);
      text(x, "hydrate", HYD_X + 14, 802, { font: FONT.mono(30, 500), color: bone, alpha: prog(b, 3.45, 3.6) * cA });
      text(x, tr("ch05.takeover"), HYD_X + 18, TY - 42, { font: FONT.cjk(28, 600), color: ash, alpha: prog(b, 3.55, 3.75) * cA });
    }
    const boxA = prog(b, 3.5, 3.68, E.out) * cA;
    if (boxA > 0) {
      const { x: bx0, y: by0, w, h } = LIVE_BOX;
      x.save(); x.globalAlpha = boxA; x.fillStyle = css("ink2"); x.fillRect(bx0, by0, w, h); x.restore();
      K.rect(x, bx0, by0, w, h, 2.2, bone, boxA);
      text(x, "useLiveEvents", bx0 + 24, by0 + 57, { font: FONT.mono(32, 500), color: bone, alpha: boxA });
      for (let i = 0; i < 3; i++) {
        const [sx, sy] = boxSlot(i), on = b >= AT.replay[i];
        const fl = impact(b, AT.replay[i], 0.12);
        if (on) fillRect(x, sx - 20, sy - 20, 40, 40, css("signalD"), boxA);
        K.rect(x, sx - 20, sy - 20, 40, 40, 1.6, on ? css("signalD") : bone, boxA * (on ? 1 : 0.5));
        text(x, String(i + 1), sx, sy + 10, { font: FONT.mono(30, 600), color: on ? css("ink") : ash, align: "center", alpha: boxA });
        if (fl > 0.02) glow(e, sx, sy, 60, 0.7 * fl);
      }
      text(x, tr("ch05.replay"), bx0, by0 + h + 40, { font: FONT.cjk(28, 600), color: ash, alpha: prog(b, 3.75, 3.95) * cA });
    }
    // 旁白
    nar(x, "ch05.n1a", 110, 944, prog(b, 1.05, 1.9), win(b, 1.0, 1.1, 3.35, 3.5) * cA);
    nar(x, "ch05.n1b", 110, 1024, prog(b, 1.9, 2.6), win(b, 1.0, 1.1, 3.35, 3.5) * cA);
    nar(x, "ch05.n2a", 110, 944, prog(b, 3.5, 3.85), win(b, 3.5, 3.6, 4.8, 4.98) * cA);
    nar(x, "ch05.n2b", 110, 1024, prog(b, 3.85, 4.4), win(b, 3.5, 3.6, 4.8, 4.98) * cA);
  }

  // ========== B 到站 ==========
  const SWR = { x: 2550, y: 480, w: 760, h: 340 };
  const SWR_ROWS = [["/api/status/desktop", "10:35:02"], ["/api/status/listening/now", null], ["/api/status/playing/now", "—"]];
  const rowY = (i) => SWR.y + 136 + i * 60;
  const NP = { x: 3420, y: 446, w: 760, h: 270 };
  const GATE = { x: 3345, y0: 776, y1: 896 };
  const POLL_Y = 836, CONTACT = GATE.x + 44;
  const HERO_PATH = [[BLIPS[3].x, TY + 128], [BLIPS[3].x + 30, 600], [SWR.x + 40, rowY(1) - 10]];
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI"; // 数据源的原文：主角这次换歌（全片同一首）
  function npCard(x, box, title, flipK, a, o = {}) {
    if (a <= 0) return;
    const { x: px, y: py, w, h } = box, bone = css("bone"), ash = css("ash");
    // 卡片翻面：纵向压扁再弹开（2D）
    const s = flipK > 0 && flipK < 1 ? Math.abs(Math.cos(flipK * Math.PI)) : 1;
    x.save(); x.translate(0, py + h / 2); x.scale(1, Math.max(0.02, s)); x.translate(0, -(py + h / 2));
    x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(px, py, w, h); x.restore();
    x.save(); x.translate(0, py + h / 2); x.scale(1, Math.max(0.02, s)); x.translate(0, -(py + h / 2));
    K.rect(x, px, py, w, h, 2.2, o.hot ? css("signalD") : bone, a);
    const cs = o.coverS ?? 150;
    text(x, tr("ch05.np"), px + 30, py + 44, { font: FONT.mono(28, 500), color: ash, alpha: a });
    x.save(); x.globalAlpha = a; x.fillStyle = css("signalD"); x.beginPath(); x.arc(px + w - 30, py + 34, 7, 0, TAU); x.fill(); x.restore();
    cover(x, px + 30, py + 62, cs, a);
    const tx = px + 30 + cs + 36;
    text(x, title, tx, py + 62 + (o.titleDy ?? 58), { font: FONT.cjk(o.titlePx ?? 46, 600), color: bone, alpha: a });
    text(x, ARTIST, tx, py + 62 + (o.titleDy ?? 58) + (o.artistDy ?? 46), { font: FONT.sans(o.artistPx ?? 30, 500), color: ash, alpha: a });
    if (o.bar !== false) {
      const by = py + h - 36;
      line(x, tx, by, px + w - 30, by, 5, bone, 0.22 * a);
      line(x, tx, by, lerp(tx, px + w - 30, o.progress ?? 0.29), by, 5, css("signalD"), a);
    }
    x.restore();
  }
  function stationB(x, d, e, s, b, cA) {
    const bone = css("bone"), ash = css("ash");
    // SWR 缓存（白卡）
    const cardA = prog(b, 4.95, 5.12, E.out) * cA;
    if (cardA > 0) {
      const { x: px, y: py, w, h } = SWR;
      sheet(d, px, py, w, h, { alpha: cardA });
      text(d, "SWR", px + 32, py + 58, { font: FONT.mono(36, 600), alpha: cardA });
      text(d, tr("ch05.swr"), px + 32 + K.measure(d, "SWR", FONT.mono(36, 600)) + 16, py + 56, { font: FONT.cjk(30, 600), color: css("graphite"), alpha: cardA });
      text(d, "receivedAt", px + w - 32, py + 56, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: cardA });
      line(d, px + 28, py + 80, px + w - 28, py + 80, 1.4, css("pink"), cardA);
      const wk = prog(b, 5.12, 5.3);
      SWR_ROWS.forEach(([key, val], i) => {
        const y = rowY(i), hero = i === 1;
        if (hero && wk > 0) fillRect(d, px + 20, y - 38, w - 40, 54, css("signal"), 0.14 * (1 - prog(b, 5.6, 6.4)) * cardA + 0.08 * impact(b, 5.12, 0.2));
        text(d, key, px + 32, y, { font: FONT.mono(28, 500), color: hero && wk > 0 ? css("signal") : css("pink"), alpha: cardA });
        if (hero) {
          if (wk <= 0) text(d, "10:31:40", px + w - 32, y, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: cardA });
          else text(d, "10:35:17", px + w - 32, y, { font: FONT.mono(28, 600), color: css("signal"), align: "right", reveal: wk, perChar: true, alpha: cardA });
        } else text(d, val, px + w - 32, y, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: cardA });
        line(d, px + 28, y + 22, px + w - 28, y + 22, 1, css("pink"), 0.16 * cardA);
      });
      text(d, "mutate(path, data, {revalidate: false})", px + 32, py + h - 26, { font: FONT.mono(28), color: css("graphite"), reveal: prog(b, 5.2, 5.6), alpha: cardA });
    }
    // 广播从线上面的推送房间来（第 03 章那根天线），穿过电报线掉进这一页
    const rA = win(b, 4.88, 5.0, 8.3, 8.45) * cA;
    if (rA > 0) {
      mast(x, BLIPS[3].x, 200, rA, burst(b, 4.9));
      text(x, "LivePushRoom", BLIPS[3].x + 70, 210, { font: FONT.mono(28, 500), color: bone, alpha: rA });
      dashLine(x, BLIPS[3].x, 222, BLIPS[3].x, lerp(222, TY - 10, prog(b, 4.9, AT.hero, E.in)), 1.6, css("signalD"), 0.8 * rA);
    }
    // 主角：listening-now 从脉冲尖上掉出来，落进缓存那一行
    const hk = prog(b, AT.hero, AT.hero + 0.12, E.in);
    if (b >= AT.hero && b < AT.hero + 0.16) {
      const L = pathLen(HERO_PATH), [ex, ey] = pathAt(HERO_PATH, hk * L);
      envelope(x, ex, ey, 62, css("signalD"), { lw: 2.4, fill: css("ink2"), alpha: (1 - prog(b, AT.hero + 0.12, AT.hero + 0.16)) * cA });
      spark(e, null, [ex, ey - 4], null, { t: G.t, size: 0.8 });
    }
    text(x, "listening-now", BLIPS[3].x + 18, TY - 66, { font: FONT.mono(28, 500), color: css("signalD"), alpha: win(b, AT.hero, AT.hero + 0.08, 8.3, 8.45) * cA });
    // 写完缓存，火花跳到卡片上：翻面
    if (b >= 5.3 && b < AT.flip + 0.05) {
      const k = prog(b, 5.3, AT.flip, E.io);
      const px = lerp(SWR.x + SWR.w - 20, NP.x + 260, k), py = lerp(rowY(1) - 10, NP.y + 110, k) - Math.sin(k * Math.PI) * 120;
      spark(e, null, [px, py], null, { t: G.t, size: 0.7 });
    }
    const npA = prog(b, 4.95, 5.15, E.out) * cA;
    const fk = prog(b, AT.flip - 0.12, AT.flip + 0.12);
    npCard(x, NP, fk >= 0.5 || b >= AT.flip + 0.12 ? NEW : OLD, fk, npA, { hot: b >= AT.flip && b < 6.6, progress: b >= AT.flip ? 0.02 + 0.03 * prog(b, AT.flip, 8.5) : 0.71, coverS: 172, titlePx: 52, titleDy: 64, artistPx: 32, artistDy: 50 });
    if (b >= AT.flip) glow(e, NP.x + 116, NP.y + NP.h / 2, 100, 0.22 * impact(b, AT.flip, 0.18));

    // 时间戳闸门
    const gA = prog(b, 6.9, 7.1) * cA;
    const hit = impact(b, AT.bounce, 0.12);
    if (gA > 0) {
      const col = hit > 0.1 ? css("signalD") : bone;
      // 一根带斜纹的闸杆，横在旧轮询回来的路上
      x.save(); x.globalAlpha = gA; x.fillStyle = css("ink2"); x.fillRect(GATE.x - 11, GATE.y0, 22, GATE.y1 - GATE.y0);
      x.beginPath(); x.rect(GATE.x - 11, GATE.y0, 22, GATE.y1 - GATE.y0); x.clip();
      x.strokeStyle = col; x.lineWidth = 3; x.beginPath();
      for (let yy = GATE.y0 - 20; yy < GATE.y1 + 20; yy += 16) { x.moveTo(GATE.x - 12, yy + 12); x.lineTo(GATE.x + 12, yy - 12); }
      x.stroke(); x.restore();
      K.rect(x, GATE.x - 11, GATE.y0, 22, GATE.y1 - GATE.y0, 2, col, gA);
      line(x, GATE.x - 22, GATE.y1, GATE.x + 22, GATE.y1, 3, col, gA);
      if (hit > 0.02) glow(e, GATE.x, POLL_Y, 90, 0.8 * hit);
      text(x, "guardPolled", GATE.x + 26, GATE.y1 + 28, { font: FONT.mono(28, 500), color: ash, alpha: gA });
      const bounced = b >= AT.bounce;
      text(x, bounced ? "10:35:12 < 10:35:17" : "≥ 10:35:17", GATE.x + 26, GATE.y1 + 66, { font: FONT.mono(28, 600), color: css("signalD"), alpha: gA });
      text(x, tr("ch05.gate"), GATE.x + 26, GATE.y1 + 104, { font: FONT.cjk(28, 600), color: bone, alpha: gA });
    }
    // 慢回来的旧轮询：一只小信封慢慢爬到闸门，撞上就被弹开
    if (b >= AT.poll && b < AT.bounce + 0.45) {
      const inK = prog(b, AT.poll, AT.bounce, E.lin);
      const out = prog(b, AT.bounce, AT.bounce + 0.42);
      const ex = out > 0 ? CONTACT + 260 * E.out(out) : lerp(4330, CONTACT, inK);
      const ey = POLL_Y + 200 * out * out;
      const a = (1 - prog(out, 0.6, 1)) * cA;
      envelope(x, ex, ey, 84, css("ash"), { lw: 2.4, fill: css("ink2"), rot: 1.1 * out, alpha: a });
      if (out <= 0) {
        text(x, "10:35:12", ex, POLL_Y - 40, { font: FONT.mono(28, 500), color: ash, align: "center", alpha: a });
        text(x, tr("ch05.poll"), ex, POLL_Y - 80, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: a });
        // 身后一串虚线：它是很早以前发出去的
        dashLine(x, ex + 46, POLL_Y, Math.min(ex + 46 + 600, 4400), POLL_Y, 1.4, ash, 0.5 * a, [4, 10]);
      } else {
        polyline(x, [[GATE.x + 20, POLL_Y - 18], [GATE.x + 52, POLL_Y + 14]], 1, 4, css("signalD"), (1 - out) * cA);
        polyline(x, [[GATE.x + 52, POLL_Y - 18], [GATE.x + 20, POLL_Y + 14]], 1, 4, css("signalD"), (1 - out) * cA);
      }
    }
    // 旁白
    nar(x, "ch05.n3a", 2410, 944, prog(b, 5.0, 5.45), win(b, 5.0, 5.1, 6.85, 7.0) * cA);
    nar(x, "ch05.n3b", 2410, 1024, prog(b, 5.45, 5.95), win(b, 5.0, 5.1, 6.85, 7.0) * cA);
    nar(x, "ch05.n4a", 2410, 944, prog(b, 7.0, 7.4), win(b, 7.0, 7.1, 8.3, 8.45) * cA);
    nar(x, "ch05.n4b", 2410, 1024, prog(b, 7.5, 8.0), win(b, 7.0, 7.1, 8.3, 8.45) * cA);
  }

  // ========== C 进度 ==========
  const NPC = { x: 4710, y: 470, w: 1040, h: 390 };
  const LY_W = [[70, 116, 58, 146, 92, 120], [104, 80, 132, 60, 112, 90]];
  function stationC(x, e, b, f, cA) {
    const bone = css("bone"), ash = css("ash");
    text(x, tr("ch05.quiet"), 4730, TY - 42, { font: FONT.cjk(28, 600), color: ash, alpha: prog(b, 8.5, 8.7) * cA });
    const a = prog(b, 8.45, 8.62, E.out) * cA;
    if (a <= 0) return;
    const { x: px, y: py, w, h } = NPC;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(px, py, w, h); x.restore();
    K.rect(x, px, py, w, h, 2.4, bone, a);
    text(x, tr("ch05.np"), px + 40, py + 50, { font: FONT.mono(28, 500), color: ash, alpha: a });
    x.save(); x.globalAlpha = a; x.fillStyle = css("signalD"); x.beginPath(); x.arc(px + w - 40, py + 40, 8, 0, TAU); x.fill(); x.restore();
    cover(x, px + 40, py + 76, 200, a);
    const tx = px + 280;
    text(x, NEW, tx, py + 128, { font: FONT.cjk(56, 600), color: bone, alpha: a });
    text(x, ARTIST, tx, py + 178, { font: FONT.sans(34, 500), color: ash, alpha: a });
    // 歌词占位：两行横条，逐块亮（不写真歌词）
    text(x, tr("ch05.lyrics"), tx, py + 222, { font: FONT.cjk(28, 600), color: ash, alpha: 0.8 * a });
    LY_W.forEach((ws, row) => {
      let cx = tx;
      ws.forEach((bw, i) => {
        const at = 9 + row + LYR[i], on = b >= at;
        const k = impact(b, at, 0.15);
        x.save(); x.globalAlpha = a * (on ? 1 : 0.28); x.fillStyle = on ? css("signalD") : bone;
        roundRect(x, cx, py + 244 + row * 34, bw, 14, 7); x.fill(); x.restore();
        if (k > 0.03) glow(e, cx + bw / 2, py + 251 + row * 34, 50, 0.5 * k);
        cx += bw + 14;
      });
    });
    // 进度条：位置 + (现在 − 观测时间)，一秒走一秒
    const sec = 62 + clamp(b - 8.5, 0, 1.75) * BARs; // 镜头离开前停在最后一个读数上
    const bx0 = px + 40, bx1 = px + w - 40, by = py + h - 44;
    const fr = sec / 213;
    line(x, bx0, by, bx1, by, 6, bone, 0.22 * a);
    line(x, bx0, by, lerp(bx0, bx1, fr), by, 6, css("signalD"), a);
    const hx = lerp(bx0, bx1, fr);
    x.save(); x.globalAlpha = a; x.fillStyle = css("ember"); x.beginPath(); x.arc(hx, by, 9, 0, TAU); x.fill(); x.restore();
    glow(e, hx, by, 40, 0.6 * a);
    text(x, `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`, bx0, by + 36, { font: FONT.mono(28, 500), color: bone, alpha: a });
    // 公式：竖着写，now 和 observedAt 各标一只钟
    const fx = 5830, fk = (i) => prog(b, 8.6 + i * 0.15, 8.8 + i * 0.15) * cA;
    const tickP = f.hit("clock", 0.08);
    text(x, "positionMs", fx, 560, { font: FONT.mono(40, 600), color: css("signalD"), alpha: fk(0) });
    text(x, "+ ( now", fx, 624, { font: FONT.mono(40, 600), color: css("signalD"), alpha: fk(1) });
    text(x, "− observedAt )", fx, 688, { font: FONT.mono(40, 600), color: css("signalD"), alpha: fk(2) });
    const nowW = K.measure(x, "+ ( now", FONT.mono(40, 600)), obsW = K.measure(x, "− observedAt )", FONT.mono(40, 600));
    miniClock(x, fx + nowW + 40, 610, 16, b, fk(1));
    text(x, tr("ch05.browserClock"), fx + nowW + 66, 622, { font: FONT.cjk(28, 600), color: bone, alpha: fk(1) });
    if (fk(1) > 0 && tickP > 0.02) glow(e, fx + nowW + 40, 610, 40, 0.5 * tickP * fk(1));
    miniClock(x, fx + obsW + 30, 674, 16, 9, fk(2));
    text(x, tr("ch05.macClock"), fx + obsW + 56, 686, { font: FONT.cjk(28, 600), color: ash, alpha: fk(2) });
    text(x, tr("ch05.onlyPlaying"), fx, 752, { font: FONT.cjk(28, 600), color: ash, alpha: prog(b, 9.3, 9.5) * cA });
    text(x, 'state === "playing"', fx, 792, { font: FONT.mono(28), color: ash, alpha: prog(b, 9.35, 9.55) * cA });
    // 旁白
    nar(x, "ch05.n5a", 4710, 944, prog(b, 8.55, 9.0), win(b, 8.5, 8.6, 10.3, 10.45) * cA);
    nar(x, "ch05.n5b", 4710, 1024, prog(b, 9.0, 9.6), win(b, 8.5, 8.6, 10.3, 10.45) * cA);
  }
  function miniClock(x, cx, cy, r, t, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = css("bone"); x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke();
    const ang = t * 1.7 - Math.PI / 2;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ang) * r * 0.75, cy + Math.sin(ang) * r * 0.75); x.moveTo(cx, cy); x.lineTo(cx, cy - r * 0.5); x.stroke(); x.restore();
  }

  // ========== D 两只钟 ==========
  // 线上面是源站那一边，线下面是浏览器这一边：源站的钟在上，访客的钟在下
  const CLK = { sr: 112, sx: 7200, sy: 215, r: 140, bx: 7640, y: 640 };
  const DESK = { x: 8150, y: 540, w: 610, h: 180 };
  function clockFace(x, cx, cy, r, minute, a, o = {}) {
    if (a <= 0) return;
    const bone = css("bone");
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    x.strokeStyle = bone; x.lineWidth = 2.8; x.stroke(); x.restore();
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * TAU - Math.PI / 2, big = i % 5 === 0, r0 = r - (big ? 26 : 15);
      line(x, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8), big ? 2.4 : 1, bone, (big ? 0.85 : 0.35) * a);
    }
    const hour = 10 + minute / 60, ha = (hour / 12) * TAU - Math.PI / 2, ma = (minute / 60) * TAU - Math.PI / 2;
    line(x, cx, cy, cx + Math.cos(ha) * r * 0.48, cy + Math.sin(ha) * r * 0.48, 7, bone, a);
    line(x, cx, cy, cx + Math.cos(ma) * r * 0.76, cy + Math.sin(ma) * r * 0.76, 3.6, o.hand || bone, a);
    x.save(); x.globalAlpha = a; x.fillStyle = o.hand || bone; x.beginPath(); x.arc(cx, cy, 7, 0, TAU); x.fill(); x.restore();
  }
  function stationD(x, e, b, cA) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 10.45, 10.62, E.out) * cA;
    if (a <= 0) return;
    const { sr, sx, sy, r, bx, y } = CLK;
    // 源站的钟（线上面）：停在首屏交出去那一刻（servedAt），只管首帧；挂载后就不再用它
    const handed = prog(b, AT.mount, AT.mount + 0.15);
    clockFace(x, sx, sy, sr, 3, a * (1 - 0.5 * handed));
    text(x, tr("ch05.originClock"), sx + sr + 30, sy - 24, { font: FONT.cjk(30, 600), color: bone, alpha: a });
    const sw = K.measure(x, "servedAt", FONT.mono(28, 500));
    text(x, "servedAt", sx + sr + 30, sy + 18, { font: FONT.mono(28, 500), color: ash, alpha: a });
    text(x, tr("ch05.firstOnly"), sx + sr + 30 + sw + 14, sy + 18, { font: FONT.cjk(28, 600), color: ash, alpha: a });
    text(x, tr("ch05.silent"), sx + sr + 30, sy + 64, { font: FONT.cjk(28, 600), color: ash, alpha: prog(b, 10.7, 10.9) * cA });
    // 访客的钟（线下面）：挂载后接手，每拍往前走一格，走到截止那一格
    const steps = clamp(Math.floor((b - AT.mount) * 4 + 1e-6), 0, 5), part = E.out(clamp(((b - AT.mount) * 4 - steps) / 0.3));
    const minute = b < AT.mount ? 8 : 8 + (Math.min(5, steps + (steps < 5 ? part : 0)) * 7) / 5;
    const out = b >= AT.deadline;
    clockFace(x, bx, y, r, minute, a * lerp(0.45, 1, handed), { hand: handed > 0.5 ? css("signalD") : bone });
    text(x, tr("ch05.visitorClock"), 7030, y - 30, { font: FONT.cjk(30, 600), color: bone, alpha: a, maxW: 440 });
    text(x, tr("ch05.afterMount"), 7030, y + 12, { font: FONT.cjk(28, 600), color: ash, alpha: a, maxW: 440 });
    // 首帧 → 挂载：一支虚线箭头从源站的钟穿过电报线落到访客的钟上
    const hk = prog(b, AT.mount - 0.12, AT.mount + 0.08, E.out);
    if (hk > 0) {
      const P0 = [sx + 40, sy + sr + 14], P1 = [bx - r * 0.72, y - r * 0.72 - 12];
      dashLine(x, P0[0], P0[1], lerp(P0[0], P1[0], hk), lerp(P0[1], P1[1], hk), 2, bone, 0.8 * a);
      if (hk >= 1) arrowHead(x, P1[0], P1[1], Math.atan2(P1[1] - P0[1], P1[0] - P0[0]), bone, 0.8 * a);
      text(x, tr("ch05.mount"), lerp(P0[0], P1[0], 0.62) + 24, lerp(P0[1], P1[1], 0.62) + 6, { font: FONT.cjk(28, 600), color: ash, alpha: hk * a });
    }
    // 截止：在 15 分那一格（三点钟方向）
    const dueA = prog(b, 10.9, 11.1) * cA;
    line(x, bx + r - 30, y, bx + r + 16, y, 5, css("signalD"), dueA);
    if (dueA > 0) glow(e, bx + r, y, 40, 0.4 * dueA + 0.8 * impact(b, AT.deadline, 0.15));
    text(x, tr("ch05.due"), bx + r + 26, y - 18, { font: FONT.cjk(28, 600), color: css("signalD"), alpha: dueA });
    // 卡片：在线点到点自己熄灭（在线点是站点卡片的颜色，片中画成 signal；live 绿只给人数）
    const { x: px, y: py, w, h } = DESK;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(px, py, w, h); x.restore();
    K.rect(x, px, py, w, h, 2.2, bone, a);
    const dot = [px + 40, py + 46];
    if (!out) {
      x.save(); x.globalAlpha = a; x.fillStyle = css("signalD"); x.beginPath(); x.arc(dot[0], dot[1], 11, 0, TAU); x.fill(); x.restore();
      glow(e, dot[0], dot[1], 34, 0.5 * a);
    } else {
      x.save(); x.globalAlpha = a; x.strokeStyle = ash; x.lineWidth = 2; x.beginPath(); x.arc(dot[0], dot[1], 10, 0, TAU); x.stroke(); x.restore();
      glow(e, dot[0], dot[1], 60, 0.9 * impact(b, AT.deadline, 0.1));
    }
    text(x, "mac", px + 66, py + 56, { font: FONT.mono(28, 500), color: ash, alpha: a });
    text(x, out ? tr("ch05.offline") : "Ghostty", px + 30, py + 140, { font: FONT.sans(52, 600), color: out ? ash : bone, alpha: a });
    // 截止那一格连到在线点
    if (dueA > 0) dashLine(x, bx + r + 18, y - 4, dot[0] - 16, dot[1] + 6, 1.6, css("signalD"), 0.8 * dueA);
    text(x, tr("ch05.dueAt"), px, py + h + 50, { font: FONT.cjk(28, 600), color: ash, alpha: dueA });
    text(x, "lastSeenAt + heartbeatWindowMs", px, py + h + 90, { font: FONT.mono(28, 500), color: css("signalD"), alpha: dueA });
    // 旁白
    nar(x, "ch05.n6a", 7010, 944, prog(b, 10.55, 11.0), win(b, 10.5, 10.6, 12.3, 12.45) * cA);
    nar(x, "ch05.n6b", 7010, 1024, prog(b, 11.0, 11.6), win(b, 10.5, 10.6, 12.3, 12.45) * cA);
  }

  // ========== E 数人头 ==========
  const WIN = { x: 9310, y: 520, w: 590, h: 290 };
  const CEN = { x: 10150, y: 470, w: 910, h: 400 };
  const ROOM = [10330, 250];
  function pageIcon(x, cx, cy, col, a, dashed = false) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = 2; if (dashed) x.setLineDash([5, 5]);
    x.strokeRect(cx - 28, cy - 20, 56, 40); x.beginPath(); x.moveTo(cx - 28, cy - 10); x.lineTo(cx + 28, cy - 10); x.stroke(); x.restore();
  }
  function stationE(x, d, e, b, cA) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 12.45, 12.62, E.out) * cA;
    if (a <= 0) return;
    const hid = b >= AT.hidden, hk = prog(b, AT.hidden, AT.hidden + 0.12);
    // 这一页：浏览器窗口，两个标签；13:2 切到另一个标签，这一页进了后台
    const { x: px, y: py, w, h } = WIN;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(px, py, w, h); x.restore();
    K.rect(x, px, py, w, h, 2.2, bone, a);
    const tabs = [[px + 12, 250, "lyjw.me"], [px + 272, 200, "…"]];
    tabs.forEach(([tx, tw, lab], i) => {
      const active = hid ? i === 1 : i === 0;
      if (active) { x.save(); x.globalAlpha = a; x.fillStyle = css("ink"); x.fillRect(tx, py + 10, tw, 46); x.restore(); }
      K.rect(x, tx, py + 10, tw, 46, 1.6, bone, a * (active ? 0.9 : 0.35));
      text(x, lab, tx + 18, py + 43, { font: FONT.mono(28, 500), color: active ? bone : ash, alpha: a * (active ? 1 : 0.6) });
    });
    line(x, px, py + 56, px + w, py + 56, 1.4, bone, 0.6 * a);
    const pageA = a * (1 - 0.8 * hk);
    for (let i = 0; i < 4; i++) K.rect(x, px + 24 + (i % 2) * 276, py + 76 + Math.floor(i / 2) * 70, 262, 56, 1.4, bone, 0.45 * pageA);
    // 页脚的 Online now：live 绿第一次出现，只给人数
    const onW = K.measure(x, tr("ch05.onlineNow"), FONT.mono(28, 500));
    x.save(); x.globalAlpha = pageA; x.fillStyle = css("live"); x.beginPath(); x.arc(px + 34, py + h - 32, 6, 0, TAU); x.fill(); x.restore();
    text(x, tr("ch05.onlineNow"), px + 52, py + h - 22, { font: FONT.mono(28, 500), color: ash, alpha: pageA });
    text(x, "03", px + 64 + onW, py + h - 22, { font: FONT.mono(28, 600), color: css("live"), alpha: pageA });
    if (hk > 0) text(x, tr("ch05.bg"), px + w / 2, py + 190, { font: FONT.cjk(34, 600), color: bone, align: "center", alpha: hk * a });
    // 这一页的线：从窗口顶上连到电报线
    dashLine(x, px + w / 2, py, px + w / 2, TY + 12, 1.4, bone, 0.55 * a, [5, 7]);
    text(x, "/ws", px + w / 2 + 12, py - 24, { font: FONT.mono(28, 500), color: ash, alpha: a });
    // hidden：往上的一个脉冲，送到房间；线接着走
    const hp = BLIPS[4];
    if (b >= AT.hidden) {
      const ta = prog(b, AT.hidden, AT.hidden + 0.1) * cA;
      text(x, "hidden", hp.x, TY + hp.amp - 22, { font: FONT.mono(30, 600), color: css("signalD"), align: "center", alpha: ta });
      const k = prog(b, AT.hidden + 0.05, AT.count, E.io);
      const P = [[hp.x + 20, TY + hp.amp - 40], [ROOM[0] - 34, ROOM[1] + 6]];
      if (k > 0) {
        dashLine(x, P[0][0], P[0][1], lerp(P[0][0], P[1][0], k), lerp(P[0][1], P[1][1], k), 1.6, css("signalD"), 0.8 * ta);
        if (k >= 1) arrowHead(x, P[1][0], P[1][1], Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]), css("signalD"), ta);
      }
      text(x, tr("ch05.stillUp"), hp.x - 36, TY - 42, { font: FONT.cjk(28, 600), color: ash, align: "right", alpha: prog(b, AT.hidden + 0.2, AT.hidden + 0.4) * cA });
    }
    // 房间
    // 房间：hidden 到了，可见的少一个，人数变了才广播一条 online（天线发射）
    mast(x, ROOM[0], ROOM[1], a, burst(b, AT.count));
    text(x, "LivePushRoom", ROOM[0] + 64, ROOM[1] + 11, { font: FONT.mono(30, 500), color: bone, alpha: a });
    // 数人头（白卡）：两个口径，同一条连接；虚线把它引回房间
    const cardA = prog(b, 12.6, 12.8, E.out) * cA;
    if (cardA > 0) dashLine(x, ROOM[0], ROOM[1] + 24, ROOM[0], CEN.y, 1.4, bone, 0.6 * cardA, [6, 6]);
    if (cardA > 0) {
      const { x: cx, y: cy, w: cw, h: ch } = CEN;
      sheet(d, cx, cy, cw, ch, { alpha: cardA });
      text(d, tr("ch05.census"), cx + 36, cy + 60, { font: FONT.cjk(38, 600), alpha: cardA });
      text(d, "live-census.ts", cx + cw - 36, cy + 58, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: cardA });
      line(d, cx + 30, cy + 82, cx + cw - 30, cy + 82, 1.4, css("pink"), cardA);
      const ck = prog(b, AT.count, AT.count + 0.12, E.io);
      [["connections", "ch05.rowOpen"], ["online", "ch05.rowWatch"]].forEach(([key, lab], i) => {
        const ry = cy + 150 + i * 150;
        text(d, key, cx + 36, ry, { font: FONT.mono(32, 600), color: css("pink"), alpha: cardA });
        text(d, tr(lab), cx + 36, ry + 44, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: cardA, maxW: 420 });
        for (let j = 0; j < 3; j++) {
          const ours = j === 0;
          const col = ours ? css("signal") : css("pink");
          const ia = ours && hid ? (i === 0 ? 0.55 : 1 - ck * 0.85) : 1;
          pageIcon(d, cx + 520 + j * 76, ry - 8, col, cardA * ia, ours && hid);
        }
        // 人数：online 那一行用 live 绿（白卡上是纸面那一档 liveL）
        const green = i === 1;
        const num = (v, dy, al) => text(d, v, cx + cw - 40, ry + 10 + dy, { font: FONT.mono(56, 600), color: green ? css("liveL") : css("pink"), align: "right", alpha: cardA * al });
        if (!green || ck <= 0) num("03", 0, 1);
        else {
          d.save(); d.beginPath(); d.rect(cx + cw - 160, ry - 50, 140, 76); d.clip();
          num("03", -60 * ck, 1 - ck); num("02", 60 * (1 - ck), ck); d.restore();
        }
        if (green) { d.save(); d.globalAlpha = cardA; d.fillStyle = css("liveL"); d.beginPath(); d.arc(cx + cw - 190, ry - 8, 8, 0, TAU); d.fill(); d.restore(); }
      });
    }
    // 旁白
    nar(x, "ch05.n7a", 9310, 944, prog(b, 12.55, 13.0), win(b, 12.5, 12.6, 14.8, 14.97) * cA);
    nar(x, "ch05.n7b", 9310, 1024, prog(b, 13.0, 13.6), win(b, 12.5, 12.6, 14.8, 14.97) * cA);
  }

  // ========== F 到货表 ==========
  const TAB = { x: 11610, y: 450, w: 1770, h: 410 };
  // 可滞后卡的节奏出自 src/lib/status-views.ts#STATUS_VIEWS 的 cadenceMs；updatedAt 是示意的时刻
  const TROWS = [["ch05.rServer", "21:14:00", "60 s", "21:15:15"], ["ch05.rChart", "21:10:00", "10 min", "21:20:15"], ["ch05.rRings", "21:00:00", "1 h", "22:00:15"]];
  function stationF(d, s, b, cA) {
    const a = prog(b, 14.95, 15.12, E.out) * cA;
    if (a <= 0) return;
    const { x: px, y: py, w, h } = TAB, pink = css("pink"), gr = css("graphite");
    sheet(d, px, py, w, h, { alpha: a, shadow: 34 });
    text(d, tr("ch05.table"), px + 40, py + 62, { font: FONT.cjk(42, 600), alpha: a });
    text(d, "poll-schedule.ts", px + w - 40, py + 60, { font: FONT.mono(28), color: gr, align: "right", alpha: a });
    line(d, px + 34, py + 86, px + w - 34, py + 86, 1.4, pink, a);
    const C = [px + 40, px + 400, px + 630, px + 830];
    text(d, tr("ch05.colCard"), C[0], py + 136, { font: FONT.cjk(28, 600), color: gr, alpha: a, maxW: 340 });
    text(d, "updatedAt", C[1], py + 136, { font: FONT.mono(28), color: gr, alpha: a });
    text(d, "cadenceMs", C[2], py + 136, { font: FONT.mono(28), color: gr, alpha: a });
    text(d, tr("ch05.colFetch"), C[3], py + 136, { font: FONT.cjk(28, 600), color: gr, alpha: a });
    TROWS.forEach(([k, up, cad, due], i) => {
      const y = py + 192 + i * 52, rk = prog(b, AT.rows[i] - 0.06, AT.rows[i] + 0.04);
      text(d, tr(k), C[0], y, { font: FONT.cjk(32, 600), alpha: a * rk, maxW: 340 });
      text(d, up, C[1], y, { font: FONT.mono(30, 500), alpha: a * rk });
      text(d, cad, C[2], y, { font: FONT.mono(30, 500), alpha: a * rk });
      text(d, due, C[3], y, { font: FONT.mono(30, 600), color: css("signal"), reveal: prog(b, AT.rows[i], AT.rows[i] + 0.12), perChar: true, alpha: a });
      line(d, px + 34, y + 18, px + 1030, y + 18, 1, pink, 0.16 * a * rk);
    });
    const fa = prog(b, AT.formula - 0.04, AT.formula + 0.1) * a;
    text(d, "due = updatedAt + cadenceMs + LAG_GRACE_MS", C[0], py + 352, { font: FONT.mono(28, 600), color: css("signal"), reveal: prog(b, AT.formula, AT.formula + 0.2), alpha: fa });
    text(d, tr("ch05.backoff"), C[0], py + 392, { font: FONT.cjk(28, 600), color: gr, alpha: prog(b, 16.1, 16.3) * a, maxW: 1010 });
    // 右栏：推送连着时，实时卡的轮询不快于兜底
    const RX = px + 1110, ra = prog(b, AT.safety - 0.2, AT.safety - 0.05) * a;
    line(d, RX - 40, py + 110, RX - 40, py + h - 30, 1.2, pink, 0.35 * a);
    text(d, tr("ch05.pushUp"), RX, py + 140, { font: FONT.cjk(34, 600), alpha: ra });
    text(d, tr("ch05.pushNet"), RX, py + 184, { font: FONT.cjk(28, 600), color: gr, alpha: ra, maxW: 610 });
    text(d, "max(cardMs, PUSH_SAFETY_NET_MS)", RX, py + 240, { font: FONT.mono(28, 500), alpha: ra, maxW: 610 });
    text(d, tr("ch05.pushList1"), RX, py + 304, { font: FONT.cjk(30, 600), alpha: ra, maxW: 610 });
    text(d, tr("ch05.pushList2"), RX, py + 348, { font: FONT.cjk(30, 600), alpha: ra, maxW: 610 });
    stamp(s, "≥ 5 min", px + w - 150, py + 318, { k: prog(b, AT.safety, AT.safety + 0.12), px: 50, rot: -0.1, alpha: cA });
  }
  function stationFnar(x, b, cA) {
    nar(x, "ch05.n8a", 11610, 944, prog(b, 15.0, 15.4), win(b, 15.0, 15.1, 17.1, 17.28) * cA);
    nar(x, "ch05.n8b", 11610, 1024, prog(b, 15.4, 16.1), win(b, 15.0, 15.1, 17.1, 17.28) * cA);
  }

  // ========== 拉远：图版外框 ==========
  function plateFrame(x, b, zoom) {
    const k = win(b, 17.45, 17.58, 17.8, 17.9);
    if (k <= 0) return;
    const [x0, y0, x1, y1] = PLATE_RECT;
    K.rect(x, x0 + 40, y0 + 40, x1 - x0 - 80, y1 - y0 - 80, 2 / zoom, css("bone"), 0.7 * k);
    x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0);
    text(x, "PLATE 05 · LIVE WIRE", G.W - 60, 760, { font: FONT.mono(30, 600), color: css("bone"), align: "right", alpha: k });
    x.restore();
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.hero, 0.12), impact(b, AT.bounce, 0.1), impact(b, AT.safety, 0.1));
    cam.zoom *= 1 + 0.014 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const d = paper.begin(); paper.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    top.begin(); top.cam(cam);

    // 各站的东西在拉远时退到很淡，拉平时全部退掉，只剩电报线
    const cA = (1 - 0.7 * prog(b, 17.25, 17.45)) * (1 - prog(b, 17.62, 17.8));
    // 每一站只在镜头附近那一段时间画（拉远时全画），省得画面外白算
    const near = (b0, b1) => (b > b0 && b < b1) || b > 17.2;
    if (near(-1, 5.3)) stationA(x, d, e, b, cA);
    if (near(4.6, 8.9)) stationB(x, d, e, s, b, cA);
    if (near(8.1, 10.9)) stationC(x, e, b, f, cA);
    if (near(10.1, 12.9)) stationD(x, e, b, cA);
    if (near(12.1, 15.4)) stationE(x, d, e, b, cA);
    if (near(14.6, 18)) { stationF(d, s, b, cA); stationFnar(x, b, cA); }
    wire(x, e, b, f, cam.zoom, cA);
    plateFrame(x, b, cam.zoom);

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 5.9 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.55 });
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 4.1 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 7;
    f.post = {
      bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      flash: impact(b, AT.hero, 0.1) * 0.05 + impact(b, AT.bounce, 0.1) * 0.04, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch05", title: "ch.05", bars: 18,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
