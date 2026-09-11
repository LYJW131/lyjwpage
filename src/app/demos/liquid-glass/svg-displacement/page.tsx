import type { Metadata } from "next";

import { SvgDisplacementDemo } from "./svg-displacement-demo";

export const metadata: Metadata = {
  title: "Liquid Glass · SVG 位移滤镜",
  description:
    "用 SVG feTurbulence 与 feDisplacementMap 做液态玻璃折射与形变演示，可拖动透镜并调节参数。",
  robots: { index: false, follow: false },
};

export default function SvgDisplacementPage() {
  return <SvgDisplacementDemo />;
}
