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
    spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(11 * x)),
  };
  const prog = (t, a, b, e = E.lin) => e(clamp((t - a) / (b - a || 1e-9)));
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

  const FONT = {
    sans: (px, w = 600) => `${w} ${px}px Geist, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif`,
    // 中文界面 PingFang 排第一（中文标点宽度对）；英文界面 Geist 排第一，拉丁字母才是 Geist
    cjk: (px, w = 600) => (window.I18N && I18N.lang === "en" ? `${w} ${px}px Geist, "PingFang SC", sans-serif` : `${w} ${px}px "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", Geist, sans-serif`),
    mono: (px, w = 500) => `${w} ${px}px "Geist Mono", ui-monospace, monospace`,
    pixel: (px) => `${px}px "Geist Pixel", "Geist Mono", monospace`,
  };

  function checkSize(x, str, px, py, o) {
    const C = window.__CHECK;
    if (!C || o.texture || !str.trim() || (o.alpha ?? 1) < 0.2 || ((o.reveal ?? 1) <= 0 && !o.dim)) return;
    const m = x.getTransform(), cw = x.canvas.width, chh = x.canvas.height;
    const f = parseFloat(/([\d.]+)px/.exec(x.font)[1]), w = x.measureText(str).width;
    const x0 = o.align === "center" ? px - w / 2 : o.align === "right" ? px - w : px;
    const xs = [], ys = [];
    for (const [u, v] of [[x0, py - f], [x0 + w, py - f], [x0, py + f * 0.3], [x0 + w, py + f * 0.3]]) { xs.push(m.a * u + m.c * v + m.e); ys.push(m.b * u + m.d * v + m.f); }
    if (Math.max(...xs) < 0 || Math.min(...xs) > cw || Math.max(...ys) < 0 || Math.min(...ys) > chh) return;
    const s = Math.hypot(m.a, m.b) / (cw / G.W); // 图层画布可能是半分辨率，按画布宽折回逻辑像素
    C.all.push({ ch: C.ch, t: +G.t.toFixed(3), str: str.slice(0, 48), px: +(f * s).toFixed(1), narr: !!o.narration });
  }

  function text(x, str, px, py, o = {}) {
    const { font = FONT.sans(40), color = css("pink"), align = "left", base = "alphabetic", tracking = 0, reveal = 1, dim = 0, alpha = 1 } = o;
    x.save();
    x.font = font;
    if (o.maxW) { const w0 = x.measureText(str).width; if (w0 > o.maxW) x.font = font.replace(/([\d.]+)px/, (_, n) => `${(+n * o.maxW / w0).toFixed(1)}px`); }
    checkSize(x, str, px, py, o);
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
        const k = clamp(shown - i);
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

  function narration(x, str, px, py, o = {}) {
    const size = o.px ?? 60;
    return text(x, str, px, py, { font: FONT.cjk(size, 600), color: o.color || css("pink"), reveal: o.reveal ?? 1, dim: o.dim ?? 0.14, perChar: true, alpha: o.alpha ?? 1, maxW: o.maxW, align: o.align, narration: true });
  }

  function line(x, x1, y1, x2, y2, w = 1, color = css("pink"), alpha = 1) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.lineCap = "round";
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }
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
  function dashed(x, x1, y1, x2, y2, w = 1, color = css("pink"), dash = [6, 6], alpha = 1, offset = 0) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash); x.lineDashOffset = offset;
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }

  function envelope(x, cx, cy, w, color = css("pink"), o = {}) {
    const h = w * 0.64, lw = o.lw ?? Math.max(1, w * 0.045), open = o.open ?? 0, fill = o.fill;
    x.save();
    x.translate(cx, cy);
    x.rotate(o.rot || 0);
    x.globalAlpha = o.alpha ?? 1;
    x.lineJoin = "round";
    if (fill) { x.fillStyle = fill; x.fillRect(-w / 2, -h / 2, w, h); }
    x.strokeStyle = color; x.lineWidth = lw;
    const fy = lerp(h * 0.08, -h * 0.95, E.io(open));
    if (open > 0.3) {
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

  function stamp(x, str, cx, cy, o = {}) {
    const { k = 1, px = 88, rot = -0.08, color = css("signal"), sub } = o;
    if (k <= 0) return;
    const subPx = o.subPx ?? px * 0.3;
    const s = lerp(2.4, 1, E.outExpo(clamp(k * 1.25)));
    const a = clamp(k * 3);
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.scale(s, s);
    x.globalAlpha = a * (o.alpha ?? 1);
    x.font = FONT.cjk(subPx, 600);
    const sw = sub ? x.measureText(sub).width : 0;
    x.font = FONT.mono(px, 700);
    const tw = x.measureText(str).width;
    const padX = px * 0.42, padY = px * 0.3;
    const bw = Math.max(tw, sw) + padX * 2, bh = px * 1.05 + (sub ? 1.5 * subPx : 0) + padY * 2;
    x.strokeStyle = color; x.fillStyle = color;
    x.lineWidth = px * 0.075;
    roundRect(x, -bw / 2, -bh / 2, bw, bh, px * 0.12); x.stroke();
    x.lineWidth = px * 0.03;
    roundRect(x, -bw / 2 + px * 0.13, -bh / 2 + px * 0.13, bw - px * 0.26, bh - px * 0.26, px * 0.07); x.stroke();
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(str, 0, sub ? -subPx * (2 / 3) : px * 0.04);
    if (sub) { x.font = FONT.cjk(subPx, 600); x.fillText(sub, 0, px * 0.4 + subPx * 0.5); }
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
    x.translate(bx, by);
    x.scale(s, s);
    if (tail === "right") x.translate(-bw, 0);
    x.globalAlpha = clamp(k * 4) * (o.alpha ?? 1);
    x.fillStyle = bg; x.strokeStyle = color; x.lineWidth = 3;
    x.beginPath();
    x.rect(0, -bh, bw, bh);
    x.fill(); x.stroke();
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

  const PLATE = {
    paper: `
uniform float uGridA;
uniform vec4 uPlate;
void main(){
  vec2 w = worldPos();
  vec3 col = C_PAPER;
  float n = fbm(w * 0.011);
  float fib = vnoise(w * vec2(0.55, 0.045));
  col *= 0.968 + 0.046 * n + 0.014 * fib;
  float speck = hash12(floor(w * 0.8));
  col = mix(col, C_PINK, speck > 0.9988 ? 0.22 : 0.0);
  float inside = step(uPlate.x, w.x) * step(w.x, uPlate.z) * step(uPlate.y, w.y) * step(w.y, uPlate.w);
  vec2 gm = abs(fract(w / 40.0 + 0.5) - 0.5) * 40.0;
  vec2 gM = abs(fract(w / 200.0 + 0.5) - 0.5) * 200.0;
  float z = uCam.z;
  float minor = pxLine(min(gm.x, gm.y) * z, 1.0) * 0.045 * sat(z * 1.4 - 0.2);
  float major = pxLine(min(gM.x, gM.y) * z, 1.2) * 0.085;
  col = mix(col, C_PINK, (minor + major) * uGridA * inside);
  fragColor = vec4(col, 1.0);
}`,
    ink: `
uniform float uGridA;
uniform vec4 uPlate;
void main(){
  vec2 w = worldPos();
  vec3 col = C_INK;
  float n = fbm(w * 0.004);
  float fib = vnoise(w * vec2(0.35, 0.03));
  col *= 0.88 + 0.22 * n + 0.05 * fib;
  float speck = hash12(floor(w * 0.7));
  col = mix(col, C_BONE, speck > 0.9994 ? 0.08 : 0.0);
  float inside = step(uPlate.x, w.x) * step(w.x, uPlate.z) * step(uPlate.y, w.y) * step(w.y, uPlate.w);
  vec2 gm = abs(fract(w / 40.0 + 0.5) - 0.5) * 40.0;
  vec2 gM = abs(fract(w / 200.0 + 0.5) - 0.5) * 200.0;
  float z = uCam.z;
  float minor = pxLine(min(gm.x, gm.y) * z, 1.0) * 0.022 * sat(z * 1.4 - 0.2);
  float major = pxLine(min(gM.x, gM.y) * z, 1.2) * 0.045;
  col = mix(col, C_BONE, (minor + major) * uGridA * inside);
  fragColor = vec4(col, 1.0);
}`,
  };

  function glyph(x, kind, cx, cy, color, s = 1) {
    x.save(); x.strokeStyle = color; x.lineWidth = 2.2;
    if (s !== 1) { x.translate(cx, cy); x.scale(s, s); x.translate(-cx, -cy); }
    if (kind === "cred") {
      x.strokeRect(cx - 60, cy - 30, 120, 60); line(x, cx - 22, cy - 2, cx + 22, cy - 2, 3, color);
      x.beginPath(); x.arc(cx, cy + 14, 7, 0, Math.PI * 2); x.stroke();
    } else if (kind === "d1") {
      for (let j = 0; j < 4; j++) { const w = 130 - j * 26, y = cy - 30 + j * 20; line(x, cx - w / 2, y, cx + w / 2, y, 2.2 - j * 0.4, color, 1 - j * 0.18); }
      line(x, cx - 65, cy - 30, cx - 26, cy + 30, 1.2, color, 0.5); line(x, cx + 65, cy - 30, cx + 26, cy + 30, 1.2, color, 0.5);
    } else if (kind === "lag") {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { x.strokeRect(cx - 64 + c * 32, cy - 36 + r * 24, 28, 20); }
    } else {
      x.beginPath(); x.moveTo(cx - 50, cy + 30); x.lineTo(cx - 50, cy - 10); x.lineTo(cx, cy - 44); x.lineTo(cx + 50, cy - 10); x.lineTo(cx + 50, cy + 30); x.closePath(); x.stroke();
    }
    x.restore();
  }

  function sheet(x, px, py, w, h, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.translate(px, py); x.rotate(o.rot || 0);
    x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = o.shadow ?? 28; x.shadowOffsetY = (o.shadow ?? 28) * 0.35;
    x.fillStyle = css("paper"); x.fillRect(0, 0, w, h);
    x.shadowColor = "transparent";
    x.strokeStyle = css("pink"); x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
    x.restore();
  }

  function checkbox(x, bx, by, k, o = {}) {
    const { size = 36, color = css("pink"), tick = css("signal"), alpha = 1 } = o;
    rect(x, bx, by, size, size, 2, color, alpha);
    const s = size / 40;
    polyline(x, [[bx + 7 * s, by + 20 * s], [bx + 17 * s, by + 31 * s], [bx + 36 * s, by + 5 * s]], k, 5 * s, tick, alpha);
  }

  function leader(x, ax, ay, str, dx, dy, o = {}) {
    const a = o.alpha ?? 1;
    if (a <= 0) return;
    const col = o.color || css("bone");
    const f = o.font || FONT.cjk(30, 600);
    const w = measure(x, str, f);
    const px = parseFloat(/([\d.]+)px/.exec(f)[1]);
    const right = dx < 0;
    const tx = ax + dx, ty = ay + dy;
    x.save(); x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.arc(ax, ay, o.dot ?? 5, 0, Math.PI * 2); x.fill(); x.restore();
    line(x, ax, ay, tx, ty, 1.4, col, 0.85 * a);
    line(x, tx, ty, tx + (right ? -w - 24 : w + 24), ty, 1.6, col, a);
    text(x, str, right ? tx - 12 : tx + 12, ty - px * 0.32, { font: f, color: col, align: right ? "right" : "left", alpha: a });
    return w;
  }

  function pathAt(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= L) { const k = L > 0 ? d / L : 0; return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]; }
      d -= L;
    }
    return pts[pts.length - 1].slice();
  }
  const pathLen = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const trailOn = (pts, d, len = 240, n = 14) => { const out = []; for (let i = n; i >= 1; i--) out.push(pathAt(pts, Math.max(0, d - (len * i) / n))); return out; };

  function camera(CAM, b, BAR) {
    const c = keys(b, CAM), c0 = keys(b - 1 / 60 / BAR, CAM);
    return {
      cam: { x: c[0], y: c[1], zoom: c[2], rot: c[3] || 0 },
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]],
      zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
    };
  }

  window.K = { clamp, lerp, E, prog, keys, mulberry32, hash, FONT, text, narration, measure, line, polyline, rect, fillRect, dashed, envelope, stamp, roundRect, clawd, bubble, spark, PLATE, glyph, sheet, checkbox, leader, pathAt, pathLen, trailOn, camera };
})();
