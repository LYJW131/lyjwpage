(() => {
  const BPM = 96, BAR = (60 / BPM) * 4;
  const params = new URLSearchParams(location.search);
  const EXPORT = params.has("export");
  if (EXPORT) document.body.classList.add("export");

  const chapters = window.CHAPTERS.slice();
  let bar0 = 0;
  for (const c of chapters) { c.t0 = bar0 * BAR; c.t1 = (bar0 + c.bars) * BAR; bar0 += c.bars; }
  const DURATION = bar0 * BAR;

  const wrap = document.getElementById("wrap");
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cw, ch;
    if (EXPORT) { cw = window.innerWidth; ch = window.innerHeight; }
    else {
      const r = wrap.getBoundingClientRect();
      cw = r.width; ch = (cw * 9) / 16;
      if (ch > r.height) { ch = r.height; cw = (ch * 16) / 9; }
    }
    G.canvas.style.width = `${Math.round(cw)}px`;
    G.canvas.style.height = `${Math.round(ch)}px`;
    G.resize(Math.round(cw * dpr), Math.round(ch * dpr));
    dirty = true;
  }

  function render(t) {
    const ch = chapters.find((c) => t >= c.t0 && t < c.t1) || chapters[chapters.length - 1];
    const lt = t - ch.t0;
    ch.render({ t: lt, bar: lt / BAR, BAR, abs: t });
  }

  let T = 0, playing = false, p0 = 0, dirty = true;
  const now = () => (playing ? (performance.now() - p0) / 1000 : T);
  function play() { if (playing) return; if (T >= DURATION - 0.05) T = 0; p0 = performance.now() - T * 1000; playing = true; ui(); }
  function pause() { if (!playing) return; T = now(); playing = false; ui(); }
  function seek(t) { const was = playing; if (was) pause(); T = Math.max(0, Math.min(DURATION - 1e-3, t)); dirty = true; if (was) play(); ui(); }

  const $ = (id) => document.getElementById(id);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const scrub = $("scrub"), fill = scrub.querySelector(".fill");
  for (const c of chapters) {
    const m = document.createElement("div"); m.className = "mark"; m.style.left = `${(c.t0 / DURATION) * 100}%`; scrub.appendChild(m);
    const l = document.createElement("div"); l.className = "lab"; l.style.left = `${(c.t0 / DURATION) * 100}%`; l.textContent = c.title; scrub.appendChild(l);
  }
  function ui() { $("play").textContent = playing ? "暂停" : "播放"; }
  $("play").onclick = () => (playing ? pause() : play());
  let dragging = false;
  const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * DURATION); };
  scrub.addEventListener("pointerdown", (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
  scrub.addEventListener("pointermove", (e) => dragging && scrubTo(e));
  scrub.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "ArrowRight") seek(now() + (e.shiftKey ? 5 : 1));
    else if (e.key === "ArrowLeft") seek(now() - (e.shiftKey ? 5 : 1));
    else if (e.key === ".") seek(now() + 1 / 60);
    else if (e.key === ",") seek(now() - 1 / 60);
  });
  window.addEventListener("resize", fit);

  let last = -1;
  function loop() {
    const t = now();
    if (playing && t >= DURATION) { pause(); T = DURATION - 1e-3; }
    if (dirty || t !== last) {
      render(Math.min(t, DURATION - 1e-3));
      last = t; dirty = false;
      fill.style.width = `${(t / DURATION) * 100}%`;
      $("time").textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    }
    requestAnimationFrame(loop);
  }

  const FONTS = ['500 20px Geist', '600 20px Geist', '700 20px Geist', '400 20px "Geist Mono"', '500 20px "Geist Mono"', '600 20px "Geist Mono"', '700 20px "Geist Mono"', '500 20px "Noto Sans SC"', '700 20px "Noto Sans SC"'];
  window.__ready = (async () => {
    await Promise.all(FONTS.map((f) => document.fonts.load(f, "中文Ag").catch(() => {})));
    await document.fonts.ready;
    fit();
    if (params.has("t")) T = Math.max(0, Math.min(DURATION - 1e-3, +params.get("t")));
    ui();
    if (!EXPORT) requestAnimationFrame(loop);
    else render(T);
    return true;
  })();
  window.__seek = (t) => { T = t; render(t); return true; };
  window.__duration = DURATION;
})();
