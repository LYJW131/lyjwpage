// 引擎：画面完全由时间 t（秒）决定。场景、Clawd、旁白、顶栏、转场、镜头、粒子都在这里调度，
// 具体章节内容在 scenes-*.js 里登记。导出视频时逐帧调用 window.__seek(t)。
(() => {
  const { BEAT, BAR } = window.Music;
  const stage = document.getElementById("stage");
  const NS = "http://www.w3.org/2000/svg";

  // ---------- 工具 ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    lin: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
    io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    sine: (x) => 0.5 - Math.cos(Math.PI * x) / 2,
    // 落地回弹：盖章、落卡用
    bounce: (x) => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; },
  };
  const inout = (t, a, b, fi = 0.3, fo = 0.3) => Math.min(seg(t, a, a + fi), 1 - seg(t, b - fo, b));
  function mk(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  }
  const L = (cls, parent, html) => mk("div", "L " + (cls || ""), parent, html);
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const icon = (n, s = 28, w = 2) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function place(e, x, y, o = 1, extra = "") {
    e.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)${extra ? " " + extra : ""}`;
    show(e, o);
  }
  function show(e, o) {
    const v = o <= 0.001 ? "hidden" : "visible";
    e.style.opacity = o >= 0.999 ? "1" : o.toFixed(3);
    if (e.style.visibility !== v) e.style.visibility = v;
  }
  const setHTML = (e, h) => { if (e.__h !== h) { e.innerHTML = h; e.__h = h; } };
  const setText = (e, h) => { if (e.__t !== h) { e.textContent = h; e.__t = h; } };
  // 可复现的随机数（粒子、转场格子都用它）
  function rng(seed) {
    let s = seed | 0;
    return () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }

  // 关键帧：frames = [[t, {x,y,o,s,r}, ease?], ...]，t 为场景内时间；返回 (lt) => 应用
  function keys(el, frames, { origin } = {}) {
    if (origin) el.style.transformOrigin = origin;
    const fs = frames.map(([t, p, ez]) => ({ t, p, ez: E[ez || "io"] }));
    const cur = { x: 0, y: 0, o: 1, s: 1, r: 0, sx: 1, sy: 1 };
    for (const f of fs) Object.assign(cur, f.p), (f.full = { ...cur });
    return (lt) => {
      let st;
      if (lt <= fs[0].t) st = fs[0].full;
      else if (lt >= fs[fs.length - 1].t) st = fs[fs.length - 1].full;
      else {
        let i = 0;
        while (lt > fs[i + 1].t) i++;
        const a = fs[i].full, b = fs[i + 1].full, k = fs[i + 1].ez(seg(lt, fs[i].t, fs[i + 1].t));
        st = {};
        for (const key in a) st[key] = lerp(a[key], b[key], k);
      }
      const sc = st.s;
      const extra = `scale(${(sc * st.sx).toFixed(4)}, ${(sc * st.sy).toFixed(4)})${st.r ? ` rotate(${st.r.toFixed(2)}deg)` : ""}`;
      place(el, st.x, st.y, st.o, extra);
      return st;
    };
  }
  // 常用：在 t0 弹出（缩放 + 淡入），在 t1 淡出
  function pop(el, x, y, t0, t1 = 1e9, { d = 0.35, from = 0.85, dy = 0, origin = "50% 50%" } = {}) {
    el.style.transformOrigin = origin;
    return (lt) => {
      const k = seg(lt, t0, t0 + d), q = seg(lt, t1, t1 + 0.3);
      const s = lerp(from, 1, E.back(k));
      place(el, x, y + dy * (1 - E.out(k)) - 10 * q, Math.min(k, 1 - q), `scale(${s.toFixed(4)})`);
    };
  }

  // ---------- 图层 ----------
  // world 里的东西跟着镜头推拉、震动（纸面点阵、场景、粒子）；转场、顶栏、Clawd、旁白固定在屏幕上
  const world = L("", stage); world.style.cssText += ";width:1920px;height:1080px;transform-origin:0 0";
  const bg = L("", world); bg.id = "dots";
  const sceneLayer = L("", world); sceneLayer.style.width = "1920px"; sceneLayer.style.height = "1080px";
  const fx = mk("canvas", "L", world); fx.width = 1920; fx.height = 1080;
  const fctx = fx.getContext("2d");
  const wipe = mk("canvas", "L", stage); wipe.width = 1920; wipe.height = 1080;
  const wctx = wipe.getContext("2d");
  const hud = L("", stage);
  const titleLayer = L("", stage);
  const crabLayer = L("", stage);
  const emoteLayer = L("", stage);
  const bubbleLayer = L("", stage);
  const fadeLayer = L("", stage); fadeLayer.style.cssText += ";width:1920px;height:1080px;background:var(--paper)";

  // ---------- 章节与场景 ----------
  const CHAPTERS = [];   // {n, name, sub, bar, bars, t0, t1}
  const SCENES = [];     // {chapter, t0, t1, root, render(lt, t)}
  const BUBBLES = [];    // {a, b, text, place, toks, ...}
  const CRAB = { path: [], acts: [], looks: [], hide: [], holds: [] };

  function chapter(name, sub, bars) {
    const prev = CHAPTERS[CHAPTERS.length - 1];
    const bar = prev ? prev.bar + prev.bars : 0;
    const c = { n: CHAPTERS.length, name, sub, bar, bars, t0: bar * BAR, t1: (bar + bars) * BAR };
    CHAPTERS.push(c);
    return c;
  }
  // 场景：a/b 为章节内时间（秒），build(root) 返回 render(lt)
  function scene(ch, a, b, build) {
    const root = L("", sceneLayer);
    root.style.width = "1920px"; root.style.height = "1080px";
    const s = { chapter: ch, t0: ch.t0 + a, t1: ch.t0 + b, root };
    s.render = build(root, s) || (() => {});
    SCENES.push(s);
    return s;
  }
  // 旁白：章节内时间 a..b
  function say(ch, a, b, text, placeHow = "right") {
    BUBBLES.push({ a: ch.t0 + a, b: ch.t0 + b, text, place: placeHow });
  }
  // Clawd 轨迹：章节内时间 t 时站在 (x=脚底中点, y=地面)
  function at(ch, t, x, y, how, extra = {}) { CRAB.path.push({ t: ch.t0 + t, x, y, how, ...extra }); }
  function act(ch, t, seq) { CRAB.acts.push({ t: ch.t0 + t, seq }); }
  // 保持某一帧（例如蹲着睡觉 {pose:"default", offset:1}）；走动时不生效
  function hold(ch, a, b, frame) { CRAB.holds.push({ t0: ch.t0 + a, t1: ch.t0 + b, frame }); }
  // 音效：章节内时间 t 处放一个音效（类型见 music.js 的 buildSfx）
  const CUES = [];
  function sfx(ch, t, type, opts = {}) { CUES.push({ t: ch.t0 + t, type, ...opts }); }
  // 配乐让位：在 t 之前 pre 秒把配乐压到 depth，t 时（加 hold）回来——「重音前一拍收住」
  const DUCKS = [];
  function duck(ch, t, o = {}) { DUCKS.push({ t: ch.t0 + t, pre: 0.45, depth: 0.2, post: 0.08, hold: 0, ...o }); }
  function look(ch, t, dir) { CRAB.looks.push({ t: ch.t0 + t, dir }); }
  // 片尾圆形收场（卡通式）：a..b 之间收成一个圆框住 (x, y)，停一下，再合上
  let IRIS = null;
  function iris(ch, a, b, x, y, { hold = 190, holdAt = 0.5, holdTo = 0.82 } = {}) { IRIS = { t0: ch.t0 + a, t1: ch.t0 + b, x, y, hold, holdAt, holdTo }; }
  function hideCrab(ch, a, b) { CRAB.hide.push([ch.t0 + a, ch.t0 + b]); }

  // ---------- 镜头：推近、平移、震动（只作用于 world） ----------
  // camera(ch, a, b, {x, y, s})：a..b 之间把画面上 (x, y) 这一点移到屏幕中心并放大到 s；传 null 回到全景
  const CAM = [], SHAKES = [];
  const HOME = { x: 960, y: 540, s: 1 };
  function camera(ch, a, b, to, ease = "io") { CAM.push({ ch: ch.n, t0: ch.t0 + a, t1: ch.t0 + b, to: to || HOME, ease }); }
  function shake(ch, t, amp = 10, dur = 0.35) { SHAKES.push({ t: ch.t0 + t, amp, dur }); }
  function camAt(t) {
    const c = CHAPTERS.find((x) => t >= x.t0 && t < x.t1);
    let st = HOME;
    if (c) for (const k of CAM) {
      if (k.ch !== c.n || t < k.t0) continue;
      if (t >= k.t1) { st = k.to; continue; }
      const e = E[k.ease](seg(t, k.t0, k.t1));
      st = { x: lerp(st.x, k.to.x, e), y: lerp(st.y, k.to.y, e), s: lerp(st.s, k.to.s, e) };
    }
    let dx = 0, dy = 0;
    for (const s of SHAKES) {
      const u = t - s.t;
      if (u < 0 || u > s.dur) continue;
      const d = s.amp * Math.pow(1 - u / s.dur, 2);
      dx += d * Math.sin(u * 90); dy += d * 0.7 * Math.cos(u * 71);
    }
    return { x: st.x, y: st.y, s: st.s, dx, dy };
  }
  // 画面坐标 → 屏幕坐标（给固定在屏幕上的东西对准镜头里的物体用）
  function toScreen(x, y, t) { const c = camAt(t); return [960 + (x - c.x) * c.s + c.dx, 540 + (y - c.y) * c.s + c.dy]; }
  function renderCamera(t) {
    const c = camAt(t);
    const tx = 960 - c.x * c.s + c.dx, ty = 540 - c.y * c.s + c.dy;
    world.style.transform = c.s === 1 && !c.dx && !c.dy && c.x === 960 && c.y === 540 ? "" : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
  }

  // ---------- 粒子：彩纸、落地烟尘、冲击线、闪星、广播波纹（画在 world 的 canvas 上） ----------
  const BURSTS = [];
  const PALETTE = ["#D97757", "#2E9E4F", "#2F6FD6", "#7458D2", "#C98A12", "#C8453A"];
  function burst(ch, t, x, y, kind = "confetti", o = {}) {
    const r = rng(9001 + BURSTS.length * 7919);
    const b = { t: ch.t0 + t, x, y, kind, ps: [], o, chn: ch.n };
    const n = o.n ?? { confetti: 44, dust: 10, spark: 12, stars: 7, rings: 3 }[kind];
    for (let i = 0; i < n; i++) {
      if (kind === "confetti") {
        const ang = -Math.PI / 2 + (r() - 0.5) * (o.spread ?? 2.3), sp = (o.speed ?? 1) * (560 + r() * 640);
        b.ps.push({ vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, w: 10 + r() * 9, h: 6 + r() * 5, rot: r() * 6.28, spin: (r() - 0.5) * 12, flip: 5 + r() * 9, c: PALETTE[i % PALETTE.length], life: 1.4 + r() * 0.8, d: r() * 0.06 });
      } else if (kind === "dust") {
        const side = i % 2 ? 1 : -1, ang = 0.08 + r() * 0.5, sp = (o.speed ?? 1) * (110 + r() * 170);
        b.ps.push({ vx: side * Math.cos(ang) * sp, vy: -Math.sin(ang) * sp * 0.55, s: 7 + r() * 8, life: 0.38 + r() * 0.3, d: r() * 0.04 });
      } else if (kind === "spark") {
        b.ps.push({ a: (i / n) * 6.283 + (r() - 0.5) * 0.3, r0: (o.r ?? 48) + r() * 12, len: (o.len ?? 1) * (24 + r() * 24), life: 0.32 + r() * 0.1, d: 0 });
      } else if (kind === "stars") {
        const ang = r() * 6.283, rad = 26 + r() * (o.r ?? 90);
        b.ps.push({ dx: Math.cos(ang) * rad, dy: Math.sin(ang) * rad * 0.8, s: 9 + r() * 10, life: 0.55 + r() * 0.3, d: r() * 0.3, c: i % 3 === 0 ? "#D97757" : "#C98A12" });
      } else if (kind === "rings") {
        b.ps.push({ d: i * 0.2, life: 0.85, r1: o.r ?? 150 });
      }
    }
    b.life = Math.max(...b.ps.map((p) => p.d + p.life));
    BURSTS.push(b);
  }
  function star4(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.28, y - s * 0.28); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.28, y + s * 0.28);
    ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.28, y + s * 0.28); ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.28, y - s * 0.28);
    ctx.closePath(); ctx.fill();
  }
  let fxDirty = false;
  function renderFx(t) {
    // 粒子只活在自己那一章：到了章节交界直接截断（那一刻转场格子正好全盖住）
    const cur = (CHAPTERS.find((c) => t >= c.t0 && t < c.t1) || CHAPTERS[CHAPTERS.length - 1]).n;
    const live = BURSTS.filter((b) => b.chn === cur && t >= b.t && t <= b.t + b.life);
    if (!live.length) { if (fxDirty) { fctx.clearRect(0, 0, 1920, 1080); fxDirty = false; } return; }
    fctx.clearRect(0, 0, 1920, 1080); fxDirty = true;
    for (const b of live) {
      const u0 = t - b.t;
      for (const p of b.ps) {
        const u = u0 - p.d;
        if (u < 0 || u > p.life) continue;
        const k = u / p.life;
        fctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        if (b.kind === "confetti") {
          const dr = 1 - 0.28 * u;
          const x = b.x + p.vx * u * dr, y = b.y + p.vy * u * dr + 0.5 * 1650 * u * u;
          fctx.save(); fctx.translate(x, y); fctx.rotate(p.rot + p.spin * u); fctx.scale(1, Math.cos(p.flip * u));
          fctx.fillStyle = p.c; fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); fctx.restore();
        } else if (b.kind === "dust") {
          const x = b.x + p.vx * u * (1 - k * 0.5), y = b.y + p.vy * u - 12 * k;
          const s = p.s * (1 + 0.6 * k);
          fctx.globalAlpha *= 0.85; fctx.fillStyle = b.o.color || "#B3AC9F"; fctx.fillRect(x - s / 2, y - s / 2, s, s);
        } else if (b.kind === "spark") {
          const r = p.r0 + (b.o.reach ?? 60) * E.out(k), l = p.len * (1 - k);
          fctx.strokeStyle = b.o.color || "#1F1E1B"; fctx.lineWidth = 5; fctx.lineCap = "square";
          fctx.beginPath(); fctx.moveTo(b.x + Math.cos(p.a) * r, b.y + Math.sin(p.a) * r); fctx.lineTo(b.x + Math.cos(p.a) * (r + l), b.y + Math.sin(p.a) * (r + l)); fctx.stroke();
        } else if (b.kind === "stars") {
          fctx.fillStyle = p.c; star4(fctx, b.x + p.dx, b.y + p.dy - 10 * k, p.s * Math.sin(Math.PI * k));
        } else if (b.kind === "rings") {
          fctx.strokeStyle = b.o.color || "#2E9E4F"; fctx.lineWidth = 2 + 5 * (1 - k); fctx.globalAlpha = 0.7 * (1 - k);
          fctx.beginPath(); fctx.arc(b.x, b.y, 18 + (p.r1 - 18) * E.out(k), 0, 6.283); fctx.stroke();
        }
      }
    }
    fctx.globalAlpha = 1;
  }

  // ---------- 顶栏 ----------
  const hdrLogo = L("hdr-logo", hud, "lyjw.me");
  const hdrSub = L("hdr-sub", hud, "运行原理");
  const prog = L("prog", hud);
  let psegs = [];
  function buildProgress() {
    // 每段长度按这一章的实际时长分配
    const n = CHAPTERS.length, gap = 10, total = CHAPTERS[n - 1].t1 - CHAPTERS[0].t0, avail = 1446 - gap * (n - 1);
    let x = 0;
    psegs = CHAPTERS.map((c) => {
      const w = (avail * (c.t1 - c.t0)) / total;
      const lab = mk("div", "plab", prog, `<span class="mono">${String(c.n).padStart(2, "0")}</span> ${c.name}`);
      lab.style.left = x + "px";
      const s = mk("div", "pseg", prog);
      s.style.left = x + "px"; s.style.width = w + "px";
      x += w + gap;
      return { lab, s, fill: mk("i", "", s) };
    });
  }
  function renderHud(t) {
    const c = CHAPTERS.find((x) => t >= x.t0 && t < x.t1) || CHAPTERS[CHAPTERS.length - 1];
    const hf = window.HUD_FROM || 0;
    const a = E.out(seg(t, hf, hf + 0.6));
    if (!hdrLogo.__w) hdrLogo.__w = hdrLogo.offsetWidth;
    place(hdrLogo, 64, 38, t >= hf ? 1 : 0); place(hdrSub, 64 + hdrLogo.__w + 16 + 12 * (1 - a), 45, a); show(prog, a);
    psegs.forEach((p, i) => {
      const ch = CHAPTERS[i];
      const f = seg(t, ch.t0, ch.t1);
      const active = ch === c;
      p.fill.style.width = (f * 100).toFixed(2) + "%";
      p.fill.style.background = active && f < 1 ? "var(--orange)" : "var(--ink)";
      p.lab.style.color = active ? "var(--ink)" : f >= 1 ? "var(--muted)" : "var(--faint)";
      p.lab.style.fontWeight = active ? "600" : "400";
    });
  }

  // ---------- 章节标题卡 ----------
  const ttl = L("ch-title", titleLayer);
  const ttlNum = mk("div", "ch-num", ttl), ttlName = mk("div", "ch-name", ttl), ttlSub = mk("div", "ch-sub", ttl);
  function renderTitle(t) {
    const c = CHAPTERS.find((x) => x.n > 0 && t >= x.t0 - 0.1 && t < x.t0 + 2.6);
    if (!c) { show(ttl, 0); return; }
    const lt = t - c.t0;
    setText(ttlNum, String(c.n).padStart(2, "0"));
    setText(ttlName, c.name);
    setText(ttlSub, c.sub || "");
    const a = E.out(seg(lt, 0.25, 0.75)), z = E.in(seg(lt, 2.0, 2.45));
    place(ttl, 0, 380 + 30 * (1 - a) - 60 * z, a * (1 - z));
  }

  // ---------- 像素转场（章节交界） ----------
  const CELL = 60, WC = 32, WR = 18;
  const rnd = rng(20260924);
  const cells = [];
  for (let r = 0; r < WR; r++) for (let c = 0; c < WC; c++) cells.push({ c, r, k: 0.7 * rnd() + 0.3 * (c / WC) });
  const WIPE_HALF = 0.42;
  function renderWipe(t) {
    wctx.clearRect(0, 0, 1920, 1080);
    const c = CHAPTERS.find((x) => x.n > 0 && Math.abs(t - x.t0) < WIPE_HALF);
    if (!c) { show(wipe, 0); return; }
    show(wipe, 1);
    wctx.fillStyle = "#1F1E1B";
    const d = t - c.t0;
    for (const cell of cells) {
      // 盖上：k 越小越早盖；揭开：k 越小越早揭
      const covered = d < 0 ? (d + WIPE_HALF) / WIPE_HALF > cell.k : d / WIPE_HALF < cell.k;
      if (covered) wctx.fillRect(cell.c * CELL, cell.r * CELL, CELL, CELL);
    }
  }

  // ---------- Clawd ----------
  const QW = 16, QH = 32;
  const clawd = Clawd.create(QW, QH);
  const crabWrap = L("", crabLayer);
  crabWrap.appendChild(clawd.el);
  const BOX_CX = 9 * QW, BOX_GY = 5 * QH; // 脚底中点相对盒子左上角
  const HOP = 0.36; // 一跳：蹲 0.08s → 腾空 0.2s → 落地 0.08s
  function crabPos(t) {
    const P = CRAB.path;
    if (!P.length || t < P[0].t) return { x: -400, y: 900, moving: false, dir: 0 };
    for (let i = 0; i < P.length - 1; i++) {
      const p = P[i], q = P[i + 1];
      if (t >= p.t && t < q.t) {
        if (p.x === q.x && p.y === q.y) return { x: p.x, y: p.y, moving: false, dir: 0, sc: q.sc || p.sc || 1 };
        const dur = q.t - p.t;
        const sc = lerp(p.sc || 1, q.sc || 1, E.io(seg(t, p.t, q.t)));
        if (q.how === "leap") {
          const k = seg(t, p.t, q.t);
          const h = q.h ?? 220;
          return { x: lerp(p.x, q.x, E.io(k)), y: lerp(p.y, q.y, k) - h * Math.sin(Math.PI * k), moving: true, dir: Math.sign(q.x - p.x), frame: { pose: "arms-up", offset: 0 }, sc };
        }
        if (q.how === "glide") {
          const k = E.io(seg(t, p.t, q.t));
          return { x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), moving: true, dir: Math.sign(q.x - p.x), glide: true, frame: q.frame, sc };
        }
        // 蹦跳前进：按官方 skip 的节奏，一跳一段
        const n = Math.max(1, Math.round(dur / HOP));
        const hl = dur / n;
        const i2 = Math.min(n - 1, Math.floor((t - p.t) / hl));
        const ph = (t - p.t - i2 * hl) / hl; // 0..1
        const k0 = i2 / n, k1 = (i2 + 1) / n;
        let k, lift = 0, frame;
        if (ph < 0.22) { k = k0; frame = { pose: "default", offset: 1 }; }
        else if (ph < 0.78) {
          const u = (ph - 0.22) / 0.56; k = lerp(k0, k1, E.sine(u)); lift = Math.sin(Math.PI * u) * 34;
          frame = { pose: "arms-up", offset: 0 };
        } else { k = k1; frame = { pose: "default", offset: 0 }; }
        return { x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) - lift, moving: true, dir: Math.sign(q.x - p.x), frame, sc };
      }
    }
    const l = P[P.length - 1];
    return { x: l.x, y: l.y, moving: false, dir: 0, sc: l.sc || 1 };
  }
  function crabFrame(t, pos) {
    // 官方动作序列优先
    for (let i = CRAB.acts.length - 1; i >= 0; i--) {
      const a = CRAB.acts[i];
      const seq = Clawd.SEQ[a.seq];
      const idx = Math.floor((t - a.t) / (Clawd.FRAME_MS / 1000));
      if (idx >= 0 && idx < seq.length) return seq[idx];
    }
    if (pos.moving && pos.frame) return pos.frame;
    if (!pos.moving) for (const h of CRAB.holds) if (t >= h.t0 && t < h.t1) return h.frame;
    let dir = 0;
    for (const l of CRAB.looks) if (t >= l.t) dir = l.dir;
    if (pos.moving) dir = pos.dir;
    const pose = dir < 0 ? "look-left" : dir > 0 ? "look-right" : "default";
    return { pose, offset: 0 };
  }
  function renderCrab(t) {
    const hidden = CRAB.hide.some(([a, b]) => t >= a && t < b);
    const pos = crabPos(t);
    const f = crabFrame(t, pos);
    clawd.update({ pose: f.pose, offset: f.offset, poof: f.poof || null });
    const sc = pos.sc || 1;
    const x = pos.x - BOX_CX * sc + (f.x || 0) * 2 * QW * sc, y = pos.y - BOX_GY * sc;
    place(crabWrap, Math.round(x), Math.round(y), hidden ? 0 : 1, sc !== 1 ? `scale(${sc.toFixed(4)})` : "");
    return { pos, hidden };
  }

  // ---------- 表情：Clawd 头顶的像素小符号（同一套方块像素） ----------
  // emote(ch, t, kind, dur)：kind = ! ? heart note drop spark z ok no dots
  const SPR = {
    "!": ["#1F1E1B", [".##.", "####", "####", "####", ".##.", ".##.", "....", ".##.", ".##."]],
    "?": ["#1F1E1B", [".####.", "##..##", "....##", "...##.", "..##..", "..##..", "......", "..##..", "..##.."]],
    heart: ["#C8453A", [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]],
    note: ["#1F1E1B", ["..#####", "..#...#", "..#...#", "..#...#", "###.###", "###.###"]],
    drop: ["#2F6FD6", ["..#..", ".###.", "#####", "#####", ".###."]],
    spark: ["#C98A12", ["...#...", "...#...", "..###..", "#######", "..###..", "...#...", "...#..."]],
    z: ["#1F1E1B", ["#####", "...#.", "..#..", ".#...", "#####"]],
    ok: ["#2E9E4F", ["......##", ".....##.", "##..##..", ".####...", "..##...."]],
    no: ["#C8453A", ["##...##", ".##.##.", "..###..", ".##.##.", "##...##"]],
    dot: ["#1F1E1B", ["##", "##"]],
  };
  const PX = 7;
  function sprite(kind, parent) {
    const [c, rows] = SPR[kind];
    const w = rows[0].length * PX, h = rows.length * PX;
    const s = svgEl("svg", { width: w, height: h, "shape-rendering": "crispEdges", class: "L" }, parent);
    let d = "";
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "#") d += `M${x * PX} ${y * PX}h${PX}v${PX}h-${PX}z`; }));
    svgEl("path", { d, fill: c }, s);
    s.__w = w; s.__h = h;
    s.style.transformOrigin = "50% 100%";
    return s;
  }
  const EMOTES = [];
  // 多粒子的表情：同一符号按间隔连续冒出来
  const MULTI = { z: { every: 0.55, life: 1.5 }, note: { every: 0.5, life: 1.3 }, heart: { every: 0.22, life: 1.1, max: 3 } };
  function emote(ch, t, kind, dur = 1.4, o = {}) {
    const m = MULTI[kind];
    const n = m ? Math.min(m.max || 99, Math.max(1, Math.floor(dur / m.every))) : kind === "dots" ? 3 : 1;
    const el = L("emote", emoteLayer);
    const parts = Array.from({ length: n }, () => sprite(kind === "dots" ? "dot" : kind, el));
    EMOTES.push({ t: ch.t0 + t, kind, dur, el, parts, ...o });
  }
  function renderEmotes(t, crab) {
    for (const e of EMOTES) {
      const u = t - e.t, m = MULTI[e.kind];
      const end = m ? (e.parts.length - 1) * m.every + m.life : e.dur;
      if (u < 0 || u > end || crab.hidden) { show(e.el, 0); continue; }
      show(e.el, 1);
      const p = crab.pos, sc = p.sc || 1;
      const hx = p.x + (e.dx ?? 0), hy = p.y - 172 * sc + (e.dy ?? 0); // 头顶上方
      e.parts.forEach((s, i) => {
        let x, y, o = 1, k = 1, r = 0;
        if (m) {
          const v = u - i * m.every, q = v / m.life;
          if (v < 0 || q > 1) { show(s, 0); return; }
          o = Math.min(1, v / 0.15, (1 - q) / 0.35);
          if (e.kind === "z") { x = hx + 70 + 46 * q + i * 4; y = hy + 10 - 90 * q; k = 0.55 + 0.6 * q; }
          else if (e.kind === "note") { const side = i % 2 ? 1 : -1; x = hx + side * (70 + 20 * q) + 14 * Math.sin(q * 7); y = hy - 80 * q; k = 0.8 + 0.2 * q; r = side * 10 * Math.sin(q * 6); }
          else { x = hx + (i - 1) * 46; y = hy - 20 - 60 * q; k = E.back(Math.min(1, v / 0.25)); }
        } else if (e.kind === "dots") {
          const on = u > 0.12 + i * 0.22;
          x = hx + 46 + i * 22; y = hy - 6; o = on ? Math.min(1, (e.dur - u) / 0.25) : 0;
        } else {
          const kin = Math.min(1, u / 0.2);
          k = E.back(kin); o = Math.min(1, u / 0.08, (e.dur - u) / 0.25);
          x = hx + (e.kind === "drop" ? -100 : 64); y = hy - (e.kind === "!" ? 18 * Math.sin(Math.PI * Math.min(1, u / 0.26)) : 0) + (e.kind === "drop" ? 40 + 18 * seg(u, 0.2, e.dur) : 0);
        }
        s.style.visibility = "visible";
        s.style.opacity = o.toFixed(3);
        s.style.transform = `translate(${(x - s.__w / 2).toFixed(1)}px, ${(y - s.__h).toFixed(1)}px) scale(${(k * sc).toFixed(3)})${r ? ` rotate(${r.toFixed(1)}deg)` : ""}`;
      });
    }
  }

  // ---------- 旁白气泡 ----------
  const bubble = L("", bubbleLayer); bubble.id = "bubble";
  const bShadow = L("pix", bubble); bShadow.id = "bShadow";
  const bOuter = L("pix", bubble); bOuter.id = "bOuter";
  const bInner = mk("div", "pix", bOuter); bInner.id = "bInner";
  const bMeasure = mk("div", "btext", bInner); bMeasure.id = "bMeasure";
  const bTyped = mk("div", "btext", bInner); bTyped.id = "bTyped";
  const TAILS = {
    dl: ["..IWWWWI", "..IWWWI.", ".IWWWI..", ".IWWI...", "IWWI....", "IWI.....", "II......"],
    dr: ["IWWWWI..", ".IWWWI..", "..IWWWI.", "...IWWI.", "....IWWI", ".....IWI", "......II"],
    d: ["IWWWWWWI", ".IWWWWI.", "..IWWI..", "...II..."],
  };
  const tails = {};
  for (const [k, rows] of Object.entries(TAILS)) {
    const s = svgEl("svg", { width: rows[0].length * 6, height: rows.length * 6, "shape-rendering": "crispEdges", class: "L" }, bubble);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") svgEl("rect", { x: x * 6, y: y * 6, width: 6, height: 6, fill: ch === "I" ? "#1F1E1B" : "#FFFFFF" }, s);
    }));
    tails[k] = s;
  }
  const CPS = 16;
  const WARN = [];
  function prepBubbles() {
    for (const b of BUBBLES) {
      const toks = [];
      let code = false, em = false;
      for (const ch of b.text) {
        if (ch === "{") { code = true; continue; }
        if (ch === "}") { code = false; continue; }
        if (ch === "[") { em = true; continue; }
        if (ch === "]") { em = false; continue; }
        toks.push(ch === "\n" ? { br: true } : { ch, code, em });
      }
      b.toks = toks;
      b.n = toks.filter((x) => !x.br).length;
      b.ts = b.a + 0.18;
      b.te = b.ts + b.n / CPS;
      setHTML(bMeasure, richHTML(toks, b.n, false));
      b.w = bOuter.offsetWidth; b.h = bOuter.offsetHeight;
    }
    BUBBLES.sort((x, y) => x.a - y.a);
    const warn = (...m) => { WARN.push(m.join(" ")); console.warn(...m); };
    BUBBLES.forEach((b, i) => {
      const tag = `气泡@${b.a.toFixed(1)}「${b.text.slice(0, 12)}」`;
      if (b.w > 1500) warn(tag, "过宽", b.w);
      if (b.te + 1.2 > b.b) warn(tag, "打完字后停留不足", (b.b - b.te).toFixed(2));
      const nx = BUBBLES[i + 1];
      if (nx && nx.a < b.b) warn(tag, "与下一句重叠");
      const c = CHAPTERS.find((c) => b.a >= c.t0 && b.a < c.t1);
      if (c && c.n > 0 && b.a - c.t0 < 2.5) warn(tag, "压在章节标题上");
      if (b.place === "above") for (const e of EMOTES) if (e.t < b.b && e.t + e.dur > b.a) warn(tag, "头顶有表情，和 above 气泡打架");
    });
  }
  function richHTML(toks, n, caret) {
    let h = "", mode = "", c = 0;
    const open = (m) => (m === "code" ? '<span class="code">' : m === "em" ? '<span class="em">' : "");
    for (const tk of toks) {
      if (c >= n && !tk.br) break;
      if (tk.br) { if (mode) { h += "</span>"; mode = ""; } if (c < n) h += "<br>"; continue; }
      const m = tk.code ? "code" : tk.em ? "em" : "";
      if (m !== mode) { if (mode) h += "</span>"; h += open(m); mode = m; }
      h += esc(tk.ch); c++;
    }
    if (mode) h += "</span>";
    if (caret) h += '<i class="caret"></i>';
    return h;
  }
  let lastBubble = null;
  function renderBubble(t) {
    const b = BUBBLES.find((x) => t >= x.a && t < x.b);
    if (!b) { show(bubble, 0); return; }
    if (b !== lastBubble) {
      setHTML(bMeasure, richHTML(b.toks, b.n, false));
      bShadow.style.width = b.w + "px"; bShadow.style.height = b.h + "px";
      lastBubble = b;
    }
    const n = Math.floor(clamp((t - b.ts) * CPS, 0, b.n));
    setHTML(bTyped, richHTML(b.toks, n, t < b.te + 0.3));
    const p = crabPos(b.a + 0.01);
    let x, y, tail, ox;
    const how = typeof b.place === "object" ? b.place : { side: b.place };
    if (how.side === "right") { x = p.x + 130; y = p.y - 150 - b.h; tail = "dl"; ox = 20; }
    else if (how.side === "left") { x = p.x - 130 - b.w; y = p.y - 150 - b.h; tail = "dr"; ox = b.w - 20 - 48; }
    else { x = clamp(p.x - b.w * (how.k ?? 0.5), 50, 1870 - b.w); y = p.y - 196 - b.h; tail = "d"; ox = clamp(p.x - x - 24, 26, b.w - 74); }
    if (how.dx) x += how.dx;
    if (how.dy) y += how.dy;
    if (!b.checked) { b.checked = true; if (x < 20 || x + b.w > 1900 || y < 100) WARN.push(`气泡@${b.a.toFixed(1)} 出界 x=${x.toFixed(0)} y=${y.toFixed(0)} w=${b.w}`); }
    for (const [k, s] of Object.entries(tails)) {
      s.style.visibility = k === tail ? "visible" : "hidden";
      if (k === tail) s.style.transform = `translate(${ox}px, ${b.h - 6}px)`;
    }
    place(bShadow, 8, 8, 1);
    place(bOuter, 0, 0, 1);
    const ai = E.back(seg(t, b.a, b.a + 0.22)), ao = seg(t, b.b - 0.2, b.b);
    bubble.style.transformOrigin = `${ox + 24}px ${b.h + 24}px`;
    place(bubble, x, y - 10 * ao, Math.min(seg(t, b.a, b.a + 0.14), 1 - ao), `scale(${(lerp(0.85, 1, ai) * (1 - 0.05 * ao)).toFixed(4)})`);
  }

  // ---------- 每帧 ----------
  let DUR = 0;
  function render(t) {
    place(bg, -((t * 6) % 32), -((t * 3) % 32), seg(t, 0, 0.6));
    for (const s of SCENES) {
      const on = t >= s.t0 && t < s.t1;
      if (on) { show(s.root, 1); s.render(t - s.t0, t); }
      else if (s.root.style.visibility !== "hidden") show(s.root, 0);
    }
    renderCamera(t);
    renderFx(t);
    renderHud(t);
    renderTitle(t);
    renderWipe(t);
    const crab = renderCrab(t);
    renderEmotes(t, crab);
    renderBubble(t);
    if (IRIS && t >= IRIS.t0) {
      const u = seg(t, IRIS.t0, IRIS.t1);
      const R = u < IRIS.holdAt ? lerp(1500, IRIS.hold, E.io(u / IRIS.holdAt)) : u < IRIS.holdTo ? IRIS.hold : lerp(IRIS.hold, 0, E.in(seg(u, IRIS.holdTo, 1)));
      fadeLayer.style.background = "#1F1E1B";
      const m = `radial-gradient(circle at ${IRIS.x}px ${IRIS.y}px, transparent ${R.toFixed(1)}px, #000 ${(R + 1.5).toFixed(1)}px)`;
      fadeLayer.style.webkitMaskImage = m; fadeLayer.style.maskImage = m;
      show(fadeLayer, 1);
    } else {
      if (fadeLayer.style.maskImage) { fadeLayer.style.webkitMaskImage = ""; fadeLayer.style.maskImage = ""; fadeLayer.style.background = "var(--paper)"; }
      show(fadeLayer, window.FADE_AT && !IRIS ? seg(t, window.FADE_AT, DUR) : 0);
    }
  }

  // 从时间轴自动推出来的音效：画面怎么动，声音就怎么落
  function autoCues() {
    const add = (t, type, o = {}) => CUES.push({ t, type, auto: true, ...o });
    const PUNCT = new Set([..."，。、：；！？…—「」（）《》·,.:;!? "]);
    for (const b of BUBBLES) {
      add(b.a + 0.02, "bubble");
      let i = 0;
      for (const tk of b.toks) {
        if (tk.br) continue;
        if (!PUNCT.has(tk.ch) && i % 2 === 0) add(b.ts + i / CPS, "talk", { i });
        i++;
      }
    }
    const P = CRAB.path;
    for (let i = 0; i < P.length - 1; i++) {
      const p = P[i], q = P[i + 1];
      if (p.x === q.x && p.y === q.y) continue;
      if (q.how === "leap") { add(p.t, "leap"); add(q.t, "land"); continue; }
      if (q.how === "glide") continue;
      const dur = q.t - p.t, n = Math.max(1, Math.round(dur / HOP)), hl = dur / n;
      for (let j = 0; j < n; j++) { add(p.t + j * hl + 0.22 * hl, "hop", { n: j }); add(p.t + (j + 0.78) * hl, "step"); }
    }
    const F = Clawd.FRAME_MS / 1000;
    for (const a of CRAB.acts) {
      if (a.seq === "jump" || a.seq === "celebrate") { add(a.t, "poof"); add(a.t + 2 * F, "hop", { n: 0 }); add(a.t + 6 * F, "poof"); add(a.t + 8 * F, "hop", { n: 1 }); }
      if (a.seq === "flinch") add(a.t, "poof");
    }
    for (const e of EMOTES) {
      const m = MULTI[e.kind];
      if (m) e.parts.forEach((_, i) => add(e.t + i * m.every, "emote-" + e.kind, { n: i }));
      else if (e.kind === "dots") [0, 1, 2].forEach((i) => add(e.t + 0.12 + i * 0.22, "tick"));
      else add(e.t, "emote-" + e.kind);
    }
    for (const b of BURSTS) add(b.t, "fx-" + b.kind, { x: b.x });
    for (const c of CHAPTERS) if (c.n > 0) add(c.t0 - WIPE_HALF, "wipe");
    CUES.sort((x, y) => x.t - y.t);
  }

  // ---------- 画面事件 → 音效（只在导出音频时跑一遍） ----------
  // 逐帧渲染整部片子，记下卡片弹出、数据包出发/到站、连线开画、印章落下的时刻和横向位置。
  // 手写的 sfx() 只留语义化的（错误、成功、时钟……），弹出这类跟画面走的交给这里，永远对得上。
  function effOp(el) {
    let o = 1;
    for (let e = el; e && e !== stage; e = e.parentElement) {
      const s = e.style;
      if (!s) continue;
      if (s.visibility === "hidden") return 0;
      if (s.opacity !== "") o *= +s.opacity;
    }
    return o;
  }
  function wireFrac(p) {
    if (p.__dash) return +(p.style.opacity || 0);
    const off = p.getAttribute("stroke-dashoffset");
    return off == null ? 1 : 1 - +off;
  }
  function analyze(fps = 30) {
    const found = [];
    const sel = ".card, .win, .term, .tg, .stag, .pkt, .stampx, .s-card, .mark";
    const kindOf = (el) => el.classList.contains("pkt") ? "pkt" : el.classList.contains("stampx") ? "stamp"
      : el.classList.contains("s-card") ? "tick" : el.classList.contains("tg") || el.classList.contains("stag") ? "tag" : el.classList.contains("mark") ? "mark" : "pop";
    const prev = new Map(), prevW = new Map();
    const N = Math.floor(DUR * fps);
    for (let i = 0; i <= N; i++) {
      const t = i / fps;
      render(t);
      // 每帧重新收集：有些场景在首帧才建元素
      const els = stage.querySelectorAll(sel);
      const wires = stage.querySelectorAll("path.wire");
      const appear = [];
      for (const el of els) {
        const o = effOp(el), p = prev.get(el) ?? 0;
        if (el.classList.contains("stampx")) {
          // 印章的声音落在砸到纸面那一刻（缩放回到 1），不是它刚出现的时候
          const m = /scale\(([\d.]+)/.exec(el.style.transform || ""), sc = m ? +m[1] : 1, ps = el.__psc ?? 9;
          if (o > 0.3 && sc <= 1.03 && ps > 1.03) found.push({ t, type: "stamp", el });
          el.__psc = o > 0.05 ? sc : 9;
          prev.set(el, o);
          continue;
        }
        if (o >= 0.05 && p < 0.05) appear.push(el);
        if (el.classList.contains("pkt") && p >= 0.85 && o < 0.85 && o > 0) found.push({ t, type: "arrive", el });
        prev.set(el, o);
      }
      const aset = new Set(appear);
      for (const el of appear) {
        let nested = false;
        for (let e = el.parentElement; e && e !== stage; e = e.parentElement) if (aset.has(e)) { nested = true; break; }
        if (!nested) found.push({ t, type: kindOf(el), el });
      }
      for (const w of wires) {
        const k = effOp(w) > 0.05 ? wireFrac(w) : 0, p = prevW.get(w) ?? 0;
        if (k > 0.03 && p <= 0.03) found.push({ t, type: "draw", el: w });
        prevW.set(w, k);
      }
    }
    // 横向位置决定声像；同一小段时间里连续弹出的按和弦往上走
    const out = [];
    let lastT = -9, n = 0;
    for (const f of found) {
      if (f.type === "arrive" || f.type === "draw") { render(f.t); }
      else render(f.t);
      const r = f.el.getBoundingClientRect();
      const x = r.width || r.height ? (r.left + r.right) / 2 : 960; // 竖线宽为 0，照样按它的位置定声像
      if (f.type === "pop" || f.type === "tag" || f.type === "tick") { n = f.t - lastT < 0.6 ? n + 1 : 0; lastT = f.t; }
      out.push({ t: Math.max(0, f.t - 0.5 / fps), type: f.type === "pkt" ? "send" : f.type, x, n: f.type === "pop" || f.type === "tag" || f.type === "tick" ? n : 0, auto: "vis" });
    }
    // 同类音效太密就合并（比如一排格子一起亮）
    out.sort((a, b) => a.t - b.t);
    const merged = [];
    for (const c of out) {
      const same = merged.filter((m) => m.type === c.type && c.t - m.t < 0.07);
      if (same.length >= 2) continue;
      merged.push(c);
    }
    return merged;
  }

  window.Engine = {
    E, clamp, seg, lerp, inout, mk, L, svgEl, icon, esc, place, show, setHTML, setText, keys, pop, rng,
    chapter, scene, say, at, act, hold, look, hideCrab, sfx, duck, camera, shake, burst, emote, iris, toScreen, camAt,
    CUES, DUCKS, CHAPTERS, SCENES, BUBBLES, CRAB, EMOTES, BURSTS, QW, QH, BEAT, BAR, stage, world, WARN, crabPos, crabWrap,
    finalize(duration) {
      DUR = duration;
      buildProgress();
      CRAB.path.sort((a, b) => a.t - b.t);
      CRAB.acts.sort((a, b) => a.t - b.t);
      CRAB.looks.sort((a, b) => a.t - b.t);
      CAM.sort((a, b) => a.t0 - b.t0);
      prepBubbles();
      autoCues();
    },
    analyze,
    render,
  };
})();
