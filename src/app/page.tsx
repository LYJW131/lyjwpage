import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { ContactCard } from "@/components/contact-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { TimezoneCard } from "@/components/live/timezone-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import {
  cachedCharger,
  cachedDesktop,
  cachedListening,
  cachedNowListening,
  cachedNowWatching,
  cachedTimezone,
  cachedVibeCoding,
  cachedWatching,
} from "@/lib/status-cache";

export default async function Home() {
  /**
   * 八份数据在服务端并行读一遍。七份当各卡片 SWR 的 fallbackData；时区没有
   * status 端点，只给首屏用。不再是「静态壳子 + 挂载后一串请求」。
   *
   * 每份都是缓存过的（见 lib/status-cache）：整页因此能预渲染成静态壳，
   * 上报进来时按 tag 失效，Redis 从「每访客读一轮」变成「每次上报后读一轮」。
   * 一份读失败只让那张卡拿到 ok:false，信封不会 reject，Promise.all 不会被拖垮。
   */
  const [desktop, charger, listening, nowListening, timezone, vibeCoding, watching, nowWatching] =
    await Promise.all([
      cachedDesktop(),
      cachedCharger(),
      cachedListening(),
      cachedNowListening(),
      cachedTimezone(),
      cachedVibeCoding(),
      cachedWatching(),
      cachedNowWatching(),
    ]);

  return (
    <>
      <Header desktop={desktop} />

      <main className="flex-1">
        <div className="mx-auto my-5 w-[calc(100%-2rem)] max-w-5xl sm:my-6">
          <Section id="live" className="px-0 pt-6 sm:px-0 sm:pt-8">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <LiveMediaPair
                chargerFallback={charger}
                listeningFallback={listening}
                nowListeningFallback={nowListening}
              />
              <VibeCodingCard fallback={vibeCoding} />
              <TimezoneCard fallback={timezone} />
              <ContactCard />
            </div>

            <div id="watching" className="mt-6 scroll-mt-28 border-t border-line pt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">最近在看</h3>
                <span className="label-mono text-muted-foreground">Emby</span>
              </div>
              <WatchingRow fallback={watching} nowFallback={nowWatching} />
            </div>
          </Section>
        </div>
      </main>

      <Footer />
    </>
  );
}
