(() => {
  const params = new URLSearchParams(location.search);
  // 导出、停帧深链（?t=）和只排几章的预览（?only=）不弹窗（film.js 同样不问），也就不用查视频，载入时照旧直接取配乐
  if (params.has("export") || params.has("t") || params.has("only")) return;
  const S = {
    title: ["怎么看", "How to watch"],
    lang: ["语言", "Language"],
    video: ["画面", "Picture"],
    videoPre: ["预渲染视频", "Pre-rendered video"],
    videoPreNote: ["直接播放，顺滑省电", "Plays right away; smooth, easy on battery"],
    videoLive: ["浏览器实时渲染", "Live in your browser"],
    videoLiveNote: ["边放边画，更清晰，费显卡", "Drawn as it plays; sharper, heavier on GPU"],
    videoChecking: ["正在查有没有视频…", "Checking for a video…"],
    videoMissing: ["这一版还没出视频", "No video for this version yet"],
    videoCodec: ["这个浏览器放不了这份视频", "This browser can't play the video"],
    audio: ["声音", "Sound"],
    audioPre: ["预渲染音轨", "Pre-rendered track"],
    audioPreNote: ["直接播放", "Plays right away"],
    audioMissing: ["这一版的音轨还没传上来", "No track for this version yet"],
    audioLive: ["实时合成", "Live synthesis"],
    audioLiveNote: ["浏览器边放边合成", "Your browser composes it as it plays"],
    cancel: ["取消", "Cancel"],
    start: ["开始", "Start"],
    loading: ["载入中…", "Loading…"],
    loadTrack: ["正在取配乐…", "Fetching the soundtrack…"],
    loadSynth: ["正在合成开头…", "Composing the opening…"],
    buffering: ["缓冲中…", "Buffering…"],
    videoFailed: ["视频没取到，改成实时渲染", "Couldn't load the video; rendering live"],
  };
  const tr = (key, lang) => S[key][lang === "en" ? 1 : 0];
  // 须与 tools/video-release.mjs 的 AV1 / HEVC 参数同步：AV1 是 Main 档 10 位、级别 4.0 配 Opus，HEVC 是 Main 档、级别 4.0 配 AAC-LC
  const TYPES = {
    av1: 'video/mp4; codecs="av01.0.08M.10, opus"',
    hevc: 'video/mp4; codecs="hvc1.1.6.L120.90, mp4a.40.2"',
  };
  const LANGS = ["zh", "en"], CODECS = ["av1", "hevc"], STORE = "explainer.watch";
  const load = document.getElementById("load");
  load.textContent = tr("loading", params.get("lang"));

  async function headOk(url) {
    try {
      return (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      return false;
    }
  }
  const probe = (async () => {
    const A = window.__assets || {}, test = document.createElement("video"), sources = {};
    const listed = LANGS.every((lang) => CODECS.some((codec) => A[`video/${lang}.${codec}.mp4`]));
    const playable = CODECS.filter((codec) => A[`video/zh.${codec}.mp4`] && test.canPlayType(TYPES[codec]) !== "");
    const [score] = await Promise.all([
      headOk(A["score.mp3"] || "score.mp3"),
      ...LANGS.map(async (lang) => {
        const ok = await Promise.all(playable.map(async (codec) => ((await headOk(A[`video/${lang}.${codec}.mp4`])) ? codec : null)));
        sources[lang] = ok.filter(Boolean).map((codec) => ({ src: A[`video/${lang}.${codec}.mp4`], type: TYPES[codec] }));
      }),
    ]);
    const video = !listed ? "videoMissing" : !playable.length ? "videoCodec" : LANGS.every((lang) => sources[lang].length) ? null : "videoMissing";
    return { video, sources, score: score ? null : "audioMissing" };
  })();

  function remembered() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || {};
    } catch {
      return {};
    }
  }
  function remember(choice) {
    try {
      localStorage.setItem(STORE, JSON.stringify(choice));
    } catch {}
  }

  const css = `
#watch{background:#15130f;color:var(--fg);border:1px solid #3a3731;padding:20px 20px 16px;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;font:inherit}
#watch::backdrop{background:rgba(13,12,10,.72)}
#watch h2{margin:0 0 16px;font:600 15px Geist,"Geist Mono",sans-serif}
#watch fieldset{border:0;margin:0 0 16px;padding:0;min-width:0}
#watch fieldset[hidden]{display:none}
#watch legend{padding:0;margin:0 0 8px;color:var(--dim);font-size:11px;letter-spacing:.06em}
#watch .opts{display:grid;gap:6px}
#watch .pair{grid-template-columns:1fr 1fr}
#watch label{display:grid;grid-template-columns:14px 1fr;column-gap:10px;align-items:start;padding:9px 10px;border:1px solid #3a3731;cursor:pointer}
#watch label:hover{border-color:#5a564e}
#watch label:has(input:checked){border-color:var(--accent)}
#watch label:has(input:disabled){opacity:.45;cursor:default;border-color:#2a2824}
#watch input{appearance:none;margin:2px 0 0;width:14px;height:14px;border:1px solid #5a564e;border-radius:50%;background:none}
#watch input:checked{border-color:var(--accent);background:radial-gradient(circle,var(--accent) 0 3px,transparent 3.5px)}
#watch input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#watch .note{grid-column:2;margin-top:3px;color:var(--dim);font-size:12px;line-height:1.4}
#watch .row{display:flex;justify-content:flex-end;gap:10px}
#watch button{font:inherit;height:32px;padding:0 14px;cursor:pointer;background:none;color:var(--fg);border:1px solid #3a3731}
#watch button:hover{border-color:var(--fg)}
#watch button[type=submit]{background:var(--accent);border-color:var(--accent);color:#0d0c0a}
#watch button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#wrap video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}`;

  const option = (name, value, label, note) => `<label><input type="radio" name="${name}" value="${value}"><span class="name" data-s="${label}"></span>${note ? `<span class="note" data-s="${note}"></span>` : ""}</label>`;
  let dialog = null;
  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    dialog = document.createElement("dialog");
    dialog.id = "watch";
    dialog.setAttribute("aria-labelledby", "watch-title");
    dialog.innerHTML = `<form method="dialog">
<h2 id="watch-title" data-s="title"></h2>
<fieldset><legend data-s="lang"></legend><div class="opts pair"><label><input type="radio" name="lang" value="zh"><span class="name">中文</span></label><label><input type="radio" name="lang" value="en"><span class="name">English</span></label></div></fieldset>
<fieldset><legend data-s="video"></legend><div class="opts">${option("video", "pre", "videoPre", "videoPreNote")}${option("video", "live", "videoLive", "videoLiveNote")}</div></fieldset>
<fieldset data-audio><legend data-s="audio"></legend><div class="opts">${option("audio", "pre", "audioPre", "audioPreNote")}${option("audio", "live", "audioLive", "audioLiveNote")}</div></fieldset>
<div class="row"><button type="button" data-s="cancel"></button><button type="submit" data-s="start"></button></div>
</form>`;
    document.body.appendChild(dialog);
    // 点到窗外（backdrop 算在 dialog 自己身上）就关掉；Esc 由 <dialog> 自己关
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    dialog.querySelector("button[type=button]").addEventListener("click", () => dialog.close());
  }

  let state = null;
  const form = () => dialog.querySelector("form");
  const pick = (name) => form().elements[name].value;
  function paint() {
    const lang = pick("lang") || "zh";
    dialog.lang = lang === "en" ? "en" : "zh-CN";
    for (const el of dialog.querySelectorAll("[data-s]")) el.textContent = tr(el.dataset.s, lang);
    const pre = (name) => form().querySelector(`input[name=${name}][value=pre]`);
    const why = { video: state ? state.video : "videoChecking", audio: state ? state.score : null };
    for (const name of ["video", "audio"]) {
      pre(name).disabled = !!why[name];
      if (why[name]) pre(name).closest("label").querySelector(".note").textContent = tr(why[name], lang);
    }
    dialog.querySelector("[data-audio]").hidden = pick("video") === "pre";
  }
  // 默认中文、预渲染视频；?lang= ?video= ?audio=（pre / live）和上次的选择优先；视频还在查或用不了时先放实时，音轨用不了时用实时合成
  function defaults() {
    const last = remembered(), pickOf = (name, ok, d) => (ok.includes(params.get(name)) ? params.get(name) : ok.includes(last[name]) ? last[name] : d);
    const want = { lang: pickOf("lang", LANGS, "zh"), video: pickOf("video", ["pre", "live"], "pre"), audio: pickOf("audio", ["pre", "live"], "pre") };
    if (!state || state.video) want.video = "live";
    if (state && state.score) want.audio = "live";
    return want;
  }
  function set(values) {
    for (const [name, value] of Object.entries(values)) {
      const input = form().querySelector(`input[name=${name}][value=${value}]`);
      if (input && !input.disabled) input.checked = true;
    }
  }

  function media(lang, onfail) {
    const wrap = document.getElementById("wrap"), v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    let pending = null, cur = lang;
    const fill = (l) => {
      v.replaceChildren(...state.sources[l].map(({ src, type }, i, all) => {
        const s = document.createElement("source");
        s.src = src;
        s.type = type;
        if (i === all.length - 1) s.addEventListener("error", () => onfail(pending ?? v.currentTime));
        return s;
      }));
    };
    const busy = (on) => {
      load.textContent = tr("buffering", cur);
      load.style.display = on ? "" : "none";
    };
    v.addEventListener("loadedmetadata", () => { if (pending != null) { v.currentTime = pending; pending = null; } });
    v.addEventListener("error", () => onfail(pending ?? v.currentTime));
    v.addEventListener("waiting", () => busy(true));
    for (const e of ["playing", "pause", "seeked", "canplay"]) v.addEventListener(e, () => busy(false));
    fill(lang);
    wrap.appendChild(v);
    return {
      el: v,
      now: () => pending ?? v.currentTime,
      playing: () => !v.paused && !v.ended,
      play() {
        if (v.ended) v.currentTime = 0;
        v.play().catch(() => {});
      },
      pause() { v.pause(); },
      seek(t) {
        if (v.readyState >= 1) v.currentTime = t;
        else pending = t;
      },
      // 换语言就换另一版视频，接着当前时刻放；在按钮的点击里调，play() 才不被拦
      lang(l) {
        if (l === cur) return;
        const t = this.now(), was = this.playing();
        cur = l;
        pending = t;
        fill(l);
        v.load();
        if (was) v.play().catch(() => {});
      },
    };
  }

  function open({ start }) {
    if (!dialog) {
      build();
      const touched = new Set();
      form().addEventListener("change", (e) => {
        touched.add(e.target.name);
        paint();
      });
      form().addEventListener("submit", (e) => {
        e.preventDefault();
        dialog.close();
        const choice = { lang: pick("lang"), video: pick("video"), audio: pick("audio") };
        remember(choice);
        if (choice.video === "pre" && state && !state.video) {
          let failed = false;
          const ext = media(choice.lang, (t) => {
            if (failed) return;
            failed = true;
            ext.el.remove();
            load.textContent = tr("videoFailed", choice.lang);
            load.style.display = "";
            setTimeout(() => (load.style.display = "none"), 4000);
            start({ lang: choice.lang, audio: "score", t });
          });
          ext.el.play().catch(() => {});
          start({ lang: choice.lang, video: ext });
        } else {
          load.textContent = tr(choice.audio === "pre" && !(state && state.score) ? "loadTrack" : "loadSynth", choice.lang);
          start({ lang: choice.lang, audio: choice.audio === "pre" ? "score" : "synth" });
        }
      });
      set(defaults());
      probe.then((s) => {
        state = s;
        paint();
        // 查完才知道视频、音轨能不能用：没动过的、或者选中的那项刚被灰掉的组，换成这时的默认
        const now = defaults(), stale = (name) => !touched.has(name) || !form().querySelector(`input[name=${name}]:checked:enabled`);
        set(Object.fromEntries(["video", "audio"].filter(stale).map((name) => [name, now[name]])));
        paint();
      });
    }
    paint();
    dialog.showModal();
    form().querySelector("button[type=submit]").focus();
  }

  window.Watch = { open };
})();
