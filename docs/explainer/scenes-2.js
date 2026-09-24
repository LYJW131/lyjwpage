// 03 首屏缓存 · 04 实时推送
(() => {
  const { E, clamp, seg, lerp, L, icon, place, show, setHTML, setText, svgEl, chapter, scene, say, at, act, hold, look, sfx, duck, emote, burst, camera, shake } = Engine;
  const { css, card, popAt, wireLayer, link, relink, drawWire, along, packets, stamp, penCircle, penLine, ring, siteMock } = Kit;
  const LEFT = [250, 975], RIGHT = [1670, 975];
  const pt = (p, f) => { const q = along(p, f); return { x: q.x, y: q.y }; };
  const mono = (s, sz = 19) => `<span class="mono" style="font-size:${sz}px">${s}</span>`;
  // 描边高亮（卡片、主页复刻里的小卡）
  const hot = (el, on, rgb = "46,158,79", w = 4, off = 3) => {
    el.style.outline = on ? `${w}px solid rgba(${rgb},.85)` : "";
    el.style.outlineOffset = on ? off + "px" : "";
  };
  // 主页复刻去掉浏览器栏：当作「存在服务器上的一份 HTML」
  function chromeless(H) {
    H.el.style.boxShadow = "none";
    H.el.querySelector(".win-bar").style.display = "none";
    H.el.children[1].style.top = "0px";
    H.el.style.height = H.H - 46 + "px";
  }
  // 主页复刻里那张取数失败的小卡：变灰、变淡
  function gray(el, on) { el.style.filter = on ? "grayscale(1)" : ""; if (on) el.style.opacity = (+el.style.opacity * 0.5).toFixed(3); }
  // 淡化聚焦：非重点整体压暗
  const dim = (el, k) => { if (el.style.visibility !== "hidden") el.style.opacity = (+(el.style.opacity || 1) * k).toFixed(3); };
  // drawWire 在 k=0 时圆头线帽会留一个点：没画出来就整体透明
  const dw = (p, k, o = 1) => drawWire(p, k, o * clamp(k * 25));
  // 圈注、下划线：压在卡片上面，放进零尺寸的 div（它们是笔迹，不是连线）
  function penLayer(root) {
    const d = L("", root);
    const sv = svgEl("svg", { width: 1920, height: 1080, class: "L" }, d);
    sv.style.overflow = "visible";
    sv.__box = d;
    show(d, 0);
    return sv;
  }
  // 笔迹层整体可见度：只在有笔迹的时段打开（渐变，不突跳）
  const penOn = (sv, o) => show(sv.__box, clamp(o));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  css(`
    .b-cell{width:46px;height:40px;border:2px solid var(--ink);background:#fff}
    .b-stripe{background:repeating-linear-gradient(45deg,#E8B04A 0 10px,#F4D494 10px 20px) !important}
    .b-tally{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-weight:700;font-size:19px;color:#fff;background:var(--ink);padding:4px 11px;white-space:nowrap}
    .b-tri{width:0;height:0;margin:2px auto 0;border-left:11px solid transparent;border-right:11px solid transparent;border-top:15px solid var(--ink)}
    .b-mark{text-align:center;white-space:nowrap}
    .b-mark i{display:block;width:4px;height:34px;background:var(--ink);margin:0 auto}
    .b-mark b{display:block;font-size:26px;font-weight:600;margin-top:8px}
    .b-mark span{display:block;font-family:var(--mono);font-size:17px;color:var(--muted);margin-top:2px}
    .b-row{border:2px solid var(--line);background:rgba(255,255,255,.7);padding:12px 16px}
    .b-row .h{display:flex;align-items:center;justify-content:space-between;font-size:25px;font-weight:700}
    .b-row .s{font-size:18px;color:var(--muted);margin-top:8px;white-space:nowrap}
    .b-x{width:44px;height:44px;border:2.5px solid var(--red);background:#fff;color:var(--red);display:flex;align-items:center;justify-content:center}
    .b-tabs{height:50px;border-bottom:2.5px solid var(--ink);background:#FBFAF7;position:relative}
    .b-tab{position:absolute;top:9px;height:41px;width:170px;display:flex;align-items:center;gap:8px;padding:0 14px;font-family:var(--mono);font-size:17px;color:var(--faint);white-space:nowrap}
    .b-tab.on{background:#fff;border:2.5px solid var(--ink);border-bottom:0;color:var(--ink);height:43.5px}
    .b-prow{display:flex;align-items:center;gap:16px;font-size:25px;white-space:nowrap}
    .b-prow .v{margin-left:auto;font-family:var(--mono);font-size:23px}
  `);

  // =====================================================================
  // 03 首屏缓存
  // =====================================================================
  const c3 = chapter("首屏缓存", "Vercel 上的 Next.js", 14);
  // 本章打击点（章节内时间，都在拍上；12.0 / 28.8 是小节头）。印章从 H−0.18 开始砸，H 那一刻落到纸面（引擎在落纸时配音）
  const IX0 = 110, IY0 = 650;
  const H3 = { fail: 5.4, hit: 12.0, page: 12.6, stale: 18.0, old: 19.2, done: 21.0, plug: 26.4, expire: 28.8, no: 31.2 };

  // --- 首屏怎么来的：一次 /api/home、24 个读取、缓存命中 ---
  scene(c3, 1.8, 15.6, (root) => {
    const T0 = 1.8, OUT = 15.0;
    const wl = wireLayer(root);
    // 上排是服务端（Vercel ⇄ Worker），左下是访客的浏览器
    const VX = 520, VY = 140, VW = 500, VH = 500;
    const vercel = card(root, { x: VX, y: VY, w: VW, h: VH, tint: "green", icon: "globe", title: "Vercel · Next.js" });
    const cap = L("lbl", vercel, "首屏 HTML");
    const uc = L("tg", vercel, `${icon("lock", 14, 2.4)}use cache`);
    const VP = siteMock(vercel, { scale: 0.4, viewH: 900 });
    chromeless(VP);
    // 首屏以下的卡在这份 HTML 里用不到
    VP.cards.activity.style.visibility = "hidden"; VP.cards.server.style.visibility = "hidden";
    const PGX = (VW - 5 - VP.W) / 2, PGY = 110;
    place(VP.el, PGX, PGY, 1);
    const KX = 1330, KY = 190, KW = 470, KH = 400;
    const worker = card(root, { x: KX, y: KY, w: KW, h: KH, tint: "orange", icon: "cloud", title: "API Worker", mono: true });
    const CW = 54, CH = 50, CG = 12, GX = (KW - 5 - (6 * CW + 5 * CG)) / 2, GY = 100, FAIL = 9;
    const cells = Array.from({ length: 24 }, (_, i) => {
      const c = L("b-cell", worker);
      c.__c = i % 6; c.__r = Math.floor(i / 6);
      c.style.cssText += `;width:${CW}px;height:${CH}px;transform-origin:50% 50%`;
      return c;
    });
    const gridLbl = L("lbl", worker, "24 个读取 · 并行");
    const IX = IX0, IY = IY0;
    const VIS = siteMock(root, { scale: 0.34, viewH: 700 });
    VIS.el.__x = IX; VIS.el.__y = IY;
    const W = {
      api: link(wl, vercel, "r", worker, "l", { ka: 0.3, kb: 0.25 }),
      back: link(wl, worker, "l", vercel, "r", { ka: 0.7, kb: 0.66 }),
      // 两条弧线套在一起不交叉：请求走里圈，HTML 走外圈
      req: link(wl, VIS.el, "t", vercel, "l", { ka: 0.6, kb: 0.84 }),
      res: link(wl, vercel, "l", VIS.el, "t", { ka: 0.66, kb: 0.26 }),
    };
    const na = L("tg r", vercel, "不可用");
    const hit = stamp(vercel, "命中", "g");
    const fast = L("stag", root, `${icon("zap", 18, 2.2)}秒开`);
    const pl = penLayer(root);
    const PG0 = { x: VX + 2.5 + PGX + 2.5, y: VY + 2.5 + PGY + 2.5 };
    const wr = VP.rect("watching", PG0.x, PG0.y - 46);
    const penCard = penCircle(pl, wr.x + wr.w / 2, wr.y + wr.h / 2, wr.w / 2 + 20, wr.h / 2 + 18, { seed: 3 });
    const failX = KX + 2.5 + GX + 3 * (CW + CG) + CW / 2, failY = KY + 2.5 + GY + (CH + CG) + CH / 2;
    const penCell = penCircle(pl, failX, failY, 48, 42, { seed: 6 });
    const pk = packets(root, 4);
    const KEYS = ["contact", "clock", "watching", "charger", "listening"];
    let m = null;
    return (lt) => {
      const t = lt + T0;
      relink(wl);
      if (!m) m = { uc: uc.offsetWidth, gl: gridLbl.offsetWidth, na: na.offsetWidth };
      const wf = 1 - seg(t, OUT - 0.2, OUT + 0.05);
      const ov = popAt(vercel, t, 2.35, OUT, { dx: -30 });
      const ow = popAt(worker, t, 2.6, OUT);
      dw(W.api, seg(t, 2.95, 3.3), Math.min(ov, ow, wf));
      dw(W.back, seg(t, 2.95, 3.3), Math.min(ov, ow, wf));
      place(cap, PGX, 78, 1);
      // use cache：快照渲染完、存进缓存那一刻变绿
      const kc = seg(t, 9.6, 9.85);
      uc.className = "L tg" + (t >= 9.6 ? " g" : "");
      uc.style.transformOrigin = "100% 50%";
      place(uc, VW - 5 - PGX - m.uc, 74, 1, `scale(${(1 + 0.18 * Math.sin(Math.PI * kc)).toFixed(3)})`);
      // Vercel 里的首屏：快照回来才一张张渲染出来；watching 那张取数失败
      const cin = { activity: 0, server: 0 };
      KEYS.forEach((k, i) => (cin[k] = seg(t, 7.45 + i * 0.1, 7.75 + i * 0.1)));
      VP.update({ t, cardsIn: cin });
      gray(VP.cards.watching, t > 7.4);
      place(na, wr.x + wr.w / 2 - VX - 2.5 - m.na / 2, wr.y + wr.h / 2 - VY - 2.5 - 15, clamp(seg(t, 7.9, 8.1) * 5) * (1 - seg(t, 11.0, 11.3)),
        `scale(${lerp(0.6, 1, E.back(seg(t, 7.9, 8.15))).toFixed(3)})`);
      // Worker 里 24 个读取：斜向波浪亮起，一格挂住、变红
      cells.forEach((c, i) => {
        const d = H3.fail - 0.6 + 0.07 * (c.__c + c.__r), k = seg(t, d, d + 0.18);
        const fail = i === FAIL, on = t >= d;
        const red = fail && t >= H3.fail, pend = fail && on && !red;
        c.style.background = red ? "var(--red-t)" : pend ? "var(--amber-t)" : on ? "var(--green-t)" : "#fff";
        c.style.borderColor = red ? "var(--red)" : pend ? "var(--amber)" : on ? "var(--green)" : "var(--ink)";
        const pulse = pend ? 0.08 * Math.sin((t - d) * 26) : 0;
        const kr = seg(t, H3.fail, H3.fail + 0.2);
        const sc = 1 + 0.16 * Math.sin(Math.PI * k) + pulse + (fail ? 0.22 * Math.sin(Math.PI * kr) : 0);
        place(c, GX + c.__c * (CW + CG), GY + c.__r * (CH + CG), 1, `scale(${sc.toFixed(3)})`);
      });
      place(gridLbl, (KW - 5 - m.gl) / 2, GY + 4 * CH + 3 * CG + 22, 1);
      penOn(pl, Math.min(seg(t, 8.15, 8.3), 1 - seg(t, 11.0, 11.3)));
      dw(penCard, seg(t, 8.2, 8.7), 1 - seg(t, 11.0, 11.3));
      dw(penCell, seg(t, 8.3, 8.8), 1 - seg(t, 11.0, 11.3));
      // 访客：打开 lyjw.me，Vercel 直接把这份给他
      const oi = popAt(VIS.el, t, 10.2, OUT, { dy: 30, x: IX, y: IY });
      const vin = {};
      KEYS.forEach((k) => (vin[k] = seg(t, H3.page, H3.page + 0.12)));
      VIS.update({ t, cardsIn: vin });
      gray(VIS.cards.watching, true);
      dw(W.req, seg(t, 10.5, 10.9), Math.min(oi, ov, wf));
      dw(W.res, seg(t, 10.5, 10.9), Math.min(oi, ov, wf));
      hit(PGX + VP.W / 2, PGY + (VP.H - 46) / 2, seg(t, H3.hit - 0.18, H3.hit), 1 - seg(t, OUT - 0.1, OUT + 0.2), -8);
      fast.style.transformOrigin = "0% 50%";
      const kf = seg(t, H3.page + 0.1, H3.page + 0.4);
      place(fast, IX + VIS.W + 18, IY + 14, Math.min(kf * 3, 1 - seg(t, OUT, OUT + 0.3)), `scale(${lerp(0.5, 1, E.back(kf)).toFixed(3)})`);
      const list = [];
      if (t > 3.5 && t < 4.75) list.push({ path: W.api, f: E.io(seg(t, 3.6, 4.6)), text: "GET /api/home", trail: true });
      if (t > 6.5 && t < 7.5) list.push({ path: W.back, f: E.io(seg(t, 6.6, 7.4)), text: "快照", cls: "purple", trail: true });
      if (t > 11.15 && t < 11.9) list.push({ path: W.req, f: E.io(seg(t, 11.25, 11.85)), text: "GET /", cls: "ink", trail: true });
      if (t > 11.95 && t < 12.65) list.push({ path: W.res, f: E.io(seg(t, 12.0, 12.6)), text: "HTML", cls: "green", trail: true });
      pk(list);
    };
  });
  at(c3, 0, LEFT[0], LEFT[1]);
  at(c3, 1.4, RIGHT[0], RIGHT[1]);
  look(c3, 1.4, -1);
  camera(c3, 3.8, 4.8, { x: 1565, y: 510, s: 1.2 }, "sine");
  camera(c3, 6.0, 6.95, null, "sine");
  emote(c3, H3.fail + 0.05, "drop", 1.4);
  emote(c3, H3.page, "!", 1.2);
  burst(c3, H3.page + 0.05, IX0 + 190, IY0 + 150, "stars", { n: 9, r: 120 });
  say(c3, 2.8, 7.0, "首屏要的数据，\n只问 Worker 要一次。", "left");
  say(c3, 7.4, 11.4, "读取各跑各的：\n挂了一个，只空出那一张。", "left");
  say(c3, 11.8, 15.1, "访客来了直接拿这份，\n不用现等 Worker。", "left");

  // --- 缓存时间轴：10 分钟后先给旧页，后台同时重建 ---
  scene(c3, 15.6, 24.4, (root) => {
    const T0 = 15.6, OUT = 24.0, RESET = H3.done + 0.8;
    const X0 = 150, X10 = 830, XB = 1180, X7 = 1560, XE = 1780, Y = 370, XP = 1040;
    const wl = wireLayer(root);
    const code = L("card code", root);
    code.style.fontSize = "25px";
    code.innerHTML = `cacheLife({ <span data-k="s"><span class="k">stale</span>: <span class="n">300</span></span>, <span data-k="r"><span class="k">revalidate</span>: <span class="n">600</span></span>, <span data-k="e"><span class="k">expire</span>: <span class="n">7 * 86400</span></span> })`;
    code.__x = 150; code.__y = 130;
    const hs = ["s", "r", "e"].map((k) => code.querySelector(`[data-k="${k}"]`));
    const note = L("lbl", root, "浏览器侧 5 分钟");
    // 时间轴整体放进一个盒子（下边缘 = 缓存条下沿，分叉线从这里出发）
    const TX = X0 - 60, TY = Y - 74;
    const tl = L("", root);
    tl.style.cssText += `;width:${XE - X0 + 120}px;height:82px`;
    tl.__x = TX; tl.__y = TY;
    const ox = (x) => x - TX, oy = (y) => y - TY;
    const axis = L("", tl); axis.style.cssText += ";height:4px;background:var(--ink)";
    const bar = L("", tl); bar.style.cssText += ";height:16px;background:var(--green)";
    const brk = L("", tl, `<svg width="30" height="40" viewBox="0 0 30 40"><rect x="7" y="0" width="16" height="40" fill="#F3F1EB"/><path d="M2 30 L14 10 M16 30 L28 10" stroke="#1F1E1B" stroke-width="3" fill="none"/></svg>`);
    const marks = [[X0, "0", "生成"], [X10, "10 分钟", "revalidate"], [X7, "7 天", "expire"]].map(([x, a, b]) => {
      const mk = L("b-mark", tl, `<i></i><b>${a}</b><span>${b}</span>`);
      mk.__x = x; return mk;
    });
    const zone7 = L("lbl", tl, "过期：先重建再给");
    zone7.style.cssText += ";color:var(--red);font-size:19px;font-weight:700";
    const ptr = L("", tl, `<div class="b-tally">${icon("clock", 17, 2.4)}<span>+00:00</span></div><div class="b-tri"></div>`);
    const ptrV = ptr.querySelector("span");
    // 两条泳道同时出现：访客立刻拿到旧页；重建在后台慢慢跑
    const VW2 = 340, RW = 420;
    const vis = card(root, { x: 680, y: 484, w: VW2, icon: "user", title: "下一位访客" });
    const reb = card(root, { x: 1060, y: 484, w: RW, h: 150, tint: "green", icon: "refresh-cw", title: "后台重建", sub: "再取一次 /api/home" });
    [vis, reb].forEach((c) => (c.querySelector(".hd").style.fontSize = "27px"));
    const rIcon = reb.querySelector(".ic svg");
    const prog = L("", reb); prog.style.cssText += `;width:${RW - 45}px;height:10px;background:#fff;border:2px solid var(--ink)`;
    const progI = L("", prog); progI.style.cssText += ";height:100%;background:var(--green)";
    const okV = L("", vis, icon("circle-check", 36, 2.4)); okV.style.color = "var(--green)";
    const okR = L("", reb, icon("circle-check", 36, 2.4)); okR.style.color = "var(--green)";
    const fk = [link(wl, [XP, Y + 8], "b", vis, "t", { kb: 0.8 }), link(wl, [XP, Y + 8], "b", reb, "t", { kb: 0.25 })];
    const neu = L("tg g", tl, "新页");
    const pk = packets(root, 3);
    let m = null;
    return (lt) => {
      const t = lt + T0;
      relink(wl);
      if (!m) m = { note: hs[0].offsetLeft, ch: code.offsetHeight, z7: zone7.offsetWidth, neu: neu.offsetWidth };
      const oc = popAt(code, t, 15.8, OUT);
      place(note, 150 + m.note, 130 + m.ch + 18, Math.min(oc, seg(t, 16.3, 16.6)));
      hs.forEach((h, i) => h.classList.toggle("hl", (i === 0 && t > 15.9 && t < 16.7) || (i === 1 && ((t > 16.2 && t < 17.0) || (t > H3.stale && t < H3.stale + 1.2))) || (i === 2 && t > 16.5 && t < 17.3)));
      const otl = seg(t, 15.8, 16.1) * (1 - seg(t, OUT, OUT + 0.3));
      place(tl, TX, TY, otl);
      const ka = E.out(seg(t, 15.8, 16.5));
      place(axis, ox(X0), oy(Y - 2), 1); axis.style.width = (XE - X0) * ka + "px";
      marks.forEach((mk, i) => popAt(mk, t, 16.0 + i * 0.25, 99, { x: ox(mk.__x), y: oy(Y - 16) }));
      marks.forEach((mk) => (mk.style.transform += " translateX(-50%)"));
      place(brk, ox(XB) - 15, oy(Y) - 20, seg(t, 16.4, 16.6));
      place(zone7, ox((X7 + XE) / 2) - m.z7 / 2, oy(Y - 46), seg(t, 16.8, 17.1));
      // 「现在」指针：快进到 10 分钟 → 缓存变旧 → 重建完回到 0
      const ff = E.io(seg(t, 16.4, H3.stale));
      const back = E.io(seg(t, RESET, RESET + 0.5));
      const creep = 18 * Math.max(0, t - (RESET + 0.5));
      let px = X0 + (X10 - X0) * ff + (XP - X10) * E.out(seg(t, H3.stale, H3.stale + 0.6));
      px = lerp(px, X0, back) + (X10 - X0) * creep / 600;
      const age = t < H3.stale ? 600 * ff : 600 + 40 * E.out(seg(t, H3.stale, H3.stale + 0.6));
      setText(ptrV, "+" + mmss(t > RESET ? age * (1 - back) + creep : age).padStart(5, "0"));
      place(ptr, ox(px), oy(Y - 62), seg(t, 16.2, 16.4), "translateX(-50%)");
      bar.style.width = Math.max(0, px - X0) + "px";
      bar.classList.toggle("b-stripe", t >= H3.stale && t < RESET + 0.5);
      const kst = seg(t, H3.stale, H3.stale + 0.25);
      place(bar, ox(X0), oy(Y - 8), 1, `scaleY(${(1 + 0.5 * Math.sin(Math.PI * kst)).toFixed(3)})`);
      // 泳道
      const kv = popAt(vis, t, 18.6, OUT), kr = popAt(reb, t, 18.6, OUT);
      fk.forEach((w, i) => dw(w, seg(t, 18.6, 18.9), Math.min(i ? kr : kv, 1 - seg(t, RESET, RESET + 0.1))));
      rIcon.style.transformOrigin = "50% 50%";
      rIcon.style.transform = `rotate(${(t > 18.6 && t < H3.done ? (t - 18.6) * 420 : 0).toFixed(1)}deg)`;
      place(prog, 20, 118, 1); progI.style.width = (100 * E.io(seg(t, 18.6, H3.done))).toFixed(1) + "%";
      const kok = seg(t, H3.old, H3.old + 0.25), kdn = seg(t, H3.done, H3.done + 0.25);
      place(okV, VW2 - 5 - 20 - 36, 26, kok, `scale(${lerp(0.4, 1, E.back(kok)).toFixed(3)})`);
      place(okR, RW - 5 - 20 - 36, 26, kdn, `scale(${lerp(0.4, 1, E.back(kdn)).toFixed(3)})`);
      hot(vis, t > H3.old && t < H3.old + 0.6);
      hot(reb, t > H3.done && t < H3.done + 0.6);
      place(neu, ox(X0) - m.neu / 2, oy(Y - 112), seg(t, RESET + 0.4, RESET + 0.6) * (1 - seg(t, OUT - 0.4, OUT - 0.1)));
      const list = [];
      if (t > 18.55 && t < 19.3) list.push({ path: fk[0], f: E.io(seg(t, 18.6, H3.old)), text: "旧页", cls: "ink", trail: true });
      if (t > H3.done && t < RESET + 0.05) list.push({ path: fk[1], f: 1 - E.io(seg(t, H3.done, RESET)), text: "新页", cls: "green", trail: true });
      pk(list);
    };
  });
  say(c3, 16.2, 20.6, "缓存到点就算旧了，\n可下一位照样秒开。", "left");

  // --- 布局变了才通知：插上充电头 → Worker → POST /api/revalidate ---
  scene(c3, 24.2, 33.4, (root) => {
    const T0 = 24.2, OUT = 32.9;
    const wl = wireLayer(root);
    const chg = card(root, { x: 60, y: 220, w: 360, h: 220, tint: "amber", icon: "battery-charging", title: "充电头插上" });
    const art = L("", chg, `<svg width="320" height="96" viewBox="0 0 320 96">
      <rect x="196" y="12" width="100" height="72" fill="#fff" stroke="#1F1E1B" stroke-width="3"/>
      <rect x="196" y="40" width="9" height="16" fill="#1F1E1B"/>
      <circle data-k="led" cx="280" cy="28" r="6" fill="#B3AC9F"/>
      <rect x="226" y="62" width="50" height="6" fill="#E6E3DC"/>
      <g data-k="plug"><path d="M-120 48 H152" stroke="#1F1E1B" stroke-width="5" fill="none"/>
        <rect x="150" y="36" width="36" height="24" fill="#1F1E1B"/><rect x="186" y="42" width="16" height="12" fill="#8F8A80"/></g></svg>`);
    const plug = art.querySelector('[data-k="plug"]'), led = art.querySelector('[data-k="led"]');
    const song = card(root, { x: 60, y: 500, w: 360, icon: "music", title: "换了一首歌", sub: "夜に駆ける → アイドル" });
    const wk = card(root, { x: 650, y: 220, w: 440, h: 370, tint: "orange", icon: "cloud", title: "API Worker", mono: true });
    const rowA = L("b-row", wk, `<div class="h">布局变了<span class="tg g">${icon("check", 14, 3)}通知</span></div><div class="s">充电卡出现消失 · 开始 / 停止放歌</div>`);
    const rowB = L("b-row", wk, `<div class="h">内容变了<span class="tg r">${icon("x", 14, 3)}不通知</span></div><div class="s">切应用、歌名、读数、心跳</div>`);
    [rowA, rowB].forEach((r) => (r.style.width = "395px"));
    const vc = card(root, { x: 1480, y: 220, w: 380, h: 280, tint: "green", icon: "globe", title: "Vercel", sub: "首屏缓存" });
    const strip = L("", vc); strip.style.cssText += ";width:290px;height:20px;border:2px solid var(--ink);background:var(--green)";
    const spinEl = L("", vc, icon("refresh-cw", 30, 2.6));
    const spinSvg = spinEl.querySelector("svg"); spinSvg.style.transformOrigin = "50% 50%";
    const exp = stamp(vc, "标旧<small>旧页照给</small>");
    const xB = L("b-x", root, icon("x", 26, 3.4));
    xB.__x = 1236; xB.__y = 220 + 2.5 + 222 + 60 - 22;
    const W = {
      ai: link(wl, chg, "r", wk, "l", { kb: 0.396 }),
      bi: link(wl, song, "r", wk, "l", { kb: 0.769 }),
      ao: link(wl, wk, "r", vc, "l", { ka: 0.396, kb: 0.273 }),
      bo: link(wl, wk, "r", xB, "l", { ka: 0.769, dash: true, color: "#C8453A", opacity: 0.7 }),
    };
    const pk = packets(root, 3);
    return (lt) => {
      const t = lt + T0;
      relink(wl);
      const oc = popAt(chg, t, 24.4, OUT, { dx: -30 });
      const ow = popAt(wk, t, 24.8, OUT);
      const ov = popAt(vc, t, 25.2, OUT);
      const os = popAt(song, t, 30.2, OUT, { dx: -30 }); // 等镜头回到全景再出场
      const wf = 1 - seg(t, OUT - 0.2, OUT + 0.05);
      dw(W.ai, seg(t, 25.0, 25.4), Math.min(oc, ow, wf));
      dw(W.ao, seg(t, 25.4, 25.8), Math.min(ow, ov, wf));
      dw(W.bi, seg(t, 30.4, 30.7), Math.min(os, ow, wf));
      // 插头滑进充电头：咔哒一声，指示灯亮
      const kp = E.in(seg(t, H3.plug - 0.5, H3.plug));
      plug.setAttribute("transform", `translate(${(-44 * (1 - kp)).toFixed(1)} 0)`);
      led.setAttribute("fill", t >= H3.plug ? "#2E9E4F" : "#B3AC9F");
      place(art, 18, 100, 1);
      place(rowA, 20, 84, 1); place(rowB, 20, 222, 1);
      const onA = t > 27.3, onB = t > H3.no;
      rowA.style.background = onA ? "var(--green-t)" : ""; rowA.style.borderColor = onA ? "var(--green)" : "";
      rowB.style.background = onB ? "var(--red-t)" : ""; rowB.style.borderColor = onB ? "var(--red)" : "";
      rowA.style.opacity = onB ? "0.55" : "1";
      // Vercel：标记过期，旧页照给，后台提前重建
      place(strip, 20, 228, 1);
      const bad = t >= H3.expire && t < 30.8;
      strip.classList.toggle("b-stripe", bad);
      spinSvg.style.transform = `rotate(${(t > 29.4 && t < 30.8 ? (t - 29.4) * 400 : 0).toFixed(1)}deg)`;
      place(spinEl, 322, 223, seg(t, 29.3, 29.5));
      spinEl.style.color = t >= 30.8 ? "var(--green)" : "var(--ink)";
      exp(186, 152, seg(t, H3.expire - 0.18, H3.expire), 1 - seg(t, OUT - 0.1, OUT + 0.2), -7);
      const kx = seg(t, H3.no, H3.no + 0.22);
      const ox2 = popAt(xB, t, H3.no, OUT, { d: 0.25 });
      dw(W.bo, seg(t, H3.no + 0.05, H3.no + 0.3), Math.min(ox2, ow, wf));
      xB.style.transform += ` rotate(${(12 * Math.sin(Math.PI * kx)).toFixed(1)}deg)`;
      const list = [];
      if (t > 26.5 && t < 27.4) list.push({ path: W.ai, f: E.io(seg(t, 26.6, 27.3)), text: "charger", trail: true });
      if (t > 27.5 && t < 28.8) list.push({ path: W.ao, f: E.io(seg(t, 27.6, 28.7)), text: "POST /api/revalidate", cls: "ink", trail: true });
      if (t > 30.5 && t < 31.2) list.push({ path: W.bi, f: E.io(seg(t, 30.6, 31.1)), text: "listening", trail: true });
      pk(list);
    };
  });
  camera(c3, 27.3, 28.3, { x: 1670, y: 412, s: 1.2 }, "sine");
  camera(c3, 29.3, 30.2, null, "sine");
  burst(c3, H3.expire, 1668, 374, "spark", { r: 150, n: 14, reach: 50 });
  shake(c3, H3.expire, 12);
  act(c3, H3.expire + 0.02, "flinch");
  emote(c3, H3.no + 0.1, "no", 1.2);
  say(c3, 25.8, 29.8, "多了一张卡，旧 HTML 里没有，\n等不了 10 分钟。", "left");
  say(c3, 30.2, 33.2, "这种小变化不惊动 Vercel，\n交给浏览器自己追。", "left");

  // =====================================================================
  // 04 实时推送
  // =====================================================================
  const c4 = chapter("实时推送", "浏览器直连 Worker", 16);
  // merge：第一张卡要数据，/api/home 当场发出；back：快照回来，所有挂着的卡一起拿到
  const H4 = { merge: 6.0, back: 8.4, push: 14.4, pause: 24.0, resume: 25.8, fresh: 27.8, old: 28.8 };

  // --- 首次读取合并、WebSocket 常驻、推送当场换歌名 ---
  scene(c4, 1.8, 20.9, (root) => {
    const T0 = 1.8, OUT = 20.2;
    const wl = wireLayer(root);
    // 流动虚线另放：不是 root 下直接的 svg，也不带 wire 类
    const flowBox = L("", root);
    const fsvg = svgEl("svg", { width: 1920, height: 1080, class: "L" }, flowBox);
    fsvg.style.overflow = "visible";
    const flow = svgEl("path", { fill: "none", stroke: "#2E9E4F", "stroke-width": 6, "stroke-dasharray": "14 22", "stroke-linecap": "round" }, fsvg);
    const PX = 80, PY = 130, SC = 0.58;
    const H = siteMock(root, { scale: SC, viewH: 750 });
    H.el.__x = PX; H.el.__y = PY;
    const vercel = card(root, { x: 990, y: 130, w: 280, tint: "green", icon: "globe", title: "Vercel", sub: "首屏 HTML" });
    const xV = L("b-x", root, icon("x", 26, 3.4));
    xV.__x = 836; xV.__y = 160;
    const box = L("win", root);
    box.style.cssText += ";width:170px;height:250px;border-style:dashed;background:rgba(255,255,255,.75);box-shadow:none";
    box.__x = 780; box.__y = 250;
    const rg = ring(box, { r: 13, w: 5, color: "var(--green)" });
    const bt = L("lbl b", box, "15 秒");
    const bf = L("lbl", box, "请求 5 秒超时");
    const worker = card(root, { x: 1330, y: 290, w: 460, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "api.homepage.lyjw.llc", tags: [{ t: "/ws · LivePushRoom", c: "g" }] });
    const swr = card(root, { x: 80, y: 668, w: 600, pad: "12px 18px", title: '<span class="lbl b" style="font-size:19px">SWR 缓存</span>',
      lines: [`${mono("listening/now", 18)} → <span data-k="v" style="display:inline-block">夜に駆ける</span>`, `${mono("charger", 18)} → 122.9 W`, `${mono("desktop", 18)} → Claude Code`] });
    const swrRow = swr.querySelectorAll(".ln")[0], swrV = swr.querySelector('[data-k="v"]');
    swrRow.style.padding = "2px 8px"; swrRow.style.margin = "6px -8px 0";
    const W = {
      v1: link(wl, H.el, "r", xV, "l", { ka: 0.1, dash: true, color: "#C8453A", opacity: 0.7 }),
      v2: link(wl, xV, "r", vercel, "l", { kb: 0.42, dash: true, color: "#C8453A", opacity: 0.7 }),
      api: link(wl, box, "r", worker, "l", { ka: 0.3, kb: 0.3 }),
      back: link(wl, worker, "l", box, "r", { ka: 0.68, kb: 0.72 }),
      wall: link(wl, H.el, "r", worker, "l", { ka: 0.844, kb: 0.9, width: 24, opacity: 0.85 }),
      core: link(wl, H.el, "r", worker, "l", { ka: 0.844, kb: 0.9, width: 17, color: "#E3F3E7", opacity: 1 }),
    };
    const wsLbl = L("lbl b", root, "WebSocket");
    // 圈注压在页面上：单独一层，建在卡片之后
    const pl = penLayer(root);
    const lr = H.rect("listening", PX, PY);
    const penSong = penCircle(pl, lr.x + 311 * SC, lr.y + 103 * SC, 122, 42, { seed: 8 });
    const chips = packets(box, 6);
    const pk = packets(root, 3);
    const ASK = ["contact", "clock", "watching", "charger", "listening"];
    const SLOT = (i) => 64 + i * 32;
    let m = null;
    return (lt) => {
      const t = lt + T0;
      relink(wl);
      if (!m) {
        flow.setAttribute("d", W.core.getAttribute("d"));
        m = { lp: pt(W.core, 0.16), ws: wsLbl.offsetWidth };
      }
      const ka = seg(t, 2.3, 2.9), oH = ka * (1 - seg(t, OUT, OUT + 0.3));
      const wf = 1 - seg(t, OUT - 0.2, OUT + 0.05);
      place(H.el, PX - 40 * (1 - E.out(ka)), PY, oH);
      const flip = seg(t, H4.push, H4.push + 0.5);
      H.update({ t: t + 20, song: t >= H4.push ? "アイドル" : "夜に駆ける", prevSong: "夜に駆ける", flip: t >= H4.push ? flip : 1, songFlash: t > H4.push && t < H4.push + 1.1 });
      // 挂载后各卡要数据：描边一闪
      ASK.forEach((k, i) => {
        const a0 = 5.7 + i * 0.35;
        hot(H.cards[k], (t > a0 && t < a0 + 0.35) || (t > H4.back + 0.5 && t < H4.back + 0.95), "46,158,79", 6, 2);
      });
      const ov = popAt(vercel, t, 2.7, OUT);
      const ox = popAt(xV, t, 3.0, OUT, { d: 0.25 });
      dw(W.v1, seg(t, 3.05, 3.35), Math.min(oH, ox, wf));
      dw(W.v2, seg(t, 3.35, 3.6), Math.min(ox, ov, wf));
      const ow = popAt(worker, t, 3.6, OUT);
      const ob = popAt(box, t, 5.2, 10.2);
      rg.set(seg(t, 5.7, 20.7)); place(rg, 12, 12, 1); // 15 秒窗口：从第一张卡要数据开始算
      place(bt, 58, 20, 1); place(bf, 14, 220, 1);
      dw(W.api, seg(t, 5.3, 5.7), Math.min(ob, ow));
      dw(W.back, seg(t, 5.3, 5.7), Math.min(ob, ow));
      // 第一张卡的 GET 一进来，/api/home 当场发出；后面几张在 15 秒窗口里挂上同一个请求，等快照回来
      const cl = [];
      ASK.forEach((k, i) => {
        const a0 = 5.7 + i * 0.35, y = SLOT(i);
        if (t > a0 && t < H4.back + 0.1) {
          const g = E.out(seg(t, a0, a0 + 0.45));
          cl.push({ x: lerp(-18, 85, g), y, text: i === 0 ? "GET" : "共用", cls: i === 0 ? "gray" : "ink", o: 1, s: 0.9 });
        }
        const r0 = H4.back + 0.1;
        if (t > r0 && t < r0 + 0.55) {
          const g = E.in(seg(t, r0, r0 + 0.5));
          cl.push({ x: lerp(85, -18, g), y, text: icon("check", 16, 3.4), cls: "green", o: 1 - g, s: 0.9 });
        }
      });
      chips(cl);
      // WebSocket：粗管道 + 一直往页面流的虚线
      const kw = seg(t, 10.8, 11.6);
      dw(W.wall, kw, Math.min(oH, ow, wf)); dw(W.core, kw, Math.min(oH, ow, wf));
      const of = seg(t, 11.5, 11.9) * Math.min(oH, ow, wf);
      flow.setAttribute("stroke-dashoffset", ((t * 70) % 36).toFixed(2));
      flow.style.opacity = of.toFixed(3);
      show(flowBox, of);
      place(wsLbl, m.lp.x - m.ws / 2, m.lp.y - 42 - 24, Math.min(seg(t, 11.4, 11.7), 1 - seg(t, OUT, OUT + 0.3)));
      penOn(pl, Math.min(seg(t, H4.push + 0.2, H4.push + 0.35), 1 - seg(t, 16.4, 16.7)));
      dw(penSong, seg(t, H4.push + 0.25, H4.push + 0.65), 1 - seg(t, 16.4, 16.7));
      // SWR 缓存：推送写进来，那一行高亮扫过
      popAt(swr, t, 12.6, OUT);
      const ks = seg(t, H4.push + 0.3, H4.push + 0.9);
      setText(swrV, t >= H4.push + 0.55 ? "アイドル" : "夜に駆ける");
      swrRow.style.background = ks > 0 && ks < 1 ? `linear-gradient(90deg, rgba(46,158,79,0) ${(ks * 130 - 40).toFixed(1)}%, rgba(46,158,79,.28) ${(ks * 130 - 15).toFixed(1)}%, rgba(46,158,79,0) ${(ks * 130 + 10).toFixed(1)}%)` : t >= H4.push + 0.9 && t < H4.push + 2.0 ? "var(--green-t)" : "";
      const list = [];
      if (t > H4.merge - 0.05 && t < H4.merge + 1.05) list.push({ path: W.api, f: E.io(seg(t, H4.merge, H4.merge + 0.9)), text: "GET /api/home", trail: true });
      if (t > H4.merge + 1.15 && t < H4.back + 0.05) list.push({ path: W.back, f: E.io(seg(t, H4.merge + 1.2, H4.back)), text: "快照", cls: "purple", trail: true });
      if (t > 13.1 && t < H4.push + 0.05) list.push({ path: W.core, f: 1 - E.io(seg(t, 13.2, H4.push)), text: "listening-now · アイドル", cls: "green", trail: true });
      pk(list);
    };
  });
  at(c4, 0, RIGHT[0], RIGHT[1]);
  look(c4, 0.5, -1);
  camera(c4, 13.5, 14.2, { x: 700, y: 480, s: 1.2 }, "sine");
  camera(c4, 15.6, 16.3, null, "sine");
  duck(c4, H4.push);
  sfx(c4, H4.push, "flip", { x: 510 });
  burst(c4, H4.push + 0.05, 600, 450, "stars", { n: 8, r: 50 });
  emote(c4, H4.push + 0.2, "note", 1.4);
  say(c4, 2.8, 7.2, "首屏是缓存，放久了会过时，\n打开后要找 Worker 拿此刻。", "left");
  say(c4, 7.6, 11.8, "十几张卡的头一次取数，\n由一个请求统一代答。", "left");
  say(c4, 12.2, 16.4, "之后一直连着，有变化\n就带着数据推过来。", "left");
  say(c4, 16.8, 20.6, "收到就写进缓存，\n卡片当场换，不用再问。", "left");

  // --- 轮询节奏、后台暂停、时间戳挡旧、本地推算进度（三栏依次聚焦，其余压暗） ---
  scene(c4, 20.8, 38.2, (root) => {
    const T0 = 20.8, OUT = 37.6;
    // 左栏：带标签页的小窗口，四行轮询各有一个倒计时环
    const PWX = 80, PWY = 160, PWW = 520, PWH = 470;
    const pw = L("win", root);
    pw.style.cssText += `;width:${PWW}px;height:${PWH}px`;
    pw.__x = PWX; pw.__y = PWY;
    pw.innerHTML = `<div class="b-tabs"><div class="b-tab" data-k="a" style="left:18px">${icon("globe", 16, 2.2)}lyjw.me</div><div class="b-tab" data-k="b" style="left:200px">${icon("app-window", 16, 2.2)}其他页面</div></div>`;
    const tabA = pw.querySelector('[data-k="a"]'), tabB = pw.querySelector('[data-k="b"]');
    const body = L("", pw); body.style.cssText += `;width:${PWW - 5}px;height:${PWH - 57}px`;
    const head = L("", body, `<div style="font-family:var(--sans);font-weight:700;font-size:28px;display:flex;align-items:center;gap:10px;white-space:nowrap">${icon("timer", 28, 2.2)}按节奏轮询</div>`);
    // 周期按真实比例缩放（30 秒 : 60 秒 : 2 分钟 : 5 分钟 = 1 : 2 : 4 : 10）；相位错开，满圈落在拍上
    const ROWS = [["充电 · 服务器", "30 秒", 1.2, 0.6], ["正在听", "60 秒", 2.4, 1.2], ["编码用量", "2 分钟", 4.8, 1.0], ["活动", "5 分钟", 12.0, 3.0]];
    const rows = ROWS.map(([a, b]) => {
      const r = L("b-prow", body, `<span style="width:40px;height:40px;display:inline-block;flex:none;position:relative"></span><span>${a}</span><span class="v">${b}</span>`);
      r.style.width = PWW - 5 - 56 + "px";
      const rg = ring(r.firstChild, { r: 15, w: 6, color: "var(--orange)" });
      r.__rg = rg; r.__v = r.querySelector(".v");
      return r;
    });
    const moon = L("", tabA, icon("moon", 16, 2.4));
    const pause = stamp(pw, "暂停", "k");
    // 中栏：时间戳挡旧
    const GW = 580;
    const gd = card(root, { x: 680, y: 160, w: GW, h: 400, icon: "shield-check", title: "时间戳挡旧", sub: `只留 ${mono("receivedAt", 20)} 更新的那份` });
    const SX = 322, SY = 150, SW = 232, SH = 170;
    const slot = L("", gd);
    slot.style.cssText += `;width:${SW}px;height:${SH}px;border:2.5px solid var(--ink);background:#fff;padding:14px 18px;box-shadow:4px 4px 0 rgba(31,30,27,.1)`;
    slot.innerHTML = `<div class="lbl">listening/now</div><div data-k="v" style="font-size:28px;font-weight:600;margin-top:10px;white-space:nowrap">夜に駆ける</div><div class="mono" data-k="t" style="font-size:20px;margin-top:10px;color:var(--muted)">10:35:17</div>`;
    const slotV = slot.querySelector('[data-k="v"]'), slotT = slot.querySelector('[data-k="t"]');
    const gpk = packets(gd, 3);
    gd.querySelectorAll(":scope > svg").forEach((sv) => (sv.style.display = "none"));
    const oldSt = stamp(gd, "旧");
    const cmp = L("lbl", gd, "19 &lt; 21");
    cmp.style.cssText += ";color:var(--red);font-weight:700;font-size:22px";
    // 右栏：进度在浏览器里按时间往前推
    const PCX = 1320, PCY = 160, PCW = 540;
    const pc = card(root, { x: PCX, y: PCY, w: PCW, h: 440, icon: "music", title: "播放进度" });
    const fm = L("", pc, `<div class="mono" style="font-size:20px;white-space:nowrap">位置 = <b style="color:var(--purple)">positionMs</b> + (现在 − <b style="color:var(--orange-d)">observedAt</b>)</div>
      <div class="mono" style="font-size:20px;white-space:nowrap;margin-top:10px;color:var(--muted)">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <b style="color:var(--purple)">1:12.0</b> + <b data-k="d" style="color:var(--orange-d);display:inline-block;min-width:74px">0.0 s</b></div>`);
    const fd = fm.querySelector('[data-k="d"]');
    const pbar = L("", pc); pbar.style.cssText += `;width:${PCW - 49}px;height:12px;background:#E6E3DC`;
    const pfill = L("", pbar); pfill.style.cssText += ";height:100%;background:var(--green)";
    const ptm = L("lbl", pc, "");
    const net = L("", pc, `<div style="display:flex;align-items:center;gap:10px;font-size:24px;white-space:nowrap">${icon("wifi", 26, 2.2)}网络请求 <b class="mono" data-k="n" style="font-size:36px;line-height:1">0</b></div>`);
    const netN = net.querySelector('[data-k="n"]');
    const ly = L("", pc); ly.style.cssText += ";font-size:30px;font-weight:600;white-space:nowrap";
    const LY = window.__tr("（当前这句歌词）");
    const pen = penLayer(root);
    // 下划线先建出来（引擎按建好的连线配音），位置等首帧量完字再定
    const netLine = penLine(pen, 0, 0, 10, 0, { seed: 4 });
    let m = null;
    const eff = (t) => t - clamp(t - H4.pause, 0, H4.resume - H4.pause);
    return (lt) => {
      const t = lt + T0;
      if (!m) {
        m = { cmp: cmp.offsetWidth };
        place(net, 22, 290, 1);
        const nx = PCX + 2.5 + 22 + netN.offsetLeft, ny = PCY + 2.5 + 290 + netN.offsetTop + netN.offsetHeight + 6;
        netLine.setAttribute("d", `M${nx - 14} ${ny} Q${nx + netN.offsetWidth / 2} ${ny + 6} ${nx + netN.offsetWidth + 14} ${ny}`);
        netLine.__len = null;
      }
      // 左栏
      popAt(pw, t, 21.2, OUT, { dx: -30 });
      dim(pw, 1 - 0.62 * seg(t, 26.4, 26.8));
      const paused = t >= H4.pause && t < H4.resume;
      tabA.className = "b-tab" + (paused ? "" : " on"); tabB.className = "b-tab" + (paused ? " on" : "");
      place(body, 0, 52, paused ? 0.4 : 1);
      place(head, 28, 26, 1);
      const te = eff(t);
      rows.forEach((r, i) => {
        place(r, 28, 104 + i * 80, 1);
        const P = ROWS[i][2], u = Math.max(0, te - 21.6) + ROWS[i][3];
        r.__rg.set(t < 21.6 ? 0 : (u / P) % 1);
        place(r.__rg, 0, 0, 1);
        const justHit = !paused && t > 21.7 && (u % P) < 0.3;
        r.__v.style.color = justHit ? "var(--green)" : "";
        r.__v.style.fontWeight = justHit ? "700" : "";
      });
      place(moon, 132, 12, paused ? 1 : 0);
      pause(PWW / 2, 52 + 210, seg(t, H4.pause - 0.18, H4.pause), 1 - seg(t, H4.resume, H4.resume + 0.3), -6);
      // 中栏
      popAt(gd, t, 26.4, OUT);
      dim(gd, 1 - 0.62 * seg(t, 31.2, 31.6));
      const got = t >= H4.fresh;
      setText(slotV, got ? "アイドル" : "夜に駆ける"); setText(slotT, got ? "10:35:21" : "10:35:17");
      const flash = got && t < H4.fresh + 0.8;
      slot.style.borderColor = flash ? "var(--green)" : "";
      slot.style.background = flash ? "var(--green-t)" : "#fff";
      const bump = seg(t, H4.old, H4.old + 0.14);
      place(slot, SX + 7 * Math.sin(Math.PI * bump), SY, 1);
      const LANE = SY + SH / 2, STOP = SX - 8;
      const glist = [];
      if (t > 27.0 && t < H4.fresh + 0.05) {
        const f = E.io(seg(t, 27.0, H4.fresh));
        glist.push({ x: lerp(96, STOP - 72, f), y: LANE, text: "推送 10:35:21", cls: "green", o: Math.min(1, f * 6, (H4.fresh + 0.05 - t) / 0.12) });
      }
      if (t > 28.0 && t < 29.8) {
        const f = E.in(seg(t, 28.0, H4.old)), bk = E.out(seg(t, H4.old, H4.old + 0.7));
        glist.push({ x: lerp(96, STOP - 72, f) - 130 * bk, y: LANE, text: "轮询 10:35:19", cls: "gray", o: Math.min(1, (t - 28.0) * 6) * (1 - seg(t, 29.4, 29.8)) });
      }
      gpk(glist);
      oldSt(150, LANE, seg(t, H4.old - 0.18, H4.old), 1 - seg(t, OUT - 0.1, OUT + 0.2), -8);
      place(cmp, 150 - m.cmp / 2, LANE + 66, seg(t, 29.1, 29.3));
      // 右栏
      popAt(pc, t, 31.2, OUT);
      const d = Math.max(0, t - 31.4);
      setText(fd, d.toFixed(1) + " s");
      place(fm, 22, 92, 1);
      const pos = 72 + d;
      place(pbar, 22, 196, 1); pfill.style.width = ((pos / 261) * 100).toFixed(2) + "%";
      place(ptm, 22, 220, 1); setText(ptm, `${mmss(pos)} / 4:21`);
      place(net, 22, 290, 1);
      penOn(pen, Math.min(seg(t, 34.35, 34.5), 1 - seg(t, OUT, OUT + 0.3)));
      dw(netLine, seg(t, 34.4, 34.8), 1 - seg(t, OUT, OUT + 0.3));
      const n = Math.floor(clamp((t - 32.4) * 3, 0, LY.length));
      setHTML(ly, `<span style="color:var(--green)">${LY.slice(0, n)}</span><span style="color:var(--faint)">${LY.slice(n)}</span>`);
      place(ly, 22, 368, 1);
    };
  });
  hold(c4, H4.pause + 0.1, H4.resume, { pose: "default", offset: 1 });
  emote(c4, H4.pause + 0.1, "z", 1.2);
  emote(c4, H4.old + 0.1, "no", 1.2);
  shake(c4, H4.old, 6, 0.25);
  say(c4, 22.0, 26.2, "一直在变的读数定时去问，\n页面看不见就不问。", "left");
  say(c4, 26.6, 31.0, "每份数据都带着时间戳，\n慢回来的旧结果进不来。", "left");
  say(c4, 31.6, 36.6, "换歌、暂停、拖动时才发锚点，\n中间的进度照着时间推。", "left");

  // ---------- 语义音效（弹出、数据包、连线、印章这类由引擎按画面自动生成） ----------
  // 首屏缓存
  sfx(c3, H3.fail - 0.6, "hash", { x: 1600 });
  sfx(c3, H3.fail, "err", { x: 1630 });
  sfx(c3, 9.6, "click", { x: 1000 });
  sfx(c3, H3.page, "coin", { x: 206 });
  for (let i = 0; i < 8; i++) sfx(c3, 16.4 + i * 0.2, "clock", { x: 150 + i * 85 });
  sfx(c3, H3.stale, "down", { x: 830 });
  sfx(c3, 18.6, "scan", { dur: 2.4, x: 1260 });
  sfx(c3, H3.old, "ok", { x: 860 });
  sfx(c3, H3.done, "chime", { x: 1260 });
  sfx(c3, H3.done + 0.8, "swoosh", { x: 600 });
  sfx(c3, H3.plug, "click", { x: 300 });
  sfx(c3, H3.plug + 0.05, "zap", { x: 300 });
  sfx(c3, 27.6, "riser", { dur: 1.2 });
  duck(c3, H3.expire);
  // 实时推送
  sfx(c4, H4.back + 0.6, "ok", { x: 400 });
  sfx(c4, 10.8, "whoosh", { x: 1000 });
  sfx(c4, H4.push + 0.35, "sparkle", { x: 380 });
  [22.2, 22.8, 23.4].forEach((t) => sfx(c4, t, "clock", { x: 300 }));
  sfx(c4, H4.pause, "down", { x: 300 });
  sfx(c4, H4.resume, "up", { x: 300 });
  sfx(c4, H4.fresh, "ok", { x: 1000 });
  sfx(c4, H4.old + 0.05, "err", { x: 900 });
  [32.4, 33.6, 34.8, 36.0].forEach((t) => sfx(c4, t, "clock", { x: 1590 }));
})();
