import type { Metadata } from "next";

import { WebglRefractionDemo } from "@/components/demos/liquid-glass/webgl-refraction-demo";

export const metadata: Metadata = {
  title: "Liquid Glass · WebGL 折射",
  description: "用 WebGL / fragment shader 做背景折射与色散的 Liquid Glass 交互演示。",
  robots: { index: false, follow: false },
};

export default function WebglRefractionLiquidGlassPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 space-y-2 border-b border-line pb-4">
        <p className="text-xs tracking-wide text-muted-foreground">演示 · Liquid Glass</p>
        <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          WebGL / Shader 折射
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          场景先画进离屏纹理，再在玻璃 SDF 内按法线偏移采样，叠色散与磨砂多点模糊。本页只演示这一条技术路线。
        </p>
      </header>
      <WebglRefractionDemo />
    </main>
  );
}
