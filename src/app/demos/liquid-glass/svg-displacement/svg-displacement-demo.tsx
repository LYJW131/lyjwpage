"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Lens = { x: number; y: number };

const DEFAULTS = {
  scale: 48,
  frequency: 0.018,
  speed: 0.35,
  lensSize: 180,
} as const;

function SceneContent({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden={className ? true : undefined}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,#3e70c9_0%,transparent_45%),radial-gradient(ellipse_at_80%_15%,#8255c7_0%,transparent_40%),radial-gradient(ellipse_at_70%_80%,#c84d3d_0%,transparent_45%),radial-gradient(ellipse_at_15%_75%,#3d7f50_0%,transparent_42%),linear-gradient(145deg,#1a2230_0%,#2a1f38_45%,#1e2a28_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute left-[8%] top-[14%] h-28 w-28 rounded-full bg-[#d0a22c]/70 blur-[1px] sm:h-36 sm:w-36" />
      <div className="absolute bottom-[18%] right-[10%] h-24 w-40 -rotate-6 bg-[#3e70c9]/55 sm:h-28 sm:w-52" />
      <div className="absolute left-[42%] top-[42%] h-20 w-20 rotate-12 bg-[#c84d3d]/65 sm:h-24 sm:w-24" />
      <p className="absolute left-[10%] top-[38%] max-w-[10ch] text-3xl font-bold leading-tight tracking-tight text-white/90 sm:text-5xl">
        液态玻璃
      </p>
      <p className="absolute bottom-[22%] left-[12%] text-sm tracking-wide text-white/70 sm:text-base">
        feTurbulence → feDisplacementMap
      </p>
      <p className="absolute right-[12%] top-[28%] text-right text-xs text-white/55 sm:text-sm">
        拖动透镜
        <br />
        观察折射
      </p>
    </div>
  );
}

function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  nudgeStep,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  nudgeStep?: number;
  display: string;
  onChange: (next: number) => void;
}) {
  const buttonStep = nudgeStep ?? step;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const precision = String(buttonStep).includes(".")
    ? String(buttonStep).split(".")[1].length
    : 0;
  const nudge = (direction: -1 | 1) => {
    const raw = value + direction * buttonStep;
    const rounded = Number(raw.toFixed(precision));
    onChange(clamp(rounded));
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono tabular-nums text-foreground">{display}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${label}减小`}
          onClick={() => nudge(-1)}
          className="inline-flex size-8 shrink-0 items-center justify-center border border-line bg-muted text-sm hover:bg-surface-hover"
        >
          −
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
          className="h-8 w-full accent-[var(--foreground)]"
        />
        <button
          type="button"
          aria-label={`${label}增大`}
          onClick={() => nudge(1)}
          className="inline-flex size-8 shrink-0 items-center justify-center border border-line bg-muted text-sm hover:bg-surface-hover"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function SvgDisplacementDemo() {
  const reactId = useId();
  const filterId = `liquid-displace-${reactId.replace(/:/g, "")}`;
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const centeredRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const turbulenceRef = useRef<SVGFETurbulenceElement | null>(null);
  const seedRef = useRef(0);

  const [scale, setScale] = useState<number>(DEFAULTS.scale);
  const [frequency, setFrequency] = useState<number>(DEFAULTS.frequency);
  const [speed, setSpeed] = useState<number>(DEFAULTS.speed);
  const [lensSize, setLensSize] = useState<number>(DEFAULTS.lensSize);
  const [animate, setAnimate] = useState(true);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [lens, setLens] = useState<Lens>({ x: 0, y: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);

  const placeLens = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const half = lensSize / 2;
    setLens({
      x: Math.min(Math.max(clientX - rect.left - half, 0), rect.width - lensSize),
      y: Math.min(Math.max(clientY - rect.top - half, 0), rect.height - lensSize),
    });
  }, [lensSize]);

  const onStageResize = useEffectEvent(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    setStageSize({ width, height });
    setLens((prev) => {
      const half = lensSize / 2;
      if (!centeredRef.current && width > 0 && height > 0) {
        centeredRef.current = true;
        return {
          x: Math.max(width / 2 - half, 0),
          y: Math.max(height / 2 - half, 0),
        };
      }
      return {
        x: Math.min(Math.max(prev.x, 0), Math.max(width - lensSize, 0)),
        y: Math.min(Math.max(prev.y, 0), Math.max(height - lensSize, 0)),
      };
    });
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setReducedMotion(media.matches);
      if (media.matches) setAnimate(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    onStageResize();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onStageResize());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [lensSize]);

  useEffect(() => {
    if (!animate || reducedMotion || speed <= 0) {
      if (turbulenceRef.current) {
        turbulenceRef.current.setAttribute("seed", "2");
      }
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      seedRef.current = (seedRef.current + delta * speed * 12) % 1000;
      turbulenceRef.current?.setAttribute("seed", String(Math.floor(seedRef.current)));
      // 轻微扰动频率，让波纹像液体一样游走
      const wobble = frequency * (1 + Math.sin(now / 900) * 0.08);
      turbulenceRef.current?.setAttribute(
        "baseFrequency",
        `${wobble.toFixed(4)} ${(wobble * 1.35).toFixed(4)}`,
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [animate, frequency, reducedMotion, speed]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    placeLens(event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    placeLens(event.clientX, event.clientY);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const reset = () => {
    setScale(DEFAULTS.scale);
    setFrequency(DEFAULTS.frequency);
    setSpeed(DEFAULTS.speed);
    setLensSize(DEFAULTS.lensSize);
    setAnimate(!reducedMotion);
    const stage = stageRef.current;
    if (stage) {
      const { width, height } = stage.getBoundingClientRect();
      setLens({
        x: width / 2 - DEFAULTS.lensSize / 2,
        y: height / 2 - DEFAULTS.lensSize / 2,
      });
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">演示 · Liquid Glass</p>
            <h1 className="text-base font-bold tracking-tight sm:text-lg">
              SVG 位移滤镜折射
            </h1>
          </div>
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            返回首页
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          本页只用 SVG 滤镜链：
          <code className="mx-1 text-foreground">feTurbulence</code>
          生成湍流噪声，再经
          <code className="mx-1 text-foreground">feDisplacementMap</code>
          把透镜里的背景像素推开，形成液态玻璃式的折射与形变。拖动舞台上的透镜；手机可直接手指滑动。
        </p>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section
            ref={stageRef}
            className="relative aspect-[4/5] w-full touch-none overflow-hidden border border-line bg-black sm:aspect-[16/11]"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="application"
            aria-label="液态玻璃透镜舞台，拖动可移动透镜"
          >
            <SceneContent className="absolute inset-0" />

            <div
              className="pointer-events-none absolute overflow-hidden rounded-full border border-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_40px_rgba(0,0,0,0.35)]"
              style={{
                left: lens.x,
                top: lens.y,
                width: lensSize,
                height: lensSize,
              }}
            >
              <div
                className="absolute"
                style={{
                  left: -lens.x,
                  top: -lens.y,
                  width: stageSize.width || "100%",
                  height: stageSize.height || "100%",
                  filter: `url(#${filterId})`,
                }}
              >
                <SceneContent className="absolute inset-0" />
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_22%,rgba(255,255,255,0.38),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.12),transparent_55%,rgba(0,0,0,0.18))]" />
            </div>

            <svg width={0} height={0} className="absolute" aria-hidden>
              <defs>
                <filter
                  id={filterId}
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="140%"
                  colorInterpolationFilters="sRGB"
                >
                  <feTurbulence
                    ref={turbulenceRef}
                    type="fractalNoise"
                    baseFrequency={`${frequency} ${(frequency * 1.35).toFixed(4)}`}
                    numOctaves="3"
                    seed="2"
                    result="noise"
                  />
                  <feGaussianBlur in="noise" stdDeviation="0.6" result="softNoise" />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="softNoise"
                    scale={scale}
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </filter>
              </defs>
            </svg>
          </section>

          <aside className="flex flex-col gap-4 border border-line bg-surface p-4">
            <h2 className="text-sm font-bold tracking-tight">参数</h2>

            <SliderRow
              id="scale"
              label="折射强度"
              value={scale}
              min={0}
              max={120}
              step={1}
              nudgeStep={10}
              display={String(scale)}
              onChange={setScale}
            />
            <SliderRow
              id="frequency"
              label="湍流频率"
              value={frequency}
              min={0.004}
              max={0.06}
              step={0.001}
              nudgeStep={0.005}
              display={frequency.toFixed(3)}
              onChange={setFrequency}
            />
            <SliderRow
              id="lens-size"
              label="透镜直径"
              value={lensSize}
              min={96}
              max={260}
              step={4}
              nudgeStep={16}
              display={`${lensSize}px`}
              onChange={setLensSize}
            />
            <SliderRow
              id="speed"
              label="动画速度"
              value={speed}
              min={0}
              max={1.5}
              step={0.05}
              nudgeStep={0.1}
              display={speed.toFixed(2)}
              onChange={setSpeed}
            />

            <label className="flex min-h-8 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={animate && !reducedMotion}
                disabled={reducedMotion}
                onChange={(event) => setAnimate(event.target.checked)}
                className="size-4 accent-[var(--foreground)]"
              />
              <span>{reducedMotion ? "已跟随系统减少动态" : "液体动画"}</span>
            </label>

            <button
              type="button"
              onClick={reset}
              className="min-h-10 border border-line bg-muted px-3 text-sm hover:bg-surface-hover"
            >
              重置参数
            </button>

            <p className="text-xs leading-relaxed text-muted-foreground">
              透镜内是对齐的背景副本，再套位移滤镜；不依赖
              <code className="mx-1">backdrop-filter</code>
              的 SVG 引用，桌面与移动端行为一致。
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
