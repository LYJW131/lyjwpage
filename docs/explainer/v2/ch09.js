(() => {
  function make() {
    const { css } = G;
    const { E, prog, clamp, lerp, text, FONT, line, polyline, rect, dashed, stamp, spark, checkbox, measure } = K;
    I18N.add({
      "ch09.title": ["对话", "Chat"],
      "ch09.msg1": ["你最近在听什么？", "What are you listening to?"],
      "ch09.c.label": ["隐私说明", "PRIVACY NOTICE"],
      "ch09.c.intro": ["先确认对话数据会发到哪里：", "Where this chat sends your data:"],
      "ch09.c.browser": ["这个浏览器", "This browser"],
      "ch09.c.accept": ["接受", "Accept"],
      "ch09.c.decline": ["拒绝", "Decline"],
      "ch09.n1a": ["发第一句之前，先说清数据去哪；", "First, a notice of where data goes;"],
      "ch09.n1b": ["点了接受，才去验人、发请求。", "nothing is sent until you accept."],
      "ch09.g.human": ["验人", "Human check"],
      "ch09.g.humanSub": ["通行证 · Turnstile", "pass · Turnstile"],
      "ch09.q.r1": ["访客自己的总量", "Your own total"],
      "ch09.q.r2": ["全站路由次数", "Site-wide routing"],
      "ch09.q.r3": ["至少一档还有空位", "A tier with room"],
      "ch09.q.foot": ["挡下：回 429，不调 Clef", "Blocked: a 429, Clef never runs"],
      "ch09.n2a": ["花钱之前先过闸：验人，再数额度；", "Before any spend: a human check,"],
      "ch09.n2b": ["被挡下就回 429，不再调 Clef。", "then quotas; blocked means a 429."],
      "ch09.k.sub": ["Workers AI 上的路由模型", "a router on Workers AI"],
      "ch09.k.full": ["满了", "Full"],
      "ch09.k.down": ["往下降一档", "Step down"],
      "ch09.k.refuse": ["refuse：不调模型，回一句关门话", "refuse: no model, just a closing line"],
      "ch09.n3a": ["Clef 看问题挑一档模型；", "Clef picks a model tier;"],
      "ch09.n3b": ["那一档满了，就往下降一档。", "if it's full, it steps down one."],
      "ch09.t.note": ["只读公开模型", "Read-only, public model"],
      "ch09.t.same": ["和浏览器看到的同一份", "The same data the browser gets"],
      "ch09.t.client": ["外部 AI 客户端", "External AI client"],
      "ch09.n4a": ["工具只读公开模型，和浏览器同一份；", "Tools read the same public model;"],
      "ch09.n4b": ["同一套工具也挂在 /mcp 上。", "the same tools are served on /mcp."],
      "ch09.reply": ["YOASOBI 的「アイドル」，正在放。", "YOASOBI's アイドル, playing now."],
      "ch09.seal": ["盖章：下一轮只认盖过章的历史", "Sealed: only sealed turns go back in"],
      "ch09.msg2": ["给在听卡加个歌词按钮", "Add a lyrics button to Now Playing"],
      "ch09.s.box": ["Claude Managed Agents · 只读沙盒", "Claude Managed Agents · read-only sandbox"],
      "ch09.s.repo": ["main · 匿名克隆", "main · anonymous clone"],
      "ch09.s.net": ["网络：只放行 github.com", "Network: github.com only"],
      "ch09.a.q": ["按钮放在哪？", "Where should the button go?"],
      "ch09.a.o1": ["封面右上角", "Cover, top right"],
      "ch09.a.o2": ["曲名旁边", "Next to the title"],
      "ch09.p.title": ["在听卡加歌词按钮", "Lyrics button on Now Playing"],
      "ch09.p.rows": ["规格 · 验收 3 项", "Spec · 3 acceptance checks"],
      "ch09.p.gh": ["先看 GitHub 授权说明", "GitHub consent first"],
      "ch09.n5a": ["想改站，Sonnet 开一个设计会话；", "Site ideas open a design session;"],
      "ch09.n5b": ["Opus 只读仓库，出题、出计划。", "Opus reads the repo, asks, plans."],
      "ch09.b.routine": ["不持有推送凭据", "holds no push credentials"],
      "ch09.b.upload": ["上传改动，Worker 校验后提交", "Uploads; the Worker checks, commits"],
      "ch09.b.review": ["审查只作参考", "Reviews are advisory"],
      "ch09.b.owner": ["合不合并：站长决定", "Merging: the owner decides"],
      "ch09.n6a": ["构建在新分支上开 draft PR，", "A build opens a draft PR;"],
      "ch09.n6b": ["合不合并，由站长决定。", "merging is the owner's call."],
    });
    const tr = (k) => I18N.tr(k);
    const TAU = Math.PI * 2;
    let plate, ink, paperL, emit, stampL, top;
    let BARs = (60 / 108) * 4;
    const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
    const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

    // 拍位和 music/ch09.js 是同一张表。
    const AT = {
      morph: [0.05, 0.6], type1: [0.6, 0.95], send1: 1.0, consent: 1.1, accept: 2.0, verify: [2.1, 2.45], leave: 2.5,
      human: 3.25, quota: [3.75, 4.0, 4.25], block: 4.5, pass: 4.75,
      clef: 6.0, full: 6.25, down: 6.5, haiku: 6.75,
      call: 8.25, data: 8.5, mcp: 9.0, reply: 10.0, seal: 10.25,
      send2: 10.75, design: 11.0, clone: 11.5, ask: 12.0, answer: 12.25, plan: 12.5, gh: 13.0, build: 13.25,
      planCommit: 13.75, pr: 14.0, upload: 14.25, implCommit: 14.5, review: 14.75, owner: 15.0,
      fade: [15.4, 15.85], fin: [15.3, 15.92],
    };

    const C = { x: 0, y: -1160, w: 1400, h: 1200 };
    const IY = -20;
    const MSG_TOP = C.y + 104, MSG_BOT = IY - 120;
    const LANE = -500;

    // 末帧与 ch10.js 首帧相同：main 线、提交圆点与 HEAD 的屏幕位置照抄 ch10.js 的 Y0、HEAD、COMMITS（它们又跟着 ch08.js 的心电图几何）。
    const ML = 1500, FIN_X = 1700;
    const scr = (sx) => FIN_X + sx - 960;
    const HEAD = [scr(1350), ML];
    const COMMITS = [1250, 1050, 850, 650, 450, 250, 50].map(scr);

    const CAM0 = [700, IY, 1];
    const CV = [-67, -360, 0.6];
    const GV = [2700, -406, 0.8];
    const KV = [4700, -420, 0.8];
    const TV = [6700, -353, 0.7];
    const SV = [1250, 640, 0.62];
    const BV = [2400, 1240, 0.62];
    const FIN = [FIN_X, ML, 1];
    const drift = (c, dx = 10, k = 1.015) => [c[0] + dx, c[1] + 2, c[2] * k];
    const CAM = [
      [AT.morph[0], CAM0], [0.7, CV, E.io], [2.3, drift(CV), E.lin], [2.75, GV, E.io], [5.0, drift(GV), E.lin],
      [5.4, KV, E.io], [7.6, drift(KV), E.lin], [7.9, TV, E.io], [9.5, drift(TV), E.lin], [9.75, CV, E.io],
      [11.1, drift(CV, 6), E.lin], [11.35, SV, E.io], [13.3, drift(SV), E.lin], [13.55, BV, E.io],
      [AT.fin[0], drift(BV), E.lin], [AT.fin[1], FIN, E.io], [16, FIN, E.lin],
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

    function glow(e, cx, cy, r, a) {
      if (a <= 0) return;
      const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
      e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
    }
    function dot(x, cx, cy, r, fill, stroke, lw, a = 1) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = fill; x.strokeStyle = stroke; x.lineWidth = lw;
      x.beginPath(); x.arc(cx, cy, r, 0, TAU); if (fill) x.fill(); if (lw > 0) x.stroke(); x.restore();
    }
    function tick(x, cx, cy, s, k, a = 1) {
      polyline(x, [[cx - 0.5 * s, cy], [cx - 0.12 * s, cy + 0.38 * s], [cx + 0.6 * s, cy - 0.5 * s]], k, s * 0.16, css("signal"), a);
    }
    function lamp(x, e, cx, cy, r, on, a = 1) {
      if (a <= 0) return;
      dot(x, cx, cy, r, css("paper"), css("pink"), r * 0.13, a);
      if (on > 0) { dot(x, cx, cy, r * 0.78, css("signal"), null, 0, a * on); glow(e, cx, cy, r * 2.6, 0.5 * on * a); }
    }
    function card(d, px, py, w, h, a, sy = 1, lw = 2.4) {
      if (a <= 0) return;
      d.save(); d.globalAlpha = a; d.translate(px, py); d.scale(1, Math.max(0.001, sy));
      d.shadowColor = "rgba(0,0,0,0.28)"; d.shadowBlur = 18; d.shadowOffsetY = 7;
      d.fillStyle = css("paper"); d.fillRect(0, 0, w, h);
      d.shadowColor = "transparent"; d.strokeStyle = css("pink"); d.lineWidth = lw; d.strokeRect(0, 0, w, h);
      d.restore();
    }
    function pill(d, px, py, w, h, label, font, a, o = {}) {
      if (a <= 0) return;
      d.save(); d.globalAlpha = a;
      K.roundRect(d, px, py, w, h, h * 0.22);
      if (o.fill) { d.fillStyle = o.fill; d.fill(); }
      d.strokeStyle = o.stroke || css("pink"); d.lineWidth = 2.4; d.stroke(); d.restore();
      text(d, label, px + w / 2, py + h * 0.68, { font, color: o.color || css("pink"), align: "center", alpha: a, maxW: w - 24 });
    }
    function arrowHead(x, tx, ty, ang, color, a = 1, s = 18) {
      if (a <= 0) return;
      x.save(); x.globalAlpha = a; x.fillStyle = color; x.beginPath();
      x.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
      x.lineTo(tx + Math.cos(ang + 2.6) * s, ty + Math.sin(ang + 2.6) * s);
      x.lineTo(tx + Math.cos(ang - 2.6) * s, ty + Math.sin(ang - 2.6) * s);
      x.fill(); x.restore();
    }
    function screen(x, draw) { x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); draw(); x.restore(); }
    function nar(x, key, row, r, a) {
      if (a <= 0) return;
      screen(x, () => K.narration(x, tr(key), 110, row ? 1024 : 944, { reveal: r, alpha: a, dim: 0.12, maxW: 1040 }));
    }
    function title(x, b) {
      const a = prog(b, 0.3, 0.75, E.out) * (1 - prog(b, 2.3, 2.6));
      if (a <= 0) return;
      screen(x, () => {
        text(x, "09", 110, 196, { font: FONT.pixel(112), color: css("signal"), alpha: a });
        text(x, tr("ch09.title"), 290, 176, { font: FONT.cjk(58, 600), reveal: prog(b, 0.35, 0.8), alpha: a });
        text(x, "Talk to God · ai Worker · Clef · Claude", 292, 226, { font: FONT.mono(28), color: css("graphite"), reveal: prog(b, 0.45, 1.0), alpha: a });
        line(x, 110, 262, 110 + 820 * prog(b, 0.35, 1.0, E.outExpo), 262, 1.4, css("pink"), a);
      });
    }

    // 一条消息的去向：章内小节 → 世界坐标；拖尾从同一个函数往回取，画面仍是时间的纯函数。
    const MSG = [
      [AT.leave, [C.x + C.w, LANE]], [3.0, [2000, LANE], E.io], [3.3, [2000, LANE]], [3.55, [2420, LANE], E.io],
      [AT.pass, [2420, LANE]], [5.0, [3350, LANE], E.io], [5.6, [3900, LANE], E.io], [AT.clef, [4400, LANE], E.io],
      [6.15, [4750, -600], E.io], [AT.down, [4750, -600]], [AT.haiku, [4750, -320], E.io],
    ];
    const CALL = [[8.0, [5550, -320]], [AT.call, [6250, -460], E.io], [8.4, [6750, -230], E.io], [AT.data, [6750, -60], E.io]];
    const BACK = [[AT.data + 0.05, [6750, -60]], [8.8, [6750, -230], E.io]];
    const MCP = [[AT.mcp, [7680, -870]], [9.3, [7200, -560], E.io]];
    function along(path, b) {
      if (b <= path[0][0]) return path[0][1];
      for (let i = 1; i < path.length; i++) if (b <= path[i][0]) {
        const [t0, p0] = path[i - 1], [t1, p1, e = E.lin] = path[i];
        const k = e(clamp((b - t0) / (t1 - t0)));
        return [lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)];
      }
      return path[path.length - 1][1];
    }
    function runner(Ly, path, b, size = 0.9) {
      const t0 = path[0][0], t1 = path[path.length - 1][0];
      if (b < t0 || b > t1 + 0.02) return;
      const head = along(path, b);
      const trail = [];
      for (let i = 14; i >= 1; i--) trail.push(along(path, Math.max(t0, b - i * 0.012)));
      spark(Ly.e, Ly.tp, head, trail, { t: G.t, size, lw: 3 });
      dot(Ly.tp, head[0], head[1], 6.5 * size, css("signal"), null, 0);
    }

    function bubble(d, str, right, y, a, o = {}) {
      if (a <= 0) return 0;
      const f = FONT.cjk(52, 600), w = measure(d, str, f) + 64, h = 96;
      const px = right - w;
      d.save(); d.globalAlpha = a; d.fillStyle = css("pink"); K.roundRect(d, px, y, w, h, 18); d.fill(); d.restore();
      text(d, str, px + 32, y + 64, { font: f, color: css("paper"), alpha: a, reveal: o.reveal ?? 1 });
      return h;
    }
    const DEST = ["Cloudflare Workers", "Cloudflare Turnstile", "Workers AI · Clef", "Anthropic · Claude API", "Sentry", "GitHub", "ch09.c.browser"];
    function consent(d, b, y0, a) {
      if (a <= 0) return;
      const gr = css("graphite");
      text(d, tr("ch09.c.label"), C.x + 60, y0 + 50, { font: FONT.mono(48, 600), color: gr, alpha: a });
      text(d, tr("ch09.c.intro"), C.x + 60, y0 + 124, { font: FONT.cjk(50, 600), alpha: a, maxW: C.w - 120 });
      DEST.forEach((s, j) => {
        const r = prog(b, AT.consent + 0.1 + j * 0.08, AT.consent + 0.3 + j * 0.08);
        dot(d, C.x + 84, y0 + 186 + j * 62, 6, css("pink"), null, 0, a * r);
        text(d, s.startsWith("ch09.") ? tr(s) : s, C.x + 110, y0 + 202 + j * 62, { font: s.startsWith("ch09.") ? FONT.cjk(48, 600) : FONT.mono(48, 500), alpha: a, reveal: r });
      });
      const by = y0 + 202 + DEST.length * 62 + 10, hit = prog(b, AT.accept, AT.accept + 0.06);
      pill(d, C.x + 60, by, 300, 84, tr("ch09.c.accept"), FONT.cjk(46, 600), a, { fill: hit > 0 ? css("signal") : css("pink"), stroke: hit > 0 ? css("signal") : css("pink"), color: css("paper") });
      pill(d, C.x + 390, by, 300, 84, tr("ch09.c.decline"), FONT.cjk(46, 600), a);
    }
    function nowCard(d, px, py, w, h, a) {
      if (a <= 0) return;
      card(d, px, py, w, h, a, 1, 2);
      const s = h - 60;
      d.save(); d.globalAlpha = a; d.fillStyle = css("pink"); d.globalAlpha = 0.12 * a; d.fillRect(px + 30, py + 30, s, s);
      d.globalAlpha = a; d.strokeStyle = css("pink"); d.lineWidth = 2; d.strokeRect(px + 30, py + 30, s, s);
      for (let j = 1; j <= 3; j++) { d.globalAlpha = a * (0.5 - j * 0.1); d.beginPath(); d.arc(px + 30 + s / 2, py + 30 + s / 2, s * 0.13 * j, 0, TAU); d.stroke(); }
      d.restore();
      text(d, "NOW PLAYING", px + s + 64, py + 72, { font: FONT.mono(40, 600), color: css("graphite"), alpha: a, texture: true });
      text(d, "アイドル", px + s + 64, py + 136, { font: FONT.cjk(56, 600), alpha: a });
      text(d, "YOASOBI", px + s + 64, py + 192, { font: FONT.mono(48, 500), color: css("graphite"), alpha: a });
    }

    function chatCard(Ly, b) {
      const { x, d, s } = Ly, gr = css("graphite");
      const ca = prog(b, 0.25, 0.55);
      card(d, C.x, C.y, C.w, C.h, ca, 1, 2.6);
      if (ca > 0) {
        text(d, "TALK TO GOD", C.x + 48, C.y + 72, { font: FONT.mono(48, 600), color: gr, alpha: ca });
        line(d, C.x + 30, C.y + 104, C.x + C.w - 30, C.y + 104, 1.4, css("pink"), ca);
      }

      const k = prog(b, AT.morph[0], AT.morph[1], E.io);
      const x0 = lerp(CAM0[0] - 960, C.x + 40, k), x1 = lerp(CAM0[0] + 960, C.x + C.w - 40, k);
      line(d, x0, IY, x1, IY, 3, css("pink"));
      const box = prog(b, 0.45, 0.65);
      if (box > 0) {
        line(d, C.x + 40, IY, C.x + 40, IY - 100 * box, 3, css("pink"));
        line(d, C.x + C.w - 40, IY, C.x + C.w - 40, IY - 100 * box, 3, css("pink"));
        if (box >= 1) line(d, C.x + 40, IY - 100, C.x + C.w - 40, IY - 100, 3, css("pink"));
      }
      const msg1 = tr("ch09.msg1"), typed = prog(b, AT.type1[0], AT.type1[1]);
      const inText = b < AT.send1 && typed > 0 ? [...msg1].slice(0, Math.ceil(typed * [...msg1].length)).join("") : "";
      const vk = prog(b, AT.verify[0], AT.verify[0] + 0.05) * (1 - prog(b, AT.verify[1], AT.verify[1] + 0.05));
      const idle = box * (b > AT.send1 + 0.05 && vk <= 0 ? 1 : 0) * (b < AT.send1 ? 0 : 1);
      if (inText) text(d, inText, C.x + 80, IY - 32, { font: FONT.cjk(52, 600) });
      if (vk > 0) text(d, "Verifying you are human…", C.x + 80, IY - 34, { font: FONT.mono(46, 500), color: gr, alpha: vk });
      else if (idle > 0 && b < AT.send2 - 0.15) text(d, "Speak, mortal… (type /)", C.x + 80, IY - 34, { font: FONT.mono(46, 500), color: gr, alpha: 0.6 * idle });
      const caretX = C.x + 84 + (inText ? measure(d, inText, FONT.cjk(52, 600)) : 0);
      const cx = lerp(CAM0[0] + 390, caretX, k), cy = lerp(IY, IY - 50, k);
      if (k < 0.9) dot(d, cx, cy, 9, css("signal"), null, 0, 1 - prog(k, 0.6, 0.9));
      if (k > 0.6 && b < AT.send1 && Math.floor(b * 8) % 2 === 0) K.fillRect(d, cx, IY - 78, 5, 56, css("signal"), prog(k, 0.6, 0.9));

      d.save(); d.beginPath(); d.rect(C.x, MSG_TOP, C.w, MSG_BOT - MSG_TOP); d.clip();
      const scroll = 700 * prog(b, AT.send2 - 0.15, AT.send2 + 0.05, E.io);
      const oldA = 1 - prog(b, AT.send2 - 0.1, AT.send2 + 0.05);
      const by = MSG_TOP + 40 - scroll;
      bubble(d, msg1, C.x + C.w - 50, by, prog(b, AT.send1, AT.send1 + 0.08) * oldA);
      const cA = win(b, AT.consent, AT.consent + 0.08, AT.accept + 0.1, AT.accept + 0.25);
      consent(d, b, by + 140, cA);
      const rA = prog(b, AT.reply - 0.1, AT.reply) * oldA;
      if (rA > 0) {
        text(d, "HAIKU · SMALL FRY", C.x + 60, by + 196, { font: FONT.mono(48, 600), color: gr, alpha: rA });
        text(d, tr("ch09.reply"), C.x + 60, by + 276, { font: FONT.cjk(52, 600), alpha: rA, reveal: prog(b, AT.reply - 0.08, AT.reply + 0.15), maxW: C.w - 120 });
        nowCard(d, C.x + 60, by + 330, 940, 250, prog(b, AT.reply + 0.05, AT.reply + 0.15) * oldA);
      }
      const b2 = MSG_TOP + 40 + 700 - scroll;
      bubble(d, tr("ch09.msg2"), C.x + C.w - 50, b2, prog(b, AT.send2, AT.send2 + 0.08));
      const dk = prog(b, AT.design, AT.design + 0.12, E.out);
      if (dk > 0) {
        const dy = b2 + 210, mid = C.x + C.w / 2, lab = "DESIGN SESSION · ARCHITECT TAKES OVER";
        const lw = measure(d, lab, FONT.mono(48, 600)) + 60;
        line(d, mid - (C.w / 2 - 50) * dk, dy, mid + (C.w / 2 - 50) * dk, dy, 2.4, css("signal"));
        card(d, mid - lw / 2, dy - 46, lw, 92, dk, 1, 2);
        text(d, lab, mid, dy + 16, { font: FONT.mono(48, 600), color: css("signal"), align: "center", alpha: dk });
      }
      d.restore();

      const sk = prog(b, AT.seal, AT.seal + 0.14);
      if (sk > 0 && b < AT.send2) {
        stamp(s, "SEAL", C.x + 1180, by + 470, { k: sk, px: 84, rot: -0.1 });
        const la = prog(b, AT.seal + 0.05, AT.seal + 0.15) * oldA;
        K.leader(x, C.x + 1060, by + 500, tr("ch09.seal"), -1220, 150, { font: FONT.cjk(52, 600), color: css("pink"), alpha: la });
      }
    }

    function gates(Ly, b, a) {
      const { x, d, e, s } = Ly, gr = css("graphite");
      if (a <= 0) return;
      line(x, C.x + C.w, LANE, 3900, LANE, 4, css("pink"), a);
      d.save(); d.globalAlpha = a; d.fillStyle = css("paper"); d.fillRect(1976, LANE - 24, 48, 48); d.restore();
      rect(d, 1976, LANE - 24, 48, 48, 3, css("pink"), a);
      tick(d, 2000, LANE + 2, 36, prog(b, AT.human, AT.human + 0.08), a);
      text(d, tr("ch09.g.human"), 2000, LANE - 70, { font: FONT.cjk(52, 600), align: "center", alpha: a });
      text(d, tr("ch09.g.humanSub"), 2000, LANE + 104, { font: FONT.mono(42, 500), color: gr, align: "center", alpha: a });
      const Q = { x: 2300, y: -900, w: 1100, h: 780 };
      card(d, Q.x, Q.y, Q.w, Q.h, a);
      text(d, "ChatQuota", Q.x + 50, Q.y + 84, { font: FONT.mono(56, 600), alpha: a });
      text(d, "admitVisitor", Q.x + Q.w - 50, Q.y + 84, { font: FONT.mono(40, 500), color: gr, align: "right", alpha: a });
      line(d, Q.x + 30, Q.y + 116, Q.x + Q.w - 30, Q.y + 116, 1.4, css("pink"), a);
      ["ch09.q.r1", "ch09.q.r2", "ch09.q.r3"].forEach((key, j) => {
        const y = Q.y + 230 + j * 130, t = AT.quota[j];
        checkbox(d, Q.x + 60, y - 40, prog(b, t, t + 0.08), { size: 52, alpha: a });
        text(d, tr(key), Q.x + 150, y, { font: FONT.cjk(50, 600), alpha: a * lerp(0.55, 1, prog(b, t, t + 0.08)) });
      });
      text(d, tr("ch09.q.foot"), Q.x + 60, Q.y + Q.h - 60, { font: FONT.cjk(44, 600), color: gr, alpha: a * prog(b, AT.block - 0.1, AT.block), maxW: Q.w - 400 });
      stamp(s, "429", Q.x + Q.w - 200, Q.y + 330, { k: prog(b, AT.block, AT.block + 0.14), px: 96, rot: -0.12, sub: "Too many prayers", subPx: 40, alpha: a });
      const ga = a * prog(b, AT.pass, AT.pass + 0.05);
      if (ga > 0) glow(e, Q.x + Q.w, LANE, 90, 0.5 * ga * impact(b, AT.pass, 0.3));
    }

    const TIERS = [
      { id: "Fable", persona: "God", y: -880, used: 2 },
      { id: "Sonnet", persona: "Prophet", y: -600, used: 6 },
      { id: "Haiku", persona: "Small Fry", y: -320, used: 3 },
    ];
    function clef(Ly, b, a) {
      const { x, d, e } = Ly, gr = css("graphite"), sig = css("signal");
      if (a <= 0) return;
      card(d, 3900, -640, 500, 280, a);
      text(d, "Clef", 4150, -500, { font: FONT.sans(72, 600), align: "center", alpha: a });
      text(d, tr("ch09.k.sub"), 4150, -420, { font: FONT.cjk(40, 600), color: gr, align: "center", alpha: a, maxW: 470 });
      const pick = prog(b, AT.clef, AT.clef + 0.08), downK = prog(b, AT.down, AT.down + 0.2, E.io);
      TIERS.forEach((t, j) => {
        const on = j === 1 ? pick * (1 - downK) : j === 2 ? prog(b, AT.haiku, AT.haiku + 0.06) : 0;
        polyline(x, [[4400, LANE], [4560, LANE], [4560, t.y], [4750, t.y]], 1, 3, on > 0 ? sig : gr, a * (on > 0 ? 1 : 0.6));
        card(d, 4750, t.y - 100, 800, 200, a);
        text(d, t.id, 4800, t.y - 6, { font: FONT.mono(60, 600), alpha: a });
        text(d, t.persona, 4800, t.y + 60, { font: FONT.mono(44, 500), color: gr, alpha: a });
        const fill = t.used + (j === 2 ? prog(b, AT.haiku, AT.haiku + 0.06) : 0);
        for (let c = 0; c < 6; c++) {
          const cx = 5170 + c * 56, on2 = c < Math.floor(fill + 1e-6);
          d.save(); d.globalAlpha = a; d.fillStyle = on2 ? (j === 1 && b >= AT.full ? sig : css("pink")) : css("paper"); d.fillRect(cx, t.y - 30, 40, 60);
          d.strokeStyle = css("pink"); d.lineWidth = 2; d.strokeRect(cx, t.y - 30, 40, 60); d.restore();
        }
        if (j === 2) lamp(d, e, 5500, t.y - 64, 18, prog(b, AT.haiku, AT.haiku + 0.06), a);
      });
      const fk = prog(b, AT.full, AT.full + 0.06);
      if (fk > 0) text(d, tr("ch09.k.full"), 5470, -690, { font: FONT.cjk(48, 600), color: sig, align: "right", alpha: a * fk });
      if (downK > 0) {
        const head = polyline(x, [[5620, -560], [5620, -380]], downK, 4, sig, a);
        if (downK >= 1) arrowHead(x, head[0], head[1], Math.PI / 2, sig, a);
        text(x, tr("ch09.k.down"), 5660, -455, { font: FONT.cjk(44, 600), color: sig, alpha: a * downK });
      }
      text(x, tr("ch09.k.refuse"), 4750, -110, { font: FONT.cjk(42, 600), color: gr, alpha: a * prog(b, 6.9, 7.1), maxW: 900 });
    }

    function tools(Ly, b, a) {
      const { x, d, e } = Ly, gr = css("graphite"), sig = css("signal");
      if (a <= 0) return;
      polyline(x, [[5550, -320], [5900, -320], [5900, -460], [6250, -460]], 1, 3, b >= 8.0 ? sig : gr, a * 0.9);
      const T = { x: 6250, y: -720, w: 1000, h: 490 };
      card(d, T.x, T.y, T.w, T.h, a);
      text(d, "SITE_TOOLS", T.x + 50, T.y + 84, { font: FONT.mono(54, 600), alpha: a });
      line(d, T.x + 30, T.y + 116, T.x + T.w - 30, T.y + 116, 1.4, css("pink"), a);
      const hot = win(b, AT.call - 0.05, AT.call, AT.data + 0.4, AT.data + 0.5);
      if (hot > 0) K.fillRect(d, T.x + 30, T.y + 150, T.w - 60, 76, sig, 0.14 * hot * a);
      text(d, "get_site_status", T.x + 60, T.y + 206, { font: FONT.mono(50, 500), color: hot > 0.5 ? sig : css("pink"), alpha: a });
      text(d, "read_project_doc", T.x + 60, T.y + 296, { font: FONT.mono(50, 500), alpha: a });
      text(d, tr("ch09.t.note"), T.x + 60, T.y + 410, { font: FONT.cjk(46, 600), color: gr, alpha: a });
      line(x, 6750, -230, 6750, -80, 3, css("pink"), a);
      text(x, "PUBLIC_STATUS", 6720, -150, { font: FONT.mono(42, 500), color: gr, align: "right", alpha: a });
      card(d, 6450, -80, 600, 130, a);
      text(d, "api · PublicStatus", 6750, -2, { font: FONT.mono(46, 600), align: "center", alpha: a });
      const sa = prog(b, 8.8, 8.9) * a;
      text(x, tr("ch09.t.same"), 7090, 0, { font: FONT.cjk(44, 600), color: sig, alpha: sa });
      if (b >= AT.data && b < 9.1) {
        const p = along(BACK, b);
        pill(Ly.tp, p[0] + 30, p[1] - 40, 370, 74, "listening/now", FONT.mono(42, 500), prog(b, AT.data, AT.data + 0.05) * (1 - prog(b, 8.8, 9.0)) * a, { fill: css("paper"), color: sig, stroke: sig });
      }
      const ma = prog(b, AT.mcp - 0.15, AT.mcp) * a;
      if (ma > 0) {
        card(d, 7420, -1010, 560, 130, ma);
        text(d, tr("ch09.t.client"), 7700, -930, { font: FONT.cjk(46, 600), align: "center", alpha: ma, maxW: 520 });
        const head = polyline(x, [[7680, -880], [7680, -800], [7200, -800], [7200, -735]], prog(b, AT.mcp, AT.mcp + 0.25, E.io), 3, sig, ma);
        if (head && b > AT.mcp + 0.25) arrowHead(x, head[0], head[1], Math.PI / 2, sig, ma);
        text(x, "POST /mcp", 7250, -820, { font: FONT.mono(46, 600), color: sig, alpha: ma });
        glow(e, 7200, -735, 80, 0.5 * impact(b, AT.mcp + 0.25, 0.3) * ma);
      }
    }

    const SB = { x: 0, y: 260, w: 1400, h: 800 };
    const ASK = { x: 1550, y: 280, w: 900, h: 270 };
    const PLAN = { x: 1550, y: 590, w: 900, h: 460 };
    function sandbox(Ly, b, a) {
      const { x, d, e } = Ly, gr = css("graphite"), sig = css("signal");
      if (a <= 0) return;
      const ok = prog(b, AT.design + 0.2, AT.design + 0.35);
      if (ok <= 0) return;
      const sa = a * ok;
      K.dashed(x, SB.x, SB.y, SB.x + SB.w, SB.y, 3, css("pink"), [16, 12], sa);
      K.dashed(x, SB.x, SB.y + SB.h, SB.x + SB.w, SB.y + SB.h, 3, css("pink"), [16, 12], sa);
      K.dashed(x, SB.x, SB.y, SB.x, SB.y + SB.h, 3, css("pink"), [16, 12], sa);
      K.dashed(x, SB.x + SB.w, SB.y, SB.x + SB.w, SB.y + SB.h, 3, css("pink"), [16, 12], sa);
      text(x, tr("ch09.s.box"), SB.x + 40, SB.y - 30, { font: FONT.cjk(50, 600), alpha: sa, maxW: SB.w - 40 });
      card(d, SB.x + 50, SB.y + 70, 560, 220, sa);
      text(d, "Opus", SB.x + 90, SB.y + 166, { font: FONT.sans(72, 600), alpha: sa });
      text(d, "Architect", SB.x + 90, SB.y + 240, { font: FONT.mono(48, 500), color: gr, alpha: sa });
      card(d, SB.x + 790, SB.y + 70, 560, 220, sa);
      text(d, "LYJW131/lyjwpage", SB.x + 820, SB.y + 166, { font: FONT.mono(46, 600), alpha: sa, maxW: 500 });
      text(d, tr("ch09.s.repo"), SB.x + 820, SB.y + 240, { font: FONT.cjk(46, 600), color: gr, alpha: sa, maxW: 500 });
      const ck = prog(b, AT.clone, AT.clone + 0.2, E.io);
      if (ck > 0) {
        const head = polyline(x, [[SB.x + 780, SB.y + 180], [SB.x + 620, SB.y + 180]], ck, 4, sig, sa);
        if (ck >= 1) arrowHead(x, head[0], head[1], Math.PI, sig, sa);
      }
      const rows = [["read", true], ["glob", true], ["grep", true], ["write", false], ["edit", false]];
      rows.forEach(([name, on], j) => {
        const r = prog(b, AT.clone + 0.1 + j * 0.06, AT.clone + 0.2 + j * 0.06) * sa;
        const px = SB.x + 60 + j * 262, py = SB.y + 420;
        text(x, name, px + 60, py, { font: FONT.mono(48, 500), color: on ? css("pink") : gr, alpha: r });
        if (on) tick(x, px + 20, py - 16, 38, r > 0 ? 1 : 0, r);
        else { line(x, px + 4, py - 32, px + 40, py + 4, 4, gr, r); line(x, px + 40, py - 32, px + 4, py + 4, 4, gr, r); }
      });
      text(x, tr("ch09.s.net"), SB.x + 60, SB.y + 560, { font: FONT.cjk(48, 600), alpha: sa * prog(b, AT.clone + 0.45, AT.clone + 0.55) });
      text(x, "ask_visitor · propose_build", SB.x + 60, SB.y + 680, { font: FONT.mono(46, 500), color: gr, alpha: sa * prog(b, AT.ask - 0.1, AT.ask) });

      const ak = prog(b, AT.ask, AT.ask + 0.12, E.outBack);
      card(d, ASK.x, ASK.y, ASK.w, ASK.h, sa * clamp(ak * 3), ak);
      if (ak > 0.9) {
        text(d, "ask_visitor", ASK.x + 40, ASK.y + 66, { font: FONT.mono(46, 600), color: sig, alpha: sa });
        text(d, tr("ch09.a.q"), ASK.x + 40, ASK.y + 140, { font: FONT.cjk(50, 600), alpha: sa, maxW: ASK.w - 80 });
        const pickK = prog(b, AT.answer, AT.answer + 0.05);
        pill(d, ASK.x + 40, ASK.y + 170, 400, 72, tr("ch09.a.o1"), FONT.cjk(44, 600), sa, pickK > 0 ? { fill: css("pink"), color: css("paper") } : {});
        pill(d, ASK.x + 460, ASK.y + 170, 400, 72, tr("ch09.a.o2"), FONT.cjk(44, 600), sa);
      }
      const pk = prog(b, AT.plan, AT.plan + 0.12, E.outBack);
      card(d, PLAN.x, PLAN.y, PLAN.w, PLAN.h, sa * clamp(pk * 3), pk);
      if (pk > 0.9) {
        text(d, "propose_build", PLAN.x + 40, PLAN.y + 66, { font: FONT.mono(46, 600), color: sig, alpha: sa });
        text(d, tr("ch09.p.title"), PLAN.x + 40, PLAN.y + 146, { font: FONT.cjk(52, 600), alpha: sa, maxW: PLAN.w - 80 });
        text(d, tr("ch09.p.rows"), PLAN.x + 40, PLAN.y + 216, { font: FONT.cjk(46, 600), color: gr, alpha: sa, maxW: PLAN.w - 80 });
        text(d, "src/components/live/…", PLAN.x + 40, PLAN.y + 280, { font: FONT.mono(46, 500), color: gr, alpha: sa });
        const gk = prog(b, AT.gh, AT.gh + 0.08);
        if (gk > 0) {
          K.fillRect(d, PLAN.x + 30, PLAN.y + 306, PLAN.w - 60, 60, sig, 0.12 * gk * sa);
          tick(d, PLAN.x + 64, PLAN.y + 336, 30, prog(b, AT.gh + 0.12, AT.gh + 0.2), sa);
          text(d, tr("ch09.p.gh"), PLAN.x + 104, PLAN.y + 352, { font: FONT.cjk(44, 600), alpha: sa * gk, maxW: PLAN.w - 150 });
        }
        const hit = prog(b, AT.build, AT.build + 0.05);
        pill(d, PLAN.x + 40, PLAN.y + 378, 390, 68, "Open issue", FONT.mono(46, 600), sa);
        pill(d, PLAN.x + 470, PLAN.y + 378, 390, 68, "Start build", FONT.mono(46, 600), sa, hit > 0 ? { fill: sig, stroke: sig, color: css("paper") } : {});
        glow(e, PLAN.x + 665, PLAN.y + 412, 140, 0.45 * impact(b, AT.build, 0.3) * sa);
      }
    }

    const BR_Y = 1250, BR_X1 = 3300, PLAN_X = 2600, IMPL_X = 3050;
    const PR = { x: 3330, y: 1190, w: 430, h: 120 };
    const RT = { x: 2830, y: 870, w: 680, h: 170 };
    function history(x, e, b) {
      line(x, FIN_X - 960 - 150, ML, HEAD[0], ML, 3, css("pink"));
      for (const cx of COMMITS) dot(x, cx, ML, 9, css("paper"), css("pink"), 2.6);
      dot(x, HEAD[0], ML, 14, css("signal"), null, 0);
    }
    function build(Ly, b, a) {
      const { x, d, e } = Ly, gr = css("graphite"), sig = css("signal");
      if (a <= 0) return;
      const bk = prog(b, 13.55, 13.75, E.io);
      const pts = [[HEAD[0], ML]];
      for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; pts.push([u * u * u * HEAD[0] + 3 * u * u * t * 2250 + 3 * u * t * t * 2250 + t * t * t * 2400, u * u * u * ML + 3 * u * u * t * ML + 3 * u * t * t * BR_Y + t * t * t * BR_Y]); }
      pts.push([BR_X1, BR_Y]);
      polyline(x, pts, bk, 4, css("pink"), a);
      text(x, "claude/build-<runId>", 2420, BR_Y + 80, { font: FONT.mono(46, 500), alpha: a * prog(b, 13.7, 13.8) });
      const pc = prog(b, AT.planCommit, AT.planCommit + 0.05);
      dot(x, PLAN_X, BR_Y, 12, css("paper"), css("pink"), 3, a * pc);
      text(x, "builds/<runId>.md", PLAN_X, BR_Y - 44, { font: FONT.mono(44, 500), color: gr, align: "center", alpha: a * pc });
      const pr = prog(b, AT.pr, AT.pr + 0.1, E.outBack);
      card(d, PR.x, PR.y, PR.w, PR.h, a * clamp(pr * 3), pr);
      if (pr > 0.9) text(d, "draft PR", PR.x + PR.w / 2, PR.y + 78, { font: FONT.mono(54, 600), align: "center", alpha: a });
      const ra = prog(b, AT.pr + 0.1, AT.upload) * a;
      card(d, RT.x, RT.y, RT.w, RT.h, ra);
      if (ra > 0) {
        text(d, "routine · Claude Code", RT.x + 40, RT.y + 76, { font: FONT.mono(46, 600), alpha: ra, maxW: RT.w - 80 });
        text(d, tr("ch09.b.routine"), RT.x + 40, RT.y + 140, { font: FONT.cjk(44, 600), color: gr, alpha: ra, maxW: RT.w - 80 });
      }
      const uk = prog(b, AT.upload, AT.implCommit, E.io);
      if (uk > 0) {
        K.dashed(x, IMPL_X, RT.y + RT.h, IMPL_X, lerp(RT.y + RT.h, BR_Y - 14, uk), 3, sig, [12, 9], a);
        if (uk >= 1) arrowHead(x, IMPL_X, BR_Y - 14, Math.PI / 2, sig, a);
        text(x, tr("ch09.b.upload"), IMPL_X + 30, 1140, { font: FONT.cjk(44, 600), color: sig, alpha: a * prog(b, AT.upload, AT.upload + 0.1), maxW: 760 });
      }
      const ic = prog(b, AT.implCommit, AT.implCommit + 0.05);
      dot(x, IMPL_X, BR_Y, 12, sig, null, 0, a * ic);
      glow(e, IMPL_X, BR_Y, 80, 0.5 * impact(b, AT.implCommit, 0.3) * a);
      text(x, tr("ch09.b.review"), PR.x, PR.y + PR.h + 76, { font: FONT.cjk(46, 600), color: gr, alpha: a * prog(b, AT.review, AT.review + 0.1) });
      text(x, tr("ch09.b.owner"), PR.x, PR.y + PR.h + 140, { font: FONT.cjk(46, 600), alpha: a * prog(b, AT.owner, AT.owner + 0.1) });
    }

    const PLATE_RECT = [-1700, -1300, 8200, 1900];
    function render(f) {
      BARs = f.BAR;
      const b = f.bar;
      const c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
      const hitS = Math.max(impact(b, AT.accept, 0.1) * 0.5, impact(b, AT.block, 0.1), impact(b, AT.seal, 0.1), impact(b, AT.build, 0.12) * 0.6);
      const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.012 * hitS), rot: 0 };
      G.setCam(cam);
      G.fill(plate, { uGridA: prog(b, 0.05, 0.6) * (1 - prog(b, AT.fade[0], AT.fin[1] - 0.02)), uPlate: PLATE_RECT });

      const x = ink.begin(); ink.cam(cam);
      const d = paperL.begin(); paperL.cam(cam);
      const e = emit.begin(); emit.cam(cam);
      const s = stampL.begin(); stampL.cam(cam);
      const tp = top.begin(); top.cam(cam);
      const Ly = { x, d, e, s, tp };

      const keep = 1 - prog(b, AT.fade[0], AT.fade[1]);
      const cardA = (1 - prog(b, 11.25, 11.45)) * (b < 13.3 ? 1 : 0);
      if (cardA > 0) { d.save(); d.globalAlpha = cardA; chatCard(Ly, b); d.restore(); }
      gates(Ly, b, prog(b, 2.4, 2.7) * (1 - prog(b, 5.3, 5.5)));
      clef(Ly, b, prog(b, 4.8, 5.2) * (1 - prog(b, 7.75, 8.0)));
      tools(Ly, b, prog(b, 7.6, 7.9) * (1 - prog(b, 9.6, 9.8)));
      runner(Ly, MSG, b);
      runner(Ly, CALL, b, 0.8);
      runner(Ly, MCP, b, 0.7);
      sandbox(Ly, b, 1 - prog(b, 13.4, 13.6));
      if (b >= 13.3) { history(x, e, b); build(Ly, b, keep); }

      title(x, b);
      nar(x, "ch09.n1a", 0, prog(b, 1.1, 1.6), win(b, 1.05, 1.15, 2.35, 2.45));
      nar(x, "ch09.n1b", 1, prog(b, 1.6, 2.2), win(b, 1.05, 1.15, 2.35, 2.45));
      nar(x, "ch09.n2a", 0, prog(b, 3.1, 3.6), win(b, 3.05, 3.15, 5.2, 5.3));
      nar(x, "ch09.n2b", 1, prog(b, 3.6, 4.4), win(b, 3.05, 3.15, 5.2, 5.3));
      nar(x, "ch09.n3a", 0, prog(b, 5.55, 6.0), win(b, 5.5, 5.6, 7.6, 7.7));
      nar(x, "ch09.n3b", 1, prog(b, 6.25, 6.8), win(b, 5.5, 5.6, 7.6, 7.7));
      nar(x, "ch09.n4a", 0, prog(b, 8.0, 8.6), win(b, 7.95, 8.05, 9.6, 9.7));
      nar(x, "ch09.n4b", 1, prog(b, 8.9, 9.4), win(b, 7.95, 8.05, 9.6, 9.7));
      nar(x, "ch09.n5a", 0, prog(b, 11.35, 11.9), win(b, 11.3, 11.4, 13.35, 13.45));
      nar(x, "ch09.n5b", 1, prog(b, 11.9, 12.6), win(b, 11.3, 11.4, 13.35, 13.45));
      nar(x, "ch09.n6a", 0, prog(b, 13.6, 14.1), win(b, 13.55, 13.65, 15.3, 15.4));
      nar(x, "ch09.n6b", 1, prog(b, 14.9, 15.2), win(b, 13.55, 13.65, 15.3, 15.4));

      G.composite(ink.upload(), { mode: G.MODE.ink, seed: 3.7 });
      G.composite(paperL.upload(), { mode: G.MODE.paper });
      G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
      G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 6.2 });
      G.composite(top.upload(), { mode: G.MODE.normal });

      const sh = hitS * 6;
      f.post = {
        bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
        shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
        blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
      };
    }
    function init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); paperL = G.layer("paper"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch09", title: "ch.09", bars: 16,
    init() { impl = impl || make(); impl.init(); },
    render(f) { impl.render(f); },
  });
})();
