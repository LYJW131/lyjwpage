import { SignalTelemetry } from "@/components/signal/telemetry";
import { SignalProfile } from "@/components/signal/profile";
import { Footer } from "@/components/footer";
import { SignalExperience } from "@/components/signal/experience";
import { HeaderDesktop } from "@/components/live/live-desk-card";
import { ListeningCard } from "@/components/live/listening-card";
import { PlaystationBlock } from "@/components/live/playstation-block";
import { WatchingRow } from "@/components/live/watching-card";
import { artworkPlaceholders } from "@/lib/artwork-placeholder";
import { desktopIconDataUri } from "@/lib/desktop-icon-inline";
import { githubAvatarDataUri } from "@/lib/github-avatar-icon";
import {
  cachedActivity,
  cachedServer,
  cachedCharger,
  cachedPowerBank,
  cachedDesktop,
  cachedGithubChart,
  cachedListening,
  cachedLyrics,
  cachedNowListening,
  cachedNowWatching,
  cachedPlaying,
  cachedPlayingNow,
  cachedTrophiesSummary,
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
   * 上报只把 page 标签标成 stale，访客先拿旧 HTML，取数重建留在后台。
   * 一份读失败只让那张卡拿到 ok:false，信封不会 reject，Promise.all 不会被拖垮。
   */
  const [
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
    avatarDataUri,
  ] = await Promise.all([
    cachedDesktop("page"),
    cachedActivity("page"),
    cachedServer("page"),
    cachedCharger(),
    cachedPowerBank(),
    cachedListening("page"),
    cachedNowListening(),
    cachedTimezone(),
    cachedVibeCoding("page"),
    cachedVibeCodingYear("page"),
    cachedWatching("page"),
    cachedNowWatching("page"),
    cachedPlaying("page"),
    cachedPlayingNow("page"),
    cachedTrophiesSummary(),
    cachedGithubChart(),
    // 不是状态数据，是构建期就定死的那张头像 —— 一起 await 免得多排一轮
    githubAvatarDataUri(),
  ]);

  const nowSongId =
    nowListening.ok && !nowListening.data.idle && nowListening.data.hasLyrics
      ? nowListening.data.songId
      : null;

  /**
   * 内联素材与首屏歌词只能排在第二轮：要压哪几张、取哪首词写在信封里，进不了上面那批并行。
   * 桌面图标按 objectKey 缓存（lib/desktop-icon-inline）、封面占位按 Apple
   * 模板 URL 缓存（lib/artwork-placeholder）、歌词按 songId 缓存（lib/status-cache 的 cachedLyrics），
   * 命中后这里都不产生额外往返；三者彼此无关，未命中时并行把最坏等待压到单边的超时。
   */
  const [desktopIcon, artwork, lyrics] = await Promise.all([
    desktopIconDataUri(
      desktop.ok ? (desktop.data.desktop?.iconUrl ?? null) : null,
    ),
    artworkPlaceholders(
      listening.ok ? listening.data.items.map((item) => item.artwork) : [],
      nowListening.ok ? (nowListening.data.music?.artworkUrl ?? null) : null,
    ),
    nowSongId ? cachedLyrics(nowSongId) : null,
  ]);

  return (
    <SignalExperience
      listening={listening}
      nowListening={nowListening}
      desktop={
        <HeaderDesktop
          key="desktop"
          fallback={desktop}
          iconDataUri={desktopIcon}
        />
      }
      music={
        <ListeningCard
          key="music"
          presentation="stage"
          fallback={listening}
          nowFallback={nowListening}
          lyricsFallback={
            lyrics && lyrics.lines.length
              ? { lines: lyrics.lines, songwriters: lyrics.songwriters }
              : null
          }
          artworkPlaceholders={artwork}
          wide
          className="signal-listening"
        />
      }
      cinema={
        <WatchingRow
          key="cinema"
          presentation="theatre"
          fallback={watching}
          nowFallback={nowWatching}
        />
      }
      games={
        <PlaystationBlock
          key="games"
          presentation="gallery"
          trophies={trophies}
          playing={playing}
          playingNow={playingNow}
        />
      }
      systems={
        <SignalTelemetry
          key="systems"
          vibeCoding={vibeCoding}
          server={server}
          charger={charger}
          powerBank={powerBank}
          activity={activity}
        />
      }
      about={
        <SignalProfile
          key="about"
          avatarDataUri={avatarDataUri}
          chartFallback={githubChart}
          yearFallback={vibeCodingYear}
          timezoneFallback={timezone}
        />
      }
      footer={<Footer key="footer" />}
    />
  );
}
