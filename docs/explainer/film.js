// 启动：核对章节与配乐、等字体后量排版、对外暴露导出接口、页面内播放。
(() => {
  const EXPORT = /[?&]export\b/.test(location.search);
  if (EXPORT) document.body.classList.add("export");
  const stage = Engine.stage;
  const errs = [];
  const plan = Music.PLAN;
  if (Engine.CHAPTERS.length !== plan.length) errs.push(`章节数 ${Engine.CHAPTERS.length} ≠ 配乐 ${plan.length}`);
  Engine.CHAPTERS.forEach((c, i) => {
    if (!plan[i] || plan[i].bars !== c.bars || plan[i].name !== c.name) errs.push(`章节 ${i}「${c.name}」${c.bars} 小节，与配乐「${plan[i] && plan[i].name}」${plan[i] && plan[i].bars} 不一致`);
  });
  window.FADE_AT = Music.DURATION - 1.2;
  const ready = document.fonts.ready.then(() => {
    Engine.finalize(Music.DURATION);
    if (errs.length) console.error(errs.join("\n"));
  });
  window.__ready = ready;
  window.__duration = Music.DURATION;
  window.__seek = (t) => Engine.render(t);
  window.__warn = () => [...errs, ...Engine.WARN];
  window.__chapters = () => Engine.CHAPTERS.map((c) => ({ n: c.n, name: c.name, t0: c.t0, t1: c.t1 }));
  window.__renderWav = async (style = "chip", seconds) => Music.toWavBase64(await Music.renderBuffer(44100, style, seconds));
  // 音效 = 手写的语义音效 + 气泡/跳跃/表情/粒子（引擎自动）+ 画面事件（逐帧分析）
  let VIS = null;
  window.__analyze = () => (VIS = VIS || Engine.analyze(30));
  function allCues() {
    const vis = window.__analyze();
    const FAM = { pop: "pop", tag: "pop", tick: "pop", send: "send", arrive: "arrive", stamp: "stamp", draw: "draw", mark: "draw" };
    const manual = Engine.CUES.filter((c) => !c.auto);
    const keep = vis.filter((v) => !manual.some((m) => FAM[m.type] && FAM[m.type] === FAM[v.type] && Math.abs(m.t - v.t) < 0.12));
    return [...Engine.CUES, ...keep].sort((a, b) => a.t - b.t);
  }
  window.__cues = () => allCues().map(({ el, ...c }) => c);
  // 音效轨 + 配乐增益曲线（配乐本身已定稿，混音在 ffmpeg 里做）
  window.__renderSfx = async (palette = "chip") => ({
    sfx: Music.toWavBase64(await Music.renderSfx(allCues(), 44100, palette)),
    duck: Music.toWavBase64(Music.duckBuffer(Engine.BUBBLES.map((b) => ({ a: b.a, b: b.b })), Engine.DUCKS, 44100)),
  });

  // 导出时铺满 1920×1080；页面里播放时两侧至少留 16px
  // 手机上避开刘海和底部横条：外壳给 :root 留了安全区的上下内边距
  function fit() {
    const cs = getComputedStyle(document.documentElement);
    const pt = EXPORT ? 0 : parseFloat(cs.paddingTop) || 0, pb = EXPORT ? 0 : parseFloat(cs.paddingBottom) || 0;
    const g = EXPORT ? 0 : 16, W = Math.max(1, innerWidth - 2 * g), H = Math.max(1, innerHeight - pt - pb - 2 * g);
    const s = Math.min(W / 1920, H / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${pt + (innerHeight - pt - pb - 1080 * s) / 2}px) scale(${s})`;
  }
  fit();
  addEventListener("resize", fit);
  if (EXPORT) return;

  const audio = document.getElementById("music");
  const pp = document.getElementById("pp"), scrub = document.getElementById("scrub"), tc = document.getElementById("tc");
  const startEl = document.getElementById("start"), ui = document.getElementById("ui"), fsBtn = document.getElementById("fs");
  const segBtns = [...document.querySelectorAll("#sty button")];
  const DUR = Music.DURATION, COVER = 10.8;
  scrub.max = DUR;
  // pos：画面用的进度。换音源时新文件还没就绪，audio.currentTime 会读成 0，不能拿它当进度
  // switching：在等新音源的元数据；resume：换完要不要接着放；prev：换之前那首，新文件拿不到就退回去
  // shown：第一次出声之前停在封面（不然点完开始会先看到一张白纸）
  let started = false, style = "chip", pos = 0, switching = false, resume = false, prev = null, fellBack = false, failed = false, shown = false, pend = null;
  const play = () => audio.play().catch(() => {});
  let saved = null;
  try { saved = localStorage.getItem("lyjw-explainer-style"); } catch {}
  // 「上次」角标只给真的选过的人看
  startEl.querySelectorAll("button[data-style]").forEach((b) => b.classList.toggle("last", b.dataset.style === saved));
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  function setStyle(k, wantPlay) {
    if (!switching) { resume = wantPlay; switching = true; prev = style; } // 连点时只记第一次的状态
    style = k; failed = false;
    pp.textContent = resume ? "暂停" : "播放"; // 从「重试」换过来时，文字也跟着复位
    try { localStorage.setItem("lyjw-explainer-style", k); } catch {}
    segBtns.forEach((b) => { const on = b.dataset.style === k; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    audio.preload = "auto";
    audio.src = (window.__assets || {})[`music-${k}.mp3`] || `music-${k}.mp3`; // 站点上是按内容哈希命名的那份
    audio.load();
    if (resume) play(); // 在点击里就发出播放请求，手机浏览器才不拦
  }
  // Clawd 所在图层：引擎每帧会改 Clawd 自己的 visibility，藏它要用图层的 opacity
  const crabLayer = Engine.crabWrap.parentElement;
  function reveal() { if (!shown) { shown = true; crabLayer.style.opacity = ""; } }
  // 新音源拿到时长后跳回原来的进度（常驻一个处理器，不会一次次叠加）
  audio.addEventListener("loadedmetadata", () => {
    if (!switching) return;
    audio.currentTime = pos; pend = pos;
    switching = false; prev = null; fellBack = false;
    if (resume) play(); else reveal();
  });
  // 有的浏览器在元数据刚到时设进度不生效：能播时再核对一次
  audio.addEventListener("canplay", () => {
    if (pend != null && Math.abs(audio.currentTime - pend) > 0.25) audio.currentTime = pend;
    pend = null;
  });
  // 新配乐拿不到就退回原来那首，进度和播放状态照旧；退回去也不行就停下，播放键变成「重试」
  audio.addEventListener("error", () => {
    if (!started) return;
    if (switching && prev && prev !== style && !fellBack) { const k = prev; fellBack = true; switching = false; setStyle(k, resume); return; }
    switching = false; prev = null; fellBack = false; failed = true;
    pp.textContent = "重试";
  });
  audio.addEventListener("playing", reveal);
  audio.addEventListener("play", () => { if (!failed) pp.textContent = "暂停"; });
  audio.addEventListener("pause", () => { if (!switching && !failed) pp.textContent = "播放"; });
  // 底栏：鼠标悬停时出现；触屏点一下画面出现，3 秒后自己收起
  let hideT = 0;
  const flash = () => { ui.classList.add("show"); clearTimeout(hideT); hideT = setTimeout(() => ui.classList.remove("show"), 3000); };
  // 用 click 不用 pointerdown：按下时底栏就变成可点，紧跟着的 click 会落到刚出现的按钮上（误触暂停）
  document.getElementById("frame").addEventListener("click", () => { if (started) flash(); });
  ui.addEventListener("pointerdown", flash);
  startEl.querySelectorAll("button[data-style]").forEach((b) => b.addEventListener("click", () => {
    started = true; startEl.remove(); ui.inert = false;
    flash();
    pos = 0;
    setStyle(b.dataset.style, true);
  }));
  segBtns.forEach((b) => b.addEventListener("click", () => { if (started && b.dataset.style !== style) setStyle(b.dataset.style, !audio.paused); }));
  pp.addEventListener("click", () => {
    if (!started) return;
    if (failed) { setStyle(style, true); return; }
    // 换音源途中：setStyle 可能已经发出播放请求，暂停要真的停下，不能只改标记
    if (switching) { resume = !resume; resume ? play() : audio.pause(); pp.textContent = resume ? "暂停" : "播放"; return; }
    if (!audio.paused) { audio.pause(); return; }
    if (pos >= DUR - 0.05) { pos = 0; audio.currentTime = 0; } // 放完了再按：从头来
    play();
  });
  // 拖动也改写「待核对的进度」，否则 canplay 时会被拉回换音源那一刻的位置
  const seekTo = (t) => { pos = Math.max(0, Math.min(DUR, t)); if (!switching) { audio.currentTime = pos; if (pend != null) pend = pos; } };
  scrub.addEventListener("input", () => seekTo(+scrub.value));
  scrub.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
    if (d) { e.preventDefault(); seekTo(pos + d); }
  });
  fsBtn.addEventListener("click", () => {
    const d = document.documentElement;
    try { (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen()).catch(() => {}); } catch {}
  });
  addEventListener("keydown", (e) => { if (e.code === "Space" && started) { e.preventDefault(); if (!e.repeat) pp.click(); } });
  // 封面：开场卡挡住 Clawd 时先把它藏起来（手机上卡片在舞台下方，就照常露出）
  function cover() {
    if (shown) return;
    Engine.render(COVER);
    const pick = startEl.isConnected && startEl.querySelector(".pick");
    const c = Engine.crabWrap.firstElementChild.getBoundingClientRect(), k = pick ? pick.getBoundingClientRect() : null; // 量 Clawd 本体，外层容器是 0×0
    crabLayer.style.opacity = k && c.bottom > k.top && c.top < k.bottom && c.right > k.left && c.left < k.right ? "0" : "";
  }
  addEventListener("resize", () => { if (!started) cover(); });
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  ready.then(() => {
    cover();
    (function loop() {
      if (started) {
        // 核对完成前按目标进度画（有的浏览器这段时间 currentTime 还是 0）
        if (!switching && audio.readyState >= 1) pos = pend != null ? pend : Math.min(audio.currentTime, DUR);
        if (shown) Engine.render(pos);
        scrub.value = pos;
        tc.textContent = failed ? "加载失败" : shown ? fmt(pos) : "加载中…";
      }
      requestAnimationFrame(loop);
    })();
  });
})();
