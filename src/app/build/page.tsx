import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";

import { BuildConsole } from "./build-console";

export const metadata: Metadata = {
  title: "Build",
  robots: { index: false, follow: false },
};

// 触发端点只在 api Worker 的分支预览上有令牌，生产部署不挂这个页面。
export default function BuildPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <HomeLink />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 py-6 sm:py-10">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-2xl">
          <BuildConsole />
        </div>
      </main>
    </>
  );
}
