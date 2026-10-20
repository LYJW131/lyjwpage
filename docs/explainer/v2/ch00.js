// 画面不读配乐事件表，独立预览和换拍复用时仍须正常渲染。
// 这一章画成一张晒图：普鲁士蓝底、白色细线、图框和标题栏、尺寸线与引线；Clawd 是图上的 7 号零件，换歌记成一处红笔修订（云线和 △1）。
(() => {
  const { css } = G;
  const { E, prog, keys, lerp, clamp, text, FONT, line, polyline, fillRect, spark, glyph, pathAt, trailOn, measure } = K;
  I18N.add({
    "ch00.title": ["这张卡片从哪来", "Where does this card come from?"],
    "ch00.clawd": ["lyjw 出主意，\n我们几个 Claude 动手。\n先带你拆开 lyjw.me 看看。", "lyjw has the ideas;\na few of us Claudes build.\nFirst, let me open up lyjw.me."],
    "ch00.part": ["零件", "Part"],
    "ch00.q": ["这张卡片，是怎么知道的？", "How does this card know?"],
    "ch00.n1a": ["全片跟踪一封上报信封：", "We trace one report end to end:"],
    "ch00.n1b": ["Mac 上 Apple Music 换了一首歌。", "a song change on the Mac."],
    "ch00.n2a": ["上报器发 POST，Workers 记状态，", "Reporters post; Workers hold state;"],
    "ch00.n2b": ["site Worker 出首屏，浏览器收推送。", "site Worker renders; browsers listen."],
    "ch00.notes": ["注", "Note"],
    "ch00.view": ["主视图", "Front view"],
    "ch00.detail": ["局部详图 A", "Detail A"],
    "ch00.src": ["采集端", "Sources"],
    "ch00.srcSub": ["上报器 · 云端遥测", "reporters · cloud telemetry"],
    "ch00.hub": ["中枢", "Hub"],
    "ch00.scr": ["展示", "Screen"],
    "ch00.scrSub": ["site Worker · 浏览器", "site Worker · browser"],
    "ch00.ingress": ["上报入口", "Ingress"],
    "ch00.core": ["状态核心", "State core"],
    "ch00.collector": ["采集 Worker", "Collector"],
    "ch00.ai": ["对话与构建", "Chat & builds"],
    "ch00.home": ["家里", "Home"],
    "ch00.tokyo": ["东京", "Tokyo"],
    "ch00.cloud": ["云端", "Cloud"],
    "ch00.recent": ["RECENTLY PLAYED", "RECENTLY PLAYED"],
    "ch00.apple": ["APPLE MUSIC", "APPLE MUSIC"],
    "ch00.np": ["NOW PLAYING", "NOW PLAYING"],
    "ch00.tbName": ["名称", "Title"],
    "ch00.tbNo": ["图号", "Dwg"],
    "ch00.tbScale": ["比例", "Scale"],
    "ch00.tbRev": ["修订", "Rev."],
    "ch00.tbRevNote": ["换歌", "song change"],
    "ch00.tbDrawn": ["设计", "Drawn"],
    "ch00.tbCheck": ["校对", "Checked"],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  const BARS = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARS) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  // 共享画法可能在本章 init 未运行时使用，图层必须按名称从共用池获取。
  const lay = () => ({ x: G.layer("ink"), e: G.layer("emit", 0.5), d: G.layer("paper"), tp: G.layer("top") });

  // 晒图配色只在本章用。图框里的底是一种平色（BLUE，着色器和画布用同一组数），字底下垫的同色块才和底严丝合缝；
  // 实心面（终端、窗口、方块）是 DEEP；改图的红笔借全片的 signalD，橙色仍是唯一发光的颜色。
  const BLUE = [26, 68, 116], DEEP = [17, 51, 92], WHITE = [236, 243, 250], PALE = [168, 196, 228], DIM = [112, 148, 194];
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const C = { blue: rgb(BLUE), deep: rgb(DEEP), white: rgb(WHITE), pale: rgb(PALE), dim: rgb(DIM), red: css("signalD") };
  const F = (px, w = 500) => `${w} ${px.toFixed(1)}px "Barlow Semi Condensed ch00", "Noto Sans SC ch00", sans-serif`;
  const M = (px, w = 500) => FONT.mono(px, w);
  const fpx = (f) => parseFloat(/([\d.]+)px/.exec(f)[1]);

  const DY = 1600;
  // 图纸 A 左右各收进 140：第 10 章借终端谢幕时镜头推近（ch10.js#render 的 cam），图框和右下角的标题栏也要整个留在画里，改一边两边一起核。
  const FRAME_A = [140, 40, 1780, 1040], SHEET_A = [-320, -280, 2240, 1320];
  // 图纸 B 的图框上下比三栏宽出一截：上边留给页眉，下边左角放注释框、右角放标题栏，都不碰栏线（见 notesAt）。
  const FRAME_B = [40, 100 + DY, 3800, 2180 + DY], SHEET_B = [-300, DY - 100, 4420, DY + 2420];
  // 图版底：两张刷了药水的晒图纸放在米色纸上。纸边是刷子拖出来的毛边，页边（图框外）曝光不匀、有日晒斑；
  // 图框里只有平色和网格，不加任何纹理，字压在上面也干净。
  const PLATE = `
uniform float uGridA;
uniform vec3 uBlue;
uniform vec4 uSheetA, uSheetB, uFrameA, uFrameB;
float box(vec2 p, vec4 r){ vec2 c = 0.5 * (r.xy + r.zw), h = 0.5 * (r.zw - r.xy); vec2 q = abs(p - c) - h; return max(q.x, q.y); }
void main(){
  vec2 w = worldPos();
  vec3 blue = toLinear(uBlue);
  vec3 cream = toLinear(vec3(0.93, 0.91, 0.855)) * (0.965 + 0.05 * fbm(w * 0.009) + 0.012 * vnoise(w * vec2(0.5, 0.04)));
  float d = min(box(w, uSheetA), box(w, uSheetB));
  float streak = vnoise(w * vec2(0.004, 0.07) + 11.0);
  float rag = (fbm(w * 0.011 + 5.0) - 0.5) * 80.0 + (streak - 0.5) * 46.0;
  float cov = 1.0 - smoothstep(-3.0, 3.0, d + rag);
  float inside = 1.0 - step(0.0, min(box(w, uFrameA), box(w, uFrameB)));
  float spot = smoothstep(0.6, 0.78, fbm(w * 0.017 + 7.7));
  vec3 margin = blue * (0.84 + 0.3 * fbm(w * 0.0022 + 3.1));
  margin = mix(margin, blue * 1.45, 0.45 * spot);
  margin = mix(margin, mix(blue, cream, 0.4), smoothstep(-150.0, 0.0, d + rag) * (0.35 + 0.45 * streak));
  vec3 col = mix(margin, blue, inside);
  vec2 gm = abs(fract(w / 40.0 + 0.5) - 0.5) * 40.0;
  vec2 gM = abs(fract(w / 200.0 + 0.5) - 0.5) * 200.0;
  float z = uCam.z;
  float g = pxLine(min(gm.x, gm.y) * z, 1.0) * 0.07 * sat(z * 1.4 - 0.2) + pxLine(min(gM.x, gM.y) * z, 1.2) * 0.13;
  col = mix(col, toLinear(vec3(0.93, 0.955, 0.98)), g * uGridA * inside);
  fragColor = vec4(mix(cream, col, cov), 1.0);
}`;
  const plate = () => G.fill(G.pass(PLATE), { uGridA: 1, uBlue: BLUE.map((v) => v / 255), uSheetA: SHEET_A, uSheetB: SHEET_B, uFrameA: FRAME_A, uFrameB: FRAME_B });
  const POST = { bloom: 0.4, threshold: 0.9, halation: 0.12, grain: 0, vignette: 0.3, ca: 0 };

  const disc = (x, cx, cy, r, color, a = 1) => { x.save(); x.globalAlpha = a; x.fillStyle = color; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.restore(); };
  const ring = (x, cx, cy, r, w, color, a = 1) => { x.save(); x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = w; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); x.restore(); };
  const screen = (x, fn) => { x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); fn(); x.restore(); };
  // 字底下先垫一块图纸蓝：网格和穿过去的线在字底下断开（图纸上写尺寸数字就是这样），字底总是干净的。
  function label(x, str, px, py, o = {}) {
    const f = o.font || F(32), a = o.alpha ?? 1;
    if (a <= 0 || !str) return 0;
    let w = measure(x, str, f);
    const s = fpx(f) * (o.maxW && w > o.maxW ? o.maxW / w : 1);
    w = Math.min(w, o.maxW || w);
    const x0 = o.align === "center" ? px - w / 2 : o.align === "right" ? px - w : px, pad = o.pad ?? s * 0.2;
    if (o.bg !== null) fillRect(x, x0 - pad, py - s * 0.95 - pad * 0.5, w + pad * 2, s * 1.25 + pad, o.bg || C.blue, a);
    text(x, str, px, py, { font: f, color: o.color || C.white, align: o.align, alpha: a, maxW: o.maxW, reveal: o.reveal, perChar: o.perChar });
    return w;
  }
  function arrow(x, px, py, ang, color, a = 1, s = 15) {
    x.save(); x.globalAlpha = a; x.fillStyle = color; x.translate(px, py); x.rotate(ang);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(-s, -s * 0.28); x.lineTo(-s, s * 0.28); x.closePath(); x.fill(); x.restore();
  }
  // 尺寸线：两根引出线、两头箭头、数字写在线上方。ref 是被量的那条边。
  function dimH(x, x0, x1, y, ref, str, k, a, f = F(30)) {
    if (k <= 0 || a <= 0) return;
    const s = Math.sign(y - ref), ek = prog(k, 0, 0.3), cx = (x0 + x1) / 2, h = ((x1 - x0) / 2) * prog(k, 0.25, 0.75, E.out);
    for (const ex of [x0, x1]) line(x, ex, ref + s * 6, ex, lerp(ref + s * 6, y + s * 12, ek), 1.2, C.pale, a);
    line(x, cx - h, y, cx + h, y, 1.2, C.pale, a);
    if (k >= 0.75) { arrow(x, x0, y, Math.PI, C.pale, a); arrow(x, x1, y, 0, C.pale, a); }
    label(x, str, cx, y - 16, { font: f, align: "center", alpha: a * prog(k, 0.6, 1) });
  }
  function dimV(x, y0, y1, xx, ref, str, k, a, f = F(30)) {
    if (k <= 0 || a <= 0) return;
    const s = Math.sign(xx - ref), ek = prog(k, 0, 0.3), cy = (y0 + y1) / 2, h = ((y1 - y0) / 2) * prog(k, 0.25, 0.75, E.out);
    for (const ey of [y0, y1]) line(x, ref + s * 6, ey, lerp(ref + s * 6, xx + s * 12, ek), ey, 1.2, C.pale, a);
    line(x, xx, cy - h, xx, cy + h, 1.2, C.pale, a);
    if (k >= 0.75) { arrow(x, xx, y0, -Math.PI / 2, C.pale, a); arrow(x, xx, y1, Math.PI / 2, C.pale, a); }
    label(x, str, xx, cy + fpx(f) * 0.36, { font: f, align: "center", alpha: a * prog(k, 0.6, 1) });
  }
  // 引线标注：零件上一个点，斜线拉到肩线，字压在肩线上。
  function callout(x, ax, ay, sx, sy, str, k, a, f = M(36)) {
    if (k <= 0 || a <= 0) return;
    const w = measure(x, str, f), left = sx < ax, ex = left ? sx - w - 24 : sx + w + 24;
    disc(x, ax, ay, 5, C.white, a);
    const head = polyline(x, [[ax, ay], [sx, sy], [ex, sy]], prog(k, 0, 0.6, E.out), 1.4, C.pale, a);
    if (head) label(x, str, left ? sx - 12 : sx + 12, sy - fpx(f) * 0.32, { font: f, align: left ? "right" : "left", alpha: a * prog(k, 0.5, 0.9) });
  }
  function balloon(x, cx, cy, r, str, a, bg = C.blue, color = C.white) {
    if (a <= 0) return;
    disc(x, cx, cy, r, bg, a);
    ring(x, cx, cy, r, 1.8, color, a);
    text(x, str, cx, cy + r * 0.45, { font: F(r * 1.3), color, align: "center", alpha: a });
  }
  function frame(x, R, a = 1) {
    const [x0, y0, x1, y1] = R, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    K.rect(x, x0, y0, x1 - x0, y1 - y0, 2.6, C.white, a);
    // 对中符号：四条边的中点各往页边伸一笔。
    line(x, mx, y0, mx, y0 - 26, 2.6, C.white, a); line(x, mx, y1, mx, y1 + 26, 2.6, C.white, a);
    line(x, x0, my, x0 - 26, my, 2.6, C.white, a); line(x, x1, my, x1 + 26, my, 2.6, C.white, a);
  }
  function cell(x, cx, cy, w, lab, val, a, s = 28) {
    if (a <= 0) return;
    const lf = F(s), lw = measure(x, lab, lf);
    text(x, lab, cx + s * 0.5, cy, { font: lf, color: C.pale, alpha: a });
    text(x, val, cx + s * 0.9 + lw, cy, { font: F(s * 1.12), color: C.white, alpha: a, maxW: w - lw - s * 1.3 });
  }

  // Clawd 画成零件图：外轮廓白线，身体打 45° 剖面线，眼睛留白；格子沿用 clawd.js（一格 q 宽、2q 高）。
  function clawdPart(x, cx, bottom, q, pose, crouch, a = 1) {
    if (a <= 0) return;
    const { body, eyes } = window.Clawd.cells(pose, crouch);
    const on = new Set(body.map(([u, v]) => u * 16 + v));
    const X0 = cx - 9 * q, Y0 = bottom - 12 * q, p = new Path2D();
    for (const [u, v] of body) p.rect(X0 + u * q, Y0 + v * 2 * q, q, 2 * q);
    x.save(); x.globalAlpha = a;
    x.fillStyle = C.deep; x.fill(p);
    x.save(); x.clip(p); x.strokeStyle = C.pale; x.lineWidth = Math.max(1, 0.14 * q); x.beginPath();
    for (let s = -12 * q; s < 18 * q; s += 1.15 * q) { x.moveTo(X0 + s, Y0 + 12 * q); x.lineTo(X0 + s + 12 * q, Y0); }
    x.stroke(); x.restore();
    x.fillStyle = C.white;
    for (const [u, v] of eyes) x.fillRect(X0 + u * q, Y0 + v * 2 * q, q, 2 * q);
    x.strokeStyle = C.white; x.lineWidth = Math.max(1.4, 0.24 * q); x.lineCap = "square"; x.beginPath();
    for (const [u, v] of body) {
      const L = X0 + u * q, T = Y0 + v * 2 * q, R = L + q, B = T + 2 * q;
      if (!on.has(u * 16 + v - 1)) { x.moveTo(L, T); x.lineTo(R, T); }
      if (!on.has(u * 16 + v + 1)) { x.moveTo(L, B); x.lineTo(R, B); }
      if (!on.has((u - 1) * 16 + v)) { x.moveTo(L, T); x.lineTo(L, B); }
      if (!on.has((u + 1) * 16 + v)) { x.moveTo(R, T); x.lineTo(R, B); }
    }
    x.stroke(); x.restore();
  }
  function poof(x, fr, px, bottom, q, a) {
    if (fr && fr.poof) for (const s of [-1, 1]) text(x, fr.poof === "dot" ? "·" : "~", px + s * 8 * q, bottom - q * 0.6, { font: M(q * 2.6, 600), color: C.pale, align: "center", texture: true, alpha: a });
  }

  // 拍位（小节）：v2/music/ch00.js 抄了其中几项让配乐落在同一拍上，两边一起改。
  const AT = {
    type0: 0.125, enter: 0.5,
    skip: 0.5, jump: 0.875, look: 1.1875, celebrate: 1.5,
    say: 0.75, tag: 0.9, cut: 2.75, land: 3.0,
    push: 4.25, dot: 4.6, cIn: [4.72, 4.81, 4.9], flip: 5.0, q: 5.25, cLook: 5.75, cOut: [6.5, 6.58, 6.66],
    shrink: 7.0, pull: 8.5, pulled: 9.3, pops: [9.5, 9.75, 10.0], rush: 11.5, end: 11.97,
  };

  const TW = { x: 250, y: 120, w: 1420, h: 840, bar: 60 };
  const TX = TW.x + 52, L1 = TW.y + TW.bar + 80;
  const BOX = { x: TW.x + 52, y: L1 + 44, w: 1120, h: 330 };
  const CLAWD_Q = 11, CLAWD_X = BOX.x + 190, CLAWD_BASE = BOX.y + BOX.h - 32;
  const L2 = BOX.y + BOX.h + 96;
  const BAL = [CLAWD_X + 150, BOX.y + 70], NOTE = [560, 668];
  const TBA = [["ch00.tbNo", "00-A"], ["ch00.tbDrawn", "lyjw"], ["ch00.tbCheck", "Clawd"]], TBA_H = 60;
  const CMD = "claude";
  const CAM_TERM = { x: 960, y: 540, zoom: 1, rot: 0 };

  function clawdFrame(b) {
    const Cl = window.Clawd, fr = Cl.FRAME_MS / 1000 / BARS;
    const segs = [["celebrate", AT.celebrate], ["look", AT.look], ["jump", AT.jump], ["skip", AT.skip]];
    for (const [name, t0] of segs) {
      if (b < t0) continue;
      const i = Math.floor((b - t0) / fr + 1e-6), s = Cl.SEQ[name];
      if (i < s.length) return s[i];
      if (name === "celebrate") break;
    }
    return b >= AT.skip ? { pose: "default", offset: 0, x: 0 } : null;
  }
  // 第 10 章借 termState(2) 改几项当谢幕的状态；这里新加的字段（tag）都只在 welcome 亮着时画，清屏后和 termState(0) 一样。
  function termState(b) {
    const typed = b < AT.type0 ? 0 : Math.min(CMD.length, Math.floor((b - AT.type0) * 16 + 1e-6) + 1);
    const entered = b >= AT.enter;
    const on = b < 0.625 || (b * 4) % 1 < 0.5;
    return {
      typed, welcome: prog(b, AT.enter, AT.enter + 0.06), clawd: clawdFrame(b), tag: prog(b, AT.tag, AT.tag + 0.12),
      say: prog(b, AT.say, AT.say + 0.1) * (1 - prog(b, 2.55, 2.65)), sayReveal: prog(b, AT.say + 0.02, AT.say + 0.6),
      cursor: { line: entered ? 2 : 1, on },
      endcard: null, clear: 0,
    };
  }
  // 标题栏的右边和下边就是图框线；格宽按当前语种实测的字宽排，中英都不挤、不出框。
  function sheetA(x) {
    dimH(x, TW.x, TW.x + TW.w, 96, TW.y, "80", 1, 1);
    dimV(x, TW.y, TW.y + TW.h, 200, TW.x, "24", 1, 1);
    const s = 28, pad = 10, [, , fx, fy] = FRAME_A, by = fy - TBA_H;
    const cells = TBA.map(([k, v]) => { const lab = tr(k); return [lab, v, measure(x, lab, F(s)) + measure(x, v, F(s * 1.12)) + s * 1.4 + pad * 2]; });
    const bx = fx - cells.reduce((n, c) => n + c[2], 0);
    fillRect(x, bx, by, fx - bx, TBA_H, C.blue);
    line(x, bx, by, fx, by, 1.6, C.white, 1); line(x, bx, by, bx, fy, 1.6, C.white, 1);
    cells.reduce((cx, [lab, v, w], i) => {
      if (i) line(x, cx, by, cx, fy, 1.2, C.white, 1);
      cell(x, cx + pad, by + 40, w - pad * 2, lab, v, 1, s);
      return cx + w;
    }, bx);
    frame(x, FRAME_A);
  }
  function note(x, st, cx) {
    const k = st.say, lines = tr("ch00.clawd").split("\n"), f = F(38), lh = 56, pad = 34;
    const w = Math.max(...lines.map((l) => measure(x, l, f))) + pad * 2, h = 64 + lines.length * lh + 20, [nx, ny] = NOTE, a = clamp(k * 3);
    const ax = cx + 8 * CLAWD_Q, ay = CLAWD_BASE - 3 * CLAWD_Q;
    polyline(x, [[ax, ay], [nx - 30, ny + 32], [nx, ny + 32]], prog(k, 0, 0.6), 1.4, C.pale, a);
    disc(x, ax, ay, 4.5, C.white, a);
    const s = lerp(0.92, 1, E.outBack(clamp(k * 1.4)));
    x.save(); x.translate(nx, ny); x.scale(s, s); x.translate(-nx, -ny);
    fillRect(x, nx, ny, w, h, C.deep, a);
    K.rect(x, nx, ny, w, h, 2, C.white, a);
    line(x, nx, ny + 64, nx + w, ny + 64, 1.2, C.pale, a);
    balloon(x, nx + 36, ny + 32, 22, "7", a, C.deep);
    text(x, "Clawd", nx + 70, ny + 43, { font: F(32), color: C.pale, alpha: a });
    const total = lines.reduce((n, l) => n + [...l].length, 0);
    let shown = st.sayReveal * total;
    lines.forEach((l, i) => {
      const n = [...l].length;
      text(x, l, nx + pad, ny + 108 + i * lh, { font: f, color: C.white, alpha: a, reveal: clamp(shown / n), perChar: true });
      shown -= n;
    });
    x.restore();
  }
  function terminal(L, st) {
    const { x, tp } = L;
    fillRect(x, TW.x, TW.y, TW.w, TW.h, C.deep);
    K.rect(x, TW.x, TW.y, TW.w, TW.h, 2.6, C.white, 1);
    line(x, TW.x, TW.y + TW.bar, TW.x + TW.w, TW.y + TW.bar, 1.4, C.pale, 1);
    for (let i = 0; i < 3; i++) ring(x, TW.x + 30 + i * 28, TW.y + TW.bar / 2, 8, 1.6, C.pale);
    text(x, "zsh — ~/Developer/lyjwpage", TW.x + TW.w / 2, TW.y + TW.bar / 2 + 10, { font: M(30), color: C.pale, align: "center" });
    const keep = (y) => st.clear <= 0 || y < lerp(TW.y + TW.h, L1 + 24, E.io(st.clear));
    const pf = M(50), pw = measure(x, "$ ", pf);
    text(x, "$", TX, L1, { font: pf, color: C.red });
    const typed = st.clear > 0.98 ? "" : CMD.slice(0, st.typed);
    if (typed) text(x, typed, TX + pw, L1, { font: pf, color: C.white });
    const wa = st.welcome;
    if (wa > 0 && keep(BOX.y + BOX.h)) {
      K.rect(x, BOX.x, BOX.y, BOX.w, BOX.h, 2.4, C.white, wa);
      K.rect(x, BOX.x + 8, BOX.y + 8, BOX.w - 16, BOX.h - 16, 1, C.dim, wa);
      const tx = BOX.x + 650;
      text(x, "Claude Code", tx, BOX.y + 108, { font: pf, color: C.white, alpha: wa });
      text(x, "Opus 5.5", tx, BOX.y + 178, { font: M(38), color: C.pale, alpha: wa });
      text(x, "~/Developer/lyjwpage", tx, BOX.y + 236, { font: M(32), color: C.pale, alpha: wa });
      const cf = st.clawd;
      if (cf) {
        const cx = CLAWD_X + (cf.x || 0) * 2 * CLAWD_Q, crouch = cf.offset || 0;
        tp.save(); tp.beginPath(); tp.rect(BOX.x + 9, BOX.y + 9, BOX.w - 18, BOX.h - 18); tp.clip();
        clawdPart(tp, cx, CLAWD_BASE, CLAWD_Q, cf.pose, crouch, wa);
        tp.restore();
        poof(tp, cf, cx, CLAWD_BASE, CLAWD_Q, wa);
        const ta = wa * (st.tag ?? 0);
        if (ta > 0) {
          const ax = cx + 5 * CLAWD_Q, ay = CLAWD_BASE - 10 * CLAWD_Q + crouch * 4 * CLAWD_Q, ang = Math.atan2(ay - BAL[1], ax - BAL[0]);
          line(x, BAL[0] + Math.cos(ang) * 26, BAL[1] + Math.sin(ang) * 26, ax, ay, 1.4, C.pale, ta);
          disc(x, ax, ay, 4.5, C.white, ta);
          balloon(x, BAL[0], BAL[1], 26, "7", ta, C.deep);
          text(x, `${tr("ch00.part")} · Clawd`, BAL[0] + 40, BAL[1] + 11, { font: F(32), color: C.pale, alpha: ta });
        }
        if (st.say > 0) note(x, st, cx);
      }
    }
    const ec = st.endcard;
    // 第 10 章的片尾字卡：字是那一章的，用全片的 cjk 字体，不靠本章只切了自己用字的子集。
    if (ec && ec.a > 0 && keep(L2 + 160)) {
      K.narration(x, ec.l1, TX, L2 + 50, { px: 110, color: C.white, reveal: ec.reveal, alpha: ec.a, maxW: TW.w - 104 });
      text(x, ec.l2, TX + 4, L2 + 140, { font: FONT.cjk(46, 600), color: C.pale, alpha: ec.a * prog(ec.reveal, 0.5, 1), maxW: TW.w - 108 });
    } else if (st.cursor.line === 2 && wa > 0 && keep(L2)) text(x, ">", TX, L2, { font: pf, color: C.pale });
    if (st.cursor.on) {
      const onL2 = st.cursor.line === 2 && st.clear <= 0;
      const cx = onL2 ? TX + measure(x, "> ", pf) : TX + pw + measure(x, typed, pf) + 4;
      fillRect(x, cx, (onL2 ? L2 : L1) - 42, 27, 50, C.red);
    }
    if (st.clear > 0 && st.clear < 1) {
      const y = lerp(TW.y + TW.h, L1 + 24, E.io(st.clear));
      fillRect(x, TW.x + 2, y, TW.w - 4, TW.y + TW.h - y - 2, C.deep);
      line(x, TW.x + 2, y, TW.x + TW.w - 2, y, 1.6, C.red, 0.8);
    }
  }
  // 首尾共用渲染函数、底版和后期参数，才能逐帧无缝循环。
  function termFrame(f, st, cam = CAM_TERM, extra = null) {
    const { x: X, e: Em, d: D, tp: T } = lay();
    G.setCam(cam);
    plate();
    const x = X.begin(); X.cam(cam);
    const e = Em.begin(); Em.cam(cam);
    const d = D.begin(); D.cam(cam);
    const tp = T.begin(); T.cam(cam);
    sheetA(x);
    terminal({ x, e, d, tp }, st);
    if (extra) extra({ x, e, d, tp });
    G.composite(X.upload(), { mode: G.MODE.normal });
    G.composite(Em.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(D.upload(), { mode: G.MODE.normal });
    G.composite(T.upload(), { mode: G.MODE.normal });
    f.post = { ...POST, shake: [0, 0], flash: 0, fade: 0, blur: [0, 0], zoomBlur: 0 };
  }

  const PSC = 1.5;
  const WIN = { x: 2700, y: 814.5 + DY, w: 961, bar: 60 };
  const VIEW = 540;
  WIN.h = WIN.bar + VIEW * PSC;
  const PX = (u) => WIN.x + 20 + u * PSC, PY = (v) => WIN.y + WIN.bar + v * PSC;
  const CARDS = [
    { id: "contact", r: [0, 64, 304, 121] },
    { id: "digest", r: [310, 64, 304, 121] },
    { id: "listening", r: [0, 192, 614, 238] },
    { id: "chat", r: [0, 437, 614, 152] },
  ];
  const LC = CARDS[2].r;
  const COVER = [LC[0] + 14, LC[1] + 31, 48];
  const COVER_C = [PX(COVER[0] + COVER[2] / 2), PY(COVER[1] + COVER[2] / 2)];
  const ML = COVER_C[1];
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI";
  const CLOUD = [PX(5), PY(221), PX(181), PY(288)], REV = [PX(205), ML + 12];

  function card(x, r, k, a, hot = 0) {
    if (a <= 0 || k <= 0) return;
    const [u, v, w, h] = r, px = PX(u), py = PY(v), W = w * PSC, H = h * PSC;
    polyline(x, [[px + W / 2, py], [px + W, py], [px + W, py + H], [px, py + H], [px, py], [px + W / 2, py]], k, hot > 0.5 ? 3 : 2, hot > 0.5 ? C.red : C.white, a);
  }
  const bar = (x, u, v, w, h, a) => fillRect(x, PX(u), PY(v), w * PSC, h * PSC, C.pale, a);
  // 照 src/components/live/digest-card.tsx#DayDial 画；弧段是示意，不是数据。
  function digestDial(x, cx, cy, r, a) {
    if (a <= 0) return;
    ring(x, cx, cy, r, 1.6, C.white, a);
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) continue;
      const t = (i / 12) * TAU, s = Math.sin(t), c = Math.cos(t);
      line(x, cx + s * r * 0.95, cy - c * r * 0.95, cx + s * r * 0.88, cy - c * r * 0.88, 1.4, C.pale, a);
    }
    [[0.66, [[0.05, 0.2], [0.42, 0.61]]], [0.53, [[0.3, 0.38], [0.7, 0.84]]]].forEach(([k, arcs]) => {
      x.save(); x.strokeStyle = C.pale; x.lineWidth = r * 0.09;
      x.globalAlpha = a * 0.18; x.beginPath(); x.arc(cx, cy, r * k, 0, TAU); x.stroke();
      x.globalAlpha = a * 0.7;
      for (const [t0, t1] of arcs) { x.beginPath(); x.arc(cx, cy, r * k, t0 * TAU - Math.PI / 2, t1 * TAU - Math.PI / 2); x.stroke(); }
      x.restore();
    });
    const hand = 0.62 * TAU, hs = Math.sin(hand), hc = Math.cos(hand);
    line(x, cx + hs * r * 0.36, cy - hc * r * 0.36, cx + hs * r * 0.96, cy - hc * r * 0.96, 1.6, C.white, a);
    fillRect(x, cx - r * 0.22, cy - r * 0.12, r * 0.44, r * 0.1, C.pale, 0.7 * a);
    fillRect(x, cx - r * 0.12, cy + r * 0.08, r * 0.24, r * 0.05, C.pale, 0.4 * a);
  }
  function heroRow(x, flipK, a, hot) {
    const [cu, cv, cs] = COVER;
    const cy = PY(cv + cs / 2), s = flipK > 0 && flipK < 1 ? Math.max(0.03, Math.abs(Math.cos(flipK * Math.PI))) : 1;
    x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy);
    K.rect(x, PX(cu), PY(cv), cs * PSC, cs * PSC, 2, C.white, a);
    for (let j = 1; j <= 4; j++) ring(x, PX(cu + cs / 2), cy, cs * PSC * 0.1 * j, 1.4, C.pale, a * (0.9 - j * 0.12));
    const tx = PX(cu + cs + 12);
    text(x, tr("ch00.np"), tx, PY(cv + 11), { font: M(20, 600), color: C.pale, alpha: a, tracking: 1.5 });
    text(x, flipK >= 0.5 ? NEW : OLD, tx, PY(cv + 32), { font: F(34), color: hot ? C.red : C.white, alpha: a });
    text(x, ARTIST, tx, PY(cv + 46), { font: F(22), color: C.pale, alpha: a });
    x.restore();
    const y = PY(cv + cs + 10), x0 = PX(cu), x1 = PX(LC[2] - 14);
    line(x, x0, y, x1, y, 4, C.pale, 0.25 * a);
    line(x, x0, y, lerp(x0, x1, flipK >= 0.5 ? 0.03 : 0.78), y, 4, C.red, a);
  }
  function home(L, o) {
    const { x } = L;
    const k = o.k ?? 1;
    if (k <= 0) return;
    const dim = 1 - 0.78 * (o.focus || 0);
    const { x: wx, y: wy, w: ww, h: wh } = WIN;
    fillRect(x, wx, wy, ww, wh, C.deep, prog(k, 0.05, 0.3));
    polyline(x, [[wx, wy + wh], [wx, wy], [wx + ww, wy], [wx + ww, wy + wh]], prog(k, 0, 0.18, E.out), 2.6, C.white, dim);
    // 窗口下沿画成断裂线：页面往下还有，线框只画到首屏。
    const bk = prog(k, 0.12, 0.3);
    if (bk > 0) { x.save(); x.globalAlpha = bk * dim; x.strokeStyle = C.pale; x.lineWidth = 1.6; x.beginPath(); for (let u = 0; u <= ww; u += 8) x.lineTo(wx + u, wy + wh + 7 * Math.sin((u / ww) * TAU * 4)); x.stroke(); x.restore(); }
    const ha = prog(k, 0.1, 0.3) * dim;
    line(x, wx, wy + WIN.bar, wx + ww, wy + WIN.bar, 1.6, C.pale, ha);
    for (let i = 0; i < 3; i++) ring(x, wx + 26 + i * 22, wy + 30, 7, 1.6, C.pale, ha);
    x.save(); x.globalAlpha = ha; x.strokeStyle = C.pale; x.lineWidth = 1.4; K.roundRect(x, wx + 330, wy + 12, 300, 36, 18); x.stroke(); x.restore();
    text(x, "lyjw.me", wx + 480, wy + 41, { font: M(32), color: C.pale, align: "center", alpha: ha });
    const hk = prog(k, 0.2, 0.4) * dim;
    bar(x, 0, 18, 70, 9, 0.75 * hk);
    x.save(); x.globalAlpha = hk; x.strokeStyle = C.pale; x.lineWidth = 1.6; K.roundRect(x, PX(190), PY(8), 234 * PSC, 40 * PSC, 30); x.stroke(); x.restore();
    fillRect(x, PX(204), PY(17), 22 * PSC, 22 * PSC, C.pale, 0.55 * hk);
    bar(x, 236, 24, 110, 8, 0.4 * hk);
    for (let i = 0; i < 2; i++) K.rect(x, PX(560 + i * 30 - 30), PY(14), 24 * PSC, 24 * PSC, 1.6, C.pale, hk);
    CARDS.forEach((c, i) => {
      const ck = prog(k, 0.3 + i * 0.1, 0.58 + i * 0.1, E.io);
      if (ck <= 0) return;
      const hero = c.id === "listening";
      const hot = hero ? o.hot || 0 : 0;
      const clip = c.id === "chat";
      if (clip) { x.save(); x.beginPath(); x.rect(wx, wy, ww, wh - 2); x.clip(); }
      card(x, c.r, ck, hero ? 1 : dim, hot);
      const ia = prog(ck, 0.6, 1) * (hero ? 1 : dim);
      const [u, v, w, h] = c.r;
      if (c.id === "contact") {
        ring(x, PX(u + 30), PY(v + 30), 16 * PSC, 1.6, C.white, ia);
        bar(x, u + 56, v + 20, 90, 8, 0.7 * ia); bar(x, u + 56, v + 34, 60, 6, 0.4 * ia);
        for (let r = 0; r < 4; r++) for (let q = 0; q < 26; q++) fillRect(x, PX(u + 14 + q * 10.6), PY(v + 64 + r * 12), 8 * PSC, 8 * PSC, C.pale, ia * (0.1 + 0.4 * K.hash(q * 7 + r * 13)));
      } else if (c.id === "digest") {
        bar(x, u + 14, v + 22, 112, 16, 0.75 * ia);
        for (let j = 0; j < 3; j++) {
          const ry = v + 58 + j * 17;
          fillRect(x, PX(u + 14), PY(ry), 6 * PSC, 6 * PSC, C.pale, 0.7 * ia);
          bar(x, u + 26, ry - 1, 34 - j * 6, 8, 0.6 * ia);
          bar(x, u + 68 - j * 6, ry + 1, 52 - j * 10, 5, 0.35 * ia);
        }
        digestDial(x, PX(u + w - 60), PY(v + h / 2), 46 * PSC, ia);
      } else if (c.id === "listening") {
        line(x, PX(u), PY(v + 21), PX(u + w), PY(v + 21), 1.4, C.pale, 0.7 * ia);
        text(x, tr("ch00.recent"), PX(u + 10), PY(v + 14), { font: M(14), color: C.pale, alpha: ia, texture: true, tracking: 1 });
        text(x, tr("ch00.apple"), PX(u + w - 10), PY(v + 14), { font: M(14), color: C.pale, align: "right", alpha: ia, texture: true, tracking: 1 });
        heroRow(x, o.flip ?? 0, ia, hot > 0.5);
        for (let j = 0; j < 9; j++) {
          K.rect(x, PX(u + 14 + j * 66), PY(v + 120), 56 * PSC, 56 * PSC, 1.4, C.white, ia * 0.8);
          bar(x, u + 14 + j * 66, v + 184, 44, 5, 0.4 * ia); bar(x, u + 14 + j * 66, v + 194, 28, 4, 0.25 * ia);
        }
      } else if (c.id === "chat") {
        line(x, PX(u), PY(v + 21), PX(u + w), PY(v + 21), 1.4, C.pale, 0.7 * ia);
        bar(x, u + 10, v + 8, 60, 6, 0.45 * ia);
        x.save(); x.globalAlpha = ia * 0.8; x.strokeStyle = C.pale; x.lineWidth = 1.4;
        K.roundRect(x, PX(u + w - 214), PY(v + 32), 200 * PSC, 22 * PSC, 11); x.stroke();
        K.roundRect(x, PX(u + 14), PY(v + 66), w * PSC - 28 * PSC, 30 * PSC, 10); x.stroke();
        x.restore();
        bar(x, u + w - 200, v + 40, 120, 6, 0.4 * ia);
        bar(x, u + 26, v + 77, 180, 7, 0.3 * ia);
      }
      if (clip) x.restore();
    });
  }
  // 线框旁的标注照 src/app/page.tsx#Home 的类名：主栏宽度、首排两列、Media 占满一行。推镜头时先收掉，免得半截露在画边。
  function homeNotes(x, b) {
    const a = 1 - prog(b, AT.push, AT.push + 0.2);
    if (a <= 0 || b < AT.land + 0.4) return;
    dimH(x, PX(0), PX(614), WIN.y - 54, WIN.y, "max-w-5xl", prog(b, 3.45, 3.85), a, M(36));
    callout(x, PX(0), PY(90), WIN.x - 60, PY(48), "md:grid-cols-2", prog(b, 3.6, 3.95), a);
    callout(x, PX(0), PY(312), WIN.x - 60, PY(350), "md:col-span-2", prog(b, 3.7, 4.05), a);
    const va = a * prog(b, 3.6, 3.9), vy = WIN.y + WIN.h + 70, vs = `${tr("ch00.view")} · lyjw.me`;
    const vw = label(x, vs, WIN.x + WIN.w / 2, vy, { font: F(40), align: "center", alpha: va });
    if (vw) line(x, WIN.x + WIN.w / 2 - vw / 2, vy + 14, WIN.x + WIN.w / 2 + vw / 2, vy + 14, 2, C.white, va);
  }
  // 推镜头那一下给「正在听」那一行画一个局部详图圈（点划线），落定、火花到之前收掉。
  // 圈线在卡头那行小字（RECENTLY PLAYED）底下断开；编号气球放在圈外，一根引线接回圈上。
  function detail(x, b) {
    const k = prog(b, AT.push, AT.push + 0.4), a = 1 - prog(b, AT.flip - 0.12, AT.flip);
    if (k <= 0 || a <= 0) return;
    const [cx, cy] = [PX(130), ML], r = 172, hy = PY(LC[1] + 14);
    x.save(); x.globalAlpha = a; x.strokeStyle = C.pale; x.lineWidth = 2; x.setLineDash([30, 8, 4, 8]);
    x.beginPath(); x.rect(cx - r - 60, cy - r - 60, 2 * r + 120, 2 * r + 120); x.rect(PX(LC[0] + 4), hy - 16, 116 * PSC, 23); x.clip("evenodd");
    x.beginPath(); x.arc(cx, cy, r, Math.PI, Math.PI + TAU * E.out(k)); x.stroke(); x.restore();
    const ba = a * prog(k, 0.6, 1), bx = cx + r + 56;
    line(x, cx + r, cy, bx - 22, cy, 1.4, C.pale, ba);
    balloon(x, bx, cy, 22, "A", ba, C.deep);
    label(x, tr("ch00.detail"), bx + 36, cy + 11, { font: F(30), alpha: ba, bg: C.deep });
  }
  // 换歌记成一处修订：红笔云线圈住这一行，旁边一个 △1 写上改了什么（标题栏「修订」一格对应它）。
  function revCloud(x, R, k, a) {
    const [x0, y0, x1, y1] = R, w = x1 - x0, h = y1 - y0, P = 2 * (w + h), n = Math.round(P / 24), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const at = (t) => { t = ((t % P) + P) % P; return t < w ? [x0 + t, y0] : t < w + h ? [x1, y0 + t - w] : t < 2 * w + h ? [x1 - (t - w - h), y1] : [x0, y1 - (t - 2 * w - h)]; };
    x.save(); x.globalAlpha = a; x.strokeStyle = C.red; x.lineWidth = 2.4; x.lineCap = "round"; x.beginPath();
    const m = n * k;
    for (let i = 0; i < Math.ceil(m); i++) {
      const p = at((i / n) * P), q = at(((i + 1) / n) * P), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, r = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2;
      let nx = -(q[1] - p[1]), ny = q[0] - p[0];
      if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
      const a0 = Math.atan2(p[1] - my, p[0] - mx), an = Math.atan2(ny, nx);
      const cw = ((an - a0 + TAU) % TAU) < Math.PI;
      const sweep = Math.PI * Math.min(1, m - i);
      x.arc(mx, my, r, a0, cw ? a0 + sweep : a0 - sweep, !cw);
    }
    x.stroke(); x.restore();
  }
  function revTri(x, cx, cy, s, a) {
    x.save(); x.globalAlpha = a; x.strokeStyle = C.red; x.lineWidth = 2; x.lineJoin = "round"; x.beginPath();
    x.moveTo(cx, cy - s * 0.58); x.lineTo(cx + s / 2, cy + s * 0.29); x.lineTo(cx - s / 2, cy + s * 0.29); x.closePath(); x.stroke(); x.restore();
    text(x, "1", cx, cy + s * 0.22, { font: F(s * 0.62), color: C.red, align: "center", alpha: a });
  }
  function revision(x, b) {
    const k = prog(b, AT.flip + 0.04, AT.flip + 0.3);
    if (k <= 0) return;
    revCloud(x, CLOUD, k, 1);
    const nk = prog(b, AT.flip + 0.15, AT.flip + 0.3);
    revTri(x, REV[0], REV[1] - 11, 36, nk);
    text(x, `${OLD} → ${NEW}`, REV[0] + 30, REV[1], { font: F(30), color: C.red, alpha: nk, reveal: prog(b, AT.flip + 0.18, AT.flip + 0.5), perChar: true });
  }

  const COLS = [
    { key: "ch00.src", sub: "ch00.srcSub", x0: 140, x1: 1180 },
    { key: "ch00.hub", sub: null, mono: "Cloudflare Workers", x0: 1380, x1: 2460 },
    { key: "ch00.scr", sub: "ch00.scrSub", x0: 2660, x1: 3700 },
  ];
  const COL_Y0 = 580 + DY, COL_Y1 = 1740 + DY;
  const PICS = [
    { i: 1, name: "iPhone", y: ML - 290 }, { i: 2, key: "ch00.home", y: ML - 145 }, { i: 0, name: "Mac", y: ML },
    { i: 3, name: "NAS", y: ML + 145 }, { i: 4, key: "ch00.tokyo", y: ML + 290 }, { i: 5, key: "ch00.cloud", y: ML + 435 },
  ];
  const PIC_X = 400, PIC_S = 2.3, FUNNEL = [1300, ML];
  const MAC = [PIC_X, ML];
  const BLK = {
    ingress: { x: 1420, y: ML - 70, w: 420, h: 140, key: "ch00.ingress", mono: "ingress" },
    core: { x: 2000, y: ML - 70, w: 420, h: 140, key: "ch00.core", mono: "core" },
    collector: { x: 2000, y: ML - 330, w: 420, h: 140, key: "ch00.collector", mono: "collector" },
    ai: { x: 1420, y: ML - 330, w: 420, h: 140, key: "ch00.ai", mono: "ai" },
  };
  const RAIL_Y = ML + 200, GLY = [["room", 1560], ["lag", 1800], ["d1", 2040], ["cred", 2280]], GLY_Y = ML + 330;
  const ROUTE = [[PIC_X + 240, ML], COVER_C];
  const TBB = { x: 2560, y: FRAME_B[3] - 330, w: FRAME_B[2] - 2560, h: 330 };

  function pict(x, i, cx, cy, s, a, col) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(s, s);
    x.strokeStyle = col; x.fillStyle = C.blue; x.lineWidth = 3.4 / s;
    const R = (rx, ry, w, h, r = 0) => { r ? K.roundRect(x, rx, ry, w, h, r) : (x.beginPath(), x.rect(rx, ry, w, h)); x.fill(); x.stroke(); };
    const Ln = (pts) => { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); };
    if (i === 0) { R(-26, -24, 52, 34); Ln([[-34, 14], [34, 14]]); }
    else if (i === 1) R(-14, -27, 28, 54, 7);
    else if (i === 2) { R(-36, -16, 34, 32, 6); x.beginPath(); x.arc(-19, 0, 5, 0, TAU); x.stroke(); R(6, -12, 30, 24); for (let j = 0; j < 3; j++) Ln([[13 + j * 8, -5], [13 + j * 8, 5]]); }
    else if (i === 3) { R(-22, -27, 44, 54); for (let j = 0; j < 3; j++) Ln([[-12 + j * 12, -18], [-12 + j * 12, 12]]); }
    else if (i === 4) { R(-37, -12, 22, 24); R(-11, -12, 22, 24); R(15, -12, 22, 24); }
    else { x.setLineDash([5, 4]); x.beginPath(); x.rect(-26, -20, 52, 40); x.fill(); x.stroke(); x.setLineDash([]); Ln([[-14, 0], [-6, -8], [2, 6], [10, -4]]); }
    x.restore();
  }
  function dial(x, cx, cy, r, a) {
    x.save(); x.globalAlpha = a; x.strokeStyle = C.white; x.lineWidth = 2.6; x.fillStyle = C.deep;
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - r * 0.7); x.lineTo(cx, cy); x.lineTo(cx + r * 0.5, cy + r * 0.28); x.stroke(); x.restore();
  }
  function block(x, B, a, hot) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.fillStyle = C.deep; x.strokeStyle = hot ? C.red : C.white; x.lineWidth = 3;
    K.roundRect(x, B.x, B.y, B.w, B.h, 14); x.fill(); x.stroke(); x.restore();
    const dx = B.key === "ch00.collector" ? 86 : 32;
    if (B.key === "ch00.collector") dial(x, B.x + 46, B.y + B.h / 2, 26, a);
    text(x, tr(B.key), B.x + dx, B.y + 62, { font: F(60), color: hot ? C.red : C.white, alpha: a, maxW: B.w - dx - 20 });
    text(x, B.mono, B.x + dx, B.y + 120, { font: M(59), color: C.pale, alpha: a });
  }
  function overview(L, b, o) {
    const { x } = L;
    const k = o.k;
    if (k <= 0) return;
    COLS.forEach((c, i) => {
      const ck = prog(k, i * 0.12, 0.45 + i * 0.12, E.io);
      if (ck <= 0) return;
      polyline(x, [[c.x0, COL_Y0 + 170], [c.x0, COL_Y0], [c.x1, COL_Y0], [c.x1, COL_Y1], [c.x0, COL_Y1], [c.x0, COL_Y0 + 170]], ck, 2.6, C.white, 0.85);
      const ta = prog(ck, 0.5, 1), tf = F(80), sf = c.sub ? F(59) : M(59), mw = c.x1 - c.x0 - 90;
      const st = c.sub ? tr(c.sub) : c.mono, tw = Math.min(mw, measure(x, tr(c.key), tf)), sw = Math.min(mw, measure(x, st, sf));
      fillRect(x, c.x0 + 30, COL_Y0 + 20, Math.max(tw, sw) + 34, 186, C.blue, ta);
      text(x, tr(c.key), c.x0 + 44, COL_Y0 + 100, { font: tf, color: o.pop[i] > 0.3 ? C.red : C.white, alpha: ta, maxW: mw });
      text(x, st, c.x0 + 46, COL_Y0 + 180, { font: sf, color: C.pale, alpha: ta, maxW: mw });
      // 三栏各亮一下：栏名闪红，红笔在下面划一道，划过就留着。
      const uk = prog(b, AT.pops[i], AT.pops[i] + 0.12, E.out);
      if (uk > 0) line(x, c.x0 + 44, COL_Y0 + 116, c.x0 + 44 + tw * uk, COL_Y0 + 116, 4, C.red, ta);
    });
    PICS.forEach((p, j) => {
      const pa = prog(k, 0.15 + j * 0.05, 0.3 + j * 0.05);
      if (pa <= 0) return;
      const mac = p.i === 0;
      pict(x, p.i, PIC_X, p.y, PIC_S * lerp(0.7, 1, E.outBack(pa)), pa, mac ? C.red : C.white);
      label(x, p.key ? tr(p.key) : p.name, PIC_X + 110, p.y + 20, { font: p.key ? F(59) : M(59), color: mac ? C.red : C.white, alpha: pa });
      if (!mac) polyline(x, [[PIC_X + 340, p.y], FUNNEL], prog(k, 0.35 + j * 0.04, 0.6 + j * 0.04, E.io), 2, C.pale, 0.6);
    });
    const ba = (t) => prog(k, t, t + 0.2, E.out);
    block(x, BLK.collector, ba(0.4), false);
    block(x, BLK.ai, ba(0.45), false);
    polyline(x, [[BLK.ai.x + BLK.ai.w, BLK.ai.y + 100], [1920, BLK.ai.y + 100], [1920, ML - 40], [BLK.core.x, ML - 40]], prog(k, 0.55, 0.7), 2, C.pale, 0.6);
    polyline(x, [[BLK.collector.x + 210, BLK.collector.y + BLK.collector.h], [BLK.core.x + 210, BLK.core.y]], prog(k, 0.5, 0.65), 2, C.pale, 0.8);
    const rk = prog(k, 0.5, 0.8, E.io);
    if (rk > 0) {
      polyline(x, [[1440, RAIL_Y], [2420, RAIL_Y]], rk, 2.4, C.white, 0.85);
      line(x, BLK.ingress.x + 210, ML + 70, BLK.ingress.x + 210, lerp(ML + 70, RAIL_Y, rk), 2, C.pale, 0.8);
      line(x, BLK.core.x + 210, ML + 70, BLK.core.x + 210, lerp(ML + 70, RAIL_Y, rk), 2, C.pale, 0.8);
      GLY.forEach(([g, gx], j) => {
        const ga = prog(k, 0.6 + j * 0.06, 0.8 + j * 0.06);
        if (ga <= 0) return;
        line(x, gx, RAIL_Y, gx, GLY_Y - 60, 1.6, C.pale, 0.7 * ga);
        glyph(x, g, gx, GLY_Y, C.white, 1.35 * lerp(0.6, 1, E.outBack(ga)), ga);
      });
    }
  }
  // 标题栏的右边和下边就是图框线。比例 1:2 取总装图机位缩放（OVER、RUSH0）的约数，修订 △1 对应卡上那处云线。
  function titleB(x, k) {
    if (k <= 0) return;
    const { x: bx, y: by, w, h } = TBB, rh = h / 3, cw = w / 2, ta = prog(k, 0.45, 0.9);
    fillRect(x, bx, by, w, h, C.blue, prog(k, 0, 0.15));
    polyline(x, [[bx + w, by], [bx, by], [bx, by + h]], prog(k, 0, 0.4, E.out), 2.6, C.white);
    for (let r = 1; r < 3; r++) line(x, bx, by + r * rh, lerp(bx, bx + w, prog(k, 0.2 + r * 0.08, 0.45 + r * 0.08, E.out)), by + r * rh, 1.6, C.white);
    line(x, bx + cw, by, bx + cw, lerp(by, by + h, prog(k, 0.3, 0.55, E.out)), 1.6, C.white);
    const rows = [[["ch00.tbName", "lyjw.me"], ["ch00.tbNo", "00-B"]], [["ch00.tbScale", "1:2"], ["ch00.tbRev", `△1 ${tr("ch00.tbRevNote")}`]], [["ch00.tbDrawn", "lyjw"], ["ch00.tbCheck", "Clawd"]]];
    rows.forEach((row, r) => row.forEach(([lab, val], j) => cell(x, bx + j * cw, by + r * rh + 76, cw, tr(lab), val, ta, 59)));
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function route(L, b) {
    const { x, e } = L;
    if (b < AT.dot) return;
    const [p0, p1] = ROUTE, len = p1[0] - p0[0];
    const d = keys(b, [[AT.dot, len - 520], [AT.flip, len, E.out]]);
    const head = pathAt(ROUTE, d);
    polyline(x, ROUTE, d / len, 2.4, C.red);
    const size = lerp(0.9, 0.65, prog(b, AT.flip, AT.flip + 0.3));
    spark(e, x, head, b < AT.flip + 0.1 ? trailOn(ROUTE, d, 300) : null, { t: G.t, size, lw: 3, color: C.red });
    disc(x, head[0], head[1], 9, C.red);
    if (b >= AT.flip) glow(e, head[0], head[1], 150, 0.45 * impact(b, AT.flip, 0.25));
  }

  const WINV = [2730, WIN.y + WIN.h / 2, 0.9, 0];
  const CARD_C = [PX(LC[0] + LC[2] / 2), PY(LC[1] + LC[3] / 2)];
  // 卡片特写的缩放和落点：卡的上沿让开大字问题框、下沿让开注释框，慢推到 AT.pull 也不压到框线。
  const ZC = 1.42, P_CARD = [1100, 606];
  const CARDV = [CARD_C[0] - (P_CARD[0] - 960) / ZC, CARD_C[1] - (P_CARD[1] - 540) / ZC, ZC, 0];
  // 总装图推到 RUSH0 时图框四边仍离画边 40 px 以上；图上要读的字（栏的副标、小样名、方块代号、标题栏）按 RUSH0 的缩放折算不低于 CONVENTIONS 的字号下限。
  const OVER = [1920, (FRAME_B[1] + FRAME_B[3]) / 2, 0.467, 0], RUSH0 = [OVER[0], OVER[1], 0.477, 0];
  // 窗口偏右放：左边空出来写尺寸标注，右边不露出图框线。
  const CAM_A = [[AT.cut, [960, 540, 1.018, 0]], [AT.land, WINV, E.io], [AT.push, [WINV[0], WINV[1], 0.93, 0], E.lin], [AT.push + 0.5, CARDV, E.io], [AT.pull, [CARDV[0], CARDV[1], ZC * 1.01, 0], E.lin]];
  const toScreen = (w, c) => [(w[0] - c[0]) * c[2] + 960, (w[1] - c[1]) * c[2] + 540];
  function anchored(k, W, p0, p1, z0, z1) {
    const z = Math.exp(lerp(Math.log(z0), Math.log(z1), k));
    const p = [lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)];
    return [W[0] - (p[0] - 960) / z, W[1] - (p[1] - 540) / z, z, 0];
  }
  function camPaper(b) {
    if (b < AT.pull) return keys(b, CAM_A);
    if (b < AT.pulled) {
      const c0 = keys(AT.pull, CAM_A);
      return anchored(E.io(prog(b, AT.pull, AT.pulled)), CARD_C, toScreen(CARD_C, c0), toScreen(CARD_C, OVER), c0[2], OVER[2]);
    }
    if (b < AT.rush) return keys(b, [[AT.pulled, OVER], [AT.rush, RUSH0, E.lin]]);
    return anchored(E.inExpo(prog(b, AT.rush, AT.end)), MAC, toScreen(MAC, RUSH0), [960, 540], RUSH0[2], 7);
  }

  function notesBox(x, a, x0, y0, y1) {
    if (a <= 0) return;
    fillRect(x, x0, y0, 1100, y1 - y0, C.blue, a);
    K.rect(x, x0, y0, 1100, y1 - y0, 1.6, C.white, a);
    K.rect(x, x0 + 6, y0 + 6, 1088, y1 - y0 - 12, 1, C.dim, a);
    text(x, tr("ch00.notes"), x0 + 1080, y1 - 16, { font: F(28), color: C.pale, align: "right", alpha: a });
  }
  // 注释框（屏幕坐标）：卡片特写时贴在屏幕左下；往回拉的最后一段挪进图纸 B 的左下角，左边和下边压在图框线上，跟着图纸走。
  const NOTES_H = 182;
  function notesAt(b) {
    const c = camPaper(Math.max(b, AT.pulled)), [px, py] = toScreen([FRAME_B[0], FRAME_B[3]], c), k = E.io(prog(b, 8.85, AT.pulled));
    return [lerp(80, px, k), lerp(1062 - NOTES_H, py - NOTES_H, k)];
  }
  const nar = (x, key, px, py, r, a) => text(x, tr(key), px, py, { font: F(60), color: C.white, reveal: r, dim: 0.16, perChar: true, alpha: a, maxW: 1030, narration: true });
  const EP = "lyjw.me · /api/status/listening/now";
  function hud(x, b) {
    const qa = prog(b, AT.q, AT.q + 0.06) * (1 - prog(b, 11.35, 11.5));
    const na = win(b, 7.05, 7.15, 11.3, 11.45);
    if (qa <= 0 && na <= 0) return;
    screen(x, () => {
      if (qa > 0) {
        // 问题翻成标题时（fk 过半，字压成一条线）标题字直接换到 00 那格右边起；00 和分隔线等页眉框收到位才出，入场时不和字叠。
        const sk = prog(b, AT.shrink, AT.shrink + 0.3, E.io), fk = prog(b, AT.shrink + 0.02, AT.shrink + 0.22);
        const sq = fk > 0 && fk < 1 ? Math.max(0.03, Math.abs(Math.cos(fk * Math.PI))) : 1;
        const isT = fk >= 0.5, str = tr(isT ? "ch00.title" : "ch00.q");
        const size = lerp(100, 60, sk), px = isT ? 292 : lerp(110, 292, sk), py = lerp(300, 172, sk), f = F(size, isT ? 500 : 300), maxW = lerp(1680, 1080, sk);
        const w = Math.min(maxW, measure(x, str, f)), ef = M(28), ew = measure(x, EP, ef);
        const x0 = lerp(80, 96, sk), y0 = lerp(190, 102, sk), y1 = lerp(336, 248, sk), x1 = Math.max(px + w, lerp(px + w, 292 + ew, sk)) + 32;
        fillRect(x, x0, y0, x1 - x0, y1 - y0, C.deep, qa);
        K.rect(x, x0, y0, x1 - x0, y1 - y0, 2, C.white, qa);
        const ha = qa * prog(sk, 0.7, 1);
        if (ha > 0) {
          line(x, 270, y0, 270, y1, 1.6, C.white, ha);
          line(x, 270, 190, x1, 190, 1.2, C.pale, ha);
          text(x, "00", 183, 214, { font: F(104, 300), color: C.red, align: "center", alpha: ha });
          text(x, EP, 292, 230, { font: ef, color: C.pale, alpha: ha * prog(b, AT.shrink + 0.2, AT.shrink + 0.4) });
        }
        x.save(); x.translate(0, py - size * 0.35); x.scale(1, sq); x.translate(0, -(py - size * 0.35));
        text(x, str, px, py, { font: f, color: C.white, reveal: prog(b, AT.q, AT.q + 0.4), perChar: b < AT.q + 0.4, alpha: qa, maxW });
        x.restore();
      }
      if (na > 0) {
        const [nx, ny] = notesAt(b);
        notesBox(x, na, nx, ny, ny + NOTES_H);
        nar(x, "ch00.n1a", nx + 30, ny + 70, prog(b, 7.1, 7.45), win(b, 7.05, 7.15, 8.75, 8.9));
        nar(x, "ch00.n1b", nx + 30, ny + 150, prog(b, 7.45, 7.95), win(b, 7.05, 7.15, 8.75, 8.9));
        nar(x, "ch00.n2a", nx + 30, ny + 70, prog(b, 9.05, 9.4), win(b, 9.0, 9.1, 11.3, 11.45));
        nar(x, "ch00.n2b", nx + 30, ny + 150, prog(b, 9.4, 9.95), win(b, 9.0, 9.1, 11.3, 11.45));
      }
    });
  }

  // 翻面那一刻镜头在 CARDV，窗口标题栏在画面外：Clawd 站在火花那根线上、窗口左边，屏幕上约 120 px 宽，不压卡片和旁白。
  const CQ = 4.6, PERCH = [2590, ML];
  const IN_X = [PERCH[0] - 250, PERCH[0] - 115, PERCH[0]], OUT_X = [PERCH[0], PERCH[0] - 125, PERCH[0] - 260];
  function hops(b, ts, xs, h) {
    for (let i = 0; i < 2; i++) {
      if (b < ts[i + 1]) return [lerp(xs[i], xs[i + 1], prog(b, ts[i], ts[i + 1])), K.hop(b, ts[i], ts[i + 1], h[i])];
    }
    return [xs[2], 0];
  }
  function cameo(tp, b) {
    if (b < AT.cIn[0] || b >= AT.cOut[2]) return;
    const air = b < AT.cIn[2] || b >= AT.cOut[0];
    const [cx, up] = b < AT.cIn[2] ? hops(b, AT.cIn, IN_X, [60, 44]) : b >= AT.cOut[0] ? hops(b, AT.cOut, OUT_X, [34, 48]) : [PERCH[0], 0];
    const fr = air ? { pose: "arms-up", offset: 0 }
      : K.clawdSeq("land", b, AT.cIn[2], BARS) || K.clawdSeq("jump", b, AT.flip, BARS) || K.clawdSeq("look", b, AT.cLook, BARS)
        || { pose: "look-right", offset: 0 };
    const px = cx + (fr.x || 0) * 2 * CQ, bottom = PERCH[1] - 1.5 - up;
    clawdPart(tp, px, bottom, CQ, fr.pose, fr.offset || 0);
    poof(tp, fr, px, bottom, CQ, 1);
  }

  function paperFrame(f, b, o = {}) {
    const { x: X, e: Em, d: D, tp: T } = lay();
    const c = camPaper(b), c0 = camPaper(Math.max(o.b0 ?? AT.cut, b - 1 / 60 / BARS));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.02 * impact(b, AT.flip, 0.12)), rot: 0 };
    G.setCam(cam);
    plate();
    const x = X.begin(); X.cam(cam);
    const e = Em.begin(); Em.cam(cam);
    const d = D.begin(); D.cam(cam);
    const tp = T.begin(); T.cam(cam);
    const Lr = { x, e, d, tp };
    // 甩镜头的那几帧终端还在画面里，照它在第一张图纸上的样子画。
    if (b < AT.land) { sheetA(x); terminal(Lr, termState(b)); }
    frame(x, FRAME_B);
    const ov = prog(b, AT.pull + 0.05, AT.pulled + 0.3);
    overview(Lr, b, { k: ov, pop: AT.pops.map((t) => impact(b, t, 0.3)) });
    const focus = o.focus ?? (o.hud === false ? 0 : win(b, AT.q - 0.1, AT.q + 0.2, AT.pull, AT.pull + 0.4));
    home(Lr, { k: prog(b, AT.land - 0.06, AT.land + 0.85), flip: prog(b, AT.flip - 0.08, AT.flip + 0.08), hot: win(b, AT.flip, AT.flip + 0.05, 6.6, 7.0), focus });
    homeNotes(x, b);
    detail(x, b);
    route(Lr, b);
    revision(x, b);
    if (ov > 0) { block(x, BLK.ingress, prog(ov, 0.3, 0.5, E.out), true); block(x, BLK.core, prog(ov, 0.35, 0.55, E.out), true); }
    titleB(x, prog(b, 8.95, 9.7));
    // 第 10 章借 paperFrame 重放翻面那一段，不带 Clawd：只有本章自己的 render 传 cameo。
    if (o.cameo) cameo(tp, b);
    if (o.hud !== false) hud(x, b);
    // 第 10 章的旁白按它自己的颜色画在 paper 层上：先在 ink 层垫一块注释框，再把 paper 层整层染成白字。
    if (o.extra) {
      screen(x, () => notesBox(x, prog(b, AT.flip + 0.03, AT.flip + 0.1), 80, 936, 1044));
      o.extra(Lr);
      d.save(); d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = "source-in"; d.fillStyle = C.white; d.fillRect(0, 0, d.canvas.width, d.canvas.height); d.restore();
    }
    G.composite(X.upload(), { mode: G.MODE.normal });
    G.composite(Em.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(D.upload(), { mode: G.MODE.normal });
    G.composite(T.upload(), { mode: G.MODE.normal });
    const zb = Math.log(c[2] / c0[2]);
    f.post = {
      ...POST, shake: [0, 0],
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: Math.max(-0.2, Math.min(0.2, zb)),
      flash: impact(b, AT.flip, 0.1) * 0.02, flashCol: [0.85, 0.92, 1],
    };
  }

  function render(f) {
    const b = f.bar;
    if (b < AT.cut) termFrame(f, termState(b), { x: 960, y: 540, zoom: 1 + 0.018 * prog(b, AT.enter, AT.cut, E.lin), rot: 0 });
    else paperFrame(f, b, { cameo: true });
  }

  window.CHAPTERS.push({
    id: "ch00", title: "ch.00", bars: 12,
    async init() {
      G.pass(PLATE); lay();
      await Promise.all([300, 500].flatMap((w) => [document.fonts.load(F(40, w), "图纸 Clawd 80"), document.fonts.load(`${w} 40px "Noto Sans SC ch00"`, "图纸")]));
    },
    render,
    share: { termFrame, termState, terminal, paperFrame, AT, TW, L2, BOX },
  });
})();
