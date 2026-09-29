// 时间轴与播放器：章节按 plan.js 排队，时钟跟配乐走；导出接口 window.__ready / __seek 供无头抽帧。
// 地址参数：?export 无头抽帧（不放声）· ?lang=en 英文 · ?t=秒 从这里开始 · ?only=ch02,ch03 只排这几章（预览、试听自己那章）
//          · ?check 自检模式（kit 记下每一处字的屏幕字号，tools/check.mjs 用）
(() => {
  const Sc = window.Score;
  const BPM = Sc ? Sc.BPM : 108, BEAT = 60 / BPM, BAR = BEAT * 4;
  const params = new URLSearchParams(location.search);
  const EXPORT = params.has("export");
  if (EXPORT) document.body.classList.add("export");
  if (params.has("check")) window.__CHECK = { all: [] };

  // ---------- 章节：plan.js 定顺序和小节数；没写的章用占位 ----------
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

  // 还没写的章：暗底上写章号、章名和小节:拍，拍子上闪一下，整片照样能从头放到尾
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
      // 章节内的小节:拍 → 章节内秒
      at: (bar, beat = 0) => (bar * 4 + beat) * BEAT,
      // 某类配乐事件最近一次到现在的衰减脉冲（半衰期 hl 秒）
      hit(name, hl = 0.15) { const e = lastBefore(EV[name], t); return e == null ? 0 : Math.exp(-((t - e) / hl) * Math.LN2); },
      env: (name) => (Sc && Sc.env ? Sc.env(name, t) : 0),
      tr: window.I18N.tr,
      post: {},
    };
  }

  // ---------- 画布尺寸 ----------
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

  // ---------- 渲染 ----------
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

  // ---------- 配乐 ----------
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

  // ---------- 播放器界面 ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const scrub = $("scrub"), fill = scrub.querySelector(".fill");
  for (const c of chapters) {
    const m = document.createElement("div"); m.className = "mark"; m.style.left = `${(c.t0 / DURATION) * 100}%`; scrub.appendChild(m);
    const l = document.createElement("div"); l.className = "lab"; l.style.left = `${(c.t0 / DURATION) * 100}%`; l.dataset.key = c.title; scrub.appendChild(l);
  }
  function ui() {
    $("play").textContent = playing ? I18N.tr("ui.pause") : I18N.tr("ui.play");
    $("lang").textContent = I18N.tr("ui.lang");
    scrub.querySelectorAll(".lab").forEach((l) => (l.textContent = I18N.tr(l.dataset.key)));
  }
  $("play").onclick = () => (playing ? pause() : play());
  $("lang").onclick = () => { I18N.set(I18N.lang === "zh" ? "en" : "zh"); dirty = true; ui(); };
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

  // ---------- 主循环 ----------
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

  // ---------- 启动 ----------
  const FONTS = ['500 20px Geist', '600 20px Geist', '700 20px Geist', '400 20px "Geist Mono"', '500 20px "Geist Mono"', '600 20px "Geist Mono"', '700 20px "Geist Mono"', '20px "Geist Pixel"'];
  window.__ready = (async () => {
    I18N.set(params.get("lang") === "en" ? "en" : "zh");
    await Promise.all(FONTS.map((f) => document.fonts.load(f, "Ag")));
    await document.fonts.load('600 20px "PingFang SC"', "中文");
    fit();
    for (const c of chapters) if (c.init) await c.init();
    if (params.has("t")) T = Math.max(0, Math.min(DURATION - 1e-3, +params.get("t")));
    ui();
    if (!EXPORT) {
      requestAnimationFrame(loop);
      // 配乐：优先读预先渲好的 score.mp3（v2/tools/score-mp3.mjs 生成，不进仓库）；长度和现在的章节表对不上、或者没有，就在浏览器里现合成
      let got = null;
      try {
        const r = await fetch("score.mp3");
        if (r.ok) {
          const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(await r.arrayBuffer());
          if (!Sc || Math.abs(buf.duration - (Sc.duration + Sc.tail)) < 0.5) got = buf;
          else console.warn("score.mp3 的长度和现在的章节表对不上，改成现合成");
        }
      } catch {}
      if (!got && Sc && Sc.render) { try { got = await Sc.render(); } catch (e) { console.error("配乐合成失败", e); } }
      document.getElementById("load").style.display = "none";
      // 配乐到之前已经按了播放（静音计时）：记下当前位置，换成有声的时钟接着放
      const wasPlaying = playing, t = now();
      if (wasPlaying) pause();
      buffer = got;
      T = t;
      if (wasPlaying) play();
    }
    return true;
  })();
  // 导出：同步画出 t 时刻的一帧
  window.__seek = (t) => { T = t; render(t); G.gl.finish(); return true; };
  window.__duration = DURATION;
  window.__chapters = chapters.map((c) => ({ id: c.id, t0: c.t0, t1: c.t1, bars: c.bars, placeholder: !!c.placeholder }));
  window.__BAR = BAR;
})();
