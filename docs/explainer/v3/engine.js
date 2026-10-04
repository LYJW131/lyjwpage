(() => {
  const W = 1920, H = 1080;

  function oklch(L, C, h, a = 1) {
    const ar = C * Math.cos((h * Math.PI) / 180), br = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * ar + 0.2158037573 * br) ** 3;
    const m = (L - 0.1055613458 * ar - 0.0638541728 * br) ** 3;
    const s = (L - 0.0894841775 * ar - 1.291485548 * br) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const enc = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };
    const [r, g, b] = lin.map(enc);
    return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  }

  const C = {
    bg: oklch(0.15, 0.008, 85),
    surface: oklch(0.185, 0.008, 85),
    surfaceHover: oklch(0.235, 0.01, 85),
    fg: oklch(0.93, 0.012, 90),
    muted: oklch(0.66, 0.012, 90),
    dim: oklch(0.44, 0.01, 88),
    line: oklch(0.93, 0.012, 90, 0.2),
    lineStrong: oklch(0.93, 0.012, 90, 0.76),
    signal: oklch(0.74, 0.115, 39),
    ember: oklch(0.86, 0.1, 55),
    live: oklch(0.76, 0.16, 148),
    black: "#000",
  };
  const rgba = (css, a) => { const n = css.match(/[\d.]+/g); return `rgba(${n[0]},${n[1]},${n[2]},${a})`; };

  const SANS = '"Geist", "PingFang SC", "Noto Sans SC", sans-serif';
  const MONO = '"Geist Mono", ui-monospace, monospace';
  const CJK = '"PingFang SC", "Noto Sans SC", "WenQuanYi Zen Hei", sans-serif';
  const FONT = {
    sans: (px, w = 500) => `${w} ${px}px ${SANS}`,
    mono: (px, w = 500) => `${w} ${px}px ${MONO}`,
    cjk: (px, w = 500) => `${w} ${px}px ${CJK}`,
  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - (1 - p) ** 3,
    io: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
    outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
    inExpo: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
    outBack: (p) => { const c = 1.4; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; },
    spring: (p) => 1 - Math.exp(-6 * p) * Math.cos(p * 14),
  };
  const prog = (t, a, b, ease = E.io) => ease(clamp01((t - a) / (b - a)));
  const win = (t, a0, a1, b0, b1, ease = E.io) => prog(t, a0, a1, ease) * (1 - prog(t, b0, b1, ease));
  function keys(t, ks) {
    if (t <= ks[0][0]) return ks[0][1].slice();
    for (let i = 1; i < ks.length; i++) {
      if (t < ks[i][0]) {
        const [t0, a] = ks[i - 1], [t1, b, ease = E.io] = ks[i];
        const p = ease(clamp01((t - t0) / (t1 - t0)));
        return a.map((v, j) => lerp(v, b[j], p));
      }
    }
    return ks[ks.length - 1][1].slice();
  }

  const canvas = document.getElementById("hud");
  const hud = canvas.getContext("2d");
  let ctx = hud;
  const G = { W, H, C, FONT, E, prog, win, keys, lerp, clamp01, rgba, canvas, ctx, S: 1, cam: { x: W / 2, y: H / 2, z: 1 } };

  G.use = (c) => { ctx = c || hud; G.ctx = ctx; };
  G.resize = (cw, ch) => { canvas.width = cw; canvas.height = ch; G.S = cw / W; };
  G.begin = () => { G.use(hud); ctx.setTransform(G.S, 0, 0, G.S, 0, 0); ctx.clearRect(0, 0, W, H); };
  G.painter = (w, h, scale = 2) => {
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const cx = c.getContext("2d");
    return {
      canvas: c, w, h,
      paint(fn) { G.use(cx); cx.setTransform(scale, 0, 0, scale, 0, 0); const saved = G.cam; G.cam = { x: w / 2, y: h / 2, z: 1 }; fn(cx); G.cam = saved; G.use(hud); },
    };
  };
  G.world = (fn) => {
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(G.cam.z, G.cam.z); ctx.translate(-G.cam.x, -G.cam.y);
    fn(ctx);
    ctx.restore();
  };
  G.screen = (fn) => { ctx.save(); fn(ctx); ctx.restore(); };
  G.toScreen = (x, y) => [W / 2 + (x - G.cam.x) * G.cam.z, H / 2 + (y - G.cam.y) * G.cam.z];
  G.hair = () => 1 / G.cam.z;

  G.text = (s, x, y, o = {}) => {
    if (!s) return 0;
    ctx.save();
    ctx.font = o.font || FONT.sans(24);
    ctx.fillStyle = o.color || C.fg;
    ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
    ctx.textAlign = o.align || "left";
    ctx.textBaseline = o.baseline || "alphabetic";
    if (o.tracking) ctx.letterSpacing = `${o.tracking}px`;
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  };
  G.measure = (s, font) => { ctx.save(); ctx.font = font; const w = ctx.measureText(s).width; ctx.restore(); return w; };

  G.rect = (x, y, w, h, fill, stroke, lw) => {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || G.hair(); ctx.strokeRect(x, y, w, h); }
  };
  G.line = (x0, y0, x1, y1, color, lw, dash) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw || G.hair();
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  };
  G.poly = (pts, color, lw, dash) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw || G.hair();
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.restore();
  };
  G.dot = (x, y, r, color, alpha = 1) => {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  G.bead = (x, y, r = 7, alpha = 1) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = C.signal; ctx.shadowBlur = r * 5 * G.cam.z;
    ctx.fillStyle = C.signal; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.ember; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  G.ring = (x, y, r, alpha, lw) => {
    if (alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = C.signal; ctx.lineWidth = lw || 2 / G.cam.z;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  };

  G.reveal = (s, x, y, t, t0, o = {}) => {
    const per = o.per == null ? 0.028 : o.per, dur = o.dur == null ? 0.35 : o.dur, rise = o.rise == null ? 10 : o.rise;
    const font = o.font || FONT.cjk(60);
    ctx.save();
    ctx.font = font; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    let cx = x;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], w = ctx.measureText(ch).width;
      const p = clamp01((t - t0 - i * per) / dur);
      if (p > 0) {
        ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * E.out(p);
        ctx.fillStyle = o.color || C.fg;
        ctx.fillText(ch, cx, y + (1 - E.out(p)) * rise);
      }
      cx += w + (o.tracking || 0);
    }
    ctx.restore();
    return cx - x;
  };

  G.vignette = (a = 0.45) => {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  G.scrim = (a) => {
    if (a <= 0) return;
    const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${0.78 * a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  G.fade = (a) => { if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, a)})`; ctx.fillRect(0, 0, W, H); } };

  window.G = G;
  window.CHAPTERS = window.CHAPTERS || [];
})();
