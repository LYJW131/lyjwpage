// 第 01 章画成等距（30°）的漂浮小岛立体模型：平行投影、没有透视，几何按公式投到 2D 画布上；镜头只平移、缩放。
// 开头整座岛在转台上转回标准角度（ROT），之后都是标准等距。画面只从 AT 取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
(() => {
  const { E, prog, keys, clamp, lerp, text, measure, pathAt, trailOn, mulberry32, hash } = K;
  const N = 29;
  I18N.add({
    "ch01.title": ["野外观测站", "Field stations"],
    "ch01.n1a": ["上报器在数据源头主动推送；", "Reporters push from the source;"],
    "ch01.n1b": ["第三方接口由采集 Worker 定时拉取。", "a cron Worker polls external APIs."],
    "ch01.push": ["上报器 · 主动推送", "Reporters · push"],
    "ch01.pull": ["采集 Worker · 定时拉取", "Collector Worker · polls"],
    "ch01.f1": ["Mac Telemetry Hub · 菜单栏 App", "Mac Telemetry Hub · menu bar app"],
    "ch01.env": ["信封", "Envelope"],
    "ch01.unsent": ["没变的模块不寄", "unchanged modules stay home"],
    "ch01.empty": ["空信封 = 心跳", "empty envelope = heartbeat"],
    "ch01.n2a": ["Mac 只寄这一次变了的模块；", "The Mac sends only changed modules;"],
    "ch01.n2b": ["没变化时，每 90 秒寄一封空信封。", "idle: an empty envelope every 90 s."],
    "ch01.wt": ["窗口标题（不上画面）", "window title (not shown)"],
    "ch01.lists": ["应用名单", "App lists"],
    "ch01.never": ["从不读", "never read"],
    "ch01.trusted": ["不用问", "no need to ask"],
    "ch01.illus": ["概率条为示意", "bars are illustrative"],
    "ch01.pass": ["放行 → 进信封", "cleared → envelope"],
    "ch01.lock": ["私密 → 锁定", "private → locked"],
    "ch01.owner": ["拿不准 → 问 lyjw", "unsure → ask lyjw"],
    "ch01.n3a": ["窗口标题先过名单，再由 Jev 判断；", "Titles clear app lists, then Jev;"],
    "ch01.n3b": ["私密的锁住，拿不准的问 lyjw。", "private ones lock; unsure ask lyjw."],
    "ch01.byContent": ["sha256(内容)", "sha256(content)"],
    "ch01.sameKey": ["同一内容，同一个键", "same bytes, same key"],
    "ch01.onlyKey": ["信封里只有对象键", "the envelope holds just the key"],
    "ch01.icon": ["Mac 的应用图标", "the Mac's app icon"],
    "ch01.nas": ["emby-reporter · NAS 上的容器", "emby-reporter · a container on the NAS"],
    "ch01.poster": ["海报先传 R2", "poster to R2 first"],
    "ch01.watching": ["再报在看什么", "then what's on"],
    "ch01.n4a": ["图片按内容哈希命名，直传 R2；", "Images go to R2, named by hash;"],
    "ch01.n4b": ["信封里只带对象键。", "the envelope carries only the key."],
    "ch01.f2": ["lyjwpage iOS App · HealthKit 唤醒", "lyjwpage iOS app · woken by HealthKit"],
    "ch01.rings": ["活动圆环 · 按小时", "Activity rings · hourly"],
    "ch01.workouts": ["训练 · 一有新记录", "Workouts · at once"],
    "ch01.steps": ["五分钟步数桶", "5-min step buckets"],
    "ch01.n5a": ["iPhone 由 HealthKit 后台唤醒：", "HealthKit wakes the iPhone app:"],
    "ch01.n5b": ["圆环按小时报，训练一有新记录就报。", "rings hourly, workouts at once."],
    "ch01.hpWhat": ["HomePod 正在放什么", "what the HomePod is playing"],
    "ch01.psWhat": ["presence、游玩列表、奖杯", "presence, games played, trophies"],
    "ch01.psnLogin": ["PSN 登录态留在本机，只拿来问 Sony", "PSN login stays local, used only with Sony"],
    "ch01.n6a": ["HomePod 由 Home Assistant 代报，", "Home Assistant relays the HomePod;"],
    "ch01.n6b": ["PlayStation 由 n100 上的容器代报。", "an n100 container relays PSN."],
    "ch01.tokyo": ["东京 · 一台主机", "Tokyo · one host"],
    "ch01.srv": ["服务器状态 · 固定每 60 秒", "server status · every 60 s, fixed"],
    "ch01.agents": ["编码工具的限额 · Cursor 账号的用量", "coding-tool limits · Cursor usage"],
    "ch01.quest": ["Quest 在玩什么 · 读 Discord 在线状态", "Quest games · from Discord presence"],
    "ch01.n7a": ["同一台主机上的几个容器，", "Containers on the same host"],
    "ch01.n7b": ["各用各的钥匙，各报各的来源。", "each hold their own key and source."],
    "ch01.cc": ["Claude Code 云端 · 自己发 OTLP", "Claude Code in the cloud · emits OTLP"],
    "ch01.extra": ["独立入口，不是我们写的上报器", "own endpoint, not a reporter of ours"],
    "ch01.srcMac": ["Mac 本机", "the Mac itself"],
    "ch01.srcCursor": ["Cursor 账号 · 容器代报", "Cursor account · via a container"],
    "ch01.merge": ["站点这边合并", "merged site-side"],
    "ch01.cu": ["编码用量", "Coding usage"],
    "ch01.sum": ["三处相加", "all three summed"],
    "ch01.tokRate": ["token 处理量 · 5 分钟平均", "tokens processed · 5-min avg"],
    "ch01.n8a": ["编码用量：三处各报原始数，", "Coding usage: three raw feeds;"],
    "ch01.n8b": ["合计与去重都在站点这边算。", "totals and dedup happen site-side."],
    "ch01.f7": ["采集 Worker · cron 每分钟触发", "Collector Worker · cron every minute"],
    "ch01.noGate": ["不走上报入口：直接交给状态核心，或写 LAG", "Skips ingress: calls the state core, or writes LAG"],
    "ch01.chart": ["各任务的节奏 · 一格一分钟", "Each job's cadence · 1 cell = 1 min"],
    "ch01.n9a": ["cron 每分钟触发一次采集 Worker，", "A cron trigger fires every minute;"],
    "ch01.n9b": ["每个任务按自己的节奏去取。", "each job keeps its own pace."],
    "ch01.elsewhere1": ["别的设备上的 Apple Music", "Apple Music on another device"],
    "ch01.noRep": ["放的歌没人上报", "playback isn't reported"],
    "ch01.col": ["采集 Worker", "Collector Worker"],
    "ch01.apple": ["Apple · 最近播放的歌", "Apple · recently played"],
    "ch01.active": ["列表一变：每 15 秒拉", "list changed: poll every 15 s"],
    "ch01.newTop": ["↑ 开播几秒就排到最前", "↑ tops the list seconds after it starts"],
    "ch01.infer": ["站点这边推断", "Inferred site-side"],
    "ch01.win": ["开播在这一格里", "started within this gap"],
    "ch01.shift": ["减去前一首的时长", "minus the previous song's length"],
    "ch01.cross": ["两格求交：开播 ± 误差", "overlap: start ± margin"],
    "ch01.chain": ["按时长接成一串", "chained by length"],
    "ch01.page": ["页面上", "On the page"],
    "ch01.n10a": ["别的设备放 Apple Music，没人上报；", "No one reports songs elsewhere;"],
    "ch01.n10b": ["采集 Worker 去拉 Apple 最近播放。", "the collector polls Apple's recents."],
    "ch01.n11a": ["新歌开播几秒，就排到列表最前；", "A song tops the list seconds in;"],
    "ch01.n11b": ["按时长接成一串，推出起止和误差。", "lengths chain them: start ± margin."],
    "ch01.clawd": ["我跟着这一封走。", "I'll ride along with this one."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2, C30 = Math.cos(Math.PI / 6);
  let bg, emit, top;
  let BARs = (60 / 108) * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp((-((b - at) * BARs) / hl) * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));

  const LAT = '"Fredoka ch01"', ZH = '"ZCOOL KuaiLe ch01"', JP = '"Zen Maru Gothic ch01"';
  const SANS = (px, w = 600) => `${w} ${px.toFixed(2)}px ${LAT}, ${ZH}, ${JP}, sans-serif`;
  const SONG = (px, w = 700) => `${w} ${px.toFixed(2)}px ${LAT}, ${JP}, sans-serif`;
  const MONO = (px, w = 500) => `${w} ${px.toFixed(2)}px "Geist Mono", ui-monospace, monospace`;

  const P = {
    sky0: "#C6CFF2", sky1: "#F0D3E3", sky2: "#FCE7D6",
    grass: "#CDEAD3", grid: "#B9DEC4", lip: "#A6D6B5", sand: "#F2D3B3", rock: "#C8B8E6",
    cream: "#FFF5E8", butter: "#F9E0A2", coral: "#F3A595", sky: "#BAD6F2", lilac: "#D6C6F2", mint: "#A6DAC3", rose: "#F6C3D3",
    wood: "#EFD7B4", steel: "#CBCFE2", pink: "#F7B9CF",
    ink: "#44315A", ink2: "#7D6A92", plate: "#FFF9F2", shade: "#674C89", screen: "#4A3C64", screenL: "#6E5D8C", envTop: "#FCE3D3",
  };
  let SIG = "#D97757", SIGD = "#E48E6E";
  const parse = (c) => (c[0] === "#" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/\d+/g).slice(0, 3).map(Number));
  const TONES = new Map();
  function tone(c, k) {
    const key = c + "|" + k.toFixed(3);
    let v = TONES.get(key);
    if (!v) {
      const a = parse(c), s = parse(P.shade);
      v = `rgb(${a.map((u, i) => Math.round(u + (s[i] - u) * k)).join(",")})`;
      TONES.set(key, v);
    }
    return v;
  }
  const rgba = (c, a) => { const [r, g, bb] = parse(c); return `rgba(${r},${g},${bb},${a})`; };

  // 时间：小节:拍写成小节数（3:2 写 3.5）；music/ch01.js 的时刻抄这张表和 STOP，改了两边一起改
  const AT = {
    title: 0.08,
    flip: 3.0, card: 3.12, lit: 3.5, post: 3.55, park: 4.0, breath: 4.3,
    wt: 5.3, list: 5.62, jev: 5.85, judged: 6.5, cleared: 6.75, lock: 6.875, owner: 7.0,
    icon: 8.05, hash: 8.3, drop: 8.5, shut: 8.75, poster: 9.05, posterIn: 9.35, emby: 9.75,
    wake: 11.0, outs: [11.25, 11.5, 11.75], send: 12.25,
    homepod: 13.35, haKey: [13.55, 13.85], psn: [14.0, 14.3], psKey: [14.35, 14.65],
    boxes: [16.0, 16.25, 16.5],
    raw: [18.5, 18.625, 18.75], merge: 19.0, pulse: 19.1,
    dial: 21.0,
    back: N - 1, launch: N - 0.75,
  };

  // ---------- 等距投影 ----------
  let ROT = 0, SEAM = 1;
  const RC = [900, 650];
  function rot(x, y) {
    if (!ROT) return [x, y];
    const c = Math.cos(ROT), s = Math.sin(ROT), dx = x - RC[0], dy = y - RC[1];
    return [RC[0] + dx * c - dy * s, RC[1] + dx * s + dy * c];
  }
  const rotN = (nx, ny) => (ROT ? [nx * Math.cos(ROT) - ny * Math.sin(ROT), nx * Math.sin(ROT) + ny * Math.cos(ROT)] : [nx, ny]);
  const pj = (X, Y, z) => [(X - Y) * C30, (X + Y) * 0.5 - z];
  const wp = (x, y, z = 0) => { const [X, Y] = rot(x, y); return pj(X, Y, z); };
  const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  function path(x, pts) { x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath(); }
  // 相邻面分开填色时边上会透出一道底色缝：同色描一圈盖住
  function poly(x, pts, fill, a = 1, seam = true) {
    if (a <= 0) return;
    x.globalAlpha = a; x.fillStyle = fill; path(x, pts); x.fill();
    if (seam && a >= 1) { x.strokeStyle = fill; x.lineWidth = SEAM; x.lineJoin = "round"; x.stroke(); }
    x.globalAlpha = 1;
  }
  // 两档明暗：朝右（+X）的面最暗，朝左（+Y）的面次之，顶面原色；转台转动时按法线方向在两档之间过渡
  const K_R = 0.3, K_L = 0.13;
  const sideK = (nx, ny) => lerp(K_R, K_L, clamp(Math.atan2(ny, nx) / (Math.PI / 2)));
  function prism(x, pts, z0, z1, col, o = {}) {
    const a = o.a ?? 1, c = pts.map(([u, v]) => rot(u, v));
    if (z1 > z0) for (let i = 0; i < c.length; i++) {
      const p = c[i], q = c[(i + 1) % c.length], nx = q[1] - p[1], ny = p[0] - q[0];
      if (nx + ny <= 1e-6) continue;
      poly(x, [pj(p[0], p[1], z0), pj(q[0], q[1], z0), pj(q[0], q[1], z1), pj(p[0], p[1], z1)], tone(o.side || col, sideK(nx, ny) + (o.dk || 0)), a);
    }
    if (!o.noTop) poly(x, c.map(([u, v]) => pj(u, v, z1)), tone(o.top || col, o.dk || 0), a);
  }
  const rect = (X0, Y0, w, d) => [[X0, Y0], [X0 + w, Y0], [X0 + w, Y0 + d], [X0, Y0 + d]];
  const box = (x, X0, Y0, Z0, w, d, h, col, o) => prism(x, rect(X0, Y0, w, d), Z0, Z0 + h, col, o);
  function beam(x, a, b, hw, z0, z1, col, o) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, mx = dy * hw, my = -dx * hw;
    prism(x, [[a[0] + mx, a[1] + my], [b[0] + mx, b[1] + my], [b[0] - mx, b[1] - my], [a[0] - mx, a[1] - my]], z0, z1, col, o);
  }
  function solid(x, F, col, a = 1) {
    for (const [pts, [nx, ny, nz]] of F) {
      const [rx, ry] = rotN(nx, ny), len = Math.hypot(rx, ry, nz);
      if (rx + ry + nz <= 1e-6) continue;
      const kz = nz / len;
      poly(x, pts.map(([X, Y, Z]) => wp(X, Y, Z)), tone(col, kz > 0.98 ? 0 : (1 - Math.max(0, kz) * 0.6) * sideK(rx, ry)), a);
    }
  }
  function pyramid(x, X0, Y0, Z0, w, d, h, col, a = 1) {
    const ap = [X0 + w / 2, Y0 + d / 2, Z0 + h];
    solid(x, [
      [[[X0, Y0, Z0], [X0 + w, Y0, Z0], ap], [0, -h, d / 2]],
      [[[X0 + w, Y0, Z0], [X0 + w, Y0 + d, Z0], ap], [h, 0, w / 2]],
      [[[X0 + w, Y0 + d, Z0], [X0, Y0 + d, Z0], ap], [0, h, d / 2]],
      [[[X0, Y0 + d, Z0], [X0, Y0, Z0], ap], [-h, 0, w / 2]],
    ], col, a);
  }
  // 屋脊沿 X 的双坡顶
  function gable(x, X0, Y0, Z0, w, d, h, col, a = 1) {
    const ym = Y0 + d / 2;
    solid(x, [
      [[[X0, Y0, Z0], [X0 + w, Y0, Z0], [X0 + w, ym, Z0 + h], [X0, ym, Z0 + h]], [0, -h, d / 2]],
      [[[X0, Y0 + d, Z0], [X0 + w, Y0 + d, Z0], [X0 + w, ym, Z0 + h], [X0, ym, Z0 + h]], [0, h, d / 2]],
      [[[X0 + w, Y0, Z0], [X0 + w, Y0 + d, Z0], [X0 + w, ym, Z0 + h]], [1, 0, 0]],
      [[[X0, Y0, Z0], [X0, Y0 + d, Z0], [X0, ym, Z0 + h]], [-1, 0, 0]],
    ], col, a);
  }
  const CRX = Math.SQRT2 * C30, CRY = Math.SQRT2 * 0.5;
  function cyl(x, X, Y, Z, r, h, col, o = {}) {
    const a = o.a ?? 1, [cx, cy] = wp(X, Y, Z), rx = r * CRX, ry = r * CRY;
    if (a <= 0) return;
    if (h > 0) {
      x.save(); x.globalAlpha = a;
      x.beginPath(); x.moveTo(cx + rx, cy - h); x.lineTo(cx + rx, cy); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
      x.lineTo(cx - rx, cy - h); x.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 0, true); x.closePath(); x.clip();
      x.fillStyle = tone(o.side || col, K_L); x.fillRect(cx - rx - 2, cy - h - ry - 2, rx + 2.5, h + 2 * ry + 4);
      x.fillStyle = tone(o.side || col, K_R); x.fillRect(cx, cy - h - ry - 2, rx + 2, h + 2 * ry + 4);
      x.restore();
    }
    x.globalAlpha = a; x.fillStyle = tone(o.top || col, 0); x.beginPath(); x.ellipse(cx, cy - h, rx, ry, 0, 0, TAU); x.fill(); x.globalAlpha = 1;
  }
  function ring(x, X, Y, Z, r, color, lw, a) {
    if (a <= 0) return;
    const [cx, cy] = wp(X, Y, Z);
    x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = lw; x.beginPath(); x.ellipse(cx, cy, r * CRX, r * CRY, 0, 0, TAU); x.stroke(); x.globalAlpha = 1;
  }
  // 面上的贴花：+X 面（u 沿 +Y）、+Y 面（u 沿 +X）、顶面（u 沿 +X、v 沿 +Y）
  const onX = (X, Y0, Z0) => (u, v) => wp(X, Y0 + u, Z0 + v);
  const onY = (X0, Y, Z0) => (u, v) => wp(X0 + u, Y, Z0 + v);
  const onT = (X0, Y0, Z) => (u, v) => wp(X0 + u, Y0 + v, Z);
  const quad = (x, F, u0, v0, u1, v1, fill, a = 1) => poly(x, [F(u0, v0), F(u1, v0), F(u1, v1), F(u0, v1)], fill, a, false);
  function fstroke(x, F, uv, color, lw, a = 1, close = false) {
    if (a <= 0) return;
    x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); uv.forEach(([u, v], i) => { const [px, py] = F(u, v); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    if (close) x.closePath();
    x.stroke(); x.globalAlpha = 1;
  }
  const fcirc = (F, cu, cv, r, n = 30) => Array.from({ length: n }, (_, i) => F(cu + r * Math.cos((i / n) * TAU), cv + r * Math.sin((i / n) * TAU)));

  const SH = [0.9, -0.36];
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // 长投影：光从左后方来，所有影子合成一条路径一次填色，重叠处不会叠深；裁在岛面以内
  function shadows(x, casters, clip, Z = 0) {
    x.save(); path(x, clip); x.clip();
    x.beginPath();
    for (const [X0, Y0, w, d, h] of casters) {
      const L = h * 1.1, pts = [];
      for (const [u, v] of rect(X0, Y0, w, d).map(([p, q]) => rot(p, q))) { pts.push(pj(u, v, Z)); pts.push(pj(u + SH[0] * L, v + SH[1] * L, Z)); }
      hull(pts).forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v)));
      x.closePath();
    }
    x.fillStyle = rgba(P.shade, 0.14); x.fill();
    x.restore();
  }
  let Q = [];
  const put = (X, Y, fn, bias = 0) => { const [u, v] = rot(X, Y); Q.push({ d: u + v + bias, fn }); };
  function flush(x) { Q.sort((p, q) => p.d - q.d); for (const it of Q) it.fn(x); Q = []; }

  // ---------- 字与牌子 ----------
  const rr = K.roundRect;
  function plate(x, rx, ry, w, h, s, a, o = {}) {
    if (a <= 0) return;
    x.globalAlpha = a * 0.2; x.fillStyle = P.shade; rr(x, rx + 5 * s, ry + 6 * s, w, h, 14 * s); x.fill();
    x.globalAlpha = a; x.fillStyle = o.fill || P.plate; rr(x, rx, ry, w, h, 14 * s); x.fill();
    if (o.line) { x.strokeStyle = o.line; x.lineWidth = (o.lw ?? 3) * s; x.stroke(); }
    x.globalAlpha = 1;
  }
  // 一行字垫一块牌子；(px, py) 是字的基线起点（世界坐标），o.px 是屏幕字号，s = 1 / 机位缩放
  function tag(x, str, px, py, s, a, o = {}) {
    if (a <= 0) return 0;
    const fs = (o.px ?? 30) * s, f = (o.font || SANS)(fs, o.w ?? 600);
    const tw = Math.min(measure(x, str, f), o.maxW ?? 1e9), pad = 15 * s;
    const x0 = o.align === "center" ? px - tw / 2 : o.align === "right" ? px - tw : px;
    plate(x, x0 - pad, py - fs * 0.95 - pad * 0.5, tw + pad * 2, fs * 1.28 + pad, s, a, o);
    text(x, str, px, py, { font: f, color: o.color || P.ink, align: o.align, alpha: a, maxW: o.maxW });
    return tw;
  }
  function lead(x, pts, s, a, color = P.ink2) {
    if (a <= 0) return;
    x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = 2.2 * s; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke();
    x.fillStyle = color; x.beginPath(); x.arc(pts[0][0], pts[0][1], 5 * s, 0, TAU); x.fill(); x.globalAlpha = 1;
  }
  function dash(x, pts, color, lw, a, d = [10, 9], off = 0) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.strokeStyle = color; x.lineWidth = lw; x.lineCap = "round"; x.setLineDash(d); x.lineDashOffset = off;
    x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); x.restore();
  }
  function nar(x, ka, kb, st, t0, t1, b, at = [110, 930]) {
    const a = win(b, t0, t0 + 0.12, t1 - 0.14, t1);
    if (a <= 0) return;
    const c = st.c, s = 1 / c[2], px = c[0] + (at[0] - 960) * s, y1 = c[1] + (at[1] - 540) * s, y2 = y1 + 80 * s;
    const f = SANS(60 * s, 600), maxW = 1120 * s;
    const w = Math.min(maxW, Math.max(measure(x, tr(ka), f), measure(x, tr(kb), f)));
    plate(x, px - 36 * s, y1 - 78 * s, w + 72 * s, 196 * s, s, a);
    text(x, tr(ka), px, y1, { font: f, color: P.ink, reveal: prog(b, t0 + 0.05, t0 + 0.6), dim: 0.16, perChar: true, alpha: a, maxW, narration: true });
    text(x, tr(kb), px, y2, { font: f, color: P.ink, reveal: prog(b, t0 + 0.6, t0 + 1.15), dim: 0.16, perChar: true, alpha: a, maxW, narration: true });
  }
  const squash = (k) => (k > 0 && k < 1 ? Math.max(0.02, Math.abs(Math.cos(k * Math.PI))) : 1);
  function withSquash(x, cy, s, draw) { x.save(); x.translate(0, cy); x.scale(1, s); x.translate(0, -cy); draw(); x.restore(); }
  function glow(e, cx, cy, r, a) {
    if (a <= 0.003) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,190,140,${0.85 * a})`); g.addColorStop(0.45, `rgba(230,120,80,${0.28 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill();
  }

  // ---------- 镜头 ----------
  // 每个机位 [名字, 到位, 起甩, 镜头 [x, y, 缩放]]；停住时慢推 1.5%，标注只在本机位到位后亮、起甩前收
  const PARK3 = [560, 990, 53];
  const PARK = wp(...PARK3);
  const STOP = {};
  [["S0", 0, 2.2, [600, 760, 0.46]],
    ["MAC", 2.5, 4.95, [-470, 610, 1.4]],
    ["GATE", 5.25, 7.7, [-250, 930, 1.4]],
    ["IMG", 8.0, 10.45, [330, 1130, 1.4]],
    ["PHONE", 10.75, 12.95, [1003, 1054, 1.4]],
    ["HOME", 13.25, 15.45, [717, 793, 1.2]],
    ["TOKYO", 15.75, 17.95, [2160, 640, 1.4]],
    ["CODE", 18.25, 20.7, [630, 461, 0.9]],
    ["CLOCK", 21.0, 23.7, [470, 40, 1.15]],
    ["INFER", 24.0, 27.7, [-363, -800, 1]],
  ].forEach(([k, t0, t1, c]) => (STOP[k] = { k, t0, t1, c }));
  const CAM = [];
  Object.values(STOP).forEach((st, i) => {
    const [cx, cy, z] = st.c;
    CAM.push(i ? [st.t0, [cx, cy, z, 0], E.io] : [st.t0, [cx, cy, z, 0]]);
    CAM.push([st.t1, [cx + 10 / z, cy, z * 1.015, 0], i ? E.lin : E.out]);
  });
  // 结尾机位：亮核正在屏幕 y 540（交给第 02 章的高度），镜头一小节里从停靠点左 10 推到右 4、缩放 1 → 1.014
  CAM.push([AT.back, [PARK[0] - 10, PARK[1], 1, 0], E.io], [N, [PARK[0] + 4, PARK[1], 1.014, 0], E.lin]);
  const live = (st, b, d0 = 0.1, d1 = 0.12) => win(b, st.t0, st.t0 + d0, st.t1 - d1, st.t1);

  // ---------- 天空与岛 ----------
  function sky(x) {
    const g = x.createLinearGradient(0, 0, 0, G.H);
    g.addColorStop(0, P.sky0); g.addColorStop(0.58, P.sky1); g.addColorStop(1, P.sky2);
    x.fillStyle = g; x.fillRect(0, 0, G.W, G.H);
  }
  // 远处几座小岛按镜头的四分之一挪动，给大图一点纵深；不画云
  const FAR = [[-2600, -900, 0.55], [3300, -300, 0.4], [-1900, 1900, 0.5], [3900, 1500, 0.35], [600, -1500, 0.3]];
  function farIsles(x, cam) {
    for (const [fx, fy, s] of FAR) {
      x.save();
      x.translate(G.W / 2 + (fx - cam.x * 0.25) * cam.zoom * 0.5, G.H / 2 + (fy - cam.y * 0.25) * cam.zoom * 0.5);
      x.scale(cam.zoom * s, cam.zoom * s); x.globalAlpha = 0.55;
      const save = ROT; ROT = 0;
      for (const [ins, z0, z1] of [[60, -150, -60], [20, -60, -22]]) box(x, ins, ins, z0, 260 - 2 * ins, 200 - 2 * ins, z1 - z0, P.rock);
      box(x, 0, 0, -22, 260, 200, 22, P.lip, { top: P.grass });
      ROT = save; x.restore();
    }
    x.globalAlpha = 1;
  }
  function island(x, I) {
    const { x0, y0, w, d, z = 0, th = 56, steps } = I;
    for (let i = steps.length - 1; i >= 0; i--) {
      const [ins, h0, h1] = steps[i];
      box(x, x0 + ins, y0 + ins, z - h1, w - 2 * ins, d - 2 * ins, h1 - h0, P.rock);
    }
    box(x, x0, y0, z - th, w, d, th - 12, P.sand, { noTop: true });
    box(x, x0, y0, z - 12, w, d, 12, P.lip, { top: P.grass });
  }
  const topPoly = (I) => rect(I.x0, I.y0, I.w, I.d).map(([u, v]) => wp(u, v, I.z || 0));
  function grid(x, I, step = 100) {
    const z = I.z || 0;
    x.globalAlpha = 0.55; x.strokeStyle = P.grid; x.lineWidth = 1.6; x.beginPath();
    for (let u = I.x0 + step; u < I.x0 + I.w - 1; u += step) { const [a1, a2] = wp(u, I.y0, z), [b1, b2] = wp(u, I.y0 + I.d, z); x.moveTo(a1, a2); x.lineTo(b1, b2); }
    for (let v = I.y0 + step; v < I.y0 + I.d - 1; v += step) { const [a1, a2] = wp(I.x0, v, z), [b1, b2] = wp(I.x0 + I.w, v, z); x.moveTo(a1, a2); x.lineTo(b1, b2); }
    x.stroke(); x.globalAlpha = 1;
  }
  const MAIN = { x0: 0, y0: 0, w: 1800, d: 1300, steps: [[90, 56, 150], [260, 150, 250], [470, 250, 330], [640, 330, 390]] };
  const TOKYO = { x0: 2080, y0: -470, w: 340, d: 320, z: 140, th: 40, steps: [[40, 40, 110], [110, 110, 170]] };
  const ELSE = { x0: -1420, y0: -260, w: 260, d: 280, z: 120, th: 36, steps: [[36, 36, 100], [96, 100, 150]] };
  const CLOUD = { x0: 840, y0: 60, w: 200, d: 170, z: 440, th: 26, steps: [[40, 26, 70]] };

  function tree(x, X, Y, s = 1, leaf = P.mint) {
    box(x, X - 5 * s, Y - 5 * s, 0, 10 * s, 10 * s, 26 * s, P.wood);
    box(x, X - 20 * s, Y - 20 * s, 26 * s, 40 * s, 40 * s, 34 * s, leaf);
    box(x, X - 12 * s, Y - 12 * s, 60 * s, 24 * s, 24 * s, 18 * s, leaf);
  }
  // 小信封：一只纸盒，顶面画封舌
  function envBox(x, X, Y, Z, s, o = {}) {
    const a = o.a ?? 1;
    if (a <= 0) return;
    const w = 40 * s, d = 28 * s, h = 7 * s;
    if (o.ghost) {
      const F = onT(X - w / 2, Y - d / 2, Z + h);
      fstroke(x, F, [[0, 0], [w, 0], [w, d], [0, d]], P.ink2, 2.4 * s * 0.6, a, true);
      fstroke(x, F, [[0, 0], [w / 2, d * 0.55], [w, 0]], P.ink2, 2.4 * s * 0.6, a);
      return;
    }
    box(x, X - w / 2, Y - d / 2, Z, w, d, h, o.side || SIG, { top: o.top || P.envTop, a });
    fstroke(x, onT(X - w / 2, Y - d / 2, Z + h), [[0, 0], [w / 2, d * 0.58], [w, 0]], o.flap || SIG, 1.6 * s, a);
  }
  // 窗口标题：一块小牌，上面几道遮住的字
  function titleTile(x, X, Y, Z, a = 1) {
    box(x, X - 22, Y - 15, Z, 44, 30, 6, P.cream, { a });
    const F = onT(X - 22, Y - 15, Z + 6);
    for (const [v, u1] of [[7, 36], [15, 28], [23, 33]]) fstroke(x, F, [[6, v], [u1, v]], P.ink2, 3.2, a * 0.8);
  }

  // ---------- Mac ----------
  const ROOM = { x0: 130, y0: 870, w: 340, d: 340, wall: 170 };
  // 左墙内面上的粉色画框 [u0, v0, u1, v1]（u 沿 +Y、v 往上，从地板面量起）
  const POSTER = [140, 84, 222, 148];
  const posterFace = () => onX(ROOM.x0 + 14, ROOM.y0, 12);
  const LAP = { x: 238, y: 905, z: 70 };
  const HUB3 = [LAP.x + 96, LAP.y, LAP.z + 66];
  const OLD = "夜に駆ける", NEW = "アイドル", ARTIST = "YOASOBI";
  const MODS = ["desktop", "appleMusic", "chargingDevices", "…"];
  function macRoom(x, b) {
    const R = ROOM;
    box(x, R.x0, R.y0, 0, R.w, R.d, 12, P.wood);
    quad(x, onT(R.x0, R.y0, 12), 150, 170, 300, 300, tone(P.rose, 0.05));
    box(x, R.x0, R.y0, 12, R.w, 14, R.wall, P.cream);
    box(x, R.x0, R.y0, 12, 14, R.d, R.wall, P.cream);
    const W = onY(R.x0, R.y0 + 14, 12);
    quad(x, W, 190, 72, 312, 150, P.sky);
    fstroke(x, W, [[251, 72], [251, 150]], P.cream, 4); fstroke(x, W, [[190, 111], [312, 111]], P.cream, 4);
    const L = posterFace(), [pu0, pv0, pu1, pv1] = POSTER;
    quad(x, L, pu0, pv0, pu1, pv1, P.pink); quad(x, L, pu0 + 12, pv0 + 12, pu1 - 12, pv1 - 12, tone(P.pink, 0.18));
    // 桌子与笔记本
    box(x, 180, 885, 12, 12, 12, 50, P.sky); box(x, 396, 885, 12, 12, 12, 50, P.sky);
    box(x, 330, 885, 12, 74, 92, 50, P.sky);
    box(x, 172, 880, 62, 248, 108, 8, P.sky);
    box(x, LAP.x, LAP.y, LAP.z, 108, 58, 5, P.steel);
    box(x, LAP.x, LAP.y - 4, LAP.z + 5, 108, 5, 72, P.steel);
    const S = onY(LAP.x, LAP.y + 1, LAP.z + 5);
    const lit = 0.25 * impact(b, AT.flip, 0.3);
    quad(x, S, 5, 5, 103, 67, tone(P.screen, -lit));
    quad(x, S, 5, 59, 103, 67, P.screenL);
    poly(x, fcirc(S, 96, 63, 2.6, 12), SIG);
    quad(x, S, 14, 16, 44, 50, P.coral); quad(x, S, 52, 40, 92, 44, P.screenL); quad(x, S, 52, 30, 80, 34, P.screenL);
    const k = prog(b, AT.flip - 0.05, AT.flip + 0.05);
    if (k > 0 && k < 1) quad(x, S, 14, 16, 44, 50, rgba(P.cream, 0.6 * Math.sin(k * Math.PI)));
    cyl(x, 392, 905, 70, 9, 4, P.butter); box(x, 390, 903, 74, 4, 4, 46, P.butter); box(x, 378, 900, 112, 22, 16, 10, P.butter);
    box(x, 268, 1010, 12, 8, 8, 30, P.coral); box(x, 250, 995, 42, 64, 54, 7, P.coral); box(x, 250, 1045, 49, 64, 6, 52, P.coral);
    cyl(x, 170, 1170, 12, 15, 26, P.coral);
    box(x, 160, 1160, 38, 20, 20, 22, P.mint); box(x, 150, 1168, 46, 14, 14, 16, P.mint); box(x, 174, 1150, 50, 12, 12, 20, P.mint);
  }
  const RAIL = [[500, 1050], [1100, 450]];
  function rail(x) {
    for (let i = 0; i <= 4; i++) { const [px, py] = [lerp(RAIL[0][0], RAIL[1][0], i / 4), lerp(RAIL[0][1], RAIL[1][1], i / 4)]; box(x, px - 6, py - 6, 0, 12, 12, 38, P.lilac); }
    beam(x, RAIL[0], RAIL[1], 9, 38, 46, P.lilac, { top: tone(P.lilac, -0.05) });
  }
  const songCard = (b) => ({ title: b < AT.flip ? OLD : NEW, k: prog(b, AT.flip - 0.05, AT.flip + 0.05) });
  function macLabels(x, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const [sx, sy] = wp(LAP.x + 54, LAP.y, LAP.z + 80);
    const cw = 420 * s, ch = 132 * s, cx0 = sx - cw / 2 - 40 * s, cy0 = sy - ch - 70 * s;
    lead(x, [[sx, sy - 6 * s], [sx, cy0 + ch]], s, a);
    plate(x, cx0, cy0, cw, ch, s, a);
    text(x, "Apple Music", cx0 + 26 * s, cy0 + 44 * s, { font: MONO(28 * s), color: P.ink2, alpha: a });
    text(x, ARTIST, cx0 + cw - 24 * s, cy0 + 44 * s, { font: SANS(28 * s, 500), color: P.ink2, align: "right", alpha: a });
    const { title, k } = songCard(b);
    withSquash(x, cy0 + 94 * s, squash(k), () => {
      text(x, title, cx0 + 26 * s, cy0 + 108 * s, { font: SONG(44 * s), color: b >= AT.flip ? SIG : P.ink, alpha: a });
    });
    const [hx, hy] = wp(ROOM.x0, ROOM.y0 + ROOM.d, 12);
    tag(x, tr("ch01.f1"), hx - 40 * s, hy + 120 * s, s, a * prog(b, st.t0 + 0.05, st.t0 + 0.2), { px: 30 });
    // 信封详图
    const ca = a * prog(b, AT.card, AT.card + 0.1, E.out);
    const X0 = st.c[0] + (1060 - 960) * s, Y0 = st.c[1] + (150 - 540) * s, W = 810 * s, H = 560 * s;
    if (ca > 0) {
      plate(x, X0, Y0, W, H, s, ca);
      text(x, tr("ch01.env"), X0 + 34 * s, Y0 + 58 * s, { font: SANS(38 * s, 600), color: P.ink, alpha: ca });
      text(x, "POST /api/ingest/mac", X0 + W - 30 * s, Y0 + 56 * s, { font: MONO(28 * s), color: P.ink2, align: "right", alpha: ca });
      const L = ["{", '  "version": 4,', '  "presence": "online",', '  "heartbeatAt": 1790640000000,', '  "activeModules": [ … ],', '  "modules": {'];
      L.forEach((str, i) => text(x, str, X0 + 34 * s, Y0 + (112 + i * 44) * s, { font: MONO(28 * s), color: P.ink, alpha: ca, reveal: prog(b, AT.card + i * 0.04, AT.card + 0.05 + i * 0.04) }));
      let cx = X0 + 64 * s;
      const cy = Y0 + 398 * s, lk = prog(b, AT.lit, AT.lit + 0.06);
      MODS.forEach((m, i) => {
        const f = MONO(28 * s), w = measure(x, m, f) + 30 * s, hot = i === 1 && lk > 0;
        x.save(); x.globalAlpha = ca * prog(b, AT.card + 0.26 + i * 0.03, AT.card + 0.3 + i * 0.03);
        rr(x, cx, cy - 34 * s, w, 50 * s, 12 * s);
        if (hot) { x.fillStyle = rgba(SIG, 0.18 + 0.1 * impact(b, AT.lit, 0.3)); x.fill(); x.strokeStyle = SIG; x.lineWidth = 3 * s; x.stroke(); }
        else { x.setLineDash([7 * s, 6 * s]); x.strokeStyle = P.ink2; x.lineWidth = 2.2 * s; x.stroke(); }
        x.restore();
        text(x, m, cx + 15 * s, cy, { font: f, color: hot ? SIG : P.ink2, alpha: ca * prog(b, AT.card + 0.26 + i * 0.03, AT.card + 0.3 + i * 0.03) });
        cx += w + 14 * s;
      });
      text(x, "  }", X0 + 34 * s, Y0 + 462 * s, { font: MONO(28 * s), color: P.ink, alpha: ca * prog(b, AT.card + 0.38, AT.card + 0.42) });
      text(x, "}", X0 + 34 * s, Y0 + 506 * s, { font: MONO(28 * s), color: P.ink, alpha: ca * prog(b, AT.card + 0.4, AT.card + 0.44) });
      tag(x, tr("ch01.unsent"), X0 + W - 30 * s, Y0 + H + 62 * s, s, ca * prog(b, AT.lit + 0.06, AT.lit + 0.16), { px: 30, align: "right", color: P.ink2 });
    }
    // 空信封 = 心跳：「90 s」贴在虚线信封左边，牌子上沿离 Apple Music 卡片的影子留 16 px。
    // 说明那行的英文放不进墙上画框和信封之间，挪到卡片左边（牌子右沿离卡片 16 px），牌子连影子的下沿高过画框上沿 12 px。
    const ba = a * win(b, AT.breath, AT.breath + 0.06, st.t1 - 0.2, st.t1 - 0.1);
    if (ba > 0) {
      const [gx, gy] = wp(LAP.x + 54, LAP.y + 30, 196), cardB = cy0 + ch;
      const frameTop = posterFace()(POSTER[0], POSTER[3])[1];
      tag(x, "90 s", gx - 76 * s, Math.max(gy + 4 * s, cardB + (6 + 16 + 36) * s), s, ba, { px: 30, font: MONO, color: P.ink, align: "right" });
      tag(x, tr("ch01.empty"), cx0 - (16 + 15) * s, Math.min(cardB - 8 * s, frameTop - (12 + 6 + 17.4) * s), s, ba, { px: 30, color: P.ink2, align: "right" });
    }
  }
  function macActors(x, e, b) {
    // 那封换歌的信封：从菜单栏的 Hub 图标弹出来，落在导轨上等到结尾
    if (b >= AT.post && b < AT.launch) {
      const k = prog(b, AT.post, AT.park, E.io);
      const p = k < 1 ? [lerp(HUB3[0], PARK3[0], k), lerp(HUB3[1], PARK3[1], k), lerp(HUB3[2], PARK3[2] - 6, k) + Math.sin(k * Math.PI) * 120] : [PARK3[0], PARK3[1], PARK3[2] - 6];
      put(p[0], p[1], (xx) => {
        envBox(xx, p[0], p[1], p[2] - 6, lerp(0.6, 1.5, E.out(Math.min(1, k * 1.4))));
        const [gx, gy] = wp(p[0], p[1], p[2]);
        glow(e, gx, gy, 70, 0.5 * (k < 1 ? 1 : 0.4 + 0.6 * impact(b, AT.back, 0.25)) + 0.5 * impact(b, AT.park, 0.2));
      }, 2);
    }
    const ba = win(b, AT.breath, AT.breath + 0.05, AT.breath + 0.6, AT.breath + 0.7);
    if (ba > 0) {
      const k = prog(b, AT.breath, AT.breath + 0.55), s = 1.1 + 0.18 * Math.sin(k * Math.PI);
      put(LAP.x + 54, LAP.y + 30, (xx) => {
        envBox(xx, LAP.x + 54, LAP.y + 30, 186, s, { ghost: true, a: ba });
        ring(xx, LAP.x + 54, LAP.y + 30, 186, 30 + 50 * k, P.ink2, 2, ba * (1 - k));
      }, 3);
    }
  }

  // ---------- 隐私闸 ----------
  const BELT = { x0: 500, x1: 980, y: 1098, d: 46 };
  const JEV = { x: 720, y: 1076, w: 150, d: 90, h: 128 };
  const PROB = [0.34, 0.81, 0.22, 0.63];
  const EXITS = [[1010, 1030], [1010, 1118], [1010, 1206]];
  const tilePath = (k) => {
    const pts = [[LAP.x + 54, LAP.y + 20, LAP.z + 40], [520, 1121, 22], [646, 1121, 22], [700, 1121, 22], [895, 1121, 22], [EXITS[0][0] + 8, EXITS[0][1] + 16, 26]];
    const T = [AT.wt, AT.wt + 0.22, AT.list + 0.1, AT.jev, AT.judged + 0.1, AT.cleared];
    for (let i = 1; i < T.length; i++) if (k < T[i] || i === T.length - 1) {
      const u = prog(k, T[i - 1], T[i], i === 1 ? E.io : E.lin), p = lerp3(pts[i - 1], pts[i], u);
      if (i === 1) p[2] += Math.sin(u * Math.PI) * 70;
      if (i === 5) p[2] += Math.sin(u * Math.PI) * 50;
      return p;
    }
    return pts[pts.length - 1];
  };
  function gate(x, b) {
    box(x, BELT.x0, BELT.y, 0, BELT.x1 - BELT.x0, BELT.d, 18, P.lilac);
    const F = onT(BELT.x0, BELT.y, 18), off = ((b * 4) % 1) * 30;
    for (let u = 10 + off; u < BELT.x1 - BELT.x0 - 6; u += 30) fstroke(x, F, [[u, 6], [u, BELT.d - 6]], tone(P.lilac, 0.22), 2.4);
    box(x, 638, 1084, 0, 22, 12, 100, P.butter); box(x, 638, 1150, 0, 22, 12, 100, P.butter); box(x, 634, 1080, 100, 30, 86, 14, P.butter);
    box(x, JEV.x, JEV.y, 0, JEV.w, JEV.d, JEV.h, P.rose);
    box(x, JEV.x + 20, JEV.y + 20, JEV.h, 40, 40, 10, tone(P.rose, 0.1));
    cyl(x, JEV.x + 112, JEV.y + 44, JEV.h, 10, 22, P.butter);
    const S = onY(JEV.x, JEV.y + JEV.d, 0);
    quad(x, S, 14, 18, 136, 114, P.screen);
    const run = prog(b, AT.jev, AT.jev + 0.05) * (1 - prog(b, AT.judged, AT.judged + 0.02)), done = prog(b, AT.judged, AT.judged + 0.08, E.out);
    PROB.forEach((p, i) => {
      const v = 96 - i * 22;
      quad(x, S, 24, v - 6, 126, v + 6, P.screenL);
      if (run > 0) {
        const ph = (b * 3.2 + i * 0.27) % 1;
        quad(x, S, 24 + ph * 70, v - 6, 24 + ph * 70 + 32, v + 6, rgba(P.cream, 0.7 * run));
      }
      if (done > 0) quad(x, S, 24, v - 6, 24 + 102 * p * done, v + 6, SIG);
    });
    // 三个出口：放行的信封托盘、锁箱、问 lyjw 的信箱
    for (const [ex, ey] of EXITS) dash(x, [wp(905, 1121, 18), wp(ex, ey + 20, 2)], P.ink2, 2.4, 0.6, [8, 7]);
    box(x, EXITS[0][0] - 4, EXITS[0][1], 0, 70, 46, 18, P.cream);
    envBox(x, EXITS[0][0] + 31, EXITS[0][1] + 23, 18, 1.1, { a: 0.35 + 0.65 * prog(b, AT.cleared, AT.cleared + 0.05) });
    box(x, EXITS[1][0], EXITS[1][1], 0, 62, 50, 46, P.steel);
    const L = onY(EXITS[1][0], EXITS[1][1] + 50, 0), drop = 1 - prog(b, AT.lock, AT.lock + 0.06, E.in);
    quad(x, L, 18, 8, 44, 30, P.ink2);
    fstroke(x, L, [[22, 30 + 10 * drop], [22, 38 + 10 * drop], [40, 38 + 10 * drop], [40, 30 + 10 * drop]], P.ink2, 3.4);
    box(x, EXITS[2][0], EXITS[2][1], 0, 54, 46, 56, P.coral);
    gable(x, EXITS[2][0], EXITS[2][1], 56, 54, 46, 14, P.coral);
    const up = prog(b, AT.owner, AT.owner + 0.06, E.outBack);
    box(x, EXITS[2][0] + 54, EXITS[2][1] + 10, 30, 4, 4, lerp(10, 44, up), SIG);
    box(x, EXITS[2][0] + 54, EXITS[2][1] + 2, 30 + lerp(10, 44, up) - 12, 4, 12, 12, SIG);
  }
  function gateActors(x, e, b) {
    if (b < AT.wt || b > AT.cleared + 0.06) return;
    const p = tilePath(b);
    put(p[0], p[1], (xx) => titleTile(xx, p[0], p[1], p[2], 1 - prog(b, AT.cleared, AT.cleared + 0.06)), 4);
  }
  function gateLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const wt = a * win(b, AT.wt + 0.05, AT.wt + 0.15, AT.list, AT.list + 0.1);
    if (wt > 0) { const [px, py] = wp(...tilePath(b)); tag(x, tr("ch01.wt"), px + 40 * s, py - 50 * s, s, wt, { px: 30, color: P.ink2 }); }
    const la = a * prog(b, AT.list - 0.15, AT.list - 0.05);
    const [gx, gy] = wp(650, 1121, 120);
    lead(x, [[gx, gy], [gx, gy - 70 * s]], s, la);
    tag(x, tr("ch01.lists"), gx, gy - 158 * s, s, la, { px: 30, align: "center", color: P.ink2 });
    const t1 = tr("ch01.never"), t2 = tr("ch01.trusted"), f = SANS(30 * s), w1 = measure(x, t1, f), w2 = measure(x, t2, f), gap = 48 * s;
    const l1 = gx - (w1 + w2 + gap) / 2, l2 = l1 + w1 + gap;
    tag(x, t1, l1, gy - 92 * s, s, la, { px: 30, line: P.ink2, lw: 2.2 });
    tag(x, t2, l2, gy - 92 * s, s, la, { px: 30, line: P.ink2, lw: 2.2 });
    const ja = a * prog(b, AT.jev - 0.1, AT.jev);
    const [jx, jy] = wp(JEV.x + JEV.w / 2, JEV.y, JEV.h + 40);
    if (ja > 0) {
      // Jev 卡片和名单标签在同一高度：英文标签更长，卡片的牌子左沿至少离第二枚标签的牌子 28 px，不够就整块往右挪
      const fj = SANS(40 * s), fm = MONO(28 * s), wj = measure(x, "Jev", fj), wm = measure(x, "TypeSafe System One", fm);
      const lx = Math.max(jx - 40 * s, l2 + w2 + (15 + 28 + 16) * s), ly = jy - 60 * s;
      plate(x, lx - 16 * s, ly - 46 * s, wj + wm + 54 * s, 64 * s, s, ja);
      text(x, "Jev", lx, ly, { font: fj, color: P.ink, alpha: ja });
      text(x, "TypeSafe System One", lx + wj + 22 * s, ly - 3 * s, { font: fm, color: P.ink2, alpha: ja });
    }
    const [ix, iy] = wp(JEV.x + JEV.w, JEV.y + JEV.d, 10);
    tag(x, tr("ch01.illus"), ix + 24 * s, iy + 64 * s, s, a * prog(b, AT.judged, AT.judged + 0.08), { px: 28, color: P.ink2 });
    if (b >= AT.judged) {
      const [fx, fy] = wp(JEV.x + JEV.w / 2, JEV.y + JEV.d / 2, JEV.h + 30);
      glow(e, fx, fy, 90, 0.5 * impact(b, AT.judged, 0.2));
    }
    [["ch01.pass", AT.cleared], ["ch01.lock", AT.lock], ["ch01.owner", AT.owner]].forEach(([k, t], i) => {
      const [ex, ey] = wp(EXITS[i][0] + 60, EXITS[i][1] + 20, 40);
      const ka = a * prog(b, t, t + 0.06);
      lead(x, [[ex, ey], [ex + 60 * s, ey]], s, ka, i === 0 ? SIG : P.ink2);
      tag(x, tr(k), ex + 78 * s, ey + 11 * s, s, ka, { px: 30, color: i === 0 ? SIG : P.ink });
      if (i === 0 && b >= t) glow(e, ex - 40 * s, ey, 80, 0.5 * impact(b, t, 0.2));
    });
  }

  // ---------- 图片 → R2 ----------
  const VAULT = { x: 1170, y: 1010, w: 230, d: 200, h: 176 };
  const NAS = { x: 1500, y: 1060, w: 190, d: 160, h: 104 };
  const DRAWER = { u: 82, v: 70, w: 66, h: 44 };
  const hex64 = (seed) => { const r = mulberry32(seed); let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(r() * 16)]; return s; };
  const ICON_KEY = hex64(101), KEY_SHORT = `${ICON_KEY.slice(0, 8)}…${ICON_KEY.slice(-4)}.png`;
  const GLYPH = new Set(["2,3", "3,4", "4,5", "3,6", "2,7", "5,7", "6,7", "7,7"]);
  const drawerOut = (b) => Math.max(win(b, AT.drop - 0.12, AT.drop - 0.02, AT.shut - 0.06, AT.shut), win(b, AT.posterIn - 0.14, AT.posterIn - 0.04, AT.posterIn + 0.18, AT.posterIn + 0.25));
  function vault(x, b) {
    box(x, VAULT.x, VAULT.y, 0, VAULT.w, VAULT.d, VAULT.h, P.sky);
    box(x, VAULT.x - 8, VAULT.y - 8, VAULT.h, VAULT.w + 16, VAULT.d + 16, 12, tone(P.sky, 0.08));
    const F = onY(VAULT.x, VAULT.y + VAULT.d, 0);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      const u = 14 + c * 70, v = 20 + r * 50;
      quad(x, F, u, v, u + 62, v + 42, tone(P.sky, 0.12));
      quad(x, F, u + 24, v + 18, u + 38, v + 24, tone(P.sky, 0.32));
    }
    const out = drawerOut(b) * 60;
    if (out > 1) box(x, VAULT.x + DRAWER.u, VAULT.y + VAULT.d, DRAWER.v, DRAWER.w, out, DRAWER.h, tone(P.sky, -0.04));
    box(x, NAS.x, NAS.y, 0, NAS.w, NAS.d, NAS.h, P.lilac);
    const Fn = onY(NAS.x, NAS.y + NAS.d, 0);
    for (let i = 0; i < 4; i++) { quad(x, Fn, 16 + i * 43, 18, 50 + i * 43, 86, tone(P.lilac, 0.12)); quad(x, Fn, 22 + i * 43, 74, 30 + i * 43, 80, i === 1 ? SIG : P.mint); }
    box(x, NAS.x + 24, NAS.y + 44, NAS.h, 146, 54, 46, P.coral);
    const Fc = onY(NAS.x + 24, NAS.y + 98, NAS.h);
    for (let u = 10; u < 146; u += 12) fstroke(x, Fc, [[u, 6], [u, 40]], tone(P.coral, 0.2), 2.2);
  }
  function iconTile(x, X, Y, Z, k, a) {
    const n = 10, cs = 4.2, F = onT(X - n * cs / 2, Y - n * cs / 2, Z + 5);
    box(x, X - n * cs / 2 - 3, Y - n * cs / 2 - 3, Z, n * cs + 6, n * cs + 6, 5, P.cream, { a });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1, g = GLYPH.has(`${i},${j}`);
      if (edge && ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0) || (i === n - 1 && j === n - 1))) continue;
      const sh = hash(i * 13 + j * 7) * k * 22;
      quad(x, (u, v) => F(u + sh, v - sh * 0.3), i * cs, j * cs, i * cs + cs + 0.3, j * cs + cs + 0.3, g ? P.cream : edge ? P.screenL : P.screen, a * (1 - k));
    }
  }
  const DROP3 = () => [VAULT.x + DRAWER.u + DRAWER.w / 2, VAULT.y + VAULT.d + 30, DRAWER.v + DRAWER.h];
  function imgActors(x, e, b) {
    if (b >= AT.icon && b < AT.drop + 0.05) {
      const k = prog(b, AT.icon, AT.hash, E.out), p = [lerp(900, 1110, k), lerp(1300, 1150, k), 90 + Math.sin(k * Math.PI) * 40];
      const fileK = prog(b, AT.hash, AT.drop, E.io), d = DROP3();
      if (b < AT.hash + 0.1) put(p[0], p[1], (xx) => iconTile(xx, p[0], p[1], p[2], prog(b, AT.hash, AT.hash + 0.1), 1), 5);
      if (b >= AT.hash) { const q = lerp3(p, d, fileK); q[2] += Math.sin(fileK * Math.PI) * 60; put(q[0], q[1], (xx) => box(xx, q[0] - 14, q[1] - 10, q[2], 28, 20, 8, P.cream, { top: P.plate }), 6); }
    }
    if (b >= AT.poster && b < AT.posterIn + 0.05) {
      const k = prog(b, AT.poster, AT.posterIn, E.io), s3 = [NAS.x + 90, NAS.y + 70, NAS.h + 50], d = DROP3(), q = lerp3(s3, d, k);
      q[2] += Math.sin(k * Math.PI) * 110;
      put(q[0], q[1], (xx) => { box(xx, q[0] - 12, q[1] - 16, q[2], 24, 32, 5, P.rose, { top: P.pink }); quad(xx, onT(q[0] - 12, q[1] - 16, q[2] + 5), 5, 6, 19, 20, P.butter); }, 6);
    }
    if (b >= AT.emby && b < AT.emby + 0.6) {
      const k = prog(b, AT.emby, AT.emby + 0.55, E.in), q = [lerp(NAS.x + 90, 1900, k), lerp(NAS.y + 80, 600, k), NAS.h + 60 + Math.sin(k * Math.PI) * 80];
      put(q[0], q[1], (xx) => envBox(xx, q[0], q[1], q[2], 1.1, { a: 1 - prog(b, AT.emby + 0.45, AT.emby + 0.55) }), 6);
    }
  }
  function imgLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const [ix, iy] = wp(1000, 1230, 140);
    tag(x, tr("ch01.icon"), ix - 160 * s, iy - 30 * s, s, a * win(b, AT.icon, AT.icon + 0.08, AT.hash + 0.4, AT.hash + 0.5), { px: 30, color: P.ink2 });
    const ha = a * prog(b, AT.hash, AT.hash + 0.06);
    const [hx, hy] = wp(1120, 1150, 260);
    if (ha > 0) {
      tag(x, tr("ch01.byContent"), hx - 230 * s, hy - 72 * s, s, ha, { px: 30, color: P.ink2 });
      tag(x, KEY_SHORT, hx - 230 * s, hy - 8 * s, s, ha, { px: 28, font: MONO, color: SIG });
    }
    const [vx, vy] = wp(VAULT.x + VAULT.w / 2, VAULT.y + VAULT.d / 2, VAULT.h + 12);
    tag(x, "R2", vx, vy - 26 * s, s, a, { px: 36, font: MONO, align: "center", w: 600 });
    tag(x, tr("ch01.sameKey"), vx + 120 * s, vy - 120 * s, s, a * prog(b, AT.shut, AT.shut + 0.08), { px: 30 });
    const oa = a * prog(b, AT.shut + 0.1, AT.shut + 0.2);
    if (oa > 0) {
      const X0 = st.c[0] + (1250 - 960) * s, Y0 = st.c[1] + (800 - 540) * s;
      plate(x, X0, Y0, 620 * s, 132 * s, s, oa);
      text(x, tr("ch01.onlyKey"), X0 + 28 * s, Y0 + 50 * s, { font: SANS(30 * s), color: P.ink, alpha: oa });
      text(x, `"iconObjectKey": "${ICON_KEY.slice(0, 6)}…png"`, X0 + 28 * s, Y0 + 100 * s, { font: MONO(28 * s), color: SIG, alpha: oa });
    }
    const [nx, ny] = wp(NAS.x + NAS.w, NAS.y + NAS.d / 2, NAS.h + 40);
    tag(x, tr("ch01.nas"), nx - 120 * s, ny - 150 * s, s, a * prog(b, AT.poster - 0.2, AT.poster - 0.1), { px: 30, color: P.ink2 });
    const num = (n, str, px, py, t) => {
      const na = a * prog(b, t, t + 0.06);
      if (na <= 0) return;
      x.globalAlpha = na; x.fillStyle = SIG; x.beginPath(); x.arc(px, py - 11 * s, 20 * s, 0, TAU); x.fill(); x.globalAlpha = 1;
      text(x, String(n), px, py, { font: SANS(28 * s, 600), color: P.plate, align: "center", alpha: na });
      tag(x, tr(str), px + 36 * s, py, s, na, { px: 30 });
    };
    num(1, "ch01.poster", nx - 100 * s, ny - 84 * s, AT.poster);
    num(2, "ch01.watching", nx - 100 * s, ny - 20 * s, AT.emby);
  }

  // ---------- iPhone ----------
  // 放在家的右前方、离编码用量的汇合塔远一点：从家里和汇合塔两个机位看过去都不挡东西
  const PHN = { x: 1650, y: 650, w: 26, d: 140, z: 26, h: 250 };
  const OUT_ICONS = ["rings", "workouts", "steps"];
  function phone(x, b) {
    box(x, PHN.x - 36, PHN.y - 20, 0, 100, PHN.d + 40, 26, P.cream);
    box(x, PHN.x, PHN.y, PHN.z, PHN.w, PHN.d, PHN.h, P.steel);
    const S = onX(PHN.x + PHN.w, PHN.y, PHN.z), on = prog(b, AT.wake, AT.wake + 0.08);
    quad(x, S, 10, 12, PHN.d - 10, PHN.h - 12, tone(P.screen, -0.25 * on));
    quad(x, S, PHN.d / 2 - 22, PHN.h - 30, PHN.d / 2 + 22, PHN.h - 21, P.ink);
    if (on > 0) {
      fstroke(x, S, [[22, 150], [46, 150], [56, 180], [70, 116], [84, 162], [118, 162]], P.cream, 4, on);
      for (let i = 0; i < 3; i++) poly(x, fcirc(S, PHN.d / 2, 72, 34 - i * 11, 28), i % 2 ? tone(P.screen, -0.25) : rgba(SIG, 0.75), on);
    }
  }
  function phoneActors(x, e, b) {
    const k = prog(b, AT.wake, AT.wake + 0.5);
    if (k > 0 && k < 1) put(PHN.x, PHN.y, (xx) => ring(xx, PHN.x + PHN.w / 2, PHN.y + PHN.d / 2, 2, 110 + 240 * k, SIG, 3, 1 - k), -50);
  }
  function iconGlyph(x, kind, cx, cy, s, a) {
    x.globalAlpha = a; x.strokeStyle = SIG; x.fillStyle = SIG; x.lineWidth = 4 * s; x.lineCap = "round";
    if (kind === "rings") for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(cx, cy, (16 - i * 5.5) * s, -Math.PI / 2, -Math.PI / 2 + TAU * (0.85 - i * 0.18)); x.stroke(); }
    else if (kind === "workouts") { x.beginPath(); x.arc(cx, cy + 2 * s, 14 * s, 0, TAU); x.stroke(); x.beginPath(); x.moveTo(cx, cy + 2 * s); x.lineTo(cx, cy - 7 * s); x.moveTo(cx - 5 * s, cy - 16 * s); x.lineTo(cx + 5 * s, cy - 16 * s); x.stroke(); }
    else for (let i = 0; i < 5; i++) { const h = [10, 18, 14, 24, 16][i] * s; x.fillRect(cx - 17 * s + i * 7.4 * s, cy + 14 * s - h, 4.6 * s, h); }
    x.globalAlpha = 1;
  }
  function phoneLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const [px, py] = wp(PHN.x + PHN.w, PHN.y + PHN.d, PHN.z + PHN.h);
    tag(x, tr("ch01.f2"), px - 520 * s, py - 70 * s, s, a * prog(b, AT.wake - 0.1, AT.wake), { px: 30 });
    const [ox, oy] = wp(PHN.x + PHN.w, PHN.y + 40, PHN.z + 230);
    OUT_ICONS.forEach((kind, i) => {
      const t = AT.outs[i], k = prog(b, t, t + 0.12, E.out), ka = a * k * (1 - prog(b, AT.send, AT.send + 0.12));
      if (ka <= 0) return;
      const tx = ox + lerp(30, 150, k) * s, ty = oy + (i * 92 - 40) * s;
      plate(x, tx - 16 * s, ty - 42 * s, 64 * s, 64 * s, s, ka);
      iconGlyph(x, kind, tx + 16 * s, ty - 10 * s, s, ka);
      tag(x, tr("ch01." + kind), tx + 72 * s, ty, s, ka, { px: 30 });
    });
    const sk = prog(b, AT.send, AT.send + 0.4, E.in);
    if (sk > 0 && sk < 1) { const tx = ox + lerp(180, 900, sk) * s, ty = oy + lerp(50, -300, sk) * s; envFlat(x, tx, ty, 1.2 * s, a); }
  }
  function envFlat(x, cx, cy, s, a) {
    x.save(); x.translate(cx, cy); x.globalAlpha = a; x.fillStyle = P.envTop; x.strokeStyle = SIG; x.lineWidth = 3 * s; x.lineJoin = "round";
    x.fillRect(-26 * s, -17 * s, 52 * s, 34 * s); x.strokeRect(-26 * s, -17 * s, 52 * s, 34 * s);
    x.beginPath(); x.moveTo(-26 * s, -17 * s); x.lineTo(0, 4 * s); x.lineTo(26 * s, -17 * s); x.stroke(); x.restore();
  }

  // ---------- 家里 ----------
  // 三样凭据分开画，不能混：Home Assistant 的钥匙只开 /homepod，容器自己的钥匙只开 /playstation；PSN 登录态不是钥匙，留在 n100 上，只拿来问 Sony。
  // PS5 和 Home Assistant 之间没有线：站点不显示 PS 电源（FACTS §1）
  const HOUSE = { x0: 1240, y0: 90, w: 360, d: 330, wall: 150 };
  const HA3 = [1268, 269, 120], CT3 = [1472, 200, 66], POD3 = [1330, 330, 62], ROOF_Z = 12 + HOUSE.wall;
  // 镜头进家里之前把屋顶整个掀走，离开时盖回去
  const roofLift = (b) => E.io(prog(b, STOP.HOME.t0 - 0.3, STOP.HOME.t0 + 0.05)) * (1 - E.io(prog(b, STOP.HOME.t1 + 0.02, STOP.HOME.t1 + 0.3)));
  function house(x, b) {
    const H = HOUSE;
    box(x, H.x0, H.y0, 0, H.w, H.d, 12, P.wood);
    box(x, H.x0, H.y0, 12, H.w, 14, H.wall, P.rose);
    box(x, H.x0, H.y0, 12, 14, H.d, H.wall, P.rose);
    box(x, 1290, 108, 12, 210, 46, 40, P.cream);
    box(x, 1312, 112, 52, 150, 8, 82, P.screen);
    box(x, 1520, 112, 12, 30, 58, 100, P.cream);
    quad(x, onY(1520, 170, 12), 12, 10, 16, 90, rgba(P.sky, 0.9));
    box(x, 1440, 176, 12, 60, 50, 24, P.steel);
    box(x, CT3[0] - 24, CT3[1] - 18, 36, 48, 36, 26, P.coral);
    const Fc = onY(CT3[0] - 24, CT3[1] + 18, 36);
    for (let u = 6; u < 48; u += 8) fstroke(x, Fc, [[u, 4], [u, 22]], tone(P.coral, 0.22), 1.8);
    box(x, 1254, 230, 98, 30, 90, 6, P.wood);
    box(x, 1256, 246, 104, 24, 46, 30, P.cream);
    poly(x, fcirc(onX(1280, 246, 104), 23, 15, 6, 14), SIG);
    cyl(x, POD3[0], POD3[1], 12, 24, 50, P.cream, { top: P.steel });
    box(x, 1440, 300, 12, 110, 70, 30, P.lilac);
    box(x, 1440, 366, 42, 110, 4, 40, P.lilac);
    const lift = roofLift(b);
    if (lift < 0.999) gable(x, H.x0 - 16, H.y0 - 16, ROOF_Z + 1000 * lift, H.w + 32, H.d + 32, 70, P.coral);
  }
  function keyGlyph(x, cx, cy, s, color, a, ang = 0) {
    x.save(); x.translate(cx, cy); x.rotate(ang); x.globalAlpha = a; x.strokeStyle = P.ink; x.fillStyle = color; x.lineWidth = 2.6 * s;
    x.beginPath(); x.arc(-16 * s, 0, 11 * s, 0, TAU); x.fill(); x.stroke();
    x.beginPath(); x.rect(-6 * s, -3.5 * s, 34 * s, 7 * s); x.fill(); x.stroke();
    x.beginPath(); x.rect(18 * s, 3 * s, 5 * s, 8 * s); x.rect(10 * s, 3 * s, 5 * s, 6 * s); x.fill(); x.stroke();
    x.fillStyle = P.plate; x.beginPath(); x.arc(-16 * s, 0, 4 * s, 0, TAU); x.fill(); x.restore();
  }
  const HOME_ROWS = [
    { from: HA3, name: "Home Assistant", ep: "/api/ingest/homepod", what: "ch01.hpWhat", t: AT.haKey, col: P.butter },
    { from: CT3, name: "playstation-reporter", ep: "/api/ingest/playstation", what: "ch01.psWhat", t: AT.psKey, col: SIG },
  ];
  function homeLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const na = a * prog(b, AT.homepod, AT.homepod + 0.1);
    for (let i = 0; i < 3; i++) {
      const k = ((b - AT.homepod) * 1.1 + i / 3) % 1, [nx, ny] = wp(POD3[0], POD3[1], POD3[2] + 8 + k * 120);
      if (b >= AT.homepod) text(x, "♪", nx + (i - 1) * 26 * s, ny, { font: SANS(30 * s), color: P.ink2, alpha: na * Math.sin(k * Math.PI), texture: true });
    }
    const [hx, hy] = wp(...POD3);
    tag(x, "HomePod", hx - 60 * s, hy + 70 * s, s, a, { px: 28, font: MONO, align: "right" });
    // 钥匙从各自的设备飞进各自那一行：一行一把，和东京那几个容器同一个画法
    HOME_ROWS.forEach((r, i) => {
      const ka = a * prog(b, r.t[0], r.t[0] + 0.08);
      if (ka <= 0) return;
      const lx = st.c[0] + (110 - 960) * s, ly = st.c[1] + (178 + i * 150 - 540) * s, w = 920 * s;
      const [ax, ay] = wp(...r.from), slot = [lx + w - 76 * s, ly - 36 * s];
      lead(x, [[ax, ay], [lx + w - 40 * s, ly - 14 * s]], s, ka, tone(r.col, 0.3));
      plate(x, lx - 20 * s, ly - 72 * s, w, 112 * s, s, ka);
      text(x, `${r.name} → ${r.ep}`, lx, ly - 28 * s, { font: MONO(28 * s), color: P.ink, alpha: ka });
      text(x, tr(r.what), lx, ly + 18 * s, { font: SANS(30 * s), color: P.ink2, alpha: ka });
      const k = prog(b, r.t[0], r.t[1], E.io);
      keyGlyph(x, lerp(ax, slot[0], k), lerp(ay, slot[1], k) - Math.sin(k * Math.PI) * 80 * s, s, r.col, ka, -0.3 * k);
      if (b >= r.t[1]) glow(e, slot[0], slot[1], 70, 0.45 * impact(b, r.t[1], 0.2));
    });
    const [cx, cy] = wp(...CT3);
    tag(x, "n100", cx + 60 * s, cy + 74 * s, s, a, { px: 28, font: MONO });
    const pa = a * prog(b, AT.psn[0] - 0.1, AT.psn[0]);
    const [sx, sy] = wp(CT3[0], CT3[1], 300);
    dash(x, [[cx, cy - 20 * s], [sx, sy + 18 * s]], P.ink2, 2.4 * s, pa * 0.7, [6 * s, 8 * s]);
    tag(x, "PSN · Sony", sx, sy, s, pa, { px: 28, font: MONO, align: "center" });
    const pk = prog(b, AT.psn[0], AT.psn[1]);
    if (pk > 0 && pk < 1) {
      const u = pk < 0.5 ? pk * 2 : 2 - pk * 2;
      x.globalAlpha = a; x.fillStyle = P.ink; x.beginPath(); x.arc(lerp(cx, sx, u), lerp(cy - 20 * s, sy + 18 * s, u), 7 * s, 0, TAU); x.fill(); x.globalAlpha = 1;
    }
    tag(x, tr("ch01.psnLogin"), sx, sy - 64 * s, s, pa, { px: 28, color: P.ink2, align: "center" });
  }

  // ---------- 东京 ----------
  const CONTS = [[P.coral, "server-reporter", "/api/ingest/server", "ch01.srv"], [P.butter, "agents-reporter", "/api/ingest/agents", "ch01.agents"], [P.sky, "discord-reporter", "/api/ingest/quest", "ch01.quest"]];
  function tokyo(x, b) {
    const z = TOKYO.z;
    box(x, 2110, -440, z, 280, 250, 12, P.cream);
    CONTS.forEach(([col], i) => {
      const lit = impact(b, AT.boxes[i], 0.25), Z = z + 12 + i * 58;
      box(x, 2150, -400, Z, 210, 76, 56, col, { dk: -0.06 * lit });
      const F = onY(2150, -324, Z);
      for (let u = 10; u < 210; u += 14) fstroke(x, F, [[u, 6], [u, 50]], tone(col, 0.2), 2.2);
      const Fx = onX(2360, -400, Z);
      fstroke(x, Fx, [[38, 8], [38, 48]], tone(col, 0.35), 2.2);
    });
    tree(x, 2380, -170, 1.1, P.pink);
    tree(x, 2125, -170, 0.8, P.pink);
  }
  function tokyoLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const [tx, ty] = wp(2250, -440, TOKYO.z + 220);
    tag(x, tr("ch01.tokyo"), tx - 40 * s, ty - 50 * s, s, a, { px: 30 });
    text(x, "misaka-jp", tx - 40 * s, ty + 14 * s, { font: MONO(28 * s), color: P.ink2, alpha: a });
    CONTS.forEach(([col, name, ep, key], i) => {
      const t = AT.boxes[i], ka = a * prog(b, t, t + 0.08);
      if (ka <= 0) return;
      const [ax, ay] = wp(2150, -324, TOKYO.z + 12 + i * 58 + 30);
      const lx = st.c[0] + (110 - 960) * s, ly = ay + (40 - i * 40) * s;
      lead(x, [[ax, ay], [lx + 760 * s, ay], [lx + 760 * s, ly - 14 * s]], s, ka, tone(col, 0.3));
      plate(x, lx - 20 * s, ly - 72 * s, 760 * s, 112 * s, s, ka);
      text(x, `${name} → ${ep}`, lx, ly - 28 * s, { font: MONO(28 * s), color: P.ink, alpha: ka });
      text(x, tr(key), lx, ly + 18 * s, { font: SANS(30 * s), color: P.ink2, alpha: ka });
      keyGlyph(x, lx + 700 * s, ly - 36 * s, s, col, ka, -0.3);
      if (b >= t) { const [gx, gy] = wp(2255, -362, TOKYO.z + 40 + i * 58); glow(e, gx, gy, 110, 0.4 * impact(b, t, 0.25)); }
    });
  }

  // ---------- 编码用量 ----------
  const HUB = [1100, 450];
  const FEEDS = [
    () => [wp(RAIL[0][0] + 160, RAIL[0][1] - 160, 54), wp(HUB[0] - 30, HUB[1] + 30, 54)],
    () => { const a = wp(940, 145, CLOUD.z + 10); return [a, [a[0], a[1] + 260], wp(HUB[0], HUB[1], 120)]; },
    () => [wp(2150, -330, TOKYO.z + 200), wp(HUB[0] + 30, HUB[1] - 30, 100)],
  ];
  function hub(x, b) {
    const pulse = impact(b, AT.merge, 0.25);
    cyl(x, HUB[0], HUB[1], 0, 46, 74, P.cream);
    cyl(x, HUB[0], HUB[1], 74, 52, 10, tone(P.coral, -0.04 * pulse));
    cyl(x, HUB[0], HUB[1], 84, 30, 30, P.coral);
    const F = onY(HUB[0] - 18, HUB[1] + 44, 20);
    quad(x, F, 0, 20, 36, 30, P.ink2);
  }
  function cloud(x, b) {
    island(x, CLOUD);
    const z = CLOUD.z;
    box(x, 880, 90, z, 90, 70, 50, P.cream);
    quad(x, onY(880, 160, z), 14, 14, 76, 38, P.screen);
    box(x, 1000, 110, z, 6, 6, 100, P.steel);
    cyl(x, 1003, 113, z + 100, 9, 9, SIG);
    const k = ((b * 2) % 1);
    ring(x, 1003, 113, z + 105, 14 + 40 * k, SIG, 2, (1 - k) * 0.6);
  }
  function codeLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2], SC = (u, v) => [st.c[0] + (u - 960) * s, st.c[1] + (v - 540) * s];
    if (a <= 0) return;
    const f0 = FEEDS[0](), f1 = FEEDS[1](), f2 = FEEDS[2]();
    dash(x, f1, P.ink2, 2.6 * s, a * 0.6, [10 * s, 9 * s], -b * 40);
    dash(x, f2, P.ink2, 2.6 * s, a * 0.6, [10 * s, 9 * s], -b * 40);
    tag(x, tr("ch01.cc"), ...SC(1190, 120), s, a, { px: 30 });
    tag(x, "OTLP → /api/ingest/agents/otlp", ...SC(1190, 184), s, a, { px: 28, font: MONO, color: P.ink2 });
    tag(x, tr("ch01.extra"), ...SC(1190, 246), s, a, { px: 28, color: P.ink2 });
    tag(x, tr("ch01.srcMac"), f0[0][0] - 60 * s, f0[0][1] - 54 * s, s, a, { px: 30 });
    tag(x, tr("ch01.srcCursor"), ...SC(1880, 724), s, a, { px: 30, align: "right" });
    const P3 = [f0, f1, f2];
    AT.raw.forEach((t, i) => {
      const k = prog(b, t, AT.merge, E.io);
      if (k <= 0 || k >= 1) return;
      const pts = P3[i], L = pts.slice(1).reduce((u, p, j) => u + Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]), 0);
      const [px, py] = pathAt(pts, k * L);
      plate(x, px - 22 * s, py - 16 * s, 44 * s, 32 * s, s, a, { line: SIG, lw: 2.4 });
      for (let j = 0; j < 3; j++) x.fillRect(px - 12 * s, py - 8 * s + j * 7 * s, (24 - j * 6) * s, 2.6 * s);
    });
    const [hx, hy] = wp(HUB[0], HUB[1], 120);
    if (b >= AT.merge) glow(e, hx, hy, 120, 0.6 * impact(b, AT.merge, 0.3));
    tag(x, tr("ch01.merge"), hx - 70 * s, hy + 10 * s, s, a * prog(b, AT.merge, AT.merge + 0.06), { px: 30, color: SIG, align: "right" });
    const pa = a * prog(b, AT.pulse, AT.pulse + 0.1, E.out);
    if (pa > 0) {
      const [X0, Y0] = SC(1220, 320), W = 640 * s;
      plate(x, X0, Y0, W, 200 * s, s, pa);
      text(x, tr("ch01.cu"), X0 + 28 * s, Y0 + 48 * s, { font: SANS(32 * s), color: P.ink, alpha: pa });
      text(x, "Pulse · Last 24 hours", X0 + W - 28 * s, Y0 + 46 * s, { font: MONO(28 * s), color: P.ink2, align: "right", alpha: pa });
      [["Coding", 0], ["Tokens", 1]].forEach(([name, hot], i) => {
        const y = Y0 + (104 + i * 60) * s, lx = X0 + 170 * s, lw = W - 200 * s;
        text(x, name, X0 + 28 * s, y + 10 * s, { font: SANS(28 * s, 500), color: hot ? SIG : P.ink, alpha: pa });
        x.globalAlpha = pa * 0.5; x.fillStyle = P.steel; x.fillRect(lx, y - 12 * s, lw, 24 * s); x.globalAlpha = pa;
        if (hot) {
          x.fillStyle = rgba(SIG, 0.3); x.beginPath(); x.moveTo(lx, y + 12 * s);
          for (let j = 0; j <= 48; j++) x.lineTo(lx + (lw * j) / 48, y + 12 * s - (0.25 + 0.75 * hash(j * 3.1)) * 22 * s * prog(b, AT.pulse + j * 0.004, AT.pulse + 0.1 + j * 0.004));
          x.lineTo(lx + lw, y + 12 * s); x.fill();
        } else {
          x.fillStyle = tone(P.lilac, 0.2);
          for (let j = 0; j < 5; j++) { const u = hash(i * 31 + j * 7), w = 0.03 + 0.08 * hash(i * 11 + j); x.fillRect(lx + lw * u * 0.9, y - 12 * s, lw * w, 24 * s); }
        }
        x.globalAlpha = 1;
      });
      tag(x, tr("ch01.tokRate"), X0 + 28 * s, Y0 + 264 * s, s, pa, { px: 28, color: SIG });
      tag(x, tr("ch01.sum"), X0 + 28 * s, Y0 + 326 * s, s, pa, { px: 28 });
    }
  }

  // ---------- 采集 Worker 的钟楼 ----------
  // 调度表须与 workers/collector/src/registry.ts#JOBS 一致。apple-recent 每分钟登记，任务里再按
  // apple-recent.ts#appleRecentDue 分闲 / 活跃两档；这里让它在 APPLE_CHANGED 那一分钟看到列表变了。
  const JOBS = [
    ["apple-recent", 1, 0], ["provider-status", 1, 0], ["pagespeed", 60, 7], ["github-chart", 10, 1], ["github-repo", 30, 2],
    ["site-deployments", 1, 0], ["site-analytics", 15, 3], ["cloudflare-deployments", 2, 0], ["cloudflare-metrics", 15, 4],
    ["uptime-probe", 1, 0], ["site-health", 5, 4], ["digest", 15, 5], ["avatar-watch", 5, 1],
  ];
  const MINUTES = 12;
  const APPLE_IDLE = 5, APPLE_HOLD = 10, APPLE_CHANGED = 5;
  const due = (j, m) => (JOBS[j][0] === "apple-recent"
    ? (m >= APPLE_CHANGED && m < APPLE_CHANGED + APPLE_HOLD) || m % APPLE_IDLE === 0
    : m % JOBS[j][1] === JOBS[j][2]);
  const minuteAt = (b) => Math.floor((b - AT.dial) * 4 + 1e-9);
  const TOWER = { x: 230, y: 190, w: 140, d: 140, h: 330 }, TOWER_EAVE = 12;
  function tower(x, b) {
    const T = TOWER, m = clamp((b - AT.dial) * 4, 0, 60);
    box(x, T.x - 34, T.y - 34, 0, T.w + 68, T.d + 68, 34, P.cream);
    box(x, T.x - 14, T.y - 14, 34, T.w + 28, T.d + 28, 16, tone(P.cream, 0.06));
    box(x, T.x, T.y, 50, T.w, T.d, T.h, P.butter);
    for (const F of [onY(T.x, T.y + T.d, 50), onX(T.x + T.w, T.y, 50)]) {
      for (let r = 0; r < 2; r++) quad(x, F, 48, 60 + r * 80, 92, 112 + r * 80, tone(P.butter, 0.18));
      poly(x, fcirc(F, 70, 270, 50, 36), P.cream);
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; fstroke(x, F, [[70 + 42 * Math.cos(an), 270 + 42 * Math.sin(an)], [70 + 47 * Math.cos(an), 270 + 47 * Math.sin(an)]], P.ink2, 2.4); }
      const am = -Math.PI / 2 - (m / 60) * TAU, ah = -Math.PI / 2 - ((10 + m / 60) / 12) * TAU;
      fstroke(x, F, [[70, 270], [70 + 38 * Math.cos(am), 270 - 38 * Math.sin(am)]], SIG, 4.2);
      fstroke(x, F, [[70, 270], [70 + 24 * Math.cos(ah), 270 - 24 * Math.sin(ah)]], P.ink, 4.8);
    }
    pyramid(x, T.x - TOWER_EAVE, T.y - TOWER_EAVE, 50 + T.h, T.w + 2 * TOWER_EAVE, T.d + 2 * TOWER_EAVE, 96, P.coral);
    // 风向标：一支平放的箭头绕竖轴转，跟着镜头甩的方向摆
    const zt = 50 + T.h + 96, cx = T.x + T.w / 2, cy = T.y + T.d / 2;
    box(x, cx - 3, cy - 3, zt, 6, 6, 60, P.ink2);
    const an = 0.6 + Math.sin(b * 0.9) * 0.5 + 0.8 * Math.sin(b * 0.23);
    const arrow = [[-46, -4], [26, -4], [26, -14], [50, 0], [26, 14], [26, 4], [-46, 4], [-56, 14], [-56, -14]];
    poly(x, arrow.map(([u, v]) => wp(cx + u * Math.cos(an) - v * Math.sin(an), cy + u * Math.sin(an) + v * Math.cos(an), zt + 52)), SIG);
    box(x, cx - 2, cy - 2, zt + 40, 4, 4, 22, P.ink2);
  }
  function towerActors(x, e, b) {
    const m = minuteAt(b);
    if (b < AT.dial || m > MINUTES) return;
    const k = (b - AT.dial) * 4 - m;
    put(TOWER.x, TOWER.y, (xx) => ring(xx, TOWER.x + TOWER.w / 2, TOWER.y + TOWER.d / 2, 50 + TOWER.h, 90 + k * 140, SIG, 3, (1 - k) * 0.7), 400);
  }
  function clockLabels(x, e, b, st) {
    const a = live(st, b), s = 1 / st.c[2];
    if (a <= 0) return;
    const X0 = st.c[0] + (1000 - 960) * s, Y0 = st.c[1] + (60 - 540) * s, W = 870 * s, RH = 40 * s, top = Y0 + 150 * s;
    plate(x, X0, Y0, W, (210 + JOBS.length * 40) * s, s, a);
    text(x, tr("ch01.f7"), X0 + 28 * s, Y0 + 52 * s, { font: SANS(32 * s), color: P.ink, alpha: a, maxW: W - 150 * s });
    text(x, tr("ch01.chart"), X0 + 28 * s, Y0 + 98 * s, { font: SANS(28 * s, 500), color: P.ink2, alpha: a });
    const mNow = clamp((b - AT.dial) * 4, 0, MINUTES + 0.999);
    text(x, `:${String(Math.min(MINUTES, Math.floor(mNow))).padStart(2, "0")}`, X0 + W - 28 * s, Y0 + 52 * s, { font: MONO(32 * s, 600), color: SIG, align: "right", alpha: a });
    const gx = X0 + 410 * s, cw = (W - 430 * s) / MINUTES;
    JOBS.forEach(([name], j) => {
      const y = top + j * RH;
      text(x, name, X0 + 28 * s, y + 10 * s, { font: MONO(28 * s), color: P.ink2, alpha: a });
      for (let m = 0; m < MINUTES; m++) {
        const cx = gx + m * cw + cw / 2, hit = due(j, m), done = b >= AT.dial + m / 4;
        x.globalAlpha = a;
        if (hit && done) { x.fillStyle = SIG; x.beginPath(); x.arc(cx, y, 9 * s, 0, TAU); x.fill(); }
        else { x.fillStyle = hit ? rgba(SIG, 0.25) : P.steel; x.beginPath(); x.arc(cx, y, (hit ? 7 : 4) * s, 0, TAU); x.fill(); }
        x.globalAlpha = 1;
      }
    });
    if (b >= AT.dial && mNow < MINUTES) { const cx = gx + Math.floor(mNow) * cw; x.globalAlpha = a * 0.16; x.fillStyle = SIG; x.fillRect(cx, top - RH / 2, cw, JOBS.length * RH); x.globalAlpha = 1; }
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(X0 + 28 * s, top + (JOBS.length - 0.3) * RH, W - 56 * s, 2 * s); x.globalAlpha = 1;
    text(x, tr("ch01.noGate"), X0 + 28 * s, top + (JOBS.length + 0.75) * RH, { font: SANS(28 * s, 500), color: P.ink2, alpha: a, maxW: W - 56 * s });
  }

  // ---------- 没人上报的播放 ----------
  // 一拍一分钟，接着钟楼走；列表变过之后每拍里每 POLL_EVERY 分钟拉一次。推断照 shared/pulse-listening.ts#inferredPlays：
  // 窗口先减去上榜滞后 LAG，后一首的窗口再减去前一首的时长，和前一首的窗口求交，交集中点是开播、半宽是理想误差。
  // PLAYS 的 start 是真正开播的分钟，seen 是第一次看到它的那次拉取；start + LAG 要落在 seen 前一格里，
  // 两次看到新歌才踩在 24:1、25:2 两拍上（配乐的纸滑），所以第一首的时长要在 4.75–5.25 分钟之间。
  const minuteBar = (m) => AT.dial + m / 4;
  const SI = (sx, sy) => [STOP.INFER.c[0] + sx - 960, STOP.INFER.c[1] + sy - 540];
  const AL = { p: SI(560, 150), w: 520, h: 380 };
  const IS = { p: SI(1110, 150), w: 760, h: 380 };
  const PG = { p: SI(1110, 552), w: 760, h: 186 };
  const POLL_EVERY = 0.25, LAG = 5.5 / 60;
  const ARTIST7 = "Aimer";
  const RECENT0 = ["カタオモイ", "蝶々結び", "Brave Shine", "春はゆく"];
  const PLAYS = [{ title: "Ref:rain", len: 4.836, start: 12.86, seen: 13 }, { title: "残響散歌", len: 3.082, start: 17.696, seen: 18 }];
  const W1 = [PLAYS[0].seen - POLL_EVERY - LAG, PLAYS[0].seen - LAG];
  const W2 = [PLAYS[1].seen - POLL_EVERY - LAG, PLAYS[1].seen - LAG];
  const W2B = [W2[0] - PLAYS[0].len, W2[1] - PLAYS[0].len];
  const CROSS = [Math.max(W1[0], W2B[0]), Math.min(W1[1], W2B[1])];
  const EST = (CROSS[0] + CROSS[1]) / 2;
  const MARGIN_S = Math.ceil(((CROSS[1] - CROSS[0]) / 2) * 60);
  const T7 = { seen1: minuteBar(PLAYS[0].seen), seen2: minuteBar(PLAYS[1].seen), shift: 25.75, cross: 26.0, chain: 26.1, page: 26.5, out: 27.7 };
  const FREEZE = 19.5;
  const minuteAt7 = (b) => Math.min((b - AT.dial) * 4, FREEZE);
  const PH7 = [ELSE.x0 + 120, ELSE.y0 + 110, ELSE.z];
  function elsewherePhone(x, b) {
    island(x, ELSE);
    tree(x, ELSE.x0 + 50, ELSE.y0 + 230, 0.8, P.rose);
    box(x, PH7[0], PH7[1] - 60, PH7[2], 26, 140, 250, P.steel);
    const S = onX(PH7[0] + 26, PH7[1] - 60, PH7[2]);
    quad(x, S, 10, 12, 130, 238, P.screen);
    const mb = minuteAt7(b), idx = PLAYS.reduce((n, p, i) => (mb >= p.start ? i : n), -1);
    if (idx >= 0) {
      quad(x, S, 30, 120, 110, 200, idx ? P.lilac : P.rose);
      quad(x, S, 30, 70, 110, 78, P.screenL);
      quad(x, S, 30, 70, 30 + 80 * clamp((mb - PLAYS[idx].start) / PLAYS[idx].len), 78, SIG);
    }
  }
  const mx = (m) => lerp(IS.p[0] + 150, IS.p[0] + IS.w - 30, (m - 11) / 11);
  const ROW = [IS.p[1] + 170, IS.p[1] + 262], AXIS_Y = IS.p[1] + 322;
  function bracket7(x, m0, m1, y, a, hot, dashed = false) {
    if (a <= 0) return;
    const x0 = mx(m0), x1 = mx(m1), h = 36, serif = Math.min(9, (x1 - x0) / 3), col = hot ? SIG : P.ink2;
    x.globalAlpha = (hot ? 0.22 : 0.08) * a; x.fillStyle = SIG; x.fillRect(x0, y - h / 2, x1 - x0, h);
    x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = 2.4; x.save(); if (dashed) x.setLineDash([5, 4]);
    x.beginPath(); x.moveTo(x0 + serif, y - h / 2); x.lineTo(x0, y - h / 2); x.lineTo(x0, y + h / 2); x.lineTo(x0 + serif, y + h / 2);
    x.moveTo(x1 - serif, y - h / 2); x.lineTo(x1, y - h / 2); x.lineTo(x1, y + h / 2); x.lineTo(x1 - serif, y + h / 2); x.stroke(); x.restore(); x.globalAlpha = 1;
  }
  // 游标竖线会扫过这几行注：垫一块牌子色的底，线从字后面过去而不是穿字
  function note7(x, str, lx, ly, color, a, k, maxW) {
    if (a <= 0 || k <= 0) return;
    const w = Math.min(measure(x, str, SANS(28)), maxW ?? Infinity);
    x.globalAlpha = a * k; x.fillStyle = P.plate; x.fillRect(lx - 8, ly - 30, w + 16, 40); x.globalAlpha = 1;
    text(x, str, lx, ly, { font: SANS(28), color, alpha: a * k, maxW });
  }
  function inferStation(x, e, b, st) {
    const a = live(st, b, 0.1, 0.08);
    if (a <= 0) return;
    const [px, py] = wp(PH7[0] + 26, PH7[1] + 10, PH7[2] + 250);
    tag(x, tr("ch01.elsewhere1"), px - 160, py - 160, 1, a, { px: 30 });
    tag(x, tr("ch01.noRep"), px - 160, py - 98, 1, a, { px: 28, color: P.ink2 });
    const mb = minuteAt7(b), idx = PLAYS.reduce((n, p, i) => (mb >= p.start ? i : n), -1);
    if (idx >= 0) {
      const p = PLAYS[idx], fk = prog(b, minuteBar(p.start) - 0.04, minuteBar(p.start) + 0.04);
      const cx0 = px - 160, cy0 = py + 330;
      plate(x, cx0 - 16, cy0 - 50, 330, 120, 1, a);
      withSquash(x, cy0 + 10, squash(fk), () => {
        text(x, p.title, cx0 + 4, cy0, { font: SONG(36), color: SIG, alpha: a });
        text(x, ARTIST7, cx0 + 4, cy0 + 44, { font: SANS(28, 500), color: P.ink2, alpha: a });
      });
    }
    // 拉取：采集 Worker 的虚线从右边进来
    const POLL = [SI(1990, 96), [AL.p[0] + AL.w / 2, SI(0, 96)[1]], [AL.p[0] + AL.w / 2, AL.p[1] - 8]];
    const k = prog(b, st.t0, st.t0 + 0.15, E.out), pa = a * (1 - prog(b, T7.out, T7.out + 0.1));
    dash(x, POLL, P.ink2, 2.4, pa * 0.7 * k, [10, 9]);
    text(x, tr("ch01.col"), SI(1880, 70)[0], SI(0, 70)[1], { font: SANS(28), color: P.ink, align: "right", alpha: pa * k });
    text(x, tr("ch01.active"), AL.p[0] + AL.w / 2 + 24, SI(0, 70)[1], { font: SANS(28), color: P.ink2, alpha: pa * k, maxW: 600 });
    const L = pathAt.length && POLL.slice(1).reduce((u, p, j) => u + Math.hypot(p[0] - POLL[j][0], p[1] - POLL[j][1]), 0);
    for (let q = 12 / POLL_EVERY; q <= FREEZE / POLL_EVERY; q++) {
      const m = q * POLL_EVERY, tick = Number.isInteger(m), t = minuteBar(m), pk = prog(b, t - 0.14, t);
      if (pk > 0 && pk < 1) { const [qx, qy] = pathAt(POLL, pk * L); x.globalAlpha = pa; x.fillStyle = P.ink; x.beginPath(); x.arc(qx, qy, tick ? 7 : 4.5, 0, TAU); x.fill(); x.globalAlpha = 1; }
      if (tick && b >= t) glow(e, POLL[2][0], POLL[2][1], 50, 0.35 * impact(b, t, 0.08) * pa);
    }
    appleList(x, e, b, a * prog(b, st.t0 - 0.05, st.t0 + 0.08, E.out));
    inferSheet(x, e, b, a * prog(b, st.t0 + 0.15, st.t0 + 0.28, E.out));
    pageSheet(x, e, b, a * prog(b, T7.page, T7.page + 0.08, E.out));
  }
  function appleList(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = AL.p;
    plate(x, X0, Y0, AL.w, AL.h, 1, a);
    text(x, tr("ch01.apple"), X0 + 30, Y0 + 54, { font: SANS(32), color: P.ink, alpha: a, maxW: AL.w - 60 });
    text(x, "/v1/me/recent/played/tracks", X0 + 30, Y0 + 94, { font: MONO(28), color: P.ink2, alpha: a, maxW: AL.w - 60 });
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(X0 + 26, Y0 + 114, AL.w - 52, 2); x.globalAlpha = 1;
    const v = b >= T7.seen2 ? 2 : b >= T7.seen1 ? 1 : 0, tSeen = v === 2 ? T7.seen2 : T7.seen1;
    const list = [...PLAYS.slice(0, v).map((p) => p.title).reverse(), ...RECENT0];
    const sk = v ? prog(b, tSeen, tSeen + 0.12, E.out) : 1, hk = v ? 1 - prog(b, tSeen + 0.2, tSeen + 1.1) : 0;
    const RH = 56, y0 = Y0 + 162;
    x.save(); x.beginPath(); x.rect(X0 + 6, Y0 + 120, AL.w - 12, 3 * RH + 4); x.clip();
    list.slice(0, 4).forEach((title, i) => {
      const y = y0 + (i - (1 - sk)) * RH, hot = v > 0 && i === 0;
      if (hot && hk > 0) { x.globalAlpha = 0.16 * hk * a; x.fillStyle = SIG; x.fillRect(X0 + 16, y - 38, AL.w - 32, RH - 6); x.globalAlpha = 1; }
      text(x, String(i + 1), X0 + 34, y, { font: MONO(28), color: P.ink2, alpha: a });
      text(x, title, X0 + 80, y, { font: SONG(32), color: hot && hk > 0.3 ? SIG : P.ink, alpha: a });
      text(x, ARTIST7, X0 + AL.w - 30, y, { font: SANS(28, 500), color: P.ink2, align: "right", alpha: a });
    });
    x.restore();
    if (v > 0) glow(e, X0 + 140, y0 - 12, 100, 0.4 * impact(b, tSeen, 0.25) * a);
    text(x, tr("ch01.newTop"), X0 + 30, Y0 + AL.h - 22, { font: SANS(28), color: P.ink2, alpha: a * prog(b, T7.seen1 + 0.1, T7.seen1 + 0.25), maxW: AL.w - 60 });
  }
  function inferSheet(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = IS.p;
    plate(x, X0, Y0, IS.w, IS.h, 1, a);
    text(x, tr("ch01.infer"), X0 + 30, Y0 + 54, { font: SANS(32), color: P.ink, alpha: a });
    text(x, "inferredPlays", X0 + IS.w - 30, Y0 + 52, { font: MONO(28), color: P.ink2, align: "right", alpha: a });
    const mb = minuteAt7(b);
    x.globalAlpha = a; x.fillStyle = P.steel; x.fillRect(mx(11), AXIS_Y - 1, mx(22) - mx(11), 2);
    for (let m = 11; m <= 22; m++) { x.fillRect(mx(m) - 1, AXIS_Y - 6, 2, 12); }
    x.globalAlpha = 1;
    for (let m = 12; m <= 21; m += 3) text(x, `:${m}`, mx(m), AXIS_Y + 38, { font: MONO(28), color: P.ink2, align: "center", alpha: a });
    for (let q = 12 / POLL_EVERY; q * POLL_EVERY <= mb; q++) {
      const m = q * POLL_EVERY;
      x.globalAlpha = a; x.fillStyle = SIG; x.beginPath(); x.arc(mx(m), AXIS_Y, Number.isInteger(m) ? 5 : 3, 0, TAU); x.fill(); x.globalAlpha = 1;
    }
    if (mb >= 11 && b < T7.out) { x.globalAlpha = 0.45 * a; x.fillStyle = P.ink2; x.fillRect(mx(mb) - 0.6, Y0 + 100, 1.2, AXIS_Y - Y0 - 100); x.globalAlpha = 1; }
    PLAYS.forEach((p, i) => text(x, p.title, X0 + 30, ROW[i] + 11, { font: SONG(30), color: P.ink, alpha: a * prog(b, minuteBar(p.seen), minuteBar(p.seen) + 0.1) }));
    const crossK = prog(b, T7.cross, T7.cross + 0.08);
    note7(x, tr("ch01.win"), mx(W1[0]) - 6, ROW[0] - 32, SIG, a, win(b, T7.seen1 + 0.05, T7.seen1 + 0.2, T7.shift - 0.1, T7.shift));
    const sk = prog(b, T7.shift, T7.cross, E.io);
    const m0 = lerp(W2[0], W2B[0], sk), m1 = lerp(W2[1], W2B[1], sk), y = lerp(ROW[1], ROW[0], sk);
    if (b >= T7.shift) {
      const str = tr("ch01.shift"), sw = measure(x, str, SANS(28));
      // 英文那行比中文长一倍：跟着括号右端走会冲出牌子右边，所以不越过右内沿
      note7(x, str, Math.min(mx(m1) + 14, X0 + IS.w - 30 - sw), y - 26, P.ink2, a, win(b, T7.shift, T7.shift + 0.08, T7.cross - 0.06, T7.cross));
    }
    bracket7(x, W1[0], W1[1], ROW[0], a * prog(b, T7.seen1, T7.seen1 + 0.08, E.out), crossK < 0.5);
    bracket7(x, W2[0], W2[1], ROW[1], a * prog(b, T7.seen2, T7.seen2 + 0.08, E.out), b < T7.shift);
    if (b >= T7.shift) bracket7(x, m0, m1, y, a, crossK < 0.5, true);
    if (crossK > 0) {
      const x0 = mx(CROSS[0]), x1 = mx(CROSS[1]);
      x.globalAlpha = 0.9 * a * crossK; x.fillStyle = SIG; x.fillRect(x0, ROW[0] - 24, Math.max(4, x1 - x0), 48); x.globalAlpha = 1;
      glow(e, (x0 + x1) / 2, ROW[0], 70, 0.6 * impact(b, T7.cross, 0.3) * a);
      // 游标此时定格在 FREEZE，英文这行的右端离它很近：起点贴近括号；垫一块牌子色的底，字再长时线从字后面过去
      const lx = mx(W1[1]) + 40;
      note7(x, tr("ch01.cross"), lx, ROW[0] - 32, SIG, a, prog(b, T7.cross + 0.05, T7.cross + 0.2), X0 + IS.w - 30 - lx);
    }
    const ck = prog(b, T7.chain, T7.chain + 0.3, E.out);
    if (ck > 0) {
      const s0 = EST, e0 = EST + PLAYS[0].len, e1 = e0 + PLAYS[1].len, g = s0 + (e1 - s0) * ck;
      x.globalAlpha = 0.85 * a; x.fillStyle = SIG; x.fillRect(mx(s0), ROW[0] - 7, mx(Math.min(g, e0)) - mx(s0), 14);
      if (g > e0) { x.fillRect(mx(e0), ROW[1] - 7, mx(g) - mx(e0), 14); x.save(); x.setLineDash([4, 4]); x.strokeStyle = SIG; x.lineWidth = 1.6; x.beginPath(); x.moveTo(mx(e0), ROW[0] + 8); x.lineTo(mx(e0), ROW[1] - 8); x.stroke(); x.restore(); }
      x.globalAlpha = 1;
      text(x, tr("ch01.chain"), mx(W2[0]) - 22, ROW[1] + 11, { font: SANS(28), color: P.ink2, align: "right", alpha: a * prog(b, T7.chain + 0.2, T7.chain + 0.35) });
    }
  }
  function pageSheet(x, e, b, a) {
    if (a <= 0) return;
    const [X0, Y0] = PG.p;
    plate(x, X0, Y0, PG.w, PG.h, 1, a);
    text(x, tr("ch01.page"), X0 + 30, Y0 + 44, { font: SANS(28), color: P.ink2, alpha: a });
    const cx0 = X0 + 30, cy0 = Y0 + 66;
    x.globalAlpha = a; x.fillStyle = P.lilac; rr(x, cx0, cy0, 88, 88, 12); x.fill();
    x.strokeStyle = P.plate; x.lineWidth = 2; for (let j = 1; j <= 3; j++) { x.beginPath(); x.arc(cx0 + 44, cy0 + 44, 10 * j, 0, TAU); x.stroke(); }
    x.globalAlpha = 1;
    text(x, "LIKELY PLAYING", cx0 + 108, cy0 + 28, { font: MONO(28, 600), color: SIG, alpha: a });
    text(x, PLAYS[1].title, cx0 + 108, cy0 + 78, { font: SONG(34), color: P.ink, alpha: a });
    x.save(); x.globalAlpha = a; x.strokeStyle = P.ink2; x.lineWidth = 1.8; x.setLineDash([6, 4]); rr(x, cx0 + 260, cy0 + 48, 88, 42, 8); x.stroke(); x.restore();
    text(x, `±${MARGIN_S}s`, cx0 + 304, cy0 + 78, { font: MONO(28), color: P.ink2, align: "center", alpha: a });
    glow(e, cx0 + 200, cy0 + 20, 100, 0.35 * impact(b, T7.page, 0.3) * a);
    const lx = X0 + 400, lw = 330, ly = Y0 + 96;
    text(x, "Listening", lx, Y0 + 84, { font: SANS(28, 500), color: P.ink, alpha: a });
    x.globalAlpha = a * 0.5; x.fillStyle = P.steel; x.fillRect(lx, ly, lw, 22); x.globalAlpha = a; x.fillStyle = tone(P.lilac, 0.15); x.fillRect(lx + lw * 0.04, ly, lw * 0.2, 22); x.globalAlpha = 1;
    const hatch = (x0, y0, w, h, k) => {
      if (k <= 0) return;
      x.save(); x.beginPath(); x.rect(x0, y0, w * k, h); x.clip(); x.globalAlpha = a; x.strokeStyle = SIG; x.lineWidth = 2;
      x.beginPath(); for (let u = x0 - h; u < x0 + w; u += 9) { x.moveTo(u, y0 + h); x.lineTo(u + h, y0); } x.stroke(); x.restore();
      x.globalAlpha = a; x.fillStyle = SIG; x.fillRect(x0, y0, 1.6, h); x.globalAlpha = 1;
    };
    hatch(lx + lw * 0.5, ly, lw * 0.24, 22, prog(b, T7.page + 0.05, T7.page + 0.2));
    hatch(lx + lw * 0.745, ly, lw * 0.195, 22, prog(b, T7.page + 0.15, T7.page + 0.3));
    hatch(lx, Y0 + 138, 28, 16, 1);
    text(x, "Elsewhere (est.)", lx + 40, Y0 + 156, { font: SANS(28, 500), color: P.ink2, alpha: a });
  }

  // ---------- 开场 ----------
  const SRC0 = [[PARK3[0], PARK3[1], 60], [PHN.x, PHN.y + 90, 260], [CT3[0], CT3[1], 80], [NAS.x + 90, NAS.y + 70, 160], [2250, -360, TOKYO.z + 180], [930, 120, CLOUD.z + 60]];
  const EXIT0 = [2700, -600, 300];
  function openLabels(x, e, b, st) {
    const a = win(b, 0, 0.02, st.t1 - 0.12, st.t1), s = 1 / st.c[2];
    if (a <= 0) return;
    SRC0.forEach((p, i) => {
      for (let j = 0; j < 2; j++) {
        const t0 = 0.25 + i * 0.13 + j * 0.85, k = prog(b, t0, t0 + 0.7, E.io);
        if (k <= 0 || k >= 1) continue;
        const q = lerp3(p, EXIT0, k);
        q[2] += Math.sin(k * Math.PI) * 300;
        const [qx, qy] = wp(...q);
        envFlat(x, qx, qy, 1.1 * s, a * (1 - prog(k, 0.85, 1)));
      }
    });
    // 拉取的虚线从钟楼顶伸向左上角画外（第三方接口在岛外），从标题上方过去，不压字
    const [tx, ty] = wp(TOWER.x + TOWER.w / 2, TOWER.y + TOWER.d / 2, 50 + TOWER.h + 120);
    const c = st.c, SC = (u, v) => [c[0] + (u - 960) * s, c[1] + (v - 540) * s];
    for (let j = 0; j < 3; j++) {
      const t0 = 0.4 + j * 0.55, k = prog(b, t0, t0 + 0.5);
      const far = SC(-40 + j * 70, 8 + j * 26);
      dash(x, [[tx, ty], far], P.ink2, 3 * s, a * 0.6 * prog(b, 0.3, 0.5), [12 * s, 12 * s]);
      if (k > 0 && k < 1) { const u = k < 0.5 ? k * 2 : 2 - 2 * k; x.globalAlpha = a; x.fillStyle = P.ink; x.beginPath(); x.arc(lerp(tx, far[0], u), lerp(ty, far[1], u), 9 * s, 0, TAU); x.fill(); x.globalAlpha = 1; }
    }
    const la = a * prog(b, 0.35, 0.5);
    const [rx, ry] = wp(1500, 900, 300);
    tag(x, tr("ch01.push"), rx + 200 * s, ry - 120 * s, s, la, { px: 32 });
    tag(x, tr("ch01.pull"), tx + 70 * s, ty + 12 * s, s, la, { px: 32 });
    const [px, py] = SC(110, 196);
    const ta = prog(b, AT.title, AT.title + 0.1, E.out) * a;
    if (ta > 0) {
      // 英文标题比中文长：右沿离钟楼尖顶的左檐至少 24 px（转台转回 0 时离得最近，按那时的投影算），放不下就靠 maxW 缩字号
      const eave = pj(TOWER.x - TOWER_EAVE, TOWER.y + TOWER.d + TOWER_EAVE, 50 + TOWER.h)[0];
      x.save(); x.translate(px, py); const sc = lerp(0.85, 1, E.outBack(prog(b, AT.title, AT.title + 0.14))); x.scale(sc, sc);
      text(x, tr("ch01.title"), 0, 0, { font: SANS(96 * s, 600), color: P.ink, alpha: ta, maxW: eave - 24 * s - px });
      text(x, "reporters · collector Worker", 4 * s, 64 * s, { font: MONO(30 * s), color: P.ink2, alpha: ta });
      x.restore();
    }
  }

  // ---------- 结尾：Clawd 骑上信封的火花 ----------
  const OUT = [PARK, [PARK[0] + 1810, PARK[1]]];
  // 末端 1100 让 Clawd 在 N − 0.03 左右整只出右缘，之后屏幕上只剩拖尾贴着右边。
  const rideD = (b) => keys(b, [[AT.launch, 0], [N - 0.02, 1100, E.inExpo]]);
  function guide(x, b) {
    const gA = prog(b, AT.back + 0.02, AT.back + 0.16, E.out);
    if (gA <= 0) return;
    dash(x, [[PARK[0] + 44, PARK[1]], [PARK[0] + 1070, PARK[1]]], P.ink2, 2, 0.5 * gA, [8, 8]);
    // 标在线下：Clawd 骑着火花沿线跑过去，标在线上会被它整只盖住。
    tag(x, "→ ingest.homepage.lyjw.llc", PARK[0] + 900, PARK[1] + 58, 1, gA, { px: 28, font: MONO, align: "right", color: P.ink2 });
  }
  function hero(x, e, b) {
    if (b < AT.back) return;
    guide(x, b);
    if (b < AT.launch) {
      const lit = prog(b, AT.back, AT.back + 0.1);
      glow(e, PARK[0], PARK[1], 150, 0.6 * impact(b, AT.back, 0.25) + 0.2 * lit);
      return;
    }
    const dd = rideD(b), head = pathAt(OUT, dd), trail = trailOn(OUT, dd, lerp(80, 520, prog(b, AT.launch, N - 0.2)), 18);
    K.spark(e, x, head, trail, { t: G.t, size: 1.1, lw: 2.4, color: SIGD });
    // 浅底上加性的亮核会发白：垫一颗实心的橙核
    x.globalAlpha = 1; x.fillStyle = SIG; x.beginPath(); x.arc(head[0], head[1], 7, 0, TAU); x.fill();
    x.fillStyle = "#FFE6D2"; x.beginPath(); x.arc(head[0], head[1], 3.5, 0, TAU); x.fill();
    glow(e, head[0], head[1], 150, 0.6 * impact(b, AT.back, 0.25));
  }
  // 骑行的信封在导轨上：起跑这一帧接停靠时的大小，信封随 Clawd 跳上去淡掉
  function heroEnvelope(b) {
    if (b < AT.launch || b > CL.leap[1] + 0.05) return;
    const head = pathAt(OUT, rideD(b)), dX = (head[0] - PARK[0]) / (2 * C30);
    const X = PARK3[0] + dX, Y = PARK3[1] - dX;
    put(X, Y, (xx) => envBox(xx, X, Y, PARK3[2] - 12, lerp(1.5, 1.1, prog(b, AT.launch, AT.launch + 0.12, E.out)), { a: 1 - prog(b, CL.leap[0], CL.leap[1] + 0.04) }), 2);
  }
  // 交给第 02 章：骑行时 Clawd 蹲着（pose default、crouch 1、不翻转），正面 18 格宽 126 px，
  // 中心对着火花亮核，底边比亮核高 7 px；亮核在屏幕 y 540。第 02 章 0:0 照这个从左缘接（ch02.js 的 CL.qRide）。
  const CL = { drop: [N - 1, N - 0.92], say: [N - 0.91, N - 0.32], leap: [N - 0.34, N - 0.23], stand: [PARK[0] + 180, PARK[1] - 0.7], qs: 7, lift: 7 };
  // 等距版 Clawd：每格正面就是 K.clawd 那一格（q 宽、2q 高），往右上挤出一点厚度当小方块；正面轮廓和第 02 章的平面 Clawd 一样
  const CLAWD_TOP = "#EFA283", CLAWD_SIDE = "#B05A40";
  function isoClawd(x, fr, cx, bottom, q, o = {}) {
    const f = fr || { pose: "default", offset: 0 };
    const px = cx + (f.x || 0) * 2 * q, a = o.alpha ?? 1;
    const { body, eyes } = window.Clawd.cells(f.pose, f.offset || 0);
    const ox = px - 9 * q, oy = bottom - 12 * q, ex = 0.62 * q, ey = -0.36 * q;
    const all = new Set([...body, ...eyes].map(([i, j]) => i + "," + j)), has = (i, j) => all.has(i + "," + j);
    x.save(); x.globalAlpha = a;
    x.fillStyle = CLAWD_TOP;
    for (const [i, j] of [...body, ...eyes]) if (!has(i, j - 1)) { const X = ox + i * q, Y = oy + j * 2 * q; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + q + 0.4, Y); x.lineTo(X + q + 0.4 + ex, Y + ey); x.lineTo(X + ex, Y + ey); x.closePath(); x.fill(); }
    x.fillStyle = CLAWD_SIDE;
    for (const [i, j] of [...body, ...eyes]) if (!has(i + 1, j)) { const X = ox + (i + 1) * q, Y = oy + j * 2 * q; x.beginPath(); x.moveTo(X, Y); x.lineTo(X, Y + 2 * q + 0.4); x.lineTo(X + ex, Y + 2 * q + 0.4 + ey); x.lineTo(X + ex, Y + ey); x.closePath(); x.fill(); }
    x.fillStyle = SIG;
    for (const [i, j] of body) x.fillRect(ox + i * q, oy + j * 2 * q, q + 0.4, 2 * q + 0.4);
    x.fillStyle = "#1E1424";
    for (const [i, j] of eyes) x.fillRect(ox + i * q, oy + j * 2 * q, q + 0.4, 2 * q + 0.4);
    x.restore();
    if (f.poof) for (const sgn of [-1, 1]) text(x, f.poof === "dot" ? "·" : "~", px + sgn * 8 * q, bottom - q * 0.6, { font: MONO(q * 2.6, 600), color: P.ink2, align: "center", texture: true, alpha: a });
  }
  function bubble(x, str, bx, by, z, k, reveal) {
    if (k <= 0) return;
    const s = 1 / z, f = SANS(34 * s, 600), tw = measure(x, str, f), pad = 18 * s, bw = tw + pad * 2, bh = 70 * s;
    x.save(); x.translate(bx, by); const sc = lerp(0.6, 1, E.outBack(clamp(k * 1.6))); x.scale(sc, sc);
    const a = clamp(k * 4);
    plate(x, 0, -bh, bw, bh, s, a);
    x.globalAlpha = a; x.fillStyle = P.plate; x.beginPath(); x.moveTo(18 * s, -2 * s); x.lineTo(6 * s, 20 * s); x.lineTo(42 * s, -2 * s); x.fill(); x.globalAlpha = 1;
    text(x, str, pad, -bh + 48 * s, { font: f, color: P.ink, alpha: a, reveal, perChar: true, fadeIn: false });
    x.restore();
  }
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
    isoClawd(tp, fr, cx, cy, q);
    const k = prog(b, CL.say[0], CL.say[0] + 0.06) * (1 - prog(b, CL.say[1] - 0.04, CL.say[1]));
    if (k > 0) bubble(tp, tr("ch01.clawd"), sx - 56 / z, sy - 12 * q - 10 / z, z, k, prog(b, CL.say[0] + 0.01, CL.say[0] + 0.13));
  }

  // ---------- 合成 ----------
  const MAIN_CAST = [[130, 870, 340, 14, 182], [130, 870, 14, 340, 182], [VAULT.x, VAULT.y, VAULT.w, VAULT.d, VAULT.h], [NAS.x, NAS.y, NAS.w, NAS.d, NAS.h + 46],
    [PHN.x, PHN.y, PHN.w, PHN.d, PHN.z + PHN.h], [JEV.x, JEV.y, JEV.w, JEV.d, JEV.h], [TOWER.x, TOWER.y, TOWER.w, TOWER.d, 50 + TOWER.h + 60], [1240, 90, 360, 14, 162], [1240, 90, 14, 330, 162],
    [HUB[0] - 40, HUB[1] - 40, 80, 80, 114]];
  const TREES = [[640, 160, 1.2], [760, 260, 0.9], [1740, 1250, 0.9], [80, 700, 1.1], [1000, 760, 0.9], [1720, 470, 0.8], [520, 640, 1.0]];
  function world(x, e, b) {
    island(x, MAIN);
    grid(x, MAIN);
    shadows(x, MAIN_CAST.concat(TREES.map(([u, v, s]) => [u - 20 * s, v - 20 * s, 40 * s, 40 * s, 78 * s])), topPoly(MAIN));
    put(ROOM.x0, ROOM.y0, (xx) => macRoom(xx, b), 60);
    put(...RAIL[1], (xx) => rail(xx), 600);
    put(BELT.x0, BELT.y, (xx) => gate(xx, b), 200);
    put(VAULT.x, VAULT.y, (xx) => vault(xx, b), 120);
    put(PHN.x, PHN.y, (xx) => phone(xx, b), 60);
    put(HOUSE.x0, HOUSE.y0, (xx) => house(xx, b), 160);
    put(TOWER.x, TOWER.y, (xx) => tower(xx, b), 100);
    put(...HUB, (xx) => hub(xx, b), 0);
    for (const [u, v, s] of TREES) put(u, v, (xx) => tree(xx, u, v, s));
    macActors(x, e, b); gateActors(x, e, b); imgActors(x, e, b); phoneActors(x, e, b); towerActors(x, e, b); heroEnvelope(b);
    flush(x);
    island(x, TOKYO); tokyo(x, b);
    cloud(x, b);
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    SIG = G.css("signal"); SIGD = G.css("signalD");
    ROT = b < STOP.S0.t1 ? lerp(0.36, 0, E.out(prog(b, 0, STOP.S0.t1))) : 0;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.judged, 0.1), impact(b, AT.merge, 0.12), impact(b, AT.back, 0.12));
    cam.zoom *= 1 + 0.01 * hitS;
    G.setCam(cam);
    SEAM = 1.2 / cam.zoom;
    G.clear([0.93, 0.85, 0.88]);
    const x = bg.begin();
    sky(x);
    farIsles(x, cam);
    bg.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const tp = top.begin(); top.cam(cam);

    island(x, ELSE); elsewherePhone(x, b);
    world(x, e, b);

    openLabels(x, e, b, STOP.S0);
    macLabels(x, b, STOP.MAC);
    gateLabels(x, e, b, STOP.GATE);
    imgLabels(x, e, b, STOP.IMG);
    phoneLabels(x, e, b, STOP.PHONE);
    homeLabels(x, e, b, STOP.HOME);
    tokyoLabels(x, e, b, STOP.TOKYO);
    codeLabels(x, e, b, STOP.CODE);
    clockLabels(x, e, b, STOP.CLOCK);
    inferStation(x, e, b, STOP.INFER);

    nar(x, "ch01.n1a", "ch01.n1b", STOP.S0, 0.35, 2.15, b, [110, 930]);
    nar(x, "ch01.n2a", "ch01.n2b", STOP.MAC, 2.8, 4.9, b, [110, 930]);
    nar(x, "ch01.n3a", "ch01.n3b", STOP.GATE, 5.55, 7.65, b, [110, 930]);
    nar(x, "ch01.n4a", "ch01.n4b", STOP.IMG, 8.3, 10.4, b, [110, 930]);
    nar(x, "ch01.n5a", "ch01.n5b", STOP.PHONE, 11.05, 12.9, b, [110, 930]);
    nar(x, "ch01.n6a", "ch01.n6b", STOP.HOME, 13.55, 15.4, b, [110, 930]);
    nar(x, "ch01.n7a", "ch01.n7b", STOP.TOKYO, 16.05, 17.9, b, [110, 930]);
    nar(x, "ch01.n8a", "ch01.n8b", STOP.CODE, 18.55, 20.65, b, [110, 930]);
    nar(x, "ch01.n9a", "ch01.n9b", STOP.CLOCK, 21.3, 23.65, b, [110, 930]);
    nar(x, "ch01.n10a", "ch01.n10b", STOP.INFER, 24.05, 25.97, b, [110, 930]);
    nar(x, "ch01.n11a", "ch01.n11b", STOP.INFER, 26.05, 27.62, b, [110, 930]);

    hero(tp, e, b);
    clawdRide(tp, b, cam.zoom, f.BAR);

    G.composite(bg.upload(), { mode: G.MODE.normal });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 0.9 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 4;
    f.post = {
      bloom: 0.25, threshold: 1.0, halation: 0, grain: 0, vignette: 0.1, ca: 0,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch01", title: "ch.01", bars: N,
    async init() {
      bg = G.layer("bg"); emit = G.layer("emit", 0.5); top = G.layer("top");
      await Promise.all([
        document.fonts.load(`600 40px ${LAT}`, "Field"), document.fonts.load(`500 40px ${LAT}`, "Field"),
        document.fonts.load(`600 40px ${ZH}`, "野外观测站"), document.fonts.load(`700 40px ${JP}`, "夜に駆ける"),
      ]);
    },
    render,
  });
})();
