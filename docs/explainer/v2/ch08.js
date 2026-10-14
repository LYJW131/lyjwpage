(() => {
  function make() {
    const { css } = G;
    const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, stamp, checkbox, measure, roundRect, pathAt, pathLen } = K;
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
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let plate, ink, emit, paperL, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

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

    // 首帧与 ch07.js 末帧、末帧与 ch09.js 首帧相同：屏幕 y 540 一条 main 线，HEAD 在屏幕 x 1350，
    // 往前隔 100 一颗提交、再往前每隔 200 一颗（ch07.js、ch09.js 的 COMMITS 是同一组数）。
    const Y0 = 540, HEAD0 = 1350, STEP = 200;
    const OLD = [1250, 1050, 850, 650, 450, 250, 50];
    const XM = 8050;
    const NMAIN = 33;
    const mainX = (j) => HEAD0 + STEP * j;
    const mainT = (j) => (j === 32 ? AT.m1 : j === 33 ? AT.m2 : 0.9 + 0.36 * j);

    const LANES = [
      { id: "pr", y: -160, from: HEAD0, to: 1750, jack: [2450, -1780], fork: AT.fork, merge: XM, at: AT.m3 },
      { id: "ui", y: 130, from: mainX(2), to: 2150, jack: [2750, -1780], fork: [2.0, 2.2], merge: XM - 100, at: AT.m2 },
      { id: "docs", y: 410, from: mainX(4), to: 2550, jack: [3050, -1780], fork: [2.45, 2.65], merge: XM - 300, at: AT.m1 },
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

    function glow(e, cx, cy, r, a) {
      if (a <= 0) return;
      const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
      e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
    }
    function dot(x, cx, cy, r, fill, stroke, lw, a = 1) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = fill; x.strokeStyle = stroke; x.lineWidth = lw;
      x.beginPath(); x.arc(cx, cy, r, 0, TAU); if (fill) x.fill(); if (lw > 0) x.stroke(); x.restore();
    }
    function tick(x, cx, cy, s, k, a = 1, color = css("signalD")) {
      polyline(x, [[cx - 0.5 * s, cy], [cx - 0.12 * s, cy + 0.38 * s], [cx + 0.6 * s, cy - 0.5 * s]], k, s * 0.16, color, a);
    }
    function card(d, px, py, w, h, a, sy = 1) {
      if (a <= 0) return;
      d.save(); d.globalAlpha = a; d.translate(px, py); d.scale(1, Math.max(0.001, sy));
      d.shadowColor = "rgba(0,0,0,0.5)"; d.shadowBlur = 24; d.shadowOffsetY = 8;
      d.fillStyle = css("paper"); d.fillRect(0, 0, w, h);
      d.shadowColor = "transparent"; d.strokeStyle = css("pink"); d.lineWidth = 2.4; d.strokeRect(0, 0, w, h);
      d.restore();
    }
    function box(x, bx, by, w, h, a, o = {}) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = o.color || css("bone"); x.lineWidth = o.lw ?? 2.4;
      roundRect(x, bx, by, w, h, o.r ?? 10); x.fill(); x.stroke(); x.restore();
    }
    function lamp(x, e, cx, cy, r, on, a = 1) {
      if (a <= 0) return;
      dot(x, cx, cy, r, css("ink2"), css("bone"), r * 0.14, a);
      if (on > 0) { dot(x, cx, cy, r * 0.74, css("signalD"), null, 0, a * on); glow(e, cx, cy, r * 3, 0.5 * on * a); }
    }
    function screen(x, draw) { x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); draw(); x.restore(); }
    function nar(x, key, row, r, a) {
      if (a <= 0) return;
      screen(x, () => K.narration(x, tr(key), 110, row ? 1024 : 944, { color: css("bone"), reveal: r, alpha: a, dim: 0.12, maxW: 1040 }));
    }
    function title(x, b) {
      const a = prog(b, 0.3, 0.75, E.out) * (1 - prog(b, 2.3, 2.6));
      if (a <= 0) return;
      screen(x, () => {
        text(x, "08", 110, 196, { font: FONT.pixel(112), color: css("signalD"), alpha: a });
        text(x, tr("ch08.title"), 290, 176, { font: FONT.cjk(58, 600), color: css("bone"), reveal: prog(b, 0.35, 0.8), alpha: a });
        text(x, "Claude Projects · GitHub · Codex · Devin · Haiku", 292, 226, { font: FONT.mono(28), color: css("ash"), reveal: prog(b, 0.45, 1.0), alpha: a });
        line(x, 110, 262, 110 + 990 * prog(b, 0.35, 1.0, E.outExpo), 262, 1.4, css("bone"), 0.6 * a);
      });
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
        const P = [[jx, jy], [jx, jy + 0.45 * h], [sx, sy - 0.45 * h], [sx, sy]];
        pts.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]);
      }
      return pts;
    }
    for (const ln of LANES) {
      ln.forkPts = sCurve(ln.from, Y0, ln.to, ln.y);
      ln.mergePts = sCurve(MX0, ln.y, ln.merge, Y0);
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
          return { x: lerp(px, x1, k), y: lerp(py, y1, k) - K.hop(b, t0, t1, h), air: true, landT };
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
      K.clawdFrame(tp, fr, st.x, bottom, q, { alpha: a, flip: o.flip });
      if (o.prop) K.clawdProp(tp, o.prop, st.x, bottom, q, { color: css("bone"), crouch: fr.offset || 0, flip: o.flip, alpha: a * (o.propA ?? 1) });
    }

    const PR_PATH = [
      [0, 1750, PR.y], [AT.pop308, AT.c1, 2240, PR.y, 120], [4.9, 5.15, 2900, PR.y, 110], [6.62, AT.c2, 3490, PR.y, 70],
      [6.87, AT.c3, 3740, PR.y, 70], [10.6, 10.95, 6790, PR.y, 260], [14.5, 14.82, XM, Y0 - 14, 260],
    ];
    const UI_PATH = [[0, 2150, UI.y], [2.2, 2.4, 2350, UI.y, 90], [10.7, 10.71, 6640, UI.y, 0]];
    const DOCS_PATH = [[0, 2550, DOCS.y], [2.65, 2.85, 2750, DOCS.y, 90], [10.7, 10.71, 6600, DOCS.y, 0]];
    const tipPR = (b) => keys(b, [[AT.pop308, PR.to], [AT.c1, 2240], [4.9, 2240], [5.15, 2900], [6.62, 2900], [AT.c2, 3490], [6.87, 3490], [AT.c3, 3740], [10.6, 3740], [10.95, GX - 60], [AT.g2, GX - 60], [AT.g2 + 0.2, MX0]]);
    const tipUI = (b) => (b < 10.7 ? keys(b, [[2.2, UI.to], [2.4, 2350]]) : keys(b, [[10.7, GX - 60], [AT.g3, GX - 60], [AT.g3 + 0.2, MX0]]));
    const tipDOCS = (b) => (b < 10.7 ? keys(b, [[2.65, DOCS.to], [2.85, 2750]]) : keys(b, [[10.7, GX - 60], [AT.g1, GX - 60], [AT.g1 + 0.2, MX0]]));

    function mainLine(Ly, b) {
      const { x, e } = Ly, bone = css("bone");
      let head = HEAD0, headT = -9;
      for (let j = 1; j <= NMAIN; j++) if (b >= mainT(j)) { head = mainX(j); headT = mainT(j); }
      if (b >= AT.m3) { head = XM; headT = AT.m3; }
      line(x, -2600, Y0, head, Y0, 3, bone);
      for (const cx of OLD) dot(x, cx, Y0, 9, css("ink2"), bone, 2.6);
      const pts = [HEAD0];
      for (let j = 1; j <= NMAIN; j++) if (b >= mainT(j)) pts.push(mainX(j));
      if (b >= AT.m3) pts.push(XM);
      for (const cx of pts) {
        if (cx === head) continue;
        dot(x, cx, Y0, 9, css("ink2"), bone, 2.6);
      }
      const pop = 1 + 0.6 * impact(b, headT, 0.12);
      dot(x, head, Y0, 14 * pop, css("signalD"), null, 0);
      const merged = [AT.m1, AT.m2, AT.m3].some((t) => Math.abs(headT - t) < 1e-6);
      if (merged) glow(e, head, Y0, 110, 0.6 * impact(b, headT, 0.3));
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
        K.clawdFrame(tp, fr, cx, Y0 - 11 - 18 * (1 - k), 1.7, { alpha: a * clamp(k * 2) });
      });
      const la = prog(b, 0.45, 0.6) * a;
      text(x, "Co-Authored-By: Claude", 650, Y0 + 84, { font: FONT.mono(32, 500), color: css("ash"), align: "center", alpha: la });
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
        K.bubble(tp, tr("ch08.hi"), HEAD0 + 6, Y0 - 14 - 12 * GUIDE_Q - 26, { px: 36, k: bk, reveal: prog(b, AT.hi + 0.04, 0.8), color: css("pink"), bg: css("paper"), tail: "right" });
        return;
      }
      const k = E.in(prog(b, AT.leap, 1.15));
      crew(tp, { x: HEAD0, y: lerp(Y0 - 14, -700, k) }, { pose: "arms-up", offset: 0 }, GUIDE_Q, 1);
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
      const { x, d, e } = Ly, bone = css("bone"), ash = css("ash");
      if (a <= 0) return;
      line(x, 640, COORD[1], 3330, COORD[1], 2.4, bone, a);
      box(x, PANEL.x, PANEL.y, PANEL.w, PANEL.h, a, { lw: 3, r: 14 });
      text(x, tr("ch08.chat"), PANEL.x + 46, PANEL.y + 78, { font: FONT.cjk(54, 600), color: bone, alpha: a });
      const lit = prog(b, AT.plug[1], AT.plug[1] + 0.05);
      for (const jy of JROWS) for (const jx of JCOLS) {
        const used = LANES.find((ln) => ln.jack[0] === jx && ln.jack[1] === jy);
        dot(x, jx, jy, 24, css("ink"), bone, 2.4, a * (used ? 1 : 0.55));
        if (!used) continue;
        const plugged = used === PR ? lit : 1;
        if (plugged > 0) {
          dot(x, jx, jy, 13, used === PR ? css("signalD") : bone, null, 0, a * plugged);
          if (used === PR) glow(e, jx, jy, 90, 0.55 * a * Math.max(impact(b, AT.plug[1], 0.25), 0.35 * plugged));
        }
        const tag = used === PR ? "#308" : tr(used === UI ? "ch08.t.ui" : "ch08.t.docs");
        text(x, tag, jx + 34, PANEL.y + PANEL.h + 74, { font: used === PR ? FONT.mono(48, 600) : FONT.cjk(48, 600), color: used === PR ? css("signalD") : ash, alpha: a * (used === PR ? lit : 1) });
      }
      const ma = a * prog(b, 1.3, 1.5);
      card(d, MEMO.x, MEMO.y, MEMO.w, MEMO.h, ma);
      if (ma > 0) {
        text(d, tr("ch08.memory"), MEMO.x + 44, MEMO.y + 86, { font: FONT.cjk(56, 600), alpha: ma });
        line(d, MEMO.x + 30, MEMO.y + 124, MEMO.x + MEMO.w - 30, MEMO.y + 124, 1.6, css("pink"), ma);
        ["ch08.mem1", "ch08.mem2", "ch08.mem3"].forEach((key, j) => {
          const r = prog(b, 1.6 + j * 0.15, 1.75 + j * 0.15);
          dot(d, MEMO.x + 58, MEMO.y + 204 + j * 92, 7, css("pink"), null, 0, ma * r);
          text(d, tr(key), MEMO.x + 84, MEMO.y + 220 + j * 92, { font: FONT.cjk(48, 600), alpha: ma, reveal: r, maxW: MEMO.w - 120 });
        });
      }
      const sk = prog(b, AT.slip[0], AT.slip[1], E.out);
      if (sk > 0) {
        const f = FONT.cjk(48, 600), w = measure(d, tr("ch08.slip"), f) + 64;
        const sx = lerp(-200 - w, SLIP_R - w, sk);
        card(d, sx, SLIP_Y, w, SLIP_H, a);
        text(d, tr("ch08.slip"), sx + 32, SLIP_Y + 78, { font: f, alpha: a });
        text(x, "lyjw", sx, SLIP_Y - 24, { font: FONT.cjk(48, 600), color: ash, alpha: a * prog(b, AT.slip[1] - 0.05, AT.slip[1] + 0.05) });
      }
    }
    function cables(Ly, b, a, coord) {
      const { x, e } = Ly, bone = css("bone");
      if (a <= 0) return;
      for (const ln of LANES) {
        const k = ln === PR ? prog(b, AT.cable[0], AT.cable[1], E.in) : 1;
        if (k > 0) polyline(x, ln.cable, k, 2, bone, a * 0.8);
        const sk = ln === PR ? prog(b, AT.cable[1], AT.cable[1] + 0.05) : 1;
        if (sk > 0) {
          const s = 1 + 0.4 * (ln === PR ? impact(b, AT.cable[1], 0.15) : 0);
          box(x, ln.to - 22 * s, ln.y - 26 - 22 * s, 44 * s, 44 * s, a * sk, { r: 6, lw: 2.4 });
          dot(x, ln.to, ln.y - 26, 7, ln === PR ? css("signalD") : bone, null, 0, a * sk);
          if (ln === PR) glow(e, ln.to, ln.y - 26, 70, 0.5 * a * impact(b, AT.cable[1], 0.25));
        }
      }
      if (coord && b >= AT.plug[0] - 0.02 && b < AT.plug[1]) {
        const k = E.io(prog(b, AT.plug[0], AT.plug[1]));
        const hand = [coord.x + 8 * COORD_Q, coord.y - 9 * COORD_Q], jack = PR.jack;
        const p = [lerp(hand[0], jack[0], k), lerp(hand[1], jack[1], k) - 180 * 4 * k * (1 - k)];
        polyline(x, [hand, [lerp(hand[0], p[0], 0.5), Math.max(hand[1], p[1]) + 60], p], 1, 2, bone, a * 0.8);
        dot(x, p[0], p[1], 12, bone, null, 0, a);
      }
    }

    function lanes(Ly, b) {
      const { x, e } = Ly, bone = css("bone");
      const end = 1 - prog(b, 15.95, 16.2);
      for (const ln of LANES) {
        const la = (ln === PR ? 1 : 1 - win(b, 4.8, 5.1, 10.7, 10.95)) * end;
        if (la <= 0 || b < ln.fork[0]) continue;
        polyline(x, ln.forkPts, prog(b, ln.fork[0], ln.fork[1], E.io), 3, bone, la);
        const tip = ln === PR ? tipPR(b) : ln === UI ? tipUI(b) : tipDOCS(b);
        if (b >= ln.fork[1] && tip > ln.to) line(x, ln.to, ln.y, tip, ln.y, 3, bone, la);
        if (b >= ln.at - 0.15) polyline(x, ln.mergePts, prog(b, ln.at - 0.15, ln.at, E.in), 3, bone, la);
      }
      const pa = end;
      for (const c of COMMITS) {
        const k = prog(b, c.t, c.t + 0.05, E.outBack);
        if (k <= 0) continue;
        dot(x, c.x, PR.y, 10 * k, css("ink2"), bone, 2.6, pa);
        glow(e, c.x, PR.y, 60, 0.45 * impact(b, c.t, 0.2) * pa);
        const keep = 1 - (c.t === AT.c1 ? prog(b, 4.9, 5.1) : c.t === AT.c4 ? prog(b, 13.8, 14.0) : prog(b, 10.6, 10.8));
        text(x, c.sha, c.x, PR.y - 34, { font: FONT.mono(48, 500), color: css("ash"), align: "center", alpha: pa * prog(b, c.t, c.t + 0.08) * keep });
      }
      const ua = 1 - win(b, 4.8, 5.1, 10.7, 10.95);
      if (b >= 2.4 && ua > 0) dot(x, 2350 - 100, UI.y, 10, css("ink2"), bone, 2.6, ua * end);
      if (b >= 2.85 && ua > 0) dot(x, 2750 - 100, DOCS.y, 10, css("ink2"), bone, 2.6, ua * end);
      const na = prog(b, 3.3, 3.5) * (1 - prog(b, 4.8, 5.1));
      text(x, "claude/project-thread-…", 1800, PR.y + 66, { font: FONT.mono(44, 500), color: css("ash"), alpha: na });
    }

    function threads(Ly, b) {
      const { tp } = Ly;
      if (b >= AT.pop308 && b < AT.exit[1]) {
        const st = walk(PR_PATH, b);
        const fr = st.air ? { pose: "arms-up", offset: 0 } : (K.clawdSeq("jump", b, AT.pop308, BARs) && b < AT.pop308 + 0.05 ? K.clawdSeq("jump", b, AT.pop308, BARs) : pose(st, b, seqAt(b, [["look", AT.fail + 0.05], ["celebrate", AT.pass + 0.02], ["look", AT.coauth]])));
        const rise = prog(b, AT.pop308, AT.pop308 + 0.06, E.outBack);
        let y = st.y;
        if (!st.air && b < AT.c1 && b >= AT.pop308 && st.x === 1750) y += 30 * (1 - rise);
        const hopMark = Math.max(0, ...[0, 1, 2, 3, 4].map((i) => K.hop(b, AT.slip0 + AT.slipStep * i + 0.125, AT.slip0 + AT.slipStep * i + 0.25, 26)));
        const ex = prog(b, AT.exit[0], AT.exit[1]);
        const st2 = { x: st.x + 160 * E.in(ex), y: y - hopMark - K.hop(b, AT.exit[0], AT.exit[1] + 0.2, 160) };
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
      const r = K.clawdProp(tp, "sign", st.x, bottom, q, { color: css("bone"), fill: css("paper"), w: 36, h: 9, alpha: a });
      if (r) text(tp, tr("ch08.sign"), st.x, r.y + r.h * 0.7, { font: FONT.cjk(42, 600), color: css("pink"), align: "center", alpha: a, maxW: r.w - 24 });
      tp.restore();
    }

    function localGates(Ly, b, a) {
      const { d } = Ly;
      if (a <= 0) return;
      const S = scr(TH), C = { x: S.x(130), y: S.y(120), w: S.s(640), h: S.s(470) };
      const k = prog(b, AT.card, AT.card + 0.12, E.outBack);
      card(d, C.x, C.y, C.w, C.h, a * clamp(k * 3), k);
      if (k < 0.9) return;
      const gr = css("graphite"), rows = ["docs:check", "typecheck", "test", "eslint", "build"];
      text(d, tr("ch08.gates"), C.x + S.s(30), C.y + S.s(56), { font: FONT.cjk(S.s(34), 600), alpha: a });
      line(d, C.x + S.s(20), C.y + S.s(80), C.x + C.w - S.s(20), C.y + S.s(80), 1.6, css("pink"), a);
      rows.forEach((name, j) => {
        const y = C.y + S.s(128 + j * 58), t = AT.gates[j];
        const on = t !== undefined ? prog(b, t, t + 0.08) : 0;
        checkbox(d, C.x + S.s(30), y - S.s(28), on, { size: S.s(34), alpha: a * (t === undefined ? 0.45 : 1), tick: css("signal") });
        text(d, name, C.x + S.s(84), y, { font: FONT.mono(S.s(30), 500), color: t === undefined ? gr : css("pink"), alpha: a * (t === undefined ? 0.7 : lerp(0.6, 1, on)) });
      });
      text(d, tr("ch08.gatesNote"), C.x + S.s(30), C.y + C.h - S.s(28), { font: FONT.cjk(S.s(28), 600), color: gr, alpha: a * prog(b, 4.8, 4.9), maxW: C.w - S.s(60) });
    }

    const BOTS = [["Codex", "f"], ["Devin", "f"], ["Codex", "f"], ["Devin", "r"], ["Codex", "f"], ["Claude review", null]];
    function prReviews(Ly, b, a) {
      const { x, d, e } = Ly;
      if (a <= 0) return;
      const S = scr(PRV), gr = css("graphite");
      const C = { x: S.x(300), y: S.y(110), w: S.s(800), h: S.s(450) };
      const k = prog(b, AT.pr, AT.pr + 0.12, E.outBack);
      card(d, C.x, C.y, C.w, C.h, a * clamp(k * 3), k);
      if (k >= 0.9) {
        text(d, "PR #308", C.x + S.s(34), C.y + S.s(58), { font: FONT.mono(S.s(32), 600), color: gr, alpha: a });
        text(d, "fix(collector):", C.x + S.s(34), C.y + S.s(130), { font: FONT.mono(S.s(36), 600), alpha: a });
        text(d, "PageSpeed 两端各算各的，放宽超时", C.x + S.s(34), C.y + S.s(186), { font: FONT.cjk(S.s(36), 600), alpha: a, maxW: C.w - S.s(68) });
        text(d, "claude/project-thread-… → main", C.x + S.s(34), C.y + S.s(246), { font: FONT.mono(S.s(28), 500), color: gr, alpha: a });
        line(d, C.x + S.s(20), C.y + S.s(290), C.x + C.w - S.s(20), C.y + S.s(290), 1.6, css("pink"), a);
        const ci = prog(b, AT.ci, AT.ci + 0.06);
        tick(d, C.x + S.s(52), C.y + S.s(350), S.s(30), ci, a, css("signal"));
        text(d, "CI · check", C.x + S.s(90), C.y + S.s(362), { font: FONT.mono(S.s(30), 500), alpha: a * lerp(0.6, 1, ci) });
        text(d, "Codex · Devin · Claude review", C.x + S.s(34), C.y + S.s(410), { font: FONT.mono(S.s(28), 500), color: gr, alpha: a * prog(b, AT.slip0, AT.slip0 + 0.1), maxW: C.w - S.s(68) });
      }
      BOTS.forEach(([name, mark], i) => {
        const t = AT.slip0 + AT.slipStep * i, sk = prog(b, t - 0.1, t, E.out);
        if (sk <= 0) return;
        const w = S.s(600), h = S.s(78), px = S.x(1170) + S.s(260) * (1 - sk), py = S.y(96 + i * 90);
        card(d, px, py, w, h, a * sk);
        text(d, name, px + S.s(24), py + S.s(50), { font: FONT.mono(S.s(32), 600), alpha: a * sk });
        if (!mark) {
          text(d, "No issues found", px + w - S.s(22), py + S.s(50), { font: FONT.mono(S.s(28), 500), color: gr, align: "right", alpha: a * sk });
          return;
        }
        const mk = prog(b, t + 0.125, t + 0.2);
        if (mk <= 0) return;
        const fixed = mark === "f";
        if (fixed) tick(d, px + w - S.s(150), py + S.s(38), S.s(28), mk, a, css("signal"));
        text(d, tr(fixed ? "ch08.fixed" : "ch08.replied"), px + w - S.s(22), py + S.s(50), { font: FONT.cjk(S.s(30), 600), color: fixed ? css("signal") : gr, align: "right", alpha: a * mk });
        glow(e, px + w - S.s(60), py + S.s(40), S.s(60), 0.35 * impact(b, t + 0.125, 0.2) * a * (fixed ? 1 : 0));
      });
      text(x, tr("ch08.codex3"), S.x(1770), S.y(680), { font: FONT.cjk(S.s(28), 600), color: css("ash"), align: "right", alpha: a * prog(b, AT.slip0 + AT.slipStep * 4, AT.slip0 + AT.slipStep * 4 + 0.1) });
    }

    const HAIKU_Q = 5.5;
    function verify(Ly, b, a) {
      const { x, d, e, tp } = Ly;
      if (a <= 0) return;
      const S = scr(VV), gr = css("graphite"), bone = css("bone");
      const hk = prog(b, AT.haiku[0], AT.haiku[1], E.in);
      if (b >= AT.haiku[0] && b < AT.bye + 0.35) {
        const st = { x: 3900, y: lerp(-1500, PR.y, hk), air: b < AT.haiku[1], landT: AT.haiku[1] };
        const out = prog(b, AT.bye + 0.05, AT.bye + 0.3, E.in);
        st.y -= 900 * out;
        const fr = st.air || out > 0 ? { pose: "arms-up", offset: 0 } : pose(st, b, seqAt(b, [["look", AT.tests[0] - 0.05], ["celebrate", AT.exact]]));
        crew(tp, st, fr, HAIKU_Q, a, { prop: "magnifier" });
      }
      const T = { x: S.x(480), y: S.y(250), w: S.s(420), h: S.s(330) };
      const tk = prog(b, AT.tests[0] - 0.2, AT.tests[0] - 0.08, E.outBack);
      card(d, T.x, T.y, T.w, T.h, a * clamp(tk * 3), tk);
      if (tk >= 0.9) {
        text(d, "f6ef255", T.x + S.s(26), T.y + S.s(52), { font: FONT.mono(S.s(30), 600), color: gr, alpha: a });
        ["collector test", "typecheck", "eslint", "docs:check"].forEach((name, j) => {
          const y = T.y + S.s(116 + j * 58), on = prog(b, AT.tests[j], AT.tests[j] + 0.06);
          checkbox(d, T.x + S.s(26), y - S.s(26), on, { size: S.s(32), alpha: a, tick: css("signal") });
          text(d, name, T.x + S.s(76), y, { font: FONT.mono(S.s(30), 500), alpha: a * lerp(0.55, 1, on) });
        });
      }
      const R = { x: S.x(950), y: S.y(84), w: S.s(590), h: S.s(470) };
      const rk = prog(b, AT.receipt, AT.receipt + 0.12, E.outBack);
      card(d, R.x, R.y, R.w, R.h, a * clamp(rk * 3), rk);
      if (rk >= 0.9) {
        const L = (sy) => R.y + S.s(sy);
        text(d, tr("ch08.receipt"), R.x + S.s(30), L(56), { font: FONT.cjk(S.s(36), 600), alpha: a });
        text(d, SHA_F6, R.x + S.s(30), L(100), { font: FONT.mono(S.s(19), 500), color: gr, alpha: a, texture: true });
        text(d, tr("ch08.paste"), R.x + S.s(30), L(142), { font: FONT.cjk(S.s(28), 600), color: css("signal"), alpha: a * prog(b, AT.receipt + 0.1, AT.receipt + 0.2), maxW: R.w - S.s(60) });
        text(d, "unit-test-verified", R.x + S.s(30), L(214), { font: FONT.mono(S.s(40), 700), color: css("signal"), alpha: a * prog(b, AT.level, AT.level + 0.06) });
        line(d, R.x + S.s(20), L(250), R.x + R.w - S.s(20), L(250), 1.6, css("pink"), a);
        text(d, tr("ch08.evidence"), R.x + S.s(30), L(306), { font: FONT.cjk(S.s(28), 600), alpha: a, maxW: R.w - S.s(60) });
        text(d, "typecheck · eslint · docs:check", R.x + S.s(30), L(352), { font: FONT.mono(S.s(28), 500), color: gr, alpha: a, maxW: R.w - S.s(60) });
        text(d, tr("ch08.verifier"), R.x + S.s(30), L(428), { font: FONT.cjk(S.s(28), 600), alpha: a, maxW: R.w - S.s(60) });
      }
      const la = a * prog(b, AT.receipt + 0.15, AT.level);
      if (la > 0) {
        const lx = S.x(1570), rows = [["live-ui-verified", 1], ["unit-test-verified", 1], ["type-check-only", 1], null, ["verifier-blocked", 0], ["verifier-failed", 0]];
        text(x, tr("ch08.passing"), lx, S.y(122), { font: FONT.cjk(S.s(28), 600), color: bone, alpha: la });
        rows.forEach((r, j) => {
          const y = S.y(176 + j * 58);
          if (!r) { text(x, tr("ch08.notPassing"), lx, y + S.s(8), { font: FONT.cjk(S.s(28), 600), color: css("ash"), alpha: la }); return; }
          const hot = r[0] === "unit-test-verified" ? prog(b, AT.rung, AT.rung + 0.06) : 0;
          line(x, lx, y - S.s(10), lx + S.s(20), y - S.s(10), 3, hot > 0 ? css("signalD") : r[1] ? bone : css("ash"), la);
          text(x, r[0], lx + S.s(30), y, { font: FONT.mono(S.s(28), hot > 0 ? 700 : 500), color: hot > 0 ? css("signalD") : r[1] ? bone : css("ash"), alpha: la, maxW: S.s(1890 - 1600) });
          if (hot > 0) glow(e, lx + S.s(10), y - S.s(10), S.s(50), 0.5 * hot * la * (0.6 + 0.4 * impact(b, AT.rung, 0.3)));
        });
      }
      const ck = prog(b, AT.check[0], AT.check[1]);
      if (ck > 0) {
        const cmd = "$ verify-receipt.mjs check --pr 308";
        text(x, cmd.slice(0, Math.ceil(ck * cmd.length)), S.x(950), S.y(650), { font: FONT.mono(S.s(28), 500), color: bone, alpha: a });
        const ex = prog(b, AT.exact, AT.exact + 0.06);
        const jw = text(x, '"coverage": "exact", "pass": true', S.x(950), S.y(700), { font: FONT.mono(S.s(28), 600), color: css("signalD"), alpha: a * ex });
        lamp(x, e, S.x(950) + jw + S.s(36), S.y(690), S.s(14), ex, a * prog(b, AT.check[1], AT.check[1] + 0.05));
      }
    }

    const GATES = [
      { ln: DOCS, label: "ch08.g1", open: AT.g1, tok: "ch08.t.docs", from: 10.8, arrive: 11.15 },
      { ln: PR, label: "ch08.g2", open: AT.g2, tok: "#308", from: 10.9, arrive: 11.45 },
      { ln: UI, label: "ch08.g3", open: AT.g3, tok: "ch08.t.ui", from: 11.0, arrive: 11.6 },
    ];
    const JUDGE = [GX + 60, PR.y - 230];
    function mergeGates(Ly, b, a) {
      const { x, d, e, s, tp } = Ly;
      if (a <= 0) return;
      const S = scr(GV), bone = css("bone"), ash = css("ash");
      for (const g of GATES) {
        const y = g.ln.y, ok = prog(b, g.open, g.open + 0.1, E.io);
        line(x, GX - 26, y - 84, GX + 26, y - 84, 3, bone, a);
        line(x, GX - 26, y + 84, GX + 26, y + 84, 3, bone, a);
        line(x, GX, y - 84, GX, lerp(y + 84, y - 76, ok), 7, ok > 0.99 ? css("ash") : bone, a);
        lamp(x, e, GX, y - 108, 13, prog(b, g.open, g.open + 0.05), a);
        text(x, tr(g.label), GX + 50, y - 52, { font: FONT.cjk(S.s(30), 600), color: bone, alpha: a });
        const tx = keys(b, [[g.from, GX - 1000], [g.arrive, GX - 150, E.out], [g.open, GX - 150], [g.open + 0.2, GX + 160, E.io]]);
        const ta = a * prog(b, g.from, g.from + 0.15) * (1 - prog(b, g.open + 0.25, g.open + 0.4));
        const tw = S.s(112), th = S.s(46);
        card(d, tx - tw / 2, y - th / 2, tw, th, ta);
        const lab = g.tok.startsWith("ch08.") ? tr(g.tok) : g.tok;
        text(d, lab, tx, y + S.s(11), { font: g.tok.startsWith("ch08.") ? FONT.cjk(S.s(28), 600) : FONT.mono(S.s(28), 600), align: "center", alpha: ta, maxW: tw - S.s(12) });
      }
      const jIn = prog(b, 11.0, 11.15, E.outBack) * (1 - prog(b, 13.8, 14.0));
      if (jIn > 0) {
        line(x, JUDGE[0] - 100, JUDGE[1], JUDGE[0] + 100, JUDGE[1], 2.4, bone, a * jIn);
        const st = { x: JUDGE[0], y: JUDGE[1] + 40 * (1 - clamp(jIn)), air: false, landT: 11.15 };
        const fr = pose(st, b, seqAt(b, [["look", AT.fail - 0.25], ["jump", AT.fail - 0.08], ["jump", AT.pass - 0.08]]));
        crew(tp, st, fr, 7, a * clamp(jIn));
        text(x, tr("ch08.judge"), JUDGE[0] + 130, S.y(262), { font: FONT.cjk(S.s(32), 600), color: bone, alpha: a * clamp(jIn) });
        text(x, tr("ch08.judgeSub"), JUDGE[0] + 130, S.y(304), { font: FONT.cjk(S.s(28), 600), color: ash, alpha: a * clamp(jIn), maxW: S.s(520) });
      }
      const fk = prog(b, AT.fail, AT.fail + 0.14) * (1 - prog(b, AT.pass - 0.12, AT.pass - 0.02));
      const SY = 110;
      stamp(s, "FAIL", GX - 150, PR.y - SY, { k: fk, px: S.s(40), rot: -0.14, color: ash, alpha: a });
      stamp(s, "PASS", GX - 150, PR.y - SY, { k: prog(b, AT.pass, AT.pass + 0.14), px: S.s(40), rot: -0.1, color: css("signalD"), alpha: a * (1 - prog(b, AT.g2 + 0.05, AT.g2 + 0.15)) });
      stamp(s, "OK", GX - 150, UI.y - SY - 20, { k: prog(b, AT.nod, AT.nod + 0.14), px: S.s(40), rot: -0.12, color: css("signalD"), sub: tr("ch08.nod"), subPx: S.s(28), alpha: a * (1 - prog(b, AT.g3 + 0.05, AT.g3 + 0.15)) });
      glow(e, GX - 150, PR.y - SY, 140, 0.5 * a * impact(b, AT.pass, 0.3));
      glow(e, GX - 150, UI.y - SY - 20, 140, 0.5 * a * impact(b, AT.nod, 0.3));
    }

    const SUBJECTS = [
      "- fix(collector): PageSpeed 两端各算各的，先占连接、放宽超时",
      "- fix(collector): PageSpeed 按较旧那端判过期，单端样本不丢",
      "- docs(core): PageSpeed 的 fetchedAt 改为两端较旧那次实测",
      "- fix(collector): 去掉 pagespeed 的 headStart 与不成立的排队解释",
    ];
    function mergeCards(Ly, b, a) {
      const { x, d, e, tp } = Ly;
      if (a <= 0) return;
      const S = scr(MV), gr = css("graphite");
      const M = { x: S.x(1080), y: S.y(50), w: S.s(800), h: S.s(384) };
      const mk = prog(b, AT.mcard, AT.mcard + 0.12, E.outBack);
      if (mk > 0) K.dashed(x, XM + 30, Y0 - 140, M.x, M.y + M.h, 2, css("bone"), [10, 9], a * clamp(mk * 2));
      card(d, M.x, M.y, M.w, M.h, a * clamp(mk * 3), mk);
      if (mk >= 0.9) {
        const L = (sy) => M.y + S.s(sy);
        const w0 = text(d, "cf92f7c", M.x + S.s(30), L(52), { font: FONT.mono(S.s(30), 600), color: gr, alpha: a });
        text(d, tr("ch08.merge"), M.x + S.s(30) + w0 + S.s(20), L(52), { font: FONT.cjk(S.s(30), 600), color: gr, alpha: a });
        text(d, "fix(collector):", M.x + S.s(30), L(112), { font: FONT.mono(S.s(34), 600), alpha: a });
        text(d, "PageSpeed 两端各算各的，放宽超时 (#308)", M.x + S.s(30), L(164), { font: FONT.cjk(S.s(34), 600), alpha: a, maxW: M.w - S.s(60) });
        SUBJECTS.forEach((s0, j) => text(d, s0, M.x + S.s(30), L(214 + j * 30), { font: FONT.cjk(S.s(20), 500), color: gr, alpha: a, reveal: prog(b, AT.mcard + 0.1 + j * 0.06, AT.mcard + 0.3 + j * 0.06), texture: true, maxW: M.w - S.s(60) }));
        const ca = prog(b, AT.coauth, AT.coauth + 0.06);
        if (ca > 0) fillRect(d, M.x + S.s(20), L(322), M.w - S.s(40), S.s(46), css("signal"), 0.12 * ca * a);
        text(d, "Co-Authored-By: Claude …", M.x + S.s(30), L(356), { font: FONT.mono(S.s(30), 600), color: ca > 0 ? css("signal") : gr, alpha: a * lerp(0.5, 1, ca) });
      }
      const H = { x: S.x(1240), y: S.y(520), w: S.s(640), h: S.s(290) };
      const hk = prog(b, AT.home, AT.home + 0.12, E.outBack);
      text(x, "lyjw.me", H.x, H.y - S.s(16), { font: FONT.mono(S.s(28), 600), color: css("ash"), alpha: a * prog(b, AT.home, AT.home + 0.1) });
      card(d, H.x, H.y, H.w, H.h, a * clamp(hk * 3), hk);
      if (hk >= 0.9) {
        const L = (sy) => H.y + S.s(sy);
        text(d, "Commits", H.x + S.s(28), L(46), { font: FONT.mono(S.s(28), 600), color: gr, alpha: a });
        text(d, "fix(collector): PageSpeed 两端各算各的…", H.x + S.s(28), L(104), { font: FONT.cjk(S.s(30), 600), alpha: a, maxW: H.w - S.s(56) });
        text(d, "LYJW131 committed", H.x + S.s(28), L(152), { font: FONT.mono(S.s(28), 500), color: gr, alpha: a });
        text(d, "with claude", H.x + S.s(74), L(206), { font: FONT.mono(S.s(30), 600), alpha: a });
        text(d, "cf92f7c", H.x + S.s(28), L(258), { font: FONT.mono(S.s(28), 500), color: gr, alpha: a });
        const avK = prog(b, AT.avatar - 0.1, AT.avatar);
        const fr = K.clawdSeq("jump", b, AT.avatar, BARs) || { pose: "default", offset: 0 };
        K.clawdFrame(tp, fr, H.x + S.s(44), L(214), S.s(1.9), { alpha: a * avK });
        const lk = prog(b, AT.home + 0.1, AT.avatar - 0.05, E.io);
        if (lk > 0) {
          const p0 = [M.x + S.s(260), M.y + M.h], p1 = [H.x + S.s(44), L(176)];
          const head = polyline(x, [p0, [p0[0], lerp(p0[1], p1[1], 0.5)], [p1[0], lerp(p0[1], p1[1], 0.5)], p1], lk, 2.4, css("signalD"), a);
          if (head && lk < 1) glow(e, head[0], head[1], S.s(40), 0.6 * a);
        }
      }
    }

    const S0 = 7650, HOUR = 300, NIGHT_Y = -900;
    const ROUTINES = [
      { h: 1 + 53 / 60, label: "01:53", key: "ch08.r.watch", up: true },
      { h: 3.25, label: "03:15", key: "ch08.r.mirror", up: false },
      { h: 4, label: "04:00", key: "ch08.r.review", up: true, prop: "magnifier" },
      { h: 4 + 53 / 60, label: "04:53", key: "ch08.r.skills", up: false },
      { h: 8 + 41 / 60, label: "08:41", key: "ch08.r.news", up: true, dx: -50 },
      { h: 9, label: "09:00", key: "ch08.r.brief", up: false, prop: "headset", dx: 50 },
    ];
    function night(Ly, b, a) {
      const { x, e, tp } = Ly;
      if (a <= 0) return;
      const S = scr(NV), bone = css("bone"), ash = css("ash");
      const x1 = S0 + 9 * HOUR;
      const lk = prog(b, 15.95, 16.2, E.io);
      line(x, S0, NIGHT_Y, lerp(S0, x1, lk), NIGHT_Y, 3, bone, a);
      for (let h = 0; h <= 9; h++) {
        const hx = S0 + h * HOUR, major = h % 3 === 0;
        if (hx > lerp(S0, x1, lk) + 1) continue;
        line(x, hx, NIGHT_Y - (major ? 22 : 12), hx, NIGHT_Y + (major ? 22 : 12), major ? 3 : 2, bone, a * (major ? 1 : 0.6));
        if (major) text(x, `${String(h).padStart(2, "0")}:00`, hx, NIGHT_Y + S.s(54), { font: FONT.mono(S.s(28), 500), color: ash, align: "center", alpha: a });
      }
      const tw = text(x, tr("ch08.night"), S0, NIGHT_Y - S.s(270), { font: FONT.cjk(S.s(36), 600), color: bone, alpha: a * prog(b, 16.0, 16.15) });
      text(x, "UTC+8", S0 + tw + S.s(20), NIGHT_Y - S.s(270), { font: FONT.mono(S.s(28), 500), color: ash, alpha: a * prog(b, 16.0, 16.15) });
      const marks = [[AT.night[0], 0], ...ROUTINES.map((r, i) => [AT.night[i + 1], r.h])];
      const cur = keys(b, marks.map(([t, h], i) => (i ? [t, S0 + h * HOUR, E.lin] : [t, S0 + h * HOUR])));
      const ca = a * prog(b, AT.night[0], AT.night[0] + 0.05) * (1 - prog(b, AT.night[6] + 0.1, AT.night[6] + 0.3));
      if (ca > 0) {
        line(x, cur, NIGHT_Y - 46, cur, NIGHT_Y + 46, 4, css("signalD"), ca);
        glow(e, cur, NIGHT_Y, 70, 0.5 * ca);
      }
      ROUTINES.forEach((r, i) => {
        const t = AT.night[i + 1], k = prog(b, t, t + 0.06, E.outBack);
        if (k <= 0) return;
        const mx = S0 + r.h * HOUR, rx = mx + (r.dx || 0), q = 6;
        dot(x, mx, NIGHT_Y, 8, css("signalD"), null, 0, a);
        glow(e, mx, NIGHT_Y, 60, 0.5 * a * impact(b, t, 0.25));
        const fr = K.clawdSeq("jump", b, t, BARs) || { pose: "default", offset: 0 };
        const bottom = NIGHT_Y - 6 + 2 * q + (1 - k) * 30;
        K.clawdFrame(tp, fr, rx, bottom, q, { alpha: a * clamp(k * 2) });
        if (r.prop) K.clawdProp(tp, r.prop, rx, bottom, q, { color: bone, crouch: fr.offset || 0, alpha: a * clamp(k * 2) });
        const ty = r.up ? NIGHT_Y - 12 * q - S.s(56) : NIGHT_Y + S.s(108);
        text(x, r.label, rx, ty, { font: FONT.mono(S.s(28), 600), color: css("signalD"), align: "center", alpha: a * k });
        text(x, tr(r.key), rx, ty + (r.up ? -S.s(38) : S.s(40)), { font: FONT.cjk(S.s(30), 600), color: bone, align: "center", alpha: a * k, maxW: S.s(300) });
      });
    }

    const PLATE_RECT = [-600, -2900, 11000, 1500];
    function render(f) {
      BARs = f.BAR;
      const b = f.bar;
      const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
      const hitS = Math.max(impact(b, AT.hopIn[1], 0.1) * 0.5, impact(b, AT.plug[1], 0.1) * 0.6, impact(b, AT.fail, 0.1) * 0.7, impact(b, AT.pass, 0.1), impact(b, AT.nod, 0.1), impact(b, AT.m3, 0.14));
      const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.012 * hitS), rot: 0 };
      G.setCam(cam);
      G.fill(plate, { uGridA: prog(b, 0.1, 0.7) * (1 - prog(b, 18.6, 19.9)), uPlate: PLATE_RECT });

      const x = ink.begin(); ink.cam(cam);
      const e = emit.begin(); emit.cam(cam);
      const d = paperL.begin(); paperL.cam(cam);
      const s = stampL.begin(); stampL.cam(cam);
      const tp = top.begin(); top.cam(cam);
      const Ly = { x, e, d, s, tp };

      mainLine(Ly, b);
      opening(Ly, b);
      guide(Ly, b);
      const boardA = prog(b, 1.1, 1.3) * (1 - prog(b, 3.0, 3.3));
      board(Ly, b, boardA);
      const coord = coordinator(Ly, b, boardA);
      cables(Ly, b, prog(b, 1.1, 1.3) * (1 - prog(b, 4.8, 5.1)), coord);
      lanes(Ly, b);
      localGates(Ly, b, 1 - prog(b, 4.85, 5.05));
      prReviews(Ly, b, 1 - prog(b, 7.3, 7.5));
      verify(Ly, b, 1 - prog(b, 10.6, 10.8));
      mergeGates(Ly, b, prog(b, 10.75, 10.95) * (1 - prog(b, 13.9, 14.2)));
      mergeCards(Ly, b, 1 - prog(b, 15.95, 16.2));
      night(Ly, b, prog(b, 15.95, 16.1) * (1 - prog(b, 17.95, 18.25)));
      threads(Ly, b);
      title(x, b);

      nar(x, "ch08.n1a", 0, prog(b, 1.45, 1.95), win(b, 1.4, 1.5, 2.85, 2.95));
      nar(x, "ch08.n1b", 1, prog(b, 1.95, 2.5), win(b, 1.4, 1.5, 2.85, 2.95));
      nar(x, "ch08.n2a", 0, prog(b, 3.1, 3.6), win(b, 3.05, 3.15, 4.85, 4.95));
      nar(x, "ch08.n2b", 1, prog(b, 3.6, 4.3), win(b, 3.05, 3.15, 4.85, 4.95));
      nar(x, "ch08.n3a", 0, prog(b, 5.15, 5.6), win(b, 5.1, 5.2, 7.25, 7.35));
      nar(x, "ch08.n3b", 1, prog(b, 5.9, 6.6), win(b, 5.1, 5.2, 7.25, 7.35));
      nar(x, "ch08.n4a", 0, prog(b, 7.6, 8.2), win(b, 7.55, 7.65, 10.55, 10.65));
      nar(x, "ch08.n4b", 1, prog(b, 8.9, 9.6), win(b, 7.55, 7.65, 10.55, 10.65));
      nar(x, "ch08.n5a", 0, prog(b, 11.05, 11.6), win(b, 11.0, 11.1, 13.7, 13.8));
      nar(x, "ch08.n5b", 1, prog(b, 12.9, 13.5), win(b, 11.0, 11.1, 13.7, 13.8));
      nar(x, "ch08.n6a", 0, prog(b, 14.1, 14.6), win(b, 14.05, 14.15, 15.8, 15.9));
      nar(x, "ch08.n6b", 1, prog(b, 15.2, 15.7), win(b, 14.05, 14.15, 15.8, 15.9));
      nar(x, "ch08.n7a", 0, prog(b, 16.15, 16.6), win(b, 16.1, 16.2, 17.85, 17.95));
      nar(x, "ch08.n7b", 1, prog(b, 16.6, 17.3), win(b, 16.1, 16.2, 17.85, 17.95));

      G.composite(ink.upload(), { mode: G.MODE.ink, seed: 8.3 });
      G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.5 });
      G.composite(paperL.upload(), { mode: G.MODE.paper });
      G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 2.9 });
      G.composite(top.upload(), { mode: G.MODE.normal });

      const sh = hitS * 6;
      f.post = {
        bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
        shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
        blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
      };
    }
    function init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paperL = G.layer("paper"); stampL = G.layer("stamp"); top = G.layer("top"); }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch08", title: "ch.08", bars: 20,
    init() { impl = impl || make(); impl.init(); },
    render(f) { impl.render(f); },
  });
})();
