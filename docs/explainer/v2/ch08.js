(() => {
  function make() {
    const { E, prog, keys, clamp, lerp, stamp, measure, hop } = K;
    const { PAL } = P;
    I18N.add({
      "ch08.title": ["一句话之后", "After one line"],
      "ch08.hi": ["说好的，看看我们怎么动手。", "Here's how we build it."],
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
      "ch08.reviews": ["机器评审", "Bot reviews"],
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
      "ch08.r.watch": ["盯防采集", "Watch the\ncollector"],
      "ch08.r.mirror": ["记忆镜像", "Mirror\nmemory"],
      "ch08.r.review": ["代码审查", "Code\nreview"],
      "ch08.r.skills": ["提炼 skill", "Distill\nskills"],
      "ch08.r.news": ["读 Anthropic 动态", "Read Anthropic news"],
      "ch08.r.brief": ["晨报", "Morning\nbrief"],
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
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let bgL, ink, glowL, paperL, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
    const T = (x, str, px, py, o = {}) => P.text(x, str, px, py, o);
    const M = (x, str, px, py, o = {}) => P.text(x, str, px, py, { ...o, mono: true });
    // 英文比中文长的几处在英文里拆成两行；中文只有一行时居中在两行的中间。
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
    // 这一章画成一栋剖开的楼：main 是一楼大厅里横过的一串灯笼，每颗提交一盏；楼上每个房间演一步。
    const Y0 = 540, HEAD0 = 1350, STEP = 200;
    const OLD = [1250, 1050, 850, 650, 450, 250, 50];
    const MAIN_T = [1.6, 3.0, 5.0, 7.4, 10.8, 13.2];
    const mainX = (j) => HEAD0 + STEP * j;
    const DOCS_C = "#4b3a86", UI_C = PAL.teal, PR_C = PAL.red;
    const MERGES = [{ x: mainX(7), t: AT.m1, col: DOCS_C }, { x: mainX(8), t: AT.m2, col: UI_C }, { x: mainX(8) + 100, t: AT.m3, col: PR_C }];
    const XM = MERGES[2].x;

    const BX0 = -400, BX1 = 5800, ROOFY = -2680, GROUND = 760, FT = 36;
    const ROOMS = {
      lobby: { x0: -320, x1: 5720, y0: 0, y1: GROUND, col: PAL.wall, seed: 511 },
      mail: { x0: -320, x1: 2700, y0: -1300, y1: -80, col: "#a9cdb8", seed: 512 },
      work: { x0: 3150, x1: 5720, y0: -1300, y1: -80, col: "#e9bb98", seed: 513 },
      lab: { x0: -320, x1: 2700, y0: -2600, y1: -1380, col: "#c3b2e0", seed: 514 },
      rev: { x0: 3150, x1: 5720, y0: -2600, y1: -1380, col: "#a9c4e0", seed: 515 },
    };
    // 楼顶三个阀门的出口顺着中间那堵墙往下走，藏进楼板，到大厅天花板再各自落到 main 上那盏灯的正上方。
    const BUNDLE = [[3090, DOCS_C], [3115, UI_C], [3140, PR_C]];

    const CAM0 = [960, Y0, 1];
    const MAILC = [1150, -690, 0.72], WORKC = [4480, -690, 0.72], REVC = [4480, -1990, 0.72], LABC = [1150, -1990, 0.72];
    const ROOFC = [2900, -3130, 0.62], MERGEC = [3000, 380, 0.75], NIGHTC = [2700, -1500, 0.235];
    const FIN = [XM - 390, Y0, 1];
    const drift = (c, dx = 10, k = 1.015) => [c[0] + dx, c[1] + 2, c[2] * k];
    const CAM = [
      [0, CAM0], [AT.leap, drift(CAM0, 0, 1.01), E.lin], [1.3, MAILC, E.io], [2.45, drift(MAILC), E.lin], [2.95, WORKC, E.io],
      [4.85, drift(WORKC), E.lin], [5.1, REVC, E.io], [7.2, drift(REVC), E.lin], [7.5, LABC, E.io], [10.65, drift(LABC), E.lin],
      [10.95, ROOFC, E.io], [13.75, drift(ROOFC, 8, 1.012), E.lin], [14.05, MERGEC, E.io], [15.85, drift(MERGEC), E.lin],
      [16.15, NIGHTC, E.io], [17.85, drift(NIGHTC, 8, 1.012), E.lin], [18.4, FIN, E.io], [20, FIN, E.lin],
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
    // 某个机位上的屏幕坐标与屏幕字号 → 世界坐标；各房间的摆设按那个机位的屏幕排，避开左下角的旁白区。
    const scr = (c) => ({ x: (sx) => c[0] + (sx - 960) / c[2], y: (sy) => c[1] + (sy - 540) / c[2], s: (px) => px / c[2] });
    const sM = scr(MAILC), sW = scr(WORKC), sR = scr(REVC), sL = scr(LABC), sF = scr(ROOFC), sG = scr(MERGEC), sN = scr(NIGHTC);
    const box = (S, x0, y0, x1, y1) => P.rect(S.x(x0), S.y(y0), S.s(x1 - x0), S.s(y1 - y0));
    const view = (c) => { const hw = 960 / c.zoom + 80, hh = 540 / c.zoom + 80; return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh }; };
    const sees = (v, r) => r.x1 > v.x0 && r.x0 < v.x1 && r.y1 > v.y0 && r.y0 < v.y1;

    function screen(x, draw) { x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); draw(); x.restore(); }
    function bulb(x, g, cx, cy, r, on, a = 1, seed = 1) {
      if (a <= 0) return;
      P.seg(x, cx, cy - r * 1.9, cx, cy - r * 0.9, r * 0.22, PAL.line, a * 0.8, seed);
      P.fill(x, P.ellipse(cx, cy, r), on > 0.5 ? PAL.moon : PAL.cream, { alpha: a, edge: r * 0.25, lw: Math.max(1.6, r * 0.16), seed, tile: { w: Math.max(2, r * 0.3), len: r * 1.5 } });
      if (on > 0) P.halo(g, cx, cy, r * 4.5, on * a);
    }
    // 玻璃管：深色描边、浅色管身、一道高光；胶囊在管里走时画在它上面，看着像透过玻璃。
    const GLASS = { [PR_C]: "#f0b9ad", [UI_C]: "#bfe0d9", [DOCS_C]: "#c6bce6" };
    function tube(x, pts, col, a, w = 40) {
      if (a <= 0) return;
      K.polyline(x, pts, 1, w + 8, PAL.line, a * 0.85);
      K.polyline(x, pts, 1, w, P.hatchTile(GLASS[col] || PAL.cream, { lite: 0.4, dark: 0.1, a0: 0.3, a1: 0.6 }), a);
      K.polyline(x, pts.map(([px, py]) => [px - w * 0.22, py - w * 0.22]), 1, w * 0.16, PAL.cream, a * 0.7);
    }
    function capsule(x, cx, cy, len, r, col, rot, a, seed) {
      if (a <= 0) return;
      x.save(); x.translate(cx, cy); x.rotate(rot);
      P.fill(x, P.rrect(-len / 2, -r, len, 2 * r, r), col, { alpha: a, edge: r * 0.3, lw: Math.max(1.6, r * 0.14), seed, shade: [0, -r * 0.45, 0.5] });
      for (const k of [-0.2, 0.2]) P.seg(x, k * len, -r * 0.85, k * len, r * 0.85, Math.max(1.4, r * 0.16), PAL.cream, a * 0.8, seed + 3);
      x.restore();
    }
    // 打字机：u 是那个机位上一个屏幕像素对应的世界长度；返回滚筒顶端，打出来的纸条从这里长出来。
    function typewriter(x, cx, bottom, u, a, seed, strike = 0) {
      if (a <= 0) return bottom;
      const w = 170 * u, h = 56 * u, dy = 3 * u * strike;
      P.fill(x, P.polyShape([[cx - w / 2, bottom], [cx + w / 2, bottom], [cx + w * 0.4, bottom - h], [cx - w * 0.4, bottom - h]]), "#5f7f8f", { alpha: a, edge: 4 * u, lw: Math.max(1.6, 2.6 * u), seed, shade: [0, -10 * u, 0.5] });
      for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) {
        const kx = cx - w * (0.3 - r * 0.05) + i * w * 0.12, ky = bottom - h * (0.2 + r * 0.24) + (r === 1 && i === 2 ? dy : 0);
        P.fill(x, P.ellipse(kx, ky, 6 * u), PAL.cream, { alpha: a, edge: 0, lw: Math.max(1, 1.6 * u), seed: seed + r * 7 + i, flat: true });
      }
      P.fill(x, P.rrect(cx - w * 0.46, bottom - h - 20 * u, w * 0.92, 18 * u, 8 * u), PAL.ink, { alpha: a, edge: 0, lw: Math.max(1.4, 2.2 * u), seed: seed + 40, flat: true });
      return bottom - h - 18 * u;
    }
    // 打字机吐出的提交小纸条：从滚筒里往上长出来。
    function shaSlip(d, u, cx, rollY, sha, t0, b, a, seed) {
      const k = prog(b, t0, t0 + 0.1, E.out);
      if (k <= 0 || a <= 0) return;
      const w = 176 * u, h = 64 * u;
      P.note(d, cx - w / 2, rollY - h * k, w, h, { alpha: a, sy: k, seed, tape: false, color: PAL.paper });
      if (k > 0.9) M(d, sha, cx, rollY - h * 0.3, { size: 34 * u, weight: 600, color: PAL.ink, align: "center", alpha: a });
    }
    function clock(x, cx, cy, r, h, seed, label) {
      P.fill(x, P.ellipse(cx, cy, r * 1.15), PAL.woodD, { edge: r * 0.05, lw: Math.max(1.6, r * 0.03), seed, shadow: [r * 0.08, r * 0.12, 0.35] });
      P.fill(x, P.ellipse(cx, cy, r), PAL.cream, { edge: r * 0.04, lw: Math.max(1.4, r * 0.02), seed: seed + 1, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * TAU, r0 = i % 3 === 0 ? r * 0.76 : r * 0.86;
        P.seg(x, cx + Math.sin(an) * r0, cy - Math.cos(an) * r0, cx + Math.sin(an) * r * 0.94, cy - Math.cos(an) * r * 0.94, Math.max(1.4, r * (i % 3 === 0 ? 0.045 : 0.028)), PAL.ink, 0.85, seed + 2 + i);
      }
      if (label) M(x, label, cx, cy + r * 0.52, { size: r * 0.32, weight: 700, color: PAL.red, align: "center" });
      const hA = (h / 12) * TAU, mA = h * TAU;
      P.seg(x, cx, cy, cx + Math.sin(hA) * r * 0.48, cy - Math.cos(hA) * r * 0.48, Math.max(2, r * 0.07), PAL.ink, 1, seed + 20);
      P.seg(x, cx, cy, cx + Math.sin(mA) * r * 0.78, cy - Math.cos(mA) * r * 0.78, Math.max(1.6, r * 0.045), PAL.ink, 1, seed + 21);
      P.fill(x, P.ellipse(cx, cy, r * 0.08), PAL.red, { edge: 0, lw: 1.6, seed: seed + 22, flat: true });
    }
    // 墙上两只钟同一个时间：白天慢慢走，入夜一圈拨到零点，再跟着夜班一个个 routine 拨到 09:00。
    const hourAt = (b) => keys(b, [[0, 14.5], [15.95, 18.6, E.lin], [16.125, 24], [16.375, 25 + 53 / 60, E.lin], [16.625, 27.25, E.lin], [16.75, 28, E.lin], [16.875, 28 + 53 / 60, E.lin], [17.375, 32 + 41 / 60, E.lin], [17.5, 33, E.lin], [20, 33.5, E.lin]]);

    // Clawd 的走位：跳一段停一段；y 是脚底。
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
      P.clawd(tp, fr, st.x, st.y, q, { alpha: a, flip: o.flip, air: st.air, sleep: o.sleep });
      if (o.prop) P.prop(tp, o.prop, st.x, st.y, q, { crouch: fr.offset || 0, flip: o.flip, alpha: a * (o.propA ?? 1) });
    }
    function zzz(x, cx, cy, s, b, a) {
      const zt = b * BARs;
      for (let i = 0; i < 3; i++) {
        const ph = (zt * 0.55 + i / 3) % 1;
        M(x, "z", cx + s * (8 + ph * 16), cy - s * (8 + ph * 18), { size: s * (7 + 3 * ph), weight: 700, color: PAL.soft, alpha: a * 0.9 * Math.sin(Math.PI * ph), texture: true });
      }
    }
    const nightA = (b) => prog(b, 15.95, 16.2) * (1 - prog(b, 18.0, 18.4));
    const asleep = (b) => b > 16.2 && b < AT.night[6];

    // 楼：天、地、外墙、各房间的墙面和地板、中间那堵墙里的三根管、楼板上的两个洞（大厅上楼的、实验室上屋顶的）。
    const WALLT = { ang: 0.42, w: 3, len: 120, lite: 0.62, dark: 0.2, darkShare: 0.45, a0: 0.45, a1: 0.9, dens: 1.5, jit: 0.05 };
    const FLOORT = { ang: -0.3, w: 3.6, len: 90, lite: 0.35, dark: 0.18, darkShare: 0.5, a0: 0.35, a1: 0.7, dens: 1.2, jit: 0.06 };
    const SKYT = { ang: 0.2, w: 4, len: 140, lite: 0.55, dark: 0.1, darkShare: 0.3, a0: 0.3, a1: 0.6, dens: 1.1, jit: 0.05 };
    const CLOUDS = [[-1000, -3300, 150], [1700, -3880, 110], [4300, -3600, 140], [6500, -2700, 170], [-1150, -1400, 130], [6600, -800, 120], [-900, 300, 120]];
    function building(w, g, v, b) {
      P.fill(w, P.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0), PAL.sky, { edge: 0, line: false, tile: SKYT });
      for (const [cx, cy, r] of CLOUDS) {
        if (!sees(v, { x0: cx - 3 * r, x1: cx + 3 * r, y0: cy - r, y1: cy + r })) continue;
        const dx = 40 * Math.sin(b * 0.3 + cx);
        for (const [ox, oy, k] of [[-1.3, 0.2, 0.7], [0, -0.2, 1], [1.3, 0.25, 0.75]]) P.fill(w, P.ellipse(cx + dx + ox * r, cy + oy * r, r * k * 1.2, r * k * 0.8), PAL.cream, { edge: r * 0.12, lw: 2.6, seed: cx + ox * 10, line: false, tile: { lite: 0.3, dark: 0.06 } });
      }
      const sx = sF.x(1680), sy = sF.y(95);
      if (sees(v, { x0: sx - 200, x1: sx + 200, y0: sy - 200, y1: sy + 200 })) {
        P.halo(g, sx, sy, 220, 0.5);
        P.fill(w, P.ellipse(sx, sy, 70), PAL.moon, { edge: 10, lw: 3, seed: 505, shade: [16, -12, 0.4] });
      }
      if (v.y1 > GROUND) {
        P.fill(w, P.rect(v.x0, GROUND, v.x1 - v.x0, v.y1 - GROUND + 40), "#a7c184", { edge: 0, line: false, tile: { ang: 1.4, w: 3, len: 30, dens: 1.4, jit: 0.4 } });
        const fx0 = Math.max(BX0, v.x0), fx1 = Math.min(BX1, v.x1);
        if (fx1 > fx0) {
          P.fill(w, P.rect(fx0, GROUND + 4, fx1 - fx0, v.y1 - GROUND + 40), PAL.floor, { edge: 0, line: false, tile: FLOORT });
          w.save(); w.beginPath(); w.rect(fx0, GROUND, fx1 - fx0, v.y1 - GROUND); w.clip();
          w.strokeStyle = PAL.woodD; w.globalAlpha = 0.45; w.lineWidth = 2.6;
          for (let r = 0, py = GROUND + 70; py < v.y1; r++, py += 78 + r * 6) {
            w.beginPath(); w.moveTo(fx0, py); w.lineTo(fx1, py + 2); w.stroke();
            for (let px = Math.floor(fx0 / 520) * 520 + (r % 2) * 260; px < fx1; px += 520) { w.beginPath(); w.moveTo(px, py - 76 - r * 6 + 4); w.lineTo(px + 2, py); w.stroke(); }
          }
          w.restore();
        }
      }
      if (!sees(v, { x0: BX0, x1: BX1, y0: ROOFY - 40, y1: GROUND })) return;
      P.fill(w, P.rect(BX0, ROOFY, BX1 - BX0, GROUND - ROOFY), "#d6bf9b", { edge: 12, lw: 4, seed: 501, tile: { w: 4, len: 80, lite: 0.3, dark: 0.16 } });
      P.fill(w, P.rect(BX0 - 30, ROOFY - 6, BX1 - BX0 + 60, 36), "#9a7558", { edge: 5, lw: 3, seed: 502 });
      for (const r of Object.values(ROOMS)) {
        if (!sees(v, r)) continue;
        P.fill(w, P.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0), r.col, { edge: 14, lw: 3.6, seed: r.seed, tile: WALLT });
        if (r !== ROOMS.lobby) P.fill(w, P.rect(r.x0, r.y1 - FT, r.x1 - r.x0, FT), PAL.floor, { edge: 4, lw: 2.6, seed: r.seed + 9, tile: FLOORT });
        else P.fill(w, P.rect(r.x0, GROUND - 44, r.x1 - r.x0, 44), PAL.cream, { edge: 5, lw: 2.6, seed: 13, tile: { lite: 0.2, dark: 0.1, a0: 0.2, a1: 0.4 } });
      }
      P.fill(w, P.rect(2700, -1660, 360, 280 - FT), "#5b4752", { edge: 8, lw: 3, seed: 503, tile: { lite: 0.1, dark: 0.3 } });
      P.fill(w, P.rect(2686, -1680, 388, 22), PAL.woodD, { edge: 3, lw: 2.6, seed: 504 });
      P.fill(w, P.rect(1720, -80, 160, 80), "#3e2a2c", { edge: 0, lw: 3, seed: 506, flat: true });
      P.fill(w, P.rect(2390, ROOFY, 160, 80), "#3e2a2c", { edge: 0, lw: 3, seed: 507, flat: true });
      P.fill(w, P.polyShape([[2390, ROOFY], [2410, ROOFY - 120], [2440, ROOFY - 126], [2420, ROOFY]]), PAL.woodD, { edge: 3, lw: 2.6, seed: 508 });
      for (const [lx, top, bot] of [[1736, -80, 0], [1864, -80, 0], [2406, ROOFY, ROOFY + 80], [2534, ROOFY, ROOFY + 80]]) P.seg(w, lx, top, lx, bot, 5, PAL.woodD, 0.9, lx);
      for (let i = 0; i < 3; i++) { P.seg(w, 1736, -66 + i * 26, 1864, -66 + i * 26, 4, PAL.woodD, 0.9, 520 + i); P.seg(w, 2406, ROOFY + 14 + i * 26, 2534, ROOFY + 14 + i * 26, 4, PAL.woodD, 0.9, 530 + i); }
      for (const [bx, col] of BUNDLE) for (const [y0, y1] of [[-2600, -1380], [-1300, -80]]) tube(w, [[bx, y0], [bx, y1]], col, 1, 16);
    }

    // main：一根挂在大厅里的彩灯线，每颗提交是一盏纸灯笼；当前 HEAD 那盏是橙色、亮着。
    const WIRE_Y = 490, NAIL = 400;
    const wireY = (px) => { const k = (((px - BX0) % NAIL) + NAIL) % NAIL / NAIL; return WIRE_Y + 18 * 4 * k * (1 - k); };
    function commitsAt(b) {
      const out = OLD.map((x) => ({ x, t: -9, old: true }));
      out.push({ x: HEAD0, t: -9 });
      MAIN_T.forEach((t, i) => { if (b >= t) out.push({ x: mainX(i + 1), t }); });
      for (const m of MERGES) if (b >= m.t) out.push({ x: m.x, t: m.t, col: m.col });
      return out;
    }
    function lantern(x, g, cx, o) {
      const { head = false, lit = 1, k = 1, clawd = 0, col = null, seed = 1 } = o;
      const r = head ? 26 : 20, cy = Y0;
      P.seg(x, cx, wireY(cx), cx, cy - r * 1.15 * k, 2.4, PAL.line, 0.9, seed);
      if (k <= 0) return;
      x.save(); x.translate(cx, cy); x.scale(k, k); x.translate(-cx, -cy);
      if (lit > 0) P.halo(g, cx, cy, (head ? 120 : 70) * lit, (head ? 0.7 : 0.45) * lit);
      P.fill(x, P.rect(cx - r * 0.55, cy - r * 1.18, r * 1.1, r * 0.3), PAL.woodD, { edge: 2, lw: 2, seed: seed + 1 });
      if (clawd < 1) {
        const body = head ? PAL.clawd : lit > 0.5 ? PAL.gold : PAL.cream;
        P.fill(x, P.ellipse(cx, cy, r * (1 - 0.4 * clawd), r * 1.15 * (1 - 0.4 * clawd)), body, { alpha: 1 - clawd, edge: r * 0.25, lw: 2.4, seed: seed + 2, tile: { w: Math.max(2, r * 0.25), len: r * 1.4 } });
        for (const s of [-0.5, 0.5]) P.contour(x, P.ellipse(cx + s * r * 0.3, cy, r * 0.42, r * 1.1).pts, { color: PAL.woodD, w: 1.6, alpha: 0.4 * (1 - clawd), seed: seed + 3, corners: false });
      }
      if (clawd > 0) P.clawd(x, { pose: "default", offset: 0 }, cx, cy + 14, 2.3, { alpha: clawd, shadow: false });
      P.fill(x, P.rect(cx - r * 0.45, cy + r * 1.05, r * 0.9, r * 0.24), PAL.woodD, { edge: 2, lw: 2, seed: seed + 4 });
      if (col) { P.seg(x, cx, cy + r * 1.3, cx, cy + r * 2.1, 5, col, 1, seed + 5); P.fill(x, P.ellipse(cx, cy + r * 2.2, 6), col, { edge: 1, lw: 1.6, seed: seed + 6 }); }
      x.restore();
    }
    function mainLine(Ly, b, v) {
      const { x, g } = Ly;
      if (!sees(v, { x0: BX0, x1: BX1, y0: WIRE_Y - 60, y1: Y0 + 80 })) return;
      const x0 = Math.max(ROOMS.lobby.x0, v.x0 - 40), x1 = Math.min(ROOMS.lobby.x1, v.x1 + 40), pts = [];
      for (let px = x0; px <= x1; px += 25) pts.push([px, wireY(px)]);
      P.line(x, pts, 1, 3, PAL.line, 0.85, 7);
      for (let nx = Math.ceil((x0 - BX0) / NAIL) * NAIL + BX0; nx <= x1; nx += NAIL) P.fill(x, P.ellipse(nx, WIRE_Y, 7), PAL.woodD, { edge: 2, lw: 2, seed: nx, flat: true });
      const cs = commitsAt(b), head = cs[cs.length - 1];
      cs.forEach((c, i) => {
        const isHead = c === head;
        const k = c.t < 0 ? 1 : prog(b, c.t, c.t + 0.06, E.outBack) * (1 + 0.3 * (isHead ? impact(b, c.t, 0.12) : 0));
        let clawd = 0;
        if (c.old) { const t = AT.pop + (OLD.length - 1 - OLD.indexOf(c.x)) * AT.popStep; clawd = prog(b, t, t + 0.05); }
        lantern(x, g, c.x, { head: isHead, k, clawd, lit: c.old ? clawd : 1, col: c.col, seed: 600 + i * 11 });
        if (c.col && isHead) P.halo(g, c.x, Y0, 200, 0.6 * impact(b, c.t, 0.3));
      });
      const la = prog(b, 0.45, 0.6) * (1 - prog(b, 1.05, 1.3));
      M(x, "Co-Authored-By: Claude", 650, 650, { size: 32, color: PAL.ink, align: "center", alpha: la });
    }

    // 大厅里的摆设：日历、LGTM 十字绣、鼠洞、门垫、盆栽，地上一箱 Vercel 时代的旧资源、一块 Sentry 的墓碑。
    function lobby(Ly, b, v) {
      const { x } = Ly;
      if (!sees(v, ROOMS.lobby)) return;
      const t = b * BARs;
      const cx = 1640, cy = 240;
      P.note(x, cx, cy, 200, 196, { seed: 3, tape: false, pin: true, rot: 0.02 });
      P.fill(x, P.rect(cx, cy, 200, 52), PAL.red, { edge: 4, lw: 3, seed: 4 });
      T(x, "OCT", cx + 100, cy + 42, { size: 40, color: PAL.cream, align: "center", texture: true });
      for (let i = 0; i < 21; i++) T(x, String(i + 6), cx + 14 + (i % 7) * 26, cy + 90 + Math.floor(i / 7) * 36, { size: 20, color: PAL.ink, texture: true });
      P.contour(x, P.ellipse(cx + 14 + 6 * 26 + 9, cy + 90 + 36 - 10, 20, 17).pts, { color: PAL.red, w: 3, seed: 5, corners: false });
      P.fill(x, P.rect(1980, 250, 330, 200), PAL.woodD, { edge: 8, lw: 4, seed: 6, shadow: [12, 16, 0.35] });
      P.fill(x, P.rect(2004, 274, 282, 152), PAL.cream, { edge: 5, lw: 2.4, seed: 7, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      T(x, "LGTM", 2145, 378, { size: 70, color: PAL.red, align: "center", texture: true });
      for (let i = 0; i < 10; i++) { T(x, "×", 2018 + i * 26, 300, { size: 20, color: PAL.teal, texture: true }); T(x, "×", 2018 + i * 26, 418, { size: 20, color: PAL.teal, texture: true }); }
      const hole = [[1374, GROUND + 4], [1374, 714]];
      for (let i = 1; i < 12; i++) { const an = Math.PI + (i / 12) * Math.PI; hole.push([1420 + 46 * Math.cos(an), 714 + 46 * Math.sin(an)]); }
      hole.push([1466, 714], [1466, GROUND + 4]);
      P.fill(x, P.polyShape(hole), "#2a1d1a", { edge: 0, lw: 3, seed: 321, flat: true });
      const blink = (t + 0.4) % 2.6 < 0.16 ? 0.15 : 1, look = 4 * Math.sin(t * 1.3);
      for (const ex of [1406, 1430]) { x.save(); x.fillStyle = PAL.moon; K.roundRect(x, ex + look - 4, 730 - 9 * blink, 8, Math.max(2, 18 * blink), 3); x.fill(); x.restore(); }
      x.save(); x.translate(980, 916); x.scale(1, 0.82);
      P.fill(x, P.polyShape([[-180, -44], [180, -44], [210, 44], [-210, 44]]), PAL.teal, { edge: 8, lw: 3, seed: 322, shadow: [0, 10, 0.3], tile: { w: 4, len: 20, dens: 1.6, jit: 0.9 } });
      P.contour(x, [[-160, -30], [160, -30], [184, 30], [-184, 30]], { color: PAL.cream, w: 3, alpha: 0.7, seed: 323 });
      T(x, tr("ch08.egg.mat"), 0, 16, { size: 42, color: PAL.cream, align: "center", maxW: 330 });
      x.restore();
      P.fill(x, P.polyShape([[160, 680], [260, 680], [248, 760], [172, 760]]), "#c46a45", { edge: 5, lw: 3, seed: 324, shade: [-10, 0, 0.5] });
      for (let i = 0; i < 5; i++) { const an = -Math.PI / 2 + (i - 2) * 0.45; P.fill(x, P.ellipse(210 + Math.cos(an) * 60, 640 + Math.sin(an) * 50, 22, 48), "#7fa46a", { edge: 5, lw: 2.6, seed: 325 + i, shade: [-6, 0, 0.5] }); }
      P.fill(x, P.rect(2100, 630, 350, 130), "#c89a64", { edge: 8, lw: 3.4, seed: 431, shadow: [14, 10, 0.3], shade: [-18, 0, 0.45] });
      x.save(); x.globalAlpha = 0.55; x.fillStyle = "#e9d8a0"; x.fillRect(2100, 630, 350, 24); x.restore();
      M(x, "site-assets-legacy/", 2275, 700, { size: 30, weight: 600, color: PAL.ink, align: "center" });
      T(x, tr("ch08.egg.box"), 2275, 744, { size: 34, color: PAL.woodD, align: "center", maxW: 320 });
      const stone = [[2500, GROUND], [2500, 690]];
      for (let i = 1; i < 12; i++) { const an = Math.PI + (i / 12) * Math.PI; stone.push([2575 + 75 * Math.cos(an), 690 + 75 * Math.sin(an)]); }
      stone.push([2650, 690], [2650, GROUND]);
      P.fill(x, P.polyShape(stone), "#a8a2b4", { edge: 8, lw: 3.2, seed: 441, shadow: [12, 6, 0.3], shade: [-14, 0, 0.5] });
      T(x, "RIP", 2575, 692, { size: 44, color: PAL.ink, align: "center" });
      M(x, "Sentry", 2575, 740, { size: 30, weight: 600, color: PAL.ink, align: "center" });
      for (const fx of [2512, 2640]) P.line(x, [[fx - 10, GROUND], [fx, GROUND - 24], [fx + 10, GROUND]], 1, 3, "#7fa46a", 1, fx);
      P.seg(x, 2662, GROUND, 2666, GROUND - 30, 3, "#7fa46a", 1, 442);
      P.fill(x, P.ellipse(2666, GROUND - 36, 8), PAL.red, { edge: 2, lw: 1.6, seed: 443 });
      // 三个阀门的出口从天花板垂下来，正对着要点亮的那三盏灯。
      for (const [i, m] of MERGES.entries()) {
        P.seg(x, m.x, 0, m.x, 80, 22, PAL.woodD, 1, 450 + i);
        P.seg(x, m.x, 0, m.x, 80, 14, P.hatchTile(PAL.gold, {}), 1, 455 + i);
        P.fill(x, P.polyShape([[m.x - 14, 74], [m.x + 14, 74], [m.x + 26, 104], [m.x - 26, 104]]), PAL.gold, { edge: 3, lw: 2.6, seed: 460 + i, shade: [8, 0, 0.5] });
        P.fill(x, P.rect(m.x - 12, 30, 24, 14), m.col, { edge: 2, lw: 2, seed: 465 + i });
      }
    }

    function title(x, b) {
      const a = prog(b, 0.3, 0.75, E.out) * (1 - prog(b, 0.95, 1.2));
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

    // 收发室（一楼左）：lyjw 的纸飞机从窗外飞进来，协调的 Claude 读完，把胶囊塞进红管。
    const RED_PTS = [[sM.x(1480), sM.y(585)], [sM.x(1480), -1246], [sW.x(380), -1246], [sW.x(380), sW.y(320)]];
    const COORD = [sM.x(900), sM.y(700)];
    function mailRoom(Ly, b, v) {
      const { x, d, g } = Ly;
      if (!sees(v, ROOMS.mail)) return;
      const S = sM, u = S.s(1);
      P.fill(x, box(S, 90, 160, 610, 620), PAL.woodD, { edge: 8, lw: 3.4, seed: 701, shadow: [14, 18, 0.35] });
      P.fill(x, box(S, 112, 176, 588, 236), PAL.wood, { edge: 4, lw: 2.6, seed: 702 });
      T(x, tr("ch08.memory"), S.x(350), S.y(222), { size: S.s(44), color: PAL.cream, align: "center" });
      ["ch08.mem1", "ch08.mem2", "ch08.mem3"].forEach((key, j) => {
        const t = 1.6 + j * 0.15, r = prog(b, t, t + 0.15), pop = 10 * impact(b, t, 0.15);
        const y0 = 250 + j * 120;
        P.fill(x, box(S, 110, y0 - pop, 590, y0 + 104 - pop), PAL.wood, { edge: 5, lw: 2.8, seed: 703 + j, shade: [0, -10 * u, 0.4], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
        P.fill(x, P.ellipse(S.x(350), S.y(y0 + 16 - pop), S.s(18), S.s(7)), PAL.gold, { edge: 2, lw: 2, seed: 706 + j });
        P.fill(d, box(S, 134, y0 + 30 - pop, 566, y0 + 94 - pop), PAL.paper, { edge: 3, lw: 2.2, seed: 709 + j, tile: { lite: 0.3, dark: 0.06 } });
        if (r > 0) P.fill(d, P.ellipse(S.x(156), S.y(y0 + 62 - pop), S.s(7)), PAL.red, { alpha: r, edge: 2, lw: 1.6, seed: 712 + j });
        T(d, tr(key), S.x(176), S.y(y0 + 76 - pop), { size: S.s(36), reveal: r, maxW: S.s(380) });
        if (r > 0) P.halo(g, S.x(350), S.y(y0 + 60), S.s(160), 0.5 * impact(b, t, 0.25));
      });
      P.note(x, S.x(640), S.y(170), S.s(220), S.s(160), { seed: 334, tape: false, pin: true, rot: 0.025 });
      M(x, "AGENTS.md", S.x(660), S.y(240), { size: S.s(30), weight: 700, color: PAL.ink });
      T(x, tr("ch08.egg.agents"), S.x(660), S.y(302), { size: S.s(40), color: PAL.red, maxW: S.s(190) });
      P.seg(x, S.x(660), S.y(314), S.x(840), S.y(316), 3, PAL.red, 0.7, 335);
      clock(x, S.x(975), S.y(250), S.s(72), hourAt(b), 341, "SGT");
      P.fill(x, box(S, 1550, 190, 1890, 510), PAL.woodD, { edge: 6, lw: 3.4, seed: 721, shadow: [12, 16, 0.35] });
      P.fill(x, box(S, 1570, 210, 1870, 490), PAL.sky, { edge: 4, lw: 2.4, seed: 722, tile: SKYT });
      P.fill(x, P.ellipse(S.x(1800), S.y(270), S.s(34)), PAL.moon, { edge: 4, lw: 2.2, seed: 723 });
      P.fill(x, P.ellipse(S.x(1650), S.y(330), S.s(56), S.s(22)), PAL.cream, { edge: 4, lw: 2, seed: 724, line: false });
      P.seg(x, S.x(1720), S.y(210), S.x(1720), S.y(490), 10, PAL.woodD, 1, 725);
      P.seg(x, S.x(1570), S.y(350), S.x(1870), S.y(350), 10, PAL.woodD, 1, 726);
      P.fill(x, box(S, 1530, 500, 1910, 520), PAL.wood, { edge: 3, lw: 2.4, seed: 727 });
      // 桌子、铭牌、一罐 token。
      P.fill(x, box(S, 720, 700, 1260, 728), PAL.wood, { edge: 4, lw: 3, seed: 731, shadow: [0, 14, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      P.fill(x, box(S, 740, 728, 1240, 820), PAL.woodD, { edge: 5, lw: 3, seed: 732 });
      for (const lx of [752, 1228]) P.fill(x, box(S, lx - 12, 820, lx + 12, 953), PAL.woodD, { edge: 3, lw: 2.6, seed: 733 + lx });
      P.note(x, S.x(860), S.y(742), S.s(260), S.s(62), { seed: 735, tape: false, color: PAL.gold });
      T(x, tr("ch08.chat"), S.x(990), S.y(786), { size: S.s(40), align: "center", maxW: S.s(240) });
      const jx = S.x(1140), jy = S.y(590), jw = S.s(110), jh = S.s(110);
      for (let i = 0; i < 12; i++) P.coin(x, jx + S.s(18 + (i % 4) * 24 + K.hash(i * 5.3) * 5), S.y(690 - Math.floor(i / 4) * 18 - K.hash(i * 2.9) * 3), S.s(10), PAL.gold, 1, 740 + i);
      const jar = P.rrect(jx, jy, jw, jh, S.s(14));
      x.save(); x.globalAlpha = 0.3; x.fillStyle = PAL.sky; x.fill(jar.path); x.restore();
      P.contour(x, jar.pts, { color: PAL.line, w: 3, seed: 316 });
      P.fill(x, P.rect(jx + S.s(6), jy + S.s(30), jw - S.s(12), S.s(36)), PAL.cream, { edge: 3, lw: 2, seed: 318, tile: { lite: 0.2, dark: 0.08 } });
      M(x, "tokens", jx + jw / 2, jy + S.s(56), { size: S.s(28), weight: 600, color: PAL.ink, align: "center", maxW: jw - S.s(4) });
      P.fill(x, P.rect(jx - S.s(6), jy - S.s(18), jw + S.s(12), S.s(20)), PAL.woodD, { edge: 3, lw: 2.2, seed: 319 });
      // 三根管的收口：界面、文档那两条线程早就开了，#308 这根等协调的 Claude 塞胶囊。
      for (const [sx, col, tag, ty, on] of [[1300, UI_C, "ch08.t.ui", 330, 1], [1390, DOCS_C, "ch08.t.docs", 400, 1], [1480, PR_C, "#308", 330, prog(b, AT.plug[1], AT.plug[1] + 0.05)]]) {
        if (col !== PR_C) tube(x, [[S.x(sx), S.y(560)], [S.x(sx), -1300]], col, 1);
        P.fill(x, box(S, sx - 34, 560, sx + 34, 640), PAL.gold, { edge: 4, lw: 3, seed: 750 + sx, shade: [10 * u, 0, 0.5] });
        P.fill(x, P.ellipse(S.x(sx), S.y(590), S.s(20), S.s(12)), PAL.line, { edge: 0, lw: 2, seed: 751 + sx, flat: true });
        bulb(x, g, S.x(sx), S.y(500), S.s(12), on, 1, 752 + sx);
        if (col === PR_C && on > 0) P.halo(g, S.x(sx), S.y(500), S.s(110), impact(b, AT.plug[1], 0.25));
        P.note(d, S.x(sx - 42), S.y(ty), S.s(84), S.s(50), { seed: 753 + sx, tape: false, rot: col === DOCS_C ? 0.04 : -0.03, alpha: col === PR_C ? on : 1 });
        if (tag.startsWith("ch08.")) T(d, tr(tag), S.x(sx), S.y(ty + 38), { size: S.s(32), align: "center", maxW: S.s(76) });
        else M(d, tag, S.x(sx), S.y(ty + 36), { size: S.s(28), weight: 600, color: PAL.red, align: "center", alpha: on, maxW: S.s(80) });
      }
      // lyjw 的纸飞机：从窗外飞进来，展开成一张便签贴在墙上。
      const pk = prog(b, AT.slip[0], AT.slip[1], E.io), ok = prog(b, AT.slip[1] - 0.04, AT.slip[1] + 0.06, E.outBack);
      if (pk > 0 && pk < 1) {
        const px = lerp(S.x(2050), S.x(980), pk), py = lerp(S.y(260), S.y(430), pk) - S.s(120) * Math.sin(Math.PI * pk);
        x.save(); x.translate(px, py); x.rotate(-0.2 + 0.5 * pk + 0.15 * Math.sin(pk * 9));
        const s = S.s(1) * (1 - 0.3 * clamp((pk - 0.85) / 0.15));
        P.fill(x, P.polyShape([[-60 * s, 0], [50 * s, -12 * s], [-36 * s, -26 * s]]), PAL.paper, { edge: 3, lw: 2.4, seed: 761 });
        P.fill(x, P.polyShape([[-60 * s, 0], [50 * s, -12 * s], [-20 * s, 18 * s]]), PAL.cream, { edge: 3, lw: 2.4, seed: 762, shade: [0, -4 * s, 0.5] });
        x.restore();
      }
      if (ok > 0) {
        const f = P.FONT.hand(S.s(44)), w = measure(d, tr("ch08.slip"), f) + S.s(56);
        P.note(d, S.x(640), S.y(390), w, S.s(96), { sy: ok, alpha: clamp(ok * 3), seed: 31, color: PAL.sticky, tape: true, rot: 0.015 });
        if (ok > 0.9) T(d, tr("ch08.slip"), S.x(668), S.y(452), { size: S.s(44) });
        T(x, "lyjw", S.x(640), S.y(374), { size: S.s(40), color: PAL.ink, alpha: prog(b, AT.slip[1], AT.slip[1] + 0.08) });
      }
    }
    function capsuleRun(Ly, b) {
      const { x, g } = Ly;
      tube(x, [[RED_PTS[0][0], sM.y(560)], ...RED_PTS.slice(1)], PR_C, 1);
      const [nx, ny] = RED_PTS[3];
      P.fill(x, P.polyShape([[nx - 24, ny - 6], [nx + 24, ny - 6], [nx + 40, ny + 40], [nx - 40, ny + 40]]), PAL.gold, { edge: 3, lw: 2.6, seed: 771, shade: [8, 0, 0.5] });
      const L = K.pathLen(RED_PTS), len = 70, r = 15;
      if (b >= AT.plug[0] - 0.08 && b < AT.plug[0]) {
        const hx = COORD[0] + 70, hy = COORD[1] - 76;
        capsule(x, hx, hy, len, r, PR_C, -0.3, prog(b, AT.plug[0] - 0.08, AT.plug[0] - 0.03), 772);
      } else if (b >= AT.plug[0] && b < AT.plug[1]) {
        const k = E.io(prog(b, AT.plug[0], AT.plug[1]));
        const hx = COORD[0] + 70, hy = COORD[1] - 76, [tx, ty] = RED_PTS[0];
        capsule(x, lerp(hx, tx, k), lerp(hy, ty, k) - 260 * 4 * k * (1 - k), len, r, PR_C, -0.3 + k * 5, 1, 772);
      } else if (b >= AT.plug[1] && b < AT.fork[0]) {
        const k = E.io(prog(b, AT.plug[1], 2.95)), p0 = K.pathAt(RED_PTS, k * L), p1 = K.pathAt(RED_PTS, Math.min(L, k * L + 4));
        capsule(x, p0[0], p0[1], len, r, PR_C, Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) || 0, 1, 772);
        P.halo(g, p0[0], p0[1], 80, 0.4);
      }
    }

    // 工作间（一楼右）：胶囊从管口弹到工作台上，#308 的 Clawd 从里面钻出来，打出第一个提交，墙上的本地门禁一盏盏亮。
    const BENCH = sW.y(640), CABIN_X = sW.x(1180);
    function workRoom(Ly, b, v) {
      const { x, d, g } = Ly;
      if (!sees(v, ROOMS.work)) return;
      const S = sW, u = S.s(1);
      P.fill(x, box(S, 160, 640, 1060, 666), PAL.wood, { edge: 4, lw: 3, seed: 801, shadow: [0, 14, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      P.fill(x, box(S, 176, 666, 1044, 742), PAL.woodD, { edge: 5, lw: 3, seed: 802 });
      for (const lx of [190, 1030]) P.fill(x, box(S, lx - 12, 742, lx + 12, 953), PAL.woodD, { edge: 3, lw: 2.6, seed: 803 + lx });
      P.fill(x, box(S, 300, 676, 920, 732), PAL.gold, { edge: 3, lw: 2.4, seed: 805, shade: [0, -6 * u, 0.4] });
      M(x, "claude/project-thread-…", S.x(610), S.y(715), { size: S.s(30), weight: 600, color: PAL.ink, align: "center", alpha: prog(b, 3.3, 3.5) });
      P.fill(x, P.ellipse(S.x(210), S.y(600), S.s(16), S.s(36)), "#7fa46a", { edge: 4, lw: 2.6, seed: 336, shade: [-6 * u, 0, 0.6] });
      P.fill(x, P.rrect(S.x(222), S.y(590), S.s(20), S.s(34), S.s(9)), "#7fa46a", { edge: 3, lw: 2.2, seed: 337 });
      P.fill(x, box(S, 180, 610, 240, 640), "#c46a45", { edge: 4, lw: 2.6, seed: 338 });
      P.fill(x, P.ellipse(S.x(210), S.y(562), S.s(6)), PAL.red, { edge: 2, lw: 1.6, seed: 339 });
      // 「家 = localhost:3211」十字绣、验证员 Haiku 的「本月最佳」挂像、一杯 effort: high。
      P.fill(x, box(S, 470, 150, 1060, 270), PAL.woodD, { edge: 6, lw: 3.2, seed: 361, shadow: [12, 16, 0.35] });
      P.fill(x, box(S, 486, 166, 1044, 254), PAL.cream, { edge: 4, lw: 2.2, seed: 362, tile: { lite: 0.2, dark: 0.08, a0: 0.15, a1: 0.35 } });
      for (let i = 0; i < 20; i++) { T(x, "×", S.x(498 + i * 27), S.y(186), { size: S.s(16), color: PAL.red, texture: true }); T(x, "×", S.x(498 + i * 27), S.y(250), { size: S.s(16), color: PAL.red, texture: true }); }
      P.fill(x, P.polyShape([[S.x(504), S.y(226)], [S.x(526), S.y(206)], [S.x(548), S.y(226)]]), PAL.red, { edge: 2, lw: 2, seed: 363 });
      P.fill(x, box(S, 510, 226, 542, 244), PAL.gold, { edge: 2, lw: 2, seed: 364 });
      T(x, tr("ch08.egg.home"), S.x(562), S.y(238), { size: S.s(40), color: PAL.ink, maxW: S.s(470) });
      P.fill(x, box(S, 600, 290, 820, 480), PAL.gold, { edge: 6, lw: 3.2, seed: 391, shadow: [12, 16, 0.35] });
      P.fill(x, box(S, 616, 306, 804, 404), PAL.sky, { edge: 4, lw: 2, seed: 392 });
      P.clawd(x, { pose: "default", offset: 0 }, S.x(710), S.y(398), S.s(4.6), { shadow: false });
      P.prop(x, "magnifier", S.x(710), S.y(398), S.s(4.6));
      for (let i = 0; i < 8; i++) { const an = (i / 8) * TAU; P.fill(x, P.ellipse(S.x(778 + 11 * Math.cos(an)), S.y(330 + 11 * Math.sin(an)), S.s(7)), PAL.red, { edge: 2, lw: 1.4, seed: 393 + i }); }
      P.fill(x, P.ellipse(S.x(778), S.y(330), S.s(9)), PAL.moon, { edge: 2, lw: 1.6, seed: 401 });
      P.fill(x, box(S, 610, 410, 810, 474), PAL.wood, { edge: 3, lw: 2.4, seed: 402 });
      TL(x, tr("ch08.egg.staff"), S.x(710), S.y(452), S.s(30), { size: S.s(30), color: PAL.cream, align: "center", maxW: S.s(192) });
      const mx = S.x(930), mw = S.s(120), mh = S.s(80), my = BENCH - mh;
      x.save(); x.lineCap = "round"; x.strokeStyle = PAL.line; x.lineWidth = S.s(11); x.beginPath(); x.arc(mx + mw, my + mh * 0.48, S.s(20), -1.3, 1.3); x.stroke();
      x.strokeStyle = PAL.teal; x.lineWidth = S.s(6); x.stroke(); x.restore();
      P.fill(x, P.rrect(mx, my, mw, mh, S.s(8)), PAL.teal, { edge: 5, lw: 3, seed: 311, shade: [-12 * u, 0, 0.5] });
      M(x, "effort:", mx + mw / 2, my + S.s(34), { size: S.s(28), weight: 600, color: PAL.cream, align: "center", maxW: mw - S.s(6) });
      M(x, "high", mx + mw / 2, my + S.s(68), { size: S.s(32), weight: 700, color: PAL.moon, align: "center" });
      const tt = b * BARs;
      for (let i = 0; i < 3; i++) {
        const sx = mx + S.s(28 + i * 30), pts = [];
        for (let k = 0; k <= 8; k++) pts.push([sx + S.s(6) * Math.sin(k * 0.9 + tt * 3 + i * 2), my - S.s(10 + k * 7)]);
        P.line(x, pts, 1, 3, PAL.cream, 0.6 * (0.6 + 0.4 * Math.sin(tt * 2 + i)), 312 + i);
      }
      // 胶囊落在台上、裂成两半，Clawd 钻出来；打字机打出 f03f371。
      const fk = prog(b, AT.fork[0], AT.fork[0] + 0.1);
      if (fk > 0) {
        const open = prog(b, AT.pop308, AT.pop308 + 0.08, E.out), [nx, ny] = RED_PTS[3];
        const cx0 = lerp(nx, S.x(520), E.out(fk)), cy0 = lerp(ny + 30, BENCH - 15, fk) - S.s(80) * Math.sin(Math.PI * fk);
        const wob = 0.25 * Math.sin((b - AT.fork[0]) * BARs * 18) * impact(b, AT.fork[0] + 0.1, 0.25);
        if (open <= 0) capsule(x, cx0, cy0, 70, 15, PR_C, (1 - fk) * 3 + wob, 1, 811);
        else for (const s of [-1, 1]) {
          x.save(); x.translate(cx0 + s * 52 * open, cy0); x.rotate(s * 0.4 * open);
          x.beginPath(); x.rect(s < 0 ? -60 : 0, -30, 60, 60); x.clip();
          capsule(x, 0, 0, 70, 15, PR_C, 0, 1, 811);
          x.restore();
        }
        if (open > 0 && open < 1) P.halo(g, cx0, cy0, 120, 1 - open);
      }
      const roll = typewriter(x, S.x(790), BENCH, u, 1, 821, impact(b, AT.c1, 0.1));
      shaSlip(d, u, S.x(790), roll, "f03f371", AT.c1, b, 1, 822);
      if (b >= AT.c1) P.halo(g, S.x(790), roll - S.s(30), S.s(80), 0.6 * impact(b, AT.c1, 0.2));
      // 本地门禁：五盏灯，这次只跑了前四样，build 没跑、在睡觉。
      P.fill(x, box(S, 1320, 150, 1840, 610), "#4f5f5c", { edge: 8, lw: 3.4, seed: 831, shadow: [14, 18, 0.35], tile: { lite: 0.25, dark: 0.25 } });
      const pa = prog(b, AT.card, AT.card + 0.1);
      T(x, tr("ch08.gates"), S.x(1350), S.y(210), { size: S.s(40), color: PAL.cream, alpha: lerp(0.5, 1, pa) });
      P.seg(x, S.x(1346), S.y(230), S.x(1814), S.y(232), 2.6, PAL.moon, 0.7, 832);
      ["docs:check", "typecheck", "test", "eslint", "build"].forEach((name, j) => {
        const y = 284 + j * 62, t = AT.gates[j], on = t !== undefined ? prog(b, t, t + 0.06) : 0;
        bulb(x, d, S.x(1372), S.y(y), S.s(13), on, 1, 833 + j);
        if (on > 0) P.halo(d, S.x(1372), S.y(y), S.s(70), 0.5 * impact(b, t, 0.25));
        M(x, name, S.x(1406), S.y(y + 11), { size: S.s(32), color: t === undefined ? "#a9b3ad" : PAL.cream, alpha: t === undefined ? 0.75 : lerp(0.6, 1, on) });
      });
      const zx = S.x(1540), zy = S.y(284 + 4 * 62 + 12);
      P.clawd(x, { pose: "default", offset: 0 }, zx, zy, S.s(2.2), { alpha: 0.85, shadow: false, sleep: true });
      zzz(x, zx + S.s(14), zy - S.s(28), S.s(3), b, 1);
      T(x, tr("ch08.gatesNote"), S.x(1350), S.y(588), { size: S.s(30), color: PAL.moon, alpha: prog(b, 4.8, 4.9), maxW: S.s(470) });
    }
    // 小电梯：工作间到评审室，#308 的 Clawd 坐它上楼。
    const cabinBottom = (b) => keys(b, [[5.0, BENCH], [5.15, sR.y(640), E.io]]);
    function lift(Ly, b, v) {
      const { x } = Ly;
      const x0 = sW.x(1110), x1 = sW.x(1250);
      if (!sees(v, { x0, x1, y0: -2600, y1: -80 })) return;
      for (const lx of [x0, x1]) P.seg(x, lx, -2600, lx, -80, 6, PAL.woodD, 0.9, 841 + lx);
      for (let y = -2560; y < -80; y += 120) P.seg(x, x0, y, x1, y + 40, 2, PAL.woodD, 0.35, 843 + y);
      const cb = cabinBottom(b), ch = 170;
      P.fill(x, P.ellipse((x0 + x1) / 2, -2570, 22), PAL.gold, { edge: 3, lw: 2.4, seed: 845 });
      P.seg(x, (x0 + x1) / 2, -2570, (x0 + x1) / 2, cb - ch, 3, PAL.line, 0.9, 846);
      P.fill(x, P.rect(x0 + 6, cb - ch, x1 - x0 - 12, ch), "#5b4752", { edge: 4, lw: 3, seed: 847, tile: { lite: 0.1, dark: 0.3 } });
      P.contour(x, [[x0 + 6, cb - ch], [x1 - 6, cb - ch], [x1 - 6, cb], [x0 + 6, cb]], { color: PAL.gold, w: 6, seed: 848 });
      P.fill(x, P.rect(x0 + 6, cb - ch - 14, x1 - x0 - 12, 16), PAL.gold, { edge: 2, lw: 2.2, seed: 849 });
    }

    // 评审室（二楼右）：PR #308 的海报立在画架上，机器评审的信从天花板的信槽里一封封掉到看板上。
    const BOTS = [["Codex", "f"], ["Devin", "f"], ["Codex", "f"], ["Devin", "r"], ["Codex", "f"], ["Claude review", null]];
    const DESK_R = sR.y(700);
    function revRoom(Ly, b, v) {
      const { x, d, g } = Ly;
      if (!sees(v, ROOMS.rev)) return;
      const S = sR, u = S.s(1);
      const str = [], bx0 = S.x(0), bx1 = S.x(1240), by = S.y(112), sag = S.s(30);
      for (let i = 0; i <= 30; i++) { const k = i / 30; str.push([lerp(bx0, bx1, k), by + sag * 4 * k * (1 - k)]); }
      P.line(x, str, 1, 3, PAL.line, 0.8, 371);
      const cols = [PAL.red, PAL.gold, PAL.teal, PAL.cream];
      for (let i = 0; i < 14; i++) {
        const k = (i + 0.5) / 14, fx = lerp(bx0, bx1, k), fy = by + sag * 4 * k * (1 - k);
        P.fill(x, P.polyShape([[fx - S.s(24), fy], [fx + S.s(24), fy], [fx + S.s(2), fy + S.s(52)]]), cols[i % 4], { edge: 4, lw: 2.2, seed: 372 + i });
      }
      for (const [lx0, lx1] of [[160, 120], [620, 660], [390, 390]]) P.seg(x, S.x(lx0), S.y(200), S.x(lx1), S.y(953), 10, PAL.woodD, 1, 901 + lx0);
      P.fill(x, box(S, 70, 570, 710, 590), PAL.wood, { edge: 3, lw: 2.4, seed: 904 });
      const pk = prog(b, AT.pr - 0.1, AT.pr + 0.06, E.outBack);
      P.note(d, S.x(80), S.y(190), S.s(620), S.s(370), { seed: 905, rot: -0.01, sy: Math.max(0.05, pk), alpha: clamp(pk * 3 + 0.2) });
      if (pk > 0.9) {
        M(d, "PR #308", S.x(110), S.y(236), { size: S.s(28), weight: 600, color: PAL.soft });
        M(d, "fix(collector):", S.x(110), S.y(288), { size: S.s(32), weight: 600 });
        T(d, "PageSpeed 两端各算各的，放宽超时", S.x(110), S.y(340), { size: S.s(34), maxW: S.s(560) });
        M(d, "claude/project-thread-… → main", S.x(110), S.y(388), { size: S.s(28), color: PAL.soft, maxW: S.s(560) });
        P.seg(d, S.x(100), S.y(414), S.x(680), S.y(416), 2.6, PAL.red, 0.7, 906);
        const ci = prog(b, AT.ci, AT.ci + 0.06);
        P.tick(d, S.x(128), S.y(462), S.s(28), ci, 1);
        M(d, "CI · check", S.x(162), S.y(474), { size: S.s(30), alpha: lerp(0.6, 1, ci) });
        M(d, "Codex · Devin · Claude review", S.x(110), S.y(530), { size: S.s(28), color: PAL.soft, alpha: prog(b, AT.slip0, AT.slip0 + 0.1), maxW: S.s(560) });
      }
      P.fill(x, box(S, 940, 300, 1090, 316), PAL.wood, { edge: 3, lw: 2.2, seed: 911 });
      alarm(x, g, S.x(1015), S.y(262), S.s(28), b, 912);
      P.fill(x, box(S, 730, 700, 1090, 726), PAL.wood, { edge: 4, lw: 3, seed: 921, shadow: [0, 14, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      for (const lx of [744, 1076]) P.fill(x, box(S, lx - 11, 726, lx + 11, 953), PAL.woodD, { edge: 3, lw: 2.6, seed: 922 + lx });
      const roll = typewriter(x, S.x(970), DESK_R, u, 1, 925, Math.max(impact(b, AT.c2, 0.1), impact(b, AT.c3, 0.1)));
      // 第二张纸条打出来时，上一张撕下来钉到墙上。
      const pin = prog(b, AT.c3, AT.c3 + 0.1, E.io);
      if (b >= AT.c2) {
        if (pin <= 0) shaSlip(d, u, S.x(970), roll, "065aa93", AT.c2, b, 1, 926);
        else {
          const px = lerp(S.x(970), S.x(830), pin), py = lerp(roll - S.s(64), S.y(380), pin);
          P.note(d, px - S.s(88), py, S.s(176), S.s(64), { seed: 926, tape: false, pin: pin > 0.8, rot: -0.05 * pin });
          M(d, "065aa93", px, py + S.s(44), { size: S.s(34), weight: 600, align: "center" });
        }
      }
      shaSlip(d, u, S.x(970), roll, "f6ef255", AT.c3, b, 1, 927);
      for (const t of [AT.c2, AT.c3]) if (b >= t) P.halo(g, S.x(970), roll - S.s(30), S.s(80), 0.6 * impact(b, t, 0.2));
      P.fill(x, box(S, 1450, 101, 1660, 118), PAL.line, { edge: 0, lw: 2, seed: 931, flat: true });
      P.fill(x, box(S, 1262, 130, 1848, 610), PAL.woodD, { edge: 8, lw: 3.4, seed: 932, shadow: [14, 18, 0.35] });
      P.fill(x, box(S, 1278, 146, 1832, 594), "#c9985f", { edge: 10, lw: 2.4, seed: 933, tile: { w: 4, len: 18, dens: 1.5, jit: 0.9 } });
      T(x, tr("ch08.reviews"), S.x(1300), S.y(190), { size: S.s(34), color: PAL.cream, alpha: prog(b, AT.slip0 - 0.1, AT.slip0) });
      BOTS.forEach(([name, mark], i) => {
        const t = AT.slip0 + AT.slipStep * i, fk = prog(b, t - 0.1, t, E.in);
        if (fk <= 0) return;
        const y0 = 206 + i * 64, ry = lerp(110, y0, fk), rot = (1 - fk) * 0.4 * (i % 2 ? -1 : 1);
        const cx = S.x(1555), cy = S.y(ry + 28);
        d.save(); d.translate(cx, cy); d.rotate(rot + ((i % 3) - 1) * 0.01); d.translate(-cx, -cy);
        P.note(d, S.x(1288), S.y(ry), S.s(534), S.s(54), { seed: 941 + i, color: mark ? PAL.sticky : PAL.paper, tape: false });
        M(d, name, S.x(1308), S.y(ry + 38), { size: S.s(28), weight: 600 });
        if (!mark) M(d, "No issues found", S.x(1808), S.y(ry + 38), { size: S.s(28), color: PAL.soft, align: "right" });
        else {
          const mk = prog(b, t + 0.125, t + 0.2);
          if (mk > 0) {
            const fixed = mark === "f";
            if (fixed) P.tick(d, S.x(1700), S.y(ry + 26), S.s(26), mk, 1);
            T(d, tr(fixed ? "ch08.fixed" : "ch08.replied"), S.x(1808), S.y(ry + 40), { size: S.s(32), color: fixed ? PAL.red : PAL.soft, align: "right", alpha: mk });
            if (fixed) P.halo(g, S.x(1760), S.y(ry + 26), S.s(60), 0.5 * impact(b, t + 0.125, 0.2));
          }
        }
        d.restore();
        // 回了理由的那条，回信折成纸飞机从信槽飞回去。
        if (mark === "r") {
          const ak = prog(b, t + 0.15, t + 0.4, E.io);
          if (ak > 0 && ak < 1) {
            const px = lerp(S.x(1700), S.x(1555), ak), py = lerp(S.y(y0), S.y(110), ak) - S.s(60) * Math.sin(Math.PI * ak);
            d.save(); d.translate(px, py); d.rotate(-1.2 * ak);
            P.fill(d, P.polyShape([[-S.s(30), 0], [S.s(26), -S.s(6)], [-S.s(18), -S.s(14)]]), PAL.cream, { edge: 2, lw: 2, seed: 951 });
            d.restore();
          }
        }
      });
      T(x, tr("ch08.codex3"), S.x(1290), S.y(656), { size: S.s(32), color: PAL.ink, alpha: prog(b, AT.slip0 + AT.slipStep * 4, AT.slip0 + AT.slipStep * 4 + 0.1) });
    }
    // 04:00 代码审查的闹钟：夜里那一刻响。
    function alarm(x, g, cx, cy, r, b, seed) {
      const ring = impact(b, AT.night[3], 0.3), t = b * BARs;
      x.save(); x.translate(cx, cy); x.rotate(0.12 * Math.sin(t * 60) * ring);
      for (const s of [-1, 1]) { P.seg(x, s * r * 0.6, r * 0.7, s * r * 0.9, r * 1.3, r * 0.14, PAL.line, 1, seed + s); P.fill(x, P.ellipse(s * r * 0.7, -r * 1.0, r * 0.42, r * 0.32), PAL.gold, { edge: 2, lw: 2, seed: seed + 2 + s }); }
      P.fill(x, P.ellipse(0, 0, r), PAL.red, { edge: r * 0.15, lw: 2.6, seed: seed + 5 });
      P.fill(x, P.ellipse(0, 0, r * 0.74), PAL.cream, { edge: 2, lw: 1.8, seed: seed + 6, tile: { lite: 0.2, dark: 0.08 } });
      P.seg(x, 0, 0, r * 0.34, r * 0.18, r * 0.1, PAL.ink, 1, seed + 7);
      P.seg(x, 0, 0, 0, -r * 0.56, r * 0.08, PAL.ink, 1, seed + 8);
      x.restore();
      if (ring > 0.05) { for (const s of [-1, 1]) P.line(x, [[cx + s * r * 1.5, cy - r * 0.8], [cx + s * r * 1.75, cy], [cx + s * r * 1.5, cy + r * 0.8]], 1, r * 0.12, PAL.red, ring, seed + 9 + s); P.halo(g, cx, cy, r * 5, ring); }
    }

    // 实验室（二楼左）：Haiku 顺着一根线从天花板吊下来，四只烧瓶一只只变绿，打印机吐出验证回执。
    const SHA_F6 = "f6ef255950c37c2b810cf06aba2f653ca22bd9c7";
    const DESK_L = sL.y(640), HAIKU = [sL.x(390), sL.y(520)];
    function labRoom(Ly, b, v) {
      const { x, d, g, s } = Ly;
      if (!sees(v, ROOMS.lab)) return;
      const S = sL, u = S.s(1), t = b * BARs;
      P.fill(x, box(S, 30, 330, 950, 352), PAL.wood, { edge: 3, lw: 2.6, seed: 1001, shadow: [0, 12, 0.3] });
      for (const bx of [80, 900]) P.fill(x, P.polyShape([[S.x(bx - 12), S.y(352)], [S.x(bx + 12), S.y(352)], [S.x(bx + 12), S.y(400)]]), PAL.woodD, { edge: 2, lw: 2.2, seed: 1002 + bx });
      ["collector test", "typecheck", "eslint", "docs:check"].forEach((name, j) => {
        const cx = 150 + j * 220, on = prog(b, AT.tests[j], AT.tests[j] + 0.06);
        const liquid = on > 0.5 ? "#8fc28a" : "#b8c4d4";
        P.fill(x, box(S, cx - 16, 176, cx + 16, 238), PAL.cream, { alpha: 0.9, edge: 2, lw: 2.4, seed: 1010 + j });
        P.fill(x, P.ellipse(S.x(cx), S.y(280), S.s(54), S.s(50)), PAL.cream, { alpha: 0.9, edge: 3, lw: 2.6, seed: 1014 + j });
        x.save(); x.beginPath(); x.ellipse(S.x(cx), S.y(280), S.s(52), S.s(48), 0, 0, TAU); x.clip();
        P.fill(x, box(S, cx - 60, 268 - 8 * Math.sin(t * 2 + j), cx + 60, 332), liquid, { edge: 0, lw: 1, seed: 1018 + j, line: false });
        x.restore();
        if (on > 0) for (let i = 0; i < 4; i++) {
          const ph = (t * 0.8 + i / 4 + j * 0.3) % 1;
          P.contour(x, P.ellipse(S.x(cx - 20 + i * 13), S.y(300 - ph * 130), S.s(5 + 3 * ph)).pts, { color: "#5f8f5a", w: 2, alpha: on * Math.sin(Math.PI * ph), seed: 1022 + i, corners: false });
        }
        P.fill(x, box(S, cx - 22, 170, cx + 22, 182), PAL.woodD, { edge: 2, lw: 2, seed: 1026 + j });
        if (on > 0) { P.tick(x, S.x(cx), S.y(282), S.s(34), on, 1); P.halo(g, S.x(cx), S.y(280), S.s(110), 0.6 * impact(b, AT.tests[j], 0.25)); }
        const f = K.FONT.mono(S.s(28), 500), tw = measure(d, name, f) + S.s(24);
        P.note(d, S.x(cx) - tw / 2, S.y(370), tw, S.s(44), { seed: 1030 + j, tape: false, rot: (j % 2 ? 0.02 : -0.02) });
        M(d, name, S.x(cx), S.y(402), { size: S.s(28), align: "center", alpha: lerp(0.6, 1, on) });
      });
      P.note(d, S.x(40), S.y(430), S.s(180), S.s(48), { seed: 1035, tape: false, color: PAL.sticky, rot: -0.02 });
      M(d, "f6ef255", S.x(130), S.y(464), { size: S.s(30), weight: 600, align: "center" });
      // 显示器：打 verify-receipt 的命令，结果亮出来。
      P.fill(x, box(S, 40, 700, 780, 726), PAL.wood, { edge: 4, lw: 3, seed: 1041, shadow: [0, 14, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      for (const lx of [56, 764]) P.fill(x, box(S, lx - 11, 726, lx + 11, 953), PAL.woodD, { edge: 3, lw: 2.6, seed: 1042 + lx });
      P.fill(x, box(S, 380, 680, 460, 700), PAL.woodD, { edge: 2, lw: 2.2, seed: 1044 });
      P.fill(x, box(S, 60, 520, 760, 684), "#4c4a5e", { edge: 6, lw: 3.2, seed: 1045, shadow: [10, 14, 0.35] });
      P.fill(x, box(S, 76, 534, 744, 670), PAL.night, { edge: 4, lw: 2.2, seed: 1046, tile: { lite: 0.1, dark: 0.2 } });
      const ck = prog(b, AT.check[0], AT.check[1]), cmd = "$ verify-receipt.ts check --pr 308";
      if (ck > 0) M(x, cmd.slice(0, Math.ceil(ck * cmd.length)), S.x(96), S.y(588), { size: S.s(28), color: PAL.cream });
      else if (b > AT.haiku[1]) M(x, (t % 1) < 0.5 ? "$ _" : "$", S.x(96), S.y(588), { size: S.s(28), color: PAL.cream, alpha: 0.8 });
      const ex = prog(b, AT.exact, AT.exact + 0.06), la = prog(b, AT.check[1], AT.check[1] + 0.05);
      if (la > 0) {
        P.fill(x, P.ellipse(S.x(110), S.y(630), S.s(11)), ex > 0.5 ? PAL.moon : PAL.soft, { alpha: la, edge: 2, lw: 1.6, seed: 1047 });
        if (ex > 0) P.halo(g, S.x(110), S.y(630), S.s(50), ex);
        M(x, '"coverage": "exact", "pass": true', S.x(134), S.y(640), { size: S.s(28), weight: 600, color: PAL.moon, alpha: ex });
      }
      // 打印机和回执：纸从打印机里往上卷出来。
      P.fill(x, box(S, 980, 640, 1740, 666), PAL.wood, { edge: 4, lw: 3, seed: 1051, shadow: [0, 14, 0.3], tile: { w: 5, len: 60, ang: -0.05, jit: 0.04 } });
      for (const lx of [994, 1726]) P.fill(x, box(S, lx - 11, 666, lx + 11, 953), PAL.woodD, { edge: 3, lw: 2.6, seed: 1052 + lx });
      const rk = prog(b, AT.receipt, AT.receipt + 0.12, E.out), top = lerp(570, 150, rk);
      if (rk > 0) {
        P.fill(d, box(S, 1010, top, 1520, 572), PAL.cream, { edge: 5, lw: 2.6, seed: 1053, shadow: [10, 14, 0.35], tile: { lite: 0.4, dark: 0.08, a0: 0.2, a1: 0.5 } });
        d.save(); d.beginPath(); d.rect(S.x(1000), S.y(top), S.s(530), S.s(572 - top)); d.clip();
        const L = (sy) => S.y(sy);
        T(d, tr("ch08.receipt"), S.x(1036), L(206), { size: S.s(38) });
        M(d, SHA_F6, S.x(1036), L(240), { size: S.s(19), color: PAL.soft, texture: true, maxW: S.s(460) });
        T(d, tr("ch08.paste"), S.x(1036), L(286), { size: S.s(30), color: PAL.red, alpha: prog(b, AT.receipt + 0.1, AT.receipt + 0.2), maxW: S.s(460) });
        P.seg(d, S.x(1026), L(380), S.x(1504), L(382), 2.4, PAL.ink, 0.6, 1054);
        T(d, tr("ch08.evidence"), S.x(1036), L(424), { size: S.s(30), maxW: S.s(460) });
        M(d, "typecheck · eslint", S.x(1036), L(464), { size: S.s(28), color: PAL.soft });
        M(d, "docs:check", S.x(1036), L(500), { size: S.s(28), color: PAL.soft });
        T(d, tr("ch08.verifier"), S.x(1036), L(548), { size: S.s(30), maxW: S.s(460) });
        d.restore();
      }
      stamp(s, "unit-test-verified", S.x(1265), S.y(336), { k: prog(b, AT.level, AT.level + 0.14), px: S.s(28), rot: -0.05, color: P.lead(PAL.red) });
      P.halo(g, S.x(1265), S.y(336), S.s(160), 0.5 * impact(b, AT.level, 0.3));
      P.fill(x, box(S, 1000, 570, 1530, 640), "#8a8fa0", { edge: 5, lw: 3, seed: 1055, shade: [0, -10 * u, 0.4] });
      P.fill(x, box(S, 1020, 566, 1510, 580), PAL.line, { edge: 0, lw: 2, seed: 1056, flat: true });
      P.fill(x, P.ellipse(S.x(1490), S.y(610), S.s(9)), rk > 0 ? PAL.moon : PAL.soft, { edge: 2, lw: 1.6, seed: 1057 });
      // 档位表：哪些算通过、哪些不算。
      const lk = prog(b, AT.receipt + 0.1, AT.level);
      P.note(d, S.x(1545), S.y(120), S.s(370), S.s(420), { seed: 1061, tape: true, rot: -0.01, alpha: lerp(0.85, 1, lk) });
      T(d, tr("ch08.passing"), S.x(1565), S.y(172), { size: S.s(32) });
      [["live-ui-verified", 1], ["unit-test-verified", 1], ["type-check-only", 1], null, ["verifier-blocked", 0], ["verifier-failed", 0]].forEach((r, j) => {
        const y = S.y(226 + j * 52);
        if (!r) { T(d, tr("ch08.notPassing"), S.x(1565), y + S.s(8), { size: S.s(32), color: PAL.soft }); return; }
        const hot = r[0] === "unit-test-verified" ? prog(b, AT.rung, AT.rung + 0.06) : 0, c = hot > 0 ? PAL.red : r[1] ? PAL.ink : PAL.soft;
        P.seg(d, S.x(1562), y - S.s(10), S.x(1580), y - S.s(10), 3, c, 1, 1062 + j);
        M(d, r[0], S.x(1588), y, { size: S.s(28), weight: hot > 0 ? 700 : 500, color: c });
        if (hot > 0) P.halo(g, S.x(1572), y - S.s(10), S.s(60), 0.6 * hot * (0.6 + 0.4 * impact(b, AT.rung, 0.3)));
      });
    }
    function haiku(Ly, b) {
      const { x, tp } = Ly;
      if (b < AT.haiku[0] || b > AT.bye + 0.32) return;
      const down = prog(b, AT.haiku[0], AT.haiku[1], E.out), up = prog(b, AT.bye, AT.bye + 0.3, E.in);
      const y = lerp(lerp(-2600, HAIKU[1], down), -2600, up), q = 5.5;
      P.seg(x, HAIKU[0], -2600, HAIKU[0], y - 12 * q, 2, PAL.line, 0.8, 1071);
      const st = { x: HAIKU[0], y, air: down < 1 || up > 0, landT: AT.haiku[1] };
      const fr = st.air ? { pose: "arms-up", offset: 0 } : pose(st, b, seqAt(b, [["look", AT.tests[0] - 0.05], ["celebrate", AT.exact]]));
      crew(tp, st, fr, q, 1 - prog(b, AT.bye + 0.22, AT.bye + 0.3), { prop: "magnifier" });
    }

    // 屋顶：三条线程的胶囊各进一只阀门，按改动大小分三档开；判定员坐在高脚凳上。
    const ROOF_S = 819;
    const VALVES = [
      { c: 470, col: DOCS_C, label: "ch08.g1", tag: "ch08.t.docs", arrive: 10.8, open: AT.g1 },
      { c: 1040, col: PR_C, label: "ch08.g2", tag: "#308", arrive: 10.9, open: AT.g2 },
      { c: 1610, col: UI_C, label: "ch08.g3", tag: "ch08.t.ui", arrive: 11.0, open: AT.g3 },
    ];
    function roof(Ly, b, v) {
      const { x, d, g, s, tp } = Ly;
      if (!sees(v, { x0: sF.x(0), x1: sF.x(1920), y0: sF.y(0), y1: ROOFY })) return;
      const S = sF, u = S.s(1);
      // 飞艇拖着「禁止手跑 wrangler deploy」横幅。
      const bd = S.s(18) * (b - 10.9), ba = 1 - prog(b, 15.9, 16.1);
      if (ba > 0) {
        const bx = S.x(300) + bd, by = S.y(130);
        P.seg(x, bx + S.s(200), by, S.x(540) + bd, S.y(140), 3, PAL.line, ba, 1101);
        P.fill(x, P.ellipse(bx, by, S.s(210), S.s(66)), PAL.gold, { alpha: ba, edge: 10 * u, lw: 3, seed: 1102, shade: [0, -20 * u, 0.5] });
        for (const k of [-0.4, 0, 0.4]) P.contour(x, P.ellipse(bx + k * S.s(150), by, S.s(30), S.s(62)).pts, { color: PAL.red, w: 3, alpha: ba * 0.7, seed: 1103, corners: false });
        P.fill(x, P.polyShape([[bx - S.s(200), by], [bx - S.s(260), by - S.s(56)], [bx - S.s(250), by + S.s(50)]]), PAL.red, { alpha: ba, edge: 4, lw: 2.6, seed: 1104 });
        x.save(); x.translate(bd, 0);
        P.fill(x, box(S, 270, 196, 340, 220), PAL.woodD, { alpha: ba, edge: 2, lw: 2.2, seed: 1105 });
        P.fill(x, box(S, 540, 92, 990, 196), "#f2c94c", { alpha: ba, edge: 6, lw: 3, seed: 1106, tile: { lite: 0.3, dark: 0.1 } });
        T(x, tr("ch08.egg.deploy"), S.x(765), S.y(140), { size: S.s(42), color: PAL.red, align: "center", alpha: ba, maxW: S.s(420) });
        M(x, "wrangler deploy", S.x(765), S.y(182), { size: S.s(32), weight: 700, color: PAL.ink, align: "center", alpha: ba });
        P.seg(x, S.x(620), S.y(172), S.x(910), S.y(172), 5, PAL.red, 0.85 * ba, 1107);
        x.restore();
      }
      // 「基线只减不增」告示牌、天线和挂在天线杆上的钟。
      P.seg(x, S.x(180), S.y(760), S.x(180), S.y(ROOF_S), 10, PAL.woodD, 1, 1111);
      P.fill(x, box(S, 60, 600, 300, 760), PAL.cream, { edge: 5, lw: 3, seed: 1112, shadow: [10, 14, 0.35], tile: { lite: 0.2, dark: 0.08 } });
      TL(x, tr("ch08.egg.baseline"), S.x(180), S.y(650), S.s(36), { size: S.s(34), color: PAL.ink, align: "center", maxW: S.s(220) });
      P.line(x, [[S.x(90), S.y(700)], [S.x(130), S.y(708)], [S.x(170), S.y(718)], [S.x(210), S.y(722)], [S.x(250), S.y(736)], [S.x(276), S.y(740)]], 1, 4, PAL.red, 0.9, 1113);
      P.seg(x, S.x(1820), S.y(ROOF_S), S.x(1820), S.y(160), 12, PAL.woodD, 1, 1114);
      for (const [y, w] of [[200, 70], [250, 50], [160, 90]]) P.seg(x, S.x(1820 - w), S.y(y), S.x(1820 + w), S.y(y), 6, PAL.woodD, 1, 1115 + y);
      P.fill(x, P.ellipse(S.x(1820), S.y(150), S.s(12)), PAL.red, { edge: 2, lw: 2, seed: 1118 });
      clock(x, S.x(1820), S.y(300), S.s(50), hourAt(b), 1121, "SGT");
      // 三只阀门。
      for (const vl of VALVES) {
        const c = vl.c, ok = prog(b, vl.open, vl.open + 0.1, E.io);
        tube(x, [[S.x(c), S.y(ROOF_S)], [S.x(c), S.y(540)]], vl.col, 1, S.s(24));
        tube(x, [[S.x(c + 90), S.y(500)], [S.x(c + 130), S.y(500)], [S.x(c + 130), S.y(ROOF_S)]], vl.col, 1, S.s(24));
        P.fill(x, box(S, c - 90, 370, c + 90, 540), "#7d9aa6", { edge: 6, lw: 3.2, seed: 1130 + c, shadow: [10, 14, 0.35], shade: [-10 * u, 0, 0.4] });
        P.fill(x, box(S, c - 62, 392, c + 62, 492), PAL.sky, { alpha: 0.85, edge: 4, lw: 2.4, seed: 1131 + c });
        P.fill(x, box(S, c - 70, 500, c + 70, 532), PAL.cream, { edge: 3, lw: 2.2, seed: 1132 + c });
        if (vl.tag.startsWith("ch08.")) T(x, tr(vl.tag), S.x(c), S.y(527), { size: S.s(30), align: "center", maxW: S.s(130) });
        else M(x, vl.tag, S.x(c), S.y(526), { size: S.s(28), weight: 600, color: PAL.red, align: "center" });
        x.save(); x.translate(S.x(c + 130), S.y(560)); x.rotate(ok * TAU * 0.75);
        P.contour(x, P.ellipse(0, 0, S.s(26)).pts, { color: PAL.red, w: S.s(6), seed: 1133 + c, corners: false });
        for (let i = 0; i < 3; i++) { const an = (i / 3) * TAU; P.seg(x, 0, 0, Math.cos(an) * S.s(26), Math.sin(an) * S.s(26), S.s(5), PAL.red, 1, 1134 + i); }
        x.restore();
        bulb(x, g, S.x(c), S.y(355), S.s(14), prog(b, vl.open, vl.open + 0.05), 1, 1137 + c);
        T(x, tr(vl.label), S.x(c), S.y(306), { size: S.s(34), align: "center", alpha: prog(b, vl.arrive - 0.1, vl.arrive) * 0.7 + 0.3 });
        const ak = prog(b, vl.arrive, vl.arrive + 0.1, E.outBack);
        if (ak > 0 && ok < 1) {
          const cy = lerp(S.y(540), S.y(442), clamp(ak)), cx = S.x(c) + S.s(150) * E.in(ok);
          x.save(); x.beginPath(); x.rect(S.x(c - 62), S.y(392), S.s(124 + 200 * ok), S.s(100)); x.clip();
          capsule(x, cx, cy + S.s(40) * ok, S.s(84), S.s(20), vl.col, 0, 1, 1138 + c);
          x.restore();
        }
        if (ok > 0) P.halo(g, S.x(c + 130), S.y(560), S.s(90), impact(b, vl.open, 0.25));
      }
      // 判定员的高脚凳；#308 的 Clawd 在箱子上的打字机旁边改代码。
      const jIn = prog(b, 11.0, 11.15, E.outBack);
      for (const lx of [1250, 1330]) P.seg(x, S.x(lx), S.y(210), S.x(lx + (lx < 1290 ? -20 : 20)), S.y(ROOF_S), 8, PAL.woodD, 1, 1151 + lx);
      P.seg(x, S.x(1240), S.y(600), S.x(1340), S.y(600), 6, PAL.woodD, 1, 1153);
      P.fill(x, box(S, 1230, 196, 1350, 214), PAL.wood, { edge: 3, lw: 2.4, seed: 1154 });
      if (jIn > 0) {
        const st = { x: S.x(1290), y: S.y(196) - S.s(30) * (1 - clamp(jIn)), air: false, landT: 11.15 };
        const fr = pose(st, b, seqAt(b, [["look", AT.fail - 0.25], ["jump", AT.fail - 0.08], ["jump", AT.pass - 0.08]]));
        crew(tp, st, fr, 7, clamp(jIn));
        T(x, tr("ch08.judge"), S.x(1366), S.y(156), { size: S.s(36), alpha: clamp(jIn) });
        T(x, tr("ch08.judgeSub"), S.x(1366), S.y(196), { size: S.s(30), color: PAL.soft, alpha: clamp(jIn), maxW: S.s(300) });
      }
      P.fill(x, box(S, 860, 745, 950, ROOF_S), "#c89a64", { edge: 5, lw: 3, seed: 1161, shade: [-8 * u, 0, 0.45] });
      for (const k of [0.33, 0.66]) P.seg(x, S.x(860), S.y(745 + 74 * k), S.x(950), S.y(745 + 74 * k), 2.4, PAL.woodD, 0.6, 1162);
      const roll = typewriter(x, S.x(905), S.y(745), u * 0.55, 1, 1163, impact(b, AT.c4, 0.1));
      shaSlip(d, u, S.x(905), roll, "e3886f1", AT.c4, b, 1 - prog(b, 13.8, 14.0), 1164);
      if (b >= AT.c4) P.halo(g, S.x(905), roll - S.s(30), S.s(80), 0.6 * impact(b, AT.c4, 0.2));
      const fk = prog(b, AT.fail, AT.fail + 0.14) * (1 - prog(b, AT.pass - 0.12, AT.pass - 0.02));
      stamp(s, "FAIL", S.x(1040), S.y(442), { k: fk, px: S.s(40), rot: -0.14, color: P.lead(PAL.soft) });
      stamp(s, "PASS", S.x(1040), S.y(442), { k: prog(b, AT.pass, AT.pass + 0.14), px: S.s(40), rot: -0.1, color: P.lead(PAL.red), alpha: 1 - prog(b, AT.g2 + 0.05, AT.g2 + 0.15) });
      stamp(s, "OK", S.x(1610), S.y(442), { k: prog(b, AT.nod, AT.nod + 0.14), px: S.s(32), rot: -0.12, color: P.lead(PAL.red), sub: tr("ch08.nod"), subPx: S.s(20), alpha: 1 - prog(b, AT.g3 + 0.05, AT.g3 + 0.15) });
      P.halo(g, S.x(1040), S.y(442), S.s(150), 0.5 * impact(b, AT.pass, 0.3));
      P.halo(g, S.x(1610), S.y(442), S.s(150), 0.5 * impact(b, AT.nod, 0.3));
      const hl = prog(b, 13.25, 13.32);
      P.fill(x, box(S, 990, 362 - 30 * hl, 1090, 372 - 30 * hl), "#5f7a86", { edge: 2, lw: 2.2, seed: 1171 });
    }

    // #308 的 Clawd：从胶囊里钻出来，一路坐电梯、穿门、上屋顶，最后钻进阀门顺着管子掉到大厅。
    const PR_PATH = [
      [0, sW.x(520), BENCH],
      [3.32, AT.c1, sW.x(640), BENCH, 50],
      [4.78, 4.9, CABIN_X, BENCH, 120],
      [5.0, 5.15, CABIN_X, sR.y(640), 0],
      [5.22, 5.36, sR.x(800), DESK_R, 90],
      [6.62, AT.c2, sR.x(800), DESK_R, 40],
      [6.87, AT.c3, sR.x(800), DESK_R, 40],
      [7.2, 7.32, 3600, -1380 - FT, 60],
      [7.32, 7.42, 2650, -1380 - FT, 0],
      [7.42, 7.52, sL.x(1610), DESK_L, 60],
      [10.6, 10.8, 2470, ROOFY - 40, 140],
      [10.8, 10.95, sF.x(830), ROOFY, 50],
      [13.3, 13.42, sF.x(1040), sF.y(370), 90],
    ];
    const LOBBY_PATH = [[0, XM, 100], [14.52, 14.74, 3330, GROUND, 60], [AT.exit[0], AT.exit[1], 3490, GROUND, 160]];
    function threads(Ly, b) {
      const { tp } = Ly;
      const q = 8;
      if (b >= AT.pop308 && b < 13.56) {
        const st = walk(PR_PATH, b);
        const rise = prog(b, AT.pop308, AT.pop308 + 0.06, E.outBack), sink = prog(b, 13.44, 13.56, E.in);
        if (b < AT.c1) st.y += 30 * (1 - rise);
        st.y += 140 * sink;
        const hopMark = Math.max(0, ...[0, 1, 2, 3, 4].map((i) => hop(b, AT.slip0 + AT.slipStep * i + 0.125, AT.slip0 + AT.slipStep * i + 0.25, 22)));
        if (b > 5.3 && b < 6.6) st.y -= hopMark;
        const fr = K.clawdSeq("jump", b, AT.pop308, BARs) && b < AT.pop308 + 0.05 ? K.clawdSeq("jump", b, AT.pop308, BARs)
          : pose(st, b, seqAt(b, [["look", AT.gates[0] - 0.05], ["look", AT.slip0], ["look", AT.tests[0]], ["celebrate", AT.exact], ["look", AT.fail + 0.05], ["celebrate", AT.pass + 0.02]]));
        tp.save();
        if (sink > 0) { tp.beginPath(); tp.rect(st.x - 200, sF.y(370) - 400, 400, 400); tp.clip(); }
        crew(tp, st, fr, q, clamp(rise * 2));
        tp.restore();
      }
      if (b >= 14.5) {
        const st = walk(LOBBY_PATH, b);
        const ex = prog(b, AT.exit[0], AT.exit[1]);
        const fr = st.air ? { pose: "arms-up", offset: 0 } : pose(st, b, seqAt(b, [["look", AT.coauth], ["jump", AT.night[6]]]));
        const a = 1 - prog(b, AT.exit[1] - 0.1, AT.exit[1]);
        crew(tp, st, fr, q, a * prog(b, 14.5, 14.54), { sleep: asleep(b) && !st.air });
        if (asleep(b)) zzz(tp, st.x + 40, st.y - 100, 4, b, nightA(b));
        signBoard(Ly, b, st, a * (1 - ex));
      }
      if (b >= AT.hopIn[0] - 0.05) {
        const GUIDE = [[0, 2300, GROUND], [AT.hopIn[0], AT.hopIn[1], 1800, GROUND, 120], [AT.leap, 1.25, 1800, -150, 0], [1.25, AT.fall[1], COORD[0], COORD[1], 160]];
        const st = walk(GUIDE, b);
        const fr = st.air ? { pose: "arms-up", offset: 0 } : b >= AT.plug[0] - 0.05 && K.clawdSeq("jump", b, AT.plug[0] - 0.05, BARs) ? K.clawdSeq("jump", b, AT.plug[0] - 0.05, BARs)
          : pose(st, b, seqAt(b, [["look", AT.look], ["jump", AT.night[6]]]));
        crew(tp, st, fr, q, 1, { prop: "headset", propA: prog(b, AT.fall[1], AT.fall[1] + 0.05), sleep: asleep(b) });
        if (asleep(b)) zzz(tp, st.x + 40, st.y - 100, 4, b, nightA(b));
        const bk = prog(b, AT.hi, AT.hi + 0.08) * (1 - prog(b, 0.95, 1.0));
        P.bubble(tp, tr("ch08.hi"), 1800 + 40, GROUND - 12 * q - 22, { size: 38, k: bk, reveal: prog(b, AT.hi + 0.04, 0.8), tail: "right" });
      }
    }
    function signBoard(Ly, b, st, a) {
      const k = prog(b, AT.sign, AT.sign + 0.12, E.outBack);
      if (k <= 0 || a <= 0) return;
      const { tp } = Ly, q = 8;
      tp.save(); tp.translate(st.x, st.y - 12 * q); tp.scale(k, k); tp.translate(-st.x, -(st.y - 12 * q));
      const r = P.prop(tp, "sign", st.x, st.y, q, { w: 36, h: 9, alpha: a });
      if (r) T(tp, tr("ch08.sign"), st.x, r.y + r.h * 0.72, { size: 46, align: "center", alpha: a, maxW: r.w - 24 });
      tp.restore();
    }

    // 大厅：胶囊从三个出口掉下来点亮三盏灯，合并提交的卡挂起来，地上的电视放首页的提交卡。
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
    function merge(Ly, b, a) {
      const { x, d, g, tp } = Ly;
      for (const m of MERGES) {
        const k = prog(b, m.t - 0.12, m.t, E.in);
        if (k > 0 && k < 1) capsule(x, m.x, lerp(100, Y0, k), 34, 15, m.col, Math.PI / 2, 1, 1201 + m.x);
      }
      confetti(x, b, AT.m3, XM, Y0, 36, 17);
      if (a <= 0) return;
      const S = sG;
      const Mc = { x: S.x(1130), y: S.y(260), w: S.s(760), h: S.s(360) };
      const mk = prog(b, AT.mcard, AT.mcard + 0.12, E.outBack);
      if (mk > 0) for (const px of [Mc.x + 60, Mc.x + Mc.w - 60]) P.seg(x, px, 0, px, Mc.y - 22, 3, PAL.line, a * clamp(mk * 2) * 0.8, 1211 + px);
      frame(d, Mc.x, Mc.y, Mc.w, Mc.h, a * clamp(mk * 3), mk, 1212);
      if (mk >= 0.9) {
        const L = (sy) => Mc.y + S.s(sy);
        const w0 = M(d, "cf92f7c", Mc.x + S.s(28), L(50), { size: S.s(30), weight: 600, color: PAL.soft, alpha: a });
        T(d, tr("ch08.merge"), Mc.x + S.s(28) + w0 + S.s(20), L(52), { size: S.s(34), color: PAL.soft, alpha: a });
        M(d, "fix(collector):", Mc.x + S.s(28), L(104), { size: S.s(34), weight: 600, alpha: a });
        T(d, "PageSpeed 两端各算各的，放宽超时 (#308)", Mc.x + S.s(28), L(156), { size: S.s(36), alpha: a, maxW: Mc.w - S.s(56) });
        SUBJECTS.forEach((s0, j) => T(d, s0, Mc.x + S.s(28), L(200 + j * 28), { size: S.s(20), color: PAL.soft, alpha: a, reveal: prog(b, AT.mcard + 0.1 + j * 0.06, AT.mcard + 0.3 + j * 0.06), texture: true, maxW: Mc.w - S.s(56) }));
        const ca = prog(b, AT.coauth, AT.coauth + 0.06);
        if (ca > 0) { d.save(); d.globalAlpha = 0.5 * ca * a; d.fillStyle = P.hatchTile(PAL.sticky, { a0: 0.5, a1: 0.9, dens: 1.4 }); d.fillRect(Mc.x + S.s(18), L(306), Mc.w - S.s(36), S.s(44)); d.restore(); }
        M(d, "Co-Authored-By: Claude …", Mc.x + S.s(28), L(338), { size: S.s(30), weight: 600, color: ca > 0 ? PAL.red : PAL.soft, alpha: a * lerp(0.5, 1, ca) });
      }
      const hk = prog(b, AT.home, AT.home + 0.1);
      P.fill(x, box(S, 1290, 640, 1890, 962), PAL.woodD, { alpha: a, edge: 8, lw: 3.4, seed: 1221, shadow: [14, 12, 0.35] });
      for (const s0 of [-1, 1]) P.seg(x, S.x(1590), S.y(640), S.x(1590 + s0 * 90), S.y(570), 4, PAL.line, a, 1222 + s0);
      P.fill(x, box(S, 1314, 662, 1866, 912), hk > 0 ? PAL.cream : "#4c4a5e", { alpha: a, edge: 5, lw: 2.4, seed: 1224, tile: { lite: 0.3, dark: 0.08 } });
      M(x, "lyjw.me", S.x(1590), S.y(946), { size: S.s(28), weight: 600, color: PAL.cream, align: "center", alpha: a });
      if (hk > 0) {
        const L = (sy) => S.y(sy), fl = a * hk * (0.85 + 0.15 * Math.sin(b * BARs * 40));
        M(d, "Commits", S.x(1340), L(700), { size: S.s(28), weight: 600, color: PAL.soft, alpha: fl });
        T(d, "fix(collector): PageSpeed 两端各算各的…", S.x(1340), L(748), { size: S.s(32), alpha: fl, maxW: S.s(500) });
        M(d, "LYJW131 committed", S.x(1340), L(790), { size: S.s(28), color: PAL.soft, alpha: fl });
        M(d, "with claude", S.x(1404), L(840), { size: S.s(30), weight: 600, alpha: fl });
        M(d, "cf92f7c", S.x(1340), L(884), { size: S.s(28), color: PAL.soft, alpha: fl });
        const avK = prog(b, AT.avatar - 0.1, AT.avatar);
        const fr = K.clawdSeq("jump", b, AT.avatar, BARs) || { pose: "default", offset: 0 };
        P.clawd(tp, fr, S.x(1366), L(848), S.s(1.9), { alpha: a * avK, shadow: false });
        const lk = prog(b, AT.home + 0.1, AT.avatar - 0.05, E.io);
        if (lk > 0) {
          const p0 = [Mc.x + S.s(240), Mc.y + Mc.h + 22], p1 = [S.x(1366), L(812)];
          const head = P.line(x, [p0, [p0[0], lerp(p0[1], p1[1], 0.5)], [p1[0], lerp(p0[1], p1[1], 0.5)], p1], lk, 5, PAL.red, a, 1225);
          if (head && lk < 1) P.halo(g, head[0], head[1], S.s(50), 0.8 * a);
        }
      }
    }
    function confetti(x, b, t0, cx, cy, n, seed) {
      const k = (b - t0) * BARs;
      if (k < 0 || k > 2.3) return;
      const cols = [PAL.red, PAL.gold, PAL.teal, PAL.cream, DOCS_C];
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

    // 夜班：整栋楼黑下来，到点的那间亮灯、出来一只值班的 Clawd；天亮时整栋楼都亮了。
    const ROUTINES = [
      { label: "01:53", key: "ch08.r.watch", room: "lab", cx: 900, side: -1 },
      { label: "03:15", key: "ch08.r.mirror", room: "mail", cx: 300, side: -1 },
      { label: "04:00", key: "ch08.r.review", room: "rev", cx: 3500, side: 1, prop: "magnifier" },
      { label: "04:53", key: "ch08.r.skills", room: "work", cx: 5300, side: 1 },
      { label: "08:41", key: "ch08.r.news", room: "roof", cx: 4100, side: 0 },
      { label: "09:00", key: "ch08.r.brief", room: "lobby", cx: 4700, side: 1, prop: "headset" },
    ];
    const STAR_CLAWD = [[3, 0], [15, 0], [15, 2], [18, 2], [18, 4], [15, 4], [15, 6], [14, 8], [12, 6], [6, 6], [4, 8], [3, 6], [3, 4], [0, 4], [0, 2], [3, 2]];
    function night(Ly, b, v) {
      const { tp } = Ly;
      const na = nightA(b);
      if (na <= 0) return;
      const S = sN, dawn = prog(b, AT.night[5], AT.night[6] + 0.1);
      const lit = (room) => { const i = ROUTINES.findIndex((r) => r.room === room); return i < 0 ? 0 : prog(b, AT.night[i + 1], AT.night[i + 1] + 0.06); };
      const out = new Path2D(); out.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
      for (const r of Object.values(ROOMS)) out.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      const dark = (path, al, rule) => {
        tp.save(); tp.globalAlpha = al; tp.fillStyle = PAL.night; tp.fill(path, rule);
        tp.globalAlpha = al * 0.5; tp.fillStyle = P.hatchTile(PAL.night, { lite: 0.15, dark: 0.3, a0: 0.3, a1: 0.6 }); tp.fill(path, rule); tp.restore();
      };
      dark(out, na * lerp(0.84, 0.5, dawn), "evenodd");
      for (const [name, r] of Object.entries(ROOMS)) {
        const l = lit(name), p = new Path2D(); p.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        dark(p, na * lerp(0.84, 0.1, l), "nonzero");
        if (l > 0) { tp.save(); tp.globalAlpha = 0.16 * l * na; tp.fillStyle = PAL.moon; tp.fill(p); tp.restore(); }
      }
      // 灯笼在黑里也亮着。
      for (const c of commitsAt(b)) P.halo(tp, c.x, Y0, 60, 0.35 * na * (1 - lit("lobby")));
      const t = b * BARs;
      tp.save();
      for (let i = 0; i < 70; i++) {
        const sx = lerp(-1400, 6800, K.hash(i * 3.1)), sy = lerp(-3950, 400, K.hash(i * 7.7)), r = 18 + 26 * K.hash(i * 1.3);
        if (sx > BX0 - 200 && sx < BX1 + 200 && sy > ROOFY - 120) continue;
        tp.strokeStyle = PAL.moon; tp.lineWidth = 9; tp.lineCap = "round"; tp.globalAlpha = na * (0.6 + 0.4 * Math.sin(t * 2 + i)) * (1 - dawn * 0.7);
        tp.beginPath(); tp.moveTo(sx - r, sy); tp.lineTo(sx + r, sy); tp.moveTo(sx, sy - r); tp.lineTo(sx, sy + r); tp.stroke();
      }
      tp.restore();
      P.halo(tp, 5420, -3300, 520, 0.6 * na);
      P.fill(tp, P.ellipse(5420, -3300, 200), PAL.moon, { alpha: na, edge: 26, lw: 6, seed: 1301, shade: [56, -40, 0.5] });
      const sx0 = 5780, sy0 = -2500, uu = 40, sp = STAR_CLAWD.map(([a0, c0]) => [sx0 + a0 * uu, sy0 + c0 * uu]);
      P.line(tp, [...sp, sp[0]], 1, 6, PAL.moon, 0.45 * na, 1302);
      for (const [px, py] of [...sp, [sx0 + 6 * uu, sy0 + 2 * uu], [sx0 + 12 * uu, sy0 + 2 * uu]]) {
        tp.save(); tp.strokeStyle = PAL.moon; tp.globalAlpha = 0.9 * na; tp.lineWidth = 7; tp.lineCap = "round";
        tp.beginPath(); tp.moveTo(px - 18, py); tp.lineTo(px + 18, py); tp.moveTo(px, py - 18); tp.lineTo(px, py + 18); tp.stroke(); tp.restore();
      }
      const sk = prog(b, 16.85, 17.05);
      if (sk > 0 && sk < 1) {
        const hx = lerp(1800, 3400, sk), hy = lerp(-3700, -3420, sk);
        P.seg(tp, hx - 500, hy - 90, hx, hy, 8, PAL.moon, 0.9 * (1 - sk) * na, 1303);
        P.halo(tp, hx, hy, 120, 0.8 * (1 - sk) * na);
      }
      const tw = T(tp, tr("ch08.night"), S.x(260), S.y(160), { size: S.s(44), color: PAL.cream, alpha: na * prog(b, 16.0, 16.15) });
      M(tp, "UTC+8", S.x(260) + tw + S.s(20), S.y(160), { size: S.s(28), color: PAL.moon, alpha: na * prog(b, 16.0, 16.15) });
      ROUTINES.forEach((r, i) => {
        const t0 = AT.night[i + 1], k = prog(b, t0, t0 + 0.06, E.outBack);
        if (k <= 0) return;
        const R0 = ROOMS[r.room], bottom = r.room === "roof" ? ROOFY : r.room === "lobby" ? GROUND : R0.y1 - FT, q = 16;
        const fr = K.clawdSeq("jump", b, t0, BARs) || { pose: "default", offset: 0 };
        P.clawd(tp, fr, r.cx, bottom + (1 - k) * 60, q, { alpha: na * clamp(k * 2), shadow: false });
        if (r.prop) P.prop(tp, r.prop, r.cx, bottom + (1 - k) * 60, q, { crouch: fr.offset || 0, alpha: na * clamp(k * 2) });
        P.halo(tp, r.cx, bottom - 6 * q, 400, 0.5 * na * impact(b, t0, 0.3));
        const cy = r.room === "roof" ? S.y(150) : r.room === "lobby" ? S.y(975) : (R0.y0 + R0.y1) / 2;
        const lx = r.side < 0 ? S.x(118) : r.side > 0 ? S.x(1806) : S.x(1060);
        const name = tr(r.key), two = name.includes("\n");
        M(tp, r.label, lx, cy - S.s(18), { size: S.s(28), weight: 600, color: PAL.moon, align: "center", alpha: na * k });
        TL(tp, name, lx, cy + S.s(26) + (two ? S.s(18) : 0), S.s(36), { size: S.s(34), color: PAL.cream, align: "center", alpha: na * k, maxW: r.side ? S.s(220) : S.s(360) });
        if (r.room === "roof") P.halo(tp, sF.x(1820), sF.y(150), 300, na * k * (0.6 + 0.4 * Math.sin(t * 6)));
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

    function paint(Ly, b, c) {
      const { w, g, tp } = Ly;
      const v = view(c);
      building(w, g, v, b);
      lift(Ly, b, v);
      lobby(Ly, b, v);
      mainLine(Ly, b, v);
      mailRoom(Ly, b, v);
      capsuleRun(Ly, b);
      workRoom(Ly, b, v);
      revRoom(Ly, b, v);
      labRoom(Ly, b, v);
      haiku(Ly, b);
      roof(Ly, b, v);
      // 合并卡和电视在夜班的旁白出来之前淡完：甩镜头时它们正落在旁白那块。
      merge(Ly, b, 1 - prog(b, 15.85, 16.05));
      threads(Ly, b);
      night(Ly, b, v);
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
      const hitS = Math.max(impact(b, AT.hopIn[1], 0.1) * 0.5, impact(b, AT.plug[1], 0.1) * 0.6, impact(b, AT.fork[0] + 0.1, 0.1) * 0.5, impact(b, AT.fail, 0.1) * 0.7, impact(b, AT.pass, 0.1), impact(b, AT.nod, 0.1), impact(b, AT.m3, 0.14));
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
      const cv = document.createElement("canvas"); cv.width = 240; cv.height = 135;
      const wx = cv.getContext("2d"), Lw = { w: wx, x: wx, g: wx, d: wx, s: wx, tp: wx };
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
