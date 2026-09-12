import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Liquid Glass 演示",
  description: "网页端 Liquid Glass 主流实现方案索引与对比入口",
  robots: { index: false, follow: false },
};

const DEMOS = [
  {
    href: "/demos/liquid-glass/css-backdrop",
    title: "CSS backdrop-filter",
    summary: "毛玻璃层叠 + 边缘高光，跨浏览器基线，无真实折射。",
  },
  {
    href: "/demos/liquid-glass/svg-displacement",
    title: "SVG feTurbulence + feDisplacementMap",
    summary: "位移图扭曲像素；挂 backdrop-filter 时折射多见于 Chromium。",
  },
  {
    href: "/demos/liquid-glass/webgl-refraction",
    title: "WebGL / Shader 折射",
    summary: "片元着色器采样背景纹理，透镜跟随与色散可控。",
  },
  {
    href: "/demos/liquid-glass/canvas-lib",
    title: "Canvas / 现成库封装",
    summary: "组件或 WebGL 库封装上述手法，接入快、行为随库而异。",
  },
] as const;

export default function LiquidGlassDemosIndexPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <header className="space-y-3 border-b border-line pb-6">
        <p className="text-sm text-muted-foreground">
          <Link href="/" className="underline-offset-2 hover:underline">
            ← 首页
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Liquid Glass 演示
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          对比网页上近似 Apple 液态玻璃的四类主流做法。下列子页由并行任务填充；未就绪时可能显示「建设中」。
        </p>
      </header>

      <ol className="mt-6 space-y-3">
        {DEMOS.map((demo, index) => (
          <li key={demo.href}>
            <Link
              href={demo.href}
              className="block rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-base font-medium text-foreground">{demo.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                {demo.summary}
              </span>
              <span className="mt-2 block font-mono text-xs text-muted-foreground">{demo.href}</span>
            </Link>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        方案对比说明见 Agent Store：
        <code className="mx-1">docs/liquid-glass-web-approaches.md</code>。
      </p>
    </main>
  );
}
