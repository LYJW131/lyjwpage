// 第 06 章 · 两条线路（交付：图片、大陆访问、发版，FACTS §6）。14 小节，纸面地铁图，全是 2D。
// 两条线只用两种颜色：lyjw.me 墨色、lyjw131.com 橙色；站是纸色圆点加站名，两条线都通到 Vercel 源站。
// 机位（章内小节）：
//   0–1 第 05 章拉平的那条线（屏幕 y 540）成了 lyjw.me 线，往后拉出整张图；lyjw131.com 线从源站分出去
//   1–4 ESA 站：5 分钟的钟走完，过期先给旧页，后台回源（Cache-Control 的 max-age / stale-while-revalidate）
//   4–7 图片是索书号：借书卡上的 /img/<哈希>.webp（Emby 海报）；lyjw.me 边缘 rewrite 到 R2，ESA 缓存同一路径
//   7–12 拉远看整张图，底下一条发版接力：六站在强拍上一站站亮（第 02 章三盏灯的画法），第 ③ 站等两个域名都打勾
//   12–14 开着的页面顶上纵向弹出 UPDATE 卡；两条线往右延伸，镜头跟着横移，停在空白的纸上交给第 07 章
// 配乐锚点（music/ch06.js，章内 小节:拍）：0:0 转到 E 多利亚 · 2:2 钟走完 · 3:2 新页回到 ESA · 4:3 图片上路 ·
// 6:0 印章 · 8:0 ① · 8:2 ② · 9:0 / 9:2 ③ 两个域名 · 10:0 ④ · 10:2 ⑤（主题起）· 11:0 ⑥（主题唱完）· 12:0 卡片弹出。
// 改时间先对这张表和 SCRIPT.md。坐标是世界坐标，开场镜头在 (1400, 540)、缩放 1。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, stamp, spark, roundRect, pathAt, pathLen, trailOn, mulberry32 } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch06.title": ["两条线路", "Two lines"],
    "ch06.origin": ["源站", "origin"],
    "ch06.esa": ["阿里云 ESA", "Alibaba Cloud ESA"],
    "ch06.visitors": ["访客", "visitors"],
    "ch06.mainland": ["大陆访客", "mainland visitors"],
    "ch06.images": ["图片", "images"],
    "ch06.n1a": ["大陆访客走 lyjw131.com：", "Mainland visitors ride lyjw131.com;"],
    "ch06.n1b": ["ESA 缓存 5 分钟，过期先给旧页。", "ESA caches it for five minutes."],
    "ch06.stale": ["过期先给旧页，后台回源", "Stale: old page now, refetch behind"],
    "ch06.card": ["借书卡", "Library card"],
    "ch06.poster": ["Emby 海报", "Emby poster"],
    "ch06.callno": ["索书号", "Call number"],
    "ch06.changed": ["内容变了 → 新名字", "New content → new name"],
    "ch06.noPurge": ["不用刷新", "never purged"],
    "ch06.apple": ["（在听的封面来自 Apple 目录，不走这条路）", "(Now-playing covers come from Apple's catalog, not /img.)"],
    "ch06.rewrite": ["边缘 rewrite", "edge rewrite"],
    "ch06.esaImg": ["ESA 缓存同一路径", "ESA caches the same path"],
    "ch06.n2a": ["图片像索书号：", "Images work like call numbers:"],
    "ch06.n2b": ["内容变了名字就变，永远不用刷新。", "new content, new name, never purged."],
    "ch06.r1": ["部署成功", "deployed"],
    "ch06.r2": ["刷新 ESA 并预热", "purge + warm ESA"],
    "ch06.r3": ["两个域名都答出新版", "both domains answer"],
    "ch06.r4": ["入口收到", "reaches ingress"],
    "ch06.r5": ["推送房间广播", "broadcast"],
    "ch06.r6": ["开着的页面弹出", "pops on open pages"],
    "ch06.n3a": ["发版是一场接力：", "A release is a relay:"],
    "ch06.n3b": ["两个域名都换好，才喊一声 version。", "both domains first, then “version”."],
    "ch06.foot": ["页面另有兜底：每 30 分钟问一次，切回焦点也问一次", "Fallback: pages also ask every 30 minutes and on refocus."],
  });
  const tr = (k) => I18N.tr(k);
  let plate, ink, emit, paper, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  // ---------- 线路图（世界坐标） ----------
  const ME_Y = 540, CN_Y = 840, LW = 14; // 两条线的高度和线宽
  const O = [400, ME_Y]; // Vercel 源站：两条线的起点
  const ESA = [1400, CN_Y], L = [2400, ME_Y], C = [2400, CN_Y];
  const R2 = [1000, 250], SPUR_X = 1000;
  const ME_PATH = [O, L], CN_PATH = [O, [700, CN_Y], C];
  const CLK = [1620, 1040], CLK_R = 80;
  // 发版接力：一条线上六站；①②③ 正对图上的源站、ESA、两个域名的终点站（虚线连上去）
  const RY = 1450, LAMP_R = 66;
  const RELAY = [
    { x: 400, t: 8.0, mono: "Vercel", key: "ch06.r1", up: ME_Y + 30 },
    { x: 1400, t: 8.5, mono: "GitHub Actions", key: "ch06.r2", up: CN_Y + 16 },
    { x: 2400, t: 9.5, mono: "/api/version", key: "ch06.r3", up: CN_Y + 16 },
    { x: 3000, t: 10.0, mono: "site-deployed", key: "ch06.r4" },
    { x: 3600, t: 10.5, mono: "version", key: "ch06.r5" },
    { x: 4200, t: 11.0, mono: "UPDATE", key: "ch06.r6" },
  ];
  const CHECK = [[L, 9.0], [C, 9.5]]; // ③：两个域名的 /api/version 先后答出新版，两个都打勾才亮
  const CARD = { x: 1580, y: -10, w: 900, h: 450 };
  const UC = { x: 3960, y: 980, w: 880, h: 280 }; // UPDATE 卡

  // 索书号：64 位十六进制（和上报器一样按内容的 sha256 起名，这里用种子随机数代替，不抄真的对象键）
  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const KEY_OLD = hex64(606), KEY_NEW = hex64(6060);
  const callNo = (k) => `/img/${k.slice(0, 10)}…${k.slice(-6)}.webp`;
  const chipNo = (k) => `/img/${k.slice(0, 8)}….webp`;

  // ---------- 机位：[小节, [x, y, zoom, rot], 进入这一段的缓动] ----------
  const START = [1400, ME_Y, 1, 0]; // 第 05 章最后那条直线在屏幕 y 540：这一帧只有 lyjw.me 那条线横穿画面
  const OVER = [1230, 560, 0.7, 0];
  const ESAV = [1500, 900, 1, 0], IMGV = [1500, 560, 0.85, 0];
  const RELAY0 = [1900, 1000, 0.5, 0], RELAY1 = [2850, 1000, 0.5, 0];
  const UPD = [4400, 1000, 0.85, 0], END = [6400, 690, 0.85, 0];
  const CAM = [
    [0, START],
    [0.12, START],
    [0.95, OVER, E.io],
    [1.0, [1232, 561, 0.705, 0], E.lin],
    [1.25, ESAV, E.io],
    [3.85, [1506, 902, 1.02, 0], E.lin],
    [4.1, IMGV, E.io],
    [6.85, [1508, 562, 0.866, 0], E.lin],
    [7.1, RELAY0, E.io],
    [11.75, RELAY1, E.lin],
    [12.0, UPD, E.io],
    [12.95, [4410, 998, 0.86, 0], E.lin],
    // 交给第 07 章：同一张纸，不切；镜头往右横移，停下时画面上只剩两条横穿的线
    [14.0, END, E.io],
  ];
  const camAt = (b) => keys(b, CAM);

  // ---------- 画 ----------
  function station(x, cx, cy, a, o = {}) {
    if (a <= 0) return;
    const r = o.r ?? 18;
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("paper"); x.strokeStyle = o.hot ? css("signal") : css("pink"); x.lineWidth = o.lw ?? 6;
    x.beginPath(); x.arc(cx, cy, r * lerp(0.6, 1, E.outBack(clamp(a))), 0, Math.PI * 2); x.fill(); x.stroke();
    x.restore();
  }
  function pageIcon(x, cx, cy, col, a, s = 1) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(s, s);
    x.fillStyle = css("paper"); x.strokeStyle = col; x.lineWidth = 3;
    x.beginPath(); x.moveTo(-22, -30); x.lineTo(10, -30); x.lineTo(22, -18); x.lineTo(22, 30); x.lineTo(-22, 30); x.closePath(); x.fill(); x.stroke();
    for (let j = 0; j < 3; j++) { x.beginPath(); x.moveTo(-12, -12 + j * 12); x.lineTo(12 - (j === 2 ? 10 : 0), -12 + j * 12); x.stroke(); }
    x.restore();
  }
  function chip(x, label, cx, cy, hot, alpha, px = 32) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.font = FONT.mono(px, 500);
    const w = x.measureText(label).width + px * 1.2, h = px * 1.66;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 2.4;
    roundRect(x, cx - w / 2, cy - h / 2, w, h, h / 2); x.fill(); x.stroke();
    x.restore();
    text(x, label, cx, cy + px * 0.36, { font: FONT.mono(px, 500), color: hot ? css("signal") : css("pink"), align: "center", alpha });
  }
  function tick(x, cx, cy, s, k, a = 1) {
    polyline(x, [[cx - 0.5 * s, cy], [cx - 0.12 * s, cy + 0.38 * s], [cx + 0.6 * s, cy - 0.5 * s]], k, s * 0.16, css("signal"), a);
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill(); e.restore();
  }
  function nar(x, key, px, py, r, a, size, maxW) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: size, maxW, reveal: r, alpha: a, dim: 0.12 });
  }

  // 标题、图例（整张图的机位缩放 0.7：字按 1.6 倍写）；只在这个机位上，之后的机位会把它切在画面边上
  function title(x, b) {
    const a = prog(b, 0.3, 0.7) * (1 - prog(b, 1.02, 1.16));
    if (a <= 0) return;
    text(x, "06", -100, 170, { font: FONT.pixel(180), color: css("signal"), alpha: a });
    text(x, tr("ch06.title"), 200, 150, { font: FONT.cjk(94, 600), reveal: prog(b, 0.35, 0.9), alpha: a, maxW: 700 });
    text(x, "lyjw.me · lyjw131.com", 204, 222, { font: FONT.mono(46), color: css("graphite"), reveal: prog(b, 0.5, 1.0), alpha: a });
    line(x, -100, 262, lerp(-100, 900, prog(b, 0.4, 1.0, E.outExpo)), 262, 2.4, css("pink"), a);
    const la = prog(b, 0.65, 0.9) * (1 - prog(b, 1.02, 1.16));
    line(x, -100, 340, -10, 340, LW, css("pink"), la);
    text(x, "lyjw.me", 14, 356, { font: FONT.mono(46, 500), alpha: la });
    line(x, -100, 420, -10, 420, LW, css("signal"), la);
    text(x, "lyjw131.com", 14, 436, { font: FONT.mono(46, 500), color: css("signal"), alpha: la });
  }

  // 两条线：lyjw.me 开场就在（从第 05 章那条细线变粗），lyjw131.com 从源站分出去；12:3 起两条都往右延伸
  function lines(x, b) {
    const cam = camAt(b);
    const reach = b < 12.3 ? L[0] : Math.max(lerp(L[0], 5750, prog(b, 12.3, 12.95, E.io)), cam[0] + 960 / cam[2] + 250);
    const lw = lerp(4, LW, prog(b, 0.05, 0.5, E.io));
    line(x, O[0], ME_Y, reach, ME_Y, lw, css("pink"));
    // 延伸那一段接在两个终点站后面
    const ck = prog(b, 0.3, 0.9, E.io);
    polyline(x, CN_PATH, ck, LW, css("signal"));
    if (reach > C[0]) line(x, C[0], CN_Y, reach, CN_Y, LW, css("signal"));
    // R2 的支线：lyjw.me 在边缘 rewrite 到 R2
    polyline(x, [[SPUR_X, ME_Y], [SPUR_X, R2[1] + 20]], prog(b, 0.6, 0.85), 6, css("pink"));
  }

  function stations(x, b) {
    station(x, O[0], O[1], prog(b, 0.35, 0.5), { r: 30, lw: 7, hot: b >= 8.0 && b < 8.5 });
    station(x, ESA[0], ESA[1], prog(b, 0.6, 0.72), { hot: b >= 8.5 && b < 9.0 });
    station(x, L[0], L[1], prog(b, 0.5, 0.62));
    station(x, C[0], C[1], prog(b, 0.8, 0.92));
    station(x, R2[0], R2[1], prog(b, 0.72, 0.84), { r: 16, lw: 5 });
    const la = (t0) => prog(b, t0, t0 + 0.15);
    text(x, "Vercel", O[0] - 50, O[1] + 16, { font: FONT.mono(46, 600), align: "right", alpha: la(0.45) });
    text(x, tr("ch06.origin"), O[0] - 50, O[1] + 66, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.5) });
    text(x, tr("ch06.esa"), ESA[0] - 34, ESA[1] - 34, { font: FONT.mono(46, 600), align: "right", alpha: la(0.66), maxW: 560 });
    text(x, "lyjw.me", L[0] - 40, L[1] + 72, { font: FONT.mono(46, 600), align: "right", alpha: la(0.56) });
    text(x, tr("ch06.visitors"), L[0] - 40, L[1] + 120, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.6) });
    text(x, "lyjw131.com", C[0] - 40, C[1] + 72, { font: FONT.mono(46, 600), color: css("signal"), align: "right", alpha: la(0.86) });
    text(x, tr("ch06.mainland"), C[0] - 40, C[1] + 120, { font: FONT.cjk(40, 600), color: css("graphite"), align: "right", alpha: la(0.9) });
    text(x, "R2", R2[0] + 36, R2[1] + 16, { font: FONT.mono(46, 600), alpha: la(0.78) });
    text(x, tr("ch06.images"), R2[0] + 104, R2[1] + 16, { font: FONT.cjk(40, 600), color: css("graphite"), alpha: la(0.82) });
  }

  // 1–4 ESA：5 分钟的钟；走完了先把旧页给访客，同时沿线回源，新页回来再换上
  function esaBeat(x, e, b) {
    const a = win(b, 1.3, 1.45, 3.85, 4.0);
    if (a <= 0) return;
    const [cx, cy] = CLK;
    line(x, cx, CN_Y + LW / 2, cx, cy - CLK_R, 2, css("pink"), a);
    const fillK = b < 3.5 ? prog(b, 1.5, 2.5) : 0;
    const expired = b >= 2.5 && b < 3.5;
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("paper"); x.strokeStyle = expired ? css("signal") : css("pink"); x.lineWidth = 4;
    x.beginPath(); x.arc(cx, cy, CLK_R, 0, Math.PI * 2); x.fill(); x.stroke();
    // 一圈就是 300 秒：每 30 秒一格
    for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + (i / 10) * Math.PI * 2; line(x, cx + Math.cos(an) * (CLK_R - 14), cy + Math.sin(an) * (CLK_R - 14), cx + Math.cos(an) * (CLK_R - 4), cy + Math.sin(an) * (CLK_R - 4), i % 5 ? 2 : 4, css("pink")); }
    if (fillK > 0) { x.globalAlpha = a * 0.28; x.fillStyle = css("signal"); x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, CLK_R - 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fillK); x.closePath(); x.fill(); }
    x.globalAlpha = a;
    const hand = -Math.PI / 2 + Math.PI * 2 * fillK;
    line(x, cx, cy, cx + Math.cos(hand) * (CLK_R - 20), cy + Math.sin(hand) * (CLK_R - 20), 4, expired ? css("signal") : css("pink"), a);
    x.restore();
    if (expired) glow(e, cx, cy, 170, 0.35 * impact(b, 2.5, 0.25));
    text(x, "max-age=300", cx + 110, cy + 44, { font: FONT.mono(30), color: css("graphite"), alpha: a * prog(b, 1.4, 1.55) });
    text(x, "stale-while-revalidate=86400", cx + 110, cy + 88, { font: FONT.mono(30), color: css("graphite"), alpha: a * prog(b, 1.45, 1.6) });
    text(x, tr("ch06.stale"), cx + 110, cy - 14, { font: FONT.cjk(38, 600), color: css("signal"), reveal: prog(b, 2.5, 2.95), alpha: a, maxW: 720 });
    // ESA 手上那一份页；过期后照样先给访客（灰），同时回源，新的一份（橙）3:2 回来换上
    const fresh = b >= 3.5;
    pageIcon(x, ESA[0], ESA[1] + 90, fresh ? css("signal") : css("pink"), a * (b > 2.95 && b < 3.45 ? 0.35 : 1));
    if (b >= 2.5 && b < 3.0) {
      const k = prog(b, 2.5, 2.9, E.io);
      pageIcon(x, lerp(ESA[0] + 60, C[0] - 90, k), CN_Y - 60, css("graphite"), a * (1 - prog(k, 0.85, 1)), 0.8);
      const back = [ESA, [700, CN_Y], O];
      const d = prog(b, 2.5, 2.9, E.in) * pathLen(back);
      x.save(); x.setLineDash([12, 10]);
      polyline(x, back, prog(b, 2.5, 2.9, E.in), 4, css("pink"), a); // 橙线上画墨色虚线才看得见
      x.restore();
      spark(e, null, pathAt(back, d), null, { t: G.t, size: 0.55 });
    }
    if (b >= 2.95 && b < 3.5) {
      const k = prog(b, 2.95, 3.45, E.io), fwd = [[O[0] + 60, O[1] + 90], [760, CN_Y + 62], [ESA[0], CN_Y + 62], [ESA[0], CN_Y + 90]];
      pageIcon(x, ...pathAt(fwd, k * pathLen(fwd)), css("signal"), a, 0.8);
    }
  }

  // 4–7 借书卡：索书号就是内容的哈希；同一个路径在 lyjw.me 走边缘 rewrite 到 R2，在 lyjw131.com 由 ESA 缓存
  function imgBeat(x, d, s, e, b) {
    const a = win(b, 4.1, 4.25, 6.85, 7.0);
    if (a <= 0) return;
    const { x: px, y: py, w, h } = CARD;
    const pop = E.outBack(prog(b, 4.1, 4.28));
    d.save(); d.globalAlpha = a; d.translate(px + w / 2, py + h / 2); d.scale(lerp(0.8, 1, pop), lerp(0.8, 1, pop)); d.translate(-px - w / 2, -py - h / 2);
    d.shadowColor = "rgba(0,0,0,0.3)"; d.shadowBlur = 18; d.shadowOffsetY = 8;
    d.fillStyle = css("paper"); d.fillRect(px, py, w, h);
    d.shadowColor = "transparent";
    d.strokeStyle = css("pink"); d.lineWidth = 2.4; d.strokeRect(px, py, w, h);
    d.strokeStyle = css("signal"); d.lineWidth = 1.2; d.globalAlpha = a * 0.5;
    for (let j = 0; j < 4; j++) { d.beginPath(); d.moveTo(px + 24, py + 226 + j * 70); d.lineTo(px + w - 24, py + 226 + j * 70); d.stroke(); } // 借书卡的格线
    d.restore();
    text(d, tr("ch06.card"), px + 36, py + 66, { font: FONT.cjk(46, 600), alpha: a });
    text(d, tr("ch06.poster"), px + w - 36, py + 64, { font: FONT.cjk(38, 600), color: css("graphite"), align: "right", alpha: a });
    line(d, px + 28, py + 92, px + w - 28, py + 92, 2, css("pink"), a);
    text(d, tr("ch06.callno"), px + 36, py + 148, { font: FONT.cjk(36, 600), color: css("graphite"), alpha: a });
    text(d, callNo(KEY_OLD), px + 36, py + 206, { font: FONT.mono(38, 500), alpha: a, reveal: prog(b, 4.2, 4.7), perChar: true });
    const nk = prog(b, 5.5, 5.62);
    if (nk > 0) {
      text(d, tr("ch06.changed"), px + 36, py + 290, { font: FONT.cjk(36, 600), color: css("graphite"), alpha: a * nk });
      text(d, callNo(KEY_NEW), px + 36, py + 346, { font: FONT.mono(38, 500), color: css("signal"), alpha: a, reveal: prog(b, 5.55, 6.0), perChar: true });
    }
    text(d, "max-age=31536000, immutable", px + 36, py + h - 34, { font: FONT.mono(34), color: css("graphite"), alpha: a * prog(b, 4.6, 4.75) });
    stamp(s, "immutable", px + w - 128, py + 250, { k: prog(b, 6.0, 6.12), px: 50, rot: -0.12, sub: tr("ch06.noPurge"), subPx: 36, alpha: a });
    text(d, tr("ch06.apple"), px - 20, 1012, { font: FONT.cjk(34, 600), color: css("graphite"), reveal: prog(b, 6.15, 6.6), alpha: a, maxW: 1000 });
    // 同一个路径上路：lyjw.me 那头沿线到支线、上 R2；lyjw131.com 那头到 ESA 就停下
    const lab = chipNo(KEY_OLD);
    const kA = prog(b, 4.75, 5.12, E.io), kUp = prog(b, 5.12, 5.3, E.in);
    if (kA > 0 && kA < 1) chip(d, lab, lerp(L[0], SPUR_X + 200, kA), ME_Y - 50, false, 1);
    if (kA >= 1 && kUp < 1) spark(e, d, [SPUR_X, lerp(ME_Y, R2[1] + 24, kUp)], [[SPUR_X, ME_Y], [SPUR_X, lerp(ME_Y, R2[1] + 24, kUp)]], { t: G.t, size: 0.6, lw: 3 });
    const kB = prog(b, 4.875, 5.3, E.io);
    if (kB > 0) {
      chip(d, lab, lerp(C[0] - 150, ESA[0] + 210, kB), CN_Y - 50, true, a);
    }
    const ra = prog(b, 5.0, 5.2) * a;
    text(d, tr("ch06.rewrite"), SPUR_X - 28, 470, { font: FONT.cjk(36, 600), align: "right", alpha: ra });
    text(d, "/img/*", SPUR_X - 28, 420, { font: FONT.mono(36, 500), color: css("graphite"), align: "right", alpha: ra });
    if (kUp >= 1) glow(e, R2[0], R2[1], 110, 0.5 * impact(b, 5.3, 0.3));
    text(d, tr("ch06.esaImg"), ESA[0] + 210, CN_Y + 72, { font: FONT.cjk(36, 600), color: css("signal"), align: "center", alpha: prog(b, 5.25, 5.45) * a, maxW: 560 });
  }

  // 7–12 发版接力：一条线上六盏灯，一站亮一盏，汇流线跟着一段段变橙
  function relay(x, e, b) {
    const a = prog(b, 7.1, 7.35);
    if (a <= 0) return;
    const x0 = RELAY[0].x, x1 = RELAY[RELAY.length - 1].x;
    polyline(x, [[x0, RY], [x1, RY]], prog(b, 7.1, 7.6, E.io), 3, css("pink"));
    const fill = keys(b, [[8.0, x0], ...RELAY.slice(1).map((r) => [r.t, r.x, E.out])]);
    if (b > 8.0) line(x, x0, RY, fill, RY, 5, css("signal"));
    RELAY.forEach((r, i) => {
      const ap = prog(b, 7.2 + i * 0.07, 7.4 + i * 0.07);
      if (ap <= 0) return;
      const on = prog(b, r.t, r.t + 0.06);
      // 连到图上的站：虚线
      if (r.up) { x.save(); x.setLineDash([12, 12]); line(x, r.x, r.up, r.x, RY - LAMP_R - 6, 2.6, on > 0 ? css("signal") : css("pink"), ap * 0.8); x.restore(); }
      x.save(); x.globalAlpha = ap; x.fillStyle = css("paper"); x.strokeStyle = css("pink"); x.lineWidth = 5;
      x.beginPath(); x.arc(r.x, RY, LAMP_R, 0, Math.PI * 2); x.fill(); x.stroke();
      if (on > 0) { x.globalAlpha = ap * on; x.fillStyle = css("signal"); x.beginPath(); x.arc(r.x, RY, LAMP_R - 10, 0, Math.PI * 2); x.fill(); }
      x.restore();
      if (on > 0) glow(e, r.x, RY, 190, 0.55 * on * (0.75 + 0.25 * impact(b, r.t, 0.3)));
      text(x, String(i + 1), r.x, RY + 22, { font: FONT.mono(62, 700), color: on > 0.5 ? css("paper") : css("pink"), align: "center", alpha: ap });
      text(x, r.mono, r.x, RY + LAMP_R + 70, { font: FONT.mono(60, 600), align: "center", alpha: ap, maxW: 560 });
      text(x, tr(r.key), r.x, RY + LAMP_R + 146, { font: FONT.cjk(60, 600), color: css("graphite"), align: "center", alpha: ap, maxW: 560 });
    });
    // ③：两个域名的 /api/version 一个一个答出新版，图上两个终点站打勾
    CHECK.forEach(([[sx, sy], t]) => tick(x, sx + 70, sy - 10, 70, prog(b, t, t + 0.1, E.out), 1));
    // ①② 亮的时候，图上对应的站也闪一下
    glow(e, O[0], O[1], 150, 0.5 * impact(b, 8.0, 0.35));
    glow(e, ESA[0], ESA[1], 130, 0.5 * impact(b, 8.5, 0.35));
    // ⑤ 广播：环从推送房间荡开，扫到 ⑥
    const R5 = RELAY[4];
    if (b >= R5.t && b < R5.t + 1.2) {
      const sec = (b - R5.t) * BARs;
      for (let j = 0; j < 3; j++) {
        const rr = (sec - j * 0.16) * 650;
        if (rr <= LAMP_R || rr > 900) continue;
        const fade = Math.pow(1 - rr / 900, 1.4);
        e.save(); e.globalAlpha = 0.5 * fade; e.strokeStyle = "rgba(240,150,105,1)"; e.lineWidth = 8 - j * 2;
        e.beginPath(); e.arc(R5.x, RY, rr, 0, Math.PI * 2); e.stroke(); e.restore();
        x.save(); x.globalAlpha = 0.45 * fade; x.strokeStyle = css("signal"); x.lineWidth = 2.4;
        x.beginPath(); x.arc(R5.x, RY, rr, 0, Math.PI * 2); x.stroke(); x.restore();
      }
    }
  }

  // 12–14 UPDATE 卡：按站点那张卡的样子画（UPDATE / New version / 旧 → 新的提交 / Reload），纵向弹出
  function updateCard(d, b) {
    const k = prog(b, 12.0, 12.28);
    if (k <= 0) return;
    const { x: px, y: py, w, h } = UC;
    const sy = E.outBack(k);
    d.save(); d.translate(px, py); d.scale(1, Math.max(0.001, sy)); d.translate(-px, -py);
    d.shadowColor = "rgba(0,0,0,0.3)"; d.shadowBlur = 20; d.shadowOffsetY = 8;
    d.fillStyle = css("paper"); d.fillRect(px, py, w, h);
    d.shadowColor = "transparent";
    d.strokeStyle = css("pink"); d.lineWidth = 2.6; d.strokeRect(px, py, w, h);
    line(d, px, py + 70, px + w, py + 70, 1.6, css("pink"), 0.6);
    const ta = clamp((k - 0.5) * 2);
    text(d, "UPDATE", px + 30, py + 48, { font: FONT.mono(36, 600), color: css("graphite"), alpha: ta, tracking: 4 });
    text(d, "DISMISS ×", px + w - 30, py + 48, { font: FONT.mono(34, 500), color: css("graphite"), align: "right", alpha: ta });
    d.save(); d.globalAlpha = ta; d.fillStyle = css("signal"); d.beginPath(); d.arc(px + 44, py + 134, 10, 0, Math.PI * 2); d.fill(); d.restore();
    text(d, "New version", px + 68, py + 150, { font: FONT.sans(46, 600), alpha: ta });
    d.save(); d.globalAlpha = ta; d.strokeStyle = css("pink"); d.lineWidth = 1.6; roundRect(d, px + 30, py + 180, 430, 64, 8); d.stroke(); d.restore();
    text(d, "63f8203 → 5939ef8", px + 50, py + 224, { font: FONT.mono(36, 500), color: css("graphite"), alpha: ta });
    d.save(); d.globalAlpha = ta; d.fillStyle = css("pink"); roundRect(d, px + w - 250, py + 120, 210, 76, 12); d.fill(); d.restore();
    text(d, "Reload", px + w - 145, py + 170, { font: FONT.sans(40, 600), color: css("paper"), align: "center", alpha: ta });
    d.restore();
    text(d, tr("ch06.foot"), px, py + h + 62, { font: FONT.cjk(38, 600), color: css("graphite"), reveal: prog(b, 12.3, 12.9), alpha: prog(b, 12.3, 12.4), maxW: 1180 });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, 6.0), ...RELAY.map((r) => impact(b, r.t, 0.08) * 0.6), impact(b, 12.0, 0.12));
    cam.zoom *= 1 + 0.015 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: [-600, -300, 9000, 2400] });

    const x = ink.begin(); ink.cam(cam);
    const d = paper.begin(); paper.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const tp = top.begin(); top.cam(cam);

    title(x, b);
    lines(x, b);
    stations(x, b);
    esaBeat(x, e, b);
    imgBeat(x, d, s, e, b);
    relay(x, e, b);
    updateCard(d, b);

    // ---- 旁白 ----
    nar(d, "ch06.n1a", 560, 1290, prog(b, 1.3, 1.9), win(b, 1.3, 1.4, 3.8, 3.95), 60, 1040);
    nar(d, "ch06.n1b", 560, 1375, prog(b, 1.9, 2.7), win(b, 1.3, 1.4, 3.8, 3.95), 60, 1040);
    nar(d, "ch06.n2a", 420, 1030, prog(b, 4.15, 4.7), win(b, 4.15, 4.25, 6.8, 6.95), 71, 1224);
    nar(d, "ch06.n2b", 420, 1115, prog(b, 4.7, 5.6), win(b, 4.15, 4.25, 6.8, 6.95), 71, 1224);
    nar(d, "ch06.n3a", 1000, 1860, prog(b, 7.5, 8.2), win(b, 7.5, 7.6, 11.55, 11.7), 120, 2080);
    nar(d, "ch06.n3b", 1000, 1990, prog(b, 8.2, 9.3), win(b, 7.5, 7.6, 11.55, 11.7), 120, 2080);

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 8.3 });
    // 借书卡、UPDATE 卡是纸上的一张张纸（带落影），按纸片模式合成；灯的光晕压在卡片上面
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 1.7 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 6;
    f.post = {
      bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch06", title: "ch.06", bars: 14,
    init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); paper = G.layer("paper"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
