// 01 采集端 · 02 状态中枢
(() => {
  const { E, clamp, seg, lerp, inout, L, mk, icon, place, show, setHTML, setText, svgEl, chapter, scene, say, at, act, look, sfx, emote, burst, camera, shake, duck } = Engine;
  const { css, card, popAt, dropAt, wireLayer, wire, link, relink, drawWire, packets, J, codeBlock, stamp, penCircle, penLine, dimLine, ring, scramble, anchor } = Kit;
  const LEFT = [250, 975], RIGHT = [1670, 975];
  const mono = (s, sz = 19) => `<span class="mono" style="font-size:${sz}px">${s}</span>`;

  // ---------- 本章的小工具 ----------
  // 场景：render 拿到的是「章节内时间」T，时间表全按章节写，不用来回换算
  function sc(ch, a, b, build) { scene(ch, a, b, (root, s) => { const r = build(root, s); return (lt) => r(lt + a); }); }
  const late = (d, build) => (root, s) => { const r = build(root, s); return (T) => r(T - d); };
  const JX = 4.8; // 01 章窗口标题那段加长了 2 小节，后面的图片场景整体后移
  const mcard = (root, o, hd) => { const c = card(root, o); if (hd) c.querySelector(".hd").style.fontSize = hd + "px"; return c; };
  // 连线跟两端卡片一起淡：o 取两端可见度的最小值
  const wv = (p, k, ...vs) => drawWire(p, k, Math.min(1, ...vs));
  // 挂在卡片上下边的线：卡片淡出时会往上飘 10px，线要在头 0.1 s 里先收掉，免得端点离开卡边
  const wvY = (p, k, T, out, ...vs) => wv(p, k, 1 - seg(T, out, out + 0.1), ...vs);
  // 画在某个元素身上的笔迹层：1×1 的 svg 钉在宿主正中、内容溢出显示，跟着宿主一起淡出。
  // （宽高为 0 的 svg 按规范不渲染。）宿主量好尺寸后调 inkFit，让 svg 里的坐标就等于宿主内容区坐标
  function ink(el) { const s = svgEl("svg", { width: 1, height: 1, class: "L" }, el); s.style.cssText += ";left:50%;top:50%;overflow:visible"; s.__host = el; return s; }
  function inkFit(s) { const h = s.__host; s.setAttribute("viewBox", `${h.clientWidth / 2} ${h.clientHeight / 2} 1 1`); return s; }
  const inkNow = (el) => inkFit(ink(el));
  function hot(el, on, rgb = "217,119,87") { el.style.outline = on ? `4px solid rgba(${rgb},.6)` : ""; el.style.outlineOffset = on ? "3px" : ""; }
  // 被「按一下」：压扁再弹回（在 popAt 之后调用，叠加在 transform 上）
  function press(el, T, t0, d = 0.32, amt = 0.08) {
    const u = seg(T, t0, t0 + d);
    if (u <= 0 || u >= 1) return;
    const s = Math.sin(Math.PI * u) * amt * (1 - 0.5 * u);
    el.style.transform += ` scale(1, ${(1 - s).toFixed(4)})`; // 只压竖向：左右边不动，贴边的连线不会插进卡片
  }
  // 量包宽（和 kit 用同一个 class、同一个字号）
  function sizer(root) {
    const p = L("pkt", root); p.style.visibility = "hidden";
    const m = new Map();
    return (text, cls = "") => {
      const k = text + "|" + cls;
      if (!m.has(k)) { p.className = "L pkt " + cls; p.innerHTML = text; m.set(k, p.offsetWidth); }
      return m.get(k);
    };
  }
  // path 形式的包：kit 按包宽把行进比例夹紧（中心离两端各 w/2+10）。这里按「包中心停在路径第 d 像素」反算 f
  function fAt(path, d, w) {
    const len = path.__len ?? (path.__len = path.getTotalLength());
    const f0 = Math.min(0.45, (w / 2 + 10) / len);
    return clamp((d / len - f0) / (1 - 2 * f0));
  }
  const bz = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c; // 二次贝塞尔
  // 跑得快的包：按时间淡入淡出（路径首尾 12% 的淡入在快包上会一帧跳完）
  const quick = (T, t0, t1, d = 0.15) => ({ f: E.io(seg(T, t0, t1)), o: Math.min(seg(T, t0, t0 + d), 1 - seg(T, t1 - d, t1)), fade: false });
  // packets() 放进卡片时，它那张 1920×1080 的速度线画布也在卡片里；改成 ink 那样钉在正中，坐标不变
  function tame(parent) {
    const s = [...parent.children].find((e) => e.tagName.toLowerCase() === "svg" && e.getAttribute("width") === "1920");
    s.setAttribute("width", 1); s.setAttribute("height", 1);
    s.style.cssText += ";left:50%;top:50%;overflow:visible";
    s.__host = parent;
    return s;
  }

  css(`
  .pkt.mod{background:#fff;color:var(--ink);font-size:24px;font-weight:600;padding:8px 18px;border-width:2.5px;box-shadow:4px 4px 0 rgba(31,30,27,.12);display:flex;align-items:center;gap:11px;line-height:1.35}
  .pkt.mod small{font-family:var(--cjk);font-size:21px;font-weight:500;color:var(--muted)}
  .pkt.env{background:#fff;padding:0;border-width:2.5px;line-height:0;box-shadow:4px 4px 0 rgba(31,30,27,.12)}
  .pkt.icn{background:#34322D;color:#E8E4DA;padding:0;border-width:2.5px;line-height:0;width:150px;height:150px;display:flex;align-items:center;justify-content:center;box-shadow:5px 5px 0 rgba(31,30,27,.12)}
  .a-fmt{font-size:20px;padding:3px 12px}
  .a-seal{width:60px;height:60px;border-radius:50%;border:3px solid var(--ink);background:var(--orange);color:#fff;font:700 21px/54px var(--mono);text-align:center}
  .a-rt{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font:600 30px var(--mono)}
  .a-dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#B3AC9F;margin-right:10px;vertical-align:1px}
  .a-ev{width:92px;height:92px;display:flex;align-items:center;justify-content:center;padding:0}
  .a-dim{font:700 30px var(--mono);color:var(--orange-d);white-space:nowrap}
  .a-scan{position:absolute;top:0;width:30px;background:rgba(116,88,210,.3);border-left:4px solid var(--purple);border-right:2px solid rgba(116,88,210,.5)}
  .a-nt .nh{font:500 15px var(--mono);color:var(--muted);display:flex;align-items:center;gap:8px}
  .a-nt .nh i{margin-left:auto;display:flex}
  .a-nt .nt{font-size:22px;font-weight:600;margin-top:8px;white-space:nowrap}
  .a-nt .nb{font:500 18px var(--mono);color:#B3AEA4;margin-top:4px;white-space:nowrap}
  .a-nt .na{display:flex;margin-top:12px}
  .a-nt .na span{font-size:17px;font-weight:600;border:2px solid var(--ink);padding:3px 18px;background:var(--ink);color:#fff}
  .a-bucket{border:none;background:transparent;box-shadow:none;padding:0;width:324px;height:244px}
  .a-bucket b{position:absolute;left:0;top:94px;width:324px;text-align:center;font:700 56px/1 var(--mono)}
  .a-bucket span{position:absolute;left:0;top:164px;width:324px;text-align:center;font-size:21px;color:var(--muted)}
  .a-house{width:30px;height:20px;border:3px solid var(--ink);background:#fff;box-shadow:3px 3px 0 rgba(31,30,27,.12)}
  .a-bar{position:absolute;left:5px;top:17px;width:14px;height:64px;border:2.5px solid var(--ink);background:repeating-linear-gradient(-45deg,var(--red) 0 7px,#fff 7px 14px);transform-origin:50% 0}
  .a-end{font-size:21px;padding:4px 12px}
  .a-lane{border:2.5px dashed #9C8FD8;background:rgba(255,255,255,.55)}
  .a-commit{border:2.5px solid var(--ink);background:#fff;display:flex;align-items:center;justify-content:center;gap:6px;font-size:21px;font-weight:600;width:104px;height:70px}
  .a-tb{width:250px;padding:10px 16px;box-shadow:4px 4px 0 rgba(31,30,27,.1);display:flex;align-items:center;justify-content:space-between}
  .a-w .ln{position:relative}
  .a-hl{position:absolute;left:-10px;right:-10px;top:-2px;bottom:-2px;background:rgba(217,119,87,.16);outline:2px solid rgba(217,119,87,.6);z-index:-1}
  .a-brw{width:100px;height:76px;padding:0;box-shadow:3px 3px 0 rgba(31,30,27,.1)}
  .a-brw .bt{height:16px;border-bottom:2px solid var(--ink);background:#FBFAF7}
  .a-brw .bb{padding:7px 9px;display:flex;flex-direction:column;gap:6px}
  .a-brw .bb i{display:block;height:7px;background:#E6E3DC}
  .a-jev{width:790px;padding:18px 24px 20px}
  .a-jev .jh{display:flex;align-items:center;gap:12px;white-space:nowrap}
  .a-jev .jm{width:54px;height:54px;border:2px solid var(--ink);background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
  .a-jev .jh b{font:700 34px var(--mono)}
  .a-jev .js{font-size:20px;color:var(--muted)}
  .a-jev .jt{margin-left:auto}
  .a-jev .jc{font-size:21px;margin-top:12px;white-space:nowrap}
  .a-jev .jq{display:flex;align-items:center;gap:14px;margin-top:12px}
  .a-jev .jq span{font-size:19px;color:var(--muted);width:72px;flex:none;white-space:nowrap}
  .a-jev .jq i{position:relative;flex:1;height:20px;border:2px solid var(--ink);background:#fff}
  .a-jev .jq em{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--purple)}
  .a-jev .jmore{margin-top:4px}
  .a-jev .jmore span{color:#B3AC9F;font-size:22px;line-height:1}
  .a-jev .jl{display:flex;align-items:center;gap:12px;height:50px;margin-top:12px;padding-top:12px;border-top:2px dashed var(--line);font-size:19px;color:var(--muted);white-space:nowrap}
  .a-jev .jlt{font:600 15px var(--mono);border:2px solid #B3AC9F;color:var(--muted);padding:1px 8px;flex:none}
  .a-jev .jlw{flex:1;min-width:0;height:28px;overflow:hidden;position:relative}
  .a-jev .jli{position:absolute;left:0;top:0;height:28px;display:flex;align-items:center;gap:4px;white-space:nowrap}
  .a-jev .jcur{width:10px;height:22px;background:#B3AC9F;flex:none}
  `);

  // =====================================================================
  // 01 采集端（20 小节，48 s）
  // =====================================================================
  const c1 = chapter("采集端", "七个上报器，守在数据产生的地方", 20);
  at(c1, 0, LEFT[0], LEFT[1]);
  at(c1, 1.2, RIGHT[0], RIGHT[1]);
  look(c1, 1.2, -1);

  // --- 七个上报器 → API Worker：讲到哪组，哪组就真的发一封 ---
  const REP = [
    ["laptop", "Mac Telemetry Hub", "应用 · 音乐 · 充电 · 编码", "App", "o", ["mac"]],
    ["smartphone", "iPhone Telemetry Hub", "活动圆环 · 训练", "App", "o", ["iphone"]],
    ["house", "Home Assistant", "HomePod 正在播放 · PS5 电源", "自动化", "", ["homepod", "playstation"]],
    ["clapperboard", "Emby 上报器", "正在看 · 续看", "容器 · NAS", "p", ["emby"]],
    ["server", "服务器上报器", "CPU · 内存 · 流量", "容器 · 东京", "p", ["server"]],
    ["gauge", "限额上报器", "编码工具的账号限额", "容器 · 东京", "p", ["agents"]],
    ["gamepad-2", "PlayStation 上报器", "在线 · 游戏 · 奖杯", "Worker · 每分钟", "g", ["playstation"]],
  ];
  // [卡片, 出发时刻, 包上的字, 包的颜色]
  const SEND = [[0, 3.5, "mac", ""], [1, 3.65, "iphone", ""], [3, 4.4, "emby", "purple"], [4, 4.55, "server", "purple"],
    [5, 4.7, "agents", "purple"], [6, 5.45, "playstation", "green"], [2, 6.15, "homepod", "blue"], [2, 7.9, "playstation", "blue"]];
  sc(c1, 1.9, 12.0, (root) => {
    const OUT = 11.3, FLY = 0.8;
    const wl = wireLayer(root);
    const cards = REP.map(([ic, nm, what, where, c, eps], i) =>
      mcard(root, { x: i < 4 ? 80 : 1330, y: 0, w: i < 4 ? 520 : 500, icon: ic, title: nm, sub: what,
        tags: [{ t: where, c }, ...eps.map((e) => ({ t: `/api/ingest/${e}` }))] }, 25));
    const hub = mcard(root, { x: 800, y: 0, w: 350, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "只有它收上报" }, 29);
    const wires = cards.map((c, i) => (i < 4 ? link(wl, c, "r", hub, "l", { kb: 0.2 + 0.2 * i }) : link(wl, c, "l", hub, "r", { kb: 0.25 + 0.25 * (i - 4) })));
    const whereTag = cards.map((c) => c.querySelector(".tg"));
    // PlayStation 上报器是 cron 叫醒的 Worker：右上角一只小闹钟
    const clock = L("", cards[6]);
    clock.style.cssText += ";left:auto;right:16px;top:16px;width:42px;height:42px;border:2px solid var(--ink);border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center";
    clock.innerHTML = icon("clock", 24, 2.2);
    const pk = packets(root, SEND.length);
    let circ = null;
    return (T) => {
      if (!circ) {
        let y = 124;
        for (let i = 0; i < 4; i++) { cards[i].__y = y; y += cards[i].offsetHeight + 16; }
        y = 124;
        for (let i = 4; i < 7; i++) { cards[i].__y = y; y += cards[i].offsetHeight + 16; }
        hub.__y = Math.round(384 - hub.offsetHeight / 2);
        relink(wl);
        // 两处 /api/ingest/playstation 各圈一下（笔迹画在卡片身上）
        circ = [2, 6].map((ci, n) => {
          const tg = [...cards[ci].querySelectorAll(".tg")].pop();
          const cx = tg.offsetLeft + tg.offsetWidth / 2, cy = tg.offsetTop + tg.offsetHeight / 2;
          return penCircle(inkNow(cards[ci]), cx, cy, tg.offsetWidth / 2 + 15, tg.offsetHeight / 2 + 10, { seed: 5 + n });
        });
      }
      const vc = cards.map((c, i) => popAt(c, T, (i < 4 ? 2.0 : 2.15) + (i % 4) * 0.1, OUT));
      const vh = dropAt(hub, T, 2.45, OUT);
      wires.forEach((w, i) => wv(w, seg(T, 2.95 + i * 0.05, 3.35 + i * 0.05), vc[i], vh));
      // 发包：卡片先按一下，「在哪跑」的标签亮一下，包沿线飞进 Worker
      const list = [];
      SEND.forEach(([ci, t0, text, cls], j) => {
        press(cards[ci], T, t0 - 0.12);
        if (T >= t0 && T <= t0 + FLY) list[j] = { path: wires[ci], f: E.io(seg(T, t0, t0 + FLY)), text, cls: cls + " big", trail: true };
      });
      pk(list);
      whereTag.forEach((tg, i) => {
        const on = SEND.some(([ci, t0]) => ci === i && T > t0 - 0.15 && T < t0 + 0.7);
        tg.style.boxShadow = on ? "0 0 0 4px rgba(217,119,87,.45)" : "";
      });
      hot(hub, SEND.some(([, t0]) => T > t0 + FLY - 0.06 && T < t0 + FLY + 0.28), "46,158,79");
      const rg = seg(T, 5.15, 5.6);
      clock.style.transform = rg > 0 && rg < 1 ? `rotate(${(16 * Math.sin(rg * Math.PI * 8) * (1 - rg)).toFixed(1)}deg)` : "";
      circ.forEach((p, n) => drawWire(p, seg(T, 8.9 + n * 0.45, 9.3 + n * 0.45)));
    };
  });
  say(c1, 2.6, 6.8, "各自往 {/api/ingest/<来源>} 发，\n谁的数据，就报到谁名下。", "left");
  say(c1, 7.2, 11.6, "所以 Home Assistant 报的 PS5 电源，\n也记在 {playstation} 名下。", "left");
  emote(c1, 9.5, "!", 1.2);
  sfx(c1, 5.15, "alarm", { x: 1580 });

  // --- Mac 信封：模块像货物一样装进各自的格子，封口，带速度线飞走 ---
  const ENV = [
    `<span class="c">// Mac → POST /api/ingest/mac</span>`,
    J.p("{"),
    `  ${J.k("version")}${J.p(":")} ${J.n("4")}${J.p(",")}`,
    `  ${J.k("heartbeatAt")}${J.p(":")} ${J.n("1790000123456")}${J.p(",")}`,
    `  ${J.k("presence")}${J.p(":")} ${J.s("online")}${J.p(",")}`,
    `  ${J.k("activeModules")}${J.p(": [")}${J.s("desktop")}${J.p(",")} ${J.s("appleMusic")}${J.p(",")} <span class="a-chg">${J.s("charger")}</span>${J.p("],")}`,
    `  ${J.k("modules")}${J.p(": {")}`,
    `    ${J.k("desktop")}${J.p(": {")} ${J.k("applicationName")}${J.p(":")} ${J.s("Ghostty")} ${J.p("},")}`,
    `    ${J.k("appleMusic")}${J.p(": {")} ${J.k("title")}${J.p(":")} ${J.s("夜に駆ける")} ${J.p("}")}`,
    `  ${J.p("}")}`,
    J.p("}"),
  ];
  // [图标, 模块, 说明, 落进第几行（-1：只在 activeModules 里点名）, 起飞时刻]
  const MODS = [["monitor", "desktop", "Ghostty", 7, 14.0], ["music", "appleMusic", "夜に駆ける", 8, 14.8], ["battery-charging", "charger", "没变", -1, 15.95]];
  const ENV_SVG = `<svg width="184" height="87" viewBox="0 0 184 87"><path d="M0 0 L92 40 L184 0" fill="none" stroke="#1F1E1B" stroke-width="2.5"/><path d="M0 87 L92 50 L184 87" fill="none" stroke="#1F1E1B" stroke-width="2" stroke-opacity=".35"/><circle cx="92" cy="40" r="11" fill="#D97757" stroke="#1F1E1B" stroke-width="2"/></svg>`;
  sc(c1, 12.0, 20.4, (root) => {
    const code = codeBlock(root, ENV.map((h) => `<span class="a-ln">${h}</span>`), { w: 920 });
    const ov = ink(code.el);
    const req = L("tg o", code.el, "必填");
    const seal = L("a-seal", code.el, "v4");
    const modPk = packets(code.el, 3);
    const modTrail = tame(code.el);
    const envPk = packets(root, 1);
    const mp = ink(root); // 看不见的运动路径
    const size = sizer(root);
    const ORDER = [0, 1, 2, 3, 4, 5, 6, 9, 10]; // 先亮出骨架，两格模块等货物落进来
    let G = null;
    return (T) => {
      if (!G) {
        const W = code.el.clientWidth, H = code.el.clientHeight, X0 = 82.5, Y0 = 152.5;
        inkFit(ov); inkFit(mp); inkFit(modTrail);
        const sp = code.ls.map((l) => l.firstChild);
        const chg = code.el.querySelector(".a-chg");
        const mid = (e) => [e.offsetLeft + e.offsetWidth / 2, e.offsetTop + e.offsetHeight / 2];
        // 必填括号：version / heartbeatAt / presence / activeModules
        const bx = Math.max(...[2, 3, 4, 5].map((i) => sp[i].offsetLeft + sp[i].offsetWidth)) + 16;
        const y2 = sp[2].offsetTop + 2, y5 = sp[5].offsetTop + sp[5].offsetHeight - 2, ym = (y2 + y5) / 2;
        const brk = wire(ov, `M${bx} ${y2} q12 0 12 12 V${ym - 12} q0 12 11 12 q-11 0 -11 12 V${y5 - 12} q0 12 -12 12`, { color: "#B5532F", width: 4, opacity: 0.9 });
        req.__x = bx + 30; req.__y = ym - 14;
        const under = penLine(ov, chg.offsetLeft, chg.offsetTop + chg.offsetHeight + 1, chg.offsetLeft + chg.offsetWidth, chg.offsetTop + chg.offsetHeight + 1, { seed: 4, bow: 4 });
        // 封口：信封背面那块三角翻下来
        const flap = svgEl("g", {}, ov);
        svgEl("polygon", { points: `0,0 ${W},0 ${W / 2},${(H * 0.46).toFixed(1)}`, fill: "#FBFAF7", stroke: "#1F1E1B", "stroke-width": 2.5, "stroke-linejoin": "round" }, flap);
        const fold = svgEl("path", { d: `M0 ${H} L${W / 2} ${(H * 0.6).toFixed(1)} L${W} ${H}`, fill: "none", stroke: "#1F1E1B", "stroke-width": 2, "stroke-opacity": 0.35 }, ov);
        seal.__x = W / 2 - 30; seal.__y = H * 0.46 - 30;
        // 货物：从右边的架子上起飞，落进各自的格子
        const mods = MODS.map(([ic, name, sub, li], i) => {
          const rest = [1300 - X0, 232 + 104 * i - Y0];
          const end = li >= 0 ? mid(sp[li]) : mid(chg);
          return { html: `${icon(ic, 26, 2.2)}${name} <small>${sub}</small>`, rest, end, ctl: [(rest[0] + end[0]) / 2, Math.min(rest[1], end[1]) - 150] };
        });
        // 封好的信封：沿一条看不见的路飞出去（起点往回退半个包宽，好让包中心正好从信封中心出发）
        const cx = 80 + code.el.offsetWidth / 2, cy = 150 + code.el.offsetHeight / 2, ew = size(ENV_SVG, "env");
        const fp = wire(mp, `M${cx - ew / 2 - 10} ${cy} L${cx + 60} ${cy} C${cx + 420} ${cy} ${1400} 250 1780 150`, { opacity: 0 });
        G = { brk, under, flap, fold, mods, fp };
      }
      // 信封（代码卡）本体：弹出 → 收缩成小信封
      const kin = seg(T, 12.1, 12.45), shrink = seg(T, 18.72, 19.12), xf = seg(T, 19.02, 19.14);
      code.el.style.transformOrigin = "50% 50%";
      place(code.el, 80, 150, Math.min(kin, 1 - xf), `scale(${(lerp(0.86, 1, E.back(kin)) * lerp(1, 0.2, shrink)).toFixed(4)})`);
      const n = Math.floor(seg(T, 12.3, 13.3) * ORDER.length + 1e-6);
      code.ls.forEach((l, i) => {
        const m = MODS.find((x) => x[3] === i);
        const on = m ? T >= m[4] + 0.5 : ORDER.indexOf(i) < n;
        l.style.visibility = on ? "visible" : "hidden";
        l.classList.toggle("hl", !!m && T > m[4] + 0.5 && T < m[4] + 1.1);
      });
      // 货物
      const list = G.mods.map((m, i) => {
        const t0 = MODS[i][4];
        const kIn = seg(T, 12.9 + i * 0.15, 13.25 + i * 0.15);
        if (kIn <= 0) return null;
        const dur = i === 2 ? 0.55 : 0.6, u = seg(T, t0, t0 + dur), e = E.io(u);
        if (u >= 1) return null;
        // charger 起飞前先摇摇头：没变
        const wob = i === 2 && T < t0 ? 12 * Math.sin(seg(T, t0 - 0.5, t0 - 0.05) * Math.PI * 5) : 0;
        const x = bz(m.rest[0], m.ctl[0], m.end[0], e) + wob, y = bz(m.rest[1], m.ctl[1], m.end[1], e);
        const e2 = Math.min(1, e + 0.02);
        const dx = bz(m.rest[0], m.ctl[0], m.end[0], e2) - x, dy = bz(m.rest[1], m.ctl[1], m.end[1], e2) - y;
        return { x, y, text: m.html, cls: "mod", s: lerp(0.86, 1, E.back(kIn)) * lerp(1, i === 2 ? 0.3 : 0.7, E.in(u)), o: Math.min(kIn * 1.5, 1 - seg(u, 0.78, 1)), dir: u > 0 ? [dx, dy] : null, trail: u > 0.05 && u < 0.85 };
      });
      modPk(list);
      const chg = code.el.querySelector(".a-chg");
      chg.style.background = T > 16.4 && T < 17.6 ? "var(--orange-t)" : "";
      drawWire(G.under, seg(T, 16.45, 16.8));
      drawWire(G.brk, seg(T, 17.3, 17.65));
      popAt(req, T, 17.6);
      // 封口
      const fk = E.back(seg(T, 18.15, 18.5));
      G.flap.setAttribute("transform", `scale(1 ${Math.max(0, fk).toFixed(4)})`);
      G.flap.style.opacity = fk > 0 ? "1" : "0";
      G.fold.style.opacity = (0.35 * seg(T, 18.2, 18.45) / 0.35).toFixed(3);
      const sk = seg(T, 18.5, 18.68);
      seal.style.transformOrigin = "50% 50%";
      place(seal, seal.__x, seal.__y, clamp(sk * 4), `scale(${lerp(1.8, 1, E.in(sk)).toFixed(3)})`);
      // 小信封飞走：先慢后快，按时间淡出（不靠路径末端那 12%，否则加速时会一帧消失）
      const fl = seg(T, 19.2, 19.9);
      envPk(T >= 19.02 && fl < 1 ? [{ path: G.fp, f: 0.12 * fl + 0.88 * fl * fl, text: ENV_SVG, cls: "env", o: xf * (1 - seg(fl, 0.55, 1)), fade: false, trail: fl > 0.02 }] : []);
    };
  });
  say(c1, 12.8, 17.2, "只装变了的模块；\n没变的在 {activeModules} 里点个名。", "left");
  sfx(c1, 14.6, "click", { x: 400 }); sfx(c1, 15.4, "click", { x: 400 });
  sfx(c1, 18.15, "flip", { x: 540 }); sfx(c1, 18.68, "thump", { x: 540 });
  sfx(c1, 19.2, "whoosh", { x: 1100 });
  duck(c1, 19.2);
  act(c1, 19.25, "jump");

  // --- 报平安 vs 快车道：90 秒的倒计时环，对比不到一秒的赛道 ---
  // [出发, 用时, 图标, 包上的字, 实测（插拔充电没有实测数字，不写）]
  const EVS = [[25.9, 0.42, "play", "播放", "0.32–0.49 s"], [26.85, 0.6, "app-window", "切换应用", "0.56–0.62 s"], [27.75, 0.45, "battery-charging", "插拔充电", ""]];
  sc(c1, 20.4, 28.8, (root) => {
    const OUT = 28.2, YA = 246, YB = 548;
    const wl = wireLayer(root);
    const beatC = mcard(root, { x: 80, y: 0, w: 540, icon: "heart", title: "报平安", sub: "没变化：90 秒一封空信封" }, 32);
    const rg = ring(root, { r: 58, w: 13, color: "var(--green)" });
    const rgT = L("a-rt", rg, "90s");
    const nodeA = mcard(root, { x: 1330, y: 0, w: 320, icon: "globe", title: "站点", lines: [`<span class="a-dot"></span>在线`] }, 30);
    const fastC = mcard(root, { x: 80, y: 0, w: 540, tint: "orange", icon: "zap", title: "快车道", sub: "要紧的变化立刻发",
      lines: EVS.map(([, , ic, , ], i) => `${icon(ic, 22, 2.2)} ${["播放 / 暂停", "切换应用", "插拔充电"][i]}`) }, 32);
    const lns = [...fastC.querySelectorAll(".ln")];
    lns.forEach((l) => { l.style.cssText += ";display:flex;align-items:center;gap:10px;padding:0 8px;margin-left:-8px;font-size:22px"; });
    // 实测数字跟在各自那一行后面，到站后一直留着（插拔充电没测过，只写「未实测」）
    const meas = lns.map((l, i) => { const m = mk("span", "", l, EVS[i][4] || "未实测"); m.style.cssText = `margin-left:auto;font-family:var(--mono);font-size:19px;color:${EVS[i][4] ? "var(--orange-d)" : "var(--faint)"};opacity:0`; return m; });
    const ev = L("card a-ev", root);
    const evIc = mk("div", "", ev);
    const nodeB = mcard(root, { x: 1330, y: 0, w: 320, icon: "globe", title: "站点", sub: "显示新状态" }, 30);
    const dimBox = L("", root);
    const dimSvg = ink(dimBox);
    const dimT = L("a-dim", dimBox);
    const trackA = link(wl, rg, "r", nodeA, "l");
    const trackB = link(wl, ev, "r", nodeB, "l");
    const pk = packets(root, 4);
    let G = null, lastIc = "";
    return (T) => {
      if (!G) {
        beatC.__y = Math.round(YA - beatC.offsetHeight / 2);
        rg.__x = 700; rg.__y = YA - rg.offsetHeight / 2;
        nodeA.__y = Math.round(YA - nodeA.offsetHeight / 2);
        fastC.__y = Math.round(YB - fastC.offsetHeight / 2);
        ev.__x = 712; ev.__y = YB - 46;
        nodeB.__y = Math.round(YB - nodeB.offsetHeight / 2);
        dimBox.__x = 828; dimBox.__y = YB - 96; dimBox.style.width = "478px"; dimBox.style.height = "44px";
        inkFit(dimSvg);
        G = { dl: dimLine(dimSvg, 6, 472, 30, { h: 13 }) };
        relink(wl);
      }
      const vR = popAt(rg, T, 20.75, OUT), vNA = popAt(nodeA, T, 20.9, OUT);
      popAt(beatC, T, 20.55, OUT);
      // 倒计时 90 → 0，归零那一拍心跳
      const cd = seg(T, 21.2, 24.0), hb = seg(T, 24.0, 24.4);
      rg.set(T < 24.0 ? cd : 0.03 * seg(T, 24.3, 28.0));
      setText(rgT, T < 24.0 ? `${Math.ceil(90 * (1 - cd))}s` : T < 24.4 ? "0s" : "90s");
      rgT.style.color = T >= 24.0 && T < 24.4 ? "var(--green)" : "";
      rg.firstChild.style.transform = `rotate(-90deg) scale(${(1 + 0.16 * Math.sin(Math.PI * hb)).toFixed(4)})`; // 只让圆环本身跳，盒子不动
      wv(trackA, seg(T, 21.1, 21.5), vR, vNA);
      nodeA.querySelector(".a-dot").style.background = T > 24.6 ? "var(--green)" : "";
      hot(nodeA, T > 24.6 && T < 25.0, "46,158,79");
      // 快车道
      popAt(fastC, T, 24.6, OUT);
      const vE = popAt(ev, T, 24.8, OUT), vNB = popAt(nodeB, T, 24.95, OUT);
      wv(trackB, seg(T, 25.15, 25.55), vE, vNB);
      popAt(dimBox, T, 25.35, OUT);
      drawWire(G.dl, seg(T, 25.35, 25.75));
      let cur = -1;
      EVS.forEach(([t0], i) => { if (T >= t0 - 0.15) cur = i; });
      const ic = EVS[Math.max(0, cur)][2];
      if (ic !== lastIc) { evIc.innerHTML = icon(ic, 46, 2.2); lastIc = ic; }
      const flip = cur >= 0 ? seg(T, EVS[cur][0] - 0.15, EVS[cur][0]) : 1;
      evIc.style.transform = `scale(${lerp(0.4, 1, E.back(flip)).toFixed(3)})`;
      lns.forEach((l, i) => { l.style.background = i === cur && T < OUT ? "rgba(217,119,87,.22)" : ""; });
      // 实测数字：到站那一刻亮在对应那一行，之后一直留着；尺寸线上只标出处
      meas.forEach((m, i) => { const [t0, dur] = EVS[i]; m.style.opacity = seg(T, t0 + dur, t0 + dur + 0.2).toFixed(3); });
      const lk = seg(T, 25.75, 25.95);
      setText(dimT, "事件 → 站点 · 8 月实测");
      dimT.style.transformOrigin = "50% 100%";
      place(dimT, 239 - dimT.offsetWidth / 2, -26, lk, `scale(${lerp(0.6, 1, E.back(lk)).toFixed(3)})`);
      const list = [];
      if (T >= 24.05 && T <= 24.6) list[0] = { path: trackA, ...quick(T, 24.05, 24.6), text: "{ }", cls: "green big", trail: true };
      EVS.forEach(([t0, dur, , text], i) => { if (T >= t0 && T <= t0 + dur) list[1 + i] = { path: trackB, ...quick(T, t0, t0 + dur, 0.12), f: seg(T, t0, t0 + dur), text, cls: "big", trail: true }; });
      pk(list);
      hot(nodeB, EVS.some(([t0, dur]) => T > t0 + dur && T < t0 + dur + 0.3));
    };
  });
  say(c1, 20.8, 25.0, "每封信都算一次在线心跳，\n所以没变化也要定时报。", "left");
  [21.6, 22.2, 22.8, 23.4].forEach((t) => sfx(c1, t, "clock", { x: 765 }));
  sfx(c1, 24.0, "heartbeat", { x: 765 });
  burst(c1, 24.0, 765.5, 246, "rings", { r: 140 });
  emote(c1, 24.2, "heart", 0.9);
  EVS.forEach(([t0]) => sfx(c1, t0, "zap", { x: 760 }));

  // --- 窗口标题的隐私判断：扫描，然后像代码分支一样只点亮一条出路 ---
  const OUTS = [["green", "check", "放行", "进信封", "46,158,79", "#2E9E4F"], ["gray", "lock", "不放行", "不上报", "110,106,98", "#6E6A62"], ["amber", "bell", "拿不准", "交给主人", "201,138,18", "#C98A12"]];
  const RUNS = [[29.9, 30.8, 31.4], [31.4, 32.2, 32.8], [32.8, 33.6, 99]]; // [出发, 点亮分支, 分支熄灭]
  // Jev 介绍面板。官方说法：System One 模型，状态进、带概率的类型化答案出，一次查询并行作答，不逐字生成
  // 标志是 TypeSafe 官方 SVG（站点服务状态卡用的同一份）
  const TS_MARK = `<svg viewBox="-3.7565 0 24 24" width="32" height="32" fill="currentColor"><path d="M 12.756 2.928 L 12.756 7.067 L 16.486 9.487 L 16.487 18.652 L 8.244 24 L 3.732 21.073 L 3.732 16.82 L 0 14.399 L 0 5.35 L 0.355 5.118 L 8.244 0 Z M 5.94 20.65 L 8.242 22.144 L 14.275 18.227 L 11.975 16.735 Z M 9.022 10.332 L 9.022 14.4 L 5.29 16.822 L 5.29 19.216 L 11.197 15.383 L 11.197 8.921 Z M 12.756 15.384 L 14.928 16.794 L 14.928 10.332 L 12.756 8.922 Z M 2.21 13.976 L 4.511 15.47 L 6.812 13.976 L 4.512 12.485 Z M 1.559 6.193 L 1.559 12.544 L 3.731 11.134 L 3.731 7.066 L 7.464 4.643 L 7.464 2.36 L 1.56 6.193 Z M 5.291 11.132 L 7.463 12.542 L 7.463 10.332 L 5.292 8.921 L 5.292 11.132 Z M 5.94 7.487 L 8.244 8.981 L 10.544 7.488 L 8.244 5.994 Z M 9.024 4.643 L 11.196 6.054 L 11.196 3.774 L 9.024 2.359 Z"/></svg>`;
  // 示意数值：只为画出「几道问题同一刻各给一个概率」，和画面上点亮哪条出路无关
  const JV = [[0.34, 0.72, 0.26], [0.29, 0.86, 0.38], [0.24, 0.39, 0.71]];
  const LLM_TEXT = window.__tr("好的，让我们一步一步来分析这个窗口标题。首先，我需要弄清楚这个标题来自哪个应用，以及它大概在描述什么内容。其次，我会结合常见的使用场景，想一想把它公开出去是否合适。为了稳妥起见，我们不妨先把各种可能的情况都列出来，再逐条权衡利弊：第一种情况，它可能只是一个普通的窗口名称；第二种情况，它也可能");
  sc(c1, 28.8, 40.8, (root) => {
    const OUT = 40.45, YJ = 372;
    const wl = wireLayer(root);
    const title = mcard(root, { x: 80, y: 0, w: 360, icon: "app-window", title: "窗口标题", sub: "前台窗口，一条条来" }, 30);
    const judge = mcard(root, { x: 600, y: 0, w: 380, tint: "purple", icon: "eye", title: "隐私判断", sub: "Jev 参与" }, 32);
    const outs = OUTS.map(([tint, ic, t, s], i) => mcard(root, { x: 1130, y: 132 + i * 180, w: 380, tint, icon: ic, title: t, sub: s }, 30));
    const scanEl = L("a-scan", judge);
    const note = L("card a-nt", root);
    note.style.width = "318px"; note.style.padding = "14px 18px";
    note.innerHTML = `<div class="nh">${icon("bell", 16, 2.2)}Mac 通知<i>${icon("x", 16, 2.4)}</i></div><div class="nt">Ghostty 窗口标题公开确认</div><div class="nb">▇▇▇▇ — ▇▇▇</div><div class="na"><span>公开</span></div>`;
    note.__x = 1552; note.__y = 132;
    const w0 = link(wl, title, "r", judge, "l");
    const ws = outs.map((o) => link(wl, judge, "r", o, "l"));
    const hls = OUTS.map((o) => wire(wl, "M0 0", { color: o[5], width: 5, opacity: 0.9 }));
    const jev = L("card a-jev", root);
    jev.innerHTML = `<div class="jh"><span class="jm">${TS_MARK}</span><b>Jev</b><span class="js">System One 模型 · TypeSafe AI</span><span class="tg p jt">官方 70–500 ms</span></div>` +
      `<div class="jc">状态进，概率出；几道问题一次答完，不逐字生成。</div>` +
      [0, 1, 2].map(() => `<div class="jq"><span>问题</span><i><em></em></i></div>`).join("") + `<div class="jq jmore"><span>⋯</span></div>` +
      `<div class="jl"><span class="jlt">LLM · 示意</span><div class="jlw"><div class="jli"><span class="jlx"></span><span class="jcur"></span></div></div></div>`;
    jev.__x = 80;
    const jBars = [...jev.querySelectorAll(".jq em")], jTracks = [...jev.querySelectorAll(".jq i")];
    const jText = jev.querySelector(".jlx"), jCur = jev.querySelector(".jcur"), jWin = jev.querySelector(".jlw"), jLine = jev.querySelector(".jli");
    const jo = { color: "#7458D2", width: 3, opacity: 0.75 };
    const wj = link(wl, judge, "b", jev, "t", jo);
    const pk = packets(root, 3);
    let ready = false;
    return (T) => {
      if (!ready) {
        ready = true;
        title.__y = Math.round(YJ - title.offsetHeight / 2);
        judge.__y = Math.round(YJ - judge.offsetHeight / 2);
        // 面板挂在判断卡正下方：竖线从判断卡底边中点垂直落到面板顶边
        jev.__y = judge.__y + judge.offsetHeight + 96;
        jo.kb = (judge.__x + judge.offsetWidth / 2 - jev.__x) / jev.offsetWidth;
        relink(wl);
        ws.forEach((w, i) => { hls[i].setAttribute("d", w.getAttribute("d")); hls[i].__len = null; });
        scanEl.style.height = judge.clientHeight + "px";
      }
      // 三次判断和通知走完后把画面让给 Jev：上面的流程压暗（dm），面板描一圈紫边
      const dm = 1 - 0.68 * E.io(seg(T, 36.1, 36.7));
      const vT0 = popAt(title, T, 28.95, OUT), vJ0 = popAt(judge, T, 29.1, OUT);
      const vT = vT0 * dm, vJ = vJ0 * dm;
      if (dm < 1) { show(title, vT); show(judge, vJ); }
      const vo = outs.map((o, i) => popAt(o, T, 29.3 + i * 0.15, OUT) * dm);
      // 当前点亮的分支：其余两条出路和卡片变淡
      let pick = -1, hk = 0;
      RUNS.forEach(([, d, h], i) => { const k = inout(T, d, Math.min(h, OUT + 0.3), 0.2, 0.2); if (k > 0) { pick = i; hk = k; } });
      outs.forEach((o, i) => {
        const f = i === pick ? 1 : 1 - 0.62 * hk;
        if (f < 1 || dm < 1) show(o, vo[i] * f);
        hot(o, i === pick && hk > 0.5, OUTS[i][4]);
      });
      wv(w0, seg(T, 29.45, 29.85), vT, vJ);
      ws.forEach((w, i) => { const f = i === pick ? 1 : 1 - 0.62 * hk; wv(w, seg(T, 29.95 + i * 0.06, 30.35 + i * 0.06), vJ * f, vo[i] * f); });
      hls.forEach((h, i) => { const [, d, e] = RUNS[i]; wv(h, seg(T, d, d + 0.4), vJ, vo[i], inout(T, d, Math.min(e, OUT + 0.3), 0.2, 0.2)); });
      // 扫描光条：判断的时候卡片也亮一圈
      let sk = -1;
      RUNS.forEach(([r0, d]) => { if (T >= r0 + 0.45 && T < d) sk = seg(T, r0 + 0.45, d - 0.05); });
      place(scanEl, lerp(0, judge.clientWidth - 30, E.io(clamp(sk))), 0, sk < 0 ? 0 : Math.min(1, sk * 6, (1 - sk) * 6));
      hot(judge, sk >= 0, "116,88,210");
      // 三个标题依次过闸
      const list = [];
      RUNS.forEach(([r0, d], i) => {
        const text = `标题 ${"①②③"[i]}`;
        if (T >= r0 && T <= r0 + 0.45) list[i] = { path: w0, ...quick(T, r0, r0 + 0.45), text, cls: "gray big", trail: true };
        else if (T >= d && T <= d + 0.45) list[i] = { path: ws[i], ...quick(T, d, d + 0.45), text, cls: "gray big", trail: true };
      });
      pk(list);
      // 不放行：锁头扣一下；拿不准：主人的 Mac 右上角弹出通知
      const lk = seg(T, 32.65, 33.0);
      outs[1].querySelector(".ic").style.transform = lk > 0 && lk < 1 ? `rotate(${(12 * Math.sin(lk * Math.PI * 4) * (1 - lk)).toFixed(1)}deg)` : "";
      const vN = popAt(note, T, 34.0, OUT, { dx: 60 });
      if (dm < 1) show(note, vN * dm);
      // Jev：判断卡扫描时几道问题一起「想」，扫完的同一刻一起给出概率；对照行的 LLM 还在一个字一个字地写
      const vP = popAt(jev, T, 29.75, OUT);
      wvY(wj, seg(T, 30.12, 30.42), T, OUT, vJ0, vP);
      hot(jev, T > 36.3 && T < OUT, "116,88,210");
      let fill = [0, 0, 0], think = 0;
      RUNS.forEach(([r0, d], i) => {
        if (T >= r0 + 0.45 && T < d) { const u = seg(T, r0 + 0.45, d); think = Math.min(1, u * 6, (1 - u) * 6); }
        const nx = RUNS[i + 1];
        if (T >= d) { const k = E.out(seg(T, d, d + 0.22)) * (1 - (nx ? E.io(seg(T, nx[0], nx[0] + 0.3)) : 0)); fill = JV[i].map((v) => v * k); }
      });
      jBars.forEach((b, j) => (b.style.width = (fill[j] * 100).toFixed(2) + "%"));
      // 「想」的时候是滚动的斜条纹（处理中），给出结果时换成实心条
      jTracks.forEach((tr) => {
        tr.style.background = think > 0 ? `repeating-linear-gradient(-45deg,rgba(116,88,210,${(0.4 * think).toFixed(3)}) 0 8px,#fff 8px 16px)` : "#fff";
        if (think > 0) tr.style.backgroundPosition = `${((T * 60) % 22.627).toFixed(2)}px 0`;
      });
      // 每秒十几个字往外冒，写满一行就往左滚；左缘淡出
      setText(jText, LLM_TEXT.slice(0, Math.min(LLM_TEXT.length, Math.max(0, Math.floor((T - 30.35) * 14)))));
      const over = Math.max(0, jLine.offsetWidth - jWin.clientWidth);
      jLine.style.transform = over ? `translateX(${-over}px)` : "";
      jWin.style.webkitMaskImage = jWin.style.maskImage = over ? "linear-gradient(90deg,transparent 0,#000 48px)" : "";
      jCur.style.opacity = T < 30.35 && Math.floor(T * 2.5) % 2 ? 0 : 1;
    };
  });
  say(c1, 29.2, 33.4, "窗口标题可能带着隐私，\n所以上报前要先过这一关。", { side: "left", dy: 8 });
  say(c1, 36.3, 40.4, "Jev 的概率是校准过的：\n说九成把握，大约九成会对。", { side: "left", dy: 8 });
  sfx(c1, 30.35, "scan", { dur: 0.45, x: 790 }); sfx(c1, 31.85, "scan", { dur: 0.35, x: 790 }); sfx(c1, 33.25, "scan", { dur: 0.35, x: 790 });
  sfx(c1, 30.8, "ok", { x: 1320 }); sfx(c1, 32.65, "click", { x: 1320 }); sfx(c1, 34.0, "chime", { x: 1700 });
  emote(c1, 30.3, "dots", 1.3);
  emote(c1, 33.9, "?", 1.2);

  // --- 图片：压一下，算哈希，沿弧线飞进 R2，信封里只剩一行 key ---
  const KEY = "3f9a…c1e7.png";
  sc(c1, 40.8, 48.0, late(JX, (root) => {
    const OUT = 42.45, IX = 140, IY = 180, BX = 1218, BY = 162; // BX/BY：桶这张「卡」的盒子（画在里面留 12/8 的边）
    const wl = wireLayer(root);
    // 图标本身就是一个包：压扁、起飞、落进桶里都是它，不用换人
    const icn = L("pkt icn", root); icn.innerHTML = icon("app-window", 80, 1.6);
    const tr = ink(root);
    const trails = [0, 1, 2].map(() => svgEl("line", { stroke: "#1F1E1B", "stroke-width": 3, "stroke-linecap": "round", "stroke-opacity": 0 }, tr));
    const fmt = L("tg a-fmt", root, "PNG");
    const hashT = L("", root); hashT.style.cssText += ";font:600 32px var(--mono);white-space:nowrap";
    const site = mcard(root, { x: 700, y: 400, w: 260, cls: "dash", icon: "globe", title: "站点", sub: "不经过" }, 28);
    const bucket = L("card a-bucket", root);
    bucket.innerHTML = `<svg width="300" height="224" style="position:absolute;left:12px;top:8px;overflow:visible"><path d="M8 30 L40 202 Q150 230 260 202 L292 30" fill="#FBF1DC" stroke="#1F1E1B" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="150" cy="30" rx="142" ry="26" fill="#fff" stroke="#1F1E1B" stroke-width="2.5"/></svg><b>R2</b><span>对象存储</span>`;
    bucket.__x = BX; bucket.__y = BY;
    const arcInk = ink(bucket); // 飞行轨迹是批注，画在桶身上
    const envC = mcard(root, { x: 110, y: 590, w: 780, icon: "send", title: "Mac 信封",
      lines: [`<span class="mono" style="font-size:26px"><span style="color:var(--orange-d)">"iconObjectKey"</span>: <span class="a-kv">"${KEY}"</span></span>`] }, 30);
    const kv = envC.querySelector(".a-kv"), kvLine = envC.querySelector(".ln");
    const arrow = link(wl, hashT, "b", envC, "t", { ka: 0.55, kb: 0.36 });
    let G = null;
    return (T) => {
      if (!G) {
        inkFit(tr); inkFit(arcInk);
        fmt.__x = IX + 75 - fmt.offsetWidth / 2; fmt.__y = IY + 172;
        hashT.__x = 110; hashT.__y = IY + 234;
        setHTML(hashT, `<span style="color:var(--muted);font-size:22px">sha256 → </span>${KEY}`);
        hashT.style.width = hashT.offsetWidth + "px";
        // 飞行弧线：从图标中心到桶口；虚线只画图标和桶口之间那一段（桶内坐标）
        const P = [[IX + 75, IY + 75], [820, 100], [BX + 12 + 150, BY + 8 + 30]];
        const pt = (t) => [bz(P[0][0], P[1][0], P[2][0], t), bz(P[0][1], P[1][1], P[2][1], t)];
        const inR = (x0, y0, x1, y1) => (t) => { const [x, y] = pt(t); return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
        const cut = (inside, a, b) => { const ia = inside(a); for (let i = 0; i < 32; i++) { const m = (a + b) / 2; if (inside(m) === ia) a = m; else b = m; } return (a + b) / 2; };
        const ta = cut(inR(IX, IY, IX + 150, IY + 150), 0, 0.5), tb = cut(inR(BX + 12, BY + 8, BX + 312, BY + 60), 0.5, 1);
        const ox = BX, oy = BY, pts = []; // 桶这张卡没有边框，内容区原点就是盒子左上角
        for (let i = 0; i <= 60; i++) { const [x, y] = pt(lerp(ta, tb, i / 60)); pts.push([x - ox, y - oy]); }
        const traj = wire(arcInk, "M" + pts.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join(" L"), { dash: true, opacity: 0.55 });
        const under = penLine(inkNow(envC), kv.offsetLeft, kv.offsetTop + kv.offsetHeight + 2, kv.offsetLeft + kv.offsetWidth, kv.offsetTop + kv.offsetHeight + 2, { seed: 9, bow: 4 });
        G = { P, traj, under };
        relink(wl);
      }
      // 图标：落下 → 压扁回弹 → 沿弧线飞进桶口（越飞越快，像被扔进去）
      const kIn = seg(T, 36.1, 36.55), fk = seg(T, 39.0, 39.6);
      const u = seg(T, 36.9, 37.35), S = u <= 0 || u >= 1 ? 0 : u < 0.3 ? E.out(u / 0.3) : 1 - E.back((u - 0.3) / 0.7);
      trails.forEach((l) => l.setAttribute("stroke-opacity", "0"));
      if (fk <= 0) {
        icn.style.transformOrigin = "50% 100%";
        place(icn, IX, IY - 70 * (1 - E.in(seg(kIn, 0, 0.6))), clamp(kIn * 3), `scale(${(1 + 0.26 * S).toFixed(4)}, ${(1 - 0.42 * S).toFixed(4)})`);
      } else {
        const e = 0.3 * fk + 0.7 * fk * fk, [a, b, c] = G.P;
        const x = bz(a[0], b[0], c[0], e), y = bz(a[1], b[1], c[1], e), sc0 = lerp(1, 0.42, e), o = 1 - seg(fk, 0.8, 1);
        icn.style.transformOrigin = "50% 50%";
        place(icn, x - 75, y - 75, o, `scale(${sc0.toFixed(4)}) rotate(${(24 * e).toFixed(1)}deg)`);
        // 速度线（和 kit 的包一样三道）
        const e2 = Math.min(1, e + 0.02), dx = bz(a[0], b[0], c[0], e2) - x, dy = bz(a[1], b[1], c[1], e2) - y, m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m;
        if (fk > 0.03 && fk < 0.85) trails.forEach((l, j) => {
          const off = (j - 1) * 12, L1 = j === 1 ? 60 : 38, bx = x - ux * (75 * sc0 + 10) - uy * off, by = y - uy * (75 * sc0 + 10) + ux * off;
          l.setAttribute("x1", bx.toFixed(1)); l.setAttribute("y1", by.toFixed(1)); l.setAttribute("x2", (bx - ux * L1).toFixed(1)); l.setAttribute("y2", (by - uy * L1).toFixed(1));
          l.setAttribute("stroke-opacity", (0.4 * o).toFixed(3));
        });
      }
      popAt(fmt, T, 37.25, OUT);
      // 哈希乱码从左到右定格
      const hk = seg(T, 37.6, 38.45);
      if (T >= 37.6) setHTML(hashT, `<span style="color:var(--muted);font-size:22px">sha256 → </span>${scramble(KEY, hk, 3)}`);
      const vH = popAt(hashT, T, 37.55, OUT);
      popAt(site, T, 36.45, OUT); popAt(bucket, T, 36.3, OUT);
      // R2 桶接住时压一下
      const bk = seg(T, 39.6, 39.95);
      bucket.style.transformOrigin = "50% 100%";
      if (bk > 0 && bk < 1) bucket.style.transform += ` scale(${(1 + 0.08 * Math.sin(Math.PI * bk)).toFixed(4)}, ${(1 - 0.12 * Math.sin(Math.PI * bk)).toFixed(4)})`;
      drawWire(G.traj, seg(T, 38.55, 38.9), 1 - seg(T, 39.7, 40.1));
      // 信封：只带一行 key
      const vE = dropAt(envC, T, 39.95, OUT);
      kvLine.style.visibility = T > 40.55 ? "visible" : "hidden";
      kv.style.background = T > 40.55 && T < 41.3 ? "var(--orange-t)" : "";
      wvY(arrow, seg(T, 40.2, 40.55), T, OUT, vH, vE);
      drawWire(G.under, seg(T, 40.95, 41.3));
    };
  }));
  say(c1, JX + 36.4, JX + 40.6, "图标、封面不塞进信封，\n信封里只带一个文件名。", "left");
  sfx(c1, JX + 36.95, "thump", { x: 215 });
  sfx(c1, JX + 37.6, "hash", { x: 400 }); sfx(c1, JX + 38.05, "hash", { x: 400 });
  sfx(c1, JX + 39.62, "coin", { x: 1380 });
  burst(c1, JX + 39.6, 1380, 200, "dust", { n: 10 });
  emote(c1, JX + 39.75, "spark", 1.0);

  // =====================================================================
  // 02 状态中枢（20 小节，48 s）
  // =====================================================================
  const c2 = chapter("状态中枢", "API Worker 和 StateHub", 20);
  at(c2, 0, RIGHT[0], RIGHT[1]);
  at(c2, 1.4, LEFT[0], LEFT[1]);
  look(c2, 1.4, 1);

  // --- 关卡传送带：闸杆落下弹回 401 / 400，过关的每关一个 ✓ ---
  // 闸杆事件：[类型, 包到闸前的时刻, 抬起后保持多久]
  const BAR_EV = [[["fail", 4.5], ["pass", 7.8, 1.0], ["pass", 11.8, 0.6]], [["fail", 9.3], ["pass", 12.8, 0.6]], [["pass", 13.7, 0.6]]];
  function barAt(i, T) { // 1 = 落下挡住，0.12 = 抬起
    let e = 1;
    for (const [kind, t, hold] of BAR_EV[i]) {
      if (T < t) break;
      if (kind === "pass") {
        if (T < t + 0.2) e = lerp(1, 0.12, E.out(seg(T, t, t + 0.2)));
        else if (T < t + 0.2 + hold) e = 0.12;
        else e = lerp(0.12, 1, E.bounce(seg(T, t + 0.2 + hold, t + 0.45 + hold)));
      } else if (T < t + 0.15) e = lerp(1, 0.78, E.out(seg(T, t, t + 0.15)));     // 犹豫着抬一点
      else if (T < t + 0.3) e = lerp(0.78, 1, E.in(seg(T, t + 0.15, t + 0.3)));  // 狠狠砸回去
      else e = 1 + 0.06 * Math.sin(Math.PI * seg(T, t + 0.3, t + 0.45));
    }
    return e;
  }
  // 三个包：[文字, 颜色, 行程[[出发, 到达, 从, 到]], 被弹回的时刻]；从/到："s" 起点，数字 i 第 i 关闸前，"e" 终点
  const PK2 = [
    ["错密钥", "gray", [[3.7, 4.5, "s", 0]], 4.8],
    ["缺 activeModules", "gray", [[7.0, 7.8, "s", 0], [8.0, 9.3, 0, 1]], 9.6],
    ["mac 信封", "", [[11.0, 11.8, "s", 0], [12.0, 12.8, 0, 1], [13.0, 13.7, 1, 2], [13.9, 14.45, 2, "e"]], null],
  ];
  sc(c2, 1.9, 17.0, (root) => {
    const OUT = 16.2, Y = 520;
    const wl = wireLayer(root);
    const req = mcard(root, { x: 80, y: 190, w: 380, icon: "send", title: "上报请求", lines: [mono("POST /api/ingest/mac")] }, 28);
    const gates = [
      mcard(root, { x: 520, y: 190, w: 300, tint: "orange", icon: "key-round", title: "① 鉴权", sub: "Bearer 密钥 · 恒时比较", tags: [{ t: "✗ 401", c: "r" }] }, 28),
      mcard(root, { x: 890, y: 190, w: 350, tint: "orange", icon: "shield-check", title: "② 校验", sub: "≤ 4 MiB · JSON · 信封字段", tags: [{ t: "✗ 400", c: "r" }] }, 28),
      mcard(root, { x: 1310, y: 190, w: 290, tint: "orange", icon: "layers", title: "③ 整理", sub: "字段归一化" }, 28),
    ];
    const endT = L("tg p a-end", root, "→ StateHub");
    const houses = gates.map(() => { const h = L("a-house", root); return { h, bar: L("a-bar", h) }; });
    const oks = houses.map(({ h }) => stamp(h, "✓", "g"));
    const ok2 = stamp(houses[0].h, "✓", "g"); // 第二个包过第一关时那一枚，之后收起来
    const belt = wire(wl, "M0 0", { opacity: 0.32, width: 3 });
    const ticks = gates.map(() => wire(wl, "M0 0", { dash: true, opacity: 0.45 }));
    const st401 = stamp(root, "401"), st400 = stamp(root, "400");
    const pk = packets(root, 3);
    const size = sizer(root);
    let G = null;
    return (T) => {
      if (!G) {
        const [rx, rb] = anchor(req, "b"), XE = 1616;
        endT.__x = XE; endT.__y = Y - endT.offsetHeight / 2;
        belt.setAttribute("d", `M${rx} ${rb} L${rx} ${Y} L${XE} ${Y}`); belt.__len = null;
        const GX = gates.map((g, i) => {
          const [x, y] = anchor(g, "b");
          ticks[i].setAttribute("d", `M${x} ${y} L${x} ${Y - 54}`);
          houses[i].h.__x = x - 15; houses[i].h.__y = Y - 54;
          return x;
        });
        [...oks, ok2].forEach((s) => { const el = s(0, 0, 0, 0); el.style.fontSize = "30px"; el.style.padding = "3px 12px 5px"; el.style.borderWidth = "4px"; });
        G = { rx, GX, drop: Y - rb };
      }
      // 镜头推近第一关时，其余关卡变淡（淡到 0.45 以下，出了画面也不算贴边）
      const dk = seg(T, 3.3, 3.6) - seg(T, 7.0, 7.3), dimF = (i) => (i === 0 ? 1 : 1 - 0.56 * dk); // 先淡再推镜头，镜头拉回再亮
      const vR = popAt(req, T, 2.1, OUT, { dx: -40 });
      const vG = gates.map((g, i) => { const v = popAt(g, T, 2.35 + i * 0.2, OUT); if (dimF(i) < 1) show(g, v * dimF(i)); return v * dimF(i); });
      const vEnd = popAt(endT, T, 2.5, OUT) * (1 - 0.56 * dk);
      if (dk > 0) show(endT, vEnd);
      wvY(belt, seg(T, 2.9, 3.5), T, OUT, vR, vEnd);
      const vH = houses.map(({ h, bar }, i) => {
        const v = popAt(h, T, 3.0 + i * 0.1, OUT) * dimF(i);
        if (dimF(i) < 1) show(h, v);
        bar.style.transform = `scaleY(${barAt(i, T).toFixed(4)})`;
        return v;
      });
      ticks.forEach((w, i) => wvY(w, seg(T, 3.3 + i * 0.1, 3.6 + i * 0.1), T, OUT, vG[i], vH[i]));
      // 包
      const list = PK2.map(([text0, cls0, legs, bounce], j) => {
        if (T < legs[0][0]) return null;
        const late = j === 2 && T >= 13.85;
        const text = late ? "已整理" : text0, cls = (late ? "purple" : cls0) + " big", w = size(text, cls);
        const fOf = (s) => (s === "s" ? 0 : s === "e" ? 1 : fAt(belt, G.drop + (G.GX[s] - 9 - w / 2 - G.rx), w));
        let f = fOf(legs[0][2]), moving = false;
        for (const [t0, t1, a, b] of legs) {
          if (T < t0) break;
          if (T <= t1) { f = lerp(fOf(a), fOf(b), E.io(seg(T, t0, t1))); moving = true; break; }
          f = fOf(b);
        }
        let o = 1;
        if (bounce != null && T >= bounce) {
          const len = belt.__len ?? belt.getTotalLength();
          f = Math.max(0.13, f - (110 / len) * E.out(seg(T, bounce, bounce + 0.5)));
          o = 1 - seg(T, bounce + 0.2, bounce + 0.6);
          if (o <= 0) return null;
          moving = T < bounce + 0.5;
        }
        if (f >= 1) return null;
        return { path: belt, f, text, cls, o, trail: moving };
      });
      pk(list);
      // 印章：401 / 400 砸在闸的右上方；✓ 盖在闸杆盒旁边
      st401(G.GX[0] + 175, Y - 95, seg(T, 4.62, 4.8), 1 - seg(T, 6.3, 6.6));
      st400(G.GX[1] + 190, Y - 95, seg(T, 9.42, 9.6), 1 - seg(T, 10.9, 11.2), -4);
      ok2(56, -30, seg(T, 7.82, 8.0), 1 - seg(T, 9.0, 9.3), -8);
      [12.0, 13.0, 13.9].forEach((t, i) => oks[i](56, -30, seg(T, t - 0.18, t), 1, -8));
    };
  });
  camera(c2, 3.6, 4.2, { x: 740, y: 480, s: 1.3 });
  camera(c2, 6.4, 7.2, null);
  shake(c2, 4.8, 9);
  burst(c2, 4.8, 654, 520, "spark", { n: 8, r: 20, reach: 18, len: 0.45 });
  burst(c2, 9.6, 1048, 520, "spark", { n: 8, r: 20, reach: 18, len: 0.45 });
  act(c2, 4.84, "flinch");
  emote(c2, 4.95, "drop", 1.4);
  emote(c2, 9.75, "no", 1.0);
  emote(c2, 14.5, "ok", 1.1);
  sfx(c2, 4.82, "err", { x: 670 });
  sfx(c2, 9.62, "err", { x: 1065 });
  [[7.8, 670], [11.8, 670], [12.8, 1065], [13.7, 1455]].forEach(([t, x]) => sfx(c2, t, "up", { x }));
  sfx(c2, 14.45, "ok", { x: 1600 });
  say(c2, 2.6, 6.4, "第一关对密钥，\n对不上直接 {401}。");
  say(c2, 7.2, 11.0, "字段不全也会被退回，\n直接 {400}。");
  say(c2, 11.4, 15.8, "三关都在无状态的 Worker 里，\n到这还没碰过数据库。");

  // --- StateHub：排队、逐个提交，提交完才回 202 ---
  const Q = [["server", "ink"], ["emby", "purple"], ["iphone", "blue"], ["homepod", "blue"], ["agents", "purple"], ["playstation", "green"], ["mac", ""]];
  const CM = [20.4, 21.6, 22.8, 24.0, 25.2, 26.4, 27.6];                       // 各自开始提交
  const EN = CM.map((c, k) => (k < 3 ? 18.3 + 0.4 * k : CM[k - 3] + 0.65));  // 队里最多三个
  sc(c2, 17.0, 31.8, (root) => {
    const OUT = 31.1, SLOT0 = 560, GAP = 180, HX = 520, HY = 140;
    const wl = wireLayer(root);
    const worker = mcard(root, { x: 80, y: 300, w: 330, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "无状态" }, 28);
    const hub = L("card purple", root);
    hub.style.cssText += ";width:1110px;height:470px;padding:18px 24px";
    hub.innerHTML = `<div class="hd mono" style="font-size:34px">${icon("database", 36, 2.2)}StateHub</div><div class="sd">SQLite Durable Object · 名字固定为 "global"</div>`;
    hub.__x = HX; hub.__y = HY;
    const lane = L("a-lane", hub); lane.style.width = "620px"; lane.style.height = "100px";
    const laneLbl = L("lbl", hub, "提交队列 · 先进先出"); laneLbl.style.fontSize = "20px";
    const commit = L("a-commit", hub, `${icon("check", 24, 2.6)}<span>提交</span>`);
    const tables = [["entries", "快照"], ["fields", "字段"], ["samples", "历史"]].map(([n, d]) => {
      const tb = L("card a-tb", hub);
      tb.innerHTML = `<div class="hd mono" style="font-size:23px">${icon("layers", 22, 2)}${n}</div><div class="sd" style="font-size:20px;margin:0">${d}</div>`;
      return tb;
    });
    const hsvg = ink(hub);
    const lo = {};
    const wIn = link(wl, worker, "r", hub, "l", lo);
    const pk = packets(hub, Q.length);
    const hubTrail = tame(hub);
    const size = sizer(root);
    const st202 = stamp(root, "202<small>ACCEPTED</small>", "g");
    let G = null;
    return (T) => {
      if (!G) {
        inkFit(hsvg); inkFit(hubTrail);
        const wy = 300 + worker.offsetHeight / 2, ly = wy - HY - 2.5, x0 = 410 - HX - 2.5;
        lo.kb = (wy - HY) / hub.offsetHeight;
        relink(wl);
        place(lane, 24, ly - 50, 1); place(laneLbl, 24, ly + 62, 1); place(commit, 664, ly - 35, 1);
        const ty = [110, 202, 294];
        tables.forEach((tb, i) => place(tb, 830, ty[i], 1));
        const lanePath = wire(hsvg, `M${x0} ${ly} L664 ${ly}`, { opacity: 0 });
        // 提交框 → 三张表
        const fan = tables.map((tb, i) => {
          const y = ty[i] + tb.offsetHeight / 2;
          return wire(hsvg, `M768 ${ly} C799 ${ly} 799 ${y} 830 ${y}`, { opacity: 0.35, width: 2.5 });
        });
        G = { lanePath, fan, x0 };
      }
      const vW = popAt(worker, T, 17.3, OUT, { dx: -40 });
      const kh = seg(T, 17.6, 18.0);
      hub.style.transformOrigin = "50% 50%";
      const vHub = Math.min(kh, 1 - seg(T, OUT, OUT + 0.3));
      place(hub, HX, HY, vHub, `scale(${lerp(0.94, 1, E.back(kh)).toFixed(4)})`);
      wv(wIn, seg(T, 18.0, 18.4), vW, vHub);
      G.fan.forEach((p) => drawWire(p, seg(T, 18.1, 18.45)));
      // 队列：前面的每提交完一个，后面的整体往前挪一格
      const list = Q.map(([text, c0], k) => {
        if (T < EN[k] || T > CM[k] + 0.35) return null;
        const cls = c0 + " big", w = size(text, cls);
        let s = 0;
        for (let j = 0; j < k; j++) s += T < CM[j] + 0.2 ? 1 : 1 - E.io(seg(T, CM[j] + 0.2, CM[j] + 0.65));
        const fx = (x) => fAt(G.lanePath, x - G.x0, w);
        let f = fx(SLOT0 - GAP * s), moving = false;
        const ein = seg(T, EN[k], EN[k] + 0.8);
        if (ein < 1) { f = lerp(0, f, E.out(ein)); moving = true; }
        if (T >= CM[k]) { f = lerp(fx(SLOT0), 1, E.io(seg(T, CM[k], CM[k] + 0.35))); moving = true; }
        return { path: G.lanePath, f, text, cls, s: k === 6 ? 1.15 : 1, trail: moving && ein > 0.1 };
      });
      pk(list);
      // 提交：提交框亮一下，三张表依次写一行
      const cm = CM.find((c) => T > c + 0.25 && T < c + 0.9);
      hot(commit, cm != null && T < cm + 0.55, "116,88,210");
      tables.forEach((tb, i) => {
        const on = cm != null && T > cm + 0.3 + i * 0.08 && T < cm + 0.65 + i * 0.08;
        tb.style.outline = on ? "3px solid var(--purple)" : "";
        tb.style.transform = tb.style.transform.replace(/ scale\([^)]*\)/, "") + (on ? " scale(1.04)" : "");
      });
      // 202：Mac 那封提交完，在 Worker 身上砸下（本章最重的一拍，落在第 12 小节头）
      st202(245, 520, seg(T, 28.62, 28.8), 1 - seg(T, OUT, OUT + 0.3));
    };
  });
  CM.forEach((c) => sfx(c2, c + 0.3, "click", { x: 1250 }));
  sfx(c2, 27.8, "riser", { dur: 1.0 });
  sfx(c2, 28.84, "coin", { x: 245 });
  duck(c2, 28.8);
  shake(c2, 28.8, 12);
  burst(c2, 28.8, 245, 520, "spark", { n: 14, r: 175 });
  act(c2, 28.85, "jump");
  emote(c2, 29.35, "heart", 1.2);
  say(c2, 17.2, 21.4, "全站只有这一个，\n七个来源的写入都在这排队。");
  say(c2, 21.8, 26.4, "先到先写，一次一个，\n谁也插不了队。");
  say(c2, 28.9, 31.6, "写完才回 {202}，\n收到就是存下了。");

  // --- 待办清单：StateHub 递给 Worker，Worker 广播、按需通知 Vercel ---
  const TODO = [mono("① 广播 listening-now"), mono("② 失效标签 listening-now")];
  sc(c2, 31.8, 48.0, (root) => {
    const OUT = 46.9;
    const wl = wireLayer(root);
    const hubS = mcard(root, { x: 80, y: 150, w: 330, tint: "purple", icon: "database", title: "StateHub", mono: true, sub: "只管存" }, 28);
    const todo = mcard(root, { x: 80, y: 330, w: 410, icon: "check", title: "待办清单", sub: "这封：从停止到开始播放", lines: TODO }, 26);
    const worker = mcard(root, { x: 540, y: 150, w: 420, tint: "orange", icon: "cloud", title: "API Worker", mono: true, sub: "回完 202 再做", lines: TODO, cls: "a-w" }, 28);
    const wlns = [...worker.querySelectorAll(".ln")];
    const whl = wlns.map((l) => L("a-hl", l));
    const room = mcard(root, { x: 1170, y: 150, w: 340, tint: "orange", icon: "radio", title: "LivePushRoom", mono: true, sub: "WebSocket 广播" }, 27);
    const brws = Array.from({ length: 6 }, (_, i) => {
      const b = L("card a-brw", root);
      b.innerHTML = `<div class="bt"></div><div class="bb"><i></i><i style="width:60%"></i></div>`;
      b.__x = 1536 + (i % 3) * 116; b.__y = 140 + Math.floor(i / 3) * 96;
      return b;
    });
    const br = mcard(root, { x: 900, y: 450, w: 440, tint: "amber", icon: "git-branch", title: "布局变了？",
      lines: [mono("是 → 通知 Vercel", 20), mono("否 → 不通知", 20)], cls: "a-w" }, 28);
    const bl = [...br.querySelectorAll(".ln")];
    const bhl = bl.map((l) => L("a-hl", l));
    bhl[0].style.background = "rgba(46,158,79,.18)"; bhl[0].style.outlineColor = "rgba(46,158,79,.7)";
    const vercel = mcard(root, { x: 1540, y: 450, w: 300, tint: "green", icon: "globe", title: "Vercel", lines: [mono("POST /api/revalidate", 18)] }, 28);
    const beat = mcard(root, { x: 1180, y: 660, w: 440, icon: "heart", title: "空心跳", sub: "只记一笔在线", lines: ['<span class="mono" data-k="p" style="font-size:19px"></span>'] }, 28);
    const beatIc = beat.querySelector(".ic"), pres = beat.querySelector('[data-k="p"]');
    const tg3 = L("tg g", root, "刷新 3 个标签");
    const o3 = {};
    const w1 = link(wl, worker, "r", room, "l");
    const w2 = link(wl, worker, "b", br, "l");
    const w3 = link(wl, br, "r", vercel, "l", o3);
    const pk = packets(root, 2);
    let G = null;
    return (T) => {
      if (!G) {
        room.__y = Math.round(150 + worker.offsetHeight / 2 - room.offsetHeight / 2); // 和 Worker 对齐，广播线是一条直线
        o3.ka = (bl[0].offsetTop + bl[0].offsetHeight / 2 + 2.5) / br.offsetHeight;
        relink(wl);
        G = { dist: brws.map((b) => Math.hypot(b.__x + 50 - 1510, b.__y + 38 - (room.__y + room.offsetHeight / 2))) };
      }
      popAt(hubS, T, 32.0, OUT, { dx: -30 });
      // 递清单：从 StateHub 底下滑到 Worker 左边，缩进去；Worker 身上随即多出两行
      const kd = dropAt(todo, T, 32.35, OUT, { h: 40 });
      const hk = seg(T, 33.6, 34.3);
      if (hk > 0) {
        const s = lerp(1, 0.25, E.io(hk)), W = todo.offsetWidth, H = todo.offsetHeight;
        const rx = lerp(490, 534, E.out(hk)), cy = lerp(330 + H / 2, 292, E.in(hk));
        todo.style.transformOrigin = "100% 50%";
        place(todo, rx - W, cy - H / 2, kd * (1 - seg(hk, 0.75, 1)), `scale(${s.toFixed(4)})`);
      }
      const vW = popAt(worker, T, 33.0, OUT);
      wlns.forEach((l, i) => { l.style.visibility = T > 34.2 + i * 0.1 ? "visible" : "hidden"; });
      show(whl[0], inout(T, 35.3, 36.5, 0.1, 0.25));
      show(whl[1], inout(T, 37.85, 39.2, 0.1, 0.25));
      // 广播：LivePushRoom 冒波纹，浏览器由近到远亮起
      const vRm = popAt(room, T, 34.45, OUT);
      wv(w1, seg(T, 34.85, 35.25), vW, vRm);
      brws.forEach((b, i) => {
        popAt(b, T, 34.65 + i * 0.05, OUT);
        const t = 36.05 + G.dist[i] * 0.0011, on = T > t;
        b.style.borderColor = on ? "var(--green)" : "";
        b.style.boxShadow = on && T < t + 0.5 ? "0 0 0 5px rgba(46,158,79,.3)" : "";
        b.querySelector(".bt").style.background = on ? "var(--green-t)" : "";
        b.querySelectorAll("i").forEach((x) => (x.style.background = on ? "rgba(46,158,79,.45)" : ""));
      });
      // 按需通知 Vercel：像代码分支一样，高亮条选中「是」
      const vBr = popAt(br, T, 36.7, OUT), vV = popAt(vercel, T, 37.0, OUT);
      wvY(w2, seg(T, 36.95, 37.35), T, OUT, vW, vBr);
      wv(w3, seg(T, 37.45, 37.85), vBr, vV);
      show(bhl[0], seg(T, 38.4, 38.5));
      show(bhl[1], 0);
      bl[1].style.opacity = T > 38.4 ? "0.4" : "";
      hot(vercel, (T > 38.95 && T < 39.35) || (T > 43.0 && T < 43.5), "46,158,79");
      const list = [];
      if (T >= 35.5 && T <= 35.95) list[0] = { path: w1, ...quick(T, 35.5, 35.95), text: "listening-now", cls: "green big", trail: true };
      if (T >= 38.0 && T <= 38.4) list[1] = { path: w2, ...quick(T, 38.0, 38.4, 0.12), text: "listening-now", cls: "big", trail: true };
      else if (T >= 38.55 && T <= 38.95) list[1] = { path: w3, ...quick(T, 38.55, 38.95, 0.12), text: "listening-now", cls: "big", trail: true };
      pk(list);
      // 空心跳：心口跳两下，别的什么都没发生
      popAt(beat, T, 40.2, OUT);
      const hb = Math.max(T < 41.1 ? seg(T, 40.8, 41.1) : 0, T < 41.9 ? seg(T, 41.6, 41.9) : 0, T < 42.9 ? seg(T, 42.6, 42.9) : 0);
      beatIc.style.transform = `scale(${(1 + 0.22 * Math.sin(Math.PI * hb)).toFixed(4)})`;
      beatIc.style.color = hb > 0 ? "var(--red)" : "";
      // 在线 / 离线翻转：这时才推 presence、刷新三个标签
      // 平时的心跳：本来就在线，什么都不推；掉线一阵后来的第一封心跳才翻转、推 presence
      setHTML(pres, T < 42.0 ? '<span style="color:var(--green)">● 在线</span>' : T < 42.6 ? '<span style="color:var(--faint)">● 离线</span>' : '<span style="color:var(--green)">● 在线</span> · 推 presence');
      hot(beat, T > 42.6 && T < 43.1, "46,158,79");
      popAt(tg3, T, 43.0, OUT, { x: 1560, y: 450 + vercel.offsetHeight + 22 });
    };
  });
  sfx(c2, 33.6, "swoosh", { x: 400 });
  sfx(c2, 34.2, "flip", { x: 750 });
  sfx(c2, 35.3, "click", { x: 750 });
  burst(c2, 36.0, 1340, 242, "rings", { r: 230 });
  sfx(c2, 36.1, "sparkle", { x: 1700 });
  emote(c2, 36.2, "note", 1.6);
  sfx(c2, 37.85, "click", { x: 750 });
  sfx(c2, 38.4, "click", { x: 1120 });
  sfx(c2, 38.95, "ok", { x: 1690 });
  sfx(c2, 40.8, "heartbeat", { x: 1230 }); sfx(c2, 41.6, "heartbeat", { x: 1230 });
  burst(c2, 40.8, 1229.5, 705.5, "rings", { r: 90, n: 2, color: "#C8453A" });
  say(c2, 32.2, 36.4, "提交时 StateHub 不发请求，\n副作用只当数据交出去。");
  say(c2, 36.8, 41.2, "有变化才广播，\n布局变了才通知 Vercel。");
  say(c2, 41.6, 46.2, "只有在线、离线翻转时，\n才推 {presence}、刷新三个标签。");
  sfx(c2, 42.6, "heartbeat", { x: 1230 });
  burst(c2, 42.7, 1340, 242, "rings", { r: 120, n: 2 });
})();
