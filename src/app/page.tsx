import { Header } from "@/components/header";
import { ContactCard } from "@/components/contact-card";
import { ChargerCard } from "@/components/live/charger-card";
import { ListeningCard } from "@/components/live/listening-card";
import { LiveDeskCard } from "@/components/live/live-desk-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Container, Section } from "@/components/ui/section";
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
   * 八份数据在服务端并行读一遍，结果当各卡片 SWR 的 fallbackData —— 首屏 HTML
   * 自带数据，不再是「静态壳子 + 挂载后八个请求」。
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
      <Header />

      <main className="flex-1">
        <Container>
          <Section id="live" label="FIG_001" title="此刻" note="实时">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <LiveDeskCard fallback={desktop} />
              {/*
                充电头和听歌绑成一对：同一行里 items-stretch + 各自 h-full，
                避免两张卡各算各的固有高度、加载完一边突然变高。
              */}
              <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2 md:items-stretch">
                <ChargerCard fallback={charger} className="h-full" />
                <ListeningCard
                  fallback={listening}
                  nowFallback={nowListening}
                  className="h-full"
                />
              </div>
              <VibeCodingCard fallback={vibeCoding} />
              <TimezoneCard fallback={timezone} />
              <ContactCard />
            </div>

            <div className="mt-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">最近在看</h3>
                <span className="label-mono text-muted-foreground">Emby</span>
              </div>
              <WatchingRow fallback={watching} nowFallback={nowWatching} />
            </div>
          </Section>
        </Container>
      </main>
    </>
  );
}
