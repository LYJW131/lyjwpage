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


  // 声音按段排在同一条 AudioContext 时间轴上：整条配乐是一段，边放边合（stream.js）时合好一段接一段，段界按整帧对齐、无缝接上
  const SR = (Sc && Sc.sampleRate) || 48000, TOTAL = Sc && Sc.duration ? Math.ceil((Sc.duration + Sc.tail) * SR) : 0;
  let ac = null, playing = false, ctxT0 = 0, clockFallback = null, ext = null;
  const segs = [], live = new Set();
  const outLat = () => (ac ? (ac.outputLatency || 0) + (ac.baseLatency || 0) : 0);
  const isPlaying = () => (ext ? ext.playing() : playing);
  function startSeg(s) {
    if (!playing || !ac) return;
    const begin = ctxT0 + s.from / SR, lead = ac.currentTime + 0.03;
    if (begin + s.buf.duration <= lead) return;
    const src = ac.createBufferSource();
    src.buffer = s.buf;
    if (begin >= lead) {
      src.connect(ac.destination);
      src.start(begin);
    } else {
      // 从一段中间接进来（开播、拖动、这一段合得晚了）：淡入 10 ms，免得咔哒一声
      const g = ac.createGain();
      g.gain.setValueAtTime(0, lead);
      g.gain.linearRampToValueAtTime(1, lead + 0.01);
      src.connect(g);
      g.connect(ac.destination);
      src.start(lead, lead - begin);
    }
    live.add(src);
    src.onended = () => live.delete(src);
  }
  function addAudio(from, buf) {
    const s = { from, buf };
    segs.push(s);
    startSeg(s);
  }
  function play() {
    if (ext) { ext.play(); ui(); return; }
    if (playing) return;
    if (T >= DURATION - 0.05) T = 0;
    playing = true;
    // 声音还没好也先在点击里把 AudioContext 建起来：Safari 只在用户手势里放行，之后合好的段才出得了声
    try { ac = ac || new AudioContext({ sampleRate: SR }); ac.resume(); } catch { ac = null; }
    if (ac) {
      T = Math.round(T * SR) / SR;
      ctxT0 = ac.currentTime - T;
      for (const s of segs) startSeg(s);
    } else {
      const p0 = performance.now() - T * 1000;
      clockFallback = () => (performance.now() - p0) / 1000;
    }
    ui();
  }
  function pause() {
    if (ext) { ext.pause(); ui(); return; }
    if (!playing) return;
    T = now();
    playing = false;
    for (const s of live) { try { s.stop(); } catch {} }
    live.clear();
    clockFallback = null;
    ui();
  }
  function now() {
    if (ext) return ext.now();
    return playing ? (ac ? ac.currentTime - ctxT0 - outLat() : clockFallback()) : T;
  }
  function seek(t) {
    t = Math.max(0, Math.min(DURATION - 1e-3, t));
    if (ext) { ext.seek(t); ui(); return; }
    const was = playing;
    if (was) pause();
    T = t;
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
  let shownPlaying = false;
  function ui() {
    shownPlaying = isPlaying();
    $("play").textContent = shownPlaying ? I18N.tr("ui.pause") : I18N.tr("ui.play");
    $("lang").textContent = I18N.tr("ui.lang");
  }
  function setLang(l) {
    I18N.set(l);
    dirty = true;
    ui();
    fitLabels();
    if (ext) ext.lang(I18N.lang);
  }

  // 第一次播放先问怎么看（watch.js）；停帧深链（?t=）、只排几章的预览（?only=）和导出照旧，不弹窗
  const asking = !EXPORT && !params.has("t") && !only && !!window.Watch;
  let chosen = !asking;
  function toggle() {
    if (!chosen) { window.Watch.open({ params, start }); return; }
    isPlaying() ? pause() : play();
  }
  // 弹窗在「开始」的点击里同步调它：浏览器只在用户手势里放行出声
  // 视频取不到时 watch.js 会再调一次，带上视频放到的时刻 t，改回实时渲染
  function start(choice) {
    chosen = true;
    if (ext) ext.pause();
    ext = null;
    if (choice.lang !== I18N.lang) setLang(choice.lang);
    if (Number.isFinite(choice.t)) T = Math.max(0, Math.min(DURATION - 1e-3, choice.t));
    ext = choice.video || null;
    if (ext) {
      ext.seek(T);
      // 视频中途取不到会改回实时渲染，那时已不在用户手势里：AudioContext 先在这次点击里建好再挂起
      try { ac = ac || new AudioContext({ sampleRate: SR }); ac.suspend(); } catch { ac = null; }
    } else loadAudio(choice.audio);
    dirty = true;
    play();
  }
  $("play").onclick = toggle;
  $("lang").onclick = () => setLang(I18N.lang === "zh" ? "en" : "zh");
  wrap.addEventListener("click", toggle);
  let dragging = false;
  const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * DURATION); };
  scrub.addEventListener("pointerdown", (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
  scrub.addEventListener("pointermove", (e) => dragging && scrubTo(e));
  scrub.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
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
    if (!ext && playing && t >= DURATION) { pause(); T = DURATION - 1e-3; }
    if (isPlaying() !== shownPlaying) ui();
    if (dirty || t !== lastDrawn) {
      // 放预渲染视频时画布不再画，片尾余音那两秒的时间显示停在片长
      if (!ext) render(Math.min(t, DURATION - 1e-3));
      lastDrawn = t; dirty = false;
      const shown = Math.min(t, DURATION);
      fill.style.width = `${(shown / DURATION) * 100}%`;
      $("time").textContent = `${fmt(shown)} / ${fmt(DURATION)}`;
    }
    requestAnimationFrame(loop);
  }

  // 音效是现成的录音（sfx/<名字>.mp3），按 Score.sfx 的时刻叠在配乐上；配乐峰值归一到 -1 dBFS，叠完超过就压回去。
  const CUES = (Sc && Sc.sfx) || [];
  let sfxBank = null;
  function loadSfx() {
    sfxBank = sfxBank || (async () => {
      const A = window.__assets || {}, ctx = new OfflineAudioContext(2, 1, SR), dec = {};
      await Promise.all([...new Set(CUES.map((c) => c.name))].map(async (n) => {
        try { dec[n] = await ctx.decodeAudioData(await (await fetch(A[`sfx/${n}.mp3`] || `sfx/${n}.mp3`)).arrayBuffer()); } catch (e) { console.error(`音效 ${n} 载入失败`, e); }
      }));
      return dec;
    })();
    return sfxBank;
  }
  // L、R 是整片（共 total 帧）第 from 帧起的一段。只在叠出 -2 dBFS 的那几下压峰（5 ms 线性压下、80 ms 回升），不按最高峰把整条混音缩小；-2 是给插值后的真峰留 1 dB。
  // 某一帧压多少只看它前 80 ms、后 5 ms：按段做时前后各多给 SFX_MARGIN 秒，段里的部分就和整片一次做的一样
  const SFX_MARGIN = [0.1, 0.01];
  function sfxRange(dec, L, R, from, total) {
    for (const c of CUES) {
      const smp = dec[c.name];
      if (!smp) continue;
      const a = smp.getChannelData(0), b = smp.numberOfChannels > 1 ? smp.getChannelData(1) : a, rate = c.rate || 1;
      const th = ((c.pan || 0) + 1) * Math.PI / 4, gl = c.v * Math.cos(th) * Math.SQRT2, gr = c.v * Math.sin(th) * Math.SQRT2;
      const i0 = Math.round((c.t - (c.lead || 0)) * SR), n = Math.min(Math.floor((a.length - 1) / rate), total - i0, from + L.length - i0);
      for (let i = Math.max(0, -i0, from - i0); i < n; i++) {
        const p = i * rate, k = p | 0, f = p - k, j = i0 + i - from;
        L[j] += gl * (a[k] + (a[k + 1] - a[k]) * f);
        R[j] += gr * (b[k] + (b[k + 1] - b[k]) * f);
      }
    }
    const ceil = Math.pow(10, -2 / 20), g = new Float32Array(L.length).fill(1);
    for (let i = 0; i < g.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > ceil) g[i] = ceil / v; }
    for (let i = 1; i < g.length; i++) g[i] = Math.min(g[i], g[i - 1] + 1 / (0.08 * SR));
    for (let i = g.length - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + 1 / (0.005 * SR));
    for (let i = 0; i < g.length; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  }
  async function withSfx(buf) {
    if (!buf || !CUES.length) return buf;
    sfxRange(await loadSfx(), buf.getChannelData(0), buf.getChannelData(1), 0, buf.length);
    return buf;
  }

  // kind："score" 先取预渲染的整条配乐（取不到或长度对不上就现合成），"synth" 直接现合成；ready 在第一段能放时兑现，done 在整条都有了时兑现
  let job = null, complete = false, mixed = null;
  function loadAudio(kind) {
    if (job) return job;
    const load = $("load");
    load.style.display = "";
    let first;
    const ready = new Promise((resolve) => (first = resolve));
    const done = (async () => {
      const url = (window.__assets || {})["score.mp3"] || "score.mp3";
      let header = null;
      if (kind === "score") {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const bytes = await r.arrayBuffer();
            header = new Uint8Array(bytes.slice(0, 4096));
            const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes);
            if (!Sc || Math.abs(buf.duration - (Sc.duration + Sc.tail)) < 0.5) {
              addAudio(0, await withSfx(buf));
              window.__audioSource = "score";
              return;
            }
            console.warn("score.mp3 的长度和现在的章节表对不上，改成现合成");
          }
        } catch {}
      }
      if (!Sc || !Sc.render) return;
      window.__audioSource = "synth";
      try {
        if (window.Stream) await window.Stream.play({ url, header, total: TOTAL, sr: SR, now, add: addAudio, first, sfx: { load: loadSfx, mix: sfxRange, margin: SFX_MARGIN } });
        else addAudio(0, await withSfx(await Sc.render()));
      } catch (e) { console.error("配乐合成失败", e); }
    })().finally(() => { complete = true; first(); });
    ready.then(() => (load.style.display = "none"));
    job = { ready, done };
    return job;
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
      if (chosen) loadAudio("score");
      else $("load").style.display = "none";
    }
    return true;
  })();
  window.__seek = (t) => { T = t; render(t); G.gl.finish(); return true; };
  window.__duration = DURATION;
  window.__chapters = chapters.map((c) => ({ id: c.id, t0: c.t0, t1: c.t1, bars: c.bars, placeholder: !!c.placeholder }));
  window.__BAR = BAR;
  window.__loadAudio = (kind = "score") => loadAudio(kind).done;
  // 整条混音：边放边合时等全部合完才有
  window.__audio = () => {
    if (!complete || !segs.length) return null;
    if (segs.length === 1) return segs[0].buf;
    if (!mixed) {
      mixed = new AudioBuffer({ length: TOTAL, sampleRate: SR, numberOfChannels: 2 });
      for (const s of segs) for (let c = 0; c < 2; c++) mixed.copyToChannel(s.buf.getChannelData(c), c, s.from);
    }
    return mixed;
  };
})();
