(() => {
  function make() {
    const { E, prog, keys, clamp, lerp, stamp, measure, hop } = K;
    const { PAL } = P;
    I18N.add({
      "ch08.title": ["一句话之后", "After one line"],
      "ch08.hi": ["说好的，看看我们怎么动手。", "As promised:\nhere's how we build it."],
      "ch08.chat": ["项目聊天", "Project chat"],
      "ch08.slip": ["PageSpeed 两行老显示「—」", "PageSpeed rows show “—”"],
      "ch08.memory": ["项目记忆", "Project memory"],
      "ch08.mem1": ["第三人称写 lyjw", "Third person: “lyjw”"],
      "ch08.mem2": ["等待都有上限", "Every wait has a limit"],
      "ch08.mem3": ["改界面等 lyjw 点头", "UI waits for lyjw's nod"],
      "ch08.t.docs": ["文档", "Docs"],
      "ch08.t.ui": ["界面", "UI"],
      "ch08.n1a": ["lyjw 在项目聊天说一句，", "lyjw asks in the project chat;"],
      "ch08.n1b": ["协调的 Claude 开一个线程去做。", "a coordinator opens a thread."],
      "ch08.gates": ["本地门禁", "Local gates"],
      "ch08.gatesNote": ["按改动挑着跑", "Only what the change touches"],
      "ch08.n2a": ["一件事一个线程，从头跟到尾：", "One thread per task, start to end:"],
      "ch08.n2b": ["开分支、改代码、先过本地门禁。", "branch, change, pass local gates."],
      "ch08.fixed": ["改了", "Fixed"],
      "ch08.replied": ["回理由", "Replied"],
      "ch08.codex3": ["Codex 最多三轮", "Codex: three rounds at most"],
      "ch08.n3a": ["机器评审不一定对：", "Bot reviews can be wrong;"],
      "ch08.n3b": ["每一条，要么改，要么回理由。", "each gets a fix or a reason."],
      "ch08.receipt": ["验证回执", "Receipt"],
      "ch08.paste": ["SHA 只粘贴，不手抄", "SHAs are pasted, never retyped"],
      "ch08.evidence": ["证据：collector test 全部通过", "Evidence: collector tests pass"],
      "ch08.verifier": ["验证员：Haiku，没写这段代码", "Verifier: Haiku, not the author"],
      "ch08.passing": ["算通过", "Passing"],
      "ch08.notPassing": ["不算通过", "Not passing"],
      "ch08.n4a": ["检查交给便宜的 Haiku 跑，", "The cheap Haiku runs the checks"],
      "ch08.n4b": ["它签一张按提交记的回执。", "and signs a receipt per commit."],
      "ch08.g1": ["CI 绿就合", "Green CI: merge"],
      "ch08.g2": ["处理完评审 + 判定员", "Reviews done + judge"],
      "ch08.g3": ["lyjw 看图点头", "lyjw's nod"],
      "ch08.judge": ["判定员", "Judge"],
      "ch08.judgeSub": ["没写这段代码", "didn't write it"],
      "ch08.nod": ["lyjw 点头", "lyjw: OK"],
      "ch08.n5a": ["合并按改动大小分三档；", "Merges come in three tiers;"],
      "ch08.n5b": ["改了界面的，要等 lyjw 看图点头。", "UI changes wait for lyjw's nod."],
      "ch08.merge": ["合并提交", "Merge commit"],
      "ch08.n6a": ["合并提交汇总协作者，", "Merge commits list co-authors;"],
      "ch08.n6b": ["首页的提交卡靠它认出 agent。", "the homepage reads them back."],
      "ch08.night": ["夜班", "Night shift"],
      "ch08.r.watch": ["盯防采集", "Watch the collector"],
      "ch08.r.mirror": ["记忆镜像", "Mirror memory"],
      "ch08.r.review": ["代码审查", "Code review"],
      "ch08.r.skills": ["提炼 skill", "Distill skills"],
      "ch08.r.news": ["读 Anthropic 动态", "Read Anthropic news"],
      "ch08.r.brief": ["晨报", "Morning brief"],
      "ch08.n7a": ["夜里也有 Claude 值班：", "Claudes work the night shift:"],
      "ch08.n7b": ["审代码、提炼做法、写晨报。", "review code, distill skills, report."],
      "ch08.sign": ["等 lyjw 验收", "Waiting on lyjw"],
      "ch08.egg.mat": ["过了门禁再进门", "Pass the gates first"],
      "ch08.egg.agents": ["≤ 150 行", "≤ 150 lines"],
      "ch08.egg.home": ["家 = localhost:3211", "home = localhost:3211"],
      "ch08.egg.staff": ["本月最佳验证员", "Verifier\nof the month"],
      "ch08.egg.deploy": ["禁止手跑", "Never hand-run"],
      "ch08.egg.baseline": ["基线只减不增", "Baselines\nonly shrink"],
      "ch08.egg.box": ["Vercel 时代", "Vercel era"],
      "ch08.egg.card1": ["明早 09:00", "See you at"],
      "ch08.egg.card2": ["晨报见", "the 09:00 brief"],
      "ch08.egg.paper": ["晨报", "Brief"],
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let bgL, ink, glowL, paperL, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
    const T = (x, str, px, py, o = {}) => P.text(x, str, px, py, o);
    const M = (x, str, px, py, o = {}) => P.text(x, str, px, py, { ...o, mono: true });
    // 英文比中文长的几处彩蛋在英文里拆成两行；中文只有一行时居中在两行的中间。
    const TL = (x, str, px, py, lh, o = {}) => { const ls = str.split("\n"); ls.forEach((l, i) => T(x, l, px, py + (i - (ls.length - 1) / 2) * lh, o)); };

    // 拍位和 music/ch08.js 是同一张表。
    const AT = {
      pop: 0.125, popStep: 0.0625, hopIn: [0.25, 0.5], hi: 0.5, leap: 1.0,
      fall: [1.3, 1.5], slip: [1.5, 1.75], look: 1.8, plug: [2.0, 2.25], cable: [2.25, 2.75],
      fork: [3.0, 3.25], pop308: 3.25, c1: 3.5, card: 3.75, gates: [4.0, 4.25, 4.5, 4.75],
      pr: 5.0, ci: 5.125, slip0: 5.25, slipStep: 0.25, c2: 6.75, c3: 7.0,
      haiku: [7.5, 7.75], tests: [8.0, 8.25, 8.5, 8.75], receipt: 9.0, level: 9.25, rung: 9.5, check: [9.75, 10.0], exact: 10.25, bye: 10.5,
      g1: 11.25, fail: 11.75, c4: 12.0, pass: 12.5, g2: 12.75, nod: 13.25, g3: 13.5,
      m1: 14.0, m2: 14.25, m3: 14.5, mcard: 14.75, coauth: 15.25, home: 15.5, avatar: 15.75,
      night: [16.125, 16.375, 16.625, 16.75, 16.875, 17.375, 17.5],
      sign: 18.5, exit: [19.25, 19.6],
    };

    // 首帧与 ch07.js 末帧、末帧与 ch09.js 首帧几何相同：屏幕 y 540 是 main，HEAD 在屏幕 x 1350，
    // 往前隔 100 一颗提交、再往前每隔 200 一颗（ch07.js、ch09.js 的 COMMITS 是同一组数）。
    // 这一章画成彩铅的一面墙：main 是一块搁板，提交是立在板上的金币，分支是钉在墙上的毛线。
    const Y0 = 540, HEAD0 = 1350, STEP = 200, CR = 12;
    const OLD = [1250, 1050, 850, 650, 450, 250, 50];
    const XM = 8050;
    const NMAIN = 33;
    const FLOOR = 760;
    const mainX = (j) => HEAD0 + STEP * j;
    const mainT = (j) => (j === 32 ? AT.m1 : j === 33 ? AT.m2 : 0.9 + 0.36 * j);

    const LANES = [
      { id: "pr", y: -160, from: HEAD0, to: 1750, jack: [2450, -1780], fork: AT.fork, merge: XM, at: AT.m3, yarn: PAL.red },
      { id: "ui", y: 130, from: mainX(2), to: 2150, jack: [2750, -1780], fork: [2.0, 2.2], merge: XM - 100, at: AT.m2, yarn: PAL.teal },
      { id: "docs", y: 410, from: mainX(4), to: 2550, jack: [3050, -1780], fork: [2.45, 2.65], merge: XM - 300, at: AT.m1, yarn: "#4b3a86" },
    ];
    const [PR, UI, DOCS] = LANES;
    const GX = 7150, MX0 = 7400;
    const COMMITS = [
      { x: 2050, t: AT.c1, sha: "f03f371" }, { x: 3300, t: AT.c2, sha: "065aa93" },
      { x: 3550, t: AT.c3, sha: "f6ef255" }, { x: 6600, t: AT.c4, sha: "e3886f1" },
    ];
    const SHA_F6 = "f6ef255950c37c2b810cf06aba2f653ca22bd9c7";

    const CAM0 = [960, Y0, 1];
    const SB = [1800, -1950, 0.62];
    const TH = [1150, -450, 0.7];
    const PRV = [3500, -450, 0.68];
    const VV = [4400, -450, 0.68];
    const GV = [6667, 40, 0.6];
    const MV = [7993, 100, 0.7];
    const NV = [9080, -800, 0.62];
    const FIN = [XM - 390, Y0, 1];
    const drift = (c, dx = 10, k = 1.015) => [c[0] + dx, c[1] + 2, c[2] * k];
    const CAM = [
      [0, CAM0], [AT.leap, drift(CAM0, 0, 1.01), E.lin], [1.3, SB, E.io], [2.45, drift(SB), E.lin], [2.95, TH, E.io],
      [4.85, drift(TH), E.lin], [5.1, PRV, E.io], [7.2, drift(PRV), E.lin], [7.5, VV, E.io], [10.65, drift(VV), E.lin],
      [10.95, GV, E.io], [13.75, drift(GV, 8, 1.012), E.lin], [14.05, MV, E.io], [15.85, drift(MV), E.lin],
      [16.15, NV, E.io], [17.85, drift(NV, 8, 1.012), E.lin], [18.4, FIN, E.io], [20, FIN, E.lin],
    ];
    function camAt(b) {
      if (b <= CAM[0][0]) return CAM[0][1].slice();
      for (let i = 1; i < CAM.length; i++) if (b <= CAM[i][0]) {
        const [t0, v0] = CAM[i - 1], [t1, v1, e = E.io] = CAM[i];
        const k = e(clamp((b - t0) / (t1 - t0)));
        return [lerp(v0[0], v1[0], k), lerp(v0[1], v1[1], k), Math.exp(lerp(Math.log(v0[2]), Math.log(v1[2]), k))];
      }
      return CAM[CAM.length - 1][1].slice();
    }
    // 某个机位上的屏幕坐标与屏幕字号 → 世界坐标；各镜头的版面按屏幕排，避开左下角的旁白区。
    const scr = (c) => ({ x: (sx) => c[0] + (sx - 960) / c[2], y: (sy) => c[1] + (sy - 540) / c[2], s: (px) => px / c[2] });

    function screen(x, draw) { x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); draw(); x.restore(); }
    function bulb(x, g, cx, cy, r, on, a = 1, seed = 1) {
      if (a <= 0) return;
      P.seg(x, cx, cy - r * 1.9, cx, cy - r * 0.9, r * 0.22, PAL.line, a * 0.8, seed);
      P.fill(x, P.ellipse(cx, cy, r), on > 0.5 ? PAL.moon : PAL.cream, { alpha: a, edge: r * 0.25, lw: Math.max(1.6, r * 0.16), seed, tile: { w: Math.max(2, r * 0.3), len: r * 1.5 } });
      if (on > 0) P.halo(g, cx, cy, r * 4.5, on * a);
    }

    // 两端水平切线的三次曲线：分支从 main 弯上去、合并时弯回来都用它。
    function sCurve(x0, y0, x1, y1, n = 22) {
      const pts = [], d = (x1 - x0) * 0.55;
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([u * u * u * x0 + 3 * u * u * t * (x0 + d) + 3 * u * t * t * (x1 - d) + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1]);
      }
      return pts;
    }
    function cablePts(jx, jy, sx, sy, n = 26) {
      const pts = [], h = sy - jy;
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const Q = [[jx, jy], [jx, jy + 0.45 * h], [sx, sy - 0.45 * h], [sx, sy]];
        pts.push([u * u * u * Q[0][0] + 3 * u * u * t * Q[1][0] + 3 * u * t * t * Q[2][0] + t * t * t * Q[3][0], u * u * u * Q[0][1] + 3 * u * u * t * Q[1][1] + 3 * u * t * t * Q[2][1] + t * t * t * Q[3][1]]);
      }
      return pts;
    }
    for (const ln of LANES) {
      ln.forkPts = sCurve(ln.from, Y0 - CR, ln.to, ln.y);
      ln.mergePts = sCurve(MX0, ln.y, ln.merge, Y0 - CR);
      ln.cable = cablePts(ln.jack[0], ln.jack[1], ln.to, ln.y - 26);
    }

    // Clawd 的走位：跳一段停一段；空中举手，落地放 land。
    function walk(path, b) {
      let px = path[0][1], py = path[0][2], landT = -9;
      for (let i = 1; i < path.length; i++) {
        const [t0, t1, x1, y1, h] = path[i];
        if (b >= t1) { px = x1; py = y1; landT = t1; continue; }
        if (b > t0) {
          const k = E.io((b - t0) / (t1 - t0));
          return { x: lerp(px, x1, k), y: lerp(py, y1, k) - hop(b, t0, t1, h), air: true, landT };
        }
        break;
      }
      return { x: px, y: py, air: false, landT };
    }
    function pose(st, b, extra) {
      if (st.air) return { pose: "arms-up", offset: 0 };
      if (extra) { const f = K.clawdSeq(extra[0], b, extra[1], BARs); if (f) return f; }
      return K.clawdSeq("land", b, st.landT, BARs) || { pose: "default", offset: 0 };
    }
    const seqAt = (b, list) => { let best = null; for (const s of list) if (b >= s[1]) best = s; return best; };
    function crew(tp, st, fr, q, a, o = {}) {
      if (a <= 0) return;
      const bottom = st.y + 2 * q;
      P.clawd(tp, fr, st.x, bottom, q, { alpha: a, flip: o.flip, air: st.air });
      if (o.prop) P.prop(tp, o.prop, st.x, bottom, q, { crouch: fr.offset || 0, flip: o.flip, alpha: a * (o.propA ?? 1) });
    }

    // 墙、护墙板、地板和搁板：每一帧都整面重画，排线图块按世界坐标铺，镜头移动时笔触钉在墙上不动。
    const WALL = { ang: 0.42, w: 3, len: 120, lite: 0.62, dark: 0.2, darkShare: 0.45, a0: 0.45, a1: 0.9, dens: 1.5, jit: 0.05 };
    const FLOORT = { ang: -0.3, w: 3.6, len: 90, lite: 0.35, dark: 0.18, darkShare: 0.5, a0: 0.35, a1: 0.7, dens: 1.2, jit: 0.06 };
    function room(x, cam) {
      const hw = 960 / cam.zoom + 40, hh = 540 / cam.zoom + 40;
      const vx0 = cam.x - hw, vx1 = cam.x + hw, vy0 = cam.y - hh, vy1 = cam.y + hh;
      P.fill(x, P.rect(vx0, vy0, vx1 - vx0, FLOOR - vy0), PAL.wall, { edge: 0, line: false, tile: WALL });
      if (vy1 > FLOOR - 50) {
        P.fill(x, P.rect(vx0 - 20, FLOOR - 44, vx1 - vx0 + 40, 48), PAL.cream, { edge: 5, lw: 2.6, seed: 13, tile: { lite: 0.2, dark: 0.1, a0: 0.2, a1: 0.4 } });
        P.fill(x, P.rect(vx0 - 20, FLOOR + 4, vx1 - vx0 + 40, vy1 - FLOOR + 40), PAL.floor, { edge: 0, line: false, tile: FLOORT });
        x.save(); x.strokeStyle = PAL.woodD; x.globalAlpha = 0.45; x.lineWidth = 2.6;
        for (let r = 0, py = FLOOR + 70; py < vy1; r++, py += 78 + r * 6) {
          x.beginPath(); x.moveTo(vx0, py); x.lineTo(vx1, py + 2); x.stroke();
          for (let sx = Math.floor(vx0 / 520) * 520 + (r % 2) * 260; sx < vx1; sx += 520) { x.beginPath(); x.moveTo(sx, py - 76 - r * 6 + 4); x.lineTo(sx + 2, py); x.stroke(); }
        }
        x.restore();
      }
      if (vy0 < Y0 + 60 && vy1 > Y0 - 40) {
        const sx0 = Math.max(-3000, vx0 - 20), sx1 = vx1 + 20;
        P.fill(x, P.rect(sx0, Y0, sx1 - sx0, 36), PAL.wood, { edge: 6, lw: 3, seed: 17, shadow: [0, 18, 0.35], shade: [0, -14, 0.6], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
        for (let bx = Math.floor(sx0 / 900) * 900 + 300; bx < sx1; bx += 900) {
          P.fill(x, P.polyShape([[bx - 16, Y0 + 36], [bx + 16, Y0 + 36], [bx + 16, Y0 + 70], [bx - 60, Y0 + 36]]), PAL.woodD, { edge: 3, lw: 2.4, seed: bx });
        }
      }
    }
    // 墙上的小摆设：日历圈着今天、一张「LGTM」十字绣。只是陪衬，没有事实。
    function decor(x) {
      const cx = 1640, cy = 316;
      P.note(x, cx, cy, 200, 196, { seed: 3, tape: false, pin: true, rot: 0.02 });
      P.fill(x, P.rect(cx, cy, 200, 52), PAL.red, { edge: 4, lw: 3, seed: 4 });
      T(x, "OCT", cx + 100, cy + 42, { size: 40, color: PAL.cream, align: "center", texture: true });
      for (let i = 0; i < 21; i++) T(x, String(i + 6), cx + 14 + (i % 7) * 26, cy + 90 + Math.floor(i / 7) * 36, { size: 20, color: PAL.ink, texture: true });
      const dx = cx + 14 + 6 * 26 - 5, dy = cy + 90 + 36 - 22;
      P.contour(x, P.ellipse(dx + 14, dy + 12, 20, 17).pts, { color: PAL.red, w: 3, seed: 5, corners: false });
      P.fill(x, P.rect(120, 290, 330, 200), PAL.woodD, { edge: 8, lw: 4, seed: 6, shadow: [12, 16, 0.35] });
      P.fill(x, P.rect(144, 314, 282, 152), PAL.cream, { edge: 5, lw: 2.4, seed: 7, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      T(x, "LGTM", 285, 418, { size: 70, color: PAL.red, align: "center", texture: true });
      for (let i = 0; i < 10; i++) { T(x, "×", 158 + i * 26, 340, { size: 20, color: PAL.teal, texture: true }); T(x, "×", 158 + i * 26, 458, { size: 20, color: PAL.teal, texture: true }); }
    }

    // 彩蛋：这个项目自己的规矩和旧事画成屋里的摆设，每个都放在某个机位镜头里空着的那块墙上或地上（坐标按那个机位的取景算）。
    function eggs(x, g, b) {
      const t = b * BARs;
      // 开场：搁板上一罐 token、一杯 effort: high，踢脚线上有个鼠洞，地上一块门垫。
      const jw = 120, jh = 140, jx = 490, jy = Y0 - jh;
      for (let i = 0; i < 15; i++) P.coin(x, jx + 22 + (i % 4) * 25 + K.hash(i * 5.3) * 6, Y0 - 16 - Math.floor(i / 4) * 19 - K.hash(i * 2.9) * 4, 11, PAL.gold, 1, 300 + i);
      const jar = P.rrect(jx, jy, jw, jh, 16);
      x.save(); x.globalAlpha = 0.3; x.fillStyle = PAL.sky; x.fill(jar.path); x.restore();
      P.contour(x, jar.pts, { color: PAL.line, w: 3.2, seed: 316 });
      P.seg(x, jx + 18, jy + 24, jx + 18, Y0 - 24, 5, PAL.cream, 0.55, 317);
      P.fill(x, P.rect(jx + 10, jy + 38, jw - 20, 42), PAL.cream, { edge: 3, lw: 2.2, seed: 318, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      M(x, "tokens", jx + jw / 2, jy + 68, { size: 28, weight: 600, color: PAL.ink, align: "center" });
      P.fill(x, P.rect(jx - 8, jy - 24, jw + 16, 28), PAL.woodD, { edge: 4, lw: 2.6, seed: 319 });
      const mx = 1440, mw = 130, mh = 104, my = Y0 - mh;
      x.save(); x.lineCap = "round"; x.strokeStyle = PAL.line; x.lineWidth = 14; x.beginPath(); x.arc(mx + mw, my + 50, 28, -1.3, 1.3); x.stroke();
      x.strokeStyle = PAL.teal; x.lineWidth = 8; x.stroke(); x.restore();
      P.fill(x, P.rrect(mx, my, mw, mh, 10), PAL.teal, { edge: 6, lw: 3.2, seed: 311, shade: [-16, 0, 0.5] });
      M(x, "effort:", mx + mw / 2, my + 44, { size: 28, weight: 600, color: PAL.cream, align: "center" });
      M(x, "high", mx + mw / 2, my + 86, { size: 36, weight: 700, color: PAL.moon, align: "center" });
      for (let i = 0; i < 3; i++) {
        const sx = mx + 34 + i * 32, pts = [];
        for (let k = 0; k <= 8; k++) pts.push([sx + 8 * Math.sin(k * 0.9 + t * 3 + i * 2), my - 14 - k * 9]);
        P.line(x, pts, 1, 3.2, PAL.cream, 0.6 * (0.6 + 0.4 * Math.sin(t * 2 + i)), 312 + i);
      }
      const hole = [[1374, FLOOR + 4], [1374, 714]];
      for (let i = 1; i < 12; i++) { const an = Math.PI + (i / 12) * Math.PI; hole.push([1420 + 46 * Math.cos(an), 714 + 46 * Math.sin(an)]); }
      hole.push([1466, 714], [1466, FLOOR + 4]);
      P.fill(x, P.polyShape(hole), "#2a1d1a", { edge: 0, lw: 3, seed: 321, flat: true });
      const blink = (t + 0.4) % 2.6 < 0.16 ? 0.15 : 1, look = 4 * Math.sin(t * 1.3);
      for (const ex of [1406, 1430]) { x.save(); x.fillStyle = PAL.moon; K.roundRect(x, ex + look - 4, 730 - 9 * blink, 8, Math.max(2, 18 * blink), 3); x.fill(); x.restore(); }
      x.save(); x.translate(980, 916); x.scale(1, 0.82);
      const mat = P.polyShape([[-180, -44], [180, -44], [210, 44], [-210, 44]]);
      P.fill(x, mat, PAL.teal, { edge: 8, lw: 3, seed: 322, shadow: [0, 10, 0.3], tile: { w: 4, len: 20, dens: 1.6, jit: 0.9 } });
      P.contour(x, [[-160, -30], [160, -30], [184, 30], [-184, 30]], { color: PAL.cream, w: 3, alpha: 0.7, seed: 323 });
      T(x, tr("ch08.egg.mat"), 0, 16, { size: 42, color: PAL.cream, align: "center", maxW: 330 });
      x.restore();

      // 项目聊天这一幕：看板上方一盏吊灯，记忆卡左边钉着 AGENTS.md 的行数上限，搁板上一盆仙人掌。
      P.seg(x, 2450, -2900, 2450, -2540, 3, PAL.line, 0.9, 331);
      P.fill(x, P.polyShape([[2400, -2540], [2500, -2540], [2550, -2450], [2350, -2450]]), PAL.red, { edge: 6, lw: 3, seed: 332, shade: [14, 0, 0.5] });
      P.halo(g, 2450, -2430, 220, 0.55);
      P.fill(x, P.ellipse(2450, -2446, 22, 12), PAL.moon, { edge: 0, lw: 2, seed: 333, flat: true });
      P.note(x, 380, -2240, 380, 250, { seed: 334, tape: false, pin: true, rot: 0.025 });
      M(x, "AGENTS.md", 410, -2140, { size: 46, weight: 700, color: PAL.ink });
      T(x, tr("ch08.egg.agents"), 410, -2050, { size: 58, color: PAL.red, maxW: 320 });
      P.seg(x, 410, -2030, 690, -2026, 3, PAL.red, 0.7, 335);
      const ca = prog(b, 1.1, 1.3) * (1 - prog(b, 3.0, 3.3));
      P.fill(x, P.ellipse(566, -1676, 22, 54), "#7fa46a", { alpha: ca, edge: 6, lw: 3, seed: 336, shade: [-8, 0, 0.6] });
      P.fill(x, P.rrect(584, -1676, 28, 52, 12), "#7fa46a", { alpha: ca, edge: 4, lw: 2.6, seed: 337 });
      P.fill(x, P.polyShape([[522, -1636], [610, -1636], [600, -1580], [532, -1580]]), "#c46a45", { alpha: ca, edge: 5, lw: 3, seed: 338 });
      P.fill(x, P.ellipse(566, -1734, 8), PAL.red, { alpha: ca, edge: 2, lw: 1.6, seed: 339 });

      // 本地门禁这一幕：一只走得飞快的新加坡时间挂钟，一幅「家 = localhost:3211」十字绣。
      const cx = 1250, cy = -880, r = 120;
      P.fill(x, P.ellipse(cx, cy, r + 18), PAL.woodD, { edge: 6, lw: 3.4, seed: 341, shadow: [10, 14, 0.35] });
      P.fill(x, P.ellipse(cx, cy, r), PAL.cream, { edge: 5, lw: 2.4, seed: 342, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * TAU, r0 = i % 3 === 0 ? r * 0.76 : r * 0.86;
        P.seg(x, cx + Math.sin(an) * r0, cy - Math.cos(an) * r0, cx + Math.sin(an) * r * 0.94, cy - Math.cos(an) * r * 0.94, i % 3 === 0 ? 5 : 3, PAL.ink, 0.85, 343 + i);
      }
      M(x, "SGT", cx, cy + r * 0.5, { size: 40, weight: 700, color: PAL.red, align: "center" });
      const mA = t * 1.4, hA = 2.1 + t * 0.12;
      P.seg(x, cx, cy, cx + Math.sin(hA) * r * 0.48, cy - Math.cos(hA) * r * 0.48, 8, PAL.ink, 1, 356);
      P.seg(x, cx, cy, cx + Math.sin(mA) * r * 0.78, cy - Math.cos(mA) * r * 0.78, 5, PAL.ink, 1, 357);
      P.fill(x, P.ellipse(cx, cy, 10), PAL.red, { edge: 0, lw: 2, seed: 358, flat: true });
      P.fill(x, P.rect(920, -640, 660, 180), PAL.woodD, { edge: 7, lw: 3.4, seed: 361, shadow: [12, 16, 0.35] });
      P.fill(x, P.rect(942, -618, 616, 136), PAL.cream, { edge: 4, lw: 2.2, seed: 362, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      for (let i = 0; i < 22; i++) { T(x, "×", 960 + i * 27, -588, { size: 20, color: PAL.red, texture: true }); T(x, "×", 960 + i * 27, -496, { size: 20, color: PAL.red, texture: true }); }
      P.fill(x, P.polyShape([[970, -540], [1002, -566], [1034, -540]]), PAL.red, { edge: 2, lw: 2.2, seed: 363 });
      P.fill(x, P.rect(978, -540, 48, 34), PAL.gold, { edge: 2, lw: 2.2, seed: 364 });
      T(x, tr("ch08.egg.home"), 1050, -520, { size: 48, color: PAL.ink, maxW: 490 });

      // 评审和验证这两幕：墙顶一串小旗，验证员 Haiku 的「本月最佳」挂像。
      const bx0 = 3400, bx1 = 5800, by = -1262, sag = 72, flags = 18, cols = [PAL.red, PAL.gold, PAL.teal, PAL.cream];
      const str = [];
      for (let i = 0; i <= 30; i++) { const k = i / 30; str.push([lerp(bx0, bx1, k), by + sag * 4 * k * (1 - k)]); }
      P.line(x, str, 1, 3, PAL.line, 0.8, 371);
      for (let i = 0; i < flags; i++) {
        const k = (i + 0.5) / flags, fx = lerp(bx0, bx1, k), fy = by + sag * 4 * k * (1 - k);
        P.fill(x, P.polyShape([[fx - 36, fy], [fx + 36, fy], [fx + 2, fy + 80]]), cols[i % 4], { edge: 5, lw: 2.4, seed: 372 + i });
      }
      P.fill(x, P.rect(4740, -110, 280, 280), PAL.gold, { edge: 7, lw: 3.4, seed: 391, shadow: [12, 16, 0.35] });
      P.fill(x, P.rect(4762, -88, 236, 236), PAL.sky, { edge: 6, lw: 2.2, seed: 392 });
      P.clawd(x, { pose: "default", offset: 0 }, 4870, 126, 7, { shadow: false });
      P.prop(x, "magnifier", 4870, 126, 7);
      for (let i = 0; i < 8; i++) { const an = (i / 8) * TAU; P.fill(x, P.ellipse(4970 + 20 * Math.cos(an), -66 + 20 * Math.sin(an), 12), PAL.red, { edge: 2, lw: 1.6, seed: 393 + i }); }
      P.fill(x, P.ellipse(4970, -66, 16), PAL.moon, { edge: 2, lw: 1.8, seed: 401 });
      P.fill(x, P.rect(4700, 192, 360, 104), PAL.wood, { edge: 4, lw: 2.6, seed: 402 });
      TL(x, tr("ch08.egg.staff"), 4880, 258, 44, { size: 44, color: PAL.cream, align: "center", maxW: 330 });

      // 合并闸门这一幕：「禁止手跑 wrangler deploy」警示牌，一张「基线只减不增」便签。
      P.fill(x, P.rect(5850, -720, 560, 300), "#f2c94c", { edge: 8, lw: 3.4, seed: 411, shadow: [12, 16, 0.35] });
      x.save(); x.clip(P.rect(5850, -720, 560, 40).path);
      for (let i = 0; i < 12; i++) P.fill(x, P.polyShape([[5850 + i * 56, -680], [5878 + i * 56, -720], [5906 + i * 56, -720], [5878 + i * 56, -680]]), PAL.ink, { edge: 0, line: false, seed: 412 + i });
      x.restore();
      P.contour(x, [[5866, -666], [6394, -666], [6394, -436], [5866, -436]], { color: PAL.red, w: 6, seed: 425 });
      T(x, tr("ch08.egg.deploy"), 6130, -580, { size: 70, color: PAL.red, align: "center", maxW: 500 });
      M(x, "wrangler deploy", 6130, -486, { size: 52, weight: 700, color: PAL.ink, align: "center" });
      P.seg(x, 5920, -500, 6340, -500, 6, PAL.red, 0.85, 426);
      P.note(x, 6480, -680, 340, 210, { seed: 427, color: PAL.sticky, tape: true, rot: 0.03 });
      TL(x, tr("ch08.egg.baseline"), 6650, -590, 54, { size: 50, color: PAL.ink, align: "center", maxW: 300 });
      P.line(x, [[6540, -526], [6600, -514], [6640, -506], [6700, -494], [6740, -492], [6780, -480]], 1, 4, PAL.red, 0.9, 428);

      // 落幕：地上一箱 Vercel 时代的旧资源、一块 Sentry 的墓碑；明信片在夜班那一幕才贴上，那时这块墙在镜头外。
      P.fill(x, P.rect(7380, 630, 380, 170), "#c89a64", { edge: 8, lw: 3.4, seed: 431, shadow: [14, 10, 0.3], shade: [-18, 0, 0.45] });
      x.save(); x.globalAlpha = 0.55; x.fillStyle = "#e9d8a0"; x.fillRect(7380, 630, 380, 26); x.restore();
      M(x, "site-assets-legacy/", 7570, 720, { size: 30, weight: 600, color: PAL.ink, align: "center" });
      T(x, tr("ch08.egg.box"), 7570, 770, { size: 36, color: PAL.woodD, align: "center", maxW: 340 });
      const stone = [[8300, 800], [8300, 715]];
      for (let i = 1; i < 12; i++) { const an = Math.PI + (i / 12) * Math.PI; stone.push([8375 + 75 * Math.cos(an), 715 + 75 * Math.sin(an)]); }
      stone.push([8450, 715], [8450, 800]);
      P.fill(x, P.polyShape(stone), "#a8a2b4", { edge: 8, lw: 3.2, seed: 441, shadow: [12, 6, 0.3], shade: [-14, 0, 0.5] });
      T(x, "RIP", 8375, 712, { size: 44, color: PAL.ink, align: "center" });
      M(x, "Sentry", 8375, 762, { size: 30, weight: 600, color: PAL.ink, align: "center" });
      for (const [fx, fc] of [[8312, "#7fa46a"], [8440, "#7fa46a"]]) P.line(x, [[fx - 10, 800], [fx, 776], [fx + 10, 800]], 1, 3, fc, 1, fx);
      P.seg(x, 8462, 800, 8466, 770, 3, "#7fa46a", 1, 442);
      P.fill(x, P.ellipse(8466, 764, 8), PAL.red, { edge: 2, lw: 1.6, seed: 443 });
      if (b >= 16.3) {
        P.note(x, 6780, 110, 560, 270, { seed: 451, color: PAL.cream, tape: true, rot: -0.03 });
        P.fill(x, P.ellipse(6900, 210, 44), PAL.moon, { edge: 6, lw: 2.4, seed: 452, shade: [14, -10, 0.5] });
        for (const [sx, sy] of [[6850, 300], [6960, 150], [6990, 290]]) { P.seg(x, sx - 8, sy, sx + 8, sy, 3, PAL.gold, 1, sx); P.seg(x, sx, sy - 8, sx, sy + 8, 3, PAL.gold, 1, sy); }
        P.seg(x, 7010, 140, 7012, 350, 2.4, PAL.soft, 0.7, 453);
        P.fill(x, P.rect(7256, 132, 64, 76), PAL.sky, { edge: 3, lw: 2, seed: 454 });
        P.clawd(x, { pose: "default", offset: 0 }, 7288, 184, 2.4, { shadow: false });
        P.contour(x, P.ellipse(7244, 196, 44).pts, { color: PAL.red, w: 2.4, alpha: 0.6, seed: 455 });
        T(x, tr("ch08.egg.card1"), 7030, 276, { size: 42, color: PAL.ink, maxW: 300 });
        T(x, tr("ch08.egg.card2"), 7030, 334, { size: 42, color: PAL.ink, maxW: 300 });
      }
    }
    // 夜班那扇窗：Clawd 形的星座、一颗流星，窗台上 04:00 的闹钟和一份晨报，窗下挂钩上挂着下了班的耳机和放大镜。
    const STAR_CLAWD = [[3, 0], [15, 0], [15, 2], [18, 2], [18, 4], [15, 4], [15, 6], [14, 8], [12, 6], [6, 6], [4, 8], [3, 6], [3, 4], [0, 4], [0, 2], [3, 2]];
    function nightEggs(x, g, b) {
      const t = b * BARs, sx0 = 8420, sy0 = -1620, u = 26;
      const sp = STAR_CLAWD.map(([a, c]) => [sx0 + a * u, sy0 + c * u]);
      P.line(x, [...sp, sp[0]], 1, 2, PAL.moon, 0.4, 461);
      for (const [px, py] of [...sp, [sx0 + 6 * u, sy0 + 2 * u], [sx0 + 12 * u, sy0 + 2 * u]]) {
        x.save(); x.strokeStyle = PAL.moon; x.globalAlpha = 0.9; x.lineWidth = 2.6; x.lineCap = "round";
        x.beginPath(); x.moveTo(px - 7, py); x.lineTo(px + 7, py); x.moveTo(px, py - 7); x.lineTo(px, py + 7); x.stroke(); x.restore();
      }
      const sk = prog(b, 16.85, 17.05);
      if (sk > 0 && sk < 1) {
        const hx = lerp(9400, 9960, sk), hy = lerp(-1600, -1470, sk);
        P.seg(x, hx - 180, hy - 42, hx, hy, 3, PAL.moon, 0.9 * (1 - sk), 462);
        P.halo(g, hx, hy, 40, 0.8 * (1 - sk));
      }
      const ring = impact(b, AT.night[3], 0.3);
      x.save(); x.translate(9500, -570); x.rotate(0.12 * Math.sin(t * 60) * ring); x.translate(-9500, 570);
      for (const lx of [9470, 9530]) P.seg(x, lx, -600, lx + (lx < 9500 ? -12 : 12), -572, 5, PAL.line, 1, lx);
      for (const bx of [9462, 9538]) P.fill(x, P.ellipse(bx, -686, 18, 14), PAL.gold, { edge: 3, lw: 2.2, seed: bx });
      P.fill(x, P.ellipse(9500, -636, 46), PAL.red, { edge: 6, lw: 3, seed: 463 });
      P.fill(x, P.ellipse(9500, -636, 34), PAL.cream, { edge: 3, lw: 2, seed: 464, tile: { lite: 0.2, dark: 0.08 } });
      P.seg(x, 9500, -636, 9500 + 15, -636 + 8, 4, PAL.ink, 1, 465);
      P.seg(x, 9500, -636, 9500, -664, 3, PAL.ink, 1, 466);
      x.restore();
      if (ring > 0.05) for (const s of [-1, 1]) P.line(x, [[9500 + s * 70, -680], [9500 + s * 82, -650], [9500 + s * 70, -620]], 1, 3, PAL.moon, ring, 467 + s);
      x.save(); x.translate(9800, -630); x.rotate(-0.04);
      P.fill(x, P.rect(-160, -62, 320, 124), PAL.paper, { edge: 5, lw: 2.6, seed: 471, shadow: [8, 6, 0.3] });
      T(x, tr("ch08.egg.paper"), -140, -8, { size: 56, color: PAL.ink, maxW: 160 });
      M(x, "09:00", 140, -12, { size: 46, weight: 700, color: PAL.red, align: "right" });
      for (let i = 0; i < 3; i++) P.seg(x, -140, 18 + i * 14, i === 2 ? 40 : 140, 18 + i * 14, 3, PAL.soft, 0.5, 472 + i);
      x.restore();
      P.fill(x, P.rect(9480, -484, 840, 30), PAL.wood, { edge: 4, lw: 2.6, seed: 481, shadow: [0, 12, 0.3] });
      for (const hx of [9620, 9900, 10180]) P.fill(x, P.ellipse(hx, -446, 10), PAL.woodD, { edge: 2, lw: 2, seed: hx });
      x.save(); x.lineCap = "round"; x.strokeStyle = PAL.line; x.lineWidth = 12; x.beginPath(); x.arc(9620, -390, 52, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      x.strokeStyle = PAL.ink; x.lineWidth = 7; x.stroke(); x.restore();
      for (const ex of [9566, 9674]) P.fill(x, P.rrect(ex - 16, -404, 32, 54, 10), PAL.red, { edge: 4, lw: 2.4, seed: ex });
      P.line(x, [[9674, -362], [9650, -330], [9620, -322]], 1, 4, PAL.ink, 1, 482);
      P.seg(x, 9900, -450, 9900, -396, 12, PAL.woodD, 1, 483);
      P.fill(x, P.ellipse(9900, -352, 42), PAL.sky, { alpha: 0.9, edge: 6, lw: 2.4, seed: 484 });
      x.save(); x.strokeStyle = PAL.gold; x.lineWidth = 7; x.beginPath(); x.arc(9900, -352, 42, 0, TAU); x.stroke(); x.restore();
      P.fill(x, P.polyShape([[10138, -452], [10222, -452], [10200, -322]]), PAL.teal, { edge: 6, lw: 2.6, seed: 485, shade: [8, 0, 0.5] });
      P.fill(x, P.rect(10132, -466, 96, 24), PAL.cream, { edge: 3, lw: 2.2, seed: 486 });
      P.fill(x, P.ellipse(10200, -314, 16), PAL.cream, { edge: 3, lw: 2, seed: 487 });
    }
    // 合并那一下撒一把纸屑：速度、转向都由序号算出来，任何一帧都能单独画。
    function confetti(x, b, t0, cx, cy, n, seed) {
      const k = (b - t0) * BARs;
      if (k < 0 || k > 2.3) return;
      const cols = [PAL.red, PAL.gold, PAL.teal, PAL.cream, "#4b3a86"];
      for (let i = 0; i < n; i++) {
        const h1 = K.hash(seed + i * 1.7), h2 = K.hash(seed + i * 3.3), h3 = K.hash(seed + i * 5.9);
        const an = -Math.PI / 2 + (h1 - 0.5) * 2.4, sp = 420 + h2 * 560, kk = Math.min(k, 0.9) + Math.max(0, k - 0.9) * 0.35;
        const px = cx + Math.cos(an) * sp * kk, py = cy + Math.sin(an) * sp * k + 450 * k * k;
        const flipK = Math.abs(Math.cos(k * 7 + h1 * 6));
        x.save(); x.translate(px, py); x.rotate(h3 * 6 + k * (3 + h3 * 6)); x.globalAlpha = 1 - clamp((k - 1.5) / 0.8);
        x.fillStyle = cols[i % 5]; x.fillRect(-10, -6 * flipK - 1, 20, 12 * flipK + 2);
        x.strokeStyle = PAL.line; x.lineWidth = 1.6; x.strokeRect(-10, -6 * flipK - 1, 20, 12 * flipK + 2);
        x.restore();
      }
    }

    function mainLine(Ly, b) {
      const { x, g } = Ly;
      let head = HEAD0, headT = -9;
      for (let j = 1; j <= NMAIN; j++) if (b >= mainT(j)) { head = mainX(j); headT = mainT(j); }
      if (b >= AT.m3) { head = XM; headT = AT.m3; }
      const pts = [...OLD, HEAD0];
      for (let j = 1; j <= NMAIN; j++) if (b >= mainT(j)) pts.push(mainX(j));
      if (b >= AT.m3) pts.push(XM);
      for (const cx of pts) if (cx !== head) P.coin(x, cx, Y0 - CR, CR, PAL.gold, 1, cx);
      const pop = 1 + 0.6 * impact(b, headT, 0.12);
      const merged = [AT.m1, AT.m2, AT.m3].some((t) => Math.abs(headT - t) < 1e-6);
      P.halo(g, head, Y0 - CR, 70 + (merged ? 90 * impact(b, headT, 0.3) : 0), 0.55 + (merged ? 0.4 * impact(b, headT, 0.3) : 0));
      P.coin(x, head, Y0 - 16 * pop, 16 * pop, PAL.clawd, 1, 999);
      return head;
    }

    function opening(Ly, b) {
      const { x, tp } = Ly;
      const a = 1 - prog(b, 1.05, 1.3);
      if (a <= 0) return;
      OLD.slice().reverse().forEach((cx, i) => {
        const t = AT.pop + i * AT.popStep, k = prog(b, t, t + 0.06, E.outBack);
        if (k <= 0) return;
        const fr = K.clawdSeq("land", b, t + 0.06, BARs) || { pose: "default", offset: 0 };
        P.clawd(tp, fr, cx, Y0 - 2 * CR - 1 - 18 * (1 - k), 1.9, { alpha: a * clamp(k * 2), shadow: false });
      });
      const la = prog(b, 0.45, 0.6) * a;
      M(x, "Co-Authored-By: Claude", 650, Y0 + 104, { size: 32, color: PAL.cream, align: "center", alpha: la });
    }

    const GUIDE_Q = 7, COORD = [1560, -1580], COORD_Q = 9;
    function guide(Ly, b) {
      const { tp } = Ly;
      if (b < AT.hopIn[0] || b >= 1.2) return;
      if (b < AT.leap) {
        const st = walk([[0, 2300, Y0 - 14], [AT.hopIn[0], AT.hopIn[1], HEAD0, Y0 - 14, 240]], b);
        const fr = pose(st, b);
        crew(tp, st, fr, GUIDE_Q, 1);
        const bk = prog(b, AT.hi, AT.hi + 0.08) * (1 - prog(b, 0.95, 1.0));
        P.bubble(tp, tr("ch08.hi"), HEAD0 + 6, Y0 - 14 - 12 * GUIDE_Q - 26, { size: 38, k: bk, reveal: prog(b, AT.hi + 0.04, 0.8), tail: "right" });
        return;
      }
      const k = E.in(prog(b, AT.leap, 1.15));
      crew(tp, { x: HEAD0, y: lerp(Y0 - 14, -700, k), air: true }, { pose: "arms-up", offset: 0 }, GUIDE_Q, 1);
    }
    function coordinator(Ly, b, a) {
      const { tp } = Ly;
      if (b < AT.fall[0] || a <= 0) return null;
      const k = E.in(prog(b, AT.fall[0], AT.fall[1]));
      const st = { x: COORD[0], y: lerp(-2950, COORD[1], k), air: b < AT.fall[1], landT: AT.fall[1] };
      const fr = st.air ? { pose: "arms-up", offset: 0 } : (K.clawdSeq("jump", b, AT.plug[0] - 0.05, BARs) && b >= AT.plug[0] - 0.05 ? K.clawdSeq("jump", b, AT.plug[0] - 0.05, BARs) : K.clawdSeq("look", b, AT.look, BARs) || pose(st, b));
      crew(tp, st, fr, COORD_Q, a, { prop: "headset", propA: prog(b, AT.fall[1], AT.fall[1] + 0.05) });
      return st;
    }

    const PANEL = { x: 1700, y: -2300, w: 1500, h: 600 };
    const JROWS = [-2140, -1960, -1780], JCOLS = [1850, 2150, 2450, 2750, 3050];
    const MEMO = { x: 820, y: -2290, w: 700, h: 450 };
    const SLIP_R = 1440, SLIP_Y = -1700, SLIP_H = 120;
    function board(Ly, b, a) {
      const { x, d, g } = Ly;
      if (a <= 0) return;
      P.fill(x, P.rect(480, COORD[1], 2850, 34), PAL.wood, { alpha: a, edge: 5, lw: 2.8, seed: 23, shadow: [0, 16, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      P.fill(x, P.rect(PANEL.x - 30, PANEL.y - 30, PANEL.w + 60, PANEL.h + 60), PAL.woodD, { alpha: a, edge: 10, lw: 3.4, seed: 24, shadow: [14, 20, 0.35] });
      P.fill(x, P.rect(PANEL.x, PANEL.y, PANEL.w, PANEL.h), "#c9985f", { alpha: a, edge: 14, lw: 2.6, seed: 25, tile: { w: 4, len: 18, dens: 1.5, jit: 0.9 } });
      P.note(d, PANEL.x + 40, PANEL.y + 22, 330, 92, { alpha: a, seed: 26, tape: false, pin: true, rot: -0.02 });
      T(d, tr("ch08.chat"), PANEL.x + 205, PANEL.y + 90, { size: 54, align: "center", alpha: a, maxW: 300 });
      const lit = prog(b, AT.plug[1], AT.plug[1] + 0.05);
      for (const jy of JROWS) for (const jx of JCOLS) {
        const used = LANES.find((ln) => ln.jack[0] === jx && ln.jack[1] === jy);
        P.fill(x, P.ellipse(jx, jy, 26), PAL.gold, { alpha: a, edge: 5, lw: 2.4, seed: jx + jy, tile: { w: 3, len: 20 } });
        P.fill(x, P.ellipse(jx, jy, 15), PAL.eye, { alpha: a, edge: 0, lw: 1.6, seed: jx - jy, flat: true });
        if (!used) continue;
        const plugged = used === PR ? lit : 1;
        if (plugged > 0) {
          P.fill(x, P.ellipse(jx, jy, 14), used.yarn, { alpha: a * plugged, edge: 3, lw: 2, seed: jx * 3 });
          if (used === PR) P.halo(g, jx, jy, 110, a * Math.max(impact(b, AT.plug[1], 0.25), 0.4 * plugged));
        }
        const tag = used === PR ? "#308" : tr(used === UI ? "ch08.t.ui" : "ch08.t.docs");
        const ta = a * (used === PR ? lit : 1);
        if (ta > 0) {
          P.note(d, jx - 4, PANEL.y + PANEL.h + 22, 150, 76, { alpha: ta, seed: jx, tape: false, rot: used === PR ? 0.03 : -0.03 });
          if (used === PR) M(d, tag, jx + 71, PANEL.y + PANEL.h + 76, { size: 44, weight: 600, color: PAL.red, align: "center", alpha: ta });
          else T(d, tag, jx + 71, PANEL.y + PANEL.h + 78, { size: 46, align: "center", alpha: ta });
        }
      }
      const ma = a * prog(b, 1.3, 1.5);
      P.note(d, MEMO.x, MEMO.y, MEMO.w, MEMO.h, { alpha: ma, seed: 27, rot: -0.015 });
      if (ma > 0) {
        T(d, tr("ch08.memory"), MEMO.x + 44, MEMO.y + 90, { size: 58, alpha: ma });
        P.seg(d, MEMO.x + 34, MEMO.y + 124, MEMO.x + MEMO.w - 34, MEMO.y + 128, 2.6, PAL.red, ma * 0.8, 28);
        ["ch08.mem1", "ch08.mem2", "ch08.mem3"].forEach((key, j) => {
          const r = prog(b, 1.6 + j * 0.15, 1.75 + j * 0.15);
          if (r > 0) P.fill(d, P.ellipse(MEMO.x + 58, MEMO.y + 206 + j * 92, 8), PAL.red, { alpha: ma * r, edge: 2, lw: 1.6, seed: 29 + j });
          T(d, tr(key), MEMO.x + 84, MEMO.y + 222 + j * 92, { size: 50, alpha: ma, reveal: r, maxW: MEMO.w - 120 });
        });
        d.save(); d.strokeStyle = PAL.woodD; d.lineCap = "round";
        for (const [rr, lw, a0, a1, al] of [[46, 7, 0.3, 5.6, 0.32], [40, 2.6, 1.0, 6.1, 0.22]]) { d.globalAlpha = ma * al; d.lineWidth = lw; d.beginPath(); d.arc(MEMO.x + MEMO.w - 92, MEMO.y + MEMO.h - 72, rr, a0, a1); d.stroke(); }
        d.restore();
      }
      const sk = prog(b, AT.slip[0], AT.slip[1], E.out);
      if (sk > 0) {
        const f = P.FONT.hand(50), w = measure(d, tr("ch08.slip"), f) + 64;
        const sx = lerp(-200 - w, SLIP_R - w, sk);
        P.note(d, sx, SLIP_Y, w, SLIP_H, { alpha: a, seed: 31, color: PAL.sticky, tape: false, rot: 0.02 });
        T(d, tr("ch08.slip"), sx + 32, SLIP_Y + 80, { size: 50, alpha: a });
        T(x, "lyjw", sx, SLIP_Y - 26, { size: 50, color: PAL.ink, alpha: a * prog(b, AT.slip[1] - 0.05, AT.slip[1] + 0.05) });
      }
    }
    function cables(Ly, b, a, coord) {
      const { x, g } = Ly;
      if (a <= 0) return;
      for (const ln of LANES) {
        const k = ln === PR ? prog(b, AT.cable[0], AT.cable[1], E.in) : 1;
        if (k > 0) P.line(x, ln.cable, k, 7, ln.yarn, a * 0.9, ln.jack[0]);
        const sk = ln === PR ? prog(b, AT.cable[1], AT.cable[1] + 0.05) : 1;
        if (sk > 0) {
          const s = 1 + 0.4 * (ln === PR ? impact(b, AT.cable[1], 0.15) : 0);
          P.fill(x, P.rect(ln.to - 22 * s, ln.y - 26 - 22 * s, 44 * s, 44 * s), PAL.gold, { alpha: a * sk, edge: 4, lw: 2.4, seed: ln.to });
          P.fill(x, P.ellipse(ln.to, ln.y - 26, 8), ln.yarn, { alpha: a * sk, edge: 2, lw: 1.6, seed: ln.to + 1 });
          if (ln === PR) P.halo(g, ln.to, ln.y - 26, 90, a * impact(b, AT.cable[1], 0.25));
        }
      }
      if (coord && b >= AT.plug[0] - 0.02 && b < AT.plug[1]) {
        const k = E.io(prog(b, AT.plug[0], AT.plug[1]));
        const hand = [coord.x + 8 * COORD_Q, coord.y - 9 * COORD_Q], jack = PR.jack;
        const p = [lerp(hand[0], jack[0], k), lerp(hand[1], jack[1], k) - 180 * 4 * k * (1 - k)];
        P.line(x, [hand, [lerp(hand[0], p[0], 0.5), Math.max(hand[1], p[1]) + 60], p], 1, 5, PR.yarn, a * 0.9, 41);
        P.fill(x, P.ellipse(p[0], p[1], 13), PR.yarn, { alpha: a, edge: 3, lw: 2, seed: 42 });
      }
    }

    function lanes(Ly, b) {
      const { x, g } = Ly;
      const end = 1 - prog(b, 15.95, 16.2);
      for (const ln of LANES) {
        const la = (ln === PR ? 1 : 1 - win(b, 4.8, 5.1, 10.7, 10.95)) * end;
        if (la <= 0 || b < ln.fork[0]) continue;
        P.line(x, ln.forkPts, prog(b, ln.fork[0], ln.fork[1], E.io), 7, ln.yarn, la, ln.to);
        const tip = ln === PR ? tipPR(b) : ln === UI ? tipUI(b) : tipDOCS(b);
        if (b >= ln.fork[1] && tip > ln.to) P.seg(x, ln.to, ln.y, tip, ln.y, 7, ln.yarn, la, ln.to + 5);
        if (b >= ln.at - 0.15) P.line(x, ln.mergePts, prog(b, ln.at - 0.15, ln.at, E.in), 7, ln.yarn, la, ln.to + 9);
      }
      const pa = end;
      for (const c of COMMITS) {
        const k = prog(b, c.t, c.t + 0.05, E.outBack);
        if (k <= 0) continue;
        P.halo(g, c.x, PR.y, 70, 0.6 * impact(b, c.t, 0.2) * pa);
        P.coin(x, c.x, PR.y, 13 * k, PAL.gold, pa, c.x);
        const keep = 1 - (c.t === AT.c1 ? prog(b, 4.9, 5.1) : c.t === AT.c4 ? prog(b, 13.8, 14.0) : prog(b, 10.6, 10.8));
        M(x, c.sha, c.x, PR.y - 38, { size: 48, color: PAL.ink, align: "center", alpha: pa * prog(b, c.t, c.t + 0.08) * keep });
      }
      const ua = 1 - win(b, 4.8, 5.1, 10.7, 10.95);
      if (b >= 2.4 && ua > 0) P.coin(x, 2350 - 100, UI.y, 12, PAL.gold, ua * end, 51);
      if (b >= 2.85 && ua > 0) P.coin(x, 2750 - 100, DOCS.y, 12, PAL.gold, ua * end, 52);
      const na = prog(b, 3.3, 3.5) * (1 - prog(b, 4.8, 5.1));
      M(x, "claude/project-thread-…", 1800, PR.y + 70, { size: 44, color: PAL.ink, alpha: na });
    }

    // 去合并闸门那一跳压低：跳高了会从清单卡、回执卡的底边穿过去，压住卡里的字。
    const PR_PATH = [
      [0, 1750, PR.y], [AT.pop308, AT.c1, 2240, PR.y, 120], [4.9, 5.15, 2900, PR.y, 110], [6.62, AT.c2, 3490, PR.y, 70],
      [6.87, AT.c3, 3740, PR.y, 70], [10.6, 10.95, 6790, PR.y, 160], [14.5, 14.82, XM, Y0 - 14, 260],
    ];
    const UI_PATH = [[0, 2150, UI.y], [2.2, 2.4, 2350, UI.y, 90], [10.7, 10.71, 6640, UI.y, 0]];
    const DOCS_PATH = [[0, 2550, DOCS.y], [2.65, 2.85, 2750, DOCS.y, 90], [10.7, 10.71, 6600, DOCS.y, 0]];
    const tipPR = (b) => keys(b, [[AT.pop308, PR.to], [AT.c1, 2240], [4.9, 2240], [5.15, 2900], [6.62, 2900], [AT.c2, 3490], [6.87, 3490], [AT.c3, 3740], [10.6, 3740], [10.95, GX - 60], [AT.g2, GX - 60], [AT.g2 + 0.2, MX0]]);
    const tipUI = (b) => (b < 10.7 ? keys(b, [[2.2, UI.to], [2.4, 2350]]) : keys(b, [[10.7, GX - 60], [AT.g3, GX - 60], [AT.g3 + 0.2, MX0]]));
    const tipDOCS = (b) => (b < 10.7 ? keys(b, [[2.65, DOCS.to], [2.85, 2750]]) : keys(b, [[10.7, GX - 60], [AT.g1, GX - 60], [AT.g1 + 0.2, MX0]]));

    function threads(Ly, b) {
      const { tp } = Ly;
      if (b >= AT.pop308 && b < AT.exit[1]) {
        const st = walk(PR_PATH, b);
        const fr = st.air ? { pose: "arms-up", offset: 0 } : (K.clawdSeq("jump", b, AT.pop308, BARs) && b < AT.pop308 + 0.05 ? K.clawdSeq("jump", b, AT.pop308, BARs) : pose(st, b, seqAt(b, [["look", AT.fail + 0.05], ["celebrate", AT.pass + 0.02], ["look", AT.coauth]])));
        const rise = prog(b, AT.pop308, AT.pop308 + 0.06, E.outBack);
        let y = st.y;
        if (!st.air && b < AT.c1 && b >= AT.pop308 && st.x === 1750) y += 30 * (1 - rise);
        const hopMark = Math.max(0, ...[0, 1, 2, 3, 4].map((i) => hop(b, AT.slip0 + AT.slipStep * i + 0.125, AT.slip0 + AT.slipStep * i + 0.25, 26)));
        const ex = prog(b, AT.exit[0], AT.exit[1]);
        const st2 = { x: st.x + 160 * E.in(ex), y: y - hopMark - hop(b, AT.exit[0], AT.exit[1] + 0.2, 160), air: st.air || ex > 0 };
        const a = (1 - ex) * clamp(rise * 2);
        crew(tp, st2, fr, 8, a);
        signBoard(Ly, b, st2, a);
      }
      for (const [ln, path, t0] of [[UI, UI_PATH, 2.2], [DOCS, DOCS_PATH, 2.65]]) {
        const a = (1 - win(b, 4.8, 5.1, 10.7, 10.95)) * prog(b, t0, t0 + 0.05) * (1 - prog(b, ln.at - 0.2, ln.at));
        if (a <= 0) continue;
        const st = walk(path, b);
        crew(tp, st, pose(st, b), 6, a);
      }
    }
    function signBoard(Ly, b, st, a) {
      const k = prog(b, AT.sign, AT.sign + 0.12, E.outBack);
      if (k <= 0 || a <= 0) return;
      const { tp } = Ly, q = 8, bottom = st.y + 2 * q;
      tp.save(); tp.translate(st.x, bottom - 12 * q); tp.scale(k, k); tp.translate(-st.x, -(bottom - 12 * q));
      const r = P.prop(tp, "sign", st.x, bottom, q, { w: 36, h: 9, alpha: a });
      if (r) T(tp, tr("ch08.sign"), st.x, r.y + r.h * 0.72, { size: 46, align: "center", alpha: a, maxW: r.w - 24 });
      tp.restore();
    }

    function localGates(Ly, b, a) {
      const { d } = Ly;
      if (a <= 0) return;
      const S = scr(TH), C = { x: S.x(130), y: S.y(120), w: S.s(640), h: S.s(470) };
      const k = prog(b, AT.card, AT.card + 0.12, E.outBack);
      P.note(d, C.x, C.y, C.w, C.h, { alpha: a * clamp(k * 3), sy: k, seed: 61, rot: -0.012 });
      if (k < 0.9) return;
      const rows = ["docs:check", "typecheck", "test", "eslint", "build"];
      T(d, tr("ch08.gates"), C.x + S.s(30), C.y + S.s(60), { size: S.s(38), alpha: a });
      P.seg(d, C.x + S.s(22), C.y + S.s(82), C.x + C.w - S.s(22), C.y + S.s(86), 2.6, PAL.red, a * 0.8, 62);
      rows.forEach((name, j) => {
        const y = C.y + S.s(130 + j * 58), t = AT.gates[j];
        const on = t !== undefined ? prog(b, t, t + 0.08) : 0;
        P.checkbox(d, C.x + S.s(30), y - S.s(28), on, { size: S.s(34), alpha: a * (t === undefined ? 0.45 : 1), seed: 63 + j });
        M(d, name, C.x + S.s(84), y, { size: S.s(30), color: t === undefined ? PAL.soft : PAL.ink, alpha: a * (t === undefined ? 0.7 : lerp(0.6, 1, on)) });
      });
      // 没跑的 build 在睡觉。
      const zy = C.y + S.s(130 + 4 * 58), zx = C.x + S.s(232), zt = b * BARs;
      P.clawd(d, { pose: "default", offset: 0 }, zx, zy + S.s(3), S.s(2.4), { alpha: a * 0.8, shadow: false, sleep: true });
      for (let i = 0; i < 3; i++) {
        const ph = (zt * 0.55 + i / 3) % 1;
        M(d, "z", zx + S.s(26 + ph * 46), zy - S.s(24 + ph * 52), { size: S.s(20 + 8 * ph), weight: 700, color: PAL.soft, alpha: a * 0.9 * Math.sin(Math.PI * ph), texture: true });
      }
      T(d, tr("ch08.gatesNote"), C.x + S.s(30), C.y + C.h - S.s(26), { size: S.s(30), color: PAL.soft, alpha: a * prog(b, 4.8, 4.9), maxW: C.w - S.s(60) });
    }

    const BOTS = [["Codex", "f"], ["Devin", "f"], ["Codex", "f"], ["Devin", "r"], ["Codex", "f"], ["Claude review", null]];
    function prReviews(Ly, b, a) {
      const { x, d, g } = Ly;
      if (a <= 0) return;
      const S = scr(PRV);
      const C = { x: S.x(300), y: S.y(110), w: S.s(800), h: S.s(450) };
      const k = prog(b, AT.pr, AT.pr + 0.12, E.outBack);
      P.note(d, C.x, C.y, C.w, C.h, { alpha: a * clamp(k * 3), sy: k, seed: 71, rot: 0.01 });
      if (k >= 0.9) {
        M(d, "PR #308", C.x + S.s(34), C.y + S.s(60), { size: S.s(32), weight: 600, color: PAL.soft, alpha: a });
        M(d, "fix(collector):", C.x + S.s(34), C.y + S.s(130), { size: S.s(36), weight: 600, alpha: a });
        T(d, "PageSpeed 两端各算各的，放宽超时", C.x + S.s(34), C.y + S.s(188), { size: S.s(38), alpha: a, maxW: C.w - S.s(68) });
        M(d, "claude/project-thread-… → main", C.x + S.s(34), C.y + S.s(246), { size: S.s(28), color: PAL.soft, alpha: a });
        P.seg(d, C.x + S.s(22), C.y + S.s(290), C.x + C.w - S.s(22), C.y + S.s(292), 2.6, PAL.red, a * 0.7, 72);
        const ci = prog(b, AT.ci, AT.ci + 0.06);
        P.tick(d, C.x + S.s(52), C.y + S.s(350), S.s(30), ci, a);
        M(d, "CI · check", C.x + S.s(90), C.y + S.s(362), { size: S.s(30), alpha: a * lerp(0.6, 1, ci) });
        M(d, "Codex · Devin · Claude review", C.x + S.s(34), C.y + S.s(412), { size: S.s(28), color: PAL.soft, alpha: a * prog(b, AT.slip0, AT.slip0 + 0.1), maxW: C.w - S.s(68) });
      }
      BOTS.forEach(([name, mark], i) => {
        const t = AT.slip0 + AT.slipStep * i, sk = prog(b, t - 0.1, t, E.out);
        if (sk <= 0) return;
        const w = S.s(600), h = S.s(80), px = S.x(1170) + S.s(260) * (1 - sk), py = S.y(94 + i * 90);
        P.note(d, px, py, w, h, { alpha: a * sk, seed: 81 + i, color: mark ? PAL.sticky : PAL.paper, tape: false, rot: ((i % 3) - 1) * 0.012 });
        M(d, name, px + S.s(24), py + S.s(52), { size: S.s(32), weight: 600, alpha: a * sk });
        if (!mark) {
          M(d, "No issues found", px + w - S.s(22), py + S.s(52), { size: S.s(28), color: PAL.soft, align: "right", alpha: a * sk });
          return;
        }
        const mk = prog(b, t + 0.125, t + 0.2);
        if (mk <= 0) return;
        const fixed = mark === "f";
        if (fixed) P.tick(d, px + w - S.s(150), py + S.s(40), S.s(28), mk, a);
        T(d, tr(fixed ? "ch08.fixed" : "ch08.replied"), px + w - S.s(22), py + S.s(54), { size: S.s(34), color: fixed ? PAL.red : PAL.soft, align: "right", alpha: a * mk });
        if (fixed) P.halo(g, px + w - S.s(60), py + S.s(40), S.s(70), 0.5 * impact(b, t + 0.125, 0.2) * a);
      });
      T(x, tr("ch08.codex3"), S.x(1770), S.y(686), { size: S.s(32), color: PAL.ink, align: "right", alpha: a * prog(b, AT.slip0 + AT.slipStep * 4, AT.slip0 + AT.slipStep * 4 + 0.1) });
    }

    const HAIKU_Q = 5.5;
    // Haiku 贴着清单卡底边往左飞，出了卡的左边再往上：直着往上会从卡里穿过去，压住清单上的字。
    const HAIKU_EXIT = [[3900, PR.y], [3700, PR.y - 170], [3380, PR.y - 170], [3330, PR.y - 1140]];
    function verify(Ly, b, a) {
      const { x, d, g, tp } = Ly;
      const hk = prog(b, AT.haiku[0], AT.haiku[1], E.in);
      if (b >= AT.haiku[0] && b < AT.bye + 0.35) {
        const st = { x: 3900, y: lerp(-1500, PR.y, hk), air: b < AT.haiku[1], landT: AT.haiku[1] };
        const out = prog(b, AT.bye, AT.bye + 0.28);
        if (out > 0) {
          const Q = HAIKU_EXIT, t = out, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          st.x = w.reduce((s0, k, i) => s0 + k * Q[i][0], 0);
          st.y = w.reduce((s0, k, i) => s0 + k * Q[i][1], 0);
          st.air = true;
        }
        const fr = st.air || out > 0 ? { pose: "arms-up", offset: 0 } : pose(st, b, seqAt(b, [["look", AT.tests[0] - 0.05], ["celebrate", AT.exact]]));
        crew(tp, st, fr, HAIKU_Q, 1 - prog(b, AT.bye + 0.2, AT.bye + 0.3), { prop: "magnifier", flip: out > 0 });
      }
      if (a <= 0) return;
      const S = scr(VV);
      const Tc = { x: S.x(480), y: S.y(250), w: S.s(420), h: S.s(330) };
      const tk = prog(b, AT.tests[0] - 0.2, AT.tests[0] - 0.08, E.outBack);
      P.note(d, Tc.x, Tc.y, Tc.w, Tc.h, { alpha: a * clamp(tk * 3), sy: tk, seed: 91, rot: -0.015 });
      if (tk >= 0.9) {
        M(d, "f6ef255", Tc.x + S.s(26), Tc.y + S.s(54), { size: S.s(30), weight: 600, color: PAL.soft, alpha: a });
        ["collector test", "typecheck", "eslint", "docs:check"].forEach((name, j) => {
          const y = Tc.y + S.s(118 + j * 58), on = prog(b, AT.tests[j], AT.tests[j] + 0.06);
          P.checkbox(d, Tc.x + S.s(26), y - S.s(26), on, { size: S.s(32), alpha: a, seed: 92 + j });
          M(d, name, Tc.x + S.s(76), y, { size: S.s(30), alpha: a * lerp(0.55, 1, on) });
        });
      }
      const R = { x: S.x(950), y: S.y(84), w: S.s(590), h: S.s(470) };
      const rk = prog(b, AT.receipt, AT.receipt + 0.12, E.outBack);
      P.note(d, R.x, R.y, R.w, R.h, { alpha: a * clamp(rk * 3), sy: rk, seed: 101, color: PAL.cream, tape: false, pin: true, rot: 0.01 });
      if (rk >= 0.9) {
        const L = (sy) => R.y + S.s(sy);
        T(d, tr("ch08.receipt"), R.x + S.s(30), L(64), { size: S.s(40), alpha: a });
        M(d, SHA_F6, R.x + S.s(30), L(104), { size: S.s(19), color: PAL.soft, alpha: a, texture: true });
        T(d, tr("ch08.paste"), R.x + S.s(30), L(146), { size: S.s(30), color: PAL.red, alpha: a * prog(b, AT.receipt + 0.1, AT.receipt + 0.2), maxW: R.w - S.s(60) });
        M(d, "unit-test-verified", R.x + S.s(30), L(214), { size: S.s(40), weight: 700, color: PAL.red, alpha: a * prog(b, AT.level, AT.level + 0.06) });
        P.seg(d, R.x + S.s(22), L(250), R.x + R.w - S.s(22), L(252), 2.4, PAL.ink, a * 0.6, 102);
        T(d, tr("ch08.evidence"), R.x + S.s(30), L(308), { size: S.s(30), alpha: a, maxW: R.w - S.s(60) });
        M(d, "typecheck · eslint · docs:check", R.x + S.s(30), L(354), { size: S.s(28), color: PAL.soft, alpha: a, maxW: R.w - S.s(60) });
        T(d, tr("ch08.verifier"), R.x + S.s(30), L(430), { size: S.s(30), alpha: a, maxW: R.w - S.s(60) });
      }
      const la = a * prog(b, AT.receipt + 0.15, AT.level);
      if (la > 0) {
        const lx = S.x(1570), rows = [["live-ui-verified", 1], ["unit-test-verified", 1], ["type-check-only", 1], null, ["verifier-blocked", 0], ["verifier-failed", 0]];
        P.note(d, lx - S.s(26), S.y(76), S.s(350), S.s(470), { alpha: la, seed: 111, tape: true, rot: -0.01 });
        T(d, tr("ch08.passing"), lx, S.y(124), { size: S.s(32), alpha: la });
        rows.forEach((r, j) => {
          const y = S.y(176 + j * 58);
          if (!r) { T(d, tr("ch08.notPassing"), lx, y + S.s(8), { size: S.s(32), color: PAL.soft, alpha: la }); return; }
          const hot = r[0] === "unit-test-verified" ? prog(b, AT.rung, AT.rung + 0.06) : 0;
          P.seg(d, lx, y - S.s(10), lx + S.s(20), y - S.s(10), 3, hot > 0 ? PAL.red : r[1] ? PAL.ink : PAL.soft, la, 112 + j);
          M(d, r[0], lx + S.s(30), y, { size: S.s(28), weight: hot > 0 ? 700 : 500, color: hot > 0 ? PAL.red : r[1] ? PAL.ink : PAL.soft, alpha: la, maxW: S.s(1890 - 1600) });
          if (hot > 0) P.halo(g, lx + S.s(10), y - S.s(10), S.s(60), 0.6 * hot * la * (0.6 + 0.4 * impact(b, AT.rung, 0.3)));
        });
      }
      const ck = prog(b, AT.check[0], AT.check[1]);
      if (ck > 0) {
        const cmd = "$ verify-receipt.ts check --pr 308";
        P.fill(x, P.rect(S.x(926), S.y(606), S.s(760), S.s(122)), PAL.night, { alpha: a, edge: 6, lw: 2.8, seed: 121, shadow: [10, 14, 0.35] });
        M(x, cmd.slice(0, Math.ceil(ck * cmd.length)), S.x(950), S.y(652), { size: S.s(28), color: PAL.cream, alpha: a });
        const ex = prog(b, AT.exact, AT.exact + 0.06);
        // 灯放在输出行行首：结果出来之前它挂在空行末尾，像个掉落的小点。
        const la2 = a * prog(b, AT.check[1], AT.check[1] + 0.05);
        if (la2 > 0) {
          P.fill(x, P.ellipse(S.x(950) + S.s(14), S.y(692), S.s(12)), ex > 0.5 ? PAL.moon : PAL.soft, { alpha: la2, edge: 2, lw: 1.6, seed: 122 });
          if (ex > 0) P.halo(g, S.x(950) + S.s(14), S.y(692), S.s(50), ex * la2);
        }
        M(x, '"coverage": "exact", "pass": true', S.x(950) + S.s(46), S.y(702), { size: S.s(28), weight: 600, color: PAL.moon, alpha: a * ex });
      }
    }

    // 小牌在闸前原地弹出：从左边滑进来会从三只线程 Clawd 身上穿过去。
    const GATES = [
      { ln: DOCS, label: "ch08.g1", open: AT.g1, tok: "ch08.t.docs", pop: 10.8 },
      { ln: PR, label: "ch08.g2", open: AT.g2, tok: "#308", pop: 10.9 },
      { ln: UI, label: "ch08.g3", open: AT.g3, tok: "ch08.t.ui", pop: 11.0 },
    ];
    const JUDGE = [GX + 60, PR.y - 230];
    function mergeGates(Ly, b, a) {
      const { x, d, g, s, tp } = Ly;
      if (a <= 0) return;
      const S = scr(GV);
      for (const gt of GATES) {
        const y = gt.ln.y, ok = prog(b, gt.open, gt.open + 0.1, E.io);
        P.fill(x, P.rect(GX - 34, y - 98, 68, 18), PAL.woodD, { alpha: a, edge: 3, lw: 2.4, seed: y });
        P.fill(x, P.rect(GX - 34, y + 80, 68, 18), PAL.woodD, { alpha: a, edge: 3, lw: 2.4, seed: y + 1 });
        const yb = lerp(y + 80, y - 74, ok);
        if (yb > y - 78) {
          const arm = P.rect(GX - 8, y - 80, 16, yb - (y - 80));
          P.fill(x, arm, PAL.cream, { alpha: a, edge: 2, lw: 2.4, seed: y + 2, tile: { lite: 0.2, dark: 0.08 } });
          x.save(); x.clip(arm.path);
          for (let k = 0; k < 6; k++) P.fill(x, P.polyShape([[GX - 10, y - 80 + k * 32], [GX + 10, y - 92 + k * 32], [GX + 10, y - 76 + k * 32], [GX - 10, y - 64 + k * 32]]), PAL.red, { alpha: a, edge: 0, line: false, seed: k });
          x.restore();
        }
        bulb(x, g, GX, y - 124, 14, prog(b, gt.open, gt.open + 0.05), a, y + 3);
        // 闸名和灯并排，小牌过闸后从它下面走，不贴着字。
        T(x, tr(gt.label), GX + 50, y - 98, { size: S.s(34), color: PAL.ink, alpha: a });
        // 闸杆收完才放小牌过去：收到一半就走，小牌会压断闸杆。
        const tx = keys(b, [[gt.open + 0.08, GX - 150], [gt.open + 0.3, GX + 200, E.io]]);
        const pk = prog(b, gt.pop, gt.pop + 0.12, E.outBack);
        const ta = a * clamp(pk * 3) * (1 - prog(b, gt.open + 0.25, gt.open + 0.4));
        const tw = S.s(112), th = S.s(50);
        P.note(d, tx - tw / 2, y - th / 2, tw, th, { alpha: ta, sy: pk, seed: y + 4, tape: false });
        const lab = gt.tok.startsWith("ch08.") ? tr(gt.tok) : gt.tok;
        if (pk >= 0.9) {
          if (gt.tok.startsWith("ch08.")) T(d, lab, tx, y + S.s(12), { size: S.s(32), align: "center", alpha: ta, maxW: tw - S.s(12) });
          else M(d, lab, tx, y + S.s(11), { size: S.s(28), weight: 600, align: "center", alpha: ta, maxW: tw - S.s(12) });
        }
      }
      const jIn = prog(b, 11.0, 11.15, E.outBack) * (1 - prog(b, 13.8, 14.0));
      if (jIn > 0) {
        P.fill(x, P.rect(JUDGE[0] - 110, JUDGE[1], 220, 20), PAL.wood, { alpha: a * clamp(jIn), edge: 3, lw: 2.4, seed: 131, shadow: [0, 12, 0.3] });
        const st = { x: JUDGE[0], y: JUDGE[1] + 40 * (1 - clamp(jIn)), air: false, landT: 11.15 };
        const fr = pose(st, b, seqAt(b, [["look", AT.fail - 0.25], ["jump", AT.fail - 0.08], ["jump", AT.pass - 0.08]]));
        crew(tp, st, fr, 7, a * clamp(jIn));
        T(x, tr("ch08.judge"), JUDGE[0] + 130, S.y(262), { size: S.s(36), color: PAL.ink, alpha: a * clamp(jIn) });
        T(x, tr("ch08.judgeSub"), JUDGE[0] + 130, S.y(306), { size: S.s(30), color: PAL.soft, alpha: a * clamp(jIn), maxW: S.s(520) });
      }
      const fk = prog(b, AT.fail, AT.fail + 0.14) * (1 - prog(b, AT.pass - 0.12, AT.pass - 0.02));
      // 印章落在小牌正上方、上一条分支的东西下面，和闸灯、小牌都隔开一截：两条分支之间只有这么高。
      const PS = [GX - 150, PR.y - 135], OS = [GX - 150, UI.y - 145];
      stamp(s, "FAIL", PS[0], PS[1], { k: fk, px: S.s(40), rot: -0.14, color: P.lead(PAL.soft), alpha: a });
      stamp(s, "PASS", PS[0], PS[1], { k: prog(b, AT.pass, AT.pass + 0.14), px: S.s(40), rot: -0.1, color: P.lead(PAL.red), alpha: a * (1 - prog(b, AT.g2 + 0.05, AT.g2 + 0.15)) });
      stamp(s, "OK", OS[0], OS[1], { k: prog(b, AT.nod, AT.nod + 0.14), px: S.s(32), rot: -0.12, color: P.lead(PAL.red), sub: tr("ch08.nod"), subPx: S.s(20), alpha: a * (1 - prog(b, AT.g3 + 0.05, AT.g3 + 0.15)) });
      P.halo(g, PS[0], PS[1], 150, 0.5 * a * impact(b, AT.pass, 0.3));
      P.halo(g, OS[0], OS[1], 150, 0.5 * a * impact(b, AT.nod, 0.3));
    }

    const SUBJECTS = [
      "- fix(collector): PageSpeed 两端各算各的，先占连接、放宽超时",
      "- fix(collector): PageSpeed 按较旧那端判过期，单端样本不丢",
      "- docs(core): PageSpeed 的 fetchedAt 改为两端较旧那次实测",
      "- fix(collector): 去掉 pagespeed 的 headStart 与不成立的排队解释",
    ];
    function frame(x, fx, fy, fw, fh, a, sy, seed) {
      if (a <= 0) return;
      x.save(); x.translate(fx, fy); x.scale(1, Math.max(0.001, sy));
      P.fill(x, P.rect(-22, -22, fw + 44, fh + 44), PAL.woodD, { alpha: a, edge: 8, lw: 3, seed, shadow: [12, 16, 0.38] });
      P.fill(x, P.rect(0, 0, fw, fh), PAL.cream, { alpha: a, edge: 5, lw: 2.2, seed: seed + 1, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      x.restore();
    }
    function mergeCards(Ly, b, a) {
      const { x, d, g, tp } = Ly;
      if (a <= 0) return;
      const S = scr(MV);
      const Mc = { x: S.x(1080), y: S.y(84), w: S.s(800), h: S.s(384) };
      const mk = prog(b, AT.mcard, AT.mcard + 0.12, E.outBack);
      if (mk > 0) P.line(x, [[XM + 30, Y0 - 150], [Mc.x, Mc.y + Mc.h]], 1, 3, PAL.ink, a * clamp(mk * 2) * 0.6, 141);
      frame(d, Mc.x, Mc.y, Mc.w, Mc.h, a * clamp(mk * 3), mk, 142);
      if (mk >= 0.9) {
        const L = (sy) => Mc.y + S.s(sy);
        const w0 = M(d, "cf92f7c", Mc.x + S.s(30), L(54), { size: S.s(30), weight: 600, color: PAL.soft, alpha: a });
        T(d, tr("ch08.merge"), Mc.x + S.s(30) + w0 + S.s(20), L(56), { size: S.s(34), color: PAL.soft, alpha: a });
        M(d, "fix(collector):", Mc.x + S.s(30), L(112), { size: S.s(34), weight: 600, alpha: a });
        T(d, "PageSpeed 两端各算各的，放宽超时 (#308)", Mc.x + S.s(30), L(166), { size: S.s(36), alpha: a, maxW: Mc.w - S.s(60) });
        SUBJECTS.forEach((s0, j) => T(d, s0, Mc.x + S.s(30), L(214 + j * 30), { size: S.s(21), color: PAL.soft, alpha: a, reveal: prog(b, AT.mcard + 0.1 + j * 0.06, AT.mcard + 0.3 + j * 0.06), texture: true, maxW: Mc.w - S.s(60) }));
        const ca = prog(b, AT.coauth, AT.coauth + 0.06);
        if (ca > 0) { d.save(); d.globalAlpha = 0.5 * ca * a; d.fillStyle = P.hatchTile(PAL.sticky, { a0: 0.5, a1: 0.9, dens: 1.4 }); d.fillRect(Mc.x + S.s(20), L(322), Mc.w - S.s(40), S.s(46)); d.restore(); }
        M(d, "Co-Authored-By: Claude …", Mc.x + S.s(30), L(356), { size: S.s(30), weight: 600, color: ca > 0 ? PAL.red : PAL.soft, alpha: a * lerp(0.5, 1, ca) });
      }
      const H = { x: S.x(1240), y: S.y(540), w: S.s(640), h: S.s(290) };
      const hk = prog(b, AT.home, AT.home + 0.12, E.outBack);
      M(x, "lyjw.me", H.x, H.y - S.s(20), { size: S.s(28), weight: 600, color: PAL.ink, alpha: a * prog(b, AT.home, AT.home + 0.1) });
      P.note(d, H.x, H.y, H.w, H.h, { alpha: a * clamp(hk * 3), sy: hk, seed: 151, rot: 0.012 });
      if (hk >= 0.9) {
        const L = (sy) => H.y + S.s(sy);
        M(d, "Commits", H.x + S.s(28), L(48), { size: S.s(28), weight: 600, color: PAL.soft, alpha: a });
        T(d, "fix(collector): PageSpeed 两端各算各的…", H.x + S.s(28), L(106), { size: S.s(32), alpha: a, maxW: H.w - S.s(56) });
        M(d, "LYJW131 committed", H.x + S.s(28), L(152), { size: S.s(28), color: PAL.soft, alpha: a });
        M(d, "with claude", H.x + S.s(74), L(206), { size: S.s(30), weight: 600, alpha: a });
        M(d, "cf92f7c", H.x + S.s(28), L(258), { size: S.s(28), color: PAL.soft, alpha: a });
        const avK = prog(b, AT.avatar - 0.1, AT.avatar);
        const fr = K.clawdSeq("jump", b, AT.avatar, BARs) || { pose: "default", offset: 0 };
        P.clawd(tp, fr, H.x + S.s(44), L(214), S.s(1.9), { alpha: a * avK, shadow: false });
        const lk = prog(b, AT.home + 0.1, AT.avatar - 0.05, E.io);
        if (lk > 0) {
          const p0 = [Mc.x + S.s(260), Mc.y + Mc.h + 22], p1 = [H.x + S.s(44), L(176)];
          const head = P.line(x, [p0, [p0[0], lerp(p0[1], p1[1], 0.5)], [p1[0], lerp(p0[1], p1[1], 0.5)], p1], lk, 5, PAL.red, a, 152);
          if (head && lk < 1) P.halo(g, head[0], head[1], S.s(50), 0.8 * a);
        }
      }
    }

    // 夜班画成墙上的一扇窗：窗外是夜空和月亮，时间轴是横过窗子的一根线，Clawd 站在线上。
    const S0 = 7650, HOUR = 300, NIGHT_Y = -900;
    const WIN = { x: 7380, y: -1660, w: 3240, h: 1060 };
    const ROUTINES = [
      { h: 1 + 53 / 60, label: "01:53", key: "ch08.r.watch", up: true },
      { h: 3.25, label: "03:15", key: "ch08.r.mirror", up: false },
      { h: 4, label: "04:00", key: "ch08.r.review", up: true, prop: "magnifier" },
      { h: 4 + 53 / 60, label: "04:53", key: "ch08.r.skills", up: false },
      { h: 8 + 41 / 60, label: "08:41", key: "ch08.r.news", up: true, dx: -50 },
      { h: 9, label: "09:00", key: "ch08.r.brief", up: false, prop: "headset", dx: 50 },
    ];
    function windowView(x, g) {
      P.fill(x, P.rect(WIN.x - 40, WIN.y - 40, WIN.w + 80, WIN.h + 80), PAL.wood, { edge: 10, lw: 3.4, seed: 161, shadow: [16, 22, 0.35], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      P.fill(x, P.rect(WIN.x, WIN.y, WIN.w, WIN.h), PAL.night, { edge: 18, lw: 2.8, seed: 162, tile: { w: 7, len: 70, lite: 0.18, dark: 0.3, a0: 0.3, a1: 0.6 } });
      x.save(); x.clip(P.rect(WIN.x, WIN.y, WIN.w, WIN.h).path);
      P.halo(g, 10230, -1430, 260, 0.6);
      P.fill(x, P.ellipse(10230, -1430, 92), PAL.moon, { edge: 12, lw: 2.6, seed: 163, shade: [26, -18, 0.5] });
      for (let i = 0; i < 38; i++) {
        const sx = WIN.x + 60 + K.hash(i * 3.1) * (WIN.w - 120), sy = WIN.y + 40 + K.hash(i * 7.7) * (WIN.h * 0.42), r = 4 + 6 * K.hash(i * 1.3);
        x.save(); x.strokeStyle = PAL.moon; x.globalAlpha = 0.85; x.lineWidth = 2.4; x.lineCap = "round";
        x.beginPath(); x.moveTo(sx - r, sy); x.lineTo(sx + r, sy); x.moveTo(sx, sy - r); x.lineTo(sx, sy + r); x.stroke(); x.restore();
      }
      x.restore();
      P.fill(x, P.rect(WIN.x + WIN.w / 2 - 14, WIN.y, 28, WIN.h), PAL.wood, { edge: 4, lw: 2.6, seed: 164, tile: { w: 4, len: 50, ang: 1.5, jit: 0.04 } });
      P.fill(x, P.rect(WIN.x - 70, WIN.y + WIN.h + 30, WIN.w + 140, 34), PAL.wood, { edge: 5, lw: 3, seed: 165, shadow: [0, 16, 0.32], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      for (const [cx, fl] of [[WIN.x - 70, 1], [WIN.x + WIN.w + 70, -1]]) {
        const pts = [[cx, WIN.y - 70], [cx + fl * 190, WIN.y - 70], [cx + fl * 150, WIN.y + WIN.h * 0.5], [cx + fl * 220, WIN.y + WIN.h + 20], [cx, WIN.y + WIN.h + 20]];
        P.fill(x, P.polyShape(pts), "#e07a4a", { edge: 12, lw: 3, seed: 166 + fl, shade: [-fl * 40, 0, 0.6], shadow: [10, 14, 0.3], tile: { ang: 1.45, w: 6, len: 80, jit: 0.05 } });
      }
    }
    function night(Ly, b, a) {
      const { x, g, tp } = Ly;
      if (a <= 0) return;
      const S = scr(NV);
      const x1 = S0 + 9 * HOUR;
      const lk = prog(b, 15.95, 16.2, E.io);
      P.seg(x, S0, NIGHT_Y, lerp(S0, x1, lk), NIGHT_Y, 4, PAL.cream, a, 171);
      for (let h = 0; h <= 9; h++) {
        const hx = S0 + h * HOUR, major = h % 3 === 0;
        if (hx > lerp(S0, x1, lk) + 1) continue;
        P.seg(x, hx, NIGHT_Y - (major ? 24 : 13), hx, NIGHT_Y + (major ? 24 : 13), major ? 3.4 : 2.4, PAL.cream, a * (major ? 1 : 0.7), 172 + h);
        if (major) M(x, `${String(h).padStart(2, "0")}:00`, hx, NIGHT_Y + S.s(56), { size: S.s(28), color: PAL.cream, align: "center", alpha: a });
      }
      const tw = T(x, tr("ch08.night"), S0, NIGHT_Y - S.s(270), { size: S.s(44), color: PAL.cream, alpha: a * prog(b, 16.0, 16.15) });
      M(x, "UTC+8", S0 + tw + S.s(20), NIGHT_Y - S.s(270), { size: S.s(28), color: PAL.moon, alpha: a * prog(b, 16.0, 16.15) });
      const marks = [[AT.night[0], 0], ...ROUTINES.map((r, i) => [AT.night[i + 1], r.h])];
      const cur = keys(b, marks.map(([t, h], i) => (i ? [t, S0 + h * HOUR, E.lin] : [t, S0 + h * HOUR])));
      const ca = a * prog(b, AT.night[0], AT.night[0] + 0.05) * (1 - prog(b, AT.night[6] + 0.1, AT.night[6] + 0.3));
      if (ca > 0) {
        P.halo(g, cur, NIGHT_Y, 90, 0.8 * ca);
        P.seg(x, cur, NIGHT_Y - 48, cur, NIGHT_Y + 48, 6, PAL.moon, ca, 181);
      }
      ROUTINES.forEach((r, i) => {
        const t = AT.night[i + 1], k = prog(b, t, t + 0.06, E.outBack);
        if (k <= 0) return;
        const mx = S0 + r.h * HOUR, rx = mx + (r.dx || 0), q = 6;
        P.coin(x, mx, NIGHT_Y, 10, PAL.moon, a, 190 + i);
        P.halo(g, mx, NIGHT_Y, 70, 0.6 * a * impact(b, t, 0.25));
        const fr = K.clawdSeq("jump", b, t, BARs) || { pose: "default", offset: 0 };
        const bottom = NIGHT_Y - 8 + 2 * q + (1 - k) * 30;
        P.clawd(tp, fr, rx, bottom, q, { alpha: a * clamp(k * 2), shadow: false });
        if (r.prop) P.prop(tp, r.prop, rx, bottom, q, { crouch: fr.offset || 0, alpha: a * clamp(k * 2) });
        const ty = r.up ? NIGHT_Y - 12 * q - S.s(56) : NIGHT_Y + S.s(108);
        M(x, r.label, rx, ty, { size: S.s(28), weight: 600, color: PAL.moon, align: "center", alpha: a * k });
        T(x, tr(r.key), rx, ty + (r.up ? -S.s(40) : S.s(44)), { size: S.s(34), color: PAL.cream, align: "center", alpha: a * k, maxW: S.s(300) });
      });
    }

    // 标题像片头的手写大字：橙色彩铅填字、深色描边；旁白写在贴着胶带的纸条上。
    function title(x, b) {
      const a = prog(b, 0.3, 0.75, E.out) * (1 - prog(b, 2.3, 2.6));
      if (a <= 0) return;
      screen(x, () => {
        x.save(); x.globalAlpha = a; x.font = P.FONT.hand(132); x.lineJoin = "round";
        x.lineWidth = 5; x.strokeStyle = PAL.line; x.strokeText("08", 104, 204);
        x.fillStyle = P.hatchTile(PAL.clawd, { a0: 0.5, a1: 0.9, dens: 1.5, w: 4 }); x.fillText("08", 104, 204);
        x.restore();
        T(x, tr("ch08.title"), 290, 180, { size: 66, reveal: prog(b, 0.35, 0.8), alpha: a });
        M(x, "Claude Projects · GitHub · Codex · Devin · Haiku", 292, 228, { size: 28, color: PAL.ink, reveal: prog(b, 0.45, 1.0), alpha: a });
        P.seg(x, 104, 262, 104 + 990 * prog(b, 0.35, 1.0, E.outExpo), 264, 3, PAL.red, 0.7 * a, 191);
      });
    }
    function narPair(x, kA, kB, rA, rB, a) {
      if (a <= 0) return;
      screen(x, () => {
        const f = P.FONT.hand(60), wA = measure(x, tr(kA), f), wB = measure(x, tr(kB), f);
        const w = Math.min(1040, Math.max(wA, wB)) + 96;
        P.note(x, 66, 870, w, 190, { alpha: a, seed: 201, rot: -0.008, color: PAL.cream });
        for (const [k, y, r] of [[kA, 944, rA], [kB, 1024, rB]]) K.text(x, tr(k), 110, y, { font: f, color: P.lead(PAL.ink), reveal: r, dim: 0.1, perChar: true, alpha: a, maxW: 1040, narration: true });
      });
    }

    function paint(Ly, b, cam) {
      const { w, x, g, tp } = Ly;
      room(w, cam);
      decor(w);
      eggs(w, g, b);
      windowView(w, g);
      nightEggs(w, g, b);
      mainLine(Ly, b);
      confetti(x, b, AT.m3, XM, Y0 - 24, 36, 17);
      opening(Ly, b);
      guide(Ly, b);
      const boardA = prog(b, 1.1, 1.3) * (1 - prog(b, 3.0, 3.3));
      board(Ly, b, boardA);
      const coord = coordinator(Ly, b, boardA);
      cables(Ly, b, prog(b, 1.1, 1.3) * (1 - prog(b, 4.8, 5.1)), coord);
      lanes(Ly, b);
      localGates(Ly, b, 1 - prog(b, 4.85, 5.05));
      prReviews(Ly, b, 1 - prog(b, 7.3, 7.5));
      // 验证这一幕要在 #308 那只 Clawd 跳过终端那两行之前淡完：它的跳线正好横穿那两行字。
      verify(Ly, b, 1 - prog(b, 10.55, 10.7));
      mergeGates(Ly, b, prog(b, 10.75, 10.95) * (1 - prog(b, 13.9, 14.2)));
      // 合并卡在夜班的旁白出来之前淡完：甩镜头时它正落在旁白那块。
      mergeCards(Ly, b, 1 - prog(b, 15.85, 16.05));
      night(Ly, b, prog(b, 15.95, 16.1) * (1 - prog(b, 17.95, 18.25)));
      threads(Ly, b);
      title(tp, b);

      narPair(tp, "ch08.n1a", "ch08.n1b", prog(b, 1.45, 1.95), prog(b, 1.95, 2.5), win(b, 1.4, 1.5, 2.85, 2.95));
      narPair(tp, "ch08.n2a", "ch08.n2b", prog(b, 3.1, 3.6), prog(b, 3.6, 4.3), win(b, 3.05, 3.15, 4.85, 4.95));
      narPair(tp, "ch08.n3a", "ch08.n3b", prog(b, 5.15, 5.6), prog(b, 5.9, 6.6), win(b, 5.1, 5.2, 7.25, 7.35));
      narPair(tp, "ch08.n4a", "ch08.n4b", prog(b, 7.6, 8.2), prog(b, 8.9, 9.6), win(b, 7.55, 7.65, 10.55, 10.65));
      narPair(tp, "ch08.n5a", "ch08.n5b", prog(b, 11.05, 11.6), prog(b, 12.9, 13.5), win(b, 11.0, 11.1, 13.7, 13.8));
      narPair(tp, "ch08.n6a", "ch08.n6b", prog(b, 14.1, 14.6), prog(b, 15.2, 15.7), win(b, 14.05, 14.15, 15.8, 15.9));
      narPair(tp, "ch08.n7a", "ch08.n7b", prog(b, 16.15, 16.6), prog(b, 16.6, 17.3), win(b, 16.1, 16.2, 17.85, 17.95));
    }

    function render(f) {
      BARs = f.BAR;
      const b = f.bar;
      const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
      const hitS = Math.max(impact(b, AT.hopIn[1], 0.1) * 0.5, impact(b, AT.plug[1], 0.1) * 0.6, impact(b, AT.fail, 0.1) * 0.7, impact(b, AT.pass, 0.1), impact(b, AT.nod, 0.1), impact(b, AT.m3, 0.14));
      const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.012 * hitS), rot: 0 };
      G.setCam(cam);
      G.clear(P.toLin(P.hex(PAL.wall)));

      const w = bgL.begin(); bgL.cam(cam);
      const g = glowL.begin(); glowL.cam(cam);
      const x = ink.begin(); ink.cam(cam);
      const d = paperL.begin(); paperL.cam(cam);
      const s = stampL.begin(); stampL.cam(cam);
      const tp = top.begin(); top.cam(cam);
      paint({ w, x, g, d, s, tp }, b, cam);

      G.composite(bgL.upload(), { mode: G.MODE.normal });
      G.composite(glowL.upload(), { mode: G.MODE.normal });
      G.composite(ink.upload(), { mode: G.MODE.normal });
      G.composite(paperL.upload(), { mode: G.MODE.normal });
      G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 2.9 });
      G.composite(top.upload(), { mode: G.MODE.normal });

      const sh = hitS * 6;
      f.post = {
        bloom: 0, threshold: 1.2, halation: 0, grain: 0.03, vignette: 0.16, ca: 0,
        shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
        blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
      };
    }
    async function init() {
      bgL = G.layer("bg"); glowL = G.layer("emit", 0.5); ink = G.layer("ink"); paperL = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top");
      await document.fonts.load(P.FONT.hand(40), "一句话之后 Ag");
      // 排线图块第一次用到才生成：开播后空闲时先在一张小画布上把各机位画一遍，图块就都在缓存里了，镜头切过去不会卡一下。
      const c = document.createElement("canvas"); c.width = 240; c.height = 135;
      const wx = c.getContext("2d"), Lw = { w: wx, x: wx, g: wx, d: wx, s: wx, tp: wx };
      const bars = [0.7, 2.3, 4.6, 6.6, 9.9, 12.6, 14.6, 15.6, 17.0, 19.5];
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
      const step = () => {
        if (!bars.length) return;
        const cb = camAt(bars[0]), k = 240 / 1920, cam = { x: cb[0], y: cb[1], zoom: cb[2] };
        wx.setTransform(k * cam.zoom, 0, 0, k * cam.zoom, k * (960 - cam.zoom * cam.x), k * (540 - cam.zoom * cam.y));
        paint(Lw, bars.shift(), cam);
        idle(step);
      };
      idle(step);
    }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch08", title: "ch.08", bars: 20,
    async init() { impl = impl || make(); await impl.init(); },
    render(f) { impl.render(f); },
  });
})();
