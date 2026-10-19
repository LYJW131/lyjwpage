(() => {
  const Sc = window.Score;
  const BPM = Sc ? Sc.BPM : 108, BEAT = 60 / BPM, BAR = BEAT * 4;
  const params = new URLSearchParams(location.search);
  const EXPORT = params.has("export");
  if (EXPORT) document.body.classList.add("export");
  if (params.has("check")) window.__CHECK = { all: [] };

  const only = params.get("only") ? params.get("only").split(",") : null;
  const PLAN = (window.PLAN || []).filter((p) => !only || only.includes(p.id));
  const registered = new Map();
  for (const c of window.CHAPTERS || []) {
    if (registered.has(c.id)) console.error(`章节 ${c.id} 登记了两次，用后一次`);
    registered.set(c.id, c);
  }
  for (const id of registered.keys()) if (!(window.PLAN || []).some((p) => p.id === id)) console.error(`章节 ${id} 不在 plan.js 里，不会播放`);
  const chapters = PLAN.map((p) => {
    const c = registered.get(p.id);
    if (!c) return placeholder(p);
    if (c.bars !== p.bars) console.error(`章节 ${p.id}：自己写的 bars=${c.bars}，plan.js 是 ${p.bars}，以 plan.js 为准`);
    return Object.assign(c, { bars: p.bars });
  });
  let bar0 = 0;
  for (const c of chapters) { c.bar0 = bar0; c.t0 = bar0 * BAR; c.t1 = (bar0 + c.bars) * BAR; bar0 += c.bars; }
  const totalBars = bar0, DURATION = totalBars * BAR;
  if (Sc && Sc.build) Sc.build(PLAN);

  function placeholder(p) {
    const nn = p.id.slice(2);
    let plate, x;
    return {
      id: p.id, title: `ch.${nn}`, bars: p.bars, placeholder: true,
      init() { plate = G.pass(K.PLATE.ink); x = G.layer("top"); },
      render(f) {
        const cam = { x: G.W / 2, y: G.H / 2, zoom: 1, rot: 0 };
        G.setCam(cam);
        G.fill(plate, { uGridA: 1, uPlate: [0, 0, G.W, G.H] });
        const c = x.begin(); x.cam(cam);
        const beat = Math.floor(f.beat % 4);
        K.text(c, nn, 120, 330, { font: K.FONT.pixel(180), color: G.css("signalD") });
        K.text(c, f.tr(`ch.${nn}`), 120, 450, { font: K.FONT.cjk(64, 600), color: G.css("bone") });
        K.text(c, f.tr("ph.todo"), 120, 530, { font: K.FONT.cjk(40, 600), color: G.css("ash") });
        K.text(c, `${Math.floor(f.bar)} : ${beat}  /  ${p.bars}`, 120, 880, { font: K.FONT.mono(56, 600), color: G.css("bone") });
        for (let i = 0; i < 4; i++) K.fillRect(c, 120 + i * 64, 930, 44, 44, i === beat ? G.css("signalD") : G.css("ash"), i === beat ? 1 : 0.3);
        G.composite(x.upload(), { mode: G.MODE.normal });
        f.post = { bloom: 0.3, halation: 0.1, grain: 0.04, vignette: 0.4, ca: 0.2 };
      },
    };
  }

  const EV = (Sc && Sc.events) || {};
  function lastBefore(arr, t) {
    let lo = 0, hi = (arr || []).length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t + 1e-9) { r = m; lo = m + 1; } else hi = m - 1; }
    return r < 0 ? null : arr[r];
  }

  function frameFor(t) {
    const ch = chapters.find((c) => t >= c.t0 && t < c.t1) || chapters[chapters.length - 1];
    const lt = t - ch.t0;
    return {
      t, lt, ch,
      bar: lt / BAR, beat: lt / BEAT, BAR, BEAT,
      frame: Math.floor(t * 60 + 1e-6),
      at: (bar, beat = 0) => (bar * 4 + beat) * BEAT,
      hit(name, hl = 0.15) { const e = lastBefore(EV[name], t); return e == null ? 0 : Math.exp(-((t - e) / hl) * Math.LN2); },
      env: (name) => (Sc && Sc.env ? Sc.env(name, t) : 0),
      tr: window.I18N.tr,
      post: {},
    };
  }

  const wrap = document.getElementById("wrap");
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cw, ch;
    if (EXPORT) { cw = window.innerWidth; ch = window.innerHeight; }
    else {
      const r = wrap.getBoundingClientRect();
      cw = r.width; ch = cw * 9 / 16;
      if (ch > r.height) { ch = r.height; cw = ch * 16 / 9; }
    }
    G.canvas.style.width = `${Math.round(cw)}px`;
    G.canvas.style.height = `${Math.round(ch)}px`;
    G.resize(Math.round(cw * dpr), Math.round(ch * dpr));
    dirty = true;
  }

  let T = 0, dirty = true;
  function render(t) {
    G.t = t;
    G.frame = Math.floor(t * 60 + 1e-6);
    G.setCam({ x: G.W / 2, y: G.H / 2, zoom: 1, rot: 0 });
    const f = frameFor(t);
    if (window.__CHECK) window.__CHECK.ch = f.ch.id;
    f.ch.render(f);
    G.post(f.post);
  }

  let ac = null, buffer = null, src = null, playing = false, ctxT0 = 0;
  const outLat = () => (ac ? (ac.outputLatency || 0) + (ac.baseLatency || 0) : 0);
  function clock() { return playing && ac ? ac.currentTime - ctxT0 - outLat() : T; }
  function play() {
    if (playing) return;
    if (T >= DURATION - 0.05) T = 0;
    playing = true;
    if (buffer) {
      ac = ac || new AudioContext({ sampleRate: buffer.sampleRate });
      ac.resume();
      src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      src.start(0, T);
      ctxT0 = ac.currentTime - T;
    } else {
      ac = null;
      const p0 = performance.now() - T * 1000;
      clockFallback = () => (performance.now() - p0) / 1000;
    }
    ui();
  }
  let clockFallback = null;
  function pause() {
    if (!playing) return;
    T = now();
    playing = false;
    if (src) { try { src.stop(); } catch {} src = null; }
    clockFallback = null;
    ui();
  }
  function now() { return playing ? (buffer ? clock() : clockFallback()) : T; }
  function seek(t) {
    const was = playing;
    if (was) pause();
    T = Math.max(0, Math.min(DURATION - 1e-3, t));
    dirty = true;
    if (was) play();
    ui();
  }

  const $ = (id) => document.getElementById(id);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const scrub = $("scrub"), fill = scrub.querySelector(".fill");
  for (const c of chapters) {
    const m = document.createElement("div"); m.className = "mark"; m.style.left = `${(c.t0 / DURATION) * 100}%`; scrub.appendChild(m);
    const z = document.createElement("div"); z.className = "zone"; z.style.left = `${(c.t0 / DURATION) * 100}%`; z.style.width = `${((c.t1 - c.t0) / DURATION) * 100}%`; z.dataset.key = c.title; scrub.appendChild(z);
    const l = document.createElement("div"); l.className = "lab"; z.appendChild(l);
  }
  function fitLabels() {
    scrub.querySelectorAll(".zone").forEach((z) => {
      const l = z.firstChild, name = I18N.tr(z.dataset.key);
      // 8 = 标签自身右移的 4 px（index.html 的 #scrub .lab）+ 给下一章刻度留的 4 px。
      const room = z.getBoundingClientRect().width - 8;
      z.title = name;
      l.textContent = name;
      if (l.scrollWidth > room) l.textContent = name.split(" ")[0];
      l.style.visibility = l.scrollWidth > room ? "hidden" : "";
    });
  }
  function ui() {
    $("play").textContent = playing ? I18N.tr("ui.pause") : I18N.tr("ui.play");
    $("lang").textContent = I18N.tr("ui.lang");
  }
  $("play").onclick = () => (playing ? pause() : play());
  $("lang").onclick = () => { I18N.set(I18N.lang === "zh" ? "en" : "zh"); dirty = true; ui(); fitLabels(); };
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
    else if (e.key === "]") { const c = chapters.find((c) => c.t0 > now() + 0.01); if (c) seek(c.t0); }
    else if (e.key === "[") { const t = now(); const c = [...chapters].reverse().find((c) => c.t0 < t - 0.3); seek(c ? c.t0 : 0); }
  });
  window.addEventListener("resize", fit);
  window.addEventListener("resize", fitLabels);

  let lastDrawn = -1;
  function loop() {
    const t = now();
    if (playing && t >= DURATION) { pause(); T = DURATION - 1e-3; }
    if (dirty || t !== lastDrawn) {
      render(Math.min(t, DURATION - 1e-3));
      lastDrawn = t; dirty = false;
      fill.style.width = `${(t / DURATION) * 100}%`;
      $("time").textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    }
    requestAnimationFrame(loop);
  }

  // 音效是现成的录音（sfx/<名字>.mp3），按 Score.sfx 的时刻叠在配乐上；配乐峰值归一到 -1 dBFS，叠完超过就整体压回去。
  async function withSfx(buf) {
    const cues = (Sc && Sc.sfx) || [];
    if (!buf || !cues.length) return buf;
    const A = window.__assets || {}, sr = buf.sampleRate, ctx = new OfflineAudioContext(2, 1, sr), dec = {};
    await Promise.all([...new Set(cues.map((c) => c.name))].map(async (n) => {
      try { dec[n] = await ctx.decodeAudioData(await (await fetch(A[`sfx/${n}.mp3`] || `sfx/${n}.mp3`)).arrayBuffer()); } catch (e) { console.error(`音效 ${n} 载入失败`, e); }
    }));
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (const c of cues) {
      const smp = dec[c.name];
      if (!smp) continue;
      const a = smp.getChannelData(0), b = smp.numberOfChannels > 1 ? smp.getChannelData(1) : a, rate = c.rate || 1;
      const th = ((c.pan || 0) + 1) * Math.PI / 4, gl = c.v * Math.cos(th) * Math.SQRT2, gr = c.v * Math.sin(th) * Math.SQRT2;
      const i0 = Math.round(c.t * sr), n = Math.min(Math.floor((a.length - 1) / rate), L.length - i0);
      for (let i = 0; i < n; i++) {
        const p = i * rate, k = p | 0, f = p - k;
        L[i0 + i] += gl * (a[k] + (a[k + 1] - a[k]) * f);
        R[i0 + i] += gr * (b[k] + (b[k + 1] - b[k]) * f);
      }
    }
    let pk = 0;
    for (const d of [L, R]) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
    const ceil = Math.pow(10, -1 / 20);
    if (pk > ceil) for (const d of [L, R]) for (let i = 0; i < d.length; i++) d[i] *= ceil / pk;
    return buf;
  }

  const FONTS = ['500 20px Geist', '600 20px Geist', '700 20px Geist', '400 20px "Geist Mono"', '500 20px "Geist Mono"', '600 20px "Geist Mono"', '700 20px "Geist Mono"', '20px "Geist Pixel"'];
  window.__ready = (async () => {
    I18N.set(params.get("lang") === "en" ? "en" : "zh");
    await Promise.all(FONTS.map((f) => document.fonts.load(f, "Ag")));
    await document.fonts.load('600 20px "PingFang SC"', "中文");
    fit();
    for (const c of chapters) if (c.init) await c.init();
    if (params.has("t")) T = Math.max(0, Math.min(DURATION - 1e-3, +params.get("t")));
    ui();
    fitLabels();
    if (!EXPORT) {
      requestAnimationFrame(loop);
      let got = null;
      try {
        const r = await fetch((window.__assets || {})["score.mp3"] || "score.mp3");
        if (r.ok) {
          const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(await r.arrayBuffer());
          if (!Sc || Math.abs(buf.duration - (Sc.duration + Sc.tail)) < 0.5) got = buf;
          else console.warn("score.mp3 的长度和现在的章节表对不上，改成现合成");
        }
      } catch {}
      if (!got && Sc && Sc.render) { try { got = await Sc.render(); } catch (e) { console.error("配乐合成失败", e); } }
      got = await withSfx(got);
      document.getElementById("load").style.display = "none";
      const wasPlaying = playing, t = now();
      if (wasPlaying) pause();
      buffer = got;
      T = t;
      if (wasPlaying) play();
    }
    return true;
  })();
  window.__seek = (t) => { T = t; render(t); G.gl.finish(); return true; };
  window.__duration = DURATION;
  window.__chapters = chapters.map((c) => ({ id: c.id, t0: c.t0, t1: c.t1, bars: c.bars, placeholder: !!c.placeholder }));
  window.__BAR = BAR;
  window.__audio = () => buffer;
})();
