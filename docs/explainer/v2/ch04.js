// 第 04 章 · 活字印版（Vercel 上的 Next.js 首屏，FACTS §4）。12 小节，纸面，全是 2D。
// 首屏是一整页印版：page.tsx 每调一次 firstScreen(key) 就是一条 'use cache'，画成一块印版，块上写它的 page: 标签名
// （没挂标签的写端点末段）。印版按 lyjw.me 桌面宽度实测的卡片框乘 0.6 排（整页约 614 × 2580），
// 一张卡读几个视图就切成几块（page.tsx#READS）。挂标签的印版右上角吊一枚小标签，没挂的那里空着，第 8 小节起亮计时环。
// 机位（章内小节）：
//   0–1 从第 03 章冲进去的那张纸往后拉，整页现出来 · 1–3 出纸口：访客拿到一张印好的页
//   3–5 顺着页面往下走：每块一根线接到 DO / KV LAG 两条轨，轨通到页底的库符号，脚注 cacheLife
//   5–8 页头近景：在线 → 离线失效的 3 个标签，三块被夹起、在重拍上重印、放回；旧页照发，新页在后台印
//   8–11 页底：没挂标签的几块亮 600 秒计时环；pulse 那块回源碰上 503，印版不动，盖「沿用上一份」
//   11–12 甩回页头：换歌，「在听」那块亮一下但不重印（交给推送），镜头推进去，12:0 硬切第 05 章
// 配乐锚点（music/ch04.js，章内 小节:拍）：0:0 印刷机的重拍进来 · 2:0 递出一页 · 5:0 在线翻转（接第 03 章）·
// 5:2 旧页照发 · 6:0 / 6:2 / 7:0 三块重印 · 7:2 新页入库 · 8:0–8:3 计时环一个一声 · 9:2 回源 · 10:0 大章 · 11:0 主题 · 11:3 吸气。
// 改时间先对这张表和 SCRIPT.md。坐标是世界坐标；印版那张页的左上角在 (0, 0)。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, stamp, spark, roundRect, glyph, pathAt, pathLen, trailOn } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch04.title": ["活字印版", "The type case"],
    "ch04.n1a": ["访客来了，递出一张印好的页；", "A visitor gets a printed page;"],
    "ch04.n1b": ["每块印版各自缓存。", "every plate is cached on its own."],
    "ch04.pages": ["印好的页", "Printed pages"],
    "ch04.visitor": ["访客", "Visitor"],
    "ch04.rt": ["实时", "Realtime"],
    "ch04.lag": ["可滞后", "Lag-tolerant"],
    "ch04.foot": ["'use cache' · stale 300 / revalidate 600 / expire 7 天", "'use cache' · stale 300 / revalidate 600 / expire 7 days"],
    "ch04.flip": ["在线 → 离线：失效 3 个标签", "Online → offline: 3 tags invalidated"],
    "ch04.old": ["旧页照发", "The old page still ships"],
    "ch04.new": ["新页 · 后台印", "New page · printing"],
    "ch04.n2a": ["一个标签失效，只重铸那一块；", "Invalidate a tag: recast one plate;"],
    "ch04.n2b": ["旧页照发，新页在后台印。", "old pages ship while new ones print."],
    "ch04.n3a": ["没挂标签的几块，", "The untagged plates"],
    "ch04.n3b": ["只看 600 秒的定时器。", "just wait out a 600-second timer."],
    "ch04.keep": ["沿用上一份", "keeps the last copy"],
    "ch04.n4a": ["来源出错，那块印版不动，", "If a source fails, its plate stays,"],
    "ch04.n4b": ["继续用上一份。", "and the last copy keeps going out."],
    "ch04.song": ["换歌不重印：交给推送", "A song change isn't recast: the push handles it"],
  });
  const tr = (k) => I18N.tr(k);
  let plate, ink, emit, paper, stampL, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出

  // ---------- 印版：一个视图一块。rt = 实时层（读 DO），tag = 挂着 page: 标签（src/lib/status-views.ts#STATUS_VIEWS）----------
  // r = [x, y, w, h]；k = 块面上的浮雕（卡片内容的示意，只当纹理）
  const P = [
    { id: "desktop", rt: 1, tag: 1, r: [190, 8, 234, 40], k: "badge" }, // 页头中间那枚徽章
    { id: "coding-year", rt: 1, tag: 1, r: [0, 64, 304, 56], k: "none" }, // Contact 卡：编码年度格子
    { id: "github-chart", rt: 0, tag: 0, r: [0, 124, 304, 61], k: "none" }, // Contact 卡：GitHub 贡献图
    { id: "timezone", rt: 0, tag: 1, r: [310, 64, 304, 121], k: "clock" },
    { id: "charger", rt: 1, tag: 1, r: [0, 192, 214, 117], k: "charge" }, // Media 卡四块
    { id: "powerbank", rt: 1, tag: 1, r: [0, 313, 214, 117], k: "battery" },
    { id: "listening-now", rt: 1, tag: 1, r: [218, 192, 396, 142], k: "hero" },
    { id: "listening", rt: 1, tag: 1, r: [218, 338, 396, 92], k: "row" },
    { id: "activity", rt: 0, tag: 1, r: [0, 437, 372, 152], k: "rings" },
    { id: "workouts", rt: 0, tag: 1, r: [376, 437, 238, 152], k: "bars" },
    { id: "server", rt: 0, tag: 1, r: [0, 596, 614, 152], k: "spark" },
    { id: "agent-status", rt: 0, tag: 1, r: [0, 755, 614, 103], k: "dots" },
    { id: "coding", rt: 1, tag: 1, r: [0, 865, 614, 258], k: "chart" }, // Vibe Coding 卡三块
    { id: "coding-now", rt: 1, tag: 1, r: [0, 1127, 362, 200], k: "list" },
    { id: "limits", rt: 0, tag: 1, r: [366, 1127, 248, 200], k: "meters" },
    { id: "playing-now", rt: 1, tag: 1, r: [0, 1334, 614, 118], k: "hero" }, // PlayStation 卡三块
    { id: "playing", rt: 1, tag: 1, r: [0, 1456, 362, 183], k: "list" },
    { id: "trophies", rt: 1, tag: 1, r: [366, 1456, 248, 183], k: "tiles" },
    { id: "pulse", rt: 1, tag: 0, r: [0, 1646, 614, 212], k: "lanes" },
    { id: "github-repo", rt: 0, tag: 0, r: [0, 1865, 614, 106], k: "text" }, // LYJWPAGE 卡五块（server 那条缓存和出口节点卡共用，只画一块）
    { id: "vercel-deployments", rt: 0, tag: 0, r: [0, 1975, 614, 106], k: "text" },
    { id: "cloudflare-workers", rt: 0, tag: 0, r: [0, 2085, 614, 106], k: "text" },
    { id: "sentry", rt: 0, tag: 0, r: [0, 2195, 614, 106], k: "cells" },
    { id: "reporters", rt: 0, tag: 0, r: [0, 2305, 614, 111], k: "text" },
    { id: "watching-now", rt: 1, tag: 1, r: [0, 2430, 270, 152], k: "poster" }, // Emby 那一栏
    { id: "watching", rt: 1, tag: 1, r: [274, 2430, 340, 152], k: "tiles" },
  ];
  const PAGE_W = 614, PAGE_H = 2582;
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  // 线从印版的哪一高度出去：跨过别的印版时避开那块底边的字
  const TAP = { "listening-now": 30, listening: 20, "github-chart": 10, activity: 60, trophies: 50, watching: 50 };
  for (const p of P) {
    const [x, y, w, h] = p.r;
    p.ty = y + (TAP[p.id] ?? h / 2);
    p.ex = p.rt ? x : x + w; // 线的起点：实时的从左边出去，可滞后的从右边出去
  }
  const RAIL = { rt: -70, lag: 684 }, GLYPH_Y = 2760;
  const RECAST = [["desktop", 6.0], ["listening-now", 6.5], ["charger", 7.0]]; // 在线 → 离线失效的三块（第 03 章：DESKTOP / NOW_LISTENING / CHARGER）
  const recastAt = Object.fromEntries(RECAST);
  const TIMERS = [["github-chart", 8.0], ["pulse", 8.125], ["github-repo", 8.25], ["vercel-deployments", 8.375], ["cloudflare-workers", 8.5], ["sentry", 8.625], ["reporters", 8.75]];
  const timerAt = Object.fromEntries(TIMERS);
  const FAIL = "pulse", FAIL_T = 9.5; // 这一块的计时到点、回源碰上 503

  // 出纸口一侧：一叠印好的页、访客的浏览器窗口、后台正在印的新页
  const MINI = 0.18; // 缩印比例
  const STACK = [880, 40], NEWP = [1090, 290], WIN = { x: 1300, y: 40, w: 440, h: 300 };

  // ---------- 机位：[小节, [x, y, zoom, rot], 进入这一段的缓动] ----------
  // 起点就是第 03 章最后一帧的镜头（冲进白卡的那一点，缩放 12）：纸纹是世界坐标的函数，同一点同一缩放，两章接缝处纸纹一样
  const START = [2497, 1325, 12, 0];
  const FULL = [800, 1270, 0.4, 0], MID = [1000, 590, 0.75, 0];
  const TOPT = [307, 760, 0.8, 0], BOT = [900, 2300, 0.8, 0];
  const TOP = [860, 470, 1, 0], LOW = [900, 2300, 0.8, 0];
  const LISTEN = [287, 262];
  const CAM = [
    [0, START],
    [1.0, FULL, E.outExpo],
    [1.4, [806, 1273, 0.408, 0], E.lin],
    [1.66, MID, E.io],
    [2.9, [1004, 592, 0.765, 0], E.lin],
    [3.05, TOPT, E.io],
    // 顺着页面往下走：起步 0.15 小节，中间匀速（约每秒 400 屏幕像素，块上的字读得出来），边走边往右让出写字的地方
    [3.2, [307, 816, 0.8, 0], E.in],
    [4.4, [700, 2214, 0.8, 0], E.lin],
    [4.6, BOT, E.out],
    [4.8, [906, 2305, 0.81, 0], E.lin],
    [5.0, TOP, E.io],
    [7.8, [866, 473, 1.018, 0], E.lin],
    [8.05, LOW, E.io],
    [10.84, [904, 2303, 0.814, 0], E.lin],
    [11.06, TOP, E.io],
    [11.5, [872, 462, 1.03, 0], E.lin],
    [12.0, [LISTEN[0], LISTEN[1], 6, 0], E.inExpo],
  ];
  // 3–5 小节镜头往下走：每块印版在镜头中心经过它时画出自己那根线
  const camY = (b) => keys(b, CAM)[1];
  for (const p of P) {
    const yc = p.r[1] + p.r[3] / 2;
    let t = 3.1;
    while (t < 4.55 && camY(t) < yc - 180) t += 0.005;
    p.lineT = t;
  }
  const railHead = (b) => (b >= 4.5 ? GLYPH_Y : clamp(camY(b) + 520, 0, GLYPH_Y)); // 轨跟着镜头往下长，走完就一直在

  // ---------- 画：一块印版 ----------
  // 块面：纸色底、墨线框、浮雕（示意，只当纹理）、右上角的标签或计时环、左下角的名字
  function relief(x, p, a, fresh, c = css("pink")) {
    const [px, py, w, h] = p.r;
    x.save(); x.globalAlpha = a * 0.32; x.strokeStyle = c; x.fillStyle = c; x.lineWidth = 2;
    const X0 = px + 16, Y0 = py + 14, X1 = px + w - 52, Y1 = py + h - 54;
    const bar = (bx, by, bw, bh = 10) => x.fillRect(bx, by, bw, bh);
    switch (p.k) {
      case "badge": // 应用图标 + 名字；离线后图标变成空心的点
        if (fresh) { x.beginPath(); x.arc(px + 22, py + 20, 9, 0, Math.PI * 2); x.stroke(); }
        else x.fillRect(px + 11, py + 9, 22, 22);
        break;
      case "clock": for (let i = 0; i < 4; i++) x.strokeRect(X0 + i * 58 + (i > 1 ? 20 : 0), Y0 + 4, 44, 40); break;
      case "charge":
        if (fresh) { x.strokeRect(X0, Y0 + 10, 40, 26); line(x, X0 + 40, Y0 + 23, X0 + 70, Y0 + 23, 2, c); }
        else { x.beginPath(); x.moveTo(X0 + 26, Y0); x.lineTo(X0 + 10, Y0 + 26); x.lineTo(X0 + 28, Y0 + 26); x.lineTo(X0 + 14, Y0 + 50); x.stroke(); bar(X0 + 50, Y0 + 12, 90); bar(X0 + 50, Y0 + 32, 60); }
        break;
      case "battery": x.strokeRect(X0, Y0 + 6, 110, 38); x.fillRect(X0 + 110, Y0 + 18, 7, 14); bar(X0 + 6, Y0 + 12, 60, 26); break;
      case "hero": { // 封面 + 标题 + 进度条；离线后没有进度条
        const s = h - 28;
        x.strokeRect(px + 14, py + 14, s, s);
        if (!fresh) x.fillRect(px + 20, py + 20, s - 12, s - 12);
        bar(px + s + 32, py + 22, 150); bar(px + s + 32, py + 44, 100);
        if (!fresh) { line(x, px + s + 32, py + 72, px + w - 30, py + 72, 2, c); bar(px + s + 32, py + 67, 90); }
        break;
      }
      case "row": for (let i = 0; i < 6; i++) x.strokeRect(px + 16 + i * 60, py + 12, 46, 30); break;
      case "rings": for (let i = 0; i < 3; i++) { x.lineWidth = 5; x.beginPath(); x.arc(X0 + 44, Y0 + 44, 40 - i * 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * (1.2 + 0.35 * i)); x.stroke(); } break;
      case "bars": for (let i = 0; i < 5; i++) bar(X0 + i * 28, Y0 + 60 - (i % 3) * 16 - 14, 18, 14 + (i % 3) * 16); break;
      case "spark": { x.beginPath(); for (let i = 0; i <= 24; i++) { const sx = X0 + (i / 24) * (X1 - X0), sy = Y0 + 40 - 30 * Math.abs(Math.sin(i * 0.9)) * (0.5 + 0.5 * K.hash(i + 7)); i ? x.lineTo(sx, sy) : x.moveTo(sx, sy); } x.stroke(); break; }
      case "dots": for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(X0 + 12 + i * 52, Y0 + 14, 9, 0, Math.PI * 2); i % 3 ? x.fill() : x.stroke(); } break;
      case "chart": for (let i = 0; i < 16; i++) { const bh = 30 + 110 * K.hash(i + 3); bar(X0 + i * 32, Y0 + 150 - bh, 20, bh); } break;
      case "list": for (let i = 0; i < 4; i++) { x.strokeRect(X0, Y0 + i * 32, 22, 22); bar(X0 + 34, Y0 + 6 + i * 32, 120 + 60 * K.hash(i + 11)); } break;
      case "meters": for (let i = 0; i < 4; i++) { x.strokeRect(X0, Y0 + i * 30, 150, 14); x.fillRect(X0, Y0 + i * 30, 150 * (0.3 + 0.6 * K.hash(i + 21)), 14); } break;
      case "tiles": for (let i = 0; i < 5; i++) { const tx = X0 + i * 56; if (tx + 44 > px + w - 12) break; x.strokeRect(tx, Y0, 44, 62); } break;
      case "poster": x.strokeRect(X0, Y0, 70, 62); bar(X0 + 84, Y0 + 8, 90); bar(X0 + 84, Y0 + 28, 60); break;
      case "lanes": for (let i = 0; i < 3; i++) { line(x, X0, Y0 + 20 + i * 36, px + w - 20, Y0 + 20 + i * 36, 1, c); for (let j = 0; j < 5; j++) { const sx = X0 + 30 + j * 100 + 40 * K.hash(i * 7 + j); bar(sx, Y0 + 14 + i * 36, 40 + 40 * K.hash(j * 3 + i), 12); } } break;
      case "text": for (let i = 0; i < 2; i++) bar(X0, Y0 + i * 20, 300 - i * 90); break;
      case "cells": for (let i = 0; i < 30; i++) x.strokeRect(X0 + i * 17, Y0 + 4, 13, 22); break;
    }
    x.restore();
  }
  function hangTag(x, cx, cy, col, a, s = 1) {
    if (a <= 0) return;
    x.save(); x.translate(cx, cy); x.rotate(-0.42); x.scale(s, s); x.globalAlpha = a;
    x.strokeStyle = col; x.lineWidth = 2.2; x.fillStyle = css("paper");
    x.beginPath(); x.moveTo(-16, -9); x.lineTo(8, -9); x.lineTo(16, 0); x.lineTo(8, 9); x.lineTo(-16, 9); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.arc(7, 0, 2.8, 0, Math.PI * 2); x.stroke();
    x.restore();
  }
  // 600 秒的计时环：外圈、走过的那一段（橙）、中心一点；走到头时闪一下
  function timerRing(x, e, cx, cy, k, a, R = 16) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("paper"); x.strokeStyle = css("pink"); x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill(); x.stroke();
    x.strokeStyle = css("signal"); x.lineWidth = 4.5; x.lineCap = "round";
    x.beginPath(); x.arc(cx, cy, R - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(k)); x.stroke();
    x.fillStyle = css("pink"); x.beginPath(); x.arc(cx, cy, 2.5, 0, Math.PI * 2); x.fill();
    x.restore();
    if (e) glow(e, cx, cy, R * 2.6, 0.22 * a);
  }
  function plateAt(x, e, p, b, o) {
    const [px0, py0, w, h] = p.r;
    const a = o.a;
    if (a <= 0) return;
    const px = px0 + (o.dx || 0), py = py0 + (o.dy || 0);
    x.save(); x.globalAlpha = a;
    x.shadowColor = `rgba(0,0,0,${o.shA ?? 0.28})`; x.shadowBlur = o.sh ?? 6; x.shadowOffsetX = (o.sh ?? 6) * 0.3; x.shadowOffsetY = (o.sh ?? 6) * 0.45;
    x.fillStyle = css("paper"); x.fillRect(px, py, w, h);
    x.shadowColor = "transparent";
    x.strokeStyle = o.hot ? css("signal") : css("pink"); x.lineWidth = o.hot ? 3.2 : 2.2; x.strokeRect(px, py, w, h);
    x.restore();
    relief(x, { ...p, r: [px, py, w, h] }, a, o.fresh);
    // 名字：高的块写在左下角，矮的块竖着居中
    const small = h < 80, lx = px + (p.k === "badge" ? 42 : 14), ly = small ? py + h / 2 + 12 : py + h - 16;
    text(x, p.id, lx, ly, { font: FONT.mono(36, 500), color: o.hot ? css("signal") : css("pink"), alpha: a });
    const cx = px + w - 22, cy = py + (small ? h / 2 : 22);
    if (p.tag) hangTag(x, cx, cy, o.tagHot ? css("signal") : css("pink"), a, o.tagHot ? 1.15 : 1);
    else if (o.timer != null) timerRing(x, e, cx, cy, o.timer, a * o.timerA);
  }

  // 缩印的一页：纸、页头、各块的位置（浅墨）；fresh[id] 给出刚重印的那几块（橙）
  function miniPage(x, px, py, s, a, o = {}) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a;
    if (o.clip) { x.beginPath(); x.rect(...o.clip); x.clip(); }
    x.shadowColor = "rgba(0,0,0,0.3)"; x.shadowBlur = o.sh ?? 10; x.shadowOffsetY = (o.sh ?? 10) * 0.4;
    x.fillStyle = css("paper"); x.fillRect(px - 8 * s, py - 8 * s, (PAGE_W + 16) * s, (PAGE_H + 16) * s);
    x.shadowColor = "transparent";
    x.strokeStyle = css("pink"); x.lineWidth = 1.6; x.strokeRect(px - 8 * s, py - 8 * s, (PAGE_W + 16) * s, (PAGE_H + 16) * s);
    for (const p of P) {
      const [qx, qy, w, h] = p.r, f = o.fresh ? o.fresh[p.id] ?? 0 : 0;
      const shown = o.printed ? o.printed(p) : 1;
      if (shown <= 0) continue;
      x.globalAlpha = a * shown * (f > 0 ? 0.9 : 0.2);
      x.fillStyle = f > 0 ? css("signal") : css("pink");
      x.fillRect(px + qx * s, py + qy * s, w * s - 2, h * s - 2);
    }
    x.restore();
  }
  function browser(x, a, k) {
    if (a <= 0) return;
    const { x: bx, y: by, w, h } = WIN;
    x.save(); x.globalAlpha = a;
    x.translate(bx + w / 2, by + h / 2); x.scale(lerp(0.7, 1, k), lerp(0.7, 1, k)); x.translate(-bx - w / 2, -by - h / 2);
    x.shadowColor = "rgba(0,0,0,0.3)"; x.shadowBlur = 14; x.shadowOffsetY = 6;
    x.fillStyle = css("paper"); x.fillRect(bx, by, w, h);
    x.shadowColor = "transparent";
    x.strokeStyle = css("pink"); x.lineWidth = 2.4; x.strokeRect(bx, by, w, h);
    line(x, bx, by + 40, bx + w, by + 40, 1.6, css("pink"));
    for (let j = 0; j < 3; j++) { x.beginPath(); x.arc(bx + 20 + j * 18, by + 20, 5, 0, Math.PI * 2); x.stroke(); }
    x.restore();
    text(x, "lyjw.me", bx + 90, by + 30, { font: FONT.mono(24, 500), color: css("graphite"), alpha: a * k, texture: true });
  }
  const WIN_CLIP = [WIN.x + 6, WIN.y + 44, WIN.w - 12, WIN.h - 50];
  const WIN_S = (WIN.w - 40) / PAGE_W; // 窗口里看到的是这一页的顶上一截

  // 飞行中的标签片：page:<tag>
  function chip(x, label, cx, cy, hot, alpha, px = 30) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha;
    x.font = FONT.mono(px, 500);
    const w = x.measureText(label).width + px * 1.2, h = px * 1.66;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 2.2;
    roundRect(x, cx - w / 2, cy - h / 2, w, h, h / 2); x.fill(); x.stroke();
    x.restore();
    text(x, label, cx, cy + px * 0.36, { font: FONT.mono(px, 500), color: hot ? css("signal") : css("pink"), align: "center", alpha });
  }

  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill(); e.restore();
  }

  // 旁白：大字，逐字亮起；按这一段机位的缩放给字号（屏幕上 60），排在图版里，不是字幕
  function nar(x, key, px, py, r, a, size, maxW) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: size, maxW, reveal: r, alpha: a, dim: 0.12 });
  }

  // ---------- 各段 ----------
  function title(x, b) {
    const a = prog(b, 0.35, 0.8) * (1 - prog(b, 1.36, 1.52));
    if (a <= 0) return;
    // 全页机位缩放 0.4：字按 2.5 倍写，屏幕上和第 02 章的标题一样大
    text(x, "04", -1100, 330, { font: FONT.pixel(280), color: css("signal"), alpha: a });
    text(x, tr("ch04.title"), -1100, 560, { font: FONT.cjk(145, 600), reveal: prog(b, 0.4, 0.95), alpha: a, maxW: 980 });
    line(x, -1100, 620, lerp(-1100, -140, prog(b, 0.45, 1.0, E.outExpo)), 620, 3.5, css("pink"), a);
    text(x, "Vercel · Next.js", -1096, 720, { font: FONT.mono(72), color: css("graphite"), reveal: prog(b, 0.55, 1.05), alpha: a });
    text(x, "first-screen.ts", -1096, 812, { font: FONT.mono(72), color: css("graphite"), reveal: prog(b, 0.62, 1.1), alpha: a });
  }

  function galleyFrame(x, b) {
    const k = prog(b, 0.2, 0.85, E.io);
    if (k <= 0) return;
    const x0 = -24, y0 = -24, x1 = PAGE_W + 24, y1 = PAGE_H + 24;
    polyline(x, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], k, 5, css("pink"));
    polyline(x, [[x0 + 9, y0 + 9], [x1 - 9, y0 + 9], [x1 - 9, y1 - 9], [x0 + 9, y1 - 9], [x0 + 9, y0 + 9]], k, 1.4, css("pink"), 0.7);
  }

  // 两条轨和页底的库符号（3–5 小节画出来，之后一直在）
  function rails(x, b) {
    if (b < 3.05) return;
    const head = railHead(b);
    const topY = { rt: Math.min(...P.filter((p) => p.rt).map((p) => p.ty)), lag: Math.min(...P.filter((p) => !p.rt).map((p) => p.ty)) };
    for (const k of ["rt", "lag"]) {
      const rx = RAIL[k];
      if (head > topY[k]) line(x, rx, topY[k], rx, Math.min(head, GLYPH_Y - 56), 2.6, css("pink"));
    }
    const gk = prog(b, 4.2, 4.45, E.outBack);
    if (gk > 0) {
      glyph(x, "room", RAIL.rt, GLYPH_Y, css("pink"), 1.25 * gk);
      glyph(x, "lag", RAIL.lag, GLYPH_Y, css("pink"), 1.25 * gk);
      const la = prog(b, 4.3, 4.5);
      text(x, tr("ch04.rt"), RAIL.rt, GLYPH_Y + 104, { font: FONT.cjk(44, 600), align: "center", alpha: la });
      text(x, "StateHub · DO", RAIL.rt, GLYPH_Y + 152, { font: FONT.mono(36), color: css("graphite"), align: "center", alpha: la });
      text(x, tr("ch04.lag"), RAIL.lag, GLYPH_Y + 104, { font: FONT.cjk(44, 600), align: "center", alpha: la });
      text(x, "KV LAG", RAIL.lag, GLYPH_Y + 152, { font: FONT.mono(36), color: css("graphite"), align: "center", alpha: la });
    }
    // 脚注：每块一条 'use cache'，寿命相同
    text(x, tr("ch04.foot"), 800, 2600, { font: FONT.mono(36, 500), color: css("graphite"), reveal: prog(b, 4.35, 4.75), maxW: 1250 });
  }
  // 每块一根线接到自己那条轨（画在印版上面，跨过别的块也看得出是哪一块的）
  function taps(x, b) {
    if (b < 3.05) return;
    for (const p of P) {
      const k = prog(b, p.lineT, p.lineT + 0.16, E.out);
      if (k <= 0) continue;
      const rx = p.rt ? RAIL.rt : RAIL.lag;
      const hot = p.id === FAIL && b > FAIL_T && b < FAIL_T + 0.55;
      line(x, p.ex, p.ty, lerp(p.ex, rx, k), p.ty, hot ? 3 : 1.8, hot ? css("signal") : css("pink"), hot ? 1 : 0.75);
      x.save(); x.fillStyle = hot ? css("signal") : css("pink");
      x.beginPath(); x.arc(p.ex, p.ty, 4, 0, Math.PI * 2); x.fill();
      if (k >= 1) { x.beginPath(); x.arc(rx, p.ty, 5, 0, Math.PI * 2); x.fill(); }
      x.restore();
    }
  }

  // 出纸口：一叠印好的页，递给访客；5–8 小节后台印新页、7:2 换上去
  function pressSide(x, e, b) {
    const stackA = prog(b, 0.5, 0.9);
    if (stackA <= 0) return;
    const newIn = prog(b, 7.5, 7.75, E.io); // 新页印完，滑进那一叠
    // 那一叠印好的页（整页缓存）：递出去的是同一版的一份，叠子不变；新页印完才换掉最上面那张
    for (let j = 2; j >= 0; j--) miniPage(x, STACK[0] + j * 9, STACK[1] + j * 9, MINI, stackA * (j === 0 ? 1 - newIn : 1));
    if (newIn > 0) miniPage(x, lerp(NEWP[0], STACK[0], newIn), lerp(NEWP[1], STACK[1], newIn), MINI, stackA, { fresh: freshMap(b) });
    text(x, tr("ch04.pages"), STACK[0], STACK[1] - 22, { font: FONT.cjk(40, 600), alpha: stackA });
    // 访客窗口
    const wk = prog(b, 1.45, 1.62, E.outBack);
    browser(x, prog(b, 1.45, 1.52), wk);
    if (wk > 0) text(x, tr("ch04.visitor"), WIN.x + WIN.w / 2, WIN.y + WIN.h + 50, { font: FONT.cjk(40, 600), align: "center", alpha: prog(b, 1.5, 1.6) });
    // 递出去的页：出纸口到窗口之间一条虚线亮一下，页从窗口左边滑进来、铺满窗口（只看得见顶上一截）
    const sends = [[2.0, false], [5.5, false], [7.75, true]];
    let shown = null;
    for (const [t0, fresh] of sends) if (b >= t0) shown = [t0, fresh];
    const slot = [[STACK[0] + PAGE_W * MINI + 30, WIN.y + WIN.h / 2], [WIN.x - 14, WIN.y + WIN.h / 2]];
    if (wk > 0) {
      x.save(); x.setLineDash([10, 9]);
      const hot = shown ? 1 - prog(b, shown[0] + 0.3, shown[0] + 0.6) : 0;
      polyline(x, slot, 1, hot > 0 ? 2.6 : 1.6, hot > 0 ? css("signal") : css("pink"), lerp(0.5, 1, hot) * prog(b, 1.5, 1.6));
      x.restore();
      const [ax, ay] = slot[1];
      x.save(); x.globalAlpha = prog(b, 1.5, 1.6); x.fillStyle = css("pink");
      x.beginPath(); x.moveTo(ax + 8, ay); x.lineTo(ax - 10, ay - 9); x.lineTo(ax - 10, ay + 9); x.fill(); x.restore();
    }
    if (shown) {
      const [t0, fresh] = shown, k = prog(b, t0, t0 + 0.3, E.io);
      const sx = lerp(WIN.x - PAGE_W * WIN_S, WIN.x + 20, k);
      miniPage(x, sx, WIN.y + 52, WIN_S, 1, { clip: WIN_CLIP, sh: 0, fresh: fresh ? freshMap(b) : null });
    }
    const oa = win(b, 5.5, 5.62, 7.6, 7.75);
    if (oa > 0) text(x, tr("ch04.old"), WIN.x + WIN.w / 2, WIN.y + WIN.h + 100, { font: FONT.cjk(38, 600), color: css("signal"), align: "center", alpha: oa, maxW: 520 });
    // 后台正在印的新页：没重印的块直接从缓存里来，三块等重印完才出现（橙）
    const na = win(b, 5.5, 5.62, 7.5, 7.52);
    if (na > 0) {
      miniPage(x, NEWP[0], NEWP[1], MINI, na, { fresh: freshMap(b), printed: (p) => (recastAt[p.id] ? prog(b, recastAt[p.id], recastAt[p.id] + 0.06) : prog(b, 5.55, 5.75)) });
      x.save(); x.globalAlpha = na * 0.8; x.setLineDash([8, 7]); x.strokeStyle = css("pink"); x.lineWidth = 1.6;
      x.strokeRect(NEWP[0] - 10, NEWP[1] - 10, PAGE_W * MINI + 20, PAGE_H * MINI + 20); x.restore();
      text(x, tr("ch04.new"), NEWP[0] + (PAGE_W * MINI) / 2, NEWP[1] + PAGE_H * MINI + 50, { font: FONT.cjk(36, 600), color: css("graphite"), align: "center", alpha: na, maxW: 420 });
    }
  }
  const freshMap = (b) => Object.fromEntries(RECAST.map(([id, t]) => [id, prog(b, t, t + 0.06) * (1 - prog(b, 9, 9.5))]));

  // 5:0 失效的三个标签：先列在「在线 → 离线」注记下面，5:1 起一个个飞到各自的印版上，挂上那枚标签
  const TAG_FLY = 5.25, CHIP_X = 1270;
  function flipTags(x, b) {
    if (b < 4.98 || b > 5.8) return;
    RECAST.forEach(([id], j) => {
      const p = byId[id], label = "page:" + id;
      const [px, py, w, h] = p.r;
      const tx = px + w - 22, ty = py + (h < 80 ? h / 2 : 22);
      const cw = K.measure(x, label, FONT.mono(30, 500)) + 36;
      const sx = CHIP_X + cw / 2, sy = 690 + j * 60;
      const t0 = TAG_FLY + j * 0.08, k = prog(b, t0, t0 + 0.28, E.io);
      if (k >= 1) return;
      const cx = lerp(sx, tx, k), cy = lerp(sy, ty, k) - Math.sin(k * Math.PI) * 80;
      chip(x, label, cx, cy, true, prog(b, 5.0 + j * 0.05, 5.08 + j * 0.05) * (1 - prog(k, 0.8, 1)));
    });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, 6.0), impact(b, 6.5), impact(b, 7.0), impact(b, 10.0, 0.12));
    cam.zoom *= 1 + 0.02 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: prog(b, 0.1, 0.7), uPlate: [-1700, -400, 3400, 3100] });

    const x = ink.begin(); ink.cam(cam);
    const d = paper.begin(); paper.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const tp = top.begin(); top.cam(cam);

    // 首帧：第 03 章最后冲进的是一张白卡（纸片模式合成，没有纸面图版的零星墨点），这里先盖一张同样的纸，镜头拉开前退掉
    const cov = 1 - prog(b, 0.04, 0.2);
    if (cov > 0) fillRect(d, START[0] - 420, START[1] - 260, 840, 520, css("paper"), cov);
    title(x, b);
    galleyFrame(x, b);
    rails(x, b);

    // ---- 印版 ----
    const lifted = [];
    for (const p of P) {
      const yN = p.r[1] / PAGE_H;
      const a = prog(b, 0.25 + 0.45 * yN, 0.4 + 0.45 * yN);
      const o = { a, fresh: false, hot: false, tagHot: false, timer: null, timerA: 0 };
      // 在线 → 离线：标签亮、夹起、在自己的重拍上重印、放回
      const rc = recastAt[p.id];
      if (rc != null) {
        const arrive = TAG_FLY + 0.28 + RECAST.findIndex(([id]) => id === p.id) * 0.08;
        o.tagHot = b >= arrive && b < rc + 0.3;
        // 夹起、悬着，落在自己那个重拍上（压下去的那一刻就是重印）
        const lift = keys(b, [[arrive + 0.08, 0], [arrive + 0.3, 1, E.outBack], [rc - 0.07, 1], [rc, 0, E.in]]);
        o.dx = -9 * lift; o.dy = -24 * lift; o.sh = lerp(6, 36, lift); o.shA = lerp(0.28, 0.55, lift);
        o.fresh = b >= rc && b < 11.5;
        o.hot = b >= rc && b < rc + 0.55;
        if (lift > 0) { lifted.push([p, o]); continue; }
      }
      // 没挂标签的：600 秒计时环（示意：按小节转，每块起点不同）
      const tt = timerAt[p.id];
      if (tt != null && b >= tt) {
        o.timerA = prog(b, tt, tt + 0.1);
        o.timer = p.id === FAIL ? (b < FAIL_T ? lerp(0.35, 1, prog(b, tt, FAIL_T)) : prog(b, 10.2, 12)) : (0.2 + 0.13 * TIMERS.findIndex(([id]) => id === p.id) + (b - tt) * 0.28) % 1;
      }
      if (p.id === "listening-now" && b >= 11.0) o.hot = true;
      plateAt(d, e, p, b, o);
    }
    for (const [p, o] of lifted) plateAt(d, e, p, b, o);
    taps(d, b);
    // 没挂标签的几块：计时环旁边写 600 s（全宽的几块才写得下）
    for (const [id, tt] of TIMERS) {
      const p = byId[id], [px, py, w] = p.r;
      if (w < 600 || b < tt) continue;
      text(d, "600 s", px + w - 50, py + 34, { font: FONT.mono(36, 500), color: css("signal"), align: "right", alpha: prog(b, tt, tt + 0.1) * (id === FAIL && b > FAIL_T && b < 10.2 ? 0.3 : 1) });
    }

    // ---- 重印：印章层上落一遍新的块面（橙，从大落到原位），之后慢慢退成墨色 ----
    for (const [id, t] of RECAST) {
      const k = prog(b, t, t + 0.1);
      if (k <= 0 || b > t + 1.2) continue;
      const p = byId[id], [px, py, w, h] = p.r, sc = lerp(1.14, 1, E.outExpo(k)), fade = 1 - prog(b, t + 0.4, t + 1.2);
      s.save(); s.translate(px + w / 2, py + h / 2); s.scale(sc, sc); s.translate(-px - w / 2, -py - h / 2);
      s.globalAlpha = clamp(k * 3) * fade;
      s.strokeStyle = css("signal"); s.lineWidth = 5; s.strokeRect(px + 3, py + 3, w - 6, h - 6);
      s.restore();
      relief(s, { ...p, r: [px, py, w, h] }, 2.6 * clamp(k * 3) * fade, true, css("signal"));
      glow(e, px + w / 2, py + h / 2, Math.max(w, h) * 0.7, 0.35 * impact(b, t, 0.14));
    }

    pressSide(d, e, b);
    flipTags(d, b);
    const fa = win(b, 5.0, 5.1, 7.7, 7.85);
    if (fa > 0) {
      text(d, tr("ch04.flip"), 1240, 610, { font: FONT.cjk(36, 600), color: css("signal"), reveal: prog(b, 5.0, 5.35), alpha: fa, maxW: 560 });
      text(d, 'revalidateTag(…, "max")', 1242, 656, { font: FONT.mono(30), color: css("graphite"), alpha: fa * prog(b, 5.3, 5.45) });
    }

    // ---- 5xx：pulse 那块的计时走到头，回源（沿线到轨、顺轨到 DO），带回 503；印版不动，盖章 ----
    const fp = byId[FAIL], [fx, fy, fw, fh] = fp.r;
    const out = [[fp.ex, fp.ty], [RAIL.rt, fp.ty], [RAIL.rt, GLYPH_Y - 60]];
    const L = pathLen(out);
    if (b > FAIL_T && b < FAIL_T + 0.52) {
      const go = prog(b, FAIL_T, FAIL_T + 0.24, E.in), back = prog(b, FAIL_T + 0.26, FAIL_T + 0.5, E.out);
      if (back <= 0) spark(e, null, pathAt(out, go * L), null, { t: G.t, size: 0.5 });
      else {
        const [rx, ry] = pathAt(out, (1 - back) * L);
        chip(d, "503", rx - 70 * (1 - prog(back, 0.7, 0.92)), ry, true, 1, 40);
      }
      if (b > FAIL_T + 0.22 && b < FAIL_T + 0.34) glow(e, RAIL.rt, GLYPH_Y, 110, 0.5);
    }
    stamp(s, "503", fx + fw / 2 + 40, fy + fh / 2 + 6, { k: prog(b, 10.0, 10.12), px: 88, rot: -0.1, sub: tr("ch04.keep"), subPx: 38, alpha: 1 - prog(b, 10.9, 11.05) });

    // ---- 旁白 ----
    nar(d, "ch04.n1a", 800, 1120, prog(b, 1.55, 2.15), win(b, 1.55, 1.65, 2.88, 3.0), 80, 1380);
    nar(d, "ch04.n1b", 800, 1225, prog(b, 2.15, 2.8), win(b, 1.55, 1.65, 2.88, 3.0), 80, 1380);
    nar(d, "ch04.n2a", 720, 900, prog(b, 5.2, 5.9), win(b, 5.2, 5.3, 7.72, 7.85), 60, 1060);
    nar(d, "ch04.n2b", 720, 980, prog(b, 5.9, 6.8), win(b, 5.2, 5.3, 7.72, 7.85), 60, 1060);
    nar(d, "ch04.n3a", 800, 1790, prog(b, 8.15, 8.6), win(b, 8.15, 8.25, 9.35, 9.48), 75, 1300);
    nar(d, "ch04.n3b", 800, 1885, prog(b, 8.6, 9.25), win(b, 8.15, 8.25, 9.35, 9.48), 75, 1300);
    nar(d, "ch04.n4a", 800, 1790, prog(b, 9.55, 10.1), win(b, 9.55, 9.65, 10.72, 10.86), 75, 1300);
    nar(d, "ch04.n4b", 800, 1885, prog(b, 10.1, 10.7), win(b, 9.55, 9.65, 10.72, 10.86), 75, 1300);

    // ---- 11–12：换歌。火花落到「在听」那块上，标签不亮、不夹起；注一句，镜头推进去 ----
    if (b > 10.7) {
      const lp = byId["listening-now"], [lx, ly] = lp.r;
      const path = [[-420, -120], [-60, 60], [120, 190], LISTEN];
      const k = prog(b, 10.72, 11.0, E.out), Lp = pathLen(path);
      const head = pathAt(path, k * Lp);
      spark(e, d, head, trailOn(path, k * Lp, 260), { t: G.t, size: lerp(0.9, 1.2, prog(b, 11.0, 11.2)), lw: 2.4 });
      if (b >= 11.0) glow(e, lx + 198, ly + 71, 260, 0.3 * (0.6 + 0.4 * impact(b, 11.0, 0.3)));
      const na = prog(b, 11.08, 11.2);
      if (na > 0) {
        polyline(d, [[lx + 396, ly + 110], [760, ly + 110], [760, 870], [800, 870]], prog(b, 11.08, 11.3, E.out), 2.2, css("signal"));
        text(d, tr("ch04.song"), 812, 886, { font: FONT.cjk(48, 600), color: css("signal"), reveal: prog(b, 11.12, 11.55), alpha: na, maxW: 960 });
      }
    }

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 4.2 });
    // 印版是纸上的一块块纸（带落影），按纸片模式合成；发光要压在印版上面，所以 emit 排在 paper 之后
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 6.1 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    // 首帧的后期参数和第 03 章最后一帧一样，一小节内缓到本章自己的值
    const k0 = prog(b, 0, 1.0, E.io), sh = hitS * 8;
    f.post = {
      bloom: lerp(0.7, 0.55, k0), threshold: lerp(0.9, 0.95, k0), halation: lerp(0.28, 0.18, k0),
      grain: lerp(0.05, 0.042, k0), vignette: lerp(0.42, 0.26, k0), ca: lerp(0.4, 0.35, k0),
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      flash: impact(b, 10.0, 0.1) * 0.08, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch04", title: "ch.04", bars: 12,
    init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); paper = G.layer("paper"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
