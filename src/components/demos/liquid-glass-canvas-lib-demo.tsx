"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "liquid-glass-canvas/css";

type LensOptions = {
  radius?: number;
  depth?: number;
  feather?: number;
  curve?: number;
  chroma?: number;
  tint?: string | [number, number, number, number];
  glint?: number;
};

type LiquidGlassInstance = {
  registerLens(target: HTMLElement, options?: LensOptions): void;
  updateLens(target: HTMLElement, options: Partial<LensOptions>): void;
  start(): void;
  destroy(): void;
};

type Blob = {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  hue: number;
};

const DEFAULT_LENS = {
  radius: 28,
  depth: 90,
  feather: 18,
  curve: 2,
  chroma: 0.06,
  tint: "rgba(255, 255, 255, 0.08)",
  glint: 0.45,
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  blobs: Blob[],
  t: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${210 + Math.sin(t * 0.0002) * 20} 48% 18%)`);
  gradient.addColorStop(0.5, `hsl(${280 + Math.cos(t * 0.00015) * 18} 42% 22%)`);
  gradient.addColorStop(1, `hsl(${160 + Math.sin(t * 0.00018) * 16} 38% 16%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (const blob of blobs) {
    const glow = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
    glow.addColorStop(0, `hsla(${blob.hue} 85% 68% / 0.9)`);
    glow.addColorStop(0.45, `hsla(${blob.hue} 75% 55% / 0.45)`);
    glow.addColorStop(1, `hsla(${blob.hue} 70% 45% / 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = (t * 0.02) % step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = (t * 0.015) % step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  const ringX = width * 0.72;
  const ringY = height * 0.28;
  const ringR = Math.min(width, height) * 0.12;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR + Math.sin(t * 0.002) * 8, 0, Math.PI * 2);
  ctx.strokeStyle = "hsla(45 90% 70% / 0.55)";
  ctx.lineWidth = 10;
  ctx.stroke();
}

export function LiquidGlassCanvasLibDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<LiquidGlassInstance | null>(null);
  const rafRef = useRef<number>(0);
  const blobsRef = useRef<Blob[]>([]);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState({ ...DEFAULT_LENS });
  const [panelPos, setPanelPos] = useState({ x: 24, y: 24 });

  const applyLensOptions = useEffectEvent((next: typeof lens) => {
    const glass = glassRef.current;
    const el = lensRef.current;
    if (!glass || !el) return;
    glass.updateLens(el, {
      radius: next.radius,
      depth: next.depth,
      feather: next.feather,
      curve: next.curve,
      chroma: next.chroma,
      tint: next.tint,
      glint: next.glint,
    });
  });

  useEffect(() => {
    applyLensOptions(lens);
  }, [lens]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const lensEl = lensRef.current;
    if (!container || !canvas || !lensEl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("当前环境无法创建 Canvas 2D 上下文。");
      return;
    }

    let disposed = false;
    let glass: LiquidGlassInstance | null = null;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (blobsRef.current.length === 0) {
        blobsRef.current = Array.from({ length: 7 }, (_, i) => ({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 60 + Math.random() * 90,
          vx: (Math.random() - 0.5) * 0.55,
          vy: (Math.random() - 0.5) * 0.55,
          hue: (i * 47 + 20) % 360,
        }));
      }

      setPanelPos((prev) => {
        const maxX = Math.max(12, w - 220);
        const maxY = Math.max(12, h - 160);
        return {
          x: clamp(prev.x, 12, maxX),
          y: clamp(prev.y, 12, maxY),
        };
      });
    };

    resize();

    const tick = (t: number) => {
      if (disposed) return;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      for (const blob of blobsRef.current) {
        blob.x += blob.vx;
        blob.y += blob.vy;
        if (blob.x < -blob.r) blob.x = w + blob.r;
        if (blob.x > w + blob.r) blob.x = -blob.r;
        if (blob.y < -blob.r) blob.y = h + blob.r;
        if (blob.y > h + blob.r) blob.y = -blob.r;
      }

      drawScene(ctx, w, h, blobsRef.current, t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    void (async () => {
      try {
        const { createCanvasLiquidGlass } = await import("liquid-glass-canvas");
        if (disposed) return;
        glass = createCanvasLiquidGlass({
          source: canvas,
          container,
          dpr: "auto",
          quality: "auto",
        });
        if (disposed) {
          glass.destroy();
          glass = null;
          return;
        }
        glass.registerLens(lensEl, { ...DEFAULT_LENS });
        glass.start();
        glassRef.current = glass;
        applyLensOptions({ ...DEFAULT_LENS });
        setReady(true);
        setError(null);
      } catch (err) {
        if (disposed) return;
        const message = err instanceof Error ? err.message : "初始化液体玻璃失败";
        setError(message);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      glassRef.current?.destroy();
      glassRef.current = null;
      glass?.destroy();
      glass = null;
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const lensEl = lensRef.current;
    if (!lensEl) return;
    lensEl.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panelPos.x,
      offsetY: event.clientY - panelPos.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const container = containerRef.current;
    const lensEl = lensRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !container || !lensEl) return;
    const rect = container.getBoundingClientRect();
    const maxX = Math.max(12, rect.width - lensEl.offsetWidth - 12);
    const maxY = Math.max(12, rect.height - lensEl.offsetHeight - 12);
    setPanelPos({
      x: clamp(event.clientX - drag.offsetX, 12, maxX),
      y: clamp(event.clientY - drag.offsetY, 12, maxY),
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const update = (key: keyof typeof lens, value: number) => {
    setLens((prev) => ({ ...prev, [key]: value }));
  };

  const panelStyle = {
    left: panelPos.x,
    top: panelPos.y,
    borderRadius: lens.radius,
  } satisfies CSSProperties;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2 border-b border-line pb-4">
        <p className="label-mono text-muted-foreground">DEMOS / LIQUID-GLASS / CANVAS-LIB</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Canvas 2D + liquid-glass-canvas</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          背景由 Canvas 2D 持续绘制；玻璃透镜由社区库{" "}
          <code className="font-mono text-[0.9em]">liquid-glass-canvas</code>{" "}
          做 WebGL 折射叠加。拖动玻璃卡片，或调节下方参数。
        </p>
      </header>

      <div
        ref={containerRef}
        className="relative h-[min(70vh,560px)] min-h-[320px] w-full overflow-hidden border border-line bg-black touch-none"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />

        <div
          ref={lensRef}
          role="group"
          aria-label="可拖动的液体玻璃透镜"
          className="absolute z-10 flex w-[min(72vw,240px)] cursor-grab flex-col gap-2 border border-white/25 bg-white/5 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.25)] active:cursor-grabbing select-none"
          style={panelStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <p className="text-xs font-medium tracking-wide text-white/80">液体玻璃透镜</p>
          <p className="text-lg font-semibold leading-snug">拖我看折射</p>
          <p className="text-xs leading-relaxed text-white/70">
            {ready ? "库已启动 · 支持触控与鼠标" : "正在初始化…"}
          </p>
        </div>

        {!ready && !error ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 text-sm text-white">
            正在加载液体玻璃…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-4 text-center text-sm text-white">
            {error}
          </div>
        ) : null}
      </div>

      <section className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">折射深度 depth · {lens.depth}</span>
          <input
            type="range"
            min={20}
            max={160}
            value={lens.depth}
            onChange={(e) => update("depth", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">色差 chroma · {lens.chroma.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={0.15}
            step={0.01}
            value={lens.chroma}
            onChange={(e) => update("chroma", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">羽化 feather · {lens.feather}</span>
          <input
            type="range"
            min={4}
            max={40}
            value={lens.feather}
            onChange={(e) => update("feather", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">高光 glint · {lens.glint.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={lens.glint}
            onChange={(e) => update("glint", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">圆角 radius · {lens.radius}</span>
          <input
            type="range"
            min={8}
            max={48}
            value={lens.radius}
            onChange={(e) => update("radius", Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label-mono text-muted-foreground">曲线 curve · {lens.curve.toFixed(1)}</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={lens.curve}
            onChange={(e) => update("curve", Number(e.target.value))}
          />
        </label>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        技术栈：HTML Canvas 2D 背景动画 + npm 包 liquid-glass-canvas（Overlay 模式，registerLens）。
        该库专为 Canvas/WebGL 源做 GPU 折射，不折射画布外的普通 DOM。
      </p>
    </div>
  );
}
