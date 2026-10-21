// 终章高潮的十格分屏：每格真的调那一章自己的 render，画进 G.scene，再缩成一张小图存起来，最后按格子贴回画面。
// 各格按 SPLIT_FPS 量化时间、相位错开，同一刻每帧只重画一两格；缓存按（章、量化后的小节、画布宽、语种）记，只省重画，不改画出来的结果。
(() => {
  const F10 = window.FIN10;
  const SPLIT_FPS = 10;
  // 每格放那一章的哪一段（章内小节）；挑的是各章画风最足、又不靠旁白撑着的一段。
  const CELLS = [
    { id: "ch00", from: 0.4 }, { id: "ch01", from: 2.6 }, { id: "ch02", from: 22.4 }, { id: "ch03", from: 8.0 },
    { id: "ch04", from: 6.0 }, { id: "ch05", from: 7.6 }, { id: "ch06", from: 1.0 }, { id: "ch07", from: 1.9 },
    { id: "ch08", from: 4.9 }, { id: "ch09", from: 3.0 },
  ];
  const GAP = 16, CW = (1920 - 5 * GAP) / 4, CH = (1080 - 4 * GAP) / 3;
  const slot = (c, r, span = 1) => [GAP + c * (CW + GAP), GAP + r * (CH + GAP), span * CW + (span - 1) * GAP, CH];
  const SLOTS = [slot(0, 0), slot(1, 0), slot(2, 0), slot(3, 0), slot(0, 1), slot(3, 1), slot(0, 2), slot(1, 2), slot(2, 2), slot(3, 2)];
  const CENTER = slot(1, 1, 2);
  // 中间那格比 16:9 扁：取「正在听」那一行上下（第 00 章翻面时它在屏幕 y 约 0.44 处）。十个小格不裁，整幅缩进去（ch10.js#cellImg）。
  const cropFor = (w, h, cy = 0.5) => {
    const a = w / h, A = 16 / 9;
    return a < A ? [(1 - a / A) / 2, 0, a / A, 1] : [0, cy - A / a / 2, 1, A / a];
  };
  const CENTER_SRC = cropFor(CENTER[2], CENTER[3], 0.44);

  let down = null, blit = null, cellRT = [], centerRT = null, sized = 0;
  const memo = new Map();
  function ensure() {
    if (!down) {
      down = G.pass(`
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){ vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) c += texture(uSrc, vUv + (vec2(float(i), float(j)) - 1.5) * uTexel).rgb;
  fragColor = vec4(c / 16.0, 1.0); }`);
      blit = G.pass(`
uniform sampler2D uTex; uniform vec4 uDst; uniform vec4 uSrcR; uniform float uRot; uniform float uA; uniform vec2 uTap;
void main(){
  vec2 p = screenPos() - (uDst.xy + uDst.zw * 0.5);
  float c = cos(uRot), s = sin(uRot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y), h = uDst.zw * 0.5, e = h - abs(q);
  if (e.x < -1.0 || e.y < -1.0) discard;
  vec2 uv = uSrcR.xy + (q + h) / uDst.zw * uSrcR.zw;
  uv.y = 1.0 - uv.y;
  vec3 col = 0.25 * (texture(uTex, uv + uTap).rgb + texture(uTex, uv - uTap).rgb + texture(uTex, uv + vec2(uTap.x, -uTap.y)).rgb + texture(uTex, uv + vec2(-uTap.x, uTap.y)).rgb);
  fragColor = vec4(col, uA * sat(min(e.x, e.y) * uS + 0.5));
}`);
    }
    if (sized !== G.PW) {
      const gl = G.gl, free = (rt) => { if (rt) { gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fb); } };
      cellRT.forEach(free); free(centerRT);
      cellRT = CELLS.map(() => G.makeRT(Math.max(1, Math.round(602 * G.S)), Math.max(1, Math.round(339 * G.S))));
      centerRT = G.makeRT(G.PW, G.PH);
      sized = G.PW; memo.clear();
    }
  }

  const chapter = (id) => (window.CHAPTERS || []).find((c) => c.id === id);
  // 借别章的 render：照 film.js#frameFor 拼一个 f；查字号的记录暂时摘掉，别章的字不算在本章头上。
  function renderAt(id, bar, fn) {
    const c = chapter(id);
    if (!c) return false;
    const BPM = (window.Score && window.Score.BPM) || 108, BEAT = 60 / BPM, BAR = BEAT * 4, lt = bar * BAR, t = (c.t0 ?? 0) + lt;
    const chk = window.__CHECK, t0 = G.t, fr0 = G.frame, cam0 = G.cam;
    window.__CHECK = null;
    G.t = t; G.frame = Math.floor(t * 60 + 1e-6);
    G.setCam({ x: G.W / 2, y: G.H / 2, zoom: 1, rot: 0 });
    const f = { t, lt, ch: c, bar, beat: lt / BEAT, BAR, BEAT, frame: G.frame, at: (b, bt = 0) => (b * 4 + bt) * BEAT, hit: () => 0, env: () => 0, tr: I18N.tr, post: {} };
    try { (fn || c.render)(f); } finally { G.t = t0; G.frame = fr0; G.setCam(cam0); window.__CHECK = chk; }
    return true;
  }
  function shrink(rt) { down.draw(rt, { uSrc: G.scene, uTexel: [1 / (4 * rt.w), 1 / (4 * rt.h)] }); }

  // 第 i 格此刻该放到章内哪一小节：按 SPLIT_FPS 取整，各格的取整点错开 i/10 帧。
  function cellBar(i, secs, BAR) {
    const ph = i / CELLS.length, q = (Math.floor(secs * SPLIT_FPS + ph) - ph) / SPLIT_FPS;
    return CELLS[i].from + Math.max(0, q) / BAR;
  }
  function updateCell(i, secs, BAR) {
    ensure();
    const bar = cellBar(i, secs, BAR), key = `${bar.toFixed(5)}|${G.PW}|${I18N.lang}`;
    if (memo.get(i) === key) return;
    if (renderAt(CELLS[i].id, bar)) shrink(cellRT[i]);
    memo.set(i, key);
  }
  // 中间那格每帧现画（第 00 章的 paperFrame），整张原样拷下来，缩小时由贴图的四个采样点去平均。
  function updateCenter(fn) {
    ensure();
    renderAt("ch00", 0, fn);
    down.draw(centerRT, { uSrc: G.scene, uTexel: [0, 0] });
  }
  function draw(rt, dst, src, rot = 0, a = 1) {
    if (a <= 0) return;
    const gl = G.gl;
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    blit.draw(G.scene, { uTex: rt, uDst: dst, uSrcR: src, uRot: rot, uA: a, uTap: [0.25 * src[2] / Math.max(1, dst[2] * G.S), 0.25 * src[3] / Math.max(1, dst[3] * G.S)] });
    gl.disable(gl.BLEND);
  }
  // 有些章在 ?only 预览时没被 film.js 初始化，第一次用之前补一次。
  async function initCells() {
    const only = new URLSearchParams(location.search).get("only");
    if (!only) return;
    const list = only.split(",");
    for (const id of ["ch00", ...CELLS.map((c) => c.id)]) {
      const c = chapter(id);
      if (c && c.init && !list.includes(id) && !c.__finInit) { c.__finInit = true; await c.init(); }
    }
  }

  F10.split = { CELLS, SLOTS, CENTER, CENTER_SRC, updateCell, updateCenter, draw, initCells, rt: () => ({ cells: cellRT, center: centerRT }) };
})();
