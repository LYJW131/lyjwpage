"use client";

import { useEffect, useId, useRef, useState } from "react";

type DemoStatus = "loading" | "ready" | "unsupported";

const VERTEX = /* glsl */ `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const SCENE_FRAGMENT = /* glsl */ `
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  vec3 c1 = vec3(0.12, 0.28, 0.55);
  vec3 c2 = vec3(0.55, 0.22, 0.42);
  vec3 c3 = vec3(0.18, 0.48, 0.42);
  vec3 c4 = vec3(0.72, 0.55, 0.22);

  float t = u_time * 0.15;
  vec3 base = mix(c1, c2, smoothstep(-0.4, 0.6, p.x + 0.35 * sin(t)));
  base = mix(base, c3, smoothstep(0.55, -0.2, p.y + 0.2 * cos(t * 0.8)));
  base = mix(base, c4, 0.35 * smoothstep(0.9, 0.1, length(p - vec2(0.35 * cos(t), -0.2))));

  // 背景里放几块可辨认的色块，方便看出折射扭曲
  float cards = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 center = vec2(
      -0.55 + fi * 0.28 + 0.04 * sin(t + fi),
      0.28 * sin(t * 1.1 + fi * 1.7) - 0.05
    );
    vec2 q = abs(p - center) - vec2(0.11, 0.16);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float fill = 1.0 - smoothstep(0.0, 0.01, d);
    vec3 cardColor = mix(vec3(0.95, 0.93, 0.88), vec3(0.2, 0.55, 0.85), fract(fi * 0.27 + 0.1));
    base = mix(base, cardColor, fill * 0.92);
    cards += fill;
  }

  // 细纹网格：折射时会出现弯曲，便于肉眼验证
  vec2 gridUv = uv * vec2(aspect, 1.0) * 14.0;
  float grid = step(0.92, abs(fract(gridUv.x) - 0.5) * 2.0)
             * step(0.92, abs(fract(gridUv.y) - 0.5) * 2.0);
  base += vec3(0.08) * (1.0 - grid) * (1.0 - cards * 0.5);

  float grain = noise(uv * u_res * 0.35 + t) * 0.04;
  base += grain;

  // 轻微暗角，突出中间玻璃
  float vignette = smoothstep(1.25, 0.25, length(p));
  base *= mix(0.72, 1.0, vignette);

  gl_FragColor = vec4(base, 1.0);
}
`;

const GLASS_FRAGMENT = /* glsl */ `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_res;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_ior;
uniform float u_chroma;
uniform float u_blur;
uniform float u_radius;
uniform float u_height;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// 把液态玻璃做成略扁的圆角胶囊，边缘用时间做轻微形变
float glassSdf(vec2 p) {
  float breathe = 1.0 + 0.03 * sin(u_time * 1.4);
  vec2 size = vec2(u_radius * 1.15, u_radius * u_height) * breathe;
  float r = min(size.x, size.y) * 0.72;
  float d = sdRoundedBox(p, size, r);
  float wave = 0.012 * sin(p.x * 18.0 + u_time * 2.2) * sin(p.y * 14.0 - u_time * 1.6);
  return d + wave;
}

vec2 glassNormal(vec2 p) {
  float e = 1.5 / min(u_res.x, u_res.y);
  float dx = glassSdf(p + vec2(e, 0.0)) - glassSdf(p - vec2(e, 0.0));
  float dy = glassSdf(p + vec2(0.0, e)) - glassSdf(p - vec2(0.0, e));
  return normalize(vec2(dx, dy) + 1e-5);
}

vec3 sampleScene(vec2 uv) {
  uv = clamp(uv, 0.001, 0.999);
  return texture2D(u_scene, uv).rgb;
}

vec3 refractSample(vec2 uv, vec2 offset, float blurAmt) {
  if (blurAmt < 0.01) {
    return sampleScene(uv + offset);
  }
  vec2 px = blurAmt / u_res;
  vec3 c = vec3(0.0);
  c += sampleScene(uv + offset);
  c += sampleScene(uv + offset + vec2(px.x, 0.0));
  c += sampleScene(uv + offset + vec2(-px.x, 0.0));
  c += sampleScene(uv + offset + vec2(0.0, px.y));
  c += sampleScene(uv + offset + vec2(0.0, -px.y));
  c += sampleScene(uv + offset + vec2(px.x, px.y) * 0.7);
  c += sampleScene(uv + offset + vec2(-px.x, px.y) * 0.7);
  c += sampleScene(uv + offset + vec2(px.x, -px.y) * 0.7);
  c += sampleScene(uv + offset + vec2(-px.x, -px.y) * 0.7);
  return c / 9.0;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 pointer = (u_pointer - 0.5) * vec2(aspect, 1.0);
  vec2 local = p - pointer;

  float d = glassSdf(local);
  float aa = 2.0 / min(u_res.x, u_res.y);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float rim = smoothstep(0.018, 0.0, abs(d)) * inside;

  vec3 scene = sampleScene(uv);

  if (inside < 0.001) {
    gl_FragColor = vec4(scene, 1.0);
    return;
  }

  vec2 n = glassNormal(local);
  // 厚度近似：越靠近中心折射越强
  float thickness = clamp(-d / max(u_radius * 0.55, 0.001), 0.0, 1.0);
  float strength = u_ior * thickness;

  vec2 bend = n * strength * 0.22;
  // 色散：RGB 分通道采样
  float chroma = u_chroma * strength;
  vec2 offR = bend * (1.0 + chroma);
  vec2 offG = bend;
  vec2 offB = bend * (1.0 - chroma);

  float blurAmt = u_blur * (0.35 + 0.65 * thickness) * min(u_res.x, u_res.y) * 0.004;
  float r = refractSample(uv, offR, blurAmt).r;
  float g = refractSample(uv, offG, blurAmt).g;
  float b = refractSample(uv, offB, blurAmt).b;
  vec3 glass = vec3(r, g, b);

  // 轻微提亮 + 边缘高光，像玻璃厚度反光
  glass = mix(glass, glass * 1.08 + 0.04, 0.35 * thickness);
  vec3 specular = vec3(0.85, 0.92, 1.0) * rim * (0.55 + 0.45 * thickness);
  glass += specular;

  // 内部极淡的冷色调，避免「只是糊一层」
  glass = mix(glass, vec3(0.78, 0.88, 0.98), 0.06 * thickness);

  vec3 color = mix(scene, glass, inside);
  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function WebglRefractionDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerTarget = useRef({ x: 0.5, y: 0.45 });
  const pointerCurrent = useRef({ x: 0.5, y: 0.45 });
  const dragging = useRef(false);
  /** 最近一次指针输入时间；超时后才恢复空闲漂移，避免盖住悬停 */
  const lastPointerAt = useRef(0);
  const paramsRef = useRef({ ior: 0.85, chroma: 0.55, blur: 0.45, radius: 0.22, height: 0.72 });
  const [status, setStatus] = useState<DemoStatus>("loading");
  const [ior, setIor] = useState(0.85);
  const [chroma, setChroma] = useState(0.55);
  const [blur, setBlur] = useState(0.45);
  const [radius, setRadius] = useState(0.22);
  const labelId = useId();

  useEffect(() => {
    paramsRef.current = { ior, chroma, blur, radius, height: 0.72 };
  }, [ior, chroma, blur, radius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      setStatus("unsupported");
      return;
    }

    const sceneProgram = createProgram(gl, VERTEX, SCENE_FRAGMENT);
    const glassProgram = createProgram(gl, VERTEX, GLASS_FRAGMENT);
    if (!sceneProgram || !glassProgram) {
      setStatus("unsupported");
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const scenePos = gl.getAttribLocation(sceneProgram, "a_pos");
    const glassPos = gl.getAttribLocation(glassProgram, "a_pos");

    const sceneUniforms = {
      res: gl.getUniformLocation(sceneProgram, "u_res"),
      time: gl.getUniformLocation(sceneProgram, "u_time"),
    };
    const glassUniforms = {
      scene: gl.getUniformLocation(glassProgram, "u_scene"),
      res: gl.getUniformLocation(glassProgram, "u_res"),
      pointer: gl.getUniformLocation(glassProgram, "u_pointer"),
      time: gl.getUniformLocation(glassProgram, "u_time"),
      ior: gl.getUniformLocation(glassProgram, "u_ior"),
      chroma: gl.getUniformLocation(glassProgram, "u_chroma"),
      blur: gl.getUniformLocation(glassProgram, "u_blur"),
      radius: gl.getUniformLocation(glassProgram, "u_radius"),
      height: gl.getUniformLocation(glassProgram, "u_height"),
    };

    const sceneTexture = createTexture(gl);
    const framebuffer = gl.createFramebuffer();
    if (!sceneTexture || !framebuffer) {
      setStatus("unsupported");
      return;
    }

    let cssW = 0;
    let cssH = 0;
    let drawW = 0;
    let drawH = 0;
    let raf = 0;
    let running = true;
    let visible = true;
    const start = performance.now();

    const bindQuad = (program: WebGLProgram, loc: number) => {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
      // 移动端限到 1.5，避免全屏 fragment 过重
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      drawW = Math.max(1, Math.floor(cssW * dpr));
      drawH = Math.max(1, Math.floor(cssH * dpr));
      canvas.width = drawW;
      canvas.height = drawH;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, drawW, drawH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
    };

    const setPointerFromEvent = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointerTarget.current.x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      pointerTarget.current.y = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
      lastPointerAt.current = performance.now();
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging.current = true;
      canvas.setPointerCapture(e.pointerId);
      setPointerFromEvent(e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      // 触摸只在按下后跟随；鼠标悬停即可移动玻璃
      if (e.pointerType === "touch" && !dragging.current) return;
      setPointerFromEvent(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging.current = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.visibilityState === "hidden") return;

      const t = (now - start) / 1000;
      // 无指针输入约 1.8s 后恢复缓慢漂移
      if (!dragging.current && now - lastPointerAt.current > 1800) {
        pointerTarget.current.x = 0.5 + 0.18 * Math.sin(t * 0.55);
        pointerTarget.current.y = 0.48 + 0.12 * Math.cos(t * 0.41);
      }
      pointerCurrent.current.x += (pointerTarget.current.x - pointerCurrent.current.x) * 0.14;
      pointerCurrent.current.y += (pointerTarget.current.y - pointerCurrent.current.y) * 0.14;

      const p = paramsRef.current;

      // Pass 1: 场景 → FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, drawW, drawH);
      bindQuad(sceneProgram, scenePos);
      gl.uniform2f(sceneUniforms.res, drawW, drawH);
      gl.uniform1f(sceneUniforms.time, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Pass 2: 折射合成 → 屏幕
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, drawW, drawH);
      bindQuad(glassProgram, glassPos);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(glassUniforms.scene, 0);
      gl.uniform2f(glassUniforms.res, drawW, drawH);
      gl.uniform2f(glassUniforms.pointer, pointerCurrent.current.x, pointerCurrent.current.y);
      gl.uniform1f(glassUniforms.time, t);
      gl.uniform1f(glassUniforms.ior, p.ior);
      gl.uniform1f(glassUniforms.chroma, p.chroma);
      gl.uniform1f(glassUniforms.blur, p.blur);
      gl.uniform1f(glassUniforms.radius, p.radius);
      gl.uniform1f(glassUniforms.height, p.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    resize();
    setStatus("ready");
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true;
      },
      { threshold: 0.01 },
    );
    io.observe(canvas);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      gl.deleteProgram(sceneProgram);
      gl.deleteProgram(glassProgram);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(sceneTexture);
      gl.deleteFramebuffer(framebuffer);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        ref={wrapRef}
        className="relative min-h-[min(70vh,560px)] flex-1 overflow-hidden rounded-none border border-line bg-background"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          aria-labelledby={labelId}
          role="img"
        />
        {status === "loading" ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">正在初始化 WebGL…</p>
        ) : null}
        {status === "unsupported" ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
            当前环境无法创建 WebGL 上下文，无法演示折射液体玻璃。
          </p>
        ) : null}
        <p
          id={labelId}
          className="pointer-events-none absolute bottom-3 left-3 max-w-[min(100%-1.5rem,22rem)] rounded-none bg-black/45 px-2 py-1 text-xs text-white"
        >
          拖动或滑动移动玻璃；桌面悬停也可跟随。
        </p>
      </div>

      <div className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="flex justify-between text-muted-foreground">
            折射率强度 <span className="tabular-nums text-foreground">{ior.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.15}
            max={1.4}
            step={0.01}
            value={ior}
            onChange={(e) => setIor(Number(e.target.value))}
            className="w-full accent-[var(--foreground)]"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex justify-between text-muted-foreground">
            色散 <span className="tabular-nums text-foreground">{chroma.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.01}
            value={chroma}
            onChange={(e) => setChroma(Number(e.target.value))}
            className="w-full accent-[var(--foreground)]"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex justify-between text-muted-foreground">
            磨砂模糊 <span className="tabular-nums text-foreground">{blur.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.01}
            value={blur}
            onChange={(e) => setBlur(Number(e.target.value))}
            className="w-full accent-[var(--foreground)]"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex justify-between text-muted-foreground">
            玻璃尺寸 <span className="tabular-nums text-foreground">{radius.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.12}
            max={0.36}
            step={0.01}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-[var(--foreground)]"
          />
        </label>
      </div>
    </div>
  );
}
