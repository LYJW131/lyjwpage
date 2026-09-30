// 画面只从 AT 取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, fillRect, envelope, spark, roundRect, sheet, pathAt, pathLen, trailOn, mulberry32, measure } = K;
  I18N.add({
    "ch01.title": ["野外观测站", "Field stations"],
    "ch01.n1a": ["上报器在数据源头主动推送；", "Reporters push from the source;"],
    "ch01.n1b": ["第三方接口由采集 Worker 定时拉取。", "a cron Worker polls external APIs."],
    "ch01.reporters": ["上报器", "Reporters"],
    "ch01.col": ["采集 Worker", "Collector Worker"],
    "ch01.extra": ["独立入口", "own endpoint"],
    "ch01.f1": ["Mac Telemetry Hub · 菜单栏 App", "Mac Telemetry Hub · menu bar app"],
    "ch01.env": ["信封", "Envelope"],
    "ch01.unsent": ["没变的模块不寄", "unchanged modules stay home"],
    "ch01.n2a": ["Mac 只寄这一次变了的模块；", "The Mac sends only changed modules;"],
    "ch01.n2b": ["没变化时，每 90 秒寄一封空信封。", "idle: an empty envelope every 90 s."],
    "ch01.empty": ["空信封 = 心跳", "empty envelope = heartbeat"],
    "ch01.settle": ["切应用先等 400 ms 落定", "App switches settle for 400 ms"],
    "ch01.again": ["落定前又切：重新计时", "switched again: restart"],
    "ch01.n2c": ["前台应用的切换先防抖：", "App switches are debounced:"],
    "ch01.n2d": ["连切几次，只报最后停住的那个。", "a burst reports only the final app."],
    "ch01.f1a": ["窗口标题 → Jev", "Window title → Jev"],
    "ch01.wt": ["窗口标题（不上画面）", "window title (not shown)"],
    "ch01.judge": ["隐私判断", "privacy check"],
    "ch01.illus": ["概率条为示意", "bars are illustrative"],
    "ch01.pass": ["放行 → 进信封", "cleared → envelope"],
    "ch01.owner": ["拿不准 → 交给主人", "unsure → the owner"],
    "ch01.n3a": ["窗口标题先经 Jev 做隐私判断；", "Jev screens window titles first;"],
    "ch01.n3b": ["拿不准的交给主人，放行的才进信封。", "unsure ones go to the owner."],
    "ch01.f1b": ["应用图标 → R2", "App icon → R2"],
    "ch01.byContent": ["sha256(内容)", "sha256(content)"],
    "ch01.sameKey": ["同一内容，同一个键", "same bytes, same key"],
    "ch01.n4a": ["图片按内容哈希命名，直传 R2；", "Images go to R2, named by hash;"],
    "ch01.n4b": ["信封里只带对象键。", "the envelope carries only the key."],
    "ch01.f2": ["iPhone Telemetry Hub · HealthKit 唤醒", "iPhone Telemetry Hub · woken by HealthKit"],
    "ch01.rings": ["活动圆环", "Activity rings"],
    "ch01.workouts": ["训练", "Workouts"],
    "ch01.steps": ["五分钟步数桶", "5-min step buckets"],
    "ch01.n5a": ["iPhone 由 HealthKit 后台唤醒：", "HealthKit wakes the iPhone app:"],
    "ch01.n5b": ["圆环按小时报，训练一有新记录就报。", "rings hourly, workouts at once."],
    "ch01.f3": ["家里", "At home"],
    "ch01.f3sub": ["HomePod 经 Home Assistant，PlayStation 由容器上报", "HomePod via Home Assistant; PlayStation via a container"],
    "ch01.playing": ["在放什么", "what's playing"],
    "ch01.haKey": ["Home Assistant 的钥匙", "Home Assistant's key"],
    "ch01.psKey": ["容器自己的钥匙", "the container's own key"],
    "ch01.psnLogin": ["PSN 登录态留在本机，只拿来问 Sony", "PSN login stays local, used only with Sony"],
    "ch01.probe1": ["探测主机醒没醒，", "probe: awake or not?"],
    "ch01.probe2": ["只定自己的节奏，不上报", "sets pace; never sent"],
    "ch01.tierRest": ["没醒 · 闲档", "asleep · idle"],
    "ch01.tierAwake": ["醒着 · 快档", "awake · fast"],
    "ch01.n6a": ["HomePod 由 Home Assistant 代报，", "Home Assistant relays the HomePod;"],
    "ch01.n6b": ["它那把钥匙只开 /homepod。", "its key opens /homepod only."],
    "ch01.n7a": ["PlayStation 由 n100 上的容器负责：", "An n100 container covers the PS5:"],
    "ch01.n7b": ["探测醒没醒，醒了就问 Sony 再上报。", "it probes, asks Sony, then reports."],
    "ch01.f4sub": ["emby-reporter · NAS 上的容器", "emby-reporter · a container on the NAS"],
    "ch01.poster": ["① 海报先传 R2", "① poster to R2 first"],
    "ch01.watching": ["② 再报在看什么", "② then what's on"],
    "ch01.n8a": ["海报先传 R2，再寄在看的信封；", "Posters reach R2 before the report;"],
    "ch01.n8b": ["入口核对 R2，缺哪张写进回执。", "the receipt lists any still missing."],
    "ch01.f5": ["东京的机柜", "The Tokyo rack"],
    "ch01.srv": ["服务器状态 · 固定每 60 秒", "server status · every 60 s, fixed"],
    "ch01.lim": ["各家编码工具的限额", "each coding tool's limits"],
    "ch01.cur": ["Cursor 账号的用量", "Cursor account usage"],
    "ch01.quest": ["Quest 在玩什么 · 读 Discord 在线状态", "Quest games · from Discord presence"],
    "ch01.n9a": ["同一台主机上的几个容器，", "Containers on the same host"],
    "ch01.n9b": ["各用各的钥匙，各报各的来源。", "each hold their own key and source."],
    "ch01.f6": ["云端的一小段遥测", "A stretch of cloud telemetry"],
    "ch01.cc": ["Claude Code 云端", "Claude Code in the cloud"],
    "ch01.self": ["Claude Code 自己发，不是我们写的上报器", "sent by Claude Code, not by a reporter of ours"],
    "ch01.n10a": ["云端的 Claude Code 自己发 OTLP，", "Cloud Claude Code emits OTLP itself;"],
    "ch01.n10b": ["只收累计值，差值在状态核心里算。", "cumulative only; the core diffs it."],
    "ch01.cu": ["编码用量", "Coding usage"],
    "ch01.srcMac": ["Mac 本机", "the Mac itself"],
    "ch01.srcCursor": ["容器里的 Cursor", "Cursor, via the container"],
    "ch01.merge": ["站点这边合并", "merged site-side"],
    "ch01.sum": ["三处相加", "all three summed"],
    "ch01.tokRate": ["token 处理量 · 5 分钟平均", "tokens processed · 5-min avg"],
    "ch01.pulse.coding": ["Coding", "Coding"],
    "ch01.pulse.tokens": ["Tokens", "Tokens"],
    "ch01.pulse.listening": ["Listening", "Listening"],
    "ch01.pulse.watching": ["Watching", "Watching"],
    "ch01.pulse.window": ["Last 24 hours", "Last 24 hours"],
    "ch01.n11a": ["编码用量：三处各报原始数，", "Coding usage: three raw feeds;"],
    "ch01.n11b": ["合计与去重都在站点这边算。", "totals and dedup happen site-side."],
    "ch01.f7": ["采集 Worker", "The collector Worker"],
    "ch01.f7sub": ["cron 每分钟触发", "cron trigger, every minute"],
    "ch01.noGate": ["不走上报入口：直接交给状态核心，或写 LAG", "Skips ingress: calls the state core, or writes LAG"],
    "ch01.chart": ["各任务的节奏", "Each job's cadence"],
    "ch01.perMin": ["一格一分钟", "one cell = one minute"],
    "ch01.n12a": ["cron 每分钟触发一次采集 Worker，", "A cron trigger fires every minute;"],
    "ch01.n12b": ["每个任务按自己的周期和偏移去取。", "each job runs on its own period."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, paper;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const AT = {
    type: 2.1, flip: 3.0, lit: 3.5, post: 3.75, park: 4.0, breath: 4.5,
    sw1: 5.0, sw2: 5.25, settle: 5.75,
    jev: 7.25, judged: 8.0, cleared: 8.25, owner: 8.5,
    pixels: 9.0, hash: 9.25, drop: 9.5, shut: 9.75, objKey: 9.5,
    wake: 11.25, outs: [11.5, 11.75, 12.0],
    homepod: 13.5, haDoor: 14.0, probeLine: 14.5, power: 15.0, probe: 15.25, awake: 15.4, psn: [15.5, 15.75], psDoor: 16.0,
    poster: 17.5, emby: 18.0,
    server: 19.25, agents: 19.75, quest: 20.25,
    otlp: [22.5, 22.75],
    raw: [24.5, 24.625, 24.75], merge: 25.0, tokens: 25.1,
    dial: 27.0, back: 30.0, launch: 30.25,
  };

  const FX = { S0: 960, M1: 2880, M2: 4800, F2: 6720, F3: 8640, F4: 10560, F5: 12480, F6: 14400, CU: 16320, F7: 18240 };
  const STOPS = [["S0", 0, 1.75], ["M1", 2, 6.75], ["M2", 7, 10.75], ["F2", 11, 12.75], ["F3", 13, 16.75], ["F4", 17, 18.75],
    ["F5", 19, 21.75], ["F6", 22, 23.75], ["CU", 24, 26.75], ["F7", 27, 29.7], ["M1", 30, 31]];
  const CAM = [[0, [FX.S0 - 24, 548, 1.03, 0]]];
  STOPS.forEach(([k, t0, t1], i) => {
    if (i > 0) CAM.push([t0, [FX[k], 540, 1, 0], E.io]);
    CAM.push([t1, [FX[k] + 14, 540, 1.014, 0], i === 0 ? E.out : E.lin]);
  });
  const PLATE_RECT = [-200, -80, 19400, 1160];
  const DATUM = 872;

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
  function narPair(x, keyA, keyB, px, r1, r2, io, b) {
    const a = win(b, io[0], io[1], io[2], io[3]);
    nar(x, keyA, px, 944, prog(b, r1[0], r1[1]), a);
    nar(x, keyB, px, 1024, prog(b, r2[0], r2[1]), a);
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
  function arrowPath(x, pts, k, color, alpha = 1, w = 2, dashed = false) {
    if (k <= 0 || alpha <= 0) return;
    const head = dashed ? dashPath(x, pts, k, w, color, alpha) : polyline(x, pts, k, w, color, alpha);
    if (!head) return;
    const prev = pathAt(pts, Math.max(0, k * pathLen(pts) - 10));
    arrowHead(x, head[0], head[1], Math.atan2(head[1] - prev[1], head[0] - prev[0]), color, alpha);
  }
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
  function container(x, rx, ry, w, h, a, hot = 0) {
    if (a <= 0) return;
    box(x, rx, ry, w, h, a, { color: hot > 0.5 ? css("signalD") : css("bone"), lw: 2 });
    x.save(); x.globalAlpha = a * 0.45; x.strokeStyle = css("bone"); x.lineWidth = 1; x.beginPath();
    for (let u = rx + 12; u < rx + w - 6; u += 12) { x.moveTo(u, ry + 7); x.lineTo(u, ry + h - 7); }
    x.stroke(); x.restore();
    if (hot > 0) fillRect(x, rx, ry, w, h, css("signalD"), 0.2 * hot * a);
  }
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
  function figHead(x, x0, num, name, sub, a, o = {}) {
    if (a <= 0) return;
    const head = num ? `FIG. ${num}` : "";
    const w = head ? measure(x, head, FONT.mono(34, 600)) + 26 : 0;
    if (head) text(x, head, x0, 118, { font: FONT.mono(34, 600), color: css("bone"), alpha: a });
    text(x, name, x0 + w, 118, { font: o.mono ? FONT.mono(34, 500) : FONT.cjk(34, 600), color: css("bone"), alpha: a });
    if (sub) text(x, sub, x0, 162, { font: o.subMono ? FONT.mono(28, 500) : FONT.cjk(28, 600), color: css("ash"), alpha: a, maxW: o.subW });
    line(x, x0, 186, x0 + (o.rule ?? 640), 186, 1.2, css("bone"), 0.35 * a);
  }
  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const ICON_KEY = hex64(101);
  const KEY_SHORT = `${ICON_KEY.slice(0, 8)}…${ICON_KEY.slice(-4)}.png`;

  function datum(x, cam) {
    const half = 960 / cam.zoom + 60, x0 = Math.max(-120, cam.x - half), x1 = Math.min(19320, cam.x + half);
    if (x1 <= x0) return;
    const bone = css("bone");
    line(x, x0, DATUM, x1, DATUM, 1.3, bone, 0.32);
    x.save(); x.strokeStyle = bone; x.lineWidth = 1; x.globalAlpha = 0.22; x.beginPath();
    for (let u = Math.ceil(x0 / 40) * 40; u <= x1; u += 40) { const big = u % 200 === 0; x.moveTo(u, DATUM); x.lineTo(u, DATUM + (big ? 12 : 6)); }
    x.stroke(); x.restore();
  }

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
    else if (i === 4) { R(-37, -12, 22, 24); R(-11, -12, 22, 24); R(15, -12, 22, 24); }
    else if (i === 5) { x.setLineDash([5, 4]); x.beginPath(); x.rect(-26, -20, 52, 40); x.stroke(); x.setLineDash([]); L([[-14, 0], [-6, -8], [2, 6], [10, -4]]); }
    else { x.beginPath(); x.arc(0, 0, 26, 0, TAU); x.fill(); x.stroke(); L([[0, -18], [0, 0], [13, 7]]); }
    x.restore();
  }
  function stationS0(x, b) {
    const bone = css("bone"), ash = css("ash");
    text(x, "01", 110, 196, { font: FONT.pixel(112), color: css("signalD") });
    text(x, tr("ch01.title"), 290, 176, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.02, 0.6) });
    text(x, "reporters · collector Worker", 292, 226, { font: FONT.mono(28), color: ash, reveal: prog(b, 0.15, 0.75) });
    line(x, 110, 262, 110 + 990 * prog(b, 0, 0.8, E.outExpo), 262, 1.4, bone, 0.6);
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
      const bx0 = xs(0) - 52, bx1 = xs(4) + 60, by = y - 78;
      polyline(x, [[bx0, by + 14], [bx0, by], [bx1, by], [bx1, by + 14]], 1, 1.4, bone, 0.7 * brA);
      text(x, tr("ch01.reporters"), (bx0 + bx1) / 2, by - 20, { font: FONT.cjk(32, 600), color: bone, align: "center", alpha: brA });
      text(x, tr("ch01.col"), xs(6), by - 20, { font: FONT.cjk(32, 600), color: bone, align: "center", alpha: brA });
      text(x, tr("ch01.extra"), xs(5), y + 134, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: brA });
    }
    narPair(x, "ch01.n1a", "ch01.n1b", 110, [0.3, 0.8], [0.8, 1.3], [0.25, 0.35, 1.72, 1.82], b);
  }

  const LAP = { x: 2050, y: 212, w: 760, h: 430 };
  const MENU_H = 44;
  const WIN = { x: 2135, y: 320, w: 600, h: 236 };
  const HUB = [LAP.x + LAP.w - 42, LAP.y + 16 + MENU_H / 2];
  const PARK = [2890, 540];
  const CARD = { x: 2946, y: 128, w: 836, h: 700 };
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI";
  const CELLS = ["desktop", "appleMusic", "chargingDevices", "…"];
  const APPS = ["Ghostty", "Xcode", "Figma"];

  function cover(x, px, py, s, a) {
    x.save(); x.globalAlpha = a;
    x.fillStyle = css("ink"); x.fillRect(px, py, s, s);
    x.strokeStyle = css("bone"); x.lineWidth = 1.6; x.strokeRect(px, py, s, s);
    for (let j = 1; j <= 4; j++) { x.globalAlpha = a * (0.55 - j * 0.1); x.beginPath(); x.arc(px + s * 0.5, py + s * 0.52, s * 0.11 * j, 0, TAU); x.stroke(); }
    x.restore();
  }
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
    line(x, lx + 16, ly + 16 + MENU_H, lx + w - 16, ly + 16 + MENU_H, 1.2, bone, 0.6 * ik);
    const second = b >= AT.sw2 - 0.05;
    const swK = second ? prog(b, AT.sw2 - 0.05, AT.sw2 + 0.05) : prog(b, AT.sw1 - 0.05, AT.sw1 + 0.05);
    const shownApp = APPS[(second ? 1 : 0) + (swK >= 0.5 ? 1 : 0)];
    withSquash(x, ly + 16 + MENU_H / 2, squash(swK), () => {
      text(x, shownApp, lx + 40, ly + 16 + MENU_H / 2 + 10, { font: FONT.mono(28, 600), color: bone, alpha: ik });
    });
    const blink = Math.max(impact(b, AT.flip, 0.12), impact(b, AT.post, 0.12), impact(b, AT.breath, 0.12), impact(b, AT.settle, 0.12), impact(b, AT.back, 0.12));
    const hc = blink > 0.3 ? css("signalD") : bone;
    x.save(); x.globalAlpha = ik; x.strokeStyle = hc; x.lineWidth = 2; x.beginPath(); x.arc(HUB[0], HUB[1], 11, 0, TAU); x.stroke();
    x.fillStyle = hc; x.beginPath(); x.arc(HUB[0], HUB[1], 3.5, 0, TAU); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.arc(HUB[0], HUB[1], 17, s > 0 ? -0.7 : Math.PI - 0.7, s > 0 ? 0.7 : Math.PI + 0.7); x.stroke(); }
    x.restore();
    if (blink > 0.02) glow(e, HUB[0], HUB[1], 60, 0.7 * blink * ik);
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
    const t0 = AT.type, step = 0.07;
    L.forEach((row, i) => {
      const y = py + 150 + i * 56;
      const r = prog(b, t0 + i * step, t0 + (i + 1) * step);
      if (!row) return;
      text(d, row[1], px + 44 + row[0] * 36, y, { font: FONT.mono(30, 500), color: css("pink"), alpha: a, reveal: r, perChar: r < 1 });
    });
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

  const BREATH = [2140, 772];
  function breath(x, e, b) {
    const a = win(b, AT.park, AT.park + 0.1, 4.85, 4.97);
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

  const RUL = { x0: 2110, x1: 2710, y: 790 };
  function ruler(x, e, b) {
    const a = win(b, 4.95, 5.05, 6.62, 6.74);
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
    const ag = win(b, AT.sw2, AT.sw2 + 0.06, AT.settle - 0.08, AT.settle);
    if (ag > 0) text(x, tr("ch01.again"), (x0 + x1) / 2, y + 40, { font: FONT.cjk(28, 600), color: ash, align: "center", alpha: a * ag });
    if (done > 0) glow(e, x1, y, 70, 0.8 * impact(b, AT.settle, 0.2));
  }

  function stationM1(x, e, d, b) {
    const k = prog(b, 1.72, 2.15, E.io);
    const headA = prog(b, 1.8, 2.05);
    figHead(x, 1990, 1, "Mac", tr("ch01.f1"), headA, { mono: true });
    laptop(x, e, b, k);
    envCard(d, b, win(b, AT.type - 0.05, AT.type, 6.62, 6.72));
    breath(x, e, b);
    ruler(x, e, b);
    narPair(x, "ch01.n2a", "ch01.n2b", 1990, [3.05, 3.5], [4.1, 4.6], [2.95, 3.05, 4.85, 4.97], b);
    narPair(x, "ch01.n2c", "ch01.n2d", 1990, [5.05, 5.45], [5.45, 5.95], [4.97, 5.07, 6.62, 6.74], b);
  }

  const WT = { x: 3910, y: 238, w: 760, h: 62 };
  const JV = { x: 3910, y: 336, w: 760, h: 316 };
  const QROWS = [430, 482, 534, 586];
  const PROB = [0.34, 0.81, 0.22, 0.63];
  const FORK = [4290, 712], PASS = [4056, 788], OWNER = [4524, 788];
  const REDACT = [140, 92, 210, 120];
  function redacted(x, rx, cy, a, s = 1) {
    let u = rx;
    REDACT.forEach((w) => { fillRect(x, u, cy - 9 * s, w * s, 18 * s, css("bone"), 0.42 * a); u += (w + 16) * s; });
  }
  function stationM2Jev(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 6.85, 7.05);
    if (a <= 0) return;
    figHead(x, 3910, "1A", tr("ch01.f1a"), null, a, { rule: 760 });
    text(x, tr("ch01.wt"), WT.x, WT.y - 12, { font: FONT.cjk(28, 600), color: ash, alpha: a });
    box(x, WT.x, WT.y, WT.w, WT.h, a, { lw: 1.8 });
    redacted(x, WT.x + 30, WT.y + WT.h / 2, a);
    arrowPath(x, [[WT.x + WT.w / 2, WT.y + WT.h + 4], [WT.x + WT.w / 2, JV.y - 6]], prog(b, 7.0, 7.2), bone, a, 1.6);
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
    narPair(x, "ch01.n3a", "ch01.n3b", 3910, [7.05, 7.5], [7.5, 8.2], [7.0, 7.1, 8.85, 8.97], b);
  }

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
    const a = prog(b, 6.85, 7.05);
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
    const openK = keys(b, [[AT.hash, 0], [AT.hash + 0.12, 1, E.out], [AT.shut - 0.04, 1], [AT.shut + 0.02, 0, E.in]]);
    cabinet(x, CAB.x, CAB.y, CAB.w, CAB.h, CAB.cols, CAB.rows, a, { ...SLOT, k: openK, hot: true });
    text(x, "R2", CAB.x, CAB.y - 22, { font: FONT.mono(44, 600), color: bone, alpha: a });
    text(x, "immutable", CAB.x + CAB.w, CAB.y - 24, { font: FONT.mono(28, 500), color: ash, align: "right", alpha: a });
    const shut = impact(b, AT.shut, 0.16);
    if (shut > 0.02) glow(e, sx, sy, 110, 0.8 * shut);
    const oa = prog(b, AT.objKey - 0.06, AT.objKey + 0.06, E.outBack);
    if (oa > 0) {
      sheet(d, OBJ.x, OBJ.y, OBJ.w, OBJ.h, { alpha: a * clamp(oa), shadow: 18 });
      envelope(d, OBJ.x + 48, OBJ.y + 44, 52, css("pink"), { lw: 2, fill: css("paper"), alpha: a * clamp(oa) });
      text(d, "desktop", OBJ.x + 90, OBJ.y + 54, { font: FONT.mono(28, 500), color: css("graphite"), alpha: a * clamp(oa) });
      text(d, '"iconObjectKey":', OBJ.x + 24, OBJ.y + 102, { font: FONT.mono(28, 500), color: css("pink"), alpha: a * clamp(oa) });
      text(d, `"${KEY_SHORT}"`, OBJ.x + 24, OBJ.y + 138, { font: FONT.mono(28, 500), color: css("signal"), alpha: a * clamp(oa), reveal: prog(b, AT.objKey, AT.objKey + 0.15), perChar: true });
      text(x, tr("ch01.sameKey"), OBJ.x, CAB.y + CAB.h + 46, { font: FONT.cjk(28, 600), color: ash, alpha: a * clamp(oa) });
    }
    narPair(x, "ch01.n4a", "ch01.n4b", 3910, [9.05, 9.5], [9.5, 10.0], [9.0, 9.1, 10.62, 10.74], b);
  }

  const PH = { x: 6100, y: 222, w: 300, h: 610 };
  const OUT2 = [[6700, 348], [6700, 540], [6700, 728]];
  function stationF2(x, e, b) {
    const bone = css("bone");
    const a = prog(b, 10.85, 11.05);
    if (a <= 0) return;
    figHead(x, 5830, 2, "iPhone", tr("ch01.f2"), a, { mono: true });
    const k = prog(b, 10.9, 11.35, E.io);
    x.save(); x.globalAlpha = a;
    x.strokeStyle = bone; x.lineWidth = 2.6; roundRect(x, PH.x, PH.y, PH.w, PH.h, 46); x.save(); x.fillStyle = css("ink2"); x.globalAlpha = a * k; x.fill(); x.restore(); x.stroke();
    x.restore();
    const wake = prog(b, AT.wake, AT.wake + 0.1);
    box(x, PH.x + 16, PH.y + 16, PH.w - 32, PH.h - 32, a * k, { r: 34, lw: 1.4, fill: "ink" });
    if (wake > 0) { x.save(); roundRect(x, PH.x + 16, PH.y + 16, PH.w - 32, PH.h - 32, 34); x.globalAlpha = a * 0.08 * wake; x.fillStyle = css("bone"); x.fill(); x.restore(); }
    box(x, PH.x + PH.w / 2 - 44, PH.y + 34, 88, 24, a * k, { r: 12, lw: 1.4, fill: "ink" });
    for (const [bx, by, bh] of [[PH.x - 6, PH.y + 130, 44], [PH.x - 6, PH.y + 196, 70], [PH.x + PH.w, PH.y + 170, 96]]) box(x, bx, by, 6, bh, a * k, { lw: 1.4 });
    if (wake > 0) {
      text(x, "HealthKit", PH.x + PH.w / 2, PH.y + PH.h / 2 + 10, { font: FONT.mono(30, 600), color: css("signalD"), align: "center", alpha: a * wake });
      const rk = prog(b, AT.wake, AT.wake + 0.5, E.out);
      if (rk < 1) { x.save(); x.globalAlpha = a * (1 - rk) * 0.8; x.strokeStyle = css("signalD"); x.lineWidth = 2; roundRect(x, PH.x - 30 * rk, PH.y - 30 * rk, PH.w + 60 * rk, PH.h + 60 * rk, 46 + 30 * rk); x.stroke(); x.restore(); }
      glow(e, PH.x + PH.w / 2, PH.y + PH.h / 2, 220, 0.5 * impact(b, AT.wake, 0.2));
    }
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
    text(x, "POST /api/ingest/iphone", OUT2[2][0] - 70, 812, { font: FONT.mono(28, 500), color: css("ash"), alpha: a * prog(b, AT.outs[2], AT.outs[2] + 0.15) });
    narPair(x, "ch01.n5a", "ch01.n5b", 5830, [11.05, 11.5], [11.5, 12.1], [11.0, 11.1, 12.62, 12.74], b);
  }

  // 三样凭据分开画，不能混：Home Assistant 的钥匙只开 /homepod；容器自己的钥匙只开 /playstation；
  // PSN 登录态不是钥匙，留在 n100 上，只拿来问 Sony，不进站点。容器的两条路也分开：往上问 Sony，往下寄到上报入口。
  // PS5 和 Home Assistant 之间没有线：站点不显示 PS 电源，醒没醒只由容器用 UDP 探测、只定它自己的节奏（FACTS §1）
  const HP = { x: 7750, y: 336, w: 210, h: 276 };
  const PS = { x: 8700, y: 286, w: 132, h: 370 };
  const HA = { x: 8150, y: 440, w: 250, h: 104 };
  const KEYC = [8275, 664];
  const HA_DOOR = [8494, 664, "/homepod"];
  const CT3 = { x: 9215, y: 380, w: 300, h: 66 };
  const N100 = { x: 9205, y: 462, w: 320, h: 120 };
  const PROBE_Y = 522, TIER_Y = PROBE_Y + 52;
  const PROBE = [[N100.x - 10, PROBE_Y], [PS.x + PS.w + 18, PROBE_Y]];
  const PSNB = { x: 9275, y: 214, w: 230, h: 60 };
  const PSN_X = PSNB.x + PSNB.w / 2, PSN_LINK = [[PSN_X, 336], [PSN_X, PSNB.y + PSNB.h + 6]];
  const KEYP = [9228, 720], PS_DOOR = [9340, 720, "/playstation"];
  function stationF3(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 12.85, 13.05);
    if (a <= 0) return;
    figHead(x, 7750, 3, tr("ch01.f3"), tr("ch01.f3sub"), a, { rule: 920 });
    const dk = prog(b, 12.9, 13.3, E.io);
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
    const pk = prog(b, 12.95, 13.35, E.io);
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
    const hk = prog(b, 13.1, 13.4);
    box(x, HA.x, HA.y, HA.w, HA.h, a * hk, { r: 12, lw: 2.2 });
    text(x, "Home Assistant", HA.x + HA.w / 2, HA.y + HA.h / 2 + 10, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * hk });
    dashPath(x, [[HP.x + HP.w + 70, HP.y + HP.h / 2], [HA.x, HA.y + HA.h / 2]], hk, 1.6, bone, a * 0.7);
    const kk = prog(b, AT.haDoor - 0.25, AT.haDoor - 0.05, E.out);
    if (kk > 0) {
      line(x, KEYC[0], HA.y + HA.h, KEYC[0], KEYC[1] - 31, 1.6, bone, a * kk);
      keycard(x, KEYC[0], KEYC[1], a * kk, b >= AT.haDoor - 0.05 && b < AT.haDoor + 0.6);
      door(x, e, b, KEYC, HA_DOOR, AT.haDoor, a);
      text(x, tr("ch01.haKey"), KEYC[0] - 75, KEYC[1] + 84, { font: FONT.cjk(28, 600), color: ash, alpha: a * kk });
    }
    const nk = prog(b, 13.1, 13.45, E.io);
    if (nk > 0) {
      const hot = b >= AT.probeLine - 0.02 ? 1 : 0;
      box(x, N100.x, N100.y, N100.w, N100.h, a * nk, { lw: 2.6 });
      hatch(x, N100.x + 16, N100.y + N100.h - 36, N100.w - 32, 22, a * nk * 0.5, 9);
      text(x, "n100", N100.x + 24, N100.y + 58, { font: FONT.mono(30, 600), color: bone, alpha: a * nk });
      x.save(); x.globalAlpha = a * nk; x.fillStyle = hot ? css("signalD") : css("ash"); x.beginPath(); x.arc(N100.x + N100.w - 28, N100.y + 28, 5, 0, TAU); x.fill(); x.restore();
      container(x, CT3.x, CT3.y, CT3.w, CT3.h, a * nk, hot);
      text(x, "playstation-reporter", CT3.x + CT3.w / 2, CT3.y - 16, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * nk });
      const uk = prog(b, AT.probeLine - 0.15, AT.probeLine + 0.05, E.out);
      const mid = (PROBE[0][0] + PROBE[1][0]) / 2;
      if (uk > 0) {
        arrowPath(x, PROBE, uk, bone, a * 0.8, 1.6, true);
        text(x, "UDP", mid, PROBE_Y - 22, { font: FONT.mono(28, 500), color: ash, align: "center", alpha: a * uk });
        const tk = prog(b, AT.awake - 0.05, AT.awake + 0.05), up = tk >= 0.5;
        withSquash(x, TIER_Y - 10, squash(tk), () => {
          text(x, tr(up ? "ch01.tierAwake" : "ch01.tierRest"), mid, TIER_Y, { font: FONT.cjk(28, 600), color: up ? css("signalD") : ash, align: "center", alpha: a * uk });
        });
        if (up) glow(e, mid, TIER_Y - 10, 80, 0.5 * impact(b, AT.awake, 0.2));
      }
      if (b >= AT.probeLine) {
        const n = Math.floor((b - AT.probeLine) * 4), sent = AT.probeLine + n / 4, p = (b - sent) * 4;
        const answered = sent >= AT.probe - 1e-6;
        const go = clamp(p / 0.5), px = lerp(PROBE[0][0], PROBE[1][0], E.out(go)), fade = answered ? 1 - prog(go, 0.9, 1) : 1 - prog(go, 0.6, 1);
        if (fade > 0) {
          x.save(); x.globalAlpha = a * fade; x.fillStyle = css("signalD"); x.beginPath(); x.arc(px, PROBE_Y, 7, 0, TAU); x.fill(); x.restore();
          glow(e, px, PROBE_Y, 38, 0.5 * fade);
        }
        if (answered && p > 0.5) {
          const bk = clamp((p - 0.5) / 0.45), rx = lerp(PROBE[1][0], PROBE[0][0], E.io(bk)), rf = 1 - prog(bk, 0.85, 1);
          x.save(); x.globalAlpha = a * rf * 0.9; x.strokeStyle = css("signalD"); x.lineWidth = 2; x.beginPath(); x.arc(rx, PROBE_Y, 7, 0, TAU); x.stroke(); x.restore();
          glow(e, rx, PROBE_Y, 30, 0.35 * rf);
        }
      }
      const pa = a * prog(b, AT.probeLine, AT.probeLine + 0.1);
      text(x, tr("ch01.probe1"), mid, TIER_Y + 50, { font: FONT.cjk(28, 600), color: bone, align: "center", alpha: pa });
      text(x, tr("ch01.probe2"), mid, TIER_Y + 88, { font: FONT.cjk(28, 600), color: bone, align: "center", alpha: pa });
      const asking = b >= AT.psn[0] && b < AT.psn[1];
      box(x, PSNB.x, PSNB.y, PSNB.w, PSNB.h, a * nk, { r: 8, lw: 2.2, color: asking ? css("signalD") : bone });
      text(x, "PSN · Sony", PSN_X, PSNB.y + 40, { font: FONT.mono(28, 600), color: asking ? css("signalD") : bone, align: "center", alpha: a * nk });
      text(x, tr("ch01.psnLogin"), PSNB.x - 18, PSNB.y + 40, { font: FONT.cjk(28, 600), color: ash, align: "right", alpha: a * nk });
      dashPath(x, PSN_LINK, nk, 1.6, bone, a * 0.7);
      if (asking) {
        const q = prog(b, AT.psn[0], AT.psn[1]), k = q < 0.5 ? E.out(q * 2) : 1 - E.out(q * 2 - 1);
        const py = lerp(PSN_LINK[0][1], PSN_LINK[1][1], k);
        x.save(); x.globalAlpha = a; x.fillStyle = css("signalD"); x.beginPath(); x.arc(PSN_X, py, 7, 0, TAU); x.fill(); x.restore();
        glow(e, PSN_X, py, 38, 0.5);
      }
      const pk2 = prog(b, AT.psDoor - 0.25, AT.psDoor - 0.05, E.out);
      if (pk2 > 0) {
        line(x, KEYP[0], N100.y + N100.h, KEYP[0], KEYP[1] - 31, 1.6, bone, a * pk2);
        keycard(x, KEYP[0], KEYP[1], a * pk2, b >= AT.psDoor - 0.05 && b < AT.psDoor + 0.6);
        door(x, e, b, KEYP, PS_DOOR, AT.psDoor, a);
        text(x, tr("ch01.psKey"), KEYP[0] - 75, KEYP[1] + 84, { font: FONT.cjk(28, 600), color: ash, alpha: a * pk2 });
      }
    }
    narPair(x, "ch01.n6a", "ch01.n6b", 7750, [13.05, 13.45], [13.45, 13.95], [13.0, 13.1, 14.38, 14.48], b);
    narPair(x, "ch01.n7a", "ch01.n7b", 7750, [14.55, 15.0], [15.0, 15.7], [14.48, 14.58, 16.62, 16.74], b);
  }
  function door(x, e, b, key, [dx, dy, label], t, a) {
    const dk = prog(b, t - 0.12, t, E.out), lit = b >= t, col = lit ? css("signalD") : css("bone");
    arrowPath(x, [[key[0] + 75, key[1]], [dx - 44, key[1]], [dx - 44, dy], [dx - 8, dy]], dk, col, a, 1.8);
    text(x, label, dx + 4, dy + 10, { font: FONT.mono(28, 500), color: col, alpha: a * dk });
    if (lit) glow(e, dx + 60, dy, 70, 0.5 * impact(b, t, 0.18));
  }

  const NS = { x: 9900, y: 356, w: 390, h: 420 };
  const CT4 = { x: 9920, y: 262, w: 350, h: 72 };
  const R2M = { x: 10680, y: 214, w: 180, h: 132 };
  function stationF4(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 16.85, 17.05);
    if (a <= 0) return;
    figHead(x, 9670, 4, "NAS", tr("ch01.f4sub"), a, { mono: true });
    const k = prog(b, 16.9, 17.25, E.io);
    box(x, NS.x, NS.y, NS.w, NS.h, a * k, { lw: 2.6 });
    for (let i = 0; i < 4; i++) {
      const bx = NS.x + 22 + i * 88, by = NS.y + 36;
      box(x, bx, by, 72, 300, a * k, { lw: 1.6, fill: "ink" });
      line(x, bx + 14, by + 250, bx + 58, by + 250, 3, bone, a * k * 0.7);
      const led = (Math.floor(b * 8 + i * 3) % 5) === 0;
      x.save(); x.globalAlpha = a * k; x.fillStyle = led ? css("signalD") : css("ash"); x.beginPath(); x.arc(bx + 36, by + 22, 5, 0, TAU); x.fill(); x.restore();
    }
    hatch(x, NS.x + 20, NS.y + NS.h - 50, NS.w - 40, 30, a * k * 0.5, 9);
    container(x, CT4.x, CT4.y, CT4.w, CT4.h, a * k, b >= AT.poster - 0.1 && b < 18.7 ? 1 : 0);
    text(x, "emby-reporter", CT4.x + CT4.w / 2, CT4.y - 16, { font: FONT.mono(28, 600), color: bone, align: "center", alpha: a * k });
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
    const ek = prog(b, AT.emby - 0.02, AT.emby + 0.3, E.out);
    if (ek > 0) {
      const ex = lerp(NS.x + NS.w + 20, R2M.x + 60, ek);
      arrowPath(x, [[NS.x + NS.w + 8, 600], [R2M.x + 20, 600]], ek, bone, a * 0.7, 1.6);
      envelope(x, ex, 600, 70, css("signalD"), { lw: 2.2, fill: css("ink2"), alpha: a });
      text(x, tr("ch01.watching"), R2M.x, 686, { font: FONT.cjk(30, 600), color: bone, alpha: a * prog(b, AT.emby, AT.emby + 0.08) });
      text(x, "POST /api/ingest/emby", R2M.x, 728, { font: FONT.mono(28, 500), color: ash, alpha: a * prog(b, AT.emby, AT.emby + 0.08) });
    }
    narPair(x, "ch01.n8a", "ch01.n8b", 9670, [17.05, 17.5], [17.5, 18.1], [17.0, 17.1, 18.62, 18.74], b);
  }

  const RK = { x: 11820, y: 212, w: 440, h: 640 };
  const SRVB = { x: 11850, y: 380, w: 380, h: 236 };
  const C5 = [0, 1, 2].map((i) => ({ x: 11872, y: 398 + i * 70, w: 300, h: 56 }));
  const TX5 = RK.x + RK.w + 130;
  const L5 = [
    { t: AT.server, ty: 262, name: "server-reporter", lines: ["ch01.srv"], ep: "POST /api/ingest/server" },
    { t: AT.agents, ty: 496, name: "agents-reporter", lines: ["ch01.lim", "ch01.cur"], ep: "POST /api/ingest/agents" },
    { t: AT.quest, ty: 716, name: "discord-reporter", lines: ["ch01.quest"], ep: "POST /api/ingest/quest" },
  ];
  function stationF5(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 18.85, 19.05);
    if (a <= 0) return;
    figHead(x, 11590, 5, tr("ch01.f5"), "misaka-jp", a, { subMono: true });
    const k = prog(b, 18.9, 19.25, E.io);
    box(x, RK.x, RK.y, RK.w, RK.h, a * k, { lw: 2.6, fill: "ink" });
    for (const rx of [RK.x + 16, RK.x + RK.w - 16]) {
      line(x, rx, RK.y + 10, rx, RK.y + RK.h - 10, 1.6, bone, a * k);
      for (let y = RK.y + 26; y < RK.y + RK.h - 20; y += 22) { x.save(); x.globalAlpha = a * k * 0.4; x.strokeStyle = bone; x.lineWidth = 1; x.strokeRect(rx - 4, y - 4, 8, 8); x.restore(); }
    }
    for (const [y0, hh] of [[RK.y + 30, 56], [RK.y + 100, 56], [RK.y + 424, 56], [RK.y + 494, 56], [RK.y + 564, 60]]) {
      box(x, RK.x + 30, y0, RK.w - 60, hh, a * k * 0.8, { lw: 1.4 });
      hatch(x, RK.x + 30, y0, RK.w - 60, hh, a * k * 0.3, 12);
    }
    box(x, SRVB.x, SRVB.y, SRVB.w, SRVB.h, a * k, { lw: 2.2 });
    L5.forEach((l, i) => {
      const c = C5[i], hot = impact(b, l.t, 0.25);
      container(x, c.x, c.y, c.w, c.h, a * k, b >= l.t - 0.02 ? Math.max(0.35, hot) : 0);
      if (b >= l.t) glow(e, c.x + c.w / 2, c.y + c.h / 2, 110, 0.6 * hot);
      const lk = prog(b, l.t - 0.12, l.t + 0.05, E.out);
      if (lk <= 0) return;
      const ay = c.y + c.h / 2, ax = c.x + c.w, vx = RK.x + RK.w + 50;
      polyline(x, [[ax, ay], [vx, ay], [vx, l.ty], [TX5 - 20, l.ty]], lk, 1.4, bone, a * 0.85);
      x.save(); x.globalAlpha = a * lk; x.fillStyle = bone; x.beginPath(); x.arc(ax, ay, 5, 0, TAU); x.fill(); x.restore();
      const ta = a * prog(b, l.t, l.t + 0.08);
      text(x, l.name, TX5, l.ty + 10, { font: FONT.mono(32, 600), color: bone, alpha: ta });
      l.lines.forEach((key, j) => text(x, tr(key), TX5, l.ty + 54 + j * 40, { font: FONT.cjk(28, 600), color: bone, alpha: ta }));
      text(x, l.ep, TX5, l.ty + 54 + l.lines.length * 40, { font: FONT.mono(28, 500), color: ash, alpha: ta });
    });
    narPair(x, "ch01.n9a", "ch01.n9b", 11590, [19.05, 19.5], [19.5, 20.1], [19.0, 19.1, 21.62, 21.74], b);
  }

  const CE = { x: 13590, y: 250, w: 560, h: 470 };
  const WIRE6 = [[CE.x + CE.w, 486], [14660, 486]];
  function stationF6(x, e, b) {
    const bone = css("bone"), ash = css("ash");
    const a = prog(b, 21.85, 22.05);
    if (a <= 0) return;
    figHead(x, 13510, 6, tr("ch01.f6"), "Claude Code · OTLP", a, { subMono: true });
    const k = prog(b, 21.9, 22.25, E.io);
    x.save(); x.globalAlpha = a * k; x.strokeStyle = bone; x.lineWidth = 2; x.setLineDash([12, 9]); x.strokeRect(CE.x, CE.y, CE.w, CE.h); x.restore();
    text(x, tr("ch01.cc"), CE.x + 28, CE.y + 52, { font: FONT.cjk(30, 600), color: bone, alpha: a * k });
    for (let i = 0; i < 3; i++) {
      const sy = CE.y + 90 + i * 118;
      box(x, CE.x + 28, sy, CE.w - 56, 92, a * k, { lw: 1.4, fill: "ink" });
      text(x, "$ claude", CE.x + 50, sy + 40, { font: FONT.pixel(28), color: bone, alpha: a * k });
      const r = mulberry32(40 + i);
      for (let j = 0; j < 2; j++) {
        const w = 80 + r() * 160, show = prog(b, 22.0 + i * 0.1 + j * 0.12, 22.12 + i * 0.1 + j * 0.12);
        fillRect(x, CE.x + 50 + j * 250, sy + 66, w * show, 8, bone, a * k * 0.35);
      }
      if (Math.floor(b * 4) % 2 === 0) fillRect(x, CE.x + 200, sy + 20, 14, 26, bone, a * k * 0.8);
    }
    const wk = prog(b, 22.05, 22.3, E.out);
    polyline(x, WIRE6, wk, 2, bone, a * 0.8);
    AT.otlp.forEach((t) => {
      const pk = prog(b, t - 0.2, t + 0.3, E.io);
      if (pk <= 0 || pk >= 1) return;
      const [px, py] = pathAt(WIRE6, pk * (pathLen(WIRE6) - 60)), pa = a * (1 - prog(pk, 0.75, 1));
      box(x, px - 50, py - 24, 100, 48, pa, { r: 8, lw: 2, color: css("signalD") });
      text(x, "OTLP", px, py + 10, { font: FONT.mono(28, 600), color: css("signalD"), align: "center", alpha: pa });
      glow(e, px, py, 70, 0.45 * pa);
    });
    const ea = a * prog(b, 22.3, 22.45);
    arrowHead(x, WIRE6[1][0], WIRE6[1][1], 0, bone, ea);
    text(x, "POST /api/ingest/agents/otlp", 14680, 496, { font: FONT.mono(28, 600), color: bone, alpha: ea });
    text(x, tr("ch01.extra"), 14680, 440, { font: FONT.cjk(34, 600), color: css("signalD"), alpha: a * prog(b, 22.55, 22.65) });
    text(x, tr("ch01.self"), CE.x + CE.w + 40, CE.y + CE.h - 10, { font: FONT.cjk(30, 600), color: ash, alpha: a * prog(b, 22.45, 22.6) });
    narPair(x, "ch01.n10a", "ch01.n10b", 13510, [22.05, 22.5], [22.5, 23.1], [22.0, 22.1, 23.62, 23.74], b);
  }

  // Tokens 道画的是三处 5 分钟桶相加后的 token 处理量（输入 + 输出 + 缓存写入，按桶平均到每分钟），不是生成速度（FACTS §1）
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
    const bone = css("bone");
    const a = prog(b, 23.85, 24.05);
    if (a <= 0) return;
    figHead(x, 15430, null, tr("ch01.cu"), null, a, { rule: 1720 });
    const srcKeys = ["ch01.srcMac", "ch01.cc", "ch01.srcCursor"];
    SRC_Y.forEach((y, i) => {
      const t = AT.raw[i];
      text(x, tr(srcKeys[i]), 15430, y - 22, { font: FONT.cjk(30, 600), color: bone, alpha: a });
      const pts = srcPath(i);
      polyline(x, pts, prog(b, 23.85, 24.1, E.out), 1.6, bone, a * 0.6);
      const pk = prog(b, t, t + 0.25, E.io);
      if (pk > 0 && pk < 1) { const [px, py] = pathAt(pts, pk * pathLen(pts)); slipIcon(x, px, py, a, true); glow(e, px, py, 60, 0.4); }
      if (b >= t) glow(e, 15430 + 20, y, 50, 0.5 * impact(b, t, 0.2));
      if (b >= t + 0.25) polyline(x, pts, 1, 2.2, css("signalD"), a * 0.85);
    });
    const mk = prog(b, AT.merge, AT.merge + 0.06);
    x.save(); x.globalAlpha = a; x.fillStyle = mk > 0.5 ? css("signalD") : css("ink2"); x.strokeStyle = mk > 0.5 ? css("signalD") : bone; x.lineWidth = 2.4;
    x.beginPath(); x.arc(MERGE[0], MERGE[1], 30, 0, TAU); x.fill(); x.stroke(); x.restore();
    if (mk > 0) glow(e, MERGE[0], MERGE[1], 140, 0.9 * impact(b, AT.merge, 0.25) + 0.15);
    text(x, tr("ch01.merge"), MERGE[0] - 30, MERGE[1] + 86, { font: FONT.cjk(30, 600), color: bone, alpha: a * prog(b, AT.merge, AT.merge + 0.1) });
    narPair(x, "ch01.n11a", "ch01.n11b", 15430, [24.05, 24.5], [25.0, 25.5], [24.0, 24.1, 26.62, 26.74], b);
    const pa = prog(b, AT.merge + 0.02, AT.merge + 0.2, E.out);
    arrowPath(x, [[MERGE[0] + 34, MERGE[1]], [PC.x - 6, MERGE[1]]], pa, css("signalD"), a, 2.2);
    if (pa <= 0) return;
    const sa = a * prog(b, AT.merge + 0.02, AT.merge + 0.08);
    sheet(d, PC.x, PC.y, PC.w, PC.h, { alpha: sa });
    text(d, "Pulse", PC.x + 36, PC.y + 64, { font: FONT.sans(40, 600), alpha: sa });
    text(d, tr("ch01.pulse.window"), PC.x + PC.w - 36, PC.y + 62, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: sa });
    line(d, PC.x + 30, PC.y + 90, PC.x + PC.w - 30, PC.y + 90, 1.4, css("pink"), sa);
    const tx0 = PC.x + 230, tx1 = PC.x + PC.w - 36;
    LANES.forEach(([key, hot], i) => {
      const y = PC.y + 160 + i * 100;
      const col = hot ? css("signal") : css("pink");
      text(d, tr(key), PC.x + 36, y + 10, { font: FONT.sans(30, 600), color: col, alpha: sa });
      line(d, tx0, y + 20, tx1, y + 20, 1.2, css("pink"), 0.25 * sa);
      const r = mulberry32(60 + i);
      if (hot) {
        const tk = prog(b, AT.tokens, AT.tokens + 0.3);
        const n = 44, cw = (tx1 - tx0) / n;
        for (let j = 0; j < n; j++) {
          const v = r(), busy = (j > 8 && j < 20) || (j > 29 && j < 41);
          const hgt = busy ? 10 + v * 34 : v < 0.2 ? 4 + v * 20 : 0;
          const shown = clamp(tk * n - j);
          if (hgt > 0 && shown > 0) fillRect(d, tx0 + j * cw + 1, y + 20 - hgt * shown, cw - 3, hgt * shown, css("signal"), sa * 0.9);
        }
        text(d, tr("ch01.tokRate"), tx0, y + 58, { font: FONT.cjk(28, 600), color: css("graphite"), alpha: sa * prog(b, AT.tokens + 0.1, AT.tokens + 0.25) });
        text(d, tr("ch01.sum"), tx1, y - 34, { font: FONT.cjk(28, 600), color: css("signal"), align: "right", alpha: sa * prog(b, AT.tokens + 0.1, AT.tokens + 0.25) });
      } else {
        let u = tx0 + r() * 60;
        while (u < tx1 - 40) { const w = 20 + r() * 110; fillRect(d, u, y + 8, Math.min(w, tx1 - u), 12, css("pink"), 0.35 * sa); u += w + 30 + r() * 90; }
      }
    });
  }

  // 调度表须与 workers/collector/src/registry.ts#JOBS 的每分钟触发规则一致。
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
    const a = prog(b, 26.85, 27.05);
    if (a <= 0) return;
    figHead(x, 17350, 7, tr("ch01.f7"), tr("ch01.f7sub"), a, { rule: 720 });
    text(x, tr("ch01.noGate"), 17350, 214, { font: FONT.cjk(28, 600), color: ash, alpha: a * prog(b, 27.5, 27.7), maxW: 840 });
    const beatF = Math.max(0, (b - AT.dial) * 4);
    const m = b < AT.dial ? -1 : Math.min(MINUTES - 1, minuteAt(b));
    const tickP = b < AT.dial ? 0 : Math.exp(-((beatF % 1) * 60 / 108) / 0.12);
    const [cx, cy] = DC;
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.beginPath(); x.arc(cx, cy, DR, 0, TAU); x.fill(); x.strokeStyle = bone; x.lineWidth = 2.8; x.stroke();
    x.lineWidth = 1.2; x.globalAlpha = a * 0.5; x.beginPath(); x.arc(cx, cy, DR - 12, 0, TAU); x.stroke(); x.restore();
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * TAU - Math.PI / 2, big = i % 5 === 0, r0 = DR - (big ? 30 : 20);
      line(x, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * (DR - 12), cy + Math.sin(ang) * (DR - 12), big ? 2.4 : 1, bone, (big ? 0.85 : 0.35) * a);
    }
    if (m >= 0) {
      text(x, "cron", cx + 56, cy + DR + 34, { font: FONT.mono(28, 500), color: ash, alpha: a });
      text(x, `:${String(m).padStart(2, "0")}`, cx + 56, cy + DR + 80, { font: FONT.mono(40, 600), color: bone, alpha: a });
    }
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
    const pv = [cx, cy + DR + 10];
    const pang = b < AT.dial ? 0 : 0.26 * Math.cos(Math.PI * beatF);
    const bob = [pv[0] + Math.sin(pang) * 70, pv[1] + Math.cos(pang) * 70];
    line(x, pv[0], pv[1], bob[0], bob[1], 2.4, bone, a);
    x.save(); x.globalAlpha = a; x.fillStyle = css("ink2"); x.strokeStyle = bone; x.lineWidth = 2.2; x.beginPath(); x.arc(bob[0], bob[1], 16, 0, TAU); x.fill(); x.stroke(); x.restore();
    narPair(x, "ch01.n12a", "ch01.n12b", 17350, [27.3, 27.9], [27.9, 28.6], [27.25, 27.35, 29.62, 29.74], b);
    const ca = a * prog(b, 27.05, 27.13, E.out);
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

  const OUT = [PARK, [4700, 540]];
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
    const dd = keys(b, [[AT.launch, 0], [30.98, 1000, E.inExpo]]);
    const head = pathAt(OUT, dd);
    const trail = trailOn(OUT, dd, lerp(80, 520, prog(b, AT.launch, 30.8)), 18);
    spark(e, x, head, trail, { t: G.t, size: 1.1, lw: 2.4, color: css("signalD") });
    envelope(x, head[0], head[1], 44, css("signalD"), { lw: 2, fill: css("ink2"), alpha: 1 - prog(b, 30.5, 30.7) });
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
    id: "ch01", title: "ch.01", bars: 31,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); },
    render,
  });
})();
