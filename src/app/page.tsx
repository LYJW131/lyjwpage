import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { ContactCard } from "@/components/contact-card";
import { ActivityCard } from "@/components/live/activity-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { PlaystationCard } from "@/components/live/playstation-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import {
  cachedActivity,
  cachedCharger,
  cachedPowerBank,
  cachedDesktop,
  cachedGithubChart,
  cachedListening,
  cachedNowListening,
  cachedNowWatching,
  cachedPlaying,
  cachedPlayingNow,
  cachedTimezone,
  cachedVibeCoding,
  cachedVibeCodingYear,
  cachedWatching,
} from "@/lib/status-cache";

export default async function Home() {
  /**
   * 服务端并行读首屏数据。状态卡片使用 fallbackData；时区没有
   * status 轮询端点，在服务端预渲染时直接烧进静态 HTML。热力图也烧进去，
   * 客户端不在进页时回源，只按很长的间隔打热力图接口。
   *
   * 每份都是缓存过的（见 lib/status-cache）：整页因此能预渲染成静态壳，
   * 上报进来时按 tag 失效，Redis 从「每访客读一轮」变成「每次上报后读一轮」。
   * 一份读失败只让那张卡拿到 ok:false，信封不会 reject，Promise.all 不会被拖垮。
   */
  const [
    desktop,
    activity,
    charger,
    powerBank,
    listening,
    nowListening,
    timezone,
    vibeCoding,
    vibeCodingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    githubChart,
  ] = await Promise.all([
    cachedDesktop(),
    cachedActivity(),
    cachedCharger(),
    cachedPowerBank(),
    cachedListening(),
    cachedNowListening(),
    cachedTimezone(),
    cachedVibeCoding(),
    cachedVibeCodingYear(),
    cachedWatching(),
    cachedNowWatching(),
    cachedPlaying(),
    cachedPlayingNow(),
    cachedGithubChart(),
  ]);

  return (
    <>
      <Header desktop={desktop} />

      <main className="flex-1">
        <div className="mx-auto my-3.5 w-[calc(100%-2rem)] max-w-5xl sm:my-4">
          <Section id="live" className="p-0 sm:p-0">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ContactCard chartFallback={githubChart} yearFallback={vibeCodingYear} />
              <TimezoneCard fallback={timezone} />
              <LiveMediaPair
                chargerFallback={charger}
                powerBankFallback={powerBank}
                listeningFallback={listening}
                nowListeningFallback={nowListening}
              />
              <ActivityCard fallback={activity} />
              <VibeCodingCard fallback={vibeCoding} />
              <PlaystationCard fallback={playing} nowFallback={playingNow} />
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
