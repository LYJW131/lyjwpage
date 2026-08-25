import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { TrophyCabinet } from "@/components/trophies/trophy-cabinet";
import { Section } from "@/components/ui/section";
import { cachedDesktop, cachedTrophies } from "@/lib/status-cache";

export const metadata: Metadata = {
  title: "奖杯陈列室",
  description: "PlayStation 奖杯等级、解锁节奏和逐个奖杯明细。",
};

export default async function TrophiesPage() {
  const [desktop, trophies] = await Promise.all([cachedDesktop(), cachedTrophies()]);

  return (
    <>
      <Header desktop={desktop} />
      <main className="flex-1">
        <div className="mx-auto my-3.5 w-[calc(100%-2rem)] max-w-5xl sm:my-4">
          <Section
            id="trophies"
            label="FIG_TROPHY"
            title="奖杯陈列室"
            note={<Link href="/">返回首页</Link>}
            className="p-4 sm:p-6"
          >
            <Suspense
              fallback={
                <div className="flex h-40 items-center justify-center border border-dashed border-line text-sm text-muted-foreground">
                  正在读取奖杯目录
                </div>
              }
            >
              <TrophyCabinet fallback={trophies} />
            </Suspense>
          </Section>
        </div>
      </main>
      <Footer />
    </>
  );
}
