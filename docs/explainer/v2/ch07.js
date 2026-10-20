(() => {
  function make() {
    const { E, prog, lerp } = K;
    I18N.add({
      "ch07.title": ["对话", "Chat"],
      "ch07.chap": ["第七章", "CHAPTER 7"],
      "ch07.push": ["PUSH START", "PUSH START"],
      "ch07.new": ["开始冒险", "NEW GAME"],
      "ch07.cont": ["继续", "CONTINUE"],
      "ch07.ph": ["Speak, mortal… (type /)", "Speak, mortal… (type /)"],
      "ch07.msg1": ["听过「アイドル」吗？从哲学上讲它为什么火？", "Heard アイドル? Philosophically, why's it a hit?"],
      "ch07.c.label": ["隐私说明", "Privacy notice"],
      "ch07.c.lineup": ["先选阵容", "Pick a lineup"],
      "ch07.c.def": ["默认", "default"],
      "ch07.c.roles": ["杂鱼 · 先知", "Small Fry · Prophet"],
      "ch07.c.dest": ["数据去向", "Where your data goes"],
      "ch07.c.browser": ["当前浏览器", "This browser"],
      "ch07.c.accept": ["接受", "Accept"],
      "ch07.c.decline": ["拒绝", "Decline"],
      "ch07.n1a": ["先选阵容，看清数据去哪；", "Pick a lineup, see where data goes;"],
      "ch07.n1b": ["点接受之前，不发一条对话请求。", "no chat request before you accept."],
      "ch07.g.who": ["是人吗？", "Human?"],
      "ch07.g.human": ["验人", "Human check"],
      "ch07.g.pass": ["通行证 或 Turnstile", "A pass or Turnstile"],
      "ch07.q.r1": ["访客自己的总量", "Your own total"],
      "ch07.q.r2": ["全站路由次数", "Site-wide routing"],
      "ch07.q.r3": ["至少一档有空位", "A tier with room"],
      "ch07.q.if": ["如果超额：", "If over quota:"],
      "ch07.q.stop": ["到此为止，不调 Clef", "It stops here; no Clef call"],
      "ch07.q.cont": ["继续？", "CONTINUE?"],
      "ch07.n2a": ["花钱之前先过闸：验人，再数额度；", "Before any spend: a human check,"],
      "ch07.n2b": ["被挡下就回 429，不再调 Clef。", "then quotas. Blocked: a 429, no Clef."],
      "ch07.k.both": ["同时开工", "Both start at once"],
      "ch07.k.tier": ["档 → 神", "Tier → God"],
      "ch07.k.group": ["分组 → listening", "Group → listening"],
      "ch07.k.pick": ["拾取：", "Picked: "],
      "ch07.n3a": ["Clef 选档的同时，Clairic 开工，", "As Clef picks a tier, Clairic"],
      "ch07.n3b": ["挑出这句话里点名的歌、游戏或番名。", "spots any song, game or show named."],
      "ch07.f.lineup": ["Claude 阵容", "Claude lineup"],
      "ch07.f.full": ["满员", "FULL"],
      "ch07.f.down": ["往下一层", "Step down"],
      "ch07.f.god": ["Fable 5.1 · 神", "Fable 5.1 · God"],
      "ch07.f.prophet": ["Sonnet 5.5 · 先知", "Sonnet 5.5 · Prophet"],
      "ch07.f.fry": ["Haiku 5.5 · 杂鱼", "Haiku 5.5 · Small Fry"],
      "ch07.f.never": ["绝不往上", "Never up"],
      "ch07.n4a": ["选中的档满了，就往下降一档，", "A full tier steps down one,"],
      "ch07.n4b": ["只在同一阵容里降，绝不往上。", "within the lineup, never up."],
      "ch07.t.pre": ["预取", "Prefetch"],
      "ch07.t.first": ["第一次请求模型之前", "before the first model call"],
      "ch07.t.again": ["+ 带「アイドル」多读一次", "+ once more, with アイドル"],
      "ch07.t.game": ["点到游戏：另预取一张游戏卡", "A game: its card is prefetched too"],
      "ch07.t.err": ["Clairic 出错或超时：只少这一次", "Clairic fails: only that read is lost"],
      "ch07.t.same": ["和浏览器看到的同一份", "The same data the browser gets"],
      "ch07.t.client": ["外部 AI 客户端", "External AI clients"],
      "ch07.t.set": ["同一套 SITE_TOOLS", "The same SITE_TOOLS"],
      "ch07.t.no": ["不含要访客确认的工具", "minus visitor-confirmed tools"],
      "ch07.n5a": ["分组可搜，就带这个名字多读一次；", "A searchable group re-reads with the name;"],
      "ch07.n5b": ["Clairic 出错或超时，只少这一次。", "if Clairic fails, only that read is lost."],
      "ch07.n6a": ["工具只读公开模型，和浏览器同一份；", "Tools read the same public model;"],
      "ch07.n6b": ["同一套工具也挂在 /mcp 上。", "the same tools are served on /mcp."],
      "ch07.r.reply": ["先说一句：lyjw 此刻就在听。", "First: lyjw is playing it right now."],
      "ch07.r.now": ["正在听", "NOW PLAYING"],
      "ch07.seal": ["盖章：下一轮只认盖过章的历史", "Sealed: only sealed turns go back in"],
      "ch07.msg2": ["给在听卡加个歌词按钮", "Add a lyrics button to Now Playing"],
      "ch07.n7a": ["回复正常结束，Worker 盖一枚章；", "Each finished reply gets a seal;"],
      "ch07.n7b": ["下一轮只认盖过章的历史。", "only sealed turns go back in."],
      "ch07.d.clef": ["Clef：design → 先知", "Clef: design → Prophet"],
      "ch07.d.worth": ["值得做。", "Worth doing."],
      "ch07.d.session": ["设计会话 · Claude Managed Agents", "Design session · Claude Managed Agents"],
      "ch07.d.arch": ["Opus 5.5 · 规划者", "Opus 5.5 · Architect"],
      "ch07.p.title": ["在听卡加歌词按钮", "Lyrics button on Now Playing"],
      "ch07.p.issue": ["预填表单 · 自己的账号", "prefilled form · your account"],
      "ch07.p.build": ["先看 GitHub 授权说明", "GitHub consent first"],
      "ch07.p.gh": ["同意不保存，用完立即撤销", "Not kept; revoked right after use"],
      "ch07.p.got": ["获得：GitHub 授权", "Got: GitHub consent"],
      "ch07.p.gone": ["用完即撤", "Revoked after use"],
      "ch07.n8a": ["想改站，先知觉得值得才开设计会话；", "Worthy ideas open a design session;"],
      "ch07.n8b": ["Opus 出计划：开 issue，或开工构建。", "Opus plans: open an issue, or build."],
      "ch07.b.plan": ["签名计划", "Signed plan"],
      "ch07.b.pr": ["开 draft PR", "Opens a draft PR"],
      "ch07.b.code": ["Actions 里的 Claude 按计划写代码", "In Actions, Claude codes to the plan"],
      "ch07.b.ro": ["只读，拿不到回传凭据", "read-only, no upload credentials"],
      "ch07.b.pub": ["publish job（不跑 Claude）凭 OIDC 回传", "A publish job (no Claude) uploads via OIDC"],
      "ch07.b.check": ["Worker 校验路径与大小，GitHub App 提交", "Worker checks paths & size; App commits"],
      "ch07.b.review": ["Claude 审查只作参考", "Claude's review is advisory"],
      "ch07.b.owner": ["合不合并：lyjw 决定", "Merging: lyjw decides"],
      "ch07.n9a": ["构建在新分支上开 draft PR，", "A build opens a draft PR;"],
      "ch07.n9b": ["合不合并，由 lyjw 决定。", "merging is lyjw's call."],
      "ch07.mat": ["过了门禁再进门", "Pass the gates first"],
      "ch07.oct": ["OCT", "OCT"],
    });
    const tr = (k) => I18N.tr(k);
    let top, bgL, glowL, ink, cv = null, c = null, F = null;
    const mos = [];
    const ITEM = "アイドル";

    // 拍位和 music/ch07.js 的 AT 是同一张表，两边一起改。
    const AT = {
      crt: [0.03, 0.25], pop: [0.3, 0.45], logo: 0.5, push: [0.5, 0.75], menu: 0.75, pick: 1.25,
      walk1: [1.75, 1.95], box: 1.875, type1: [2.0, 2.45], send1: 2.5, notice: 2.7, lineup: 2.75, cur: 2.85, claude: 3.1, chose: 3.35,
      dest: 3.45, rows: [3.5, 3.75, 4.0, 4.25], ts: [2.8, 4.4], opts: 4.5, accept: 5.0, close: 5.125, enter: [5.3, 5.55], door1: 5.6,
      walk2: [6.0, 6.25], who: [6.3, 6.75], human: 6.6, tick: 6.65, lift: [6.75, 6.95], pass: [6.95, 7.2], quota: [7.25, 7.5, 7.75],
      blk: 8.0, cont: 8.45, clear: 8.65, exit2: [8.75, 9.15],
      walk3: [9.25, 9.45], scroll: 9.5, bang: 9.75, mag: [10.0, 10.4], ledger: [10.25, 10.3, 10.45], grab: [10.5, 10.75],
      point: 12.5, full: 12.75, down: [13.0, 13.1, 13.25, 13.32], door: 13.25, hop: [13.32, 13.45], hand: [13.5, 13.6], never: 13.75,
      winA: 14.625, pre: [14.75, 15.0], run: [15.25, 15.6], back: [15.75, 16.1], game: 16.25, err: 16.5, winAoff: 16.875,
      mon: 17.0, same: 17.25, mcp: 17.75, bots: [18.0, 18.2], tools: [18.25, 18.5],
      reply: [19.3, 19.7], card: 19.5, seal: 20.5, type2: [21.45, 21.85], send2: 21.9,
      clefD: 22.1, worth: [22.25, 22.75], portal: 22.5, arch: [22.75, 22.9], plan: 23.0, opts2: [23.125, 23.25, 23.375], cur2: 23.75, sel2: 24.0,
      gh: 24.0625, okGh: 24.25, item: 24.3, poof: 24.625,
      branch: [25.125, 25.375], c1: 25.5, pr: 25.75, act: 26.0, ro: 26.25, pub: [26.625, 26.875], check: 26.875, c2: 27.0, rev: 27.25, owner: 27.625,
      boxOff: 28.75, despawn: [28.75, 28.9], scroll2: [28.9, 29.3], shrink: [29.3, 29.35], hole: [29.35, 29.5], eyes: 29.55, mosaic: [29.55, 29.97],
    };
    const CUTS = [1.75, 6.0, 9.25, 12.0, 14.5, 19.25, 22.0, 25.0];
    const NAR = [["n1", 2.75, 5.85], ["n2", 6.25, 9.1], ["n3", 9.5, 11.85], ["n4", 12.25, 14.35], ["n5", 14.75, 16.85], ["n6", 17.0, 19.1],
      ["n7", 19.5, 21.35], ["n8", 22.15, 24.8], ["n9", 25.25, 28.6, AT.owner]];
    const INPUTS = [["ch07.msg1", AT.box, AT.type1, AT.send1], ["ch07.msg2", 21.4, AT.type2, AT.send2]];
    const LOG = [["ch07.b.plan", AT.c1], ["ch07.b.pr", AT.pr], ["ch07.b.code", AT.act], ["ch07.b.ro", AT.ro], ["ch07.b.pub", AT.pub[0]],
      ["ch07.b.check", AT.check], ["ch07.b.review", AT.rev], ["ch07.b.owner", AT.owner]];

    // 末帧与 ch08.js 首帧相同：屏幕 y 540 是挂灯笼的 main，HEAD 在 x 1350，提交在 COMMITS。
    // HEAD、COMMITS 照抄 ch08.js 的 Y0、HEAD0、OLD（它们又跟着 ch06.js 的心电图几何）；末帧的大厅照抄 ch08.js 首帧画出的
    // building、lobby、mainLine（同样的种子和排线参数，笔触才一样），那边改了这里一起改。
    const HEAD = [1350, 540], COMMITS = [1250, 1050, 850, 650, 450, 250, 50];

    // 整章按 384×216 的游戏坐标画，直接画在全分辨率图层上：一个游戏像素是对齐到设备像素的方块（1920 宽时 5×5），
    // 字不跟着放大，按屏幕分辨率画。KS 是一个游戏像素占几个设备像素，QX 是震屏的横移（游戏像素）。
    const GW = 384, GH = 216;
    let KS = 5, QX = 0;
    const C = { k: "#000000", w: "#fcfcfc", l: "#bcbcbc", g: "#7c7c7c", d: "#404040", D: "#000058", n: "#0000bc", b: "#0058f8", c: "#3cbcfc", p: "#a4e4fc",
      o: "#d77757", f: "#fca044", y: "#f8b800", u: "#ac7c00", e: "#503000", s: "#fce0a8", r: "#e40058", R: "#a81000", v: "#9878f8", m: "#6844fc", L: "#b8b8f8", G: "#00a800", H: "#58d854" };
    const PL = P.PAL, LEAF = "#7fa46a", POT = "#c46a45", HOLE = "#2a1d1a", RIB = "#ceb7a3", HRIB = "#b8664c";
    // 要读的字用思源黑体子集（Noto Sans SC ch07）配 Geist，代码配 Geist Mono；放大的像素字只留给标题、PUSH START、429 这几处大字。
    // 像素字是 Fusion Pixel 的子集，OFL 保留了这个名字，改过的字体不能再叫它，所以 index.html 里另起名 Ch07 Pixel；只用原生字号（24 是 12 的两倍）。
    // 小字用 700，笔画约一个游戏像素粗，和像素画的线一样；等宽字同字号偏宽，缩到 0.85 倍，代码名牌才放得进画面给它们留的位置。
    const face = (s, k) => (k === "pix" ? `${s}px "Ch07 Pixel ${s === 24 ? 12 : s}"`
      : k === "mono" ? `${s >= 12 ? 500 : 700} ${s * 0.85}px "Geist Mono", "Noto Sans SC ch07", monospace`
      : `${s >= 12 ? 500 : 700} ${s}px Geist, "Noto Sans SC ch07", sans-serif`);

    const on = (b, a, z) => b >= a && b < z;
    const opened = (b, t, d = 0.0625) => prog(b, t, t + d);
    const walk = (b, t0, t1, x0, x1) => Math.round(lerp(x0, x1, prog(b, t0, t1)));
    const bob = (b, t0, t1) => (b > t0 && b < t1 ? Math.floor(b * 16) % 2 : 0);
    const hopH = (b, t0, t1, h) => Math.round(K.hop(b, t0, t1, h));
    const blink = (b, n = 4) => Math.floor(b * n) % 2 === 0;

    function px(x, y, w, h) {
      const x0 = Math.round((x + QX) * KS), y0 = Math.round(y * KS);
      c.fillRect(x0, y0, Math.round((x + w + QX) * KS) - x0, Math.round((y + h) * KS) - y0);
    }
    const R = (x, y, w, h, col) => { if (w <= 0 || h <= 0) return; c.fillStyle = col; px(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    function T(str, x, y, o = {}) {
      const { s = 12, col = C.w, reveal = 1, narr = false, tex = false, k } = o;
      if (!str || reveal <= 0) return 0;
      c.save(); c.setTransform(KS, 0, 0, KS, QX * KS, 0);
      const w = K.text(c, str, Math.round(x), Math.round(y), { font: face(s, k), color: col, reveal, perChar: reveal < 1, fadeIn: false, dim: 0, narration: narr, texture: tex });
      c.restore();
      return w;
    }
    const W = (str, s = 12, k) => Math.ceil(K.measure(c, str, face(s, k)));
    const TC = (str, cx, y, o = {}) => T(str, cx - Math.floor(W(str, o.s ?? 12, o.k) / 2), y, o);

    function box(x, y, w, h, k = 1, fill = C.n, edge = C.w) {
      if (k <= 0) return false;
      x = Math.round(x); w = Math.round(w);
      const hh = Math.max(6, Math.round(h * Math.min(1, k))), yy = Math.round(y + (h - hh) / 2);
      R(x + 1, yy, w - 2, hh, C.k); R(x, yy + 1, w, hh - 2, C.k);
      R(x + 2, yy + 1, w - 4, hh - 2, edge); R(x + 1, yy + 2, w - 2, hh - 4, edge);
      R(x + 3, yy + 3, w - 6, hh - 6, fill);
      return k >= 1;
    }
    function plate(str, cx, by, o = {}) {
      const { s = 10, fg = C.e, bg = C.s, edge = C.k, k } = o;
      const w = W(str, s, k), x = Math.round(cx - w / 2);
      R(x - 3, by - s, w + 6, s + 3, edge); R(x - 2, by - s + 1, w + 4, s + 1, bg);
      T(str, x, by, { s, col: fg, k });
    }
    function bubble(str, cx, by, s = 12) {
      const w = W(str, s) + 10, h = s + 7, x = Math.round(cx - w / 2), y = by - h - 3;
      R(x + 1, y, w - 2, h, C.k); R(x, y + 1, w, h - 2, C.k); R(x + 1, y + 1, w - 2, h - 2, C.w);
      R(cx - 2, y + h - 1, 5, 1, C.w); R(cx - 3, y + h - 1, 1, 2, C.k); R(cx + 3, y + h - 1, 1, 2, C.k);
      R(cx - 2, y + h, 5, 1, C.w); R(cx - 1, y + h + 1, 3, 1, C.w); R(cx - 2, y + h + 1, 1, 1, C.k); R(cx + 2, y + h + 1, 1, 1, C.k); R(cx, y + h + 2, 1, 1, C.k);
      T(str, x + 5, y + h - 4, { s, col: C.k });
    }
    function spr(rows, x, y, map = null, flip = false) {
      x = Math.round(x); y = Math.round(y);
      const wd = rows[0].length;
      for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
        const ch = rows[j][i];
        if (ch === " ") continue;
        c.fillStyle = (map && map[ch]) || C[ch];
        px(flip ? x + wd - 1 - i : x + i, y + j, 1, 1);
      }
    }
    function sprS(rows, x, y, k, map = null) {
      for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
        const ch = rows[j][i];
        if (ch !== " ") R(x + i * k, y + j * k, k, k, (map && map[ch]) || C[ch]);
      }
    }
    function ln(x0, y0, x1, y1, col) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      c.fillStyle = col;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        px(x0, y0, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    function oval(cx, cy, rx, ry, col) {
      c.fillStyle = col;
      for (let dy = -ry; dy <= ry; dy++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2))); px(Math.round(cx) - hw, Math.round(cy) + dy, 2 * hw + 1, 1); }
    }
    const disc = (cx, cy, r, col) => oval(cx, cy, r, r, col);
    function ring(cx, cy, r, col) {
      c.fillStyle = col;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = Math.hypot(dx, dy); if (d <= r + 0.35 && d > r - 0.85) px(Math.round(cx) + dx, Math.round(cy) + dy, 1, 1); }
    }
    // 星星和地上的碎点都是纹理：落在字的方框里就不画（holes 是 [x0, y0, x1, y1]）。
    const inHole = (x, y, holes) => holes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
    function stars(b, h, seed, holes = []) {
      for (let i = 0; i < 40; i++) {
        const t = K.hash(i * 1.7 + Math.floor(b * 4) * 0.37 + seed), x = Math.floor(K.hash(i * 3.17 + seed) * GW), y = Math.floor(K.hash(i * 7.31 + seed + 1) * h);
        if (t > 0.25 && !inHole(x, y, holes)) R(x, y, 1, 1, t > 0.85 ? C.w : C.g);
      }
    }
    const textBox = (str, x, y, s = 12, pad = 2, k) => [x - pad, y - s - pad, x + W(str, s, k) + pad, y + pad + 2];

    const CUR = ["w   ", "ww  ", "www ", "wwww", "www ", "ww  ", "w   "];
    const DOWN = ["wwwww", " www ", "  w  "];
    const UP = ["   w   ", "  www  ", " wwwww ", "wwwwwww", "  www  ", "  www  ", "  www  "];
    const TICK = ["      w", "     ww", "w   ww ", "ww ww  ", " www   ", "  w    "];
    const CROSS = ["rr   rr", " rr rr ", "  rrr  ", " rr rr ", "rr   rr"];
    const ENV = ["kkkkkkkkkkk", "kwlwwwwwlwk", "kwwlwwwlwwk", "kwwwlwlwwwk", "kwwwwowwwwk", "kwwwwwwwwwk", "kwwwwwwwwwk", "kkkkkkkkkkk"];
    const PAWN = ["  kkkk  ", " kllllk ", " kllllk ", " kllllk ", "  kllk  ", "  kllk  ", " kllllk ", "kllllllk", "kllllllk", "kllllllk", "kkkkkkkk"];
    const PHAT = ["  k  ", " kdk ", "kdddk"];
    const KEY = [" yyy      ", "yu uyyyyyy", "yu uy  y y", " yyy      "];
    const LOCK = [" kkk ", "k   k", "kkkkk", "kyyyk", "kyuyk", "kkkkk"];
    const SCROLL = ["kkkkkkk", "ksssssk", "kseeesk", "ksssssk", "kkkkkkk"];
    const SPROUT = ["H H", " G ", " G "];
    const WIZ = ["     k      ", "    kbk     ", "    kbbk    ", "   kbybk    ", "   kbbbbk   ", "  kbbbbbk   ", "  kbbbbbbk  ", " kbbbbbbbbk ", "kkkkkkkkkkkk"];
    const WIZ1 = ["   k    ", "  kbk   ", "  kbyk  ", " kbbbk  ", " kbbbbk ", "kkkkkkkk"];
    const CROWN = ["y   y   y", "yy yyy yy", "yyyyyyyyy", "yryyryyry", "yyyyyyyyy"];
    const HARD = ["     kkkkkk     ", "    kyyyyyyk    ", "   kyyywyyyyk   ", "  kyyyyyyyyyyk  ", "kyyyyyyyyyyyyyyk", "kkkkkkkkkkkkkkkk"];
    const MAG = [" kkkk   ", "kpwppk  ", "kwpppk  ", "kppppk  ", "kppppk  ", " kkkkk  ", "     kk ", "      kk"];
    const BANG = [" kkkkkkkk ", "kwwwwwwwwk", "kwwwrrwwwk", "kwwwrrwwwk", "kwwwrrwwwk", "kwwwwwwwwk", "kwwwrrwwwk", "kwwwwwwwwk", " kkkkkkkk ", "    kwk   ", "     k    "];
    const QMARK = [" kkkkkkkk ", "kwwwwwwwwk", "kwwwyywwwk", "kwwywwywwk", "kwwwwwywwk", "kwwwwywwwk", "kwwwwwwwwk", "kwwwwywwwk", " kkkkkkkk ", "    kwk   ", "     k    "];
    const SPEAR = ["  l  ", " lwl ", " lwl ", " lwl ", "  l  "];
    const FLAME = [
      ["   r   ", "  rr   ", "  rfr  ", " rffr  ", " rfyfr ", "rffyffr", "rfyyyfr", "rfyyyfr", " rfyfr ", "  rrr  "],
      ["  r    ", "  rr   ", " rffr  ", " rffr  ", "rfyffr ", "rfyyfr ", "rffyyfr", "rfyyyfr", " rfyfr ", "  rrr  "],
      ["    r  ", "   rr  ", "  rffr ", "  rfffr", " rffyfr", " rfyyfr", "rffyyfr", "rfyyyfr", " rfyfr ", "  rrr  "],
    ];
    const LANT = ["  hhhh  ", " zqqqqz ", "zqjqqjqz", "zqjqqjqz", "zqjqqjqz", "zqjqqjqz", "zqjqqjqz", " zqqqqz ", "  hhhh  "];
    const HLANT = ["   hhhh   ", "  hhhhhh  ", " zOOOOOOz ", "zOOjOOjOOz", "zOOjOOjOOz", "zOOjOOjOOz", "zOOjOOjOOz", "zOOjOOjOOz", "zOOjOOjOOz", " zOOOOOOz ", "  zOOOOz  ", "   hhhh   "];
    const LMAP = { h: PL.woodD, z: PL.line, q: PL.cream, j: RIB, O: PL.clawd, g: PL.gold };
    const HMAP = { ...LMAP, j: HRIB };
    const GMAP = { ...LMAP, q: PL.gold, j: "#c99a3c" };

    // Clawd 的格子出自 ../clawd.js：18 列 × 6 行，每格宽 q、高 2q；q = 2 时是 36×24 个游戏像素。
    function clawd(cx, bottom, q = 2, o = {}) {
      const { pose = "default", crouch = 0, flip = false, body = C.o, clipR = 1e9, prop = null } = o;
      const { body: B, eyes: EY } = window.Clawd.cells(pose, crouch);
      const x0 = Math.round(cx - 9 * q), y0 = Math.round(bottom - 12 * q);
      const put = (list, col) => {
        c.fillStyle = col;
        for (const [qx, qy] of list) { const x = x0 + (flip ? 17 - qx : qx) * q, w = Math.min(q, clipR - x); if (w > 0) px(x, y0 + qy * 2 * q, w, 2 * q); }
      };
      put(B, body); put(EY, C.k);
      const hx = Math.round(cx), hy = y0 + crouch * 2 * q;
      if (prop === "wiz") spr(WIZ, hx - 6, hy - 8);
      else if (prop === "wiz1") spr(WIZ1, hx - 4, hy - 5);
      else if (prop === "crown") spr(CROWN, hx - 4, hy - 5);
      else if (prop === "hard") spr(HARD, hx - 8, hy - 5);
      else if (prop === "sprout") spr(SPROUT, hx - 1, hy - 3);
    }
    // 不是 Claude 的角色（守卫、Clef、Clairic、跑腿的 Worker）画成小人，免得和 Clawd 混。
    function chibi(cx, bottom, o) {
      const { robe, trim = robe, skin = C.s, hat = null, face = 0, monocle = false } = o;
      cx = Math.round(cx); bottom = Math.round(bottom);
      const hy = bottom - 18;
      R(cx - 6, bottom - 2, 5, 2, C.k); R(cx + 1, bottom - 2, 5, 2, C.k);
      R(cx - 7, bottom - 13, 14, 11, C.k); R(cx - 6, bottom - 12, 12, 10, robe); R(cx - 1, bottom - 12, 2, 10, trim);
      R(cx - 8, bottom - 9, 2, 3, C.k); R(cx + 6, bottom - 9, 2, 3, C.k); R(cx - 7, bottom - 8, 1, 1, skin); R(cx + 6, bottom - 8, 1, 1, skin);
      if (hat === "hood") { disc(cx, hy, 7, C.k); disc(cx, hy, 6, robe); R(cx - 1, hy - 9, 2, 3, robe); R(cx - 1, hy - 10, 2, 1, C.k); disc(cx + face, hy + 1, 4, skin); }
      else { disc(cx, hy, 6, C.k); disc(cx, hy, 5, skin); }
      R(cx - 3 + face, hy, 1, 2, C.k); R(cx + 2 + face, hy, 1, 2, C.k);
      if (monocle) { R(cx + 1 + face, hy - 2, 3, 1, C.y); R(cx + 1 + face, hy + 2, 3, 1, C.y); R(cx + face, hy - 1, 1, 3, C.y); R(cx + 4 + face, hy - 1, 1, 3, C.y); }
      if (hat === "helm") {
        for (let dy = -6; dy <= -1; dy++) { const hw = Math.round(Math.sqrt(36 - dy * dy)); R(cx - hw, hy + dy, 2 * hw + 1, 1, dy === -6 ? C.k : C.l); }
        R(cx - 6, hy - 1, 13, 1, C.d); R(cx - 1, hy - 10, 2, 4, C.r);
      } else if (hat === "cap") {
        for (let dy = -6; dy <= -2; dy++) { const hw = Math.round(Math.sqrt(36 - dy * dy)); R(cx - hw, hy + dy, 2 * hw + 1, 1, dy === -6 ? C.k : C.c); }
        R(cx - 7 + face * 4, hy - 2, 15, 1, C.k); R(cx - 1, hy - 5, 2, 2, C.w);
      } else if (hat === "beret") {
        for (let dy = -7; dy <= -3; dy++) { const hw = Math.round(Math.sqrt(49 - dy * dy)); R(cx - hw, hy + dy, 2 * hw + 1, 1, dy === -7 ? C.k : C.b); }
        R(cx, hy - 9, 1, 2, C.k); R(cx + 3, hy - 6, 1, 1, C.y);
      }
    }
    function dashes(x0, x1, y, b, col, dir = -1) {
      const off = Math.floor(b * 64) % 6;
      c.fillStyle = col;
      for (let x = x0 + (dir < 0 ? 6 - off : off); x < x1; x += 6) px(x, y, 3, 1);
    }
    function spinner(cx, cy, b) {
      const i0 = Math.floor(b * 16) % 8;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; R(cx + Math.round(Math.cos(a) * 4), cy + Math.round(Math.sin(a) * 4), 1, 1, i === i0 ? C.w : i === (i0 + 7) % 8 ? C.l : C.g); }
    }
    function quake(b) {
      for (const t of [AT.lift[1], AT.blk, AT.full, AT.seal, AT.item]) if (b >= t && b < t + 0.06) return F.frame % 2 ? 1 : -1;
      return 0;
    }
    function fadeAt(b) {
      let a = 0;
      for (const t of CUTS) {
        if (b >= t - 0.125 && b < t) a = Math.max(a, (b - t + 0.125) / 0.125);
        else if (b >= t && b < t + 0.125) a = Math.max(a, 1 - (b - t) / 0.125);
      }
      return Math.round(a * 4) / 4;
    }

    // 0 · 标题：第 06 章的横线成了显像管开机那一道亮线，笔尖那一点跳起来变成 Clawd。
    function sTitle(b) {
      R(0, 0, GW, GH, C.k);
      if (b < AT.crt[0]) { R(0, 107, GW, 2, C.w); R(268, 106, 4, 4, C.o); return; }
      const half = Math.max(1, Math.round(108 * prog(b, AT.crt[0], AT.crt[1], E.out))), cy0 = Math.round((108 - half) * KS);
      c.save(); c.beginPath(); c.rect(0, cy0, c.canvas.width, Math.round((108 + half) * KS) - cy0); c.clip();
      const ly = -Math.round(36 * (1 - prog(b, AT.logo, AT.logo + 0.125, E.out))), t = tr("ch07.title"), sub = "Talk to God · ai Worker · Clef · Claude";
      const pushX = 192 - Math.floor(W(tr("ch07.push"), 8, "pix") / 2), holes = [];
      if (b >= AT.logo) holes.push(textBox(tr("ch07.chap"), 32, 46 + ly, 10), [28, 50 + ly, 38 + W(t, 24, "pix"), 82 + ly], textBox(sub, 32, 94, 10, 2, "mono"));
      if (on(b, ...AT.push)) holes.push(textBox(tr("ch07.push"), pushX, 146, 8, 2, "pix"));
      stars(b, 104, 3, holes);
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(K.hash(i * 5.3 + 9) * GW), y = 112 + Math.floor(K.hash(i * 2.9 + 4) * 96);
        if (!inHole(x, y, holes) && !inHole(x + 1, y, holes)) R(x, y, 2, 1, C.d);
      }
      R(0, 107, GW, 2, C.w);
      if (b >= AT.logo) {
        T(tr("ch07.chap"), 32, 46 + ly, { s: 10, col: C.f });
        T(t, 34, 78 + ly, { s: 24, col: C.n, k: "pix" }); T(t, 32, 76 + ly, { s: 24, k: "pix" });
        T(sub, 32, 94, { s: 10, col: C.l, reveal: prog(b, AT.logo + 0.125, AT.push[1]), k: "mono" });
      }
      c.restore();
      if (half < 108) { R(0, 107 - half, GW, 1, C.l); R(0, 108 + half, GW, 1, C.l); }
      const [p0, p1] = AT.pop;
      if (b < p0) R(268, 106, 4, 4, C.o);
      else {
        const pose = b < p1 ? "arms-up" : on(b, AT.menu, AT.pick) ? (blink(b) ? "look-left" : "look-right") : on(b, AT.pick, AT.pick + 0.25) ? "arms-up" : "default";
        clawd(270, 107 - hopH(b, p0, p1, 22) - hopH(b, AT.pick, AT.pick + 0.125, 6), b < p0 + 0.04 ? 1 : 2, { pose });
        if (on(b, p1, p1 + 0.08)) { R(244, 104, 3, 2, C.g); R(294, 104, 3, 2, C.g); R(240, 101, 2, 2, C.d); R(299, 101, 2, 2, C.d); }
      }
      if (on(b, ...AT.push) && blink(b, 8)) T(tr("ch07.push"), pushX, 146, { s: 8, k: "pix" });
      if (box(140, 122, 104, 40, opened(b, AT.menu))) {
        const sel = b >= AT.pick && blink(b, 16);
        T(tr("ch07.new"), 160, 138, { col: sel ? C.y : C.w });
        T(tr("ch07.cont"), 160, 154, { col: C.g });
        if (blink(b) || b >= AT.pick) spr(CUR, 150, 131, sel ? { w: C.y } : null);
      }
    }

    // 1 · 神殿门口：隐私说明。消息先举在 Clawd 头上，点接受之后才带进门。
    function sTemple(b) {
      R(0, 0, GW, 152, C.D); stars(b, 90, 11);
      disc(334, 28, 8, C.s); disc(338, 25, 7, C.D);
      R(0, 152, GW, 64, C.d); R(0, 152, GW, 1, C.g);
      for (let i = 0; i < 25; i++) { R(i * 16, 155, 13, 3, C.g); R(i * 16 + 8, 160, 13, 3, C.g); }
      for (let i = 0; i < 3; i++) { R(116 - i * 4, 140 + i * 4, 152 + i * 8, 4, C.l); R(116 - i * 4, 143 + i * 4, 152 + i * 8, 1, C.g); }
      for (const x of [122, 154, 218, 250]) {
        R(x, 60, 12, 80, C.l); R(x + 9, 60, 3, 80, C.g); R(x + 3, 62, 1, 76, C.g); R(x + 6, 62, 1, 76, C.g);
        R(x - 2, 56, 16, 4, C.w); R(x - 2, 59, 16, 1, C.g); R(x - 2, 136, 16, 4, C.w);
      }
      R(108, 46, 168, 10, C.w); R(108, 54, 168, 2, C.g);
      for (let y = 22; y < 46; y++) { const hw = Math.round(((y - 22) / 24) * 86); R(192 - hw, y, 2 * hw, 1, C.l); R(192 - hw, y, 2, 1, C.g); R(192 + hw - 2, y, 2, 1, C.g); }
      R(158, 33, 68, 13, C.y); R(159, 34, 66, 11, C.e); TC("Talk to God", 192, 43, { s: 10, col: C.y });
      R(174, 98, 36, 42, C.g); for (let y = 84; y < 98; y++) { const hw = Math.round(Math.sqrt(Math.max(0, 324 - (98 - y) ** 2))); R(192 - hw, y, 2 * hw, 1, C.g); }
      R(176, 100, 32, 40, C.k); for (let y = 86; y < 100; y++) { const hw = Math.round(Math.sqrt(Math.max(0, 256 - (100 - y) ** 2))); R(192 - hw, y, 2 * hw, 1, C.k); }
      if (on(b, AT.enter[1], AT.door1 + 0.2)) R(180, 104, 24, 36, C.e);
      for (const tx of [92, 292]) {
        R(tx - 1, 122, 3, 30, C.u); R(tx - 6, 118, 13, 4, C.e); R(tx - 5, 122, 11, 1, C.k);
        spr(FLAME[Math.floor(b * 12 + tx) % 3], tx - 3, 108);
      }
      if (b < AT.door1) {
        let x = walk(b, AT.walk1[0], AT.walk1[1], -20, 150), y = 152;
        if (b >= AT.enter[0]) { x = walk(b, AT.enter[0], AT.enter[1], 150, 192); y = 152 - 4 * Math.min(3, Math.floor(prog(b, AT.enter[0], AT.enter[1]) * 4)); }
        y -= bob(b, ...AT.walk1) + bob(b, ...AT.enter);
        const hold = b >= AT.send1;
        clawd(x, y, 2, { pose: hold ? "arms-up" : "default" });
        if (hold) spr(ENV, x - 5, y - 33 - (b < AT.send1 + 0.06 ? 3 : 0));
      }
      if (box(24, 4, 336, 156, opened(b, AT.notice) * (1 - prog(b, AT.close, AT.close + 0.0625)))) notice(b);
    }
    function lineupCard(x, y, kind, b) {
      const chosen = kind === 1 && b >= AT.chose, hov = b >= AT.cur && (kind === 1) === (b >= AT.claude);
      box(x, y, 140, 50, 1, C.k, chosen ? C.y : hov ? C.w : C.g);
      const name = kind ? "Claude" : "DeepSeek";
      T(name, x + 8, y + 14, { s: 10 });
      if (!kind) T(tr("ch07.c.def"), x + 14 + W(name, 10), y + 14, { s: 10, col: C.c });
      const j = chosen ? hopH(b, AT.chose, AT.chose + 0.125, 4) : 0;
      if (!kind) { spr(PAWN, x + 26, y + 22); spr(PAWN, x + 58, y + 22); spr(PHAT, x + 59, y + 19); }
      else { clawd(x + 30, y + 33 - j, 1, { prop: "sprout" }); clawd(x + 62, y + 33 - j, 1, { prop: "wiz1" }); }
      T(tr("ch07.c.roles"), x + 8, y + 45, { s: 10, col: C.l });
      if (hov && (blink(b) || chosen)) spr(CUR, x - 8, y + 20, chosen ? { w: C.y } : null);
    }
    function notice(b) {
      T(tr("ch07.c.label"), 36, 21);
      T("Turnstile", 334 - W("Turnstile", 8), 19, { s: 8, col: C.l });
      if (b >= AT.ts[1]) spr(TICK, 341, 13, { w: C.H }); else spinner(344, 16, b);
      if (b >= AT.lineup) {
        T(tr("ch07.c.lineup"), 36, 37, { s: 10, col: C.y });
        lineupCard(44, 42, 0, b); lineupCard(200, 42, 1, b);
      }
      if (b >= AT.dest) {
        T(tr("ch07.c.dest"), 36, 106, { s: 10, col: C.y });
        ["Cloudflare Workers", "Workers AI · Clef", "Anthropic · Claude API", tr("ch07.c.browser")].forEach((s, i) => {
          if (b < AT.rows[i]) return;
          const x = i % 2 ? 200 : 44, y = 120 + Math.floor(i / 2) * 14;
          R(x - 7, y - 6, 3, 3, C.c); T(s, x, y, { s: 10 });
        });
      }
      if (b >= AT.opts) {
        const flash = b >= AT.accept && blink(b, 16);
        T(tr("ch07.c.accept"), 144, 152, { col: flash ? C.y : C.w }); T(tr("ch07.c.decline"), 216, 152, { col: C.l });
        if (b >= AT.accept || blink(b)) spr(CUR, 135, 144, flash ? { w: C.y } : null);
      }
    }

    // 2 · 城门：城头的守卫问「是人吗」（通行证或 Turnstile），闸门升起；ChatQuota 三道额度一项一项打勾；超额就是 429 的「继续？」。
    // 城楼的砖缝按城楼左上角对齐，Clawd 穿过门洞后把两根门柱重画一遍盖住它，看起来是从门洞里穿过去的。
    function stone(x0, y0, w, h) {
      R(x0, y0, w, h, C.l);
      for (let y = y0; y < y0 + h; y++) {
        const r = Math.floor((y - 20) / 6);
        if ((y - 20) % 6 === 0) { R(x0, y, w, 1, C.g); continue; }
        for (let x = x0; x < x0 + w; x++) if ((((x - 166 - (r % 2) * 6) % 12) + 12) % 12 === 0) R(x, y, 1, 1, C.g);
      }
    }
    const archHW = (y) => (y >= 104 ? 18 : Math.round(Math.sqrt(Math.max(0, 324 - (104 - y) ** 2))));
    function sGate(b) {
      R(0, 0, GW, 152, C.D); stars(b, 56, 23);
      const gy = Math.round(24 * prog(b, AT.pass[0], AT.pass[0] + 0.1));
      chibi(248, 64 + gy, { robe: C.b, trim: C.y, hat: "helm", face: -1 });
      R(237, 30 + gy, 1, 34, C.u); spr(SPEAR, 235, 25 + gy);
      R(0, 64, GW, 88, C.g);
      for (let y = 64, r = 0; y < 152; y += 8, r++) { R(0, y, GW, 1, C.d); for (let x = (r % 2) * 8; x < GW; x += 16) R(x, y, 1, 8, C.d); }
      for (let x = 0; x < GW; x += 16) { R(x, 56, 10, 8, C.g); R(x, 56, 10, 1, C.l); R(x + 9, 56, 1, 8, C.d); }
      R(0, 64, GW, 1, C.l);
      R(0, 152, GW, 64, C.e);
      for (let i = 0; i < 40; i++) R(Math.floor(K.hash(i * 1.3 + 2) * GW), 154 + Math.floor(K.hash(i * 4.1) * 11), 2, 1, C.u);
      stone(166, 20, 52, 132);
      for (const mx of [166, 188, 210]) { stone(mx, 12, 8, 8); R(mx, 12, 8, 1, C.w); }
      R(164, 12, 2, 140, C.d); R(218, 12, 2, 140, C.d);
      const top0 = 86 - Math.round(70 * prog(b, AT.lift[0], AT.lift[1], E.io));
      for (let y = 86; y < 152; y++) {
        const hw = archHW(y);
        R(192 - hw, y, 2 * hw, 1, C.k);
        if (y < top0 || y >= top0 + 66) continue;
        if ((y - top0) % 16 === 8) R(192 - hw, y, 2 * hw, 1, C.g);
        for (let x = 177; x < 210; x += 6) if (Math.abs(x - 192) < hw) R(x, y, 2, 1, y === top0 + 65 ? C.w : C.l);
      }
      let x = walk(b, AT.walk2[0], AT.walk2[1], -20, 138);
      if (b >= AT.pass[0]) x = walk(b, AT.pass[0], AT.pass[1], 138, 270);
      if (b >= AT.exit2[0]) x = walk(b, AT.exit2[0], AT.exit2[1], 270, 420);
      const y = 152 - bob(b, ...AT.walk2) - bob(b, ...AT.pass) - bob(b, ...AT.exit2);
      clawd(x, y, 2, { pose: "arms-up" }); spr(ENV, x - 5, y - 33);
      stone(166, 86, 8, 66); stone(210, 86, 8, 66); R(164, 86, 2, 66, C.d); R(218, 86, 2, 66, C.d);
      if (on(b, ...AT.who)) bubble(tr("ch07.g.who"), 248, 34);
      const h1 = tr("ch07.g.human"), h2 = tr("ch07.g.pass"), hw = Math.max(W(h1), W(h2, 10)) + 40;
      if (box(8, 6, hw, 40, opened(b, AT.human))) {
        T(h1, 18, 22); T(h2, 18, 38, { s: 10, col: C.l });
        if (b >= AT.tick) spr(TICK, 8 + hw - 17, 13, { w: C.H });
      }
      const rows = ["ch07.q.r1", "ch07.q.r2", "ch07.q.r3"].map(tr), head = "ChatQuota.admitVisitor";
      const qw = Math.max(W(head, 10, "mono"), ...rows.map((s) => W(s, 10) + 14)) + 24, qx = 378 - qw;
      if (box(qx, 6, qw, 74, opened(b, AT.pass[1]))) {
        T(head, qx + 12, 21, { s: 10, col: C.c, k: "mono" });
        rows.forEach((s, i) => {
          const ry = 38 + i * 15, done = b >= AT.quota[i];
          R(qx + 12, ry - 8, 9, 9, C.w); R(qx + 13, ry - 7, 7, 7, C.n);
          if (done) spr(TICK, qx + 13, ry - 7, { w: C.H });
          T(s, qx + 26, ry, { s: 10, col: done ? C.w : C.l });
        });
      }
      const pk = opened(b, AT.blk) * (1 - prog(b, AT.clear, AT.clear + 0.0625));
      if (pk > 0) { c.globalAlpha = 0.5; R(0, 0, GW, GH, C.k); c.globalAlpha = 1; }
      if (box(84, 40, 216, 112, pk, C.k)) {
        T(tr("ch07.q.if"), 96, 58, { s: 10, col: C.l });
        TC("429", 192, 90, { s: 24, col: C.r, k: "pix" });
        TC("Too many prayers.", 192, 106, { s: 10 });
        TC(tr("ch07.q.stop"), 192, 122, { s: 10, col: C.l });
        if (b >= AT.cont) {
          const t = tr("ch07.q.cont"), w = W(t), x0 = 192 - Math.floor((w + 10) / 2);
          T(t, x0, 142);
          if (blink(b)) spr(CUR, x0 + w + 6, 135);
        }
      }
    }

    // 3a · 旅店柜台：Clef（掌柜，记档次和分组）与 Clairic（鉴定师，从这句话里捡出点名的名字）同时开工。
    function sInn(b) {
      R(0, 0, GW, 152, C.u);
      for (let y = 0, r = 0; y < 112; y += 12, r++) { R(0, y + 11, GW, 1, C.e); for (let x = (r % 3) * 37; x < GW; x += 111) R(x, y, 1, 12, C.e); }
      R(8, 56, 40, 36, C.e); R(11, 59, 34, 30, C.D); R(27, 59, 2, 30, C.e); R(11, 73, 34, 2, C.e);
      R(16, 64, 1, 1, C.w); R(37, 82, 1, 1, C.l); disc(39, 65, 3, C.s);
      for (const sy of [72, 96]) {
        R(334, sy, 46, 3, C.e);
        for (let i = 0; i < 5; i++) { const h = 5 + (i % 3) * 2; R(337 + i * 9, sy - h, 5, h, [C.r, C.G, C.c, C.y, C.v][i % 5]); R(338 + i * 9, sy - h, 1, 1, C.w); }
      }
      R(22, 0, 1, 8, C.k); R(18, 8, 9, 10, C.k); R(19, 9, 7, 8, blink(b, 6) ? C.y : C.f);
      R(0, 152, GW, 64, C.e); for (let y = 157; y < 216; y += 6) R(0, y, GW, 1, C.u);
      chibi(156, 118, { robe: C.b, trim: C.w, hat: "beret" });
      chibi(246, 118, { robe: C.m, trim: C.v, hat: "hood", monocle: true });
      R(56, 112, 284, 3, C.s); R(56, 115, 284, 37, C.u); R(56, 115, 284, 1, C.e);
      for (let x = 56; x <= 340; x += 40) R(x, 118, 1, 32, C.e);
      R(56, 150, 284, 2, C.e);
      plate("Clef", 156, 138); plate("Clairic", 246, 138);
      const cx = walk(b, AT.walk3[0], AT.walk3[1], -20, 92), cy = 152 - bob(b, ...AT.walk3), put = b >= AT.scroll;
      clawd(cx, cy, 2, { pose: put ? "default" : "arms-up" });
      if (!put) spr(ENV, cx - 5, cy - 33);
      else if (b < AT.scroll + 0.125) spr(ENV, 116, 104);
      const m = tr("ch07.msg1"), mw = W(m) + 20, sx = 192 - Math.floor(mw / 2), i0 = m.indexOf(ITEM);
      const ix = sx + 10 + Math.floor(K.measure(c, m.slice(0, Math.max(0, i0)), face(12))), iw = W(ITEM);
      if (box(sx, 28, mw, 22, opened(b, AT.scroll), C.s, C.e)) {
        if (b >= AT.grab[0] && i0 >= 0) R(ix - 1, 32, iw + 1, 14, C.y);
        T(m, sx + 10, 43, { col: C.e });
        if (on(b, ...AT.mag)) {
          const lx = Math.round(lerp(sx + 12, sx + mw - 12, prog(b, ...AT.mag, E.io))), ly = 37;
          ring(lx, ly, 7, C.k); ring(lx, ly, 6, C.p); ln(lx + 5, ly + 5, lx + 9, ly + 9, C.e); ln(lx + 6, ly + 5, lx + 10, ly + 9, C.e);
        }
      }
      if (on(b, AT.bang, AT.bang + 0.45)) { spr(BANG, 151, 81); spr(BANG, 241, 81); }
      const both = tr("ch07.k.both"), bw = W(both) + 24;
      if (box(192 - Math.floor(bw / 2), 4, bw, 21, opened(b, AT.bang + 0.0625))) TC(both, 192, 19);
      const l1 = tr("ch07.k.tier"), l2 = tr("ch07.k.group"), lw = Math.max(W(l1, 10), W(l2, 10)) + 24;
      if (box(190 - lw, 52, lw, 31, opened(b, AT.ledger[0]))) {
        if (b >= AT.ledger[1]) T(l1, 202 - lw, 65, { s: 10 });
        if (b >= AT.ledger[2]) T(l2, 202 - lw, 78, { s: 10 });
      }
      const pk = tr("ch07.k.pick"), pw = W(pk + ITEM, 10) + 24, tx = 214 + W(pk, 10);
      if (box(202, 52, pw, 31, opened(b, AT.grab[0]))) {
        T(pk, 214, 72, { s: 10 });
        if (b >= AT.grab[1]) T(ITEM, tx, 72, { s: 10, col: C.y });
      }
      if (on(b, ...AT.grab) && i0 >= 0) {
        const k = prog(b, ...AT.grab, E.io), fx = Math.round(lerp(ix, tx, k)), fy = Math.round(lerp(43, 72, k)), fw = W(ITEM, 10);
        R(fx - 3, fy - 11, fw + 6, 15, C.y); R(fx - 2, fy - 10, fw + 4, 13, C.k);
        T(ITEM, fx, fy, { s: 10, col: C.y });
      }
    }

    // 3b · 三层客栈：同一阵容三档一层一层。Clef 指的神那层门口挂着满员，就下楼到先知那层，绝不往上；右边一栏是招牌。
    const FLOORS = [{ y1: 54, bg: C.L, prop: "crown", key: "ch07.f.god" }, { y1: 98, bg: C.v, prop: "wiz", key: "ch07.f.prophet" }, { y1: 142, bg: C.s, prop: "sprout", key: "ch07.f.fry" }];
    function stairs(xTop, yTop) { for (let i = 0; i < 11; i++) { const sx = xTop - 4 * (i + 1), sy = yTop + 4 * i; R(sx, sy, 4, 4, C.e); R(sx, sy, 4, 1, C.u); } }
    function sFloors(b) {
      R(0, 0, GW, GH, C.D);
      stars(b, 150, 31, [textBox("Clef", 4, 24, 8, 3), [20, 18, 30, 34]]);
      R(0, 146, GW, 70, C.d);
      R(30, 8, 274, 140, C.e);
      const got = b >= AT.hand[1];
      FLOORS.forEach((fl, i) => {
        const y0 = fl.y1 - 40, name = tr(fl.key);
        R(36, y0, 160, 40, fl.bg); R(200, y0, 98, 40, C.g);
        R(196, y0, 4, 40, C.e);
        if (i === 1 && b >= AT.door) R(196, fl.y1 - 26, 4, 26, C.k); else { R(196, fl.y1 - 26, 4, 26, C.u); R(197, fl.y1 - 14, 1, 2, C.y); }
        clawd(166, fl.y1, 2, { prop: fl.prop });
        if (i === 0) for (const [k, [sx, sy]] of [[146, 24], [157, 18], [177, 19], [189, 27]].entries()) if (blink(b + k * 0.13, 8)) R(sx, sy, 1, 1, C.w);
        plate(name, 40 + Math.ceil(W(name, 10) / 2) + 3, y0 + 12, { fg: C.w, bg: C.n });
      });
      if (got) spr(ENV, 176, 80);
      stairs(298, 58); stairs(298, 102);
      plate(tr("ch07.f.lineup"), 343, 17, { fg: C.y, bg: C.k, edge: C.y });
      if (b >= AT.point) {
        if (blink(b, 8) || b >= AT.full) spr(CUR.map((r) => r.replace(/w/g, "y")), 22, 27);
        T("Clef", 4, 24, { s: 8, col: C.y });
      }
      if (b >= AT.full) {
        const fu = tr("ch07.f.full"), fw = W(fu, 10) + 8, fx = 343 - Math.floor(fw / 2), sy = 44 - (b < AT.full + 0.06 ? 2 : 0);
        R(304, 26, fx + fw - 300, 2, C.e); R(fx + 3, 28, 1, sy - 39, C.e); R(fx + fw - 4, 28, 1, sy - 39, C.e);
        R(fx - 1, sy - 11, fw + 2, 15, C.k); R(fx, sy - 10, fw, 13, C.r); T(fu, fx + 4, sy, { s: 10 });
      }
      let hx = 236, hy = 54;
      if (b >= AT.down[0]) hx = walk(b, AT.down[0], AT.down[1], 236, 290);
      if (b >= AT.down[1]) { const k = prog(b, AT.down[1], AT.down[2]); hx = Math.round(lerp(290, 254, k)); hy = 54 + 4 * Math.floor(k * 11); }
      if (b >= AT.down[2]) { hx = walk(b, AT.down[2], AT.down[3], 254, 216); hy = 98; }
      if (b >= AT.hop[0]) { hx = walk(b, ...AT.hop, 216, 206); hy = 98 - hopH(b, ...AT.hop, 8); }
      const moving = on(b, AT.down[0], AT.down[3]);
      clawd(hx, hy - (moving ? Math.floor(b * 16) % 2 : 0), 2, { pose: on(b, AT.hand[0], AT.hand[1] + 0.1) ? "arms-up" : "default", flip: b >= AT.down[2] });
      if (b < AT.hand[0]) spr(ENV, hx - 5, hy - 33);
      else if (b < AT.hand[1]) { const k = prog(b, ...AT.hand); spr(ENV, Math.round(lerp(hx - 5, 176, k)), Math.round(lerp(hy - 33, 80, k))); }
      const dn = tr("ch07.f.down"), dw = W(dn, 10) + 26;
      if (box(380 - dw, 64, dw, 19, opened(b, AT.down[0]))) { T(dn, 392 - dw, 77, { s: 10 }); spr(DOWN, 368, 72); }
      if (b >= AT.never) {
        const nv = tr("ch07.f.never"), nw = W(nv, 10) + 34;
        if (box(380 - nw, 108, nw, 19, opened(b, AT.never))) { T(nv, 392 - nw, 121, { s: 10 }); spr(UP, 363, 113); ln(361, 112, 371, 122, C.r); ln(362, 112, 372, 122, C.r); }
      }
    }

    // 4 · 街上：模型开口之前，跑腿的 Worker 先去 core 的档案馆把预取读回来；镜头再往右走，同一座档案馆也给浏览器看，同一套工具也挂在 /mcp 上。
    function archive(X) {
      const x0 = X(236);
      R(x0, 104, 96, 48, C.l);
      for (let y = 104, r = 0; y < 152; y += 6, r++) { R(x0, y, 96, 1, C.g); for (let x = x0 + (r % 2) * 8; x < x0 + 96; x += 16) R(x, y, 1, 6, C.g); }
      R(x0 - 6, 98, 108, 6, C.w); R(x0 - 6, 103, 108, 1, C.g);
      for (const wx of [X(244), X(304)]) { R(wx, 112, 22, 16, C.e); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) R(wx + 2 + i * 7, 114 + j * 7, 5, 4, (i + j) % 2 ? C.s : C.l); }
      R(X(274), 128, 20, 24, C.e); R(X(276), 130, 16, 22, C.k);
      plate("core · PublicStatus", X(284), 97, { fg: C.e, bg: C.s, k: "mono" });
    }
    function sStreet(b) {
      const cam = Math.round(136 * prog(b, AT.mon, AT.mon + 0.25, E.io)), X = (wx) => Math.round(wx - cam);
      R(0, 0, GW, 152, C.D); stars(b, 80, 41);
      R(0, 152, GW, 64, C.d); R(0, 152, GW, 1, C.g);
      for (let y = 70; y < 92; y++) { const hw = Math.round(((y - 70) / 22) * 62); R(X(58) - hw, y, 2 * hw, 1, C.R); }
      R(X(0), 92, 116, 60, C.u); R(X(0), 92, 116, 2, C.e);
      R(X(6), 102, 104, 50, C.s); R(X(6), 102, 104, 1, C.e);
      clawd(X(44), 152, 2, { prop: "wiz" });
      R(X(28), 136, 36, 3, C.e); R(X(30), 139, 2, 13, C.e); R(X(60), 139, 2, 13, C.e);
      if (b >= AT.back[1]) { spr(SCROLL, X(32), 131); spr(SCROLL, X(41), 131); }
      clawd(X(88), 152, 2, {});
      archive(X);
      R(X(175), 112, 2, 40, C.u); plate("PUBLIC_STATUS", X(176), 112, { s: 8, k: "mono" });
      let px = 128, face = 1, inside = false;
      if (b >= AT.run[0]) px = walk(b, ...AT.run, 128, 284);
      if (b >= AT.run[1]) inside = b < AT.back[0];
      if (b >= AT.back[0]) { px = walk(b, ...AT.back, 284, 128); face = b < AT.back[1] ? -1 : 1; }
      const py = 152 - bob(b, ...AT.run) - bob(b, ...AT.back);
      if (!inside) chibi(X(px), py, { robe: C.G, trim: C.H, hat: "cap", face });
      if (on(b, AT.back[0], AT.back[1] + 0.05)) { spr(SCROLL, X(px) - 8, py - 32); spr(SCROLL, X(px) + 1, py - 32); }
      if (b >= AT.mon) {
        const mx = X(362);
        R(mx + 16, 136, 4, 14, C.g); R(mx + 10, 150, 16, 2, C.g);
        R(mx, 112, 36, 26, C.l); R(mx + 2, 114, 32, 22, C.k);
        R(mx + 4, 116, 12, 8, C.o); R(mx + 18, 116, 14, 3, C.c); R(mx + 18, 121, 10, 3, C.l); R(mx + 4, 126, 28, 2, C.g); R(mx + 4, 130, 20, 2, C.g);
        dashes(X(332), mx, 124, b, C.y, 1);
      }
      const t1 = tr("ch07.t.pre"), t2 = tr("ch07.t.first");
      const rowsA = [["get_site_status · listening", AT.pre[0], C.w, "mono"], [tr("ch07.t.again"), AT.pre[1], C.w], [tr("ch07.t.game"), AT.game, C.c], [tr("ch07.t.err"), AT.err, C.c]];
      const aw = Math.max(W(t1) + 8 + W(t2, 10), ...rowsA.map((r) => W(r[0], 10, r[3]))) + 24;
      if (box(8, 4, aw, 80, opened(b, AT.winA) * (1 - prog(b, AT.winAoff, AT.winAoff + 0.0625)))) {
        T(t1, 20, 19, { col: C.y }); T(t2, 28 + W(t1), 19, { s: 10, col: C.l });
        rowsA.forEach(([s, t, col, k], i) => T(s, 20, 35 + i * 14, { s: 10, col, reveal: prog(b, t, t + 0.1), k }));
      }
      const same = tr("ch07.t.same"), sw = W(same) + 24;
      if (box(8, 4, sw, 21, opened(b, AT.same))) T(same, 20, 19);
      const r1 = tr("ch07.t.set"), r2 = tr("ch07.t.no"), mw = Math.max(W("POST /mcp", 12, "mono"), W(r1, 10), W(r2, 10)) + 24;
      if (box(378 - mw, 30, mw, 52, opened(b, AT.mcp))) {
        T("POST /mcp", 390 - mw, 45, { col: C.y, k: "mono" });
        T(r1, 390 - mw, 60, { s: 10, reveal: prog(b, AT.tools[0], AT.tools[0] + 0.1) });
        T(r2, 390 - mw, 73, { s: 10, col: C.l, reveal: prog(b, AT.tools[1], AT.tools[1] + 0.1) });
      }
      if (b >= AT.bots[0]) {
        for (const [i, tx] of [[0, 450], [1, 474]]) {
          const rx = X(walk(b, ...AT.bots, 540 + i * 24, tx)), ry = 152 - bob(b, ...AT.bots);
          R(rx - 5, ry - 18, 10, 8, C.k); R(rx - 4, ry - 17, 8, 6, C.l); R(rx - 2, ry - 15, 1, 2, C.c); R(rx + 1, ry - 15, 1, 2, C.c);
          R(rx, ry - 21, 1, 3, C.k); R(rx - 1, ry - 22, 3, 1, C.r);
          R(rx - 6, ry - 10, 12, 8, C.k); R(rx - 5, ry - 9, 10, 6, C.g); R(rx - 4, ry - 2, 3, 2, C.k); R(rx + 1, ry - 2, 3, 2, C.k);
        }
        const cl = tr("ch07.t.client"), cw = W(cl, 10), cx = X(462) - Math.floor(cw / 2);
        R(cx - 4, 153, cw + 8, 12, C.k); T(cl, cx, 163, { s: 10, col: C.y });
      }
    }

    // 5 · 回到对话卡：先知回复、show_card 画一张在听卡（主题在这里唱），回复正常结束时盖章，也就是存档。
    function sChat(b) {
      R(0, 0, GW, GH, C.k); stars(b, 166, 57);
      box(8, 4, 368, 158, 1);
      T("Talk to God", 20, 18, { s: 10, col: C.l }); R(11, 23, 362, 1, C.g);
      const m1 = tr("ch07.msg1"), w1 = W(m1) + 12;
      R(365 - w1, 28, w1 - 2, 18, C.o); R(364 - w1, 29, w1, 16, C.o); T(m1, 370 - w1, 41);
      if (b >= AT.reply[0]) { clawd(27, 62, 1, { prop: "wiz1" }); T(tr("ch07.f.prophet"), 42, 60, { s: 10, col: C.c }); }
      T(tr("ch07.r.reply"), 20, 78, { reveal: prog(b, ...AT.reply) });
      if (b >= AT.card) {
        box(20, 86, 200, 46, 1, C.k, C.l);
        R(26, 92, 32, 34, C.m); for (let i = 0; i < 8; i++) R(26 + i * 4, 92, 2, 34, i % 2 ? C.r : C.v); disc(42, 109, 9, C.k); disc(42, 109, 7, C.f); disc(42, 109, 2, C.k);
        T(tr("ch07.r.now"), 64, 100, { s: 10, col: C.c }); T(ITEM, 64, 115); T("YOASOBI", 64, 127, { s: 10, col: C.l });
        const h = F.hit("bell", 0.12);
        for (let i = 0; i < 3; i++) { const bh = 2 + Math.round((4 + 3 * Math.sin(b * 37 + i * 2)) * (0.4 + 0.6 * h)); R(196 + i * 5, 126 - bh, 3, bh, C.H); }
      }
      if (b >= AT.seal) {
        const r = Math.round(lerp(16, 10, prog(b, AT.seal, AT.seal + 0.04)));
        disc(252, 108, r + 1, C.k); disc(252, 108, r, C.R); ring(252, 108, r - 2, C.r); spr(TICK, 249, 105, { w: C.w });
      }
      if (b >= AT.seal + 0.08 && b < AT.send2) T(tr("ch07.seal"), 20, 150, { s: 10, col: C.y, reveal: prog(b, AT.seal + 0.08, AT.seal + 0.2) });
      if (b >= AT.send2) { const m2 = tr("ch07.msg2"), w2 = W(m2) + 12; R(365 - w2, 138, w2 - 2, 18, C.o); R(364 - w2, 139, w2, 16, C.o); T(m2, 370 - w2, 151); }
    }

    // 6 · 先知的塔：值得做才开 start_design 的传送门，Opus 规划者出来递计划卡；GitHub 授权是一件用完就没的道具。
    function sTower(b) {
      R(0, 0, GW, 152, C.m);
      for (let y = 0, r = 0; y < 152; y += 10, r++) { R(0, y + 9, GW, 1, C.v); for (let x = (r % 2) * 14; x < GW; x += 28) R(x, y, 1, 10, C.v); }
      disc(38, 64, 17, C.e); disc(38, 64, 15, C.D); R(37, 49, 2, 30, C.e); R(23, 63, 30, 2, C.e); R(30, 56, 1, 1, C.w); R(46, 71, 1, 1, C.w);
      R(0, 152, GW, 64, C.e); R(0, 152, GW, 1, C.u);
      for (const kx of [16, 168]) { R(kx - 2, 132, 5, 20, C.w); R(kx - 4, 150, 9, 2, C.u); spr(FLAME[Math.floor(b * 12 + kx) % 3], kx - 3, 121); }
      const itemOn = on(b, AT.item, AT.poof);
      clawd(52, 152, 2, { pose: itemOn ? "arms-up" : "default" });
      clawd(108, 152, 2, { prop: "wiz", flip: true });
      if (b >= AT.portal) {
        const k = prog(b, AT.portal, AT.portal + 0.125), ph = Math.floor(b * 12);
        for (let i = 0; i < 4; i++) {
          const rx = Math.round((15 - i * 3.5) * k), ry = Math.round((22 - i * 5) * k);
          if (rx > 0 && ry > 0) oval(268, 128, rx, ry, [C.w, C.L, C.v, C.k][(i + ph) % 4]);
        }
        oval(268, 128, Math.round(4 * k), Math.round(8 * k), C.k);
        if (k >= 1) plate("start_design", 268, 101, { fg: C.L, bg: C.k, edge: C.L, k: "mono" });
      }
      if (b >= AT.arch[0]) {
        const ax = walk(b, ...AT.arch, 268, 204);
        clawd(ax, 152 - bob(b, ...AT.arch), 2, { prop: "hard", flip: true });
        const an = tr("ch07.d.arch");
        if (b >= AT.arch[1]) plate(an, Math.min(204, 247 - Math.ceil(W(an, 10) / 2)), 117, { fg: C.w, bg: C.k, edge: C.y });
      }
      if (on(b, ...AT.worth)) bubble(tr("ch07.d.worth"), 108, 116);
      const cd = tr("ch07.d.clef"), cw = W(cd, 10) + 24;
      if (box(8, 4, cw, 19, opened(b, AT.clefD))) T(cd, 20, 17, { s: 10 });
      const se = tr("ch07.d.session"), sw = W(se, 10) + 24;
      if (box(378 - sw, 4, sw, 19, opened(b, AT.arch[0]))) T(se, 390 - sw, 17, { s: 10, col: C.y });
      if (box(64, 26, 256, 64, opened(b, AT.plan) * (1 - prog(b, AT.item - 0.0625, AT.item)))) {
        T(tr("ch07.p.title"), 76, 42, { col: C.y, reveal: prog(b, AT.opts2[0], AT.opts2[0] + 0.1) });
        if (b >= AT.opts2[1]) { T("Open issue", 84, 62); T(tr("ch07.p.issue"), 92 + W("Open issue"), 62, { s: 10, col: C.l }); }
        if (b >= AT.opts2[2]) { T("Start build", 84, 80); T(tr("ch07.p.build"), 92 + W("Start build"), 80, { s: 10, col: C.l }); }
        const flash = b >= AT.sel2 && blink(b, 16);
        if (b >= AT.opts2[1] && (blink(b) || b >= AT.sel2)) spr(CUR, 75, b >= AT.cur2 ? 73 : 55, flash ? { w: C.y } : null);
      }
      const g1 = tr("ch07.p.gh"), gw = W(g1, 10) + 28, gx = 192 - Math.floor(gw / 2);
      if (box(gx, 56, gw, 38, opened(b, AT.gh) * (1 - prog(b, AT.item - 0.0625, AT.item)))) {
        T(g1, gx + 14, 71, { s: 10 });
        const ok = b >= AT.okGh && blink(b, 16);
        T(tr("ch07.c.accept"), gx + 26, 88, { col: ok ? C.y : C.w });
        if (blink(b) || b >= AT.okGh) spr(CUR, gx + 16, 81, ok ? { w: C.y } : null);
      }
      if (itemOn) sprS(KEY, 42, 116 - Math.round(8 * prog(b, AT.item, AT.item + 0.08)), 2);
      if (on(b, AT.poof, AT.poof + 0.15)) { const k = Math.floor(prog(b, AT.poof, AT.poof + 0.15) * 3); for (const [dx, dy] of [[-6, -3], [6, -3], [-3, 4], [4, 4]]) R(52 + dx * (k + 1) / 2 - 1, 112 + dy * (k + 1) / 2 - 1, 3 - k, 3 - k, C.l); }
      const got = b < AT.poof ? tr("ch07.p.got") : tr("ch07.p.gone"), gtw = W(got) + 24;
      if (box(192 - Math.floor(gtw / 2), 30, gtw, 21, opened(b, AT.item) * (1 - prog(b, AT.poof + 0.25, AT.poof + 0.3125)))) TC(got, 192, 45, { col: b < AT.poof ? C.y : C.w });
    }

    // 7 · 一楼大厅（第 08 章那间屋子的 8 位版）：从 HEAD 分出构建分支，构建日志一行一行往上滚。
    const wireY = (wx) => { const k = ((((wx + 80) % 80) + 80) % 80) / 80; return 98 + Math.round(3.6 * 4 * k * (1 - k)); };
    function pxLobby(cx, b, eyes) {
      const X = (wx) => Math.round(wx - cx);
      R(0, 0, GW, 143, PL.wall);
      for (let y = 6, r = 0; y < 138; y += 12, r++) for (let wx = Math.floor(cx / 24) * 24 - 24 + (r % 2) * 12; wx < cx + GW + 24; wx += 24) { const x = X(wx); R(x, y, 1, 1, PL.wallD); R(x + 1, y + 1, 1, 1, PL.wallD); R(x + 2, y + 2, 1, 1, PL.wallD); }
      R(0, 0, GW, 1, PL.line); R(X(344), 0, 32, 1, "#3e2a2c"); R(X(347), 0, 1, 1, PL.woodD); R(X(373), 0, 1, 1, PL.woodD);
      R(0, 143, GW, 9, PL.cream); R(0, 143, GW, 1, PL.line); R(0, 151, GW, 1, PL.line);
      R(0, 152, GW, 64, PL.floor);
      [166, 183, 201, 222].reduce((prev, py, r) => {
        R(0, py, GW, 1, PL.woodD);
        for (let wx = Math.floor(cx / 104) * 104 - 104 + (r % 2) * 52; wx < cx + GW; wx += 104) R(X(wx), prev + 1, 1, py - prev - 1, PL.woodD);
        return py;
      }, 152);
      const KX = X(328);
      R(KX, 48, 40, 39, PL.line); R(KX + 1, 49, 38, 37, PL.paper); R(KX + 1, 49, 38, 10, PL.red); R(KX + 1, 59, 38, 1, PL.line); R(KX + 19, 46, 2, 3, PL.red);
      T(tr("ch07.oct"), KX + 20 - Math.floor(W(tr("ch07.oct"), 8) / 2), 57, { s: 8, col: PL.cream, tex: true });
      for (let i = 0; i < 21; i++) R(KX + 4 + (i % 7) * 5, 66 + Math.floor(i / 7) * 7, 2, 2, PL.ink);
      R(KX + 32, 71, 6, 1, PL.red); R(KX + 32, 76, 6, 1, PL.red); R(KX + 31, 72, 1, 4, PL.red); R(KX + 38, 72, 1, 4, PL.red);
      const HX = X(284);
      for (let y = 134; y < 152; y++) { const dy = 143 - y, hw = y >= 143 ? 9 : Math.round(Math.sqrt(81 - dy * dy)); R(HX - hw, y, 2 * hw, 1, HOLE); }
      if (eyes) { R(X(280), 144, 2, 4, PL.moon); R(X(285), 144, 2, 4, PL.moon); }
      const MX = X(196);
      for (let y = 176; y < 191; y++) { const hw = Math.round(lerp(36, 42, (y - 176) / 14)); R(MX - hw - 1, y, 2 * hw + 2, 1, PL.line); R(MX - hw, y, 2 * hw, 1, PL.teal); }
      R(MX - 33, 179, 66, 1, PL.cream); R(MX - 37, 188, 74, 1, PL.cream);
      const PX = X(42);
      for (let i = 0; i < 5; i++) { const an = -Math.PI / 2 + (i - 2) * 0.45, lx = PX + Math.round(Math.cos(an) * 12), ly = 128 + Math.round(Math.sin(an) * 10); oval(lx, ly, 5, 11, PL.line); oval(lx, ly, 4, 10, LEAF); }
      for (let y = 136; y < 152; y++) { const hw = Math.round(lerp(10, 8, (y - 136) / 16)); R(PX - hw, y, 2 * hw, 1, PL.line); R(PX - hw + 1, y, 2 * hw - 2, 1, POT); }
      R(PX - 10, 136, 20, 1, PL.line);
      for (let x = 0; x < GW; x++) R(x, wireY(x + cx), 1, 1, PL.line);
      for (let n = Math.floor(cx / 80) * 80; n < cx + GW + 80; n += 80) R(X(n) - 1, 97, 3, 3, PL.woodD);
      for (const sx of COMMITS) { const wx = sx / 5, x = X(wx); R(x, wireY(wx) + 1, 1, 103 - wireY(wx) - 1, PL.line); spr(LANT, x - 4, 103, LMAP); }
      const hx = X(HEAD[0] / 5);
      for (let dy = -17; dy <= 17; dy++) for (let dx = -17; dx <= 17; dx++) {
        const d = Math.hypot(dx, dy);
        if ((d > 8 && d <= 12 && (dx + dy) % 2 === 0) || (d > 12 && d <= 17 && dx % 2 === 0 && dy % 2 === 0)) R(hx + dx, 108 + dy, 1, 1, PL.moon);
      }
      R(hx, wireY(HEAD[0] / 5) + 1, 1, 102 - wireY(HEAD[0] / 5) - 1, PL.line); spr(HLANT, hx - 5, 102, HMAP);
    }
    function lamp(x, y, k) { if (k <= 0) return; R(x, 93, 1, y - 93, PL.line); spr(LANT, x - 4, y + (k < 1 ? 2 : 0), GMAP); }
    function build(b, cx) {
      const X = (wx) => Math.round(wx - cx), pts = [[270, 99], [284, 92], [560, 92]];
      let left = (14 + 276) * prog(b, ...AT.branch);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay), k = Math.min(1, left / d);
        ln(X(ax), ay, X(lerp(ax, bx, k)), lerp(ay, by, k), PL.red); ln(X(ax), ay + 1, X(lerp(ax, bx, k)), lerp(ay, by, k) + 1, PL.red);
        left -= d;
      }
      if (b >= AT.branch[1]) plate("claude/build-<runId>", X(424), 88, { s: 8, fg: PL.red, bg: PL.cream, edge: PL.line, k: "mono" });
      lamp(X(316), 95, prog(b, AT.c1, AT.c1 + 0.04));
      if (b >= AT.c1) plate("builds/<runId>.md", X(316), 117, { s: 8, fg: PL.ink, bg: PL.cream, edge: PL.line, k: "mono" });
      if (b >= AT.pr) { const fx = X(480); R(fx, 70, 1, 22, PL.line); R(fx + 1, 70, 40, 11, PL.red); R(fx + 2, 71, 38, 9, PL.cream); T("draft PR", fx + 4, 78, { s: 8, col: PL.red }); }
      if (b >= AT.act) {
        R(X(388), 136, 44, 3, PL.woodD); R(X(390), 139, 2, 13, PL.woodD); R(X(428), 139, 2, 13, PL.woodD);
        R(X(396), 118, 26, 18, PL.line); R(X(398), 120, 22, 14, PL.ink);
        for (let i = 0; i < 4; i++) R(X(400), 122 + i * 3, 4 + Math.floor(K.hash(i + Math.floor(b * 8)) * 14), 1, PL.teal);
        clawd(X(450), 152, 2, { prop: "hard", flip: true, pose: blink(b, 8) ? "default" : "arms-up" });
      }
      if (b >= AT.ro) spr(LOCK, X(407), 110);
      if (b >= AT.pub[0]) {
        R(X(436), 104, 10, 8, PL.line); R(X(437), 105, 8, 6, PL.teal); R(X(439), 107, 4, 2, PL.cream);
        if (b < AT.pub[1]) {
          const k = prog(b, ...AT.pub), seg = k < 0.5 ? [[409, 118], [441, 108], k * 2] : [[441, 108], [404, 96], k * 2 - 1];
          R(X(lerp(seg[0][0], seg[1][0], seg[2])) - 1, Math.round(lerp(seg[0][1], seg[1][1], seg[2])) - 1, 3, 3, PL.gold);
        }
      }
      lamp(X(404), 95, prog(b, AT.c2, AT.c2 + 0.04));
      if (b >= AT.rev) {
        const rx = walk(b, AT.rev, AT.rev + 0.1, 560, 520);
        clawd(X(rx), 152 - hopH(b, AT.rev, AT.rev + 0.1, 6), 2, { flip: true });
        spr(MAG, X(rx) - 22, 128, null, true);
      }
      if (b >= AT.owner && (blink(b, 8) || b >= AT.owner + 0.25)) spr(QMARK, X(526), 64);
    }
    function sLobby(b) {
      const cx = Math.round(lerp(160, 0, prog(b, ...AT.scroll2, E.io)));
      pxLobby(cx, b, b >= AT.eyes);
      if (b < AT.despawn[0] || (b < AT.despawn[1] && blink(b, 32))) build(b, cx);
      if (b < AT.hole[1]) {
        const small = b >= AT.shrink[1] || (on(b, ...AT.shrink) && blink(b, 64));
        const wx = walk(b, ...AT.hole, 236, 292), clip = Math.round(275 - cx);
        clawd(Math.round(wx - cx), 152 - bob(b, ...AT.hole), small ? 1 : 2, { flip: true, clipR: b >= AT.hole[0] ? clip : 1e9 });
      }
      const lk = opened(b, AT.c1 - 0.0625) * (1 - prog(b, AT.despawn[0], AT.despawn[0] + 0.0625));
      // 日志窗只留三行，下沿停在日历的钉子上面，日历不被挡一半。
      if (box(8, 1, 368, 44, lk)) {
        const shown = LOG.filter(([, t]) => b >= t).slice(-3);
        shown.forEach(([key, t], i) => {
          const last = i === shown.length - 1;
          T(tr(key), 20, 15 + i * 12, { s: 10, col: key === "ch07.b.owner" ? C.y : last ? C.w : C.l, reveal: prog(b, t, t + 0.1) });
        });
      }
    }

    function narBox(b) {
      if (!box(4, 166, 376, 46, opened(b, AT.box) * (1 - prog(b, AT.boxOff, AT.boxOff + 0.0625)))) return;
      for (const [key, t0, [ta, tb], ts] of INPUTS) {
        if (b < t0 || b >= ts) continue;
        const s = [...tr(key)], shown = s.slice(0, Math.floor(prog(b, ta, tb) * s.length + 1e-6)).join("");
        if (b < ta) T(tr("ch07.ph"), 16, 184, { col: C.l }); else T(shown, 16, 184);
        if (blink(b, 8)) R(17 + (b < ta ? 0 : W(shown)), 174, 2, 12, C.o);
        return;
      }
      for (const [id, t0, t1, tbAt] of NAR) {
        if (b < t0 || b >= t1) continue;
        const A = tr(`ch07.${id}a`), B = tr(`ch07.${id}b`), na = [...A].length, nb = [...B].length;
        const da = tbAt ? 0.3 : (0.5 * na) / (na + nb), db = tbAt ? 0.3 : (0.5 * nb) / (na + nb), tb = tbAt ?? t0 + da;
        T(A, 16, 184, { reveal: prog(b, t0, t0 + da), narr: true });
        T(B, 16, 201, { reveal: prog(b, tb, tb + db), narr: true });
        if (b >= tb + db && blink(b)) spr(DOWN, 366, 203);
        return;
      }
    }
    function scene(b) {
      if (b < CUTS[0]) sTitle(b);
      else if (b < CUTS[1]) sTemple(b);
      else if (b < CUTS[2]) sGate(b);
      else if (b < CUTS[3]) sInn(b);
      else if (b < CUTS[4]) sFloors(b);
      else if (b < CUTS[5]) sStreet(b);
      else if (b < CUTS[6]) sChat(b);
      else if (b < CUTS[7]) sTower(b);
      else sLobby(b);
    }
    function game(b) {
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
      KS = c.canvas.width / GW; QX = 0;
      R(0, 0, GW, GH, C.k);
      c.save(); QX = quake(b);
      scene(b);
      QX = 0; c.restore();
      const fa = fadeAt(b);
      if (fa > 0) { c.globalAlpha = fa; R(0, 0, GW, GH, C.k); c.globalAlpha = 1; }
      narBox(b);
    }

    // 末尾：8 位大厅按 5、4、3、2 个屏幕像素一格逐级变细，最后一档就是第 08 章首帧的彩铅大厅。
    const GROUND = 760, BX0 = -400, NAIL = 400;
    const WALLT = { ang: 0.42, w: 3, len: 120, lite: 0.62, dark: 0.2, darkShare: 0.45, a0: 0.45, a1: 0.9, dens: 1.5, jit: 0.05 };
    const FLOORT = { ang: -0.3, w: 3.6, len: 90, lite: 0.35, dark: 0.18, darkShare: 0.5, a0: 0.35, a1: 0.7, dens: 1.2, jit: 0.06 };
    const wireP = (px) => { const k = ((((px - BX0) % NAIL) + NAIL) % NAIL) / NAIL; return 490 + 18 * 4 * k * (1 - k); };
    function pencilLobby(w, g, x) {
      const PAL = PL;
      P.fill(w, P.rect(-80, GROUND, 2080, 440), "#a7c184", { edge: 0, line: false, tile: { ang: 1.4, w: 3, len: 30, dens: 1.4, jit: 0.4 } });
      P.fill(w, P.rect(-80, GROUND + 4, 2080, 440), PAL.floor, { edge: 0, line: false, tile: FLOORT });
      w.save(); w.beginPath(); w.rect(-80, GROUND, 2080, 400); w.clip();
      w.strokeStyle = PAL.woodD; w.globalAlpha = 0.45; w.lineWidth = 2.6;
      for (let r = 0, py = GROUND + 70; py < 1160; r++, py += 78 + r * 6) {
        w.beginPath(); w.moveTo(-80, py); w.lineTo(2000, py + 2); w.stroke();
        for (let px = Math.floor(-80 / 520) * 520 + (r % 2) * 260; px < 2000; px += 520) { w.beginPath(); w.moveTo(px, py - 76 - r * 6 + 4); w.lineTo(px + 2, py); w.stroke(); }
      }
      w.restore();
      P.fill(w, P.rect(BX0, -2680, 6200, GROUND + 2680), "#d6bf9b", { edge: 12, lw: 4, seed: 501, tile: { w: 4, len: 80, lite: 0.3, dark: 0.16 } });
      P.fill(w, P.rect(-320, 0, 6040, GROUND), PAL.wall, { edge: 14, lw: 3.6, seed: 511, tile: WALLT });
      P.fill(w, P.rect(-320, GROUND - 44, 6040, 44), PAL.cream, { edge: 5, lw: 2.6, seed: 13, tile: { lite: 0.2, dark: 0.1, a0: 0.2, a1: 0.4 } });
      P.fill(w, P.rect(1720, -80, 160, 80), "#3e2a2c", { edge: 0, lw: 3, seed: 506, flat: true });
      for (const lx of [1736, 1864]) P.seg(w, lx, -80, lx, 0, 5, PAL.woodD, 0.9, lx);
      P.halo(g, HEAD[0], HEAD[1], 120, 0.7);
      const cx = 1640, cy = 240;
      P.note(x, cx, cy, 200, 196, { seed: 3, tape: false, pin: true, rot: 0.02 });
      P.fill(x, P.rect(cx, cy, 200, 52), PAL.red, { edge: 4, lw: 3, seed: 4 });
      P.text(x, tr("ch07.oct"), cx + 100, cy + 42, { size: 40, color: PAL.cream, align: "center", texture: true });
      for (let i = 0; i < 21; i++) P.text(x, String(i + 6), cx + 14 + (i % 7) * 26, cy + 90 + Math.floor(i / 7) * 36, { size: 20, color: PAL.ink, texture: true });
      P.contour(x, P.ellipse(cx + 14 + 6 * 26 + 9, cy + 90 + 36 - 10, 20, 17).pts, { color: PAL.red, w: 3, seed: 5, corners: false });
      const hole = [[1374, GROUND + 4], [1374, 714]];
      for (let i = 1; i < 12; i++) { const an = Math.PI + (i / 12) * Math.PI; hole.push([1420 + 46 * Math.cos(an), 714 + 46 * Math.sin(an)]); }
      hole.push([1466, 714], [1466, GROUND + 4]);
      P.fill(x, P.polyShape(hole), HOLE, { edge: 0, lw: 3, seed: 321, flat: true });
      for (const ex of [1406, 1430]) { x.save(); x.fillStyle = PAL.moon; K.roundRect(x, ex - 4, 721, 8, 18, 3); x.fill(); x.restore(); }
      x.save(); x.translate(980, 916); x.scale(1, 0.82);
      P.fill(x, P.polyShape([[-180, -44], [180, -44], [210, 44], [-210, 44]]), PAL.teal, { edge: 8, lw: 3, seed: 322, shadow: [0, 10, 0.3], tile: { w: 4, len: 20, dens: 1.6, jit: 0.9 } });
      P.contour(x, [[-160, -30], [160, -30], [184, 30], [-184, 30]], { color: PAL.cream, w: 3, alpha: 0.7, seed: 323 });
      P.text(x, tr("ch07.mat"), 0, 16, { size: 42, color: PAL.cream, align: "center", maxW: 330 });
      x.restore();
      P.fill(x, P.polyShape([[160, 680], [260, 680], [248, 760], [172, 760]]), POT, { edge: 5, lw: 3, seed: 324, shade: [-10, 0, 0.5] });
      for (let i = 0; i < 5; i++) { const an = -Math.PI / 2 + (i - 2) * 0.45; P.fill(x, P.ellipse(210 + Math.cos(an) * 60, 640 + Math.sin(an) * 50, 22, 48), LEAF, { edge: 5, lw: 2.6, seed: 325 + i, shade: [-6, 0, 0.5] }); }
      const pts = [];
      for (let px = -120; px <= 2040; px += 25) pts.push([px, wireP(px)]);
      P.line(x, pts, 1, 3, PAL.line, 0.85, 7);
      for (let nx = 0; nx <= 2040; nx += NAIL) P.fill(x, P.ellipse(nx, 490, 7), PAL.woodD, { edge: 2, lw: 2, seed: nx, flat: true });
      [...COMMITS, HEAD[0]].forEach((lx, i) => {
        const head = lx === HEAD[0], r = head ? 26 : 20, ly = HEAD[1], seed = 600 + i * 11;
        P.seg(x, lx, wireP(lx), lx, ly - r * 1.15, 2.4, PAL.line, 0.9, seed);
        P.fill(x, P.rect(lx - r * 0.55, ly - r * 1.18, r * 1.1, r * 0.3), PAL.woodD, { edge: 2, lw: 2, seed: seed + 1 });
        P.fill(x, P.ellipse(lx, ly, r, r * 1.15), head ? PAL.clawd : PAL.cream, { alpha: 1, edge: r * 0.25, lw: 2.4, seed: seed + 2, tile: { w: Math.max(2, r * 0.25), len: r * 1.4 } });
        for (const s of [-0.5, 0.5]) P.contour(x, P.ellipse(lx + s * r * 0.3, ly, r * 0.42, r * 1.1).pts, { color: PAL.woodD, w: 1.6, alpha: 0.4, seed: seed + 3, corners: false });
        P.fill(x, P.rect(lx - r * 0.45, ly + r * 1.05, r * 0.9, r * 0.24), PAL.woodD, { edge: 2, lw: 2, seed: seed + 4 });
      });
    }
    function pencilInto(m) {
      const k = m.w / 1920;
      m.c.setTransform(1, 0, 0, 1, 0, 0); m.c.globalAlpha = 1; m.c.fillStyle = PL.wall; m.c.fillRect(0, 0, m.w, m.cv.height);
      m.c.setTransform(k, 0, 0, k, 0, 0);
      pencilLobby(m.c, m.c, m.c);
    }

    function render(f) {
      F = f;
      const b = f.bar, [m0, m1] = AT.mosaic, endK = prog(b, m0, m1);
      G.setCam({ x: 960, y: 540, zoom: 1, rot: 0 });
      G.clear(P.toLin(P.hex(PL.wall)));
      const step = b < m0 ? -1 : Math.min(4, Math.floor(endK * 5));
      if (step < 4) {
        const tp = top.begin();
        tp.save(); tp.imageSmoothingEnabled = false;
        if (step >= 0) { pencilInto(mos[step]); tp.drawImage(mos[step].cv, 0, 0, 1920, 1080); }
        const pix = step < 0 ? 1 : 1 - prog(b, m0, m0 + 0.07);
        if (pix >= 1) { c = tp; game(b); }
        else if (pix > 0) {
          // K.text 自己设 globalAlpha，淡出不能靠给图层设透明度：先画在同样大小的离屏画布上，再带透明度贴上去。
          const tc = tp.canvas;
          if (!cv || cv.width !== tc.width || cv.height !== tc.height) { cv = document.createElement("canvas"); cv.width = tc.width; cv.height = tc.height; }
          c = cv.getContext("2d"); game(b);
          tp.setTransform(1, 0, 0, 1, 0, 0); tp.globalAlpha = pix; tp.drawImage(cv, 0, 0);
        }
        tp.restore();
        G.composite(top.upload(), { mode: G.MODE.normal });
      } else {
        const w = bgL.begin(), g = glowL.begin(), x = ink.begin();
        pencilLobby(w, g, x);
        G.composite(bgL.upload(), { mode: G.MODE.normal });
        G.composite(glowL.upload(), { mode: G.MODE.normal });
        G.composite(ink.upload(), { mode: G.MODE.normal });
      }
      f.post = { bloom: 0, threshold: 1.2, halation: 0, ca: 0, grain: 0.03 * endK, vignette: lerp(0.12, 0.16, endK), shake: [0, 0], blur: [0, 0], zoomBlur: 0 };
    }

    async function init() {
      top = G.layer("top"); bgL = G.layer("bg"); glowL = G.layer("emit", 0.5); ink = G.layer("ink");
      if (!mos.length) for (const w of [384, 480, 640, 960]) { const m = document.createElement("canvas"); m.width = w; m.height = (w * 9) / 16; mos.push({ cv: m, c: m.getContext("2d"), w }); }
      await Promise.all([
        document.fonts.load(face(24, "pix"), "对话 Chat 429"), document.fonts.load(face(8, "pix"), "PUSH START"),
        ...[12, 10].flatMap((s) => [document.fonts.load(face(s), "对话 Ag"), document.fonts.load(face(s, "mono"), "Ag")]),
        document.fonts.load(P.FONT.hand(42), "过了门禁再进门 OCT 19 Pass"),
      ]);
      // 排线图块第一次用到才生成：空闲时先在小画布上把末帧画一遍，图块就进了 pencil.js 的缓存，变彩铅那几帧不卡。
      (window.requestIdleCallback || ((fn) => setTimeout(fn, 50)))(() => pencilInto(mos[0]));
    }
    return { init, render };
  }

  let impl = null;
  window.CHAPTERS.push({
    id: "ch07", title: "ch.07", bars: 30,
    async init() { impl = impl || make(); await impl.init(); },
    render(f) { impl.render(f); },
  });
})();
