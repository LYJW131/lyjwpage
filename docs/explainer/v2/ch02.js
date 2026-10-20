(() => {
  const { E, prog, keys, track, clamp, lerp, hash, pathAt, pathLen, trailOn } = K;
  I18N.add({
    "ch02.title": ["门禁与分拣", "The gate and the sorting desk"],
    "ch02.posterA": ["门禁", "The gate &"],
    "ch02.posterB": ["与分拣", "the sorting desk"],
    "ch02.clawd": ["上报都从这道闸进来。", "Every report comes in\nthrough this gate."],
    "ch02.n1a": ["每个上报方一把 Access 钥匙，", "Each reporter gets one Access key;"],
    "ch02.n1b": ["权限表写明它能开哪几扇门。", "the table says which doors it opens."],
    "ch02.two": ["两把钥匙，各开一扇", "Two keys, one door each"],
    "ch02.form": ["入口检查单", "Ingress checklist"],
    "ch02.r1": ["方法是 POST", "Method is POST"],
    "ch02.r2": ["认识这个来源", "Known source"],
    "ch02.r3": ["Access 凭证", "Access credential"],
    "ch02.r4": ["不超过 4 MiB", "At most 4 MiB"],
    "ch02.r4s": ["按实际读到的字节", "bytes actually read"],
    "ch02.r5": ["是 JSON", "Is JSON"],
    "ch02.r6": ["prepare：整理成命令", "prepare: build the command"],
    "ch02.n2a": ["入口按判定顺序逐项检查，", "The ingress checks in a fixed order;"],
    "ch02.n2b": ["一项不过，当场拒收。", "fail one and it is turned away."],
    "ch02.notJson": ["不是 JSON", "not JSON"],
    "ch02.n3a": ["prepare 把信封整理成命令，", "prepare turns it into a command,"],
    "ch02.n3b": ["按数据层分进四根管子。", "split into four tubes by data layer."],
    "ch02.tube.rt": ["实时", "Realtime"],
    "ch02.tube.lag": ["可滞后", "Lag-tolerant"],
    "ch02.tube.d1": ["归档", "Archive"],
    "ch02.tube.cred": ["凭据", "Credentials"],
    "ch02.byCore": ["交给状态核心", "to the state core"],
    "ch02.byGate": ["入口直接写", "ingress writes it"],
    "ch02.server": ["服务器那封整封不进状态核心：只进可滞后和归档。", "The server report skips the state core: lag and archive only."],
    "ch02.n4a": ["三根管子由入口自己写，", "The ingress writes three itself;"],
    "ch02.n4b": ["只有实时那根交给状态核心。", "only realtime is handed to the core."],
    "ch02.gateSide": ["无状态，只在边界鉴权", "stateless; auth at the edge"],
    "ch02.coreSide": ["状态核心", "the state core"],
    "ch02.rpc": ["RPC 入口", "RPC entrypoint"],
    "ch02.noNet": ["内部调用：不走公网，不带凭据", "internal call: no public network, no credentials"],
    "ch02.bound": ["只有绑定了 CORE 的 Worker 调得到", "only Workers bound to CORE can call it"],
    "ch02.n5a": ["实时那一半经 Service Binding，", "Realtime rides a Service Binding"],
    "ch02.n5b": ["交给 core Worker 里的 StateCore。", "to StateCore in the core Worker."],
    "ch02.n6a": ["鉴权已在边界做过一次，", "Auth already happened at the edge;"],
    "ch02.n6b": ["这一跳只认绑定，不再验钥匙。", "this hop trusts the binding alone."],
    "ch02.foot1": ["改校验只需重新发布入口：", "A validation change redeploys"],
    "ch02.foot2": ["core Worker 只引用类型，", "only the ingress: core imports types,"],
    "ch02.foot3": ["Durable Object 不重启，连接不断。", "the DO keeps running, sockets stay up."],
    "ch02.waits": ["回 202 之前，入口依次等：", "Before 202, the ingress awaits:"],
    "ch02.lamp.do": ["状态核心已提交", "State core committed"],
    "ch02.lamp.lag": ["LAG 已写", "LAG written"],
    "ch02.lamp.cred": ["凭据已写", "Credentials written"],
    "ch02.lamp.credOnly": ["await · 带了 token 才写", "await · only when a token came"],
    "ch02.lamp.d1": ["D1 归档", "D1 archive"],
    "ch02.lamp.d1s": ["waitUntil · 不等", "waitUntil · not awaited"],
    "ch02.onFail": ["失败时", "On failure"],
    "ch02.f503": ["暂时故障：稍后重发", "transient failure: retry later"],
    "ch02.f400": ["上报器整封重发", "the reporter resends it all"],
    "ch02.n7a": ["三层都写完，才回 202；", "202 only after three layers commit;"],
    "ch02.n7b": ["归档、推送与失效在后台继续。", "archive and push continue after."],
    "ch02.n8a": ["中途出错回 400，整封重发；", "On error: 400, and a full resend;"],
    "ch02.n8b": ["每一路按自然键写，重发不重复。", "keyed writes make resends harmless."],
  });
  const tr = (k) => I18N.tr(k);
  const en = () => I18N.lang === "en";
  const TAU = Math.PI * 2;
  let bg, top, dots = null, dotTile = null, BARs = (60 / 108) * 4;

  // 构成主义海报：米白纸、墨黑、朱红，外加一档灰给次要的字。橙色仍是全片唯一发光的颜色，只给信封亮核、灯和 Clawd。
  const PAPER = [236, 229, 214], INK = [26, 24, 22], RED = [202, 42, 34], GRAY = [104, 99, 92], CLAWD = [215, 119, 87];
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const paint = (c) => (typeof c === "string" ? c : rgba(c));
  const toLin = (c) => c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  const PAPER_LIN = toLin(PAPER);
  const SIG = () => G.css("signal");

  const HEI = '"Noto Sans SC ch02", "PingFang SC", "Noto Sans SC", sans-serif';
  const BIG = '"Big Shoulders ch02", Geist, sans-serif';
  const DISP = (px) => (en() ? `900 ${px}px ${BIG}` : `900 ${px}px ${HEI}`);
  const NUM = (px) => `900 ${px}px ${BIG}`;
  // 闸号和三块章用模板喷字，像机器外壳上喷的编号。
  const STEN = (px) => `900 ${px}px "Big Shoulders Stencil ch02", ${BIG}`;
  const LABEL = (px) => (en() ? `600 ${px}px ${BIG}` : `700 ${px}px ${HEI}`);
  const MONO = (px, w = 500) => K.FONT.mono(px, w);
  const disp = (s) => (en() ? s.toUpperCase() : s);

  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  // 机器每拍走一格：每拍开头 0.3 拍内带一点过冲走完，其余时间停着。
  const tick = (b) => { const q = b * 4, i = Math.floor(q); return i + E.outBack(clamp((q - i) / 0.3)); };

  // 时刻（小节），和 music/ch02.js 的 story、sfx 是同一张表。
  const AT = {
    look: 0.3, leap: 0.5, land: 1.125, arms: 0.75, table: 0.9,
    e403: 3.5, two: 4.15, exit: 4.9, gone: 5.15,
    checks: [6.5, 7.0, 7.5, 8.0, 8.5], press: 9.0, html: 9.25, htmlGates: [9.5, 9.625, 9.75, 9.875], s400: 10.0, trap: 10.25,
    gear: 11.5, server: 14.0, fork: 14.5, rtOut: 15.75,
    flange: 17.0, core: 17.25, hub: 17.5, commit: 17.75, reply: [18.0, 18.5], slide: [21.4, 22.5],
    lamp1: 22.5, d1Start: 22.75, lamp2: 23.0, lamp3: 23.5, horn: 23.75, s202: 24.0, d1Done: 24.25, fail: 25.05,
    wide: 27.5, dive: 30.0,
  };
  // [键, 第一行起, 第二行起, 收]：每行逐字显出 NAR_REVEAL 小节；每对在镜头甩走之前收完，第二行显全之后到开始淡出至少一小节。
  const NAR_AT = [
    ["n1", 1.5, 2.25, 5.4], ["n2", 6.25, 7.0, 10.7], ["n3", 11.45, 12.05, 13.85], ["n4", 13.95, 14.55, 16.3],
    ["n5", 17.0, 17.6, 19.4], ["n6", 19.45, 20.05, 21.85], ["n7", 22.55, 23.15, 24.95], ["n8", 25.05, 25.65, 27.45],
  ];
  const NAR_REVEAL = 0.6;

  // ---- 机器坐标：u 沿传送带往右下（19°），v 垂直于带子、朝下为正；带子、闸、压机、管子、墙都按它摆 ----
  const SL = 682 / 1980, TH = Math.atan(SL), CT = Math.cos(TH), ST = Math.sin(TH);
  const O = [1860, 690];
  const M = (u, v = 0) => [O[0] + u * CT - v * ST, O[1] + u * ST + v * CT];
  const uAt = (wx) => (wx - O[0]) / CT;
  const U2 = uAt(1920), U3 = uAt(3840), U_G = uAt(4660), U_F = uAt(6460);
  // 五个机位各占一屏（镜头缩放 1 时机位左上角 = 屏幕原点），沿带子一路往右下，最后顺着墙折回左下。
  const F1 = [0, 40], F2 = [1920, M(U2)[1] - 300], F3 = [3840, M(U3)[1] - 160], F4 = [6460 - 640, M(U_F)[1] - 380];
  // 回执贴着墙的入口一侧往下滑，三盏灯装在这条线上。
  const BUS = (s) => M(U_F - 160, s);
  const S_LAMP = [1000, 1200, 1400];
  const L1W = BUS(S_LAMP[0]);
  const F5 = [L1W[0] - 1230, L1W[1] - 300];
  const toLocal = (fr, p) => [p[0] - fr[0], p[1] - fr[1]];
  const NAR_POS = { n1: [F1, 150, 925, 1500], n2: [F2, 960, 140, 900], n3: [F3, 80, 930, 1000], n4: [F3, 80, 930, 1000],
    n5: [F4, 620, 930, 1240], n6: [F4, 620, 930, 1240], n7: [F5, 80, 110, 1100], n8: [F5, 80, 110, 1100] };

  // ---- 画法 ----
  function rect(x, x0, y0, w, h, col, a = 1) { if (a <= 0) return; x.save(); x.globalAlpha *= a; x.fillStyle = paint(col); x.fillRect(x0, y0, w, h); x.restore(); }
  function disc(x, cx, cy, r, col, a = 1) { if (a <= 0 || r <= 0) return; x.save(); x.globalAlpha *= a; x.fillStyle = paint(col); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.restore(); }
  function ring(x, cx, cy, r, lw, col, a = 1, dash) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.strokeStyle = paint(col); x.lineWidth = lw; if (dash) x.setLineDash(dash);
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); x.restore();
  }
  function bar(x, x1, y1, x2, y2, lw, col, a = 1, dash) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.strokeStyle = paint(col); x.lineWidth = lw; x.lineCap = "butt"; if (dash) x.setLineDash(dash);
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); x.restore();
  }
  function fillPoly(x, pts, col, a = 1) {
    if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.fillStyle = paint(col); x.beginPath();
    pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.closePath(); x.fill(); x.restore();
  }
  function group(x, a, fn) { if (a <= 0) return; x.save(); x.globalAlpha *= a; fn(); x.restore(); }
  function at(x, px, py, rot, fn) { x.save(); x.translate(px, py); if (rot) x.rotate(rot); fn(); x.restore(); }
  function outside(x, [x0, y0, x1, y1], fn) {
    x.save(); x.beginPath(); x.rect(-1e5, -1e5, 2e5, 2e5); x.rect(x0, y0, x1 - x0, y1 - y0); x.clip("evenodd"); fn(); x.restore();
  }
  const machine = (x, fn) => at(x, O[0], O[1], TH, fn);
  const local = (x, fr, fn) => at(x, fr[0], fr[1], 0, fn);
  // K.text 的 alpha 是绝对值、会盖掉外层 globalAlpha；这里乘上外层的，组里淡入淡出时字跟着走。
  function T(x, str, px, py, o = {}) {
    return K.text(x, str, px, py, { ...o, font: o.font || LABEL(30), color: o.css || rgba(o.col || INK), alpha: (o.alpha ?? 1) * x.globalAlpha });
  }
  function glow(x, cx, cy, r, a) {
    if (a <= 0) return;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,214,176,0.95)"); g.addColorStop(0.3, "rgba(236,138,96,0.5)"); g.addColorStop(1, "rgba(230,110,70,0)");
    x.save(); x.globalAlpha *= a; x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.restore();
  }
  function spark(x, head, trail, size, a = 1) {
    if (a <= 0 || size <= 0.01) return;
    x.save(); x.globalAlpha *= a;
    if (trail && trail.length > 1) {
      x.strokeStyle = SIG(); x.lineWidth = 3.2; x.lineCap = "round"; x.lineJoin = "round";
      x.beginPath(); x.moveTo(trail[0][0], trail[0][1]); for (const p of trail) x.lineTo(p[0], p[1]); x.lineTo(head[0], head[1]); x.stroke();
    }
    const flick = 0.88 + 0.12 * hash(Math.floor(G.t * 60)), r = 34 * size;
    const g = x.createRadialGradient(head[0], head[1], 0, head[0], head[1], r);
    g.addColorStop(0, "rgba(255,238,218,1)"); g.addColorStop(0.16, "rgba(255,188,140,0.95)"); g.addColorStop(0.45, "rgba(232,122,82,0.38)"); g.addColorStop(1, "rgba(230,110,70,0)");
    x.globalAlpha *= flick; x.fillStyle = g; x.beginPath(); x.arc(head[0], head[1], r, 0, TAU); x.fill();
    x.globalAlpha /= flick; x.fillStyle = SIG(); x.beginPath(); x.arc(head[0], head[1], 6 * size, 0, TAU); x.fill();
    x.restore();
  }
  // 网点只铺在没有字的大块几何上：拉远才看得到的大「02」和喊话的楔形。
  function makeDots() {
    const W = 760, H = 700, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d"), step = 15;
    x.fillStyle = rgba(RED);
    for (let j = 0; j * step < H + step; j++) for (let i = 0; i * step < W + step; i++) {
      const px = i * step + (j % 2) * (step / 2), py = j * step, k = clamp((px * 0.6 + py) / (W * 0.6 + H));
      x.beginPath(); x.arc(px, py, step * 0.5 * lerp(0.28, 0.98, k), 0, TAU); x.fill();
    }
    x.globalCompositeOperation = "destination-in";
    x.font = `900 640px ${BIG}`; x.textAlign = "center"; x.textBaseline = "alphabetic";
    x.fillStyle = "#000"; x.fillText("02", W / 2, H - 40);
    return c;
  }
  function makeTile() {
    const c = document.createElement("canvas");
    c.width = 18; c.height = 18;
    const x = c.getContext("2d");
    x.fillStyle = rgba(RED); x.beginPath(); x.arc(9, 9, 5.2, 0, TAU); x.fill();
    return c;
  }

  // ---- Clawd：一张张橙纸条按格子拼起来，底下压一层错开的墨影 ----
  function clawdCut(x, cx, bottom, q, o = {}) {
    const { body, eyes } = window.Clawd.cells(o.pose || "default", o.crouch || 0);
    const rows = new Map();
    for (const [a, r] of body) { if (!rows.has(r)) rows.set(r, []); rows.get(r).push(a); }
    const strips = [];
    for (const [r, cols] of rows) {
      cols.sort((p, s) => p - s);
      let s0 = cols[0];
      for (let i = 1; i <= cols.length; i++) {
        if (i < cols.length && cols[i] === cols[i - 1] + 1) continue;
        strips.push([s0, cols[i - 1] + 1, r]);
        if (i < cols.length) s0 = cols[i];
      }
    }
    x.save(); x.globalAlpha *= o.a ?? 1;
    x.translate(cx - 9 * q, bottom - 12 * q);
    if (o.flip) { x.translate(18 * q, 0); x.scale(-1, 1); }
    const sh = q * 0.42;
    x.fillStyle = rgba(INK);
    for (const [a0, a1, r] of strips) x.fillRect(a0 * q + sh, r * 2 * q + sh, (a1 - a0) * q, 2 * q);
    x.fillStyle = rgba(CLAWD);
    for (const [a0, a1, r] of strips) {
      const j = (hash(r * 7.31 + a0 * 1.7 + 3) - 0.5) * 0.07, dx = (hash(r * 3.3 + a0 * 0.71) - 0.5) * 0.24 * q;
      x.save(); x.translate(((a0 + a1) / 2) * q + dx, (r * 2 + 1) * q); x.rotate(j);
      x.fillRect(-((a1 - a0) / 2) * q - 0.5, -q - 0.5, (a1 - a0) * q + 1, 2 * q + 1);
      x.restore();
    }
    x.fillStyle = rgba(INK);
    for (const [a, r] of eyes) x.fillRect(a * q - 0.3, r * 2 * q - 0.3, q + 0.6, 2 * q + 0.6);
    x.restore();
  }
  function clawdFr(x, fr, cx, bottom, q, o = {}) {
    const f = fr || { pose: "default", offset: 0 };
    const px = cx + (f.x || 0) * 2 * q * (o.flip ? -1 : 1);
    clawdCut(x, px, bottom, q, { ...o, pose: f.pose, crouch: f.offset || 0 });
    if (f.poof) for (const s of [-1, 1]) {
      const bx = px + s * 8.5 * q, by = bottom - q * 0.7;
      if (f.poof === "dot") rect(x, bx - q * 0.45, by - q * 0.45, q * 0.9, q * 0.9, INK, o.a ?? 1);
      else rect(x, bx - q * 1.2, by - q * 0.25, q * 2.4, q * 0.5, INK, o.a ?? 1);
    }
    return px;
  }
  const frameAt = (b, t0, BAR) => Math.floor(((b - t0) * BAR * 1000) / window.Clawd.FRAME_MS + 1e-6);
  const takeoff = (b, t0, BAR) => { const i = frameAt(b, t0, BAR); return i < 2 ? window.Clawd.SEQ.jump[i] : { pose: "arms-up", offset: 0 }; };
  // 对白框：米白底、粗墨框、一块墨影，尖角朝右下指着 Clawd。
  function say(x, str, rx, by, k, reveal) {
    if (k <= 0) return;
    const lines = str.split("\n"), f = LABEL(34), lh = 44;
    const w = Math.max(...lines.map((l) => K.measure(x, l, f))) + 40, h = lines.length * lh + 22;
    const s = lerp(0.7, 1, E.outBack(clamp(k * 1.4)));
    const total = lines.reduce((n, l) => n + [...l].length, 0);
    let before = 0;
    group(x, clamp(k * 3), () => at(x, rx, by, 0, () => {
      x.scale(s, s);
      rect(x, -w + 7, -h + 7, w, h, INK);
      rect(x, -w, -h, w, h, PAPER);
      x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 4; x.strokeRect(-w, -h, w, h); x.restore();
      fillPoly(x, [[-46, -2], [-14, -2], [16, 28]], INK);
      lines.forEach((l, i) => {
        const n = [...l].length, r = clamp((reveal * total - before) / n);
        before += n;
        T(x, l, -w + 20, -h + 11 + lh * (i + 0.78), { font: f, reveal: r, perChar: true });
      });
    }));
  }

  // ---- 机位 1：门墙 ----
  const DOORS = ["mac", "iphone", "homepod", "playstation", "emby", "server", "agents", "quest", "agents/otlp"];
  const DX = (i) => 170 + i * 186, DW = 138;
  const D_TOP = 346, D_BOT = 640, LOCK_Y = 470, ARM_Y = 600;
  // 门墙外框 [x0, 门楣顶, x1, 门槛底]
  const DOOR_WALL = [140, D_TOP - 46, 1850, D_BOT + 28];
  const AC = [["mac", "/mac · /agents/otlp"], ["iphone", "/iphone"], ["iphone-focus", "/iphone"],
    ["home-assistant", "/homepod"], ["playstation", "/playstation"], ["quest", "/quest"],
    ["emby", "/emby"], ["server", "/server"], ["agents", "/agents"],
    ["claude-cloud", "/agents/otlp"], ["github-actions", "/api/internal/…"]];
  const AC_X = [150, 700, 1250], AC_Y = 760, AC_LH = 36;
  const acPos = (i) => [AC_X[i % 3], AC_Y + Math.floor(i / 3) * AC_LH];
  // 钥匙从权限表自己那一行左边飞到锁上；emby 的钥匙去开 /mac，拧不动、掉下去。
  // 名牌（side 0 挂在钥匙圈下面）都不伸进隔壁门：mac 那块横在钥匙右边，因为火花正从它的钥匙圈底下进门。
  const KEYS = [
    { row: 0, door: 0, t: [1.3, 1.95], end: 2.7, side: 1 },
    { row: 6, door: 0, t: [2.9, 3.45], end: 3.98, side: 0, bad: true },
    { row: 3, door: 2, t: [3.6, 3.95], end: 4.85, side: 0 },
    { row: 4, door: 3, t: [3.7, 4.075], end: 4.9, side: 0 },
  ];
  const doorOpen = (i, b) => (i === 0 ? keys(b, [[2.0, 0], [2.3, 1, E.out], [2.72, 1], [3.0, 0, E.in]])
    : i === 2 ? prog(b, 4.0, 4.3, E.out) : i === 3 ? prog(b, 4.125, 4.425, E.out) : 0);
  const keyTurn = (i, b) => (i === 0 ? prog(b, 1.95, 2.05) * (1 - prog(b, 2.75, 2.85)) : i === 2 ? prog(b, 3.95, 4.05) : i === 3 ? prog(b, 4.075, 4.175) : 0);
  const ARM_T = DOORS.map((_, i) => AT.arms + i * 0.125);

  function titleBlock(x, b) {
    disc(x, 1760, 160, 128, RED);
    at(x, 70, 302, -0.12, () => T(x, "02", 0, 0, { font: NUM(250), col: RED, alpha: prog(b, 0.15, 0.55, E.out) }));
    // 英文标题整行淡入：K.text 逐字显出时每个字少算前面那一对字偶距，大号 Big Shoulders 的 AT、TE 会挤在一起。
    const tk = prog(b, 0.3, 0.95);
    T(x, disp(tr("ch02.title")), 372, 214, { font: DISP(96), reveal: en() ? 1 : tk, alpha: en() ? E.out(tk) : 1, maxW: 820 });
    const f = MONO(28), s = "ingest.homepage.lyjw.llc · ingress Worker", w = K.measure(x, s, f) + 32, hk = prog(b, 0.45, 0.85, E.outExpo);
    rect(x, 372, 236, w * hk, 42, INK);
    if (hk > 0.98) T(x, s, 388, 266, { font: f, col: PAPER });
  }
  function door(x, i, b) {
    const x0 = DX(i), o = doorOpen(i, b), h = D_BOT - D_TOP;
    rect(x, x0, D_TOP, DW, h, RED);
    const ph = h * (1 - E.io(o));
    if (ph <= 0.5) return;
    rect(x, x0, D_TOP, DW, ph, PAPER);
    if (ph > 40) { x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 3; x.strokeRect(x0 + 16, D_TOP + 16, DW - 32, ph - 32); x.restore(); }
    const ly = Math.min(LOCK_Y, D_TOP + ph - 46);
    if (ph > 100) {
      disc(x, x0 + DW / 2, ly, 21, INK);
      at(x, x0 + DW / 2, ly, (Math.PI / 2) * keyTurn(i, b), () => rect(x, -3.5, -12, 7, 24, keyTurn(i, b) > 0.5 ? RED : PAPER));
    }
  }
  function arm(x, i, b) {
    const t = ARM_T[i], down = E.outBack(prog(b, t, t + 0.1));
    const ang = lerp(lerp(-Math.PI / 2, 0, down), -1.42, doorOpen(i, b));
    at(x, DX(i) + 8, ARM_Y, ang, () => {
      for (let s = 0; s < 6; s++) rect(x, s * 20, -7, 20, 14, s % 2 ? PAPER : RED);
      x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 2; x.strokeRect(0, -7, 120, 14); x.restore();
    });
    disc(x, DX(i) + 8, ARM_Y, 9, INK);
  }
  function keyShape(x, tx, ty, s, flipX, rot, a, col) {
    group(x, a, () => at(x, tx, ty, rot, () => {
      x.scale(s * flipX, s);
      rect(x, -5, 0, 10, 94, INK);
      rect(x, 5, 12, 16, 12, col); rect(x, 5, 32, 11, 10, col);
      ring(x, 0, 118, 22, 10, INK); disc(x, 0, 118, 12, col);
    }));
  }
  // 名牌写权限表里的名字，中英文都用窄的 Big Shoulders：门挨得近，home-assistant 和 playstation 两块并排挂着才不相碰。
  const TAG = `600 28px ${BIG}`;
  function tag(x, str, bx, by, side, a, s = 1) {
    if (a <= 0) return;
    const w = K.measure(x, str, TAG) + 26, h = 42;
    group(x, a, () => at(x, bx, by, 0, () => {
      x.scale(s, s);
      const x0 = side > 0 ? 34 : side < 0 ? -34 - w : -w / 2, y0 = side ? -h / 2 : 31;
      if (side) bar(x, side * 24, 0, side * 34, 0, 4, INK);
      else bar(x, 0, 22, 0, y0, 4, INK);
      rect(x, x0, y0, w, h, INK);
      T(x, str, x0 + 13, y0 + 31, { font: TAG, col: PAPER });
    }));
  }
  function keysFly(x, b) {
    for (const k of KEYS) {
      if (b < k.t[0] || b > k.end + 0.3) continue;
      const [rx, ry] = acPos(k.row), lock = [DX(k.door) + DW / 2, LOCK_Y];
      const fly = E.outExpo(prog(b, k.t[0], k.t[1]));
      let tx = lerp(rx - 32, lock[0], fly), ty = lerp(ry - 40, lock[1], fly), rot = 0, a = prog(b, k.t[0], k.t[0] + 0.04), flipX = 1;
      const s = lerp(0.55, 1, fly);
      if (k.bad) {
        const r = prog(b, 3.5, 3.75);
        if (r > 0 && r < 1) tx += Math.sin((b - 3.5) * 70) * 9 * (1 - r);
        const fall = prog(b, 3.75, k.end, E.in);
        ty += fall * 160; rot = fall * 0.55; a *= 1 - prog(b, k.end - 0.1, k.end);
      } else {
        const turn = prog(b, k.t[1], k.t[1] + 0.12);
        flipX = Math.cos(Math.PI * turn);
        a *= 1 - prog(b, k.end - 0.12, k.end);
      }
      keyShape(x, tx, ty, s, Math.abs(flipX) < 0.08 ? 0.08 : flipX, rot, a, k.bad ? GRAY : RED);
      const bow = [tx - Math.sin(rot) * 118 * s, ty + Math.cos(rot) * 118 * s];
      // 坏钥匙一开始往下掉就收掉名牌，不然挂着的名牌会跟着掉到红条上的 ACCESS_CLIENTS 上。
      const ta = prog(b, k.t[1], k.t[1] + 0.05) * a * (k.bad ? 1 - prog(b, 3.75, 3.8) : 1);
      tag(x, AC[k.row][0], bow[0], bow[1], k.side, ta, lerp(0.7, 1, E.outBack(prog(b, k.t[1], k.t[1] + 0.12))));
    }
  }
  function accessTable(x, b) {
    const k = prog(b, AT.table, AT.table + 0.35, E.out);
    if (k <= 0) return;
    T(x, "ACCESS_CLIENTS", 162, 700, { font: MONO(28, 600), col: PAPER, alpha: k });
    AC.forEach(([who, doors], i) => {
      const [x0, y] = acPos(i), a = prog(b, AT.table + i * 0.035, AT.table + 0.22 + i * 0.035);
      const on = KEYS.some((kk) => kk.row === i && b >= kk.t[0] - 0.05 && b < kk.end);
      const w = T(x, who, x0, y, { font: MONO(28, 600), col: on ? RED : INK, alpha: a });
      T(x, "→ " + doors, x0 + w + 12, y, { font: MONO(28), col: on ? RED : GRAY, alpha: a });
    });
  }
  function slab(x, cx, cy, w, h, rot, k, main, sub, o = {}) {
    if (k <= 0) return;
    const s = lerp(1.7, 1, E.outExpo(clamp(k * 1.2)));
    // Big Shoulders 的数字高 0.81 em：有副标题时数字顶离章顶 16 px，没有时上下居中。
    const px = o.px || 110, cap = 0.81 * px;
    group(x, clamp(k * 4) * (o.a ?? 1), () => at(x, cx, cy, rot, () => {
      x.scale(s, s);
      rect(x, -w / 2 + 9, -h / 2 + 9, w, h, INK);
      rect(x, -w / 2, -h / 2, w, h, RED);
      T(x, main, 0, sub ? -h / 2 + cap + 16 : cap / 2, { font: STEN(px), col: PAPER, align: "center" });
      if (sub) T(x, sub, 0, h / 2 - 20, { font: o.subFont || LABEL(30), col: PAPER, align: "center" });
    }));
  }
  function frame1(x, b) {
    titleBlock(x, b);
    const [wx0, wy0, wx1, wy1] = DOOR_WALL;
    rect(x, wx0, D_BOT, wx1 - wx0, wy1 - D_BOT, INK);
    DOORS.forEach((_, i) => door(x, i, b));
    for (let i = 0; i <= DOORS.length; i++) {
      const x0 = i === 0 ? wx0 : DX(i - 1) + DW, x1 = i === DOORS.length ? wx1 : DX(i);
      // 立柱上下各多压 1 px：和门楣、门槛只是对边相接的话，抗锯齿会在接缝处漏出一条亮线。
      rect(x, x0, D_TOP - 1, x1 - x0, D_BOT - D_TOP + 2, INK);
    }
    rect(x, wx0, wy0, wx1 - wx0, D_TOP - wy0, INK);
    DOORS.forEach((d, i) => T(x, "/" + d, DX(i) + DW / 2, 333, { font: MONO(28, 600), col: PAPER, align: "center" }));
    DOORS.forEach((_, i) => arm(x, i, b));
    accessTable(x, b);
    T(x, tr("ch02.two"), (DX(2) + DX(3) + DW) / 2, 700, { font: LABEL(28), col: PAPER, align: "center", reveal: prog(b, AT.two, AT.two + 0.3) });
    keysFly(x, b);
    slab(x, 239, 405, 200, 100, -0.12, prog(b, AT.e403, AT.e403 + 0.12), "403", null, { px: 90, a: 1 - prog(b, 4.6, 4.9) });
  }

  // ---- 机位 2：判定顺序 ----
  const GATE_U = [0, 1, 2, 3, 4].map((g) => U2 + 330 + 280 * g);
  const PRESS_U = GATE_U[4] + 260;
  const STOP = (g) => (g < 5 ? GATE_U[g] - 189 : PRESS_U);
  const ENV_W = 140, ENV_H = 87;
  const envU = (b) => keys(b, [[6.55, STOP(0)], [6.85, STOP(1), E.io], [7.05, STOP(1)], [7.35, STOP(2), E.io], [7.55, STOP(2)], [7.85, STOP(3), E.io], [8.05, STOP(3)], [8.35, STOP(4), E.io], [8.55, STOP(4)], [8.85, STOP(5), E.io]]);
  const blockU = (b) => keys(b, [[9.4, PRESS_U], [11.45, U_G - 210, E.io], [11.62, U_G - 40, E.in]]);
  const htmlU = (b) => keys(b, [[AT.html, U2 - 130], [9.5, GATE_U[0] - 30, E.out], [9.625, GATE_U[1] - 30, E.lin], [9.75, GATE_U[2] - 30, E.lin], [9.875, GATE_U[3] - 30, E.lin], [9.97, STOP(4), E.out]]);
  const boomUp = (g, b) => {
    const c = AT.checks[g];
    const m = prog(b, c, c + 0.1, E.out) * (1 - prog(b, c + 0.33, c + 0.43, E.in));
    if (g > 3) return m;
    const th = AT.htmlGates[g];
    return Math.max(m, prog(b, th - 0.1, th - 0.05, E.out) * (1 - prog(b, th + 0.06, th + 0.11, E.in)));
  };
  function envAt(x, wx, wy, rot, o = {}) {
    const a = o.a ?? 1;
    if (a <= 0) return;
    group(x, a, () => at(x, wx, wy, rot, () => {
      x.scale(o.s ?? 1, o.s ?? 1);
      rect(x, -ENV_W / 2 + 6, -ENV_H / 2 + 6, ENV_W, ENV_H, INK);
      rect(x, -ENV_W / 2, -ENV_H / 2, ENV_W, ENV_H, PAPER);
      x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 4; x.strokeRect(-ENV_W / 2, -ENV_H / 2, ENV_W, ENV_H); x.restore();
      fillPoly(x, [[-ENV_W / 2, -ENV_H / 2], [0, ENV_H * 0.06], [ENV_W / 2, -ENV_H / 2]], o.flap || SIG());
      if (o.label) T(x, o.label, 0, ENV_H / 2 - 11, { font: MONO(28, 600), align: "center" });
    }));
  }
  const envOn = (x, u, o) => { const p = M(u, -21 - ENV_H / 2); envAt(x, p[0], p[1], TH, o); };
  function cmdBlock(x, u, s, a) {
    if (a <= 0 || s <= 0.02) return;
    const p = M(u, -21 - 32);
    group(x, a, () => at(x, p[0], p[1], TH, () => {
      x.scale(s, s);
      rect(x, -70, -26, 150, 64, INK);
      rect(x, -75, -32, 150, 64, RED);
      T(x, "cmd", 0, 11, { font: MONO(30, 600), col: PAPER, align: "center" });
    }));
  }
  function gatePosts(x) {
    machine(x, () => GATE_U.forEach((u, g) => {
      rect(x, u - 7, -220, 14, 199, INK);
      at(x, u, -262, 0, () => { rect(x, -42, -42, 84, 84, INK); T(x, String(g + 1), 0, 23, { font: STEN(64), col: PAPER, align: "center" }); });
    }));
  }
  function booms(x, b) {
    machine(x, () => GATE_U.forEach((u, g) => {
      at(x, u - 7, -62, Math.PI + (Math.PI / 2) * boomUp(g, b), () => {
        for (let s = 0; s < 5; s++) rect(x, s * 20, -8, 20, 16, s % 2 ? PAPER : RED);
        x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 2; x.strokeRect(0, -8, 100, 16); x.restore();
      });
      disc(x, u - 7, -62, 9, INK);
    }));
  }
  function pressMachine(x, b) {
    const ram = keys(b, [[8.88, 0], [9.0, 1, E.in], [9.12, 1], [9.32, 0, E.out]]);
    machine(x, () => {
      const u = PRESS_U, y0 = lerp(-262, -154, ram);
      rect(x, u - 92, -336, 16, 315, INK); rect(x, u + 76, -336, 16, 315, INK);
      rect(x, u - 104, -350, 208, 30, INK);
      rect(x, u - 7, -320, 14, y0 + 320, INK);
      rect(x, u - 82, y0, 164, 46, INK);
      rect(x, u - 82, y0 + 38, 164, 8, RED);
      at(x, u, -392, 0, () => { rect(x, -42, -42, 84, 84, INK); T(x, "6", 0, 23, { font: STEN(64), col: PAPER, align: "center" }); });
    });
  }
  const BIN = [1183, 982];
  function trapAndBin(x, b) {
    const k = prog(b, AT.trap, AT.trap + 0.12, E.in), u0 = STOP(4) - 75;
    if (k > 0) machine(x, () => { rect(x, u0, -21, 150, 42, INK); at(x, u0, 0, 1.25 * k, () => rect(x, 0, -21, 150, 42, RED)); });
    local(x, F2, () => {
      const [bx, by] = BIN;
      rect(x, bx - 92, by - 60, 14, 120, INK); rect(x, bx + 78, by - 60, 14, 120, INK); rect(x, bx - 92, by + 46, 184, 14, INK);
    });
  }
  function htmlEnv(x, b) {
    if (b < AT.html || b > AT.trap + 0.4) return;
    const o = { label: "<html>", flap: rgba(GRAY) };
    if (b < AT.trap + 0.02) { envOn(x, htmlU(b), o); return; }
    const k = prog(b, AT.trap + 0.02, AT.trap + 0.3, E.in), p0 = M(STOP(4), -21 - ENV_H / 2), p1 = [F2[0] + BIN[0], F2[1] + BIN[1] - 10];
    envAt(x, lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k), TH + 1.3 * k, { ...o, a: 1 - prog(k, 0.8, 1), s: lerp(1, 0.85, k) });
  }
  const ROWS = [["r1", "method", "405"], ["r2", "source", "404"], ["r3", "RS256 · aud · iss · exp", "401·403·503"], ["r4", null, "400"], ["r5", "JSON.parse", "400"], ["r6", "PreparedIngest", "400"]];
  function board(x, b) {
    local(x, F2, () => {
      T(x, disp(tr("ch02.form")), 60, 656, { font: DISP(44) });
      T(x, "ingress Worker · handleIngest", 60, 706, { font: MONO(28), col: GRAY });
      ROWS.forEach(([lab, sub, code], i) => {
        const y = 752 + 54 * i, t = i < 5 ? AT.checks[i] : AT.press, done = b >= t + 0.04;
        rect(x, 60, y - 30, 36, 36, done ? RED : INK);
        T(x, String(i + 1), 78, y - 3, { font: NUM(30), col: PAPER, align: "center" });
        const w = T(x, tr(`ch02.${lab}`), 116, y, { font: LABEL(30) });
        T(x, sub || tr("ch02.r4s"), 116 + w + 18, y, { font: sub ? MONO(28) : LABEL(28), col: GRAY });
        const hot = i === 4 && b >= AT.s400 && b < 10.75;
        if (hot) { const cw = K.measure(x, code, MONO(28, 600)); rect(x, 1000 - cw - 10, y - 28, cw + 20, 38, RED); }
        T(x, code, 1000, y, { font: MONO(28, 600), col: hot ? PAPER : RED, align: "right" });
      });
    });
  }
  function frame2(x, b) {
    gatePosts(x);
    if (b < AT.press + 0.02) envOn(x, envU(b), { label: "mac", s: 1 - 0.12 * prog(b, 8.98, AT.press) });
    else cmdBlock(x, blockU(b), lerp(0.6, 1, E.outBack(prog(b, AT.press, AT.press + 0.12))) * (1 - prog(b, 11.47, 11.62)), 1);
    trapAndBin(x, b);
    htmlEnv(x, b);
    booms(x, b);
    pressMachine(x, b);
    board(x, b);
    local(x, F2, () => slab(x, 1440, 956, 210, 168, -0.12, prog(b, AT.s400, AT.s400 + 0.12), "400", tr("ch02.notJson"), { px: 96 }));
  }

  // ---- 机位 3：分拣 ----
  const G3 = toLocal(F3, M(U_G)), GEAR_R = 180;
  const LANE = { rt: { ang: TH, valve: 330 }, lag: { ang: -0.7, valve: 400, store: 480 }, cred: { ang: Math.PI / 2, valve: 270, store: 328 }, d1: { ang: Math.PI - 0.35, valve: 440, store: 520 } };
  const laneAt = (k, d) => [G3[0] + Math.cos(LANE[k].ang) * d, G3[1] + Math.sin(LANE[k].ang) * d];
  const TOKENS = [["rt", 12.0, 0], ["rt", 12.125, 1], ["rt", 12.25, 2], ["lag", 12.5, 0], ["cred", 12.75, 0], ["lag", AT.fork, 1], ["d1", AT.fork, 0]];
  const OPEN_AT = { rt: AT.rtOut, d1: AT.d1Start, lag: AT.lamp2, cred: AT.lamp3 };
  const serverU = (b) => keys(b, [[13.3, U3 - 130], [14.0, U_G - GEAR_R - 80, E.out], [14.15, U_G - 50, E.in]]);
  function gear(x, cx, cy, r, n, ang) {
    at(x, cx, cy, ang, () => {
      const ri = r - 30;
      x.save(); x.fillStyle = rgba(INK); x.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, w = TAU / n;
        for (const [rr, f] of [[ri, 0], [r, 0.1], [r, 0.45], [ri, 0.55]]) { const t = a + f * w; x.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); }
      }
      x.closePath(); x.fill(); x.restore();
      disc(x, 0, 0, ri - 28, RED);
      for (let i = 0; i < 3; i++) at(x, 0, 0, (i / 3) * TAU, () => rect(x, -9, 0, 18, ri - 28, INK));
      disc(x, 0, 0, 38, INK);
      disc(x, 0, 0, 12, PAPER);
    });
  }
  function storeBox(x, kind, cx, cy) {
    rect(x, cx - 85 + 7, cy - 55 + 7, 170, 110, INK);
    rect(x, cx - 85, cy - 55, 170, 110, PAPER);
    x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 5; x.strokeRect(cx - 85, cy - 55, 170, 110); x.restore();
    K.glyph(x, kind, cx, cy, rgba(INK), 1.05);
  }
  function valve(x, k, open) {
    const p = laneAt(k, LANE[k].valve);
    at(x, p[0], p[1], LANE[k].ang + (Math.PI / 2) * (1 - E.io(open)), () => {
      rect(x, -32, -7, 64, 14, PAPER);
      x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 3; x.strokeRect(-32, -7, 64, 14); x.restore();
    });
  }
  function frame3(x, b) {
    local(x, F3, () => {
      for (const k of ["lag", "cred", "d1"]) { const a = laneAt(k, GEAR_R - 30), c = laneAt(k, LANE[k].store); bar(x, a[0], a[1], c[0], c[1], 48, INK); }
      TOKENS.forEach(([k, t, slot]) => {
        if (b < t) return;
        const park = LANE[k].valve - 26 - 32 * slot, open = OPEN_AT[k];
        let d = lerp(0, park, E.out(prog(b, t, t + 0.3))), s = prog(b, t, t + 0.1);
        if (k === "rt") { if (b > open) { d = lerp(park, LANE.rt.valve, prog(b, open, open + 0.1)); s *= 1 - prog(b, open, open + 0.1); } }
        else if (b > open) { d = lerp(park, LANE[k].store, E.in(prog(b, open, open + 0.25))); s *= 1 - prog(b, open + 0.17, open + 0.25); }
        if (s <= 0.01) return;
        const [px, py] = laneAt(k, d);
        at(x, px, py, LANE[k].ang, () => rect(x, -13 * s, -13 * s, 26 * s, 26 * s, k === "rt" ? INK : RED));
      });
    });
    if (b > 13.3 && b < 14.15) envOn(x, serverU(b), { label: "server", s: 1 - prog(b, 14.0, 14.15) });
    local(x, F3, () => {
      const spin = tick(b) * (TAU / 24) + TAU * 0.5 * (E.io(prog(b, AT.gear, AT.gear + 0.5)) + E.io(prog(b, AT.server, AT.server + 0.4)));
      gear(x, G3[0], G3[1], GEAR_R, 12, spin);
      for (const k of ["rt", "lag", "cred", "d1"]) valve(x, k, prog(b, OPEN_AT[k], OPEN_AT[k] + 0.1));
      for (const k of ["lag", "cred", "d1"]) { const [sx, sy] = laneAt(k, LANE[k].store); storeBox(x, k, sx, sy); }
      const gateHot = b > 14.8 && b < 15.6, coreHot = b > 15.4 && b < 16.2;
      const lag = laneAt("lag", LANE.lag.store), cred = laneAt("cred", LANE.cred.store), d1 = laneAt("d1", LANE.d1.store);
      T(x, tr("ch02.tube.lag"), lag[0] + 106, lag[1] - 5, { font: LABEL(34) });
      T(x, "KV LAG", lag[0] + 106, lag[1] + 31, { font: MONO(28) });
      T(x, tr("ch02.byGate"), lag[0] + 106, lag[1] + 71, { font: LABEL(28), col: gateHot ? RED : GRAY });
      T(x, tr("ch02.tube.cred"), cred[0] + 105, cred[1] - 10, { font: LABEL(34) });
      T(x, "KV CREDENTIALS", cred[0] + 105, cred[1] + 26, { font: MONO(28) });
      T(x, tr("ch02.byGate"), cred[0] + 105, cred[1] + 66, { font: LABEL(28), col: gateHot ? RED : GRAY });
      T(x, tr("ch02.tube.d1"), d1[0], d1[1] + 95, { font: LABEL(34), align: "center" });
      T(x, "D1 HISTORY", d1[0], d1[1] + 131, { font: MONO(28), align: "center" });
      T(x, tr("ch02.byGate"), d1[0], d1[1] + 171, { font: LABEL(28), col: gateHot ? RED : GRAY, align: "center" });
      T(x, tr("ch02.tube.rt"), 1200, 720, { font: LABEL(34), col: RED });
      T(x, "CORE.commitIngest", 1200, 758, { font: MONO(28) });
      T(x, tr("ch02.byCore"), 1200, 800, { font: LABEL(28), col: coreHot ? RED : GRAY });
      T(x, tr("ch02.server"), 1120, 905, { font: LABEL(28), col: GRAY, reveal: prog(b, AT.fork, AT.fork + 0.6) });
      // 横着写在带子下方：顺着带子斜放的话，经过的信封和 cmd 块会压上它。
      T(x, "prepare → PreparedIngest", 120, 430, { font: MONO(28), col: GRAY });
    });
  }

  // ---- 机位 4：墙两边 ----
  const SC = toLocal(F4, M(U_F + 250)), HUB = toLocal(F4, M(U_F + 580));
  const SC_BOX = [SC[0] - 130, SC[1] - 62, SC[0] + 130, SC[1] + 62];
  const replyAt = (b) => (b < AT.slide[0] ? M(keys(b, [[AT.reply[0], U_F + 250], [AT.reply[1], U_F - 160, E.io]])) : BUS(keys(b, [[AT.slide[0], 0], [AT.slide[1], S_LAMP[0], E.in]])));
  function receipt(x, cx, cy, a = 1) {
    group(x, a, () => {
      glow(x, cx, cy, 90, 0.45);
      rect(x, cx - 30 + 5, cy - 21 + 5, 60, 42, INK);
      rect(x, cx - 30, cy - 21, 60, 42, PAPER);
      x.save(); x.strokeStyle = SIG(); x.lineWidth = 4; x.strokeRect(cx - 30, cy - 21, 60, 42);
      x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = 5; x.beginPath(); x.moveTo(cx - 13, cy); x.lineTo(cx - 3, cy + 10); x.lineTo(cx + 14, cy - 10); x.stroke(); x.restore();
    });
  }
  function frame4(x, b) {
    local(x, F4, () => {
      const flash = impact(b, AT.core, 0.14), [s0, s1, s2, s3] = SC_BOX;
      rect(x, s0, s1, s2 - s0, s3 - s1, INK);
      rect(x, s0, s1, s2 - s0, s3 - s1, RED, flash);
      T(x, "StateCore", SC[0], SC[1] - 4, { font: MONO(34, 600), col: PAPER, align: "center" });
      T(x, tr("ch02.rpc"), SC[0], SC[1] + 38, { font: LABEL(28), col: PAPER, align: "center" });
      disc(x, HUB[0] + 10, HUB[1] + 10, 140, INK);
      disc(x, HUB[0], HUB[1], 140, RED);
      T(x, "StateHub", HUB[0], HUB[1] - 3, { font: MONO(34, 600), col: PAPER, align: "center" });
      T(x, "Durable Object", HUB[0], HUB[1] + 37, { font: MONO(28), col: PAPER, align: "center" });
      const lit = prog(b, AT.commit, AT.commit + 0.06);
      if (lit > 0) glow(x, HUB[0], HUB[1] - 108, 120, 0.4 + 0.5 * impact(b, AT.commit, 0.25));
      disc(x, HUB[0], HUB[1] - 108, 18, PAPER);
      disc(x, HUB[0], HUB[1] - 108, 13, SIG(), lit);
      T(x, "core Worker", 1000, 170, { font: MONO(34, 600) });
      T(x, tr("ch02.coreSide"), 1000, 212, { font: LABEL(34), col: GRAY });
      T(x, "Service Binding · CORE", 870, 330, { font: MONO(28, 600), col: RED });
      T(x, "ingress Worker", 40, 600, { font: MONO(34, 600) });
      T(x, tr("ch02.gateSide"), 40, 642, { font: LABEL(28), col: GRAY });
      // 回执那一行接在调用下面：写在带子下方的话，墙往左下斜，行尾会压到墙上。
      T(x, "await CORE.commitIngest(cmd)", 60, 72, { font: MONO(28) });
      T(x, "→ { ready: true, ok: true, data }", 60, 112, { font: MONO(28, 600), col: RED, alpha: win(b, AT.reply[1], AT.reply[1] + 0.1, AT.slide[0] - 0.12, AT.slide[0]) });
      const nk = prog(b, 19.6, 19.75);
      T(x, tr("ch02.noNet"), 960, 790, { font: LABEL(28), col: GRAY, alpha: nk });
      T(x, tr("ch02.bound"), 960, 830, { font: LABEL(28), col: GRAY, alpha: nk });
      // 三行逐字显出：显全之后到镜头甩走至少留一小节读。
      ["foot1", "foot2", "foot3"].forEach((k, i) => T(x, tr(`ch02.${k}`), 1360, 120 + 38 * i, { font: LABEL(28), col: GRAY, reveal: prog(b, 19.85 + 0.2 * i, 20.1 + 0.2 * i) }));
    });
    if (b >= AT.slide[0]) {
      const p0 = BUS(0), p1 = b < AT.lamp1 ? replyAt(b) : BUS(S_LAMP[0]);
      bar(x, p0[0], p0[1], p1[0], p1[1], 8, INK);
      bar(x, p0[0], p0[1], p1[0], p1[1], 4, SIG());
    }
    if (b >= AT.reply[0] && b < AT.lamp1) { const p = replyAt(b); receipt(x, p[0], p[1]); }
  }

  // ---- 机位 5：灯塔与 202 ----
  const L5 = (s) => toLocal(F5, BUS(s));
  const LAMP_T = [AT.lamp1, AT.lamp2, AT.lamp3], LAMP_K = ["do", "lag", "cred"];
  // 目标点是解出来的：亮条在 AT.lamp2、AT.lamp3 前后约 0.05 小节扫过 S_LAMP[1]、S_LAMP[2]，中途不减速；改了灯的位置或时刻要重解。
  const LAMP_TRACK = [[AT.lamp1, S_LAMP[0]], [AT.lamp1, S_LAMP[0] + 250], [AT.lamp2, S_LAMP[2] + 50], [AT.lamp3 - 0.0625, S_LAMP[2] + 170]];
  const D1L = [640, L5(S_LAMP[0] + 100)[1]];
  const STAMP = [970, 900], CL5 = [540, 1000];
  function lamp(x, cx, cy, on, pulse, o = {}) {
    const dim = o.dim ?? 1;
    if (on > 0) glow(x, cx, cy, 170, 0.55 * on * dim);
    disc(x, cx, cy, 66, PAPER);
    disc(x, cx, cy, 54, SIG(), on * dim);
    ring(x, cx, cy, 66, 10, INK, 1, o.dashed ? [16, 10] : null);
    if (pulse > 0.02) ring(x, cx, cy, 70 + (1 - pulse) * 70, 5, SIG(), pulse);
  }
  function frame5(x, b) {
    local(x, F5, () => {
      const p0 = L5(S_LAMP[0]), p1 = L5(S_LAMP[2] + 170);
      bar(x, p0[0], p0[1], p1[0], p1[1], 8, INK);
      if (b >= AT.lamp1) {
        const q = L5(track(b, LAMP_TRACK));
        bar(x, p0[0], p0[1], q[0], q[1], 4, SIG());
      }
      const dk = prog(b, AT.d1Start, AT.d1Start + 0.2, E.out), bp = L5(S_LAMP[0] + 100);
      if (dk > 0) {
        bar(x, bp[0], bp[1], lerp(bp[0], D1L[0] + 66, dk), bp[1], 6, INK, 1, [18, 12]);
        group(x, dk, () => {
          lamp(x, D1L[0], D1L[1], prog(b, AT.d1Done, AT.d1Done + 0.15), impact(b, AT.d1Done, 0.2) * 0.6, { dashed: true, dim: 0.55 });
          T(x, tr("ch02.lamp.d1"), D1L[0] - 92, D1L[1] - 8, { font: LABEL(34), align: "right" });
          T(x, tr("ch02.lamp.d1s"), D1L[0] - 92, D1L[1] + 38, { font: LABEL(28), col: GRAY, align: "right" });
        });
      }
      S_LAMP.forEach((s, i) => {
        const [lx, ly] = L5(s), t = LAMP_T[i];
        lamp(x, lx, ly, prog(b, t, t + 0.06), impact(b, t, 0.22));
        T(x, tr(`ch02.lamp.${LAMP_K[i]}`), lx - 92, ly - 8, { font: LABEL(34), align: "right" });
        if (i === 2) T(x, tr("ch02.lamp.credOnly"), lx - 92, ly + 38, { font: LABEL(28), col: GRAY, align: "right" });
        else T(x, "await", lx - 92, ly + 38, { font: MONO(28), col: GRAY, align: "right" });
      });
      const hk = prog(b, 22.3, 22.6);
      T(x, tr("ch02.waits"), 80, 300, { font: LABEL(34), alpha: hk });
      group(x, hk, () => { bar(x, 560, 289, 790, 289, 10, INK); fillPoly(x, [[790, 272], [826, 289], [790, 306]], INK); });
      const hornK = win(b, AT.s202, AT.s202 + 0.05, 25.0, 25.15);
      if (hornK > 0 && dotTile) {
        const mouth = [CL5[0] + 140, 945];
        group(x, hornK, () => {
          x.save(); x.beginPath(); x.moveTo(mouth[0], mouth[1] - 40); x.lineTo(STAMP[0] - 175, STAMP[1] - 112); x.lineTo(STAMP[0] - 175, STAMP[1] + 104); x.lineTo(mouth[0], mouth[1] + 40); x.closePath();
          x.fillStyle = x.createPattern(dotTile, "repeat"); x.fill(); x.restore();
        });
      }
      slab(x, STAMP[0], STAMP[1], 340, 210, -0.09, prog(b, AT.s202, AT.s202 + 0.16), "202", "Accepted", { px: 150, subFont: MONO(34, 600) });
      group(x, prog(b, AT.fail, AT.fail + 0.15), () => {
        T(x, tr("ch02.onFail"), 80, 820, { font: LABEL(34), col: RED });
        T(x, "retryable → 503", 80, 866, { font: MONO(28, 600) });
        T(x, tr("ch02.f503"), 80, 902, { font: LABEL(28), col: GRAY });
        T(x, "throw → 400", 80, 952, { font: MONO(28, 600) });
        T(x, tr("ch02.f400"), 80, 988, { font: LABEL(28), col: GRAY });
      });
    });
  }

  // ---- 拉远后才看得到的海报大件 ----
  function poster(x, v) {
    if (sees(v, 6700, 150, 7700, 1150)) {
      disc(x, 7210, 650, 430, RED);
    }
    if (sees(v, 4000, 0, 6700, 1200)) {
      T(x, disp(tr("ch02.posterA")), 4100, 560, { font: DISP(480), maxW: 2500 });
      T(x, disp(tr("ch02.posterB")), 4100, 1060, { font: DISP(480), col: RED, maxW: 2500 });
    }
    if (sees(v, 200, 1500, 2500, 4000)) {
      if (dots) x.drawImage(dots, 240, 1720, 2150, (2150 * dots.height) / dots.width);
      T(x, "ingest.homepage.lyjw.llc", 300, 1660, { font: MONO(120, 600) });
    }
  }
  // 带子：门墙下的红轨接一条 19° 的斜带，直通分拣齿轮；黑色箭头每拍往前挪一格。
  function belt(x, b) {
    const end = M(U_G - GEAR_R + 12);
    x.save(); x.strokeStyle = rgba(RED); x.lineWidth = 42; x.lineJoin = "miter"; x.lineCap = "butt";
    x.beginPath(); x.moveTo(150, 690); x.lineTo(O[0], O[1]); x.lineTo(end[0], end[1]); x.stroke(); x.restore();
    const off = (tick(b) * 24) % 96;
    machine(x, () => {
      x.save(); x.fillStyle = rgba(INK);
      for (let u = 30 + off; u < U_G - GEAR_R - 30; u += 96) {
        x.beginPath(); x.moveTo(u - 10, -13); x.lineTo(u + 4, 0); x.lineTo(u - 10, 13); x.lineTo(u - 19, 13); x.lineTo(u - 5, 0); x.lineTo(u - 19, -13); x.closePath(); x.fill();
      }
      x.restore();
    });
  }
  // 实时那根管子：齿轮出来一直到 StateHub，中间穿墙；管壁上每隔一段一道米白环。
  function tube(x) {
    machine(x, () => {
      rect(x, U_G + 150, -26, U_F + 440 - U_G - 150, 52, RED);
      for (let u = U_G + 420; u < U_F + 420; u += 180) rect(x, u, -26, 8, 52, PAPER);
    });
  }
  function wall(x) {
    machine(x, () => {
      rect(x, U_F - 70, -1000, 140, 2900, INK);
      for (let v = -940; v < 1880; v += 150) disc(x, U_F, v, 7, PAPER);
      for (const u of [U_F - 70, U_F + 70]) {
        rect(x, u - 10, -40, 20, 80, PAPER);
        x.save(); x.strokeStyle = rgba(INK); x.lineWidth = 3; x.strokeRect(u - 10, -40, 20, 80); x.restore();
        disc(x, u, -28, 4, INK); disc(x, u, 28, 4, INK);
      }
    });
  }

  function narration(x, b) {
    for (const [key, s1, s2, end] of NAR_AT) {
      const a = win(b, s1 - 0.02, s1 + 0.1, end - 0.15, end);
      if (a <= 0) continue;
      const [fr, px, py, maxW] = NAR_POS[key], wx = fr[0] + px, wy = fr[1] + py;
      rect(x, wx - 40, wy - 56, 14, 154 * E.outExpo(prog(b, s1 - 0.02, s1 + 0.25)), RED, a);
      [["a", s1, 0], ["b", s2, 82]].forEach(([l, s, dy]) => K.text(x, tr(`ch02.${key}${l}`), wx, wy + dy, {
        font: LABEL(62), color: rgba(INK), reveal: prog(b, s, s + NAR_REVEAL), dim: 0.12, perChar: true, alpha: a * x.globalAlpha, maxW, narration: true,
      }));
    }
  }

  // ---- 交接：火花从左缘骑进来（接 ch01.js#clawdRide，两边须同步） ----
  // 第 01 章用 E.inExpo 加速冲出右缘（镜头不转，到顶约 1 万屏幕 px/小节）。这边镜像成 E.outExpo：0:0 镜头不转，
  // 亮核在屏幕 (−40, 540)，起速 10·ln2 ×（A_STOP − A_IN）× 1.4 ÷ A_BRAKE 接上那边的速度，在带子起点前刹停。
  const CAM0 = [450, 650, 1.4];
  const A_PATH = [[-700, CAM0[1]], [120, CAM0[1]], [DX(0) + DW / 2, 600]];
  const A_LEN = pathLen(A_PATH);
  const A_IN = 700 + CAM0[0] - (960 + 40) / CAM0[2], A_STOP = 810, A_BRAKE = 0.345;
  const sparkD = (b) => keys(b, [[0, A_IN], [A_BRAKE, A_STOP, E.outExpo], [1.9, A_LEN - 40, E.io], [2.35, A_LEN, E.in]]);
  const sparkA = (b) => pathAt(A_PATH, sparkD(b));
  // 接第 01 章的甩镜头：0:0 镜头还落在左边 D 处、正往右甩，E.outExpo 在 T 内刹到 CAM0。起速接上第 01 章末的屏幕速度
  // （ch01.js#WHIP 的 dx 2200、0.25 小节 E.inExpo、出口缩放 1.014，两边须同步）；火花和 Clawd 减去同一段位移，屏幕上的骑乘轨迹不变。
  const WHIP = { T: 0.35, slabX: 900 };
  WHIP.D = (2200 * 1.014 * WHIP.T) / (0.25 * CAM0[2]);
  // 0:0 之前那一帧（算运动模糊用）按起速往回外推，首帧就带着第 01 章末的模糊
  const whipOff = (b) => WHIP.D * (b < 0 ? 1 - (10 * Math.LN2 * b) / WHIP.T : 1 - E.outExpo(prog(b, 0, WHIP.T)));
  const sparkS = (b) => { const [u, v] = sparkA(b); return [u - whipOff(b), v]; };
  // 甩镜头带过剪切点的红斜块：sx 是红块左下角的屏幕 x，往右上斜；第 01 章最后两帧经 share 借它画。
  function whipBand(x, sx) {
    fillPoly(x, [[sx, 1180], [sx + 420, -100], [sx + 1420, -100], [sx + 1000, 1180]], RED);
    fillPoly(x, [[sx + 1060, 1180], [sx + 1480, -100], [sx + 1600, -100], [sx + 1180, 1180]], INK);
  }
  function whipSlab(x, cam) {
    const wx = CAM0[0] - WHIP.D + (WHIP.slabX - 960) / CAM0[2], sx = (wx - cam.x) * cam.zoom + 960;
    if (sx + 1600 < 0) return;
    x.save(); x.setTransform(G.S, 0, 0, G.S, 0, 0); x.globalAlpha = 1; whipBand(x, sx); x.restore();
  }
  // 蹲着、不翻转，屏幕上 18 格 × 7 px = 126 px 宽，底边比亮核高 7 px（镜头 1.4 × 5）。
  // 从火花跳到门楣上，直线、弧线都会压过门名、域名条或标题：起跳后钻到门墙背后，从标题右边的门楣后面冒出来再落下。
  const CL = { leap: 0.5, duck: 0.62, pop: 0.86, land: 1.125, qRide: 5, q: 7, spot: [1690, 300], popFrom: [1250, 430] };
  // 骑火花时鼻尖已经伸到门墙左边的黑立柱上：从立柱中间往右才算墙后，起跳那一帧不会被裁掉一块。
  const BEHIND = [DOOR_WALL[0] + 20, DOOR_WALL[1], DOOR_WALL[2], DOOR_WALL[3]];
  function clawdGate(x, b, BAR) {
    if (b >= AT.gone) return;
    const [px, py] = CL.spot;
    if (b < CL.leap) {
      const [hx, hy] = sparkS(b);
      clawdCut(x, hx, hy - 5, CL.qRide, { crouch: 1, pose: b < AT.look ? "default" : "look-right" });
      return;
    }
    if (b < CL.land) {
      if (b >= CL.duck && b < CL.pop) return;
      outside(x, BEHIND, () => {
        if (b < CL.duck) {
          const [sx, sy] = sparkA(CL.leap);
          clawdFr(x, takeoff(b, CL.leap, BAR), sx + 200 * E.in(prog(b, CL.leap, CL.duck)), sy - 5 - K.hop(b, CL.leap, CL.duck, 40), CL.qRide);
        } else {
          const k = prog(b, CL.pop, CL.land), [ux, uy] = CL.popFrom;
          clawdFr(x, takeoff(b, CL.pop, BAR), lerp(ux, px, k), lerp(uy, py, k) - K.hop(b, CL.pop, CL.land, 140), CL.q);
        }
      });
      return;
    }
    if (b >= AT.exit) {
      const k = prog(b, AT.exit, AT.gone);
      clawdFr(x, takeoff(b, AT.exit, BAR), lerp(px, px + 340, k), py - K.hop(b, AT.exit, AT.gone, 110) + E.in(k) * 160, CL.q);
      return;
    }
    const fr = K.clawdSeq("land", b, CL.land, BAR) || K.clawdSeq("flinch", b, AT.e403, BAR) || { pose: b > 1.9 && b < 4.7 ? "look-left" : "default", offset: 0 };
    clawdFr(x, fr, px, py, CL.q);
    say(x, tr("ch02.clawd"), 1612, 238, prog(b, 1.15, 1.4) * (1 - prog(b, 2.4, 2.55)), prog(b, 1.2, 1.9));
  }
  // 202 这一下照罗德钦科的「书」：Clawd 举着红喇叭喊，喊声是一块网点楔形，正好撞上 202 的章。
  function clawdTower(x, b, BAR) {
    if (b < 22.4) return;
    const [lx, ly] = CL5, cx = F5[0] + lx, bottom = F5[1] + ly, q = CL.q;
    if (b < 22.55) return;
    if (b < 22.65) { clawdFr(x, { pose: "arms-up", offset: 0 }, cx, lerp(bottom - 700, bottom, prog(b, 22.55, 22.65, E.in)), q); return; }
    const horn = b >= AT.horn && b < 25.0;
    const fr = K.clawdSeq("land", b, 22.65, BAR) || K.clawdSeq("jump", b, AT.s202, BAR) || (horn ? { pose: "arms-up", offset: 0 } : { pose: b < AT.horn ? "look-right" : b < AT.wide ? "look-left" : "default", offset: 0 });
    const pxx = clawdFr(x, fr, cx, bottom, q);
    if (horn) {
      const k = E.outBack(prog(b, AT.horn, AT.horn + 0.12)), hx = pxx + 9 * q - 4, hy = bottom - 8 * q;
      group(x, prog(b, AT.horn, AT.horn + 0.05), () => at(x, hx, hy, -0.05, () => {
        x.scale(k, k);
        fillPoly(x, [[4, -8], [74, -36], [74, 44], [4, 16]], INK, 1);
        fillPoly(x, [[0, -12], [70, -40], [70, 40], [0, 12]], RED);
        rect(x, -14, -6, 18, 22, INK);
      }));
    }
  }

  // ---- 镜头 ----
  const LZ = Math.log;
  const C = (fr, dx = 0, dy = 0) => [fr[0] + 960 + dx, fr[1] + 540 + dy];
  const CAM = [
    [0, [CAM0[0], CAM0[1], LZ(CAM0[2]), 0]],
    [1.6, [960, 580, 0, 0], E.io],
    [5.45, [978, 586, LZ(1.02), 0], E.lin],
    [6.05, [...C(F2), 0, 0], E.io],
    [10.75, [...C(F2, 15, 6), LZ(1.02), 0], E.lin],
    [11.35, [...C(F3), 0, 0], E.io],
    [16.35, [...C(F3, 15, 6), LZ(1.02), 0], E.lin],
    [16.95, [...C(F4), 0, 0], E.io],
    [21.95, [...C(F4, -15, 6), LZ(1.02), 0], E.lin],
    [22.5, [...C(F5), 0, 0], E.io],
    [27.5, [...C(F5, -12, 6), LZ(1.02), 0], E.lin],
    [28.4, [3800, 2000, LZ(0.24), 0], E.io],
    [29.2, [3800, 2000, LZ(0.25), 0], E.lin],
    [29.74, [L1W[0], L1W[1], LZ(1.15), 0], E.io],
    // N:0 那一帧已属于第 03 章：冲进灯里、全黑交接在 N − 0.03 前做完。
    [29.97, [L1W[0], L1W[1], LZ(60), 0], E.inExpo],
  ];
  // 甩镜头时顺着对角线带一点转角，中途稍微拉远，看得见带子和墙的走向。
  const MOVES = [[5.45, 6.05, -0.06], [10.75, 11.35, 0.05], [16.35, 16.95, -0.05], [21.95, 22.5, 0.07], [27.5, 28.4, -0.04]];
  function camAt(b) {
    const c = keys(b, CAM).slice();
    c[0] -= whipOff(b);
    let z = Math.exp(c[2]), r = c[3];
    for (const [a0, a1, rr] of MOVES) if (b > a0 && b < a1) { const s = Math.sin((Math.PI * (b - a0)) / (a1 - a0)) ** 2; r += rr * s; z *= 1 - 0.12 * s; }
    return [c[0], c[1], z, r];
  }
  function viewOf(cam) {
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot), xs = [], ys = [];
    for (const [sx, sy] of [[0, 0], [1920, 0], [0, 1080], [1920, 1080]]) {
      const dx = (sx - 960) / cam.zoom, dy = (sy - 540) / cam.zoom;
      xs.push(cam.x + c * dx + s * dy); ys.push(cam.y - s * dx + c * dy);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  const sees = (v, x0, y0, x1, y1) => x1 > v.x0 && x0 < v.x1 && y1 > v.y0 && y0 < v.y1;
  const seesF = (v, fr) => sees(v, fr[0] - 120, fr[1] - 120, fr[0] + 2040, fr[1] + 1200);

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, c = camAt(b), c0 = camAt(b - 1 / 60 / f.BAR);
    // 四下盖章既推镜又震屏；九根栏杆落下只轻震屏，推镜那一下只有一帧，看着像跳帧。
    const hitZ = Math.max(impact(b, AT.e403, 0.1) * 0.7, impact(b, AT.press, 0.1) * 0.5, impact(b, AT.s400, 0.1) * 0.8, impact(b, AT.s202, 0.14));
    const hitS = Math.max(hitZ, ...ARM_T.map((t) => impact(b, t, 0.05) * 0.18));
    const cam = { x: c[0], y: c[1], zoom: c[2] * (1 + 0.014 * hitZ), rot: c[3] };
    G.setCam(cam);
    G.clear(PAPER_LIN);
    const v = viewOf(cam);
    const x = bg.begin(); bg.cam(cam);
    poster(x, v);
    belt(x, b);
    tube(x);
    wall(x);
    if (seesF(v, F1)) frame1(x, b);
    if (seesF(v, F2)) frame2(x, b);
    if (seesF(v, F3)) frame3(x, b);
    if (seesF(v, F4) || seesF(v, F5)) frame4(x, b);
    if (seesF(v, F5)) frame5(x, b);
    narration(x, b);
    if (b < WHIP.T) whipSlab(x, cam);
    const tp = top.begin(); top.cam(cam);
    if (b < 2.5) {
      const d = sparkD(b), wo = whipOff(b);
      spark(tp, sparkS(b), trailOn(A_PATH, d, 320).map(([u, v]) => [u - wo, v]), lerp(1.1, 0.4, prog(b, 2.0, 2.4)), 1 - prog(b, 2.36, 2.5));
    }
    if (b >= AT.rtOut && b < AT.commit) {
      const u = keys(b, [[AT.rtOut, U_G + 330], [AT.flange, U_F, E.io], [AT.core, U_F + 250, E.io], [AT.hub, U_F + 440, E.out]]);
      // 光点钻进 StateCore 那块牌子、从另一头出来：它在牌子正中停一下，不能停在字上。
      const box = [F4[0] + SC_BOX[0], F4[1] + SC_BOX[1], F4[0] + SC_BOX[2], F4[1] + SC_BOX[3]];
      outside(tp, box, () => spark(tp, M(u), [M(Math.max(U_G + 330, u - 320)), M(u)], 1 - 0.7 * prog(b, AT.hub, AT.commit), 1 - prog(b, AT.commit - 0.08, AT.commit)));
    }
    clawdGate(tp, b, f.BAR);
    clawdTower(tp, b, f.BAR);
    G.composite(bg.upload(), { mode: G.MODE.normal });
    G.composite(top.upload(), { mode: G.MODE.normal });
    // 字底下不压任何纹理：后期颗粒、色差、光晕都关掉；最后一帧要全黑，颗粒是在 fade 之后加的，所以必须是 0。
    const sh = hitS * 6;
    f.post = {
      bloom: 0, threshold: 1.2, halation: 0, ca: 0, grain: 0, vignette: 0.12,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      flash: Math.max(impact(b, AT.s202, 0.1) * 0.14, prog(b, AT.dive - 0.23, AT.dive - 0.11)),
      flashCol: b > AT.dive - 0.5 ? [0.85, 0.36, 0.2] : [1.0, 0.72, 0.55],
      fade: prog(b, AT.dive - 0.1, AT.dive - 0.03),
      blur: [(c0[0] - c[0]) * c[2], (c0[1] - c[1]) * c[2]], zoomBlur: clamp(Math.log(c[2] / c0[2]), -0.2, 0.2),
    };
  }

  window.CHAPTERS.push({
    id: "ch02", title: "ch.02", bars: 30,
    async init() {
      bg = G.layer("bg"); top = G.layer("top");
      await Promise.all([
        document.fonts.load('900 40px "Noto Sans SC ch02"', "门禁与分拣"),
        document.fonts.load('700 40px "Noto Sans SC ch02"', "每个上报方"),
        document.fonts.load('900 40px "Big Shoulders ch02"', "02THE"),
        document.fonts.load('600 40px "Big Shoulders ch02"', "Each reporter"),
        document.fonts.load('900 40px "Big Shoulders Stencil ch02"', "0123456789"),
      ]);
      dots = makeDots(); dotTile = makeTile();
    },
    render,
    share: { whipBand },
  });
})();
