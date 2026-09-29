// 第 01 章 · 野外观测站（采集端：外部上报器 + 采集 Worker，Claude Code 云端的 OTLP 另算一个入口，FACTS §1）。20 小节，暗底专利图，全是 2D。
// 一长条暗底图纸，镜头只做横移：每件仪器一个机位，甩 0.22 小节、落在拍上，停住时慢推。
// 上报器有几个、采集任务有几个只画不说：旁白和标注里不出这两个数（CONVENTIONS「事实」）。
//   S0 标题与图纸索引（0–1.5）：七个图号，前五个是外部上报器，第 6 号是云端那一小段遥测，第 7 号是表盘
//   M1 FIG. 1 Mac（1.5–5）：2:0 换歌，白卡逐字敲出信封、modules 只亮 appleMusic；3:1 空信封的呼吸（90 s）；
//     4:0 切应用、4:1 又切一次重新计时、4:3 量满 400 ms 落定（防抖，ServiceController 的 desktopSettleDelay）
//   M2 FIG. 1A / 1B（5–8）：窗口标题过 Jev，问题横条同时走、6:0 一起给出概率条（示意，不和出路对应）；
//     应用图标压成哈希，7:0 落进 R2 的抽屉、7:1 关上，信封里只剩文件名
//   F2–F6（8–14.5）：iPhone、家里（Home Assistant 那把钥匙开两扇门；n100 上的容器用 UDP 探测 PS5，10:0 开机后
//     档位牌从闲档翻到快档）、NAS、东京的机柜、云端的一小段遥测
//   CU 编码用量（14.5–16）：三处原始数汇到站点这边合并，合并处伸出一段 Pulse，多一条 Tokens 道
//   F7 表盘（16–19）：cron 每分钟一响（一拍当一分钟），每根指针一个采集任务，右边白卡是逐分钟的时序图
//   19–20 甩回 Mac：换歌那封亮起，拖着发丝线往右飞出画面（屏幕 y 540）；第 02 章 0:0 的火花从左边同一高度进场
// 配乐锚点是下面的 AT，music/ch01.js 的 story 按同一组小节落拍，改时间先对这两处和 SCRIPT.md。
// 画面只从 AT 取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
// 时间一律写章内小节（b），5.5 即第 5 小节第三拍。镜头 y 恒为 540、缩放约 1，每个机位就是一屏宽的一段图纸。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, envelope, spark, roundRect, sheet, pathAt, pathLen, trailOn, mulberry32, measure } = K;
  // ---------- 这一章的文字：[中文, English]，场景代码里只写键 ----------
  I18N.add({
    "ch01.title": ["野外观测站", "Field stations"],
    "ch01.n1a": ["上报器守在数据的源头，", "Reporters sit at the source,"],
    "ch01.n1b": ["外加每分钟一响的采集 Worker。", "plus a minute-by-minute collector."],
    "ch01.reporters": ["上报器", "Reporters"],
    "ch01.col": ["采集 Worker", "Collector"],
    // FIG. 1 Mac
    "ch01.f1": ["Mac Telemetry Hub · 菜单栏 App", "Mac Telemetry Hub · a menu bar app"],
    "ch01.env": ["信封", "Envelope"],
    "ch01.unsent": ["没变的格不寄", "unchanged cells stay home"],
    "ch01.n2a": ["Mac 只寄变了的那几格；", "The Mac mails only what changed;"],
    "ch01.n2b": ["没变化，每 90 秒寄个空信封。", "no news: an empty one every 90 s."],
    "ch01.empty": ["没变化：空信封报平安", "no change: an empty envelope"],
    "ch01.settle": ["切应用先等 400 ms 落定", "App switches settle for 400 ms first"],
    "ch01.again": ["又切了：重新计时", "switched again: restart"],
    // FIG. 1A / 1B
    "ch01.f1a": ["窗口标题 → Jev", "Window title → Jev"],
    "ch01.wt": ["窗口标题（不上画面）", "window title (not shown)"],
    "ch01.judge": ["隐私判断", "privacy check"],
    "ch01.illus": ["概率条为示意", "bars are illustrative"],
    "ch01.pass": ["放行的才进信封", "only cleared titles go in"],
    "ch01.owner": ["拿不准：交给主人", "unsure: ask the owner"],
    "ch01.n3a": ["窗口标题先过 Jev：", "Jev screens window titles first;"],
    "ch01.n3b": ["拿不准的交给主人，放行的才进信封。", "unsure ones go to the owner."],
    "ch01.f1b": ["应用图标 → R2", "App icon → R2"],
    "ch01.byContent": ["sha256(内容)", "sha256(content)"],
    "ch01.onlyName": ["信封里只写文件名", "the envelope carries only the name"],
    "ch01.n4a": ["图片按内容起名，直接放进 R2；", "Images are named by their content"],
    "ch01.n4b": ["信封里只写文件名。", "and go straight to R2."],
    // FIG. 2–6
    "ch01.f2": ["iPhone Telemetry Hub · HealthKit 唤醒", "iPhone Telemetry Hub · woken by HealthKit"],
    "ch01.rings": ["活动圆环", "Activity rings"],
    "ch01.workouts": ["训练", "Workouts"],
    "ch01.steps": ["五分钟步数桶", "5-minute step buckets"],
    "ch01.f3": ["家里", "At home"],
    "ch01.f3sub": ["HomePod 与电源经 Home Assistant，游戏另有容器上报", "HomePod and power via Home Assistant; games via a container"],
    "ch01.playing": ["在放什么", "what's playing"],
    "ch01.power": ["电源开关", "power switch"],
    "ch01.key2": ["这把钥匙开两扇门", "one key, two doors"],
    "ch01.probe": ["探测主机状态，按档调整轮询频率", "probes the console, paces its polling"],
    "ch01.tierRest": ["没醒 · 闲档", "resting · slow"],
    "ch01.tierAwake": ["醒着 · 快档", "awake · fast"],
    "ch01.f4sub": ["emby-reporter · NAS 上的容器", "emby-reporter · a container on the NAS"],
    "ch01.poster": ["① 海报先传 R2", "① the poster goes to R2 first"],
    "ch01.watching": ["② 在看什么", "② what's being watched"],
    "ch01.f5": ["东京的机柜", "The Tokyo rack"],
    "ch01.srv": ["服务器状态 · 固定每 60 秒", "server status · every 60 s, fixed"],
    "ch01.lim": ["各家编码工具的限额", "each coding tool's limits"],
    "ch01.cur": ["Cursor 账号的用量", "Cursor account usage"],
    "ch01.f6": ["云端的一小段遥测", "A stretch of cloud telemetry"],
    "ch01.cc": ["Claude Code 云端", "Claude Code in the cloud"],
    "ch01.self": ["Claude Code 自己发，不是我们写的上报器", "Claude Code sends it; not a reporter of ours"],
    "ch01.extra": ["另算一个入口", "an entry of its own"],
    // 编码用量
    "ch01.cu": ["编码用量", "Coding usage"],
    "ch01.srcMac": ["Mac 本机", "the Mac itself"],
    "ch01.srcCursor": ["容器里的 Cursor", "Cursor, via the container"],
    "ch01.merge": ["站点这边合并", "merged on the site side"],
    "ch01.sum": ["三处相加", "all three summed"],
    // 站点 Pulse 卡片上的原文（中英一样）
    "ch01.pulse.coding": ["Coding", "Coding"],
    "ch01.pulse.tokens": ["Tokens", "Tokens"],
    "ch01.pulse.listening": ["Listening", "Listening"],
    "ch01.pulse.watching": ["Watching", "Watching"],
    "ch01.pulse.window": ["Last 24 hours", "Last 24 hours"],
    "ch01.n5a": ["编码用量：三处各报原始数，", "Coding usage: three raw reports;"],
    "ch01.n5b": ["合并在站点这边做。", "the site does the merging."],
    // FIG. 7
    "ch01.f7": ["采集 Worker", "The collector"],
    "ch01.f7sub": ["cron 每分钟一响", "cron fires every minute"],
    "ch01.noGate": ["不走上报入口：直接交给状态核心，或写 LAG", "No ingress: straight to the state core, or to LAG"],
    "ch01.chart": ["各任务的节奏", "Each job's own beat"],
    "ch01.perMin": ["一格一分钟", "one cell = one minute"],
    "ch01.n6a": ["采集 Worker 每分钟醒一次，", "The collector wakes every minute;"],
    "ch01.n6b": ["每个任务按自己的节奏去取。", "each job keeps its own beat."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, paper;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1)); // 淡入、停住、淡出

  // ---------- 时间表（章内小节）：画面和 music/ch01.js 的 story 共用这一组 ----------
  const AT = {
    flip: 2.0, lit: 2.5, post: 2.75, park: 3.0, breath: 3.25,
    sw1: 4.0, sw2: 4.25, settle: 4.75,
    jev: 5.25, judged: 6.0, cleared: 6.25, owner: 6.5,
    pixels: 6.5, hash: 6.75, drop: 7.0, shut: 7.25, objKey: 7.0,
    wake: 8.5, outs: [8.75, 9.0, 9.25],
    homepod: 9.75, power: 10.0, probe: 10.25, awake: 10.375, doors: [10.5, 10.625],
    poster: 11.25, emby: 11.5,
    server: 12.25, agents: 12.75,
    otlp: [13.75, 14.0],
    raw: [14.5, 14.625, 14.75], merge: 15.0, tokens: 15.1,
    dial: 16.0, back: 19.0, launch: 19.25,
  };

  // ---------- 机位：一屏宽一段；每段 [机位, 落定, 起甩] ----------
  const FX = { S0: 960, M1: 2880, M2: 4800, F2: 6720, F3: 8640, F4: 10560, F5: 12480, F6: 14400, CU: 16320, F7: 18240 };
  const STOPS = [["S0", 0, 1.28], ["M1", 1.5, 4.78], ["M2", 5.0, 7.78], ["F2", 8.0, 9.28], ["F3", 9.5, 10.78], ["F4", 11.0, 11.78],
    ["F5", 12.0, 13.28], ["F6", 13.5, 14.28], ["CU", 14.5, 15.78], ["F7", 16.0, 18.7], ["M1", 19.0, 20.0]];
  const CAM = [[0, [FX.S0 - 24, 548, 1.03, 0]]];
  STOPS.forEach(([k, t0, t1], i) => {
    if (i > 0) CAM.push([t0, [FX[k], 540, 1, 0], E.io]);
    CAM.push([t1, [FX[k] + 14, 540, 1.014, 0], i === 0 ? E.out : E.lin]);
  });
  const PLATE_RECT = [-200, -80, 19400, 1160];
  const DATUM = 872; // 图纸下沿的基准线：线上画仪器，线下排旁白

  // ---------- 小件 ----------
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,205,160,${a})`); g.addColorStop(0.3, `rgba(235,135,90,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function nar(x, key, px, py, r, a = 1) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: 60, maxW: 1040, color: css("bone"), reveal: r, alpha: a });
  }
  function dashPath(x, pts, k, w, color, alpha = 1, dash = [8, 7]) {
    if (k <= 0 || alpha <= 0) return null;
    x.save(); x.setLineDash(dash); const head = polyline(x, pts, k, w, color, alpha); x.restore();
    return head;
  }
  function arrowHead(x, tx, ty, ang, color, alpha = 1, s = 14) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
    x.lineTo(tx + Math.cos(ang + 2.6) * s, ty + Math.sin(ang + 2.6) * s);
    x.lineTo(tx + Math.cos(ang - 2.6) * s, ty + Math.sin(ang - 2.6) * s);
    x.fill(); x.restore();
  }
  // 画到 k 的折线，末端带箭头
  function arrowPath(x, pts, k, color, alpha = 1, w = 2, dashed = false) {
    if (k <= 0 || alpha <= 0) return;
    const head = dashed ? dashPath(x, pts, k, w, color, alpha) : polyline(x, pts, k, w, color, alpha);
    if (!head) return;
    const prev = pathAt(pts, Math.max(0, k * pathLen(pts) - 10));
    arrowHead(x, head[0], head[1], Math.atan2(head[1] - prev[1], head[0] - prev[0]), color, alpha);
  }
  // 剖切斜线（专利图的剖面）：只画在矩形里
  function hatch(x, rx, ry, rw, rh, a, gap = 11) {
    if (a <= 0) return;
    x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
    x.globalAlpha = a; x.strokeStyle = css("bone"); x.lineWidth = 1.1; x.beginPath();
    for (let s = rx - rh; s < rx + rw; s += gap) { x.moveTo(s, ry + rh); x.lineTo(s + rh, ry); }
    x.stroke(); x.restore();
  }
  function box(x, rx, ry, w, h, a, o = {}) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a;
    if (o.fill !== false) { x.fillStyle = css(o.fill || "ink2"); o.r ? (roundRect(x, rx, ry, w, h, o.r), x.fill()) : x.fillRect(rx, ry, w, h); }
    x.strokeStyle = o.color || css("bone"); x.lineWidth = o.lw ?? 2.2;
    if (o.dash) x.setLineDash(o.dash);
    if (o.r) { roundRect(x, rx, ry, w, h, o.r); x.stroke(); } else x.strokeRect(rx, ry, w, h);
    x.restore();
  }
  // 集装箱：跑在机器上的一个上报器容器（竖筋）
  function container(x, rx, ry, w, h, a, hot = 0) {
    if (a <= 0) return;
    box(x, rx, ry, w, h, a, { color: hot > 0.5 ? css("signalD") : css("bone"), lw: 2 });
    x.save(); x.globalAlpha = a * 0.45; x.strokeStyle = css("bone"); x.lineWidth = 1; x.beginPath();
    for (let u = rx + 12; u < rx + w - 6; u += 12) { x.moveTo(u, ry + 7); x.lineTo(u, ry + h - 7); }
    x.stroke(); x.restore();
    if (hot > 0) fillRect(x, rx, ry, w, h, css("signalD"), 0.2 * hot * a);
  }
  // R2：一排排不上锁的小抽屉（卡片目录柜），和凭据那只带锁的抽屉不是一回事
  function cabinet(x, rx, ry, w, h, cols, rows, a, open = null) {
    if (a <= 0) return;
    box(x, rx, ry, w, h, a, { lw: 2.6 });
    const cw = (w - 20) / cols, ch = (h - 20) / rows;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const px = rx + 10 + c * cw, py = ry + 10 + r * ch;
      const isOpen = open && open.c === c && open.r === r ? open.k : 0;
      if (isOpen > 0) fillRect(x, px + 4, py + 4, cw - 8, ch - 8, css("ink"), a);
      const dy = isOpen * ch * 0.42;
      box(x, px + 4, py + 4 + dy, cw - 8, ch - 8, a, { lw: 1.4, color: open && open.hot && isOpen > 0 ? css("signalD") : css("bone") });
      line(x, px + cw / 2 - 12, py + ch / 2 + dy, px + cw / 2 + 12, py + ch / 2 + dy, 3, css("bone"), a * 0.8);
    }
  }
  function keycard(x, cx, cy, a, hot = false) {
    if (a <= 0) return;
    const w = 150, h = 62, col = hot ? css("signalD") : css("bone");
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = col; x.lineWidth = 2.4;
    roundRect(x, cx - w / 2, cy - h / 2, w, h, 9); x.fill(); x.stroke();
    x.lineWidth = 1.4; x.strokeRect(cx - w / 2 + 14, cy - 11, 26, 20); x.beginPath(); x.moveTo(cx - w / 2 + 14, cy - 1); x.lineTo(cx - w / 2 + 40, cy - 1); x.stroke();
    for (let j = 0; j < 3; j++) { x.beginPath(); x.moveTo(cx - 14, cy - 12 + j * 12); x.lineTo(cx + 52 - j * 16, cy - 12 + j * 12); x.stroke(); }
    x.restore();
  }
  // 图号：FIG. n + 名字，下面一行注
  function figHead(x, x0, num, name, sub, a, o = {}) {
    if (a <= 0) return;
    const head = num ? `FIG. ${num}` : "";
    const w = head ? measure(x, head, FONT.mono(34, 600)) + 26 : 0;
    if (head) text(x, head, x0, 118, { font: FONT.mono(34, 600), color: css("bone"), alpha: a });
    text(x, name, x0 + w, 118, { font: o.mono ? FONT.mono(34, 500) : FONT.cjk(34, 600), color: css("bone"), alpha: a });
    if (sub) text(x, sub, x0, 162, { font: o.subMono ? FONT.mono(28, 500) : FONT.cjk(28, 600), color: css("ash"), alpha: a, maxW: o.subW });
    line(x, x0, 186, x0 + (o.rule ?? 640), 186, 1.2, css("bone"), 0.35 * a);
  }
  // 64 位十六进制：和上报器一样按内容的 sha256 起名，这里用种子随机数代替，不抄真的对象键
  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const ICON_KEY = hex64(101);
  const KEY_SHORT = `${ICON_KEY.slice(0, 8)}…${ICON_KEY.slice(-4)}.png`;

  // ---------- 图纸的基准线：一长条贯穿全章，每 40 一小格 ----------
  function datum(x, cam) {
    const half = 960 / cam.zoom + 60, x0 = Math.max(-120, cam.x - half), x1 = Math.min(19320, cam.x + half);
    if (x1 <= x0) return;
    const bone = css("bone");
    line(x, x0, DATUM, x1, DATUM, 1.3, bone, 0.32);
    x.save(); x.strokeStyle = bone; x.lineWidth = 1; x.globalAlpha = 0.22; x.beginPath();
    for (let u = Math.ceil(x0 / 40) * 40; u <= x1; u += 40) { const big = u % 200 === 0; x.moveTo(u, DATUM); x.lineTo(u, DATUM + (big ? 12 : 6)); }
    x.stroke(); x.restore();
  }

  // ========== S0 标题与图纸索引 ==========
  // 七个图号的小样：前五个是外部上报器（第 3 号是 Home Assistant 加 n100 上的一台容器，第 5 号是一台机器上的两台容器），
  // 第 6 号是云端那一小段遥测（虚线：不是我们写的，另算一个入口），第 7 号是采集 Worker 的表盘
  const MAP = { x0: 980, dx: 126, y: 560, s: 1.45 };
  function pict(x, i, cx, cy, a) {
    x.save(); x.globalAlpha = a; x.translate(cx, cy); x.scale(MAP.s, MAP.s);
    x.strokeStyle = css("bone"); x.fillStyle = css("ink2"); x.lineWidth = 2 / MAP.s * 1.2;
    const R = (rx, ry, w, h, r = 0) => { r ? roundRect(x, rx, ry, w, h, r) : (x.beginPath(), x.rect(rx, ry, w, h)); x.fill(); x.stroke(); };
    const L = (pts) => { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); };
    if (i === 0) { R(-26, -24, 52, 34); L([[-34, 14], [34, 14]]); }
    else if (i === 1) R(-14, -27, 28, 54, 7);
    else if (i === 2) { R(-36, -16, 34, 32, 6); x.beginPath(); x.arc(-19, 0, 5, 0, TAU); x.stroke(); R(6, -12, 30, 24); for (let j = 0; j < 3; j++) L([[13 + j * 8, -5], [13 + j * 8, 5]]); }
    else if (i === 3) { R(-22, -27, 44, 54); for (let j = 0; j < 3; j++) L([[-12 + j * 12, -18], [-12 + j * 12, 12]]); }
    else if (i === 4) { R(-30, -12, 26, 24); R(4, -12, 26, 24); }
    else if (i === 5) { x.setLineDash([5, 4]); x.beginPath(); x.rect(-26, -20, 52, 40); x.stroke(); x.setLineDash([]); L([[-14, 0], [-6, -8], [2, 6], [10, -4]]); }
    else { x.beginPath(); x.arc(0, 0, 26, 0, TAU); x.fill(); x.stroke(); L([[0, -18], [0, 0], [13, 7]]); }
    x.restore();
  }
  function stationS0(x, b) {
    const bone = css("bone"), ash = css("ash");
    // 硬切进来的第一帧就有章号，标题紧跟着敲出来
    text(x, "01", 110, 196, { font: FONT.pixel(112), color: css("signalD") });
    text(x, tr("ch01.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.02, 0.6) });
    text(x, "reporters/ · workers/collector", 292, 226, { font: FONT.mono(28), color: ash, reveal: prog(b, 0.15, 0.75) });
    line(x, 110, 262, 110 + 990 * prog(b, 0, 0.8, E.outExpo), 262, 1.4, bone, 0.6);
    // 索引：七个图号排成一条，镜头接下来就沿着它往右走
    const xs = (i) => MAP.x0 + i * MAP.dx, y = MAP.y;
    const lk = prog(b, 0.25, 0.9, E.io);
    line(x, xs(0) - 60, y, lerp(xs(0) - 60, xs(6) + 60, lk), y, 1.2, bone, 0.35);
    for (let i = 0; i < 7; i++) {
      const a = prog(b, 0.3 + i * 0.07, 0.45 + i * 0.07);
      if (a <= 0) continue;
      pict(x, i, xs(i), y, a);
      text(x, String(i + 1), xs(i), y + 88, { font: FONT.mono(30, 500), color: ash, align: "center", alpha: a });
    }
    const brA = prog(b, 0.75, 0.95);
    if (brA > 0) {
      const bx0 = xs(0) - 52, bx1 = xs(4) + 52, by = y - 78;
      polyline(x, [[bx0, by + 14], [bx0, by], [bx1, by], [bx1, by + 14]], 1, 1.4, bone, 0.7 * brA);
      text(x, tr("ch01.reporters"), (bx0 + bx1) / 2, by - 20, { font: FONT.cjk(32, 600), color: bone, align: "center", alpha: brA });
      text(x, tr("ch01.col"), xs(6), by - 20, { font: FONT.cjk(32, 600), color: bone, align: "center", alpha: brA });
      // 第 6 号的注排在图号下面：上面那一排括线标注的位置被「采集 Worker」占了
      text(x, tr("ch01.extra"), xs(5), y + 134, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: brA });
    }
    nar(x, "ch01.n1a", 110, 944, prog(b, 0.3, 0.85), win(b, 0.25, 0.35, 1.3, 1.45));
    nar(x, "ch01.n1b", 110, 1024, prog(b, 0.85, 1.4), win(b, 0.25, 0.35, 1.3, 1.45));
  }

  // ========== M1 FIG. 1 Mac ==========
  const LAP = { x: 2050, y: 212, w: 760, h: 430 };
  const MENU_H = 44;
  const WIN = { x: 2135, y: 320, w: 600, h: 236 };
  const HUB = [LAP.x + LAP.w - 42, LAP.y + 16 + MENU_H / 2];
  const PARK = [2890, 540];
  const CARD = { x: 2946, y: 128, w: 836, h: 700 };
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI"; // 数据源的原文：主角这次换歌（全片同一首）
  const CELLS = ["desktop", "appleMusic", "chargingDevices", "…"];
  const APPS = ["Ghostty", "Xcode", "Figma"]; // 前台应用名是数据源的原文（示意）

  function cover(x, px, py, s, a) {
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink"); x.fillRect(px, py, s, s);
    x.strokeStyle = css("bone"); x.lineWidth = 1.6; x.strokeRect(px, py, s, s);
    for (let j = 1; j <= 4; j++) { x.globalAlpha = a * (0.55 - j * 0.1); x.beginPath(); x.arc(px + s * 0.5, py + s * 0.52, s * 0.11 * j, 0, TAU); x.stroke(); }
    x.restore();
  }
  // 纵向压扁再弹开（2D 翻面）：k 过 0.5 时换内容
  const squash = (k) => (k > 0 && k < 1 ? Math.max(0.02, Math.abs(Math.cos(k * Math.PI))) : 1);
  function withSquash(x, cy, s, draw) { x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy); draw(); x.restore(); }

  function laptop(x, e, b, k) {
    const bone = css("bone"), ash = css("ash");
    const { x: lx, y: ly, w, h } = LAP;
    polyline(x, [[lx, ly + h], [lx, ly], [lx + w, ly], [lx + w, ly + h]], k, 2.6, bone);
    polyline(x, [[lx - 52, ly + h], [lx + w + 52, ly + h], [lx + w + 52, ly + h + 26], [lx - 52, ly + h + 26], [lx - 52, ly + h]], k, 2.2, bone);
    const ik = prog(k, 0.45, 1);
    if (ik <= 0) return;
    x.save(); x.globalAlpha = ik; x.fillStyle = css("ink2"); x.fillRect(lx + 16, ly + 16, w - 32, h - 32); x.restore();
    K.rect(x, lx + 16, ly + 16, w - 32, h - 32, 1.4, bone, ik);
    hatch(x, lx - 50, ly + h + 2, w + 100, 22, 0.5 * ik, 10);
    fillRect(x, lx + w / 2 - 60, ly + h, 120, 8, css("ink"), ik); K.rect(x, lx + w / 2 - 60, ly + h, 120, 8, 1.2, bone, ik);
    // 菜单栏：左边是前台应用，右边是 Hub 的图标
    line(x, lx + 16, ly + 16 + MENU_H, lx + w - 16, ly + 16 + MENU_H, 1.2, bone, 0.6 * ik);
    const second = b >= AT.sw2 - 0.05;
    const swK = second ? prog(b, AT.sw2 - 0.05, AT.sw2 + 0.05) : prog(b, AT.sw1 - 0.05, AT.sw1 + 0.05);
    const shownApp = APPS[(second ? 1 : 0) + (swK >= 0.5 ? 1 : 0)];
    withSquash(x, ly + 16 + MENU_H / 2, squash(swK), () => {
      text(x, shownApp, lx + 40, ly + 16 + MENU_H / 2 + 10, { font: FONT.mono(28, 600), color: bone, alpha: ik });
    });
    // Hub 的图标：一个圈、一点、两道弧；发信时亮一下
    const blink = Math.max(impact(b, AT.flip, 0.12), impact(b, AT.post, 0.12), impact(b, AT.breath, 0.12), impact(b, AT.settle, 0.12), impact(b, AT.back, 0.12));
    const hc = blink > 0.3 ? css("signalD") : bone;
    x.save(); x.globalAlpha = ik; x.strokeStyle = hc; x.lineWidth = 2; x.beginPath(); x.arc(HUB[0], HUB[1], 11, 0, TAU); x.stroke();
    x.fillStyle = hc; x.beginPath(); x.arc(HUB[0], HUB[1], 3.5, 0, TAU); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.arc(HUB[0], HUB[1], 17, s > 0 ? -0.7 : Math.PI - 0.7, s > 0 ? 0.7 : Math.PI + 0.7); x.stroke(); }
    x.restore();
    if (blink > 0.02) glow(e, HUB[0], HUB[1], 60, 0.7 * blink * ik);
    // Apple Music 的小窗：2:0 换歌，歌名压扁再弹开
    const wk = prog(k, 0.6, 1);
    box(x, WIN.x, WIN.y, WIN.w, WIN.h, wk, { fill: "ink", lw: 1.8 });
    line(x, WIN.x, WIN.y + 30, WIN.x + WIN.w, WIN.y + 30, 1.2, bone, 0.5 * wk);
    const fk = prog(b, AT.flip - 0.08, AT.flip + 0.08);
    const title = fk < 0.5 ? OLD : NEW;
    withSquash(x, WIN.y + 133, squash(fk), () => {
      cover(x, WIN.x + 24, WIN.y + 54, 158, wk);
      text(x, title, WIN.x + 214, WIN.y + 118, { font: FONT.cjk(46, 600), color: fk >= 0.5 ? css("signalD") : bone, alpha: wk });
      text(x, ARTIST, WIN.x + 214, WIN.y + 164, { font: FONT.sans(30, 500), color: ash, alpha: wk });
    });
    const px0 = WIN.x + 214, px1 = WIN.x + WIN.w - 30, py = WIN.y + 202;
    line(x, px0, py, px1, py, 5, bone, 0.22 * wk);
    const pos = b < AT.flip ? 0.86 : clamp(0.02 + (b - AT.flip) * 0.012);
    line(x, px0, py, lerp(px0, px1, pos), py, 5, css("signalD"), wk);
    if (fk > 0.3 && fk < 0.9) glow(e, WIN.x + 380, WIN.y + 110, 150, 0.5 * (1 - Math.abs(fk - 0.6) * 3));
  }

  // 白卡：信封逐字敲出来；modules 那一行是四格，只有 appleMusic 亮
  function envCard(d, b, a) {
    if (a <= 0) return;
    const { x: px, y: py, w, h } = CARD;
    sheet(d, px, py, w, h, { alpha: a });
    text(d, tr("ch01.env"), px + 36, py + 64, { font: FONT.cjk(40, 600), alpha: a });
    text(d, "POST /api/ingest/mac", px + w - 36, py + 62, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: a });
    line(d, px + 30, py + 90, px + w - 30, py + 90, 1.4, css("pink"), a);
    const L = [
      [0, "{"], [1, '"version": 4,'], [1, '"presence": "online",'], [1, '"heartbeatAt": 1790640000000,'],
      [1, '"activeModules": [ … ],'], [1, '"modules": {'], null, [1, "}"], [0, "}"],
    ];
    const t0 = AT.flip + 0.05, step = 0.07;
    L.forEach((row, i) => {
      const y = py + 150 + i * 56;
      const r = prog(b, t0 + i * step, t0 + (i + 1) * step);
      if (!row) return;
      text(d, row[1], px + 44 + row[0] * 36, y, { font: FONT.mono(30, 500), color: css("pink"), alpha: a, reveal: r, perChar: r < 1 });
    });
    // modules 的四格：变了的才寄
    const cy = py + 150 + 6 * 56 - 10, ca = prog(b, t0 + 6 * step, t0 + 7 * step);
    if (ca > 0) {
      let cx = px + 80;
      CELLS.forEach((name, j) => {
        const cw = measure(d, name, FONT.mono(28, 500)) + 28, hot = name === "appleMusic";
        const litK = hot ? prog(b, AT.lit, AT.lit + 0.06) : 0;
        d.save(); d.globalAlpha = a * ca; d.lineWidth = 2;
        d.strokeStyle = litK > 0.5 ? css("signal") : css("graphite");
        if (!hot || litK < 0.5) d.setLineDash([6, 5]);
        roundRect(d, cx, cy - 26, cw, 46, 8);
        if (litK > 0) { d.save(); d.globalAlpha = a * ca * 0.16 * litK; d.fillStyle = css("signal"); d.fill(); d.restore(); }
        d.stroke(); d.restore();
        text(d, name, cx + cw / 2, cy + 7, { font: FONT.mono(28, 500), color: litK > 0.5 ? css("signal") : css("graphite"), align: "center", alpha: a * ca * (litK > 0.5 ? 1 : 0.8) });
        cx += cw + 12;
      });
    }
    text(d, tr("ch01.unsent"), px + w - 36, py + h - 34, { font: FONT.cjk(28, 600), color: css("graphite"), align: "right", alpha: a * prog(b, AT.lit + 0.05, AT.lit + 0.2) });
  }

  // 没变化：空信封呼吸一次（圆环缩放），标 90 s
  const BREATH = [2140, 772];
  function breath(x, e, b) {
    const a = win(b, AT.park, AT.park + 0.1, 3.85, 3.97);
    if (a <= 0) return;
    const [cx, cy] = BREATH, rk = prog(b, AT.breath, AT.breath + 0.55, E.out);
    envelope(x, cx, cy, 70, css("bone"), { lw: 2.2, fill: css("ink2"), alpha: a });
    if (rk > 0 && rk < 1) {
      x.save(); x.globalAlpha = a * (1 - rk) * 0.9; x.strokeStyle = css("bone"); x.lineWidth = 2;
      x.beginPath(); x.arc(cx, cy, lerp(44, 110, rk), 0, TAU); x.stroke(); x.restore();
    }
    const s = 1 + 0.08 * Math.sin(prog(b, AT.breath, AT.breath + 0.55) * Math.PI);
    x.save(); x.globalAlpha = a * 0.35; x.strokeStyle = css("bone"); x.lineWidth = 1.2; x.setLineDash([4, 5]);
    x.beginPath(); x.arc(cx, cy, 44 * s, 0, TAU); x.stroke(); x.restore();
    text(x, "90 s", cx + 150, cy + 14, { font: FONT.mono(44, 600), color: css("bone"), alpha: a });
    text(x, tr("ch01.empty"), cx + 270, cy + 12, { font: FONT.cjk(30, 600), color: css("ash"), alpha: a });
  }

  // 切应用：一把平面刻度尺，量满 400 ms 才算落定；落定前再切一次，指针回零重新量
  const RUL = { x0: 2110, x1: 2710, y: 790 };
  function ruler(x, e, b) {
    const a = win(b, 3.92, 4.02, 4.86, 4.98);
    if (a <= 0) return;
    const bone = css("bone"), ash = css("ash"), { x0, x1, y } = RUL;
    line(x, x0, y, x1, y, 2, bone, a);
    for (let i = 0; i <= 8; i++) { const u = lerp(x0, x1, i / 8), big = i % 2 === 0; line(x, u, y, u, y - (big ? 18 : 10), big ? 1.8 : 1.2, bone, a * (big ? 0.9 : 0.6)); }
    text(x, "0", x0, y + 40, { font: FONT.mono(28, 500), color: ash, align: "center", alpha: a });
    const done = prog(b, AT.settle, AT.settle + 0.05);
    text(x, "400 ms", x1, y + 40, { font: FONT.mono(28, 600), color: done > 0.5 ? css("signalD") : ash, align: "center", alpha: a });
    const since = b >= AT.sw2 ? AT.sw2 : AT.sw1;
    const p = clamp((b - since) / (AT.settle - AT.sw2));
    const ux = lerp(x0, x1, p);
    x.save(); x.globalAlpha = a; x.fillStyle = done > 0.5 ? css("signalD") : bone; x.beginPath();
    x.moveTo(ux, y - 24); x.lineTo(ux - 11, y - 44); x.lineTo(ux + 11, y - 44); x.closePath(); x.fill(); x.restore();
    if (b > AT.sw1) fillRect(x, x0, y - 3, ux - x0, 6, done > 0.5 ? css("signalD") : bone, a * 0.5);
    text(x, tr("ch01.settle"), x0, y - 70, { font: FONT.cjk(30, 600), color: done > 0.5 ? css("signalD") : bone, alpha: a });
    // 「又切了」排在刻度尺下面、两端读数中间：右边就是白卡，排不下
    const ag = win(b, AT.sw2, AT.sw2 + 0.06, AT.settle - 0.08, AT.settle);
    if (ag > 0) text(x, tr("ch01.again"), (x0 + x1) / 2, y + 40, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: a * ag });
    if (done > 0) glow(e, x1, y, 70, 0.8 * impact(b, AT.settle, 0.2));
  }

  function stationM1(x, e, d, b) {
    const k = prog(b, 1.32, 1.95, E.io);
    const headA = prog(b, 1.4, 1.7);
    figHead(x, 1990, 1, "Mac", tr("ch01.f1"), headA, { mono: true });
    laptop(x, e, b, k);
    // 白卡只在第一次停在这里时出现；19:0 甩回来时这里只剩笔记本和那封信
    const cardA = win(b, AT.flip - 0.04, AT.flip + 0.08, 4.8, 4.95);
    envCard(d, b, cardA * E.outBack(prog(b, AT.flip - 0.04, AT.flip + 0.1)));
    breath(x, e, b);
    ruler(x, e, b);
    nar(x, "ch01.n2a", 1990, 944, prog(b, 2.0, 2.6), win(b, 1.95, 2.05, 4.8, 4.95));
    nar(x, "ch01.n2b", 1990, 1024, prog(b, 2.95, 3.6), win(b, 1.95, 2.05, 4.8, 4.95));
  }

  // ========== M2 FIG. 1A 窗口标题过 Jev · FIG. 1B 图标进 R2 ==========
  const WT = { x: 3910, y: 214, w: 760, h: 62 };
  const JV = { x: 3910, y: 316, w: 760, h: 316 };
  const QROWS = [410, 462, 514, 566];
  const PROB = [0.34, 0.81, 0.22, 0.63]; // 示意值：不标数，也不和出路对应
  const FORK = [4290, 694], PASS = [4056, 770], OWNER = [4524, 770];
  const REDACT = [140, 92, 210, 120];
  function redacted(x, rx, cy, a, s = 1) {
    let u = rx;
    REDACT.forEach((w) => { fillRect(x, u, cy - 9 * s, w * s, 18 * s, css("bone"), 0.42 * a); u += (w + 16) * s; });
  }
  function stationM2Jev(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 4.9, 5.1);
    if (a <= 0) return;
    figHead(x, 3910, "1A", tr("ch01.f1a"), null, a, { rule: 760 });
    // 窗口的标题栏：标题本身不上画面，只画成几块遮住的字
    text(x, tr("ch01.wt"), WT.x, WT.y - 12, { font: FONT.cjk(28, 600), color: ash, alpha: a });
    box(x, WT.x, WT.y, WT.w, WT.h, a, { lw: 1.8 });
    redacted(x, WT.x + 30, WT.y + WT.h / 2, a);
    arrowPath(x, [[WT.x + WT.w / 2, WT.y + WT.h + 4], [WT.x + WT.w / 2, JV.y - 6]], prog(b, 5.05, 5.25), bone, a, 1.6);
    // Jev：几道问题的横条同时走，6:0 同一刻一起给出概率条（示意）
    box(x, JV.x, JV.y, JV.w, JV.h, a, { lw: 2.2 });
    text(x, "Jev", JV.x + 30, JV.y + 52, { font: FONT.mono(34, 600), color: bone, alpha: a });
    text(x, tr("ch01.judge"), JV.x + 110, JV.y + 50, { font: FONT.cjk(28, 600), color: ash, alpha: a });
    const jd = prog(b, AT.judged, AT.judged + 0.08, E.outExpo);
    text(x, tr("ch01.illus"), JV.x + JV.w - 30, JV.y + 50, { font: FONT.cjk(28, 600), color: ash, align: "right", alpha: a * jd });
    const tx0 = JV.x + 60, tx1 = JV.x + JV.w - 40;
    QROWS.forEach((y, i) => {
      text(x, `q${i + 1}`, JV.x + 24, y + 8, { font: FONT.mono(20, 500), color: ash, alpha: a, texture: true });
      line(x, tx0, y, tx1, y, 1.2, bone, 0.3 * a);
      if (b >= AT.jev && jd <= 0) {
        // 还在想：一段亮条来回扫（各行相位不同，同时在走）
        const ph = ((b - AT.jev) * 4 * (0.9 + 0.13 * i) + i * 0.37) % 1;
        const u = lerp(tx0, tx1 - 120, 0.5 - 0.5 * Math.cos(ph * TAU));
        fillRect(x, u, y - 6, 120, 12, bone, 0.7 * a);
      }
      if (jd > 0) {
        fillRect(x, tx0, y - 8, (tx1 - tx0) * PROB[i] * jd, 16, bone, 0.85 * a);
        line(x, tx0 + (tx1 - tx0) * PROB[i] * jd, y - 13, tx0 + (tx1 - tx0) * PROB[i] * jd, y + 13, 2, bone, a);
      }
    });
    if (jd > 0.5) glow(e, (tx0 + tx1) / 2, (QROWS[0] + QROWS[3]) / 2, 260, 0.35 * impact(b, AT.judged, 0.2));
    // 两条出路：放行的进信封（实线），拿不准的交给主人（虚线）；这一次的标题走了放行那条
    const fk = prog(b, AT.judged + 0.02, AT.cleared, E.out);
    if (fk > 0) {
      polyline(x, [[JV.x + JV.w / 2, JV.y + JV.h], FORK], fk, 1.8, bone, a);
      x.save(); x.globalAlpha = a * fk; x.fillStyle = css("ink2"); x.strokeStyle = bone; x.lineWidth = 1.8;
      x.beginPath(); x.moveTo(FORK[0], FORK[1] - 12); x.lineTo(FORK[0] + 12, FORK[1]); x.lineTo(FORK[0], FORK[1] + 12); x.lineTo(FORK[0] - 12, FORK[1]); x.closePath(); x.fill(); x.stroke(); x.restore();
      arrowPath(x, [FORK, [PASS[0] + 40, FORK[1]], [PASS[0] + 40, PASS[1] - 34]], prog(b, AT.judged + 0.08, AT.cleared, E.out), css("signalD"), a, 2.2);
      arrowPath(x, [FORK, [OWNER[0] - 40, FORK[1]], [OWNER[0] - 40, OWNER[1] - 38]], prog(b, AT.judged + 0.08, AT.cleared, E.out), bone, a * 0.8, 1.8, true);
    }
    const inK = prog(b, AT.cleared, AT.cleared + 0.2, E.io);
    const pa = prog(b, AT.cleared - 0.1, AT.cleared);
    if (pa > 0) {
      envelope(x, PASS[0], PASS[1], 72, inK >= 1 ? css("signalD") : bone, { lw: 2.2, fill: css("ink2"), alpha: a * pa, open: 1 - inK });
      text(x, tr("ch01.pass"), PASS[0] - 48, PASS[1] + 68, { font: FONT.cjk(28, 600), color: css("signalD"), alpha: a * pa });
      if (inK > 0 && inK < 1) {
        const p = pathAt([FORK, [PASS[0] + 40, FORK[1]], [PASS[0] + 40, PASS[1] - 30], [PASS[0], PASS[1] - 10]], inK * 330);
        fillRect(x, p[0] - 28, p[1] - 6, 56, 12, css("signalD"), a);
      }
      if (inK >= 1) glow(e, PASS[0], PASS[1], 80, 0.6 * impact(b, AT.cleared + 0.2, 0.2) + 0.15);
    }
    const oa = prog(b, AT.owner - 0.05, AT.owner + 0.08, E.outBack);
    if (oa > 0) {
      x.save(); x.translate(OWNER[0], OWNER[1]); x.scale(oa, oa);
      box(x, -54, -34, 108, 68, a, { r: 12, lw: 2 });
      text(x, "?", 0, 16, { font: FONT.mono(40, 600), color: bone, align: "center", alpha: a });
      x.restore();
      text(x, tr("ch01.owner"), OWNER[0] - 60, OWNER[1] + 68, { font: FONT.cjk(28, 600), color: ash, alpha: a * clamp(oa) });
    }
    nar(x, "ch01.n3a", 3910, 944, prog(b, 5.05, 5.5), win(b, 5.0, 5.1, 6.4, 6.5));
    nar(x, "ch01.n3b", 3910, 1024, prog(b, 5.5, 6.25), win(b, 5.0, 5.1, 6.4, 6.5));
  }

  // 应用图标：一张 10×10 的像素图（圆角方块里一个 >_ ），压成一串哈希
  const ICON = { x: 4930, y: 222, cell: 18, n: 10 };
  const GLYPH = new Set(["2,3", "3,4", "4,5", "3,6", "2,7", "5,7", "6,7", "7,7"]);
  function iconCells() {
    const out = [];
    for (let r = 0; r < ICON.n; r++) for (let c = 0; c < ICON.n; c++) {
      const corner = (r === 0 || r === ICON.n - 1) && (c === 0 || c === ICON.n - 1);
      if (!corner) out.push({ r, c, hot: GLYPH.has(`${c},${r}`) });
    }
    return out;
  }
  const CELLS_ICON = iconCells();
  const HASH = [5170, 318];
  const CAB = { x: 5320, y: 430, w: 380, h: 300, cols: 3, rows: 4 };
  const SLOT = { c: 1, r: 1 };
  const slotCenter = () => { const cw = (CAB.w - 20) / CAB.cols, ch = (CAB.h - 20) / CAB.rows; return [CAB.x + 10 + (SLOT.c + 0.5) * cw, CAB.y + 10 + (SLOT.r + 0.5) * ch]; };
  const OBJ = { x: 4906, y: 556, w: 384, h: 156 };
  function stationM2Img(x, e, d, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 4.9, 5.1);
    if (a <= 0) return;
    figHead(x, 4920, "1B", tr("ch01.f1b"), null, a, { rule: 770 });
    const ck = prog(b, AT.pixels, AT.hash, E.in);
    const rnd = mulberry32(7);
    CELLS_ICON.forEach(({ r, c, hot }) => {
      const j = rnd();
      const k = clamp(ck * 1.4 - j * 0.4);
      const sx = ICON.x + c * ICON.cell, sy = ICON.y + r * ICON.cell;
      const px = lerp(sx, HASH[0] + j * 60, E.io(k)), py = lerp(sy, HASH[1] - 12, E.io(k));
      const s = lerp(ICON.cell - 2, 4, k);
      fillRect(x, px, py, s, s, hot ? css("signalD") : bone, a * (hot ? 0.95 : 0.5) * (1 - prog(k, 0.8, 1)));
    });
    text(x, "96×96 PNG", ICON.x, ICON.y + ICON.n * ICON.cell + 44, { font: FONT.mono(28, 500), color: ash, alpha: a * (1 - prog(b, AT.pixels, AT.pixels + 0.15)) });
    // 哈希：按内容起名
    const hk = prog(b, AT.hash - 0.02, AT.hash + 0.2);
    const fall = prog(b, AT.drop, AT.shut - 0.04, E.in);
    const [sx, sy] = slotCenter();
    if (hk > 0 && fall < 1) {
      text(x, tr("ch01.byContent"), HASH[0], HASH[1] - 50, { font: FONT.mono(28, 500), color: ash, alpha: a * hk * (1 - fall) });
      const hx = lerp(HASH[0], sx - 120, fall), hy = lerp(HASH[1], sy + 8, fall);
      x.save(); x.translate(hx, hy); x.scale(lerp(1, 0.55, fall), lerp(1, 0.55, fall));
      text(x, KEY_SHORT, 0, 0, { font: FONT.mono(34, 600), color: bone, alpha: a * (1 - prog(fall, 0.85, 1)), reveal: hk, perChar: hk < 1 });
      x.restore();
    }
    // R2：抽屉 6:3 起拉开，7:1 关上
    const openK = keys(b, [[AT.hash, 0], [AT.hash + 0.12, 1, E.out], [AT.shut - 0.04, 1], [AT.shut + 0.02, 0, E.in]]);
    cabinet(x, CAB.x, CAB.y, CAB.w, CAB.h, CAB.cols, CAB.rows, a, { ...SLOT, k: openK, hot: true });
    text(x, "R2", CAB.x, CAB.y - 22, { font: FONT.mono(44, 600), color: bone, alpha: a });
    text(x, "immutable", CAB.x + CAB.w, CAB.y - 24, { font: FONT.mono(28, 500), color: ash, align: "right", alpha: a });
    const shut = impact(b, AT.shut, 0.16);
    if (shut > 0.02) glow(e, sx, sy, 110, 0.8 * shut);
    // 信封里只剩文件名
    const oa = prog(b, AT.objKey - 0.06, AT.objKey + 0.06, E.outBack);
    if (oa > 0) {
      sheet(d, OBJ.x, OBJ.y, OBJ.w, OBJ.h, { alpha: a * clamp(oa), shadow: 18 });
      envelope(d, OBJ.x + 48, OBJ.y + 44, 52, css("pink"), { lw: 2, fill: css("paper"), alpha: a * clamp(oa) });
      text(d, "desktop", OBJ.x + 90, OBJ.y + 54, { font: FONT.mono(28, 500), color: css("graphite"), alpha: a * clamp(oa) });
      text(d, '"iconObjectKey":', OBJ.x + 24, OBJ.y + 102, { font: FONT.mono(28, 500), color: css("pink"), alpha: a * clamp(oa) });
      text(d, `"${KEY_SHORT}"`, OBJ.x + 24, OBJ.y + 138, { font: FONT.mono(28, 500), color: css("signal"), alpha: a * clamp(oa), reveal: prog(b, AT.objKey, AT.objKey + 0.15), perChar: true });
      // 放在抽屉柜底下那一行：英文比柜子左沿长
      text(x, tr("ch01.onlyName"), OBJ.x, CAB.y + CAB.h + 46, { font: FONT.cjk(28, 600), color: ash, alpha: a * clamp(oa) });
    }
    nar(x, "ch01.n4a", 3910, 944, prog(b, 6.55, 7.1), win(b, 6.5, 6.6, 7.8, 7.95));
    nar(x, "ch01.n4b", 3910, 1024, prog(b, 7.1, 7.6), win(b, 6.5, 6.6, 7.8, 7.95));
  }

  // ========== F2 iPhone ==========
  const PH = { x: 6100, y: 222, w: 300, h: 610 };
  const OUT2 = [[6700, 348], [6700, 540], [6700, 728]];
  function stationF2(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 7.85, 8.05);
    if (a <= 0) return;
    figHead(x, 5830, 2, "iPhone", tr("ch01.f2"), a, { mono: true });
    const k = prog(b, 7.9, 8.35, E.io);
    x.save(); x.globalAlpha = a;
    x.strokeStyle = bone; x.lineWidth = 2.6; roundRect(x, PH.x, PH.y, PH.w, PH.h, 46); x.save(); x.fillStyle = css("ink2"); x.globalAlpha = a * k; x.fill(); x.restore(); x.stroke();
    x.restore();
    const wake = prog(b, AT.wake, AT.wake + 0.1);
    box(x, PH.x + 16, PH.y + 16, PH.w - 32, PH.h - 32, a * k, { r: 34, lw: 1.4, fill: "ink" });
    if (wake > 0) { x.save(); roundRect(x, PH.x + 16, PH.y + 16, PH.w - 32, PH.h - 32, 34); x.globalAlpha = a * 0.08 * wake; x.fillStyle = css("bone"); x.fill(); x.restore(); }
    box(x, PH.x + PH.w / 2 - 44, PH.y + 34, 88, 24, a * k, { r: 12, lw: 1.4, fill: "ink" });
    for (const [bx, by, bh] of [[PH.x - 6, PH.y + 130, 44], [PH.x - 6, PH.y + 196, 70], [PH.x + PH.w, PH.y + 170, 96]]) box(x, bx, by, 6, bh, a * k, { lw: 1.4 });
    // HealthKit 把它叫醒：屏幕亮起、外圈荡开一道
    if (wake > 0) {
      text(x, "HealthKit", PH.x + PH.w / 2, PH.y + PH.h / 2 + 10, { font: FONT.mono(30, 600), color: css("signalD"), align: "center", alpha: a * wake });
      const rk = prog(b, AT.wake, AT.wake + 0.5, E.out);
      if (rk < 1) { x.save(); x.globalAlpha = a * (1 - rk) * 0.8; x.strokeStyle = css("signalD"); x.lineWidth = 2; roundRect(x, PH.x - 30 * rk, PH.y - 30 * rk, PH.w + 60 * rk, PH.h + 60 * rk, 46 + 30 * rk); x.stroke(); x.restore(); }
      glow(e, PH.x + PH.w / 2, PH.y + PH.h / 2, 220, 0.5 * impact(b, AT.wake, 0.2));
    }
    // 三样东西：活动圆环、训练、五分钟步数桶
    const labels = ["ch01.rings", "ch01.workouts", "ch01.steps"];
    OUT2.forEach(([ox, oy], i) => {
      const t = AT.outs[i], ok = prog(b, t - 0.1, t + 0.08, E.out);
      if (ok <= 0) return;
      arrowPath(x, [[PH.x + PH.w + 10, oy], [ox - 78, oy]], ok, bone, a * 0.8, 1.6);
      const ia = a * prog(b, t, t + 0.1);
      if (i === 0) {
        [[58, 0.82, css("signalD")], [44, 0.66, bone], [30, 0.9, bone]].forEach(([r, p, c], j) => {
          x.save(); x.globalAlpha = ia * (j === 2 ? 0.55 : 1); x.strokeStyle = c; x.lineWidth = 9; x.lineCap = "round";
          x.beginPath(); x.arc(ox, oy, r, -Math.PI / 2, -Math.PI / 2 + TAU * p * prog(b, t, t + 0.25, E.out)); x.stroke();
          x.globalAlpha = ia * 0.15; x.beginPath(); x.arc(ox, oy, r, 0, TAU); x.stroke(); x.restore();
        });
      } else if (i === 1) {
        x.save(); x.globalAlpha = ia; x.strokeStyle = bone; x.lineWidth = 2.4;
        x.beginPath(); x.arc(ox, oy + 6, 44, 0, TAU); x.stroke();
        x.fillStyle = bone; x.fillRect(ox - 10, oy - 52, 20, 10);
        const ang = -Math.PI / 2 + prog(b, t, t + 0.4) * TAU * 0.7;
        x.strokeStyle = css("signalD"); x.lineWidth = 3; x.beginPath(); x.moveTo(ox, oy + 6); x.lineTo(ox + Math.cos(ang) * 34, oy + 6 + Math.sin(ang) * 34); x.stroke();
        x.restore();
      } else {
        const r = mulberry32(23);
        for (let j = 0; j < 12; j++) {
          const hgt = 12 + r() * 60, bk = prog(b, t + j * 0.012, t + j * 0.012 + 0.1);
          fillRect(x, ox - 66 + j * 11, oy + 36 - hgt * bk, 8, hgt * bk, j === 11 ? css("signalD") : bone, ia * 0.85);
        }
        line(x, ox - 72, oy + 38, ox + 70, oy + 38, 1.2, bone, ia * 0.6);
      }
      text(x, tr(labels[i]), ox + 110, oy + 12, { font: FONT.cjk(34, 600), color: bone, alpha: ia });
    });
    text(x, "POST /api/ingest/iphone", OUT2[2][0] - 70, 812, { font: FONT.mono(28, 500), color: ash, alpha: a * prog(b, AT.outs[2], AT.outs[2] + 0.15) });
  }

  // ========== F3 家里：HomePod、PS5 的电源经 Home Assistant；n100 上的 playstation-reporter 在局域网里探测 PS5 ==========
  const HP = { x: 7750, y: 336, w: 210, h: 276 };
  const PS = { x: 8790, y: 286, w: 132, h: 370 };
  const SWITCH = [8640, 470];
  const HA = { x: 8150, y: 440, w: 250, h: 104 };
  const KEYC = [8275, 664];
  const DOORS = [[8494, 624, "/homepod"], [8494, 712, "/playstation"]];
  // n100 上的 playstation-reporter：容器坐在小机身上；UDP 探测线从机身左沿画到 PS5 右侧板
  const CT3 = { x: 9215, y: 380, w: 300, h: 66 };
  const N100 = { x: 9205, y: 462, w: 320, h: 120 };
  const PROBE_Y = 522, TIER_Y = PROBE_Y + 52;
  const PROBE = [[N100.x - 10, PROBE_Y], [PS.x + PS.w + 18, PROBE_Y]];
  function stationF3(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 9.35, 9.55);
    if (a <= 0) return;
    figHead(x, 7750, 3, tr("ch01.f3"), tr("ch01.f3sub"), a, { rule: 920 });
    // HomePod：正视，网罩一道道横线，顶上一块小屏
    const dk = prog(b, 9.4, 9.8, E.io);
    box(x, HP.x, HP.y, HP.w, HP.h, a * dk, { r: 84, lw: 2.6 });
    x.save(); roundRect(x, HP.x, HP.y, HP.w, HP.h, 84); x.clip(); x.globalAlpha = a * dk * 0.28; x.strokeStyle = bone; x.lineWidth = 1;
    x.beginPath(); for (let y = HP.y + 20; y < HP.y + HP.h - 10; y += 13) { x.moveTo(HP.x, y); x.lineTo(HP.x + HP.w, y); } x.stroke(); x.restore();
    const play = b >= AT.homepod;
    x.save(); x.globalAlpha = a * dk; x.strokeStyle = play ? css("signalD") : bone; x.lineWidth = 2; x.beginPath(); x.ellipse(HP.x + HP.w / 2, HP.y + 26, 54, 9, 0, 0, TAU); x.stroke(); x.restore();
    if (play) {
      const beat = ((b - AT.homepod) * 4) % 1;
      for (let j = 1; j <= 3; j++) {
        x.save(); x.globalAlpha = a * (0.7 - j * 0.15) * (0.6 + 0.4 * Math.exp(-beat * 3)); x.strokeStyle = bone; x.lineWidth = 2;
        x.beginPath(); x.arc(HP.x + HP.w / 2, HP.y + HP.h / 2, HP.w / 2 + 14 + j * 18, -0.5, 0.5); x.stroke(); x.restore();
      }
      glow(e, HP.x + HP.w / 2, HP.y + 26, 70, 0.4 * impact(b, AT.homepod, 0.2) + 0.12);
    }
    text(x, "HomePod", HP.x, HP.y + HP.h + 56, { font: FONT.mono(30, 600), color: bone, alpha: a });
    text(x, tr("ch01.playing"), HP.x, HP.y + HP.h + 96, { font: FONT.cjk(28, 600), color: ash, alpha: a });
    // PS5：正视，中间一条机身，两侧弧形的侧板；电源一开，机身边上的灯条亮
    const pk = prog(b, 9.45, 9.85, E.io);
    const on = prog(b, AT.power, AT.power + 0.06);
    x.save(); x.globalAlpha = a * pk; x.lineWidth = 2.4; x.strokeStyle = bone; x.fillStyle = css("ink2");
    const cx0 = PS.x + 38, cx1 = PS.x + PS.w - 38;
    x.beginPath(); x.rect(cx0, PS.y + 20, cx1 - cx0, PS.h - 40); x.fill(); x.stroke();
    for (const s of [-1, 1]) {
      const ex = s < 0 ? cx0 : cx1, ox = s < 0 ? PS.x : PS.x + PS.w;
      x.beginPath(); x.moveTo(ex, PS.y); x.quadraticCurveTo(ox, PS.y + 10, ox + s * 4, PS.y + 90); x.lineTo(ox, PS.y + PS.h - 30); x.quadraticCurveTo(ox, PS.y + PS.h, ex, PS.y + PS.h - 6); x.stroke();
    }
    x.restore();
    if (on > 0) { line(x, cx0 + 3, PS.y + 30, cx0 + 3, PS.y + PS.h - 30, 3, css("signalD"), a * on); line(x, cx1 - 3, PS.y + 30, cx1 - 3, PS.y + PS.h - 30, 3, css("signalD"), a * on); glow(e, (cx0 + cx1) / 2, PS.y + PS.h / 2, 160, 0.45 * impact(b, AT.power, 0.2)); }
    text(x, "PS5", PS.x, PS.y + PS.h + 50, { font: FONT.mono(30, 600), color: bone, alpha: a });
    text(x, "{version:1, power}", PS.x, PS.y + PS.h + 90, { font: FONT.mono(28, 500), color: ash, alpha: a });
    // 电源开关：IEC 电源符号，10:0 翻面（关 → 开）
    const fk = prog(b, AT.power - 0.05, AT.power + 0.05);
    withSquash(x, SWITCH[1], squash(fk), () => {
      const c = fk >= 0.5 ? css("signalD") : bone;
      x.save(); x.globalAlpha = a * pk; x.strokeStyle = c; x.lineWidth = 3; x.lineCap = "round";
      x.beginPath(); x.arc(SWITCH[0], SWITCH[1], 26, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6 + TAU); x.stroke();
      x.beginPath(); x.moveTo(SWITCH[0], SWITCH[1] - 34); x.lineTo(SWITCH[0], SWITCH[1] - 4); x.stroke(); x.restore();
    });
    text(x, tr("ch01.power"), SWITCH[0], SWITCH[1] + 66, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: a });
    // Home Assistant：一个盒子，两路观测线；下面一把钥匙分出两扇门（第 02 章那把）
    const hk = prog(b, 9.6, 9.9);
    box(x, HA.x, HA.y, HA.w, HA.h, a * hk, { r: 12, lw: 2.2 });
    text(x, "Home Assistant", HA.x + HA.w / 2, HA.y + HA.h / 2 + 10, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * hk });
    dashPath(x, [[HP.x + HP.w + 70, HP.y + HP.h / 2], [HA.x, HA.y + HA.h / 2]], hk, 1.6, bone, a * 0.7);
    dashPath(x, [[SWITCH[0] - 40, SWITCH[1]], [HA.x + HA.w, HA.y + HA.h / 2]], hk, 1.6, bone, a * 0.7);
    const kk = prog(b, 10.2, 10.4, E.out);
    if (kk > 0) {
      line(x, KEYC[0], HA.y + HA.h, KEYC[0], KEYC[1] - 31, 1.6, bone, a * kk);
      const hot = b >= AT.doors[0] - 0.05 && b < 11.2;
      keycard(x, KEYC[0], KEYC[1], a * kk, hot);
      DOORS.forEach(([dx, dy, label], i) => {
        const t = AT.doors[i], dk2 = prog(b, t - 0.12, t, E.out), lit = b >= t;
        arrowPath(x, [[KEYC[0] + 75, KEYC[1]], [dx - 44, KEYC[1]], [dx - 44, dy], [dx - 8, dy]], dk2, lit ? css("signalD") : bone, a, 1.8);
        text(x, label, dx + 4, dy + 10, { font: FONT.mono(28, 500), color: lit ? css("signalD") : bone, alpha: a * dk2 });
        if (lit) glow(e, dx + 60, dy, 70, 0.5 * impact(b, t, 0.18));
      });
      text(x, tr("ch01.key2"), KEYC[0] - 75, KEYC[1] + 84, { font: FONT.cjk(28, 600), color: ash, alpha: a * kk });
    }
    // n100 上的 playstation-reporter：跟 PS5 在同一个局域网里。每拍一个点从容器飞向 PS5（AT.probe 起），是 UDP 探测；
    // 线下的档位牌只有两档（醒着 / 没醒），10:0 开机后第一探读到醒着就翻面。间隔不出数（FACTS §1、§7）
    const nk = prog(b, 9.6, 9.95, E.io);
    if (nk > 0) {
      const hot = b >= AT.probe - 0.02 ? 1 : 0;
      box(x, N100.x, N100.y, N100.w, N100.h, a * nk, { lw: 2.6 });
      hatch(x, N100.x + 16, N100.y + N100.h - 36, N100.w - 32, 22, a * nk * 0.5, 9);
      text(x, "n100", N100.x + 24, N100.y + 58, { font: FONT.mono(30, 600), color: bone, alpha: a * nk });
      x.save(); x.globalAlpha = a * nk; x.fillStyle = hot ? css("signalD") : css("ash"); x.beginPath(); x.arc(N100.x + N100.w - 28, N100.y + 28, 5, 0, TAU); x.fill(); x.restore();
      container(x, CT3.x, CT3.y, CT3.w, CT3.h, a * nk, hot);
      text(x, "playstation-reporter", CT3.x + CT3.w / 2, CT3.y - 16, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * nk });
      if (hot) glow(e, CT3.x + CT3.w / 2, CT3.y + CT3.h / 2, 110, 0.5 * impact(b, AT.probe, 0.2));
      const uk = prog(b, 9.95, 10.2, E.out);
      const mid = (PROBE[0][0] + PROBE[1][0]) / 2;
      if (uk > 0) {
        arrowPath(x, PROBE, uk, bone, a * 0.8, 1.6, true);
        text(x, "UDP", mid, PROBE_Y - 22, { font: FONT.mono(28, 500), color: ash, align: "center", alpha: a * uk });
        // 档位牌：压扁再弹开（和电源开关同一种翻面），翻过去就是快档
        const tk = prog(b, AT.awake - 0.05, AT.awake + 0.05), up = tk >= 0.5;
        withSquash(x, TIER_Y - 10, squash(tk), () => {
          text(x, tr(up ? "ch01.tierAwake" : "ch01.tierRest"), mid, TIER_Y, { font: FONT.cjk(28, 600), color: up ? css("signalD") : ash, align: "center", alpha: a * uk });
        });
        if (up) glow(e, mid, TIER_Y - 10, 80, 0.5 * impact(b, AT.awake, 0.2));
      }
      if (b >= AT.probe) {
        const p = ((b - AT.probe) * 4) % 1, px = lerp(PROBE[0][0], PROBE[1][0], E.out(p)), fade = 1 - prog(p, 0.7, 1);
        x.save(); x.globalAlpha = a * fade; x.fillStyle = css("signalD"); x.beginPath(); x.arc(px, PROBE_Y, 7, 0, TAU); x.fill(); x.restore();
        glow(e, px, PROBE_Y, 38, 0.5 * fade);
      }
      const rx = N100.x + N100.w, ty = N100.y + N100.h;
      text(x, tr("ch01.probe"), rx, ty + 52, { font: FONT.cjk(28, 600), color: bone, align: "right", alpha: a * prog(b, AT.probe, AT.probe + 0.1) });
      // 醒着和没醒对调时立刻打一轮 PSN（cadence.ts#shouldRunTick），所以翻到快档紧跟着就寄出去
      text(x, "POST /api/ingest/playstation", rx, ty + 98, { font: FONT.mono(28, 500), color: ash, align: "right", alpha: a * prog(b, AT.awake, AT.awake + 0.1) });
    }
  }

  // ========== F4 NAS：emby-reporter，海报先传 R2 ==========
  const NS = { x: 9900, y: 356, w: 390, h: 420 };
  const CT4 = { x: 9920, y: 262, w: 350, h: 72 };
  const R2M = { x: 10680, y: 214, w: 180, h: 132 };
  function stationF4(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 10.85, 11.05);
    if (a <= 0) return;
    figHead(x, 9670, 4, "NAS", tr("ch01.f4sub"), a, { mono: true });
    const k = prog(b, 10.9, 11.25, E.io);
    box(x, NS.x, NS.y, NS.w, NS.h, a * k, { lw: 2.6 });
    for (let i = 0; i < 4; i++) {
      const bx = NS.x + 22 + i * 88, by = NS.y + 36;
      box(x, bx, by, 72, 300, a * k, { lw: 1.6, fill: "ink" });
      line(x, bx + 14, by + 250, bx + 58, by + 250, 3, bone, a * k * 0.7);
      const led = (Math.floor(b * 8 + i * 3) % 5) === 0;
      x.save(); x.globalAlpha = a * k; x.fillStyle = led ? css("signalD") : css("ash"); x.beginPath(); x.arc(bx + 36, by + 22, 5, 0, TAU); x.fill(); x.restore();
    }
    hatch(x, NS.x + 20, NS.y + NS.h - 50, NS.w - 40, 30, a * k * 0.5, 9);
    container(x, CT4.x, CT4.y, CT4.w, CT4.h, a * k, b >= AT.poster - 0.1 && b < 11.95 ? 1 : 0);
    text(x, "emby-reporter", CT4.x + CT4.w / 2, CT4.y - 16, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * k });
    // ① 海报先传 R2
    cabinet(x, R2M.x, R2M.y, R2M.w, R2M.h, 2, 2, a * k);
    text(x, "R2", R2M.x + R2M.w + 20, R2M.y + 46, { font: FONT.mono(36, 600), color: bone, alpha: a * k });
    const pk = prog(b, AT.poster - 0.22, AT.poster, E.io);
    if (pk > 0 && pk < 1) {
      const px = lerp(CT4.x + CT4.w + 10, R2M.x + R2M.w / 2, pk), py = lerp(CT4.y + 30, R2M.y + R2M.h / 2, pk) - Math.sin(pk * Math.PI) * 90;
      const s = lerp(1, 0.5, pk);
      x.save(); x.translate(px, py); x.scale(s, s); box(x, -45, -68, 90, 136, a, { lw: 2, color: css("signalD") }); text(x, "webp", 0, 10, { font: FONT.mono(28, 600), color: css("signalD"), align: "center", alpha: a, texture: true }); x.restore();
    }
    if (b >= AT.poster) glow(e, R2M.x + R2M.w / 2, R2M.y + R2M.h / 2, 90, 0.6 * impact(b, AT.poster, 0.18));
    text(x, tr("ch01.poster"), R2M.x, R2M.y + R2M.h + 50, { font: FONT.cjk(30, 600), color: bone, alpha: a * prog(b, AT.poster, AT.poster + 0.08) });
    // ② 在看什么：信封寄出去
    const ek = prog(b, AT.emby - 0.02, AT.emby + 0.3, E.out);
    if (ek > 0) {
      const ex = lerp(NS.x + NS.w + 20, R2M.x + 60, ek);
      arrowPath(x, [[NS.x + NS.w + 8, 600], [R2M.x + 20, 600]], ek, bone, a * 0.7, 1.6);
      envelope(x, ex, 600, 70, css("signalD"), { lw: 2.2, fill: css("ink2"), alpha: a });
      text(x, tr("ch01.watching"), R2M.x, 686, { font: FONT.cjk(30, 600), color: bone, alpha: a * prog(b, AT.emby, AT.emby + 0.08) });
      text(x, "POST /api/ingest/emby", R2M.x, 728, { font: FONT.mono(28, 500), color: ash, alpha: a * prog(b, AT.emby, AT.emby + 0.08) });
    }
  }

  // ========== F5 东京的机柜：两台容器 ==========
  const RK = { x: 11820, y: 212, w: 440, h: 640 };
  const SRVB = { x: 11850, y: 400, w: 380, h: 160 };
  const C5 = [{ x: 11872, y: 446, w: 162, h: 66 }, { x: 12050, y: 446, w: 162, h: 66 }];
  function stationF5(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 11.85, 12.05);
    if (a <= 0) return;
    figHead(x, 11590, 5, tr("ch01.f5"), "misaka-jp", a, { subMono: true });
    const k = prog(b, 11.9, 12.25, E.io);
    box(x, RK.x, RK.y, RK.w, RK.h, a * k, { lw: 2.6, fill: "ink" });
    for (const rx of [RK.x + 16, RK.x + RK.w - 16]) {
      line(x, rx, RK.y + 10, rx, RK.y + RK.h - 10, 1.6, bone, a * k);
      for (let y = RK.y + 26; y < RK.y + RK.h - 20; y += 22) { x.save(); x.globalAlpha = a * k * 0.4; x.strokeStyle = bone; x.lineWidth = 1; x.strokeRect(rx - 4, y - 4, 8, 8); x.restore(); }
    }
    for (const [y0, hh] of [[RK.y + 30, 56], [RK.y + 100, 56], [RK.y + 380, 56], [RK.y + 450, 56], [RK.y + 540, 80]]) {
      box(x, RK.x + 30, y0, RK.w - 60, hh, a * k * 0.8, { lw: 1.4 });
      hatch(x, RK.x + 30, y0, RK.w - 60, hh, a * k * 0.3, 12);
    }
    box(x, SRVB.x, SRVB.y, SRVB.w, SRVB.h, a * k, { lw: 2.2 });
    text(x, "server", SRVB.x + 16, SRVB.y + SRVB.h - 16, { font: FONT.mono(20, 500), color: ash, alpha: a * k, texture: true });
    const hot = [impact(b, AT.server, 0.25), impact(b, AT.agents, 0.25)];
    C5.forEach((c, i) => {
      const t = i ? AT.agents : AT.server;
      container(x, c.x, c.y, c.w, c.h, a * k, b >= t - 0.02 ? Math.max(0.35, hot[i]) : 0);
      if (b >= t) glow(e, c.x + c.w / 2, c.y + c.h / 2, 110, 0.6 * hot[i]);
    });
    // 标注：引线到右边
    const L = [
      { t: AT.server, ay: C5[0].y, ax: C5[0].x + C5[0].w / 2, ty: 300, name: "server-reporter", lines: ["ch01.srv"], ep: "POST /api/ingest/server" },
      { t: AT.agents, ay: C5[1].y + C5[1].h, ax: C5[1].x + C5[1].w / 2, ty: 620, name: "agents-reporter", lines: ["ch01.lim", "ch01.cur"], ep: "POST /api/ingest/agents" },
    ];
    L.forEach((l) => {
      const lk = prog(b, l.t - 0.12, l.t + 0.05, E.out);
      if (lk <= 0) return;
      const tx = RK.x + RK.w + 130;
      polyline(x, [[l.ax, l.ay], [l.ax, l.ty], [tx - 20, l.ty]], lk, 1.4, bone, a * 0.85);
      x.save(); x.globalAlpha = a * lk; x.fillStyle = bone; x.beginPath(); x.arc(l.ax, l.ay, 5, 0, TAU); x.fill(); x.restore();
      const ta = a * prog(b, l.t, l.t + 0.08);
      text(x, l.name, tx, l.ty + 10, { font: FONT.mono(32, 600), color: bone, alpha: ta });
      l.lines.forEach((key, j) => text(x, tr(key), tx, l.ty + 54 + j * 40, { font: FONT.cjk(28, 600), color: bone, alpha: ta }));
      text(x, l.ep, tx, l.ty + 54 + l.lines.length * 40, { font: FONT.mono(28, 500), color: ash, alpha: ta });
    });
  }

  // ========== F6 云端的一小段遥测：Claude Code 自己发 OTLP ==========
  const CE = { x: 13590, y: 250, w: 560, h: 470 };
  const WIRE6 = [[CE.x + CE.w, 486], [14660, 486]];
  function stationF6(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 13.35, 13.55);
    if (a <= 0) return;
    figHead(x, 13510, 6, tr("ch01.f6"), "Claude Code · OTLP", a, { subMono: true });
    const k = prog(b, 13.4, 13.75, E.io);
    // 云端环境画成一个虚线框（不画云朵）：里面几条会话在跑
    x.save(); x.globalAlpha = a * k; x.strokeStyle = bone; x.lineWidth = 2; x.setLineDash([12, 9]); x.strokeRect(CE.x, CE.y, CE.w, CE.h); x.restore();
    text(x, tr("ch01.cc"), CE.x + 28, CE.y + 52, { font: FONT.cjk(30, 600), color: bone, alpha: a * k });
    for (let i = 0; i < 3; i++) {
      const sy = CE.y + 90 + i * 118;
      box(x, CE.x + 28, sy, CE.w - 56, 92, a * k, { lw: 1.4, fill: "ink" });
      text(x, "$ claude", CE.x + 50, sy + 40, { font: FONT.pixel(28), color: bone, alpha: a * k });
      const r = mulberry32(40 + i);
      for (let j = 0; j < 2; j++) {
        const w = 80 + r() * 160, show = prog(b, 13.5 + i * 0.1 + j * 0.12, 13.62 + i * 0.1 + j * 0.12);
        fillRect(x, CE.x + 50 + j * 250, sy + 66, w * show, 8, bone, a * k * 0.35);
      }
      if (Math.floor(b * 4) % 2 === 0) fillRect(x, CE.x + 200, sy + 20, 14, 26, bone, a * k * 0.8);
    }
    // 一小段遥测：OTLP 包顺着线往右走
    const wk = prog(b, 13.55, 13.8, E.out);
    polyline(x, WIRE6, wk, 2, bone, a * 0.8);
    AT.otlp.forEach((t) => {
      const pk = prog(b, t - 0.2, t + 0.3, E.io);
      if (pk <= 0 || pk >= 1) return;
      // 走到线头之前就淡掉：线头右边紧挨着入口的标注
      const [px, py] = pathAt(WIRE6, pk * (pathLen(WIRE6) - 60)), pa = a * (1 - prog(pk, 0.75, 1));
      box(x, px - 50, py - 24, 100, 48, pa, { r: 8, lw: 2, color: css("signalD") });
      text(x, "OTLP", px, py + 10, { font: FONT.mono(28, 600), color: css("signalD"), align: "center", alpha: pa });
      glow(e, px, py, 70, 0.45 * pa);
    });
    const ea = a * prog(b, 13.8, 13.95);
    arrowHead(x, WIRE6[1][0], WIRE6[1][1], 0, bone, ea);
    text(x, "POST /api/ingest/agents/otlp", 14680, 496, { font: FONT.mono(28, 600), color: bone, alpha: ea });
    text(x, tr("ch01.extra"), 14680, 440, { font: FONT.cjk(34, 600), color: css("signalD"), alpha: a * prog(b, 14.0, 14.1) });
    text(x, tr("ch01.self"), CE.x + CE.w + 40, CE.y + CE.h - 10, { font: FONT.cjk(30, 600), color: ash, alpha: a * prog(b, 13.9, 14.05) });
  }

  // ========== CU 编码用量：三处原始数汇到站点这边合并，Pulse 多一条 Tokens 道 ==========
  const SRC_Y = [330, 470, 610];
  const MERGE = [15960, 470];
  const PC = { x: 16300, y: 214, w: 860, h: 540 };
  const LANES = [["ch01.pulse.coding", 0], ["ch01.pulse.tokens", 1], ["ch01.pulse.listening", 0], ["ch01.pulse.watching", 0]];
  const srcPath = (i) => [[15430, SRC_Y[i]], [15790, SRC_Y[i]], MERGE];
  function slipIcon(x, cx, cy, a, hot) {
    box(x, cx - 22, cy - 15, 44, 30, a, { lw: 1.6, color: hot ? css("signalD") : css("bone") });
    for (let j = 0; j < 3; j++) line(x, cx - 14, cy - 7 + j * 7, cx + 12 - j * 6, cy - 7 + j * 7, 1.2, hot ? css("signalD") : css("bone"), a * 0.8);
  }
  function stationCU(x, e, d, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 14.35, 14.55);
    if (a <= 0) return;
    figHead(x, 15430, null, tr("ch01.cu"), null, a, { rule: 1720 });
    const srcKeys = ["ch01.srcMac", "ch01.cc", "ch01.srcCursor"];
    SRC_Y.forEach((y, i) => {
      const t = AT.raw[i];
      text(x, tr(srcKeys[i]), 15430, y - 22, { font: FONT.cjk(30, 600), color: bone, alpha: a });
      const pts = srcPath(i);
      polyline(x, pts, prog(b, 14.35, 14.6, E.out), 1.6, bone, a * 0.6);
      // 一张原始数的小单子，t 时出发，走到合并处
      const pk = prog(b, t, t + 0.25, E.io);
      if (pk > 0 && pk < 1) { const [px, py] = pathAt(pts, pk * pathLen(pts)); slipIcon(x, px, py, a, true); glow(e, px, py, 60, 0.4); }
      if (b >= t) glow(e, 15430 + 20, y, 50, 0.5 * impact(b, t, 0.2));
      if (b >= t + 0.25) polyline(x, pts, 1, 2.2, css("signalD"), a * 0.85);
    });
    // 合并处
    const mk = prog(b, AT.merge, AT.merge + 0.06);
    x.save(); x.globalAlpha = a; x.fillStyle = mk > 0.5 ? css("signalD") : css("ink2"); x.strokeStyle = mk > 0.5 ? css("signalD") : bone; x.lineWidth = 2.4;
    x.beginPath(); x.arc(MERGE[0], MERGE[1], 30, 0, TAU); x.fill(); x.stroke(); x.restore();
    if (mk > 0) glow(e, MERGE[0], MERGE[1], 140, 0.9 * impact(b, AT.merge, 0.25) + 0.15);
    text(x, tr("ch01.merge"), MERGE[0] - 30, MERGE[1] + 86, { font: FONT.cjk(30, 600), color: bone, alpha: a * prog(b, AT.merge, AT.merge + 0.1) });
    text(x, "/api/status/coding*", MERGE[0] - 30, MERGE[1] + 128, { font: FONT.mono(28, 500), color: ash, alpha: a * prog(b, AT.merge + 0.05, AT.merge + 0.15) });
    nar(x, "ch01.n5a", 15430, 944, prog(b, 14.55, 15.0), win(b, 14.5, 14.6, 15.8, 15.95));
    nar(x, "ch01.n5b", 15430, 1024, prog(b, 15.0, 15.5), win(b, 14.5, 14.6, 15.8, 15.95));
    // 合并处伸出一段 Pulse（站点首页那张卡的一小截），多一条 Tokens 道
    const pa = prog(b, AT.merge + 0.02, AT.merge + 0.2, E.out);
    arrowPath(x, [[MERGE[0] + 34, MERGE[1]], [PC.x - 6, MERGE[1]]], pa, css("signalD"), a, 2.2);
    if (pa <= 0) return;
    sheet(d, PC.x, PC.y, PC.w, PC.h, { alpha: a * pa });
    text(d, "Pulse", PC.x + 36, PC.y + 64, { font: FONT.sans(40, 600), alpha: a * pa });
    text(d, tr("ch01.pulse.window"), PC.x + PC.w - 36, PC.y + 62, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: a * pa });
    line(d, PC.x + 30, PC.y + 90, PC.x + PC.w - 30, PC.y + 90, 1.4, css("pink"), a * pa);
    const tx0 = PC.x + 230, tx1 = PC.x + PC.w - 36;
    LANES.forEach(([key, hot], i) => {
      const y = PC.y + 160 + i * 100;
      const col = hot ? css("signal") : css("pink");
      text(d, tr(key), PC.x + 36, y + 10, { font: FONT.sans(30, 600), color: col, alpha: a * pa });
      line(d, tx0, y + 20, tx1, y + 20, 1.2, css("pink"), 0.25 * a * pa);
      const r = mulberry32(60 + i);
      if (hot) {
        const tk = prog(b, AT.tokens, AT.tokens + 0.3);
        const n = 44, cw = (tx1 - tx0) / n;
        for (let j = 0; j < n; j++) {
          const v = r(), busy = (j > 8 && j < 20) || (j > 29 && j < 41);
          const hgt = busy ? 10 + v * 34 : v < 0.2 ? 4 + v * 20 : 0; // 最高 44：上面要留给「三处相加」
          const shown = clamp(tk * n - j);
          if (hgt > 0 && shown > 0) fillRect(d, tx0 + j * cw + 1, y + 20 - hgt * shown, cw - 3, hgt * shown, css("signal"), a * pa * 0.9);
        }
        text(d, "tokens/min", PC.x + 36, y + 46, { font: FONT.mono(28, 500), color: css("graphite"), alpha: a * pa });
        text(d, tr("ch01.sum"), tx1, y - 34, { font: FONT.cjk(28, 600), color: css("signal"), align: "right", alpha: a * pa * prog(b, AT.tokens + 0.1, AT.tokens + 0.25) });
      } else {
        let u = tx0 + r() * 60;
        while (u < tx1 - 40) { const w = 20 + r() * 110; fillRect(d, u, y + 8, Math.min(w, tx1 - u), 12, css("pink"), 0.35 * a * pa); u += w + 30 + r() * 90; }
      }
    });
  }

  // ========== F7 表盘：采集 Worker，一拍当一分钟 ==========
  // 源：workers/collector/src/registry.ts#JOBS 与各任务的 everyMinutes / offset（分钟 % every === offset 时跑，schedule.ts#isDue）。
  // 表盘从整点起走 12 分钟；任务增减或改节奏时照着改这张表
  const JOBS = [
    ["apple-recent", 2, 0], ["provider-status", 1, 0], ["pagespeed", 60, 7],
    ["github-chart", 10, 1], ["github-repo", 30, 2], ["vercel-deployments", 1, 0], ["vercel-metrics", 15, 3],
    ["cloudflare-deployments", 2, 0], ["cloudflare-metrics", 15, 4], ["sentry-status", 5, 0],
  ];
  const MINUTES = 12;
  const due = (j, m) => m % JOBS[j][1] === JOBS[j][2];
  const DC = [17870, 500], DR = 262;
  const TC = { x: 18236, y: 174, w: 880, h: 652 };
  const minuteAt = (b) => Math.floor((b - AT.dial) * 4 + 1e-9);
  // 第 j 根指针此刻转了几格（含正在弹的那一格）
  function handSteps(j, b) {
    if (b < AT.dial) return 0;
    const bt = Math.min((b - AT.dial) * 4, MINUTES - 1e-6), m = Math.floor(bt);
    let n = 0;
    for (let i = 0; i < m; i++) if (due(j, i)) n++;
    if (due(j, m)) n += E.spring(clamp((bt - m) / 0.55));
    return n;
  }
  function stationF7(x, e, d, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 15.85, 16.05);
    if (a <= 0) return;
    figHead(x, 17350, 7, tr("ch01.f7"), tr("ch01.f7sub"), a, { rule: 720 });
    text(x, "workers/collector", 17350 + measure(x, tr("ch01.f7sub"), FONT.cjk(28, 600)) + 24, 162, { font: FONT.mono(28, 500), color: ash, alpha: a });
    text(x, tr("ch01.noGate"), 17350, 214, { font: FONT.cjk(28, 600), color: ash, alpha: a * prog(b, 16.5, 16.7), maxW: 840 });
    const beatF = Math.max(0, (b - AT.dial) * 4);
    const m = b < AT.dial ? -1 : Math.min(MINUTES - 1, minuteAt(b));
    const tickP = b < AT.dial ? 0 : Math.exp(-((beatF % 1) * 60 / 108) / 0.12);
    // 钟面
    const [cx, cy] = DC;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.beginPath(); x.arc(cx, cy, DR, 0, TAU); x.fill(); x.strokeStyle = bone; x.lineWidth = 2.8; x.stroke();
    x.lineWidth = 1.2; x.globalAlpha = a * 0.5; x.beginPath(); x.arc(cx, cy, DR - 12, 0, TAU); x.stroke(); x.restore();
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * TAU - Math.PI / 2, big = i % 5 === 0, r0 = DR - (big ? 30 : 20);
      line(x, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * (DR - 12), cy + Math.sin(ang) * (DR - 12), big ? 2.4 : 1, bone, (big ? 0.85 : 0.35) * a);
    }
    // 分钟读数（整点起第几分钟）：放在钟摆右边，钟面里全是指针
    if (m >= 0) {
      text(x, "cron", cx + 56, cy + DR + 34, { font: FONT.mono(28, 500), color: ash, alpha: a });
      text(x, `:${String(m).padStart(2, "0")}`, cx + 56, cy + DR + 80, { font: FONT.mono(40, 600), color: bone, alpha: a });
    }
    // 指针：每个任务一根，长短不一，起点错开；到它跑的那一分钟就往前弹一格
    JOBS.forEach((job, j) => {
      const len = DR * (0.4 + 0.042 * j), ang = -Math.PI / 2 + (j / JOBS.length) * TAU + handSteps(j, b) * (TAU / 12);
      const ran = m >= 0 && due(j, m) ? Math.exp(-((beatF - m) * 60 / 108) / 0.2) : 0;
      const tx = cx + Math.cos(ang) * len, ty = cy + Math.sin(ang) * len;
      line(x, cx, cy, tx, ty, 2, ran > 0.3 ? css("signalD") : bone, a * 0.9);
      x.save(); x.globalAlpha = a; x.fillStyle = ran > 0.3 ? css("signalD") : css("ink2"); x.strokeStyle = ran > 0.3 ? css("signalD") : bone; x.lineWidth = 1.8;
      x.beginPath(); x.arc(tx, ty, 8, 0, TAU); x.fill(); x.stroke(); x.restore();
      if (ran > 0.05) glow(e, tx, ty, 46, 0.7 * ran);
    });
    x.save(); x.globalAlpha = a; x.fillStyle = bone; x.beginPath(); x.arc(cx, cy, 13, 0, TAU); x.fill(); x.restore();
    if (tickP > 0.05) glow(e, cx, cy, 90, 0.55 * tickP);
    // 钟摆：每拍走到头滴答一下
    const pv = [cx, cy + DR + 10];
    const pang = b < AT.dial ? 0 : 0.26 * Math.cos(Math.PI * beatF);
    const bob = [pv[0] + Math.sin(pang) * 70, pv[1] + Math.cos(pang) * 70];
    line(x, pv[0], pv[1], bob[0], bob[1], 2.4, bone, a);
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = bone; x.lineWidth = 2.2; x.beginPath(); x.arc(bob[0], bob[1], 16, 0, TAU); x.fill(); x.stroke(); x.restore();
    nar(x, "ch01.n6a", 17350, 944, prog(b, 16.3, 16.9), win(b, 16.25, 16.35, 18.62, 18.75));
    nar(x, "ch01.n6b", 17350, 1024, prog(b, 16.9, 17.6), win(b, 16.25, 16.35, 18.62, 18.75));
    // 时序图：每行一个任务，每格一分钟，跑了就填上
    const ca = a * prog(b, 16.05, 16.25, E.out);
    if (ca <= 0) return;
    sheet(d, TC.x, TC.y, TC.w, TC.h, { alpha: ca });
    text(d, tr("ch01.chart"), TC.x + 34, TC.y + 60, { font: FONT.cjk(36, 600), alpha: ca });
    text(d, tr("ch01.perMin"), TC.x + TC.w - 34, TC.y + 58, { font: FONT.cjk(28, 600), color: css("graphite"), align: "right", alpha: ca });
    line(d, TC.x + 28, TC.y + 86, TC.x + TC.w - 28, TC.y + 86, 1.4, css("pink"), ca);
    const gx = TC.x + 438, pitch = 34, y0 = TC.y + 150;
    [0, 5, 10].forEach((mm) => text(d, `:${String(mm).padStart(2, "0")}`, gx + mm * pitch + 13, TC.y + 122, { font: FONT.mono(28, 500), color: css("graphite"), align: "center", alpha: ca }));
    if (m >= 0) fillRect(d, gx + m * pitch - 3, y0 - 26, pitch, JOBS.length * 48 + 4, css("pink"), 0.07 * ca);
    JOBS.forEach(([name], j) => {
      const y = y0 + j * 48;
      const ranNow = m >= 0 && due(j, m) ? Math.exp(-((beatF - m) * 60 / 108) / 0.2) : 0;
      text(d, name, TC.x + 34, y + 10, { font: FONT.mono(28, 500), color: ranNow > 0.3 ? css("signal") : css("pink"), alpha: ca });
      for (let mm = 0; mm < MINUTES; mm++) {
        const cxl = gx + mm * pitch, filled = m >= mm && due(j, mm);
        d.save(); d.globalAlpha = ca * (filled ? 1 : 0.35); d.strokeStyle = filled ? css("signal") : css("graphite"); d.lineWidth = 1.4; d.strokeRect(cxl, y - 14, 26, 26); d.restore();
        if (filled) fillRect(d, cxl + 3, y - 11, 20, 20, css("signal"), ca * (mm === m ? 0.6 + 0.4 * ranNow : 0.85));
      }
    });
  }

  // ========== 主角那封：2:3 从 Hub 出来停在笔记本旁边；19:0 亮起，19:1 起往右飞出画面 ==========
  const OUT = [PARK, [4700, 540]];
  const OUT_LEN = pathLen(OUT);
  // 去路：一条虚线指向下一章的入口域名（只在甩回来之后出现）
  function guide(x, b) {
    const gA = prog(b, AT.back + 0.02, AT.back + 0.16, E.out);
    if (gA <= 0) return;
    dashPath(x, [[PARK[0] + 44, 540], [3960, 540]], gA, 1.4, css("bone"), 0.45, [8, 8]);
    text(x, "→ ingest.homepage.lyjw.llc", 3790, 512, { font: FONT.mono(28, 500), color: css("ash"), align: "right", alpha: gA });
  }
  function hero(x, e, b) {
    if (b < AT.post) return;
    if (b < AT.park) {
      const k = prog(b, AT.post, AT.park, E.io);
      const p = [lerp(HUB[0], PARK[0], E.out(k)), lerp(HUB[1] + 30, PARK[1], k)];
      envelope(x, p[0], p[1], lerp(24, 60, k), css("signalD"), { lw: 2.2, fill: css("ink2") });
      spark(e, null, p, null, { t: G.t, size: 0.5 });
      return;
    }
    if (b < AT.launch) {
      guide(x, b);
      const lit = prog(b, AT.back, AT.back + 0.1);
      envelope(x, PARK[0], PARK[1], 60, css("signalD"), { lw: 2.2, fill: css("ink2") });
      spark(e, null, [PARK[0], PARK[1] - 4], null, { t: G.t, size: lerp(0.45, 1.1, lit) });
      if (lit > 0) glow(e, PARK[0], PARK[1], 150, 0.6 * impact(b, AT.back, 0.25));
      return;
    }
    guide(x, b);
    const dd = keys(b, [[AT.launch, 0], [19.97, OUT_LEN, E.inExpo]]);
    const head = pathAt(OUT, dd);
    const trail = trailOn(OUT, dd, lerp(80, 520, prog(b, AT.launch, 19.8)), 18);
    spark(e, x, head, trail, { t: G.t, size: 1.1, lw: 2.4, color: css("signalD") });
    envelope(x, head[0], head[1], 44, css("signalD"), { lw: 2, fill: css("ink2"), alpha: 1 - prog(b, 19.5, 19.7) });
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.judged, 0.1), impact(b, AT.shut, 0.1), impact(b, AT.merge, 0.12), impact(b, AT.back, 0.12));
    cam.zoom *= 1 + 0.012 * hitS;
    G.setCam(cam);
    G.fill(plate, { uGridA: 1, uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const d = paper.begin(); paper.cam(cam);

    // 只画镜头看得到的那几段（19:0 甩回来的那一下会扫过整条图纸）
    const half = 960 / cam.zoom + 400;
    const seen = (k) => Math.abs(FX[k] - cam.x) < half + 960;
    datum(x, cam);
    if (seen("S0")) stationS0(x, b);
    if (seen("M1")) stationM1(x, e, d, b);
    if (seen("M2")) { stationM2Jev(x, e, b); stationM2Img(x, e, d, b); }
    if (seen("F2")) stationF2(x, e, b);
    if (seen("F3")) stationF3(x, e, b);
    if (seen("F4")) stationF4(x, e, b);
    if (seen("F5")) stationF5(x, e, b);
    if (seen("F6")) stationF6(x, e, b);
    if (seen("CU")) stationCU(x, e, d, b);
    if (seen("F7")) stationF7(x, e, d, b);
    hero(x, e, b);

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 1.7 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.5 });
    G.composite(paper.upload(), { mode: G.MODE.paper });

    const sh = hitS * 6;
    f.post = {
      bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      flash: impact(b, AT.judged, 0.1) * 0.04 + impact(b, AT.merge, 0.1) * 0.04, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch01", title: "ch.01", bars: 20,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); },
    render,
  });
})();
