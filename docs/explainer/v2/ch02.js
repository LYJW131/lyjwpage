(() => {
  const { css } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, polyline, rect, fillRect, dashed, envelope, stamp, clawd, bubble, spark, roundRect, glyph, pathAt, pathLen, trailOn } = K;
  I18N.add({
    "ch02.title": ["门禁与分拣", "The gate and the sorting desk"],
    "ch02.host": ["ingest.homepage.lyjw.llc · ingress Worker", "ingest.homepage.lyjw.llc · ingress Worker"],
    "ch02.clawd": ["上报都从这面墙进来。", "Every report comes in\nthrough this wall."],
    "ch02.n1a": ["每个上报方一把 Access 钥匙，", "One Access token per reporter;"],
    "ch02.n1b": ["权限表决定它能开哪几扇门。", "the table decides which doors open."],
    "ch02.two": ["两把钥匙，各开一扇", "Two keys, one door each"],
    "ch02.key.mac": ["mac 的钥匙", "mac key"],
    "ch02.key.emby": ["emby 的钥匙", "emby key"],
    "ch02.key.ha": ["Home Assistant 的钥匙", "Home Assistant key"],
    "ch02.key.ps": ["playstation 的钥匙", "playstation key"],
    "ch02.form": ["入口检查单", "Ingress checklist"],
    "ch02.reject": ["拒收", "Reject"],
    "ch02.r1": ["方法是 POST", "Method is POST"],
    "ch02.r2": ["认识这个来源", "Known source"],
    "ch02.r3": ["Access 凭证", "Access credential"],
    "ch02.r4": ["不超过 4 MiB", "At most 4 MiB"],
    "ch02.r4s": ["按实际读到的字节", "bytes actually read"],
    "ch02.r5": ["是 JSON", "Is JSON"],
    "ch02.r6": ["prepare：校验并整理成命令", "prepare: build the command"],
    "ch02.n2a": ["按判定顺序逐项校验，", "Checks run in order;"],
    "ch02.n2b": ["一项不过，当场拒收。", "any miss is rejected."],
    "ch02.notJson": ["不是 JSON", "not JSON"],
    "ch02.n3a": ["prepare 把信封整理成命令，", "prepare turns it into a command,"],
    "ch02.n3b": ["按数据层拆成四路。", "split four ways by data layer."],
    "ch02.tube.rt": ["实时", "Realtime"],
    "ch02.tube.lag": ["可滞后", "Lag-tolerant"],
    "ch02.tube.d1": ["归档", "Archive"],
    "ch02.tube.cred": ["凭据", "Credentials"],
    "ch02.byCore": ["交给状态核心", "to the state core"],
    "ch02.byGate": ["入口直接写", "ingress writes it"],
    "ch02.fork": ["训练：可滞后、归档各一份", "workouts: one copy to lag, one to archive"],
    "ch02.server": ["服务器那封整封不进状态核心：只进可滞后和归档。", "The server report skips the state core: lag and archive only."],
    "ch02.gateSide": ["无状态，只在边界鉴权", "stateless; auth at the edge"],
    "ch02.coreSide": ["状态核心", "the state core"],
    "ch02.rpc": ["RPC 入口", "RPC entrypoint"],
    "ch02.noNet": ["内部调用：不走公网，不带凭据", "internal call: no public network, no credentials"],
    "ch02.bound": ["只有绑定了 CORE 的 Worker 调得到", "only Workers bound to CORE can call it"],
    "ch02.n4a": ["实时那一半经 Service Binding，", "Realtime rides a Service Binding"],
    "ch02.n4b": ["交给 api Worker 里的 StateCore。", "to StateCore in the api Worker."],
    "ch02.n5a": ["鉴权已在边界做过一次，", "Auth already happened at the edge;"],
    "ch02.n5b": ["这一跳只认绑定，不再验钥匙。", "this hop trusts the binding alone."],
    "ch02.foot1": ["改校验只需重新发布入口：", "Changing validation redeploys only the ingress:"],
    "ch02.foot2": ["api Worker 只引用类型，Durable Object 不重启，连接不断。", "the api Worker imports types only; the DO keeps running."],
    "ch02.waits": ["回 202 之前，入口依次等：", "Before 202, the ingress awaits:"],
    "ch02.lamp.do": ["状态核心已提交", "State core committed"],
    "ch02.lamp.lag": ["LAG 已写", "LAG written"],
    "ch02.lamp.cred": ["凭据已写", "Credentials written"],
    "ch02.lamp.d1": ["D1 归档", "D1 archive"],
    "ch02.lamp.d1s": ["waitUntil · 不等", "waitUntil · not awaited"],
    "ch02.onFail": ["失败时", "On failure"],
    "ch02.f503": ["状态核心未就绪：稍后重发", "core not ready: retry later"],
    "ch02.f400": ["上报器整封重发", "the reporter resends it all"],
    "ch02.n6a": ["三层都写完，才回 202；", "202 only after three layers commit;"],
    "ch02.n6b": ["归档、推送与失效在后台继续。", "archive and push continue after."],
    "ch02.n7a": ["中途出错回 400，整封重发；", "On error: 400, and a full resend;"],
    "ch02.n7b": ["每一路按自然键写，重发不重复。", "keyed writes make resends harmless."],
  });
  const tr = (k) => I18N.tr(k);
  const TAU = Math.PI * 2;
  let paper, ink, stampL, emit, top;
  const PLATE_RECT = [0, 0, 3840, 3240];

  const AT = {
    macOpen: 2.0, e403: 3.5, haOpen: 4.0, psOpen: 4.125,
    ticks: [5.0, 5.5, 6.0, 6.5, 7.0, 7.5], s400: 8.0,
    chips: [9.0, 9.5, 10.0, 10.5], server: 10.35, fork: 11.0,
    port: 12.5, core: 12.75, hub: 13.0, commit: 13.25, reply: [13.5, 14.0], drop: [15.75, 16.0],
    lamp1: 16.0, d1Start: 16.25, lamp2: 16.5, lamp3: 17.0, s202: 17.5, d1Done: 17.75, fail: 17.75,
    out: 19.25, dive: 20.0,
  };

  const DOORS = ["mac", "iphone", "homepod", "playstation", "emby", "server", "agents", "quest", "agents/otlp"];
  const DX = (i) => 170 + i * 178, DW = 138, DTOP = 340, DH = 300;
  const lockPos = (i) => [DX(i) + DW / 2, DTOP + DH * 0.6];
  const TUBE_X = { cred: 300, d1: 700, lag: 1100, rt: 1500 };
  const WALL_X = 2600, PIPE_Y = 1720, CORE_BOX = { x: 2980, y: 1640, w: 300, h: 160 }, HUB = [3560, 1720];
  const DROP_X = 2556;
  const LAMP_Y = 2620, BUS_Y = 2500;
  const LAMPS = [
    { key: "do", x: DROP_X, t: AT.lamp1 },
    { key: "lag", x: DROP_X + 330, t: AT.lamp2 },
    { key: "cred", x: DROP_X + 660, t: AT.lamp3 },
  ];
  const D1L = { x: DROP_X + 165, y: 2860 };
  const STAMP202 = [3600, 2500];
  const RT_FULL = [[1500, 1690], [1500, 1930], [2000, 1930], [2000, PIPE_Y], [CORE_BOX.x, PIPE_Y], [CORE_BOX.x + CORE_BOX.w / 2, PIPE_Y], [HUB[0] - 60, PIPE_Y]];
  const RT_TUBE = RT_FULL.slice(0, 5);

  const CAM = [
    [0, [640, 660, 1.4, -0.025]],
    [1.6, [960, 580, 1.0, 0], E.io],
    [4.8, [990, 580, 1.03, 0], E.lin],
    [5.0, [2880, 540, 1.0, 0], E.io],
    [8.75, [2900, 548, 1.03, 0], E.lin],
    [9.0, [960, 1620, 1.0, 0], E.io],
    [11.75, [940, 1630, 1.03, 0], E.lin],
    [12.0, [2880, 1620, 1.0, 0], E.io],
    [15.75, [2895, 1630, 1.03, 0], E.lin],
    [16.0, [2880, 2700, 1.0, 0], E.io],
    [19.25, [2895, 2690, 1.03, 0], E.lin],
    [19.55, [1920, 1620, 1 / 3, 0], E.io],
    [19.74, [DROP_X, LAMP_Y, 1.1, 0], E.io],
    [19.97, [DROP_X, LAMP_Y, 60, 0], E.inExpo],
  ];

  let BARs = 60 / 108 * 4;
  const impact = (b, at, hl = 0.09) => (b < at ? 0 : Math.exp(-((b - at) * BARs) / hl * Math.LN2));
  const win = (b, a0, a1, b0, b1) => prog(b, a0, a1) * (1 - prog(b, b0, b1));
  function glow(e, cx, cy, r, a) {
    if (a <= 0) return;
    const g = e.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,200,150,${a})`); g.addColorStop(0.35, `rgba(235,130,85,${0.45 * a})`); g.addColorStop(1, "rgba(230,110,70,0)");
    e.save(); e.fillStyle = g; e.beginPath(); e.arc(cx, cy, r, 0, TAU); e.fill(); e.restore();
  }
  function sparkP(e, x, head, trail, o) {
    spark(e, x, head, trail, o);
    x.save(); x.fillStyle = css("signal"); x.beginPath(); x.arc(head[0], head[1], 5.5 * (o.size ?? 1), 0, TAU); x.fill(); x.restore();
  }
  function nar(x, key, px, py, r, a, o = {}) {
    if (a <= 0) return;
    K.narration(x, tr(key), px, py, { px: o.px ?? 62, maxW: o.maxW ?? 1100, reveal: r, dim: 0.12, alpha: a });
  }
  function arrowHead(x, tx, ty, ang, color, alpha = 1, s = 16) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha; x.fillStyle = color; x.beginPath();
    x.moveTo(tx + Math.cos(ang) * 4, ty + Math.sin(ang) * 4);
    x.lineTo(tx + Math.cos(ang + 2.6) * s, ty + Math.sin(ang + 2.6) * s);
    x.lineTo(tx + Math.cos(ang - 2.6) * s, ty + Math.sin(ang - 2.6) * s);
    x.fill(); x.restore();
  }

  function door(x, i, open, drawK) {
    const dx = DX(i), top = DTOP, w = DW, h = DH;
    const ink = css("pink");
    const frame = [[dx, top + h], [dx, top], [dx + w, top], [dx + w, top + h]];
    polyline(x, frame, drawK, 3, ink);
    if (drawK < 1) return;
    if (open > 0) fillRect(x, dx + 2, top + 2, w - 4, h - 2, ink, 0.9 * clamp(open * 3));
    const o = E.out(clamp(open));
    const ex = dx + w * (1 - 0.8 * o);
    x.save();
    x.fillStyle = css("paper");
    x.strokeStyle = ink; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(dx + 1, top + 1); x.lineTo(ex, top + 1); x.lineTo(ex, top + h); x.lineTo(dx + 1, top + h); x.closePath();
    x.fill(); x.stroke();
    const inset = (px, py) => [lerp(dx + 1, ex, px), lerp(top + 1, top + h, py)];
    const pts = [inset(0.14, 0.08), inset(0.86, 0.08), inset(0.86, 0.46), inset(0.14, 0.46), inset(0.14, 0.08)];
    polyline(x, pts, 1, 1.2, ink, 0.55);
    const [lx, ly] = inset(0.8, 0.6);
    x.lineWidth = 2; x.beginPath(); x.arc(lx, ly, 9 * (1 - o * 0.5), 0, TAU); x.stroke();
    x.restore();
    text(x, "/" + DOORS[i], dx + w / 2, top - 20, { font: FONT.mono(28, 500), color: css("pink"), align: "center", alpha: clamp(drawK * 2 - 1) });
  }
  function keycard(x, label, cx, cy, rot = 0, alpha = 1, hot = false) {
    if (alpha <= 0) return;
    const tw = K.measure(x, label, FONT.cjk(28, 600));
    x.save(); x.translate(cx, cy); x.rotate(rot); x.globalAlpha = alpha;
    const w = Math.max(210, tw + 110), h = 86;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 3;
    roundRect(x, -w / 2, -h / 2, w, h, 10); x.fill(); x.stroke();
    x.lineWidth = 1.5; x.strokeRect(-w / 2 + 16, -14, 30, 24);
    line(x, -w / 2 + 16, -2, -w / 2 + 46, -2, 1, x.strokeStyle);
    x.restore();
    text(x, label, cx - Math.max(210, tw + 110) / 2 + 64, cy + 10, { font: FONT.cjk(28, 600), color: hot ? css("signal") : css("pink"), alpha });
  }

  const AC = [["mac", "/mac"], ["iphone", "/iphone"], ["home-assistant", "/homepod"], ["playstation", "/playstation"], ["quest", "/quest"],
    ["emby", "/emby"], ["server", "/server"], ["agents", "/agents"], ["claude-cloud", "/agents/otlp"], ["github-actions", "/api/internal/site-deployed"]];
  const AC_ROW = { mac: 0, ha: 2, ps: 3, emby: 5 };
  const AC_X = [150, 1000], AC_Y = 700, AC_LH = 36;
  const acPos = (i) => [AC_X[Math.floor(i / 5)], AC_Y + 40 + (i % 5) * AC_LH];
  const acRow = (i) => { const [x0, y] = acPos(i); return [x0 + 90, y - 8]; };
  function accessTable(x, b) {
    const k = prog(b, 0.9, 1.5, E.out);
    if (k <= 0) return;
    text(x, "ACCESS_CLIENTS", AC_X[0], AC_Y, { font: FONT.mono(28, 600), color: css("graphite"), alpha: k });
    line(x, AC_X[0], AC_Y + 12, AC_X[0] + 1620 * k, AC_Y + 12, 1.2, css("pink"), 0.6);
    const hot = b > 1.3 && b < 2.6 ? [AC_ROW.mac] : b > 2.8 && b < 4.1 ? [AC_ROW.emby] : b >= 4.1 && b < 4.9 ? [AC_ROW.ha, AC_ROW.ps] : [];
    AC.forEach(([who, doors], i) => {
      const [x0, y] = acPos(i), a = prog(b, 1.0 + i * 0.05, 1.3 + i * 0.05);
      const on = hot.includes(i), c = on ? css("signal") : css("pink");
      text(x, who, x0, y, { font: FONT.mono(28, 500), color: c, alpha: a });
      text(x, "→ " + doors, x0 + 260, y, { font: FONT.mono(28), color: on ? c : css("graphite"), alpha: a });
    });
  }

  function panelA(x, s, b) {
    const k0 = prog(b, 0.15, 1.0, E.out);
    text(x, "02", 120, 196, { font: FONT.pixel(112), color: css("signal"), alpha: k0 });
    text(x, tr("ch02.title"), 300, 176, { font: FONT.cjk(58, 600), reveal: prog(b, 0.3, 1.0), fadeIn: true });
    text(x, tr("ch02.host"), 302, 224, { font: FONT.mono(28), color: css("graphite"), reveal: prog(b, 0.5, 1.3) });
    line(x, 120, 262, 120 + 1680 * prog(b, 0.2, 1.3, E.outExpo), 262, 1.4, css("pink"));
    line(x, 150, DTOP + DH, 150 + 1620 * (0.12 + 0.88 * prog(b, 0, 0.9, E.outExpo)), DTOP + DH, 2, css("pink"));
    text(x, "POST /api/ingest/…", 1770, DTOP + DH + 44, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: prog(b, 0.7, 1.2) });

    const openMac = keys(b, [[AT.macOpen, 0], [AT.macOpen + 0.4, 1, E.outExpo], [2.72, 1], [3.0, 0, E.in]]);
    const openHP = keys(b, [[AT.haOpen, 0], [AT.haOpen + 0.4, 1, E.outExpo]]);
    const openPS = keys(b, [[AT.psOpen, 0], [AT.psOpen + 0.4, 1, E.outExpo]]);
    DOORS.forEach((_, i) => {
      const dk = prog(b, 0.35 + i * 0.06, 0.95 + i * 0.06, E.io);
      door(x, i, i === 0 ? openMac : i === 2 ? openHP : i === 3 ? openPS : 0, dk);
    });

    accessTable(x, b);
    const [mx, my] = lockPos(0);
    const macK = keys(b, [[1.3, acRow(AC_ROW.mac)], [2.0, [mx, my], E.outExpo], [2.35, [mx, my]], [2.7, [mx, my + 30], E.in]]);
    keycard(x, tr("ch02.key.mac"), macK[0], macK[1], 0, prog(b, 1.3, 1.4) * (1 - prog(b, 2.35, 2.7)), b > 1.95 && b < 2.5);
    const embyK = keys(b, [[2.9, acRow(AC_ROW.emby)], [3.5, [mx, my], E.outExpo], [3.75, [mx, my]], [4.15, [mx - 30, my + 110], E.in]]);
    const shakeE = b > 3.5 && b < 3.75 ? Math.sin((b - 3.5) * 120) * 10 * (1 - prog(b, 3.5, 3.75)) : 0;
    keycard(x, tr("ch02.key.emby"), embyK[0] + shakeE, embyK[1], lerp(0, -0.4, prog(b, 3.75, 4.15, E.in)), prog(b, 2.9, 3.0) * (1 - prog(b, 3.85, 4.1)));
    const cardW = (label) => Math.max(210, K.measure(x, label, FONT.cjk(28, 600)) + 110);
    const hpX = DX(2) + DW - 8 - cardW(tr("ch02.key.ha")) / 2, psX = DX(3) + 8 + cardW(tr("ch02.key.ps")) / 2;
    const haK = keys(b, [[3.45, acRow(AC_ROW.ha)], [AT.haOpen, [hpX, my], E.outExpo], [4.5, [hpX, my]], [4.85, [hpX, my + 40], E.in]]);
    keycard(x, tr("ch02.key.ha"), haK[0], haK[1], 0, prog(b, 3.45, 3.55) * (1 - prog(b, 4.5, 4.85)), b > AT.haOpen - 0.05 && b < 4.6);
    const psK = keys(b, [[3.55, acRow(AC_ROW.ps)], [AT.psOpen, [psX, my], E.outExpo], [4.6, [psX, my]], [4.9, [psX, my + 40], E.in]]);
    keycard(x, tr("ch02.key.ps"), psK[0], psK[1], 0, prog(b, 3.55, 3.65) * (1 - prog(b, 4.6, 4.9)), b > AT.psOpen - 0.05 && b < 4.7);
    if (b > AT.haOpen) {
      const hy = DTOP + DH + 28;
      line(x, DX(2) + 14, hy, DX(2) + DW - 14, hy, 2, css("signal"), prog(b, AT.haOpen, AT.haOpen + 0.2));
      line(x, DX(3) + 14, hy, DX(3) + DW - 14, hy, 2, css("signal"), prog(b, AT.psOpen, AT.psOpen + 0.2));
      text(x, tr("ch02.two"), DX(3) + DW + 24, hy + 10, { maxW: 700, font: FONT.cjk(28, 600), color: css("signal"), reveal: prog(b, AT.psOpen, AT.psOpen + 0.3) });
    }
    stamp(s, "403", DX(0) + DW / 2 + 6, DTOP + DH * 0.24, { k: prog(b, AT.e403, AT.e403 + 0.12), px: 64, rot: -0.2, alpha: 1 - prog(b, 4.6, 4.9) });

    const na = prog(b, 1.3, 1.6);
    nar(x, "ch02.n1a", 150, 975, prog(b, 1.4, 2.2), na, { px: 64, maxW: 1500 });
    nar(x, "ch02.n1b", 150, 1055, prog(b, 2.2, 3.2), na, { px: 64, maxW: 1500 });
  }

  const ROWS = [
    ["ch02.r1", "method", "405"],
    ["ch02.r2", "source", "404"],
    ["ch02.r3", "RS256 · aud · iss · exp", "401 · 403 · 503"],
    ["ch02.r4", "ch02.r4s", "400"],
    ["ch02.r5", "JSON.parse", "400"],
    ["ch02.r6", "PreparedIngest", "400 · 503"],
  ];
  function panelB(x, s, b) {
    const X = 2000, Y = 110, FW = 1080, FH = 880;
    const fk = prog(b, 4.55, 5.05, E.io);
    polyline(x, [[X, Y], [X + FW, Y], [X + FW, Y + FH], [X, Y + FH], [X, Y]], fk, 2.4, css("pink"));
    if (fk <= 0) return;
    text(x, tr("ch02.form"), X + 48, Y + 84, { font: FONT.cjk(46, 600), alpha: fk });
    text(x, "ingress Worker · handleIngest", X + FW - 40, Y + 80, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: fk });
    line(x, X + 40, Y + 116, X + FW - 40, Y + 116, 1.4, css("pink"), fk);
    text(x, tr("ch02.reject"), X + FW - 40, Y + 166, { font: FONT.cjk(28, 600), color: css("graphite"), align: "right", alpha: fk });
    ROWS.forEach(([lab, sub, code], i) => {
      const y = Y + 232 + i * 108;
      const tk = AT.ticks[i];
      const done = prog(b, tk, tk + 0.1);
      const a = fk * lerp(0.42, 1, done);
      text(x, String(i + 1).padStart(2, "0"), X + 44, y, { font: FONT.mono(28, 500), color: css("graphite"), alpha: fk });
      text(x, tr(lab), X + 110, y, { font: FONT.cjk(38, 600), alpha: a, maxW: 580 });
      text(x, sub.startsWith("ch02.") ? tr(sub) : sub, X + 112, y + 40, { font: sub.startsWith("ch02.") ? FONT.cjk(28, 600) : FONT.mono(28), color: css("graphite"), alpha: a });
      text(x, code, X + FW - 40, y, { font: FONT.mono(28, 500), color: css("graphite"), align: "right", alpha: fk });
      const bx = X + FW - 370, by = y - 34;
      rect(x, bx, by, 40, 40, 2, css("pink"), fk);
      polyline(x, [[bx + 7, by + 20], [bx + 17, by + 31], [bx + 36, by + 5]], done, 5, css("signal"));
      line(x, X + 40, y + 66, X + 40 + (FW - 80) * prog(b, 4.8 + i * 0.05, 5.2 + i * 0.05, E.out), y + 66, 1, css("pink"), 0.3);
      const sw = prog(b, tk, tk + 0.12, E.outExpo);
      if (sw > 0 && b < tk + 0.45) line(x, X + 40, y + 66, X + 40 + (FW - 80) * sw, y + 66, 2.2, css("signal"), 1 - prog(b, tk + 0.2, tk + 0.45));
    });

    nar(x, "ch02.n2a", 3150, 200, prog(b, 4.9, 5.4), 1, { px: 60, maxW: 650 });
    nar(x, "ch02.n2b", 3150, 282, prog(b, 5.4, 6.4), 1, { px: 60, maxW: 650 });
    const ex = 3440;
    const ey = keys(b, [[4.7, 470], [6.5, 470], [6.72, 742, E.spring]]);
    const eIn = prog(b, 4.6, 4.95, E.outExpo);
    const envX = lerp(3180, ex, eIn);
    text(x, "POST", ex, 340, { font: FONT.mono(34, 600), color: b < 5.25 ? css("signal") : css("pink"), align: "center", alpha: prog(b, 5.0, 5.08) * (1 - prog(b, 6.35, 6.5)) });
    text(x, "/api/ingest/mac", ex, 382, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: prog(b, 5.5, 5.58) * (1 - prog(b, 6.35, 6.5)) });
    const jk = prog(b, 6.0, 6.2, E.out);
    if (jk > 0 && b < 6.55) {
      const segs = [[3290, 70], [3366, 150], [3522, 70]];
      segs.forEach(([sx, sw], j) => fillRect(x, sx, 600, sw * clamp(jk * 3 - j), 12, j === 2 ? css("signal") : css("pink"), 0.85 * (1 - prog(b, 6.35, 6.5))));
      text(x, "Cf-Access-Jwt-Assertion", ex, 652, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: jk * (1 - prog(b, 6.35, 6.5)) });
    }
    const sk = prog(b, 6.2, 6.5, E.out);
    if (sk > 0) {
      const py = 790, cx = ex, cy = 905, R = 70;
      line(x, cx - 150, py, cx + 150, py, 3, css("pink"), sk);
      line(x, cx, py, cx, cy - R, 2, css("pink"), sk);
      x.save(); x.globalAlpha = sk; x.strokeStyle = css("pink"); x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cy, R, Math.PI * 0.85, Math.PI * 2.15); x.stroke();
      for (let j = 0; j <= 10; j++) { const a = Math.PI * (0.85 + 1.3 * j / 10); line(x, cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12), cx + Math.cos(a) * R, cy + Math.sin(a) * R, j === 10 ? 4 : 1.5, j === 10 ? css("signal") : css("pink")); }
      x.restore();
      text(x, "4 MiB", cx + R + 16, cy - 30, { font: FONT.mono(28, 600), color: css("signal"), alpha: sk });
      const wob = b < 6.5 ? 0 : Math.exp(-(b - 6.5) * 9) * Math.sin((b - 6.5) * 60) * 0.5;
      const na = Math.PI * 0.85 + (b < 6.5 ? 0 : 0.1 + wob);
      line(x, cx, cy, cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16), 3, css("signal"), sk);
    }
    const jb = prog(b, 7.0, 7.12, E.outBack);
    if (jb > 0) {
      text(x, "{", ex - 170 - (1 - jb) * 30, ey + 26, { font: FONT.mono(80, 500), color: css("graphite"), align: "center", alpha: jb });
      text(x, "}", ex + 170 + (1 - jb) * 30, ey + 26, { font: FONT.mono(80, 500), color: css("graphite"), align: "center", alpha: jb });
    }
    const open = prog(b, 7.5, 7.75, E.io);
    envelope(x, envX, ey, 230, css("pink"), { lw: 3, open, fill: css("paper"), alpha: eIn });
    const rk = prog(b, 7.62, 7.95, E.outExpo);
    if (rk > 0) {
      const rx = lerp(3960, 3640, rk), ry = 440;
      envelope(x, rx, ry, 150, css("graphite"), { lw: 2.5, fill: css("paper"), rot: 0.08 });
      text(x, "<html>", rx, ry + 82, { font: FONT.mono(28), color: css("graphite"), align: "center" });
      stamp(s, "400", rx + 60, ry + 206, { k: prog(b, AT.s400, AT.s400 + 0.12), px: 56, rot: -0.14, sub: tr("ch02.notJson"), subPx: 28 });
    }
  }

  function tube(x, pts, color, k, lw = 2.2) {
    const off = (d) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / L) * d, p[1] + (dx / L) * d];
    });
    polyline(x, off(-24), k, lw, color);
    polyline(x, off(24), k, lw, color);
  }
  const CHIPS = [
    ["mac · desktop", "rt", 9.0, 0], ["mac · appleMusic", "rt", 9.06, 0], ["mac · chargingDevices", "rt", 9.12, 0],
    ["mac · timezone", "lag", 9.5, 0],
    ["iphone · workouts", "lag", 10.0, 1], ["iphone · workouts", "d1", 10.0, 1],
    ["mac · musicUserToken", "cred", 10.5, 0],
  ];
  const ENV_C = [[1160, 1330], [1420, 1372]];
  const SERVER_AT = [1780, 1420];
  function chip(x, label, cx, cy, hot, alpha, scale = 1) {
    if (alpha <= 0) return;
    x.save(); x.translate(cx, cy); x.scale(scale, scale); x.globalAlpha = alpha;
    x.font = FONT.mono(28, 500);
    const w = x.measureText(label).width + 40, h = 52;
    x.fillStyle = css("paper"); x.strokeStyle = hot ? css("signal") : css("pink"); x.lineWidth = 2;
    roundRect(x, -w / 2, -h / 2, w, h, 26); x.fill(); x.stroke();
    x.fillStyle = hot ? css("signal") : css("pink"); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 0, 1);
    x.restore();
  }
  function panelC(x, s, b) {
    const na = prog(b, 8.95, 9.05) * (1 - prog(b, 11.62, 11.74));
    nar(x, "ch02.n3a", 120, 1235, prog(b, 9.05, 9.5), na, { maxW: 880 });
    nar(x, "ch02.n3b", 120, 1318, prog(b, 9.5, 10.2), na, { maxW: 880 });
    const tk = prog(b, 8.85, 9.35, E.io);
    const names = { rt: "ch02.tube.rt", lag: "ch02.tube.lag", d1: "ch02.tube.d1", cred: "ch02.tube.cred" };
    const subs = { rt: "CORE.commitIngest", lag: "KV LAG", d1: "D1 HISTORY", cred: "KV CREDENTIALS" };
    for (const key of ["cred", "d1", "lag", "rt"]) {
      const tx = TUBE_X[key], hot = key === "rt", col = hot ? css("signal") : css("pink");
      text(x, tr(names[key]), tx, 1580, { font: FONT.cjk(38, 600), color: col, align: "center", alpha: tk });
      text(x, subs[key], tx, 1620, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: tk });
      text(x, tr(hot ? "ch02.byCore" : "ch02.byGate"), tx, 1656, { font: FONT.cjk(28, 600), color: hot ? css("signal") : css("graphite"), align: "center", alpha: tk * prog(b, 9.2, 9.4) });
      polyline(x, [[tx - 84, 1690], [tx - 26, 1750]], tk, 2.4, col);
      polyline(x, [[tx + 84, 1690], [tx + 26, 1750]], tk, 2.4, col);
      if (hot) tube(x, [[tx, 1750], ...RT_TUBE.slice(1)], col, tk);
      else { tube(x, [[tx, 1750], [tx, 1990]], col, tk); glyph(x, key, tx, 2046, col); }
      const arrive = CHIPS.filter((c) => c[1] === key).map((c) => c[2]);
      if (key === "lag" || key === "d1") arrive.push(AT.fork);
      const p = Math.max(0, ...arrive.map((a) => impact(b, a, 0.12)));
      if (p > 0.02) polyline(x, [[tx - 84, 1690], [tx + 84, 1690]], 1, 4, css("signal"), p);
    }

    const ek = prog(b, 8.7, 9.0, E.outExpo);
    text(x, "prepare → PreparedIngest", 1880, 1215, { font: FONT.mono(28), color: css("graphite"), align: "right", alpha: ek });
    envelope(x, ENV_C[1][0], ENV_C[1][1], 170, css("pink"), { lw: 2.5, open: 1, fill: css("paper"), alpha: ek, rot: 0.06 });
    envelope(x, ENV_C[0][0], ENV_C[0][1], 220, css("pink"), { lw: 3, open: 1, fill: css("paper"), alpha: ek, rot: -0.03 });
    text(x, "mac", ENV_C[0][0], ENV_C[0][1] + 112, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: ek });
    text(x, "iphone", ENV_C[1][0], ENV_C[1][1] + 92, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: ek });
    CHIPS.forEach(([label, key, at, from]) => {
      const k = prog(b, at - 0.42, at, E.io);
      if (k <= 0 || k >= 1) return;
      const [sx, sy] = [ENV_C[from][0], ENV_C[from][1] - 60];
      const tx = TUBE_X[key], ty = 1720;
      const cx = lerp(sx, tx, k), cy = lerp(sy, ty, k) - Math.sin(k * Math.PI) * 170;
      chip(x, label, cx, cy, key === "rt", 1 - prog(k, 0.85, 1), lerp(1, 0.6, prog(k, 0.7, 1)));
    });
    text(x, tr("ch02.fork"), 120, 1440, { maxW: 900, font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, 10.0, 10.5) });
    const sIn = prog(b, AT.server, AT.server + 0.37, E.outExpo);
    if (sIn > 0) {
      const sx = lerp(2060, SERVER_AT[0], sIn), sy = SERVER_AT[1];
      const split = prog(b, AT.fork - 0.25, AT.fork, E.io);
      if (split <= 0) envelope(x, sx, sy, 180, css("pink"), { lw: 2.6, fill: css("paper") });
      else if (split < 1) {
        for (const key of ["lag", "d1"]) {
          const tx = TUBE_X[key], cx = lerp(sx, tx, split), cy = lerp(sy, 1720, split) - Math.sin(split * Math.PI) * 120;
          envelope(x, cx, cy, lerp(180, 90, split), css("pink"), { lw: 2.4, fill: css("paper"), alpha: 1 - prog(split, 0.85, 1) });
        }
      }
      text(x, "server", sx, sy + 90, { font: FONT.mono(28), color: css("graphite"), align: "center", alpha: 1 - split });
      text(x, tr("ch02.server"), 120, 1485, { maxW: 900, font: FONT.cjk(28, 600), color: css("graphite"), reveal: prog(b, AT.fork, AT.fork + 0.6) });
    }
  }

  function wall(x, y0, y1, a) {
    if (a <= 0 || y1 <= y0) return;
    const w = 26, x0 = WALL_X - w / 2;
    x.save(); x.globalAlpha = a; x.strokeStyle = css("pink"); x.lineWidth = 2.2; x.strokeRect(x0, y0, w, y1 - y0);
    x.beginPath(); x.rect(x0, y0, w, y1 - y0); x.clip(); x.lineWidth = 1.1;
    x.beginPath(); for (let s0 = y0 - w; s0 < y1; s0 += 10) { x.moveTo(x0, s0 + w); x.lineTo(x0 + w, s0); } x.stroke(); x.restore();
  }
  function receipt(x, e, cx, cy, a) {
    if (a <= 0) return;
    x.save(); x.globalAlpha = a; x.fillStyle = css("paper"); x.strokeStyle = css("signal"); x.lineWidth = 2.4;
    roundRect(x, cx - 26, cy - 18, 52, 36, 6); x.fill(); x.stroke(); x.restore();
    polyline(x, [[cx - 12, cy], [cx - 3, cy + 9], [cx + 13, cy - 9]], 1, 3, css("signal"), a);
    glow(e, cx, cy, 60, 0.45 * a);
  }
  function panelD(x, s, e, b) {
    const pink = css("pink"), graphite = css("graphite");
    const dk = prog(b, 11.85, 12.25, E.io);
    if (dk <= 0) return;
    wall(x, 1400, lerp(1400, 1630, dk), 1);
    wall(x, 1790, lerp(1790, 2080, dk), 1);
    text(x, "ingress Worker", WALL_X - 40, 1440, { font: FONT.mono(32, 600), color: pink, align: "right", alpha: dk });
    text(x, tr("ch02.gateSide"), WALL_X - 40, 1482, { font: FONT.cjk(28, 600), color: graphite, align: "right", alpha: dk });
    text(x, "api Worker", WALL_X + 40, 1440, { font: FONT.mono(32, 600), color: pink, alpha: dk });
    text(x, tr("ch02.coreSide"), WALL_X + 40, 1482, { font: FONT.cjk(28, 600), color: graphite, alpha: dk });
    fillRect(x, WALL_X - 20, PIPE_Y - 34, 40, 68, css("paper"), dk);
    rect(x, WALL_X - 20, PIPE_Y - 34, 40, 68, 2.2, pink, dk);
    text(x, "Service Binding · CORE", WALL_X, PIPE_Y - 48, { font: FONT.mono(28, 600), color: css("signal"), align: "center", alpha: prog(b, 12.1, 12.3) });
    const cb = CORE_BOX, coreHot = b >= AT.core - 0.02 && b < AT.reply[0] + 0.1;
    x.save(); x.globalAlpha = dk; x.fillStyle = css("paper"); x.strokeStyle = coreHot ? css("signal") : pink; x.lineWidth = 2.6;
    roundRect(x, cb.x, cb.y, cb.w, cb.h, 12); x.fill(); x.stroke(); x.restore();
    text(x, "StateCore", cb.x + cb.w / 2, cb.y + 72, { font: FONT.mono(34, 600), color: coreHot ? css("signal") : pink, align: "center", alpha: dk });
    text(x, tr("ch02.rpc"), cb.x + cb.w / 2, cb.y + 118, { font: FONT.cjk(28, 600), color: graphite, align: "center", alpha: dk });
    const hk = prog(b, 12.1, 12.4, E.out);
    polyline(x, [[cb.x + cb.w, PIPE_Y], [HUB[0] - 78, PIPE_Y]], hk, 2.2, pink);
    if (hk >= 1) arrowHead(x, HUB[0] - 78, PIPE_Y, 0, pink);
    const lit = prog(b, AT.commit, AT.commit + 0.08);
    glyph(x, "room", HUB[0], HUB[1] + 8, lit > 0.5 ? css("signal") : pink, 1.4 * hk + 0.001);
    x.save(); x.globalAlpha = hk; x.strokeStyle = pink; x.lineWidth = 2; x.beginPath(); x.arc(HUB[0], HUB[1] + 14, 11, 0, TAU); x.stroke();
    if (lit > 0) { x.globalAlpha = hk * lit; x.fillStyle = css("signal"); x.beginPath(); x.arc(HUB[0], HUB[1] + 14, 9, 0, TAU); x.fill(); }
    x.restore();
    if (lit > 0) glow(e, HUB[0], HUB[1] + 14, 90, 0.55 * impact(b, AT.commit, 0.25) + 0.2);
    text(x, "StateHub", HUB[0], 1830, { font: FONT.mono(34, 600), color: pink, align: "center", alpha: hk });
    text(x, "Durable Object", HUB[0], 1870, { font: FONT.mono(28), color: graphite, align: "center", alpha: hk });
    text(x, "await CORE.commitIngest(cmd)", WALL_X - 60, 1792, { font: FONT.mono(28), color: pink, align: "right", alpha: prog(b, 12.2, 12.4) });
    const rp = prog(b, AT.reply[0], AT.reply[1], E.io);
    text(x, "{ ready: true, ok: true, data }", WALL_X - 60, 1834, { font: FONT.mono(28, 600), color: css("signal"), align: "right", alpha: prog(b, AT.reply[1], AT.reply[1] + 0.1) });
    const nk = prog(b, 13.9, 14.1);
    text(x, tr("ch02.noNet"), WALL_X + 40, 1920, { font: FONT.cjk(28, 600), color: graphite, alpha: nk });
    text(x, tr("ch02.bound"), WALL_X + 40, 1960, { font: FONT.cjk(28, 600), color: graphite, alpha: nk });
    text(x, tr("ch02.foot1"), WALL_X + 40, 2024, { font: FONT.cjk(28, 600), color: graphite, reveal: prog(b, 14.6, 14.9), maxW: 1150 });
    text(x, tr("ch02.foot2"), WALL_X + 40, 2064, { font: FONT.cjk(28, 600), color: graphite, reveal: prog(b, 14.9, 15.3), maxW: 1150 });
    if (b >= AT.reply[0] && b < AT.drop[1]) {
      const dropK = prog(b, AT.drop[0], AT.drop[1], E.in);
      const rx = lerp(cb.x + 30, DROP_X, rp), ry = dropK > 0 ? lerp(PIPE_Y + 8, LAMP_Y - 60, dropK) : PIPE_Y + 8;
      if (dropK > 0) line(x, DROP_X, PIPE_Y + 24, DROP_X, ry, 2.4, css("signal"));
      receipt(x, e, rx, ry, 1);
    }
    if (b >= AT.drop[1]) line(x, DROP_X, PIPE_Y + 24, DROP_X, LAMP_Y - 46, 2.4, css("signal"), 0.9);
    const a4 = win(b, 12.0, 12.1, 13.72, 13.82), a5 = win(b, 13.82, 13.92, 15.62, 15.74);
    nar(x, "ch02.n4a", 2000, 1235, prog(b, 12.05, 12.5), a4);
    nar(x, "ch02.n4b", 2000, 1318, prog(b, 12.5, 13.1), a4);
    nar(x, "ch02.n5a", 2000, 1235, prog(b, 13.87, 14.3), a5);
    nar(x, "ch02.n5b", 2000, 1318, prog(b, 14.3, 14.95), a5);
  }

  function panelE(x, s, e, b) {
    const pink = css("pink"), graphite = css("graphite");
    const k = prog(b, 15.8, 16.1, E.out);
    if (k <= 0) return;
    text(x, tr("ch02.waits"), 2000, 2440, { font: FONT.cjk(34, 600), color: graphite, alpha: k });
    const lit = (L) => prog(b, L.t, L.t + 0.08);
    line(x, LAMPS[0].x, BUS_Y, 3400, BUS_Y, 2.2, pink, k);
    LAMPS.forEach((L) => {
      const on = lit(L), lx = L.x, ly = LAMP_Y;
      line(x, lx, ly - 46, lx, BUS_Y, 2.2, pink, k);
      if (on > 0) line(x, lx, ly - 46, lx, lerp(ly - 46, BUS_Y, on), 3.4, css("signal"));
      x.save(); x.globalAlpha = k; x.strokeStyle = pink; x.lineWidth = 3; x.beginPath(); x.arc(lx, ly, 44, 0, TAU); x.stroke(); x.restore();
      if (on > 0) {
        x.save(); x.globalAlpha = on; x.fillStyle = css("signal"); x.beginPath(); x.arc(lx, ly, 36, 0, TAU); x.fill(); x.restore();
        glow(e, lx, ly, 95, on * 0.55);
      }
      text(x, tr(`ch02.lamp.${L.key}`), lx, ly + 90, { font: FONT.cjk(28, 600), align: "center", alpha: k });
      text(x, "await", lx, ly + 130, { font: FONT.mono(28), color: graphite, align: "center", alpha: k });
    });
    const dk = prog(b, AT.d1Start, AT.d1Start + 0.25, E.out);
    if (dk > 0) {
      x.save(); x.setLineDash([8, 7]); polyline(x, [[D1L.x, BUS_Y], [D1L.x, D1L.y - 46]], dk, 2, pink); x.restore();
      x.save(); x.globalAlpha = dk; x.strokeStyle = pink; x.lineWidth = 3; x.setLineDash([8, 7]); x.beginPath(); x.arc(D1L.x, D1L.y, 44, 0, TAU); x.stroke(); x.restore();
      const on = prog(b, AT.d1Done, AT.d1Done + 0.15);
      if (on > 0) {
        x.save(); x.globalAlpha = on * 0.45; x.fillStyle = css("signal"); x.beginPath(); x.arc(D1L.x, D1L.y, 36, 0, TAU); x.fill(); x.restore();
        glow(e, D1L.x, D1L.y, 95, on * 0.25);
      }
      text(x, tr("ch02.lamp.d1"), D1L.x, D1L.y + 90, { font: FONT.cjk(28, 600), align: "center", alpha: dk * 0.75 });
      text(x, tr("ch02.lamp.d1s"), D1L.x, D1L.y + 130, { font: FONT.cjk(28, 600), color: graphite, align: "center", alpha: dk });
    }
    const fill = keys(b, [[AT.lamp1, LAMPS[0].x], [AT.lamp2, LAMPS[1].x, E.out], [AT.lamp3, LAMPS[2].x, E.out], [AT.s202 - 0.05, 3400, E.io]]);
    if (b > AT.lamp1) line(x, LAMPS[0].x, BUS_Y, fill, BUS_Y, 3.4, css("signal"));
    stamp(s, "202", STAMP202[0], STAMP202[1], { k: prog(b, AT.s202, AT.s202 + 0.16), px: 150, rot: -0.09, sub: "Accepted" });
    const fk = prog(b, AT.fail, AT.fail + 0.15);
    if (fk > 0) {
      text(x, tr("ch02.onFail"), 3300, 2790, { font: FONT.cjk(30, 600), color: pink, alpha: fk });
      text(x, "ready: false → 503", 3300, 2840, { font: FONT.mono(28, 600), color: pink, alpha: fk });
      text(x, tr("ch02.f503"), 3300, 2880, { font: FONT.cjk(28, 600), color: graphite, alpha: fk });
      text(x, "throw → 400", 3300, 2940, { font: FONT.mono(28, 600), color: pink, alpha: fk });
      text(x, tr("ch02.f400"), 3300, 2980, { font: FONT.cjk(28, 600), color: graphite, alpha: fk });
    }
    const a6 = win(b, 16.0, 16.1, 17.62, 17.72), a7 = prog(b, 17.72, 17.82);
    nar(x, "ch02.n6a", 2000, 3090, prog(b, 16.05, 16.5), a6, { maxW: 1150 });
    nar(x, "ch02.n6b", 2000, 3170, prog(b, 16.5, 17.1), a6, { maxW: 1150 });
    nar(x, "ch02.n7a", 2000, 3090, prog(b, 17.8, 18.25), a7, { maxW: 1150 });
    nar(x, "ch02.n7b", 2000, 3170, prog(b, 18.25, 18.8), a7, { maxW: 1150 });
  }

  function plateFrame(x, b) {
    const k = prog(b, AT.out - 0.1, AT.out + 0.2, E.out);
    if (k <= 0) return;
    rect(x, 40, 40, 3760, 3160, 3, css("pink"), k);
    line(x, 1920, 60, 1920, 3180, 1, css("pink"), 0.25 * k);
    line(x, 60, 1080, 3780, 1080, 1, css("pink"), 0.25 * k);
    line(x, 60, 2160, 3780, 2160, 1, css("pink"), 0.25 * k);
    text(x, tr("ch02.title"), 960, 2640, { font: FONT.cjk(90, 600), align: "center", alpha: k });
    text(x, "PLATE 02 · INGRESS", 960, 2790, { font: FONT.mono(96, 600), align: "center", alpha: k });
  }

  const A_PATH = [[-420, 652], [120, 640], [DX(0) + DW / 2, 600]];
  const A_LEN = pathLen(A_PATH);
  function sparkAll(x, e, b) {
    if (b < 2.5) {
      const d = keys(b, [[0, 400], [1.9, A_LEN - 40, E.out], [2.35, A_LEN, E.in]]);
      const head = pathAt(A_PATH, d);
      sparkP(e, x, head, trailOn(A_PATH, d, 320), { t: G.t, size: lerp(1.1, 0.4, prog(b, 2.0, 2.4)), lw: 2.2 });
    } else if (b >= 4.7 && b < 8.9) {
      const ey = keys(b, [[4.7, 470], [6.5, 470], [6.72, 742, E.spring]]);
      const ex = lerp(3180, 3440, prog(b, 4.6, 4.95, E.outExpo));
      sparkP(e, x, [ex, ey - 20], null, { t: G.t, size: 0.8 });
    } else if (b >= 8.95 && b < AT.hub + 0.2) {
      const d = keys(b, [[8.95, 0], [9.6, 200, E.out], [11.5, 620, E.io], [12.0, 900, E.io], [AT.port, 1550, E.io], [AT.core, 2080, E.io], [AT.hub, pathLen(RT_FULL), E.io]]);
      const fade = 1 - prog(b, AT.hub, AT.hub + 0.2);
      sparkP(e, x, pathAt(RT_FULL, d), trailOn(RT_FULL, d, 300), { t: G.t, size: 1.0 * fade + 0.001, lw: 3 });
    }
  }

  function render(f) {
    BARs = f.BAR;
    const b = f.bar;
    const { cam, blur, zoomBlur } = K.camera(CAM, b, f.BAR);
    const hitS = Math.max(impact(b, AT.e403), impact(b, AT.s400), impact(b, AT.s202, 0.14));
    cam.zoom *= 1 + 0.025 * hitS;
    G.setCam(cam);
    G.fill(paper, { uGridA: 1, uPlate: PLATE_RECT });

    const x = ink.begin(); ink.cam(cam);
    const s = stampL.begin(); stampL.cam(cam);
    const e = emit.begin(); emit.cam(cam);
    const tp = top.begin(); top.cam(cam);

    const wide = b > AT.out;
    if (b < 5.2 || wide) panelA(x, s, b);
    if ((b > 4.4 && b < 9.3) || wide) panelB(x, s, b);
    if (b > 8.5) panelC(x, s, b);
    if (b > 11.5) panelD(x, s, e, b);
    if (b > 15.5) panelE(x, s, e, b);
    plateFrame(x, b);
    sparkAll(x, e, b);

    const cIn = prog(b, 0.45, 0.8, E.lin), cOut = prog(b, 2.45, 2.8, E.lin);
    if (cIn > 0 && cOut < 1) {
      const baseY = 262;
      const cx = lerp(2000, 1700, E.out(cIn)) + lerp(0, 320, E.in(cOut));
      const hop = Math.sin(cIn * Math.PI) * 110 * (1 - cIn) + Math.sin(cOut * Math.PI) * 90;
      const land = impact(b, 0.8, 0.07);
      clawd(tp, cx, baseY - hop, 8, { pose: cIn < 1 || cOut > 0 ? "arms-up" : b > 1.8 ? "look-left" : "default", crouch: land > 0.4 ? 1 : 0 });
      bubble(tp, tr("ch02.clawd"), cx - 90, baseY - 118, { px: 34, k: prog(b, 0.95, 1.2) * (1 - prog(b, 2.3, 2.45)), reveal: prog(b, 1.0, 1.7), tail: "right" });
    }

    G.composite(ink.upload(), { mode: G.MODE.ink, seed: 3.1 });
    G.composite(stampL.upload(), { mode: G.MODE.stamp, seed: 7.7 });
    G.composite(top.upload(), { mode: G.MODE.normal });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 1.35 });

    const sh = hitS * 9;
    f.post = {
      bloom: 0.55, threshold: 0.95, halation: 0.18, grain: 0.042, vignette: 0.26, ca: 0.35,
      shake: [Math.sin(f.frame * 1.7) * sh, Math.cos(f.frame * 2.3) * sh],
      // N:0 已属于下一章，全黑交接必须在 N − 0.03 前完成。
      flash: Math.max(impact(b, AT.s202, 0.1) * 0.18, prog(b, AT.dive - 0.23, AT.dive - 0.11)), flashCol: b > AT.dive - 0.5 ? [0.85, 0.36, 0.2] : [1.0, 0.72, 0.55],
      fade: prog(b, AT.dive - 0.1, AT.dive - 0.03),
      blur, zoomBlur,
    };
  }

  window.CHAPTERS.push({
    id: "ch02", title: "ch.02", bars: 20,
    init() { paper = G.pass(K.PLATE.paper); ink = G.layer("ink"); stampL = G.layer("stamp"); top = G.layer("top"); emit = G.layer("emit", 0.5); },
    render,
  });
})();
