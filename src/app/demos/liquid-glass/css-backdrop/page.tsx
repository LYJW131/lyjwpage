import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "CSS backdrop-filter · Liquid Glass",
  robots: { index: false, follow: false },
};

/** 占位：完整演示由并行 agent 实现。 */
export default function CssBackdropPlaceholderPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        <Link href="/demos/liquid-glass" className="underline-offset-2 hover:underline">
          ← 索引
        </Link>
      </p>
      <h1 className="mt-4 text-xl font-semibold text-foreground">CSS backdrop-filter</h1>
      <p className="mt-3 text-sm text-muted-foreground">建设中</p>
    </main>
  );
}
