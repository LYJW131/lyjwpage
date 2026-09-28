import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { WebPlayerProvider } from "@/components/web-player/web-player-provider";
import { AppVersionCard } from "@/components/app-version-card";
import { ContactCard } from "@/components/contact-card";
import { DevFakeDataToggle } from "@/components/dev-fake-data-toggle";
import { DevToggleDock } from "@/components/dev-toggles";
import { WorkoutsStrip } from "@/components/live/workouts-strip";
import { ActivityCard } from "@/components/live/activity-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { ServerCard } from "@/components/live/server-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { PulseCard } from "@/components/live/pulse-card";
import { TimezoneCard } from "@/components/live/timezone-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { AgentStatusCard } from "@/components/live/agent-status-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { desktopIconDataUri } from "@/lib/desktop-icon-inline";
import { githubAvatarDataUri } from "@/lib/github-avatar-icon";
import { getRecentCommits } from "@/lib/github-recent-commits";
import { firstScreen, firstScreenLyrics } from "@/lib/first-screen";
import { liveTrack } from "@/lib/home-layout";
import type { StatusResponse, TrophiesSummaryPayload } from "@/lib/types";

export default async function Home() {
  /**
   * 首屏按卡读取，各卡一条缓存（见 lib/first-screen）：实时卡的端点读状态核心，
   * 可滞后卡的端点读 KV。并行发出，任何一张都不在请求路径上现拉外部 API。
   */
  const [
    desktop,
    timezone,
    workouts,
    activity,
    server,
    charger,
    powerBank,
    listening,
    nowListening,
    vibeCoding,
    limits,
    agentStatus,
    vibeCodingYear,
    watching,
    nowWatching,
    playing,
    playingNow,
    trophiesEnvelope,
    githubChart,
    githubRepo,
    cloudflareWorkers,
    vercelDeployments,
    sentry,
    reporters,
    pulse,
    avatarDataUri,
    recentCommits,
  ] = await Promise.all([
    firstScreen("desktop"),
    firstScreen("timezone"),
    firstScreen("workouts"),
    firstScreen("activity"),
    firstScreen("server"),
    firstScreen("charger"),
    firstScreen("powerBank"),
    firstScreen("listening"),
    firstScreen("nowListening"),
    firstScreen("vibeCoding"),
    firstScreen("limits"),
    firstScreen("agentStatus"),
    firstScreen("vibeCodingYear"),
    firstScreen("watching"),
    firstScreen("nowWatching"),
    firstScreen("playing"),
    firstScreen("playingNow"),
    firstScreen("trophies"),
    firstScreen("githubChart"),
    firstScreen("githubRepo"),
    firstScreen("cloudflareWorkers"),
    firstScreen("vercelDeployments"),
    firstScreen("sentry"),
    firstScreen("reporters"),
    firstScreen("pulse"),
    githubAvatarDataUri(),
    getRecentCommits(),
  ]);
  /** 无参的奖杯端点回的是摘要（带 `?titleids=` 才是目录），首屏这格就是那份摘要 */
  const trophies = trophiesEnvelope as StatusResponse<TrophiesSummaryPayload>;

  const nowSongId =
    nowListening.ok && !nowListening.data.idle && nowListening.data.hasLyrics
      ? nowListening.data.songId
      : null;

  const listeningArtworks = listening.ok
    ? listening.data.items.map((item) => item.artwork)
    : [];
  const nowMusic = nowListening.ok && !nowListening.data.idle ? nowListening.data.music : null;
  const liveHeroArtwork = liveTrack(nowMusic)?.artworkUrl ?? null;
  const heroArtwork = liveHeroArtwork ?? listeningArtworks[0];
  // 实时曲目当 hero 时，历史列表从第一条开始；否则第一条已经被 hero 占用。
  const rowArtworks = liveHeroArtwork ? listeningArtworks : listeningArtworks.slice(1);

  /**
   * 内联素材与首屏歌词只能排在第二轮：要压哪几张、要哪首的歌词写在信封里，进不了
   * 上面那批并行。桌面图标按 objectKey 缓存（lib/desktop-icon-inline）、封面占位按
   * Apple 模板 URL 缓存（lib/artwork-placeholder）、歌词按曲目缓存（lib/first-screen）；
   * 命中缓存后这里不产生额外往返。
   */
  const [desktopIcon, artwork, lyrics] = await Promise.all([
    desktopIconDataUri(desktop.ok ? (desktop.data.desktop?.iconUrl ?? null) : null),
    artworkPlaceholders(rowArtworks, heroArtwork),
    nowSongId ? firstScreenLyrics(nowSongId) : Promise.resolve(null),
  ]);

  return (
    <>
      <WebPlayerProvider>
        <Header desktop={desktop} desktopIconDataUri={desktopIcon} />

        <main className="flex-1">
          <div className="mx-auto my-3.5 w-[calc(100%-2rem)] max-w-5xl sm:my-4">
            <Section id="live" className="p-0 sm:p-0">
              <AppVersionCard />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ContactCard
                  avatarDataUri={avatarDataUri}
                  chartFallback={githubChart}
                  yearFallback={vibeCodingYear}
                />
                <TimezoneCard fallback={timezone} />
              </div>

              {/*
                「正在播放」放在两个网格之间、不进网格：进网格的话收起时高度能到 0，
                网格那 12px 的 gap 却要等它卸载才消失，动画末尾会跳一下。它自己的
                上边距跟着高度一起动画，见 now-watching-card。没在播时整个不渲染。
              */}
              <NowWatchingCard nowFallback={nowWatching} />

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <LiveMediaPair
                  chargerFallback={charger}
                  powerBankFallback={powerBank}
                  listeningFallback={listening}
                  nowListeningFallback={nowListening}
                  lyricsFallback={
                    nowSongId && lyrics && lyrics.lines.length
                      ? { songId: nowSongId, lines: lyrics.lines, songwriters: lyrics.songwriters }
                      : null
                  }
                  artworkPlaceholders={artwork}
                />
                {/*
                  首屏之外的大块先不排版，见 globals.css 的 defer-offscreen。
                  估高按 375px 上实测的高度写，锚点跳过去才落得准；`auto` 让它
                  渲染过一次之后改按真高度算，所以桌面端那份估偏也只差第一帧。

                  这三张是两列网格里的格子，只在窄屏（单列）开；整宽的那几块
                  用 defer-offscreen-always，宽窄都开。首屏 load 之后整页揭开，
                  不再等滚到跟前。
                */}
                <ActivityCard
                  fallback={activity}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_350px] md:[contain-intrinsic-size:auto_253px]"
                >
                  <WorkoutsStrip fallback={workouts} />
                </ActivityCard>
                <ServerCard
                  fallback={server}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_245px]"
                />
                <AgentStatusCard
                  fallback={agentStatus}
                  className="defer-offscreen-always [contain-intrinsic-size:auto_172px]"
                />
                <VibeCodingCard
                  fallback={vibeCoding}
                  limitsFallback={limits}
                  className="defer-offscreen [contain-intrinsic-size:auto_1372px]"
                />
                <PlaystationBlock
                  trophies={trophies}
                  playing={playing}
                  playingNow={playingNow}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_643px]"
                />
                {/* Pulse 夹在 PlayStation 与 Emby Recently Watched 中间 */}
                <PulseCard
                  fallback={pulse}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_240px]"
                />
              </div>

              <SiteStatusCard
                githubFallback={githubRepo}
                vercelFallback={vercelDeployments}
                cloudflareFallback={cloudflareWorkers}
                sentryFallback={sentry}
                serverFallback={server}
                reportersFallback={reporters}
                recentCommits={recentCommits}
                className="mt-3 defer-offscreen-always [contain-intrinsic-size:auto_1440px]"
              />

              <div
                id="watching"
                className="mt-6 scroll-mt-28 border-t border-line pt-5 defer-offscreen-always [contain-intrinsic-size:auto_270px]"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">Recently Watched</h3>
                  <span className="label-mono text-muted-foreground">Emby</span>
                </div>
                <WatchingRow fallback={watching} nowFallback={nowWatching} />
              </div>
            </Section>
          </div>
        </main>
      </WebPlayerProvider>

      <Footer />

      {/* 开发环境右下角的调试胶囊：Dock 是容器，各组件把自己的开关传送进来；生产不渲染 */}
      <DevToggleDock />
      <DevFakeDataToggle />
    </>
  );
}
