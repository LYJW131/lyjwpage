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
    "ch01.settle": ["切应用默认先等 400 ms 落定", "App switches settle 400 ms by default"],
    "ch01.again": ["落定前又切：重新计时", "switched again: restart"],
    "ch01.n2c": ["前台应用的切换先防抖：", "App switches are debounced:"],
    "ch01.n2d": ["连切几次，只报最后停住的那个。", "a burst reports only the final app."],
    "ch01.f1a": ["窗口标题 → Jev", "Window title → Jev"],
    "ch01.wt": ["窗口标题（不上画面）", "window title (not shown)"],
    "ch01.judge": ["隐私判断", "privacy check"],
    "ch01.illus": ["概率条为示意", "bars are illustrative"],
    "ch01.pass": ["放行 → 进信封", "cleared → envelope"],
    "ch01.owner": ["拿不准 → 交给 lyjw", "unsure → lyjw"],
    "ch01.n3a": ["窗口标题先经 Jev 做隐私判断；", "Jev screens window titles first;"],
    "ch01.n3b": ["拿不准的交给 lyjw，放行的才进信封。", "unsure ones go to lyjw."],
    "ch01.f1b": ["应用图标 → R2", "App icon → R2"],
    "ch01.byContent": ["sha256(内容)", "sha256(content)"],
    "ch01.sameKey": ["同一内容，同一个键", "same bytes, same key"],
    "ch01.n4a": ["图片按内容哈希命名，直传 R2；", "Images go to R2, named by hash;"],
    "ch01.n4b": ["信封里只带对象键。", "the envelope carries only the key."],
    "ch01.f2": ["lyjwpage iOS App · HealthKit 唤醒", "lyjwpage iOS app · woken by HealthKit"],
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
    "ch01.n12b": ["每个任务按自己的节奏去取。", "each job keeps its own pace."],
    "ch01.f7a": ["没人上报的播放", "Playback no one reports"],
    "ch01.f7asub": ["别的设备上的 Apple Music：从最近播放推断", "Apple Music on other devices, inferred from recents"],
    "ch01.noRep": ["放的歌没人上报", "playback isn't reported"],
    "ch01.apple": ["Apple · 最近播放的歌", "Apple · recently played"],
    "ch01.active": ["列表一变：每 15 秒拉", "list changed: poll every 15 s"],
    "ch01.newTop": ["↑ 开播几秒就排到最前", "↑ tops the list seconds after it starts"],
    "ch01.infer": ["站点这边推断", "Inferred site-side"],
    "ch01.win": ["开播在这一格里", "started within this gap"],
    "ch01.shift": ["减去前一首的时长", "minus the previous song's length"],
    "ch01.cross": ["两格求交：开播 ± 误差", "overlap: start ± margin"],
    "ch01.chain": ["按时长接成一串", "chained by length"],
    "ch01.page": ["页面上", "On the page"],
    "ch01.likely": ["LIKELY PLAYING", "LIKELY PLAYING"],
    "ch01.elsewhere": ["Played elsewhere, estimated", "Played elsewhere, estimated"],
    "ch01.n13a": ["别的设备放 Apple Music，没人上报；", "No one reports songs elsewhere;"],
    "ch01.n13b": ["采集 Worker 去拉 Apple 最近播放。", "the collector polls Apple's recents."],
    "ch01.n14a": ["新歌开播几秒，就排到列表最前；", "A song tops the list seconds in;"],
    "ch01.n14b": ["按时长接成一串，推出起止和误差。", "lengths chain them: start ± margin."],
    "ch01.clawd": ["我跟着这一封走。", "I'll ride along with this one."],
    "ch01.m.head": ["其余来源", "Other sources"],
    "ch01.m.ip": ["iPhone", "iPhone"],
    "ch01.m.ipF": ["HealthKit 唤醒", "woken by HealthKit"],
    "ch01.m.hp": ["HomePod", "HomePod"],
    "ch01.m.hpF": ["钥匙只开 /homepod", "/homepod only"],
    "ch01.m.ps": ["PlayStation", "PlayStation"],
    "ch01.m.psF": ["先探醒，再问 Sony", "probe, then ask Sony"],
    "ch01.m.nas": ["NAS", "NAS"],
    "ch01.m.nasF": ["海报先于信封", "poster before the report"],
    "ch01.m.tyo": ["东京", "Tokyo"],
    "ch01.m.tyoF": ["同机各用各的钥匙", "one host, separate keys"],
    "ch01.m.cc": ["云端", "Cloud"],
    "ch01.m.ccF": ["自己发，核心算差", "it emits; the core diffs"],
    "ch01.m.use": ["用量", "Usage"],
    "ch01.m.useF": ["三处相加 · 5 分钟均", "three feeds · 5-min avg"],
    "ch01.m.col": ["采集", "Collector"],
    "ch01.m.colF": ["每分钟，并推断播放", "each minute; infers plays"],
    "ch01.nMa": ["其余来源一晃而过：", "The other sources flash by:"],
    "ch01.nMb": ["各报各的，钥匙不混用。", "each source keeps its own key."],
    "ch01.nMc": ["用量三处相加，站点合并；", "Usage is summed on the site;"],
    "ch01.nMd": ["没人报的歌，靠最近播放推。", "unreported songs use recents."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let plate, ink, emit, paper, top;
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
    dial: 27.0, back: 15.2, launch: 15.45,
  };

  const FX = { S0: 960, M1: 2880, M2: 4800, MONT: 6720, F2: 8640, F3: 10560, F4: 12480, F5: 14400, F6: 16320, CU: 18240, F7: 20160, F7A: 22080 };
  const STOPS = [["S0", 0, 1.75], ["M1", 2, 6.75], ["M2", 7, 10.75], ["MONT", 11, 14.6], ["M1", 15.2, 17]];
  const CAM = [[0, [FX.S0 - 24, 548, 1.03, 0]]];
  STOPS.forEach(([k, t0, t1], i) => {
    if (i > 0) CAM.push([t0, [FX[k], 540, 1, 0], E.io]);
    CAM.push([t1, [FX[k] + 14, 540, 1.014, 0], i === 0 ? E.out : E.lin]);
  });
  const PLATE_RECT = [-200, -80, 21320, 1160];
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
      if (open && open.k > 0 && open.c === c && open.r === r) continue;
      const px = rx + 10 + c * cw, py = ry + 10 + r * ch;
      box(x, px + 4, py + 4, cw - 8, ch - 8, a, { lw: 1.4 });
      line(x, px + cw / 2 - 12, py + ch / 2, px + cw / 2 + 12, py + ch / 2, 3, css("bone"), a * 0.8);
    }
    if (!open || open.k <= 0) return;
    // 拉开的抽屉画在最上层：朝镜头放大、略往下错，两角连回格口。只往下平移会被下一格盖住，像错了半格。
    const k = open.k, px = rx + 10 + open.c * cw, py = ry + 10 + open.r * ch, col = open.hot ? css("signalD") : css("bone");
    fillRect(x, px + 4, py + 4, cw - 8, ch - 8, css("ink"), a);
    const fw = (cw - 8) * (1 + 0.14 * k), fh = (ch - 8) * (1 + 0.14 * k), fx = px + cw / 2 - fw / 2, fy = py + ch / 2 - fh / 2 + 10 * k;
    line(x, px + 4, py + 4, fx, fy, 1.4, col, a); line(x, px + cw - 4, py + 4, fx + fw, fy, 1.4, col, a);
    box(x, fx, fy, fw, fh, a, { lw: 1.4, color: col });
    line(x, fx + fw / 2 - 12, fy + fh / 2, fx + fw / 2 + 12, fy + fh / 2, 3, css("bone"), a * 0.8);
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
    const half = 960 / cam.zoom + 60, x0 = Math.max(-120, cam.x - half), x1 = Math.min(21240, cam.x + half);
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
    text(x, "R2", CAB.x, CAB.y - 22, { font: FONT.mono(44, 600), color: bone, alpha: a });
    text(x, "immutable", CAB.x + CAB.w, CAB.y - 24, { font: FONT.mono(28, 500), color: ash, align: "right", alpha: a });
    if (hk > 0 && fall < 1) {
      text(x, tr("ch01.byContent"), HASH[0], HASH[1] - 50, { font: FONT.mono(28, 500), color: ash, alpha: a * hk * (1 - fall) });
      const hx = lerp(HASH[0], sx - 120, fall), hy = lerp(HASH[1], sy + 8, fall);
      x.save(); x.translate(hx, hy); x.scale(lerp(1, 0.55, fall), lerp(1, 0.55, fall));
      // 落进抽屉的路上要穿过「R2」那行表头：垫一块底色压住它，而不是字叠字。
      const pa = a * prog(fall, 0, 0.08) * (1 - prog(fall, 0.85, 1));
      if (pa > 0) { x.save(); x.font = FONT.mono(34, 600); const kw = x.measureText(KEY_SHORT).width; x.globalAlpha = pa; x.fillStyle = css("ink2"); roundRect(x, -14, -34, kw + 28, 48, 8); x.fill(); x.restore(); }
      text(x, KEY_SHORT, 0, 0, { font: FONT.mono(34, 600), color: bone, alpha: a * (1 - prog(fall, 0.85, 1)), reveal: hk, perChar: hk < 1 });
      x.restore();
    }
    const openK = keys(b, [[AT.hash, 0], [AT.hash + 0.12, 1, E.out], [AT.shut - 0.04, 1], [AT.shut + 0.02, 0, E.in]]);
    cabinet(x, CAB.x, CAB.y, CAB.w, CAB.h, CAB.cols, CAB.rows, a, { ...SLOT, k: openK, hot: true });
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

  const MONT_CARDS = [
    ["ch01.m.ip", "ch01.m.ipF", 11.15], ["ch01.m.hp", "ch01.m.hpF", 11.55],
    ["ch01.m.ps", "ch01.m.psF", 11.95], ["ch01.m.nas", "ch01.m.nasF", 12.35],
    ["ch01.m.tyo", "ch01.m.tyoF", 12.75], ["ch01.m.cc", "ch01.m.ccF", 13.15],
    ["ch01.m.use", "ch01.m.useF", 13.55], ["ch01.m.col", "ch01.m.colF", 13.95],
  ];
  function montage(x, b) {
    const a = prog(b, 10.88, 11.06);
    if (a <= 0) return;
    const bone = css("bone"), ash = css("ash");
    const x0 = FX.MONT - 900, y0 = 150;
    text(x, tr("ch01.m.head"), x0, y0 + 36, { font: FONT.cjk(36, 600), color: ash, alpha: a });
    MONT_CARDS.forEach(([title, fact, t], i) => {
      const col = i % 4, row = (i / 4) | 0;
      const rx = x0 + col * 450, ry = y0 + 70 + row * 300;
      const hot = win(b, t, t + 0.06, t + 0.38, t + 0.5);
      const dim = 0.22 + 0.78 * hot;
      x.save(); x.globalAlpha = a * dim; x.fillStyle = css("ink2"); x.strokeStyle = hot > 0.45 ? css("signalD") : bone; x.lineWidth = hot > 0.45 ? 2.6 : 1.4;
      roundRect(x, rx, ry, 420, 240, 10); x.fill(); x.stroke(); x.restore();
      text(x, tr(title), rx + 28, ry + 78, { font: FONT.cjk(40, 600), color: hot > 0.45 ? css("signalD") : bone, alpha: a * dim, texture: hot < 0.35 });
      text(x, tr(fact), rx + 28, ry + 140, { font: FONT.cjk(32, 600), color: hot > 0.45 ? bone : ash, alpha: a * dim, maxW: 364, texture: hot < 0.35 });
    });
    narPair(x, "ch01.nMa", "ch01.nMb", x0, [11.2, 11.55], [11.6, 12.05], [11.05, 11.15, 12.85, 13.0], b);
    narPair(x, "ch01.nMc", "ch01.nMd", x0, [13.1, 13.45], [13.5, 13.95], [13.0, 13.1, 14.45, 14.6], b);
  }

  const OUT = [PARK, [4700, 540]];
  function guide(x, b) {
    const gA = prog(b, AT.back + 0.02, AT.back + 0.16, E.out);
    if (gA <= 0) return;
    dashPath(x, [[PARK[0] + 44, 540], [3960, 540]], gA, 1.4, css("bone"), 0.45, [8, 8]);
    // 标在线下：Clawd 骑着火花沿线跑过去，标在线上会被它整只盖住。
    text(x, "→ ingest.homepage.lyjw.llc", 3790, 584, { font: FONT.mono(28, 500), color: css("ash"), align: "right", alpha: gA });
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
    const dd = rideD(b);
    const head = pathAt(OUT, dd);
    const trail = trailOn(OUT, dd, lerp(80, 520, prog(b, AT.launch, 16.8)), 18);
    spark(e, x, head, trail, { t: G.t, size: 1.1, lw: 2.4, color: css("signalD") });
    // 起跑这一帧接停靠时的大小和光晕，不然信封一帧缩一圈、光晕一帧没了。
    const shrink = prog(b, AT.launch, AT.launch + 0.12, E.out);
    envelope(x, head[0], head[1], lerp(60, 44, shrink), css("signalD"), { lw: lerp(2.2, 2, shrink), fill: css("ink2"), alpha: 1 - prog(b, CL.leap[0], CL.leap[1] + 0.04) });
    glow(e, head[0], head[1], 150, 0.6 * impact(b, AT.back, 0.25));
  }
  // 末端 1100 让 Clawd 在最后两帧前整只出右缘，屏幕上只剩拖尾贴着右边。
  const rideD = (b) => keys(b, [[AT.launch, 0], [16.98, 1100, E.inExpo]]);

  // 交给第 02 章：骑行时 Clawd 蹲着（pose default、crouch 1、不翻转），屏幕上 18 格宽 126 px，
  // 中心对着火花亮核，底边比亮核高 7 px；亮核在屏幕 y 540。第 02 章 0:0 照这个从左缘接（ch02.js 的 CL.qRide）。
  const CL = { drop: [15.2, 15.28], say: [15.29, 15.88], leap: [15.86, 15.97], stand: [3070, 539.3], qs: 7, lift: 7 };
  function clawdRide(tp, b, z, BAR) {
    if (b < CL.drop[0]) return;
    const q = CL.qs / z, [sx, sy] = CL.stand;
    const frameAt = (t0) => Math.floor(((b - t0) * BAR * 1000) / window.Clawd.FRAME_MS + 1e-6);
    const [hx, hy] = pathAt(OUT, rideD(b)), ride = hy - CL.lift / z;
    let fr, cx = sx, cy = sy;
    if (b < CL.drop[1]) {
      fr = { pose: "arms-up", offset: 0 };
      cy = lerp(sy - 660, sy, prog(b, CL.drop[0], CL.drop[1], E.in));
    } else if (b < CL.leap[0]) {
      fr = K.clawdSeq("land", b, CL.drop[1], BAR) || { pose: b < CL.say[0] + 0.2 ? "default" : "look-left", offset: 0 };
    } else if (b < CL.leap[1]) {
      const k = prog(b, CL.leap[0], CL.leap[1]), i = frameAt(CL.leap[0]);
      fr = i < 2 ? window.Clawd.SEQ.jump[i] : { pose: "arms-up", offset: 0 };
      cx = lerp(sx, hx, k);
      cy = lerp(sy, ride, k) - K.hop(b, CL.leap[0], CL.leap[1], 56);
    } else {
      const i = frameAt(CL.leap[1]);
      fr = i < 2 ? window.Clawd.SEQ.land[i] : { pose: "default", offset: 1 };
      cx = hx; cy = ride;
    }
    K.clawdFrame(tp, fr, cx, cy, q, { poofColor: css("ash") });
    const k = prog(b, CL.say[0], CL.say[0] + 0.06) * (1 - prog(b, CL.say[1] - 0.04, CL.say[1]));
    if (k > 0) K.bubble(tp, tr("ch01.clawd"), sx - 56 / z, sy - 12 * q - 10 / z, { px: 34 / z, k, reveal: prog(b, CL.say[0] + 0.01, CL.say[0] + 0.13) });
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
    const tp = top.begin(); top.cam(cam);

    const half = 960 / cam.zoom + 400;
    const seen = (k) => Math.abs(FX[k] - cam.x) < half + 960;
    datum(x, cam);
    if (seen("S0")) stationS0(x, b);
    if (seen("M1")) stationM1(x, e, d, b);
    if (seen("M2")) { stationM2Jev(x, e, b); stationM2Img(x, e, d, b); }
    if (seen("MONT")) montage(x, b);
    hero(x, e, b);
    clawdRide(tp, b, cam.zoom, f.BAR);

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 1.7 });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.5 });
    G.composite(paper.upload(), { mode: G.MODE.paper });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 6;
    f.post = {
      bloom: 0.7, threshold: 0.9, halation: 0.28, grain: 0.05, vignette: 0.42, ca: 0.4,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      flash: impact(b, AT.judged, 0.1) * 0.04 + impact(b, AT.merge, 0.1) * 0.04, flashCol: [1, 0.8, 0.6],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch01", title: "ch.01", bars: 17,
    init() { plate = G.pass(K.PLATE.ink); ink = G.layer("ink"); emit = G.layer("emit", 0.5); paper = G.layer("paper"); top = G.layer("top"); },
    render,
  });
})();
