import type { Metadata } from "next";

import { CssBackdropDemo } from "./css-backdrop-demo";

export const metadata: Metadata = {
  title: "Liquid Glass · CSS Backdrop",
  description:
    "用 CSS backdrop-filter 与层叠高光模拟 Liquid Glass 的演示页：指针与滚动可交互。",
  robots: { index: false, follow: false },
};

export default function CssBackdropLiquidGlassPage() {
  return <CssBackdropDemo />;
}
