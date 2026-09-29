// 第 02 章 · 门禁与分拣（上报入口 workers/ingress，FACTS §2）。16 小节。
// 纸面图版：一张 3840×2160 的大图纸分四格，镜头在强拍上甩到下一格：
//   A 门墙（钥匙与门） · B 检查单 · C 分拣台（四根管子） · D 三盏灯与 202
// 结尾镜头拉远看整张图纸，再冲进「状态核心」那盏灯，接第 03 章。
// 时间一律写章节内的小节（bar），b = 5.5 即第 5 小节第 2 拍。
(() => {
  const { css, Pass, Layer } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, dashed, envelope, stamp, clawd, bubble, spark, hash, roundRect, glyph } = K;
  const tr = (k) => I18N.tr(k);
  let paper, ink, stampL, emit, top;
  // 图版底用共用的纸面着色器（kit.js 的 K.PLATE.paper）：纸纹、纤维、图纸网格只铺在这张 3840×2160 的图纸上
  const PLATE_RECT = [0, 0, 3840, 2160];

  // ---------- 布局常量（世界坐标） ----------
  const LAMP_Y_ = 1560;
  const DOORS = ["mac", "iphone", "homepod", "playstation", "emby", "server", "agents", "agents/otlp"];
  const DX = (i) => 206 + i * 194, DW = 150, DTOP = 368, DH = 360;
  const lockPos = (i) => [DX(i) + DW / 2, DTOP + DH * 0.6];
  const TUBE_X = { cred: 300, d1: 700, lag: 1100, rt: 1500 };
  const MOUTH_Y = 1720 + 1080 - 1080; // C 格内的管口（世界 y）
  const RT_PATH = [[1500, 1750], [1500, 1930], [2130, 1930], [2130, LAMP_Y_], [2254, LAMP_Y_]];
  const LAMPS = [
    { key: "do", x: 2300, t: 13.0 },
    { key: "lag", x: 2560, t: 13.5 },
    { key: "cred", x: 2820, t: 14.0 },
    { key: "d1", x: 3080, t: 14.75, soft: true },
  ];
  const LAMP_Y = LAMP_Y_;
  const STAMP202 = [3480, 1470];

  // 镜头：[小节, [x, y, zoom, rot], 进入这一段的缓动]
  const CAM = [
    [0, [640, 660, 1.4, -0.025]],
    [1.6, [960, 560, 1.0, 0], E.io],
    [4.8, [990, 560, 1.03, 0], E.lin],
    [5.0, [2880, 540, 1.0, 0], E.io],
    [8.8, [2900, 548, 1.03, 0], E.lin],
    [9.0, [960, 1620, 1.0, 0], E.io],
    [12.8, [940, 1630, 1.03, 0], E.lin],
    [13.0, [2880, 1620, 1.0, 0], E.io],
    [15.3, [2895, 1595, 1.03, 0], E.lin],
    [15.58, [1920, 1080, 0.5, 0], E.io],
    [15.76, [2300, LAMP_Y, 1.1, 0], E.io],
    [16.0, [2300, LAMP_Y, 60, 0], E.inExpo],
  ];

  // 落点的冲击：事件发生后迅速衰减（小节 → 秒按 BAR 换算）
  let BARs = 60 / 108 * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp(-((b - at) * BARs) / hl * Math.LN2));

  function pathAt(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= L) { const k = d / L; return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]; }
      d -= L;
    }
    return pts[pts.length - 1].slice();
  }
  const pathLen = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const trailOn = (pts, d, len = 240, n = 14) => { const out = []; for (let i = n; i >= 1; i--) out.push(pathAt(pts, Math.max(0, d - (len * i) / n))); return out; };

  // ---------- A 门墙 ----------
  function door(x, i, open, drawK) {
    const dx = DX(i), top = DTOP, w = DW, h = DH;
    const ink = css("pink");
    const frame = [[dx, top + h], [dx, top], [dx + w, top], [dx + w, top + h]];
    polyline(x, frame, drawK, 3, ink);
    if (drawK < 1) return;
    if (open > 0) fillRect(x, dx + 2, top + 2, w - 4, h - 2, ink, 0.9 * clamp(open * 3));
    // 门扇：以左边为轴向外转。全片只有 2D，所以不做透视：门扇只是平着变窄，上下沿始终水平
    const o = E.out(clamp(open));
    const ex = dx + w * (1 - 0.8 * o);
    x.save();
    x.fillStyle = css("paper");
    x.strokeStyle = ink; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(dx + 1, top + 1); x.lineTo(ex, top + 1); x.lineTo(ex, top + h); x.lineTo(dx + 1, top + h); x.closePath();
    x.fill(); x.stroke();
    // 门板上的内框和锁
    const inset = (px, py) => [lerp(dx + 1, ex, px), lerp(top + 1, top + h, py)];
    const pts = [inset(0.14, 0.08), inset(0.86, 0.08), inset(0.86, 0.46), inset(0.14, 0.46), inset(0.14, 0.08)];
    polyline(x, pts, 1, 1.2, ink, 0.55);
    const [lx, ly] = inset(0.8, 0.6);
    x.lineWidth = 2; x.beginPath(); x.arc(lx, ly, 9 * (1 - o * 0.5), 0, Math.PI * 2); x.stroke();
    x.restore();
    text(x, "/" + DOORS[i], dx, top - 20, { font: FONT.mono(24, 500), color: css("pink"), alpha: clamp(drawK * 2 - 1) });
  }
  function keycard(x, label, cx, cy, rot = 0, alpha = 1, hot = false) {
    if (alpha <= 0) return;
    const tw = K.measure(x, label, FONT.cjk(26, 600));
    x.save(); x.translate(cx, cy); x.rotate(rot); x.globalAlpha = alpha;
    const w = Math.max(210, tw + 110), h = 86;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 3;
    roundRect(x, -w / 2, -h / 2, w, h, 10); x.fill(); x.stroke();
    // 芯片
    x.lineWidth = 1.5; x.strokeRect(-w / 2 + 16, -14, 30, 24);
    line(x, -w / 2 + 16, -2, -w / 2 + 46, -2, 1, x.strokeStyle);
    x.restore();
    text(x, label, cx - Math.max(210, tw + 110) / 2 + 64, cy + 10, { font: FONT.cjk(26, 600), color: hot ? css("signal") : css("pink"), alpha });
  }

  // 权限表：每把钥匙能开哪几扇门（workers/ingress/wrangler.toml 的 ACCESS_CLIENTS，只写来源名）
  const AC = [["mac", "/mac"], ["iphone", "/iphone"], ["home-assistant", "/homepod · /playstation"], ["emby", "/emby"], ["server", "/server"], ["agents", "/agents"], ["claude-cloud", "/agents/otlp"], ["github-actions", "/api/internal/site-deployed"]];
  const AC_X = 150, AC_Y = 800, AC_LH = 31;
  const acRow = (i) => [AC_X + 90, AC_Y + 36 + i * AC_LH];
  function accessTable(x, b) {
    const k = prog(b, 0.9, 1.5, E.out);
    if (k <= 0) return;
    text(x, "ACCESS_CLIENTS", AC_X, AC_Y, { font: FONT.mono(20, 600), color: css("graphite"), alpha: k });
    line(x, AC_X, AC_Y + 12, AC_X + 700 * k, AC_Y + 12, 1.2, css("pink"), 0.6);
    const hot = b > 1.3 && b < 2.6 ? 0 : b > 2.8 && b < 4.1 ? 3 : b >= 4.1 && b < 4.9 ? 2 : -1;
    AC.forEach(([who, doors], i) => {
      const y = AC_Y + 42 + i * AC_LH, a = prog(b, 1.0 + i * 0.05, 1.3 + i * 0.05);
      const c = i === hot ? css("signal") : css("pink");
      text(x, who, AC_X, y, { font: FONT.mono(23, 500), color: c, alpha: a });
      text(x, "→ " + doors, AC_X + 260, y, { font: FONT.mono(23), color: i === hot ? c : css("graphite"), alpha: a });
    });
  }

  function panelA(x, s, b) {
    const k0 = prog(b, 0.15, 1.0, E.out);
    text(x, "02", 120, 196, { font: FONT.pixel(112), color: css("signal"), alpha: k0 });
    text(x, tr("ch02.title"), 300, 176, { font: FONT.cjk(58, 600), reveal: prog(b, 0.3, 1.0), fadeIn: true });
    text(x, tr("ch02.host"), 302, 222, { font: FONT.mono(22), color: css("graphite"), reveal: prog(b, 0.5, 1.3) });
    line(x, 120, 262, 120 + 1680 * prog(b, 0.2, 1.3, E.outExpo), 262, 1.4, css("pink"));
    text(x, "POST /api/ingest/…", 1800, 300, { font: FONT.mono(20), color: css("graphite"), align: "right", alpha: prog(b, 0.7, 1.2) });
    line(x, 150, DTOP + DH, 150 + 1620 * prog(b, 0.3, 1.2, E.outExpo), DTOP + DH, 2, css("pink"));

    // 门的开合：mac 2:0 开、2:3 关；homepod / playstation 4:0 同时开
    const openMac = keys(b, [[2.0, 0], [2.4, 1, E.outExpo], [2.72, 1], [3.0, 0, E.in]]);
    const openHA = keys(b, [[4.0, 0], [4.4, 1, E.outExpo]]);
    DOORS.forEach((_, i) => {
      const dk = prog(b, 0.35 + i * 0.07, 0.95 + i * 0.07, E.io);
      door(x, i, i === 0 ? openMac : i === 2 || i === 3 ? openHA : 0, dk);
    });

    accessTable(x, b);
    // 钥匙从权限表里自己那一行滑出来：mac 的钥匙开 mac；emby 的钥匙去开 mac → 403；HA 的钥匙同时开两扇
    const [mx, my] = lockPos(0);
    const macK = keys(b, [[1.3, acRow(0)], [2.0, [mx, my], E.outExpo], [2.35, [mx, my]], [2.7, [mx, my + 30], E.in]]);
    keycard(x, tr("ch02.key.mac"), macK[0], macK[1], 0, prog(b, 1.3, 1.4) * (1 - prog(b, 2.35, 2.7)), b > 1.95 && b < 2.5);
    const embyK = keys(b, [[2.9, acRow(3)], [3.5, [mx, my], E.outExpo], [3.75, [mx, my]], [4.3, [mx - 40, 1220], E.in]]);
    const shakeE = b > 3.5 && b < 3.75 ? Math.sin((b - 3.5) * 120) * 10 * (1 - prog(b, 3.5, 3.75)) : 0;
    keycard(x, tr("ch02.key.emby"), embyK[0] + shakeE, embyK[1], lerp(0, -0.5, prog(b, 3.75, 4.3, E.in)), prog(b, 2.9, 3.0) * (1 - prog(b, 4.0, 4.3)));
    const haX = (DX(2) + DX(3) + DW) / 2;
    const haK = keys(b, [[3.45, acRow(2)], [4.0, [haX, my], E.outExpo], [4.5, [haX, my]], [4.85, [haX, my + 40], E.in]]);
    keycard(x, tr("ch02.key.ha"), haK[0], haK[1], 0, prog(b, 3.45, 3.55) * (1 - prog(b, 4.5, 4.85)), b > 3.95 && b < 4.6);
    if (b > 4.0) {
      const hy = DTOP + DH + 50;
      line(x, DX(2) + DW / 2, DTOP + DH + 14, DX(2) + DW / 2, hy - 22, 1.2, css("signal"), prog(b, 4.0, 4.2));
      line(x, DX(3) + DW / 2, DTOP + DH + 14, DX(3) + DW / 2, hy - 22, 1.2, css("signal"), prog(b, 4.0, 4.2));
      line(x, DX(2) + DW / 2, hy - 22, DX(3) + DW / 2, hy - 22, 1.2, css("signal"), prog(b, 4.05, 4.25));
      text(x, tr("ch02.ha"), DX(3) + DW / 2 + 24, hy - 12, { maxW: 700, font: FONT.cjk(26, 600), color: css("signal"), reveal: prog(b, 4.1, 4.6) });
    }
    // 403：盖在 mac 那扇门上
    stamp(s, "403", DX(0) + DW / 2 + 6, DTOP + DH * 0.24, { k: prog(b, 3.5, 3.62), px: 64, rot: -0.2, alpha: 1 - prog(b, 4.6, 4.9) });

    // 旁白
    text(x, tr("ch02.n1a"), 1000, 900, { maxW: 800, font: FONT.cjk(64, 600), reveal: prog(b, 1.4, 2.2), dim: 0.12, perChar: true });
    text(x, tr("ch02.n1b"), 1000, 985, { maxW: 800, font: FONT.cjk(64, 600), reveal: prog(b, 2.2, 3.2), dim: 0.12, perChar: true });
  }

  // ---------- B 检查单 ----------
  const ROWS = [
    ["ch02.r1", "method", "405"],
    ["ch02.r2", "source", "404"],
    ["ch02.r3", "RS256 · aud · iss · exp", "401 · 403 · 503"],
    ["ch02.r4", "ch02.r4s", "400"],
    ["ch02.r5", "JSON.parse", "400"],
    ["ch02.r6", "prepareIngestForCommit", "400 · 503"],
  ];
  const TICKS = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5];
  function panelB(x, s, b) {
    const X = 2000, Y = 110, FW = 1080, FH = 880;
    const fk = prog(b, 4.55, 5.05, E.io);
    polyline(x, [[X, Y], [X + FW, Y], [X + FW, Y + FH], [X, Y + FH], [X, Y]], fk, 2.4, css("pink"));
    if (fk <= 0) return;
    text(x, tr("ch02.form"), X + 48, Y + 84, { font: FONT.cjk(46, 600), alpha: fk });
    text(x, "workers/ingress · worker.ts", X + FW - 40, Y + 80, { font: FONT.mono(20), color: css("graphite"), align: "right", alpha: fk });
    line(x, X + 40, Y + 116, X + FW - 40, Y + 116, 1.4, css("pink"), fk);
    text(x, tr("ch02.reject"), X + FW - 40, Y + 166, { font: FONT.cjk(22, 600), color: css("graphite"), align: "right", alpha: fk });
    ROWS.forEach(([lab, sub, code], i) => {
      const y = Y + 232 + i * 108;
      const tk = TICKS[i];
      const done = prog(b, tk, tk + 0.1);
      const a = fk * lerp(0.42, 1, done);
      text(x, String(i + 1).padStart(2, "0"), X + 44, y, { font: FONT.mono(26, 500), color: css("graphite"), alpha: fk });
      text(x, tr(lab), X + 110, y, { font: FONT.cjk(38, 600), alpha: a });
      text(x, sub.startsWith("ch02.") ? tr(sub) : sub, X + 112, y + 36, { font: FONT.mono(20), color: css("graphite"), alpha: a });
      text(x, code, X + FW - 40, y, { font: FONT.mono(26, 500), color: css("graphite"), align: "right", alpha: fk });
      const bx = X + FW - 370, by = y - 34;
      rect(x, bx, by, 40, 40, 2, css("pink"), fk);
      polyline(x, [[bx + 7, by + 20], [bx + 17, by + 31], [bx + 36, by + 5]], done, 5, css("signal"));
      line(x, X + 40, y + 66, X + 40 + (FW - 80) * prog(b, 4.8 + i * 0.05, 5.2 + i * 0.05, E.out), y + 66, 1, css("pink"), 0.3);
      // 勾上的那一刻，这一行下面扫过一道橙线
      const sw = prog(b, tk, tk + 0.12, E.outExpo);
      if (sw > 0 && b < tk + 0.45) line(x, X + 40, y + 66, X + 40 + (FW - 80) * sw, y + 66, 2.2, css("signal"), 1 - prog(b, tk + 0.2, tk + 0.45));
    });

    // 右侧：这一封上报本身
    text(x, tr("ch02.n2a"), 3150, 200, { maxW: 650, font: FONT.cjk(60, 600), reveal: prog(b, 4.9, 5.4), dim: 0.12, perChar: true });
    text(x, tr("ch02.n2b"), 3150, 282, { maxW: 650, font: FONT.cjk(60, 600), reveal: prog(b, 5.4, 6.4), dim: 0.12, perChar: true });
    const ex = 3440;
    const ey = keys(b, [[4.7, 470], [6.5, 470], [6.72, 742, E.spring]]);
    const eIn = prog(b, 4.6, 4.95, E.outExpo);
    const envX = lerp(3180, ex, eIn);
    // 1 POST · 2 路径
    text(x, "POST", ex, 356, { font: FONT.mono(34, 600), color: b < 5.25 ? css("signal") : css("pink"), align: "center", alpha: prog(b, 5.0, 5.08) * (1 - prog(b, 6.35, 6.5)) });
    text(x, "/api/ingest/mac", ex, 396, { font: FONT.mono(24), color: css("graphite"), align: "center", alpha: prog(b, 5.5, 5.58) * (1 - prog(b, 6.35, 6.5)) });
    // 3 Access 凭证：三段式 JWT
    const jk = prog(b, 6.0, 6.2, E.out);
    if (jk > 0 && b < 6.55) {
      const segs = [[3290, 70], [3366, 150], [3522, 70]];
      segs.forEach(([sx, sw], j) => fillRect(x, sx, 600, sw * clamp(jk * 3 - j), 12, j === 2 ? css("signal") : css("pink"), 0.85 * (1 - prog(b, 6.35, 6.5))));
      text(x, "Cf-Access-Jwt-Assertion", ex, 650, { font: FONT.mono(22), color: css("graphite"), align: "center", alpha: jk * (1 - prog(b, 6.35, 6.5)) });
    }
    // 4 秤：信封落到秤盘上，指针晃一晃停在很靠左的地方；右端红线是 4 MiB
    const sk = prog(b, 6.2, 6.5, E.out);
    if (sk > 0) {
      const py = 790, cx = ex, cy = 905, R = 70;
      line(x, cx - 150, py, cx + 150, py, 3, css("pink"), sk);
      line(x, cx, py, cx, cy - R, 2, css("pink"), sk);
      x.save(); x.globalAlpha = sk; x.strokeStyle = css("pink"); x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cy, R, Math.PI * 0.85, Math.PI * 2.15); x.stroke();
      for (let j = 0; j <= 10; j++) { const a = Math.PI * (0.85 + 1.3 * j / 10); line(x, cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12), cx + Math.cos(a) * R, cy + Math.sin(a) * R, j === 10 ? 4 : 1.5, j === 10 ? css("signal") : css("pink")); }
      x.restore();
      text(x, "4 MiB", cx + R + 16, cy - 30, { font: FONT.mono(20, 600), color: css("signal"), alpha: sk });
      const wob = b < 6.5 ? 0 : Math.exp(-(b - 6.5) * 9) * Math.sin((b - 6.5) * 60) * 0.5;
      const na = Math.PI * 0.85 + (b < 6.5 ? 0 : 0.1 + wob);
      line(x, cx, cy, cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16), 3, css("signal"), sk);
    }
    // 5 JSON：信封两边浮出花括号
    const jb = prog(b, 7.0, 7.12, E.outBack);
    if (jb > 0) {
      text(x, "{", ex - 170 - (1 - jb) * 30, ey + 26, { font: FONT.mono(80, 500), color: css("graphite"), align: "center", alpha: jb });
      text(x, "}", ex + 170 + (1 - jb) * 30, ey + 26, { font: FONT.mono(80, 500), color: css("graphite"), align: "center", alpha: jb });
    }
    // 6 prepare：信封打开
    const open = prog(b, 7.5, 7.75, E.io);
    envelope(x, envX, ey, 230, css("pink"), { lw: 3, open, fill: css("paper"), alpha: eIn });
    // 反例：一封不是 JSON 的，8:0 盖 400
    const rk = prog(b, 7.62, 7.95, E.outExpo);
    if (rk > 0) {
      const rx = lerp(3960, 3640, rk), ry = 440;
      envelope(x, rx, ry, 150, css("graphite"), { lw: 2.5, fill: css("paper"), rot: 0.08 });
      text(x, "<html>", rx, ry + 80, { font: FONT.mono(22), color: css("graphite"), align: "center" });
      stamp(s, "400", rx + 60, ry + 200, { k: prog(b, 8.0, 8.12), px: 56, rot: -0.14, sub: tr("ch02.notJson") });
    }
  }

  // ---------- C 分拣台（管子底下四个库的符号是共用的 K.glyph） ----------
  function tube(x, pts, color, k, lw = 2.2) {
    // 双线管子：沿中线左右各偏 24
    const off = (d) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / L) * d, p[1] + (dx / L) * d];
    });
    polyline(x, off(-24), k, lw, color);
    polyline(x, off(24), k, lw, color);
  }
  const CHIPS = [
    ["mac · desktop", "rt", 9.0, 0], ["mac · appleMusic", "rt", 9.06, 0], ["mac · chargingDevices", "rt", 9.12, 0],
    ["mac · timezone", "lag", 9.5, 0],
    ["iphone · workouts", "lag", 10.0, 1], ["iphone · workouts", "d1", 10.0, 1],
    ["mac · musicUserToken", "cred", 10.5, 0],
  ];
  const ENV_C = [[1080, 1330], [1330, 1372]]; // 分拣台上：mac 那封、iphone 那封
  function chip(x, label, cx, cy, hot, alpha, scale = 1) {
    if (alpha <= 0) return;
    x.save(); x.translate(cx, cy); x.scale(scale, scale); x.globalAlpha = alpha;
    x.font = FONT.mono(24, 500);
    const w = x.measureText(label).width + 36, h = 46;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 2;
    roundRect(x, -w / 2, -h / 2, w, h, 23); x.fill(); x.stroke();
    x.fillStyle = hot ? css("signal") : css("pink"); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 0, 1);
    x.restore();
  }
  function panelC(x, s, b) {
    text(x, tr("ch02.n3a"), 120, 1235, { maxW: 820, font: FONT.cjk(62, 600), reveal: prog(b, 8.95, 9.4), dim: 0.12, perChar: true });
    text(x, tr("ch02.n3b"), 120, 1318, { maxW: 820, font: FONT.cjk(62, 600), reveal: prog(b, 9.4, 10.4), dim: 0.12, perChar: true });
    const tk = prog(b, 8.85, 9.35, E.io);
    const names = { rt: "ch02.tube.rt", lag: "ch02.tube.lag", d1: "ch02.tube.d1", cred: "ch02.tube.cred" };
    const subs = { rt: "CORE.commitIngest", lag: "KV LAG", d1: "D1 HISTORY", cred: "KV CREDENTIALS" };
    for (const key of ["cred", "d1", "lag", "rt"]) {
      const tx = TUBE_X[key], hot = key === "rt", col = hot ? css("signal") : css("pink");
      text(x, tr(names[key]), tx, 1612, { font: FONT.cjk(38, 600), color: col, align: "center", alpha: tk });
      text(x, subs[key], tx, 1650, { font: FONT.mono(22), color: css("graphite"), align: "center", alpha: tk });
      // 管口：漏斗
      polyline(x, [[tx - 84, 1690], [tx - 26, 1750]], tk, 2.4, col);
      polyline(x, [[tx + 84, 1690], [tx + 26, 1750]], tk, 2.4, col);
      if (hot) tube(x, RT_PATH, col, tk);
      else { tube(x, [[tx, 1750], [tx, 1990]], col, tk); glyph(x, key, tx, 2046, col); }
      // 收到东西时管口亮一下
      const arrive = CHIPS.filter((c) => c[1] === key).map((c) => c[2]);
      if (key === "lag" || key === "d1") arrive.push(11.0);
      const p = Math.max(0, ...arrive.map((a) => impact(b, a, 0.12)));
      if (p > 0.02) polyline(x, [[tx - 84, 1690], [tx + 84, 1690]], 1, 4, css("signal"), p);
    }

    // 两封上报在台上，已经拆开
    const ek = prog(b, 8.7, 9.0, E.outExpo);
    envelope(x, ENV_C[1][0], ENV_C[1][1], 170, css("pink"), { lw: 2.5, open: 1, fill: css("paper"), alpha: ek, rot: 0.06 });
    envelope(x, ENV_C[0][0], ENV_C[0][1], 220, css("pink"), { lw: 3, open: 1, fill: css("paper"), alpha: ek, rot: -0.03 });
    text(x, "mac", ENV_C[0][0], ENV_C[0][1] + 108, { font: FONT.mono(20), color: css("graphite"), align: "center", alpha: ek });
    text(x, "iphone", ENV_C[1][0], ENV_C[1][1] + 88, { font: FONT.mono(20), color: css("graphite"), align: "center", alpha: ek });
    // 模块逐个飞进各自的管子
    CHIPS.forEach(([label, key, at, from], j) => {
      const k = prog(b, at - 0.42, at, E.io);
      if (k <= 0 || k >= 1) return;
      const [sx, sy] = [ENV_C[from][0], ENV_C[from][1] - 60];
      const tx = TUBE_X[key], ty = 1720;
      const cx = lerp(sx, tx, k), cy = lerp(sy, ty, k) - Math.sin(k * Math.PI) * 170;
      chip(x, label, cx, cy, key === "rt", 1 - prog(k, 0.85, 1), lerp(1, 0.6, prog(k, 0.7, 1)));
    });
    text(x, tr("ch02.fork"), 120, 1440, { maxW: 1700, font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, 10.0, 10.5) });
    // 服务器那封：整封一分为二，进可滞后和归档
    const sIn = prog(b, 10.35, 10.72, E.outExpo);
    if (sIn > 0) {
      const sx = lerp(-160, 1000, sIn), sy = 1440;
      const split = prog(b, 10.75, 11.0, E.io);
      if (split <= 0) envelope(x, sx, sy, 180, css("pink"), { lw: 2.6, fill: css("paper") });
      else if (split < 1) {
        for (const key of ["lag", "d1"]) {
          const tx = TUBE_X[key], cx = lerp(sx, tx, split), cy = lerp(sy, 1720, split) - Math.sin(split * Math.PI) * 120;
          envelope(x, cx, cy, lerp(180, 90, split), css("pink"), { lw: 2.4, fill: css("paper"), alpha: 1 - prog(split, 0.85, 1) });
        }
      }
      text(x, "server", sx, sy + 92, { font: FONT.mono(20), color: css("graphite"), align: "center", alpha: 1 - split });
      text(x, tr("ch02.server"), 120, 1490, { maxW: 1700, font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, 11.0, 11.6) });
    }
  }

  // ---------- D 三盏灯与 202 ----------
  function panelD(x, s, e, b) {
    text(x, tr("ch02.n4a"), 2040, 1235, { maxW: 1100, font: FONT.cjk(62, 600), reveal: prog(b, 12.95, 13.45), dim: 0.12, perChar: true });
    text(x, tr("ch02.n4b"), 2040, 1318, { maxW: 1100, font: FONT.cjk(62, 600), reveal: prog(b, 14.3, 15.0), dim: 0.12, perChar: true });
    const bus = 1430;
    const lit = (L) => prog(b, L.t, L.t + 0.08);
    // 汇流线：前三盏接到 202，D1 那根线故意不接上
    line(x, 2300, bus, 3300, bus, 2.2, css("pink"));
    LAMPS.forEach((L) => {
      const on = lit(L), lx = L.x, ly = LAMP_Y;
      if (L.soft) {
        dashed(x, lx, ly - 46, lx, bus + 40, 2, css("pink"), [7, 7]);
        text(x, "×", lx, bus + 22, { font: FONT.mono(26, 600), color: css("graphite"), align: "center" });
      } else {
        line(x, lx, ly - 46, lx, bus, 2.2, css("pink"));
        if (on > 0) line(x, lx, ly - 46, lx, lerp(ly - 46, bus, on), 3.4, css("signal"));
      }
      x.save(); x.strokeStyle = css("pink"); x.lineWidth = 3;
      if (L.soft) x.setLineDash([8, 7]);
      x.beginPath(); x.arc(lx, ly, 44, 0, Math.PI * 2); x.stroke(); x.restore();
      if (on > 0) {
        x.save(); x.globalAlpha = on * (L.soft ? 0.45 : 1); x.fillStyle = css("signal"); x.beginPath(); x.arc(lx, ly, 36, 0, Math.PI * 2); x.fill(); x.restore();
        glow(e, lx, ly, 95, on * (L.soft ? 0.25 : 0.55));
      }
      text(x, tr(`ch02.lamp.${L.key}`), lx, ly + 90, { font: FONT.cjk(28, 600), align: "center", alpha: L.soft ? 0.6 : 1 });
      if (L.soft) text(x, tr("ch02.lamp.d1s"), lx, ly + 130, { font: FONT.cjk(26, 600), color: css("graphite"), align: "center" });
    });
    // 汇流线上的橙色：亮一盏走一段
    const fill = keys(b, [[13.0, 2300], [13.5, 2560, E.out], [14.0, 2820, E.out], [14.9, 3300, E.io]]);
    if (b > 13.0) line(x, 2300, bus, fill, bus, 3.4, css("signal"));
    stamp(s, "202", STAMP202[0], STAMP202[1], { k: prog(b, 15.0, 15.16), px: 150, rot: -0.09, sub: "Accepted" });
    text(x, tr("ch02.foot"), 2040, 2040, { maxW: 1700, font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, 14.0, 14.9) });
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill(); e.restore();
  }

  // ---------- 图版外框（拉远时才看得到） ----------
  function plateFrame(x, b) {
    const k = prog(b, 15.1, 15.45, E.out);
    if (k <= 0) return;
    rect(x, 40, 40, 3760, 2080, 3, css("pink"), k);
    line(x, 1920, 60, 1920, 2100, 1, css("pink"), 0.25 * k);
    line(x, 60, 1080, 3780, 1080, 1, css("pink"), 0.25 * k);
    text(x, "PLATE 02 · INGRESS", 70, 2100, { font: FONT.mono(34, 600), alpha: k });
  }

  // ---------- 信封火花：A 格走进 mac 那扇门；C 格起沿着「实时」管一路走到状态核心那盏灯 ----------
  const A_PATH = [[-200, 640], [DX(0) + DW / 2, 640], [DX(0) + DW / 2 + 40, 600]];
  const RT_FULL = [[1500, 1690], ...RT_PATH];
  const RT_LEN = pathLen(RT_FULL);
  function sparkAll(x, e, b) {
    if (b < 2.5) {
      const L = pathLen(A_PATH);
      const d = keys(b, [[0, 0], [1.9, L - 40, E.out], [2.35, L, E.in]]);
      const head = pathAt(A_PATH, d);
      spark(e, x, head, trailOn(A_PATH, d, 320), { t: G.t, size: lerp(1.1, 0.4, prog(b, 2.0, 2.4)), lw: 2.2 });
    } else if (b >= 4.7 && b < 8.9) {
      // 附在检查单右边那封信的封舌上
      const ey = keys(b, [[4.7, 470], [6.5, 470], [6.72, 742, E.spring]]);
      const ex = lerp(3180, 3440, prog(b, 4.6, 4.95, E.outExpo));
      spark(e, null, [ex, ey - 20], null, { t: G.t, size: 0.8 });
    } else if (b >= 8.95 && b < 13.2) {
      const d = keys(b, [[8.95, 0], [9.6, 520, E.out], [12.5, 1150, E.io], [13.0, RT_LEN, E.in]]);
      spark(e, x, pathAt(RT_FULL, d), trailOn(RT_FULL, d, 300), { t: G.t, size: 1.0, lw: 3 });
    }
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const c = keys(b, CAM);
    // 镜头的呼吸和落点冲击：盖章那一下往前顶一点
    const hitS = Math.max(impact(b, 3.5), impact(b, 8.0), impact(b, 15.0, 0.14));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.025 * hitS), rot: c[3] };
    G.setCam(cam);
    G.fill(paper, { uGridA: 1, uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const tp = top.begin(); top.cam(cam);

    if (b < 5.2 || b > 15.2) panelA(x, s, b);
    if ((b > 4.4 && b < 9.3) || b > 15.2) panelB(x, s, b);
    if (b > 8.5) panelC(x, s, b);
    if (b > 8.5) panelD(x, s, e, b);
    plateFrame(x, b);
    sparkAll(x, e, b);

    // Clawd：只在开场出来一次，站在标题线右端
    const cIn = prog(b, 0.45, 0.8, E.lin), cOut = prog(b, 2.45, 2.8, E.lin);
    if (cIn > 0 && cOut < 1) {
      const baseY = 262;
      const cx = lerp(2000, 1700, E.out(cIn)) + lerp(0, 320, E.in(cOut));
      const hop = Math.sin(cIn * Math.PI) * 110 * (1 - cIn) + Math.sin(cOut * Math.PI) * 90;
      const land = impact(b, 0.8, 0.07);
      clawd(tp, cx, baseY - hop, 8, { pose: cIn < 1 || cOut > 0 ? "arms-up" : b > 1.8 ? "look-left" : "default", crouch: land > 0.4 ? 1 : 0 });
      bubble(tp, tr("ch02.clawd"), cx - 90, baseY - 118, { px: 34, k: prog(b, 0.95, 1.2) * (1 - prog(b, 2.3, 2.45)), reveal: prog(b, 1.0, 1.7), tail: "right" });
    }

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 3.1 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 7.7 });
    G.composite(top.upload(), { mode: G.MODE.normal });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.35 });

    const sh = hitS * 9;
    // 运动模糊：用上一帧（1/60 秒前）的镜头推出这一帧画面在屏幕上移动了多少
    const c0 = keys(b - 1 / 60 / f.BAR, CAM);
    const blur = [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]];
    const zoomBlur = Math.log(c[2] / c0[2]);
    f.post = {
      bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      // 冲进灯里：先整屏化成橙色，再干净地落黑
      flash: Math.max(impact(b, 15.0, 0.1) * 0.18, prog(b, 15.8, 15.92)), flashCol: b > 15.5 ? [0.85, 0.36, 0.2] : [1.0, 0.72, 0.55],
      fade: prog(b, 15.93, 16.0),
      blur, zoomBlur: Math.max(-0.2, Math.min(0.2, zoomBlur)),
    };
  }

  window.CHAPTERS.push({
    id: "ch02", title: "ch.02", bars: 16,
    init() { paper = G.pass(K.PLATE.paper); ink = G.layer("ink"); stampL = G.layer("stamp"); top = G.layer("top"); emit = G.layer("emit", 0.5); },
    render,
  });
})();
