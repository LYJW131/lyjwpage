// 第 09 章 · 一首歌的旅程（回顾，FACTS 全篇）。14 小节，全是 2D。
// 一张横向长图版：第 01–08 章各缩成一格，一格一个机位那么大，暗底的格直接画在墨色图版上，纸面的格是一张张纸（paper 层）。
// 远看是一条明暗相间的长条（全片的明暗节奏），信封经过哪一格，镜头就推近那一格、用那一章的画法闪回一下：
//   0–1 接第 08 章最后一帧（心电图，镜头 [960, 540, 1]）：心电图再卷一拍、拉平，镜头往后拉出整条长图版，标题；冲进第 01 格
//   1–2 01 Mac：1:1 换歌（夜に駆ける → アイドル），1:2 信封从菜单栏的 Hub 出来，1:3 往右飞出这一格
//   2–4 02 门禁与分拣：2:0 mac 的钥匙开门，2:2 过秤，3:2 拆开、appleMusic 进实时那根管子
//   4–6 03 账房：排队、4:2 落账、5:0 写「要做的事」、5:2 递出去；6:0 门外照单去办，回执和推送同一拍出发
//   6–7.75 拉远：回执往左回到第 02 格的三盏灯、7:1 盖 202；推送往右经过第 04 格（在听那块亮一下、不重印）进第 05 格
//   7.75–9.75 05 电报线：8:0 脉冲到站，8:2 写进浏览器缓存，火花奔向页面；9:3 切到第 00 章那张主页，10:0 卡片翻面（同一个函数画）
//   10.5–14 切回第 00 章的终端：欢迎框里 Clawd 按官方 celebrate 庆祝，下面是片尾字卡；12.5 起拉回整个终端、清屏，
//     13.5 起停在第 00 章第一帧（同一个函数、同一份状态）
// 世界坐标：第 08 格放在 [0, 1920]，和第 08 章同一套坐标（图版的纹理和网格是世界坐标的函数，首帧才接得上），其余往左排。
// 配乐锚点在 AT，music/ch09.js 按同一组小节落拍；画面只从 AT 取时间。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, roundRect, envelope, stamp, spark, glyph, sheet, checkbox, pathAt, pathLen, trailOn, measure } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch09.title": ["一首歌的旅程", "One song's journey"],
    "ch09.n1a": ["Mac 上换了一首歌：", "A song changes on the Mac:"],
    "ch09.n1b": ["过门、过秤、分拣，", "the gate, the scale, the sorter,"],
    "ch09.n2a": ["屋里记一笔，门外去广播；", "a ledger line, a push outside;"],
    "ch09.n2b": ["回执和推送同时出发。", "receipt and push leave together."],
    "ch09.n3a": ["电报线那头，", "At the far end of the wire,"],
    "ch09.n3b": ["卡片翻面。", "the card flips."],
    "ch09.end1": ["谢谢观看", "Thanks for watching"],
    "ch09.end2": ["讲解 Claude Opus 5.5 · lyjw.me", "Narrated by Claude Opus 5.5 · lyjw.me"],
    "ch09.c1": ["野外观测站", "Field stations"],
    "ch09.c2": ["门禁与分拣", "The gate and the sorting desk"],
    "ch09.c3": ["一间屋子的账房", "A one-room ledger office"],
    "ch09.c4": ["活字印版", "The type case"],
    "ch09.c5": ["电报线", "The live wire"],
    "ch09.c6": ["两条线路", "Two lines"],
    "ch09.c7": ["节拍器", "Metronomes"],
    "ch09.c8": ["心电图与地层", "Heartbeat and strata"],
    "ch09.keyMac": ["mac 的钥匙", "mac key"],
    "ch09.limit": ["不超过 4 MiB", "At most 4 MiB"],
    "ch09.t.rt": ["实时", "Realtime"],
    "ch09.t.lag": ["可滞后", "Lag"],
    "ch09.t.d1": ["归档", "Archive"],
    "ch09.t.cred": ["凭据", "Credentials"],
    "ch09.l.do": ["状态核心已提交", "State core committed"],
    "ch09.l.lag": ["LAG 已写", "LAG written"],
    "ch09.l.cred": ["凭据已写", "Credentials written"],
    "ch09.ledger": ["StateHub 账本", "StateHub ledger"],
    "ch09.slip": ["要做的事", "To do"],
    "ch09.listen": ["广播 listening-now", "push listening-now"],
    "ch09.noRecast1": ["换歌不重印：", "No recast:"],
    "ch09.noRecast2": ["交给推送", "the push handles it"],
    "ch09.swr": ["浏览器缓存", "browser cache"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  const BARS = (60 / 108) * 4; // 一小节的秒数（108 BPM）
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARS) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出
  const lay = () => ({ x: G.layer("ink"), e: G.layer("emit", 0.5), d: G.layer("paper"), s: G.layer("stamp"), tp: G.layer("top") });
  // 第 00 章的终端和「正在听」那一段（ch00.js 的 share）：首尾两帧用同一个函数画
  const ch00 = () => (window.CHAPTERS.find((c) => c.id === "ch00") || {}).share;

  // ---------- 时间表（章内小节）：画面和 music/ch09.js 共用 ----------
  const AT = {
    flat: [0.05, 0.45], pull: [0.2, 0.55], rush1: [0.8, 1.0],
    songFlip: 1.25, envOut: 1.5, park: 1.625, leave: 1.75,
    door: 2.0, scale: 2.5, toTubes: [3.0, 3.3], open: 3.5, tube: [3.55, 4.0],
    commits: [4.0, 4.25, 4.5], slipWrite: 5.0, handout: [5.5, 6.0], split: 6.0,
    receipt: [6.0, 6.5], lamps: [6.5, 6.75, 7.0], s202: 7.25, plate4: 7.0,
    push: [6.05, 8.0], pulse: 8.0, swr: 8.5, toPage: [8.75, 9.72],
    cutHome: 9.75, flip: 10.0, cutTerm: 10.5, endcard: 10.6, celebrate: [10.75, 11.75],
    pullTerm: [12.5, 13.25], clear: [13.0, 13.4], still: 13.5,
  };

  // ---------- 长图版：八格，一格一个机位那么高（1080），宽度按内容；第 08 格在 [0, 1920] ----------
  const CELLS = [
    { n: "01", key: "ch09.c1", X: -15320, W: 1920, paper: false },
    { n: "02", key: "ch09.c2", X: -13200, W: 2880, paper: true },
    { n: "03", key: "ch09.c3", X: -10120, W: 2400, paper: false },
    { n: "04", key: "ch09.c4", X: -7520, W: 1440, paper: true },
    { n: "05", key: "ch09.c5", X: -5880, W: 2400, paper: false },
    { n: "06", key: "ch09.c6", X: -3280, W: 1440, paper: true },
    { n: "07", key: "ch09.c7", X: -1640, W: 1440, paper: true },
    { n: "08", key: "ch09.c8", X: 0, W: 1920, paper: false },
  ];
  const SPINE = 540; // 信封走的那条线：每一格从左沿这一高度进、右沿这一高度出
  const Wx = (i, lx) => CELLS[i].X + lx;
  const PLATE_RECT = [-16000, -300, 3400, 1900]; // 右边、上下和第 08 章的图版范围一样

  // ---------- 小件 ----------
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function strokePts(x, pts, lw, color, alpha = 1) {
    if (pts.length < 2 || alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function dashPath(x, pts, k, w, color, alpha = 1, dash = [9, 8]) {
    if (k <= 0 || alpha <= 0) return null;
    x.save(); x.setLineDash(dash); const head = polyline(x, pts, k, w, color, alpha); x.restore();
    return head;
  }
  function arrowHead(x, tx, ty, ang, color, alpha = 1, s = 14) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
    x.lineTo(tx + Math.cos(ang + 2.6) * s, ty + Math.sin(ang + 2.6) * s);
    x.lineTo(tx + Math.cos(ang - 2.6) * s, ty + Math.sin(ang - 2.6) * s);
    x.fill(); x.restore();
  }
  const squash = (k) => (k > 0 && k < 1 ? Math.max(0.03, Math.abs(Math.cos(k * Math.PI))) : 1);
  function withSquash(x, cy, s, draw) { x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy); draw(); x.restore(); }
  // 封面占位：Apple 目录给的封面不画真图，一块带同心圆的方片
  function cover(x, px, py, s, a, col, fill) {
    x.save(); x.globalAlpha = a;
    x.fillStyle = fill; x.fillRect(px, py, s, s);
    x.strokeStyle = col; x.lineWidth = 1.6; x.strokeRect(px, py, s, s);
    for (let j = 1; j <= 4; j++) { x.globalAlpha = a * (0.55 - j * 0.1); x.beginPath(); x.arc(px + s * 0.5, py + s * 0.52, s * 0.11 * j, 0, TAU); x.stroke(); }
    x.restore();
  }
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI"; // 数据源的原文：主角这次换歌（全片同一首）

  // 每一格的底和格头（章号 + 章名）；o.lit 这一格正被信封经过（格头亮橙）
  function cellBase(L, i, a) {
    const c = CELLS[i], { x, d } = L;
    if (c.paper) {
      sheet(d, c.X, 0, c.W, 1080, { alpha: a, shadow: 34 });
      // 纸面的图纸网格（和纸面图版一样 40 / 200 一格）
      d.save(); d.globalAlpha = a; d.strokeStyle = css("pink"); d.beginPath(); d.rect(c.X + 2, 2, c.W - 4, 1076); d.clip();
      for (let u = 40; u < c.W; u += 40) { d.globalAlpha = a * (u % 200 ? 0.035 : 0.075); d.lineWidth = u % 200 ? 1 : 1.3; d.beginPath(); d.moveTo(c.X + u, 0); d.lineTo(c.X + u, 1080); d.stroke(); }
      for (let v = 40; v < 1080; v += 40) { d.globalAlpha = a * (v % 200 ? 0.035 : 0.075); d.lineWidth = v % 200 ? 1 : 1.3; d.beginPath(); d.moveTo(c.X, v); d.lineTo(c.X + c.W, v); d.stroke(); }
      d.restore();
    } else K.rect(x, c.X, 0, c.W, 1080, 2, css("bone"), 0.35 * a);
  }
  // 第 04、06–08 格镜头不推近（只在拉远时看得到），格头只当纹理
  const FAR = new Set([3, 5, 6, 7]);
  function cellHead(L, i, a, lit) {
    const c = CELLS[i], ctx = c.paper ? L.d : L.x;
    if (a <= 0) return;
    const col = c.paper ? css("signal") : css("signalD");
    text(ctx, c.n, c.X + 90, 196, { font: FONT.pixel(112), color: col, alpha: a });
    text(ctx, tr(c.key), c.X + 270, 176, { font: FONT.cjk(58, 600), color: lit > 0.5 ? col : c.paper ? css("pink") : css("bone"), alpha: a, maxW: c.W - 330, texture: FAR.has(i) });
    line(ctx, c.X + 90, 226, c.X + 90 + Math.min(900, c.W - 180), 226, 1.4, c.paper ? css("pink") : css("bone"), 0.5 * a);
  }
  // 远看时每一格中间一个很淡的大号章号（只在长图版全景里看得见）
  function cellMark(L, i, a) {
    if (a <= 0) return;
    const c = CELLS[i], ctx = c.paper ? L.d : L.x;
    text(ctx, c.n, c.X + c.W / 2, 700, { font: FONT.pixel(640), color: c.paper ? css("pink") : css("bone"), align: "center", alpha: 0.14 * a, texture: true });
  }

  // ========== 第 08 格：心电图（和第 08 章同一套几何；0:0 这一帧和它最后一帧一样）==========
  const NOW_X = 1350, Y0 = 540, V = 200;
  const UP = [[-98, 0], [0, -220], [34, 46], [62, 0]];
  const DOWN = [[-16, 0], [0, 104], [14, -22], [30, 0]];
  const CHECKS = [], KNOCKS = [];
  for (let k = 0; k <= 60; k += 5) CHECKS.push(k);
  for (let k = 0; k <= 60; k++) KNOCKS.push(k + 0.5);
  const PHI0 = 48; // 第 08 章结束时走到第 48 拍（一拍一分钟）
  function shapeY(shape, dx) {
    if (dx <= shape[0][0] || dx >= shape[shape.length - 1][0]) return 0;
    for (let i = 1; i < shape.length; i++) if (dx <= shape[i][0]) {
      const [x0, y0] = shape[i - 1], [x1, y1] = shape[i];
      return lerp(y0, y1, (dx - x0) / (x1 - x0));
    }
    return 0;
  }
  function ecgEvents(phi) {
    const ev = [];
    for (const t of CHECKS) if (t <= phi + 2) ev.push({ t, x: NOW_X - (phi - t) * V, s: UP, up: true });
    for (const t of KNOCKS) if (t <= phi + 2) ev.push({ t, x: NOW_X - (phi - t) * V, s: DOWN, up: false });
    return ev.filter((v) => v.x + v.s[0][0] < NOW_X && v.x + v.s[v.s.length - 1][0] > -3000);
  }
  // 画心电图：flat 1 是原样，0 拉平成一条直线；dim 光点的亮度
  function ecg(L, phi, flat, penA) {
    const { x, e } = L;
    const ev = ecgEvents(phi), x0 = -60;
    const xs = [x0, NOW_X];
    for (const v of ev) for (const [dx] of v.s) { const u = v.x + dx; if (u > x0 && u < NOW_X) xs.push(u); }
    xs.sort((a, c) => a - c);
    const ty = (u) => Y0 + flat * ev.reduce((y, v) => y + shapeY(v.s, u - v.x), 0);
    const pts = xs.map((u) => [u, ty(u)]);
    strokePts(x, pts, 2.4, css("bone"), 0.9);
    const tail = pts.filter(([u]) => u > NOW_X - 150);
    for (let i = 1; i < tail.length; i++) strokePts(x, [tail[i - 1], tail[i]], 2.88, css("signalD"), ((tail[i][0] - (NOW_X - 150)) / 150) * penA);
    strokePts(e, tail, 7.2, "rgb(240,150,105)", 0.35 * penA);
    const py = ty(NOW_X);
    glow(e, NOW_X, py, 38, 0.95 * penA);
    x.save(); x.globalAlpha = penA; x.fillStyle = css("ember"); x.beginPath(); x.arc(NOW_X, py, 5, 0, TAU); x.fill(); x.restore();
    for (const v of ev) if (phi >= v.t && phi - v.t < 1.2) {
      const k = Math.exp(-(phi - v.t) * 3.2);
      glow(e, v.x, Y0 + flat * (v.up ? -220 : 104) * 0.9, v.up ? 110 : 60, (v.up ? 0.8 : 0.45) * k * flat);
    }
  }
  function cell8(L, b, a) {
    const { x } = L;
    // 远看时地层露出来：Pulse 那几条道画成深浅交替的几层
    if (a > 0) for (let j = 0; j < 5; j++) {
      x.save(); x.globalAlpha = a * (j % 2 ? 0.4 : 0.7); x.fillStyle = css("ink2"); x.fillRect(80, 760 + j * 56, 1760, 56); x.restore();
      line(x, 80, 760 + j * 56, 1840, 760 + j * 56, 1.2, css("bone"), 0.25 * a);
    }
  }

  // ========== 第 01 格：Mac（第 01 章 FIG. 1 的画法）==========
  const LAP = { x: 150, y: 260, w: 760, h: 430 }, MENU_H = 44;
  const AWIN = { x: 235, y: 368, w: 600, h: 236 };
  const HUB = [LAP.x + LAP.w - 42, LAP.y + 16 + MENU_H / 2];
  const PARK = [1060, SPINE];
  function cell1(L, b, a) {
    const { x, e } = L, X = CELLS[0].X, bone = css("bone"), ash = css("ash");
    x.save(); x.translate(X, 0); e.save(); e.translate(X, 0);
    const { x: lx, y: ly, w, h } = LAP;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.fillRect(lx + 16, ly + 16, w - 32, h - 32); x.restore();
    K.rect(x, lx, ly, w, h, 2.6, bone, a); K.rect(x, lx + 16, ly + 16, w - 32, h - 32, 1.4, bone, a);
    polyline(x, [[lx - 52, ly + h], [lx + w + 52, ly + h], [lx + w + 52, ly + h + 26], [lx - 52, ly + h + 26], [lx - 52, ly + h]], 1, 2.2, bone, a);
    line(x, lx + 16, ly + 16 + MENU_H, lx + w - 16, ly + 16 + MENU_H, 1.2, bone, 0.6 * a);
    text(x, "Ghostty", lx + 40, ly + 16 + MENU_H / 2 + 10, { font: FONT.mono(28, 600), color: bone, alpha: a });
    const blink = Math.max(impact(b, AT.songFlip, 0.12), impact(b, AT.envOut, 0.12));
    const hc = blink > 0.3 ? css("signalD") : bone;
    x.save(); x.globalAlpha = a; x.strokeStyle = hc; x.lineWidth = 2; x.beginPath(); x.arc(HUB[0], HUB[1], 11, 0, TAU); x.stroke();
    x.fillStyle = hc; x.beginPath(); x.arc(HUB[0], HUB[1], 3.5, 0, TAU); x.fill(); x.restore();
    if (blink > 0.02) glow(e, HUB[0], HUB[1], 60, 0.7 * blink * a);
    // Apple Music 的小窗：1:1 换歌，歌名压扁再弹开
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink"); x.fillRect(AWIN.x, AWIN.y, AWIN.w, AWIN.h); x.restore();
    K.rect(x, AWIN.x, AWIN.y, AWIN.w, AWIN.h, 1.8, bone, a);
    line(x, AWIN.x, AWIN.y + 30, AWIN.x + AWIN.w, AWIN.y + 30, 1.2, bone, 0.5 * a);
    const fk = prog(b, AT.songFlip - 0.08, AT.songFlip + 0.08);
    withSquash(x, AWIN.y + 133, squash(fk), () => {
      cover(x, AWIN.x + 24, AWIN.y + 54, 158, a, bone, css("ink"));
      text(x, fk < 0.5 ? OLD : NEW, AWIN.x + 214, AWIN.y + 118, { font: FONT.cjk(46, 600), color: fk >= 0.5 ? css("signalD") : bone, alpha: a });
      text(x, ARTIST, AWIN.x + 214, AWIN.y + 164, { font: FONT.sans(30, 500), color: ash, alpha: a });
    });
    const px0 = AWIN.x + 214, px1 = AWIN.x + AWIN.w - 30, py = AWIN.y + 202;
    line(x, px0, py, px1, py, 5, bone, 0.22 * a);
    line(x, px0, py, lerp(px0, px1, fk >= 0.5 ? 0.02 + 0.02 * prog(b, AT.songFlip, 2) : 0.86), py, 5, css("signalD"), a);
    if (fk > 0.3 && fk < 0.9) glow(e, AWIN.x + 380, AWIN.y + 110, 150, 0.5 * (1 - Math.abs(fk - 0.6) * 3));
    text(x, "Mac Telemetry Hub", lx - 50, ly + h + 90, { font: FONT.mono(30, 500), color: ash, alpha: a });
    // 信封出去的路：停在笔记本旁边，往右沿着那条线出这一格
    line(x, PARK[0] + 40, SPINE, CELLS[0].W, SPINE, 2, bone, 0.5 * a);
    x.restore(); e.restore();
  }

  // ========== 第 02 格：门、秤、管子、三盏灯（第 02 章纸面的画法，画在 paper 层）==========
  const DOORS = ["/mac", "/iphone", "/homepod"];
  const DX = (i) => 160 + i * 190, DW = 150, DTOP = 330, DH = 360;
  const LOCK = [DX(0) + DW * 0.8, DTOP + DH * 0.6];
  const SCALE = [1260, 540];
  const TUBES = [["cred", 1760], ["d1", 2010], ["lag", 2260], ["rt", 2510]];
  const MOUTH_Y = 330, OPEN_AT = [2140, 250];
  const LAMPS = [["ch09.l.do", 1800], ["ch09.l.lag", 2080], ["ch09.l.cred", 2360]], LAMP_Y = 860;
  const S202 = [2330, 690]; // 只在拉远的机位上看得到（缩放 0.25），章按 3 倍大小盖
  function door2(d, i, open) {
    const dx = DX(i), inkC = css("pink");
    K.rect(d, dx, DTOP, DW, DH, 3, inkC, 1);
    if (open > 0) fillRect(d, dx + 2, DTOP + 2, DW - 4, DH - 2, inkC, 0.9 * clamp(open * 3));
    const o = E.out(clamp(open)), ex = dx + DW * (1 - 0.8 * o);
    d.save(); d.fillStyle = css("paper"); d.strokeStyle = inkC; d.lineWidth = 2.2;
    d.beginPath(); d.moveTo(dx + 1, DTOP + 1); d.lineTo(ex, DTOP + 1); d.lineTo(ex, DTOP + DH); d.lineTo(dx + 1, DTOP + DH); d.closePath(); d.fill(); d.stroke();
    const [lx, ly] = [lerp(dx + 1, ex, 0.8), DTOP + DH * 0.6];
    d.lineWidth = 2; d.beginPath(); d.arc(lx, ly, 9 * (1 - o * 0.5), 0, TAU); d.stroke(); d.restore();
    text(d, DOORS[i], dx + DW / 2, DTOP - 20, { font: FONT.mono(28, 500), color: inkC, align: "center" });
  }
  function keycard2(d, cx, cy, alpha, hot) {
    if (alpha <= 0) return;
    const label = tr("ch09.keyMac"), tw = measure(d, label, FONT.cjk(28, 600)), w = Math.max(200, tw + 100), h = 80;
    d.save(); d.globalAlpha = alpha; d.fillStyle = css("paper"); d.strokeStyle = hot ? css("signal") : css("pink"); d.lineWidth = 3;
    roundRect(d, cx - w / 2, cy - h / 2, w, h, 10); d.fill(); d.stroke();
    d.lineWidth = 1.5; d.strokeRect(cx - w / 2 + 16, cy - 13, 28, 22); d.restore();
    text(d, label, cx - w / 2 + 60, cy + 10, { font: FONT.cjk(28, 600), color: hot ? css("signal") : css("pink"), alpha });
  }
  function tube2(d, pts, color, lw = 2.2) {
    const off = (dd) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      const dx = c[0] - a[0], dy = c[1] - a[1], Ln = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / Ln) * dd, p[1] + (dx / Ln) * dd];
    });
    polyline(d, off(-22), 1, lw, color); polyline(d, off(22), 1, lw, color);
  }
  const RT_TUBE = [[2510, MOUTH_Y + 60], [2510, SPINE], [2880, SPINE]];
  function cell2(L, b, a) {
    const { d, e, s } = L, X = CELLS[1].X, inkC = css("pink"), gr = css("graphite");
    for (const c of [d, e, s]) { c.save(); c.translate(X, 0); c.globalAlpha = 1; }
    // 门：mac 的钥匙 2:0 开门，信封穿过去
    line(d, 100, DTOP + DH, 760, DTOP + DH, 2, inkC);
    const openK = keys(b, [[AT.door, 0], [AT.door + 0.12, 1, E.outExpo], [2.45, 1], [2.6, 0, E.in]]);
    DOORS.forEach((_, i) => door2(d, i, i === 0 ? openK : 0));
    const kk = keys(b, [[1.8, [-120, LOCK[1] + 150]], [AT.door, LOCK, E.outExpo], [2.3, LOCK], [2.5, [LOCK[0], LOCK[1] + 40], E.in]]);
    keycard2(d, kk[0], kk[1], prog(b, 1.8, 1.86) * (1 - prog(b, 2.3, 2.5)), b > 1.95 && b < 2.4);
    // 秤：2:2 信封落到秤盘上，指针晃一晃停在很靠左的地方；右端是 4 MiB
    {
      const [cx, py] = SCALE, cy = py + 140, R = 86;
      line(d, cx - 170, py, cx + 170, py, 3, inkC); line(d, cx, py, cx, cy - R, 2, inkC);
      d.save(); d.strokeStyle = inkC; d.lineWidth = 2.5; d.beginPath(); d.arc(cx, cy, R, Math.PI * 0.85, Math.PI * 2.15); d.stroke(); d.restore();
      for (let j = 0; j <= 10; j++) { const an = Math.PI * (0.85 + 1.3 * j / 10); line(d, cx + Math.cos(an) * (R - 14), cy + Math.sin(an) * (R - 14), cx + Math.cos(an) * R, cy + Math.sin(an) * R, j === 10 ? 4 : 1.5, j === 10 ? css("signal") : inkC); }
      text(d, "4 MiB", cx + R + 18, cy - 34, { font: FONT.mono(30, 600), color: css("signal") });
      const wob = b < AT.scale ? 0 : Math.exp(-(b - AT.scale) * 9) * Math.sin((b - AT.scale) * 60) * 0.5;
      const na = Math.PI * 0.85 + (b < AT.scale ? 0 : 0.1 + wob);
      line(d, cx, cy, cx + Math.cos(na) * (R - 18), cy + Math.sin(na) * (R - 18), 3, css("signal"));
      text(d, tr("ch09.limit"), cx, cy + 90, { font: FONT.cjk(34, 600), align: "center" });
    }
    // 四根管子：只有实时那根往右拐，顺着那条线出这一格
    TUBES.forEach(([k, tx]) => {
      const hot = k === "rt", col = hot ? css("signal") : inkC;
      text(d, tr(`ch09.t.${k}`), tx, MOUTH_Y - 60, { font: FONT.cjk(34, 600), color: col, align: "center" });
      polyline(d, [[tx - 70, MOUTH_Y], [tx - 22, MOUTH_Y + 60]], 1, 2.4, col); polyline(d, [[tx + 70, MOUTH_Y], [tx + 22, MOUTH_Y + 60]], 1, 2.4, col);
      if (hot) tube2(d, RT_TUBE, col);
      else { tube2(d, [[tx, MOUTH_Y + 60], [tx, 640]], col); glyph(d, k, tx, 700, col, 0.9); }
      const p = hot ? impact(b, AT.open + 0.12, 0.12) : 0;
      if (p > 0.02) polyline(d, [[tx - 70, MOUTH_Y], [tx + 70, MOUTH_Y]], 1, 4, css("signal"), p);
    });
    // 三盏灯：回执回来才亮（6:2、6:3、7:0），7:1 盖 202；D1 那盏在后台，不等
    const bus = LAMP_Y - 90, busEnd = LAMPS[2][1] + 200;
    line(d, LAMPS[0][1], bus, busEnd, bus, 2.2, inkC);
    LAMPS.forEach(([k, lx], j) => {
      const on = prog(b, AT.lamps[j], AT.lamps[j] + 0.06);
      line(d, lx, LAMP_Y - 44, lx, bus, 2.2, on > 0 ? css("signal") : inkC);
      d.save(); d.strokeStyle = inkC; d.lineWidth = 3; d.beginPath(); d.arc(lx, LAMP_Y, 40, 0, TAU); d.stroke();
      if (on > 0) { d.globalAlpha = on; d.fillStyle = css("signal"); d.beginPath(); d.arc(lx, LAMP_Y, 32, 0, TAU); d.fill(); }
      d.restore();
      if (on > 0) glow(e, lx, LAMP_Y, 90 * Math.sqrt(L.big), 0.4 * on);
      text(d, tr(k), lx, LAMP_Y + 80, { font: FONT.cjk(30, 600), align: "center", maxW: 340 });
    });
    const fillX = keys(b, [[AT.lamps[0], LAMPS[0][1]], [AT.lamps[1], LAMPS[1][1], E.out], [AT.lamps[2], LAMPS[2][1], E.out], [AT.s202, busEnd, E.io]]);
    if (b > AT.lamps[0]) line(d, LAMPS[0][1], bus, fillX, bus, 3.4 * L.big, css("signal"));
    stamp(s, "202", S202[0], S202[1], { k: prog(b, AT.s202, AT.s202 + 0.14), px: 300, rot: -0.09, sub: "Accepted", subPx: 90 });
    for (const c of [d, e, s]) c.restore();
  }

  // ========== 第 03 格：账房（第 03 章平面图的画法，整体上移 50，排队那条线落在 SPINE 上）==========
  const R3 = { x0: 520, y0: 280, x1: 1080, y1: 780, t: 24 };
  const DOOR3 = { y0: 490, y1: 590 }, SLOT3 = { y0: 516, y1: 544 };
  const DESK = { x: 700, y: 430, w: 260, h: 120 }, BOOK = [830, 490], LAMP3 = [930, 456], TRAY = [930, 520];
  // 账本和「要做的事」先后占右上角同一个位置：落完账（5:0）账本收起、换成那张纸条的详图
  const LED = { x: 1160, y: 60, w: 660, h: 300 }, SLP = { x: 1160, y: 80, w: 660, h: 250 };
  const BOOTH = { x: 1150, y: 450, w: 160, h: 160 }, MAST = [1620, 720];
  const QPATH = [[0, SPINE], [490, SPINE], [R3.x0 + R3.t + 40, SPINE], [BOOK[0] - 90, BOOK[1] + 20], BOOK];
  const Q_FRONT = pathLen(QPATH.slice(0, 2)), Q_BOOK = pathLen(QPATH), GAP = 78;
  // 队里的信封（主角是第三封）：落账时刻
  const QUEUE = [{ t: AT.commits[0], src: "mac", what: "desktop" }, { t: AT.commits[1], src: "homepod", what: "nowPlaying" }, { t: AT.commits[2], src: "mac", what: "appleMusic", hero: true }, { t: 99 }, { t: 99 }];
  function roomPlan3(x) {
    const bone = css("bone"), { x0, y0, x1, y1, t } = R3;
    polyline(x, [[x0, DOOR3.y0], [x0, y0], [x1, y0], [x1, SLOT3.y0]], 1, 2.6, bone);
    polyline(x, [[x1, SLOT3.y1], [x1, y1], [x0, y1], [x0, DOOR3.y1]], 1, 2.6, bone);
    polyline(x, [[x0 + t, DOOR3.y0], [x0 + t, y0 + t], [x1 - t, y0 + t], [x1 - t, SLOT3.y0]], 1, 1.6, bone);
    polyline(x, [[x1 - t, SLOT3.y1], [x1 - t, y1 - t], [x0 + t, y1 - t], [x0 + t, DOOR3.y1]], 1, 1.6, bone);
    x.save(); x.beginPath();
    for (const [rx, ry, rw, rh] of [[x0, y0, x1 - x0, t], [x0, y1 - t, x1 - x0, t], [x0, y0, t, DOOR3.y0 - y0], [x0, DOOR3.y1, t, y1 - DOOR3.y1], [x1 - t, y0, t, SLOT3.y0 - y0], [x1 - t, SLOT3.y1, t, y1 - SLOT3.y1]]) x.rect(rx, ry, rw, rh);
    x.clip(); x.globalAlpha = 0.55; x.strokeStyle = bone; x.lineWidth = 1.1; x.beginPath();
    for (let s = x0 + y0 - 20; s < x1 + y1 + 20; s += 11) { x.moveTo(s - y0, y0); x.lineTo(s - y1, y1); }
    x.stroke(); x.restore();
    x.save(); x.strokeStyle = bone; x.lineWidth = 2.4; x.beginPath(); x.moveTo(x0 + t, DOOR3.y1); x.lineTo(x0 + t + 100, DOOR3.y1); x.stroke();
    x.setLineDash([5, 6]); x.lineWidth = 1.2; x.beginPath(); x.arc(x0 + t, DOOR3.y1, 100, -Math.PI / 2, 0); x.stroke(); x.restore();
    x.save(); x.fillStyle = css("ink2"); x.fillRect(DESK.x, DESK.y, DESK.w, DESK.h); x.strokeStyle = bone; x.lineWidth = 2.2; x.strokeRect(DESK.x, DESK.y, DESK.w, DESK.h);
    x.lineWidth = 1.8; roundRect(x, 800, 382, 60, 40, 6); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.moveTo(804, 378); x.lineTo(856, 378); x.stroke();
    x.fillStyle = css("paper"); x.globalAlpha = 0.92; x.fillRect(772, 462, 116, 60); x.globalAlpha = 1;
    x.strokeStyle = css("pink"); x.lineWidth = 1.8; x.strokeRect(772, 462, 116, 60); x.restore();
    line(x, 830, 462, 830, 522, 1.4, css("pink"));
    x.save(); x.strokeStyle = bone; x.lineWidth = 1.8; x.beginPath(); x.arc(LAMP3[0], LAMP3[1], 11, 0, TAU); x.stroke();
    x.strokeRect(TRAY[0] - 22, TRAY[1] - 14, 44, 28); x.restore();
    // 进口：栏杆只围出一条队
    for (const y of [SPINE - 44, SPINE + 44]) {
      line(x, 280, y, 490, y, 1.2, bone, 0.45);
      for (const px of [280, 350, 420, 490]) { x.save(); x.globalAlpha = 0.7; x.fillStyle = bone; x.beginPath(); x.arc(px, y, 4.5, 0, TAU); x.fill(); x.restore(); }
    }
  }
  function mast3(x, a, pulse) {
    const bone = css("bone"), [mx, my] = MAST;
    x.save(); x.globalAlpha = a; x.strokeStyle = bone; x.lineWidth = 2.2; x.fillStyle = css("ink2");
    x.beginPath(); x.arc(mx, my, 18, 0, TAU); x.fill(); x.stroke(); x.restore();
    line(x, mx - 12, my - 12, mx + 12, my + 12, 1.6, bone, a); line(x, mx - 12, my + 12, mx + 12, my - 12, 1.6, bone, a);
    if (pulse > 0.02) for (let j = 1; j <= 3; j++) { x.save(); x.globalAlpha = a * pulse * (1 - j * 0.22); x.strokeStyle = css("signalD"); x.lineWidth = 2.2; x.beginPath(); x.arc(mx, my, 18 + j * 12, -0.6, 0.6); x.stroke(); x.beginPath(); x.arc(mx, my, 18 + j * 12, Math.PI - 0.6, Math.PI + 0.6); x.stroke(); x.restore(); }
  }
  function tinySlip(d, px, py, a) {
    if (a <= 0) return;
    d.save(); d.globalAlpha = a; d.translate(px, py);
    d.fillStyle = css("paper"); d.fillRect(-18, -12, 36, 24); d.strokeStyle = css("pink"); d.lineWidth = 1.4; d.strokeRect(-18, -12, 36, 24);
    for (let j = 0; j < 3; j++) line(d, -12, -5 + j * 6, 8, -5 + j * 6, 1, css("pink"), 0.6);
    d.restore();
  }
  function cell3(L, b, a) {
    const { x, e, d, s } = L, X = CELLS[2].X, bone = css("bone"), ash = css("ash");
    for (const c of [x, e, d, s]) { c.save(); c.translate(X, 0); }
    roomPlan3(x);
    const commitFlash = Math.max(...QUEUE.map((q) => impact(b, q.t, 0.1)));
    glow(e, LAMP3[0], LAMP3[1], 90, 0.35 + 0.3 * commitFlash);
    text(x, "StateHub · StateCore", R3.x0, R3.y1 + 60, { font: FONT.mono(28, 500), color: ash });
    // 队：每封落账前 0.2 小节往前挪一格；主角带着橙色火花
    const mv = QUEUE.reduce((sum, q) => sum + E.io(prog(b, q.t - 0.2, q.t)), 0);
    QUEUE.forEach((q, i) => {
      if (b >= q.t || (q.hero && b < AT.tube[1])) return;
      const pos = i - mv;
      const [px, py] = pos >= 0 ? pathAt(QPATH, Q_FRONT - pos * GAP) : pathAt(QPATH, Q_FRONT + -pos * (Q_BOOK - Q_FRONT));
      if (px < 10) return;
      envelope(x, px, py, 58, q.hero ? css("signalD") : bone, { lw: 2.2, fill: css("ink2") });
      if (q.hero) { spark(e, null, [px, py - 6], null, { t: G.t, size: 0.75 }); if (b > q.t - 0.7) text(x, "mac · appleMusic", px, py - 56, { font: FONT.mono(28, 500), color: css("signalD"), align: "center", alpha: prog(b, q.t - 0.7, q.t - 0.6) * (1 - prog(pos, -0.4, -0.8)) }); }
    });
    // 账本详图：一封一行，主角那行橙色
    const la = 1 - prog(b, AT.slipWrite - 0.12, AT.slipWrite - 0.04);
    if (la > 0) {
      sheet(d, LED.x, LED.y, LED.w, LED.h, { alpha: la });
      text(d, tr("ch09.ledger"), LED.x + 30, LED.y + 56, { font: FONT.cjk(36, 600), alpha: la });
      text(d, "SQLite", LED.x + LED.w - 30, LED.y + 54, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: la });
      line(d, LED.x + 26, LED.y + 80, LED.x + LED.w - 26, LED.y + 80, 1.4, css("pink"), la);
      const rows = [["mac", "chargingDevices", -1], ["emby", "watching", -1], ...QUEUE.slice(0, 3).map((q) => [q.src, q.what, q.t, q.hero])];
      const done = rows.filter((r) => r[2] < 0 || b >= r[2]).slice(-4);
      done.forEach(([src, what, t, hero], j) => {
        const y = LED.y + 130 + j * 44, k = t < 0 ? 1 : clamp((b - t) / 0.1);
        const col = hero ? css("signal") : css("pink");
        text(d, src, LED.x + 34, y, { font: FONT.mono(30, 500), color: col, alpha: la });
        text(d, what, LED.x + 260, y, { font: FONT.mono(30, 500), color: col, reveal: k, perChar: k < 1, alpha: la });
        polyline(d, [[LED.x + LED.w - 60, y - 12], [LED.x + LED.w - 50, y - 2], [LED.x + LED.w - 32, y - 24]], t < 0 ? 1 : clamp((b - t - 0.04) / 0.08), 4, css("signal"), la);
      });
    }
    // 「要做的事」：5:0 写出 listening 一行；门外照办（6:0）时打勾、盖 waitUntil
    const sa = prog(b, AT.slipWrite - 0.05, AT.slipWrite + 0.05);
    if (sa > 0) {
      sheet(d, SLP.x, SLP.y, SLP.w, SLP.h, { alpha: sa });
      text(d, tr("ch09.slip"), SLP.x + 30, SLP.y + 56, { font: FONT.cjk(36, 600), alpha: sa });
      text(d, "ingest-effects.ts", SLP.x + SLP.w - 30, SLP.y + 54, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: sa });
      line(d, SLP.x + 26, SLP.y + 78, SLP.x + SLP.w - 26, SLP.y + 78, 1.4, css("pink"), sa);
      text(d, "listening", SLP.x + 30, SLP.y + 150, { font: FONT.mono(30, 500), alpha: sa });
      text(d, tr("ch09.listen"), SLP.x + 210, SLP.y + 150, { font: FONT.cjk(30, 600), alpha: sa, reveal: prog(b, AT.slipWrite, AT.slipWrite + 0.3), perChar: true, maxW: SLP.w - 300 });
      checkbox(d, SLP.x + SLP.w - 76, SLP.y + 120, prog(b, AT.split, AT.split + 0.08), { alpha: sa });
      stamp(s, "waitUntil", SLP.x + SLP.w - 190, SLP.y + 212, { k: prog(b, AT.split, AT.split + 0.12), px: 48, rot: -0.08 });
      // 详图的虚线圈：引到桌上的托盘
      x.save(); x.globalAlpha = 0.7 * sa; x.strokeStyle = bone; x.lineWidth = 1.4; x.setLineDash([6, 6]);
      x.beginPath(); x.arc(TRAY[0], TRAY[1], 40, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(TRAY[0] + 20, TRAY[1] - 34); x.lineTo(SLP.x + 30, SLP.y + SLP.h); x.stroke(); x.restore();
    }
    // 小纸条：5:2 起从托盘滑到墙缝、递到门外岗亭
    if (b >= AT.slipWrite && b < AT.split + 0.3) {
      const k1 = prog(b, AT.handout[0], AT.handout[0] + 0.25, E.in), k2 = prog(b, AT.handout[0] + 0.25, AT.handout[1], E.out);
      const p = k2 > 0 ? [lerp(R3.x1 - 10, BOOTH.x + 70, k2), 530] : [lerp(TRAY[0], R3.x1 - 10, k1), lerp(TRAY[1], 530, k1)];
      tinySlip(d, p[0], p[1], prog(b, AT.slipWrite, AT.slipWrite + 0.1) * (1 - prog(b, AT.split + 0.15, AT.split + 0.3)));
    }
    // 门外：StateCore 岗亭、LivePushRoom 天线
    x.save(); x.fillStyle = css("ink2"); x.fillRect(BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h); x.restore();
    K.rect(x, BOOTH.x, BOOTH.y, BOOTH.w, BOOTH.h, 2.4, bone); K.rect(x, BOOTH.x + 14, BOOTH.y + 14, BOOTH.w - 28, BOOTH.h - 28, 1.4, bone);
    line(x, R3.x1, SLOT3.y0 - 4, BOOTH.x, SLOT3.y0 - 4, 1.2, bone, 0.6); line(x, R3.x1, SLOT3.y1 + 4, BOOTH.x, SLOT3.y1 + 4, 1.2, bone, 0.6);
    text(x, "StateCore", BOOTH.x + BOOTH.w / 2, BOOTH.y + BOOTH.h + 44, { font: FONT.mono(30, 500), color: bone, align: "center" });
    const pulse = b >= AT.split ? Math.exp(-(b - AT.split) * BARS * 1.8) : 0;
    mast3(x, 1, pulse);
    text(x, "LivePushRoom", MAST[0], MAST[1] + 64, { font: FONT.mono(30, 500), color: bone, align: "center" });
    // 6:0 同一拍出发的两条路：广播（岗亭 → 天线），回执（岗亭 → 往左回入口）
    const fa = 1 - prog(b, 7.6, 7.8);
    if (b >= AT.split) {
      dashPath(x, [[BOOTH.x + BOOTH.w, 560], [MAST[0] - 26, MAST[1] - 16]], prog(b, AT.split, AT.split + 0.15, E.out), 2, css("signalD"), fa);
      dashPath(x, [[BOOTH.x, 480], [1115, 480], [1115, 230], [R3.x0 - 60, 230]], prog(b, AT.split, AT.split + 0.3, E.io), 2, css("signalD"), fa);
      // 橙环从天线荡开
      const sec = (b - AT.split) * BARS;
      for (let j = 0; j < 3; j++) {
        const Rr = (sec - j * 0.16) * 800;
        if (Rr <= 20 || Rr > 1300) continue;
        const fade = Math.pow(1 - Rr / 1300, 1.5);
        e.save(); e.globalAlpha = 0.5 * fade; e.strokeStyle = "rgba(240,150,105,1)"; e.lineWidth = 5 - j * 1.2; e.beginPath(); e.arc(MAST[0], MAST[1], Rr, 0, TAU); e.stroke(); e.restore();
      }
    }
    line(x, MAST[0] + 18, MAST[1], MAST[0] + 160, MAST[1], 1.6, bone, 0.5);
    polyline(x, [[MAST[0] + 160, MAST[1]], [MAST[0] + 160, SPINE], [CELLS[2].W, SPINE]], 1, 2, bone, 0.5);
    for (const c of [x, e, d, s]) c.restore();
  }

  // ========== 第 04 格：印版（第 04 章 P 表缩印）==========
  const P4 = [
    [190, 8, 234, 40, 1], [0, 64, 304, 56, 1], [0, 124, 304, 61, 0], [310, 64, 304, 121, 1], [0, 192, 214, 117, 1], [0, 313, 214, 117, 1],
    [218, 192, 396, 142, 1, "listening-now"], [218, 338, 396, 92, 1], [0, 437, 372, 152, 1], [376, 437, 238, 152, 1], [0, 596, 614, 152, 1],
    [0, 755, 614, 103, 1], [0, 865, 614, 258, 1], [0, 1127, 362, 200, 1], [366, 1127, 248, 200, 1], [0, 1334, 614, 118, 1], [0, 1456, 362, 183, 1],
    [366, 1456, 248, 183, 1], [0, 1646, 614, 212, 0], [0, 1865, 614, 106, 0], [0, 1975, 614, 106, 0], [0, 2085, 614, 106, 0], [0, 2195, 614, 106, 0],
    [0, 2305, 614, 111, 0], [0, 2430, 270, 152, 1], [274, 2430, 340, 152, 1],
  ];
  const G4 = { x: 620, y: 110, s: 0.36 };
  function cell4(L, b) {
    const { d, e } = L, X = CELLS[3].X;
    d.save(); d.translate(X, 0); e.save(); e.translate(X, 0);
    line(d, 0, SPINE, CELLS[3].W, SPINE, 2, css("pink"), 0.6);
    const hot = win(b, AT.plate4 - 0.05, AT.plate4 + 0.05, AT.plate4 + 0.6, AT.plate4 + 1.0);
    for (const [u, v, w, h, tag, id] of P4) {
      const px = G4.x + u * G4.s, py = G4.y + v * G4.s, W = w * G4.s - 2, H = h * G4.s - 2;
      const lit = id ? hot : 0;
      d.save(); d.fillStyle = css("paper"); d.shadowColor = "rgba(0,0,0,0.25)"; d.shadowBlur = 4; d.shadowOffsetY = 2; d.fillRect(px, py, W, H); d.restore();
      K.rect(d, px, py, W, H, lit > 0.3 ? 3 : 1.6, lit > 0.3 ? css("signal") : css("pink"));
      if (tag) { d.save(); d.strokeStyle = css("pink"); d.lineWidth = 1.2; d.beginPath(); d.moveTo(px + W - 12, py + 4); d.lineTo(px + W - 4, py + 4); d.lineTo(px + W - 4, py + 12); d.stroke(); d.restore(); }
      if (lit > 0) glow(e, px + W / 2, py + H / 2, 110, 0.45 * lit);
    }
    // 这句注只在拉远的机位上出现（缩放 0.25）：字按 4 倍写，屏幕上 30 px
    const na = prog(b, AT.plate4, AT.plate4 + 0.1);
    if (na > 0) {
      const [u, v, w] = P4[6];
      polyline(d, [[G4.x + (u + w) * G4.s, G4.y + (v + 26) * G4.s], [1000, G4.y + (v + 26) * G4.s], [1000, 640]], prog(b, AT.plate4, AT.plate4 + 0.15, E.out), 5, css("signal"));
      text(d, tr("ch09.noRecast1"), 90, 800, { font: FONT.cjk(124, 600), color: css("signal"), reveal: prog(b, AT.plate4 + 0.05, AT.plate4 + 0.3), maxW: 1280 });
      text(d, tr("ch09.noRecast2"), 90, 950, { font: FONT.cjk(124, 600), color: css("signal"), reveal: prog(b, AT.plate4 + 0.3, AT.plate4 + 0.5), maxW: 1280 });
    }
    d.restore(); e.restore();
  }

  // ========== 第 05 格：电报线（第 05 章示波器的画法：那条线就是这一页的 /ws）==========
  const PULSE_X = 420, SWR = { x: 700, y: 640, w: 780, h: 330 }, PW = { x: 1640, y: 600, w: 620, h: 400 };
  const NP_ROW = [PW.x + 30, PW.y + 190, PW.w - 60, 120]; // 迷你页面里「正在听」那一格
  function pulseY(dx, amp) {
    if (dx < -40 || dx > 120) return 0;
    const gs = (c, w) => Math.exp(-(((dx - c) / w) ** 2));
    return amp * (gs(0, 8) - 0.34 * gs(24, 13) + 0.12 * gs(52, 16));
  }
  function cell5(L, b) {
    const { x, e, d } = L, X = CELLS[4].X, bone = css("bone"), ash = css("ash");
    for (const c of [x, e, d]) { c.save(); c.translate(X, 0); }
    // 电报线：这一格里就是 SPINE，推送进来时画成橙色发光的线；到站那一下是往下的脉冲
    const amp = b < AT.pulse ? 0 : 112 * E.spring(clamp((b - AT.pulse) / 0.3));
    const pts = [];
    for (let u = 0; u <= CELLS[4].W; u += u > PULSE_X - 50 && u < PULSE_X + 130 ? 2 : 40) pts.push([u, SPINE + pulseY(u - PULSE_X, amp)]);
    const lit = prog(b, 7.55, 7.8);
    strokePts(e, pts, 9, "rgb(240,150,105)", 0.3 * lit);
    strokePts(x, pts, 2.4, lit > 0 ? css("signalD") : bone, lit > 0 ? 0.95 : 0.6);
    text(x, "wss://…/ws", 110, SPINE - 40, { font: FONT.mono(30, 500), color: ash });
    if (b >= AT.pulse) {
      glow(e, PULSE_X, SPINE + amp * 0.85, 120, impact(b, AT.pulse, 0.14));
      text(x, "listening-now", PULSE_X + 20, SPINE - 40, { font: FONT.mono(28, 500), color: css("signalD"), alpha: prog(b, AT.pulse, AT.pulse + 0.08) });
    }
    // 掉出来的电报纸条落进浏览器缓存那一行
    const row = (i) => SWR.y + 136 + i * 60;
    const sk = prog(b, AT.pulse + 0.05, AT.swr, E.io);
    if (sk > 0 && sk < 1) {
      const px = lerp(PULSE_X, SWR.x + 60, sk), py = lerp(SPINE + 130, row(1) - 10, sk) - Math.sin(sk * Math.PI) * 60;
      const w = measure(d, "listening-now", FONT.mono(30, 500)) + 40;
      sheet(d, px - w / 2, py - 26, w, 52, { shadow: 12 });
      text(d, "listening-now", px, py + 11, { font: FONT.mono(30, 500), align: "center" });
    }
    sheet(d, SWR.x, SWR.y, SWR.w, SWR.h);
    text(d, "SWR", SWR.x + 30, SWR.y + 58, { font: FONT.mono(36, 600) });
    text(d, tr("ch09.swr"), SWR.x + 30 + measure(d, "SWR", FONT.mono(36, 600)) + 16, SWR.y + 56, { font: FONT.cjk(30, 600), color: css("graphite") });
    text(d, "receivedAt", SWR.x + SWR.w - 30, SWR.y + 56, { font: FONT.mono(28), color: css("graphite"), align: "right" });
    line(d, SWR.x + 26, SWR.y + 80, SWR.x + SWR.w - 26, SWR.y + 80, 1.4, css("pink"));
    const wk = prog(b, AT.swr, AT.swr + 0.12);
    [["/api/status/desktop", "10:35:02"], ["/api/status/listening/now", null], ["/api/status/playing/now", "—"]].forEach(([k, v], i) => {
      const y = row(i), hero = i === 1;
      if (hero && wk > 0) fillRect(d, SWR.x + 18, y - 38, SWR.w - 36, 54, css("signal"), 0.14 * wk);
      text(d, k, SWR.x + 30, y, { font: FONT.mono(28, 500), color: hero && wk > 0 ? css("signal") : css("pink") });
      if (hero) text(d, wk > 0 ? "10:35:17" : "10:31:40", SWR.x + SWR.w - 30, y, { font: FONT.mono(28, wk > 0 ? 600 : 500), color: wk > 0 ? css("signal") : css("graphite"), align: "right" });
      else text(d, v, SWR.x + SWR.w - 30, y, { font: FONT.mono(28, 500), color: css("graphite"), align: "right" });
    });
    text(d, "mutate(path, data, {revalidate: false})", SWR.x + 30, SWR.y + SWR.h - 26, { font: FONT.mono(28), color: css("graphite"), maxW: SWR.w - 60 });
    if (wk > 0) glow(e, SWR.x + SWR.w / 2, row(1) - 10, 200, 0.3 * impact(b, AT.swr, 0.2));
    // 迷你页面：写完缓存，火花奔向页面里「正在听」那一格（9:3 切到第 00 章那张主页）
    x.save(); x.fillStyle = css("ink2"); x.fillRect(PW.x, PW.y, PW.w, PW.h); x.restore();
    K.rect(x, PW.x, PW.y, PW.w, PW.h, 2.2, bone);
    line(x, PW.x, PW.y + 44, PW.x + PW.w, PW.y + 44, 1.2, bone, 0.6);
    text(x, "lyjw.me", PW.x + PW.w / 2, PW.y + 32, { font: FONT.mono(28, 500), color: ash, align: "center" });
    K.rect(x, PW.x + 30, PW.y + 70, 270, 100, 1.4, bone, 0.5); K.rect(x, PW.x + 320, PW.y + 70, 270, 100, 1.4, bone, 0.5);
    const npHot = b >= AT.toPage[1] - 0.1;
    K.rect(x, NP_ROW[0], NP_ROW[1], NP_ROW[2], NP_ROW[3], npHot ? 2.8 : 1.6, npHot ? css("signalD") : bone, npHot ? 1 : 0.7);
    cover(x, NP_ROW[0] + 16, NP_ROW[1] + 16, 88, 0.9, bone, css("ink"));
    text(x, OLD, NP_ROW[0] + 124, NP_ROW[1] + 64, { font: FONT.cjk(36, 600), color: bone, alpha: 0.9 });
    K.rect(x, PW.x + 30, PW.y + 330, PW.w - 60, 50, 1.4, bone, 0.4);
    for (const c of [x, e, d]) c.restore();
  }

  // ========== 第 06、07 格：只在全景里当缩略图 ==========
  function cell6(L) {
    const { d } = L, X = CELLS[5].X;
    d.save(); d.translate(X, 0);
    line(d, 120, 420, 1320, 420, 14, css("pink")); line(d, 120, 420, 120, 720, 14, css("signal")); line(d, 120, 720, 1320, 720, 14, css("signal"));
    for (const [cx, cy] of [[120, 420], [640, 720], [1320, 420], [1320, 720]]) { d.save(); d.fillStyle = css("paper"); d.strokeStyle = css("pink"); d.lineWidth = 6; d.beginPath(); d.arc(cx, cy, 20, 0, TAU); d.fill(); d.stroke(); d.restore(); }
    d.restore();
  }
  function cell7(L, b) {
    const { d } = L, X = CELLS[6].X;
    d.save(); d.translate(X, 0);
    [300, 720, 1140].forEach((cx, i) => {
      const th = 0.36 * Math.cos(Math.PI * b * (i === 0 ? 4 : i === 1 ? 0.8 : 2));
      d.save(); d.translate(cx, 900); d.scale(0.85, 0.85); d.strokeStyle = css("pink"); d.fillStyle = css("paper"); d.lineWidth = 3.4; d.lineJoin = "round";
      d.beginPath(); d.moveTo(-140, -40); d.lineTo(-54, -400); d.lineTo(54, -400); d.lineTo(140, -40); d.closePath(); d.fill(); d.stroke();
      roundRect(d, -170, -40, 340, 40, 6); d.fill(); d.stroke();
      d.translate(0, -92); d.rotate(th); d.lineWidth = 6; d.lineCap = "round"; d.beginPath(); d.moveTo(0, 16); d.lineTo(0, -286); d.stroke();
      d.restore();
    });
    d.restore();
  }

  // ========== 信封（火花）一路的位置：[小节, 世界坐标]，折线按弧长插值 ==========
  // 01：Hub → 停在笔记本旁边 → 飞出这一格；02：穿门 → 秤 → 管口上方；实时管 → 出格 → 03 的队尾
  const RT_WORLD = RT_TUBE.map(([u, v]) => [Wx(1, u), v]);
  const HERO_PATH = [
    [AT.envOut, [Wx(0, HUB[0]), HUB[1] + 30]], [AT.park, [Wx(0, PARK[0]), PARK[1]]], [AT.leave, [Wx(0, PARK[0]), PARK[1]]],
    [AT.door, [Wx(1, LOCK[0] - 30), SPINE]], [AT.scale, [Wx(1, SCALE[0]), SCALE[1] - 42]], [AT.toTubes[0], [Wx(1, SCALE[0]), SCALE[1] - 42]],
    [AT.toTubes[1], [Wx(1, OPEN_AT[0]), OPEN_AT[1]]], [AT.open + 0.05, [Wx(1, OPEN_AT[0]), OPEN_AT[1]]],
  ];
  function heroEnvelope(L, b) {
    const { tp, e } = L;
    if (b < AT.envOut || b >= AT.open + 0.1) return;
    let p0 = HERO_PATH[0], p1 = HERO_PATH[1];
    for (let i = 1; i < HERO_PATH.length; i++) if (b <= HERO_PATH[i][0]) { p0 = HERO_PATH[i - 1]; p1 = HERO_PATH[i]; break; }
    const k = E.io(prog(b, p0[0], p1[0]));
    const pos = [lerp(p0[1][0], p1[1][0], k), lerp(p0[1][1], p1[1][1], k)];
    const size = lerp(24, 64, prog(b, AT.envOut, AT.park));
    const open = prog(b, AT.open - 0.1, AT.open + 0.05);
    const onPaper = pos[0] >= CELLS[1].X; // 第 01 格是暗底，第 02 格是纸
    envelope(tp, pos[0], pos[1], size, onPaper ? css("signal") : css("signalD"), { lw: 2.4, fill: onPaper ? css("paper") : css("ink2"), open, alpha: 1 - prog(b, AT.open + 0.02, AT.open + 0.1) });
    spark(e, null, [pos[0], pos[1] - 6], null, { t: G.t, size: 0.8 });
    if (b >= AT.leave && b < AT.door) line(tp, Wx(0, PARK[0]), SPINE, pos[0] - 30, SPINE, 2.4, css("signal"), 0.8); // 飞出去时身后拖一段线
  }
  // 拆开后那一格 appleMusic 的小牌子落进实时管；之后火花顺着管子、那条线走到第 03 格的队尾
  function heroChip(L, b) {
    const { tp } = L;
    const k = prog(b, AT.open, AT.open + 0.12, E.io);
    if (k <= 0 || k >= 1) return;
    const sx = Wx(1, OPEN_AT[0]), sy = OPEN_AT[1] - 40, tx = Wx(1, 2510), ty = MOUTH_Y + 20;
    const cx = lerp(sx, tx, k), cy = lerp(sy, ty, k) - Math.sin(k * Math.PI) * 90;
    tp.save(); tp.font = FONT.mono(28, 500);
    const w = tp.measureText("mac · appleMusic").width + 40;
    tp.fillStyle = css("paper"); tp.strokeStyle = css("signal"); tp.lineWidth = 2; roundRect(tp, cx - w / 2, cy - 26, w, 52, 26); tp.fill(); tp.stroke(); tp.restore();
    text(tp, "mac · appleMusic", cx, cy + 10, { font: FONT.mono(28, 500), color: css("signal"), align: "center" });
  }
  const TUBE_RUN = [[Wx(1, 2510), MOUTH_Y + 30], ...RT_WORLD.slice(1), [Wx(2, 0), SPINE], [Wx(2, 490 - GAP), SPINE]];
  const TUBE_LEN = pathLen(TUBE_RUN);
  function tubeSpark(L, b) {
    if (b < AT.tube[0] || b >= AT.tube[1]) return;
    const dd = keys(b, [[AT.tube[0], 0], [AT.tube[1], TUBE_LEN, E.io]]);
    spark2(L, pathAt(TUBE_RUN, dd), trailOn(TUBE_RUN, dd, 420), 1, 3);
  }
  // 6:0 起：回执往左回到第 02 格的三盏灯；推送往右，经过第 04 格，进第 05 格的线，8:0 到站
  const RECEIPT = [[Wx(2, BOOTH.x), 480], [Wx(2, 1115), 480], [Wx(2, 1115), 230], [Wx(2, 0), 230], [Wx(1, 2880), 230], [Wx(1, 2620), 600], [Wx(1, LAMPS[0][1] + 60), LAMP_Y - 90]];
  const PUSH = [[Wx(2, MAST[0]), MAST[1]], [Wx(2, MAST[0] + 160), MAST[1]], [Wx(2, MAST[0] + 160), SPINE], [Wx(4, PULSE_X), SPINE]];
  const PUSH_LEN = pathLen(PUSH), RECEIPT_LEN = pathLen(RECEIPT);
  function splitRun(L, b) {
    const { d } = L;
    const rk = prog(b, AT.receipt[0], AT.receipt[1], E.io);
    const k = L.big;
    if (rk > 0 && rk < 1) {
      const [rx, ry] = pathAt(RECEIPT, rk * RECEIPT_LEN);
      d.save(); d.translate(rx, ry); d.scale(k, k);
      sheet(d, -110, -36, 220, 68, { shadow: 18 });
      text(d, "ok · data", 0, 11, { font: FONT.mono(32, 600), align: "center" });
      d.restore();
    }
    if (b >= AT.push[0] && b < AT.push[1] + 0.05) {
      const up = pathLen(PUSH.slice(0, 3)), along = (wx) => up + (wx - PUSH[2][0]);
      const dd = keys(b, [[AT.push[0], 0], [6.3, up, E.out], [AT.plate4, along(Wx(3, G4.x + 90)), E.lin], [7.75, along(CELLS[4].X), E.lin], [AT.push[1], PUSH_LEN, E.in]]);
      spark2(L, pathAt(PUSH, dd), trailOn(PUSH, dd, 700 * k, 20), 1.2 * k, 3.2 * k);
    }
  }
  // 8:2 写完缓存，火花从那一行奔向迷你页面里「正在听」那一格
  const TO_PAGE = [[Wx(4, SWR.x + SWR.w - 30), SWR.y + 186], [Wx(4, PW.x - 60), SWR.y + 186], [Wx(4, NP_ROW[0] + 60), NP_ROW[1] + 60]];
  function toPage(L, b) {
    if (b < AT.toPage[0] || b >= AT.cutHome) return;
    const dd = keys(b, [[AT.toPage[0], 0], [AT.toPage[1], pathLen(TO_PAGE), E.io]]);
    spark2(L, pathAt(TO_PAGE, dd), trailOn(TO_PAGE, dd, 300), 1, 3);
  }

  // 火花：纸面上相加的光只会把纸照白，亮核另画一个实心的橙点（画在最上层，暗底纸面都看得见）
  function spark2(L, head, trail, size, lw) {
    spark(L.e, L.tp, head, trail, { t: G.t, size, lw });
    L.tp.save(); L.tp.fillStyle = css("signal"); L.tp.beginPath(); L.tp.arc(head[0], head[1], 6 * size, 0, TAU); L.tp.fill(); L.tp.restore();
  }

  // ---------- 各格之间的那条线（格与格的空隙里，骨白）----------
  function gaps(L, zoom) {
    const lw = Math.max(2.4, 1.6 / zoom);
    for (let i = 0; i < CELLS.length - 1; i++) line(L.x, CELLS[i].X + CELLS[i].W, SPINE, CELLS[i + 1].X - (i === CELLS.length - 2 ? 60 : 0), SPINE, lw, css("bone"), 0.9);
  }

  // ========== 镜头 ==========
  const OVC = [(CELLS[0].X + CELLS[7].X + CELLS[7].W) / 2, 560, (1920 * 0.92) / (CELLS[7].X + CELLS[7].W - CELLS[0].X)];
  const toScreen = (w, c) => [(w[0] - c[0]) * c[2] + 960, (w[1] - c[1]) * c[2] + 540];
  function anchored(k, W, p0, p1, z0, z1) {
    const z = Math.exp(lerp(Math.log(z0), Math.log(z1), k));
    const p = [lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)];
    return [W[0] - (p[0] - 960) / z, W[1] - (p[1] - 540) / z, z, 0];
  }
  const C1V = [Wx(0, 960), 560, 1, 0];
  const C2A = [Wx(1, 1000), 560, 1, 0], C2B = [Wx(1, 1400), 560, 1, 0], C2C = [Wx(1, 2080), 560, 1, 0];
  const C3V = [Wx(2, 1000), 560, 1, 0];
  const WIDE = [(Wx(1, 1500) + Wx(4, 700)) / 2, 640, 0.25, 0];
  const C5V = [Wx(4, 960), 580, 1, 0], C5B = [Wx(4, 1500), 600, 1.05, 0];
  const NP_W = [Wx(4, NP_ROW[0] + 60), NP_ROW[1] + 60];
  const PEN = [NOW_X, SPINE];
  const CAM_B = [
    [AT.rush1[1], C1V], [AT.leave, [C1V[0] + 14, 560, 1.02, 0], E.lin],
    [AT.door, C2A, E.io], [2.35, [C2A[0] + 10, 560, 1.01, 0], E.lin], [2.55, C2B, E.io], [3.0, [C2B[0] + 10, 560, 1.01, 0], E.lin],
    [3.3, C2C, E.io], [3.8, [C2C[0] + 10, 560, 1.01, 0], E.lin],
    [4.05, C3V, E.io], [6.2, [C3V[0] + 14, 560, 1.02, 0], E.lin],
    [6.45, WIDE, E.io], [7.4, [WIDE[0], WIDE[1], WIDE[2] * 1.02, 0], E.lin],
  ];
  function camAt(b) {
    if (b < AT.pull[0]) return [960, 540, 1, 0];
    if (b < AT.pull[1]) return anchored(E.io(prog(b, AT.pull[0], AT.pull[1])), PEN, [NOW_X, SPINE], toScreen(PEN, OVC), 1, OVC[2]);
    if (b < AT.rush1[0]) return keys(b, [[AT.pull[1], OVC], [AT.rush1[0], [OVC[0], OVC[1], OVC[2] * 1.02, 0], E.lin]]);
    if (b < AT.rush1[1]) { const c0 = [OVC[0], OVC[1], OVC[2] * 1.02]; return anchored(E.io(prog(b, AT.rush1[0], AT.rush1[1])), [C1V[0], C1V[1]], toScreen([C1V[0], C1V[1]], c0), [960, 540], c0[2], 1); }
    if (b < 7.4) return keys(b, CAM_B);
    if (b < 7.8) { const c0 = keys(7.4, CAM_B); return anchored(E.io(prog(b, 7.4, 7.8)), [C5V[0], C5V[1]], toScreen([C5V[0], C5V[1]], c0), [960, 540], c0[2], 1); }
    if (b < 9.0) return keys(b, [[7.8, C5V], [9.0, [C5V[0] + 12, 580, 1.015, 0], E.lin]]);
    if (b < 9.45) return keys(b, [[9.0, [C5V[0] + 12, 580, 1.015, 0]], [9.45, C5B, E.io]]);
    return anchored(E.inExpo(prog(b, 9.45, AT.cutHome)), NP_W, toScreen(NP_W, C5B), [960, 540], C5B[2], 3.2);
  }

  // ========== 旁白：屏幕坐标，排在各个机位的左下；纸面格用墨色写在纸上，暗底格用骨白 ==========
  const NARR = [
    ["ch09.n1a", 1.05, 1.5, 1.72, false], ["ch09.n1b", 2.05, 2.6, 3.72, true],
    ["ch09.n2a", 4.1, 4.8, 5.9, false], ["ch09.n2b", 6.02, 6.6, 7.4, false], ["ch09.n3a", 7.85, 8.3, 9.4, false],
  ];
  function narration(L, b) {
    for (const [k, t0, t1, t2, paper] of NARR) {
      const a = win(b, t0 - 0.05, t0 + 0.05, t2, t2 + 0.1);
      if (a <= 0) continue;
      const ctx = paper ? L.d : L.x;
      ctx.save(); ctx.setTransform(G.S, 0, 0, G.S, 0, 0);
      K.narration(ctx, tr(k), 110, 1000, { reveal: prog(b, t0, t1), alpha: a, color: paper ? css("pink") : css("bone"), maxW: 1100 });
      ctx.restore();
    }
  }
  // 全景时的标题（屏幕坐标）
  function title(L, b) {
    const a = win(b, 0.3, 0.45, 0.82, 0.92);
    if (a <= 0) return;
    const { x } = L;
    x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0);
    text(x, "09", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: a });
    text(x, tr("ch09.title"), 290, 176, { font: FONT.cjk(58, 600), color: css("bone"), reveal: prog(b, 0.32, 0.6), alpha: a });
    text(x, "mac · appleMusic → Now Playing", 292, 226, { font: FONT.mono(28), color: css("ash"), reveal: prog(b, 0.4, 0.7), alpha: a });
    line(x, 110, 262, 110 + 990 * prog(b, 0.35, 0.7, E.outExpo), 262, 1.4, css("bone"), 0.6 * a);
    text(x, "PLATE 09 · RECAP", G.W - 60, 1000, { font: FONT.mono(30, 600), color: css("bone"), align: "right", alpha: a });
    x.restore();
  }

  // ========== 长图版这一段的一整帧（0–9.75）==========
  const POST_DARK = { bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4 };
  function plateFrame(f, b) {
    const { x: X, e: Em, d: D, s: S, tp: T } = lay();
    const c = camAt(b), c0 = camAt(Math.max(0, b - 1 / 60 / BARS));
    const hitS = Math.max(impact(b, AT.door, 0.1), impact(b, AT.split, 0.12), impact(b, AT.s202, 0.1), impact(b, AT.pulse, 0.1));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.014 * hitS), rot: 0 };
    G.setCam(cam);
    G.fill(G.pass(K.PLATE.ink), { uGridA: 1, uPlate: PLATE_RECT });
    const x = X.begin(); X.cam(cam);
    const e = Em.begin(); Em.cam(cam);
    const d = D.begin(); D.cam(cam);
    const s = S.begin(); S.cam(cam);
    const tp = T.begin(); T.cam(cam);
    // 拉远到 0.25 的那一段，回执、推送的火花、灯的光按镜头缩放放大（最多 3.2 倍），远看也认得出
    const L = { x, e, d, s, tp, big: clamp(0.8 / cam.zoom, 1, 3.2) };
    const half = 960 / cam.zoom + 200, seen = (i) => CELLS[i].X < cam.x + half && CELLS[i].X + CELLS[i].W > cam.x - half;
    // 0:0 这一帧只有心电图：其余各格等镜头往后拉时才出来
    const ca = prog(b, 0.12, 0.35);
    const markA = win(b, 0.35, 0.5, 0.82, 0.95);
    CELLS.forEach((cell, i) => {
      if (!seen(i)) return;
      const a = i === 7 ? prog(b, 0.15, 0.4) : ca;
      if (a <= 0) return;
      cellBase(L, i, a);
      cellMark(L, i, markA);
      if (i === 7) { cell8(L, b, a); cellHead(L, 7, a, 0); return; }
      if (a < 1) { // 拉远那一下只画底和格头的淡影；内容等停住再画
        cellHead(L, i, a, 0);
        return;
      }
      if (i === 0) cell1(L, b, 1);
      else if (i === 1) cell2(L, b, 1);
      else if (i === 2) cell3(L, b, 1);
      else if (i === 3) cell4(L, b);
      else if (i === 4) cell5(L, b);
      else if (i === 5) cell6(L);
      else if (i === 6) cell7(L, b);
      const lit = i === 0 ? win(b, 1, 1.1, 1.8, 1.9) : i === 1 ? win(b, 2, 2.1, 3.85, 4) : i === 2 ? win(b, 4, 4.1, 6.2, 6.4) : i === 4 ? win(b, 7.8, 7.9, 9.7, 9.8) : 0;
      cellHead(L, i, 1, lit);
    });
    gaps(L, cam.zoom);
    // 第 08 格：心电图再卷一拍、拉平，光点退掉
    if (seen(7)) ecg(L, PHI0 + b * 4, 1 - prog(b, AT.flat[0], AT.flat[1], E.io), 1 - prog(b, 0.3, 0.55));
    heroEnvelope(L, b);
    heroChip(L, b);
    tubeSpark(L, b);
    splitRun(L, b);
    toPage(L, b);
    narration(L, b);
    title(L, b);
    G.composite(X.upload(), { mode: G.MODE.ink, seed: 6.7 });
    G.composite(D.upload(), { mode: G.MODE.paper });
    G.composite(Em.upload(), { mode: G.MODE.add, gain: 1.5 });
    G.composite(S.upload(), { mode: G.MODE.stamp, seed: 2.9 });
    G.composite(T.upload(), { mode: G.MODE.normal });
    const sh = hitS * 6;
    const zb = Math.log(c[2] / c0[2]);
    f.post = {
      ...POST_DARK, shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: Math.max(-0.2, Math.min(0.2, zb)),
      flash: impact(b, AT.s202, 0.1) * 0.05, flashCol: [1, 0.8, 0.6],
    };
  }

  // ========== 收尾：第 00 章的终端 ==========
  function endState(b, S) {
    const st = S.termState(2); // 敲完、回车、欢迎框都在的那一刻
    const C = window.Clawd, fr = C.FRAME_MS / 1000 / BARS;
    let cf = { pose: "default", offset: 0, x: 0 };
    for (const t0 of AT.celebrate) { const i = Math.floor((b - t0) / fr + 1e-6); if (i >= 0 && i < C.SEQ.celebrate.length) cf = C.SEQ.celebrate[i]; }
    st.clawd = cf; st.say = 0;
    st.cursor = { line: 2, on: false };
    st.endcard = { a: prog(b, AT.endcard, AT.endcard + 0.06), reveal: prog(b, AT.endcard, AT.endcard + 0.6), l1: tr("ch09.end1"), l2: tr("ch09.end2") };
    st.clear = prog(b, AT.clear[0], AT.clear[1]);
    if (st.clear >= 1) { st.welcome = 0; st.endcard = null; st.typed = 0; st.cursor = { line: 1, on: true }; }
    return st;
  }

  function render(f) {
    const b = f.bar, S = ch00();
    if (b < AT.cutHome || !S) { plateFrame(f, Math.min(b, AT.cutHome - 1e-6)); return; }
    if (b < AT.cutTerm) {
      // 9:3 起就是第 00 章 3.75–4.5 那一段（10:0 翻面），不画页眉；10:0 之后别的卡退淡，给旁白让地方
      const b00 = S.AT.flip + (b - AT.flip);
      S.paperFrame(f, b00, {
        hud: false, b0: S.AT.flip + (AT.cutHome - AT.flip),
        focus: 0.8 * prog(b, AT.flip + 0.05, AT.flip + 0.25),
        extra: (Lr) => {
          const a = prog(b, AT.flip + 0.05, AT.flip + 0.12);
          if (a <= 0) return;
          Lr.d.save(); Lr.d.setTransform(G.S, 0, 0, G.S, 0, 0);
          K.narration(Lr.d, tr("ch09.n3b"), 110, 1000, { reveal: prog(b, AT.flip + 0.05, AT.flip + 0.3), alpha: a, maxW: 1100 });
          Lr.d.restore();
        },
      });
      return;
    }
    if (b >= AT.still) { S.termFrame(f, S.termState(0)); return; }
    // 片尾字卡：镜头先稍微推近终端的下半，12.5 起拉回整个终端（第 00 章第一帧的镜头）
    const zk = E.io(prog(b, AT.pullTerm[0], AT.pullTerm[1]));
    const cam = { x: 960, y: lerp(600, 540, zk), zoom: lerp(1.12, 1, zk), rot: 0 };
    S.termFrame(f, endState(b, S), cam);
    const zk0 = E.io(prog(b - 1 / 60 / BARS, AT.pullTerm[0], AT.pullTerm[1]));
    f.post.zoomBlur = Math.max(-0.2, Math.min(0.2, Math.log(lerp(1.12, 1, zk) / lerp(1.12, 1, zk0))));
    f.post.blur = [0, (lerp(600, 540, zk0) - lerp(600, 540, zk)) * cam.zoom];
  }

  window.CHAPTERS.push({
    id: "ch09", title: "ch.09", bars: 14,
    init() { G.pass(K.PLATE.ink); G.pass(K.PLATE.paper); lay(); },
    render,
  });
})();
