// 08 回顾：主人按下播放，这条消息一路坐到浏览器
(() => {
  const { E, clamp, seg, lerp, mk, L, icon, place, show, setHTML, setText, chapter, scene, say, at, act, look, sfx, crabPos, emote, burst, duck, shake, iris } = Engine;
  const { card, popAt, wireLayer, wire, drawWire, packets, stamp, dimLine, penLine, css } = Kit;
  const LEFT = [250, 975], RIGHT = [1670, 975];

  const c8 = chapter("回顾", "一首歌的旅程", 14);
  // 五张站牌在上，轨道在下：Clawd 站在轨道上滑行，身体不会压到站牌；下车往右下跳，路上没有卡片
  const ST = [
    { x: 220, icon: "laptop", t: "Mac", s: "按下播放", c: "" },
    { x: 590, icon: "cloud", t: "API Worker", s: "鉴权 · 校验", c: "orange" },
    { x: 960, icon: "database", t: "StateHub", s: "提交 · 交回待办", c: "purple" },
    { x: 1330, icon: "radio", t: "LivePushRoom", s: "广播", c: "orange" },
    { x: 1700, icon: "globe", t: "浏览器", s: "换上正在播放", c: "green" },
  ];
  // 六次停靠：提交完折回 Worker——202 由它回给 Mac，广播也由它发起（和第 02 章一致）
  const STOPS = [[6.0, 0], [7.2, 1], [8.4, 2], [9.6, 1], [10.8, 3], [12.0, 4]]; // [到站时刻, 站牌]，每两拍一站，终点落在小节头
  const ARRIVE = STOPS[STOPS.length - 1][0];
  // 尾声：再换一首歌，包自己沿轨道跑一遍（同样六站，每站一拍多一点）
  const ENC = [24.6, 24.96, 25.32, 25.68, 26.04, 26.4];
  const RY = 540, CY = 130;
  css(`.st-line{font-family:var(--mono);font-size:17px;margin-top:6px;white-space:nowrap}
    .stampx.sm{font-size:30px;padding:5px 12px 6px;border-width:4px}
    .grp{font-size:20px;font-weight:600;color:var(--orange-d);background:var(--paper);padding:0 10px;white-space:nowrap}
    .mb{width:176px;height:132px;background:#fff;border:2.5px solid var(--ink);box-shadow:4px 4px 0 rgba(31,30,27,.12)}
    .mb .bar{height:18px;border-bottom:2px solid var(--ink);background:#FBFAF7;display:flex;gap:4px;align-items:center;padding-left:6px}
    .mb .bar i{width:6px;height:6px;border:1.5px solid var(--ink)}
    .mb .hd2{font:500 9px var(--mono);letter-spacing:.08em;color:#6F6B64;padding:6px 8px 4px;border-bottom:1px solid rgba(31,30,27,.2)}
    .mb .bd{display:flex;gap:8px;padding:8px}
    .mb .art{width:40px;height:40px;border:1px solid rgba(31,30,27,.6);background:linear-gradient(160deg,#f07a8e,#6c4bb0 60%,#23285f);flex:none}
    .mb .stt{font:600 10px var(--mono);letter-spacing:.05em;white-space:nowrap}
    .mb .nm{font:600 15px var(--cjk);margin-top:3px;white-space:nowrap;display:inline-block;transform-origin:50% 60%}
    .mb .pg{height:3px;background:#E6E3DC;margin:6px 8px 0;position:relative}
    .mb .pg i{position:absolute;left:0;top:0;bottom:0;background:#3DA05A}`);
  const PAUSED = '<span style="color:#8F8A80">‖ PAUSED</span>', PLAYING = '<span style="color:#3DA05A">||| NOW PLAYING</span>';

  scene(c8, 1.9, 28.8, (root, s) => {
    const wl = wireLayer(root);
    const nodes = ST.map((n) => {
      const c = card(root, { x: n.x - 150, y: CY, w: 300, tint: n.c, icon: n.icon, title: n.t, sub: n.s });
      c.querySelector(".hd").style.fontSize = "26px";
      return c;
    });
    // Mac 卡上的播放键和状态行；Worker 第二次停靠时多一行；浏览器卡上的状态行
    const macSt = mk("div", "st-line", nodes[0]), wkSt = mk("div", "st-line", nodes[1]), brSt = mk("div", "st-line", nodes[4]);
    setHTML(macSt, `<span style="color:var(--faint)">‖ 暂停中</span>`); setHTML(brSt, PAUSED); setHTML(wkSt, "回 202 · 发广播"); // 先填上，量高度才准
    const btn = L("", nodes[0]);
    btn.style.cssText += ";left:auto;right:16px;top:18px;width:46px;height:46px;border:2.5px solid var(--ink);border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:3px 3px 0 rgba(31,30,27,.15)";
    btn.innerHTML = icon("play", 22, 2.6);
    const line = wire(wl, `M${ST[0].x} ${RY} L${ST[4].x} ${RY}`, { opacity: 0.35, width: 3 });
    const done = wire(wl, `M${ST[0].x} ${RY} L${ST[4].x} ${RY}`, { color: "#D97757", opacity: 0.9, width: 5 });
    const ticks = nodes.map(() => wire(wl, "M0 0", { opacity: 0.35, width: 3 }));
    const dim = dimLine(wl, ST[0].x, ST[4].x, 606);
    const dimLbl = L("stag", root, `${icon("timer", 18, 2.2)}8 月实测：按下播放 → 站点给出新状态 0.32–0.49 s`);
    const ok = L("tg g", root, "✓ 通过");
    const cm = L("tg p", root, "✓ 已提交");
    const s202 = stamp(root, "202", "g sm");
    // 旁白念「采集、中枢、展示」时，三组站牌下各画一道
    const pen = wireLayer(root);
    // LivePushRoom 是 workers/api 里的 Durable Object，归中枢；展示只有浏览器
    const GRP = [[70, 370, "采集"], [440, 1480, "中枢"], [1550, 1850, "展示"]];
    const glines = GRP.map(([a, b], i) => penLine(pen, a + 10, 318, b - 10, 318, { seed: 21 + i, bow: 5 }));
    const glabs = GRP.map(([a, b, t]) => { const e = L("grp", root, t); e.__c = (a + b) / 2; return e; });
    const minis = Array.from({ length: 4 }, (_, i) => {
      const m = L("mb", root);
      m.innerHTML = `<div class="bar"><i></i><i></i><i></i></div><div class="hd2">RECENTLY PLAYED</div><div class="bd"><i class="art"></i><div><div class="stt"></div><div class="nm">夜に駆ける</div></div></div><div class="pg"><i></i></div>`;
      m.__x = 80 + i * 196; m.__y = 690;
      return { el: m, st: m.querySelector(".stt"), nm: m.querySelector(".nm"), pg: m.querySelector(".pg i") };
    });
    const pk = packets(root, 3);
    let measured = false;
    return (lt, t) => {
      const T = lt + s.t0 - c8.t0;
      if (!measured) {
        measured = true;
        nodes.forEach((n, i) => { const h = n.offsetHeight; ticks[i].setAttribute("d", `M${ST[i].x} ${CY + h} L${ST[i].x} ${RY}`); });
      }
      const out = 1 - seg(lt, 26.4, 26.8);
      const on = nodes.map((n, i) => popAt(n, lt, 0.5 + i * 0.2, 26.4));
      // 站牌亮：Clawd（或尾声的包）停在这一站时
      nodes.forEach((n, i) => {
        const here = STOPS.some(([t0, k]) => k === i && T > t0 - 0.05 && T < t0 + 0.8) || ENC.some((t0, j) => STOPS[j][1] === i && T > t0 - 0.03 && T < t0 + 0.3);
        n.style.boxShadow = here ? "0 0 0 6px rgba(217,119,87,.35), 6px 6px 0 rgba(31,30,27,.12)" : "";
      });
      drawWire(line, seg(lt, 1.0, 2.0), out);
      // 站牌淡出时会往上飘，竖线跟着更快收掉，不留一截
      ticks.forEach((w, i) => drawWire(w, seg(lt, 1.4 + i * 0.1, 1.7 + i * 0.1), Math.min(out, Math.pow(on[i], 3))));
      // 走过的那段轨道变橙：折回 Worker 时不倒退
      const p = crabPos(t);
      const reach = T < STOPS[0][0] ? ST[0].x : T >= ARRIVE ? ST[4].x : Math.max(p.x, T > 8.4 ? ST[2].x : 0);
      drawWire(done, (reach - ST[0].x) / (ST[4].x - ST[0].x), out);
      // 按下播放
      const press = seg(T, 3.6, 3.75) * (1 - seg(T, 3.75, 3.95));
      btn.style.transform = `scale(${(1 - 0.18 * press).toFixed(3)})`;
      btn.style.background = T > 3.6 ? "var(--green-t)" : "#fff";
      setHTML(macSt, T > ENC[0] ? `<span style="color:var(--green)">▶</span> 群青` : T > 3.6 ? `<span style="color:var(--green)">▶</span> 夜に駆ける` : `<span style="color:var(--faint)">‖ 暂停中</span>`);
      setHTML(brSt, T > ARRIVE ? PLAYING : PAUSED);
      wkSt.style.visibility = T > 9.6 ? "visible" : "hidden";
      wkSt.style.color = T > 9.6 && T < 10.4 ? "var(--green)" : "";
      // Worker：第一次过关打勾；StateHub：已提交；折回 Worker：202 砸下
      place(ok, ST[1].x + 142, CY - 12, seg(T, 7.2, 7.35) * out, `translate(-100%, 0) scale(${lerp(0.5, 1, E.back(seg(T, 7.2, 7.45))).toFixed(3)})`);
      place(cm, ST[2].x + 142, CY - 12, seg(T, 8.4, 8.55) * out, `translate(-100%, 0) scale(${lerp(0.5, 1, E.back(seg(T, 8.4, 8.65))).toFixed(3)})`);
      s202(ST[1].x + 96, CY + 92, seg(T, 9.44, 9.6), out, -9);
      // 尺寸标注：从 Mac 到浏览器
      drawWire(dim, seg(T, 12.3, 12.7), out);
      popAt(dimLbl, lt, 12.7 - (s.t0 - c8.t0), 26.4, { x: 960 - dimLbl.offsetWidth / 2, y: 628 });
      // 采集 / 中枢 / 展示 三组
      glines.forEach((g, i) => drawWire(g, seg(T, 14.8 + i * 0.2, 15.1 + i * 0.2), 1 - seg(T, 18.3, 18.7)));
      glabs.forEach((e, i) => place(e, e.__c, 318, seg(T, 15.0 + i * 0.2, 15.2 + i * 0.2) * (1 - seg(T, 18.3, 18.7)), "translate(-50%, -50%)"));
      // 所有开着的页面同一刻翻牌；尾声再换一首
      minis.forEach((m, i) => {
        popAt(m.el, lt, 19.2 - (s.t0 - c8.t0) + i * 0.12, 26.4);
        const f = seg(T, 19.8, 20.1), f2 = seg(T, ENC[5], ENC[5] + 0.3);
        setHTML(m.st, f >= 0.5 ? PLAYING : PAUSED);
        setText(m.nm, f2 >= 0.5 ? "群青" : "夜に駆ける");
        const k = f > 0 && f < 1 ? f : f2 > 0 && f2 < 1 ? f2 : 0;
        m.nm.style.transform = k ? `perspective(200px) rotateX(${(k < 0.5 ? k * 180 : (k - 1) * 180).toFixed(1)}deg)` : "";
        m.pg.style.width = (T > ENC[5] ? 1 + (T - ENC[5]) * 1.6 : T > 19.95 ? 3 + (T - 19.95) * 1.6 : 3).toFixed(2) + "%";
      });
      const list = [];
      // 数据包一直抱在 Clawd 手里
      const ride = T > STOPS[0][0] - 0.02 && T < ARRIVE + 0.25;
      const grab = seg(T, STOPS[0][0] - 0.02, STOPS[0][0] + 0.22);
      if (ride) list.push({ x: p.x, y: RY - 202, text: "listening-now", cls: "green big", o: Math.min(grab * 3, 1 - seg(T, ARRIVE + 0.05, ARRIVE + 0.25)), s: lerp(0.4, 1, E.back(grab)), trail: p.moving, dir: [Math.sign(p.dir || 1), 0] });
      // 尾声：包自己沿轨道跑一遍
      if (T > ENC[0] && T < ENC[5] + 0.2) {
        let j = 0;
        while (j < ENC.length - 1 && T >= ENC[j + 1]) j++;
        const a = ST[STOPS[j][1]].x, b = ST[STOPS[Math.min(j + 1, 5)][1]].x;
        const k = j >= 5 ? 1 : E.io(seg(T, ENC[j], ENC[j + 1]));
        list.push({ x: lerp(a, b, k), y: RY, text: "群青", cls: "green", o: Math.min(seg(T, ENC[0], ENC[0] + 0.12), 1 - seg(T, ENC[5], ENC[5] + 0.2)), trail: j < 5, dir: [Math.sign(b - a) || 1, 0] });
      }
      pk(list);
    };
  });
  at(c8, 0, LEFT[0], LEFT[1]);
  look(c8, 0.5, 1);
  say(c8, 2.6, 4.9, "最后串一遍：主人按下播放——");
  emote(c8, 3.7, "note", 0.9, { dx: -30 });
  // 起跳：落在第一站正好在拍上
  at(c8, 5.1, LEFT[0], LEFT[1]);
  at(c8, STOPS[0][0], ST[0].x, RY - 20, "leap", { h: 140 });
  for (let i = 1; i < STOPS.length; i++) {
    at(c8, STOPS[i - 1][0] + 0.35, ST[STOPS[i - 1][1]].x, RY - 20);
    at(c8, STOPS[i][0], ST[STOPS[i][1]].x, RY - 20, "glide", { frame: { pose: "arms-up", offset: 0 } });
  }
  act(c8, ARRIVE + 0.05, "celebrate");
  at(c8, 13.3, ST[4].x, RY - 20);
  at(c8, 14.1, RIGHT[0], RIGHT[1], "leap", { h: 90 });
  act(c8, 14.1, "land");
  burst(c8, 14.1, RIGHT[0], RIGHT[1], "dust");
  look(c8, 14.3, -1);
  // 到站的打击点
  burst(c8, 10.8, ST[3].x, CY + 55, "rings", { r: 170 });
  duck(c8, ARRIVE, { pre: 0.5, depth: 0.15 });
  burst(c8, ARRIVE, ST[4].x, CY + 70, "confetti", { n: 56 });
  burst(c8, ARRIVE + 0.05, ST[4].x, CY + 55, "stars", { r: 120 });
  shake(c8, ARRIVE, 8, 0.3);
  burst(c8, 19.85, 470, 750, "stars", { r: 300, n: 10 });
  burst(c8, ENC[5] + 0.05, 470, 750, "stars", { r: 300, n: 8 });
  say(c8, 14.6, 18.6, "采集、中枢、展示，\n一站接一站。", "left");
  say(c8, 19.0, 23.6, "开着的页面，同一刻一起更新。", "left");
  say(c8, 24.2, 28.3, "这就是 {lyjw.me}。", "left");

  // --- 片尾 ---
  scene(c8, 28.8, 34.9, (root) => {
    const t1 = L("end-t", root, [...window.__tr("谢谢观看")].map((c) => `<span>${c === " " ? "&nbsp;" : c}</span>`).join(""));
    const chars = [...t1.children];
    const t2 = L("end-s", root, "讲解：Claude · Opus 5.5");
    const t3 = L("end-s mono", root, "lyjw.me · lyjw131.com");
    return (lt) => {
      chars.forEach((c, i) => {
        const st = 0.36 / Math.max(1, chars.length - 1); // 逐字跳出的总时长固定（中文四个字正好每字 0.12 s），英文字母多也按时出齐
        const k = seg(lt, 0.3 + i * st, 0.65 + i * st);
        c.style.transform = `translateY(${(36 * (1 - E.back(k))).toFixed(2)}px)`;
        c.style.opacity = k.toFixed(3);
      });
      place(t1, 0, 250, 1);
      const a = E.out(seg(lt, 1.0, 1.5)), b = E.out(seg(lt, 1.4, 1.9));
      place(t2, 0, 430 + 14 * (1 - a), a);
      place(t3, 0, 500 + 14 * (1 - b), b);
    };
  });
  at(c8, 28.8, RIGHT[0], RIGHT[1]);
  at(c8, 29.8, 960, 860);
  look(c8, 29.9, 0);
  act(c8, 30.0, "celebrate");
  burst(c8, 30.0, 420, 1000, "confetti", { spread: 1.2, speed: 1.1 });
  burst(c8, 30.0, 1500, 1000, "confetti", { spread: 1.2, speed: 1.1 });
  act(c8, 31.6, "jump");
  act(c8, 32.7, "look");
  // 圆形收场：收到 Clawd 身上，停一下，合上
  iris(c8, 32.0, 33.6, 960, 780);

  // ---------- 音效（语义化的；站牌、印章、彩纸、落地等由引擎自动生成） ----------
  sfx(c8, 3.6, "click"); sfx(c8, 3.66, "up");
  sfx(c8, STOPS[0][0] - 0.9, "riser", { dur: 0.9 });
  STOPS.forEach(([t, k], i) => sfx(c8, t, "station", { n: i, x: ST[k].x }));
  sfx(c8, 7.22, "ok");
  sfx(c8, 8.4, "click", { x: ST[2].x });
  sfx(c8, ARRIVE, "chime");
  sfx(c8, 12.72, "coin");
  sfx(c8, 19.8, "flip");
  ENC.forEach((t, i) => sfx(c8, t, "tick", { x: ST[STOPS[i][1]].x }));
  sfx(c8, ENC[5], "flip");
  sfx(c8, 30.0, "fanfare");
  sfx(c8, 33.3, "thump");

})();
