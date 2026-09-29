// 第 07 章 · 节拍器（上报器各自的调频，FACTS §7）。12 小节，纸面，全是 2D。
// 一拍 = 一分钟：摆杆摆到一端「响」一下 = 这个上报器跑一轮。
// 三台从左到右：服务器（server-reporter，固定，不问人数）、编码账号限额（agents-reporter，读推送房间的 GET /count）、
// PlayStation（n100 上的 playstation-reporter，在家里的局域网发发现包，看主机醒没醒，不问人数、不连天线）。
// 推送房间画成第 03、05 章那根天线：小屋符号是四个库里的「实时 · StateHub」，不能拿来画推送房间。
// 场景（章内小节）：
//   0–1 接第 06 章最后一帧（镜头 [6400, 690, 0.85]、两条线在世界 y 540 / 840，同一张纸不切）往右横移，两条线在终点站收住
//   1–4 有人在看、主机醒着 · 4–6 页面都在后台（只有限额慢一档，PS 看的是主机）
//   6–9 入夜：6:0 发现包回 620，PS 当拍响最后一下、落到闲档；7:2 主机断电，同一档不额外打；6:2 起限额打盹，7:3 醒一下看人数又睡
//   9–11 早上有人来：9:0 限额的小睡检查看到人就醒；PS 不看人数，9:3 主机开机、10:0 那一探回 200 才当拍回到快档
//   11–12 人数问不到当 0：限额 11:2 跑完那一轮又去睡，PS、服务器照旧；镜头冲进服务器那台，12:0 那一响是第 08 章心电图的第一个尖峰
// 各台的响点在 PS_SEGS / LIM_SEGS（按拍），music/ch07.js 的 kick 和 story 用同一组拍：改一边先对另一边，再对 SCRIPT.md。
// 坐标：节拍器那一页按主机位（镜头 [9400, 690, 1]）的屏幕坐标写，画的时候平移 (OX, OY) 进世界坐标。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, rect, clawd, roundRect } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch07.title": ["节拍器", "Metronomes"],
    "ch07.sub": ["三种节奏：固定、看人数、看主机", "Fixed, by audience, by console"],
    "ch07.legend": ["一拍 = 一分钟", "1 beat = 1 minute"],
    "ch07.sA": ["有人在看 · 主机醒着", "Watched · console awake"],
    "ch07.sB": ["页面都在后台", "Every page in the background"],
    "ch07.sC": ["入夜 · 没人", "Night · nobody here"],
    "ch07.sD": ["早上 · 有人来了", "Morning · a visitor"],
    "ch07.sE": ["人数问不到", "Head count unreadable"],
    "ch07.srv": ["服务器 · 不问人数", "Server · never asks"],
    "ch07.lim": ["编码账号限额", "Coding plan limits"],
    "ch07.ps": ["PlayStation", "PlayStation"],
    "ch07.count": ["人数", "Head count"],
    "ch07.watch": ["正在看", "watching"],
    "ch07.open": ["开着的", "open"],
    "ch07.console": ["家里的 PS5", "The PS5 at home"],
    "ch07.probe": ["同一个局域网里的发现包", "discovery probes, home LAN"],
    "ch07.fast": ["快档", "fast"],
    "ch07.idle": ["闲档", "idle"],
    "ch07.awake": ["醒着", "awake"],
    "ch07.rest": ["休息", "rest mode"],
    "ch07.noReply": ["没应答", "no reply"],
    "ch07.naps": ["限额：60 分钟 = 12 次 5 分钟的盹", "Limits: 60 min = twelve 5-min naps"],
    "ch07.napCheck": ["每次醒来看一眼人数", "a head-count check after each"],
    "ch07.same1": ["休息和关机是同一档，", "Rest mode and off share a tier:"],
    "ch07.same2": ["来回切不额外打", "switching adds no round"],
    "ch07.noCount1": ["PS 不看人数，", "PS ignores the head count:"],
    "ch07.noCount2": ["只看主机醒没醒", "it only asks if the console is awake"],
    "ch07.flip1": ["醒着和没醒对调，", "Awake and asleep swap:"],
    "ch07.flip2": ["当场打一轮", "one round, right away"],
    "ch07.backoff": ["（退避没到时一律不放行）", "(unless a backoff is still running)"],
    "ch07.n1a": ["主机醒着，就勤打 PSN；", "Console awake, PSN ticks fast;"],
    "ch07.n1b": ["限额看有没有人在看。", "limits follow who's watching."],
    "ch07.n2a": ["入夜人走光，只有服务器照旧：", "At night only the server keeps time:"],
    "ch07.n2b": ["问人数，并不比直接报省。", "asking costs as much as reporting."],
    "ch07.n3a": ["PS5 一开机，", "Power the PS5 on"],
    "ch07.n3b": ["马上回到快档。", "and the fast tick starts now."],
    "ch07.n4a": ["人数问不到就当 0：", "No head count? Call it zero:"],
    "ch07.n4b": ["只会变慢，不会变快。", "slower, never faster."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, stampL, top;
  let BARs = (60 / 108) * 4;
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出
  // 按拍算的衰减脉冲（φ = 小节 × 4）
  const pulse = (phi, at, hl = 0.12) => (phi < at ? 0 : Math.exp((-((phi - at) * BARs) / 4 / hl) * Math.LN2));

  // ---------- 节奏表（按拍）：swing 余弦摆到另一端，两端各「响」一下；park 停在起始那一端（打盹）；
  // creep 按 P 拍半周慢慢挪，过了 snap 拍加速甩到另一端 ----------
  const every = (a, b, step) => { const out = []; for (let k = a; k < b; k += step) out.push({ a: k, b: k + step, mode: "swing" }); return out; };
  function sided(segs, s0) { let s = s0; return segs.map((g) => { const o = { ...g, s }; if (g.mode !== "park") s = -s; return o; }); }
  // PlayStation 只有两档（reporters/playstation-reporter/src/cadence.ts）：醒着那一档，发现包一拍四下、过线那一探在每拍上 → 每拍；
  // 没醒是闲档，画成半周 29.5 拍（章里走不完）。片中不写这两档的数，只写快档、闲档（FACTS §1）。
  // 醒着和没醒对调当场打一轮，两次对调都放在拍上，「当场」和「落拍」是同一下
  const PS_SEGS = sided([
    ...every(-1, 24, 1),
    { a: 24, b: 40, mode: "creep", P: 29.5, snap: 39.5 }, // 6:0 回 620：当拍响最后一下，落到闲档；10:0 回 200
    ...every(40, 50, 1),
  ], -1);
  // 限额：跑完一轮才定下一次等多久（5 / 10 / 60 分钟），60 分钟是 12 个 5 分钟的盹、每个醒来问一次人数
  const LIM_SEGS = sided([
    ...every(-4, 16, 5),
    { a: 16, b: 26, mode: "swing" },
    { a: 26, b: 36, mode: "park" }, // 31 醒一下（0 人）又睡，36 看到人
    ...every(36, 46, 5),
    { a: 46, b: 999, mode: "park" }, // 问不到当 0：又去睡
  ], 1);
  const ticksOf = (segs) => segs.map((g) => g.a).filter((a) => a >= 0);
  const PS_TICKS = ticksOf(PS_SEGS), LIM_TICKS = ticksOf(LIM_SEGS);
  const NAP_CHECKS = [31, 36];
  const AMP = 0.42;
  function angle(segs, phi) {
    let g = segs[segs.length - 1];
    for (const s of segs) if (phi < s.b) { g = s; break; }
    const u = phi - g.a;
    if (g.mode === "park") return g.s * AMP;
    if (g.mode === "creep") {
      if (g.snap != null && phi > g.snap) {
        const from = g.s * AMP * Math.cos((Math.PI * (g.snap - g.a)) / g.P);
        return lerp(from, -g.s * AMP, E.in(clamp((phi - g.snap) / (g.b - g.snap))));
      }
      return g.s * AMP * Math.cos((Math.PI * u) / g.P);
    }
    return g.s * AMP * Math.cos(Math.PI * clamp(u / (g.b - g.a)));
  }
  // 服务器：固定每分钟，12:0（第 08 章 0:0）摆到右端
  const srvAngle = (phi) => AMP * Math.cos(Math.PI * phi);
  // 摆锤的位置就是档位：越往上越慢（和真的节拍器一样）。[拍, 离支点的距离]，换档用一拍滑过去
  const PS_D = [[-99, 100], [24, 228], [40, 100]];
  const LIM_D = [[-99, 168], [16, 196], [26, 240], [36, 168], [46, 240]];
  const SRV_D = 104;
  function slide(phi, table) {
    let d = table[0][1];
    for (let i = 1; i < table.length; i++) d = lerp(d, table[i][1], E.io(clamp(phi - table[i][0])));
    return d;
  }
  const stepAt = (phi, table) => { let v = table[0][1], at = -99; for (const [t, x] of table) if (phi >= t) { v = x; at = t; } return [v, at]; };
  const PS_R = [[-99, "ch07.fast"], [24, "ch07.idle"], [40, "ch07.fast"]]; // 文字键：PS 的档位只写字，不写数
  const LIM_R = [[-99, "5 min"], [16, "10 min"], [26, "60 min"], [36, "5 min"], [46, "60 min"]];
  const ONLINE = [[-99, "02"], [16, "00"], [36, "01"]];
  const CONN = [[-99, "03"], [24, "00"], [36, "01"]];
  const SCENE = [[-99, "ch07.sA"], [16, "ch07.sB"], [24, "ch07.sC"], [36, "ch07.sD"], [44, "ch07.sE"]];
  // 家里的主机：发现包的读数（200 醒着、620 休息、没应答 = 关机）。9:3 开机灯先亮，10:0 那一探才答 200
  const CONSOLE = [[-99, "awake"], [24, "rest"], [30, "off"], [40, "awake"]];
  const BOOT = 39;
  const REPLY = { awake: ["200", "ch07.awake"], rest: ["620", "ch07.rest"], off: ["—", "ch07.noReply"] };
  const FAIL = 43.9; // 11:0 那一问起问不到

  // ---------- 主机位的布局（屏幕坐标，画时平移进世界） ----------
  const OX = 8440, OY = 150;
  const MAIN = [9400, 690, 1, 0];
  const BY = 720, MS = 0.85; // 桌面（底座下沿）、节拍器缩放
  const MX = { srv: 290, lim: 690, ps: 1090 };
  const PIV = 92 * MS, ROD = 286 * MS;
  const CAP_Y = BY - 412 * MS;
  const tipOf = (cx, th) => [cx + Math.sin(th) * ROD, BY - PIV - Math.cos(th) * ROD];
  const MAST = [1480, 320], BUS_Y = 286, XMARK = 1410;
  const HC = { x: 1330, y: 370, w: 530, h: 210 }; // 人数表
  const PS5 = { x: 1360, y: 606, w: 72, h: 116 }; // 家里的 PS5（正视，一块立着的机身）
  const PROBE = [[1206, 642], [PS5.x - 6, 660]]; // PS 那台 → 主机：发现包走的路
  const NOTE_Y = 790, NOTE2_Y = 950;

  // ---------- 镜头 ----------
  // 结尾冲进服务器那台：12:0 它摆到右端，摆尖落在屏幕 (1100, 300)，第 08 章心电图第一个尖峰的尖在同一处
  const [TIPX, TIPY] = tipOf(MX.srv, AMP);
  const ZF = 2.4, END = [TIPX + OX - (1100 - 960) / ZF, TIPY + OY - (300 - 540) / ZF, ZF, 0];
  const CAM = [
    [0, [6400, 690, 0.85, 0]],
    [0.95, MAIN, E.io],
    [11.45, [9470, 700, 1.04, 0], E.lin],
    [12.0, END, E.inExpo],
  ];
  const PLATE_RECT = [-600, -300, 11200, 2400];
  // 第 06 章的两条线在这里到终点站
  const TERM_X = 7700;

  // ---------- 画：节拍器（正视：梯形机身、刻度板、摆杆绕底部支点转、摆锤） ----------
  function metronome(x, cx, th, d, a = 1) {
    if (a <= 0) return;
    const inkC = css("pink");
    x.save(); x.globalAlpha = a; x.translate(cx, BY); x.scale(MS, MS);
    x.lineJoin = "round"; x.strokeStyle = inkC; x.fillStyle = css("paper");
    x.lineWidth = 3.4; roundRect(x, -170, -40, 340, 40, 6); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-140, -40); x.lineTo(-54, -400); x.lineTo(54, -400); x.lineTo(140, -40); x.closePath(); x.fill(); x.stroke();
    x.lineWidth = 3; x.fillRect(-62, -412, 124, 12); x.strokeRect(-62, -412, 124, 12);
    // 正面开口和刻度板（刻度只当纹理）
    x.lineWidth = 1.6; x.globalAlpha = a * 0.55;
    x.beginPath(); x.moveTo(-112, -62); x.lineTo(-38, -378); x.lineTo(38, -378); x.lineTo(112, -62); x.stroke();
    x.strokeRect(-14, -362, 28, 250);
    for (let j = 0; j < 18; j++) { const y = -350 + j * 13.5; x.beginPath(); x.moveTo(j % 3 ? -6 : -12, y); x.lineTo(j % 3 ? 6 : 12, y); x.stroke(); }
    x.globalAlpha = a;
    // 摆杆、摆锤、支点
    x.translate(0, -92); x.rotate(th);
    x.lineWidth = 6; x.lineCap = "round"; x.beginPath(); x.moveTo(0, 16); x.lineTo(0, -286); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.moveTo(-26, -d + 16); x.lineTo(26, -d + 16); x.lineTo(19, -d - 16); x.lineTo(-19, -d - 16); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.arc(0, 0, 11, 0, TAU); x.fill(); x.stroke();
    x.restore();
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  // 摆到一端「响」：摆尖亮一下
  function tickFlash(e, cx, th, phi, ticks) {
    let p = 0;
    for (const t of ticks) if (phi >= t && phi - t < 1.5) p = Math.max(p, pulse(phi, t));
    if (p > 0.02) { const [tx, ty] = tipOf(cx, th); glow(e, tx, ty, 60, 0.5 * p); }
  }
  // 推送房间：第 03、05 章那根天线（圆里一个叉），被问的时候左右亮几道短弧
  function mast(x, mx, my, a, hot = 0) {
    if (a <= 0) return;
    const inkC = css("pink");
    x.save(); x.globalAlpha = a; x.strokeStyle = inkC; x.lineWidth = 2.6; x.fillStyle = css("paper");
    x.beginPath(); x.arc(mx, my, 18, 0, TAU); x.fill(); x.stroke(); x.restore();
    line(x, mx - 12, my - 12, mx + 12, my + 12, 2, inkC, a); line(x, mx - 12, my + 12, mx + 12, my - 12, 2, inkC, a);
    if (hot > 0.02) for (let j = 1; j <= 3; j++) {
      x.save(); x.globalAlpha = a * hot * (1 - j * 0.22); x.strokeStyle = css("signal"); x.lineWidth = 2.4;
      x.beginPath(); x.arc(mx, my, 18 + j * 11, -0.6, 0.6); x.stroke(); x.beginPath(); x.arc(mx, my, 18 + j * 11, Math.PI - 0.6, Math.PI + 0.6); x.stroke();
      x.restore();
    }
  }
  function dashLine(x, pts, color, alpha, dash = [9, 8], w = 2) {
    x.save(); x.globalAlpha = alpha; x.strokeStyle = color; x.lineWidth = w; x.setLineDash(dash); x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  // 问人数的路：节拍器顶上 → 母线 → 天线
  const askPath = (cx) => [[cx, CAP_Y - 4], [cx, BUS_Y], [MAST[0], BUS_Y], [MAST[0], MAST[1] - 20]];
  // 一问一答：小点沿路过去再回来；问不到时停在叉上
  function askDot(x, e, cx, phi, t0, dur, failed) {
    const k = (phi - t0) / dur;
    if (k <= 0 || k >= 1) return 0;
    const pts = askPath(cx), L = K.pathLen(pts), stop = failed ? L - (MAST[0] - XMARK) - (MAST[1] - 20 - BUS_Y) : L;
    const d = failed ? Math.min(stop, 2 * k * L) : (k < 0.5 ? 2 * k : 2 - 2 * k) * L;
    const [px, py] = K.pathAt(pts, d);
    const a = failed ? 1 - prog(k, 0.6, 1) : 1;
    x.save(); x.globalAlpha = a; x.fillStyle = css("signal"); x.beginPath(); x.arc(px, py, 6, 0, TAU); x.fill(); x.restore();
    glow(e, px, py, 26, 0.5 * a);
    return !failed && k > 0.4 && k < 0.6 ? 1 : 0;
  }
  // 家里的 PS5 和发现包：小点从 PS 那台一路走到主机，一拍四个；主机旁边写最近一次的读数。
  // 主机不画品牌，只是一块立着的机身，醒着时顶上一道灯带亮橙色
  function consoleSide(x, e, phi, a) {
    if (a <= 0) return;
    const [st, at] = stepAt(phi, CONSOLE);
    const { x: px, y: py, w, h } = PS5;
    const lit = st === "awake" ? 1 : phi >= BOOT ? 0.35 + 0.35 * Math.sin((phi - BOOT) * Math.PI * 4) ** 2 : st === "rest" ? 0.25 : 0;
    x.save(); x.globalAlpha = a; x.strokeStyle = css("pink"); x.fillStyle = css("paper"); x.lineWidth = 3;
    roundRect(x, px, py, w, h, 14); x.fill(); x.stroke();
    x.lineWidth = 1.6; x.globalAlpha = a * 0.5; x.beginPath(); x.moveTo(px + w / 2, py + 10); x.lineTo(px + w / 2, py + h - 10); x.stroke();
    x.restore();
    fillRect(x, px + 10, py + 12, w - 20, 7, st === "awake" ? css("signal") : css("graphite"), a * (0.3 + 0.7 * Math.min(1, lit)));
    if (st === "awake" || phi >= BOOT) glow(e, px + w / 2, py + 16, 40, 0.5 * lit * a);
    // 发现包：沿虚线往主机走，路上一直有四个
    dashLine(x, PROBE, css("pink"), 0.5 * a, [5, 7]);
    const [p0, p1] = PROBE;
    for (let k = Math.floor(phi * 4) - 4; k <= Math.floor(phi * 4); k++) {
      const u = phi - k / 4;
      if (u < 0 || u >= 1) continue;
      const dx = lerp(p0[0], p1[0], u), dy = lerp(p0[1], p1[1], u);
      x.save(); x.globalAlpha = a * Math.sin(u * Math.PI); x.fillStyle = css("pink"); x.beginPath(); x.arc(dx, dy, 4.5, 0, TAU); x.fill(); x.restore();
    }
    text(x, "UDP 9302", p0[0] + 4, p0[1] - 22, { font: FONT.mono(28, 500), alpha: a });
    // 旁边三行：谁、多久一个、这会儿答的是什么（读数一变就橙一下）
    const tx = px + w + 24;
    text(x, tr("ch07.console"), tx, py + 34, { font: FONT.cjk(30, 600), alpha: a, maxW: 1860 - tx });
    text(x, tr("ch07.probe"), tx, py + 74, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: a, maxW: 1860 - tx });
    const [code, word] = REPLY[st];
    const hot = at > 0 && phi - at < 2;
    const cw = K.measure(x, code, FONT.mono(34, 700));
    text(x, code, tx, py + 118, { font: FONT.mono(34, 700), color: hot ? css("signal") : css("pink"), alpha: a });
    text(x, "· " + tr(word), tx + cw + 12, py + 116, { font: FONT.cjk(28, 600), color: hot ? css("signal") : css("graphite"), alpha: a, maxW: 1860 - tx - cw - 12 });
    if (at > 0) glow(e, tx + cw / 2, py + 106, 50, 0.45 * pulse(phi, at, 0.2) * a);
  }

  // ---------- 场景 ----------
  function title(x, b) {
    const a = prog(b, 0.5, 0.95, E.out);
    if (a <= 0) return;
    text(x, "07", 110, 196, { font: FONT.pixel(112), color: css("signal"), alpha: a });
    text(x, tr("ch07.title"), 290, 176, { font: FONT.cjk(58, 600), reveal: prog(b, 0.55, 1.0), alpha: a });
    text(x, tr("ch07.sub"), 292, 226, { font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, 0.65, 1.1), alpha: a });
    line(x, 110, 262, 110 + 450 * prog(b, 0.6, 1.2, E.outExpo), 262, 1.4, css("pink"), a);
  }
  function scene(x, phi, a) {
    const [key, at] = stepAt(phi, SCENE);
    const k = prog(phi, at, at + 0.6);
    const prev = SCENE[Math.max(0, SCENE.findIndex(([t]) => t === at) - 1)][1];
    if (k < 1 && at > 0) text(x, tr(prev), 1860, 176, { font: FONT.cjk(38, 600), align: "right", alpha: a * (1 - k) });
    text(x, tr(key), 1860, 176, { font: FONT.cjk(38, 600), color: at > 0 && phi - at < 4 ? css("signal") : css("pink"), align: "right", alpha: a * k, maxW: 520 });
    text(x, tr("ch07.legend"), 1860, 222, { font: FONT.cjk(28, 600), color: css("graphite"), align: "right", alpha: a });
  }
  function headCount(x, phi, a, asked) {
    const { x: px, y: py, w, h } = HC;
    rect(x, px, py, w, h, 2.4, css("pink"), a);
    text(x, tr("ch07.count"), px + 26, py + 46, { font: FONT.cjk(30, 600), alpha: a });
    line(x, px + 20, py + 66, px + w - 20, py + 66, 1.2, css("pink"), 0.5 * a);
    [["online", "ch07.watch", ONLINE], ["connections", "ch07.open", CONN]].forEach(([key, lab, table], i) => {
      const y = py + 118 + i * 66;
      const kw = K.measure(x, key, FONT.mono(30, 500));
      text(x, key, px + 26, y, { font: FONT.mono(30, 500), alpha: a });
      text(x, tr(lab), px + 40 + kw, y, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: a });
      const [v, at] = stepAt(phi, table);
      const fresh = at > 0 ? pulse(phi, at, 0.35) : 0;
      if (asked > 0.02) fillRect(x, px + w - 110, y - 40, 90, 52, css("signal"), 0.12 * asked * a);
      text(x, v, px + w - 26, y + 6, { font: FONT.mono(48, 600), color: fresh > 0.1 ? css("signal") : css("pink"), align: "right", alpha: a });
    });
  }
  // 每台下面：此刻的间隔（换档时橙一下）、名字、上报器
  function labels(x, cx, readout, changedAt, phi, name, sub, a, word = false) {
    const hot = changedAt > 0 && phi - changedAt < 2;
    text(x, readout, cx, BY + 56, { font: word ? FONT.cjk(44, 600) : FONT.mono(44, 600), color: hot ? css("signal") : css("pink"), align: "center", alpha: a });
    text(x, name, cx, BY + 98, { font: FONT.cjk(30, 600), align: "center", alpha: a, maxW: 380 });
    text(x, sub, cx, BY + 136, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: a });
  }
  // 限额打盹：摆杆停住，头顶一串 z（z 只当纹理）
  function zees(x, phi, a) {
    if (a <= 0) return;
    for (let j = 0; j < 3; j++) {
      const u = ((phi * 0.5 + j / 3) % 1 + 1) % 1;
      const zx = MX.lim - 40 - u * 90, zy = CAP_Y - 14 - u * 70;
      text(x, "z", zx, zy, { font: FONT.mono(30 + 18 * u, 600), color: css("graphite"), alpha: a * Math.sin(u * Math.PI), texture: true });
    }
  }
  // 右栏的注记：夜里是限额的 12 个盹（每格一个 5 分钟）和右下角「休息 = 关机」，早上是 PS 只看主机、对调当场打一轮
  function notes(x, phi, a) {
    const napA = win(phi, 26.2, 26.8, 35.6, 36.2) * a;
    if (napA > 0) {
      text(x, tr("ch07.naps"), HC.x, NOTE_Y, { font: FONT.cjk(28, 600), alpha: napA, maxW: 530 });
      for (let i = 0; i < 12; i++) {
        const bx = HC.x + i * 44, by = NOTE_Y + 20;
        const k = clamp((phi - 26 - i * 5) / 5);
        rect(x, bx, by, 34, 26, 1.6, css("pink"), napA * (phi >= 36 && i >= 2 ? 0.35 : 1));
        if (k > 0) fillRect(x, bx + 3, by + 3, 28 * k, 20, css("pink"), 0.8 * napA);
        if (i < 2 && phi >= 31 + i * 5) text(x, "✓", bx + 17, by - 6, { font: FONT.mono(22, 600), color: css("signal"), align: "center", alpha: napA, texture: true });
      }
      text(x, tr("ch07.napCheck"), HC.x, NOTE_Y + 84, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: napA, maxW: 530 });
    }
    // 7:2 主机断电：读数从 620 变成没应答，PS 那台什么也不做
    const sameA = win(phi, 30.1, 30.6, 35.4, 36.0) * a;
    if (sameA > 0) {
      text(x, tr("ch07.same1"), HC.x, NOTE2_Y, { font: FONT.cjk(30, 600), alpha: sameA, maxW: 530 });
      text(x, tr("ch07.same2"), HC.x, NOTE2_Y + 44, { font: FONT.cjk(30, 600), color: css("signal"), alpha: sameA, maxW: 530 });
    }
    const ncA = win(phi, 36.2, 36.8, 39.6, 40.1) * a;
    if (ncA > 0) {
      text(x, tr("ch07.noCount1"), HC.x, NOTE_Y + 10, { font: FONT.cjk(30, 600), alpha: ncA, maxW: 530 });
      text(x, tr("ch07.noCount2"), HC.x, NOTE_Y + 54, { font: FONT.cjk(30, 600), color: css("signal"), alpha: ncA, maxW: 530 });
    }
    const flA = win(phi, 40.1, 40.6, 43.6, 44.2) * a;
    if (flA > 0) {
      text(x, tr("ch07.flip1"), HC.x, NOTE_Y + 10, { font: FONT.cjk(30, 600), alpha: flA, maxW: 530 });
      text(x, tr("ch07.flip2"), HC.x, NOTE_Y + 54, { font: FONT.cjk(30, 600), color: css("signal"), alpha: flA, maxW: 530 });
      text(x, tr("ch07.backoff"), HC.x, NOTE_Y + 96, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: flA, maxW: 530 });
    }
  }
  function nar(x, key, px, py, r, a) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: 60, maxW: 1040, reveal: r, alpha: a, dim: 0.12 });
  }

  function page(x, e, tp, b, f) {
    const phi = b * 4;
    const pa = prog(b, 0.15, 0.6);
    title(x, b);
    scene(x, phi, prog(b, 0.6, 1.0));
    // 三台节拍器
    const thS = srvAngle(phi), thL = angle(LIM_SEGS, phi), thP = angle(PS_SEGS, phi);
    // 限额醒一下看人数：摆杆抖一下
    const peek = pulse(phi, 31, 0.25) * Math.sin((phi - 31) * 40) * 0.05;
    metronome(x, MX.srv, thS, SRV_D, pa);
    metronome(x, MX.lim, thL + (phi > 31 && phi < 33 ? peek : 0), slide(phi, LIM_D), pa);
    metronome(x, MX.ps, thP, slide(phi, PS_D), pa);
    tickFlash(e, MX.srv, thS, phi, Array.from({ length: 49 }, (_, i) => i));
    tickFlash(e, MX.lim, thL, phi, LIM_TICKS);
    tickFlash(e, MX.ps, thP, phi, PS_TICKS);
    labels(x, MX.srv, "60 s", -1, phi, tr("ch07.srv"), "server-reporter", pa);
    const [lr, lat] = stepAt(phi, LIM_R), [pr, pat] = stepAt(phi, PS_R);
    labels(x, MX.lim, lr, lat, phi, tr("ch07.lim"), "agents-reporter", pa);
    labels(x, MX.ps, tr(pr), pat, phi, tr("ch07.ps"), "playstation-reporter", pa, true);
    zees(x, phi, win(phi, 26.4, 27, 35.7, 36.1) * pa);
    // 推送房间和问人数的那条路：只有限额那台连过去（服务器不问；PS 看的是家里的主机）
    const la = prog(b, 0.55, 0.95) * pa;
    const failed = phi >= FAIL;
    dashLine(x, [[MX.lim, CAP_Y - 4], [MX.lim, BUS_Y], [MAST[0], BUS_Y], [MAST[0], MAST[1] - 20]], css("pink"), 0.6 * la);
    text(x, "GET /count", MX.lim + 16, BUS_Y - 12, { font: FONT.mono(28, 500), alpha: la });
    let asked = 0;
    // 限额在每轮之后、每个盹醒来时问一次
    for (const t of [1, 6, 11, 16, 21, 26, 31, 36, 41, 46]) {
      const pre = t === 21 || NAP_CHECKS.includes(t);
      asked = Math.max(asked, askDot(x, e, MX.lim, phi, pre ? t - 0.5 : t + 0.05, 0.45, t >= FAIL));
    }
    mast(x, MAST[0], MAST[1], la, asked);
    text(x, "LivePushRoom", MAST[0] + 34, MAST[1] + 10, { font: FONT.mono(28, 500), alpha: la });
    headCount(x, phi, la, asked);
    // 问不到：限额那条线上一个叉，读到的当 0
    if (failed) {
      const k = prog(phi, FAIL, FAIL + 0.3, E.outBack);
      const c = css("signal");
      line(x, XMARK - 16 * k, BUS_Y - 16 * k, XMARK + 16 * k, BUS_Y + 16 * k, 4, c);
      line(x, XMARK - 16 * k, BUS_Y + 16 * k, XMARK + 16 * k, BUS_Y - 16 * k, 4, c);
      glow(e, XMARK, BUS_Y, 60, 0.5 * pulse(phi, FAIL, 0.2));
      text(x, "0", MX.lim - 16, CAP_Y - 20, { font: FONT.mono(34, 700), color: c, align: "right", alpha: prog(phi, FAIL + 0.2, FAIL + 0.5) });
    }
    consoleSide(x, e, phi, la);
    notes(x, phi, pa);
    // 旁白（左下）
    nar(x, "ch07.n1a", 110, 944, prog(b, 1.0, 1.6), win(b, 1.0, 1.1, 3.8, 3.95));
    nar(x, "ch07.n1b", 110, 1024, prog(b, 1.6, 2.3), win(b, 1.0, 1.1, 3.8, 3.95));
    nar(x, "ch07.n2a", 110, 944, prog(b, 6.3, 7.0), win(b, 6.3, 6.4, 8.85, 9.0));
    nar(x, "ch07.n2b", 110, 1024, prog(b, 7.0, 7.8), win(b, 6.3, 6.4, 8.85, 9.0));
    nar(x, "ch07.n3a", 110, 944, prog(b, 9.05, 9.5), win(b, 9.05, 9.15, 10.85, 11.0));
    nar(x, "ch07.n3b", 110, 1024, prog(b, 9.5, 10.2), win(b, 9.05, 9.15, 10.85, 11.0));
    nar(x, "ch07.n4a", 110, 944, prog(b, 11.0, 11.22), win(b, 11.0, 11.05, 11.62, 11.75));
    nar(x, "ch07.n4b", 110, 1024, prog(b, 11.22, 11.45), win(b, 11.0, 11.05, 11.62, 11.75));
    // Clawd 在限额旁边一起打盹，早上被叫醒就走
    const cIn = prog(b, 6.6, 6.9), cOut = prog(b, 9.05, 9.35);
    if (cIn > 0 && cOut < 1) {
      const hop = Math.sin(cOut * Math.PI) * 70 + (1 - E.out(cIn)) * 40;
      clawd(tp, 500 - 60 * E.in(cOut), BY - hop, 6, { pose: cOut > 0 ? "arms-up" : "default", crouch: cOut > 0 ? 0 : 1, alpha: cIn * (1 - cOut) });
      const za = cIn * (1 - prog(b, 8.95, 9.05));
      for (let j = 0; j < 2; j++) {
        const u = ((phi * 0.4 + j / 2) % 1 + 1) % 1;
        text(x, "z", 540 + u * 30, BY - 60 - u * 50, { font: FONT.mono(22 + 10 * u, 600), color: css("graphite"), alpha: za * Math.sin(u * Math.PI), texture: true });
      }
    }
  }

  // 第 06 章那两条线：接着画到终点站，左边一直画出画面
  function lines(x, cam) {
    const x0 = Math.min(TERM_X - 10, cam.x - 960 / cam.zoom - 300);
    if (x0 >= TERM_X - 10) return;
    line(x, x0, 540, TERM_X, 540, 14, css("pink"));
    line(x, x0, 840, TERM_X, 840, 14, css("signal"));
    line(x, TERM_X, 540 - 34, TERM_X, 540 + 34, 14, css("pink"));
    line(x, TERM_X, 840 - 34, TERM_X, 840 + 34, 14, css("signal"));
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar, phi = b * 4;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(pulse(phi, 40, 0.1), pulse(phi, FAIL, 0.1) * 0.7);
    cam.zoom *= 1 + 0.012 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    stampL.begin(); stampL.cam(cam);
    const tp = top.begin(); top.cam(cam);

    lines(x, cam);
    for (const c of [x, e, tp]) { c.save(); c.translate(OX, OY); }
    page(x, e, tp, b, f);
    for (const c of [x, e, tp]) c.restore();

    // 接缝：墨的 seed 和第 06 章一样，第一帧两条线的墨纹才不跳
    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 8.3 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.4 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 1.7 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 5;
    f.post = {
      bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch07", title: "ch.07", bars: 12,
    init() { plate = G.pass(K.PLATE.paper); ink = G.layer("ink"); emit = G.layer("emit", 0.5); stampL = G.layer("stamp"); top = G.layer("top"); },
    render,
  });
})();
