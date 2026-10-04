import { S } from "./scene.js";
const { THREE } = S;
const { C, FONT, E, prog, win, keys, lerp, clamp01, rgba } = G;

const K = 1024 / 614, U = 1 / 100;
// 卡片框按 docs/explainer/v2/ch04.js#P 的实测比例（614 宽）放大到首页 1024 宽，再按 100 px = 1 单位进场景。
const CARDS = [
  ["header", 0, -26, 614, 26], ["contact", 0, 64, 304, 121], ["timezone", 310, 64, 304, 121],
  ["charger", 0, 192, 214, 117], ["powerbank", 0, 313, 214, 117],
  ["hero", 218, 192, 396, 142], ["recent", 218, 338, 396, 92],
  ["activity", 0, 437, 372, 152], ["workouts", 376, 437, 238, 152], ["server", 0, 596, 614, 152],
].map(([id, x, y, w, h]) => ({ id, px: x * K, py: y * K, pw: w * K, ph: h * K }));
const PX0 = 24.0, PY0 = 4.4;
for (const c of CARDS) { c.cx = PX0 + (c.px + c.pw / 2) * U; c.cy = PY0 - (c.py + c.ph / 2) * U; c.w = c.pw * U; c.h = c.ph * U; }
const HERO = CARDS.find((c) => c.id === "hero");
const CARD_X = PX0 + HERO.px * U, HX = HERO.cx;
const MAC = -38, HUB = -27, ING = -16, CORE = -5, ROOM = 6;

const SONG = [
  { title: "夜に駆ける", artist: "YOASOBI", dur: 261 },
  { title: "アイドル", artist: "YOASOBI", dur: 213 },
];

const AT = {
  fadeIn: [0, 1.2], flip1: 4.0, n1: [6.5, 11.0],
  explode: [11.0, 12.8], n2: [13.0, 17.0],
  pop: { [ROOM]: 13.4, [CORE]: 15.9, [ING]: 17.4, [HUB]: 18.9, [MAC]: 20.3 },
  n3: [21.0, 25.0], n4: [25.0, 28.5], flipMac: 26.0,
  bead: 28.5, hubArr: 29.5, json: 29.7, n5: [29.5, 33.5],
  ingArr: 35.0, check: 35.2, split: 37.2, n6: [35.0, 40.5],
  coreArr: 40.0, enrich: [40.2, 41.2], commit: 41.6, fork: 42.3, n7: [40.5, 44.0],
  roomArr: 44.0, n8: [44.2, 47.8], pageArr: 47.5, flip2: 48.0, n9: [48.2, 52.0],
  pull: [52.5, 55.2], n10: [54.0, 59.5], title: 55.5, fadeOut: [62.5, 64.5],
};

const CARD1 = [HX, 0.1, 7.4, HX, 0, 0, 32];
const CARD2 = [HX, 0.1, 8.4, HX, 0, 1.0, 32];
const CAM1 = [
  [0, [23.2, -4.4, 26.5, 29.4, -2.2, 0, 32]],
  [AT.flip1, [24.2, -4.0, 25.6, 29.4, -2.2, 0, 32], E.lin],
  [6.0, CARD1, E.io],
  [11.0, CARD1],
  [12.8, [26.6, 2.1, 10.2, 30.2, -0.4, 0, 32], E.io],
  [13.2, [26.6, 2.1, 10.2, 30.2, -0.4, 0, 32]],
  [14.8, [ROOM - 3, 5.5, 17, ROOM + 1, 0.2, -1, 34], E.io],
  [AT.pop[MAC], [MAC - 3, 5.5, 17, MAC + 1, 0.2, -1, 34], E.lin],
  [22.5, [MAC - 3.6, 2.6, 14, MAC - 2.8, 1.7, 0, 32], E.io],
];
const CAM2 = [
  [AT.pageArr, CARD2],
  [AT.pull[0], CARD2],
  [AT.pull[1], [-8, 11, 50, -4, 0.3, -2, 44], E.io],
];
const BEAD = [
  [AT.bead, [MAC]], [AT.hubArr, [HUB], E.io], [33.5, [HUB]], [AT.ingArr, [ING], E.io], [38.5, [ING]],
  [AT.coreArr, [CORE], E.io], [AT.fork, [CORE]], [AT.roomArr, [ROOM], E.io], [44.6, [ROOM]], [AT.pageArr, [CARD_X], E.io],
];
const WIRE_LEFT = [[11.5, [CARD_X]], [AT.pop[ROOM], [ROOM], E.out], [14.8, [ROOM - 2]], [AT.pop[MAC], [MAC], E.lin]];
const beadX = (t) => keys(t, BEAD)[0];
function cam(t) {
  if (t < AT.bead) return keys(t, CAM1);
  const bx = beadX(t), follow = [bx - 3.6, 2.6, 14, bx - 2.8, 1.7, 0, 32];
  if (t < 45.5) return follow;
  if (t < AT.pageArr) { const p = prog(t, 45.5, AT.pageArr); return follow.map((v, i) => lerp(v, CARD2[i], p)); }
  return keys(t, CAM2);
}
const impact = (t, at, hl = 0.12) => (t < at ? 0 : Math.exp((-(t - at) / hl) * Math.LN2));
const flipP = (t, at, dur = 0.55) => prog(t, at, at + dur, E.io);

const label = (s, x, y, alpha = 1) => G.text(s, x, y, { font: FONT.mono(11, 500), color: C.muted, tracking: 1.2, alpha });
function artwork(x, y, s, song) {
  const g = G.ctx.createLinearGradient(x, y, x + s, y + s);
  if (song === 0) { g.addColorStop(0, "#3b3833"); g.addColorStop(1, "#141310"); } else { g.addColorStop(0, "#6b665c"); g.addColorStop(1, "#2a2823"); }
  G.rect(x, y, s, s, g);
  G.ctx.save(); G.ctx.beginPath(); G.ctx.rect(x, y, s, s); G.ctx.clip();
  if (song === 0) G.dot(x + s * 0.62, y + s * 0.4, s * 0.22, rgba(C.fg, 0.12));
  else for (let i = 0; i < 5; i++) G.line(x + s * (0.15 + i * 0.17), y, x + s * (0.15 + i * 0.17) - s * 0.3, y + s, rgba(C.fg, 0.1), s * 0.04);
  G.ctx.restore();
}
function lyricBars(x, y, w, sungP) {
  const ctx = G.ctx;
  const row = (yy, ww, p) => {
    ctx.fillStyle = rgba(C.fg, 0.22); ctx.beginPath(); ctx.roundRect(x, yy, ww, 9, 4.5); ctx.fill();
    if (p > 0) { ctx.fillStyle = C.fg; ctx.beginPath(); ctx.roundRect(x, yy, ww * clamp01(p), 9, 4.5); ctx.fill(); }
  };
  row(y, w * 0.78, sungP * 1.6);
  row(y + 22, w * 0.56, (sungP - 0.62) * 1.6);
}
function spark(x, y, w, h, seed, color) {
  const pts = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push([x + u * w, y + h - h * (0.35 + 0.3 * Math.sin(u * 9 + seed) + 0.2 * Math.sin(u * 23 + seed * 2))]); }
  G.poly(pts, color, 1.2);
}
function rings(cx, cy, r) {
  [[r, 0.78, C.fg], [r - 14, 0.55, C.muted], [r - 28, 0.9, rgba(C.fg, 0.7)]].forEach(([rr, p, col]) => {
    const ctx = G.ctx; ctx.save(); ctx.lineWidth = 8;
    ctx.strokeStyle = rgba(C.fg, 0.12); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
    ctx.restore();
  });
}
const surface = (w, h) => { const g = G.ctx.createLinearGradient(0, 0, w * 0.3, h); g.addColorStop(0, "#26241f"); g.addColorStop(1, "#191814"); G.rect(0, 0, w, h, g); };

function heroPaint(t, w, h, flip) {
  surface(w, h);
  const pad = 20, art = 150;
  label("NOW PLAYING · APPLE MUSIC", pad, 30);
  G.text("MacBook Pro", w - pad, 30, { font: FONT.mono(11, 500), color: C.muted, align: "right", tracking: 1 });
  const shown = flip < 0.5 ? 0 : 1, sd = SONG[shown];
  artwork(pad, 54, art, shown);
  const tx = pad + art + 24, pw = w - pad - tx;
  G.text(sd.title, tx, 96, { font: FONT.sans(28, 600), color: C.fg });
  G.text(sd.artist, tx, 126, { font: FONT.sans(17, 500), color: C.muted });
  const elapsed = shown === 0 ? 130 : Math.max(0, t - (t < 22 ? AT.flip1 : AT.flip2));
  const pp = clamp01(elapsed / sd.dur);
  G.line(tx, 150, tx + pw, 150, rgba(C.fg, 0.2), 2);
  G.line(tx, 150, tx + pw * pp, 150, C.fg, 2);
  G.dot(tx + pw * pp, 150, 3.5, C.fg);
  const mm = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  G.text(mm(elapsed), tx, 172, { font: FONT.mono(12), color: C.muted });
  G.text(mm(sd.dur), tx + pw, 172, { font: FONT.mono(12), color: C.muted, align: "right" });
  lyricBars(tx, 188, pw, shown === 0 ? (t * 0.09) % 1 : clamp01(elapsed / 7));
}
function cardPaint(id, w, h) {
  surface(w, h);
  const pad = 20;
  switch (id) {
    case "header":
      G.rect(0, 0, w, h, C.bg);
      G.rect(w / 2 - 18, 11, 20, 20, C.surfaceHover);
      G.text("Ghostty", w / 2 + 14, 26, { font: FONT.sans(15, 600), color: C.fg });
      G.line(0, h - 1, w, h - 1, C.line, 1);
      break;
    case "contact":
      label("CONTACT", pad, 30);
      G.dot(pad + 26, 90, 26, C.surfaceHover);
      G.text("LYJW131", pad + 68, 84, { font: FONT.sans(22, 600) });
      G.text("github.com/LYJW131 · lyjw.me", pad + 68, 108, { font: FONT.mono(12), color: C.muted });
      for (let i = 0; i < 26; i++) for (let j = 0; j < 3; j++) G.rect(pad + 68 + i * 11, 128 + j * 11, 8, 8, rgba(C.fg, 0.08 + 0.3 * ((i * 7 + j * 13) % 5 === 0)));
      break;
    case "timezone":
      label("TIMEZONE", pad, 30);
      G.text("11:42", pad, 110, { font: FONT.mono(56, 500) });
      G.text("Asia/Shanghai · GMT+8", pad, 150, { font: FONT.mono(13), color: C.muted });
      G.text("Mon, Oct 6", w - pad, 150, { font: FONT.mono(13), color: C.muted, align: "right" });
      break;
    case "charger":
      label("CHARGER", pad, 30);
      G.text("65 W", pad, 92, { font: FONT.mono(44, 500) });
      spark(pad, 110, w - pad * 2, 60, 2, rgba(C.fg, 0.6));
      G.text("C1 45 W · C2 20 W", pad, h - 18, { font: FONT.mono(12), color: C.muted });
      break;
    case "powerbank":
      label("POWER BANK", pad, 30);
      G.text("82%", pad, 92, { font: FONT.mono(44, 500) });
      G.rect(pad, 120, w - pad * 2, 8, rgba(C.fg, 0.14));
      G.rect(pad, 120, (w - pad * 2) * 0.82, 8, C.fg);
      G.text("30.1 °C · in 0 W · out 18 W", pad, h - 18, { font: FONT.mono(12), color: C.muted });
      break;
    case "recent":
      label("RECENTLY PLAYED", pad, 30);
      for (let i = 0; i < 4; i++) {
        const x = pad + i * ((w - pad * 2) / 4), y = 50;
        G.rect(x, y, 48, 48, i % 2 ? "#2b2924" : "#3a3731");
        G.rect(x + 60, y + 12, 70 - i * 8, 8, rgba(C.fg, 0.7));
        G.rect(x + 60, y + 30, 48, 7, rgba(C.fg, 0.3));
      }
      break;
    case "activity": {
      label("ACTIVITY", pad, 30);
      rings(pad + 92, h / 2 + 10, 86);
      const tx = pad + 210;
      [["MOVE", "612 / 700 kcal"], ["EXERCISE", "34 / 60 min"], ["STAND", "11 / 12 h"]].forEach(([k, v], i) => {
        label(k, tx, 72 + i * 56);
        G.text(v, tx, 96 + i * 56, { font: FONT.mono(20, 500) });
      });
      break;
    }
    case "workouts":
      label("WORKOUTS", pad, 30);
      [0.7, 0.45, 0.9, 0.3, 0.6].forEach((hh, i) => G.rect(pad + i * 60, 170 - hh * 100, 36, hh * 100, rgba(C.fg, 0.25 + 0.5 * (i === 2))));
      G.text("Outdoor Run · 42 min", pad, h - 24, { font: FONT.mono(12), color: C.muted });
      break;
    case "server":
      label("SERVER · TOKYO", pad, 30);
      G.text("↑ 12.4 Mb/s", pad, 80, { font: FONT.mono(26, 500) });
      G.text("↓ 3.1 Mb/s", pad + 220, 80, { font: FONT.mono(26, 500), color: C.muted });
      spark(pad, 100, w - pad * 2, 100, 5, rgba(C.fg, 0.55));
      G.text("CPU 7% · MEM 41% · 23 d up", w - pad, 80, { font: FONT.mono(13), color: C.muted, align: "right" });
      break;
  }
}

const BOX_W = 560, BOX_H = 220;
function panel(w, h, title, sub, body = [], hot = -1) {
  surface(w, h);
  G.text(title, 28, 48, { font: FONT.mono(28, 600) });
  G.text(sub, 28, 78, { font: FONT.mono(17), color: C.muted });
  body.forEach((s, i) => G.text(s, 28, 152 + i * 26, { font: FONT.mono(16), color: i === hot ? C.fg : C.muted }));
}
function cardHead(w, h, title) {
  surface(w, h);
  G.rect(0, 0, w, h, null, rgba(C.fg, 0.12), 2);
  G.text(title, 24, 36, { font: FONT.mono(13, 500), color: C.muted, tracking: 1.4 });
}
function check(x, y, on, size = 20) {
  G.rect(x, y - size + 4, size, size, null, on ? C.fg : rgba(C.fg, 0.35), 1.5);
  if (on) G.poly([[x + 4, y - size / 2 + 4], [x + size / 2 - 1, y], [x + size - 3, y - size + 8]], C.fg, 2.2);
}
const JSON_LINES = [
  "{", '  "version": 4,', '  "presence": "online",', '  "heartbeatAt": 1759541180000,', '  "activeModules": ["appleMusic"],',
  '  "modules": {', '    "appleMusic": {', '      "music": {', '        "state": "playing",', '        "title": "アイドル",',
  '        "artist": "YOASOBI",', '        "positionMs": 0,', '        "observedAt": 1759541180412', "      }", "    }", "  }", "}",
];
const CHECKS = ["POST", "source: mac", "Access JWT · lyjwpage-mac", "body ≤ 4 MiB", "JSON", "prepare → command"];
const ROUTES = [["realtime", "CORE.commitIngest"], ["lag", "KV LAG · —"], ["archive", "D1 · —"], ["credentials", "KV CREDENTIALS · —"]];

const mesh = {};
const dyn = [];
function addSlab(name, x, y, z, wpx, hpx, paint, dynamic, depth = 0.18) {
  const p = G.painter(wpx, hpx);
  const m = S.slab(p, wpx * U, hpx * U, depth);
  m.position.set(x, y, z);
  m.userData.paint = paint; m.userData.name = name;
  p.paint(() => paint(0));
  m.userData.tex.needsUpdate = true;
  if (dynamic) dyn.push([m, dynamic]);
  mesh[name] = m;
  return m;
}
const detailY = (hpx, gap = 0.4) => 1.1 + gap + (hpx * U) / 2;
function tilt(m, rx = -0.1) { m.rotation.x = rx; }

let wire, tip, trail, ghost, ringA, ringB, stem = {};
const TIP = 1.2;
const beadZ = (bx, hz) => (bx <= CARD_X - TIP ? 0 : hz * (bx - (CARD_X - TIP)) / TIP);
const STATIONS = [MAC, HUB, ING, CORE, ROOM];
const insideK = (bx) => Math.max(0, ...STATIONS.map((x) => 1 - clamp01((Math.abs(bx - x) - 2.55) / 0.35)));
function init() {
  for (const c of CARDS) {
    const paint = c.id === "hero" ? (t) => heroPaint(t, c.pw, c.ph, t < 22 ? flipP(t, AT.flip1) : flipP(t, AT.flip2)) : () => cardPaint(c.id, c.pw, c.ph);
    addSlab(c.id, c.cx, c.cy, 0, c.pw, c.ph, paint, c.id === "hero" ? () => true : null, c.id === "header" ? 0.06 : 0.12);
  }
  addSlab("mac", MAC, 0, 0, BOX_W, BOX_H, (t) => {
    const fp = flipP(t, AT.flipMac), shown = fp < 0.5 ? 0 : 1, sd = SONG[shown];
    panel(BOX_W, BOX_H, "Apple Music", "macOS · where this change happened");
    const ctx = G.ctx; ctx.save();
    ctx.translate(0, 170); ctx.scale(1, Math.abs(Math.cos(Math.PI * fp))); ctx.translate(0, -170);
    artwork(28, 138, 64, shown);
    G.text(sd.title, 108, 164, { font: FONT.sans(21, 600) });
    G.text(sd.artist, 108, 188, { font: FONT.sans(15), color: C.muted });
    G.text(shown ? "▶ 0:00" : "▶ 2:10", BOX_W - 28, 188, { font: FONT.mono(14), color: C.muted, align: "right" });
    ctx.restore();
  }, (t) => t > AT.flipMac - 0.1 && t < AT.flipMac + 0.8);
  addSlab("hub", HUB, 0, 0, BOX_W, BOX_H, () => panel(BOX_W, BOX_H, "Mac Telemetry Hub", "menu bar app · POST /api/ingest/mac",
    ["sends only the modules that changed", "heartbeat every 90 s when nothing changes", "key: lyjwpage-mac (Cloudflare Access)"]));
  addSlab("ing", ING, 0, 0, BOX_W, BOX_H, () => panel(BOX_W, BOX_H, "ingress", "Cloudflare Worker · ingest.homepage.lyjw.llc",
    ["authenticate · validate · route by data layer", "202 waits for core reply + LAG + CREDENTIALS", "one envelope, four routes · this one uses one"]));
  addSlab("core", CORE, 0, 0, 600, BOX_H, (t) => {
    panel(600, BOX_H, "StateCore", "WorkerEntrypoint · api Worker");
    const hot = impact(t, AT.commit, 0.6);
    G.rect(28, 132, 544, 72, C.bg, hot > 0.02 ? rgba(C.signal, hot) : rgba(C.fg, 0.3), hot > 0.02 ? 2 : 1.2);
    G.text("StateHub", 46, 162, { font: FONT.mono(21, 600) });
    G.text("Durable Object · one instance · SQLite", 158, 162, { font: FONT.mono(15), color: C.muted });
    G.text("one queue, commits in arrival order", 46, 186, { font: FONT.mono(15), color: C.muted });
    for (let i = 0; i < 4; i++) G.rect(544 - 8 - i * 24, 170, 14, 14, rgba(C.fg, 0.25 + 0.2 * Math.sin(t * 3 + i)));
  }, (t) => t > AT.coreArr - 0.5 && t < AT.commit + 3);
  addSlab("room", ROOM, 0, 0, BOX_W, BOX_H, (t) => panel(BOX_W, BOX_H, "LivePushRoom", "Durable Object · WebSocket /ws · one room",
    ["every open page holds one socket", "broadcast: listening-now", "hibernates between messages"], t >= AT.roomArr ? 1 : -1), (t) => t > AT.roomArr - 0.1 && t < AT.roomArr + 0.2);

  const jsonM = addSlab("json", HUB, detailY(400), 0, 560, 400, (t) => {
    cardHead(560, 400, "ENVELOPE · ONLY THE MODULE THAT CHANGED");
    const n = Math.floor((t - AT.json) / 0.07);
    JSON_LINES.forEach((l, i) => {
      if (i > n) return;
      const hot = /appleMusic|title|artist|activeModules/.test(l);
      G.text(l, 24, 66 + i * 19.6, { font: FONT.mono(14.5), color: hot ? C.fg : C.muted });
    });
  }, (t) => t > AT.json - 0.1 && t < AT.json + 1.5, 0.08);
  tilt(jsonM);
  const chkM = addSlab("checks", ING, detailY(290), 0, 560, 290, (t) => {
    cardHead(560, 290, "CHECKS · IN CODE ORDER");
    CHECKS.forEach((s, i) => {
      const on = t >= AT.check + i * 0.3;
      check(24, 76 + i * 34, on);
      G.text(s, 60, 76 + i * 34, { font: FONT.mono(18), color: on ? C.fg : rgba(C.fg, 0.45) });
    });
  }, (t) => t > AT.check - 0.1 && t < AT.check + 2.2, 0.08);
  tilt(chkM);
  const routesM = addSlab("routes", ING - 5.4, 2.6, 0, 440, 170, () => {
    cardHead(440, 170, "ROUTES");
    ROUTES.forEach(([k, v], i) => {
      const y = 70 + i * 30, lit = i === 0;
      G.text(k, 24, y, { font: FONT.mono(17, lit ? 600 : 500), color: lit ? C.signal : rgba(C.fg, 0.4) });
      G.text(v, 170, y, { font: FONT.mono(15), color: lit ? C.fg : rgba(C.fg, 0.35) });
    });
  }, null, 0.08);
  routesM.rotation.y = 0.22;
  const enrichM = addSlab("enrich", CORE, detailY(100), 0, 560, 100, () => {
    cardHead(560, 100, "ENRICH · APPLE MUSIC CATALOG");
    G.text("artwork · link · songId · lyrics?", 24, 74, { font: FONT.mono(17), color: C.fg });
  }, null, 0.08);
  tilt(enrichM);
  const fxM = addSlab("effects", CORE - 6.0, 2.5, 0, 460, 150, () => {
    cardHead(460, 150, "EFFECTS");
    G.text("[ listening ]", 24, 76, { font: FONT.mono(20, 600), color: C.fg });
    G.text("→ broadcast listening-now ∥ reply 202", 24, 104, { font: FONT.mono(14), color: C.muted });
    G.text("waitUntil: network never blocks the queue", 24, 126, { font: FONT.mono(14), color: C.muted });
  }, null, 0.08);
  fxM.rotation.y = 0.22;

  for (const [name, x] of [["json", HUB], ["checks", ING], ["enrich", CORE]]) stem[name] = S.rod(new THREE.Vector3(x, 1.1, 0), new THREE.Vector3(x, mesh[name].position.y - mesh[name].geometry.parameters.height / 2, 0), 0.01);

  wire = S.rod(new THREE.Vector3(CARD_X, 0, 0), new THREE.Vector3(CARD_X, 0, 0));
  tip = S.rod(new THREE.Vector3(CARD_X, 0, 0), new THREE.Vector3(CARD_X, 0, 0));
  trail = S.glowRod(new THREE.Vector3(MAC, 0, 0), new THREE.Vector3(MAC, 0, 0));
  trail.visible = false;
  ghost = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), S.bead.material);
  S.scene.add(ghost);
  const ringGeo = () => new THREE.RingGeometry(0.98, 1, 128);
  const ringMat = () => new THREE.MeshBasicMaterial({ color: S.SIGNAL, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  ringA = new THREE.Mesh(ringGeo(), ringMat()); ringB = new THREE.Mesh(ringGeo(), ringMat());
  ringA.position.set(ROOM, 0, 0.2); ringB.position.set(ROOM, 0, 0.2);
  S.scene.add(ringA, ringB);
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
    lines.forEach((s, i) => {
      let px = 60;
      while (px > 44 && G.measure(s, FONT.cjk(px, 500)) > 820) px -= 2;
      G.reveal(s, 120, y0 + i * 76, t, t0 + i * 0.25, { font: FONT.cjk(px, 500), alpha: out });
    });
  }
}
function chrome(t) {
  const a = prog(t, 1.2, 2.0);
  if (a > 0) {
    G.text("01", 120, 96, { font: FONT.mono(26, 600), color: C.signal, alpha: a });
    G.text("这张卡怎么知道的", 172, 96, { font: FONT.cjk(26, 500), color: C.muted, alpha: a });
    G.text("lyjw.me · how it works · v3 draft", 1800, 1030, { font: FONT.mono(16), color: C.dim, align: "right", alpha: a });
  }
  const mp = win(t, AT.pageArr - 0.2, AT.pageArr + 0.3, 50.0, 50.8);
  if (mp > 0) {
    const [sx, sy] = S.project(CARD_X, HERO.cy + HERO.h / 2, 1.0);
    G.text('mutate("/api/status/listening/now")', sx, sy - 22, { font: FONT.mono(20), color: C.signal, alpha: mp });
  }
  if (t >= AT.title) {
    G.reveal("拆开来看", 960 - 192, 250, t, AT.title, { font: FONT.cjk(96, 700), per: 0.08, dur: 0.5, rise: 16 });
    G.text("lyjw.me 运行原理 · 一张卡，一条线，一路走回源头", 960, 296, { font: FONT.cjk(24, 500), color: C.muted, align: "center", alpha: prog(t, AT.title + 0.5, AT.title + 1.1) });
  }
}

function update(t) {
  const explode = prog(t, AT.explode[0], AT.explode[1], E.io);
  for (const c of CARDS) {
    const m = mesh[c.id];
    if (c.id === "hero") {
      m.position.set(c.cx, c.cy, 1.0 * explode);
      const fp = t < 22 ? flipP(t, AT.flip1) : flipP(t, AT.flip2);
      m.rotation.x = fp < 0.5 ? fp * Math.PI : (fp - 1) * Math.PI;
      S.glow(m, impact(t, AT.flip2, 0.8) * 0.8 + impact(t, AT.pageArr, 0.6));
      continue;
    }
    const dx = c.cx - HX, dy = c.cy - HERO.cy, d = Math.hypot(dx, dy);
    m.position.set(c.cx + dx * 0.08 * explode, c.cy + dy * 0.08 * explode, -(0.5 + 0.14 * d) * explode);
    S.dim(m, explode);
  }
  const left = keys(t, WIRE_LEFT)[0];
  wire.visible = tip.visible = t >= 11.5;
  const heroZ = 1.0 * explode;
  if (wire.visible) {
    S.setRod(wire, new THREE.Vector3(left, 0, 0), new THREE.Vector3(CARD_X - TIP, 0, 0), 0.022);
    S.setRod(tip, new THREE.Vector3(CARD_X - TIP, 0, 0), new THREE.Vector3(CARD_X, 0, heroZ), 0.022);
  }
  for (const [name, x] of [["mac", MAC], ["hub", HUB], ["ing", ING], ["core", CORE], ["room", ROOM]]) {
    const p = prog(t, AT.pop[x], AT.pop[x] + 0.5, E.outBack);
    const m = mesh[name];
    m.visible = p > 0;
    m.scale.setScalar(Math.max(0.001, p));
    m.position.y = (1 - p) * -0.6;
  }
  const show = (name, t0, t1, from = 0, rx = -0.1) => {
    const m = mesh[name], p = win(t, t0, t0 + 0.4, t1, t1 + 0.5, E.out);
    m.visible = p > 0.001;
    m.scale.setScalar(Math.max(0.001, p));
    if (from) m.position.z = from * (1 - p);
    if (stem[name]) stem[name].visible = m.visible;
    m.rotation.x = rx;
  };
  show("json", AT.json, 34.6);
  show("checks", AT.ingArr, 40.0);
  show("routes", AT.split, 40.0, -0.8, 0);
  show("enrich", AT.enrich[0], AT.enrich[1] + 1.2);
  show("effects", AT.commit, 46.0, -0.8, 0);

  const bx = beadX(t), beadOn = t >= AT.bead && t < AT.pageArr + 0.4;
  const alpha = prog(t, AT.bead - 0.2, AT.bead + 0.2) * (1 - prog(t, AT.pageArr, AT.pageArr + 0.4)) * (1 - insideK(bx));
  S.setBead(bx, 0, beadZ(bx, heroZ), t >= AT.bead - 0.2 ? alpha : 0);
  trail.visible = beadOn;
  if (beadOn) {
    const stops = [MAC, HUB, ING, CORE, ROOM, CARD_X];
    let from = MAC; for (const s of stops) if (s <= bx) from = s;
    const next = STATIONS.find((x) => x > from && Math.abs(bx - x) < 2.9);
    const to = next == null ? bx : Math.min(bx, next - 2.85);
    trail.visible = to > from + 0.05;
    S.setRod(trail, new THREE.Vector3(from, 0, 0), new THREE.Vector3(to, 0, beadZ(to, heroZ)), 0.03);
  }
  for (const [name, x, arr] of [["hub", HUB, AT.hubArr], ["ing", ING, AT.ingArr], ["core", CORE, AT.coreArr], ["room", ROOM, AT.roomArr]]) {
    const inside = beadOn ? 0.7 * (1 - clamp01((Math.abs(bx - x) - 2.55) / 0.35)) : 0;
    S.glow(mesh[name], Math.max(inside, impact(t, arr, 0.5)));
  }
  S.glow(mesh.mac, impact(t, AT.flipMac, 0.6) * 0.8);
  const gp = t >= AT.fork && t < 44.4 ? prog(t, AT.fork, AT.fork + 1.5, E.io) : -1;
  ghost.visible = gp >= 0;
  if (ghost.visible) { ghost.position.set(lerp(CORE - 3.2, ING + 2.8, gp), -0.35, 0.3); ghost.scale.setScalar(1 - prog(t, 43.6, 44.4)); }
  const r1 = prog(t, AT.roomArr, AT.roomArr + 1.4, E.out), r2 = prog(t, AT.roomArr + 0.25, AT.roomArr + 1.65, E.out);
  ringA.visible = r1 > 0 && r1 < 1; ringA.scale.setScalar(0.6 + 9 * r1); ringA.material.opacity = (1 - r1) * 0.9;
  ringB.visible = r2 > 0 && r2 < 1; ringB.scale.setScalar(0.6 + 9 * r2); ringB.material.opacity = (1 - r2) * 0.5;

  for (const [m, when] of dyn) if (when(t)) S.repaint(m, () => m.userData.paint(t));
}

window.CHAPTERS.push({
  id: "ch01", title: "01 这张卡怎么知道的", bars: 26,
  init,
  render(f) {
    const t = f.t;
    S.look(...cam(t));
    update(t);
    S.render(t);
    G.begin();
    chrome(t);
    narration(t);
    G.fade(1 - prog(t, AT.fadeIn[0], AT.fadeIn[1], E.out));
    G.fade(prog(t, AT.fadeOut[0], AT.fadeOut[1], E.in));
  },
});
