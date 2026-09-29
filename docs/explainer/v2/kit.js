// 画面工具：缓动、时间段、2D 绘图（发丝线、文字、信封、印章、Clawd、信封火花）。
// 所有函数只依赖传入的时间，不读时钟、不用 Math.random。
(() => {
  const { css } = G;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    lin: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
    io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    ioExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    outBack: (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    // 带阻尼的弹簧落定：盖章、落卡
    spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(11 * x)),
  };
  // t 在 [a,b] 内的进度，套缓动
  const prog = (t, a, b, e = E.lin) => e(clamp((t - a) / (b - a || 1e-9)));
  // 关键帧：[[t, v, ease], ...]，ease 作用于进入该帧的那一段
  function keys(t, ks) {
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i][0]) {
        const [t0, v0] = ks[i - 1], [t1, v1, e = E.io] = ks[i];
        const k = e(clamp((t - t0) / (t1 - t0)));
        return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], k)) : lerp(v0, v1, k);
      }
    }
    return ks[ks.length - 1][1];
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------- 字体 ----------
  const FONT = {
    sans: (px, w = 600) => `${w} ${px}px Geist, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif`,
    // 中文界面 PingFang 排第一（中文标点宽度对）；英文界面 Geist 排第一，拉丁字母才是 Geist
    cjk: (px, w = 600) => (window.I18N && I18N.lang === "en" ? `${w} ${px}px Geist, "PingFang SC", sans-serif` : `${w} ${px}px "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", Geist, sans-serif`),
    mono: (px, w = 500) => `${w} ${px}px "Geist Mono", ui-monospace, monospace`,
    pixel: (px) => `${px}px "Geist Pixel", "Geist Mono", monospace`,
  };

  // 文字。reveal 为 0..1 时逐字显现：已出现的字用 color，还没到的用 dim（默认不画）
  function text(x, str, px, py, o = {}) {
    const { font = FONT.sans(40), color = css("pink"), align = "left", base = "alphabetic", tracking = 0, reveal = 1, dim = 0, alpha = 1 } = o;
    x.save();
    x.font = font;
    // maxW：超宽时按比例缩小字号（英文往往比中文长）
    if (o.maxW) { const w0 = x.measureText(str).width; if (w0 > o.maxW) x.font = font.replace(/([\d.]+)px/, (_, n) => `${(+n * o.maxW / w0).toFixed(1)}px`); }
    x.textAlign = "left";
    x.textBaseline = base;
    if ("letterSpacing" in x) x.letterSpacing = `${tracking}px`;
    const chars = [...str];
    const wAll = x.measureText(str).width;
    let sx = align === "center" ? px - wAll / 2 : align === "right" ? px - wAll : px;
    if (reveal >= 1 && !o.perChar) {
      x.globalAlpha = alpha;
      x.fillStyle = color;
      x.fillText(str, sx, py);
    } else {
      const n = chars.length, shown = reveal * n;
      let acc = "";
      for (let i = 0; i < n; i++) {
        const k = clamp(shown - i); // 这个字出现的进度
        const cx = sx + x.measureText(acc).width;
        acc += chars[i];
        if (k > 0) {
          x.globalAlpha = alpha * (o.fadeIn === false ? 1 : E.out(k));
          x.fillStyle = color;
          x.fillText(chars[i], cx, py + (o.rise ? (1 - E.out(k)) * o.rise : 0));
        }
        if (k < 1 && dim > 0) {
          x.globalAlpha = alpha * dim * (1 - k);
          x.fillStyle = color;
          x.fillText(chars[i], cx, py);
        }
      }
    }
    x.restore();
    return wAll;
  }
  function measure(x, str, font) { x.save(); x.font = font; const w = x.measureText(str).width; x.restore(); return w; }

  function line(x, x1, y1, x2, y2, w = 1, color = css("pink"), alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.lineCap = "round";
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }
  // 画到一定比例的折线（用于「笔画出来」）
  function polyline(x, pts, k = 1, w = 1, color = css("pink"), alpha = 1) {
    if (k <= 0 || pts.length < 2) return null;
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    let left = total * clamp(k);
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    let head = pts[0];
    for (let i = 1; i < pts.length && left > 0; i++) {
      const d = seg[i - 1], f = Math.min(1, left / d);
      head = [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)];
      x.lineTo(head[0], head[1]);
      left -= d;
    }
    x.stroke(); x.restore();
    return head;
  }
  function rect(x, rx, ry, rw, rh, w = 1, color = css("pink"), alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.strokeRect(rx, ry, rw, rh); x.restore();
  }
  function fillRect(x, rx, ry, rw, rh, color, alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.fillRect(rx, ry, rw, rh); x.restore();
  }
  // 虚线
  function dashed(x, x1, y1, x2, y2, w = 1, color = css("pink"), dash = [6, 6], alpha = 1, offset = 0) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash); x.lineDashOffset = offset;
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }

  // 信封：矩形 + V 形封舌。open 0..1 时封舌翻开
  function envelope(x, cx, cy, w, color = css("pink"), o = {}) {
    const h = w * 0.64, lw = o.lw ?? Math.max(1, w * 0.045), open = o.open ?? 0, fill = o.fill;
    x.save();
    x.translate(cx, cy);
    x.rotate(o.rot || 0);
    x.globalAlpha = o.alpha ?? 1;
    x.lineJoin = "round";
    if (fill) { x.fillStyle = fill; x.fillRect(-w / 2, -h / 2, w, h); }
    x.strokeStyle = color; x.lineWidth = lw;
    const fy = lerp(h * 0.08, -h * 0.95, E.io(open)); // 封舌尖的高度：合上时在中间偏上，打开时翻到顶上
    if (open > 0.3) { // 打开后：封舌翻到后面，信纸从口里探出来
      x.save(); x.globalAlpha *= 0.55; x.beginPath(); x.moveTo(-w / 2, -h / 2); x.lineTo(0, fy); x.lineTo(w / 2, -h / 2); x.stroke(); x.restore();
      const sh = h * 0.55 * E.out(clamp((open - 0.3) / 0.7));
      if (fill) { x.fillStyle = fill; x.fillRect(-w * 0.38, -h / 2 - sh, w * 0.76, sh + h * 0.3); }
      x.strokeRect(-w * 0.38, -h / 2 - sh, w * 0.76, sh + h * 0.3);
      for (let i = 0; i < 3; i++) { const ly = -h / 2 - sh + h * 0.16 + i * h * 0.13; if (ly < -h / 2 - 2) { x.beginPath(); x.moveTo(-w * 0.28, ly); x.lineTo(w * (0.28 - i * 0.08), ly); x.lineWidth = lw * 0.6; x.stroke(); x.lineWidth = lw; } }
      if (fill) { x.fillStyle = fill; x.fillRect(-w / 2, -h / 2, w, h); }
    }
    x.strokeRect(-w / 2, -h / 2, w, h);
    if (open <= 0.3) { x.beginPath(); x.moveTo(-w / 2, -h / 2); x.lineTo(0, fy); x.lineTo(w / 2, -h / 2); x.stroke(); }
    else { x.beginPath(); x.moveTo(-w / 2, -h / 2); x.lineTo(0, h * 0.12); x.lineTo(w / 2, -h / 2); x.globalAlpha *= 0.5; x.stroke(); }
    x.restore();
  }

  // 橡皮章：双线框 + 字。k 为落章进度（0 未落，1 已落定）；落下时从大缩到 1
  function stamp(x, str, cx, cy, o = {}) {
    const { k = 1, px = 88, rot = -0.08, color = css("signal"), sub } = o;
    if (k <= 0) return;
    const s = lerp(2.4, 1, E.outExpo(clamp(k * 1.25)));
    const a = clamp(k * 3);
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.scale(s, s);
    x.globalAlpha = a * (o.alpha ?? 1);
    x.font = FONT.mono(px, 700);
    const tw = x.measureText(str).width;
    const padX = px * 0.42, padY = px * 0.3;
    const bw = tw + padX * 2, bh = px * (sub ? 1.5 : 1.05) + padY * 2;
    x.strokeStyle = color; x.fillStyle = color;
    x.lineWidth = px * 0.075;
    roundRect(x, -bw / 2, -bh / 2, bw, bh, px * 0.12); x.stroke();
    x.lineWidth = px * 0.03;
    roundRect(x, -bw / 2 + px * 0.13, -bh / 2 + px * 0.13, bw - px * 0.26, bh - px * 0.26, px * 0.07); x.stroke();
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(str, 0, sub ? -px * 0.2 : px * 0.04);
    if (sub) { x.font = FONT.cjk(px * 0.3, 600); x.fillText(sub, 0, px * 0.55); }
    x.restore();
  }
  function roundRect(x, rx, ry, rw, rh, r) {
    x.beginPath();
    x.moveTo(rx + r, ry); x.lineTo(rx + rw - r, ry); x.arcTo(rx + rw, ry, rx + rw, ry + r, r);
    x.lineTo(rx + rw, ry + rh - r); x.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
    x.lineTo(rx + r, ry + rh); x.arcTo(rx, ry + rh, rx, ry + rh - r, r);
    x.lineTo(rx, ry + r); x.arcTo(rx, ry, rx + r, ry, r);
    x.closePath();
  }

  // Clawd：官方像素造型（../clawd.js 给出象限坐标）。q 为一个象限的宽，高为 2q（终端字符比例）
  function clawd(x, cx, bottom, q, o = {}) {
    const { pose = "default", crouch = 0, body = G.css("signal"), eye = "#0b0a09", alpha = 1, flip = false } = o;
    const { body: B, eyes: EY } = window.Clawd.cells(pose, crouch);
    const cols = 18, rows = 6;
    const w = cols * q, h = rows * q * 2;
    x.save();
    x.globalAlpha = alpha;
    x.translate(cx - w / 2, bottom - h);
    if (flip) { x.translate(w, 0); x.scale(-1, 1); }
    x.fillStyle = body;
    for (const [qx, qy] of B) x.fillRect(qx * q, qy * q * 2, q + 0.4, q * 2 + 0.4);
    x.fillStyle = eye;
    for (const [qx, qy] of EY) x.fillRect(qx * q, qy * q * 2, q + 0.4, q * 2 + 0.4);
    x.restore();
    return { w, h };
  }

  // Clawd 的对白框：像素字体、硬边框、尖角指向 Clawd
  function bubble(x, str, bx, by, o = {}) {
    const { px = 34, color = css("pink"), bg = css("paper"), k = 1, tail = "left" } = o;
    if (k <= 0) return;
    x.save();
    x.font = FONT.cjk(px, 600);
    const lines = str.split("\n");
    const tw = Math.max(...lines.map((l) => x.measureText(l).width));
    const pad = px * 0.55, lh = px * 1.35;
    const bw = tw + pad * 2, bh = lh * lines.length + pad * 1.2;
    const s = lerp(0.6, 1, E.outBack(clamp(k * 1.6)));
    // tail="right" 时 (bx,by) 是框的右下角，框向左展开
    x.translate(bx, by);
    x.scale(s, s);
    if (tail === "right") x.translate(-bw, 0);
    x.globalAlpha = clamp(k * 4) * (o.alpha ?? 1);
    x.fillStyle = bg; x.strokeStyle = color; x.lineWidth = 3;
    x.beginPath();
    x.rect(0, -bh, bw, bh);
    x.fill(); x.stroke();
    // 尖角
    x.beginPath();
    if (tail === "left") { x.moveTo(18, 0); x.lineTo(4, 22); x.lineTo(44, 0); }
    else { x.moveTo(bw - 18, 0); x.lineTo(bw - 4, 22); x.lineTo(bw - 44, 0); }
    x.fill(); x.stroke();
    x.fillRect(tail === "left" ? 20 : bw - 42, -2, 22, 4);
    x.fillStyle = color;
    x.textBaseline = "alphabetic";
    const reveal = o.reveal ?? 1;
    const total = [...str.replace(/\n/g, "")].length;
    let shown = Math.floor(reveal * total + 1e-6);
    lines.forEach((l, i) => {
      const cs = [...l];
      const part = cs.slice(0, Math.max(0, shown)).join("");
      shown -= cs.length;
      x.fillText(part, pad, -bh + pad * 0.6 + lh * (i + 0.78));
    });
    x.restore();
  }

  // 信封火花：亮核 + 身后的发丝线。trail 为最近经过的点（世界坐标），head 为当前点。
  // 发光部分画在 emit 图层（相加合成、增益 >1），线画在普通图层
  function spark(emit, x, head, trail, o = {}) {
    const { size = 1, color = css("signal"), lw = 2, t = 0 } = o;
    if (trail && trail.length > 1) {
      x.save(); x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
      x.beginPath(); x.moveTo(trail[0][0], trail[0][1]);
      for (let i = 1; i < trail.length; i++) x.lineTo(trail[i][0], trail[i][1]);
      x.lineTo(head[0], head[1]); x.stroke(); x.restore();
    }
    if (!emit) return;
    const flick = 0.85 + 0.15 * hash(Math.floor(t * 60));
    const r = 26 * size;
    const g = emit.createRadialGradient(head[0], head[1], 0, head[0], head[1], r);
    g.addColorStop(0, "rgba(255,236,214,1)");
    g.addColorStop(0.12, "rgba(255,190,140,0.95)");
    g.addColorStop(0.4, "rgba(230,120,80,0.35)");
    g.addColorStop(1, "rgba(230,110,70,0)");
    emit.save(); emit.globalAlpha = flick; emit.fillStyle = g;
    emit.beginPath(); emit.arc(head[0], head[1], r, 0, Math.PI * 2); emit.fill(); emit.restore();
  }

  window.K = { clamp, lerp, E, prog, keys, mulberry32, hash, FONT, text, measure, line, polyline, rect, fillRect, dashed, envelope, stamp, roundRect, clawd, bubble, spark };
})();
