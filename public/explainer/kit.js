// 组件库：卡片、连线、数据包、印章、手绘圈注、代码信封、终端、主页窗口。只负责造 DOM 和按进度摆位，时间编排在 scenes-*.js。
(() => {
  const { E, clamp, seg, lerp, mk, L, svgEl, icon, esc, place, show, setHTML, setText, rng } = Engine;

  // 场景自带的样式（各章可以各自加，不用改 index.html）
  function css(text) { const s = document.createElement("style"); s.textContent = text; document.head.appendChild(s); }

  // ---------- 卡片 ----------
  // opts: x y w h tint icon title sub lines[] tags[] mono
  function card(parent, o) {
    const el = L(`card ${o.tint || ""} ${o.cls || ""}`, parent);
    el.style.width = o.w + "px";
    if (o.h) el.style.height = o.h + "px";
    el.style.padding = o.pad || "16px 20px";
    const head = o.icon
      ? `<div class="hd ${o.mono ? "mono" : ""}"><span class="ic">${icon(o.icon, 30, 2)}</span><span>${o.title}</span></div>`
      : `<div class="hd ${o.mono ? "mono" : ""}">${o.title}</div>`;
    el.innerHTML = head + (o.sub ? `<div class="sd">${o.sub}</div>` : "") +
      (o.lines || []).map((l) => `<div class="ln">${l}</div>`).join("") +
      (o.tags && o.tags.length ? `<div class="tagrow">${o.tags.map((t) => `<span class="tg ${t.c || ""}">${t.t}</span>`).join("")}</div>` : "");
    el.__x = o.x; el.__y = o.y;
    return el;
  }
  // 弹出：t0 出现，t1 消失（场景内时间）。返回当前可见度（0..1），连线用它一起淡出
  function popAt(el, lt, t0, t1 = 1e9, { d = 0.35, from = 0.86, dx = 0, dy = 0, x = el.__x, y = el.__y } = {}) {
    const k = seg(lt, t0, t0 + d), q = seg(lt, t1, t1 + 0.3);
    const s = lerp(from, 1, E.back(k));
    el.style.transformOrigin = "50% 50%";
    place(el, x + dx * (1 - E.out(k)), y + dy * (1 - E.out(k)) - 10 * q, Math.min(k, 1 - q), `scale(${s.toFixed(4)})`);
    return Math.min(k, 1 - q);
  }
  // 卡片「落地」：从上方掉下来，落地压扁再弹回（强调用）
  function dropAt(el, lt, t0, t1 = 1e9, { d = 0.45, h = 60, x = el.__x, y = el.__y } = {}) {
    const k = seg(lt, t0, t0 + d), q = seg(lt, t1, t1 + 0.3);
    const fall = seg(k, 0, 0.55), squash = seg(k, 0.55, 1);
    const sy = fall < 1 ? 1.04 : 1 - 0.1 * Math.sin(Math.PI * squash) * (1 - squash * 0.4);
    const sx = fall < 1 ? 0.97 : 1 + 0.06 * Math.sin(Math.PI * squash) * (1 - squash * 0.4);
    el.style.transformOrigin = "50% 100%";
    place(el, x, y - h * (1 - E.in(fall)) - 10 * q, Math.min(k * 3, 1 - q), `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`);
    return Math.min(k, 1 - q);
  }

  // ---------- 连线 ----------
  function wireLayer(parent) {
    const s = svgEl("svg", { width: 1920, height: 1080, class: "L" });
    s.style.overflow = "visible";
    parent.appendChild(s);
    return s;
  }
  function wire(svg, d, { color = "#1F1E1B", width = 2.5, opacity = 0.42, dash = false } = {}) {
    const p = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": width, "stroke-opacity": opacity, "stroke-linecap": "round", class: "wire" }, svg);
    if (dash) { p.setAttribute("stroke-dasharray", "10 9"); p.__dash = true; }
    else { p.setAttribute("pathLength", "1"); p.setAttribute("stroke-dasharray", "1 1"); p.setAttribute("stroke-dashoffset", "1"); }
    p.__len = null;
    return p;
  }
  // k：画出来的比例；o：整体透明度（传卡片的可见度，线就跟着卡片一起淡出）
  function drawWire(p, k, o = 1) {
    if (p.__dash) { const v = clamp(k) * clamp(o); p.style.opacity = v.toFixed(3); return; }
    p.setAttribute("stroke-dashoffset", (1 - clamp(k)).toFixed(4));
    // 还没开画时圆头线帽会留一个点，直接藏掉
    const v = k <= 0.001 ? 0 : clamp(o);
    p.style.opacity = v >= 0.999 ? "" : v.toFixed(3);
  }
  function along(p, f) {
    if (p.__len == null) p.__len = p.getTotalLength();
    return p.getPointAtLength(clamp(f) * p.__len);
  }
  const ptAt = (p, f) => { const q = along(p, f); return { x: q.x, y: q.y }; };
  function arrow(svg, x, y, dir = "r", color = "#1F1E1B") {
    const d = { r: `M${x - 13} ${y - 9} L${x} ${y} L${x - 13} ${y + 9}`, l: `M${x + 13} ${y - 9} L${x} ${y} L${x + 13} ${y + 9}`,
      d: `M${x - 9} ${y - 13} L${x} ${y} L${x + 9} ${y - 13}`, u: `M${x - 9} ${y + 13} L${x} ${y} L${x + 9} ${y + 13}` }[dir];
    return svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "miter" }, svg);
  }

  // ---------- 数据包 ----------
  // 列表项：{ text, cls, o, s } 加 { x, y }，或 { path, f }（沿线走：自动避开两端卡片，首尾 12% 淡入淡出）
  // trail: true 时身后拖三道速度线
  function packets(parent, n = 24) {
    const tsvg = svgEl("svg", { width: 1920, height: 1080, class: "L" }, parent);
    tsvg.style.overflow = "visible";
    const pool = Array.from({ length: n }, () => L("pkt", parent));
    const lines = pool.map(() => [0, 1, 2].map(() => svgEl("line", { stroke: "#1F1E1B", "stroke-width": 3, "stroke-linecap": "round", "stroke-opacity": 0 }, tsvg)));
    const widths = new Map();
    return (list) => {
      pool.forEach((el, i) => {
        const a = list[i];
        for (const ln of lines[i]) ln.setAttribute("stroke-opacity", "0");
        if (!a) { show(el, 0); return; }
        const cls = "L pkt " + (a.cls || "");
        if (el.className !== cls) el.className = cls;
        setHTML(el, a.text);
        let x = a.x, y = a.y, o = a.o ?? 1, dir = a.dir || null;
        const key = a.text + "|" + cls;
        let w = widths.get(key);
        if (w == null) { w = el.offsetWidth; widths.set(key, w); }
        let room = 1e9; // 速度线最多能拖多长：不能拖回出发的卡片里
        if (a.path) {
          const len = a.path.__len ?? (a.path.__len = a.path.getTotalLength());
          const f0 = Math.min(0.45, (w / 2 + 10) / len);
          const f = f0 + (1 - 2 * f0) * clamp(a.f);
          room = (f - f0) * len - 6;
          const q = a.path.getPointAtLength(f * len);
          x = q.x; y = q.y;
          const fade = a.fade ?? "both";
          if (fade === "both" || fade === "in") o *= clamp(a.f / 0.12);
          if (fade === "both" || fade === "out") o *= clamp((1 - a.f) / 0.12);
          if (a.trail) {
            const q0 = a.path.getPointAtLength(Math.max(0, f * len - 6)), q1 = a.path.getPointAtLength(Math.min(len, f * len + 6));
            dir = [q1.x - q0.x, q1.y - q0.y];
          }
        }
        if (a.trail && dir && (dir[0] || dir[1])) {
          const m = Math.hypot(dir[0], dir[1]), ux = dir[0] / m, uy = dir[1] / m;
          const bx = x - ux * (w / 2 + 8), by = y - uy * (w / 2 + 8);
          lines[i].forEach((ln, j) => {
            const off = (j - 1) * 9, L1 = Math.max(0, Math.min(j === 1 ? 44 : 28, room - 8));
            const sx = bx - uy * off, sy = by + ux * off;
            ln.setAttribute("x1", sx.toFixed(1)); ln.setAttribute("y1", sy.toFixed(1));
            ln.setAttribute("x2", (sx - ux * L1).toFixed(1)); ln.setAttribute("y2", (sy - uy * L1).toFixed(1));
            ln.setAttribute("stroke-opacity", L1 > 2 ? (0.4 * o).toFixed(3) : "0");
          });
        }
        place(el, x, y, o, `translate(-50%, -50%) scale(${(a.s ?? 1).toFixed(3)})`);
      });
    };
  }

  // ---------- 印章：大字从 2.4 倍砸下来，微微歪着 ----------
  // 返回 set(x, y, k, o, rot)：k 为砸下进度（0..1），o 为之后的整体透明度
  function stamp(parent, html, cls = "") {
    const el = L("stampx " + cls, parent, html);
    return (x, y, k, o = 1, rot = -7) => {
      const s = lerp(2.4, 1, E.in(clamp(k)));
      place(el, x, y, clamp(k * 5) * o, `translate(-50%, -50%) rotate(${rot}deg) scale(${s.toFixed(3)})`);
      return el;
    };
  }

  // ---------- 手绘圈注：老师在白板上圈重点 ----------
  function penCircle(svg, cx, cy, rx, ry, { color = "#B5532F", width = 4.5, seed = 1, turns = 1.14 } = {}) {
    const r = rng(seed * 131 + 7), N = 56, ph0 = -2.3 + r() * 0.5;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = ph0 + (i / N) * turns * 6.283, g = 1 + 0.05 * (i / N) + 0.025 * Math.sin(a * 3 + r() * 0.3);
      pts.push([cx + Math.cos(a) * rx * g, cy + Math.sin(a) * ry * g]);
    }
    const p = wire(svg, smooth(pts), { color, width, opacity: 0.92 });
    p.classList.add("pen");
    return p;
  }
  function penLine(svg, x1, y1, x2, y2, { color = "#B5532F", width = 4.5, seed = 3, bow = 6 } = {}) {
    const r = rng(seed * 17 + 1), mx = (x1 + x2) / 2 + (r() - 0.5) * 6, my = (y1 + y2) / 2 + bow;
    const p = wire(svg, `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, { color, width, opacity: 0.92 });
    p.classList.add("pen");
    return p;
  }
  // 尺寸标注：两端竖杠 + 横线，标签由场景放
  function dimLine(svg, x1, x2, y, { color = "#1F1E1B", width = 2.5, h = 14 } = {}) {
    const p = wire(svg, `M${x1} ${y - h} L${x1} ${y + h} M${x1} ${y} L${x2} ${y} M${x2} ${y - h} L${x2} ${y + h}`, { color, width, opacity: 0.7 });
    p.classList.add("pen");
    return p;
  }
  // Catmull-Rom → 贝塞尔，让手绘线顺一点
  function smooth(p) {
    let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
      d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
    }
    return d;
  }

  // ---------- 倒计时环 ----------
  function ring(parent, { r = 34, w = 9, color = "var(--orange)", track = "#E6E3DC" } = {}) {
    const s = r * 2 + w + 2;
    const el = L("", parent);
    el.style.width = s + "px"; el.style.height = s + "px";
    el.innerHTML = `<svg width="${s}" height="${s}" style="transform:rotate(-90deg);display:block"><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${w}"/><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" pathLength="100" stroke-dasharray="0 100"/></svg>`;
    const arc = el.querySelectorAll("circle")[1];
    el.set = (k) => arc.setAttribute("stroke-dasharray", `${(clamp(k) * 100).toFixed(2)} 100`);
    return el;
  }
  // 乱码揭晓：从左到右一位位定格（哈希、密钥这类）
  function scramble(final, k, seed = 7, pool = "0123456789abcdef") {
    const n = final.length, done = Math.floor(clamp(k) * n), tick = Math.floor(k * 40);
    let s = "";
    for (let i = 0; i < n; i++) {
      const ch = final[i];
      if (i < done || "….:/ -_\"'".includes(ch)) { s += ch; continue; }
      const v = Math.sin((i + 1) * 12.9898 + seed * 78.233 + tick * 3.17) * 43758.5453;
      s += pool[Math.floor((v - Math.floor(v)) * pool.length)];
    }
    return s;
  }

  // ---------- 代码信封 ----------
  const J = {
    k: (s) => `<span class="k">"${s}"</span>`,
    s: (s) => `<span class="s">"${esc(s)}"</span>`,
    n: (s) => `<span class="n">${s}</span>`,
    p: (s) => `<span class="p">${s}</span>`,
    c: (s) => `<span class="c">${esc(s)}</span>`,
  };
  function codeBlock(parent, lines, { w = 760 } = {}) {
    const el = L("card code", parent);
    el.style.width = w + "px";
    const ls = lines.map((h) => mk("div", "", el, h || " "));
    return { el, ls };
  }
  // 逐行出现：k ∈ [0,1]
  function revealLines(block, k) {
    const n = Math.floor(k * block.ls.length + 1e-6);
    block.ls.forEach((l, i) => { l.style.visibility = i < n ? "visible" : "hidden"; });
  }

  // ---------- 终端 ----------
  function terminal(parent, { w = 1000, h = 520, title = "zsh — lyjwpage" } = {}) {
    const el = L("term", parent);
    el.style.width = w + "px"; el.style.height = h + "px";
    el.innerHTML = `<div class="bar"><i></i><i></i><i></i><span>${title}</span></div>`;
    const body = mk("div", "body", el);
    return { el, body };
  }

  // ---------- 主页：按站点真实首屏复刻（max-w-5xl 两列 bento，直角 1px 边框 + 3px 硬阴影） ----------
  // 页面按真实尺寸（内容宽 1024px）搭，再整体缩放放进浏览器窗口。
  const PAGE_W = 1104, PAD = 40, GAP = 12, COL = (1024 - GAP) / 2;
  const R = { // 各卡片在页面里的矩形（未缩放）
    contact: [PAD, 88, COL, 202], clock: [PAD + COL + GAP, 88, COL, 202],
    watching: [PAD, 302, 1024, 178],
    charger: [PAD, 492, COL, 396], listening: [PAD + COL + GAP, 492, COL, 396],
    activity: [PAD, 900, 1024, 253], server: [PAD, 1165, 1024, 245],
  };
  const HISTORY = [
    ["a1", "LOSTandFOUND", "SennaRin &amp; 泽野弘之"], ["a2", "Fate/strange Fake", "Original Soundtrack"],
    ["a3", "还没想好叫什么", "梁杨峻玮"], ["a4", "ROUNDABOUT", "Tatsuya Kitani"],
    ["a5", "Kaikai Kitan / Ao No Waltz", "Eve"], ["a6", "星の消えた夜に", "Aimer"],
    ["a7", "群青", "YOASOBI"], ["a8", "Song from Tv Series 【Oshi No Ko】 Vol.5", "B KOMACHI"],
  ];
  function siteMock(parent, { scale = 0.88, viewH = 900 } = {}) {
    const W = Math.round(PAGE_W * scale), H = Math.round(viewH * scale);
    const win = L("win", parent);
    win.style.width = W + 5 + "px"; win.style.height = 46 + H + 5 + "px"; win.style.transformOrigin = "0 0";
    win.innerHTML = `<div class="win-bar" style="height:46px"><i class="sq"></i><i class="sq"></i><i class="sq"></i>
      <div class="addr" style="height:30px;font-size:17px">${icon("shield-check", 16, 2.4)}<span>lyjw.me</span></div></div>`;
    const vp = L("", win);
    vp.style.cssText += `;top:46px;width:${W}px;height:${H}px;overflow:hidden`;
    const page = L("site", vp);
    page.style.transformOrigin = "0 0";
    const heat = Array.from({ length: 40 * 7 }, (_, i) => {
      const c = Math.floor(i / 7), r = i % 7, v = (Math.sin(c * 1.7 + r * 2.3) + Math.sin(c * 0.37) + (c > 30 ? 1.2 : 0)) * 1.3;
      const lv = v > 2 ? 4 : v > 1.1 ? 3 : v > 0.3 ? 2 : v > -0.6 ? 1 : 0;
      return `<i class="h${lv}"></i>`;
    }).join("");
    const ticks = Array.from({ length: 12 }, (_, i) => `<line x1="75" y1="8" x2="75" y2="${i % 3 ? 14 : 18}" transform="rotate(${i * 30} 75 75)"/>`).join("");
    const box = (k) => `left:${R[k][0]}px;top:${R[k][1]}px;width:${R[k][2]}px;height:${R[k][3]}px`;
    const NB = 58;
    const bars = Array.from({ length: NB }, () => "<i></i>").join("");
    const hist = (items) => items.map(([a, t, s]) => `<div><i class="s-art ${a}"></i><div><b>${t}</b><span>${s}</span></div></div>`).join("");
    page.innerHTML = `
      <div class="s-hdr">
        <div class="s-brand">LYJW's Homepage</div>
        <div class="s-now"><div class="s-app"><span data-k="clawd"></span><b>Claude Code</b></div><div class="s-title">scenes.js — lyjwpage</div></div>
        <div class="s-btn">${icon("monitor", 18, 1.8)}</div>
      </div>
      <div class="s-card" data-c="contact" style="${box("contact")}">
        <div style="position:absolute;left:24px;top:22px;display:flex;gap:18px;align-items:center">
          <div class="s-avatar"></div>
          <div><div class="s-name">LYJW131</div><div class="s-mail">admin@lyjw.me</div></div>
        </div>
        <div class="s-toggle"><span class="on">TOKENS</span><span>COMMIT</span></div>
        <div class="s-heat">${heat}</div>
      </div>
      <div class="s-card" data-c="clock" style="${box("clock")}">
        <div class="s-lbl2" style="left:26px;top:30px">Mac Time</div>
        <div class="s-time" style="left:24px;top:62px"><span data-k="hm">10:35</span><small data-k="ss">:21</small></div>
        <div class="s-date" style="left:26px;top:128px">2026/09/22 Tue</div>
        <div class="s-lbl2" style="left:26px;top:160px">Asia/Singapore · UTC+08:00</div>
        <svg class="s-dial" viewBox="0 0 150 150" width="160" height="160"><circle cx="75" cy="75" r="72" fill="#FDFCF9" stroke="rgba(31,30,27,.25)"/>
          <g stroke="#1F1E1B" stroke-width="2">${ticks}</g>
          <line data-k="hh" x1="75" y1="75" x2="75" y2="38" stroke="#1F1E1B" stroke-width="4" stroke-linecap="round"/>
          <line data-k="mm" x1="75" y1="75" x2="75" y2="20" stroke="#1F1E1B" stroke-width="3" stroke-linecap="round"/>
          <line data-k="sh" x1="75" y1="85" x2="75" y2="14" stroke="#C84D3D" stroke-width="1.4"/></svg>
      </div>
      <div class="s-card" data-c="watching" style="${box("watching")}">
        <div class="s-hd"><span>NOW WATCHING</span><span>EMBY</span></div>
        <div class="s-poster" style="left:16px;top:50px;width:206px;height:114px"></div>
        <div style="position:absolute;left:240px;top:48px;right:16px">
          <div class="s-np"><i></i>NOW PLAYING <span>· Infuse · Mac</span></div>
          <div class="s-ttl" style="margin-top:6px">我推的孩子</div><div class="s-sub" style="margin-top:2px">S1:E5 · 恋爱实境秀</div>
          <div class="s-tags" style="margin-top:8px"><span>1080p HEVC</span><span>FLAC stereo</span><span>5.3 Mbps</span></div>
        </div>
        <div class="s-tm" data-k="wt" style="right:16px;top:131px"></div>
        <div class="s-prog" style="left:240px;right:16px;top:160px"><i data-k="wp"></i></div>
      </div>
      <div class="s-card" data-c="charger" style="${box("charger")}">
        <div class="s-hd"><span><i class="s-dot"></i>CHARGER</span><span>ANKER A2687</span></div>
        <div class="s-big" style="left:17px;top:54px"><span data-k="cw">122.86</span><small>W</small></div>
        <div class="s-lbl2 up" style="left:18px;top:122px" data-k="cpct">77% / 160W</div>
        <div class="s-bars" data-k="cbars" style="left:17px;right:17px;top:160px;height:134px">${bars}</div>
        <div class="s-ports" style="left:17px;right:17px;top:306px">
          <div><p><i class="s-dot"></i>C1</p><b data-k="c1">96.0W</b><span>MacBook Pro series</span></div>
          <div><p><i class="s-dot"></i>C2</p><b>26.9W</b><span>iPhone 17 series</span></div>
          <div><p><i class="s-dot off"></i>C3</p><b class="idle">Idle</b><span>—</span></div>
        </div>
      </div>
      <div class="s-card" data-c="listening" style="${box("listening")}">
        <div class="s-hd"><span>RECENTLY PLAYED</span><span>APPLE MUSIC</span></div>
        <div class="lay" data-k="lh">
          <div class="s-art a0" style="left:20px;top:54px;width:100px;height:100px"></div>
          <div style="position:absolute;left:136px;top:56px;right:20px">
            <div class="s-np"><b>|||</b> NOW PLAYING <em>${icon("laptop", 12, 2)}MacBook Pro</em></div>
            <div class="s-ttl flipper" data-k="song">夜に駆ける</div>
            <div class="s-sub s-lyric">（这里逐字亮起歌词）</div>
          </div>
          <div class="s-tm" data-k="lt" style="right:20px;top:118px"></div>
          <div class="s-prog" style="left:136px;right:20px;top:146px"><i data-k="lp"></i></div>
          <div class="s-list" style="left:20px;right:20px;top:170px">${hist([HISTORY[0], HISTORY[1], HISTORY[2]])}</div>
        </div>
        <div class="lay" data-k="lf" style="width:1024px">
          <div class="s-art a0" style="left:16px;top:50px;width:76px;height:76px"></div>
          <div style="position:absolute;left:116px;top:46px;width:364px">
            <div class="s-np"><b>|||</b> NOW PLAYING <em>${icon("laptop", 12, 2)}MacBook Pro</em></div>
            <div class="s-ttl flipper" data-k="song2" style="margin-top:4px">夜に駆ける</div>
            <div class="s-sub" style="font-family:var(--mono);font-size:14px;margin-top:0">YOASOBI</div>
          </div>
          <div class="s-tm" data-k="lt2" style="left:380px;width:100px;text-align:right;top:100px"></div>
          <div class="s-prog" style="left:116px;width:364px;top:126px"><i data-k="lp2"></i></div>
          <div style="position:absolute;left:500px;top:48px;width:1px;height:88px;background:rgba(31,30,27,.24)"></div>
          <div style="position:absolute;left:522px;top:54px">
            <div class="s-sub" style="margin:0;color:#B3AEA4;letter-spacing:3px">· · ·</div>
            <div class="s-ttl" style="font-size:18px;margin-top:6px">（当前这句歌词逐字亮起）</div>
            <div class="s-sub s-lyric" style="margin-top:6px">（下一句）</div>
          </div>
          <div style="position:absolute;left:16px;right:16px;top:148px;height:1px;background:rgba(31,30,27,.24)"></div>
          <div class="s-list2" style="left:24px;top:162px;width:976px">
            <div class="s-list s-col">${hist(HISTORY.slice(0, 4))}</div><div class="s-list s-col">${hist(HISTORY.slice(4, 8))}</div>
          </div>
        </div>
      </div>
      <div class="s-card" data-c="activity" style="${box("activity")}">
        <div class="s-hd"><span>ACTIVITY</span><span>APPLE WATCH</span></div>
        <svg viewBox="0 0 150 150" width="176" height="176" style="position:absolute;left:24px;top:58px;transform:rotate(-90deg)">
          <circle cx="75" cy="75" r="62" fill="none" stroke="#FA114F" stroke-opacity=".18" stroke-width="18"/>
          <circle cx="75" cy="75" r="42" fill="none" stroke="#7ED321" stroke-opacity=".2" stroke-width="18"/>
          <circle cx="75" cy="75" r="22" fill="none" stroke="#1EC8EF" stroke-opacity=".2" stroke-width="18"/>
          <circle data-k="r0" cx="75" cy="75" r="62" fill="none" stroke="#FA114F" stroke-width="18" stroke-linecap="round" pathLength="100"/>
          <circle data-k="r1" cx="75" cy="75" r="42" fill="none" stroke="#7ED321" stroke-width="18" stroke-linecap="round" pathLength="100"/>
          <circle data-k="r2" cx="75" cy="75" r="22" fill="none" stroke="#1EC8EF" stroke-width="18" stroke-linecap="round" pathLength="100"/></svg>
        <div class="s-stats" style="left:232px;top:62px">
          <div><i style="background:#FA114F"></i>MOVE<b>386 <small>/ 270 kcal</small></b></div>
          <div><i style="background:#7ED321"></i>EXERCISE<b>34 <small>/ 30 min</small></b></div>
          <div><i style="background:#1EC8EF"></i>STAND<b>9 <small>/ 10 hrs</small></b></div>
        </div>
        <div class="s-stats" style="left:420px;top:62px"><div>STEPS<b>9,427</b></div><div>DISTANCE<b>7.14 km</b></div><div>FLIGHTS<b>6</b></div></div>
        <div class="s-work" style="left:512px;top:37px"><b>Fencing</b> <span>Outdoor</span><p>Sep 20, 2026, 1:50 AM</p><p><span>Duration</span> 23:39 · <span>Active energy</span> 202 kcal</p></div>
        <div class="s-work" style="left:512px;top:145px;border-top:1px solid rgba(31,30,27,.24)"><b>Fencing</b> <span>Outdoor</span><p>Apr 24, 2026, 7:30 PM</p><p><span>Duration</span> 1:47:21 · <span>Active energy</span> 404 kcal</p></div>
      </div>
      <div class="s-card" data-c="server" style="${box("server")}">
        <div class="s-hd"><span>EXIT NODE</span><span>MISAKA-JP</span></div>
        <div style="position:absolute;left:24px;top:52px"><div class="s-ttl" style="font:500 17px var(--mono);margin:0">Tokyo, Japan</div><div class="s-sub" style="font-family:var(--mono);font-size:14px">Misaka Network, Inc.</div></div>
        <div style="position:absolute;right:24px;top:50px;text-align:right"><div class="s-lbl2 up" style="position:static">UPTIME</div><div style="font:500 17px var(--mono);margin-top:4px">3d 1h</div></div>
        <div style="position:absolute;left:24px;top:104px"><div class="s-lbl2 up" style="position:static">DOWNLOAD</div><div class="s-mid">1.4<small>MB/s</small></div></div>
        <div style="position:absolute;left:498px;top:104px"><div class="s-lbl2 up" style="position:static">UPLOAD</div><div class="s-mid">415.0<small>KB/s</small></div></div>
        <div class="s-lbl2 up" style="left:24px;top:160px">TRAFFIC</div><div class="s-lbl2" style="right:24px;top:160px">0.82 / 2.00 TB</div>
        <div class="s-meter2" style="left:24px;right:24px;top:180px"><i style="width:30%"></i><i class="lt" style="left:30%;width:11%"></i></div>
        <div class="s-lbl2 up" style="left:24px;top:196px">CPU</div><div class="s-lbl2" style="left:420px;width:64px;text-align:right;top:196px">12.3%</div>
        <div class="s-meter2" style="left:24px;width:460px;top:216px"><i style="width:12%"></i></div>
        <div class="s-lbl2 up" style="left:498px;top:196px">MEMORY</div><div class="s-lbl2" style="right:24px;top:196px">0.6 / 2.0 GB</div>
        <div class="s-meter2" style="left:498px;right:24px;top:216px"><i style="width:30%"></i></div>
      </div>`;
    const q = (k) => page.querySelector(`[data-k="${k}"]`);
    const K = {};
    for (const k of ["hm", "ss", "hh", "mm", "sh", "wt", "wp", "cw", "cpct", "c1", "cbars", "song", "song2", "lt", "lp", "lt2", "lp2", "r0", "r1", "r2", "lh", "lf"]) K[k] = q(k);
    const barEls = [...K.cbars.children];
    const cards = {};
    for (const k of Object.keys(R)) cards[k] = page.querySelector(`[data-c="${k}"]`);
    const mini = Clawd.create(2, 4);
    mini.el.style.position = "relative";
    q("clawd").appendChild(mini.el);
    q("clawd").style.cssText = `display:inline-block;position:relative;width:${18 * 2}px;height:${5 * 4}px`;
    const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
    // 功率柱：前半段低一点，后面插上第二台设备后抬高（和真实截图一致），每秒往左滚一格
    const barH = (i) => { const v = i < 32 ? 0.74 + 0.05 * Math.sin(i * 0.9) - i * 0.002 : 0.95 + 0.02 * Math.sin(i * 1.7); return v; };
    // st: { t, scroll, cardsIn{}, chargerOn 0..1, rings 0..1, song, prevSong, flip 0..1, songFlash }
    function update(st) {
      const s = scale;
      page.style.transform = `scale(${s}) translateY(${(-(st.scroll || 0)).toFixed(1)}px)`;
      const T = 10 * 3600 + 35 * 60 + 21 + st.t;
      setText(K.hm, `${Math.floor(T / 3600)}:${String(Math.floor((T % 3600) / 60)).padStart(2, "0")}`);
      setText(K.ss, ":" + String(Math.floor(T % 60)).padStart(2, "0"));
      K.hh.setAttribute("transform", `rotate(${(((T / 3600) % 12) * 30).toFixed(2)} 75 75)`);
      K.mm.setAttribute("transform", `rotate(${(((T / 60) % 60) * 6).toFixed(2)} 75 75)`);
      K.sh.setAttribute("transform", `rotate(${((Math.floor(T) % 60) * 6).toFixed(2)} 75 75)`);
      const wpos = 517 + st.t, lpos = st.lpos ?? 7 + st.t;
      K.wp.style.width = ((wpos / 1421) * 100).toFixed(2) + "%"; setText(K.wt, `${mmss(wpos)} / 23:41`);
      for (const [p, tm] of [[K.lp, K.lt], [K.lp2, K.lt2]]) { p.style.width = ((lpos / 261) * 100).toFixed(2) + "%"; setText(tm, `${mmss(lpos)} / 4:21`); }
      // 换歌：翻牌（前半程旧名翻下去，后半程新名翻上来）
      const fk = st.flip ?? 1, name = fk < 0.5 && st.prevSong ? st.prevSong : st.song || "夜に駆ける";
      const ang = fk < 1 && st.prevSong ? (fk < 0.5 ? fk * 180 : (fk - 1) * 180) : 0;
      for (const el of [K.song, K.song2]) {
        setText(el, name);
        el.style.transform = ang ? `perspective(300px) rotateX(${ang.toFixed(1)}deg)` : "";
        el.style.background = st.songFlash ? "var(--green-t)" : "";
      }
      const w = 122.86 + 1.9 * Math.sin(st.t * 2.1) + 0.8 * Math.sin(st.t * 5.3 + 1);
      setText(K.cw, w.toFixed(2)); setText(K.cpct, `${Math.round((w / 160) * 100)}% / 160W`);
      setText(K.c1, `${(w - 26.9).toFixed(1)}W`);
      const sh = Math.floor(st.t);
      barEls.forEach((b, i) => { b.style.height = (barH(i + sh - Math.min(sh, 26)) * 100).toFixed(1) + "%"; });
      const rk = st.rings ?? 1;
      [143, 113, 90].forEach((p, i) => K["r" + i].setAttribute("stroke-dasharray", `${(Math.min(p, 100) * rk).toFixed(2)} 100`));
      // 充电格亮灭：充电卡淡出左移，最近播放铺满整行并换成整行排版（站点里是 FLIP + 交叉淡入）
      const on = st.chargerOn ?? 1, e = E.io(on);
      const li = cards.listening;
      const cin = st.cardsIn || {};
      for (const k of Object.keys(R)) {
        const c = cards[k], k0 = cin[k] ?? 1;
        let o = k0, tf = `translateY(${(14 * (1 - E.out(k0))).toFixed(1)}px)`;
        if (k === "charger") { o = Math.min(k0, on); tf += ` translateX(${(-8 * (1 - on)).toFixed(1)}px) scale(${lerp(0.985, 1, on).toFixed(4)})`; }
        c.style.opacity = o.toFixed(3); c.style.transform = tf;
      }
      li.style.left = lerp(PAD, R.listening[0], e).toFixed(1) + "px";
      li.style.width = lerp(1024, COL, e).toFixed(1) + "px";
      K.lh.style.opacity = clamp((e - 0.35) / 0.5).toFixed(3);
      K.lf.style.opacity = clamp((0.65 - e) / 0.5).toFixed(3);
      mini.update({ pose: Math.floor(st.t / 1.6) % 3 === 2 ? "look-right" : "default", offset: 0 });
    }
    // 卡片在舞台上的中心点 / 矩形（给连线、数据包、标签用）
    function center(k, x0, y0, scroll = 0) {
      const [x, y, w, h] = R[k];
      return { x: x0 + (x + w / 2) * scale, y: y0 + 46 + (y - scroll + h / 2) * scale };
    }
    function rect(k, x0, y0, scroll = 0) {
      const [x, y, w, h] = R[k];
      return { x: x0 + x * scale, y: y0 + 46 + (y - scroll) * scale, w: w * scale, h: h * scale };
    }
    return { el: win, page, cards, update, center, rect, W: W + 5, H: 46 + H + 5, viewTop: 46, viewH: H };
  }

  // ---------- 贴边连线：按元素实际尺寸算端点 ----------
  // side: r l t b；首帧渲染时量尺寸（字体已就绪），之后不再变
  function box(el) {
    const x = el.__x ?? 0, y = el.__y ?? 0;
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function anchor(el, side, k = 0.5) {
    const b = box(el);
    if (side === "r") return [b.x + b.w, b.y + b.h * k];
    if (side === "l") return [b.x, b.y + b.h * k];
    if (side === "t") return [b.x + b.w * k, b.y];
    return [b.x + b.w * k, b.y + b.h];
  }
  // 端点的控制柄沿各自那条边的法线方向伸出去：从下边出发先往下，进左边时从左边水平进，不会钩回来
  const NORMAL = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };
  function link(svg, a, sa, b, sb, opts = {}) {
    const p = wire(svg, "M0 0", opts);
    p.__link = () => {
      const [x1, y1] = Array.isArray(a) ? a : anchor(a, sa, opts.ka ?? 0.5);
      const [x2, y2] = Array.isArray(b) ? b : anchor(b, sb, opts.kb ?? 0.5);
      let d;
      const flat = (sa === "r" || sa === "l") && (sb === "r" || sb === "l") && Math.abs(y1 - y2) < 1;
      const plumb = (sa === "t" || sa === "b") && (sb === "t" || sb === "b") && Math.abs(x1 - x2) < 1;
      if (opts.straight || flat || plumb) d = `M${x1} ${y1} L${x2} ${y2}`;
      else {
        const n1 = NORMAL[sa] || [0, 0], n2 = NORMAL[sb] || [0, 0];
        const d1 = Math.max(30, (n1[0] ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) / 2);
        const d2 = Math.max(30, (n2[0] ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) / 2);
        d = `M${x1} ${y1} C${x1 + n1[0] * d1} ${y1 + n1[1] * d1} ${x2 + n2[0] * d2} ${y2 + n2[1] * d2} ${x2} ${y2}`;
      }
      p.setAttribute("d", d);
      p.__len = null;
      p.__end = [x2, y2];
    };
    return p;
  }
  // 每个场景第一次渲染时调用：把所有 link 的端点量出来
  function relink(svg) {
    if (svg.__linked) return;
    svg.__linked = true;
    for (const p of svg.querySelectorAll("path")) if (p.__link) p.__link();
  }

  // 小地球 / 设备等图标块
  function iconBox(parent, name, { size = 64, tint = "#fff", stroke = 2 } = {}) {
    const el = L("", parent);
    el.style.cssText += `;width:${size}px;height:${size}px;border:2.5px solid var(--ink);background:${tint};display:flex;align-items:center;justify-content:center;box-shadow:4px 4px 0 rgba(31,30,27,.12)`;
    el.innerHTML = icon(name, Math.round(size * 0.55), stroke);
    return el;
  }
  function text(parent, html, cls = "lbl") { return L(cls, parent, html); }

  window.Kit = {
    css, card, popAt, dropAt, wireLayer, wire, drawWire, along, ptAt, arrow, packets, stamp, penCircle, penLine, dimLine, smooth, ring, scramble,
    J, codeBlock, revealLines, terminal, siteMock, link, relink, anchor, iconBox, text,
  };
})();
