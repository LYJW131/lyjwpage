// Reviewer-only geometry analysis (does not modify the explainer).
// node analyze.mjs <index.html> <out.json> [step=0.25] [popStep=0.05] [from=0] [to=end]
// 输出 JSON：geo（重叠/贴边/悬空连线/数据包压字等问题，按时刻）、pops（一帧内突然出现或消失、位置跳变）
import { chromium } from "playwright-core";
import fs from "node:fs";
const [html, outPath, stepArg, popArg, fromArg, toArg] = process.argv.slice(2);
const FROM = +(fromArg || 0), TO_ARG = toArg ? +toArg : null;
const STEP = +(stepArg || 0.25), POP = +(popArg || 0.05);
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
p.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(m.type() + ": " + m.text()); });
p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await p.goto("file://" + html + "?export");
await p.evaluate(() => window.__ready);

await p.evaluate(() => {
  const stage = Engine.stage;
  let RID = 0;
  const rid = (el) => (el.__rid ??= ++RID);
  const vis = (el) => { for (let e = el; e && e !== stage; e = e.parentElement) { const v = e.style && e.style.visibility; if (v === "hidden") return false; if (v === "visible") return true; } return true; };
  const op = (el) => { let o = 1; for (let e = el; e && e !== stage; e = e.parentElement) { if (e.style && e.style.opacity !== "") o *= +e.style.opacity; } return o; };
  const eff = (el) => (vis(el) ? op(el) : 0);
  const txt = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
  const desc = (el) => `${(el.getAttribute && el.getAttribute("class")) || el.tagName}「${txt(el)}」`;
  const RR = (r) => ({ l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) });
  const inter = (a, c) => { const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); return w > 0 && h > 0 ? [w, h] : null; };
  const union = (rs) => { rs = rs.filter(Boolean); return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) }; };
  const inR = (pt, r, pad = 0) => pt.x >= r.left - pad && pt.x <= r.right + pad && pt.y >= r.top - pad && pt.y <= r.bottom + pad;
  const scRoots = () => Engine.SCENES.map((s, i) => ({ s, i })).filter(({ s }) => s.root.style.visibility !== "hidden" && eff(s.root) > 0.01);
  const scr = (pth, q) => { const m = pth.getScreenCTM(); return m ? new DOMPoint(q.x, q.y).matrixTransform(m) : q; };
  const wiresOf = (root) => [...root.querySelectorAll(":scope > svg path")];
  const wireInfo = (pth) => {
    const dash = pth.getAttribute("stroke-dasharray") === "10 9";
    const so = +(pth.getAttribute("stroke-opacity") || 1);
    let frac, o;
    if (dash) { frac = 1; o = eff(pth); }
    else { const off = +(pth.getAttribute("stroke-dashoffset") || 0); frac = 1 - off; o = eff(pth); }
    return { dash, frac, o, so };
  };
  const bubbleRect = () => {
    const bub = document.getElementById("bubble");
    if (!bub || eff(bub) < 0.05) return null;
    const bo = document.getElementById("bOuter"), bs = document.getElementById("bShadow");
    const tails = [...bub.querySelectorAll(":scope > svg")].filter((s) => s.style.visibility === "visible");
    return { r: union([bo.getBoundingClientRect(), bs.getBoundingClientRect(), ...tails.map((s) => s.getBoundingClientRect())]), o: eff(bub), text: txt(document.getElementById("bMeasure")) };
  };
  const crabRect = () => {
    const paths = [...document.querySelectorAll("svg path")].filter((x) => x.getAttribute("fill") === "#D77757");
    // the stage crab is the one whose svg is 288 wide
    const main = paths.find((x) => x.ownerSVGElement && +x.ownerSVGElement.getAttribute("width") === 288);
    if (!main) return null;
    const wrap = main.ownerSVGElement.parentElement.parentElement;
    if (eff(wrap) < 0.05) return null;
    return main.getBoundingClientRect();
  };
  const hudRects = () => {
    const out = [];
    for (const cls of ["hdr-logo", "hdr-sub", "hud-chip", "prog", "ch-title"]) {
      const el = document.querySelector("." + cls);
      if (el && eff(el) > 0.05) {
        if (cls === "ch-title") { for (const c of el.children) { const r = c.getBoundingClientRect(); if (r.width) out.push({ k: cls + ":" + c.className, r }); } }
        else if (cls === "prog") { for (const c of el.querySelectorAll(".plab,.pseg")) out.push({ k: "prog", r: c.getBoundingClientRect() }); }
        else out.push({ k: cls, r: el.getBoundingClientRect() });
      }
    }
    return out;
  };
  const cardCache = new WeakMap();
  function cardMargins(card) {
    // min distance from text/inline content to the card's border box (only at scale 1)
    if (cardCache.has(card)) return cardCache.get(card);
    const cr = card.getBoundingClientRect();
    if (Math.abs(cr.width - card.offsetWidth) > 0.6) return null;
    let m = { l: 1e9, r: 1e9, t: 1e9, b: 1e9, worst: "" };
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const rng = document.createRange();
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const pe = n.parentElement;
      if (!vis(pe) || eff(pe) < 0.05) continue;
      // skip nested cards/packets (checked on their own)
      const nested = pe.closest(".card,.pkt,.tg");
      if (nested && nested !== card && card.contains(nested) && nested.classList.contains("card")) continue;
      rng.selectNodeContents(n);
      for (const r of rng.getClientRects()) {
        if (!r.width) continue;
        const d = { l: r.left - cr.left, r: cr.right - r.right, t: r.top - cr.top, b: cr.bottom - r.bottom };
        for (const k of ["l", "r", "t", "b"]) if (d[k] < m[k]) { m[k] = +d[k].toFixed(1); if (k === "r" || k === "b") m["w" + k] = n.textContent.trim().slice(0, 24); }
      }
    }
    // also tags / inline boxes
    for (const e of card.querySelectorAll(".tg,.ic,svg,.tagrow")) {
      if (!vis(e)) continue;
      const nested = e.closest(".card");
      if (nested !== card) continue;
      const r = e.getBoundingClientRect(); if (!r.width) continue;
      const d = { l: r.left - cr.left, r: cr.right - r.right, t: r.top - cr.top, b: cr.bottom - r.bottom };
      for (const k of ["l", "r", "t", "b"]) if (d[k] < m[k]) { m[k] = +d[k].toFixed(1); if (k === "r" || k === "b") m["w" + k] = (e.getAttribute("class") || e.tagName) + ":" + txt(e); }
    }
    m.desc = desc(card);
    m.rect = RR(cr);
    cardCache.set(card, m);
    return m;
  }

  window.__geo = (t) => {
    __seek(t);
    const iss = [];
    const add = (type, key, info) => iss.push({ type, key, ...info });
    const roots = scRoots();
    const tops = [];
    const wires = [];
    const pkts = [];
    const cards = [];
    for (const { s, i } of roots) {
      for (const el of s.root.children) {
        if (el.tagName.toLowerCase() === "svg") continue;
        const o = eff(el);
        if (o < 0.08) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        tops.push({ el, r, o, sc: i, d: desc(el) });
      }
      for (const pth of wiresOf(s.root)) {
        const w = wireInfo(pth);
        if (w.o * w.so < 0.05 || w.frac < 0.02) continue;
        wires.push({ pth, ...w, sc: i });
      }
      for (const pk of s.root.querySelectorAll(".pkt")) { const o = eff(pk); if (o > 0.1) pkts.push({ el: pk, r: pk.getBoundingClientRect(), o, d: desc(pk) }); }
      for (const c of s.root.querySelectorAll(".card,.s-card")) { const o = eff(c); if (o > 0.5) cards.push({ el: c, o, sc: i }); }
    }
    const bub = bubbleRect();
    const crab = crabRect();
    const hud = hudRects();

    // 1. bubble overlaps
    if (bub) {
      const br = bub.r;
      for (const tp of tops) { const x = inter(br, tp.r); if (x && x[0] * x[1] > 40) add("bubble×content", bub.text + " ⟂ " + tp.d, { a: Math.round(x[0] * x[1]), w: Math.round(x[0]), h: Math.round(x[1]) }); }
      for (const w of wires) { const L = w.pth.getTotalLength(); for (let k = 0; k <= 40; k++) { const q = scr(w.pth, w.pth.getPointAtLength((k / 40) * L * w.frac)); if (inR(q, br)) { add("bubble×wire", bub.text + " ⟂ wire#" + rid(w.pth), { x: Math.round(q.x), y: Math.round(q.y) }); break; } } }
      for (const h of hud) { const x = inter(br, h.r); if (x) add("bubble×hud", bub.text + " ⟂ " + h.k, { w: Math.round(x[0]), h: Math.round(x[1]) }); }
      if (crab) { const x = inter(br, crab); if (x) add("bubble×crab", bub.text, { w: Math.round(x[0]), h: Math.round(x[1]) }); }
      if (br.left < 40 || br.right > 1880 || br.top < 100 || br.bottom > 1000) add("bubble-edge", bub.text, { r: RR(br) });
      for (const pk of pkts) { const x = inter(br, pk.r); if (x) add("bubble×packet", bub.text + " ⟂ " + pk.d, {}); }
    }
    // 2. content vs content
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const A = tops[i], B = tops[j];
      if (A.el.classList.contains("pkt") || B.el.classList.contains("pkt")) continue;
      const x = inter(A.r, B.r);
      if (x && x[0] * x[1] > 30) add("content×content", A.d + " ⟂ " + B.d, { w: Math.round(x[0]), h: Math.round(x[1]) });
    }
    // gaps between content (cramped): pairs closer than 14px but not overlapping
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const A = tops[i], B = tops[j];
      if (A.el.classList.contains("pkt") || B.el.classList.contains("pkt")) continue;
      if (A.o < 0.9 || B.o < 0.9) continue;
      const dx = Math.max(A.r.left - B.r.right, B.r.left - A.r.right), dy = Math.max(A.r.top - B.r.bottom, B.r.top - A.r.bottom);
      if (dx > 0 && dy > 0) continue;
      const gap = Math.max(dx, dy);
      if (gap >= 0 && gap < 16) add("content-gap<16", A.d + " ⟂ " + B.d, { gap: Math.round(gap) });
    }
    // 3. edges & HUD
    for (const tp of tops) {
      const r = tp.r;
      if (tp.o < 0.5) continue;
      if (r.left < 48 || r.right > 1872 || r.top < 100 || r.bottom > 1005) add("content-edge", tp.d, { r: RR(r) });
      for (const h of hud) { const x = inter(r, h.r); if (x) add("content×hud", tp.d + " ⟂ " + h.k, { w: Math.round(x[0]), h: Math.round(x[1]) }); }
      if (crab) { const x = inter(r, crab); if (x && x[0] * x[1] > 60) add("crab×content", tp.d, { w: Math.round(x[0]), h: Math.round(x[1]) }); }
    }
    if (crab) for (const h of hud) { const x = inter(crab, h.r); if (x) add("crab×hud", h.k, {}); }
    // 4. packets over text/cards
    for (const pk of pkts) {
      for (const c of cards) { if (c.el.contains(pk.el)) continue; const r = c.el.getBoundingClientRect(); const x = inter(pk.r, r); if (x && x[0] * x[1] > 60) add("packet×card", pk.d + " ⟂ " + desc(c.el), { w: Math.round(x[0]), h: Math.round(x[1]) }); }
      for (const tp of tops) { if (tp.el === pk.el || tp.el.contains(pk.el) || tp.el.classList.contains("card") || tp.el.classList.contains("pkt")) continue; const x = inter(pk.r, tp.r); if (x && x[0] * x[1] > 60) add("packet×label", pk.d + " ⟂ " + tp.d, {}); }
    }
    // 5. card margins (text cramped / overflow)
    for (const c of cards) { const m = cardMargins(c.el); if (m && (m.l < 10 || m.r < 10 || m.t < 6 || m.b < 6)) add("card-margin", m.desc, { m: { l: m.l, r: m.r, t: m.t, b: m.b, wr: m.wr, wb: m.wb } }); }
    // 6. wires: attachment & crossing
    const obstacles = tops.filter((x) => !x.el.classList.contains("pkt"));
    for (const w of wires) {
      const L = w.pth.getTotalLength();
      const id = "wire#" + rid(w.pth) + "(sc" + w.sc + ")";
      const ends = [scr(w.pth, w.pth.getPointAtLength(0)), scr(w.pth, w.pth.getPointAtLength(L * w.frac))];
      const attached = new Set();
      ends.forEach((q, ei) => {
        if (ei === 1 && w.frac < 0.999) return;
        let best = null;
        for (const ob of obstacles) {
          const r = ob.r;
          const dxo = Math.max(r.left - q.x, 0, q.x - r.right), dyo = Math.max(r.top - q.y, 0, q.y - r.bottom);
          const outside = Math.hypot(dxo, dyo);
          const inside = Math.min(q.x - r.left, r.right - q.x, q.y - r.top, r.bottom - q.y);
          const dist = outside > 0 ? outside : -inside; // >0 gap, <=0 inside depth
          if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { dist, ob };
        }
        if (w.pth.classList.contains("pen")) {}
        else if (!best || best.dist > 3.5) add("wire-dangling", id + (ei ? " end" : " start"), { x: Math.round(q.x), y: Math.round(q.y), gap: best ? +best.dist.toFixed(1) : null, near: best ? best.ob.d : null });
        else {
          attached.add(best.ob.el);
          if (best.dist < -4 && !w.pth.classList.contains("pen")) add("wire-end-inside", id + (ei ? " end" : " start"), { depth: +(-best.dist).toFixed(1), el: best.ob.d });
          if (best.ob.o < 0.6 && w.o * w.frac > 0.6) add("wire-outlives-card", id, { el: best.ob.d, o: +best.ob.o.toFixed(2) });
        }
      });
      // crossing
      const hits = new Map();
      const N = Math.max(20, Math.round(L / 12));
      for (let k = 1; k < N; k++) {
        const q = scr(w.pth, w.pth.getPointAtLength((k / N) * L * w.frac));
        for (const ob of obstacles) {
          if (attached.has(ob.el)) continue;
          if (inR(q, ob.r, -1)) hits.set(ob.d, (hits.get(ob.d) || 0) + 1);
        }
      }
      for (const [d, n] of hits) add("wire×content", id + " ⟂ " + d, { n });
    }
    return iss;
  };

  window.__pop = (t) => {
    __seek(t);
    const m = {};
    for (const { s, i } of scRoots()) {
      for (const el of s.root.children) {
        if (el.tagName.toLowerCase() === "svg") { for (const pth of wiresOf(el.parentElement === s.root ? s.root : s.root)) { const w = wireInfo(pth); m["w" + rid(pth)] = [w.o * Math.min(1, w.frac * 3), "wire sc" + i]; } continue; }
        m["e" + rid(el)] = [eff(el), "sc" + i + " " + desc(el), el.getBoundingClientRect().left, el.getBoundingClientRect().top];
      }
    }
    const bub = document.getElementById("bubble"); m.bubble = [eff(bub), "bubble"];
    return m;
  };
});

const meta = await p.evaluate(() => ({
  chapters: window.__chapters(), dur: window.__duration, warn: window.__warn(),
  bubbles: Engine.BUBBLES.map((b) => ({ a: +b.a.toFixed(2), b: +b.b.toFixed(2), te: +b.te.toFixed(2), dwell: +(b.b - b.te).toFixed(2), w: b.w, h: b.h, n: b.n, text: b.text, place: b.place })),
  pseg: [...document.querySelectorAll(".pseg")].map((s) => ({ l: +s.style.left.replace("px", ""), w: +(+s.style.width.replace("px", "")).toFixed(1) })),
  plab: [...document.querySelectorAll(".plab")].map((s) => ({ l: s.offsetLeft, w: s.offsetWidth, text: s.textContent })),
}));

const geo = [];
const TO = TO_ARG ?? meta.dur;
for (let t = FROM; t <= TO + 1e-6; t += STEP) {
  const tt = +t.toFixed(3);
  const iss = await p.evaluate((x) => window.__geo(x), tt);
  for (const i of iss) geo.push({ t: tt, ...i });
}
// pops
const pops = [];
let prev = null;
const wipeNear = (t) => meta.chapters.some((c) => c.n > 0 && Math.abs(t - c.t0) < 0.45);
for (let t = FROM; t <= TO + 1e-6; t += POP) {
  const tt = +t.toFixed(3);
  const m = await p.evaluate((x) => window.__pop(x), tt);
  if (prev) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(m)]);
    for (const k of keys) {
      const a = prev[k] ? prev[k][0] : 0, c = m[k] ? m[k][0] : 0;
      const label = (m[k] || prev[k])[1];
      if (Math.abs(c - a) > 0.5) pops.push({ t: tt, from: +a.toFixed(2), to: +c.toFixed(2), what: label, wipe: wipeNear(tt) });
      if (prev[k] && m[k] && prev[k][2] != null && m[k][2] != null && a > 0.5 && c > 0.5 && !label.includes("pkt")) {
        const dx = m[k][2] - prev[k][2], dy = m[k][3] - prev[k][3];
        if (Math.hypot(dx, dy) > 60) pops.push({ t: tt, jump: [Math.round(dx), Math.round(dy)], what: label });
      }
    }
  }
  prev = m;
}
fs.writeFileSync(outPath, JSON.stringify({ meta, logs, geo, pops }, null, 1));
await b.close();
console.log("geo issues", geo.length, "pops", pops.length, "logs", logs.length);
