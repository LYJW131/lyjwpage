(() => {
  const { C, FONT, E, prog, win, keys, lerp, clamp01, rgba } = G;
  const BAR = 60 / 96 * 4;

  const K = 1024 / 614, PX = 6000, PY = 60;
  // 卡片框按 docs/explainer/v2/ch04.js#P 的实测比例（614 宽）放大到首页 1024 宽。
  const CARDS = [
    ["contact", 0, 64, 304, 121], ["timezone", 310, 64, 304, 121],
    ["charger", 0, 192, 214, 117], ["powerbank", 0, 313, 214, 117],
    ["hero", 218, 192, 396, 142], ["recent", 218, 338, 396, 92],
    ["activity", 0, 437, 372, 152], ["workouts", 376, 437, 238, 152],
    ["server", 0, 596, 614, 152],
  ].map(([id, x, y, w, h]) => ({ id, x: PX + x * K, y: PY + y * K, w: w * K, h: h * K }));
  const HERO = CARDS.find((c) => c.id === "hero");
  const WIRE_Y = HERO.y + HERO.h / 2, CARD_X = HERO.x, CARD_CX = HERO.x + HERO.w / 2;
  const MAC = 420, HUB = 1500, ING = 2620, CORE = 3800, ROOM = 5000;
  const BOX_W = 560, BOX_H = 220;

  const SONG = [
    { title: "夜に駆ける", artist: "YOASOBI", dur: 261 },
    { title: "アイドル", artist: "YOASOBI", dur: 213 },
  ];

  const AT = {
    fadeIn: [0, 1.2], flip1: 4.0, n1: [6.5, 11.0],
    explode: [11.0, 12.5], n2: [13.0, 17.0],
    pop: { [ROOM]: 13.2, [CORE]: 15.9, [ING]: 17.4, [HUB]: 18.9, [MAC]: 20.3 },
    n3: [21.0, 25.0], n4: [25.0, 28.5], flipMac: 26.0,
    bead: 28.5, hubArr: 29.5, json: 29.7, n5: [29.5, 33.5],
    ingArr: 35.0, check: 35.2, split: 37.2, n6: [35.0, 40.5],
    coreArr: 40.0, enrich: [40.2, 41.2], commit: 41.6, fork: 42.3, n7: [40.5, 44.0],
    roomArr: 44.0, n8: [44.2, 47.8], pageArr: 47.5, flip2: 48.0, n9: [48.2, 52.0],
    pull: [52.5, 55.0], n10: [54.0, 59.5], title: 55.5, fadeOut: [62.5, 64.5],
  };

  const CAM1 = [
    [0, [PX + 512, PY + 500, 0.9]],
    [AT.flip1, [PX + 512, PY + 500, 0.9]],
    [6.0, [CARD_CX, WIRE_Y - 20, 1.6], E.io],
    [11.0, [CARD_CX, WIRE_Y - 20, 1.6]],
    [12.5, [CARD_CX - 200, WIRE_Y - 60, 1.1], E.io],
    [13.0, [CARD_CX - 200, WIRE_Y - 60, 1.1]],
    [14.5, [ROOM, WIRE_Y - 100, 0.55], E.io],
    [20.3, [MAC + 200, WIRE_Y - 100, 0.55], E.lin],
    [22.5, [MAC + 420, WIRE_Y - 150, 1.0], E.io],
  ];
  const CARD_FRAME = [CARD_CX, WIRE_Y - 20, 1.6];
  const CAM2 = [
    [AT.pageArr, CARD_FRAME],
    [AT.pull[0], CARD_FRAME],
    [AT.pull[1], [3640, WIRE_Y - 60, 0.27], E.io],
  ];
  const BEAD = [
    [AT.bead, [MAC]], [AT.hubArr, [HUB], E.io], [33.5, [HUB]], [AT.ingArr, [ING], E.io], [38.5, [ING]],
    [AT.coreArr, [CORE], E.io], [AT.fork, [CORE]], [AT.roomArr, [ROOM], E.io], [44.6, [ROOM]], [AT.pageArr, [CARD_X], E.io],
  ];
  const WIRE_LEFT = [
    [11.5, [CARD_X]], [AT.pop[ROOM], [ROOM], E.out], [14.5, [ROOM - 200]], [AT.pop[MAC], [MAC], E.lin],
  ];
  const beadX = (t) => keys(t, BEAD)[0];
  function cam(t) {
    if (t < AT.bead) return keys(t, CAM1);
    const follow = [beadX(t) + 420, WIRE_Y - 150, 1.0];
    if (t < 45.5) return follow;
    if (t < AT.pageArr) { const p = prog(t, 45.5, AT.pageArr); return follow.map((v, i) => lerp(v, CARD_FRAME[i], p)); }
    return keys(t, CAM2);
  }

  const impact = (t, at, hl = 0.12) => (t < at ? 0 : Math.exp((-(t - at) / hl) * Math.LN2));
  const flipP = (t, at, dur = 0.5) => prog(t, at, at + dur, E.io);
  const flipScale = (p) => Math.abs(Math.cos(Math.PI * p));

  const label = (s, x, y, alpha = 1) => G.text(s, x, y, { font: FONT.mono(11, 500), color: C.muted, tracking: 1.2, alpha });
  function artwork(x, y, s, song) {
    const g = G.ctx.createLinearGradient(x, y, x + s, y + s);
    if (song === 0) { g.addColorStop(0, "#3b3833"); g.addColorStop(1, "#141310"); }
    else { g.addColorStop(0, "#6b665c"); g.addColorStop(1, "#2a2823"); }
    G.rect(x, y, s, s, g);
    G.ctx.save(); G.ctx.beginPath(); G.ctx.rect(x, y, s, s); G.ctx.clip();
    if (song === 0) G.dot(x + s * 0.62, y + s * 0.4, s * 0.22, rgba(C.fg, 0.12));
    else for (let i = 0; i < 5; i++) G.line(x + s * (0.15 + i * 0.17), y, x + s * (0.15 + i * 0.17) - s * 0.3, y + s, rgba(C.fg, 0.1), s * 0.04);
    G.ctx.restore();
  }
  function lyricBars(x, y, w, sungP, alpha = 1) {
    const ctx = G.ctx;
    const row = (yy, ww, p) => {
      ctx.save(); ctx.globalAlpha *= alpha;
      ctx.fillStyle = rgba(C.fg, 0.22); ctx.beginPath(); ctx.roundRect(x, yy, ww, 9, 4.5); ctx.fill();
      if (p > 0) { ctx.fillStyle = C.fg; ctx.beginPath(); ctx.roundRect(x, yy, ww * clamp01(p), 9, 4.5); ctx.fill(); }
      ctx.restore();
    };
    row(y, w * 0.78, sungP * 1.6);
    row(y + 22, w * 0.56, (sungP - 0.62) * 1.6);
  }
  function spark(x, y, w, h, seed, color) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push([x + u * w, y + h - h * (0.35 + 0.3 * Math.sin(u * 9 + seed) + 0.2 * Math.sin(u * 23 + seed * 2))]);
    }
    G.poly(pts, color, 1.2);
  }
  function rings(cx, cy, r) {
    [[r, 0.78, C.fg], [r - 14, 0.55, C.muted], [r - 28, 0.9, rgba(C.fg, 0.7)]].forEach(([rr, p, col]) => {
      G.ctx.save(); G.ctx.strokeStyle = rgba(C.fg, 0.12); G.ctx.lineWidth = 8; G.ctx.beginPath(); G.ctx.arc(cx, cy, rr, 0, Math.PI * 2); G.ctx.stroke();
      G.ctx.strokeStyle = col; G.ctx.lineCap = "round"; G.ctx.beginPath(); G.ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); G.ctx.stroke();
      G.ctx.restore();
    });
  }

  function heroContent(t, c, flip) {
    const ctx = G.ctx;
    const pad = 20, art = 150;
    label("NOW PLAYING · APPLE MUSIC", c.x + pad, c.y + 30);
    G.text("MacBook Pro", c.x + c.w - pad, c.y + 30, { font: FONT.mono(11, 500), color: C.muted, align: "right", tracking: 1 });
    ctx.save();
    const cy = c.y + 54 + art / 2;
    ctx.translate(0, cy); ctx.scale(1, flipScale(flip)); ctx.translate(0, -cy);
    const shown = flip < 0.5 ? 0 : 1, sd = SONG[shown];
    artwork(c.x + pad, c.y + 54, art, shown);
    const tx = c.x + pad + art + 24;
    G.text(sd.title, tx, c.y + 96, { font: FONT.sans(28, 600), color: C.fg });
    G.text(sd.artist, tx, c.y + 126, { font: FONT.sans(17, 500), color: C.muted });
    const pw = c.x + c.w - pad - tx;
    const elapsed = shown === 0 ? 130 : Math.max(0, t - (t < 22 ? AT.flip1 : AT.flip2));
    const pp = clamp01(elapsed / sd.dur);
    G.line(tx, c.y + 150, tx + pw, c.y + 150, rgba(C.fg, 0.2), 2);
    G.line(tx, c.y + 150, tx + pw * pp, c.y + 150, C.fg, 2);
    G.dot(tx + pw * pp, c.y + 150, 3.5, C.fg);
    const mm = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
    G.text(mm(elapsed), tx, c.y + 172, { font: FONT.mono(12), color: C.muted });
    G.text(mm(sd.dur), tx + pw, c.y + 172, { font: FONT.mono(12), color: C.muted, align: "right" });
    const lyricT = shown === 0 ? (t * 0.09) % 1 : clamp01(elapsed / 7);
    lyricBars(tx, c.y + 188, pw, lyricT);
    ctx.restore();
  }

  function cardContent(t, c) {
    const pad = 20;
    switch (c.id) {
      case "contact": {
        label("CONTACT", c.x + pad, c.y + 30);
        G.dot(c.x + pad + 26, c.y + 90, 26, C.surfaceHover);
        G.text("LYJW131", c.x + pad + 68, c.y + 84, { font: FONT.sans(22, 600) });
        G.text("github.com/LYJW131 · lyjw.me", c.x + pad + 68, c.y + 108, { font: FONT.mono(12), color: C.muted });
        for (let i = 0; i < 26; i++) for (let j = 0; j < 3; j++) G.rect(c.x + pad + 68 + i * 11, c.y + 128 + j * 11, 8, 8, rgba(C.fg, 0.08 + 0.3 * ((i * 7 + j * 13) % 5 === 0)));
        break;
      }
      case "timezone": {
        label("TIMEZONE", c.x + pad, c.y + 30);
        G.text("11:42", c.x + pad, c.y + 110, { font: FONT.mono(56, 500) });
        G.text("Asia/Shanghai · GMT+8", c.x + pad, c.y + 150, { font: FONT.mono(13), color: C.muted });
        G.text("Mon, Oct 6", c.x + c.w - pad, c.y + 150, { font: FONT.mono(13), color: C.muted, align: "right" });
        break;
      }
      case "charger": {
        label("CHARGER", c.x + pad, c.y + 30);
        G.text("65 W", c.x + pad, c.y + 92, { font: FONT.mono(44, 500) });
        spark(c.x + pad, c.y + 110, c.w - pad * 2, 60, 2, rgba(C.fg, 0.6));
        G.text("C1 45 W · C2 20 W", c.x + pad, c.y + c.h - 18, { font: FONT.mono(12), color: C.muted });
        break;
      }
      case "powerbank": {
        label("POWER BANK", c.x + pad, c.y + 30);
        G.text("82%", c.x + pad, c.y + 92, { font: FONT.mono(44, 500) });
        G.rect(c.x + pad, c.y + 120, c.w - pad * 2, 8, rgba(C.fg, 0.14));
        G.rect(c.x + pad, c.y + 120, (c.w - pad * 2) * 0.82, 8, C.fg);
        G.text("30.1 °C · in 0 W · out 18 W", c.x + pad, c.y + c.h - 18, { font: FONT.mono(12), color: C.muted });
        break;
      }
      case "recent": {
        label("RECENTLY PLAYED", c.x + pad, c.y + 30);
        for (let i = 0; i < 4; i++) {
          const x = c.x + pad + i * ((c.w - pad * 2) / 4), y = c.y + 50;
          G.rect(x, y, 48, 48, i % 2 ? "#2b2924" : "#3a3731");
          G.rect(x + 60, y + 12, 70 - i * 8, 8, rgba(C.fg, 0.7));
          G.rect(x + 60, y + 30, 48, 7, rgba(C.fg, 0.3));
        }
        break;
      }
      case "activity": {
        label("ACTIVITY", c.x + pad, c.y + 30);
        rings(c.x + pad + 92, c.y + c.h / 2 + 10, 86);
        const tx = c.x + pad + 210;
        [["MOVE", "612 / 700 kcal"], ["EXERCISE", "34 / 60 min"], ["STAND", "11 / 12 h"]].forEach(([k, v], i) => {
          label(k, tx, c.y + 72 + i * 56);
          G.text(v, tx, c.y + 96 + i * 56, { font: FONT.mono(20, 500) });
        });
        break;
      }
      case "workouts": {
        label("WORKOUTS", c.x + pad, c.y + 30);
        [0.7, 0.45, 0.9, 0.3, 0.6].forEach((h, i) => G.rect(c.x + pad + i * 60, c.y + 170 - h * 100, 36, h * 100, rgba(C.fg, 0.25 + 0.5 * (i === 2))));
        G.text("Outdoor Run · 42 min", c.x + pad, c.y + c.h - 24, { font: FONT.mono(12), color: C.muted });
        break;
      }
      case "server": {
        label("SERVER · TOKYO", c.x + pad, c.y + 30);
        G.text("↑ 12.4 Mb/s", c.x + pad, c.y + 80, { font: FONT.mono(26, 500) });
        G.text("↓ 3.1 Mb/s", c.x + pad + 220, c.y + 80, { font: FONT.mono(26, 500), color: C.muted });
        spark(c.x + pad, c.y + 100, c.w - pad * 2, 100, 5, rgba(C.fg, 0.55));
        G.text("CPU 7% · MEM 41% · 23 d up", c.x + c.w - pad, c.y + 80, { font: FONT.mono(13), color: C.muted, align: "right" });
        break;
      }
    }
  }

  function drawPage(t, explode, flip) {
    const ctx = G.ctx;
    const hx = HERO.x + HERO.w / 2, hy = HERO.y + HERO.h / 2;
    G.text("Ghostty", PX + 512 + 14, PY + 26, { font: FONT.sans(15, 600), color: C.fg, align: "left" });
    G.rect(PX + 512 - 18, PY + 11, 20, 20, C.surfaceHover);
    G.line(PX, PY + 44, PX + 1024, PY + 44, C.line);
    for (const c of CARDS) {
      if (c.id === "hero") continue;
      const dx = (c.x + c.w / 2 - hx) * 0.1 * explode, dy = (c.y + c.h / 2 - hy) * 0.1 * explode;
      ctx.save(); ctx.translate(dx, dy); ctx.globalAlpha *= 1 - 0.74 * explode;
      G.rect(c.x, c.y, c.w, c.h, C.surface, C.line);
      cardContent(t, c);
      ctx.restore();
    }
    ctx.save();
    const lift = 1 + 0.03 * explode;
    ctx.translate(hx, hy); ctx.scale(lift, lift); ctx.translate(-hx, -hy);
    if (explode > 0) { ctx.shadowColor = `rgba(0,0,0,${0.6 * explode})`; ctx.shadowBlur = 60 * explode; ctx.shadowOffsetY = 20 * explode; }
    G.rect(HERO.x, HERO.y, HERO.w, HERO.h, C.surface);
    ctx.shadowColor = "transparent";
    G.rect(HERO.x, HERO.y, HERO.w, HERO.h, null, explode > 0 ? rgba(C.fg, 0.2 + 0.3 * explode) : C.line);
    heroContent(t, HERO, flip);
    ctx.restore();
  }

  function box(x, title, sub, w = BOX_W, h = BOX_H, glow = 0, alpha = 1) {
    const ctx = G.ctx;
    const x0 = x - w / 2, y0 = WIRE_Y - h / 2;
    ctx.save(); ctx.globalAlpha *= alpha;
    G.rect(x0, y0, w, h, C.surface, C.line);
    if (glow > 0) { ctx.save(); ctx.shadowColor = C.signal; ctx.shadowBlur = 30 * glow; G.rect(x0, y0, w, h, null, rgba(C.signal, glow), 2); ctx.restore(); }
    G.text(title, x0 + 28, y0 + 48, { font: FONT.mono(28, 600) });
    G.text(sub, x0 + 28, y0 + 78, { font: FONT.mono(17), color: C.muted });
    ctx.restore();
    return { x0, y0, w, h };
  }
  function popIn(t, at, fn) {
    const p = prog(t, at, at + 0.4, E.out);
    if (p <= 0) return;
    const ctx = G.ctx;
    ctx.save(); ctx.globalAlpha *= p;
    fn(p);
    ctx.restore();
  }
  function card(x0, y0, w, h, title) {
    G.rect(x0, y0, w, h, C.surface, C.line);
    if (title) G.text(title, x0 + 24, y0 + 36, { font: FONT.mono(13, 500), color: C.muted, tracking: 1.4 });
  }
  function leader(x, y0, y1, alpha = 1) { G.line(x, y0, x, y1, rgba(C.fg, 0.35 * alpha), 1.2, [4, 6]); }
  function check(x, y, on, size = 20) {
    G.rect(x, y - size + 4, size, size, null, on ? C.fg : rgba(C.fg, 0.35), 1.5);
    if (on) G.poly([[x + 4, y - size / 2 + 4], [x + size / 2 - 1, y + 0], [x + size - 3, y - size + 8]], C.fg, 2.2);
  }

  const JSON_LINES = [
    "{", '  "version": 4,', '  "presence": "online",', '  "heartbeatAt": 1759541180000,', '  "activeModules": ["appleMusic"],',
    '  "modules": {', '    "appleMusic": {', '      "music": {', '        "state": "playing",', '        "title": "アイドル",',
    '        "artist": "YOASOBI",', '        "positionMs": 0,', '        "observedAt": 1759541180412', "      }", "    }", "  }", "}",
  ];
  const CHECKS = ["POST", "source: mac", "Access JWT · lyjwpage-mac", "body ≤ 4 MiB", "JSON", "prepare → command"];
  const ROUTES = [["realtime", "CORE.commitIngest"], ["lag", "KV LAG · —"], ["archive", "D1 · —"], ["credentials", "KV CREDENTIALS · —"]];

  function stations(t) {
    const bx = beadX(t), beadOn = t >= AT.bead && t < AT.pageArr + 0.3;
    const inBox = (x) => (beadOn && Math.abs(bx - x) < BOX_W / 2 ? 1 : 0);
    const glowAt = (x, arr) => Math.max(inBox(x) * 0.6, impact(t, arr, 0.5));

    popIn(t, AT.pop[MAC], () => {
      const b = box(MAC, "Apple Music", "macOS · where this change happened", BOX_W, BOX_H, 0);
      const fp = flipP(t, AT.flipMac), shown = fp < 0.5 ? 0 : 1, sd = SONG[shown];
      const ctx = G.ctx; ctx.save();
      const cy = b.y0 + 170; ctx.translate(0, cy); ctx.scale(1, flipScale(fp)); ctx.translate(0, -cy);
      artwork(b.x0 + 28, b.y0 + 138, 64, shown);
      G.text(sd.title, b.x0 + 108, b.y0 + 164, { font: FONT.sans(21, 600) });
      G.text(sd.artist, b.x0 + 108, b.y0 + 188, { font: FONT.sans(15), color: C.muted });
      G.text(shown ? "▶ 0:00" : "▶ 2:10", b.x0 + b.w - 28, b.y0 + 188, { font: FONT.mono(14), color: C.muted, align: "right" });
      ctx.restore();
      if (t >= AT.flipMac) G.ring(b.x0 + 60, b.y0 + 170, 40 + 220 * prog(t, AT.flipMac, AT.flipMac + 0.9, E.out), 0.8 * (1 - prog(t, AT.flipMac, AT.flipMac + 0.9)), 2);
    });

    popIn(t, AT.pop[HUB], () => {
      const b = box(HUB, "Mac Telemetry Hub", "menu bar app · POST /api/ingest/mac", BOX_W, BOX_H, glowAt(HUB, AT.hubArr));
      G.text("sends only the modules that changed", b.x0 + 28, b.y0 + 152, { font: FONT.mono(16), color: C.muted });
      G.text("heartbeat every 90 s when nothing changes", b.x0 + 28, b.y0 + 178, { font: FONT.mono(16), color: C.muted });
      G.text("key: lyjwpage-mac (Cloudflare Access)", b.x0 + 28, b.y0 + 204, { font: FONT.mono(16), color: C.muted });
      const jp = prog(t, AT.json, AT.json + 0.3, E.out);
      if (jp > 0) {
        const w = 600, h = 428, x0 = HUB - w / 2, y0 = b.y0 - 36 - h;
        G.ctx.save(); G.ctx.globalAlpha *= jp * (1 - prog(t, 34.6, 35.4));
        leader(HUB, y0 + h, b.y0);
        card(x0, y0, w, h, "ENVELOPE · ONLY THE MODULE THAT CHANGED");
        const n = Math.floor((t - AT.json) / 0.07);
        JSON_LINES.forEach((l, i) => {
          if (i > n) return;
          const hot = /appleMusic|title|artist|activeModules/.test(l);
          G.text(l, x0 + 24, y0 + 68 + i * 21, { font: FONT.mono(15.5), color: hot ? C.fg : C.muted });
        });
        G.ctx.restore();
      }
    });

    popIn(t, AT.pop[ING], () => {
      const b = box(ING, "ingress", "Cloudflare Worker · ingest.homepage.lyjw.llc", BOX_W, BOX_H, glowAt(ING, AT.ingArr));
      G.text("authenticate · validate · route by data layer", b.x0 + 28, b.y0 + 152, { font: FONT.mono(16), color: C.muted });
      G.text("202 waits for core reply + LAG + CREDENTIALS", b.x0 + 28, b.y0 + 178, { font: FONT.mono(16), color: C.muted });
      G.text("one envelope, four routes · this one uses one", b.x0 + 28, b.y0 + 204, { font: FONT.mono(16), color: C.muted });
      const cp = prog(t, AT.ingArr, AT.ingArr + 0.3, E.out);
      if (cp > 0) {
        const w = 560, h = 290, x0 = ING - w / 2, y0 = b.y0 - 36 - h;
        G.ctx.save(); G.ctx.globalAlpha *= cp * (1 - prog(t, 40.0, 40.8));
        leader(ING, y0 + h, b.y0);
        card(x0, y0, w, h, "CHECKS · IN CODE ORDER");
        CHECKS.forEach((s, i) => {
          const on = t >= AT.check + i * 0.3;
          check(x0 + 24, y0 + 76 + i * 34, on);
          G.text(s, x0 + 60, y0 + 76 + i * 34, { font: FONT.mono(18), color: on ? C.fg : rgba(C.fg, 0.45) });
        });
        G.ctx.restore();
      }
      const sp = prog(t, AT.split, AT.split + 0.5, E.out);
      if (sp > 0) {
        G.ctx.save(); G.ctx.globalAlpha *= sp * (1 - prog(t, 46.0, 47.0));
        const x0 = b.x0 + b.w + 40, y0 = WIRE_Y + 44;
        G.text("ROUTES", x0, y0 - 46, { font: FONT.mono(12), color: C.muted, tracking: 1.4 });
        ROUTES.forEach(([k, v], i) => {
          const y = y0 + i * 32, lit = i === 0;
          if (!lit) G.line(ING + b.w / 2, WIRE_Y, x0 - 8, y - 6, rgba(C.fg, 0.18), 1.2, [3, 5]);
          G.text(k, x0, y, { font: FONT.mono(17, lit ? 600 : 500), color: lit ? C.signal : rgba(C.fg, 0.4) });
          G.text(v, x0 + 150, y, { font: FONT.mono(15), color: lit ? C.fg : rgba(C.fg, 0.35) });
        });
        G.ctx.restore();
      }
      const two = win(t, 43.8, 44.0, 46.2, 46.8, E.out);
      if (two > 0) {
        const s = 1 + 0.5 * impact(t, 43.8, 0.15);
        G.ctx.save(); G.ctx.globalAlpha *= two; G.ctx.translate(b.x0 + b.w - 70, b.y0 + 54); G.ctx.scale(s, s);
        G.text("202", 0, 0, { font: FONT.mono(34, 700), color: C.signal, align: "center" });
        G.ctx.restore();
      }
    });

    popIn(t, AT.pop[CORE], () => {
      const w = 640, b = box(CORE, "StateCore", "WorkerEntrypoint · api Worker", w, BOX_H, glowAt(CORE, AT.coreArr));
      const ix = b.x0 + 28, iy = b.y0 + 132, iw = w - 56, ih = 72;
      const hot = impact(t, AT.commit, 0.6);
      G.rect(ix, iy, iw, ih, C.bg, rgba(C.fg, 0.3 + 0.5 * hot));
      if (hot > 0) { G.ctx.save(); G.ctx.shadowColor = C.signal; G.ctx.shadowBlur = 24 * hot; G.rect(ix, iy, iw, ih, null, rgba(C.signal, hot), 2); G.ctx.restore(); }
      G.text("StateHub", ix + 18, iy + 30, { font: FONT.mono(21, 600) });
      G.text("Durable Object · one instance · SQLite", ix + 130, iy + 30, { font: FONT.mono(15), color: C.muted });
      G.text("one queue, commits in arrival order", ix + 18, iy + 54, { font: FONT.mono(15), color: C.muted });
      for (let i = 0; i < 4; i++) {
        const qx = ix + iw - 36 - i * 24, pulse = 0.25 + 0.2 * Math.sin(t * 3 + i);
        G.rect(qx, iy + 38, 14, 14, rgba(C.fg, pulse));
      }
      const ep = win(t, AT.enrich[0], AT.enrich[0] + 0.3, AT.enrich[1] + 0.8, AT.enrich[1] + 1.3);
      if (ep > 0) {
        G.ctx.save(); G.ctx.globalAlpha *= ep;
        const ty = b.y0 - 120;
        leader(CORE + 120, ty + 10, b.y0);
        G.text("enrich: Apple Music catalog", CORE + 120, ty, { font: FONT.mono(17), color: C.fg, align: "center" });
        G.text("artwork · link · songId · lyrics?", CORE + 120, ty - 26, { font: FONT.mono(14), color: C.muted, align: "center" });
        const q = (t - AT.enrich[0]) / (AT.enrich[1] - AT.enrich[0]);
        if (q < 1) G.dot(CORE + 120, b.y0 - (q < 0.5 ? q * 2 : 2 - q * 2) * 110, 4, C.signal);
        G.ctx.restore();
      }
      const fx = prog(t, AT.commit, AT.commit + 0.3, E.out);
      if (fx > 0) {
        G.ctx.save(); G.ctx.globalAlpha *= fx * (1 - prog(t, 46.0, 46.8));
        G.text("effects: [ listening ]", b.x0 + w + 24, WIRE_Y - 26, { font: FONT.mono(17), color: C.fg });
        G.text("→ broadcast listening-now ∥ reply to ingress", b.x0 + w + 24, WIRE_Y - 2, { font: FONT.mono(14), color: C.muted });
        G.text("waitUntil: network never blocks the queue", b.x0 + w + 24, WIRE_Y + 20, { font: FONT.mono(14), color: C.muted });
        G.ctx.restore();
      }
    });

    popIn(t, AT.pop[ROOM], () => {
      const b = box(ROOM, "LivePushRoom", "Durable Object · WebSocket /ws · one room", BOX_W, BOX_H, glowAt(ROOM, AT.roomArr));
      G.text("every open page holds one socket", b.x0 + 28, b.y0 + 152, { font: FONT.mono(16), color: C.muted });
      G.text("broadcast: listening-now", b.x0 + 28, b.y0 + 178, { font: FONT.mono(16), color: t >= AT.roomArr ? C.fg : C.muted });
      G.text("hibernates between messages", b.x0 + 28, b.y0 + 204, { font: FONT.mono(16), color: C.muted });
      const rp = prog(t, AT.roomArr, AT.roomArr + 1.4, E.out);
      if (rp > 0 && rp < 1) G.ring(ROOM, WIRE_Y, 80 + 900 * rp, (1 - rp) * 0.9, 3);
      const rp2 = prog(t, AT.roomArr + 0.25, AT.roomArr + 1.65, E.out);
      if (rp2 > 0 && rp2 < 1) G.ring(ROOM, WIRE_Y, 80 + 900 * rp2, (1 - rp2) * 0.5, 2);
    });
  }

  function wire(t) {
    if (t < 11.5) return;
    const left = keys(t, WIRE_LEFT)[0];
    G.line(left, WIRE_Y, CARD_X, WIRE_Y, rgba(C.fg, 0.5), 1.6);
    if (t >= AT.bead && t < AT.pageArr) {
      const bx = beadX(t);
      const stops = [MAC, HUB, ING, CORE, ROOM, CARD_X];
      let from = MAC;
      for (const s of stops) if (s <= bx) from = s;
      G.ctx.save(); G.ctx.shadowColor = C.signal; G.ctx.shadowBlur = 12;
      G.line(from, WIRE_Y, bx, WIRE_Y, rgba(C.signal, 0.85), 2.2);
      G.ctx.restore();
    }
    if (t >= AT.fork && t < 44.6) {
      const p = prog(t, AT.fork, AT.fork + 1.5, E.io), gx = lerp(CORE - 320, ING + 280, p);
      G.bead(gx, WIRE_Y + 36, 5, 0.9 * (1 - prog(t, 43.6, 44.4)));
      G.text("202", gx, WIRE_Y + 66, { font: FONT.mono(14), color: C.signal, align: "center", alpha: 0.9 * (1 - prog(t, 43.6, 44.4)) });
    }
  }

  function narration(t) {
    const N = [
      [AT.n1, ["这张卡片，", "是怎么知道 Mac 上换了歌的？"]],
      [AT.n2, ["顺着这根线往回走。"]],
      [AT.n3, ["线的另一头，是我的 Mac。"]],
      [AT.n4, ["从这里开始，慢放一遍。"]],
      [AT.n5, ["Hub 只寄变了的模块：appleMusic。"]],
      [AT.n6, ["入口验钥匙、称重、校验；", "只有实时那一半交出去。"]],
      [AT.n7, ["StateHub 排一条队串行落账，", "回执和推送同时出发。"]],
      [AT.n8, ["推送房间把 listening-now", "广播给每个开着的页面。"]],
      [AT.n9, ["写进 SWR，卡片当场翻面。"]],
      [AT.n10, ["接下来每一章，都从一张卡出发，", "顺着线走回它的源头。"]],
    ];
    for (const [[t0, t1], lines] of N) {
      if (t < t0 || t > t1) continue;
      const out = 1 - prog(t, t1 - 0.35, t1, E.in);
      G.scrim(prog(t, t0, t0 + 0.4) * out);
      const y0 = lines.length === 1 ? 940 : 870;
      lines.forEach((s, i) => G.reveal(s, 120, y0 + i * 76, t, t0 + i * 0.25, { font: FONT.cjk(60, 500), alpha: out }));
    }
  }

  function chrome(t) {
    const a = prog(t, 1.2, 2.0);
    if (a > 0) {
      G.text("01", 120, 96, { font: FONT.mono(26, 600), color: C.signal, alpha: a });
      G.text("这张卡怎么知道的", 172, 96, { font: FONT.cjk(26, 500), color: C.muted, alpha: a });
      G.text("lyjw.me · how it works · v3 draft", 1800, 96, { font: FONT.mono(16), color: C.dim, align: "right", alpha: a });
    }
    const mp = win(t, AT.pageArr - 0.2, AT.pageArr + 0.3, 50.0, 50.8);
    if (mp > 0) {
      const [sx, sy] = G.toScreen(CARD_X, HERO.y);
      G.text('mutate("/api/status/listening/now")', sx, sy - 26, { font: FONT.mono(20), color: C.signal, alpha: mp });
    }
    const tp = prog(t, AT.title, AT.title + 0.8, E.out);
    if (tp > 0) {
      G.reveal("拆开来看", 960 - 192, 250, t, AT.title, { font: FONT.cjk(96, 700), per: 0.08, dur: 0.5, rise: 16 });
      G.text("lyjw.me 运行原理 · 一张卡，一条线，一路走回源头", 960, 296, { font: FONT.cjk(24, 500), color: C.muted, align: "center", alpha: prog(t, AT.title + 0.5, AT.title + 1.1) });
    }
  }

  window.CHAPTERS.push({
    id: "ch01", title: "01 这张卡怎么知道的", bars: 26,
    render(f) {
      const t = f.t;
      const [cx, cy, cz] = cam(t);
      G.cam = { x: cx, y: cy, z: cz };
      G.begin();
      const explode = prog(t, AT.explode[0], AT.explode[1], E.io);
      const flip = t < 22 ? flipP(t, AT.flip1) : flipP(t, AT.flip2);
      G.world(() => {
        wire(t);
        stations(t);
        drawPage(t, explode, flip);
        if (t >= AT.bead) G.bead(beadX(t), WIRE_Y, 7, prog(t, AT.bead - 0.2, AT.bead + 0.2) * (1 - prog(t, AT.pageArr, AT.pageArr + 0.4)));
        if (t >= AT.pageArr) G.ring(CARD_X, WIRE_Y, 10 + 260 * prog(t, AT.pageArr, AT.pageArr + 0.9, E.out), 0.8 * (1 - prog(t, AT.pageArr, AT.pageArr + 0.9)), 2);
      });
      G.screen(() => {
        G.vignette(0.5);
        chrome(t);
        narration(t);
        G.fade(1 - prog(t, AT.fadeIn[0], AT.fadeIn[1], E.out));
        G.fade(prog(t, AT.fadeOut[0], AT.fadeOut[1], E.in));
      });
    },
  });
})();
