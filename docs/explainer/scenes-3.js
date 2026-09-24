// 05 大陆访问 · 06 图片链路 · 07 自适应调频
(() => {
  const { E, seg, lerp, mk, L, svgEl, icon, place, show, setHTML, setText, chapter, scene, say, at, act, hold, look, sfx, duck, camera, shake, burst, emote } = Engine;
  const { css, card, popAt, dropAt, wireLayer, wire, link, relink, drawWire, packets, stamp, penCircle, scramble } = Kit;
  const LEFT = [250, 975], RIGHT = [1670, 975];
  const mono = (s, sz = 19) => `<span class="mono" style="font-size:${sz}px">${s}</span>`;

  // ---------- 小工具 ----------
  // 关键帧取值：stops = [[t, v, ease?], ...]，v 可以是数，也可以是数组（颜色、坐标）
  function kf(stops, T) {
    if (T <= stops[0][0]) return stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (T < b[0]) {
        const k = E[b[2] || "io"](seg(T, a[0], b[0]));
        return Array.isArray(a[1]) ? a[1].map((v, j) => lerp(v, b[1][j], k)) : lerp(a[1], b[1], k);
      }
    }
    return stops[stops.length - 1][1];
  }
  const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
  const beats = (a, b, d = 0.6) => { const r = []; for (let t = a; t <= b + 1e-6; t += d) r.push(+t.toFixed(2)); return r; };
  // 数据包走一趟：t0 出发、t1 到站；前后各 0.14s 按时间淡入淡出（短途也不会一帧冒出来）
  // 速度线等包离开出发的卡片一段再出现（trailFrom = 行进比例），免得拖进卡片里压字
  function trip(path, T, t0, t1, text, cls = "", trailFrom = 0.4) {
    if (T < t0 - 0.14 || T > t1 + 0.14) return null;
    const f = E.io(seg(T, t0, t1));
    return { path, f, text, cls, fade: false, trail: f > trailFrom && T < t1, o: Math.min(seg(T, t0 - 0.14, t0), 1 - seg(T, t1, t1 + 0.14)) };
  }
  // 角标 / 小标签：spans = [[a, b, html, cls], ...]，a 弹出、b 收起
  function badge(el, T, spans, base) {
    let cur = null;
    for (const s of spans) if (T >= s[0] && T < s[1] + 0.16) cur = s;
    if (!cur) { show(el, 0); return; }
    const [a, b, html, cls] = cur, kin = seg(T, a, a + 0.18), kout = seg(T, b, b + 0.16);
    setHTML(el, html);
    const c = `${base} ${cls || ""}`.trim();
    if (el.className !== c) el.className = c;
    el.style.transform = `scale(${(lerp(0.4, 1, E.back(kin)) * (1 - 0.3 * kout)).toFixed(3)})`;
    show(el, Math.min(kin * 3, 1 - kout));
  }
  // 首帧按实际排版量尺寸再定路径（和 Kit.link 一样挂 __link，relink 时统一算）
  function measured(svg, fn, opts) {
    const p = wire(svg, "M0 0", opts);
    p.__link = () => { p.setAttribute("d", fn()); p.__len = null; };
    return p;
  }
  // 卡片里某个元素 → 舞台坐标（卡片边框 2.5px）
  const inCard = (el, c) => ({ x: c.__x + 2.5 + el.offsetLeft, y: c.__y + 2.5 + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const PEN = { color: "#B5532F", width: 4.5, opacity: 0.92 };
  const penD = (cx, cy, rx, ry, seed) => penCircle(svgEl("svg", {}), cx, cy, rx, ry, { seed }).getAttribute("d");
  // 数字翻牌：ch = [[t, 值], ...]
  function flipNum(el, T, ch) {
    let cur = ch[0][1], prev = cur, tc = -9;
    for (let i = 1; i < ch.length; i++) if (T >= ch[i][0]) { prev = cur; cur = ch[i][1]; tc = ch[i][0]; }
    const k = seg(T, tc, tc + 0.32);
    setText(el, String(k < 0.5 ? prev : cur));
    const ang = k > 0 && k < 1 ? (k < 0.5 ? k * 180 : (k - 1) * 180) : 0;
    el.style.transform = ang ? `perspective(220px) rotateX(${ang.toFixed(1)}deg)` : "";
  }

  // =====================================================================
  // 05 大陆访问
  // =====================================================================
  const c5 = chapter("大陆访问", "lyjw131.com 和阿里云 ESA", 8);
  css(`
    .c5-shelf{display:flex;gap:16px;margin-top:12px}
    .c5-tile{position:relative;width:140px;height:62px;border:2.5px solid var(--ink);background:#fff}
    .c5-tile .tc{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:0 10px;font:600 18px var(--mono);white-space:nowrap}
    .c5-tile .ring{margin-left:auto;transform:rotate(-90deg);flex:none}
    .c5-badge{position:absolute;right:-12px;top:-16px;font-size:14px;padding:1px 7px;transform-origin:50% 50%}
    .tg.c5-a{background:var(--amber-t);border-color:var(--amber);color:#8A5E0B}
    .c5-chips{position:relative;display:flex;gap:12px;margin-top:10px}
    .c5-chip{position:relative;z-index:1;font:600 20px var(--mono);padding:5px 12px;border:2px solid var(--line);color:var(--muted);white-space:nowrap}
    .c5-hl{position:absolute;left:0;top:0;z-index:0;background:var(--orange-t);border:2.5px solid var(--orange);opacity:0}
    .c5-broom{transform-origin:50% 6%}
  `);
  // 扫帚：墨线 + 琥珀色刷毛，和 lucide 图标同一套笔触
  const BROOM = `<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#1F1E1B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;overflow:visible"><path d="M12 1v10.5"/><path d="M9 11.5h6l.8 2.5H8.2z" fill="#FFFFFF"/><path d="M8.2 14h7.6l3 8H5.2z" fill="#E8B04A"/><path d="M9.6 16.2 8.6 21.6M12 16.2v5.4M14.4 16.2l1 5.4"/></svg>`;
  scene(c5, 1.9, 19.2, (root, s) => {
    const T0 = s.t0 - c5.t0;
    const wl = wireLayer(root);
    const tile = (k, ic, lab, withRing) => `<div class="c5-tile" data-t="${k}"><div class="tc">${icon(ic, 24, 2.2)}<span>${lab}</span>${withRing ? '<svg class="ring" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="10" fill="none" stroke="#E6E3DC" stroke-width="5"/><circle data-r cx="14" cy="14" r="10" fill="none" stroke="#2E9E4F" stroke-width="5" pathLength="100" stroke-dasharray="0 100"/></svg>' : ""}</div></div>`;
    const visitor = card(root, { x: 80, y: 205, w: 270, icon: "user", title: "大陆访客", sub: mono("lyjw131.com", 18) });
    const esa = card(root, { x: 540, y: 190, w: 520, tint: "amber", icon: "zap", title: "阿里云 ESA", sub: "边缘缓存",
      lines: [`<div class="c5-shelf">${tile("home", "app-window", "首页", true)}${tile("js", "package", "JS")}${tile("img", "image", "/img")}</div>`] });
    const origin = card(root, { x: 1260, y: 205, w: 280, tint: "green", icon: "globe", title: "lyjw.me", sub: "源站 · Vercel" });
    const worker = card(root, { x: 1590, y: 205, w: 270, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "状态 API · WebSocket" });
    worker.querySelector(".hd").style.fontSize = "24px";
    const CC = ["max-age=300", "stale-while-revalidate=86400", "stale-if-error=86400"];
    const hdr = card(root, { x: 80, y: 460, w: 900, pad: "12px 18px", title: '<span class="lbl b" style="font-size:19px">首页 Cache-Control</span>',
      lines: [`<div class="c5-chips"><i class="c5-hl"></i>${CC.map((t) => `<span class="c5-chip">${t}</span>`).join("")}</div>`] });
    const gh = card(root, { x: 80, y: 470, w: 420, icon: "rocket", title: "GitHub Actions", sub: mono("purge-esa.yml", 18), tags: [{ t: `${icon("check", 14, 3)}部署成功`, c: "g" }] });
    const wsLbl = L("tg o", root, "WebSocket 直连");
    const home = esa.querySelector('[data-t="home"]'), homeC = home.querySelector(".tc"), arc = home.querySelector("[data-r]");
    const hb = mk("span", "tg c5-badge", home);
    const esaIc = esa.querySelector(".ic");
    const oErr = mk("span", "tg r c5-badge", origin);
    const vUp = mk("span", "tg c5-badge", visitor);
    const chips = [...hdr.querySelectorAll(".c5-chip")], hl = hdr.querySelector(".c5-hl");
    const ghTag = gh.querySelector(".tg"), ghIc = gh.querySelector(".ic"), ghTagHTML = ghTag.innerHTML;
    const broom = L("c5-broom", esa, BROOM);
    const W = {
      req: wire(wl, "M350 245 L540 245"), res: wire(wl, "M540 295 L350 295"),
      up: wire(wl, "M1060 245 L1260 245"), down: wire(wl, "M1260 295 L1060 295"),
      // 实时数据：从 ESA 上方绕过去，直连 Worker（路径从 Worker 出发，推送沿它回到访客）
      ws: wire(wl, "M1725 205 C1725 92 215 92 215 205", { dash: true, color: "#D97757", opacity: 0.8, width: 3 }),
      gh: link(wl, gh, "r", esa, "b", { kb: 0.3 }),
      // 两个域名都换上新版后，Actions 再通知 Worker：Worker 直接往推送房间广播 version
      dep: link(wl, gh, "r", worker, "b", { ka: 0.62, color: "#1F1E1B", opacity: 0.5 }),
    };
    const pk = packets(root, 8);
    const iK = [[3.9, 0], [7.5, 0], [7.8, 1], [10.5, 1], [10.8, 2]];
    let M = null;
    return (lt) => {
      const T = lt + T0;
      relink(wl);
      if (!M) M = { chips: chips.map((c) => ({ x: c.offsetLeft, w: c.offsetWidth, h: c.offsetHeight })), tile: { x: home.offsetLeft, y: home.offsetTop, w: home.offsetWidth, h: home.offsetHeight } };
      const END = 18.5;
      const vis = popAt(visitor, T, 2.2, END, { dx: -30 });
      const e = popAt(esa, T, 2.45, END);
      // 源站出错：红框 + 抖两下
      const jit = T > 11.3 && T < 11.75 ? 6 * Math.sin((T - 11.3) * 70) * (1 - seg(T, 11.3, 11.75)) : 0;
      const o = popAt(origin, T, 2.7, END, { x: 1260 + jit });
      origin.style.borderColor = T > 11.3 && T < 12.4 ? "var(--red)" : "";
      popAt(hdr, T, 3.3, 12.4);
      const g = popAt(gh, T, 12.8, END, { dx: -30 });
      const w = popAt(worker, T, 15.9, END);
      popAt(wsLbl, T, 16.35, END, { x: 893, y: 142 });
      const wout = 1 - seg(T, END - 0.15, END + 0.05); // 连线先于卡片淡出（卡片淡出时会上浮 10px）
      drawWire(W.req, seg(T, 2.85, 3.25), Math.min(vis, e) * wout); drawWire(W.res, seg(T, 2.95, 3.35), Math.min(vis, e) * wout);
      drawWire(W.up, seg(T, 3.05, 3.45), Math.min(e, o) * wout); drawWire(W.down, seg(T, 3.15, 3.55), Math.min(e, o) * wout);
      drawWire(W.gh, seg(T, 13.0, 13.4), Math.min(g, e) * wout);
      drawWire(W.ws, seg(T, 16.15, 16.5), Math.min(vis, w) * wout);
      drawWire(W.dep, seg(T, 16.1, 16.45), Math.min(g, w) * wout);

      // 缓存头：高亮条滑到正在演示的那一条
      const C = M.chips, idx = kf(iK, T);
      hl.style.width = kf(iK.map(([t, i]) => [t, C[i].w]), T).toFixed(1) + "px";
      hl.style.height = C[0].h + "px";
      hl.style.transform = `translateX(${kf(iK.map(([t, i]) => [t, C[i].x]), T).toFixed(1)}px)`;
      hl.style.opacity = seg(T, 3.9, 4.2).toFixed(3);
      chips.forEach((c, i) => { c.style.color = T > 3.95 && Math.abs(idx - i) < 0.5 ? "var(--orange-d)" : ""; });

      // 命中：ESA 的闪电亮一下
      const fz = seg(T, 4.2, 4.3) * (1 - seg(T, 4.5, 4.9));
      esaIc.style.background = fz > 0.01 ? `rgba(242,181,65,${(0.95 * fz).toFixed(2)})` : "";
      esaIc.style.transform = fz > 0.01 ? `scale(${(1 + 0.15 * fz).toFixed(3)})` : "";

      // 首页格：新鲜度环（5 分钟走满变琥珀色 = 过期）
      let age;
      if (T < 4.8) age = 0.3; else if (T < 6.9) age = lerp(0.3, 1, seg(T, 4.8, 6.9)); else if (T < 9.0) age = 1;
      else if (T < 9.6) age = 0.04; else if (T < 10.2) age = lerp(0.04, 1, seg(T, 9.6, 10.2)); else if (T < 16.0) age = 1; else age = 0.04;
      arc.setAttribute("stroke-dasharray", `${(age * 100).toFixed(1)} 100`);
      arc.setAttribute("stroke", age > 0.995 ? "#C98A12" : "#2E9E4F");
      badge(hb, T, [[4.2, 5.3, "命中", "g"], [6.9, 8.9, "过期", "c5-a"], [9.0, 9.55, "新", "g"], [10.2, 12.4, "过期", "c5-a"], [16.0, END, "新版", "g"]], "tg c5-badge");
      badge(oErr, T, [[11.3, 12.4, "✗ 5xx", "r"]], "tg c5-badge");
      // 页面收到 version：自己再问一次 /api/version，顶上弹出更新卡（站点界面是英文）
      badge(vUp, T, [[17.75, END, "UPDATE", "o"]], "tg c5-badge");
      worker.style.outline = T > 16.95 && T < 17.35 ? "4px solid rgba(217,119,87,.6)" : "";
      worker.style.outlineOffset = "3px";

      // 发版：对勾亮起，火箭一蹿
      badge(ghTag, T, [[13.2, END, ghTagHTML, "g"]], "tg");
      ghIc.style.background = T > 13.2 ? "var(--green-t)" : "";
      ghIc.style.transform = T > 13.2 && T < 13.6 ? `translateY(${(-7 * Math.sin(Math.PI * seg(T, 13.2, 13.6))).toFixed(1)}px)` : "";

      // 刷新：扫帚从右往左把首页格扫出卡片（只扫首页这一条，JS 和 /img 不动）；预热：重新填回来
      const TL = M.tile;
      const sweep = seg(T, 14.1, 14.4), empty = T >= 14.4 && T < 16.0, refill = seg(T, 16.0, 16.3);
      if (T < 14.1) { homeC.style.transform = ""; homeC.style.opacity = ""; }
      else if (T < 16.0) { homeC.style.transform = `translateX(${(-130 * E.in(sweep)).toFixed(1)}px) rotate(${(-12 * sweep).toFixed(1)}deg)`; homeC.style.opacity = (1 - sweep).toFixed(3); }
      else { homeC.style.transform = `scale(${lerp(0.5, 1, E.back(refill)).toFixed(3)})`; homeC.style.opacity = Math.min(1, refill * 3).toFixed(3); }
      home.style.borderStyle = empty ? "dashed" : "";
      home.style.borderColor = empty ? "#B3AC9F" : "";
      home.style.background = empty ? "transparent" : (T > 9.0 && T < 9.5) || (T > 16.0 && T < 16.8) ? "var(--green-t)" : "";
      if (T > 13.75 && T < 14.75) {
        const bIn = seg(T, 13.75, 13.95), bk = seg(T, 13.95, 14.4), bOut = seg(T, 14.4, 14.75);
        const bx = TL.x + TL.w - 40 - 170 * E.io(bk), by = TL.y + TL.h / 2 - 64 - 50 * E.out(bOut);
        const rot = 22 + 9 * Math.sin(bk * Math.PI * 4);
        place(broom, bx, by, Math.min(bIn * 2, 1 - bOut), `rotate(${rot.toFixed(1)}deg) scale(${lerp(0.6, 1, E.back(bIn)).toFixed(3)})`);
      } else show(broom, 0);

      // 数据包：命中秒回 / 过期先给旧页、同时回源 / 源站出错照给旧页 / 刷新、预热 / 推送直连
      const P = [], add = (i, x) => { if (x) P[i] = x; };
      add(0, trip(W.req, T, 3.7, 4.2, "GET /", "ink"));
      add(1, trip(W.res, T, 4.25, 4.6, "首页", "green"));
      add(0, trip(W.req, T, 7.2, 7.7, "GET /", "ink"));
      add(1, trip(W.res, T, 7.75, 8.15, "旧页", "gray"));
      add(2, trip(W.up, T, 7.75, 8.35, "回源", ""));
      add(3, trip(W.down, T, 8.45, 8.95, "新页", "green"));
      add(0, trip(W.req, T, 10.2, 10.7, "GET /", "ink"));
      add(1, trip(W.res, T, 10.75, 11.15, "旧页", "gray"));
      add(2, trip(W.up, T, 10.75, 11.3, "回源", ""));
      add(3, trip(W.down, T, 11.35, 11.8, "5xx", "red"));
      add(4, trip(W.gh, T, 13.35, 13.85, "刷新", "ink"));
      add(4, trip(W.gh, T, 14.65, 15.15, "预热", ""));
      add(2, trip(W.up, T, 15.2, 15.6, "回源", ""));
      add(3, trip(W.down, T, 15.6, 16.0, "新版", "green"));
      add(7, trip(W.dep, T, 16.4, 17.0, "site-deployed", "ink"));
      add(5, trip(W.ws, T, 17.05, 17.75, "version", "green", 0.06));
      add(6, trip(W.ws, T, 17.4, 18.1, "version", "green", 0.06));
      pk(P);
    };
  });
  at(c5, 0, RIGHT[0], RIGHT[1]);
  look(c5, 0.5, -1);
  act(c5, 11.3, "flinch");
  emote(c5, 11.4, "drop", 1.3);
  emote(c5, 16.05, "spark", 1.0);
  // 发版那一扫不配旁白：镜头推近 ESA，让扫帚自己演
  camera(c5, 13.0, 13.75, { x: 810, y: 360, s: 1.22 }, "sine");
  camera(c5, 14.65, 15.45, null, "sine");
  say(c5, 2.8, 6.8, "离大陆访客最近的一层，\n五分钟内直接命中。", "left");
  say(c5, 7.2, 12.2, "访客不用等源站：\n过期、出错都先给旧页。", "left");
  say(c5, 14.6, 18.8, "发版后先扫旧首页、再预热；\n新版就位，再推 version 提醒刷新。", "left");

  // =====================================================================
  // 06 图片链路
  // =====================================================================
  const c6 = chapter("图片链路", "按内容寻址", 8);
  const KEY = "3f9a…c1e7.png", KEY2 = "b7d0…4e21.png";
  // 8×8 像素小图（一只小 Clawd）；改动的那一个像素在右上角的天上
  const PIX = ["........", ".CCCCCC.", ".CKCCKC.", "CCCCCCCC", ".CCCCCC.", ".C.CC.C.", "........", "GGGGGGGG"];
  const PIX2 = PIX.map((r, i) => (i === 0 ? r.slice(0, 6) + "Y" + r.slice(7) : r));
  const PC = { ".": "#2F6FD6", C: "#D77757", K: "#1F1E1B", G: "#2E9E4F", Y: "#F2C14E" };
  const pixSVG = (px, rows = PIX) => `<svg width="${8 * px}" height="${8 * px}" shape-rendering="crispEdges" style="display:block">${rows.map((r, y) => [...r].map((ch, x) => `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${PC[ch]}"/>`).join("")).join("")}</svg>`;
  css(`
    .c6-br{background:#fff;box-shadow:8px 8px 0 rgba(31,30,27,.12)}
    .c6-br .bar{height:40px;border-bottom:2.5px solid var(--ink);display:flex;align-items:center;gap:8px;padding:0 12px;background:#FBFAF7}
    .c6-br .bar .sq{width:12px;height:12px;border:2px solid var(--ink)}
    .c6-br .addr{margin-left:10px;flex:1;height:26px;border:2px solid var(--ink);display:flex;align-items:center;gap:6px;padding:0 10px;font:500 16px var(--mono);background:#fff}
    .c6-br .body{display:flex;align-items:center;gap:14px;padding:14px 16px}
    .c6-th{position:relative;width:60px;height:60px;border:2px dashed #B3AC9F;flex:none}
    .c6-th svg{position:absolute;left:0;top:0;opacity:0}
    .c6-code{font:500 17px var(--mono);white-space:nowrap}
    .c6-code b{color:var(--orange-d);font-weight:600}
    .pkt.c6-img{padding:3px;background:#fff}
    .c6-thumb{position:relative;width:54px;height:54px;border:2px solid var(--ink);flex:none;display:block}
    .c6-thumb svg{position:absolute;left:1px;top:1px}
    .c6-lock{position:absolute;right:-12px;bottom:-12px;width:30px;height:30px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid #fff;opacity:0}
    .stampx.c6-stamp{font-size:46px}
    .c6-keys .tagrow{margin-top:16px;gap:24px}
  `);
  // --- 两个域名各取各的 ---
  scene(c6, 1.9, 10.7, (root, s) => {
    const T0 = s.t0 - c6.t0;
    const wl = wireLayer(root);
    const browser = (x, y, host) => {
      const el = L("win c6-br", root);
      el.style.width = "440px";
      el.innerHTML = `<div class="bar"><i class="sq"></i><i class="sq"></i><i class="sq"></i><div class="addr">${icon("shield-check", 14, 2.4)}<span>${host}</span></div></div><div class="body"><div class="c6-th">${pixSVG(7)}</div><div class="c6-code">&lt;img src="<b>/img/${KEY}</b>"&gt;</div></div>`;
      el.__x = x; el.__y = y;
      return { el, th: el.querySelector(".c6-th"), img: el.querySelector(".c6-th svg") };
    };
    const A = browser(80, 150, "lyjw.me"), B = browser(80, 450, "lyjw131.com");
    const vc = card(root, { x: 700, y: 140, w: 420, tint: "green", icon: "globe", title: "Vercel 边缘", sub: mono("rewrite /img/*", 18), tags: [{ t: KEY }, { t: "不经过 Next.js 函数" }], cls: "c6-keys" });
    const esa = card(root, { x: 700, y: 450, w: 420, tint: "amber", icon: "zap", title: "阿里云 ESA", sub: "缓存同一路径", tags: [{ t: KEY }], cls: "c6-keys" });
    const r2 = card(root, { x: 1300, y: 140, w: 480, tint: "orange", icon: "box", title: "R2", mono: true, sub: "公开地址", lines: [mono("max-age=31536000, immutable", 18)] });
    const [vKey, vFn] = vc.querySelectorAll(".tg"), eKey = esa.querySelector(".tg");
    const upLbl = L("lbl b", root, "回源");
    // 手绘圈注要压在卡片上面：卡片之后单独建一层
    const pen = wireLayer(root);
    const W = {
      a1: wire(wl, "M520 190 L700 190"), a2: wire(wl, "M700 250 L520 250"),
      r1: wire(wl, "M1120 190 L1300 190"), r2: wire(wl, "M1300 250 L1120 250"),
      b1: wire(wl, "M520 500 L700 500"), b2: wire(wl, "M700 560 L520 560"),
      up: link(wl, esa, "t", vc, "b", { ka: 0.43, kb: 0.43, dash: true, opacity: 0.6 }),
      dn: link(wl, vc, "b", esa, "t", { ka: 0.57, kb: 0.57, dash: true, opacity: 0.6 }),
      c1: measured(pen, () => { const r = inCard(vKey, vc); return penD(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 9, r.h / 2 + 7, 2); }, PEN),
      c2: measured(pen, () => { const r = inCard(eKey, esa); return penD(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + 9, r.h / 2 + 7, 5); }, PEN),
    };
    const pk = packets(root, 8);
    const IMG = pixSVG(3);
    return (lt) => {
      const T = lt + T0;
      relink(wl); relink(pen);
      const END = 10.0;
      const a = popAt(A.el, T, 2.2, END, { dx: -30 }), b = popAt(B.el, T, 2.4, END, { dx: -30 });
      const v = popAt(vc, T, 3.0, END), e = popAt(esa, T, 3.2, END), r = popAt(r2, T, 3.5, END);
      popAt(upLbl, T, 3.9, END, { x: 812, y: 362 });
      const wout = 1 - seg(T, END - 0.15, END + 0.05);
      drawWire(W.a1, seg(T, 3.3, 3.7), Math.min(a, v) * wout); drawWire(W.a2, seg(T, 3.4, 3.8), Math.min(a, v) * wout);
      drawWire(W.b1, seg(T, 3.5, 3.9), Math.min(b, e) * wout); drawWire(W.b2, seg(T, 3.6, 4.0), Math.min(b, e) * wout);
      drawWire(W.r1, seg(T, 3.8, 4.2), Math.min(v, r) * wout); drawWire(W.r2, seg(T, 3.9, 4.3), Math.min(v, r) * wout);
      drawWire(W.up, seg(T, 3.7, 4.0), Math.min(v, e) * wout); drawWire(W.dn, seg(T, 3.75, 4.05), Math.min(v, e) * wout);
      badge(vFn, T, [[4.95, END, "不经过 Next.js 函数", ""]], "tg");
      badge(vKey, T, [[5.95, END, KEY, ""]], "tg");
      badge(eKey, T, [[7.15, END, KEY, ""]], "tg");
      // 两边缓存下来的是同一个文件名：圈出来
      drawWire(W.c1, seg(T, 8.4, 8.8), v * wout); drawWire(W.c2, seg(T, 8.6, 9.0), e * wout);
      // 图到了：缩略图亮起
      [[A, 6.5], [B, 7.7]].forEach(([X, t]) => {
        const k = seg(T, t, t + 0.3);
        X.img.style.opacity = k.toFixed(3);
        X.img.style.transform = `scale(${lerp(0.5, 1, E.back(k)).toFixed(3)})`;
        X.th.style.borderStyle = k > 0 ? "solid" : ""; X.th.style.borderColor = k > 0 ? "var(--ink)" : "";
      });
      const P = [], add = (i, x) => { if (x) P[i] = x; };
      // lyjw.me：Vercel 边缘 rewrite 到 R2
      add(0, trip(W.a1, T, 4.3, 4.8, "GET", "ink"));
      add(1, trip(W.r1, T, 4.85, 5.35, "GET", "ink"));
      add(2, trip(W.r2, T, 5.45, 5.95, IMG, "c6-img"));
      add(3, trip(W.a2, T, 6.0, 6.5, IMG, "c6-img"));
      // lyjw131.com：ESA 没命中，回源
      add(4, trip(W.b1, T, 5.5, 6.0, "GET", "ink"));
      add(5, trip(W.up, T, 6.05, 6.55, "GET", "ink"));
      add(6, trip(W.dn, T, 6.65, 7.15, IMG, "c6-img"));
      add(7, trip(W.b2, T, 7.2, 7.7, IMG, "c6-img"));
      pk(P);
    };
  });
  // --- 地址就是内容的指纹 ---
  scene(c6, 10.3, 19.2, (root, s) => {
    const T0 = s.t0 - c6.t0;
    const wl = wireLayer(root);
    const pic = L("card", root);
    pic.style.cssText += ";width:200px;padding:18px 18px 12px";
    pic.innerHTML = `<div style="position:relative;width:160px;height:160px">${pixSVG(20)}</div><div class="lbl" data-k="cap" style="margin-top:8px"></div>`;
    pic.__x = 190; pic.__y = 200;
    const cells = [...pic.querySelectorAll("rect")], cap = pic.querySelector('[data-k="cap"]');
    const hash = card(root, { x: 500, y: 236, w: 420, icon: "hash", title: "sha256", mono: true, lines: [`<span class="mono" data-k="h" style="font-size:26px;font-weight:600">${KEY}</span>`] });
    const hv = hash.querySelector('[data-k="h"]');
    const addr = (y, key, rows, sub) => card(root, { x: 1030, y, w: 640, title: `<span class="c6-thumb">${pixSVG(6, rows)}</span><span class="mono" style="font-size:26px">/img/${key}</span>`, sub });
    const old = addr(200, KEY, PIX, "旧内容"), neu = addr(412, KEY2, PIX2, "新内容");
    const oldSub = old.querySelector(".sd");
    const lock = mk("span", "c6-lock", old.querySelector(".c6-thumb"), icon("lock", 16, 2.6));
    const st = stamp(old, "一年<small>IMMUTABLE</small>", "o c6-stamp");
    const pen = wireLayer(root); // 圈注压在卡片上面
    const W = {
      a: wire(wl, "M390 308 L500 308"),
      n: link(wl, hash, "r", neu, "l", { ka: 0.75 }),
      pen: wire(pen, penD(340.5, 230.5, 26, 24, 7), PEN), // 圈住要改的那个像素（第 0 行第 6 列）
    };
    return (lt) => {
      const T = lt + T0;
      relink(wl);
      const END = 18.2;
      const p = popAt(pic, T, 10.6, END, { dx: -30 });
      const h = popAt(hash, T, 10.9, END);
      // 旧地址等镜头拉回再出来：和新地址并排，各自带着自己的缩略图
      const o = popAt(old, T, 13.35, END);
      const n = dropAt(neu, T, 13.5, END, { h: 70 });
      const wout = 1 - seg(T, END - 0.15, END + 0.05);
      drawWire(W.a, seg(T, 11.0, 11.4), Math.min(p, h) * wout);
      drawWire(W.n, seg(T, 13.75, 14.15), Math.min(h, n) * wout);
      drawWire(W.pen, seg(T, 11.6, 11.95), p * (1 - seg(T, 12.8, 13.1)));
      // 改一个像素
      const flipped = T >= 12.0;
      cells[6].setAttribute("fill", flipped ? PC.Y : PC["."]);
      setText(cap, flipped ? "改了 1 个像素" : "原图");
      // 哈希重新滚动，定格成新的文件名
      setText(hv, T < 12.1 ? KEY : scramble(KEY2.replace(".png", ""), seg(T, 12.1, 13.0), 11) + ".png");
      hv.style.color = T > 12.1 && T < 13.05 ? "var(--orange-d)" : "";
      // 旧地址：上锁、盖章，缓存天数往上走，缩略图一直是旧图
      const lk = seg(T, 13.95, 14.15);
      lock.style.opacity = lk.toFixed(3);
      lock.style.transform = `scale(${lerp(0.3, 1, E.back(lk)).toFixed(3)})`;
      st(595, 58, seg(T, 14.28, 14.42), o, -7);
      const days = Math.round(365 * E.out(seg(T, 15.2, 17.6)));
      setText(oldSub, T < 15.2 ? "旧内容" : `旧内容 · 已缓存 ${days} 天`);
    };
  });
  at(c6, 0, RIGHT[0], RIGHT[1]);
  at(c6, 1.4, LEFT[0], LEFT[1]);
  look(c6, 1.4, 1);
  camera(c6, 11.2, 12.0, { x: 700, y: 380, s: 1.22 }, "sine");
  camera(c6, 12.95, 13.65, null, "sine");
  emote(c6, 12.05, "?", 1.0);
  emote(c6, 13.6, "!", 1.1);
  say(c6, 2.8, 6.8, "页面不写死域名：\n哪个域名打开，就从哪取。");
  say(c6, 7.2, 10.3, "两边的边缘各取各的，\n拿到的是同一个文件。");
  say(c6, 10.9, 13.8, "内容一变，地址就变。");
  say(c6, 14.8, 18.8, "旧地址永远是那张旧图，\n所以从不用刷新。");

  // =====================================================================
  // 07 自适应调频
  // =====================================================================
  const c7 = chapter("自适应调频", "有人在看，才值得勤快", 10);
  css(`
    .c7-sky .win-bar{height:46px}
    .c7-sky .addr{height:30px;font-size:17px}
    .c7-view{position:absolute;left:0;top:46px;width:595px;height:379px;overflow:hidden}
    .c7-sun{width:72px;height:72px;border-radius:50%;border:2.5px solid var(--ink)}
    .c7-ground{width:595px;height:91px;border-top:2.5px solid var(--ink)}
    .c7-tab{width:170px;height:112px;border:2.5px solid var(--ink);background:#fff;box-shadow:4px 4px 0 rgba(31,30,27,.15);transform-origin:50% 100%}
    .c7-tab .tb{height:18px;border-bottom:2.5px solid var(--ink);background:#FBFAF7}
    .c7-tab .tbody{height:89px;display:flex;align-items:center;justify-content:center}
    .c7-person{transform-origin:50% 100%}
    .c7-dig{width:124px;height:88px;border:2.5px solid var(--ink);background:#fff;text-align:center}
    .c7-dig .k{font:500 13px var(--mono);color:var(--muted);margin-top:7px}
    .c7-dig .v{font:700 46px/1.1 var(--mono)}
    .c7-dig .v span{display:inline-block}
    .c7-grid{position:relative;display:grid;grid-template-columns:280px repeat(3,200px) 60px;gap:10px 12px;align-items:center}
    .c7-grid>div{position:relative;z-index:1}
    .c7-hl{position:absolute;left:0;top:0;z-index:0;border:3px solid var(--orange);background:var(--orange-t);opacity:0}
    .c7-name{font-size:23px;font-weight:600;white-space:nowrap;line-height:1.2}
    .c7-name small{display:block;font:500 14px var(--mono);color:var(--muted);margin-top:2px}
    .c7-v{font-size:24px;padding:6px 10px;white-space:nowrap}
    .c7-v.c7-fixed{color:var(--faint)}
    .c7-hb{display:flex;justify-content:center}
    .c7-hb svg{display:block;transform-origin:50% 50%}
    .c7-cells{display:flex;gap:8px;margin-top:4px}
    .c7-cells i{position:relative;display:block;width:38px;height:30px;border:2px solid var(--ink);background:#fff}
    .c7-cells b{position:absolute;left:0;top:0;bottom:0;width:0;background:#D9D5CC}
    .c7-clock{display:inline-flex;transform-origin:50% 30%}
    .c7-brw{width:120px;height:80px;padding:0;box-shadow:3px 3px 0 rgba(31,30,27,.1)}
    .c7-z{font:24px/1 "Geist Pixel";color:var(--ink)}
  `);
  // 白天 → 黄昏 → 深夜 → 清晨 → 白天（面板里的平涂颜色随时间换，舞台背景不动）
  // 黄昏到深夜、深夜到清晨中间各垫一档（暮紫、拂晓蓝），免得直接插值出一段泥灰色
  const SKY = { day: [220, 234, 249], dusk: [246, 213, 181], dim: [168, 128, 150], night: [38, 41, 63], pre: [104, 112, 168], dawn: [247, 221, 192] };
  const GND = { day: [234, 230, 220], dusk: [228, 210, 190], dim: [140, 118, 120], night: [58, 59, 78], pre: [104, 104, 128], dawn: [234, 219, 199] };
  const phaseK = (P) => [[0, P.day], [7.2, P.day], [7.9, P.dusk], [9.6, P.dusk], [9.95, P.dim], [10.3, P.night], [15.6, P.night], [16.0, P.pre], [16.4, P.dawn], [16.8, P.dawn], [17.2, P.day]];
  const SKYK = phaseK(SKY), GNDK = phaseK(GND);
  const SUNK = [[0, [430, 92]], [7.2, [430, 92]], [8.0, [520, 262]], [9.6, [520, 262]], [10.2, [545, 440]], [15.5, [545, 440]], [15.55, [450, 440]], [16.4, [450, 262]], [16.8, [450, 262]], [17.2, [430, 92], "back"]];
  const SUNC = [[0, [242, 181, 65]], [7.2, [242, 181, 65]], [8.0, [232, 128, 79]], [15.5, [232, 128, 79]], [15.55, [240, 164, 90]], [16.8, [240, 164, 90]], [17.2, [242, 181, 65]]];
  const STARS = [[48, 52], [138, 118], [226, 36], [318, 96], [540, 30], [566, 168], [372, 186]];
  const LABS = [["eye", "白天 · 有人正看"], ["app-window", "黄昏 · 只开在后台"], ["moon", "深夜 · 没人"], ["user", "清晨 · 有人打开页面"]].map(([ic, t]) => `${icon(ic, 16, 2.4)}<span>${t}</span>`);
  // 限额上报器的小睡（闲档每 5 分钟醒一次再问）：第一觉慢放，之后快进；第 11 觉醒来有人了
  const NAP = [[10.6, 12.0]];
  for (let i = 1; i <= 9; i++) NAP.push([12.9 + (i - 1) * 0.3, 12.9 + i * 0.3]);
  NAP.push([15.6, 16.2]);
  // 一拍 = 一分钟：每上报一次心形跳一下。服务器上报器固定每分钟一封、不看人数，夜里也照跳；另外两个按档
  const PULSE = [
    beats(3.6, 22.8),
    [...beats(3.6, 7.8), 9.0, 16.2, ...beats(16.8, 22.8)],
    [3.6, 6.6, 16.8, 19.8, 22.8],
  ];
  // PlayStation 的 cron 每分钟响一次、每响都问两个计数；限额上报器每次小睡醒来也问
  const ASK = [...beats(3.6, 22.8), 12.35, ...NAP.slice(1, 10).map((n) => n[1]), 16.4];
  scene(c7, 1.9, 24, (root, s) => {
    const T0 = s.t0 - c7.t0;
    const wl = wireLayer(root);
    // 天空面板
    const sky = L("win c7-sky", root);
    sky.style.width = "600px"; sky.style.height = "430px";
    sky.__x = 80; sky.__y = 130;
    sky.innerHTML = `<div class="win-bar"><i class="sq"></i><i class="sq"></i><i class="sq"></i><div class="addr" data-k="lab"></div></div><div class="c7-view"></div>`;
    const view = sky.querySelector(".c7-view"), lab = sky.querySelector('[data-k="lab"]');
    const stars = STARS.map(() => L("", view, `<svg width="22" height="22" viewBox="0 0 20 20" style="display:block"><path d="M10 0L12.6 7.4 20 10 12.6 12.6 10 20 7.4 12.6 0 10 7.4 7.4Z" fill="#F6EFD9"/></svg>`));
    const moon = L("", view, `<svg width="64" height="64" viewBox="0 0 24 24" fill="#F6EFD9" stroke="#1F1E1B" stroke-width="1.6" stroke-linejoin="round" style="display:block">${ICONS.moon}</svg>`);
    const sun = L("c7-sun", view);
    const ground = L("c7-ground", view);
    const tab = L("c7-tab", view, `<div class="tb"></div><div class="tbody">${icon("eye", 38, 2.2)}</div>`);
    const tabBody = tab.querySelector(".tbody");
    const person = L("c7-person", view, icon("user", 84, 2.2));
    // 两个计数
    const counter = (x, tint, ic, title, sub, key) => {
      const c = card(root, { x, y: 130, w: 530, tint, icon: ic, title, mono: true, sub });
      c.querySelector(".hd").style.fontSize = "24px";
      const box = L("c7-dig", c, `<div class="k">${key}</div><div class="v"><span>1</span></div>`);
      place(box, 381, 14, 1);
      return { c, box, v: box.querySelector(".v span") };
    };
    const cA = counter(740, "orange", "radio", "API Worker /count", "推送连接 · 含后台", "connections");
    const cB = counter(1300, "blue", "eye", "在线人数 /count", "可见页面", "online");
    // 三档表
    // 服务器上报器是对照行：固定每分钟，三档一样（置灰）
    const ROWS = [["服务器上报器", "固定每分钟 · 不问人数", "60 秒", "60 秒", "60 秒", true], ["PlayStation 上报器", "每分钟 cron + 门控", "约 1 分钟", "约 2 分钟", "约 30 分钟"], ["限额上报器", "", "5 分钟", "10 分钟", "60 分钟"]];
    const HEART = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1F1E1B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS.heart}</svg>`;
    const tbl = L("card", root);
    tbl.style.cssText += ";width:1050px;padding:14px 22px";
    tbl.__x = 740; tbl.__y = 290;
    tbl.innerHTML = `<div class="c7-grid"><i class="c7-hl"></i>
      <div class="lbl">上报器</div><div class="lbl b" data-c="0">快档 · 有人正看</div><div class="lbl b" data-c="1">中档 · 只开在后台</div><div class="lbl b" data-c="2">闲档 · 没人</div><div class="lbl">上报</div>
      ${ROWS.map((r) => `<div class="c7-name">${r[0]}${r[1] ? `<small>${r[1]}</small>` : ""}</div>${r.slice(2, 5).map((v, j) => `<div class="mono c7-v${r[5] ? " c7-fixed" : ""}" data-c="${j}">${v}</div>`).join("")}<div class="c7-hb">${HEART}</div>`).join("")}</div>`;
    const hlBar = tbl.querySelector(".c7-hl");
    const hearts = [...tbl.querySelectorAll(".c7-hb svg")];
    const colEls = [0, 1, 2].map((i) => [...tbl.querySelectorAll(`[data-c="${i}"]`)]);
    // 小睡
    const naps = card(root, { x: 1080, y: 620, w: 730, pad: "14px 18px",
      title: `<span class="c7-clock">${icon("timer", 26, 2.2)}</span><span class="lbl b" style="font-size:19px">限额上报器：闲档 60 分钟 = 12 次 5 分钟小睡</span>`,
      lines: [`<div class="c7-cells">${Array.from({ length: 12 }, () => "<i><b></b></i>").join("")}</div>`] });
    const clockEl = naps.querySelector(".c7-clock");
    const cellEls = [...naps.querySelectorAll(".c7-cells i")];
    // 推送房间休眠：ping 由运行时代答
    const brw = L("card c7-brw", root, `<div style="height:14px;border-bottom:2px solid var(--ink);background:#FBFAF7"></div><div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px"><i style="height:7px;background:#E6E3DC;display:block"></i><i style="height:7px;width:60%;background:#E6E3DC;display:block"></i><i style="height:7px;width:80%;background:#E6E3DC;display:block"></i></div>`);
    brw.__x = 1080; brw.__y = 706;
    const shield = card(root, { x: 1400, y: 686, w: 190, tint: "green", icon: "shield-check", title: "运行时" });
    shield.querySelector(".hd").style.fontSize = "24px";
    const shIc = shield.querySelector(".ic");
    const room = card(root, { x: 1610, y: 662, w: 250, tint: "orange", icon: "moon", title: "LivePushRoom", mono: true, sub: "WebSocket 休眠" });
    room.querySelector(".hd").style.fontSize = "20px";
    const roomIc = room.querySelector(".ic");
    // 房间睡着：图标位挂一弯实心月亮
    roomIc.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24" fill="#F2C14E" stroke="#1F1E1B" stroke-width="1.8" stroke-linejoin="round">${ICONS.moon}</svg>`;
    const zs = [0, 1, 2].map(() => L("c7-z", room, "z"));
    const W = { ping: wire(wl, "M1200 728 L1400 728"), pong: wire(wl, "M1400 758 L1200 758") };
    const pk = packets(root, 3);
    let G = null;
    return (lt) => {
      const T = lt + T0;
      relink(wl);
      if (!G) {
        const hd = colEls.map((els) => els[0]), last = colEls[0][3];
        const top = hd[0].offsetTop - 8;
        G = { x: hd.map((h) => h.offsetLeft - 6), w: hd[0].offsetWidth + 12, top, h: last.offsetTop + last.offsetHeight + 8 - top };
      }
      const END = 23.0;
      popAt(sky, T, 2.2, END);
      popAt(cA.c, T, 2.5, END); popAt(cB.c, T, 2.7, END);
      popAt(tbl, T, 3.0, END);

      // --- 天空：颜色、太阳、月亮、星星 ---
      view.style.background = rgb(kf(SKYK, T));
      place(ground, 0, 288, 1); ground.style.background = rgb(kf(GNDK, T));
      const [sx, sy] = kf(SUNK, T);
      sun.style.background = rgb(kf(SUNC, T));
      place(sun, sx - 36, sy - 36, 1);
      place(moon, 440, 44 + 4 * Math.sin(T * 1.7), seg(T, 9.9, 10.5) * (1 - seg(T, 15.6, 16.2)));
      stars.forEach((st, i) => {
        const o = seg(T, 10.0 + i * 0.08, 10.4 + i * 0.08) * (1 - seg(T, 15.6, 16.0)), tw = 0.75 + 0.25 * Math.sin(T * 5 + i * 1.9);
        place(st, STARS[i][0] - 11, STARS[i][1] - 11, o * tw, `scale(${(0.8 + 0.3 * tw).toFixed(3)})`);
      });
      // 标签跟天色走：在每段换色的中点才换字
      setHTML(lab, LABS[T < 7.55 ? 0 : T < 9.95 ? 1 : T < 15.7 ? 2 : T < 17.0 ? 3 : 0]); // 清晨：人和标签页回来的那一刻
      // 标签页：白天亮着、黄昏变灰（切到后台）、夜里关掉、清晨重新打开
      const dim = T < 15.6 ? seg(T, 7.3, 7.7) : 0, close = seg(T, 9.7, 10.0), reopen = seg(T, 15.6, 15.9);
      tab.style.background = dim > 0 ? rgb([lerp(255, 217, dim), lerp(255, 213, dim), lerp(255, 204, dim)]) : "#fff";
      tabBody.style.opacity = (1 - 0.65 * dim).toFixed(3);
      if (T < 15.6) place(tab, 58, 176, 1 - close, `scale(${(lerp(1, 0.92, dim) * lerp(1, 0.6, E.in(close))).toFixed(3)})`);
      else place(tab, 58, 176, reopen, `scale(${lerp(0.6, 1, E.back(reopen)).toFixed(3)})`);
      // 人：黄昏走开，清晨回来
      const leave = seg(T, 7.3, 7.8), come = seg(T, 15.6, 15.95);
      if (T < 15.6) place(person, 262 + 60 * E.in(leave), 204, 1 - leave);
      else place(person, 262, 204, come, `scale(${lerp(0.6, 1, E.back(come)).toFixed(3)})`);

      // --- 计数：被问到时闪一下，变化时翻牌 ---
      const asked = T > 3.5 && ASK.some((t) => T >= t && T < t + 0.25);
      [cA, cB].forEach((X) => { X.box.style.outline = asked ? "4px solid rgba(217,119,87,.55)" : ""; X.box.style.outlineOffset = asked ? "2px" : ""; });
      flipNum(cA.v, T, [[0, 1], [9.9, 0], [15.8, 1]]);
      flipNum(cB.v, T, [[0, 1], [7.6, 0], [15.7, 1]]);

      // --- 三档表：高亮条在列之间滑；有人来时一下弹回快档 ---
      const col = kf([[3.3, 0], [7.8, 0], [8.3, 1], [10.2, 1], [10.7, 2], [16.8, 2], [17.15, 0, "back"]], T);
      hlBar.style.width = G.w + "px"; hlBar.style.height = G.h + "px";
      hlBar.style.transform = `translate(${(G.x[0] + col * (G.x[1] - G.x[0])).toFixed(1)}px, ${G.top}px)`;
      hlBar.style.opacity = seg(T, 3.3, 3.6).toFixed(3);
      // 高亮条停稳在哪一列，哪一列的字才变橙（一路滑过的列不亮）
      colEls.forEach((els, i) => els.forEach((el) => { el.style.color = !el.classList.contains("c7-fixed") && T > 3.35 && Math.abs(col - i) < 0.15 ? "var(--orange-d)" : ""; }));
      hearts.forEach((hEl, i) => {
        let k = -1;
        for (const p of PULSE[i]) if (T >= p && T < p + 0.35) k = (T - p) / 0.35;
        hEl.style.transform = k >= 0 ? `scale(${(1 + 0.4 * Math.sin(Math.PI * k)).toFixed(3)})` : "";
        hEl.setAttribute("fill", k >= 0 ? `rgba(217,119,87,${(1 - 0.6 * k).toFixed(2)})` : "none");
      });

      // --- 小睡格：一格一觉；醒来有人就立刻开跑，剩下的不睡了 ---
      popAt(naps, T, 10.4, 18.0);
      cellEls.forEach((c, i) => {
        const f = i < NAP.length ? seg(T, NAP[i][0], NAP[i][1]) : 0, skip = i > 10 ? seg(T, 16.8, 17.1) : 0;
        c.firstChild.style.width = (f * 100).toFixed(1) + "%";
        c.firstChild.style.background = i === 10 && T >= 16.8 ? "var(--green)" : "";
        c.style.borderStyle = skip > 0.5 ? "dashed" : "";
        c.style.borderColor = skip > 0.5 ? "#B3AC9F" : "";
        c.style.opacity = (1 - 0.5 * skip).toFixed(3);
      });
      const ringing = (T > 12.0 && T < 12.55) || (T > 16.2 && T < 16.75);
      clockEl.style.transform = ringing ? `rotate(${(16 * Math.sin(T * 62)).toFixed(1)}deg)` : "";
      clockEl.style.color = ringing ? "var(--orange-d)" : "";

      // --- 推送房间：月亮挂着、z 往上冒；ping 飞来由运行时回 pong，房间接着睡 ---
      const bw = popAt(brw, T, 18.4, END), sh = popAt(shield, T, 18.6, END);
      popAt(room, T, 18.8, END);
      const wout = 1 - seg(T, END - 0.15, END + 0.05);
      drawWire(W.ping, seg(T, 19.0, 19.4), Math.min(bw, sh) * wout); drawWire(W.pong, seg(T, 19.1, 19.5), Math.min(bw, sh) * wout);
      roomIc.style.transform = `rotate(${(6 * Math.sin(T * 1.8)).toFixed(1)}deg)`;
      zs.forEach((z, i) => {
        const u = (((T - 19.5) / 1.8 + i / 3) % 1 + 1) % 1;
        place(z, 62 + 30 * u + i * 4, 4 - 60 * u, Math.sin(Math.PI * u) * seg(T, 19.5, 19.9), `scale(${(0.7 + 0.6 * u).toFixed(3)})`);
      });
      const guard = [20.1, 21.9].some((t) => T >= t && T < t + 0.35);
      shield.style.borderColor = guard ? "var(--green)" : "";
      shIc.style.background = guard ? "var(--green)" : ""; shIc.style.color = guard ? "#fff" : "";
      const P = [], add = (i, x) => { if (x) P[i] = x; };
      add(0, trip(W.ping, T, 19.5, 20.1, "ping", "ink")); add(1, trip(W.pong, T, 20.15, 20.75, "pong", "green"));
      add(0, trip(W.ping, T, 21.3, 21.9, "ping", "ink")); add(1, trip(W.pong, T, 21.95, 22.55, "pong", "green"));
      pk(P);
    };
  });
  at(c7, 0, LEFT[0], LEFT[1]);
  look(c7, 0.5, 1);
  // 夜里：Clawd 当限额上报器，蹲下打盹；闹钟响醒来看一眼计数，还是 0，接着睡
  hold(c7, 10.6, 12.0, { pose: "default", offset: 1 });
  emote(c7, 10.65, "z", 1.1, { dx: -150 });
  emote(c7, 12.05, "?", 1.0);
  act(c7, 12.15, "look");
  hold(c7, 12.9, 16.2, { pose: "default", offset: 1 });
  emote(c7, 13.0, "z", 2.6, { dx: -150 });
  // 清晨：有人打开页面，下次醒来立刻开跑
  emote(c7, 16.8, "!", 1.2);
  act(c7, 16.8, "jump");
  say(c7, 2.8, 6.8, "PlayStation 和限额上报器：\n先问两边人数，再定多久跑一轮。");
  say(c7, 7.2, 10.4, "没人看就放慢，\n但会定时醒来再问。");
  say(c7, 17.2, 19.6, "有人一来，下次醒来就开跑。");
  say(c7, 19.9, 23.6, "推送房间没事就睡，\n保活的 {ping} 叫不醒它。");

  // ---------- 音效（只放语义化的；弹出、数据包、连线、印章由引擎按画面自动生成） ----------
  // 大陆访问
  sfx(c5, 4.2, "zap", { x: 800 });
  [5.4, 6.0, 6.6].forEach((t) => sfx(c5, t, "clock"));
  sfx(c5, 11.3, "err", { x: 1400 });
  burst(c5, 11.3, 1400, 267, "spark", { color: "#C8453A", r: 160, reach: 40, len: 0.8 });
  sfx(c5, 13.2, "ok", { x: 290 });
  sfx(c5, 13.95, "swoosh", { x: 650 });
  duck(c5, 14.4);
  burst(c5, 14.4, 562, 356, "dust", { n: 20, speed: 1.5 });
  shake(c5, 14.4, 6, 0.3);
  sfx(c5, 16.0, "coin", { x: 650 });
  // 图片链路
  sfx(c6, 12.0, "flip", { x: 340 });
  sfx(c6, 12.1, "hash", { x: 710 });
  sfx(c6, 13.95, "click", { x: 1090 });
  duck(c6, 14.4);
  // 奇数条冲击线：避开正左方那一条，不扫到地址文字
  burst(c6, 14.4, 1627, 260, "spark", { n: 9, r: 150, reach: 44, len: 0.8 });
  shake(c6, 14.4, 10);
  [15.6, 16.2, 16.8, 17.4].forEach((t) => sfx(c6, t, "clock"));
  // 自适应调频
  sfx(c7, 3.6, "heartbeat", { x: 1760 });
  sfx(c7, 7.6, "flip", { x: 1740 }); sfx(c7, 7.8, "down");
  sfx(c7, 9.9, "flip", { x: 1180 }); sfx(c7, 10.2, "down");
  sfx(c7, 12.0, "alarm", { x: 1110 });
  NAP.slice(1, 10).forEach((n) => sfx(c7, n[1], "clock"));
  sfx(c7, 15.7, "flip", { x: 1740 }); sfx(c7, 15.8, "flip", { x: 1180 });
  sfx(c7, 16.2, "alarm", { x: 1110 });
  duck(c7, 16.8);
  sfx(c7, 16.8, "up");
  burst(c7, 16.85, 450, 262, "stars", { n: 10, r: 110 }); // 围着刚升起的太阳，不压表格
  shake(c7, 16.8, 6, 0.3);
  sfx(c7, 17.4, "heartbeat", { x: 1760 });

  // =====================================================================
  // 08 站点自检（8 小节，19.2 s）：每分钟两个方向相反的信号，结果再取回卡片
  // Sentry 来敲门（在线探测 HEAD /api/version，只能说明页面还在出）；
  // Worker 去报到（cron 每分钟跑，每 5 分钟那一轮跑完才报到，途中会叫 Durable Object 排队重建读模型；KV 是之后才写的）
  // =====================================================================
  const cS = chapter("站点自检", "报错和在线，交给 Sentry", 8);
  css(`
    .s8-mk{width:54px;height:54px;border:2px solid var(--ink);background:#fff;display:flex;align-items:center;justify-content:center;flex:none;color:#362D59}
    .s8-chain{display:flex;align-items:center;gap:8px;margin-top:12px}
    .s8-chain b{font:600 17px var(--mono);border:2px solid var(--line);padding:3px 10px;background:#fff;color:var(--muted);white-space:nowrap}
    .s8-chain i{color:var(--faint);font-style:normal;font-size:18px}
    .s8-panel{width:780px;padding:18px 24px 20px}
    .s8-top{display:flex;align-items:baseline;gap:14px;white-space:nowrap}
    .s8-top b{font:700 26px var(--mono)}
    .s8-top span{font-size:19px;color:var(--muted)}
    .s8-row{margin-top:16px}
    .s8-rh{display:flex;align-items:baseline;justify-content:space-between;font-size:22px;font-weight:600}
    .s8-rh span{font:500 17px var(--mono);color:var(--green)}
    .s8-cells{display:flex;gap:4px;height:30px;margin-top:10px}
    .s8-cells i{flex:1;border-radius:3px;background:#E6E3DC}
    .s8-note{font-size:17px;color:var(--muted);margin-top:8px;white-space:nowrap}
  `);
  // Sentry 标（Simple Icons，CC0；站点 sentry-mark.tsx 用的同一份）
  const SENTRY_MARK = `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z"/></svg>`;
  // 敲门（探测，每分钟）和报到（心跳，每 5 分钟一次，比敲门稀）；中间 11–14 s 是取回结果那一段，信号先停一停
  const PROBES = [3.2, 5.6, 8.0, 10.4, 14.4, 16.8], BEATS = [6.8, 15.6];
  scene(cS, 1.9, 19.2, (root, s) => {
    const T0 = s.t0 - cS.t0;
    const wl = wireLayer(root);
    const site = card(root, { x: 90, y: 240, w: 300, tint: "green", icon: "globe", title: "lyjw.me", sub: "Vercel · 出页面" });
    const sentry = card(root, { x: 770, y: 240, w: 380, tint: "purple", title: `<span class="s8-mk">${SENTRY_MARK}</span><span>Sentry</span>`, sub: "报错 · 性能 · 在线" });
    const worker = card(root, { x: 1470, y: 240, w: 360, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "分钟 cron",
      lines: [`<div class="s8-chain"><b>cron</b><i>→</i><b>DO</b></div>`] });
    worker.querySelector(".hd").style.fontSize = "24px";
    const chain = [...worker.querySelectorAll(".s8-chain b")];
    const tProbe = L("tg p", root, "在线探测 · 每分钟"), tBeat = L("tg o", root, "cron 心跳 · 每 5 分钟");
    const kvTag = L("tg", root, "KV 读模型");
    const ok = L("tg g", root, "200");
    const cells = (n) => Array.from({ length: n }, () => "<i></i>").join("");
    const panel = L("card s8-panel", root);
    panel.innerHTML = `<div class="s8-top"><b>LYJWPAGE</b><span>站点卡片里的在线状态</span></div>` +
      `<div class="s8-row"><div class="s8-rh">lyjw.me<span>Operational</span></div><div class="s8-cells">${cells(30)}</div><div class="s8-note">Sentry 每分钟来敲门 · 只说明页面还在出</div></div>` +
      `<div class="s8-row"><div class="s8-rh">API<span>Operational</span></div><div class="s8-cells">${cells(30)}</div><div class="s8-note">Worker 每 5 分钟去报到 · cron 跑完一整轮才算</div></div>`;
    panel.__x = 1060; panel.__y = 560;
    const rows = [...panel.querySelectorAll(".s8-cells")].map((r) => [...r.children]);
    const jo = { color: "#1F1E1B", opacity: 0.42 };
    const W = {
      probe: wire(wl, "M770 282 L390 282"), // Sentry → lyjw.me：HEAD /api/version
      beat: wire(wl, "M1470 282 L1150 282"), // Worker → Sentry：心跳；取数时也走这条
      back: wire(wl, "M1150 318 L1470 318"), // Sentry → Worker：取回的结果
      down: link(wl, worker, "b", panel, "t", jo), // Worker → 卡片：/api/status/sentry
    };
    const pk = packets(root, 6);
    let ready = false;
    return (lt) => {
      const T = lt + T0;
      if (!ready) {
        ready = true;
        jo.ka = 0.5; jo.kb = (worker.__x + worker.offsetWidth / 2 - panel.__x) / panel.offsetWidth; // 竖直落到卡片顶边
        relink(wl);
      }
      const END = 18.5;
      const vS = popAt(site, T, 2.1, END), vY = popAt(sentry, T, 2.3, END), vW = popAt(worker, T, 2.5, END);
      const wout = 1 - seg(T, END - 0.15, END + 0.05);
      drawWire(W.probe, seg(T, 2.75, 3.1), Math.min(vS, vY) * wout);
      drawWire(W.beat, seg(T, 2.85, 3.2), Math.min(vY, vW) * wout);
      drawWire(W.back, seg(T, 11.75, 12.0), Math.min(vY, vW) * wout);
      popAt(tProbe, T, 2.95, END, { x: 580 - tProbe.offsetWidth / 2, y: 226 });
      popAt(tBeat, T, 3.1, END, { x: 1310 - tBeat.offsetWidth / 2, y: 226 });
      // 敲门：包到了，lyjw.me 回个 200（卡片描一下绿边）
      const hitS = PROBES.find((t) => T >= t + 0.55 && T < t + 1.35);
      site.style.outline = hitS != null && T < hitS + 0.9 ? "4px solid rgba(46,158,79,.55)" : ""; site.style.outlineOffset = "3px";
      if (hitS != null) popAt(ok, T, hitS + 0.55, hitS + 0.95, { x: 212, y: 196, d: 0.2 }); else show(ok, 0);
      // 报到：cron 这一轮跑完（途中叫 DO 排队），再发心跳
      let lit = -1;
      BEATS.forEach((t) => { for (let i = 0; i < 2; i++) if (T >= t - 0.45 + i * 0.18 && T < t - 0.45 + i * 0.18 + 0.3) lit = i; });
      const store = T >= 12.45 && T < 12.85; // 取回的结果写进 KV 读模型
      const vK = popAt(kvTag, T, 12.4, END, { x: worker.__x + worker.offsetWidth / 2 + 16, y: 470 });
      kvTag.style.background = store ? "var(--orange-t)" : ""; kvTag.style.borderColor = store ? "var(--orange)" : "";
      chain.forEach((b, i) => {
        const on = lit === i;
        b.style.borderColor = on ? "var(--orange)" : ""; b.style.color = on ? "var(--orange-d)" : ""; b.style.background = on ? "var(--orange-t)" : "";
      });
      sentry.style.outline = T > 11.7 && T < 12.0 ? "4px solid rgba(116,88,210,.55)" : ""; sentry.style.outlineOffset = "3px";
      // 卡片：取回之后出现，一天一格填上；之后每次敲门 / 报到，今天那一格亮一下
      const vP = popAt(panel, T, 13.05, END);
      wv2(W.down, seg(T, 12.6, 12.9), T, END, vW, vP);
      rows.forEach((cs, r) => cs.forEach((c, i) => {
        const on = T >= 13.4 + r * 0.2 + i * 0.026;
        const today = i === cs.length - 1 && (r === 0 ? PROBES : BEATS).some((t) => T >= t + (r ? 0.5 : 0.55) && T < t + (r ? 0.5 : 0.55) + 0.4) && T > 14;
        c.style.background = today ? "#1F7A3D" : on ? "var(--green)" : "";
      }));
      const P = [], add = (i, x) => { if (x) P[i] = x; };
      PROBES.forEach((t) => add(0, trip(W.probe, T, t, t + 0.55, "HEAD /api/version", "purple")));
      BEATS.forEach((t) => add(1, trip(W.beat, T, t, t + 0.5, "心跳", "")));
      add(2, trip(W.beat, T, 11.15, 11.7, "只读令牌 · 取数", "ink"));
      add(3, trip(W.back, T, 11.9, 12.45, "报错 · 在线 · 性能", "green"));
      add(4, trip(W.down, T, 12.75, 13.25, "/api/status/sentry", "ink", 0.2));
      pk(P);
    };
  });
  // 挂在上下边的线：卡片淡出时会上浮 10px，线要先收掉
  function wv2(p, k, T, out, ...vs) { drawWire(p, k, Math.min(1, ...vs) * (1 - seg(T, out, out + 0.1))); }
  at(cS, 0, LEFT[0], LEFT[1]);
  look(cS, 0.5, 1);
  emote(cS, 13.2, "spark", 1.0);
  say(cS, 2.6, 6.6, "两个信号，方向相反：Sentry 每分钟\n来敲门，Worker 每 5 分钟去报到。");
  say(cS, 7.0, 10.8, "敲门只说明页面还在出；\n报到说明 cron 跑完了一整轮。");
  say(cS, 12.2, 16.0, "Worker 用只读令牌取回结果，\n变成卡片上的两行在线状态。");
  say(cS, 16.05, 18.6, "线上出错时，\n我先来这儿查证据。");
})();
