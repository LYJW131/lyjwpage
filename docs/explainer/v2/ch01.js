// 第 01 章：漂浮小岛的立体微缩。模型在 ch01-models.js 搭、ch01-world.js 用 three.js 渲染；字、牌子、火花都画在 2D 层，锚点从 3D 投影过来（ch01-labels.js、ch01-collector.js）。
// 画面只从 AT 取时间，不读配乐的音符表（score.js 加载失败时这一章照样画得出来）。
(() => {
  const { E, prog, keys, clamp, lerp, trailOn } = K;
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
  const NS = (window.CH01 = window.CH01 || {});
  const TAU = Math.PI * 2;
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
  const parse = (c) => (c[0] === "#" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
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
  const hex = (c) => "#" + parse(c).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  // 时间：小节:拍写成小节数（3:2 写 3.5）；music/ch01.js 的时刻抄这张表和 STOP，改了两边一起改
  const AT = {
    title: 0.7,
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
  const PROB = [0.34, 0.81, 0.22, 0.63];
  const L = () => NS.W.L;
  const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

  // 窗口标题那块牌子的路线：从 Mac 落到传送带上，穿过 Jev，进放行的托盘
  function tilePath(k) {
    const { LAP, EXITS, BELT } = L(), z = BELT.z;
    const pts = [[LAP.x + 54, LAP.y + 20, LAP.z + 40], [520, 1121, z], [646, 1121, z], [700, 1121, z], [895, 1121, z], [EXITS[0][0] + 8, EXITS[0][1] + 16, z]];
    const T = [AT.wt, AT.wt + 0.22, AT.list + 0.1, AT.jev, AT.judged + 0.1, AT.cleared];
    for (let i = 1; i < T.length; i++) if (k < T[i] || i === T.length - 1) {
      const u = prog(k, T[i - 1], T[i], i === 1 ? E.io : E.lin), p = lerp3(pts[i - 1], pts[i], u);
      if (i === 1) p[2] += Math.sin(u * Math.PI) * 70;
      if (i === 5) p[2] += Math.sin(u * Math.PI) * 50;
      return p;
    }
    return pts[pts.length - 1];
  }
  const drawerOut = (b) => Math.max(win(b, AT.drop - 0.12, AT.drop - 0.02, AT.shut - 0.06, AT.shut), win(b, AT.posterIn - 0.14, AT.posterIn - 0.04, AT.posterIn + 0.18, AT.posterIn + 0.25));

  // 每个机位 [名字, 到位, 起甩]；停住时慢推 1.5%，标注只在本机位到位后亮、起甩前收
  const STOP = {};
  [["S0", 0, 2.2], ["MAC", 2.5, 4.95], ["GATE", 5.25, 7.7], ["IMG", 8.0, 10.45], ["PHONE", 10.75, 12.95], ["HOME", 13.25, 15.45],
    ["TOKYO", 15.75, 17.95], ["CODE", 18.25, 20.7], ["CLOCK", 21.0, 23.7], ["INFER", 24.0, 27.7]].forEach(([k, t0, t1]) => (STOP[k] = { k, t0, t1 }));
  const live = (st, b, d0 = 0.1, d1 = 0.12) => win(b, st.t0, st.t0 + d0, st.t1 - d1, st.t1);
  // 镜头进家里之前把屋顶整个掀走，离开时盖回去
  const roofLift = (b) => E.io(prog(b, STOP.HOME.t0 - 0.3, STOP.HOME.t0 + 0.05)) * (1 - E.io(prog(b, STOP.HOME.t1 + 0.02, STOP.HOME.t1 + 0.3)));

  // 别处那台 iPhone 的播放：一拍一分钟，接着钟楼走，到 FREEZE 定住。推断的算法见 ch01-labels.js 的 inferSheet
  const FREEZE = 19.5;
  const minuteAt7 = (b) => Math.min((b - AT.dial) * 4, FREEZE);
  const PLAYS = [{ title: "Ref:rain", len: 4.836, start: 12.86, seen: 13 }, { title: "残响散歌", len: 3.082, start: 17.696, seen: 18 }];

  Object.assign(NS, { N, tr, P, tone, rgba, impact, win, SANS, SONG, MONO, AT, PROB, STOP, live, tilePath, drawerOut, roofLift, FREEZE, minuteAt7, PLAYS, SIG: "#D97757", SIGD: "#E48E6E", SIGH: "#D97757" });

  // 机位 v = { at 画面中心对着的世界点, az 方位, el 仰角（度）, d 距离, zoom, aper 景深光圈 }。视角 26°，FOCAL 是落点处一单位长的屏幕 px × 距离
  const FOCAL = 540 / Math.tan((13 * Math.PI) / 180);
  const D2R = Math.PI / 180;
  const right = (az) => [Math.cos(az * D2R), -Math.sin(az * D2R)];
  const up = (v) => { const a = v.az * D2R, e = v.el * D2R; return [-Math.sin(e) * Math.sin(a), -Math.sin(e) * Math.cos(a), Math.cos(e)]; };
  const ppuOf = (v) => FOCAL / v.d;
  const add3 = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + (d[2] || 0) * k];
  // aim：让世界点 Pw 落在屏幕 (sx, sy)，按落点那一层的深度算
  function aim(Pw, sx, sy, v) {
    const r = right(v.az), u = up(v), k = 1 / ppuOf(v), a = (sx - 960) * k, c = (540 - sy) * k;
    return { ...v, at: [Pw[0] - r[0] * a - u[0] * c, Pw[1] - r[1] * a - u[1] * c, Pw[2] - u[2] * c] };
  }
  const fwd = (v) => { const a = v.az * D2R, e = v.el * D2R; return [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), -Math.sin(e)]; };
  function screenX(v, Pw) {
    const f = fwd(v), r = right(v.az), C = add3(v.at, f, -v.d), q = [Pw[0] - C[0], Pw[1] - C[1], Pw[2] - C[2]];
    return 960 + (FOCAL * (v.zoom ?? 1) * (q[0] * r[0] + q[1] * r[1])) / (q[0] * f[0] + q[1] * f[1] + q[2] * f[2]);
  }
  const eave = () => { const T = L().TOWER; return [T.x - 12, T.y + T.d + 12, 50 + T.h]; };
  // 标题块（标题加副标）放左上角时的右沿，含弹出回弹的 2%；离钟楼尖顶的左檐（按 S0 转回 45° 后算）不到 24 px 就整块挪到右下角，返回 0
  const SUB = (NS.titleSub = "reporters · collector Worker");
  function titleRight(x) {
    const w = 1.02 * Math.max(K.measure(x, tr("ch01.title"), SANS(96, 600)), 4 + K.measure(x, SUB, MONO(30)));
    return 110 + w + 24 <= screenX(SHOT.S0, eave()) ? 110 + w : 0;
  }
  const SHOT = {
    S0: { at: [1010, 400, 0], az: 45, el: 33, d: 4150, aper: 10 },
    MAC: { at: [380, 1000, 70], az: 36, el: 27, d: 1290, aper: 24 },
    GATE: aim([795, 1076, 168], 900, 330, { az: 30, el: 30, d: 1330, aper: 24 }),
    IMG: { at: [1310, 1110, 70], az: 47, el: 32, d: 1330, aper: 24 },
    PHONE: { at: [1560, 690, 120], az: 55, el: 25, d: 1320, aper: 24 },
    HOME: { at: [1330, 330, 40], az: 40, el: 50, d: 1560, aper: 20 },
    TOKYO: { at: [2210, -310, 190], az: 51, el: 27, d: 1320, aper: 24 },
    CODE: { at: [930, 380, 90], az: 45, el: 35, d: 2050, aper: 18 },
    CLOCK: aim([300, 260, 300], 360, 500, { az: 34, el: 18, d: 1600, aper: 22 }),
    INFER: aim([-1274, -140, 392], 340, 270, { az: 56, el: 26, d: 1880, aper: 20 }),
  };
  // 钟楼的任务表盘浮出后停在 CLOCK 机位前方：屏幕中心 (sx, sy)、半径约 R px，比机位的落点近 near，面朝镜头再往左偏 yaw 度，看得出盘面的厚度（ch01-dial.js）
  const DIAL_AT = { sx: 660, sy: 440, R: 215, near: 350, yaw: 18 };
  NS.DIAL = (() => {
    const v = SHOT.CLOCK, f = fwd(v), r = [...right(v.az), 0], u = up(v), dep = v.d - DIAL_AT.near, C = add3(v.at, f, -v.d), k = dep / FOCAL;
    const c = [0, 1, 2].map((i) => C[i] + (f[i] * FOCAL + r[i] * (DIAL_AT.sx - 960) + u[i] * (540 - DIAL_AT.sy)) * k);
    const cy = Math.cos(DIAL_AT.yaw * D2R), sy = Math.sin(DIAL_AT.yaw * D2R);
    return { c, r: r.map((q, i) => q * cy - f[i] * sy), u, n: f.map((q, i) => -q * cy - r[i] * sy), R: (DIAL_AT.R * dep) / FOCAL };
  })();
  const depthOf = (v, Pw) => { const f = fwd(v), C = add3(v.at, f, -v.d); return (Pw[0] - C[0]) * f[0] + (Pw[1] - C[1]) * f[1] + (Pw[2] - C[2]) * f[2]; };
  const PARK3 = [560, 990, 53];
  const END = { at: PARK3, az: 45, el: 32, d: FOCAL / (Math.SQRT2 * Math.cos(Math.PI / 6)), aper: 22 };
  function truck(v, px) { const r = right(v.az), k = px / ppuOf(v); return { ...v, at: [v.at[0] + r[0] * k, v.at[1] + r[1] * k, v.at[2]] }; }
  const hold = (v, k) => ({ ...truck(v, 10 * k), d: v.d / (1 + 0.015 * k) });
  // 两个机位之间：落点、方位、仰角按缓动走，距离按对数走；中途升高、退远一点再落下（同一种镜头语言，不打转）
  function move(a, c, k0) {
    const k = E.io(k0), arc = Math.sin(k * Math.PI);
    return {
      at: lerp3(a.at, c.at, k), az: lerp(a.az, c.az, k), el: lerp(a.el, c.el, k) + 7 * arc,
      d: Math.exp(lerp(Math.log(a.d), Math.log(c.d), k)) * (1 + 0.22 * arc), zoom: 1, aper: lerp(a.aper, c.aper, k),
    };
  }

  // 开头：接第 00 章晒图上的笔记本（ch00.js#CUT 经 share.cut 给首帧的屏幕位置和大小，两边须同步）
  // 首帧镜头从正前方（方位 0°）微微俯看笔记本：仰角等于盖子后仰的角度，屏幕正对镜头，是一块方方正正的矩形，和晒图小样同处同大；
  // paint 内蓝底从笔记本往外化开、红线变到笔记本的轮廓上再淡掉，pull 内拉出到 S0 全景，方位在 S0 停留期间转回 45°。
  const BP = { paint: [0.03, 0.3], morph: [0.02, 0.24], pull: [0.18, 0.7], R0: -45 };
  const cut00 = () => window.CHAPTERS.find((c) => c.id === "ch00")?.share?.cut;
  const rotAt = (b) => (b < STOP.S0.t1 ? BP.R0 * (1 - E.out(prog(b, BP.pull[0], STOP.S0.t1))) : 0);
  function camOpen(b) {
    const cut = cut00(), s = cut ? cut.s * (1 + cut.rate * b) : 14, az = SHOT.S0.az + rotAt(b);
    const W = NS.W, c = W.L.lidPoint(W.L.LID.w / 2, W.L.LID.h / 2), el = (W.L.LID_TILT * 180) / Math.PI;
    // 盖子宽 108 对上小样的 52 格；小样的框心在屏幕中心上方 2 格（ch00.js#CUT 的 at 比框心低 2 格）
    const d1 = (FOCAL * W.L.LID.w) / (52 * s), lid = { az, el, d: d1, aper: 0 };
    lid.at = add3(c, up(lid), -(2 * s) / (FOCAL / d1));
    let S = { ...hold(SHOT.S0, E.out(prog(b, BP.pull[1], STOP.S0.t1))), az };
    // 方位还没转回 45° 时钟楼偏左，会贴上左上角的标题块：镜头往左平移到左檐离标题块右沿 24 px（平移量对屏幕 x 是线性的，一步解出）
    if (NS.titleR) {
      const need = NS.titleR + 24 - screenX(S, eave());
      if (need > 0) { const d1 = screenX(truck(S, -need), eave()) - screenX(S, eave()); S = truck(S, (-need * need) / d1); }
    }
    const k = E.io(prog(b, BP.pull[0], BP.pull[1]));
    if (k <= 0) return { ...lid, zoom: 1 };
    return { at: lerp3(lid.at, S.at, k), az, el: lerp(el, S.el, k), d: Math.exp(lerp(Math.log(d1), Math.log(S.d), k)), zoom: 1, aper: lerp(0, S.aper, k) };
  }

  // 结尾机位：亮核正在屏幕 y 540（交给第 02 章的高度），镜头一小节里从停靠点左 10 px 平移到右 4 px、缩放 1 → 1.014；导轨沿镜头的右方向，在屏幕上是一条水平线
  // 末端 1100 让 Clawd 在 N − 0.03 左右整只出右缘，之后屏幕上只剩拖尾贴着右边。
  const rideD = (b) => keys(b, [[AT.launch, 0], [N - 0.02, 1100, E.inExpo]]);
  // 交给第 02 章的甩镜头：最后 0.25 小节镜头往右 E.inExpo 加速横甩，到 N 走完 dx；骑手、火花加上同一段位移，屏幕上的骑乘轨迹不变。
  // 末两帧第 02 章的红斜块从右缘进画（ch02.js 的 share.whipBand），N:0（第 02 章 0:0）那一帧它的左下角在 slabX；ch02.js#WHIP 用同一出口速度接着刹停，两边须同步。
  const WHIP = { t0: N - 0.25, dx: 2200, slabX: 900 };
  const whipX = (b) => WHIP.dx * E.inExpo(prog(b, WHIP.t0, N));
  const endView = (b) => ({ ...truck(END, lerp(-10, 4, prog(b, AT.back, N)) + whipX(b)), zoom: lerp(1, 1.014, prog(b, AT.back, N)) });
  // 轨上一点：从停靠点沿导轨（镜头右方向）走 px 屏幕像素，再加甩镜头的位移
  const onRail = (px, b) => { const r = right(END.az), k = (px + whipX(b)) / ppuOf(END); return [PARK3[0] + r[0] * k, PARK3[1] + r[1] * k, PARK3[2]]; };

  function viewAt(b) {
    if (b < STOP.S0.t1) return camOpen(b);
    const list = Object.values(STOP);
    for (let i = 1; i < list.length; i++) {
      const st = list[i], prev = list[i - 1];
      if (b < st.t0) return move(hold(SHOT[prev.k], 1), SHOT[st.k], prog(b, prev.t1, st.t0));
      if (b < st.t1) return { ...hold(SHOT[st.k], prog(b, st.t0, st.t1)), zoom: 1 };
    }
    if (b < AT.back) return move(hold(SHOT.INFER, 1), endView(AT.back), prog(b, STOP.INFER.t1, AT.back));
    return endView(b);
  }

  const SRC0 = () => { const { PHN, CT3, NAS, CLOUD, TOKYO } = L(); return [[PARK3[0], PARK3[1], 60], [PHN.x, PHN.y + 90, 260], [CT3[0], CT3[1], 80], [NAS.x + 90, NAS.y + 70, 160], [2250, -360, TOKYO.z + 180], [930, 120, CLOUD.z + 60]]; };
  const EXIT0 = [2700, -600, 300];
  const yawOf = (dx, dy) => Math.atan2(-dy, dx);
  // Mac 的应用图标从 Jev 的出口升到 R2 柜顶上方，在那儿拆成哈希：落点高过柜顶，镜头这边没有东西挡着（ch01-world.js 画图标，ch01-labels.js 的标签跟着它）
  NS.iconAt = (b) => { const k = prog(b, AT.icon, AT.hash, E.out); return [lerp(900, 1120, k), lerp(1300, 1150, k), lerp(90, 250, k) + Math.sin(k * Math.PI) * 40]; };
  // 风向标指着镜头最近一路甩过去的方向：过去 3 小节里落点的位移按 e^(−Δ/1.2 小节) 衰减相加，取它的方位，再加一点风里的晃
  NS.vaneYaw = (b) => {
    let sx = 1, sy = 0, a = viewAt(b).at;
    for (let k = 1; k <= 30; k++) {
      const p = viewAt(b - k * 0.1).at, w = Math.exp((-(k - 1) * 0.1) / 1.2);
      sx += (a[0] - p[0]) * w; sy += (a[1] - p[1]) * w; a = p;
    }
    return yawOf(sx, sy) + 0.12 * Math.sin(b * 2.1);
  };
  // 交给第 02 章：骑行时 Clawd 蹲着（pose default、不翻转），正面 18 格宽 126 px，中心对着火花亮核，底边比亮核高 7 px；第 02 章 0:0 照这个从左缘接（ch02.js 的 CL.qRide）。
  const CL = { drop: [N - 1, N - 0.92], say: [N - 0.91, N - 0.32], leap: [N - 0.34, N - 0.23], stand: 180, qs: 7, lift: 7 };
  // 落地的挤压按欠阻尼弹簧的闭式解：A·e^(−t/τ)·cos(ωt)，t 是落地后的秒数
  const spring = (b, t0, A) => { const t = (b - t0) * BARs; return t < 0 ? 0 : A * Math.exp(-t / 0.09) * Math.cos(t * 30); };
  function clawdRide(b, BAR) {
    if (b < CL.drop[0]) return null;
    const v = NS.cur, ppu = ppuOf(END) * v.zoom, q = CL.qs / ppu, lift = 1 / (ppu * Math.cos(v.el * D2R));
    const stand = onRail(CL.stand, b), st = [stand[0], stand[1], L().RAIL_Z];
    // 骑行时正面贴在导轨那一层（往后让半个身子的厚度）：正面的屏幕宽正好 126 px，正面底边比亮核高 7 px
    const head = onRail(rideD(b), b), back = 2.5 * q, a = v.az * D2R;
    const ride = [head[0] - Math.sin(a) * back, head[1] - Math.cos(a) * back, head[2] + CL.lift * lift];
    const frameAt = (t0) => Math.floor(((b - t0) * BAR * 1000) / window.Clawd.FRAME_MS + 1e-6);
    let fr, pos = st, squash = 0;
    if (b < CL.drop[1]) {
      fr = { pose: "arms-up", offset: 0 };
      pos = [st[0], st[1], st[2] + lerp(660, 0, prog(b, CL.drop[0], CL.drop[1], E.in)) * lift];
    } else if (b < CL.leap[0]) {
      fr = K.clawdSeq("land", b, CL.drop[1], BAR) || { pose: b < CL.say[0] + 0.2 ? "default" : "look-left", offset: 0 };
      squash = spring(b, CL.drop[1], 0.24);
    } else if (b < CL.leap[1]) {
      const k = prog(b, CL.leap[0], CL.leap[1]), i = frameAt(CL.leap[0]);
      fr = i < 2 ? window.Clawd.SEQ.jump[i] : { pose: "arms-up", offset: 0 };
      pos = lerp3(st, ride, k); pos[2] += K.hop(b, CL.leap[0], CL.leap[1], 56) * lift;
      squash = -0.12 * Math.sin(k * Math.PI);
    } else {
      const i = frameAt(CL.leap[1]);
      fr = i < 2 ? window.Clawd.SEQ.land[i] : { pose: "default", offset: 1 };
      pos = ride; squash = spring(b, CL.leap[1], 0.16);
    }
    return { fr, q, pos, yaw: v.az * D2R, squash };
  }
  function actors(b, { envAt, clawdPose }) {
    const { HUB3 } = L();
    if (b < STOP.S0.t1) SRC0().forEach((p, i) => {
      for (let j = 0; j < 2; j++) {
        const t0 = 0.75 + i * 0.1 + j * 0.65, k = prog(b, t0, t0 + 0.7, E.io);
        if (k <= 0 || k >= 1) continue;
        const q = lerp3(p, EXIT0, k);
        q[2] += Math.sin(k * Math.PI) * 300;
        envAt(q[0], q[1], q[2], 2.6 * (1 - prog(k, 0.85, 1)), yawOf(EXIT0[0] - p[0], EXIT0[1] - p[1]));
      }
    });
    // 那封换歌的信封：从菜单栏的 Hub 图标弹出来，落在导轨上等到结尾；起跑后跟着火花走，Clawd 跳上去时收掉
    if (b >= AT.post && b < CL.leap[1] + 0.05) {
      const rail = yawOf(1, -1);
      if (b < AT.park) {
        const k = prog(b, AT.post, AT.park, E.io), p = lerp3(HUB3, [PARK3[0], PARK3[1], PARK3[2] - 6], k);
        envAt(p[0], p[1], p[2] + Math.sin(k * Math.PI) * 120, lerp(0.6, 1.5, E.out(Math.min(1, k * 1.4))), lerp(0, rail, k));
      } else if (b < AT.launch) envAt(PARK3[0], PARK3[1], PARK3[2] - 6, 1.5, rail);
      else {
        const h = onRail(rideD(b), b);
        envAt(h[0], h[1], h[2] - 6, lerp(1.5, 1.1, prog(b, AT.launch, AT.launch + 0.12, E.out)) * (1 - prog(b, CL.leap[0], CL.leap[1] + 0.04)), rail);
      }
    }
    clawdPose(clawdRide(b, BARs));
  }
  NS.actors = actors;

  const rr = K.roundRect;
  function plate(x, rx, ry, w, h, a, o = {}) {
    if (a <= 0) return;
    x.globalAlpha = a * 0.2; x.fillStyle = P.shade; rr(x, rx + 5, ry + 6, w, h, 14); x.fill();
    x.globalAlpha = a; x.fillStyle = o.fill || P.plate; rr(x, rx, ry, w, h, 14); x.fill();
    if (o.line) { x.strokeStyle = o.line; x.lineWidth = o.lw ?? 3; x.stroke(); }
    x.globalAlpha = 1;
  }
  function glow(e, cx, cy, r, a) {
    if (a <= 0.003) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,190,140,${0.85 * a})`); g.addColorStop(0.45, `rgba(230,120,80,${0.28 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill();
  }
  Object.assign(NS, { plate, glow });

  function blueprint(x, b) {
    const cut = cut00();
    if (!cut || b >= BP.paint[1]) return;
    const W = NS.W, s = cut.s * (1 + cut.rate * b), P0 = (u, v) => [960 + u * s, 540 + (v + 5) * s];
    const m = E.io(prog(b, BP.morph[0], BP.morph[1])), mix = (a, c) => a.map((p, i) => [lerp(p[0], c[i][0], m), lerp(p[1], c[i][1], m)]);
    const { LAP, LID, lidPoint } = W.L, pr = (p) => W.proj(...p);
    const lid = mix([P0(-26, 10), P0(26, 10), P0(26, -24), P0(-26, -24)], [[0, 0], [LID.w, 0], [LID.w, LID.h], [0, LID.h]].map(([u, v]) => pr(lidPoint(u, v))));
    const key = mix([P0(-34, 14), P0(34, 14)], [[LAP.x, LAP.y + 58, LAP.z], [LAP.x + 108, LAP.y + 58, LAP.z]].map(pr));
    const c = [(lid[0][0] + lid[2][0]) / 2, (lid[0][1] + lid[2][1]) / 2];
    const r1 = Math.max(0.5, 2600 * prog(b, BP.paint[0], BP.paint[1]) ** 2), g = x.createRadialGradient(c[0], c[1], Math.max(0, r1 - 300), c[0], c[1], r1);
    const [br, bg, bb] = parse(cut.bg);
    g.addColorStop(0, `rgba(${br},${bg},${bb},0)`); g.addColorStop(1, cut.bg);
    x.globalAlpha = 1; x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
    x.globalAlpha = 1 - prog(b, BP.paint[1] - 0.12, BP.paint[1]);
    x.strokeStyle = cut.line; x.lineWidth = lerp(cut.lw * s, 4, m); x.lineCap = "butt"; x.lineJoin = "miter";
    x.beginPath(); lid.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath(); x.moveTo(...key[0]); x.lineTo(...key[1]); x.stroke();
    x.globalAlpha = 1;
  }
  function whipSlab(x, b) {
    const band = window.CHAPTERS.find((c) => c.id === "ch02")?.share?.whipBand;
    if (!band || b < WHIP.t0) return;
    const sx = WHIP.slabX + (WHIP.dx - whipX(b)) * NS.cur.zoom;
    if (sx > 1920) return;
    x.globalAlpha = 1; band(x, sx);
  }
  function guide(x, dock, b) {
    const gA = prog(b, AT.back + 0.02, AT.back + 0.16, E.out);
    if (gA <= 0) return;
    x.save(); x.globalAlpha = 0.5 * gA; x.strokeStyle = P.ink2; x.lineWidth = 2; x.setLineDash([8, 8]);
    x.beginPath(); x.moveTo(dock[0] + 44, dock[1]); x.lineTo(dock[0] + 1070, dock[1]); x.stroke(); x.restore();
    // 标在线下：Clawd 骑着火花沿线跑过去，标在线上会被它整只盖住。
    NS.tag(x, "→ ingest.homepage.lyjw.llc", dock[0] + 900, dock[1] + 58, gA, { px: 28, font: MONO, align: "right", color: P.ink2 });
  }
  function hero(x, e, b) {
    const W = NS.W, dockG = PARK3;
    if (b >= AT.post && b < AT.launch) {
      const k = prog(b, AT.post, AT.park, E.io), p = lerp3(W.L.HUB3, PARK3, k);
      const [gx, gy] = W.proj(p[0], p[1], p[2] + Math.sin(k * Math.PI) * 120);
      glow(e, gx, gy, 70 * (NS.cur.zoom || 1), 0.5 * (k < 1 ? 1 : 0.4 + 0.6 * impact(b, AT.back, 0.25)) + 0.5 * impact(b, AT.park, 0.2));
    }
    if (b < AT.back) return;
    const dock = W.proj(...dockG);
    guide(x, dock, b);
    if (b < AT.launch) {
      glow(e, dock[0], dock[1], 150, 0.6 * impact(b, AT.back, 0.25) + 0.2 * prog(b, AT.back, AT.back + 0.1));
      return;
    }
    const dd = rideD(b), head = W.proj(...onRail(dd, b));
    const trail = trailOn([[0, 0], [1810, 0]], dd, lerp(80, 520, prog(b, AT.launch, N - 0.2)), 18).map(([u]) => W.proj(...onRail(u, b)));
    K.spark(e, x, head, trail, { t: G.t, size: 1.1, lw: 2.4, color: NS.SIGD });
    // 浅底上加性的亮核会发白：垫一颗实心的橙核
    x.globalAlpha = 1; x.fillStyle = NS.SIG; x.beginPath(); x.arc(head[0], head[1], 7, 0, TAU); x.fill();
    x.fillStyle = "#FFE6D2"; x.beginPath(); x.arc(head[0], head[1], 3.5, 0, TAU); x.fill();
    glow(e, head[0], head[1], 150, 0.6 * impact(b, AT.back, 0.25));
  }
  function bubble(x, b) {
    const k = prog(b, CL.say[0], CL.say[0] + 0.06), out = 1 - E.in(prog(b, CL.say[1] - 0.1, CL.say[1]));
    if (k <= 0 || out <= 0) return;
    const [sx, sy] = NS.W.proj(...onRail(CL.stand, b).slice(0, 2), NS.W.L.RAIL_Z);
    const str = tr("ch01.clawd"), f = SANS(34, 600), tw = K.measure(x, str, f), pad = 18, bw = tw + pad * 2, bh = 70;
    x.save(); x.translate(sx - 56, sy - 12 * CL.qs - 10); const sc = lerp(0.6, 1, E.outBack(clamp(k * 1.6))); x.scale(sc, sc);
    const a = clamp(k * 4) * out;
    plate(x, 0, -bh, bw, bh, a);
    x.globalAlpha = a; x.fillStyle = P.plate; x.beginPath(); x.moveTo(18, -2); x.lineTo(6, 20); x.lineTo(42, -2); x.fill(); x.globalAlpha = 1;
    K.text(x, str, pad, -bh + 48, { font: f, color: P.ink, alpha: a, reveal: prog(b, CL.say[0] + 0.01, CL.say[0] + 0.13), perChar: true, fadeIn: false });
    x.restore();
  }

  let bg, emit, top;
  function fallback(x) {
    const g = x.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, P.sky0); g.addColorStop(0.58, P.sky1); g.addColorStop(1, P.sky2);
    x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
  }
  function render(f) {
    BARs = f.BAR;
    const b = f.bar, W = NS.W, dt = 1 / 60 / f.BAR;
    NS.SIG = G.css("signal"); NS.SIGD = G.css("signalD");
    const x = bg.begin(), e = emit.begin(), tp = top.begin();
    const hitS = Math.max(impact(b, AT.judged, 0.1), impact(b, AT.merge, 0.12), impact(b, AT.back, 0.12));
    let blur = [0, 0], zoomBlur = 0;
    if (W && W.ready) {
      NS.titleR = titleRight(x);
      const v = viewAt(b), v0 = viewAt(b - dt);
      v.zoom = (v.zoom ?? 1) * (1 + 0.01 * hitS);
      W.view(v0);
      const p0 = W.proj(...v.at);
      W.view(v);
      blur = [960 - p0[0], 540 - p0[1]];
      zoomBlur = clamp(Math.log((v0.d / v.d) * (v.zoom / (v0.zoom ?? 1))), -0.2, 0.2);
      W.pose(b);
      const dk = NS.dialK ? NS.dialK(b) : 0;
      W.draw({ aper: v.aper, focus: dk > 0 ? lerp(v.d, depthOf(v, NS.DIAL.c), dk) : v.d });
      NS.labels(x, e, b);
      hero(tp, e, b);
      bubble(tp, b);
      whipSlab(tp, b);
      blueprint(tp, b);
    } else {
      G.clear([0.93, 0.85, 0.88]);
      fallback(x);
      NS.cur = { zoom: 1 };
      NS.narrations(x, b);
    }
    G.composite(bg.upload(), { mode: G.MODE.normal });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 0.9 });
    G.composite(top.upload(), { mode: G.MODE.normal });

    const sh = hitS * 4, p0 = cut00()?.post, pk = p0 ? E.io(prog(b, BP.paint[0], BP.pull[1])) : 1;
    const pp = (k, v) => (p0 ? lerp(p0[k], v, pk) : v);
    f.post = {
      bloom: pp("bloom", 0.25), threshold: pp("threshold", 1.0), halation: pp("halation", 0), grain: 0, vignette: pp("vignette", 0.12), ca: 0,
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
      NS.SIGH = hex(G.css("signal"));
      if (NS.W) NS.W.init();
    },
    render,
  });
})();
