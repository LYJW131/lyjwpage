// 引擎：WebGL2 当 2D 合成器用。画面是时间 t 的纯函数：同一个 t 永远出同一帧。
// 全片只有 2D：镜头是平移、缩放、旋转四个数（uCam），没有透视矩阵、没有光线步进。
// 场景在 1920×1080 的逻辑像素里排版；画布按屏幕实际像素渲染，逻辑 → 物理的倍数是 G.S。
// 一帧的流程：场景往 HDR 目标（线性、半浮点）上画图版底（按 worldPos() 画的全屏 2D 着色器）和 Canvas2D 图层
// → 后期（泛光、光晕、色散、暗角、颗粒、色调映射、按镜头速度算的运动模糊）→ 屏幕。
(() => {
  const W = 1920, H = 1080;

  // ---------- 颜色：站点 token 用 oklch 写，这里换成线性 sRGB（GL）和 sRGB 字符串（Canvas2D） ----------
  function oklch(L, C, h) {
    const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => Math.max(0, v));
  }
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  // 调色板：取自 src/app/globals.css
  const LIN = {
    ink: oklch(0.15, 0.008, 85), // 暗图版底色（暗色 --background）
    ink2: oklch(0.185, 0.008, 85), // 面板（暗色 --surface）
    paper: oklch(0.94, 0.007, 92), // 纸面底色（亮色 --background）
    pink: oklch(0.19, 0.006, 80), // 纸上的墨（亮色 --foreground）
    bone: oklch(0.93, 0.012, 90), // 暗底上的字与线（暗色 --foreground）
    graphite: oklch(0.48, 0.008, 80),
    ash: oklch(0.66, 0.012, 90),
    signal: oklch(0.672, 0.131, 38.8), // --claude（纸面）
    signalD: oklch(0.74, 0.115, 39), // --claude（暗底）
    ember: oklch(0.86, 0.1, 55),
    live: oklch(0.76, 0.16, 148),
    liveL: oklch(0.65, 0.17, 145),
  };
  const CSS = {};
  for (const k in LIN) CSS[k] = LIN[k].map((v) => Math.round(255 * enc(Math.min(1, v))));
  const css = (name, a = 1) => {
    const c = CSS[name];
    return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };

  // ---------- GL ----------
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("需要 WebGL2");
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");
  const vao = gl.createVertexArray();

  const vec3 = (v) => `vec3(${v.map((x) => x.toFixed(5)).join(",")})`;
  const COMMON = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;      // 物理像素
uniform float uS;       // 逻辑 → 物理
uniform float uT;       // 秒
uniform float uFrame;   // 60fps 帧号（逐帧闪烁用它，不用连续时间）
uniform vec4 uCam;      // 当前 2D 镜头：世界坐标中心 x,y、缩放、旋转
const vec2 LOG = vec2(${W}.0, ${H}.0);
const vec3 C_INK = ${vec3(LIN.ink)};
const vec3 C_INK2 = ${vec3(LIN.ink2)};
const vec3 C_PAPER = ${vec3(LIN.paper)};
const vec3 C_PINK = ${vec3(LIN.pink)};
const vec3 C_BONE = ${vec3(LIN.bone)};
const vec3 C_GRAPHITE = ${vec3(LIN.graphite)};
const vec3 C_ASH = ${vec3(LIN.ash)};
const vec3 C_SIGNAL = ${vec3(LIN.signal)};
const vec3 C_SIGNALD = ${vec3(LIN.signalD)};
const vec3 C_EMBER = ${vec3(LIN.ember)};
float sat(float x){ return clamp(x, 0.0, 1.0); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec3 toLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// 片元的逻辑屏幕坐标（y 向下）
vec2 screenPos(){ return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uS; }
// 片元的世界坐标：按 uCam 反推
vec2 worldPos(){ vec2 d = (screenPos() - LOG * 0.5) / uCam.z; float c = cos(uCam.w), s = sin(uCam.w);
  return uCam.xy + vec2(c * d.x + s * d.y, -s * d.x + c * d.y); }
// 发丝线：d 为到线的距离（逻辑像素），w 为线宽（逻辑像素）；按物理像素做抗锯齿
float pxLine(float d, float w){ float dp = d * uS, wp = max(w * uS, 1.0); return (1.0 - smoothstep(wp * 0.5 - 0.6, wp * 0.5 + 0.6, dp)) * min(1.0, w * uS); }
`;

  const VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
      console.error(log + "\n" + lines);
      throw new Error("着色器编译失败：" + log);
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VERT);

  // 全屏着色器通道。uniforms 按值推断类型；{ tex } 视为采样器
  class Pass {
    constructor(frag) {
      this.prog = gl.createProgram();
      gl.attachShader(this.prog, vs);
      gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, "#version 300 es\n" + COMMON + frag));
      gl.linkProgram(this.prog);
      if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog));
      this.loc = {};
    }
    u(name) {
      if (!(name in this.loc)) this.loc[name] = gl.getUniformLocation(this.prog, name);
      return this.loc[name];
    }
    draw(target, uniforms = {}) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
      gl.useProgram(this.prog);
      const all = { uRes: [G.PW, G.PH], uS: G.S, uT: G.t, uFrame: G.frame, uCam: G.camVec, ...uniforms };
      let unit = 0;
      for (const k in all) {
        const v = all[k], l = this.u(k);
        if (l == null) continue;
        if (v && v.tex !== undefined) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v.tex);
          gl.uniform1i(l, unit++);
        } else if (typeof v === "number") gl.uniform1f(l, v);
        else if (typeof v === "boolean") gl.uniform1i(l, v ? 1 : 0);
        else if (v.length === 2) gl.uniform2fv(l, v);
        else if (v.length === 3) gl.uniform3fv(l, v);
        else if (v.length === 4) gl.uniform4fv(l, v);
        else if (v.length === 16) gl.uniformMatrix4fv(l, false, v);
      }
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  function makeRT(w, h, float = true) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  const freeRT = (rt) => { if (rt) { gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fb); } };

  // Canvas2D 图层：按物理分辨率建画布，上下文预先缩放到逻辑像素
  const layers = [];
  class Layer {
    constructor(scale = 1) {
      this.scale = scale; // 1 = 满分辨率；0.5 = 半分辨率（柔光之类）
      this.c = document.createElement("canvas");
      this.tex = gl.createTexture();
      layers.push(this);
      this.resize();
    }
    resize() {
      this.c.width = Math.max(1, Math.round(W * G.S * this.scale));
      this.c.height = Math.max(1, Math.round(H * G.S * this.scale));
      this.ctx = this.c.getContext("2d");
    }
    begin() {
      const x = this.ctx;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, this.c.width, this.c.height);
      const k = G.S * this.scale;
      x.setTransform(k, 0, 0, k, 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
      return x;
    }
    // 把 2D 世界坐标经镜头映射到屏幕：screen = R(rot)·(world − c)·zoom + 中心
    cam(cam) {
      const k = G.S * this.scale, z = cam.zoom, c = Math.cos(cam.rot || 0), s = Math.sin(cam.rot || 0);
      const sx = (cam.sx ?? 0), sy = (cam.sy ?? 0);
      this.ctx.setTransform(k * z * c, k * z * s, -k * z * s, k * z * c,
        k * (W / 2 + sx - z * (c * cam.x - s * cam.y)), k * (H / 2 + sy - z * (s * cam.x + c * cam.y)));
    }
    upload() {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.c);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return this;
    }
  }

  // ---------- 合成：把图层叠到 HDR 目标上 ----------
  // mode 0 普通（alpha 叠加）；1 相加（发光，gain 可超过 1）；2 纸上的墨（纤维吃墨、边缘微洇）；3 橡皮章（墨不匀、有空隙）；
  // 4 纸片（alpha 照旧，颜色乘上和纸面图版同一套纸纹：暗底图版上的白卡用它，看起来和第 02 章的纸是同一张纸）
  const compositePass = new Pass(`
uniform sampler2D uTex; uniform float uMode; uniform float uOpacity; uniform float uGain; uniform float uSeed;
void main(){
  vec4 c = texture(uTex, vUv);
  vec3 lin = toLinear(c.rgb);
  float a = c.a * uOpacity;
  vec2 w = worldPos();
  if (abs(uMode - 4.0) < 0.5) {
    float n = fbm(w * 0.011);
    float fib = vnoise(w * vec2(0.55, 0.045));
    lin *= 0.968 + 0.046 * n + 0.014 * fib;
  } else if (abs(uMode - 2.0) < 0.5) {
    float n = fbm(w * 0.07 + uSeed);
    float fiber = vnoise(w * vec2(0.9, 0.12) + uSeed * 3.0);
    float bleed = textureLod(uTex, vUv, 1.6).a;
    a = sat(a * (0.8 + 0.22 * n + 0.08 * fiber) + bleed * 0.05 * uOpacity);
  } else if (abs(uMode - 3.0) < 0.5) {
    float n = fbm(w * 0.035 + uSeed);
    float g = vnoise(w * 0.55 + uSeed);
    float speck = hash12(floor(w * 1.3) + uSeed);
    float keep = smoothstep(0.22, 0.52, n * 0.75 + g * 0.35) * (speck > 0.035 ? 1.0 : 0.0);
    a *= mix(0.25, 1.0, keep);
  }
  if (abs(uMode - 1.0) < 0.5) fragColor = vec4(lin * a * uGain, 1.0);
  else fragColor = vec4(lin, a);
}`);

  function composite(layer, target, { mode = 0, opacity = 1, gain = 1, seed = 0 } = {}) {
    gl.enable(gl.BLEND);
    if (mode === 1) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    compositePass.draw(target, { uTex: layer, uMode: mode, uOpacity: opacity, uGain: gain, uSeed: seed });
    gl.disable(gl.BLEND);
  }
  const MODE = { normal: 0, add: 1, ink: 2, stamp: 3, paper: 4 };

  // ---------- 后期 ----------
  const brightPass = new Pass(`
uniform sampler2D uSrc; uniform float uThr;
void main(){ vec3 c = texture(uSrc, vUv).rgb; float m = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThr, uThr + 0.6, m); fragColor = vec4(c * k, 1.0); }`);
  const downPass = new Pass(`
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){ vec2 o = uTexel * 0.5;
  vec3 s = texture(uSrc, vUv).rgb * 4.0 + texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb + texture(uSrc, vUv + vec2(o.x, -o.y)).rgb
    + texture(uSrc, vUv + vec2(-o.x, o.y)).rgb + texture(uSrc, vUv + vec2(o.x, o.y)).rgb;
  fragColor = vec4(s / 8.0, 1.0); }`);
  const upPass = new Pass(`
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){ vec2 o = uTexel;
  vec3 s = texture(uSrc, vUv + vec2(-o.x * 2.0, 0)).rgb + texture(uSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(0, o.y * 2.0)).rgb + texture(uSrc, vUv + vec2(o.x, o.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(o.x * 2.0, 0)).rgb + texture(uSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(0, -o.y * 2.0)).rgb + texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  fragColor = vec4(s / 12.0, 1.0); }`);
  const finalPass = new Pass(`
uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uWide;
uniform float uBloomAmt, uHalation, uCA, uVignette, uGrain, uExposure, uFlash, uFade;
uniform vec2 uShake; uniform vec3 uFlashCol;
uniform vec2 uBlur;      // 镜头甩动的运动模糊：这一帧里画面移动的逻辑像素
uniform float uZoomBlur; // 冲进去 / 拉出来时的径向模糊（这一帧的缩放比例变化）
vec3 sceneCA(vec2 uv, vec2 off){ return vec3(texture(uScene, uv - off).r, texture(uScene, uv).g, texture(uScene, uv + off).b); }
vec3 shoulder(vec3 x){ // 0.8 以下原样，以上柔和压缩：纸面的白保持准确，只有发光的高光被压
  vec3 k = max(x - 0.8, 0.0); return min(x, 0.8) + 0.2 * (1.0 - exp(-k / 0.2)) * 1.4; }
void main(){
  vec2 uv = vUv + uShake / LOG;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec2 off = cc * r2 * uCA * 0.012;
  vec3 col = vec3(0.0);
  float bl = length(uBlur) + abs(uZoomBlur) * 900.0;
  if (bl > 0.75) {
    // 沿这一帧的运动方向取 24 个样，快门约半帧
    vec2 v = uBlur / LOG * 0.5;
    for (int i = 0; i < 32; i++) {
      float k = (float(i) + 0.5) / 32.0 - 0.5;
      vec2 u2 = uv + v * k;
      u2 = 0.5 + (u2 - 0.5) * (1.0 + uZoomBlur * 0.5 * k);
      col += sceneCA(u2, off);
    }
    col /= 32.0;
  } else col = sceneCA(uv, off);
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 wide = texture(uWide, uv).rgb;
  col += bloom * uBloomAmt;
  col += wide * vec3(1.0, 0.42, 0.22) * uHalation; // 光晕：偏暖的大范围散射
  col *= uExposure;
  col = mix(col, uFlashCol, uFlash);
  col *= mix(1.0, 1.0 - smoothstep(0.15, 0.85, r2 * 2.2), uVignette);
  col = shoulder(col);
  col *= 1.0 - uFade;
  vec3 s = toSRGB(col);
  // 颗粒：按帧号取随机，亮部弱暗部强；再加抖动去色带
  vec2 gp = floor(gl_FragCoord.xy / max(1.0, uS * 0.9));
  float g = hash12(gp + vec2(uFrame * 17.0, uFrame * 31.0)) - 0.5;
  float lum = dot(s, vec3(0.299, 0.587, 0.114));
  s += g * uGrain * mix(1.0, 0.45, lum);
  s += (hash12(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;
  fragColor = vec4(s, 1.0);
}`);

  const POST_DEFAULT = { bloom: 0.9, threshold: 0.95, halation: 0.35, ca: 0.6, vignette: 0.35, grain: 0.05, exposure: 1, flash: 0, flashCol: [1, 1, 1], fade: 0, shake: [0, 0], blur: [0, 0], zoomBlur: 0 };

  // ---------- 共用的图层和着色器 ----------
  // 同一时刻只画一章，所以各章共用同一组图层（每层满分辨率一张画布，4K 下一张约 33 MB，不能每章各建一套）。
  // 各章在 init 里按名字取：G.layer("ink") / "paper" / "stamp" / "top"（满分辨率）、G.layer("emit", 0.5)（半分辨率发光）。
  // 取到的图层每帧先 begin() 清空，上一章画的东西不会留下来。着色器按源码缓存，同一段 GLSL 只编译一次。
  const layerPool = new Map(), passPool = new Map();
  const layer = (name, scale = 1) => {
    const k = `${name}@${scale}`;
    if (!layerPool.has(k)) layerPool.set(k, new Layer(scale));
    return layerPool.get(k);
  };
  const pass = (src) => {
    if (!passPool.has(src)) passPool.set(src, new Pass(src));
    return passPool.get(src);
  };

  // ---------- 全局状态 ----------
  const G = {
    W, H, S: 1, PW: W, PH: H, t: 0, frame: 0,
    LIN, css, oklch, Pass, Layer, layer, pass, makeRT, MODE, gl, canvas,
    cam: { x: W / 2, y: H / 2, zoom: 1, rot: 0 },
    camVec: [W / 2, H / 2, 1, 0],
    scene: null, bloomRT: [],
    setCam(c) { this.cam = c; this.camVec = [c.x, c.y, c.zoom, c.rot || 0]; },
    composite(layer, opts) { composite(layer, this.scene, opts); },
    // 画一个全屏着色器到场景目标（覆盖）
    fill(pass, uniforms) { pass.draw(this.scene, uniforms); },
    clear(rgb) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
      gl.viewport(0, 0, this.PW, this.PH);
      gl.clearColor(rgb[0], rgb[1], rgb[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };

  function resize(pw, ph) {
    if (pw === G.PW && ph === G.PH && G.scene) return;
    G.PW = pw; G.PH = ph; G.S = pw / W;
    canvas.width = pw; canvas.height = ph;
    freeRT(G.scene);
    G.scene = makeRT(pw, ph);
    G.bloomRT.forEach(freeRT);
    G.bloomRT = [];
    let w = Math.round(pw / 2), h = Math.round(ph / 2);
    for (let i = 0; i < 6; i++) { G.bloomRT.push(makeRT(Math.max(1, w), Math.max(1, h))); w = Math.round(w / 2); h = Math.round(h / 2); }
    G.wideRT = makeRT(Math.max(1, Math.round(pw / 4)), Math.max(1, Math.round(ph / 4)));
    layers.forEach((l) => l.resize());
  }

  function post(p) {
    const o = { ...POST_DEFAULT, ...p };
    const B = G.bloomRT;
    brightPass.draw(B[0], { uSrc: G.scene, uThr: o.threshold });
    for (let i = 1; i < B.length; i++) downPass.draw(B[i], { uSrc: B[i - 1], uTexel: [1 / B[i - 1].w, 1 / B[i - 1].h] });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = B.length - 2; i >= 0; i--) {
      if (i === 1) { gl.disable(gl.BLEND); downPass.draw(G.wideRT, { uSrc: B[2], uTexel: [0, 0] }); gl.enable(gl.BLEND); }
      upPass.draw(B[i], { uSrc: B[i + 1], uTexel: [1 / B[i + 1].w, 1 / B[i + 1].h] });
    }
    gl.disable(gl.BLEND);
    finalPass.draw(null, {
      uScene: G.scene, uBloom: B[0], uWide: G.wideRT,
      uBloomAmt: o.bloom, uHalation: o.halation, uCA: o.ca, uVignette: o.vignette, uGrain: o.grain,
      uExposure: o.exposure, uFlash: o.flash, uFlashCol: o.flashCol, uFade: o.fade, uShake: o.shake,
      uBlur: o.blur, uZoomBlur: o.zoomBlur,
    });
  }

  G.resize = resize;
  G.post = post;
  window.G = G;
})();
