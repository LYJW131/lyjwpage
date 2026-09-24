// 00 序章
(() => {
  const { E, clamp, seg, lerp, mk, L, icon, esc, place, show, setHTML, setText, svgEl, chapter, scene, say, at, act, look, sfx, hideCrab, emote, burst } = Engine;
  const { card, popAt, wireLayer, link, relink, drawWire, packets, terminal, siteMock, penCircle, css } = Kit;
  const mono = (s, sz = 19) => `<span class="mono" style="font-size:${sz}px">${s}</span>`;

  // 官方动作序列在场景内取帧
  function seqFrame(name, t0, lt) {
    const s = Clawd.SEQ[name], i = Math.floor((lt - t0) / (Clawd.FRAME_MS / 1000));
    return i >= 0 && i < s.length ? s[i] : null;
  }

  const c0 = chapter("序章", "", 12);
  window.HUD_FROM = 12.8;

  // --- 终端开场：在 Claude Code 里问一句，Clawd 从欢迎框里跳出来 ---
  scene(c0, 0, 4.3, (root) => {
    const T = terminal(root, { w: 1040, h: 470, title: "zsh — ~/Developer/lyjwpage" });
    const b = T.body;
    const l1 = mk("div", "", b);
    const wel = mk("div", "welcome", b);
    const box = mk("div", "", wel);
    box.style.cssText = "position:relative;width:144px;height:96px;overflow:hidden;flex:none";
    const mini = Clawd.create(8, 16);
    box.appendChild(mini.el);
    const info = mk("div", "t", wel, `<b>Claude Code</b><br><span class="dim">Opus 5.5</span><br><span class="dim">~/Developer/lyjwpage</span>`);
    const l2 = mk("div", "", b);
    const cmd = "claude", ask = window.__tr("讲讲 lyjw.me 是怎么运转的");
    return (lt) => {
      // Clawd 一跳出来，终端就散掉，免得他从输入行上压过去
      const a = E.out(seg(lt, 0.1, 0.4)), z = E.out(seg(lt, 3.65, 4.15));
      T.el.style.transformOrigin = "50% 50%";
      place(T.el, 440, 250 + 20 * (1 - a), a * (1 - z), `scale(${(lerp(0.96, 1, a) * lerp(1, 0.94, z)).toFixed(4)})`);
      const n1 = Math.round(seg(lt, 0.35, 0.7) * cmd.length);
      setHTML(l1, `<span class="prompt">❯</span> ${cmd.slice(0, n1)}${lt < 0.85 ? '<span class="prompt">▋</span>' : ""}`);
      show(wel, seg(lt, 0.85, 0.95));
      const f = seqFrame("skip", 0.95, lt) || seqFrame("jump", 2.75, lt) || { pose: "default", offset: 0, x: 0 };
      mini.update({ pose: f.pose, offset: f.offset, poof: f.poof || null });
      mini.el.style.transform = `translateX(${(f.x || 0) * 16}px)`;
      mini.el.style.visibility = lt >= 0.95 && lt < 3.6 ? "visible" : "hidden"; // 蹦进欢迎框之前不露面
      show(info, seg(lt, 1.0, 1.3));
      const n2 = Math.round(seg(lt, 1.85, 2.55) * ask.length);
      setHTML(l2, lt < 1.8 ? "" : `<span class="prompt">❯</span> ${esc(ask.slice(0, n2))}${lt < 2.9 ? '<span class="prompt">▋</span>' : ""}`);
    };
  });
  hideCrab(c0, 0, 3.6);
  // 交接点和终端里那只小 Clawd 的位置、大小完全重合（半尺寸），再一跃落到台前——落地正好是鼓进来的那一拍
  at(c0, 3.6, 570, 478, null, { sc: 0.5 });
  at(c0, 4.8, 640, 900, "leap", { sc: 1, h: 170 });
  act(c0, 4.8, "land");
  burst(c0, 4.8, 640, 900, "dust", { n: 12 });
  emote(c0, 4.92, "!", 0.9);
  say(c0, 5.2, 9.0, "嗨！我是 Claude（Opus 5.5），\n带你拆开 {lyjw.me} 看看。");
  emote(c0, 6.9, "spark", 0.9);

  // --- 标题 ---
  scene(c0, 9.0, 13.0, (root) => {
    const logo = L("", root);
    logo.style.cssText += ";font-family:'Geist Pixel';font-size:176px;line-height:1;white-space:nowrap;transform-origin:0 0";
    const t1 = L("", root, "这个主页，是怎么运转的？");
    t1.style.cssText += ";width:1920px;text-align:center;font-size:72px;font-weight:600;letter-spacing:2px";
    let W = 0;
    return (lt) => {
      if (!W) { logo.textContent = "lyjw.me"; W = logo.offsetWidth; }
      const n = Math.round(seg(lt, 0.2, 0.8) * 7);
      setHTML(logo, "lyjw.me".slice(0, n) + (lt < 2.9 ? `<span style="display:inline-block;width:.42em;height:.8em;background:var(--orange);margin-left:.08em;vertical-align:-.04em;opacity:${lt < 1.0 || Math.floor(lt / 0.4) % 2 ? 1 : 0}"></span>` : ""));
      const k = E.io(seg(lt, 3.1, 3.8));
      // 缩到顶栏位置后，顶栏 logo 在 12.8 接手；这边到 3.8 才藏，中间不留空档
      place(logo, lerp((1920 - W) / 2, 64, k), lerp(200, 38, k), lt >= 3.8 ? 0 : 1, `scale(${lerp(1, 40 / 176, k).toFixed(4)})`);
      const a1 = E.out(seg(lt, 0.9, 1.4)), z = E.in(seg(lt, 2.9, 3.3));
      place(t1, 0, 440 + 24 * (1 - a1) - 40 * z, a1 * (1 - z));
    };
  });
  act(c0, 9.25, "jump");
  burst(c0, 9.8, 1380, 230, "stars", { r: 70, n: 6 });

  // --- 主页（站点真实首屏）→ 三段总览 ---
  const S0 = 12.4;
  const WX = 900, WY = 140, SC = 0.86;
  css(`.devtag{background:var(--orange-t);border:2px solid var(--orange);color:var(--orange-d);font-size:17px;font-weight:600;padding:2px 10px 2px 8px;display:flex;align-items:center;gap:6px;white-space:nowrap}
    .plug{width:30px;height:18px;background:var(--ink);border-radius:3px}
    .plug::after{content:"";position:absolute;right:-9px;top:4px;width:9px;height:10px;background:#B8B1A3;border:2px solid var(--ink);border-left:0;border-radius:0 3px 3px 0;box-sizing:border-box}`);
  scene(c0, S0, 28.8, (root) => {
    const H = siteMock(root, { scale: SC, viewH: 900 });
    const VT = WY + H.viewTop, VB = VT + H.viewH;
    const TAGS = [["clock", "laptop", "来自 Mac"], ["watching", "hard-drive", "来自 NAS"], ["charger", "battery-charging", "来自 Mac · 蓝牙"],
      ["listening", "music", "来自 Mac · Apple Music", 15], ["activity", "smartphone", "来自 iPhone"], ["server", "server", "来自东京服务器"]];
    // 「最近播放」的标签字多，缩一号、挪到两段标题文字的正中，不压 RECENTLY PLAYED
    const tags = TAGS.map(([k, ic, t, dx]) => { const e = L("devtag", root, `${icon(ic, dx ? 16 : 18, 2.2)}${t}`); e.__k = k; e.__dx = dx || 0; if (dx) e.style.fontSize = "15px"; return e; });
    // 充电头：拔掉、插回，页面上的充电卡跟着消失、出现
    const dev = card(root, { x: 640, y: 728, w: 212, icon: "battery-charging", title: "充电头", lines: [mono("122.9 W")] });
    dev.querySelector(".hd").style.fontSize = "26px";
    const devW = dev.querySelector(".ln span");
    const cab = svgEl("svg", { width: 1920, height: 1080, class: "L" }, root);
    const cable = svgEl("path", { fill: "none", stroke: "#1F1E1B", "stroke-width": 5, "stroke-linecap": "round" }, cab);
    const plug = L("plug", root);
    const wl = wireLayer(root);
    const zones = [
      card(root, { x: 110, y: 230, w: 460, tint: "gray", icon: "radio", title: "采集端", sub: "设备和上报器", lines: ["Mac · iPhone · NAS · 服务器"] }),
      card(root, { x: 730, y: 230, w: 460, tint: "orange", icon: "cloud", title: "状态中枢", sub: "Cloudflare", lines: ["收上报 · 存状态 · 推变化"] }),
      card(root, { x: 1350, y: 230, w: 460, tint: "green", icon: "globe", title: "展示端", sub: "Vercel · 浏览器", lines: ["首屏 · 实时更新"] }),
    ];
    zones.forEach((z) => { z.querySelector(".hd").style.fontSize = "34px"; z.querySelectorAll(".ln").forEach((l) => (l.style.fontSize = "24px")); z.style.padding = "22px 26px"; });
    const w1 = link(wl, zones[0], "r", zones[1], "l"), w2 = link(wl, zones[1], "r", zones[2], "l");
    // 旁白念到「采集、中枢、展示」时依次圈出来（笔迹层要在卡片之后建，才画在卡片上面）
    const pen = wireLayer(root);
    const marks = [[253, 70], [890, 88], [1493, 70]].map(([cx, rx], i) => penCircle(pen, cx, 279, rx, 34, { seed: i + 3 }));
    const pk = packets(root, 6);
    // 插头：插上时顶到充电卡左边框，拔掉时退到窗外垂下
    const IN = [WX + 40 * SC - 34, 784], OUT = [WX - 40, 822];
    return (lt) => {
      relink(wl);
      const a = E.out(seg(lt, 0.2, 0.8));
      const q = E.io(seg(lt, 11.2, 11.9));
      const s = lerp(1, 0.32, q);
      const cx = lerp(WX + H.W / 2, 1580, q), cy = lerp(WY + H.H / 2, 318, q);
      place(H.el, cx - (H.W / 2) * s + 150 * (1 - a), cy - (H.H / 2) * s, a * (1 - seg(lt, 11.6, 11.9)), `scale(${s.toFixed(4)})`);
      const cardsIn = {};
      ["contact", "clock", "watching", "charger", "listening", "activity", "server"].forEach((k, i) => (cardsIn[k] = seg(lt, 0.6 + i * 0.12, 1.0 + i * 0.12)));
      // 往下滚到 EXIT NODE 整张露出来，再滚回顶部
      const scroll = 570 * E.sine(seg(lt, 4.0, 4.8)) * (1 - E.sine(seg(lt, 7.1, 7.9)));
      const unplug = E.out(seg(lt, 8.8, 8.94)), replug = E.in(seg(lt, 10.6, 10.7));
      const chargerOn = 1 - E.io(seg(lt, 8.85, 9.25)) + E.io(seg(lt, 10.7, 11.1));
      H.update({ t: lt, scroll, cardsIn, chargerOn, rings: E.out(seg(lt, 3.8, 5.0)) });
      // 设备标签贴在各卡标题栏正中（标题栏两端本来就有来源标注，中间是空的）；滚出窗口时平滑淡出
      tags.forEach((e, i) => {
        const r = H.rect(e.__k, WX, WY, scroll);
        // 上面四个先收起来再滚动，不跟着页面一起飞走；滚到底再亮下面两个。每组完整停留 1.5 秒以上
        const tIn = i < 4 ? 1.2 + i * 0.2 : 4.9 + (i - 4) * 0.2, tOut = i < 4 ? 3.7 : 7.0;
        const k1 = seg(lt, tIn, tIn + 0.3) * (1 - seg(lt, tOut, tOut + 0.3));
        const y = e.__k === "clock" ? r.y : r.y + 18 * SC;
        const vis = clamp((y - VT - 10) / 26) * clamp((VB - 10 - y) / 26);
        e.style.transformOrigin = "50% 50%";
        place(e, r.x + r.w / 2 + e.__dx, y, k1 * vis * a * (1 - q), `translate(-50%, -50%) scale(${lerp(0.5, 1, E.back(Math.min(1, k1 * 1.4))).toFixed(3)})`);
      });
      // 充电头与线
      const od = popAt(dev, lt, 7.6, 11.1, { dx: -30 });
      const off = unplug * (1 - replug);
      const [px, py] = [lerp(IN[0], OUT[0], off), lerp(IN[1], OUT[1], off)];
      const x0 = 852, y0 = 784, sag = 26 + 18 * off;
      cable.setAttribute("d", `M${x0} ${y0} C${x0 + 30} ${y0 + sag} ${px - 30} ${py + sag * 0.6} ${px} ${py}`);
      cable.style.opacity = (od * seg(lt, 7.8, 8.0)).toFixed(3);
      place(plug, px, py - 9, od * seg(lt, 7.8, 8.0), off > 0.5 ? "rotate(18deg)" : "");
      setText(devW, off > 0.5 ? "0 W · 未连接" : "122.9 W");
      devW.style.color = off > 0.5 ? "var(--faint)" : "";
      // 三段
      const oz = zones.map((z, i) => popAt(z, lt, 11.5 + i * 0.25));
      drawWire(w1, seg(lt, 12.3, 12.7), Math.min(oz[0], oz[1])); drawWire(w2, seg(lt, 12.5, 12.9), Math.min(oz[1], oz[2]));
      marks.forEach((m, i) => drawWire(m, seg(lt, 12.5 + i * 0.2, 12.85 + i * 0.2), 1 - seg(lt, 14.3, 14.7)));
      const list = [];
      // 三个包都要在本章结束前到站（到站波纹不能串进下一章）
      for (let k = 0; k < 3; k++) {
        const s0 = 12.7 + k * 0.5;
        if (lt >= s0 && lt < s0 + 1.25) {
          const f = (lt - s0) / 1.25, first = f < 0.5, g = first ? f * 2 : f * 2 - 1;
          list.push({ path: first ? w1 : w2, f: E.io(g), text: first ? "POST" : "推送", cls: first ? "" : "green", trail: true });
        }
      }
      pk(list);
    };
  });
  at(c0, S0, 640, 900);
  at(c0, S0 + 0.9, 330, 975);
  look(c0, S0 + 0.9, 1);
  say(c0, S0 + 1.0, S0 + 7.2, "卡片上的数据，\n来自主人身边的真实设备。", "above");
  say(c0, S0 + 7.6, S0 + 11.3, "充电卡片只在充电时出现。", "above");
  at(c0, S0 + 11.3, 330, 975);
  at(c0, S0 + 11.9, 250, 975);
  look(c0, S0 + 11.9, 1);
  say(c0, S0 + 12.0, S0 + 15.5, "链路分三段：采集、中枢、展示。", "right");
  // 三段之间的数据包到站时，展示端冒一圈波纹
  for (let k = 0; k < 3; k++) burst(c0, S0 + 12.7 + k * 0.5 + 1.25, 1350, 318, "rings", { r: 90, n: 1 });
  burst(c0, S0 + 10.7, WX + 40 * SC - 4, 784, "spark", { r: 14, n: 8, reach: 18, len: 0.45 });

  // ---------- 音效（只放语义化的；弹出、连线、数据包、表情、粒子由引擎按画面自动生成） ----------
  sfx(c0, 0.1, "swoosh");
  for (let i = 1; i <= 6; i++) sfx(c0, 0.35 + ((i - 0.5) / 6) * 0.35, "key");
  sfx(c0, 0.8, "key"); sfx(c0, 0.86, "chime");
  [1.01, 1.25, 1.49].forEach((t, i) => sfx(c0, t, "hop", { n: i })); sfx(c0, 1.61, "poof");
  [..."讲讲 lyjw.me 是怎么运转的"].forEach((ch, i) => { if (ch !== " ") sfx(c0, 1.85 + ((i + 0.5) / 17) * 0.7, "key"); });
  sfx(c0, 2.7, "key"); sfx(c0, 2.87, "hop", { n: 0 }); sfx(c0, 3.23, "hop", { n: 1 });
  sfx(c0, 3.65, "whoosh");
  for (let i = 1; i <= 7; i++) sfx(c0, 9.0 + 0.2 + ((i - 0.5) / 7) * 0.6, "key");
  sfx(c0, 12.1, "swoosh");
  sfx(c0, S0 + 4.0, "swoosh"); sfx(c0, S0 + 7.1, "swoosh");
  sfx(c0, S0 + 8.8, "click"); sfx(c0, S0 + 8.85, "down");
  sfx(c0, S0 + 10.68, "click"); sfx(c0, S0 + 10.7, "up");
  sfx(c0, S0 + 11.2, "whoosh");

})();
