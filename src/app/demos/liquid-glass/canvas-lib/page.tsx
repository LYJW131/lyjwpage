import type { Metadata } from "next";

import { LiquidGlassCanvasLibDemo } from "@/components/demos/liquid-glass-canvas-lib-demo";

export const metadata: Metadata = {
  title: "Canvas 库 · Liquid Glass",
  description: "Canvas 2D 背景 + liquid-glass-canvas 库的液体玻璃折射演示",
  robots: { index: false, follow: false },
};

export default function LiquidGlassCanvasLibPage() {
  return <LiquidGlassCanvasLibDemo />;
}
