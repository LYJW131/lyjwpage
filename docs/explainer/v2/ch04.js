(() => {
  const P = [
    { id: "desktop", rt: 1, tag: 1, r: [190, 8, 234, 40] },
    { id: "coding-year", rt: 1, tag: 1, r: [0, 64, 304, 56] },
    { id: "github-chart", rt: 0, tag: 0, r: [0, 124, 304, 61] },
    { id: "digest", rt: 0, tag: 1, r: [310, 64, 304, 56] },
    { id: "timezone", rt: 0, tag: 1, r: [310, 124, 304, 61] },
    { id: "charger", rt: 1, tag: 1, r: [0, 192, 214, 117] },
    { id: "powerbank", rt: 1, tag: 1, r: [0, 313, 214, 117] },
    { id: "listening-now", rt: 1, tag: 1, r: [218, 192, 396, 142] },
    { id: "listening", rt: 1, tag: 1, r: [218, 338, 396, 92] },
    { id: "activity", rt: 0, tag: 1, r: [0, 437, 372, 152] },
    { id: "workouts", rt: 0, tag: 1, r: [376, 437, 238, 152] },
    { id: "server", rt: 0, tag: 1, r: [0, 596, 614, 152] },
    { id: "agent-status", rt: 0, tag: 1, r: [0, 755, 614, 103] },
    { id: "coding", rt: 1, tag: 1, r: [0, 865, 614, 258] },
    { id: "coding-now", rt: 1, tag: 1, r: [0, 1127, 362, 200] },
    { id: "limits", rt: 0, tag: 1, r: [366, 1127, 248, 200] },
    { id: "playing-now", rt: 1, tag: 1, r: [0, 1334, 362, 118] },
    { id: "quest-now", rt: 1, tag: 1, r: [366, 1334, 248, 118] },
    { id: "playing", rt: 1, tag: 1, r: [0, 1456, 362, 183] },
    { id: "trophies", rt: 1, tag: 1, r: [366, 1456, 248, 183] },
    { id: "pulse", rt: 1, tag: 0, r: [0, 1646, 614, 212] },
    { id: "github-repo", rt: 0, tag: 1, r: [0, 1865, 614, 106] },
    { id: "site-deployments", rt: 0, tag: 0, r: [0, 1975, 614, 106] },
    { id: "cloudflare-workers", rt: 0, tag: 0, r: [0, 2085, 614, 106] },
    { id: "health", rt: 0, tag: 0, r: [0, 2195, 614, 106] },
    { id: "reporters", rt: 0, tag: 0, r: [0, 2305, 614, 111] },
    { id: "watching-now", rt: 1, tag: 1, r: [0, 2430, 270, 152] },
    { id: "watching", rt: 1, tag: 1, r: [274, 2430, 340, 152] },
  ];

  function make() {
    const { E, prog, keys, clamp, lerp, mulberry32 } = K;
    const css = G.css;
    I18N.add({
      "ch04.title": ["活字印版", "The type case"],
      "ch04.mast": ["lyjw.me 日报", "The lyjw.me Daily"],
      "ch04.motto": ["所有新闻，都在缓存里", "All the news that's cached"],
      "ch04.edition": ["第 04 版 · 缓存版", "Page 04 · Cache edition"],
      "ch04.life": ["快照有效 600 秒", "Snapshots last 600 s"],
      "ch04.earL": ["实时消息\n见第 05 版", "Live news\non page 05"],
      "ch04.earR": ["售价\n0 个外部 API", "Price\n0 external APIs"],
      "ch04.n1a": ["访客拿到的是缓存好的 HTML，", "Visitors get cached HTML;"],
      "ch04.n1b": ["请求路径上不现拉任何外部 API。", "no external API sits on that path."],
      "ch04.capA": ["图：site Worker 印好的页，访客到了直接拿走", "Photo: the site Worker's printed page, handed straight over"],
      "ch04.visitor": ["访客", "Visitor"],
      "ch04.pages": ["印好的页", "Printed pages"],
      "ch04.ads": ["分类广告", "Classifieds"],
      "ch04.ad1": ["招排字工：只为版面变化换铅字", "Typesetter wanted: recast on layout changes only"],
      "ch04.ad2": ["出租：KV 一格，可滞后", "For rent: one KV slot, lag-tolerant"],
      "ch04.ad3": ["寻人：对话卡不在这块版上", "Missing: the chat card isn't in this forme"],
      "ch04.bHead": ["每块版各挂一张标签", "Every block wears a tag"],
      "ch04.bDeck": ["实时的读状态核心，可滞后的读 KV", "Realtime reads the core; the rest reads KV"],
      "ch04.rt": ["实时", "Realtime"],
      "ch04.lag": ["可滞后", "Lag-tolerant"],
      "ch04.tagKey": ["挂牌的块：Cache-Tag page:<标签>", "Tagged blocks: Cache-Tag page:<tag>"],
      "ch04.foot": ["Cache-Tag · max-age 600 / stale-if-error 604200", "Cache-Tag · max-age 600 / stale-if-error 604200"],
      "ch04.extra": ["号外", "EXTRA"],
      "ch04.flip": ["在线 → 离线：这几块的标签失效", "Online → offline: tags expire"],
      "ch04.n2a": ["失效通知只带标签名，不带数据；", "Only tag names travel, never data;"],
      "ch04.n2b": ["清掉这几块和首页，下一位访客来时重印。", "the blocks and page are cleared, then reprinted on the next visit."],
      "ch04.capC": ["图：core 经 SITE_CACHE 交来标签，site Worker 按 page:<标签> 清掉", "Photo: core hands tags over SITE_CACHE; site purges page:<tag>"],
      "ch04.old": ["清掉", "Purged"],
      "ch04.new": ["下一位访客来时重印", "Reprinted on the next visit"],
      "ch04.n3a": ["标签只为布局变化而发；", "Tags fire only on layout changes;"],
      "ch04.n3b": ["内容变化等 600 秒定时重建。", "content waits for the 600 s rebuild."],
      "ch04.capD": ["图：这六块没挂标签，只等过期", "Photo: six untagged blocks just wait out the clock"],
      "ch04.n4a": ["回源碰上 5xx 或断网就抛错，", "A 5xx or network error throws,"],
      "ch04.n4b": ["缓存不被覆盖，照给上一份。", "the last good copy keeps serving."],
      "ch04.keep": ["沿用上一份", "keeps the last copy"],
      "ch04.errata": ["更正：照给上一份不算出错", "Correction: serving the last copy is not an error"],
      "ch04.brief": ["简讯", "In brief"],
      "ch04.song": ["换歌不重印：交给推送", "Song changes are pushed, not recast"],
      "ch04.capF": ["图：Clawd 在听歌", "Photo: Clawd, listening"],
      "ch04.colophon": ["印刷：site Worker　发行：lyjw.me · lyjw131.com", "Printed by the site Worker · lyjw.me · lyjw131.com"],
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let page, spot, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
    const seedOf = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

    // 一整版报纸，每个机位读一篇。拍位和 music/ch04.js 是同一张表。
    const AT = {
      print: 0,
      a: { head: [1.15, 1.65], deck: [1.65, 2.2], sheets: [1.5, 2.0, 2.5, 3.0, 3.5], pick: 2.75, hand: 3.0 },
      b: { head: [4.15, 4.6], deck: [4.6, 5.1], tags: 4.25, rails: [4.6, 5.4] },
      c: { extra: 6.0, head: [6.1, 6.6], deck: [6.6, 7.2], snip: [7.0, 7.5, 8.0], home: 8.25, visitor: 8.5, reprint: 8.625 },
      d: { head: [9.15, 9.6], deck: [9.6, 10.1], ring: 10.0, ringStep: 0.125 },
      e: { head: [11.1, 11.5], deck: [11.5, 11.85], wire: 11.25, stamp: 11.5 },
      f: { brief: [12.1, 12.6], note: 12.5, spark: 12.75, back: [13.0, 13.3], hold: 13.45 },
    };

    const PW = 4200, PH = 2600;
    const A = { x: 80, y: 560, w: 2040, h: 1020 }, B = { x: 2320, y: 560, w: 1800, h: 1020 };
    const C = { x: 80, y: 1640, w: 1760, h: 860 }, D = { x: 1920, y: 1640, w: 1280, h: 860 };
    const Ebox = { x: 3280, y: 1640, w: 840, h: 540 }, F = { x: 3280, y: 2220, w: 840, h: 280 };
    const FCLAWD = { cx: 3990, bottom: 2460, q: 11 };

    // 镜头按 log(缩放) 插值，开场从 12 拉到 0.44 也走得匀。
    // 首帧和第 03 章末帧一样：满屏是纸，缩放 12，停在 A、B 两栏之间的空白里；拉远从第一帧就起步。
    // 收尾停在整版上慢推，第 05 章的剪纸从右边滑进来盖住（第 05 章的 share.wipe）。
    const CAM = [
      [0, [2220, 1070, Math.log(12)]],
      [0.9, [2100, 1250, Math.log(0.44)], E.outExpo],
      [1.0, [2100, 1250, Math.log(0.445)], E.lin],
      [1.25, [1100, 1070, Math.log(0.92)], E.io],
      [3.85, [1110, 1070, Math.log(0.95)], E.lin],
      [4.1, [3180, 1070, Math.log(0.92)], E.io],
      [5.85, [3190, 1070, Math.log(0.95)], E.lin],
      [6.1, [980, 2060, Math.log(0.96)], E.io],
      [8.85, [990, 2060, Math.log(0.99)], E.lin],
      [9.1, [2560, 2070, Math.log(0.95)], E.io],
      [10.85, [2565, 2070, Math.log(0.98)], E.lin],
      [11.1, [3600, 1950, Math.log(1.1)], E.io],
      [11.85, [3605, 1950, Math.log(1.13)], E.lin],
      [12.1, [3560, 2220, Math.log(1.25)], E.io],
      [AT.f.back[0], [3565, 2220, Math.log(1.28)], E.lin],
      [AT.f.back[1], [2100, 1300, Math.log(0.4)], E.io],
      [AT.f.hold, [2100, 1300, Math.log(0.405)], E.lin],
      [14, [2100, 1300, Math.log(0.415)], E.lin],
    ];
    const camAt = (b) => { const c = keys(b, CAM); return [c[0], c[1], Math.exp(c[2])]; };

    // ---- 版面用的颜色与图块 ----
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const cssRGB = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const mixC = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
    const NEWS = hex("#ebe1c9"), DESK = hex("#3a2b22");
    const INK = () => cssRGB(css("ink")), ORANGE = () => cssRGB(css("signal")), PAPER0 = () => cssRGB(css("paper"));
    const tiles = new Map();
    const tileCanvas = (n) => { const c = document.createElement("canvas"); c.width = c.height = n; return c; };

    // 新闻纸：底色上撒细颗粒、几道短纤维和大块的浅深不匀；按种子生成，四边回绕。
    function paperTile() {
      if (tiles.has("paper")) return tiles.get("paper");
      const N = 512, cv = tileCanvas(N), c = cv.getContext("2d"), r = mulberry32(7);
      c.fillStyle = rgba([0, 0, 0], 0); c.fillRect(0, 0, N, N);
      for (let i = 0; i < 40; i++) {
        const x = r() * N, y = r() * N, rad = 40 + r() * 120, g = c.createRadialGradient(x, y, 0, x, y, rad);
        const dark = r() < 0.5;
        g.addColorStop(0, dark ? "rgba(120,90,50,0.022)" : "rgba(255,250,235,0.03)"); g.addColorStop(1, "rgba(0,0,0,0)");
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { c.save(); c.translate(ox, oy); c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); c.restore(); }
      }
      for (let i = 0; i < 5200; i++) {
        const x = r() * N, y = r() * N, dark = r() < 0.6;
        c.fillStyle = dark ? `rgba(70,55,35,${0.05 + r() * 0.12})` : `rgba(255,255,245,${0.08 + r() * 0.15})`;
        c.fillRect(x, y, 0.6 + r() * 1.4, 0.6 + r() * 1.4);
      }
      c.lineCap = "round";
      for (let i = 0; i < 160; i++) {
        const x = r() * N, y = r() * N, a = r() * TAU, l = 6 + r() * 22;
        c.strokeStyle = `rgba(90,70,45,${0.06 + r() * 0.1})`; c.lineWidth = 0.5 + r() * 0.6;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.6, y + Math.sin(a + 0.6) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
      const p = c.createPattern(cv, "repeat");
      tiles.set("paper", p);
      return p;
    }

    // 网点：45° 的点阵，点的面积占比就是色调；印在纸上之后和纸一起正片叠底。
    const DOT = 11;
    function tone(level, rgb) {
      const L = Math.round(clamp(level) * 20) / 20, key = `t|${L}|${rgb}`;
      if (tiles.has(key)) return tiles.get(key);
      const S = 4, n = DOT * S, cv = tileCanvas(n), c = cv.getContext("2d");
      const rad = Math.min(n * 0.62, n * Math.sqrt(L / (2 * Math.PI)));
      c.fillStyle = rgba(rgb);
      for (const [px, py] of [[0, 0], [n, 0], [0, n], [n, n], [n / 2, n / 2]]) { c.beginPath(); c.arc(px, py, rad, 0, TAU); c.fill(); }
      const p = c.createPattern(cv, "repeat");
      p.setTransform(new DOMMatrix().scale(1 / S, 1 / S));
      tiles.set(key, p);
      return p;
    }
    // 铅字吃墨不匀：实地里带一点点发白的麻点。
    function inkTile(rgb) {
      const key = `i|${rgb}`;
      if (tiles.has(key)) return tiles.get(key);
      const N = 256, cv = tileCanvas(N), c = cv.getContext("2d"), r = mulberry32(31);
      c.fillStyle = rgba(rgb); c.fillRect(0, 0, N, N);
      c.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.3})`; c.beginPath(); c.arc(r() * N, r() * N, 0.4 + r() * 1.3, 0, TAU); c.fill(); }
      const p = c.createPattern(cv, "repeat");
      tiles.set(key, p);
      return p;
    }
    const inkP = () => inkTile(INK()), spotP = () => inkTile(ORANGE());

    // ---- 字 ----
    const SERIF = (px, w = 900) => `${w} ${px}px "Noto Serif SC", "Songti SC", "Noto Serif CJK SC", serif`;
    const MONO = (px, w = 500) => K.FONT.mono(px, w);
    function T(x, str, px, py, o = {}) {
      const { size = 40, w = 600, mono = false, color = inkP() } = o;
      return K.text(x, str, px, py, { ...o, font: o.font || (mono ? MONO(size, o.w || 500) : SERIF(size, w)), color });
    }
    // 标题按栏宽折行：中文逐字量，英文按词。
    function chipT(x, str, px, py, o = {}) {
      const size = o.size || 40, f = o.mono ? MONO(size, o.w || 500) : SERIF(size, o.w || 600);
      x.save(); x.font = f; const tw = x.measureText(str).width; x.restore();
      const x0 = o.align === "center" ? px - tw / 2 : o.align === "right" ? px - tw : px;
      x.save(); x.globalAlpha *= o.alpha ?? 1; x.fillStyle = rgba(NEWS); x.fillRect(x0 - 12, py - size * 0.95, tw + 24, size * 1.3); x.restore();
      T(x, str, px, py, o);
    }
    function wrap(x, str, font, maxW) {
      x.save(); x.font = font;
      const units = str.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) || [], out = [];
      let cur = "";
      for (const u of units) {
        const next = cur + u;
        if (cur && x.measureText(next).width > maxW && !/^\s+$/.test(u) && !/^[，。；：、）]$/.test(u)) { out.push(cur.trimEnd()); cur = u.trimStart(); }
        else cur = next;
      }
      if (cur) out.push(cur.trimEnd());
      x.restore();
      return out;
    }
    // 读到这篇时标题从清样的浅灰一个字一个字压成实墨，像排字机一行行铸出来。
    function headline(x, str, px, py, size, maxW, k, o = {}) {
      const lines = wrap(x, str, SERIF(size, o.w || 900), maxW), lh = size * (o.lh || 1.18);
      const total = lines.reduce((s, l) => s + [...l].length, 0);
      let done = 0;
      lines.forEach((l, i) => {
        const n = [...l].length, kk = clamp((k * total - done) / n);
        T(x, l, px, py + i * lh, { size, w: o.w || 900, alpha: 0.2, align: o.align });
        if (kk > 0) T(x, l, px, py + i * lh, { size, w: o.w || 900, reveal: kk, perChar: true, rise: -size * 0.12, align: o.align });
        done += n;
      });
      return py + (lines.length - 1) * lh;
    }

    // ---- 版面零件 ----
    function rule(x, x0, y0, x1, y1, w = 2, a = 1) { x.save(); x.globalAlpha *= a; x.strokeStyle = inkP(); x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); x.restore(); }
    function dbl(x, x0, x1, y) { rule(x, x0, y, x1, y, 5); rule(x, x0, y + 10, x1, y + 10, 1.6); }
    // 正文排不出字的地方用灰条代替（报纸样张的「假字」），按种子定长短，每段末行短一截。
    function greek(x, x0, y0, w, h, seed, lh = 26) {
      const r = mulberry32(seed);
      x.save(); x.fillStyle = tone(0.55, INK());
      let y = y0, left = 3 + Math.floor(r() * 4);
      while (y + 10 < y0 + h) {
        const last = left-- <= 0, lw = last ? w * (0.3 + r() * 0.4) : w * (0.94 + r() * 0.06);
        x.fillRect(x0 + (left === 2 && !last ? 0 : 0), y, lw, 10);
        y += lh;
        if (last) { left = 3 + Math.floor(r() * 5); y += lh * 0.4; }
      }
      x.restore();
    }
    function frame(x, r, a = 1) { x.save(); x.globalAlpha *= a; x.strokeStyle = inkP(); x.lineWidth = 3; x.strokeRect(r.x, r.y, r.w, r.h); x.restore(); }
    function shape(x, path, level, rgb, o = {}) {
      x.save(); x.globalAlpha *= o.alpha ?? 1;
      if (o.base) { x.fillStyle = rgba(NEWS); x.fill(path); }
      x.fillStyle = tone(level, rgb); x.fill(path);
      if (o.edge !== false) { x.strokeStyle = rgba(INK(), o.edgeA ?? 0.85); x.lineWidth = o.lw || 2.4; x.stroke(path); }
      x.restore();
    }
    const rectP = (x0, y0, w, h) => { const p = new Path2D(); p.rect(x0, y0, w, h); return p; };
    const rrP = (x0, y0, w, h, r) => { const p = new Path2D(); p.roundRect(x0, y0, w, h, r); return p; };
    const circP = (cx, cy, r) => { const p = new Path2D(); p.arc(cx, cy, r, 0, TAU); return p; };

    // Clawd 印成两色网点：橙色网点铺身体，下半身叠一层墨网当暗部，眼睛是实墨。
    function clawd(x, fr, cx, bottom, q, o = {}) {
      const f = fr || { pose: "default", offset: 0 };
      const px = cx + (f.x || 0) * 2 * q * (o.flip ? -1 : 1);
      const { body, eyes } = window.Clawd.cells(f.pose, f.offset || 0);
      x.save(); x.globalAlpha *= o.alpha ?? 1;
      x.translate(px - 9 * q, bottom - 12 * q);
      if (o.flip) { x.translate(18 * q, 0); x.scale(-1, 1); }
      const path = new Path2D();
      for (const [a, b2] of body) path.rect(a * q - 0.4, b2 * 2 * q - 0.4, q + 0.8, 2 * q + 0.8);
      x.fillStyle = tone(0.85, ORANGE()); x.fill(path);
      x.save(); x.clip(path); x.fillStyle = tone(0.25, INK()); x.fillRect(0, 8 * q, 18 * q, 4 * q); x.restore();
      x.fillStyle = inkP();
      for (const [a, b2] of eyes) x.fillRect(a * q - 0.4, b2 * 2 * q - 0.4, q + 0.8, 2 * q + 0.8);
      x.restore();
      if (o.cap) newsCap(x, px, bottom - 12 * q + (f.offset || 0) * 2 * q, q, o.flip);
      if (o.headset) K.clawdProp(x, "headset", px, bottom, q, { color: rgba(INK()), crouch: (f.offset || 0) / 2, flip: o.flip });
      return px;
    }
    function newsCap(x, cx, top, q, flip) {
      const s = flip ? -1 : 1, p = new Path2D();
      p.moveTo(cx - 6.5 * q, top + 0.6 * q);
      p.bezierCurveTo(cx - 6.5 * q, top - 3.4 * q, cx + 5 * q, top - 3.6 * q, cx + 6 * q, top + 0.2 * q);
      p.lineTo(cx - 6.5 * q, top + 0.6 * q);
      shape(x, p, 0.6, INK(), { lw: 2 });
      const brim = new Path2D();
      brim.ellipse(cx + s * 5.2 * q, top + 0.5 * q, 3.6 * q, 0.8 * q, 0, 0, TAU);
      shape(x, brim, 0.85, INK(), { lw: 1.6 });
    }
    function visitor(x, cx, bottom, s = 1, a = 1, read = 0) {
      x.save(); x.globalAlpha *= a;
      const body = new Path2D();
      body.moveTo(cx - 46 * s, bottom); body.bezierCurveTo(cx - 44 * s, bottom - 120 * s, cx - 30 * s, bottom - 150 * s, cx, bottom - 152 * s);
      body.bezierCurveTo(cx + 30 * s, bottom - 150 * s, cx + 44 * s, bottom - 120 * s, cx + 46 * s, bottom); body.closePath();
      shape(x, body, 0.42, INK());
      shape(x, circP(cx, bottom - 186 * s, 30 * s), 0.3, INK());
      const brim = new Path2D(); brim.ellipse(cx, bottom - 208 * s, 46 * s, 9 * s, 0, 0, TAU); shape(x, brim, 0.8, INK(), { lw: 1.6 });
      shape(x, rrP(cx - 26 * s, bottom - 250 * s, 52 * s, 44 * s, 6 * s), 0.8, INK(), { lw: 1.6 });
      if (read > 0) {
        x.save(); x.translate(cx - 70 * s, bottom - 140 * s); x.rotate(-0.12);
        shape(x, rectP(0, 0, 66 * s, 86 * s), 0.05, INK(), { alpha: read, lw: 1.8 });
        x.globalAlpha *= read; x.fillStyle = tone(0.6, INK());
        for (let i = 0; i < 6; i++) x.fillRect(8 * s, 10 * s + i * 12 * s, (i === 0 ? 50 : 40 - (i % 2) * 12) * s, 5 * s);
        x.restore();
      }
      x.restore();
    }
    // 铅字块：底面一块深网、顶面浅网，右下一道厚边当侧面。
    function slug(x, sx, sy, w, h, o = {}) {
      const { level = 0.35, rgb = INK(), alpha = 1, lift = 0, label, size = 28, fresh = 0, texture, depth = 14 } = o;
      if (alpha <= 0) return;
      x.save(); x.globalAlpha *= alpha; x.translate(0, -lift);
      const d = Math.min(depth, h * 0.18);
      x.save(); x.fillStyle = inkP(); x.fillRect(sx + d, sy + d, w, h); x.restore();
      x.save(); x.fillStyle = rgba(NEWS); x.fillRect(sx, sy, w, h); x.restore();
      if (fresh > 0) { x.save(); x.fillStyle = rgba(mixC(NEWS, ORANGE(), 0.55), fresh); x.fillRect(sx, sy, w, h); x.restore(); }
      x.save(); x.fillStyle = tone(level * 2, rgb); x.fillRect(sx, sy, Math.min(w * 0.06, 18), h); x.restore();
      shape(x, rectP(sx, sy, w, h), 0, rgb, { lw: 2.2 });
      if (label) { const pad = Math.min(w * 0.06, 18) + 10; T(x, label, sx + pad, sy + h / 2 + size * 0.36, { mono: true, size, maxW: w - pad - 12, color: rgba(INK()), texture }); }
      x.restore();
    }
    // 吊牌：一张带孔的小纸牌，一根线拴在块的角上，跟着拍轻轻晃。
    function hangTag(x, ax, ay, label, o = {}) {
      const { k = 1, sway = 0, size = 28, cut = 0, rgb = ORANGE() } = o;
      if (k <= 0) return;
      const len = 38 + (o.len || 0), drop = cut > 0 ? E.in(cut) * 900 : 0, rot = sway + cut * 0.9;
      x.save(); x.globalAlpha *= clamp(k * 2) * (1 - clamp((cut - 0.6) * 2.5));
      x.translate(ax, ay + drop); x.rotate(rot);
      x.font = MONO(size, 500);
      const tw = label ? x.measureText(label).width : 0, w = tw + 54, h = size * 1.5;
      x.restore();
      x.save(); x.globalAlpha *= clamp(k * 2) * (1 - clamp((cut - 0.6) * 2.5));
      if (cut <= 0) rule(x, ax, ay, ax + Math.sin(-rot) * len, ay + Math.cos(rot) * len, 1.6);
      x.translate(ax, ay + drop); x.rotate(rot); x.translate(0, len); x.scale(lerp(0.4, 1, E.outBack(clamp(k))), lerp(0.4, 1, E.outBack(clamp(k))));
      const p = new Path2D();
      p.moveTo(-h / 2, 0); p.lineTo(w - h / 2, 0); p.lineTo(w - h / 2, h); p.lineTo(-h / 2, h); p.lineTo(-h / 2 - h * 0.4, h / 2); p.closePath();
      x.translate(0, -h / 2);
      x.save(); x.fillStyle = rgba(NEWS); x.fill(p); x.restore();
      x.save(); x.fillStyle = rgba(mixC(NEWS, rgb, 0.4)); x.fill(p); x.strokeStyle = rgba(INK(), 0.85); x.lineWidth = 1.8; x.stroke(p); x.restore();
      x.fillStyle = rgba(NEWS); x.beginPath(); x.arc(-h / 2 + h * 0.05, h / 2, h * 0.16, 0, TAU); x.fill();
      if (label) T(x, label, -h / 2 + h * 0.4, h / 2 + size * 0.36, { mono: true, size, color: rgba(INK()), maxW: tw + 2 });
      x.restore();
    }
    function cross(x, cx, cy, s, k) {
      if (k <= 0) return;
      x.save(); x.strokeStyle = spotP(); x.lineWidth = 9; x.lineCap = "round";
      const a = clamp(k * 2), b = clamp(k * 2 - 1);
      x.beginPath(); x.moveTo(cx - s, cy - s); x.lineTo(cx - s + 2 * s * a, cy - s + 2 * s * a); x.stroke();
      if (b > 0) { x.beginPath(); x.moveTo(cx + s, cy - s); x.lineTo(cx + s - 2 * s * b, cy - s + 2 * s * b); x.stroke(); }
      x.restore();
    }

    // ---- 首屏的印版：P 表是 lyjw.me 桌面宽度的卡片框乘 0.6（第 10 章经 share 借用），版上只排上半页 ----
    const PB = P.slice(0, 16);
    const FS = 0.66, FX = 2380, FY = 640;
    const fr = (p) => [FX + p.r[0] * FS, FY + p.r[1] * FS, p.r[2] * FS - 6, p.r[3] * FS - 6];
    const BUS = { rt: 2832, lag: 2856, y: 1430 };
    const RTBOX = { x: 2900, y: 900, w: 560, h: 470 }, LAGBOX = { x: 3520, y: 900, w: 560, h: 470 };

    function forme(x, b, recast) {
      const ch = { x: FX - 26, y: FY - 26, w: 614 * FS + 46, h: 1327 * FS + 46 };
      shape(x, rectP(ch.x, ch.y, ch.w, ch.h), 0.7, INK(), { lw: 3 });
      shape(x, rectP(ch.x + 14, ch.y + 14, ch.w - 28, ch.h - 28), 0.12, INK(), { lw: 1.4 });
      for (const p of PB) {
        const [px, py, w, h] = fr(p), r = recast[p.id] || 0;
        slug(x, px, py, w, h, { level: p.rt ? 0.32 : 0.22, label: p.id, size: 15, texture: true, fresh: r, depth: 4 });
      }
      const kt = prog(b, AT.b.tags, AT.b.tags + 0.9);
      PB.forEach((p, i) => {
        if (!p.tag) return;
        const [px, py] = fr(p), k = clamp(kt * 1.6 - i * 0.04);
        const sw = 0.12 * Math.sin((b * 4 + i * 0.7) * Math.PI) * win(b, AT.b.tags, AT.b.tags + 0.4, 5.9, 6.1);
        miniTag(x, px + 10, py + 6, k, sw);
      });
    }
    function miniTag(x, ax, ay, k, sway) {
      if (k <= 0) return;
      x.save(); x.translate(ax, ay); x.rotate(sway); x.scale(E.outBack(clamp(k)), E.outBack(clamp(k)));
      const p = new Path2D(); p.moveTo(0, 0); p.lineTo(26, 0); p.lineTo(26, 14); p.lineTo(0, 14); p.lineTo(-6, 7); p.closePath();
      shape(x, p, 0.8, ORANGE(), { lw: 1.2 });
      x.fillStyle = rgba(NEWS); x.beginPath(); x.arc(-1, 7, 2.2, 0, TAU); x.fill();
      x.restore();
    }
    function rails(x, b) {
      const k = prog(b, AT.b.rails[0], AT.b.rails[1], E.io);
      if (k <= 0) return;
      for (const lay of ["rt", "lag"]) {
        const bx = BUS[lay], ps = PB.filter((p) => !!p.rt === (lay === "rt"));
        x.save(); x.strokeStyle = lay === "rt" ? spotP() : inkP(); x.lineWidth = 3;
        for (const p of ps) {
          const [px, py, w, h] = fr(p), yy = py + h / 2, x0 = px + w;
          const kk = clamp(k * 2.2 - (py - FY) / 900);
          if (kk <= 0) continue;
          x.beginPath(); x.moveTo(x0, yy); x.lineTo(lerp(x0, bx, kk), yy); x.stroke();
          x.fillStyle = x.strokeStyle; x.beginPath(); x.arc(x0, yy, 4, 0, TAU); x.fill();
        }
        const box = lay === "rt" ? RTBOX : LAGBOX, top = FY + 10, kb = clamp(k * 1.6 - 0.3);
        if (kb > 0) {
          const pts = [[bx, top], [bx, BUS.y + (lay === "rt" ? 0 : 22)], [box.x + box.w / 2, BUS.y + (lay === "rt" ? 0 : 22)], [box.x + box.w / 2, box.y + box.h]];
          K.polyline(x, pts, kb);
          x.stroke();
        }
        x.restore();
      }
    }
    function legendBox(x, box, kind, label, sub, k) {
      if (k <= 0) return;
      x.save(); x.globalAlpha *= clamp(k * 2);
      shape(x, rectP(box.x, box.y, box.w, box.h), 0.06, INK(), { lw: 2.4 });
      K.glyph(x, kind, box.x + box.w / 2, box.y + 150, rgba(kind === "room" ? ORANGE() : INK()), 1.6);
      T(x, label, box.x + box.w / 2, box.y + 320, { size: 62, align: "center", maxW: box.w - 40 });
      T(x, sub, box.x + box.w / 2, box.y + 400, { mono: true, size: 34, align: "center", color: rgba(INK(), 0.85) });
      x.restore();
    }

    // ---- A 栏的轮转印刷机 ----
    const PHOTO_A = { x: 100, y: 830, w: 1200, h: 630 };
    function press(x, b) {
      const P0 = PHOTO_A, gy = P0.y + P0.h - 40;
      x.save(); x.beginPath(); x.rect(P0.x, P0.y, P0.w, P0.h); x.clip();
      x.fillStyle = tone(0.08, INK()); x.fillRect(P0.x, P0.y, P0.w, P0.h);
      x.fillStyle = tone(0.3, INK()); x.fillRect(P0.x, gy, P0.w, 60);
      const run = prog(b, 1.25, 3.9), ang = b * TAU * 0.9 * (b > 1.2 ? 1 : 0);
      const fx = P0.x + 60, fy = P0.y + 120;
      shape(x, rrP(fx, fy, 470, gy - fy, 18), 0.5, INK(), { lw: 3 });
      for (const [cx, cy, r] of [[fx + 160, fy + 150, 92], [fx + 160, fy + 340, 92], [fx + 360, fy + 245, 64]]) {
        shape(x, circP(cx, cy, r), 0.68, INK());
        x.save(); x.strokeStyle = rgba(NEWS, 0.8); x.lineWidth = 6;
        for (let i = 0; i < 4; i++) { const a = ang * (r > 80 ? 1 : -1.4) + (i * TAU) / 4; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); x.stroke(); }
        x.beginPath(); x.arc(cx, cy, r * 0.9, -2.4, -1.4); x.stroke();
        x.restore();
      }
      const web = new Path2D(); web.moveTo(P0.x, fy + 40); web.bezierCurveTo(fx + 40, fy + 40, fx + 120, fy + 240, fx + 160, fy + 245); web.lineTo(fx + 640, fy + 245);
      x.save(); x.strokeStyle = rgba(NEWS); x.lineWidth = 14; x.stroke(web); x.strokeStyle = rgba(INK(), 0.7); x.lineWidth = 2; x.stroke(web); x.restore();
      // 印好的页每拍从出纸口滑出来，落到右边那摞上。
      const SX = P0.x + 660, SY = gy - 20;
      const out = AT.a.sheets.filter((t) => b >= t).length;
      const stackN = 3 + out;
      for (let i = 0; i < stackN; i++) shape(x, rectP(SX + (i % 2) * 3, SY - 16 - i * 9, 180, 14), 0.05, INK(), { lw: 1.4 });
      for (const t of AT.a.sheets) {
        const k = prog(b, t - 0.25, t, E.out);
        if (k <= 0 || k >= 1) continue;
        const sx = lerp(fx + 470, SX, k), sy = lerp(fy + 230, SY - 16 - out * 9, E.in(k)), rot = lerp(-0.3, 0, k);
        x.save(); x.translate(sx, sy); x.rotate(rot); shape(x, rectP(0, -8, 180, 14), 0.05, INK(), { lw: 1.4 }); x.restore();
      }
      chipT(x, tr("ch04.pages"), SX + 90, SY - 36 - stackN * 9, { size: 34, align: "center", w: 600, alpha: clamp(run * 3) });
      // 报童 Clawd 戴鸭舌帽，抽一张递给访客。
      const hand = AT.a.hand, pick = AT.a.pick, cxA = P0.x + 960;
      const fr0 = b >= pick && b < pick + 0.25 ? K.clawdSeq("land", b, pick, BARs) : b >= hand && b < hand + 0.6 ? K.clawdSeq("jump", b, hand, BARs) : null;
      const cl = clawd(x, fr0, cxA - (b >= pick && b < hand ? 0 : 0), gy, 12, { cap: true });
      const hk = prog(b, hand - 0.1, hand + 0.2, E.io);
      const vx = P0.x + 1110;
      visitor(x, vx, gy, 1, 1, prog(b, hand + 0.1, hand + 0.35));
      if (b >= pick && hk < 1) {
        const sx = lerp(cl - 40, vx - 70, hk), sy = lerp(gy - 170, gy - 140, hk);
        x.save(); x.translate(sx, sy); x.rotate(lerp(0.2, -0.12, hk)); shape(x, rectP(0, 0, 66, 86), 0.05, INK(), { lw: 1.8 }); x.restore();
      }
      x.restore();
      frame(x, P0);
      chipT(x, tr("ch04.visitor"), vx, P0.y + 70, { size: 34, align: "center", w: 600 });
    }

    // ---- C 栏：三块撤版 ----
    const PHOTO_C = { x: 920, y: 1790, w: 900, h: 630 };
    const RECAST = [["desktop", AT.c.snip[0]], ["listening-now", AT.c.snip[1]], ["charger", AT.c.snip[2]]];
    function purge(x, b) {
      const P0 = PHOTO_C, gy = P0.y + P0.h - 30;
      x.save(); x.beginPath(); x.rect(P0.x, P0.y, P0.w, P0.h); x.clip();
      x.fillStyle = tone(0.06, INK()); x.fillRect(P0.x, P0.y, P0.w, P0.h);
      RECAST.forEach(([id, t], i) => {
        const sx = P0.x + 50, sy = P0.y + 110 + i * 150, w = 400, h = 100;
        const lift = 90 * win(b, t + 0.05, t + 0.2, t + 0.3, t + 0.45);
        const gone = b >= t + 0.3 && b < AT.c.reprint;
        const fresh = 1 - prog(b, AT.c.reprint, AT.c.reprint + 0.6);
        slug(x, sx, sy, w, h, { label: id, size: 34, alpha: gone ? 0.15 : 1, lift, fresh: b >= AT.c.reprint ? fresh : 0 });
        hangTag(x, sx + w + 20, sy + 4, `page:${id}`, { k: 1, size: 30, sway: 0.08 * Math.sin((b * 2 + i) * Math.PI) * (b < t ? 1 : 0), cut: prog(b, t, t + 0.35), len: 6 });
        if (b >= t + 0.1) cross(x, sx + w / 2, sy + h / 2, 34, prog(b, t + 0.1, t + 0.3) * (1 - prog(b, AT.c.reprint - 0.1, AT.c.reprint)));
      });
      const homeK = prog(b, AT.c.home, AT.c.home + 0.35);
      hangTag(x, P0.x + 690, P0.y + 104, "home", { k: 1, cut: homeK, sway: 0.06 * Math.sin(b * 2 * Math.PI) * (b < AT.c.home ? 1 : 0) });
      // Clawd 排字：每到一块就蹲下抽走，跳回原位。
      const at = RECAST.reduce((acc, [, t]) => (b >= t - 0.1 ? t : acc), null);
      const ry = at === null ? 0 : RECAST.findIndex(([, t]) => t === at);
      const fr0 = at !== null && b < at + 0.5 ? K.clawdSeq("flinch", b, at + 0.05, BARs) : b >= AT.c.reprint && b < AT.c.reprint + 0.7 ? K.clawdSeq("celebrate", b, AT.c.reprint, BARs) : null;
      clawd(x, fr0, P0.x + 560 + (at === null ? 0 : -10 * ry), gy, 9);
      const vk = prog(b, AT.c.visitor - 0.25, AT.c.visitor, E.out);
      if (vk > 0) visitor(x, lerp(P0.x + P0.w + 80, P0.x + 790, vk), gy, 0.9, 1, prog(b, AT.c.reprint + 0.2, AT.c.reprint + 0.5));
      x.restore();
      frame(x, P0);
      const ko = win(b, AT.c.snip[0] + 0.3, AT.c.snip[0] + 0.5, AT.c.reprint - 0.1, AT.c.reprint + 0.1);
      if (ko > 0) chipT(x, tr("ch04.old"), P0.x + 250, P0.y + 64, { size: 40, align: "center", color: spotP(), alpha: ko });
      const kn = prog(b, AT.c.reprint, AT.c.reprint + 0.3);
      if (kn > 0) chipT(x, tr("ch04.new"), P0.x + 330, P0.y + 64, { size: 40, align: "center", alpha: kn, maxW: 620 });
    }

    // ---- D 栏：钟和六块没挂牌的版 ----
    const PHOTO_D = { x: 1940, y: 1930, w: 1240, h: 490 };
    const TIMED = ["github-chart", "pulse", "site-deployments", "cloudflare-workers", "health", "reporters"];
    function clockPhoto(x, b) {
      const P0 = PHOTO_D;
      x.save(); x.beginPath(); x.rect(P0.x, P0.y, P0.w, P0.h); x.clip();
      x.fillStyle = tone(0.06, INK()); x.fillRect(P0.x, P0.y, P0.w, P0.h);
      const cx = P0.x + 230, cy = P0.y + 245, R = 190;
      shape(x, circP(cx, cy, R + 16), 0.75, INK());
      shape(x, circP(cx, cy, R), 0.04, INK());
      for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU - Math.PI / 2, l = i % 5 ? 10 : 24; rule(x, cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8), cx + Math.cos(a) * (R - 8 - l), cy + Math.sin(a) * (R - 8 - l), i % 5 ? 2 : 4); }
      const sweep = prog(b, 9.0, AT.d.ring + 0.75) * TAU;
      x.save(); x.fillStyle = tone(0.5, ORANGE()); x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R - 40, -Math.PI / 2, -Math.PI / 2 + sweep); x.closePath(); x.fill(); x.restore();
      const ha = -Math.PI / 2 + sweep;
      rule(x, cx, cy, cx + Math.cos(ha) * (R - 30), cy + Math.sin(ha) * (R - 30), 7);
      shape(x, circP(cx, cy, 12), 0.9, INK(), { lw: 1 });
      shape(x, rrP(cx - 66, cy + 76, 132, 48, 6), 0, INK(), { lw: 1.6, base: true });
      T(x, "600 s", cx, cy + 110, { mono: true, size: 36, w: 600, align: "center" });
      TIMED.forEach((id, i) => {
        const col = i % 2, row = Math.floor(i / 2), sx = P0.x + 500 + col * 370, sy = P0.y + 50 + row * 145, w = 340, h = 100;
        const t = AT.d.ring + i * AT.d.ringStep, kk = prog(b, 9.2, t), done = impact(b, t, 0.12);
        slug(x, sx, sy, w, h, { label: id, size: 28, fresh: b >= t ? 1 - prog(b, t, t + 0.7) : 0 });
        const rx = sx + w - 2, ry = sy + 2;
        x.save(); x.fillStyle = rgba(NEWS); x.beginPath(); x.arc(rx, ry, 24, 0, TAU); x.fill(); x.strokeStyle = rgba(INK(), 0.4); x.lineWidth = 6; x.beginPath(); x.arc(rx, ry, 18, 0, TAU); x.stroke();
        x.strokeStyle = spotP(); x.beginPath(); x.arc(rx, ry, 18, -Math.PI / 2, -Math.PI / 2 + kk * TAU); x.stroke();
        if (done > 0.02) { x.globalAlpha = done; x.lineWidth = 3; x.beginPath(); x.arc(rx, ry, 18 + (1 - done) * 30, 0, TAU); x.stroke(); }
        x.restore();
      });
      x.restore();
      frame(x, P0);
    }

    // ---- E 栏：回源 503，上一份照发 ----
    const PHOTO_E = { x: 3300, y: 1960, w: 800, h: 200 };
    function errPhoto(x, b) {
      const P0 = PHOTO_E;
      x.save(); x.beginPath(); x.rect(P0.x, P0.y, P0.w, P0.h); x.clip();
      x.fillStyle = tone(0.06, INK()); x.fillRect(P0.x, P0.y, P0.w, P0.h);
      slug(x, P0.x + 40, P0.y + 50, 300, 96, { label: "pulse", size: 32 });
      const k = prog(b, AT.e.wire - 0.3, AT.e.wire, E.out), back = prog(b, AT.e.wire + 0.05, AT.e.wire + 0.35, E.in);
      const tx = lerp(P0.x + P0.w + 40, P0.x + 380, k) + back * 520;
      x.save(); x.translate(tx, P0.y + 40); x.rotate(-0.05 + back * 0.3);
      shape(x, rectP(0, 0, 230, 120), 0, INK(), { lw: 2, base: true });
      T(x, "503", 115, 82, { mono: true, size: 56, w: 700, align: "center", color: spotP() });
      x.restore();
      x.restore();
      frame(x, P0);
    }

    // ---- 整版 ----
    function sheetPaper(x, b) {
      const ink0 = clamp(prog(b, 0.0, 0.35));
      x.save();
      x.fillStyle = rgba(mixC(PAPER0(), DESK, prog(b, 0.15, 0.6))); x.fillRect(-4000, -4000, PW + 8000, PH + 8000);
      const base = mixC(PAPER0(), NEWS, prog(b, 0.0, 0.5));
      x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowBlur = 50 * prog(b, 0.2, 0.6); x.shadowOffsetY = 18;
      x.fillStyle = rgba(base); x.fillRect(0, 0, PW, PH);
      x.shadowColor = "transparent";
      x.globalAlpha = ink0; x.fillStyle = paperTile(); x.fillRect(0, 0, PW, PH);
      x.globalAlpha = 0.5 * ink0; x.strokeStyle = "rgba(90,70,45,0.25)"; x.lineWidth = 3; x.beginPath(); x.moveTo(PW / 2, 0); x.lineTo(PW / 2, PH); x.stroke();
      x.restore();
    }
    function masthead(x) {
      dbl(x, 80, PW - 80, 70);
      T(x, tr("ch04.mast"), PW / 2, 320, { size: 250, w: 900, align: "center", maxW: 2400 });
      T(x, tr("ch04.motto"), PW / 2, 420, { size: 48, w: 600, align: "center" });
      for (const [bx, key] of [[120, "ch04.earL"], [PW - 120 - 560, "ch04.earR"]]) {
        frame(x, { x: bx, y: 130, w: 560, h: 250 });
        tr(key).split("\n").forEach((l, i) => T(x, l, bx + 280, 230 + i * 80, { size: i ? 64 : 60, w: i ? 900 : 600, align: "center", maxW: 520 }));
      }
      dbl(x, 80, PW - 80, 450);
      T(x, tr("ch04.edition"), 100, 510, { size: 40, w: 600 });
      T(x, tr("ch04.life"), PW / 2, 510, { size: 40, w: 600, align: "center" });
      T(x, "lyjw.me · lyjw131.com", PW - 100, 508, { mono: true, size: 36, align: "right" });
      rule(x, 80, 532, PW - 80, 532, 1.6);
    }

    function paint(L, b) {
      const { pg, sp, st, tp } = L;
      sheetPaper(pg, b);
      // 版面从第一帧就在：首帧镜头里只有空白新闻纸，拉远的头几帧墨色跟着淡进来。
      const pr = clamp(prog(b, AT.print, AT.print + 0.08));
      if (pr <= 0) return;
      pg.save(); pg.globalAlpha = pr;
      masthead(pg);
      // 第一排：A 头条、B 印版
      headline(pg, tr("ch04.n1a"), A.x + 20, A.y + 80, 92, A.w - 60, prog(b, ...AT.a.head));
      headline(pg, tr("ch04.n1b"), A.x + 20, A.y + 200, 62, A.w - 60, prog(b, ...AT.a.deck), { w: 600 });
      rule(pg, A.x, A.y + 240, A.x + A.w, A.y + 240, 1.6);
      press(pg, b);
      T(pg, tr("ch04.capA"), PHOTO_A.x, PHOTO_A.y + PHOTO_A.h + 48, { size: 32, w: 600, maxW: PHOTO_A.w });
      greek(pg, 1350, 840, 750, 420, 11);
      frame(pg, { x: 1350, y: 1290, w: 750, h: 270 });
      T(pg, tr("ch04.ads"), 1375, 1345, { size: 40 });
      ["ch04.ad1", "ch04.ad2", "ch04.ad3"].forEach((k, i) => T(pg, tr(k), 1375, 1405 + i * 54, { size: 32, w: 600, maxW: 700 }));
      rule(pg, A.x + A.w + 100, A.y + 20, A.x + A.w + 100, A.y + A.h - 20, 1.6);

      headline(pg, tr("ch04.bHead"), 2880, A.y + 120, 92, 1200, prog(b, ...AT.b.head));
      headline(pg, tr("ch04.bDeck"), 2880, A.y + 230, 62, 1200, prog(b, ...AT.b.deck), { w: 600 });
      const recast = {};
      for (const [id, t] of RECAST) recast[id] = b >= AT.c.reprint ? 1 - prog(b, AT.c.reprint, AT.c.reprint + 0.6) : 0;
      forme(pg, b, recast);
      rails(pg, b);
      const kl = b >= AT.b.rails[0] ? prog(b, AT.b.rails[0] + 0.2, AT.b.rails[0] + 0.5) : 0;
      legendBox(pg, RTBOX, "room", tr("ch04.rt"), "StateHub", Math.max(kl, b > 6 ? 1 : 0));
      legendBox(pg, LAGBOX, "lag", tr("ch04.lag"), "LAG KV", Math.max(kl, b > 6 ? 1 : 0));
      T(pg, tr("ch04.tagKey"), 2900, 1480, { mono: true, size: 32, maxW: 1180 });
      T(pg, tr("ch04.foot"), 2900, 1536, { mono: true, size: 32, maxW: 1180 });
      dbl(pg, 80, PW - 80, 1600);

      // 第二排：C 号外、D 钟、E 503、F 简讯
      const ek = prog(b, AT.c.extra - 0.05, AT.c.extra + 0.12, E.outBack);
      pg.save(); pg.translate(0, C.y + 60); pg.scale(1, b >= AT.c.extra - 0.05 ? ek : 1); pg.translate(0, -(C.y + 60));
      pg.fillStyle = b >= AT.c.extra - 0.05 ? spotP() : tone(0.15, INK()); pg.fillRect(C.x, C.y + 10, C.w, 110);
      if (b >= AT.c.extra - 0.05) {
        T(pg, tr("ch04.extra"), C.x + 40, C.y + 98, { size: 84, color: rgba(NEWS) });
        T(pg, tr("ch04.flip"), C.x + 300, C.y + 88, { size: 52, w: 600, color: rgba(NEWS), maxW: C.w - 340 });
      }
      pg.restore();
      let y = headline(pg, tr("ch04.n2a"), C.x + 30, C.y + 230, 84, 790, prog(b, ...AT.c.head));
      y = headline(pg, tr("ch04.n2b"), C.x + 30, y + 100, 60, 790, prog(b, ...AT.c.deck), { w: 600 });
      greek(pg, C.x + 30, y + 50, 780, C.y + C.h - 130 - y - 50, 23);
      wrap(pg, tr("ch04.capC"), SERIF(30, 600), 790).forEach((l, i) => T(pg, l, C.x + 30, C.y + C.h - 80 + i * 40, { size: 30, w: 600 }));
      purge(pg, b);
      rule(pg, D.x - 40, D.y + 10, D.x - 40, D.y + D.h, 1.6);

      headline(pg, tr("ch04.n3a"), D.x + 20, D.y + 120, 84, D.w - 40, prog(b, ...AT.d.head));
      headline(pg, tr("ch04.n3b"), D.x + 20, D.y + 220, 60, D.w - 40, prog(b, ...AT.d.deck), { w: 600 });
      clockPhoto(pg, b);
      T(pg, tr("ch04.capD"), PHOTO_D.x, PHOTO_D.y + PHOTO_D.h + 44, { size: 30, w: 600, maxW: PHOTO_D.w });
      rule(pg, Ebox.x - 40, D.y + 10, Ebox.x - 40, D.y + D.h, 1.6);

      let ye = headline(pg, tr("ch04.n4a"), Ebox.x, Ebox.y + 100, 76, Ebox.w - 20, prog(b, ...AT.e.head));
      headline(pg, tr("ch04.n4b"), Ebox.x, ye + 86, 56, Ebox.w - 20, prog(b, ...AT.e.deck), { w: 600 });
      errPhoto(pg, b);
      T(pg, tr("ch04.errata"), Ebox.x, PHOTO_E.y + PHOTO_E.h + 40, { size: 30, w: 600, maxW: Ebox.w - 20, alpha: b >= AT.e.stamp ? 1 : 0.35 });
      rule(pg, F.x, F.y - 10, F.x + F.w, F.y - 10, 2.4);
      T(pg, tr("ch04.brief"), F.x, F.y + 54, { size: 44 });
      const bk = prog(b, ...AT.f.brief);
      wrap(pg, tr("ch04.song"), SERIF(56, 900), 560).forEach((l, i, ls) => {
        const n = ls.length;
        T(pg, l, F.x, F.y + 140 + i * 66, { size: 56, alpha: 0.2 });
        T(pg, l, F.x, F.y + 140 + i * 66, { size: 56, reveal: clamp(bk * n - i), perChar: true });
      });
      const PF = { x: 3870, y: 2230, w: 240, h: 255 };
      pg.save(); pg.beginPath(); pg.rect(PF.x, PF.y, PF.w, PF.h); pg.clip();
      pg.fillStyle = tone(0.1, INK()); pg.fillRect(PF.x, PF.y, PF.w, PF.h);
      const bob = b >= AT.f.note - 0.2 ? Math.abs(Math.sin((b - AT.f.note) * Math.PI * 2)) * 6 * (b < AT.f.back[0] ? 1 : 0) : 0;
      clawd(pg, null, FCLAWD.cx, FCLAWD.bottom - bob, FCLAWD.q, { headset: true });
      const nk = prog(b, AT.f.note, AT.f.note + 0.6);
      if (nk > 0 && nk < 1) T(pg, "♪", FCLAWD.cx + 70 + nk * 30, FCLAWD.bottom - 150 - nk * 60, { size: 44, color: spotP(), alpha: 1 - nk, texture: true });
      pg.restore();
      frame(pg, PF);
      T(pg, tr("ch04.capF"), F.x, F.y + 270, { size: 28, w: 600, maxW: 560 });
      const sk = prog(b, AT.f.spark, AT.f.spark + 0.35, E.in);
      if (sk > 0 && sk < 1) {
        const sx = lerp(PF.x, PW + 300, sk), sy = F.y + 120 - Math.sin(sk * Math.PI) * 80;
        sp.save(); sp.globalAlpha = 1 - sk * 0.5; sp.fillStyle = css("signal");
        sp.beginPath(); sp.arc(sx, sy, 14, 0, TAU); sp.fill();
        sp.globalAlpha *= 0.4; sp.beginPath(); sp.arc(sx, sy, 34, 0, TAU); sp.fill(); sp.restore();
      }

      dbl(pg, 80, PW - 80, 2510);
      T(pg, tr("ch04.colophon"), 100, 2570, { size: 32, w: 600, maxW: 2600 });
      T(pg, "4", PW - 100, 2570, { size: 40, align: "right" });
      pg.restore();

      // 回源出错那一下：一枚大章斜着盖在 E 栏上。
      const stk = prog(b, AT.e.stamp - 0.05, AT.e.stamp + 0.1);
      if (stk > 0) K.stamp(st, tr("ch04.keep"), PHOTO_E.x + 520, PHOTO_E.y + 110, { k: stk, px: 72, rot: -0.12, color: css("signal") });
      const wipe = (window.CHAPTERS.find((c) => c.id === "ch05") || {}).share?.wipe;
      if (wipe && b > 13) { tp.save(); tp.setTransform(G.S, 0, 0, G.S, 0, 0); wipe(tp, b - 14); tp.restore(); }
    }

    function render(f) {
      BARs = f.BAR;
      const b = f.bar, c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
      const hitS = Math.max(impact(b, AT.print, 0.1), impact(b, AT.c.extra, 0.1) * 0.7, impact(b, AT.e.stamp, 0.1) * 0.8, ...AT.c.snip.map((t) => impact(b, t, 0.08) * 0.4));
      const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.01 * hitS), rot: 0 };
      G.setCam(cam);
      G.clear(P_LIN());
      const pg = page.begin(); page.cam(cam);
      const sp = spot.begin(); spot.cam(cam);
      const st = stampL.begin(); stampL.cam(cam);
      const tp = top.begin(); top.cam(cam);
      paint({ pg, sp, st, tp }, b);
      G.composite(page.upload(), { mode: G.MODE.normal });
      G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 4.4 });
      G.composite(spot.upload(), { mode: G.MODE.add, gain: 1.4 });
      G.composite(top.upload(), { mode: G.MODE.normal });
      // 首帧的后期参数和第 03 章末帧一样，0.5 小节内缓到报纸的值。
      const k0 = prog(b, 0, 0.5, E.io), sh = hitS * 5;
      f.post = {
        bloom: lerp(0.7, 0, k0), threshold: lerp(0.9, 1.2, k0), halation: lerp(0.28, 0, k0), grain: lerp(0.05, 0.035, k0), vignette: lerp(0.42, 0.22, k0), ca: lerp(0.4, 0, k0),
        shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
        blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
      };
    }
    const P_LIN = () => { const p = G.LIN ? G.LIN.paper : null; return p || [0.85, 0.84, 0.8]; };

    async function init() {
      page = G.layer("bg"); spot = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top");
      await Promise.all([document.fonts.load(SERIF(40, 900), "日报 Ag"), document.fonts.load(SERIF(40, 600), "日报 Ag")]);
    }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch04", title: "ch.04", bars: 14,
    async init() { impl = impl || make(); await impl.init(); },
    render(f) { impl.render(f); },
    share: { P },
  });
})();
