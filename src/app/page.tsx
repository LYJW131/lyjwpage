import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { WebPlayerProvider } from "@/components/web-player/web-player-provider";
import { AppVersionCard } from "@/components/app-version-card";
import { ContactCard } from "@/components/contact-card";
import { DevFakeDataToggle } from "@/components/dev-fake-data-toggle";
import { DevToggleDock } from "@/components/dev-toggles";
import { ActivityCard } from "@/components/live/activity-card";
import { SiteStatusCard } from "@/components/live/site-status-card";
import { LiveMediaPair } from "@/components/live/media-pair";
import { ServerCard } from "@/components/live/server-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { TimezoneCard } from "@/components/live/timezone-card";
import { NowWatchingCard } from "@/components/live/now-watching-card";
import { VibeCodingCard } from "@/components/live/vibecoding-card";
import { WatchingRow } from "@/components/live/watching-card";
import { Section } from "@/components/ui/section";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { desktopIconDataUri } from "@/lib/desktop-icon-inline";
import { githubAvatarDataUri } from "@/lib/github-avatar-icon";
import { getRecentCommits } from "@/lib/github-recent-commits";
import { cachedHomeSnapshot } from "@/lib/status-cache";
import type { GithubRepoPayload, StatusResponse } from "@/lib/types";

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
    snapshot.githubRepo ?? { ok: false, error: "状态暂不可用" };
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
  const liveHeroArtwork =
    nowMusic?.title && nowMusic.state !== "stopped" ? nowMusic.artworkUrl : null;
  const heroArtwork = liveHeroArtwork ?? listeningArtworks[0];
  // 实时曲目当 hero 时，历史列表从第一条开始；否则第一条已经被 hero 占用。
  const rowArtworks = liveHeroArtwork ? listeningArtworks : listeningArtworks.slice(1);

  /**
   * PlayStation 在首屏之外，一屏最多显示 9 张。HTML 先带 18 条，给合并同款和
   * 当前游戏插队留余量；客户端挂载后 useStatus 会立即拉完整列表，正常横滑和
   * 奖杯跳转仍使用全量数据。这样不让几十张游戏卡和图片地址挤进首屏文档。
   */
  const initialPlaying = playing.ok
    ? {
        ...playing,
        data: { ...playing.data, items: playing.data.items.slice(0, 18) },
      }
    : playing;

  /**
   * 内联素材与首屏歌词只能排在第二轮：要压哪几张、取哪首词写在信封里，进不了上面那批并行。
   * 桌面图标按 objectKey 缓存（lib/desktop-icon-inline）、封面占位按 Apple
   * 模板 URL 缓存（lib/artwork-placeholder）、歌词按 songId 缓存（lib/status-cache 的 cachedLyrics），
   * 命中后这里都不产生额外往返；三者彼此无关，未命中时并行把最坏等待压到单边的超时。
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
                  首屏之外的大块推迟排版，见 globals.css 的 defer-offscreen。
                  估高按 375px 上实测的高度写，锚点跳过去才落得准；`auto` 让它
                  渲染过一次之后改按真高度算，所以桌面端那份估偏也只差第一帧。

                  这三张是两列网格里的格子，只在窄屏（单列）开；整宽的那几块
                  用 defer-offscreen-always，宽窄都开。
                */}
                <ActivityCard
                  fallback={activity}
                  className="defer-offscreen [contain-intrinsic-size:auto_214px]"
                />
                <ServerCard
                  fallback={server}
                  className="defer-offscreen [contain-intrinsic-size:auto_245px]"
                />
                <VibeCodingCard
                  fallback={vibeCoding}
                  className="defer-offscreen [contain-intrinsic-size:auto_1372px]"
                />
                <PlaystationBlock
                  trophies={trophies}
                  playing={initialPlaying}
                  playingNow={playingNow}
                  className="defer-offscreen-always md:col-span-2 [contain-intrinsic-size:auto_643px]"
                />
              </div>

              <SiteStatusCard
                githubFallback={githubRepo}
                vercelFallback={snapshot.vercelDeployments ?? { ok: false, error: "部署暂不可用" }}
                cloudflareFallback={snapshot.cloudflareWorkers ?? { ok: false, error: "统计暂不可用" }}
                recentCommits={recentCommits}
                className="mt-3 defer-offscreen-always [contain-intrinsic-size:auto_1319px]"
              />

              <div
                id="watching"
                className="mt-6 scroll-mt-28 border-t border-line pt-5 defer-offscreen-always [contain-intrinsic-size:auto_270px]"
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">最近在看</h3>
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
