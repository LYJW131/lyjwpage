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
import { ReliabilityCard } from "@/components/live/reliability-card";
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
import { liveTrack } from "@/lib/home-layout";
import { cachedHomeSnapshot } from "@/lib/home-snapshot";
import type { GithubRepoPayload, PulsePayload, StatusResponse } from "@/lib/types";

export default async function Home() {
  const [snapshot, avatarDataUri, recentCommits] = await Promise.all([
    cachedHomeSnapshot(),
    githubAvatarDataUri(),
    getRecentCommits(),
  ]);
  /**
   * 仓库统计跟着快照走（Worker 取、Worker 缓存）。旧 Worker 还没带这个字段时
   * 给一份降级信封：直接透传 undefined 会在 useStatus 读 fallback.ok 时整页
   * 跌进 error 边界。
   */
  const githubRepo: StatusResponse<GithubRepoPayload> =
    snapshot.githubRepo ?? { ok: false, error: "Status unavailable" };
  /** 同理：Worker 还没带 pulse 字段时，卡片自己显示空态，不能让整页跌进错误边界 */
  const pulse: StatusResponse<PulsePayload> =
    snapshot.pulse ?? { ok: false, error: "Pulse unavailable" };
  const {
    desktop,
    activity,
    server,
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
    trophies,
    githubChart,
    lyrics,
  } = snapshot;

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
   * 内联素材只能排在第二轮：要压哪几张写在信封里，进不了上面那批并行。
   * 桌面图标按 objectKey 缓存（lib/desktop-icon-inline）、封面占位按 Apple
   * 模板 URL 缓存（lib/artwork-placeholder）；歌词已在 `/api/home` 的 `lyrics`
   * 字段里由 Worker 现解，跟着 snapshot 一起来。命中缓存后这里不产生额外往返。
   */
  const [desktopIcon, artwork] = await Promise.all([
    desktopIconDataUri(desktop.ok ? (desktop.data.desktop?.iconUrl ?? null) : null),
    artworkPlaceholders(rowArtworks, heroArtwork),
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
                  <WorkoutsStrip fallback={snapshot.workouts ?? { ok: false, error: "Awaiting workout report" }} />
                </ActivityCard>
                <ServerCard
                  fallback={server}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_245px]"
                />
                <AgentStatusCard
                  fallback={snapshot.agentStatus ?? { ok: false, error: "Status unavailable" }}
                  className="defer-offscreen-always [contain-intrinsic-size:auto_172px]"
                />
                <VibeCodingCard
                  fallback={vibeCoding}
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
                vercelFallback={snapshot.vercelDeployments ?? { ok: false, error: "Deployments unavailable" }}
                cloudflareFallback={snapshot.cloudflareWorkers ?? { ok: false, error: "Stats unavailable" }}
                recentCommits={recentCommits}
                className="mt-3 defer-offscreen-always [contain-intrinsic-size:auto_1319px]"
              />

              <ReliabilityCard
                fallback={snapshot.sentry ?? { ok: false, error: "Reliability unavailable" }}
                className="mt-3 defer-offscreen-always [contain-intrinsic-size:auto_420px]"
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
